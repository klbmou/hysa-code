export declare function looksLikeHandle(s: string): boolean;
export declare function isEntityFollowUpQuery(message: string): boolean;
export declare function isEntityLookupQuery(message: string): boolean;
export declare function extractEntityName(message: string): string | null;
export declare function shouldSearchEntity(message: string, previousUserMessage?: string | null): {
    shouldSearch: boolean;
    query: string | null;
};
//# sourceMappingURL=entity-detector.d.ts.map