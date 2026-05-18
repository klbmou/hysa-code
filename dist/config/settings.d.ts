import type { HysaConfig } from './keys.js';
export type { HysaConfig, ProviderType } from './keys.js';
export declare function getSettings(): HysaConfig | null;
export declare function updateSettings(partial: Partial<HysaConfig>): HysaConfig;
export declare function updateAgentMode(mode: 'chat' | 'builder' | 'debug' | 'refactor' | 'autonomous'): void;
//# sourceMappingURL=settings.d.ts.map