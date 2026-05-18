export interface SearchResult {
    file: string;
    line: number;
    content: string;
}
export declare function grepSearch(rootDir: string, pattern: string, maxResults?: number): SearchResult[];
export declare function findFiles(rootDir: string, filename: string): string[];
//# sourceMappingURL=searcher.d.ts.map