import type { ExperienceGraphNode } from './graph-types.js';
export type TaskComplexity = 'simple' | 'code' | 'planning' | 'provider';
export interface ScoredMemoryItem {
    node: ExperienceGraphNode;
    relevanceScore: number;
    importanceScore: number;
    confidenceScore: number;
    recencyScore: number;
    totalScore: number;
    reason: string;
    charCount: number;
}
export interface SelectedContext {
    items: ScoredMemoryItem[];
    totalChars: number;
    budget: number;
    skippedCount: number;
    pinnedIncluded: number;
    debugExplanation: string;
}
export declare function detectComplexity(taskKind: string, message: string): TaskComplexity;
export interface SelectContextOptions {
    message: string;
    taskKind: string;
    maxItems?: number;
    debug?: boolean;
}
export declare function selectContext(opts: SelectContextOptions): Promise<SelectedContext>;
export declare function formatSelectedContext(selected: SelectedContext): string;
//# sourceMappingURL=context-selector.d.ts.map