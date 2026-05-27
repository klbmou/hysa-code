const recallCache = new Map();
const CACHE_TTL_MS = 30_000;
export function cacheKey(message, optionsMask) {
    const kw = message.toLowerCase().split(/\s+/).filter(w => w.length > 2).sort().join(',');
    return `${kw}|${optionsMask}`;
}
export function getCached(message, optionsMask) {
    const key = cacheKey(message, optionsMask);
    const entry = recallCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
        return entry.result;
    }
    if (entry)
        recallCache.delete(key);
    return undefined;
}
export function setCached(message, optionsMask, result) {
    const key = cacheKey(message, optionsMask);
    recallCache.set(key, { result, timestamp: Date.now() });
    if (recallCache.size > 50) {
        const oldest = [...recallCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
        if (oldest)
            recallCache.delete(oldest[0]);
    }
}
export function invalidateRecallCache() {
    recallCache.clear();
}
//# sourceMappingURL=recall-cache.js.map