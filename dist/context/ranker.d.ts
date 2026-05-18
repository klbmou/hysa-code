export interface RankedFile {
    path: string;
    score: number;
}
export declare function rankFiles(files: string[], query: string, topN?: number): RankedFile[];
//# sourceMappingURL=ranker.d.ts.map