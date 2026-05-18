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
}
export interface SessionData {
    recentTasks: string[];
    recentFiles: string[];
    recentEdits: SessionEdit[];
    lastDirectory: string;
    sessionCount: number;
    yolo?: boolean;
    providerHealth?: ProviderHealthEntry[];
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
//# sourceMappingURL=session.d.ts.map