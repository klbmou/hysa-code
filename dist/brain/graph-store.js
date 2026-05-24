import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getBrainDir, redact } from './store.js';
const GRAPH_FILE = 'experience-graph.json';
function graphPath() {
    return join(getBrainDir(), GRAPH_FILE);
}
const EMPTY_GRAPH = {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: [],
    edges: [],
};
export async function readExperienceGraph() {
    try {
        const raw = await readFile(graphPath(), 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return { ...EMPTY_GRAPH, updatedAt: new Date().toISOString() };
    }
}
export async function writeExperienceGraph(graph) {
    const dir = getBrainDir();
    await mkdir(dir, { recursive: true });
    graph.updatedAt = new Date().toISOString();
    const redacted = redact(graph);
    await writeFile(graphPath(), JSON.stringify(redacted, null, 2), 'utf8');
}
export async function upsertNode(node) {
    const graph = await readExperienceGraph();
    const now = new Date().toISOString();
    const existingIdx = graph.nodes.findIndex(n => n.kind === node.kind && n.label === node.label);
    if (existingIdx >= 0) {
        const existing = graph.nodes[existingIdx];
        const updated = {
            ...existing,
            summary: node.summary ?? existing.summary,
            tags: node.tags ?? existing.tags,
            metadata: node.metadata ?? existing.metadata,
            updatedAt: now,
        };
        graph.nodes[existingIdx] = updated;
        await writeExperienceGraph(graph);
        return updated;
    }
    const newNode = {
        id: node.id ?? randomUUID().slice(0, 8),
        kind: node.kind,
        label: node.label,
        summary: node.summary,
        createdAt: node.createdAt ?? now,
        updatedAt: node.updatedAt,
        tags: node.tags,
        metadata: node.metadata,
    };
    graph.nodes.push(newNode);
    await writeExperienceGraph(graph);
    return newNode;
}
export async function addEdge(edge) {
    const graph = await readExperienceGraph();
    const existing = graph.edges.find(e => e.from === edge.from && e.to === edge.to && e.kind === edge.kind);
    if (existing)
        return null;
    const newEdge = {
        id: edge.id ?? randomUUID().slice(0, 8),
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        createdAt: edge.createdAt ?? new Date().toISOString(),
        summary: edge.summary,
        metadata: edge.metadata,
    };
    graph.edges.push(newEdge);
    await writeExperienceGraph(graph);
    return newEdge;
}
export async function linkEventToFiles(eventId, files) {
    for (const file of files) {
        const fileNode = await upsertNode({ kind: 'file', label: file });
        await addEdge({ from: eventId, to: fileNode.id, kind: 'touched' });
    }
}
export async function linkBugFix(bugTitle, fixTitle, files, tests) {
    const bugNode = await upsertNode({ kind: 'bug', label: bugTitle });
    const fixNode = await upsertNode({ kind: 'fix', label: fixTitle });
    await addEdge({ from: bugNode.id, to: fixNode.id, kind: 'fixed_by' });
    for (const file of files) {
        const fileNode = await upsertNode({ kind: 'file', label: file });
        await addEdge({ from: fixNode.id, to: fileNode.id, kind: 'touched' });
    }
    for (const test of tests) {
        const testNode = await upsertNode({ kind: 'test', label: test });
        await addEdge({ from: fixNode.id, to: testNode.id, kind: 'verified_by' });
    }
}
export async function compactGraph(maxNodes = 500) {
    const graph = await readExperienceGraph();
    const validNodeIds = new Set(graph.nodes.map(n => n.id));
    const beforeEdges = graph.edges.length;
    graph.edges = graph.edges.filter(e => validNodeIds.has(e.from) && validNodeIds.has(e.to));
    const removedEdges = beforeEdges - graph.edges.length;
    if (graph.nodes.length <= maxNodes) {
        await writeExperienceGraph(graph);
        return { removedNodes: 0, removedEdges };
    }
    const priority = (n) => {
        if (['lesson', 'decision', 'fix', 'bug', 'file', 'provider', 'model'].includes(n.kind))
            return 0;
        if (['test', 'skill'].includes(n.kind))
            return 1;
        return 2;
    };
    graph.nodes.sort((a, b) => priority(a) - priority(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const beforeNodes = graph.nodes.length;
    graph.nodes = graph.nodes.slice(0, maxNodes);
    const removedNodes = beforeNodes - graph.nodes.length;
    const remainingIds = new Set(graph.nodes.map(n => n.id));
    graph.edges = graph.edges.filter(e => remainingIds.has(e.from) && remainingIds.has(e.to));
    await writeExperienceGraph(graph);
    return { removedNodes, removedEdges };
}
export async function searchGraph(query) {
    const graph = await readExperienceGraph();
    const q = query.toLowerCase();
    const matchingNodes = graph.nodes.filter(n => n.label.toLowerCase().includes(q) ||
        (n.summary && n.summary.toLowerCase().includes(q)) ||
        (n.tags && n.tags.some(t => t.toLowerCase().includes(q))));
    const matchingNodeIds = new Set(matchingNodes.map(n => n.id));
    const matchingEdges = graph.edges.filter(e => matchingNodeIds.has(e.from) || matchingNodeIds.has(e.to) ||
        (e.summary && e.summary.toLowerCase().includes(q)));
    return { nodes: matchingNodes, edges: matchingEdges };
}
export async function getGraphStats() {
    const graph = await readExperienceGraph();
    const kindCount = new Map();
    for (const n of graph.nodes) {
        kindCount.set(n.kind, (kindCount.get(n.kind) ?? 0) + 1);
    }
    const topKinds = [...kindCount.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    return {
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        topKinds,
        updatedAt: graph.updatedAt,
    };
}
// ── Auto-logging helpers (Part C) ──
export async function logProviderSuccess(provider, model) {
    const provNode = await upsertNode({ kind: 'provider', label: provider });
    const modelNode = await upsertNode({ kind: 'model', label: model });
    const eventNode = await upsertNode({
        kind: 'event',
        label: `provider_succeeded:${provider}/${model}`,
        summary: `${provider}/${model} succeeded`,
        tags: [provider, model],
    });
    await addEdge({ from: eventNode.id, to: modelNode.id, kind: 'succeeded_on' });
    await addEdge({ from: eventNode.id, to: provNode.id, kind: 'succeeded_on' });
}
export async function logProviderFailure(provider, model, reason) {
    const provNode = await upsertNode({ kind: 'provider', label: provider });
    const modelNode = await upsertNode({ kind: 'model', label: model });
    const eventNode = await upsertNode({
        kind: 'event',
        label: `provider_failed:${provider}/${model}`,
        summary: `${provider}/${model} failed: ${reason}`,
        tags: [provider, model, 'failure'],
    });
    await addEdge({ from: eventNode.id, to: modelNode.id, kind: 'failed_on' });
    await addEdge({ from: eventNode.id, to: provNode.id, kind: 'failed_on' });
}
export async function logTestPassed(testName) {
    const testNode = await upsertNode({ kind: 'test', label: testName });
    const eventNode = await upsertNode({
        kind: 'event',
        label: `test_passed:${testName}`,
        summary: `Test ${testName} passed`,
        tags: [testName, 'test'],
    });
    await addEdge({ from: eventNode.id, to: testNode.id, kind: 'verified_by' });
}
export async function logLesson(title, summary) {
    await upsertNode({
        kind: 'lesson',
        label: title,
        summary,
        tags: ['lesson'],
    });
}
export async function logDecision(title, summary) {
    await upsertNode({
        kind: 'decision',
        label: title,
        summary,
        tags: ['decision'],
    });
}
export async function experienceGraphExists() {
    try {
        const raw = await readFile(graphPath(), 'utf8');
        const graph = JSON.parse(raw);
        return graph.nodes !== undefined;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=graph-store.js.map