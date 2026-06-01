export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, RateLimitEntry>();

  constructor(private config: RateLimitConfig) {}

  check(key: string): { allowed: boolean; retryAfter: number } {
    const now = Date.now();
    const entry = this.buckets.get(key);

    if (!entry || now >= entry.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.config.windowMs });
      return { allowed: true, retryAfter: 0 };
    }

    if (entry.count >= this.config.maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }

    entry.count++;
    return { allowed: true, retryAfter: 0 };
  }

  clear(): void {
    this.buckets.clear();
  }
}
