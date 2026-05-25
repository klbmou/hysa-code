export type GraphNodeKind = 'event' | 'file' | 'command' | 'provider' | 'model' | 'test' | 'bug' | 'fix' | 'lesson' | 'decision' | 'skill';
export type GraphEdgeKind = 'caused' | 'fixed_by' | 'verified_by' | 'touched' | 'used' | 'failed_on' | 'succeeded_on' | 'created' | 'updated' | 'related_to' | 'led_to';
export type MemorySource = 'user' | 'auto-fix' | 'provider' | 'command' | 'manual';
export type ExperienceGraphNode = {
    id: string;
    kind: GraphNodeKind;
    label: string;
    summary?: string;
    createdAt: string;
    updatedAt?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    importance?: number;
    confidence?: number;
    source?: MemorySource;
    lastAccessedAt?: string;
    pinned?: boolean;
};
export type ExperienceGraphEdge = {
    id: string;
    from: string;
    to: string;
    kind: GraphEdgeKind;
    createdAt: string;
    summary?: string;
    metadata?: Record<string, unknown>;
};
export type ExperienceGraph = {
    version: number;
    updatedAt: string;
    nodes: ExperienceGraphNode[];
    edges: ExperienceGraphEdge[];
};
export type CleanupAction = {
    action: 'prune' | 'archive' | 'keep' | 'merge' | 'forget';
    nodeId: string;
    label: string;
    kind: string;
    reason: string;
};
export type CleanupResult = {
    actions: CleanupAction[];
    removedNodes: number;
    archivedNodes: number;
    mergedNodes: number;
    forgottenNodes: number;
    pinnedSkipped: number;
};
//# sourceMappingURL=graph-types.d.ts.map