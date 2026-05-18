import { normalizeApiKey } from '../config/keys.js';
function isFreeModel(model) {
    const prompt = parseFloat(model.pricing.prompt);
    const completion = parseFloat(model.pricing.completion);
    if (prompt === 0 && completion === 0)
        return true;
    if (model.id.includes(':free') || model.name.toLowerCase().includes('(free)'))
        return true;
    return false;
}
function parseFloat(val) {
    const n = Number(val);
    return isNaN(n) ? Infinity : n;
}
export async function fetchOpenRouterModels(apiKey) {
    const cleaned = normalizeApiKey(apiKey);
    const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
            'Authorization': `Bearer ${cleaned}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/hysa-code',
            'X-Title': 'HYSA Code',
        },
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        if (res.status === 401)
            throw new Error('Invalid OpenRouter API key');
        throw new Error(`OpenRouter API returned status ${res.status}`);
    }
    const data = (await res.json());
    return data.data || [];
}
export function filterFreeModels(models) {
    return models.filter(isFreeModel);
}
export function formatModelsTable(models, freeOnly = false) {
    const filtered = freeOnly ? filterFreeModels(models) : models;
    if (filtered.length === 0)
        return 'No models found.';
    const rows = [];
    rows.push(`  ${'Model ID'.padEnd(45)} ${'Name'.padEnd(35)} ${'Context'.padEnd(10)} Notes`);
    rows.push(`  ${'─'.repeat(100)}`);
    for (const m of filtered) {
        const freeTag = isFreeModel(m) ? ' 💰Free' : '';
        rows.push(`  ${m.id.padEnd(45)} ${m.name.slice(0, 34).padEnd(35)} ${String(m.contextLength).padEnd(10)}${freeTag}`);
    }
    return rows.join('\n');
}
//# sourceMappingURL=openrouter-models.js.map