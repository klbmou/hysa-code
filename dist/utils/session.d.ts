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
    cooldownUntil?: number;
    cooldownReason?: string;
    averageResponseTimeMs?: number;
    requestCount?: number;
    totalResponseTimeMs?: number;
}
export interface ProviderCooldownEntry {
    provider: string;
    reason: string;
    category: string;
    timestamp: number;
    cooldownUntil: number;
    failedCount?: number;
}
export interface LastChatErrorEntry {
    provider: string;
    model: string;
    category: string;
    reason: string;
    timestamp: number;
}
export interface FallbackEventEntry {
    provider: string;
    model: string;
    reason: string;
    timestamp: number;
}
export interface ChatRuntimeState {
    lastError?: LastChatErrorEntry | null;
    lastFallbackUsed?: string | null;
    lastSuccessfulProvider?: string | null;
    lastSuccessfulModel?: string | null;
    providerCooldowns?: ProviderCooldownEntry[];
    fallbackEvents?: FallbackEventEntry[];
    updatedAt?: number;
}
export interface SessionUsage {
    lastRequestDuration?: number;
    lastRequestTimestamp?: number;
    lastRequestTokens?: number;
    lastPromptMode?: string;
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
    chatState?: ChatRuntimeState;
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
export declare function getChatRuntimeState(): ChatRuntimeState;
export declare function saveChatRuntimeState(state: ChatRuntimeState): void;
export declare function clearChatRuntimeState(): void;
export declare function saveUsage(data: SessionUsage): void;
export declare function getUsage(): SessionUsage;
export declare function recordRequest(durationMs: number, tokens?: number): void;
export declare function recordPromptMode(mode: string): void;
export declare function recordError(error: string, provider: string, model: string): void;
//# sourceMappingURL=session.d.ts.map