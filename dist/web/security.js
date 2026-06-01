export function securityHeaders(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
}
export function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
        const ip = forwarded.split(',')[0].trim();
        if (ip)
            return ip;
    }
    if (req.ip)
        return req.ip;
    return req.socket?.remoteAddress || 'unknown';
}
export function createOriginGuard(options) {
    return (req, res, next) => {
        const isProd = options?.isProduction ?? (process.env.NODE_ENV === 'production');
        const allowedRaw = options?.allowedOrigins ?? process.env.HYSA_ALLOWED_ORIGINS;
        if (!isProd || !allowedRaw)
            return next();
        const origin = req.headers['origin'];
        if (!origin)
            return next();
        const allowed = allowedRaw.split(',').map(s => s.trim());
        if (allowed.includes(origin))
            return next();
        console.log(`[Security] blocked origin=${origin} reason=HYSA_ALLOWED_ORIGINS mismatch`);
        res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
    };
}
export function createEndpointBlocker(options) {
    return (req, res, next) => {
        const isProd = options.isProduction ?? (process.env.NODE_ENV === 'production');
        if (!isProd)
            return next();
        if (process.env[options.envVar] === 'true')
            return next();
        console.log(`[Security] blocked ${options.label} endpoint=${req.originalUrl} reason=${options.envVar} not set`);
        res.status(403).json({
            error: 'ENDPOINT_DISABLED',
            message: `This endpoint is disabled in production. Set ${options.envVar}=true to enable.`,
        });
    };
}
export function rateLimitResponse(res, retryAfter) {
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests. Please wait and try again.',
        retryAfter,
    });
}
//# sourceMappingURL=security.js.map