import { PROVIDER_DEFAULTS } from './keys.js';
const DETECT_TIMEOUT_MS = 2000;
export async function detectBestProvider() {
    const router = await tryOpenAIRouter();
    if (router)
        return router;
    const zen = await tryOpenCodeZen();
    if (zen)
        return zen;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (geminiKey?.trim()) {
        return { provider: 'gemini', reason: 'Gemini API key found in environment' };
    }
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey?.trim()) {
        return { provider: 'groq', reason: 'Groq API key found in environment' };
    }
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey?.trim()) {
        return { provider: 'deepseek', reason: 'DeepSeek API key found in environment' };
    }
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (openrouterKey?.trim()) {
        return { provider: 'openrouter', reason: 'OpenRouter API key found in environment' };
    }
    const ollama = await tryOllama();
    if (ollama)
        return ollama;
    return null;
}
async function tryOpenAIRouter() {
    if (process.env.HYSA_DETECT_SKIP_ROUTER === 'true')
        return null;
    const urlsToTry = [];
    const envUrl = process.env.HYSA_OPENAI_ROUTER_BASE_URL;
    if (envUrl) {
        urlsToTry.push(envUrl.replace(/\/+$/, ''));
    }
    else {
        urlsToTry.push('http://127.0.0.1:20128/v1');
        urlsToTry.push('http://localhost:20128/v1');
    }
    const seen = new Set();
    for (const raw of urlsToTry) {
        const url = raw.replace(/\/+$/, '');
        if (seen.has(url))
            continue;
        seen.add(url);
        try {
            const res = await fetch(`${url}/models`, {
                signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
            });
            if (res.ok || res.status === 401) {
                const model = process.env.HYSA_OPENAI_ROUTER_MODEL || 'oc/deepseek-v4-flash-free';
                return { provider: 'openai_router', model, reason: `9router reachable at ${url}`, openaiRouterBaseUrl: url };
            }
        }
        catch {
            // try next
        }
    }
    return null;
}
async function tryOpenCodeZen() {
    if (process.env.HYSA_DETECT_SKIP_OPENCODE_ZEN === 'true')
        return null;
    try {
        const res = await fetch('https://opencode.ai/zen/v1/models', {
            signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
        });
        if (res.ok) {
            return { provider: 'opencode_zen', reason: 'OpenCode Zen reachable' };
        }
    }
    catch {
        // not available
    }
    return null;
}
async function tryOllama() {
    if (process.env.HYSA_DETECT_SKIP_OLLAMA === 'true')
        return null;
    try {
        const res = await fetch('http://localhost:11434/api/tags', {
            signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
        });
        if (res.ok) {
            return { provider: 'ollama', reason: 'Ollama running locally' };
        }
    }
    catch {
        // not running
    }
    return null;
}
export function buildConfigFromDetection(detected) {
    const model = detected.model || PROVIDER_DEFAULTS[detected.provider]?.model || 'default';
    const config = {
        currentProvider: detected.provider,
        currentModel: model,
        apiKeys: {},
        ollamaBaseUrl: 'http://localhost:11434',
    };
    if (detected.provider === 'openai_router' && detected.openaiRouterBaseUrl) {
        config.openaiRouterBaseUrl = detected.openaiRouterBaseUrl;
        config.openaiRouterModel = model;
    }
    return config;
}
export function detectedProviderLabel(detected) {
    const label = PROVIDER_DEFAULTS[detected.provider]?.label || detected.provider;
    const modelStr = detected.model ? ` · ${detected.model}` : '';
    return `${label}${modelStr} (${detected.reason})`;
}
//# sourceMappingURL=provider-detect.js.map