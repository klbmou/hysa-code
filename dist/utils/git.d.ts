export interface GitInfo {
    isRepo: boolean;
    branch: string | null;
    hasChanges: boolean;
    lastCommitMessage: string | null;
    remoteUrl: string | null;
}
export declare function getGitInfo(rootDir: string): GitInfo;
export declare function getCommitSuggestion(rootDir: string): string;
//# sourceMappingURL=git.d.ts.map