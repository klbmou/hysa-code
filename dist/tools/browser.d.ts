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
//# sourceMappingURL=browser.d.ts.map