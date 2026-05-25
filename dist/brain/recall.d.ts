export declare function isMemoryQuery(message: string): boolean;
export type RecallIntent = 'none' | 'project_context' | 'bug_history' | 'provider_history' | 'browser_history' | 'decision_history' | 'lesson_history' | 'skill_history';
export type RecallContext = {
    intent: RecallIntent;
    summary: string;
    projectMapSummary?: string;
    recentLessons?: string[];
    recentDecisions?: string[];
    relevantGraphNodes?: string[];
    relevantGraphEdges?: string[];
    warnings?: string[];
};
export declare function detectRecallIntent(message: string): RecallIntent;
export declare function buildRecallContext(message: string, options?: {
    maxTokens?: number;
    includeProjectMap?: boolean;
    includeGraph?: boolean;
    includeLessons?: boolean;
    includeDecisions?: boolean;
}): Promise<RecallContext | null>;
export declare function formatRecallContext(ctx: RecallContext): string;
export declare function isRecallAvailable(): Promise<boolean>;
//# sourceMappingURL=recall.d.ts.map