import { PROVIDER_DEFAULTS, PROVIDER_MODELS, PROVIDER_TIERS, PREMIUM_API_PROVIDERS, PROVIDER_SIGNUP_URLS, EXPERIMENTAL_BASE_URLS } from '../config/keys.js';
import { createAnthropicClient } from './anthropic.js';
import { createOpenAIClient } from './openai.js';
import { createGeminiClient } from './gemini.js';
import { createOllamaClient, checkOllama } from './ollama.js';
import { createOpenRouterClient } from './openrouter.js';
import { createGroqClient } from './groq.js';
import { createDeepSeekClient } from './deepseek.js';
import { createOpenAICompatibleClient, checkOpenAICompatibleAPI } from './openai-compatible.js';
import { createOpenCodeZenClient } from './opencode-zen.js';
import { createHysaAIClient } from './hysa-ai.js';
import { markHealth, isUnhealthy, isSkippedForRequest, setLastFallbackUsed, clearRequestSkips, addFallbackEvent, clearFallbackEvents } from './model-health.js';
import { recordRequest, recordError } from '../utils/session.js';
const CHAT_TIMEOUT_MS = 30000;
const FALLBACK_ATTEMPT_TIMEOUT_MS = 12000;
const EXPERIMENTAL_TIMEOUT_MS = 8000;
const LOCAL_TIMEOUT_MS = 15000;
const MAX_TOTAL_TIME_MS = 60000;
const MAX_FALLBACK_PROVIDERS = 4;
function getProviderTimeout(provider, isPrimary) {
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
    if (lower.includes('404') || lower.includes('model not found') || lower.includes('not found') || lower.includes('unavailable') || lower.includes('no free') || lower.includes('not supported') || lower.includes('503') || lower.includes('service unavailable') || lower.includes('overloaded') || lower.includes('overload'))
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
function getFallbackCandidates(current, config) {
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
        candidates.push({ provider, model: m, label: `${PROVIDER_DEFAULTS[provider]?.label || provider} / ${m}` });
    }
    // A. Free API fallback chain
    if (tier === 'free_api') {
        add('openrouter', 'qwen/qwen3-coder:free');
        add('openrouter', 'deepseek/deepseek-chat:free');
        add('openrouter', 'openai/gpt-oss-120b:free');
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
    if (isSkippedForRequest(provider, model))
        return true;
    const rec = isUnhealthy(provider, model);
    if (rec)
        return true;
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
function tryCreateClient(provider, model, apiKeys, ollamaBaseUrl, localOpenAiBaseUrl, localOpenAiModel) {
    try {
        return createSingleClient(provider, model, apiKeys, ollamaBaseUrl, localOpenAiBaseUrl, localOpenAiModel);
    }
    catch {
        return null;
    }
}
export function createSingleClient(provider, model, apiKeys, ollamaBaseUrl, localOpenAiBaseUrl, localOpenAiModel) {
    switch (provider) {
        case 'anthropic': {
            const key = apiKeys.anthropic;
            if (!key)
                throw new Error('Anthropic API key not configured. Run: hysa config');
            return createAnthropicClient(key, model);
        }
        case 'openai': {
            const key = apiKeys.openai;
            if (!key)
                throw new Error('OpenAI API key not configured. Run: hysa config');
            return createOpenAIClient(key, model);
        }
        case 'gemini': {
            const key = apiKeys.gemini;
            if (!key)
                throw new Error('Gemini API key not configured. Run: hysa config');
            return createGeminiClient(key, model);
        }
        case 'ollama':
            return createOllamaClient(ollamaBaseUrl, model);
        case 'local_openai':
            return createOpenAICompatibleClient(localOpenAiBaseUrl || 'http://localhost:1234/v1', undefined, localOpenAiModel || model);
        case 'openrouter':
            return createOpenRouterClient(apiKeys.openrouter, model);
        case 'groq':
            return createGroqClient(apiKeys.groq, model);
        case 'deepseek':
            return createDeepSeekClient(apiKeys.deepseek, model);
        case 'opencode_zen': {
            if (!apiKeys.opencode_zen)
                throw new Error('OpenCode Zen requires an API key. Get one from https://opencode.ai/zen');
            return createOpenCodeZenClient(apiKeys.opencode_zen, model);
        }
        case 'pollinations': {
            const baseUrl = EXPERIMENTAL_BASE_URLS.pollinations || 'https://text.pollinations.ai/v1';
            return createOpenAICompatibleClient(baseUrl, apiKeys.pollinations, model);
        }
        case 'llm7': {
            const baseUrl = EXPERIMENTAL_BASE_URLS.llm7 || 'https://api.llm7.io/v1';
            return createOpenAICompatibleClient(baseUrl, apiKeys.llm7, model);
        }
        case 'puter': {
            const baseUrl = EXPERIMENTAL_BASE_URLS.puter || 'https://api.puter.com/v1';
            return createOpenAICompatibleClient(baseUrl, apiKeys.puter, model);
        }
        case 'hysa_ai': {
            return createHysaAIClient(apiKeys.hysa_ai, model, 'http://localhost:3002/v1');
        }
        default:
            throw new Error(`Unsupported provider: ${provider}`);
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
            const startTime = Date.now();
            clearFallbackEvents();
            const primaryModel = config.currentModel;
            const primaryTimeout = getProviderTimeout(primary, true);
            if (!shouldSkipProvider(primary, primaryModel)) {
                const client = tryCreateClient(primary, primaryModel, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel);
                if (client?.sendMessageStream) {
                    const provLabel = PROVIDER_DEFAULTS[primary]?.label || primary;
                    addFallbackEvent(primary, primaryModel, `Streaming ${provLabel} / ${primaryModel}...`);
                    const ac = new AbortController();
                    const timer = setTimeout(() => ac.abort(), primaryTimeout);
                    if (signal) {
                        signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
                    }
                    let contentStarted = false;
                    let streamError = null;
                    try {
                        const result = await client.sendMessageStream(messages, systemPrompt, (event) => {
                            if (event.type === 'token')
                                contentStarted = true;
                            onEvent(event);
                        }, ac.signal);
                        clearTimeout(timer);
                        const duration = Date.now() - startTime;
                        markHealth(primary, primaryModel, 'healthy', 'success', 'unknown', duration);
                        recordRequest(duration);
                        return result;
                    }
                    catch (err) {
                        clearTimeout(timer);
                        streamError = err;
                        const errMsg = streamError.message || '';
                        const cat = categorizeError(errMsg);
                        markHealth(primary, primaryModel, 'unhealthy', friendlyError(errMsg, primary), cat);
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
        const startTime = Date.now();
        clearFallbackEvents();
        let lastError = null;
        let lastProvider = primary;
        let totalAttempts = 0;
        const skippedReasons = [];
        const attemptLog = [];
        const tryProvider = async (provider, model, timeoutMs, attemptLabel) => {
            if (shouldSkipProvider(provider, model)) {
                const reason = isSkippedForRequest(provider, model) ? 'already failed this request' : isUnhealthy(provider, model) ? 'marked unhealthy' : 'unknown';
                skippedReasons.push(`  [skip] ${attemptLabel}: ${PROVIDER_DEFAULTS[provider]?.label || provider} / ${model} (${reason})`);
                if (debug)
                    console.log(`  [debug] ${skippedReasons[skippedReasons.length - 1]}`);
                return null;
            }
            const client = tryCreateClient(provider, model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel);
            if (!client) {
                skippedReasons.push(`  [skip] ${attemptLabel}: ${provider} / ${model} (could not create client)`);
                return null;
            }
            const provLabel = PROVIDER_DEFAULTS[provider]?.label || provider;
            addFallbackEvent(provider, model, `Trying ${provLabel} / ${model}...`);
            if (!debug)
                console.log(`  ~ ${provLabel} / ${model}...`);
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), timeoutMs);
            if (signal) {
                signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
            }
            const tryOnce = async () => {
                totalAttempts++;
                if (debug) {
                    console.log(`  [debug] ${attemptLabel}: ${provLabel} / ${model} (timeout: ${timeoutMs / 1000}s)`);
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
                        const hint = isExperimental ? ' Experimental providers are not guaranteed stable.' : '';
                        addFallbackEvent(provider, model, `${provLabel} returned empty response`);
                        throw new Error(`${provLabel} returned an empty response.${hint}`);
                    }
                    const duration = Date.now() - attemptStart;
                    markHealth(provider, model, 'healthy', 'success', 'unknown', duration);
                    recordRequest(duration);
                    return result;
                }
                catch (err) {
                    retries++;
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    lastError = err;
                    const errMsg = lastError.message || '';
                    const cat = categorizeError(errMsg);
                    const attemptDuration = Date.now() - attemptStart;
                    if (cat === 'timeout')
                        addFallbackEvent(provider, model, `${provLabel} timed out (${timeoutMs / 1000}s)`);
                    else if (cat === 'rate_limit')
                        addFallbackEvent(provider, model, `${provLabel} rate-limited`);
                    markHealth(provider, model, 'unhealthy', friendlyError(errMsg, provider), cat, attemptDuration);
                    recordError(errMsg, provider, model);
                    if (debug) {
                        console.log(`  [debug] ${attemptLabel} failed (retry ${retries}/${maxRetries}) after ${((Date.now() - attemptStart) / 1000).toFixed(1)}s:`);
                        console.log(extractDebugInfo(err, provider, model, config, elapsed, timeoutMs, totalAttempts));
                    }
                    if (retries <= maxRetries && isRetryableError(errMsg)) {
                        const delay = Math.min(1000 * Math.pow(2, retries - 1), 4000);
                        if (debug)
                            console.log(`  [debug] Retrying ${attemptLabel} in ${delay}ms...`);
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
            console.log(`  [debug] Trying primary: ${primary} / ${primaryModel} (timeout: ${primaryTimeout / 1000}s)`);
        let result = await tryProvider(primary, primaryModel, primaryTimeout, 'Primary');
        if (result)
            return result;
        // Check total time
        if (Date.now() - startTime >= MAX_TOTAL_TIME_MS) {
            throwAllFailedError(lastError, primary, primaryModel, startTime, skippedReasons, totalAttempts);
        }
        // Model-level fallback for OpenRouter — limit to avoid slow fallback chains
        const MAX_FALLBACK_MODELS = 3;
        if (primary === 'openrouter') {
            const triedModels = new Set([primaryModel]);
            const orderedModels = PROVIDER_MODELS.openrouter.filter(m => m !== primaryModel).slice(0, MAX_FALLBACK_MODELS);
            for (const altModel of orderedModels) {
                if (triedModels.has(altModel))
                    continue;
                triedModels.add(altModel);
                if (Date.now() - startTime >= MAX_TOTAL_TIME_MS)
                    break;
                if (shouldSkipProvider(primary, altModel)) {
                    if (debug)
                        console.log(`  [debug] Skipping unhealthy model: ${altModel}`);
                    continue;
                }
                if (debug)
                    console.log(`  [debug] Model fallback to ${altModel}`);
                result = await tryProvider(primary, altModel, getProviderTimeout(primary, false), 'Model fallback');
                if (result) {
                    const errMsg = lastError ? friendlyError(lastError.message, primary) : null;
                    if (errMsg) {
                        console.log(`  ⚡ ${errMsg}`);
                        console.log(`  ⚡ Switched to ${altModel} on ${PROVIDER_DEFAULTS[primary]?.label || primary}.`);
                    }
                    else {
                        console.log(`  ⚡ Switched temporarily to ${altModel}.`);
                    }
                    setLastFallbackUsed(`${PROVIDER_DEFAULTS[primary]?.label || primary} / ${altModel}`);
                    addFallbackEvent(primary, altModel, `Switched to ${PROVIDER_DEFAULTS[primary]?.label || primary} / ${altModel}`);
                    return result;
                }
            }
        }
        // Check total time
        if (Date.now() - startTime >= MAX_TOTAL_TIME_MS) {
            throwAllFailedError(lastError, primary, primaryModel, startTime, skippedReasons, totalAttempts);
        }
        // Provider-level fallback — grouped by provider, counting provider groups not model variants
        const flatCandidates = getFallbackCandidates(primary, config);
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
            // Skip entire provider group if all its healthy models are also unhealthy
            const allSkipped = group.models.every(m => shouldSkipProvider(group.provider, m));
            if (allSkipped) {
                debugCandidateInfo.push(`  [skip] ${provLabel} (all models unhealthy or already failed)`);
                if (debug)
                    console.log(`  [debug] ${debugCandidateInfo[debugCandidateInfo.length - 1]}`);
                providerFallbackCount++;
                continue;
            }
            addFallbackEvent(group.provider, '', `Trying ${provLabel}...`);
            if (!debug)
                console.log(`  ~ ${provLabel}...`);
            if (debug) {
                console.log(`  [debug] Provider fallback ${providerFallbackCount + 1}/${MAX_FALLBACK_PROVIDERS}: ${provLabel} (${group.models.length} models)`);
            }
            let groupSucceeded = false;
            for (const model of group.models) {
                if (shouldSkipProvider(group.provider, model)) {
                    if (debug)
                        console.log(`  [debug]  skipping model: ${model} (unhealthy)`);
                    continue;
                }
                if (Date.now() - startTime >= MAX_TOTAL_TIME_MS)
                    break;
                const fbTimeout = getProviderTimeout(group.provider, false);
                const modelResult = await tryProvider(group.provider, model, fbTimeout, `Fallback ${providerFallbackCount + 1}`);
                if (modelResult) {
                    const label = PROVIDER_DEFAULTS[group.provider]?.label || group.provider;
                    const errMsgFromPrimary = lastError ? friendlyError(lastError.message, primary) : null;
                    if (errMsgFromPrimary) {
                        console.log(`  ⚡ ${errMsgFromPrimary}`);
                        console.log(`  ⚡ Switched to ${label} / ${model}.`);
                    }
                    else {
                        console.log(`  ⚡ Switched to ${label} / ${model}.`);
                    }
                    setLastFallbackUsed(`${label} / ${model}`);
                    addFallbackEvent(group.provider, model, `Switched to ${label} / ${model}`);
                    if (debug) {
                        const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                        console.log(`  [debug] Fallback succeeded after ${totalElapsed}s, ${totalAttempts} attempts.`);
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
            console.log(`  [debug] All providers failed after ${totalElapsed}s, ${totalAttempts} attempts.`);
            console.log(extractDebugInfo(lastError, lastProvider, lastProvider === primary ? primaryModel : '', config, totalElapsed, getProviderTimeout(lastProvider, lastProvider === primary), totalAttempts));
            if (debugCandidateInfo.length > 0) {
                console.log(`  [debug] Skipped candidates:`);
                for (const si of debugCandidateInfo)
                    console.log(si);
            }
            if (skippedReasons.length > 0) {
                console.log(`  [debug] Skipped during retry:`);
                for (const sr of skippedReasons)
                    console.log(sr);
            }
        }
        const primaryLabel = PROVIDER_DEFAULTS[primary]?.label || primary;
        const errMsg = lastError
            ? friendlyError(lastError.message, primary)
            : `${primaryLabel} is unavailable. No fallback providers configured.`;
        throw new Error(`${errMsg}\n  All fallback providers failed. Run hysa doctor to check your configuration.`);
    }
}
function throwAllFailedError(lastError, primary, primaryModel, startTime, skipped, totalAttempts) {
    const el = ((Date.now() - startTime) / 1000).toFixed(0);
    const label = PROVIDER_DEFAULTS[primary]?.label || primary;
    throw new Error(`${label} is unavailable after ${el}s (${totalAttempts} attempts). All retries and fallbacks exhausted.\n  Run hysa doctor to check your provider configuration.`);
}
// ── Greeting guard ──────────────────────────────────
const GREETINGS = ['hi', 'hello', 'hey', 'yo', 'sup', 'hiya', 'howdy', 'greetings', 'salam', 'السلام', 'صباح', 'مساء', 'مرحبا', 'اهلا', 'اه', 'اوك'];
const CASUAL_RESPONSES = {
    bro: "Yo — what do you want to build or fix?",
    thanks: "You're welcome! What's next?",
    ok: "Got it. What do you need help with?",
    lol: "😄 Let me know what you want to build or fix.",
    اوك: "تمام. ماذا تريد أن أعدل أو أشرح في المشروع؟",
    تمام: "تمام. ماذا تريد أن أعدل أو أشرح في المشروع؟",
    نعم: "حسناً. ماذا تريد أن تفعل؟",
    لا: "حسناً. أخبرني إن احتجت شيئاً.",
    شكرا: "العفو! هل تحتاج شيئاً آخر؟",
};
export function isOnlyGreeting(text) {
    const trimmed = text.trim().toLowerCase();
    if (CASUAL_RESPONSES[trimmed])
        return true;
    return GREETINGS.some(g => trimmed === g || trimmed === `${g}!` || trimmed === `${g},` || (trimmed.startsWith(g + ' ') && trimmed.split(/\s+/).length <= 3));
}
export function getCasualResponse(text) {
    const trimmed = text.trim().toLowerCase();
    return CASUAL_RESPONSES[trimmed] || null;
}
function applyGreetingGuard(client) {
    const guarded = {
        async sendMessage(messages, systemPrompt, signal) {
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            if (lastUser) {
                const casual = getCasualResponse(lastUser.content);
                if (casual)
                    return { message: casual, toolCalls: [] };
            }
            const result = await client.sendMessage(messages, systemPrompt, signal);
            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            if (lastUserMsg && isOnlyGreeting(lastUserMsg.content)) {
                const hasReadFile = result.toolCalls?.some(tc => tc.type === 'read_file');
                if (hasReadFile) {
                    return { message: 'Hi! How can I help with this project?', toolCalls: [] };
                }
            }
            return result;
        },
    };
    if (client.sendMessageStream) {
        guarded.sendMessageStream = client.sendMessageStream.bind(client);
    }
    return guarded;
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
    const tier = PROVIDER_TIERS[provider];
    const isLocal = tier === 'local_free';
    const lightMode = config.lightMode !== false && isLocal;
    clearRequestSkips();
    clearFallbackEvents();
    if (tier === 'free_api' || tier === 'premium_api') {
        return applyGreetingGuard(createFallbackClient(provider, config));
    }
    const client = createSingleClient(provider, config.currentModel, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel);
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
        return applyGreetingGuard(wrapped);
    }
    // For local providers, still wrap in fallback for resilience
    return applyGreetingGuard(createFallbackClient(provider, config));
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
//# sourceMappingURL=client.js.map