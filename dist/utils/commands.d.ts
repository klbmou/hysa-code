export type CommandSafety = 'safe' | 'dangerous' | 'caution' | 'unknown';
export declare function classifyCommand(command: string): CommandSafety;
export declare function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T>;
export declare function formatCommandOutput(stdout: string, maxLines?: number): string;
//# sourceMappingURL=commands.d.ts.map