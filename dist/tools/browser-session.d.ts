export type BrowserSessionMeta = {
    pid: number;
    port: number;
    startedAt: string;
    url?: string;
    title?: string;
    headless: boolean;
};
export declare function loadSession(): BrowserSessionMeta | null;
export declare function saveSession(meta: BrowserSessionMeta): void;
export declare function clearSession(): void;
export declare function isDaemonAlive(port: number, timeoutMs?: number): Promise<boolean>;
export declare function isProcessAlive(pid: number): boolean;
export declare function getValidSession(): Promise<BrowserSessionMeta | null>;
//# sourceMappingURL=browser-session.d.ts.map