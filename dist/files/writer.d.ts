export declare function isPathTraversal(filePath: string, projectRoot: string): boolean;
export declare function normalizePath(filePath: string): string;
export interface DiffSummary {
    additions: number;
    deletions: number;
    hunks: number;
}
export declare function summarizeDiff(diff: string): DiffSummary;
export declare function generateDiff(original: string, modified: string, filePath: string): string;
export declare function writeFileWithBackup(filePath: string, content: string): void;
export declare function previewEdit(filePath: string, newContent: string): string | null;
//# sourceMappingURL=writer.d.ts.map