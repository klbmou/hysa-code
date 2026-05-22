export interface SessionEdit {
    file: string;
    timestamp: string;
    summary: string;
}
export interface ProviderHealthEntry {
    provider: string;
    model: string;
    reason: string;
    category: string;
    timestamp: number;
    failedCount: number;
    lastSuccessTime?: number;
    lastFailureTime?: number;
    failureReason?: string;
    rateLimited?: boolean;
    timedOut?: boolean;
    averageResponseTimeMs?: number;
    requestCount?: number;
    totalResponseTimeMs?: number;
}
export interface SessionUsage {
    lastRequestDuration?: number;
    lastRequestTimestamp?: number;
    lastRequestTokens?: number;
    lastError?: string;
    lastProvider?: string;
    lastModel?: string;
    totalRequests: number;
    totalErrors: number;
}
export interface SessionData {
    recentTasks: string[];
    recentFiles: string[];
    recentEdits: SessionEdit[];
    lastDirectory: string;
    sessionCount: number;
    yolo?: boolean;
    providerHealth?: ProviderHealthEntry[];
    usage?: SessionUsage;
}
export declare function loadSession(): SessionData;
export declare function saveSession(session: SessionData): void;
export declare function addTask(task: string): void;
export declare function addRecentFile(file: string): void;
export declare function addEdit(edit: SessionEdit): void;
export declare function incrementSessionCount(): number;
export declare function getYolo(): boolean;
export declare function setYolo(enabled: boolean): void;
export declare function getProviderHealth(): ProviderHealthEntry[];
export declare function saveProviderHealth(entries: ProviderHealthEntry[]): void;
export declare function clearProviderHealth(): void;
export declare function getLastProviderError(): string | null;
export declare function saveUsage(data: SessionUsage): void;
export declare function getUsage(): SessionUsage;
export declare function recordRequest(durationMs: number, tokens?: number): void;
export declare function recordError(error: string, provider: string, model: string): void;
//# sourceMappingURL=session.d.ts.map