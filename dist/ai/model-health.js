import { saveProviderHealth } from '../utils/session.js';
const healthStore = new Map();
const requestSkipped = new Set();
let lastError = null;
let lastFallbackUsed = null;
const fallbackEvents = [];
function key(provider, model) {
    return `${provider}:${model}`;
}
export function markHealth(provider, model, status, reason, category = 'unknown', responseTimeMs) {
    const k = key(provider, model);
    const existing = healthStore.get(k);
    if (status === 'unhealthy') {
        const failedCount = (existing?.failedCount ?? 0) + 1;
        const entry = {
            status: 'unhealthy',
            reason: category === 'rate_limit' ? `${reason} (Rate limit may be RPM/TPM/daily-quota based, not context tokens)` : reason,
            category,
            timestamp: Date.now(),
            failedCount,
            lastSuccessTime: existing?.lastSuccessTime,
            lastFailureTime: Date.now(),
            failureReason: reason,
            rateLimited: category === 'rate_limit',
            timedOut: category === 'timeout',
            averageResponseTimeMs: existing?.averageResponseTimeMs,
            requestCount: existing?.requestCount ?? 0,
            totalResponseTimeMs: existing?.totalResponseTimeMs ?? 0,
        };
        healthStore.set(k, entry);
        requestSkipped.add(k);
        lastError = { provider, model, category, reason, timestamp: Date.now() };
        if (failedCount >= 2) {
            healthStore.set(k, {
                ...entry,
                reason: `${reason} (failed ${failedCount} times, auto-skipped for rest of session)`,
            });
        }
    }
    else {
        const requestCount = (existing?.requestCount ?? 0) + 1;
        const totalResponseTimeMs = (existing?.totalResponseTimeMs ?? 0) + (responseTimeMs ?? 0);
        const averageResponseTimeMs = requestCount > 0 ? totalResponseTimeMs / requestCount : undefined;
        healthStore.set(k, {
            status: 'healthy',
            reason: '',
            category: 'unknown',
            timestamp: Date.now(),
            failedCount: 0,
            lastSuccessTime: Date.now(),
            lastFailureTime: existing?.lastFailureTime,
            failureReason: undefined,
            rateLimited: false,
            timedOut: false,
            averageResponseTimeMs,
            requestCount,
            totalResponseTimeMs,
        });
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
export function getHealthForProvider(provider) {
    for (const [k, rec] of healthStore) {
        const sep = k.lastIndexOf(':');
        const p = k.substring(0, sep);
        if (p === provider)
            return rec;
    }
    return null;
}
export function getHealthSummary(provider, model) {
    const lines = ['=== Provider Health Summary ==='];
    for (const [k, rec] of healthStore) {
        if (provider) {
            const sep = k.lastIndexOf(':');
            const p = k.substring(0, sep);
            if (p !== provider)
                continue;
        }
        if (model && !k.endsWith(`:${model}`))
            continue;
        const status = rec.status;
        const fails = rec.failedCount;
        const requests = rec.requestCount;
        const avg = rec.averageResponseTimeMs !== undefined ? `${rec.averageResponseTimeMs.toFixed(0)}ms` : 'N/A';
        const lastSuccess = rec.lastSuccessTime ? new Date(rec.lastSuccessTime).toLocaleTimeString() : 'never';
        const lastFailure = rec.lastFailureTime ? new Date(rec.lastFailureTime).toLocaleTimeString() : 'never';
        lines.push(`  ${k}`);
        lines.push(`    Status: ${status}`);
        lines.push(`    Requests: ${requests}`);
        lines.push(`    Consecutive failures: ${fails}`);
        lines.push(`    Avg response time: ${avg}`);
        lines.push(`    Last success: ${lastSuccess}`);
        lines.push(`    Last failure: ${lastFailure}`);
        if (rec.rateLimited)
            lines.push(`    Rate limited: yes`);
        if (rec.timedOut)
            lines.push(`    Timed out: yes`);
        if (rec.status === 'unhealthy' && rec.reason)
            lines.push(`    Reason: ${rec.reason}`);
    }
    if (lines.length === 1) {
        lines.push('  No health records found.');
    }
    return lines.join('\n');
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
export function addFallbackEvent(provider, model, reason) {
    fallbackEvents.push({ provider, model, reason, timestamp: Date.now() });
}
export function getFallbackEvents() {
    return [...fallbackEvents];
}
export function clearFallbackEvents() {
    fallbackEvents.length = 0;
}
export function clearRequestSkips() {
    requestSkipped.clear();
}
export function resetHealth() {
    healthStore.clear();
    requestSkipped.clear();
    lastError = null;
    lastFallbackUsed = null;
    fallbackEvents.length = 0;
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
            entries.push({
                provider,
                model,
                reason: rec.reason,
                category: rec.category,
                timestamp: rec.timestamp,
                failedCount: rec.failedCount,
                lastSuccessTime: rec.lastSuccessTime,
                lastFailureTime: rec.lastFailureTime,
                failureReason: rec.failureReason,
                rateLimited: rec.rateLimited,
                timedOut: rec.timedOut,
                averageResponseTimeMs: rec.averageResponseTimeMs,
                requestCount: rec.requestCount,
                totalResponseTimeMs: rec.totalResponseTimeMs,
            });
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
            lastSuccessTime: e.lastSuccessTime,
            lastFailureTime: e.lastFailureTime,
            failureReason: e.failureReason,
            rateLimited: e.rateLimited ?? false,
            timedOut: e.timedOut ?? false,
            averageResponseTimeMs: e.averageResponseTimeMs,
            requestCount: e.requestCount ?? 0,
            totalResponseTimeMs: e.totalResponseTimeMs ?? 0,
        });
    }
}
export { key as healthKey };
//# sourceMappingURL=model-health.js.map