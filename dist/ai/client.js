import { PROVIDER_DEFAULTS, PROVIDER_MODELS, PROVIDER_TIERS, PREMIUM_API_PROVIDERS, PROVIDER_SIGNUP_URLS, EXPERIMENTAL_BASE_URLS, isLocalFallbackEnabled } from '../config/keys.js';
import { createSingleClient } from './client-factory.js';
import { createSmartRouter } from './smart-router.js';
import { checkOllama } from './ollama.js';
import { checkOpenAICompatibleAPI } from './openai-compatible.js';
import { markHealth, markModelCooldown, markProviderCooldown, isOnCooldown, isProviderOnCooldown, isUnhealthy, isSkippedForRequest, getHealthRecord, getFallbackEvents, setLastFallbackUsed, setLastSuccessfulProvider, clearRequestSkips, addFallbackEvent, clearFallbackEvents } from './model-health.js';
import { getRetryAfterSeconds } from './provider-policy.js';
import { recordRequest, recordError } from '../utils/session.js';
import { logProviderSuccess, logProviderFailure } from '../brain/graph-store.js';
import { hasVisionCapability } from './provider-capabilities.js';
const CHAT_TIMEOUT_MS = 30000;
const FALLBACK_ATTEMPT_TIMEOUT_MS = 12000;
const EXPERIMENTAL_TIMEOUT_MS = 4000;
const EXPERIMENTAL_RETRY_TIMEOUT_MS = 2000;
const LOCAL_TIMEOUT_MS = 15000;
const MAX_TOTAL_TIME_MS = 60000;
const MAX_FALLBACK_MODELS = 10;
const MAX_FALLBACK_PROVIDERS = 10;
let requestCounter = 0;
function getProviderTimeout(provider, isPrimary) {
    // Env var overrides
    const envChatTimeout = process.env.HYSA_CHAT_TIMEOUT_MS;
    const envFallbackTimeout = process.env.HYSA_FALLBACK_TIMEOUT_MS;
    if (isPrimary && envChatTimeout) {
        const parsed = parseInt(envChatTimeout, 10);
        if (!isNaN(parsed) && parsed > 0)
            return parsed;
    }
    if (!isPrimary && envFallbackTimeout) {
        const parsed = parseInt(envFallbackTimeout, 10);
        if (!isNaN(parsed) && parsed > 0)
            return parsed;
    }
    const tier = PROVIDER_TIERS[provider];
    if (tier === 'experimental_free')
        return EXPERIMENTAL_TIMEOUT_MS;
    if (tier === 'local_free')
        return LOCAL_TIMEOUT_MS;
    if (isPrimary)
        return CHAT_TIMEOUT_MS;
    return FALLBACK_ATTEMPT_TIMEOUT_MS;
}
// ── Error Categorization ──────────────────────────────
export function categorizeError(msg) {
    const lower = msg.toLowerCase();
    // Auth errors must be checked BEFORE timeout (a 401 may also say "timed out" in its message)
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication') || lower.includes('auth') || lower.includes('api key') || lower.includes('invalid key') || lower.includes('forbidden') || lower.includes('403'))
        return 'invalid_key';
    if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests'))
        return 'rate_limit';
    if (lower.includes('quota') || lower.includes('402') || lower.includes('payment') || lower.includes('billing') || lower.includes('insufficient'))
        return 'quota';
    if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort'))
        return 'timeout';
    if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('fetch failed') || lower.includes('network') || lower.includes('enotfound') || lower.includes('econnaborted'))
        return 'network';
    if (lower.includes('404') || lower.includes('model not found') || lower.includes('not found') || lower.includes('does not support') || lower.includes('not support') || lower.includes('unavailable') || lower.includes('no free') || lower.includes('not supported') || lower.includes('503') || lower.includes('service unavailable') || lower.includes('overloaded') || lower.includes('overload'))
        return 'model_unavailable';
    return 'unknown';
}
// ── Friendly Error Messages ───────────────────────────
function friendlyRateLimit(provider) {
    const label = PROVIDER_DEFAULTS[provider]?.label || provider;
    const msgs = {
        groq: `${label} is rate limited. This can happen because of requests-per-minute (RPM), tokens-per-minute (TPM), or daily free-tier quotas on Groq's side. It is not based on your current context token count. Wait a moment and retry, or the system will automatically fallback to another provider.`,
        gemini: `${label} free tier quota may have been reached. Gemini limits requests to ~60/min with daily quotas. This is a provider-side limit, not related to your context token count. Automatically falling back...`,
        openrouter: `${label} rate limit hit. Some OpenRouter free models have strict RPM/TPM limits on the provider side. This is separate from your local context tokens. Trying another model or provider...`,
        deepseek: `${label} is rate limited. DeepSeek free tier has request and token limits on their side. This is not about your context size. Automatically falling back...`,
        opencode_zen: `${label} free model is rate limited or temporarily unavailable. This is a provider-side limit, not context-token related. Trying another provider...`,
    };
    return msgs[provider] || `${label} is rate limited. Provider-side limits (RPM/TPM/daily quota) have been reached. This is not the same as context tokens. Automatically falling back...`;
}
function friendlyError(msg, provider) {
    const lower = msg.toLowerCase();
    const label = PROVIDER_DEFAULTS[provider]?.label || provider;
    const cat = categorizeError(msg);
    if (cat === 'rate_limit')
        return friendlyRateLimit(provider);
    if (cat === 'quota') {
        if (provider === 'openrouter')
            return `${label} requires credits or a paid plan for this model. Try a free model like qwen/qwen3-coder:free.`;
        return `${label} quota exceeded. This is a provider-side billing or daily limit, not related to your context tokens.`;
    }
    if (cat === 'timeout')
        return `${label} timed out. The provider may be slow or overloaded. Automatically falling back...`;
    if (cat === 'network') {
        if (provider === 'ollama' || provider === 'local_openai')
            return `${label} is not running. Make sure the local server is started.`;
        if (provider === 'openrouter')
            return `Cannot reach ${label}. Check your internet connection or OpenRouter may be down.`;
        return `Cannot reach ${label}. Check your internet connection.`;
    }
    if (cat === 'invalid_key') {
        if (provider === 'opencode_zen')
            return `${label} API key is invalid or missing. Get a key from https://opencode.ai/zen`;
        const url = PROVIDER_SIGNUP_URLS[provider];
        const keyHint = url ? `\n  Get a key: ${url}` : '';
        return `${label} API key is invalid or missing.${keyHint}`;
    }
    if (cat === 'model_unavailable') {
        if (provider === 'gemini')
            return `${label} free tier is temporarily overloaded (503). Provider-side issue, not your context. Trying another provider...`;
        if (provider === 'openrouter')
            return `${label} model is temporarily unavailable. Trying another model or provider...`;
        return `${label} is temporarily unavailable. Trying another provider...`;
    }
    return msg;
}
function isRetryableError(msg) {
    const cat = categorizeError(msg);
    return cat === 'rate_limit' || cat === 'timeout' || cat === 'network' || cat === 'model_unavailable' || cat === 'quota';
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
export function getFallbackCandidates(current, config) {
    const tier = PROVIDER_TIERS[current];
    const candidates = [];
    const added = new Set();
    function add(provider, model) {
        const m = model || PROVIDER_DEFAULTS[provider]?.model || '';
        if (!m)
            return;
        const k = `${provider}:${m}`;
        if (added.has(k))
            return;
        added.add(k);
        validateProviderConsistency(provider, m);
        candidates.push({ provider, model: m, label: `${PROVIDER_DEFAULTS[provider]?.label || provider} / ${m}` });
    }
    // A. Free API fallback chain
    if (tier === 'free_api') {
        add('openrouter', 'qwen/qwen3-coder:free');
        add('openrouter', 'deepseek/deepseek-chat:free');
        add('openrouter', 'openai/gpt-oss-120b:free');
        if (config.openaiRouterBaseUrl) {
            if (config.openaiRouterModel)
                add('openai_router', config.openaiRouterModel);
            for (const m of PROVIDER_MODELS.openai_router) {
                add('openai_router', m);
            }
        }
        if (current !== 'gemini')
            add('gemini');
        if (current !== 'deepseek')
            add('deepseek');
        if (current !== 'opencode_zen')
            add('opencode_zen');
        if (current !== 'groq')
            add('groq');
        // Experimental only if allowed
        if (config.allowExperimentalProviders) {
            add('pollinations');
        }
        // Anthropic proxy fallback if configured
        if (config.anthropicProxyBaseUrl) {
            add('anthropic_proxy');
        }
        if (isLocalFallbackEnabled(config)) {
            add('ollama');
            add('local_openai');
            add('hysa_ai');
        }
    }
    // B. Local free fallback
    if (tier === 'local_free') {
        add('hysa_ai');
        add('ollama');
        add('local_openai');
        // Fallback to free API if keys exist
        if (config.apiKeys.openrouter)
            add('openrouter', 'qwen/qwen3-coder:free');
        if (config.apiKeys.gemini)
            add('gemini');
        if (config.apiKeys.deepseek)
            add('deepseek');
        if (config.apiKeys.opencode_zen)
            add('opencode_zen');
        if (config.apiKeys.groq)
            add('groq');
    }
    // C. Premium fallback
    if (tier === 'premium_api') {
        for (const p of PREMIUM_API_PROVIDERS) {
            if (p !== current && config.apiKeys[p])
                add(p);
        }
        // Ask by trying free providers silently
        if (config.apiKeys.openrouter)
            add('openrouter', 'qwen/qwen3-coder:free');
        if (config.apiKeys.gemini)
            add('gemini');
    }
    // D. Experimental fallback
    if (tier === 'experimental_free') {
        if (config.allowExperimentalProviders) {
            // Try other experimental providers
            if (current !== 'pollinations')
                add('pollinations');
            if (current !== 'llm7')
                add('llm7');
            if (current !== 'puter')
                add('puter');
        }
        // Also try free API if keys exist
        if (config.apiKeys.openrouter)
            add('openrouter', 'qwen/qwen3-coder:free');
        if (config.apiKeys.gemini)
            add('gemini');
        if (config.apiKeys.deepseek)
            add('deepseek');
        if (config.apiKeys.opencode_zen)
            add('opencode_zen');
        if (config.apiKeys.groq)
            add('groq');
    }
    return candidates;
}
// ── Provider/Model skip logic ────────────────────────
function shouldSkipProvider(provider, model) {
    if (isProviderOnCooldown(provider))
        return true;
    if (isOnCooldown(provider, model))
        return true;
    if (isSkippedForRequest(provider, model))
        return true;
    const rec = getHealthRecord(provider, model);
    if (rec && rec.status === 'unhealthy') {
        // Only skip session-unhealthy providers for permanent failures (invalid key).
        // Transient failures (rate_limit, timeout, model_unavailable) are retried on each request.
        const permanent = rec.category === 'invalid_key' || rec.category === 'quota';
        if (permanent)
            return true;
    }
    return false;
}
// ── Extract debug info ──────────────────────────────
function extractDebugInfo(err, provider, model, config, elapsed, timeoutMs, attempt) {
    const lines = [];
    const cat = categorizeError(err?.message || '');
    lines.push(`  Provider: ${provider}`);
    lines.push(`  Model: ${model}`);
    lines.push(`  Category: ${cat}`);
    if (elapsed)
        lines.push(`  Elapsed: ${elapsed}s`);
    if (timeoutMs)
        lines.push(`  Timeout: ${timeoutMs / 1000}s`);
    if (attempt !== undefined)
        lines.push(`  Attempt: ${attempt}`);
    lines.push(`  API key set: ${config.apiKeys[provider] ? 'yes' : 'no'}`);
    const e = err;
    if (e.status)
        lines.push(`  HTTP Status: ${e.status}`);
    else if (e.response?.status)
        lines.push(`  HTTP Status: ${e.response.status}`);
    if (e.message) {
        const statusMatch = e.message.match(/(\d{3})/);
        if (statusMatch && !e.status && !e.response?.status)
            lines.push(`  HTTP Status: ${statusMatch[1]}`);
        lines.push(`  Error: ${e.message.slice(0, 500)}`);
    }
    return lines.join('\n');
}
// ── Client creation ──────────────────────────────────
function tryCreateClient(provider, model, config) {
    try {
        return createSingleClient(provider, model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel, config);
    }
    catch {
        return null;
    }
}
// ── Fallback Client ─────────────────────────────────
function createFallbackClient(primary, config) {
    const debug = !!config.debug;
    return {
        async sendMessage(messages, systemPrompt, signal) {
            return sendMessageFallback(messages, systemPrompt, signal);
        },
        async sendMessageStream(messages, systemPrompt, onEvent, signal) {
            const streamReqId = ++requestCounter;
            const startTime = Date.now();
            clearFallbackEvents();
            const primaryModel = config.currentModel;
            const primaryTimeout = getProviderTimeout(primary, true);
            if (config.debug)
                console.log(`[req:${streamReqId}] sendMessageStream starting: ${primary} / ${primaryModel}`);
            if (!shouldSkipProvider(primary, primaryModel)) {
                const client = tryCreateClient(primary, primaryModel, config);
                if (client?.sendMessageStream) {
                    const provLabel = PROVIDER_DEFAULTS[primary]?.label || primary;
                    addFallbackEvent(primary, primaryModel, `Streaming ${provLabel} / ${primaryModel}...`);
                    if (config.debug)
                        console.log(`[req:${streamReqId}] Streaming ${provLabel} / ${primaryModel}...`);
                    const ac = new AbortController();
                    const timer = setTimeout(() => ac.abort(), primaryTimeout);
                    if (signal) {
                        signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
                    }
                    let contentStarted = false;
                    let streamError = null;
                    try {
                        // Request tracing and hard validation before streaming
                        console.log('[provider] selected provider:', primary);
                        console.log('[provider] actual upstream provider:', primary);
                        console.log('[provider] routed model:', primaryModel);
                        console.log('[provider] payload type: stream');
                        console.log('[provider] capability type:', hasVisionCapability(primary, primaryModel) ? 'vision' : 'text-only');
                        const hasImagePayload = messages.some(m => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
                        if (hasImagePayload && !hasVisionCapability(primary, primaryModel)) {
                            console.log('[provider] MISMATCH: text-only provider', primary, 'receiving image payload');
                            throw new Error(`Provider/model mismatch detected: selectedModel=${primaryModel} but actual provider=${primary} is text-only. Cannot send vision content to a text-only model.`);
                        }
                        const result = await client.sendMessageStream(messages, systemPrompt, (event) => {
                            if (event.type === 'token')
                                contentStarted = true;
                            onEvent(event);
                        }, ac.signal);
                        clearTimeout(timer);
                        const duration = Date.now() - startTime;
                        markHealth(primary, primaryModel, 'healthy', 'success', 'unknown', duration);
                        logProviderSuccess(primary, primaryModel).catch(() => { });
                        recordRequest(duration);
                        return result;
                    }
                    catch (err) {
                        clearTimeout(timer);
                        streamError = err;
                        const errMsg = streamError.message || '';
                        const cat = categorizeError(errMsg);
                        markHealth(primary, primaryModel, 'unhealthy', friendlyError(errMsg, primary), cat);
                        logProviderFailure(primary, primaryModel, errMsg).catch(() => { });
                        recordError(errMsg, primary, primaryModel);
                        if (contentStarted) {
                            // Some content was already emitted — cannot cleanly fallback
                            throw streamError;
                        }
                        // No content yet — fall through to non-streaming fallback
                    }
                }
            }
            // Fall back to non-streaming with retry/fallback
            const result = await sendMessageFallback(messages, systemPrompt, signal);
            // Emit the complete non-streaming result as events
            if (result.message) {
                onEvent({ type: 'token', text: result.message });
            }
            onEvent({ type: 'done', fullText: result.message, toolCalls: result.toolCalls });
            return result;
        },
    };
    // Shared fallback logic used by both sendMessage and sendMessageStream fallback path
    async function sendMessageFallback(messages, systemPrompt, signal) {
        const reqId = ++requestCounter;
        const startTime = Date.now();
        let lastError = null;
        let lastProvider = primary;
        let totalAttempts = 0;
        const skippedReasons = [];
        const attemptLog = [];
        let openRouterGlobal429 = false;
        if (debug) {
            const candidates = getFallbackCandidates(primary, config);
            console.log(`[req:${reqId}] Starting fallback chain`);
            console.log(`[req:${reqId}] Primary: ${primary} / ${config.currentModel}`);
            console.log(`[req:${reqId}] Fallback candidates:`);
            for (const c of candidates) {
                console.log(`[req:${reqId}]   ${c.provider} / ${c.model}`);
            }
        }
        const tryProvider = async (provider, model, timeoutMs, attemptLabel) => {
            if (provider === 'openrouter' && openRouterGlobal429) {
                if (debug)
                    console.log(`[req:${reqId}] [skip] ${attemptLabel}: OpenRouter global 429 detected, skipping all OR models`);
                skippedReasons.push(`  [skip] ${attemptLabel}: OpenRouter global 429, skipping all OR models`);
                return null;
            }
            if (shouldSkipProvider(provider, model)) {
                const reason = isSkippedForRequest(provider, model) ? 'already failed this request' : isUnhealthy(provider, model) ? 'marked unhealthy' : 'unknown';
                const skipMsg = `[skip] ${attemptLabel}: ${PROVIDER_DEFAULTS[provider]?.label || provider} / ${model} (${reason})`;
                skippedReasons.push(`  ${skipMsg}`);
                if (debug)
                    console.log(`[req:${reqId}] ${skipMsg}`);
                return null;
            }
            const client = tryCreateClient(provider, model, config);
            if (!client) {
                const skipMsg = `[skip] ${attemptLabel}: ${provider} / ${model} (could not create client)`;
                skippedReasons.push(`  ${skipMsg}`);
                if (debug)
                    console.log(`[req:${reqId}] ${skipMsg}`);
                return null;
            }
            const provLabel = PROVIDER_DEFAULTS[provider]?.label || provider;
            addFallbackEvent(provider, model, `Trying ${provLabel} / ${model}...`);
            if (debug) {
                console.log(`[req:${reqId}] Trying ${provLabel} / ${model} (timeout: ${timeoutMs / 1000}s)`);
            }
            else {
                console.log(`  Trying ${provLabel} / ${model}...`);
            }
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), timeoutMs);
            if (signal) {
                signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
            }
            const tryOnce = async () => {
                totalAttempts++;
                if (debug) {
                    console.log(`[req:${reqId}] ${attemptLabel}: ${provLabel} / ${model} (timeout: ${timeoutMs / 1000}s)`);
                }
                // Request tracing
                console.log('[provider] selected provider:', provider);
                console.log('[provider] actual upstream provider:', provider);
                console.log('[provider] routed model:', model);
                console.log('[provider] capability type:', hasVisionCapability(provider, model) ? 'vision' : 'text-only');
                // Hard validation: ensure text-only provider never gets image payloads
                const hasImagePayload = messages.some(m => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
                if (hasImagePayload && !hasVisionCapability(provider, model)) {
                    console.log('[provider] MISMATCH: text-only provider', provider, 'receiving image payload');
                    throw new Error(`Provider/model mismatch detected: selectedModel=${model} but actual provider=${provider} is text-only. Cannot send vision content to a text-only model.`);
                }
                return await client.sendMessage(messages, systemPrompt, ac.signal);
            };
            let retries = 0;
            const isPrimaryAttempt = attemptLabel === 'Primary';
            const maxRetries = isPrimaryAttempt ? 2 : 0;
            let attemptStart = Date.now();
            while (retries <= maxRetries) {
                try {
                    lastProvider = provider;
                    attemptStart = Date.now();
                    const result = await tryOnce();
                    if (!result.message?.trim() && (!result.toolCalls || result.toolCalls.length === 0)) {
                        const isExperimental = !!EXPERIMENTAL_BASE_URLS[provider];
                        if (isExperimental && retries === 0) {
                            addFallbackEvent(provider, model, `${provLabel} empty, retrying...`);
                            if (debug)
                                console.log(`[req:${reqId}] ${provLabel} empty response, retrying once`);
                            clearTimeout(timer);
                            const rt = setTimeout(() => ac.abort(), EXPERIMENTAL_RETRY_TIMEOUT_MS);
                            retries++; // count this as a retry
                            continue;
                        }
                        const hint = isExperimental ? ' Experimental providers are not guaranteed stable.' : '';
                        addFallbackEvent(provider, model, `${provLabel} returned empty response`);
                        throw new Error(`${provLabel} returned an empty response.${hint}`);
                    }
                    const duration = Date.now() - attemptStart;
                    markHealth(provider, model, 'healthy', 'success', 'unknown', duration);
                    logProviderSuccess(provider, model).catch(() => { });
                    recordRequest(duration);
                    setLastSuccessfulProvider(provider, model);
                    return result;
                }
                catch (err) {
                    retries++;
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    lastError = err;
                    const errMsg = lastError.message || '';
                    const cat = categorizeError(errMsg);
                    const attemptDuration = Date.now() - attemptStart;
                    if (cat === 'timeout') {
                        addFallbackEvent(provider, model, `${provLabel} timed out (${timeoutMs / 1000}s)`);
                        if (debug) {
                            console.log(`[req:${reqId}] ${provLabel} timed out (${timeoutMs / 1000}s)`);
                        }
                        else {
                            const dur = ((Date.now() - attemptStart) / 1000).toFixed(1);
                            console.log(`  ${provLabel} / ${model} timed out after ${dur}s. Trying next...`);
                        }
                    }
                    else if (cat === 'rate_limit') {
                        // If OpenRouter returns 429 on the primary, assume global rate limit — skip remaining OR models
                        if (provider === 'openrouter' && attemptLabel === 'Primary') {
                            openRouterGlobal429 = true;
                            if (debug)
                                console.log(`[req:${reqId}] OpenRouter global 429 detected — will skip remaining OR models`);
                        }
                        addFallbackEvent(provider, model, `${provLabel} rate-limited`);
                        if (debug) {
                            console.log(`[req:${reqId}] ${provLabel} rate-limited`);
                        }
                        else {
                            console.log('  Rate limited. Trying next...');
                        }
                    }
                    else if (cat === 'model_unavailable') {
                        addFallbackEvent(provider, model, `${provLabel} unavailable`);
                        if (debug) {
                            console.log(`[req:${reqId}] ${provLabel} unavailable`);
                        }
                        else {
                            console.log('  Unavailable. Trying next...');
                        }
                    }
                    else if (cat === 'invalid_key') {
                        addFallbackEvent(provider, model, `${provLabel} invalid key`);
                        if (debug) {
                            console.log(`[req:${reqId}] ${provLabel} invalid key`);
                        }
                        else {
                            console.log('  Invalid key. Trying next...');
                        }
                    }
                    markHealth(provider, model, 'unhealthy', friendlyError(errMsg, provider), cat, attemptDuration);
                    logProviderFailure(provider, model, errMsg).catch(() => { });
                    if (cat === 'rate_limit' || cat === 'timeout' || cat === 'quota') {
                        const cooldownSec = getRetryAfterSeconds(err) ?? (cat === 'rate_limit' ? 120 : 60);
                        markModelCooldown(provider, model, friendlyError(errMsg, provider), cooldownSec, cat);
                        if ((provider === 'openai_router' || provider === 'openrouter' || provider === 'ninerouter') && cat === 'rate_limit') {
                            markProviderCooldown(provider, `${PROVIDER_DEFAULTS[provider]?.label || provider} rate-limited; provider cooldown active`, cooldownSec, cat);
                        }
                    }
                    recordError(errMsg, provider, model);
                    if (debug) {
                        console.log(`[req:${reqId}] ${attemptLabel} failed (retry ${retries}/${maxRetries}) after ${((Date.now() - attemptStart) / 1000).toFixed(1)}s:`);
                        console.log(extractDebugInfo(err, provider, model, config, elapsed, timeoutMs, totalAttempts));
                    }
                    if (retries <= maxRetries && isRetryableError(errMsg) && cat !== 'rate_limit') {
                        const delay = Math.min(1000 * Math.pow(2, retries - 1), 4000);
                        if (debug)
                            console.log(`[req:${reqId}] Retrying ${attemptLabel} in ${delay}ms...`);
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }
                    return null;
                }
                finally {
                    clearTimeout(timer);
                }
            }
            return null;
        };
        // Try primary provider with current model
        const primaryModel = config.currentModel;
        const primaryTimeout = getProviderTimeout(primary, true);
        if (debug)
            console.log(`[req:${reqId}] Trying primary: ${primary} / ${primaryModel} (timeout: ${primaryTimeout / 1000}s)`);
        let result = await tryProvider(primary, primaryModel, primaryTimeout, 'Primary');
        if (result)
            return result;
        // Check total time
        if (Date.now() - startTime >= MAX_TOTAL_TIME_MS) {
            throwAllFailedError(lastError, primary, primaryModel, startTime, skippedReasons, totalAttempts, reqId, config);
        }
        // Model-level fallback for OpenAI Router — try models in order before giving up
        if (primary === 'openai_router') {
            const triedModels = new Set([primaryModel]);
            const orderedModels = PROVIDER_MODELS.openai_router.filter(m => m !== primaryModel).slice(0, MAX_FALLBACK_MODELS);
            if (debug) {
                console.log(`[req:${reqId}] Router model-level fallback with ${orderedModels.length} candidates`);
            }
            for (const altModel of orderedModels) {
                if (triedModels.has(altModel))
                    continue;
                triedModels.add(altModel);
                if (Date.now() - startTime >= MAX_TOTAL_TIME_MS)
                    break;
                if (shouldSkipProvider(primary, altModel)) {
                    if (debug)
                        console.log(`[req:${reqId}] Skipping unhealthy router model: ${altModel}`);
                    continue;
                }
                if (debug)
                    console.log(`[req:${reqId}] Router model fallback to ${altModel}`);
                result = await tryProvider(primary, altModel, getProviderTimeout(primary, false), 'Router model fallback');
                if (result) {
                    console.log(`  OK Switched to ${altModel} on ${PROVIDER_DEFAULTS[primary]?.label || primary}.`);
                    setLastFallbackUsed(`${PROVIDER_DEFAULTS[primary]?.label || primary} / ${altModel}`);
                    addFallbackEvent(primary, altModel, `Switched to ${PROVIDER_DEFAULTS[primary]?.label || primary} / ${altModel}`);
                    return result;
                }
            }
        }
        // Model-level fallback for OpenRouter — try many text models before giving up
        if (primary === 'openrouter') {
            if (debug && openRouterGlobal429) {
                console.log(`[req:${reqId}] OpenRouter globally rate-limited, skipping all model-level fallback`);
            }
            const triedModels = new Set([primaryModel]);
            const orderedModels = PROVIDER_MODELS.openrouter.filter(m => m !== primaryModel).slice(0, MAX_FALLBACK_MODELS);
            if (debug && !openRouterGlobal429) {
                console.log(`[req:${reqId}] Model-level fallback with ${orderedModels.length} OR candidates`);
            }
            for (const altModel of orderedModels) {
                if (openRouterGlobal429) {
                    if (debug)
                        console.log(`[req:${reqId}] OpenRouter global 429 — skipping model fallback ${altModel}`);
                    break;
                }
                if (triedModels.has(altModel))
                    continue;
                triedModels.add(altModel);
                if (Date.now() - startTime >= MAX_TOTAL_TIME_MS)
                    break;
                if (shouldSkipProvider(primary, altModel)) {
                    if (debug)
                        console.log(`[req:${reqId}] Skipping unhealthy model: ${altModel}`);
                    continue;
                }
                if (debug)
                    console.log(`[req:${reqId}] Model fallback to ${altModel}`);
                result = await tryProvider(primary, altModel, getProviderTimeout(primary, false), 'Model fallback');
                if (result) {
                    console.log(`  OK Switched to ${altModel} on ${PROVIDER_DEFAULTS[primary]?.label || primary}.`);
                    setLastFallbackUsed(`${PROVIDER_DEFAULTS[primary]?.label || primary} / ${altModel}`);
                    addFallbackEvent(primary, altModel, `Switched to ${PROVIDER_DEFAULTS[primary]?.label || primary} / ${altModel}`);
                    return result;
                }
            }
        }
        // Check total time
        if (Date.now() - startTime >= MAX_TOTAL_TIME_MS) {
            throwAllFailedError(lastError, primary, primaryModel, startTime, skippedReasons, totalAttempts, reqId, config);
        }
        // Provider-level fallback — grouped by provider, counting provider groups not model variants
        const flatCandidates = getFallbackCandidates(primary, config);
        if (debug) {
            console.log(`[req:${reqId}] Provider-level fallback candidates:`);
            for (const c of flatCandidates) {
                console.log(`[req:${reqId}]   ${c.provider} / ${c.model}`);
            }
        }
        const providerGroups = new Map();
        for (const c of flatCandidates) {
            const existing = providerGroups.get(c.provider);
            if (existing) {
                if (!existing.models.includes(c.model))
                    existing.models.push(c.model);
            }
            else {
                providerGroups.set(c.provider, { provider: c.provider, models: [c.model] });
            }
        }
        const groups = Array.from(providerGroups.values());
        let providerFallbackCount = 0;
        const debugCandidateInfo = [];
        for (const group of groups) {
            if (providerFallbackCount >= MAX_FALLBACK_PROVIDERS)
                break;
            if (Date.now() - startTime >= MAX_TOTAL_TIME_MS)
                break;
            const provLabel = PROVIDER_DEFAULTS[group.provider]?.label || group.provider;
            // Skip entire provider group if global 429 OR all models are unhealthy
            const isGlobalIssue = group.provider === 'openrouter' && openRouterGlobal429;
            const allSkipped = isGlobalIssue || group.models.every(m => shouldSkipProvider(group.provider, m));
            if (allSkipped) {
                const info = `[skip] ${provLabel} (all models unhealthy or already failed)`;
                debugCandidateInfo.push(info);
                if (debug)
                    console.log(`[req:${reqId}] ${info}`);
                providerFallbackCount++;
                continue;
            }
            addFallbackEvent(group.provider, '', `Trying ${provLabel}...`);
            if (debug) {
                console.log(`[req:${reqId}] Trying ${provLabel}...`);
            }
            else {
                console.log(`  Trying ${provLabel}...`);
            }
            let groupSucceeded = false;
            for (const model of group.models) {
                if (shouldSkipProvider(group.provider, model)) {
                    if (debug)
                        console.log(`[req:${reqId}]  skipping model: ${model} (unhealthy)`);
                    continue;
                }
                if (Date.now() - startTime >= MAX_TOTAL_TIME_MS)
                    break;
                const fbTimeout = getProviderTimeout(group.provider, false);
                if (debug)
                    console.log(`[req:${reqId}]  trying: ${group.provider}/${model} (timeout: ${fbTimeout / 1000}s)`);
                const modelResult = await tryProvider(group.provider, model, fbTimeout, `Fallback ${providerFallbackCount + 1}`);
                if (modelResult) {
                    const label = PROVIDER_DEFAULTS[group.provider]?.label || group.provider;
                    console.log(`  OK Switched to ${label} / ${model}.`);
                    setLastFallbackUsed(`${label} / ${model}`);
                    addFallbackEvent(group.provider, model, `Switched to ${label} / ${model}`);
                    if (debug) {
                        const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                        console.log(`[req:${reqId}] Fallback succeeded after ${totalElapsed}s, ${totalAttempts} attempts.`);
                    }
                    result = modelResult;
                    groupSucceeded = true;
                    break;
                }
                if (Date.now() - startTime >= MAX_TOTAL_TIME_MS)
                    break;
            }
            if (groupSucceeded) {
                return result;
            }
            addFallbackEvent(group.provider, '', `${provLabel} all models failed.`);
            providerFallbackCount++;
        }
        // All fallbacks exhausted
        if (debug && lastError) {
            const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[req:${reqId}] All providers failed after ${totalElapsed}s, ${totalAttempts} attempts.`);
            console.log(extractDebugInfo(lastError, lastProvider, lastProvider === primary ? primaryModel : '', config, totalElapsed, getProviderTimeout(lastProvider, lastProvider === primary), totalAttempts));
            console.log(`[req:${reqId}] Tried:`);
            const fbEvents = getFallbackEvents();
            for (const e of fbEvents) {
                console.log(`[req:${reqId}]   ${e.reason}`);
            }
        }
        const lastProvLabel = PROVIDER_DEFAULTS[lastProvider]?.label || lastProvider;
        const errMsg = lastError
            ? friendlyError(lastError.message, lastProvider)
            : `${lastProvLabel} is unavailable. No fallback providers configured.`;
        const prefix = isLocalFallbackEnabled(config)
            ? 'All configured free providers are currently unavailable or rate-limited. Try again shortly or configure another provider.'
            : 'All configured online free providers are currently unavailable or rate-limited. Try again shortly or configure another provider.';
        throw new Error(`${prefix}\n${errMsg}`);
    }
}
function throwAllFailedError(lastError, primary, primaryModel, startTime, skipped, totalAttempts, reqId, config) {
    const el = ((Date.now() - startTime) / 1000).toFixed(0);
    const label = PROVIDER_DEFAULTS[primary]?.label || primary;
    const prefix = isLocalFallbackEnabled(config)
        ? 'All configured free providers are currently unavailable or rate-limited. Try again shortly or configure another provider.'
        : 'All configured online free providers are currently unavailable or rate-limited. Try again shortly or configure another provider.';
    throw new Error(`${prefix}\n${label} exhausted after ${el}s (${totalAttempts} attempts).`);
}
// ── Local provider pre-flight check ────────────────
async function checkLocalProviderReachable(provider, config) {
    if (provider === 'ollama') {
        const result = await checkOllama(config.ollamaBaseUrl);
        if (!result.ok)
            throw new Error(result.message);
    }
    else if (provider === 'local_openai') {
        const baseUrl = config.localOpenAiBaseUrl || 'http://localhost:1234/v1';
        const result = await checkOpenAICompatibleAPI(baseUrl);
        if (!result.ok) {
            throw new Error('LM Studio / local API is not running. Start LM Studio and enable the local server.\nDefault: http://localhost:1234/v1');
        }
    }
    else if (provider === 'hysa_ai') {
        const result = await checkOpenAICompatibleAPI('http://localhost:3002/v1', 'hysa_dev_key');
        if (!result.ok) {
            throw new Error('HYSA AI is not running. Start it with: hysa-ai serve');
        }
    }
}
// ── Public API ──────────────────────────────────────
export function createClient(config, signal) {
    const { currentProvider: provider } = config;
    const routerMode = (process.env.HYSA_MODEL_ROUTER_MODE || 'smart').toLowerCase();
    // Smart router: classify task and pick best model
    if (routerMode === 'smart') {
        return createSmartRouter(config, signal);
    }
    const tier = PROVIDER_TIERS[provider];
    const isLocal = tier === 'local_free';
    const lightMode = config.lightMode !== false && isLocal;
    clearRequestSkips();
    clearFallbackEvents();
    if (tier === 'free_api' || tier === 'premium_api') {
        return createFallbackClient(provider, config);
    }
    const client = createSingleClient(provider, config.currentModel, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel, config);
    const wrapped = {
        async sendMessage(messages, systemPrompt) {
            // Pre-flight: check local server is reachable before sending
            if (isLocal) {
                await checkLocalProviderReachable(provider, config);
            }
            return client.sendMessage(messages, systemPrompt, signal);
        },
    };
    // Pass through streaming if the underlying client supports it
    if (client.sendMessageStream) {
        wrapped.sendMessageStream = async (messages, systemPrompt, onEvent, streamSignal) => {
            if (isLocal) {
                await checkLocalProviderReachable(provider, config);
            }
            return client.sendMessageStream(messages, systemPrompt, onEvent, streamSignal || signal);
        };
    }
    const finalClient = tier === 'experimental_free' ? wrapClient(wrapped, config.currentProvider) : wrapped;
    // For local providers in light mode, skip fallback entirely
    if (isLocal && lightMode) {
        return wrapped;
    }
    // For local providers, still wrap in fallback for resilience
    return createFallbackClient(provider, config);
}
function wrapClient(client, provider) {
    const wrapped = {
        async sendMessage(messages, systemPrompt, signal) {
            try {
                return await client.sendMessage(messages, systemPrompt, signal);
            }
            catch (err) {
                const raw = err.message || String(err);
                throw new Error(friendlyError(raw, provider));
            }
        },
    };
    if (client.sendMessageStream) {
        wrapped.sendMessageStream = async (messages, systemPrompt, onEvent, signal) => {
            try {
                return await client.sendMessageStream(messages, systemPrompt, onEvent, signal);
            }
            catch (err) {
                const raw = err.message || String(err);
                throw new Error(friendlyError(raw, provider));
            }
        };
    }
    return wrapped;
}
export { createSingleClient } from './client-factory.js';
//# sourceMappingURL=client.js.map