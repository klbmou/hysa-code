import type { ToolCall } from './types.js';
export declare function isProtectedFilePath(filePath: string): boolean;
export declare const PROTECTED_FILE_MESSAGE = "Blocked: HYSA will not edit .env or secret files.";
export declare function normalizeToolParams(params: Record<string, string>): Record<string, string>;
export declare function parseToolCalls(content: string): ToolCall[];
export declare function findToolCallErrors(content: string): string[];
export interface ParseResult {
    calls: ToolCall[];
    errors: string[];
}
export declare function parseToolCallsSafe(content: string): ParseResult;
export declare function stripToolCallBlocks(content: string): string;
export declare function hasToolSyntax(content: string): boolean;
export declare function containsOnlyToolSyntax(content: string): boolean;
//# sourceMappingURL=tools.d.ts.map