import type { HysaConfig } from '../config/keys.js';
import type { TaskKind } from './task-classifier.js';
import type { RuntimeProviderModels } from './provider-policy.js';
export interface ModelCapability {
    provider: string;
    model: string;
    label: string;
    capabilities: TaskKind[];
    priority: 'fast' | 'balanced' | 'stronger' | 'fallback';
}
export declare function providerIsAvailable(provider: string, config: HysaConfig): boolean;
export declare function getCandidatesForTask(taskKind: TaskKind, config: HysaConfig, healthChecker: {
    isOnCooldown: (provider: string, model: string) => boolean;
    isUnhealthy: (provider: string, model: string) => boolean;
    isProviderOnCooldown?: (provider: string) => boolean;
}, runtimeModels?: RuntimeProviderModels): {
    provider: string;
    model: string;
    label: string;
    priority: string;
}[];
export declare function getSkippedProviderReasons(config: HysaConfig): {
    provider: string;
    reason: string;
}[];
//# sourceMappingURL=model-registry.d.ts.map