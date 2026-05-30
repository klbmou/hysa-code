import type { HysaConfig } from '../config/keys.js';
export declare const DEFAULT_NINEROUTER_ROOT_URL = "http://localhost:20128";
export declare const DEFAULT_NINEROUTER_CHAT_MODEL = "oc/deepseek-v4-flash-free";
export type NinerouterProbeStatus = 'usable' | 'rate_limited' | 'missing_credentials' | 'invalid_model' | 'unavailable' | 'unknown_error';
export interface NinerouterDiscovery {
    available: boolean;
    rootUrl: string;
    apiBaseUrl: string;
    models: string[];
    visionModels: string[];
    chatModel: string;
    visionModel?: string;
    promotedVisionModels?: string[];
    visionPromotionReason?: string;
    autoHealthChecked: boolean;
    reason?: string;
}
export interface NinerouterErrorDetails {
    httpStatus?: number;
    errorType?: string;
    errorMessage?: string;
    upstreamProvider?: string;
    rawBody?: string;
}
export interface NinerouterProbeResult extends NinerouterErrorDetails {
    model: string;
    usable: boolean;
    status: NinerouterProbeStatus;
    reason: string;
    latencyMs: number;
}
export declare function normalizeNinerouterRootUrl(raw?: string): string;
export declare function toNinerouterApiBaseUrl(rootOrApiUrl?: string): string;
export declare function getPreferredNinerouterChatModel(config: HysaConfig): string;
export declare function getPreferredNinerouterVisionModel(config: HysaConfig): string | undefined;
export declare function getNinerouterCandidateRoots(config: HysaConfig): string[];
export declare function discoverNinerouter(config: HysaConfig, options?: {
    includeVision?: boolean;
    timeoutMs?: number;
    force?: boolean;
}): Promise<NinerouterDiscovery>;
export declare function hydrateNinerouterConfig(config: HysaConfig, options?: {
    includeVision?: boolean;
    timeoutMs?: number;
    force?: boolean;
}): Promise<NinerouterDiscovery | null>;
export declare function clearNinerouterDiscoveryCache(): void;
export declare function orderNinerouterChatModels(models: string[], preferred?: string): string[];
export declare function isUsableNinerouterChatModel(model: string): boolean;
export declare function getNinerouterPromotableVisionChatModels(models: string[]): string[];
export declare function extractNinerouterErrorDetails(error: unknown): NinerouterErrorDetails;
export declare function classifyNinerouterFailure(errorOrDetails: unknown): NinerouterProbeStatus;
export declare function ninerouterProbeStatusToErrorCategory(status: NinerouterProbeStatus): 'rate_limit' | 'invalid_key' | 'model_unavailable' | 'network' | 'unknown';
export declare function probe9RouterModel(config: HysaConfig, model: string, options?: {
    timeoutMs?: number;
}): Promise<NinerouterProbeResult>;
//# sourceMappingURL=ninerouter.d.ts.map