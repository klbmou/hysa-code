export type RecallIntent = 'none' | 'project_context' | 'bug_history' | 'provider_history' | 'browser_history' | 'decision_history' | 'lesson_history' | 'skill_history' | 'session_recall';
export interface ScoredMemoryDebug {
    text: string;
    titleScore: number;
    bodyScore: number;
    fuzzyScore: number;
    recencyBoost: number;
    pinnedBoost: number;
    importanceConfidenceBoost: number;
    totalScore: number;
    source: string;
}
export interface SkippedMemoryDebug {
    text: string;
    reason: string;
}
export interface RecallDebugInfo {
    query: string;
    intent: RecallIntent;
    intentDetected: boolean;
    matchedMemories?: ScoredMemoryDebug[];
    skippedMemories?: SkippedMemoryDebug[];
    cacheHit: boolean;
}
export type RecallContext = {
    intent: RecallIntent;
    summary: string;
    projectMapSummary?: string;
    recentLessons?: string[];
    recentDecisions?: string[];
    relevantGraphNodes?: string[];
    relevantGraphEdges?: string[];
    warnings?: string[];
    debugInfo?: RecallDebugInfo;
};
export declare function isMemoryQuery(message: string): boolean;
export declare function detectRecallIntent(message: string): RecallIntent;
export declare function buildRecallContext(message: string, options?: {
    maxTokens?: number;
    includeProjectMap?: boolean;
    includeGraph?: boolean;
    includeLessons?: boolean;
    includeDecisions?: boolean;
    debugMode?: boolean;
}): Promise<RecallContext | null>;
export declare function formatRecallContext(ctx: RecallContext): string;
export declare function isRecallAvailable(): Promise<boolean>;
//# sourceMappingURL=recall.d.ts.map