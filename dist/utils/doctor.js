import pc from 'picocolors';
import { loadConfig, PROVIDER_SIGNUP_URLS, PROVIDER_DEFAULTS, PROVIDER_TIERS, TIER_LABELS, FREE_API_PROVIDERS, EXPERIMENTAL_FREE_PROVIDERS, EXPERIMENTAL_BASE_URLS, validateApiKey, providerHasOptionalApiKey, isLocalFallbackEnabled } from '../config/keys.js';
import { detectBestProvider, detectedProviderLabel } from '../config/provider-detect.js';
import { checkOpenCodeZenAPI } from '../ai/opencode-zen.js';
import { checkAnthropicProxyAPI } from '../ai/anthropic-proxy.js';
import { checkOpenAICompatibleAPI } from '../ai/openai-compatible.js';
import { getLastError, getModelsInCooldown, getProviderCooldowns, getRateLimitedModels } from '../ai/model-health.js';
import { getProviderUsability, getSuggestedFallbackAction } from '../ai/provider-policy.js';
import { listOllamaModels } from '../ai/ollama.js';
import { getWebSearchConfig, getSearchDiagnostics } from '../tools/web-search.js';
import { checkPlaywrightInstalled, checkChromiumInstalled, getBrowserConfig, cliBrowserStatus, getDaemonConfig } from '../tools/browser.js';
import { getBrainStatus } from '../brain/store.js';
import { getGraphStats, experienceGraphExists } from '../brain/graph-store.js';
import { isRecallAvailable } from '../brain/recall.js';
const DOCTOR_TIMEOUT_MS = 15000;
async function withTimeout(promise, timeoutMs) {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
}
async function checkInternet() {
    try {
        await withTimeout(fetch('https://google.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) }).then(r => r), 5000);
        return { name: 'Internet', status: 'ok', message: 'Connected' };
    }
    catch {
        return { name: 'Internet', status: 'error', message: 'No internet connection' };
    }
}
async function getDoctorRuntimeModels(config) {
    try {
        const models = await listOllamaModels(config.ollamaBaseUrl || 'http://localhost:11434', 1500);
        return { ollama: models };
    }
    catch {
        return { ollama: [] };
    }
}
function pushProviderUsability(results, provider, config, runtimeModels) {
    const usability = getProviderUsability(provider, config, runtimeModels);
    const label = PROVIDER_DEFAULTS[provider]?.label || provider;
    const cooldowns = getModelsInCooldown(provider);
    const providerCooldowns = getProviderCooldowns(provider);
    const rateLimited = getRateLimitedModels(provider);
    const allModelsRateLimited = usability.usableModels.length === 0 && rateLimited.length > 0;
    results.push({
        name: `${label} Reachable`,
        status: usability.configured ? 'ok' : 'warn',
        message: usability.configured ? 'Configured/reachable check passed separately' : usability.reason,
    });
    results.push({
        name: `${label} Usable`,
        status: usability.usable ? 'ok' : allModelsRateLimited ? 'error' : 'warn',
        message: usability.usable
            ? `${usability.usableModels.length} usable model(s)`
            : `${usability.reason}${cooldowns.length > 0 || providerCooldowns.length > 0 ? ' (cooldowns active)' : ''}`,
    });
    if (rateLimited.length > 0) {
        results.push({
            name: `${label} Rate Limits`,
            status: allModelsRateLimited ? 'error' : 'warn',
            message: `${rateLimited.length} model(s) recently rate-limited: ${rateLimited.slice(0, 3).map(m => m.model).join(', ')}`,
        });
    }
}
async function checkOllama(baseUrl) {
    try {
        const res = await withTimeout(fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (res.ok) {
            const data = (await res.json());
            const count = data.models?.length ?? 0;
            return { name: 'Ollama', status: 'ok', message: `Running (${count} model${count !== 1 ? 's' : ''})` };
        }
        return { name: 'Ollama', status: 'warn', message: `HTTP ${res.status}` };
    }
    catch {
        return { name: 'Ollama', status: 'error', message: 'Not running' };
    }
}
async function checkLocalOpenAI(baseUrl) {
    try {
        const res = await withTimeout(fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (res.ok) {
            const data = (await res.json());
            const models = data.data?.map((m) => m.id) || [];
            const modelList = models.slice(0, 3).join(', ');
            return { name: 'LM Studio / Local', status: 'ok', message: `Running (${modelList}${models.length > 3 ? '...' : ''})` };
        }
        return { name: 'LM Studio / Local', status: 'warn', message: `HTTP ${res.status}` };
    }
    catch {
        return { name: 'LM Studio / Local', status: 'error', message: 'Not running' };
    }
}
async function checkOpenCodeZen(apiKey) {
    if (!apiKey) {
        return { name: 'OpenCode Zen', status: 'error', message: 'No API key configured' };
    }
    const result = await checkOpenCodeZenAPI(apiKey);
    if (result.ok) {
        return { name: 'OpenCode Zen', status: 'ok', message: 'Reachable' };
    }
    return { name: 'OpenCode Zen', status: 'warn', message: result.message || 'Unreachable' };
}
async function checkOpenRouterAPI(apiKey, debug = false) {
    if (!apiKey) {
        return { name: 'OpenRouter', status: 'error', message: 'No API key configured' };
    }
    const cleaned = validateApiKey(apiKey, 'openrouter');
    if (!cleaned.valid) {
        if (debug) {
            return { name: 'OpenRouter', status: 'error', message: `Key validation failed: ${cleaned.error}` };
        }
        return { name: 'OpenRouter', status: 'error', message: 'Key contains invalid characters. Run hysa config and paste the key again.' };
    }
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleaned.key}`,
            'HTTP-Referer': 'https://github.com/hysa-code',
            'X-Title': 'HYSA Code',
        };
        const res = await withTimeout(fetch('https://openrouter.ai/api/v1/models', { headers, signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (res.ok) {
            return { name: 'OpenRouter', status: 'ok', message: 'API reachable' };
        }
        if (res.status === 401) {
            return { name: 'OpenRouter', status: 'error', message: 'Invalid API key (401). Run hysa config to update it.' };
        }
        const detail = debug ? ` (HTTP ${res.status})` : '';
        return { name: 'OpenRouter', status: 'warn', message: `API responded with status ${res.status}${detail}` };
    }
    catch (err) {
        const e = err;
        const detail = debug ? `: ${e.message}` : '';
        return { name: 'OpenRouter', status: 'error', message: `Cannot reach API${detail}` };
    }
}
async function checkOpenRouterDetailed(apiKey, debug) {
    const results = [];
    const cleaned = validateApiKey(apiKey, 'openrouter');
    if (!cleaned.valid) {
        results.push({ name: 'OpenRouter Key Format', status: 'error', message: cleaned.error || 'Invalid key' });
        return results;
    }
    results.push({ name: 'OpenRouter Key Format', status: 'ok', message: 'Valid' });
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleaned.key}`,
            'HTTP-Referer': 'https://github.com/hysa-code',
            'X-Title': 'HYSA Code',
        };
        const getRes = await withTimeout(fetch('https://openrouter.ai/api/v1/models', { headers, signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (getRes.ok) {
            results.push({ name: 'OpenRouter GET /models', status: 'ok', message: `HTTP ${getRes.status}` });
        }
        else {
            const body = debug ? ` (HTTP ${getRes.status})` : '';
            results.push({ name: 'OpenRouter GET /models', status: 'error', message: `Failed with status ${getRes.status}${body}` });
        }
    }
    catch (err) {
        const e = err;
        results.push({ name: 'OpenRouter GET /models', status: 'error', message: `Cannot reach API: ${debug ? e.message : 'check internet'}` });
    }
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleaned.key}`,
            'HTTP-Referer': 'https://github.com/hysa-code',
            'X-Title': 'HYSA Code',
        };
        const body = JSON.stringify({
            model: 'openrouter/free',
            messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
            max_tokens: 10,
        });
        const postRes = await withTimeout(fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS),
        }), DOCTOR_TIMEOUT_MS);
        if (postRes.ok) {
            results.push({ name: 'OpenRouter POST /chat', status: 'ok', message: 'Chat completion works' });
        }
        else {
            let detail = `HTTP ${postRes.status}`;
            if (postRes.status === 401)
                detail = 'Invalid API key (401)';
            else if (postRes.status === 402)
                detail = 'Credits required (402). Try openrouter/free model.';
            else if (postRes.status === 404)
                detail = 'Model not found (404). Try a different model.';
            else if (postRes.status === 429)
                detail = 'Rate limited (429). Try again later.';
            else if (postRes.status >= 500)
                detail = 'Provider overloaded (5xx). Try again later.';
            if (debug) {
                try {
                    const respBody = await postRes.text();
                    detail += `\n  Response: ${respBody.slice(0, 300)}`;
                }
                catch { /* ignore */ }
            }
            results.push({ name: 'OpenRouter POST /chat', status: 'error', message: detail });
        }
    }
    catch (err) {
        const e = err;
        results.push({ name: 'OpenRouter POST /chat', status: 'error', message: `Request failed: ${debug ? e.message : 'check internet or try again'}` });
    }
    return results;
}
async function checkApiReachability(name, debug = false) {
    const url = PROVIDER_SIGNUP_URLS[name];
    if (!url)
        return { name: `${name} API`, status: 'warn', message: 'No URL' };
    try {
        const res = await withTimeout(fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (res.ok || res.status < 500)
            return { name: `${PROVIDER_DEFAULTS[name]?.label || name}`, status: 'ok', message: 'Reachable' };
        return { name: `${PROVIDER_DEFAULTS[name]?.label || name}`, status: 'warn', message: `HTTP ${res.status}` };
    }
    catch {
        return { name: `${PROVIDER_DEFAULTS[name]?.label || name}`, status: 'warn', message: 'Unreachable' };
    }
}
async function checkOpenAICompatibleEndpoint(label, baseURL, apiKey, debug) {
    const keyStatus = apiKey ? 'with key' : 'without key';
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey)
            headers['Authorization'] = `Bearer ${apiKey}`;
        const res = await withTimeout(fetch(`${baseURL}/models`, { headers, signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (res.ok) {
            return { name: label, status: 'ok', message: `API reachable ${keyStatus}` };
        }
        const detail = debug ? ` (HTTP ${res.status})` : '';
        return { name: label, status: 'warn', message: `API responded with status ${res.status}${detail}` };
    }
    catch (err) {
        const e = err;
        const detail = debug ? `: ${e.message}` : '';
        return { name: label, status: 'error', message: `Cannot reach API${detail}` };
    }
}
async function checkChatCompletion(provider, baseURL, apiKey, debug) {
    const label = `${PROVIDER_DEFAULTS[provider]?.label || provider} POST /chat`;
    try {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (apiKey)
            headers['Authorization'] = `Bearer ${apiKey}`;
        const body = JSON.stringify({
            model: PROVIDER_DEFAULTS[provider]?.model || 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
            max_tokens: 10,
        });
        const res = await withTimeout(fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS),
        }), DOCTOR_TIMEOUT_MS);
        if (res.ok) {
            return { name: label, status: 'ok', message: 'Chat completion works' };
        }
        let detail = `HTTP ${res.status}`;
        if (res.status === 400)
            detail = 'Bad request - model may not exist';
        else if (res.status === 401)
            detail = 'Invalid API key (401)';
        else if (res.status === 404)
            detail = 'Endpoint not found (404)';
        else if (res.status === 429)
            detail = 'Rate limited (429)';
        if (debug) {
            try {
                const respBody = await res.text();
                detail += `\n  Response: ${respBody.slice(0, 300)}`;
            }
            catch { /* ignore */ }
        }
        return { name: label, status: 'error', message: detail };
    }
    catch (err) {
        const e = err;
        return { name: label, status: 'error', message: `Request failed: ${debug ? e.message : 'check internet or try again'}` };
    }
}
async function checkPollinations(debug = false) {
    const baseURL = EXPERIMENTAL_BASE_URLS.pollinations || 'https://text.pollinations.ai/v1';
    return checkOpenAICompatibleEndpoint('Pollinations AI', baseURL, undefined, debug);
}
async function checkPollinationsDetailed(debug) {
    const results = [];
    const baseURL = EXPERIMENTAL_BASE_URLS.pollinations || 'https://text.pollinations.ai/v1';
    results.push(await checkOpenAICompatibleEndpoint('Pollinations GET /models', baseURL, undefined, debug));
    results.push(await checkChatCompletion('pollinations', baseURL, undefined, debug));
    return results;
}
async function checkLLM7(debug = false) {
    const baseURL = EXPERIMENTAL_BASE_URLS.llm7 || 'https://api.llm7.io/v1';
    return checkOpenAICompatibleEndpoint('LLM7', baseURL, undefined, debug);
}
async function checkLLM7Detailed(debug) {
    const results = [];
    const baseURL = EXPERIMENTAL_BASE_URLS.llm7 || 'https://api.llm7.io/v1';
    results.push(await checkOpenAICompatibleEndpoint('LLM7 GET /models', baseURL, undefined, debug));
    results.push(await checkChatCompletion('llm7', baseURL, undefined, debug));
    return results;
}
async function checkPuter(debug = false) {
    const baseURL = EXPERIMENTAL_BASE_URLS.puter || 'https://api.puter.com/v1';
    return checkOpenAICompatibleEndpoint('Puter AI', baseURL, undefined, debug);
}
async function checkPuterDetailed(debug) {
    const results = [];
    const baseURL = EXPERIMENTAL_BASE_URLS.puter || 'https://api.puter.com/v1';
    results.push(await checkOpenAICompatibleEndpoint('Puter GET /models', baseURL, undefined, debug));
    results.push(await checkChatCompletion('puter', baseURL, undefined, debug));
    return results;
}
async function checkDeepSeekDetailed(apiKey, debug) {
    return checkOpenAICompatibleDetailed('DeepSeek', 'https://api.deepseek.com/v1', apiKey, debug);
}
async function checkGeminiDetailed(apiKey, debug) {
    const results = [];
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const res = await withTimeout(fetch(url, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (res.ok) {
            results.push({ name: 'Gemini GET /models', status: 'ok', message: 'API reachable' });
        }
        else {
            results.push({ name: 'Gemini GET /models', status: 'error', message: debug ? `HTTP ${res.status}` : 'API returned error' });
        }
    }
    catch (err) {
        const e = err;
        results.push({ name: 'Gemini GET /models', status: 'error', message: `Cannot reach API: ${debug ? e.message : 'check internet'}` });
    }
    return results;
}
async function checkGroqDetailed(apiKey, debug) {
    return checkOpenAICompatibleDetailed('Groq', 'https://api.groq.com/openai/v1', apiKey, debug);
}
async function checkOpenAICompatibleDetailed(label, baseURL, apiKey, debug) {
    const results = [];
    results.push(await checkOpenAICompatibleEndpoint(`${label} GET /models`, baseURL, apiKey, debug));
    results.push(await checkChatCompletionForLabel(label, baseURL, apiKey, debug));
    return results;
}
async function checkChatCompletionForLabel(label, baseURL, apiKey, debug) {
    try {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (apiKey)
            headers['Authorization'] = `Bearer ${apiKey}`;
        const body = JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
            max_tokens: 10,
        });
        const res = await withTimeout(fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS),
        }), DOCTOR_TIMEOUT_MS);
        if (res.ok) {
            return { name: `${label} POST /chat`, status: 'ok', message: 'Chat completion works' };
        }
        let detail = `HTTP ${res.status}`;
        if (res.status === 400)
            detail = 'Bad request - model may not exist';
        else if (res.status === 401)
            detail = 'Invalid API key (401)';
        else if (res.status === 404)
            detail = 'Endpoint not found (404)';
        else if (res.status === 429)
            detail = 'Rate limited (429)';
        if (debug) {
            try {
                const respBody = await res.text();
                detail += `\n  Response: ${respBody.slice(0, 300)}`;
            }
            catch { /* ignore */ }
        }
        return { name: `${label} POST /chat`, status: 'error', message: detail };
    }
    catch (err) {
        const e = err;
        return { name: `${label} POST /chat`, status: 'error', message: `Request failed: ${debug ? e.message : 'check internet or try again'}` };
    }
}
async function checkHysaAIDetailed(debug) {
    const results = [];
    const baseURL = 'http://localhost:3002/v1';
    const apiKey = 'hysa_dev_key';
    const modelsResult = await checkOpenAICompatibleEndpoint('HYSA AI GET /models', baseURL, apiKey, debug);
    results.push(modelsResult);
    if (modelsResult.status === 'error') {
        results.push({ name: 'HYSA AI POST /chat', status: 'error', message: 'Skipped - server not reachable' });
        return results;
    }
    const chatResult = await checkChatCompletionForModel('hysa-ai', baseURL, apiKey, 'hysa-coder-lite', debug);
    results.push(chatResult);
    return results;
}
async function checkAnthropicProxyDetailed(config, debug) {
    const results = [];
    const baseUrl = config.anthropicProxyBaseUrl;
    if (!baseUrl) {
        results.push({ name: 'Base URL', status: 'error', message: 'Not configured. Set HYSA_ANTHROPIC_PROXY_BASE_URL.' });
        return results;
    }
    try {
        const parsedUrl = new URL(baseUrl);
        results.push({ name: 'Base URL', status: 'ok', message: parsedUrl.href });
    }
    catch {
        results.push({ name: 'Base URL', status: 'error', message: `Invalid URL: ${baseUrl}` });
        return results;
    }
    const checkResult = await checkAnthropicProxyAPI(baseUrl, config.apiKeys.anthropic_proxy);
    if (checkResult.ok) {
        results.push({ name: 'API Connection', status: 'ok', message: 'Proxy endpoint is reachable' });
    }
    else {
        results.push({ name: 'API Connection', status: 'error', message: checkResult.message });
        return results;
    }
    const model = config.anthropicProxyModel || 'claude-3-5-sonnet-latest';
    results.push({ name: 'Default Model', status: 'ok', message: model });
    if (config.apiKeys.anthropic_proxy) {
        results.push({ name: 'API Key', status: 'ok', message: 'Configured' });
    }
    else {
        results.push({ name: 'API Key', status: 'warn', message: 'Not configured (optional)' });
    }
    return results;
}
async function check9RouterDetailed(config, debug) {
    const results = [];
    const runtimeModels = await getDoctorRuntimeModels(config);
    const baseUrl = config.ninerouterBaseUrl || 'http://localhost:20128/v1';
    try {
        const parsedUrl = new URL(baseUrl);
        results.push({ name: 'Base URL', status: 'ok', message: parsedUrl.href });
    }
    catch {
        results.push({ name: 'Base URL', status: 'error', message: `Invalid URL: ${baseUrl}` });
        return results;
    }
    const checkResult = await checkOpenAICompatibleAPI(baseUrl, config.apiKeys.ninerouter);
    if (checkResult.ok) {
        results.push({ name: 'API Connection', status: 'ok', message: '9Router endpoint is reachable' });
    }
    else {
        results.push({ name: 'API Connection', status: 'error', message: checkResult.message });
        return results;
    }
    const model = config.ninerouterModel || 'auto (default)';
    results.push({ name: 'Default Model', status: 'ok', message: model });
    if (config.apiKeys.ninerouter) {
        results.push({ name: 'API Key', status: 'ok', message: 'Configured' });
    }
    else {
        results.push({ name: 'API Key', status: 'warn', message: 'Not configured (optional)' });
    }
    pushProviderUsability(results, 'ninerouter', config, runtimeModels);
    return results;
}
async function checkOpenAIRouterDetailed(config, debug) {
    const results = [];
    const runtimeModels = await getDoctorRuntimeModels(config);
    const baseUrl = config.openaiRouterBaseUrl;
    if (!baseUrl) {
        results.push({ name: 'Base URL', status: 'error', message: 'Not configured. Set HYSA_OPENAI_ROUTER_BASE_URL.' });
        return results;
    }
    try {
        const parsedUrl = new URL(baseUrl);
        results.push({ name: 'Base URL', status: 'ok', message: parsedUrl.href });
    }
    catch {
        results.push({ name: 'Base URL', status: 'error', message: `Invalid URL: ${baseUrl}` });
        return results;
    }
    const checkResult = await checkOpenAICompatibleAPI(baseUrl, config.apiKeys.openai_router);
    if (checkResult.ok) {
        results.push({ name: 'API Connection', status: 'ok', message: 'Router endpoint is reachable' });
    }
    else {
        results.push({ name: 'API Connection', status: 'error', message: checkResult.message });
        return results;
    }
    const model = config.openaiRouterModel || 'gpt-4o-mini (default)';
    results.push({ name: 'Default Model', status: 'ok', message: model });
    if (config.apiKeys.openai_router) {
        results.push({ name: 'API Key', status: 'ok', message: 'Configured' });
    }
    else {
        results.push({ name: 'API Key', status: 'warn', message: 'Not configured (optional)' });
    }
    pushProviderUsability(results, 'openai_router', config, runtimeModels);
    return results;
}
async function checkChatCompletionForModel(provider, baseURL, apiKey, model, debug) {
    const label = `${provider} POST /chat`;
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey)
            headers['Authorization'] = `Bearer ${apiKey}`;
        const body = JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
            max_tokens: 10,
        });
        const res = await withTimeout(fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS),
        }), DOCTOR_TIMEOUT_MS);
        if (res.ok) {
            return { name: label, status: 'ok', message: 'Chat completion works' };
        }
        let detail = `HTTP ${res.status}`;
        if (res.status === 400)
            detail = 'Bad request - model may not exist';
        else if (res.status === 401)
            detail = 'Invalid API key (401)';
        else if (res.status === 404)
            detail = 'Endpoint not found (404)';
        if (debug) {
            try {
                const respBody = await res.text();
                detail += `\n  Response: ${respBody.slice(0, 300)}`;
            }
            catch { /* ignore */ }
        }
        return { name: label, status: 'error', message: detail };
    }
    catch (err) {
        const e = err;
        return { name: label, status: 'error', message: `Request failed: ${debug ? e.message : 'check internet or try again'}` };
    }
}
async function checkOllamaDetailed(config, debug) {
    const results = [];
    const baseUrl = config.ollamaBaseUrl || 'http://localhost:11434';
    // Server reachable?
    try {
        const res = await withTimeout(fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (!res.ok) {
            results.push({ name: 'Ollama Server', status: 'error', message: `HTTP ${res.status} — is Ollama running?` });
            return results;
        }
        results.push({ name: 'Ollama Server', status: 'ok', message: `Reachable at ${baseUrl}` });
    }
    catch {
        results.push({ name: 'Ollama Server', status: 'error', message: 'Not running. Start it: ollama serve' });
        return results;
    }
    // Models available?
    try {
        const data = await (await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) })).json();
        const count = data.models?.length ?? 0;
        if (count === 0) {
            results.push({ name: 'Ollama Models', status: 'warn', message: 'No models found. Pull one: ollama pull qwen2.5-coder:1.5b' });
        }
        else {
            results.push({ name: 'Ollama Models', status: 'ok', message: `${count} model${count !== 1 ? 's' : ''} available` });
        }
    }
    catch {
        results.push({ name: 'Ollama Models', status: 'warn', message: 'Could not list models' });
    }
    return results;
}
async function checkLocalOpenAIDetailed(config, debug) {
    const results = [];
    const baseUrl = config.localOpenAiBaseUrl || 'http://localhost:1234/v1';
    try {
        const res = await withTimeout(fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (!res.ok) {
            results.push({ name: 'LM Studio Server', status: 'error', message: `HTTP ${res.status} — is LM Studio / local server running?` });
            return results;
        }
        results.push({ name: 'LM Studio Server', status: 'ok', message: `Reachable at ${baseUrl}` });
    }
    catch {
        results.push({ name: 'LM Studio Server', status: 'error', message: 'Not running. Start LM Studio → Local Inference Server → Start' });
        return results;
    }
    // Models loaded?
    try {
        const data = await (await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) })).json();
        const models = data.data?.map(m => m.id) || [];
        if (models.length === 0) {
            results.push({ name: 'LM Studio Models', status: 'warn', message: 'No models loaded. Load a model in LM Studio first.' });
        }
        else {
            results.push({ name: 'LM Studio Models', status: 'ok', message: `${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}` });
        }
    }
    catch {
        results.push({ name: 'LM Studio Models', status: 'warn', message: 'Could not list models' });
    }
    return results;
}
async function checkLlamaCppDetailed(config, debug) {
    const results = [];
    const baseUrl = 'http://localhost:8080/v1';
    try {
        const res = await withTimeout(fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }), DOCTOR_TIMEOUT_MS);
        if (!res.ok) {
            results.push({ name: 'llama.cpp Server', status: 'error', message: `HTTP ${res.status} — is llama.cpp running?` });
            return results;
        }
        results.push({ name: 'llama.cpp Server', status: 'ok', message: `Reachable at ${baseUrl}` });
    }
    catch {
        results.push({ name: 'llama.cpp Server', status: 'error', message: 'Not running. Start: ./server -m model.gguf --port 8080' });
        return results;
    }
    // Models available?
    try {
        const data = await (await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) })).json();
        const models = data.data?.map(m => m.id) || [];
        if (models.length === 0) {
            results.push({ name: 'llama.cpp Models', status: 'warn', message: 'No models loaded. Specify a model with -m flag.' });
        }
        else {
            results.push({ name: 'llama.cpp Models', status: 'ok', message: `${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}` });
        }
    }
    catch {
        results.push({ name: 'llama.cpp Models', status: 'warn', message: 'Could not list models' });
    }
    return results;
}
export async function runVisionDiagnostics(debug = false) {
    console.log(pc.bold(pc.magenta('\n🔍 Vision Diagnostics\n')));
    const config = loadConfig();
    if (!config) {
        console.log(pc.red('\n  No config found. Run: hysa chat\n'));
        return;
    }
    const envModel = process.env.HYSA_VISION_MODEL;
    console.log(`  ${pc.bold('HYSA_VISION_MODEL')}: ${envModel ? pc.green(envModel) : pc.dim('(not set)')}`);
    const configuredModel = config.visionModel;
    if (configuredModel && !envModel) {
        console.log(`  ${pc.bold('config.visionModel')}: ${pc.cyan(configuredModel)} (from config file)`);
    }
    console.log();
    // Check what the fallback candidates would be
    const { getVisionFallbackCandidates } = await import('../web/api.js');
    const candidates = getVisionFallbackCandidates(config);
    if (candidates.length === 0) {
        console.log(pc.yellow(`  ✘ No vision-capable fallback models available.`));
        console.log(pc.dim(`    Configure HYSA_VISION_MODEL=provider/model, or add API keys for Gemini/OpenRouter.\n`));
        return;
    }
    console.log(`  ${pc.bold('Vision Fallback Order')}:`);
    for (const c of candidates) {
        const prov = c.provider;
        const label = c.label;
        const keyConfig = config.apiKeys[prov];
        const hasKey = prov === 'openai_router' || !!keyConfig;
        const hasVision = true; // assume candidate is selected as vision-capable
        const status = hasKey ? pc.green('✔') : pc.red('✘');
        const statusText = hasKey ? 'usable' : `${pc.red('missing API key')}`;
        console.log(`    ${status} ${pc.bold(label.padEnd(50))} ${statusText}`);
    }
    console.log();
    const usable = candidates.filter(c => {
        if (c.provider === 'openai_router')
            return true;
        return !!config.apiKeys[c.provider];
    });
    if (usable.length === 0) {
        console.log(pc.yellow(`  ⚠ No usable vision providers — check your API keys.\n`));
        const geminiKey = config.apiKeys.gemini;
        const orKey = config.apiKeys.openrouter;
        console.log(`  ${geminiKey ? pc.green('✔') : pc.red('✘')} Gemini API key: ${geminiKey ? 'configured' : 'not set'}`);
        console.log(`  ${orKey ? pc.green('✔') : pc.red('✘')} OpenRouter API key: ${orKey ? 'configured' : 'not set'}`);
        console.log(pc.dim(`\n  Set HYSA_VISION_MODEL=gemini/gemini-2.5-flash and configure the required API key.\n`));
    }
    else {
        console.log(pc.green(`  ✔ ${usable.length}/${candidates.length} vision provider(s) usable.\n`));
    }
    console.log(pc.dim(`  Run tests with: hysa chat (with an image attachment)\n`));
}
export async function runDoctor(debug = false, provider) {
    if (provider) {
        const config = loadConfig();
        if (!config) {
            console.log(pc.red('\nNo config found. Run: hysa chat\n'));
            return;
        }
        const label = PROVIDER_DEFAULTS[provider]?.label || provider;
        console.log(pc.bold(pc.magenta(`\n🔍 Detailed Diagnostics: ${label}\n`)));
        let results = [];
        if (provider === 'openrouter') {
            if (!config.apiKeys.openrouter) {
                console.log(pc.red('  ✘ No OpenRouter API key configured.\n'));
                return;
            }
            results = await checkOpenRouterDetailed(config.apiKeys.openrouter, debug);
        }
        else if (provider === 'pollinations') {
            results = await checkPollinationsDetailed(debug);
        }
        else if (provider === 'llm7') {
            results = await checkLLM7Detailed(debug);
        }
        else if (provider === 'puter') {
            results = await checkPuterDetailed(debug);
        }
        else if (provider === 'deepseek') {
            if (!config.apiKeys.deepseek) {
                console.log(pc.red('  ✘ No DeepSeek API key configured.\n'));
                return;
            }
            results = await checkDeepSeekDetailed(config.apiKeys.deepseek, debug);
        }
        else if (provider === 'gemini') {
            if (!config.apiKeys.gemini) {
                console.log(pc.red('  ✘ No Gemini API key configured.\n'));
                return;
            }
            results = await checkGeminiDetailed(config.apiKeys.gemini, debug);
        }
        else if (provider === 'groq') {
            if (!config.apiKeys.groq) {
                console.log(pc.red('  ✘ No Groq API key configured.\n'));
                return;
            }
            results = await checkGroqDetailed(config.apiKeys.groq, debug);
        }
        else if (provider === 'ollama') {
            results = await checkOllamaDetailed(config, debug);
        }
        else if (provider === 'local_openai') {
            results = await checkLocalOpenAIDetailed(config, debug);
        }
        else if (provider === 'llama_cpp') {
            results = await checkLlamaCppDetailed(config, debug);
        }
        else if (provider === 'hysa_ai') {
            results = await checkHysaAIDetailed(debug);
        }
        else if (provider === 'anthropic_proxy') {
            results = await checkAnthropicProxyDetailed(config, debug);
        }
        else if (provider === 'openai_router') {
            results = await checkOpenAIRouterDetailed(config, debug);
        }
        else if (provider === 'ninerouter') {
            results = await check9RouterDetailed(config, debug);
        }
        else if (provider === 'anthropic' || provider === 'openai' || provider === 'opencode_zen') {
            console.log(pc.yellow(`  Diagnostics for "${provider}" not yet supported in detailed mode. Try:\n  hysa doctor\n  hysa doctor --provider hysa-ai\n`));
            return;
        }
        else {
            console.log(pc.yellow(`  Diagnostics for "${provider}" not yet supported. Try:\n  hysa doctor --provider openrouter\n  hysa doctor --provider hysa-ai\n`));
            return;
        }
        for (const r of results) {
            const icon = r.status === 'ok' ? pc.green('✔') : r.status === 'warn' ? pc.yellow('⚠') : pc.red('✘');
            console.log(`  ${icon} ${pc.bold(r.name.padEnd(32))} ${r.message}`);
        }
        const hasIssues = results.some(r => r.status === 'error');
        if (hasIssues) {
            console.log(pc.yellow('\n  Some tests failed. Check the errors above and verify your setup.\n'));
        }
        else {
            console.log(pc.green('\n  All checks passed!\n'));
        }
        return;
    }
    // Full general diagnostic
    console.log(pc.bold(pc.magenta('\n🔍 HYSA Code Diagnostic\n')));
    const config = loadConfig();
    const results = [];
    results.push(await checkInternet());
    if (config) {
        const runtimeModels = await getDoctorRuntimeModels(config);
        const localFallbackEnabled = isLocalFallbackEnabled(config);
        results.push({ name: 'Config', status: 'ok', message: '~/.hysa/config.json found' });
        if (config.currentProvider === 'ollama' || config.ollamaBaseUrl) {
            results.push(await checkOllama(config.ollamaBaseUrl));
        }
        results.push({
            name: 'Local Fallback',
            status: localFallbackEnabled ? 'ok' : 'warn',
            message: localFallbackEnabled
                ? 'Enabled via HYSA_ENABLE_LOCAL_FALLBACK=true'
                : 'Disabled by default. Set HYSA_ENABLE_LOCAL_FALLBACK=true to allow Ollama fallback.',
        });
        const localOpenAiUrl = config.localOpenAiBaseUrl || 'http://localhost:1234/v1';
        if (config.currentProvider === 'local_openai') {
            results.push(await checkLocalOpenAI(localOpenAiUrl));
        }
        const hysaAiUrl = config.hysaAiBaseUrl || 'http://localhost:3002/v1';
        if (config.currentProvider === 'hysa_ai') {
            results.push(await checkLocalOpenAI(hysaAiUrl));
        }
        for (const [prov, key] of Object.entries(config.apiKeys)) {
            const label = PROVIDER_DEFAULTS[prov]?.label || prov;
            const tier = PROVIDER_TIERS[prov];
            const tierLabel = tier ? TIER_LABELS[tier]?.label || '' : '';
            if (key) {
                const masked = key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '[set]';
                results.push({ name: `${label}`, status: 'ok', message: `${tierLabel} key: ${masked}` });
            }
            else {
                results.push({ name: `${label}`, status: 'error', message: `${tierLabel} key not set` });
            }
        }
        for (const prov of FREE_API_PROVIDERS) {
            if (prov === 'openrouter')
                continue;
            if (config.apiKeys[prov]) {
                results.push(await checkApiReachability(prov, debug));
            }
        }
        if (config.apiKeys.openrouter) {
            results.push(await checkOpenRouterAPI(config.apiKeys.openrouter, debug));
        }
        const current = config.currentProvider;
        const currentLabel = PROVIDER_DEFAULTS[current]?.label || current;
        const currentTier = PROVIDER_TIERS[current];
        const currentTierLabel = currentTier ? TIER_LABELS[currentTier]?.label || '' : '';
        const hasKey = current === 'ollama' || current === 'local_openai' || current === 'hysa_ai' || providerHasOptionalApiKey(current) || !!config.apiKeys[current];
        results.push({
            name: 'Current Provider',
            status: hasKey ? 'ok' : 'error',
            message: `${currentLabel} (${currentTierLabel})`,
        });
        if (config.apiKeys.opencode_zen) {
            results.push(await checkOpenCodeZen(config.apiKeys.opencode_zen));
        }
        if (config.allowExperimentalProviders) {
            for (const prov of EXPERIMENTAL_FREE_PROVIDERS) {
                if (config.currentProvider === prov) {
                    if (prov === 'pollinations')
                        results.push(await checkPollinations(debug));
                    else if (prov === 'llm7')
                        results.push(await checkLLM7(debug));
                    else if (prov === 'puter')
                        results.push(await checkPuter(debug));
                }
            }
        }
        if (config.apiKeys.gemini && config.currentProvider === 'gemini') {
            results.push({
                name: 'Gemini Quota',
                status: 'warn',
                message: 'Free tier: 60 requests/min. Daily limit applies.',
            });
        }
        // Anthropic proxy status
        if (config.anthropicProxyBaseUrl) {
            results.push({ name: 'Anthropic Proxy', status: 'ok', message: `Base URL: ${config.anthropicProxyBaseUrl}` });
            const proxyModel = config.anthropicProxyModel || 'claude-3-5-sonnet-latest (default)';
            results.push({ name: 'Proxy Model', status: 'ok', message: proxyModel });
            if (config.apiKeys.anthropic_proxy) {
                results.push({ name: 'Proxy Key', status: 'ok', message: 'Configured (optional)' });
            }
            else {
                results.push({ name: 'Proxy Key', status: 'warn', message: 'Not configured (optional)' });
            }
        }
        else {
            results.push({ name: 'Anthropic Proxy', status: 'warn', message: 'Not configured. Set HYSA_ANTHROPIC_PROXY_BASE_URL.' });
        }
        // OpenAI router status
        if (config.openaiRouterBaseUrl) {
            results.push({ name: 'OpenAI Router', status: 'ok', message: `Base URL: ${config.openaiRouterBaseUrl}` });
            const routerModel = config.openaiRouterModel || 'gpt-4o-mini (default)';
            results.push({ name: 'Router Model', status: 'ok', message: routerModel });
            if (config.apiKeys.openai_router) {
                results.push({ name: 'Router Key', status: 'ok', message: 'Configured (optional)' });
            }
            else {
                results.push({ name: 'Router Key', status: 'warn', message: 'Not configured (optional)' });
            }
            pushProviderUsability(results, 'openai_router', config, runtimeModels);
        }
        else {
            results.push({ name: 'OpenAI Router', status: 'warn', message: 'Not configured. Set HYSA_OPENAI_ROUTER_BASE_URL.' });
        }
        // 9Router status
        const nrBaseUrl = config.ninerouterBaseUrl || (process.env.NINEROUTER_URL ? process.env.NINEROUTER_URL.replace(/\/+$/, '') : null);
        if (nrBaseUrl) {
            results.push({ name: '9Router', status: 'ok', message: `Base URL: ${nrBaseUrl}` });
            const nrModel = config.ninerouterModel || 'auto (default)';
            results.push({ name: '9Router Model', status: 'ok', message: nrModel });
            if (config.apiKeys.ninerouter) {
                results.push({ name: '9Router Key', status: 'ok', message: 'Configured (optional)' });
            }
            else {
                results.push({ name: '9Router Key', status: 'warn', message: 'Not configured (optional)' });
            }
            pushProviderUsability(results, 'ninerouter', config, runtimeModels);
        }
        else {
            results.push({ name: '9Router', status: 'warn', message: 'Not configured. Set NINEROUTER_URL.' });
        }
        const lastChatError = getLastError();
        if (lastChatError) {
            const action = lastChatError.provider === 'ollama'
                ? 'Ollama is reachable, but the last local model failed. Pull or select a chat-capable coding model.'
                : getSuggestedFallbackAction(lastChatError.provider, config, lastChatError.reason, runtimeModels);
            results.push({
                name: 'Last Chat Error',
                status: lastChatError.category === 'invalid_key' ? 'error' : 'warn',
                message: `${lastChatError.provider}/${lastChatError.model}: ${lastChatError.category}. ${action}`,
            });
        }
        // Web search status
        const wsConfig = getWebSearchConfig();
        const wsDiag = getSearchDiagnostics();
        if (wsConfig.provider !== 'none') {
            results.push({ name: 'Web Search', status: 'ok', message: `Provider: ${wsConfig.provider}` });
            if (wsConfig.tavilyKey)
                results.push({ name: 'Tavily Key', status: 'ok', message: 'Configured' });
            if (wsConfig.serperKey)
                results.push({ name: 'Serper Key', status: 'ok', message: 'Configured' });
            if (wsConfig.braveKey)
                results.push({ name: 'Brave Key', status: 'ok', message: 'Configured' });
            if (wsDiag.ddgExperimental) {
                results.push({ name: 'DDG Fallback', status: 'warn', message: 'Limited instant answer API — configure a reliable provider for full search.' });
            }
        }
        else {
            results.push({ name: 'Web Search', status: 'warn', message: 'Not configured. Set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.' });
            results.push({ name: 'DDG Fallback', status: 'ok', message: 'Available (no API key needed, but limited — instant answers only)' });
        }
        // Browser status
        const pwInstalled = await checkPlaywrightInstalled();
        const crInstalled = await checkChromiumInstalled();
        const browserCfg = getBrowserConfig();
        const daemonCfg = getDaemonConfig();
        const daemonStatus = await cliBrowserStatus();
        results.push({ name: 'Playwright', status: pwInstalled ? 'ok' : 'warn', message: pwInstalled ? 'Package installed' : 'Not installed. Run: npm install playwright' });
        results.push({ name: 'Chromium', status: crInstalled === true ? 'ok' : 'warn', message: crInstalled === true ? 'Installed' : crInstalled === 'unknown' ? 'Unknown (check with: npx playwright install chromium)' : 'Not found. Run: npx playwright install chromium' });
        results.push({ name: 'Browser Mode', status: 'ok', message: browserCfg.headless ? 'Headless' : 'Visible (HYSA_BROWSER_HEADLESS=false)' });
        results.push({ name: 'Screenshots', status: 'ok', message: browserCfg.screenshotDir });
        results.push({ name: 'Daemon', status: daemonCfg.enabled ? 'ok' : 'warn', message: daemonCfg.enabled ? (daemonStatus.active ? `Active (PID ${daemonStatus.pid}, port ${daemonStatus.port})` : 'Enabled, no active session') : 'Disabled (HYSA_BROWSER_DAEMON_ENABLED=false)' });
        results.push({ name: 'Browser API', status: 'warn', message: process.env.HYSA_BROWSER_API_ENABLED === 'true' ? 'Enabled (HYSA_BROWSER_API_ENABLED=true)' : 'CLI only (set HYSA_BROWSER_API_ENABLED=true for Web API)' });
        // Brain system status
        const brainStatus = await getBrainStatus();
        if (brainStatus.exists) {
            results.push({ name: 'Brain Dir', status: 'ok', message: `.hysa/brain/ exists` });
            results.push({ name: 'Project Map', status: brainStatus.projectMapDate ? 'ok' : 'warn', message: brainStatus.projectMapDate ? `Updated ${new Date(brainStatus.projectMapDate).toLocaleDateString()}` : 'Not generated' });
            const graphExists = await experienceGraphExists();
            if (graphExists) {
                const graphStats = await getGraphStats();
                results.push({ name: 'Experience Graph', status: 'ok', message: `${graphStats.nodeCount} nodes, ${graphStats.edgeCount} edges, updated ${new Date(graphStats.updatedAt).toLocaleDateString()}` });
            }
            else {
                results.push({ name: 'Experience Graph', status: 'warn', message: 'Not yet created (auto-created on first event)' });
            }
            const recallAvail = await isRecallAvailable();
            results.push({ name: 'Recall Module', status: recallAvail ? 'ok' : 'warn', message: recallAvail ? 'Available' : 'No memory data to recall' });
            results.push({ name: 'Event Log', status: 'ok', message: `${brainStatus.eventCount} events` });
            results.push({ name: 'Git Ignored', status: 'ok', message: '.hysa/ is gitignored' });
        }
        else {
            results.push({ name: 'Brain System', status: 'warn', message: 'Not initialized. Run: hysa brain init' });
        }
    }
    else {
        results.push({ name: 'Config', status: 'error', message: 'No config found. Running auto-detection...' });
        const detected = await detectBestProvider();
        if (detected) {
            results.push({ name: 'Auto-Detected', status: 'ok', message: detectedProviderLabel(detected) });
            results.push({ name: 'Next Step', status: 'ok', message: 'Run: hysa chat  (will auto-save this config)' });
        }
        else {
            results.push({ name: 'Auto-Detection', status: 'error', message: 'No provider detected. Run: hysa chat to set up manually.' });
        }
    }
    console.log();
    for (const r of results) {
        const icon = r.status === 'ok' ? pc.green('✔') : r.status === 'warn' ? pc.yellow('⚠') : pc.red('✘');
        console.log(`  ${icon} ${pc.bold(r.name.padEnd(22))} ${r.message}`);
    }
    if (debug) {
        console.log(pc.dim(`\n  Debug info: Current provider: ${config?.currentProvider}, model: ${config?.currentModel}`));
        if (config?.apiKeys.openrouter) {
            console.log(pc.dim(`  OpenRouter key: [configured]`));
        }
    }
    const hasError = results.some(r => r.status === 'error');
    const hasWarn = results.some(r => r.status === 'warn');
    if (hasError) {
        console.log(pc.yellow('\n  Some issues found. Run "hysa config" to review your setup.\n'));
    }
    else if (hasWarn) {
        console.log(pc.yellow('\n  Warnings found. HYSA can run, but review the warnings above.\n'));
    }
    else {
        console.log(pc.green('\n  All checks passed! HYSA Code is ready to use.\n'));
    }
}
//# sourceMappingURL=doctor.js.map