import type { AgentMode } from '../agent/types.js';
import type { ProviderType } from '../config/keys.js';
export type PromptMode = 'full' | 'compact' | 'minimal' | 'auto';
export declare function resolvePromptMode(promptMode?: PromptMode, provider?: ProviderType, isSimple?: boolean): 'full' | 'compact' | 'minimal';
export declare function buildMinimalSystemPrompt(): string;
export declare function buildCompactSystemPrompt(projectInfo?: {
    type: string;
    entryPoints: string[];
    fileCount: number;
}): string;
export declare function buildSystemPrompt(projectInfo?: {
    type: string;
    entryPoints: string[];
    configFiles: string[];
    fileCount: number;
    tree?: string;
}, agentMode?: AgentMode, lightMode?: boolean, provider?: ProviderType, promptMode?: PromptMode): string;
export declare const SYSTEM_PROMPT: string;
//# sourceMappingURL=system.d.ts.map