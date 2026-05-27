export type ShellType = 'powershell' | 'cmd' | 'bash' | 'wsl';
export declare function detectShell(): ShellType;
export declare function isWindows(): boolean;
export declare function isWindowsShell(): boolean;
export declare function translateCommand(command: string): string;
export declare function shellInfo(): string;
export declare function isCommandAvailable(commandName: string): boolean;
//# sourceMappingURL=shell.d.ts.map