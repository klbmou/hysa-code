import type { AIClient, ToolCall } from '../ai/types.js';
import type { TaskKind } from '../ai/task-classifier.js';
export type ErrorCategory = 'typescript_error' | 'eslint_error' | 'test_failure' | 'missing_import' | 'syntax_error' | 'command_timeout' | 'permission_error' | 'unknown';
export interface ErrorDetails {
    category: ErrorCategory;
    filePath?: string;
    line?: number;
    column?: number;
    message: string;
    originalOutput: string;
}
export declare function isAutoFixTask(taskKind: TaskKind): boolean;
export declare function classifyError(result: string, toolType: string): ErrorDetails;
export declare function extractFileInfo(text: string): {
    filePath?: string;
    line?: number;
    column?: number;
};
export declare function isErrorResult(result: string): boolean;
export declare function isFixableError(details: ErrorDetails): boolean;
export declare function shouldAutoFix(result: string, toolType: string, taskKind: TaskKind): boolean;
export declare function attemptAutoFix(result: string, toolCall: ToolCall, client: AIClient, workingDir: string, userMessage: string, state: {
    attempts: number;
    lastErrorHash: string;
}, runCommand: (cmd: string) => {
    stdout: string;
    stderr: string;
}, debug?: boolean): Promise<{
    fixed: boolean;
    newResult?: string;
    errorType: string;
    filesTouched: string[];
    debugLog: string[];
}>;
//# sourceMappingURL=auto-fix.d.ts.map