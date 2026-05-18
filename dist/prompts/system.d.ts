import type { AgentMode } from '../agent/types.js';
export declare function buildSystemPrompt(projectInfo?: {
    type: string;
    entryPoints: string[];
    configFiles: string[];
    fileCount: number;
    tree?: string;
}, agentMode?: AgentMode): string;
export declare const SYSTEM_PROMPT: string;
//# sourceMappingURL=system.d.ts.map