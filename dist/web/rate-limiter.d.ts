export interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
}
export declare class RateLimiter {
    private config;
    private buckets;
    constructor(config: RateLimitConfig);
    check(key: string): {
        allowed: boolean;
        retryAfter: number;
    };
    clear(): void;
}
//# sourceMappingURL=rate-limiter.d.ts.map