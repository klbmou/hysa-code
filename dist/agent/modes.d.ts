import type { AgentMode } from './types.js';
export declare const ALL_MODES: AgentMode[];
export declare const MODE_LABELS: Record<AgentMode, string>;
export declare const MODE_DESCRIPTIONS: Record<AgentMode, string>;
export declare function getModePromptAddendum(mode: AgentMode, modePlan?: string): string;
//# sourceMappingURL=modes.d.ts.map