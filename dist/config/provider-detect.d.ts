import type { ProviderType } from './keys.js';
import type { HysaConfig } from './keys.js';
export interface BestProviderResult {
    provider: ProviderType;
    model?: string;
    reason: string;
    openaiRouterBaseUrl?: string;
}
export declare function detectBestProvider(): Promise<BestProviderResult | null>;
export declare function buildConfigFromDetection(detected: BestProviderResult): HysaConfig;
export declare function detectedProviderLabel(detected: BestProviderResult): string;
//# sourceMappingURL=provider-detect.d.ts.map