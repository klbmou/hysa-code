export class RateLimiter {
    config;
    buckets = new Map();
    constructor(config) {
        this.config = config;
    }
    check(key) {
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
    clear() {
        this.buckets.clear();
    }
}
//# sourceMappingURL=rate-limiter.js.map