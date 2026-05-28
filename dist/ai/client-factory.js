import { createAnthropicClient } from './anthropic.js';
import { createOpenAIClient } from './openai.js';
import { createGeminiClient } from './gemini.js';
import { createOllamaClient } from './ollama.js';
import { createOpenRouterClient } from './openrouter.js';
import { createGroqClient } from './groq.js';
import { createDeepSeekClient } from './deepseek.js';
import { createOpenAICompatibleClient } from './openai-compatible.js';
import { createOpenCodeZenClient } from './opencode-zen.js';
import { createHysaAIClient } from './hysa-ai.js';
import { createAnthropicProxyClient } from './anthropic-proxy.js';
import { EXPERIMENTAL_BASE_URLS, PROVIDER_DEFAULTS } from '../config/keys.js';
import { providerModelHasActiveCredentials } from './provider-policy.js';
export function createSingleClient(provider, model, apiKeys, ollamaBaseUrl, localOpenAiBaseUrl, localOpenAiModel, config) {
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
        case 'anthropic_proxy': {
            const proxyUrl = config?.anthropicProxyBaseUrl;
            if (!proxyUrl)
                throw new Error('Anthropic proxy base URL not configured. Set HYSA_ANTHROPIC_PROXY_BASE_URL.');
            const proxyModel = config?.anthropicProxyModel || model;
            return createAnthropicProxyClient(proxyUrl, apiKeys.anthropic_proxy, proxyModel);
        }
        case 'openai_router': {
            const routerUrl = config?.openaiRouterBaseUrl;
            if (!routerUrl)
                throw new Error('OpenAI router base URL not configured. Set HYSA_OPENAI_ROUTER_BASE_URL.');
            const routerModel = model || config?.openaiRouterModel || PROVIDER_DEFAULTS.openai_router.model;
            if (config && !providerModelHasActiveCredentials('openai_router', routerModel, config)) {
                throw new Error(`OpenAI Router / ${routerModel} has no active credentials or connections configured.`);
            }
            return createOpenAICompatibleClient(routerUrl, apiKeys.openai_router, routerModel);
        }
        case 'ninerouter': {
            const nrUrl = config?.ninerouterBaseUrl;
            if (!nrUrl)
                throw new Error('9Router base URL not configured. Set NINEROUTER_URL.');
            const nrModel = model || config?.ninerouterModel || PROVIDER_DEFAULTS.ninerouter.model;
            if (config && !providerModelHasActiveCredentials('ninerouter', nrModel, config)) {
                throw new Error(`9Router / ${nrModel} has no active credentials or connections configured.`);
            }
            return createOpenAICompatibleClient(nrUrl, apiKeys.ninerouter, nrModel);
        }
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}
//# sourceMappingURL=client-factory.js.map