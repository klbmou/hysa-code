export interface SessionEdit {
    file: string;
    timestamp: string;
    summary: string;
}
export interface SessionData {
    recentTasks: string[];
    recentFiles: string[];
    recentEdits: SessionEdit[];
    lastDirectory: string;
    sessionCount: number;
    yolo?: boolean;
}
export declare function loadSession(): SessionData;
export declare function saveSession(session: SessionData): void;
export declare function addTask(task: string): void;
export declare function addRecentFile(file: string): void;
export declare function addEdit(edit: SessionEdit): void;
export declare function incrementSessionCount(): number;
export declare function getYolo(): boolean;
export declare function setYolo(enabled: boolean): void;
//# sourceMappingURL=session.d.ts.map