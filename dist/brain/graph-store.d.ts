import type { ExperienceGraph, ExperienceGraphNode, ExperienceGraphEdge, CleanupResult } from './graph-types.js';
export declare function readExperienceGraph(): Promise<ExperienceGraph>;
export declare function writeExperienceGraph(graph: ExperienceGraph): Promise<void>;
export declare function normalizeLabel(label: string): string;
export declare function upsertNode(node: Omit<ExperienceGraphNode, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
}): Promise<ExperienceGraphNode>;
export declare function findDuplicateLabels(nodes: ExperienceGraphNode[]): {
    nodes: ExperienceGraphNode[];
    reason: string;
}[];
export declare function addEdge(edge: Omit<ExperienceGraphEdge, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
}): Promise<ExperienceGraphEdge | null>;
export declare function linkEventToFiles(eventId: string, files: string[]): Promise<void>;
export declare function linkBugFix(bugTitle: string, fixTitle: string, files: string[], tests: string[]): Promise<void>;
export declare function getInspectReport(): Promise<{
    totalNodes: number;
    totalEdges: number;
    countsByKind: {
        kind: string;
        count: number;
    }[];
    pinned: number;
    staleEvents: number;
    duplicateGroups: {
        nodes: ExperienceGraphNode[];
        reason: string;
    }[];
    lowImportanceNodes: number;
    topDecisions: ExperienceGraphNode[];
    topLessons: ExperienceGraphNode[];
    recentProviderEvents: ExperienceGraphNode[];
}>;
export declare function mergeNodes(nodeIds: string[]): Promise<ExperienceGraphNode | null>;
export declare function pinNode(query: string): Promise<ExperienceGraphNode | null>;
export declare function unpinNode(query: string): Promise<ExperienceGraphNode | null>;
export declare function forgetNodes(query: string): Promise<CleanupResult>;
export interface CleanupOptions {
    dryRun?: boolean;
    maxAgeDays?: number;
    minImportance?: number;
}
export declare function cleanupGraph(options?: CleanupOptions): Promise<CleanupResult>;
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