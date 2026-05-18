export interface ProjectInfo {
    type: string;
    framework: string;
    entryPoints: string[];
    configFiles: string[];
    importantFiles: string[];
    fileCount: number;
    totalSize: number;
    tree: string;
    summary: string;
}
export declare function getProjectInfo(rootDir: string): ProjectInfo;
export declare function invalidateCache(): void;
export declare function buildProjectTree(rootDir: string): string;
//# sourceMappingURL=builder.d.ts.map