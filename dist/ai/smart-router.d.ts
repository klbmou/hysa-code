import type { AIClient } from './types.js';
import type { HysaConfig } from '../config/keys.js';
import type { TaskKind } from './task-classifier.js';
import type { RuntimeProviderModels } from './provider-policy.js';
export declare function createSmartRouter(config: HysaConfig, _signal?: AbortSignal): AIClient;
type RouterCandidate = {
    provider: string;
    model: string;
    label: string;
    priority: string;
};
export declare function applyTaskBasedRouting(candidates: RouterCandidate[], taskKind: TaskKind, userText: string, config: HysaConfig, _runtimeModels?: RuntimeProviderModels): RouterCandidate[];
export declare function buildAttemptPlan(candidates: RouterCandidate[], taskKind: TaskKind, maxAttempts: number): RouterCandidate[];
export {};
//# sourceMappingURL=smart-router.d.ts.map