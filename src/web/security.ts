import type { Request, Response, NextFunction } from 'express';
import { isIP } from 'node:net';

export function createPublicAccessGuard(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const apiKey = process.env.HYSA_PUBLIC_API_KEY;
    if (!apiKey) return next();
    const clientIp = getClientIP(req);
    if (isPrivateIp(clientIp)) return next();
    const provided = (req.headers['x-api-key'] as string) || (req.query.api_key as string) || '';
    if (provided === apiKey) return next();
    res.status(401).json({ error: 'PUBLIC_ACCESS_KEY_REQUIRED', message: 'Set HYSA_PUBLIC_API_KEY or access from a private network.' });
  };
}

function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '::ffff:127.0.0.1') return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const p = v4.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
  }
  return false;
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

export function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    const ip = forwarded.split(',')[0].trim();
    if (ip) return ip;
  }
  if (req.ip) return req.ip;
  return req.socket?.remoteAddress || 'unknown';
}

export function createOriginGuard(options?: {
  isProduction?: boolean;
  allowedOrigins?: string;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const isProd = options?.isProduction ?? (process.env.NODE_ENV === 'production');
    const allowedRaw = options?.allowedOrigins ?? process.env.HYSA_ALLOWED_ORIGINS;

    if (!isProd || !allowedRaw) return next();

    const origin = req.headers['origin'];
    if (!origin) return next();

    const allowed = allowedRaw.split(',').map(s => s.trim());
    if (allowed.includes(origin)) return next();

    console.log(`[Security] blocked origin=${origin} reason=HYSA_ALLOWED_ORIGINS mismatch`);
    res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
  };
}

export function createEndpointBlocker(options: {
  envVar: string;
  label: string;
  isProduction?: boolean;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const isProd = options.isProduction ?? (process.env.NODE_ENV === 'production');
    if (!isProd) return next();
    if (process.env[options.envVar] === 'true') return next();

    console.log(`[Security] blocked ${options.label} endpoint=${req.originalUrl} reason=${options.envVar} not set`);
    res.status(403).json({
      error: 'ENDPOINT_DISABLED',
      message: `This endpoint is disabled in production. Set ${options.envVar}=true to enable.`,
    });
  };
}

export function rateLimitResponse(res: Response, retryAfter: number): void {
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({
    error: 'RATE_LIMITED',
    message: 'Too many requests. Please wait and try again.',
    retryAfter,
  });
}
