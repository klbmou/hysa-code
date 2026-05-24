export type BrowserSessionInfo = {
    active: boolean;
    url?: string;
    title?: string;
    browser?: string;
};
export declare function browserOpen(url: string, options?: {
    headless?: boolean;
    timeoutMs?: number;
}): Promise<{
    ok: boolean;
    url?: string;
    title?: string;
    message: string;
}>;
export declare function browserScreenshot(options?: {
    path?: string;
    fullPage?: boolean;
}): Promise<{
    ok: boolean;
    path?: string;
    message: string;
}>;
export declare function browserText(): Promise<{
    ok: boolean;
    text: string;
    message: string;
}>;
export declare function browserSnapshot(): Promise<{
    ok: boolean;
    snapshot: string;
    message: string;
}>;
export declare function browserClick(target: string): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function browserType(target: string, value: string): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function browserClose(): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function getBrowserStatus(): Promise<BrowserSessionInfo>;
export declare function checkPlaywrightInstalled(): Promise<boolean>;
export declare function checkChromiumInstalled(): Promise<boolean | 'unknown'>;
export declare function getBrowserConfig(): {
    headless: boolean;
    screenshotDir: string;
    timeoutMs: number;
};
export declare function cliBrowserOpen(url: string, options?: {
    headless?: boolean;
    timeoutMs?: number;
}): Promise<{
    ok: boolean;
    url?: string;
    title?: string;
    message: string;
}>;
export declare function cliBrowserStatus(): Promise<BrowserSessionInfo & {
    daemon?: boolean;
    pid?: number;
    port?: number;
}>;
export declare function cliBrowserText(): Promise<{
    ok: boolean;
    text: string;
    message: string;
}>;
export declare function cliBrowserScreenshot(options?: {
    path?: string;
    fullPage?: boolean;
}): Promise<{
    ok: boolean;
    path?: string;
    message: string;
}>;
export declare function cliBrowserSnapshot(): Promise<{
    ok: boolean;
    snapshot: string;
    message: string;
}>;
export declare function cliBrowserClick(target: string): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function cliBrowserType(target: string, value: string): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function cliBrowserClose(): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function cliBrowserCleanStale(): void;
export declare function getDaemonConfig(): {
    enabled: boolean;
};
//# sourceMappingURL=browser.d.ts.map