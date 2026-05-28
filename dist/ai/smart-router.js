import { PROVIDER_TIERS, isLocalFallbackEnabled } from '../config/keys.js';
import { createSingleClient } from './client-factory.js';
import { addFallbackEvent, clearFallbackEvents, clearRequestSkips, getFallbackEvents, getHealthRecord, getProviderCooldownRemaining, isOnCooldown, isProviderOnCooldown, isUnhealthy, markHealth, markModelCooldown, markProviderCooldown, setLastFallbackUsed, setLastSuccessfulProvider, recordRequestLatency, recordErrorAnalytics, recordRecoverySuccess, recordStreamInterruption, } from './model-health.js';
import { classifyTask } from './task-classifier.js';
import { getCandidatesForTask, getSkippedProviderReasons } from './model-registry.js';
import { listOllamaModels } from './ollama.js';
import { getBestProviderForTask, getRetryAfterSeconds, isRateLimitError, isTimeoutError, } from './provider-policy.js';
import { logProviderSuccess, logProviderFailure } from '../brain/graph-store.js';
import { hasVisionCapability } from './provider-capabilities.js';
import { getProviderTimeoutForTask } from './timeout-utils.js';
const LOG = '[SmartRouter]';
const ATTEMPT_TIMEOUT_MS = 25000;
const MAX_TOTAL_TIME_MS = 120000;
const LOCAL_TIMEOUT_MS = 15000;
const PROVIDER_FAILURE_COOLDOWN_THRESHOLD = 3;
const ONLINE_FREE_UNAVAILABLE_MESSAGE = 'All configured online free providers are currently unavailable or rate-limited. Try again shortly or configure another provider.';
let requestCounter = 0;
function getEnvInt(key, defaultVal) {
    const v = process.env[key];
    if (v) {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0)
            return n;
    }
    return defaultVal;
}
let lastTaskKind = 'unknown';
function getAttemptTimeout(provider) {
    const tier = PROVIDER_TIERS[provider];
    if (tier === 'local_free')
        return LOCAL_TIMEOUT_MS;
    const envTimeout = getEnvInt('HYSA_CHAT_TIMEOUT_MS', 0);
    if (envTimeout > 0)
        return envTimeout;
    return getProviderTimeoutForTask(provider, lastTaskKind);
}
function validateProviderConsistency(provider, model, taskKind) {
    console.log('[provider] selected provider:', provider);
    console.log('[provider] routed model:', model);
    if (taskKind === 'image_vision' && !hasVisionCapability(provider, model)) {
        console.log('[provider] MISMATCH: text-only model selected for vision task');
        return false;
    }
    return true;
}
export function createSmartRouter(config, _signal) {
    const debug = !!config.debug;
    const isWeb = !!process.env.HYSA_WEB_MODE || false;
    function getMaxAttempts() {
        if (isWeb)
            return getEnvInt('HYSA_WEB_MODEL_MAX_ATTEMPTS', 6);
        return getEnvInt('HYSA_MODEL_MAX_ATTEMPTS', 6);
    }
    const router = {
        async sendMessage(messages, systemPrompt, signal) {
            const reqId = ++requestCounter;
            const startTime = Date.now();
            clearRequestSkips();
            clearFallbackEvents();
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            const lastText = typeof lastUser?.content === 'string' ? lastUser.content : '';
            // ── Classify task ──
            const taskKind = classifyTask(messages);
            lastTaskKind = taskKind;
            if (debug)
                console.log(`${LOG}[req:${reqId}] Task: ${taskKind}`);
            // ── Browser / skill tasks — no model call ──
            if (taskKind === 'browser_task') {
                return { message: 'Use /browser commands to control the browser.', toolCalls: [] };
            }
            if (taskKind === 'skill_task') {
                return { message: 'Use @skill or /skill to load a specialized skill.', toolCalls: [] };
            }
            // ── Build candidate list ──
            const runtimeModels = await getRuntimeProviderModels(config, taskKind);
            const healthChecker = { isOnCooldown, isUnhealthy, isProviderOnCooldown };
            const candidates = getCandidatesForTask(taskKind, config, healthChecker, runtimeModels);
            const maxAttempts = getMaxAttempts();
            const attempts = buildAttemptPlan(candidates, taskKind, maxAttempts);
            const bestProvider = getBestProviderForTask(taskKind, config, runtimeModels);
            if (debug) {
                console.log(`${LOG}[req:${reqId}] Best provider for ${taskKind}: ${bestProvider ?? 'none'}`);
                console.log(`${LOG}[req:${reqId}] Smart router candidates (planned ${attempts.length}/${candidates.length}, max ${maxAttempts}):`);
                for (let i = 0; i < candidates.length; i++) {
                    const c = candidates[i];
                    const marker = i < maxAttempts ? '→' : ' ';
                    console.log(`  ${marker} ${i + 1}. ${c.label} (${c.priority})`);
                }
                const skipped = getSkippedProviderReasons(config);
                if (skipped.length > 0) {
                    console.log(`  Skipped providers:`);
                    for (const s of skipped) {
                        console.log(`  - ${s.provider} — ${s.reason}`);
                    }
                }
            }
            // ── Try candidates ──
            if (attempts.length === 0) {
                const localHint = isLocalFallbackEnabled(config)
                    ? 'Local fallback is enabled, but no local chat-capable model is currently usable.'
                    : 'Local fallback is disabled. To enable it, set HYSA_ENABLE_LOCAL_FALLBACK=true.';
                throw new Error(`${ONLINE_FREE_UNAVAILABLE_MESSAGE} ${localHint}`);
            }
            let lastError = null;
            const providerStats = new Map();
            const providerTargets = countProviderTargets(attempts);
            const skippedProviders = new Set();
            for (let i = 0; i < attempts.length; i++) {
                const c = attempts[i];
                if (isProviderOnCooldown(c.provider)) {
                    if (!skippedProviders.has(c.provider)) {
                        skippedProviders.add(c.provider);
                        const remaining = Math.ceil(getProviderCooldownRemaining(c.provider) / 1000);
                        addFallbackEvent(c.provider, '', `Skipped ${c.provider}: provider cooldown ${remaining}s`);
                        if (debug)
                            console.log(`${LOG}[req:${reqId}] Skipping ${c.provider}: provider cooldown ${remaining}s`);
                    }
                    continue;
                }
                const timeoutMs = getAttemptTimeout(c.provider);
                const attemptLabel = `Attempt ${i + 1}/${attempts.length}`;
                if (debug) {
                    console.log(`${LOG}[req:${reqId}] ${attemptLabel}: ${c.label} (timeout: ${timeoutMs / 1000}s)`);
                    const healthRecord = getHealthRecord(c.provider, c.model);
                    console.log(`[router] candidate ${i + 1} - health: ${healthRecord?.status ?? 'unknown'}`);
                }
                else {
                    console.log(`  Smart: Trying ${c.label}...`);
                }
                validateProviderConsistency(c.provider, c.model, taskKind);
                // Request tracing
                console.log('[provider] selected provider:', c.provider);
                console.log('[provider] actual upstream provider:', c.provider);
                console.log('[provider] routed model:', c.model);
                console.log('[provider] payload type: text');
                console.log('[provider] capability type:', hasVisionCapability(c.provider, c.model) ? 'vision' : 'text-only');
                const client = createSingleClient(c.provider, c.model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel, config);
                const ac = new AbortController();
                const timer = setTimeout(() => ac.abort(), timeoutMs);
                if (signal) {
                    signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
                }
                try {
                    const attemptStart = Date.now();
                    addFallbackEvent(c.provider, c.model, `Trying ${c.label}...`);
                    const result = await client.sendMessage(messages, systemPrompt, ac.signal);
                    clearTimeout(timer);
                    if (!result.message?.trim() && (!result.toolCalls || result.toolCalls.length === 0)) {
                        throw new Error(`${c.label} returned an empty response.`);
                    }
                    const duration = Date.now() - attemptStart;
                    markHealth(c.provider, c.model, 'healthy', 'success', 'unknown', duration);
                    logProviderSuccess(c.provider, c.model).catch(() => { });
                    setLastSuccessfulProvider(c.provider, c.model);
                    if (c.provider !== config.currentProvider || c.model !== config.currentModel || i > 0) {
                        setLastFallbackUsed(c.label);
                        addFallbackEvent(c.provider, c.model, `Switched to ${c.label}`);
                    }
                    if (debug) {
                        console.log(`${LOG}[req:${reqId}] ✅ ${c.label} succeeded in ${(duration / 1000).toFixed(1)}s`);
                    }
                    else {
                        console.log(`  ✅ ${c.label} — ${(duration / 1000).toFixed(1)}s`);
                    }
                    return result;
                }
                catch (err) {
                    clearTimeout(timer);
                    lastError = err;
                    const errMsg = lastError.message || '';
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    const cat = categorizeError(errMsg || String(err));
                    const retryAfter = getRetryAfterSeconds(err);
                    const cooldownSec = retryAfter ?? getCooldownSeconds(cat);
                    markHealth(c.provider, c.model, 'unhealthy', errMsg, cat);
                    logProviderFailure(c.provider, c.model, errMsg).catch(() => { });
                    if (cat === 'rate_limit' || cat === 'timeout' || cat === 'quota') {
                        markModelCooldown(c.provider, c.model, errMsg, cooldownSec, cat);
                    }
                    const providerCooldownReason = recordProviderFailure(providerStats, c.provider, cat, providerTargets.get(c.provider) ?? 1);
                    if (providerCooldownReason) {
                        markProviderCooldown(c.provider, providerCooldownReason, Math.max(cooldownSec, 120), cat);
                        addFallbackEvent(c.provider, '', providerCooldownReason);
                        if (!debug) {
                            console.log(`  ${c.provider} is under pressure. Trying another provider...`);
                        }
                    }
                    addFallbackEvent(c.provider, c.model, `${c.label} — ${cat} (cooldown ${cooldownSec}s)`);
                    if (debug) {
                        console.log(`${LOG}[req:${reqId}] ❌ ${c.label} — ${cat} after ${elapsed}s`);
                        console.log(`  ${errMsg.slice(0, 200)}`);
                    }
                    else {
                        console.log(`  ${c.label} — ${cat}. Cooldown ${cooldownSec}s.`);
                    }
                    if (Date.now() - startTime >= MAX_TOTAL_TIME_MS) {
                        break;
                    }
                }
            }
            // ── All attempts exhausted ──
            const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const fbEvents = getFallbackEvents();
            // Vision-specific error
            if (taskKind === 'image_vision') {
                const visionHint = 'Could not analyze the image because all vision-capable models are unavailable, rate-limited, or quota-exhausted. Try again later, or configure a vision-capable provider (Gemini, OpenRouter Vision, OpenAI, or Anthropic).';
                throw new Error(`${visionHint} Tried ${attempts.length} vision model(s) after ${totalElapsed}s.`);
            }
            if (debug && fbEvents.length > 0) {
                console.log(`${LOG}[req:${reqId}] All ${attempts.length} attempts failed after ${totalElapsed}s. Tried:`);
                for (const e of fbEvents) {
                    console.log(`  ${e.reason}`);
                }
            }
            // Build friendly error based on which providers were tried
            const triedRouter = attempts.some(a => a.provider === 'openai_router');
            const triedOllama = attempts.some(a => a.provider === 'ollama');
            const routerStats = providerStats.get('openai_router');
            const routerPressure = !!routerStats && routerStats.failures.length > 0 && routerStats.failures.every(f => f === 'rate_limit' || f === 'timeout' || f === 'quota');
            if (triedRouter && routerPressure && !triedOllama) {
                const localHint = isLocalFallbackEnabled(config)
                    ? 'Local fallback is enabled, but Ollama was not usable. Start Ollama, pull a chat-capable model, or wait for cooldowns.'
                    : 'Local fallback is disabled. To enable it, set HYSA_ENABLE_LOCAL_FALLBACK=true.';
                throw new Error(`${ONLINE_FREE_UNAVAILABLE_MESSAGE} ${localHint}`);
            }
            if (triedRouter && routerPressure && triedOllama) {
                throw new Error(`OpenAI Router is rate-limited, so HYSA switched to Ollama. Ollama was reachable, but the local model attempt failed: ${lastError?.message || 'no local chat-capable model responded'}. Pull a chat-capable coding model with "ollama pull qwen2.5-coder:1.5b", run hysa config, or wait for router cooldowns.`);
            }
            throw new Error(`All ${attempts.length} planned model(s) failed after ${totalElapsed}s. ${lastError?.message || 'No usable fallback provider responded.'}`);
        },
        async sendMessageStream(messages, systemPrompt, onEvent, signal) {
            // For streaming, use a simpler approach: try first candidate with streaming
            const reqId = ++requestCounter;
            const startTime = Date.now();
            clearRequestSkips();
            clearFallbackEvents();
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            const lastText = typeof lastUser?.content === 'string' ? lastUser.content : '';
            const taskKind = classifyTask(messages);
            lastTaskKind = taskKind;
            if (debug)
                console.log(`${LOG}[req:${reqId}] Stream task: ${taskKind}`);
            if (taskKind === 'browser_task' || taskKind === 'skill_task') {
                const msg = taskKind === 'browser_task'
                    ? 'Use /browser commands to control the browser.'
                    : 'Use @skill or /skill to load a specialized skill.';
                onEvent({ type: 'token', text: msg });
                onEvent({ type: 'done', fullText: msg, toolCalls: [] });
                return { message: msg, toolCalls: [] };
            }
            const runtimeModels = await getRuntimeProviderModels(config, taskKind);
            const healthChecker = { isOnCooldown, isUnhealthy, isProviderOnCooldown };
            const candidates = buildAttemptPlan(getCandidatesForTask(taskKind, config, healthChecker, runtimeModels), taskKind, getMaxAttempts());
            if (candidates.length === 0) {
                const msg = 'No available models for this request. Check your provider configuration.';
                onEvent({ type: 'token', text: msg });
                onEvent({ type: 'done', fullText: msg, toolCalls: [] });
                return { message: msg, toolCalls: [] };
            }
            // Try first candidate with streaming
            const first = candidates[0];
            const timeoutMs = getAttemptTimeout(first.provider);
            if (debug) {
                console.log(`${LOG}[req:${reqId}] Stream: ${first.label}`);
            }
            validateProviderConsistency(first.provider, first.model, taskKind);
            const client = createSingleClient(first.provider, first.model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel, config);
            if (client.sendMessageStream) {
                const ac = new AbortController();
                const timer = setTimeout(() => ac.abort(), timeoutMs);
                if (signal) {
                    signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
                }
                let contentStarted = false;
                let partialTokens = '';
                // Request tracing and validation before streaming
                console.log('[provider] selected provider:', first.provider);
                console.log('[provider] actual upstream provider:', first.provider);
                console.log('[provider] routed model:', first.model);
                console.log('[provider] payload type: stream');
                console.log('[provider] capability type:', hasVisionCapability(first.provider, first.model) ? 'vision' : 'text-only');
                if (taskKind === 'image_vision' && !hasVisionCapability(first.provider, first.model)) {
                    console.log('[provider] MISMATCH: text-only model for vision stream');
                    throw new Error(`Provider/model mismatch: ${first.provider}/${first.model} is text-only but task is image_vision`);
                }
                try {
                    addFallbackEvent(first.provider, first.model, `Streaming ${first.label}...`);
                    const result = await client.sendMessageStream(messages, systemPrompt, (event) => {
                        if (event.type === 'token') {
                            contentStarted = true;
                            partialTokens += event.text;
                        }
                        onEvent(event);
                    }, ac.signal);
                    clearTimeout(timer);
                    const duration = Date.now() - startTime;
                    markHealth(first.provider, first.model, 'healthy', 'success', 'unknown', duration);
                    logProviderSuccess(first.provider, first.model).catch(() => { });
                    setLastSuccessfulProvider(first.provider, first.model);
                    recordRequestLatency(first.provider, first.model, duration);
                    return result;
                }
                catch (err) {
                    clearTimeout(timer);
                    const errMsg = err.message || '';
                    const cat = categorizeError(errMsg || String(err));
                    const retryAfter = getRetryAfterSeconds(err);
                    const cooldownSec = retryAfter ?? getCooldownSeconds(cat);
                    markHealth(first.provider, first.model, 'unhealthy', errMsg, cat);
                    logProviderFailure(first.provider, first.model, errMsg).catch(() => { });
                    recordErrorAnalytics(first.provider, first.model, cat);
                    const isTimeout = cat === 'timeout';
                    if (cat === 'rate_limit' || cat === 'timeout' || cat === 'quota') {
                        markModelCooldown(first.provider, first.model, errMsg, cooldownSec, cat);
                    }
                    addFallbackEvent(first.provider, first.model, `Stream ${first.label} - ${cat}`);
                    if (contentStarted) {
                        recordStreamInterruption(first.provider, first.model);
                        if (isTimeout && partialTokens.length > 20) {
                            // ── Partial recovery: preserve partial output, fallback with context ──
                            const partialResponse = {
                                message: partialTokens,
                                toolCalls: [],
                            };
                            const continuationMsg = `[Previous response was interrupted after generating partial content. Continuing with fallback provider.]
Previous partial response: ${partialTokens.slice(0, 500)}`;
                            const continuedMessages = [...messages, { role: 'assistant', content: continuationMsg }];
                            const fallbackResult = await this.sendMessage(continuedMessages, systemPrompt, signal);
                            if (fallbackResult.message) {
                                recordRecoverySuccess(first.provider, first.model);
                                if (debug)
                                    console.log(`${LOG}[req:${reqId}] Partial recovery succeeded via fallback`);
                                onEvent({ type: 'token', text: `\n\n[Partial recovery: ${first.provider} timed out, continuing with fallback]\n\n` });
                                onEvent({ type: 'token', text: fallbackResult.message });
                                onEvent({ type: 'done', fullText: partialTokens + '\n\n[continued below]\n\n' + fallbackResult.message, toolCalls: fallbackResult.toolCalls });
                                return {
                                    message: partialTokens + '\n\n[continued]\n\n' + fallbackResult.message,
                                    toolCalls: fallbackResult.toolCalls,
                                };
                            }
                        }
                        // Content too short or non-timeout — rethrow
                        throw err;
                    }
                    if (cat === 'rate_limit') {
                        markProviderCooldown(first.provider, `${first.provider} streaming failed with rate_limit; switching providers on the next request`, Math.max(cooldownSec, 120), cat);
                    }
                    console.log(`  Stream ${first.label} failed (${cat}). Trying another model/provider...`);
                }
            }
            // Fall back to non-streaming router
            const result = await this.sendMessage(messages, systemPrompt, signal);
            if (result.message) {
                onEvent({ type: 'token', text: result.message });
            }
            onEvent({ type: 'done', fullText: result.message, toolCalls: result.toolCalls });
            return result;
        },
    };
    return router;
}
async function getRuntimeProviderModels(config, taskKind) {
    const runtime = {};
    const allowOllama = config.currentProvider === 'ollama' || isLocalFallbackEnabled(config);
    if (!allowOllama)
        return runtime;
    if (!config.ollamaBaseUrl || isProviderOnCooldown('ollama'))
        return runtime;
    try {
        runtime.ollama = [];
        const models = await listOllamaModels(config.ollamaBaseUrl, taskKind === 'simple_chat' ? 1500 : 2500);
        runtime.ollama = models;
    }
    catch {
        // Ollama is optional unless selected. A failed model list simply removes it from this attempt plan.
    }
    return runtime;
}
function buildAttemptPlan(candidates, taskKind, maxAttempts) {
    const groups = new Map();
    for (const candidate of candidates) {
        const group = groups.get(candidate.provider);
        if (group)
            group.push(candidate);
        else
            groups.set(candidate.provider, [candidate]);
    }
    const planned = [];
    const totalLimit = Math.max(maxAttempts, taskKind === 'code_edit' || taskKind === 'debugging' || taskKind === 'code_review' ? 6 : 4);
    for (const [provider, group] of groups) {
        const limit = getProviderAttemptLimit(provider, taskKind);
        for (const candidate of group.slice(0, limit)) {
            if (planned.length >= totalLimit)
                return planned;
            planned.push(candidate);
        }
    }
    return planned;
}
function getProviderAttemptLimit(provider, taskKind) {
    if (taskKind === 'simple_chat')
        return provider === 'ollama' ? 2 : 2;
    if (provider === 'openai_router' && (taskKind === 'code_edit' || taskKind === 'debugging' || taskKind === 'code_review'))
        return 4;
    if (provider === 'openrouter')
        return 3;
    if (provider === 'ninerouter' && (taskKind === 'code_edit' || taskKind === 'debugging' || taskKind === 'code_review'))
        return 3;
    return 2;
}
function countProviderTargets(candidates) {
    const counts = new Map();
    for (const candidate of candidates) {
        counts.set(candidate.provider, (counts.get(candidate.provider) ?? 0) + 1);
    }
    return counts;
}
function recordProviderFailure(statsByProvider, provider, category, plannedProviderAttempts) {
    const stats = statsByProvider.get(provider) ?? { attempts: 0, failures: [] };
    stats.attempts += 1;
    stats.failures.push(category);
    statsByProvider.set(provider, stats);
    const pressureFailures = stats.failures.filter(cat => cat === 'rate_limit' || cat === 'timeout' || cat === 'quota');
    const allFailuresArePressure = pressureFailures.length === stats.failures.length;
    const threshold = Math.min(plannedProviderAttempts, PROVIDER_FAILURE_COOLDOWN_THRESHOLD);
    if (stats.attempts >= threshold && allFailuresArePressure) {
        const reason = pressureFailures.some(cat => cat === 'rate_limit') ? 'rate-limited' : 'timed out';
        return `${provider} ${reason} across ${stats.attempts} model attempt(s); provider cooldown active`;
    }
    return null;
}
function categorizeError(msg) {
    const lower = msg.toLowerCase();
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth') || lower.includes('invalid key') || lower.includes('403'))
        return 'invalid_key';
    if (isRateLimitError(msg))
        return 'rate_limit';
    if (lower.includes('quota') || lower.includes('402') || lower.includes('payment') || lower.includes('billing'))
        return 'quota';
    if (isTimeoutError(msg))
        return 'timeout';
    if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('fetch failed') || lower.includes('network') || lower.includes('enotfound'))
        return 'network';
    if (lower.includes('404') || lower.includes('model not found') || lower.includes('does not support') || lower.includes('not support') || lower.includes('unavailable') || lower.includes('empty') || lower.includes('503'))
        return 'model_unavailable';
    return 'unknown';
}
function getCooldownSeconds(cat) {
    switch (cat) {
        case 'timeout': return 30;
        case 'rate_limit': return 120;
        case 'model_unavailable': return 60;
        case 'network': return 20;
        case 'invalid_key': return 300;
        default: return 60;
    }
}
//# sourceMappingURL=smart-router.js.map