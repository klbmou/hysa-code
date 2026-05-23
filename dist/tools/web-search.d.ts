export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    source?: string;
}
export interface WebSearchConfig {
    provider: 'tavily' | 'serper' | 'brave' | 'ddg' | 'none';
    tavilyKey?: string;
    serperKey?: string;
    braveKey?: string;
}
export interface SearchDiagnostics {
    provider: string;
    configuredKeys: string[];
    hasTavilyKey: boolean;
    hasSerperKey: boolean;
    hasBraveKey: boolean;
    ddgAvailable: boolean;
    isReliable: boolean;
    ddgExperimental: boolean;
}
export declare function getSearchDiagnostics(): SearchDiagnostics;
export declare function isReliableProvider(): boolean;
export declare function getWebSearchConfig(): WebSearchConfig;
export declare function searchWeb(query: string, options?: {
    maxResults?: number;
}): Promise<SearchResult[]>;
export declare function formatSearchResults(query: string, results: SearchResult[]): string;
//# sourceMappingURL=web-search.d.ts.map