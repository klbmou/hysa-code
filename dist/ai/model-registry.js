import { getProviderPreferenceForTask, providerIsConfigured, } from './provider-policy.js';
const MODEL_REGISTRY = [
    // ── openai_router models ──
    { provider: 'openai_router', model: 'qw/qwen3-coder-flash', label: 'OpenAI Router / qw/qwen3-coder-flash', capabilities: ['simple_chat', 'general_qa', 'coding_qa', 'code_edit', 'project_scan', 'unknown'], priority: 'fast' },
    { provider: 'openai_router', model: 'oc/deepseek-v4-flash-free', label: 'OpenAI Router / oc/deepseek-v4-flash-free', capabilities: ['general_qa', 'coding_qa', 'long_reasoning', 'web_research', 'unknown'], priority: 'balanced' },
    { provider: 'openai_router', model: 'qw/qwen3-coder-plus', label: 'OpenAI Router / qw/qwen3-coder-plus', capabilities: ['code_edit', 'project_scan', 'long_reasoning', 'coding_qa'], priority: 'stronger' },
    { provider: 'openai_router', model: 'oc/nemotron-3-super-free', label: 'OpenAI Router / oc/nemotron-3-super-free', capabilities: ['general_qa', 'coding_qa', 'unknown'], priority: 'fallback' },
    { provider: 'openai_router', model: 'deepseek/deepseek-chat', label: 'OpenAI Router / deepseek/deepseek-chat', capabilities: ['coding_qa', 'long_reasoning', 'general_qa'], priority: 'balanced' },
    { provider: 'openai_router', model: 'openai/gpt-4o-mini', label: 'OpenAI Router / openai/gpt-4o-mini', capabilities: ['general_qa', 'simple_chat', 'unknown'], priority: 'fast' },
    { provider: 'openai_router', model: 'cc/claude-sonnet-4-6', label: 'OpenAI Router / cc/claude-sonnet-4-6', capabilities: ['long_reasoning', 'code_edit', 'coding_qa'], priority: 'stronger' },
    // openai/gpt-4o-mini vision depends on router backend — not reliable
    { provider: 'openai_router', model: 'openai/gpt-4o-mini', label: 'OpenAI Router / openai/gpt-4o-mini', capabilities: ['general_qa', 'simple_chat', 'unknown'], priority: 'fast' },
    // ── ninerouter models ──
    { provider: 'ninerouter', model: 'auto', label: '9Router / auto', capabilities: ['simple_chat', 'general_qa', 'coding_qa', 'code_edit', 'project_scan', 'long_reasoning', 'web_research', 'unknown', 'image_vision'], priority: 'balanced' },
    { provider: 'ninerouter', model: 'gemini/gemini-2.5-flash', label: '9Router / gemini/gemini-2.5-flash', capabilities: ['general_qa', 'coding_qa', 'long_reasoning', 'image_vision', 'simple_chat', 'unknown'], priority: 'balanced' },
    { provider: 'ninerouter', model: 'gemini/gemini-1.5-flash', label: '9Router / gemini/gemini-1.5-flash', capabilities: ['general_qa', 'simple_chat', 'image_vision', 'unknown'], priority: 'fast' },
    { provider: 'ninerouter', model: 'openai/gpt-4o', label: '9Router / openai/gpt-4o', capabilities: ['general_qa', 'coding_qa', 'long_reasoning', 'image_vision', 'unknown'], priority: 'stronger' },
    { provider: 'ninerouter', model: 'openai/gpt-4o-mini', label: '9Router / openai/gpt-4o-mini', capabilities: ['general_qa', 'simple_chat', 'image_vision', 'unknown'], priority: 'fast' },
    // ── openrouter models ──
    { provider: 'openrouter', model: 'qwen/qwen3-coder:free', label: 'OpenRouter / qwen/qwen3-coder:free', capabilities: ['simple_chat', 'general_qa', 'coding_qa'], priority: 'fast' },
    { provider: 'openrouter', model: 'openai/gpt-oss-120b:free', label: 'OpenRouter / openai/gpt-oss-120b:free', capabilities: ['general_qa', 'simple_chat'], priority: 'fast' },
    { provider: 'openrouter', model: 'deepseek/deepseek-chat:free', label: 'OpenRouter / deepseek/deepseek-chat:free', capabilities: ['coding_qa', 'long_reasoning'], priority: 'balanced' },
    { provider: 'openrouter', model: 'google/gemini-2.5-flash:free', label: 'OpenRouter / google/gemini-2.5-flash:free', capabilities: ['general_qa', 'coding_qa', 'long_reasoning', 'image_vision'], priority: 'balanced' },
    { provider: 'openrouter', model: 'deepseek/deepseek-chat', label: 'OpenRouter / deepseek/deepseek-chat', capabilities: ['coding_qa', 'long_reasoning', 'general_qa'], priority: 'balanced' },
    { provider: 'openrouter', model: 'google/gemini-2.5-flash', label: 'OpenRouter / google/gemini-2.5-flash', capabilities: ['general_qa', 'coding_qa', 'long_reasoning', 'image_vision'], priority: 'balanced' },
    { provider: 'openrouter', model: 'openrouter/free', label: 'OpenRouter / openrouter/free', capabilities: ['general_qa', 'simple_chat'], priority: 'fallback' },
    { provider: 'openrouter', model: 'qwen/qwen2.5-vl-72b-instruct:free', label: 'OpenRouter / qwen2.5-vl-72b-instruct:free', capabilities: ['general_qa', 'image_vision'], priority: 'balanced' },
    { provider: 'openrouter', model: 'qwen/qwen-vl-plus', label: 'OpenRouter / qwen-vl-plus', capabilities: ['general_qa', 'image_vision'], priority: 'balanced' },
    // ── gemini ──
    { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini / gemini-2.5-flash', capabilities: ['general_qa', 'coding_qa', 'simple_chat', 'long_reasoning', 'image_vision'], priority: 'balanced' },
    { provider: 'gemini', model: 'gemini-1.5-flash', label: 'Gemini / gemini-1.5-flash', capabilities: ['general_qa', 'simple_chat', 'image_vision'], priority: 'fast' },
    // ── deepseek ──
    { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek / deepseek-chat', capabilities: ['general_qa', 'coding_qa', 'long_reasoning'], priority: 'balanced' },
    { provider: 'deepseek', model: 'deepseek-coder', label: 'DeepSeek / deepseek-coder', capabilities: ['coding_qa', 'code_edit'], priority: 'stronger' },
    // ── groq ──
    { provider: 'groq', model: 'llama3-70b-8192', label: 'Groq / llama3-70b-8192', capabilities: ['general_qa', 'coding_qa', 'simple_chat'], priority: 'fast' },
    { provider: 'groq', model: 'llama3-8b-8192', label: 'Groq / llama3-8b-8192', capabilities: ['general_qa', 'simple_chat'], priority: 'fast' },
    // ── opencode_zen ──
    { provider: 'opencode_zen', model: 'big-pickle', label: 'OpenCode Zen / big-pickle', capabilities: ['general_qa', 'coding_qa', 'simple_chat', 'long_reasoning'], priority: 'balanced' },
    // ── anthropic_proxy ──
    { provider: 'anthropic_proxy', model: 'claude-3-5-sonnet-latest', label: 'Anthropic Proxy / claude-3-5-sonnet-latest', capabilities: ['coding_qa', 'code_edit', 'long_reasoning', 'general_qa', 'image_vision'], priority: 'stronger' },
    { provider: 'anthropic_proxy', model: 'claude-3-haiku-latest', label: 'Anthropic Proxy / claude-3-haiku-latest', capabilities: ['general_qa', 'simple_chat', 'coding_qa'], priority: 'fast' },
    // ── experimental ──
    { provider: 'pollinations', model: 'openai', label: 'Pollinations AI / openai', capabilities: ['general_qa', 'simple_chat'], priority: 'fallback' },
];
const TASK_PRIORITY_ORDER = {
    simple_chat: ['fast', 'balanced', 'fallback'],
    code_review: ['stronger', 'balanced', 'fast', 'fallback'],
    search: ['balanced', 'fast', 'fallback'],
    planning: ['balanced', 'stronger', 'fast', 'fallback'],
    long_context: ['stronger', 'balanced', 'fast', 'fallback'],
    debugging: ['stronger', 'balanced', 'fast', 'fallback'],
    general_qa: ['fast', 'balanced', 'fallback'],
    coding_qa: ['fast', 'balanced', 'stronger', 'fallback'],
    code_edit: ['stronger', 'balanced', 'fast', 'fallback'],
    project_scan: ['stronger', 'balanced', 'fast', 'fallback'],
    web_research: ['balanced', 'fast', 'fallback'],
    long_reasoning: ['stronger', 'balanced', 'fast', 'fallback'],
    image_vision: ['balanced', 'fast', 'stronger', 'fallback'],
    browser_task: ['fast'],
    skill_task: ['balanced', 'fast', 'fallback'],
    unknown: ['balanced', 'fast', 'fallback'],
};
export function providerIsAvailable(provider, config) {
    return providerIsConfigured(provider, config);
}
export function getCandidatesForTask(taskKind, config, healthChecker, runtimeModels) {
    const candidates = [];
    const added = new Set();
    const priorityOrder = TASK_PRIORITY_ORDER[taskKind] || ['balanced', 'fast', 'fallback'];
    const providerOrder = getProviderPreferenceForTask(taskKind, config);
    const normalizedTask = normalizeTaskForRegistry(taskKind);
    const registry = getRuntimeRegistry(config, runtimeModels);
    for (const pri of priorityOrder) {
        for (const mc of registry) {
            if (mc.priority !== pri)
                continue;
            if (normalizedTask === 'image_vision') {
                if (!mc.capabilities.includes('image_vision'))
                    continue;
            }
            else if (normalizedTask !== 'unknown') {
                if (!mc.capabilities.includes(normalizedTask))
                    continue;
            }
            else {
                if (!mc.capabilities.includes('unknown'))
                    continue;
            }
            const key = `${mc.provider}:${mc.model}`;
            if (added.has(key))
                continue;
            added.add(key);
            if (!providerIsAvailable(mc.provider, config))
                continue;
            if (healthChecker.isProviderOnCooldown?.(mc.provider))
                continue;
            if (healthChecker.isOnCooldown(mc.provider, mc.model))
                continue;
            if (healthChecker.isUnhealthy(mc.provider, mc.model))
                continue;
            candidates.push({
                provider: mc.provider,
                model: mc.model,
                label: mc.label,
                priority: mc.priority,
            });
        }
    }
    return candidates.sort((a, b) => {
        const providerDelta = providerIndex(providerOrder, a.provider) - providerIndex(providerOrder, b.provider);
        if (providerDelta !== 0)
            return providerDelta;
        const priorityDelta = priorityIndex(priorityOrder, a.priority) - priorityIndex(priorityOrder, b.priority);
        if (priorityDelta !== 0)
            return priorityDelta;
        return 0;
    });
}
export function getSkippedProviderReasons(config) {
    const reasons = [];
    const checks = [
        { provider: 'openrouter', check: () => !!config.apiKeys.openrouter, reason: 'missing/invalid API key' },
        { provider: 'gemini', check: () => !!config.apiKeys.gemini, reason: 'missing/invalid API key' },
        { provider: 'deepseek', check: () => !!config.apiKeys.deepseek, reason: 'missing/invalid API key' },
        { provider: 'groq', check: () => !!config.apiKeys.groq, reason: 'missing/invalid API key' },
        { provider: 'opencode_zen', check: () => !!config.apiKeys.opencode_zen, reason: 'missing/invalid API key' },
        { provider: 'anthropic_proxy', check: () => !!config.anthropicProxyBaseUrl, reason: 'base URL not configured' },
        { provider: 'openai_router', check: () => !!config.openaiRouterBaseUrl, reason: 'base URL not configured' },
        { provider: 'ninerouter', check: () => !!config.ninerouterBaseUrl, reason: 'NINEROUTER_URL not set' },
    ];
    for (const c of checks) {
        if (!c.check()) {
            reasons.push({ provider: c.provider, reason: c.reason });
        }
    }
    return reasons;
}
function normalizeTaskForRegistry(taskKind) {
    switch (taskKind) {
        case 'debugging':
        case 'code_review':
            return 'code_edit';
        case 'search':
            return 'web_research';
        case 'planning':
        case 'long_context':
            return 'long_reasoning';
        default:
            return taskKind;
    }
}
function getRuntimeRegistry(config, runtimeModels) {
    const registry = [...MODEL_REGISTRY];
    const ollamaModels = runtimeModels?.ollama ?? [];
    for (const model of ollamaModels) {
        registry.push({
            provider: 'ollama',
            model,
            label: `Ollama / ${model}`,
            capabilities: ['simple_chat', 'general_qa', 'coding_qa', 'code_edit', 'project_scan', 'long_reasoning', 'unknown'],
            priority: ollamaPriority(model),
        });
    }
    if (config.currentProvider === 'ninerouter' && config.currentModel && !registry.some(m => m.provider === 'ninerouter' && m.model === config.currentModel)) {
        registry.push({
            provider: 'ninerouter',
            model: config.currentModel,
            label: `9Router / ${config.currentModel}`,
            capabilities: ['simple_chat', 'general_qa', 'coding_qa', 'code_edit', 'project_scan', 'long_reasoning', 'web_research', 'unknown'],
            priority: 'balanced',
        });
    }
    if (config.currentProvider === 'openai_router' && config.currentModel && !registry.some(m => m.provider === 'openai_router' && m.model === config.currentModel)) {
        registry.push({
            provider: 'openai_router',
            model: config.currentModel,
            label: `OpenAI Router / ${config.currentModel}`,
            capabilities: ['simple_chat', 'general_qa', 'coding_qa', 'code_edit', 'project_scan', 'long_reasoning', 'web_research', 'unknown'],
            priority: 'balanced',
        });
    }
    return registry;
}
function ollamaPriority(model) {
    const lower = model.toLowerCase();
    if (/(0\.5b|1\.5b|3b|mini|tiny|flash|fast)/.test(lower))
        return 'fast';
    if (/(coder|code|deepseek|qwen|starcoder|codestral)/.test(lower))
        return 'balanced';
    return 'fast';
}
function providerIndex(providerOrder, provider) {
    const index = providerOrder.indexOf(provider);
    return index >= 0 ? index : providerOrder.length + 1;
}
function priorityIndex(priorityOrder, priority) {
    const index = priorityOrder.indexOf(priority);
    return index >= 0 ? index : priorityOrder.length + 1;
}
//# sourceMappingURL=model-registry.js.map