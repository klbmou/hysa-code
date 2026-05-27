interface CacheEntry {
  result: unknown;
  timestamp: number;
}

const recallCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

export function cacheKey(message: string, optionsMask: number): string {
  const kw = message.toLowerCase().split(/\s+/).filter(w => w.length > 2).sort().join(',');
  return `${kw}|${optionsMask}`;
}

export function getCached(message: string, optionsMask: number): unknown {
  const key = cacheKey(message, optionsMask);
  const entry = recallCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.result;
  }
  if (entry) recallCache.delete(key);
  return undefined;
}

export function setCached(message: string, optionsMask: number, result: unknown): void {
  const key = cacheKey(message, optionsMask);
  recallCache.set(key, { result, timestamp: Date.now() });
  if (recallCache.size > 50) {
    const oldest = [...recallCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) recallCache.delete(oldest[0]);
  }
}

export function invalidateRecallCache(): void {
  recallCache.clear();
}
