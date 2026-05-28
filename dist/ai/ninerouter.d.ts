import type { HysaConfig } from '../config/keys.js';
export declare const DEFAULT_NINEROUTER_ROOT_URL = "http://localhost:20128";
export declare const DEFAULT_NINEROUTER_CHAT_MODEL = "oc/deepseek-v4-flash-free";
export interface NinerouterDiscovery {
    available: boolean;
    rootUrl: string;
    apiBaseUrl: string;
    models: string[];
    visionModels: string[];
    chatModel: string;
    visionModel?: string;
    autoHealthChecked: boolean;
    reason?: string;
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
//# sourceMappingURL=ninerouter.d.ts.map