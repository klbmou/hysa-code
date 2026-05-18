import { saveProviderHealth } from '../utils/session.js';
const healthStore = new Map();
const requestSkipped = new Set();
let lastError = null;
let lastFallbackUsed = null;
function key(provider, model) {
    return `${provider}:${model}`;
}
export function markHealth(provider, model, status, reason, category = 'unknown') {
    const k = key(provider, model);
    const existing = healthStore.get(k);
    if (status === 'unhealthy') {
        const failedCount = (existing?.failedCount ?? 0) + 1;
        healthStore.set(k, {
            status: 'unhealthy',
            reason: category === 'rate_limit' ? `${reason} (Rate limit may be RPM/TPM/daily-quota based, not context tokens)` : reason,
            category,
            timestamp: Date.now(),
            failedCount,
        });
        requestSkipped.add(k);
        lastError = { provider, model, category, reason, timestamp: Date.now() };
        if (failedCount >= 2) {
            healthStore.set(k, {
                status: 'unhealthy',
                reason: `${reason} (failed ${failedCount} times, auto-skipped for rest of session)`,
                category,
                timestamp: Date.now(),
                failedCount,
            });
        }
    }
    else {
        healthStore.set(k, { status: 'healthy', reason: '', category: 'unknown', timestamp: Date.now(), failedCount: 0 });
    }
    // Persist to session
    try {
        saveProviderHealth(toHealthEntries());
    }
    catch { /* session save is best-effort */ }
}
export function isUnhealthy(provider, model) {
    const rec = healthStore.get(key(provider, model));
    return rec?.status === 'unhealthy';
}
export function isSkippedForRequest(provider, model) {
    return requestSkipped.has(key(provider, model));
}
export function getHealthRecord(provider, model) {
    return healthStore.get(key(provider, model)) ?? null;
}
export function getAllHealth() {
    return new Map(healthStore);
}
export function getLastError() {
    return lastError;
}
export function getLastFallbackUsed() {
    return lastFallbackUsed;
}
export function setLastFallbackUsed(fb) {
    lastFallbackUsed = fb;
}
export function clearRequestSkips() {
    requestSkipped.clear();
}
export function resetHealth() {
    healthStore.clear();
    requestSkipped.clear();
    lastError = null;
    lastFallbackUsed = null;
    try {
        saveProviderHealth([]);
    }
    catch { /* best-effort */ }
}
export function toHealthSummary() {
    const lines = [];
    for (const [k, rec] of healthStore) {
        if (rec.status === 'unhealthy') {
            lines.push(`  ${k} — ${rec.reason} (${rec.failedCount}x, ${new Date(rec.timestamp).toLocaleTimeString()})`);
        }
    }
    return lines;
}
export function toHealthEntries() {
    const entries = [];
    for (const [k, rec] of healthStore) {
        if (rec.status === 'unhealthy') {
            const sep = k.lastIndexOf(':');
            const provider = k.substring(0, sep);
            const model = k.substring(sep + 1);
            entries.push({ provider, model, reason: rec.reason, category: rec.category, timestamp: rec.timestamp, failedCount: rec.failedCount });
        }
    }
    return entries;
}
export function loadHealthFromEntries(entries) {
    for (const e of entries) {
        const k = key(e.provider, e.model);
        healthStore.set(k, {
            status: 'unhealthy',
            reason: e.reason,
            category: e.category,
            timestamp: e.timestamp,
            failedCount: e.failedCount,
        });
    }
}
export { key as healthKey };
//# sourceMappingURL=model-health.js.map