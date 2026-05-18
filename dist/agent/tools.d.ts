export interface SymbolInfo {
    name: string;
    type: string;
    line: number;
}
export declare function listSymbols(filePath: string): SymbolInfo[];
export declare function findReferences(rootDir: string, symbol: string): {
    file: string;
    line: number;
    content: string;
}[];
export declare function searchImports(rootDir: string, moduleName: string): {
    file: string;
    line: number;
    content: string;
}[];
export declare function summarizeFile(filePath: string): string;
export declare function explainFunction(filePath: string, functionName: string): string;
//# sourceMappingURL=tools.d.ts.map