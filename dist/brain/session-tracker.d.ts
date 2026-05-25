export type SessionEventKind = 'command_run' | 'file_read' | 'file_edited' | 'tool_used' | 'error_encountered' | 'auto_fix' | 'provider_fallback' | 'memory_injected' | 'build_result' | 'test_result' | 'session_started' | 'session_ended';
export type SessionEvent = {
    kind: SessionEventKind;
    timestamp: string;
    detail: string;
};
export type SessionState = {
    id: string;
    startedAt: string;
    endedAt?: string;
    events: SessionEvent[];
    commandsRun: string[];
    filesRead: string[];
    filesEdited: string[];
    toolsUsed: string[];
    errorsEncountered: string[];
    autoFixAttempts: number;
    providerFallbacks: number;
    memoriesInjected: number;
    finalStatus: 'success' | 'partial' | 'failure' | 'running';
};
export type SessionSummary = {
    sessionId: string;
    startedAt: string;
    duration: string;
    commandsRun: string[];
    filesChanged: string[];
    decisionsMade: string[];
    lessonsLearned: string[];
    unresolvedIssues: string[];
    autoFixAttempts: number;
    providerFallbacks: number;
    memoriesSaved: number;
    testsBuildStatus: string;
    finalStatus: string;
    charCount: number;
};
declare function loadSession(): Promise<SessionState | null>;
export { loadSession };
export declare function isTrivialSession(state: SessionState): boolean;
export declare function getOrCreateSession(): Promise<SessionState>;
export declare function recordEvent(kind: SessionEventKind, detail: string): Promise<void>;
export declare function endSession(status: 'success' | 'partial' | 'failure'): Promise<SessionState>;
export declare function generateSummary(): Promise<SessionSummary>;
export declare function formatSummaryForChat(): Promise<string>;
export declare function saveSessionToBrain(): Promise<{
    saved: number;
    skipped: boolean;
    reason?: string;
}>;
export declare function clearSession(): Promise<void>;
//# sourceMappingURL=session-tracker.d.ts.map