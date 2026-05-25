import type { MemorySource } from '../brain/graph-types.js';
export declare function writeMemory(kind: 'lesson' | 'decision', title: string, summary: string, tags?: string[], files?: string[], source?: MemorySource): Promise<void>;
export declare function writeAutoFixMemory(fixResult: {
    fixed: boolean;
    errorType: string;
    filesTouched: string[];
    newResult?: string;
}, userRequest: string): Promise<void>;
export declare function classifyMemoryText(text: string): {
    kind: 'lesson' | 'decision' | null;
    content: string;
};
export declare function writeMemoryFromText(text: string): Promise<{
    kind: string;
    title: string;
} | null>;
export declare function writeProviderEvent(provider: string, model: string, status: 'success' | 'failure', reason?: string): Promise<void>;
export declare function containsMemoryTrigger(text: string): boolean;
//# sourceMappingURL=memory-writer.d.ts.map