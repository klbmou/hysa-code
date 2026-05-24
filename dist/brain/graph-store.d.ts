import type { ExperienceGraph, ExperienceGraphNode, ExperienceGraphEdge } from './graph-types.js';
export declare function readExperienceGraph(): Promise<ExperienceGraph>;
export declare function writeExperienceGraph(graph: ExperienceGraph): Promise<void>;
export declare function upsertNode(node: Omit<ExperienceGraphNode, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
}): Promise<ExperienceGraphNode>;
export declare function addEdge(edge: Omit<ExperienceGraphEdge, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
}): Promise<ExperienceGraphEdge | null>;
export declare function linkEventToFiles(eventId: string, files: string[]): Promise<void>;
export declare function linkBugFix(bugTitle: string, fixTitle: string, files: string[], tests: string[]): Promise<void>;
export declare function compactGraph(maxNodes?: number): Promise<{
    removedNodes: number;
    removedEdges: number;
}>;
export declare function searchGraph(query: string): Promise<{
    nodes: ExperienceGraphNode[];
    edges: ExperienceGraphEdge[];
}>;
export declare function getGraphStats(): Promise<{
    nodeCount: number;
    edgeCount: number;
    topKinds: {
        kind: string;
        count: number;
    }[];
    updatedAt: string;
}>;
export declare function logProviderSuccess(provider: string, model: string): Promise<void>;
export declare function logProviderFailure(provider: string, model: string, reason: string): Promise<void>;
export declare function logTestPassed(testName: string): Promise<void>;
export declare function logLesson(title: string, summary: string): Promise<void>;
export declare function logDecision(title: string, summary: string): Promise<void>;
export declare function experienceGraphExists(): Promise<boolean>;
//# sourceMappingURL=graph-store.d.ts.map