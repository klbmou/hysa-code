import type { Request, Response, NextFunction } from 'express';
export declare function securityHeaders(_req: Request, res: Response, next: NextFunction): void;
export declare function getClientIP(req: Request): string;
export declare function createOriginGuard(options?: {
    isProduction?: boolean;
    allowedOrigins?: string;
}): (req: Request, res: Response, next: NextFunction) => void;
export declare function createEndpointBlocker(options: {
    envVar: string;
    label: string;
    isProduction?: boolean;
}): (req: Request, res: Response, next: NextFunction) => void;
export declare function rateLimitResponse(res: Response, retryAfter: number): void;
//# sourceMappingURL=security.d.ts.map