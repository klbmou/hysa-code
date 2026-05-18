const WEAK_FOR_TOOLS = new Set();
const UNHEALTHY = new Set();
export function markWeakForTools(provider, model) {
    WEAK_FOR_TOOLS.add(`${provider}:${model}`);
}
export function isWeakForTools(provider, model) {
    return WEAK_FOR_TOOLS.has(`${provider}:${model}`);
}
export function markUnhealthy(provider, model) {
    UNHEALTHY.add(`${provider}:${model}`);
}
export function isUnhealthy(provider, model) {
    return UNHEALTHY.has(`${provider}:${model}`);
}
export function getPreferredModel(provider, models) {
    for (const m of models) {
        const key = `${provider}:${m}`;
        if (!UNHEALTHY.has(key) && !WEAK_FOR_TOOLS.has(key))
            return m;
    }
    return models[0] || '';
}
export function resetHealth() {
    WEAK_FOR_TOOLS.clear();
    UNHEALTHY.clear();
}
//# sourceMappingURL=model-health.js.map