import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getBrainDir, redact } from './store.js';
import type { ExperienceGraph, ExperienceGraphNode, ExperienceGraphEdge, CleanupResult, CleanupAction, MemorySource } from './graph-types.js';

const GRAPH_FILE = 'experience-graph.json';

function graphPath(): string {
  return join(getBrainDir(), GRAPH_FILE);
}

const EMPTY_GRAPH: ExperienceGraph = {
  version: 2,
  updatedAt: new Date().toISOString(),
  nodes: [],
  edges: [],
};

export async function readExperienceGraph(): Promise<ExperienceGraph> {
  try {
    const raw = await readFile(graphPath(), 'utf8');
    return JSON.parse(raw) as ExperienceGraph;
  } catch {
    return { ...EMPTY_GRAPH, updatedAt: new Date().toISOString() };
  }
}

export async function writeExperienceGraph(graph: ExperienceGraph): Promise<void> {
  const dir = getBrainDir();
  await mkdir(dir, { recursive: true });
  graph.updatedAt = new Date().toISOString();
  const redacted = redact(graph) as ExperienceGraph;
  await writeFile(graphPath(), JSON.stringify(redacted, null, 2), 'utf8');
}

// ── Label normalization for dedup ──

export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(label: string): Set<string> {
  return new Set(normalizeLabel(label).split(/\s+/).filter(w => w.length > 2));
}

function jaccardSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 && wb.size === 0) return 1;
  const intersection = new Set([...wa].filter(w => wb.has(w)));
  const union = new Set([...wa, ...wb]);
  return intersection.size / union.size;
}

// ── Quality-scored upsertNode ──

export async function upsertNode(node: Omit<ExperienceGraphNode, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<ExperienceGraphNode> {
  const graph = await readExperienceGraph();
  const now = new Date().toISOString();

  // First try exact match (kind + label)
  let existingIdx = graph.nodes.findIndex(n => n.kind === node.kind && n.label === node.label);

  // If no exact match on label, try fuzzy (for lessons/decisions)
  if (existingIdx < 0 && (node.kind === 'lesson' || node.kind === 'decision')) {
    const similar = findFuzzyMatch(graph.nodes, node.kind, node.label, node.summary);
    if (similar) existingIdx = graph.nodes.findIndex(n => n.id === similar.id);
  }

  if (existingIdx >= 0) {
    const existing = graph.nodes[existingIdx];
    const updated: ExperienceGraphNode = {
      ...existing,
      label: existing.label,
      summary: pickBestSummary(existing, node),
      tags: node.tags ? [...new Set([...(existing.tags || []), ...node.tags])] : existing.tags,
      metadata: node.metadata ? { ...(existing.metadata || {}), ...node.metadata } : existing.metadata,
      updatedAt: now,
      lastAccessedAt: now,
      importance: pickHighest(existing.importance, node.importance),
      confidence: pickHighest(existing.confidence, node.confidence),
      source: node.source ?? existing.source,
      pinned: existing.pinned ?? node.pinned,
    };
    graph.nodes[existingIdx] = updated;
    await writeExperienceGraph(graph);
    return updated;
  }

  const newNode: ExperienceGraphNode = {
    id: node.id ?? randomUUID().slice(0, 8),
    kind: node.kind,
    label: node.label,
    summary: node.summary,
    createdAt: node.createdAt ?? now,
    updatedAt: node.updatedAt ?? now,
    lastAccessedAt: now,
    tags: node.tags,
    metadata: node.metadata,
    importance: node.importance,
    confidence: node.confidence,
    source: node.source,
    pinned: node.pinned,
  };
  graph.nodes.push(newNode);
  await writeExperienceGraph(graph);
  return newNode;
}

function pickBestSummary(existing: ExperienceGraphNode, incoming: Omit<ExperienceGraphNode, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): string | undefined {
  // Keep the longer, non-redacted summary
  const a = existing.summary || '';
  const b = incoming.summary || '';
  if (!a) return b || undefined;
  if (!b) return a || undefined;
  if (a === '[REDACTED]' && b !== '[REDACTED]') return b;
  if (b === '[REDACTED]' && a !== '[REDACTED]') return a;
  return a.length >= b.length ? a : b;
}

function pickHighest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

// ── Fuzzy dedup helpers ──

function findFuzzyMatch(nodes: ExperienceGraphNode[], kind: string, label: string, summary?: string): ExperienceGraphNode | null {
  const normalized = normalizeLabel(label);
  const sumWords = summary ? normalizeLabel(summary) : '';

  let best: ExperienceGraphNode | null = null;
  let bestScore = 0;

  for (const n of nodes) {
    if (n.kind !== kind) continue;
    const labelScore = jaccardSimilarity(normalized, normalizeLabel(n.label));
    let sumScore = 0;
    if (sumWords && n.summary) {
      sumScore = jaccardSimilarity(sumWords, normalizeLabel(n.summary));
    }
    const score = Math.max(labelScore, sumScore);
    if (score > 0.4 && score > bestScore) {
      best = n;
      bestScore = score;
    }
  }

  return best;
}

export function findDuplicateLabels(nodes: ExperienceGraphNode[]): { nodes: ExperienceGraphNode[]; reason: string }[] {
  const groups: { nodes: ExperienceGraphNode[]; reason: string }[] = [];
  const visited = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    if (visited.has(nodes[i].id)) continue;
    const group: ExperienceGraphNode[] = [nodes[i]];
    visited.add(nodes[i].id);

    for (let j = i + 1; j < nodes.length; j++) {
      if (visited.has(nodes[j].id)) continue;
      if (nodes[i].kind !== nodes[j].kind) continue;

      const sim = jaccardSimilarity(normalizeLabel(nodes[i].label), normalizeLabel(nodes[j].label));
      if (sim > 0.4) {
        group.push(nodes[j]);
        visited.add(nodes[j].id);
      }
    }

    if (group.length > 1) {
      groups.push({ nodes: group, reason: `~${Math.round(jaccardSimilarity(normalizeLabel(group[0].label), normalizeLabel(group[1].label)) * 100)}% similar` });
    }
  }

  return groups;
}

// ── addEdge ──

export async function addEdge(edge: Omit<ExperienceGraphEdge, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<ExperienceGraphEdge | null> {
  const graph = await readExperienceGraph();

  const existing = graph.edges.find(e => e.from === edge.from && e.to === edge.to && e.kind === edge.kind);
  if (existing) return null;

  const newEdge: ExperienceGraphEdge = {
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

export async function linkEventToFiles(eventId: string, files: string[]): Promise<void> {
  for (const file of files) {
    const fileNode = await upsertNode({ kind: 'file', label: file });
    await addEdge({ from: eventId, to: fileNode.id, kind: 'touched' });
  }
}

export async function linkBugFix(bugTitle: string, fixTitle: string, files: string[], tests: string[]): Promise<void> {
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

// ── Inspect ──

export async function getInspectReport(): Promise<{
  totalNodes: number;
  totalEdges: number;
  countsByKind: { kind: string; count: number }[];
  pinned: number;
  staleEvents: number;
  duplicateGroups: { nodes: ExperienceGraphNode[]; reason: string }[];
  lowImportanceNodes: number;
  topDecisions: ExperienceGraphNode[];
  topLessons: ExperienceGraphNode[];
  recentProviderEvents: ExperienceGraphNode[];
}> {
  const graph = await readExperienceGraph();
  const now = Date.now();
  const DAY_MS = 86_400_000;

  const kindCount = new Map<string, number>();
  for (const n of graph.nodes) {
    kindCount.set(n.kind, (kindCount.get(n.kind) ?? 0) + 1);
  }
  const countsByKind = [...kindCount.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  const pinned = graph.nodes.filter(n => n.pinned).length;

  const staleEvents = graph.nodes.filter(n => {
    if (n.kind !== 'event') return false;
    const age = now - new Date(n.createdAt).getTime();
    return age > 30 * DAY_MS;
  }).length;

  const duplicateGroups = findDuplicateLabels(graph.nodes);

  const lowImportanceNodes = graph.nodes.filter(n =>
    n.importance !== undefined && n.importance < 30
  ).length;

  const topDecisions = graph.nodes
    .filter(n => n.kind === 'decision')
    .sort((a, b) => (b.importance || 50) - (a.importance || 50))
    .slice(0, 10);

  const topLessons = graph.nodes
    .filter(n => n.kind === 'lesson')
    .sort((a, b) => (b.importance || 50) - (a.importance || 50))
    .slice(0, 10);

  const recentProviderEvents = graph.nodes
    .filter(n => n.kind === 'event' && (n.label.includes('provider') || n.tags?.some(t => t === 'failure' || t === 'provider')))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 15);

  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    countsByKind,
    pinned,
    staleEvents,
    duplicateGroups,
    lowImportanceNodes,
    topDecisions,
    topLessons,
    recentProviderEvents,
  };
}

// ── Merge nodes ──

export async function mergeNodes(nodeIds: string[]): Promise<ExperienceGraphNode | null> {
  const graph = await readExperienceGraph();
  const nodes = nodeIds.map(id => graph.nodes.find(n => n.id === id)).filter(Boolean) as ExperienceGraphNode[];

  if (nodes.length < 2) return null;

  // Sort by confidence (highest first), then by importance
  nodes.sort((a, b) => (b.confidence || 50) - (a.confidence || 50) || (b.importance || 50) - (a.importance || 50));

  const primary = nodes[0];
  const rest = nodes.slice(1);
  const restIds = new Set(rest.map(n => n.id));

  // Merge summaries
  const summaries = [primary.summary, ...rest.map(n => n.summary)].filter(Boolean) as string[];
  const mergedSummary = summaries
    .filter(s => s !== '[REDACTED]')
    .sort((a, b) => b.length - a.length)[0] || summaries[0];

  // Merge tags
  const allTags = [...new Set(nodes.flatMap(n => n.tags || []))];

  // Keep highest confidence / importance
  const merged = await upsertNode({
    id: primary.id,
    kind: primary.kind,
    label: primary.label,
    summary: mergedSummary,
    tags: allTags,
    confidence: Math.max(...nodes.map(n => n.confidence || 50)),
    importance: Math.max(...nodes.map(n => n.importance || 50)),
    source: primary.source,
    pinned: nodes.some(n => n.pinned),
    metadata: Object.assign({}, ...nodes.map(n => n.metadata || {})),
  });

  // Remove the rest
  graph.nodes = graph.nodes.filter(n => !restIds.has(n.id));
  graph.edges = graph.edges.filter(e => !restIds.has(e.from) && !restIds.has(e.to));

  // Reconnect edges to primary
  const allEdges = graph.edges;
  for (const edge of allEdges) {
    if (restIds.has(edge.from)) edge.from = primary.id;
    if (restIds.has(edge.to)) edge.to = primary.id;
  }
  // Dedup edges
  graph.edges = allEdges.filter((e, i, self) => i === self.findIndex(e2 => e2.from === e.from && e2.to === e.to && e2.kind === e.kind));

  await writeExperienceGraph(graph);
  return merged;
}

// ── Pin / unpin ──

export async function pinNode(query: string): Promise<ExperienceGraphNode | null> {
  const result = await searchGraph(query);
  if (result.nodes.length === 0) return null;

  // Pin the best match
  const target = result.nodes.reduce((a, b) => {
    const aScore = jaccardSimilarity(query, a.label);
    const bScore = jaccardSimilarity(query, b.label);
    return bScore > aScore ? b : a;
  });

  return await upsertNode({
    id: target.id,
    kind: target.kind,
    label: target.label,
    pinned: true,
    importance: Math.max(target.importance || 50, 80),
  });
}

export async function unpinNode(query: string): Promise<ExperienceGraphNode | null> {
  const result = await searchGraph(query);
  if (result.nodes.length === 0) return null;

  const target = result.nodes.reduce((a, b) => {
    const aScore = jaccardSimilarity(query, a.label);
    const bScore = jaccardSimilarity(query, b.label);
    return bScore > aScore ? b : a;
  });

  return await upsertNode({
    id: target.id,
    kind: target.kind,
    label: target.label,
    pinned: false,
  });
}

// ── Forget (remove nodes) ──

export async function forgetNodes(query: string): Promise<CleanupResult> {
  const graph = await readExperienceGraph();
  const result = await searchGraph(query);
  const actions: CleanupAction[] = [];
  let forgottenNodes = 0;
  let pinnedSkipped = 0;

  const toRemove = new Set<string>();
  for (const n of result.nodes) {
    if (n.pinned) {
      actions.push({ action: 'keep', nodeId: n.id, label: n.label, kind: n.kind, reason: 'pinned — skipped' });
      pinnedSkipped++;
      continue;
    }
    toRemove.add(n.id);
    actions.push({ action: 'forget', nodeId: n.id, label: n.label, kind: n.kind, reason: `matched query: "${query}"` });
    forgottenNodes++;
  }

  graph.nodes = graph.nodes.filter(n => !toRemove.has(n.id));
  graph.edges = graph.edges.filter(e => !toRemove.has(e.from) && !toRemove.has(e.to));

  await writeExperienceGraph(graph);

  return { actions, removedNodes: 0, archivedNodes: 0, mergedNodes: 0, forgottenNodes, pinnedSkipped };
}

// ── Cleanup — prune stale / low-value memories ──

export interface CleanupOptions {
  dryRun?: boolean;
  maxAgeDays?: number;
  minImportance?: number;
}

export async function cleanupGraph(options: CleanupOptions = {}): Promise<CleanupResult> {
  const {
    dryRun = true,
    maxAgeDays = 30,
    minImportance = 30,
  } = options;

  const graph = await readExperienceGraph();
  const now = Date.now();
  const DAY_MS = 86_400_000;
  const actions: CleanupAction[] = [];
  let removedNodes = 0;
  let archivedNodes = 0;
  let mergedNodes = 0;
  let pinnedSkipped = 0;

  const toRemove = new Set<string>();
  const archived = new Set<string>();

  // ── Phase 1: Prune low-value events ──
  for (const n of graph.nodes) {
    if (n.pinned) {
      pinnedSkipped++;
      continue;
    }
    // Never prune decisions or lessons automatically
    if (n.kind === 'decision' || n.kind === 'lesson') continue;

    const age = now - new Date(n.createdAt).getTime();
    const imp = n.importance ?? 50;

    if (n.kind === 'event' && age > maxAgeDays * DAY_MS && imp < minImportance) {
      if (dryRun) {
        actions.push({ action: 'prune', nodeId: n.id, label: n.label, kind: n.kind, reason: `event >${maxAgeDays}d, importance=${imp}` });
      } else {
        toRemove.add(n.id);
        actions.push({ action: 'prune', nodeId: n.id, label: n.label, kind: n.kind, reason: `pruned: event >${maxAgeDays}d, importance=${imp}` });
        removedNodes++;
      }
    }
  }

  // ── Phase 2: Archive but don't delete provider success events that are very old ──
  for (const n of graph.nodes) {
    if (n.pinned || toRemove.has(n.id)) continue;
    if (n.kind !== 'event') continue;
    if (!n.label.startsWith('provider_succeeded')) continue;

    const age = now - new Date(n.createdAt).getTime();
    if (age > maxAgeDays * DAY_MS) {
      if (!dryRun) {
        archived.add(n.id);
        archivedNodes++;
      }
      actions.push({ action: 'archive', nodeId: n.id, label: n.label, kind: n.kind, reason: `archived: provider success >${maxAgeDays}d` });
    }
  }

  // ── Phase 3: Merge duplicate provider events ──
  if (!dryRun) {
    const providerEvents = graph.nodes.filter(n =>
      n.kind === 'event' && (n.label.startsWith('provider_failed') || n.label.startsWith('provider_succeeded'))
    );
    const merged = new Set<string>();
    for (let i = 0; i < providerEvents.length; i++) {
      if (merged.has(providerEvents[i].id) || toRemove.has(providerEvents[i].id) || archived.has(providerEvents[i].id)) continue;
      for (let j = i + 1; j < providerEvents.length; j++) {
        if (merged.has(providerEvents[j].id) || toRemove.has(providerEvents[j].id) || archived.has(providerEvents[j].id)) continue;
        if (jaccardSimilarity(providerEvents[i].label, providerEvents[j].label) > 0.6) {
          const mergedNode = await mergeNodes([providerEvents[i].id, providerEvents[j].id]);
          if (mergedNode) {
            merged.add(providerEvents[i].id);
            merged.add(providerEvents[j].id);
            mergedNodes++;
            actions.push({ action: 'merge', nodeId: mergedNode.id, label: mergedNode.label, kind: mergedNode.kind, reason: 'merged similar provider events' });
          }
        }
      }
    }
  }

  // Apply removals and archives
  if (!dryRun) {
    graph.nodes = graph.nodes.filter(n => !toRemove.has(n.id) && !archived.has(n.id));
    graph.edges = graph.edges.filter(e => !toRemove.has(e.from) && !toRemove.has(e.to) && !archived.has(e.from) && !archived.has(e.to));

    // Also remove any orphan edges connected to archived nodes
    const keptIds = new Set(graph.nodes.map(n => n.id));
    graph.edges = graph.edges.filter(e => keptIds.has(e.from) && keptIds.has(e.to));

    await writeExperienceGraph(graph);
  }

  return { actions, removedNodes, archivedNodes, mergedNodes, forgottenNodes: 0, pinnedSkipped };
}

// ── compactGraph (preserves scoring) ──

export async function compactGraph(maxNodes: number = 500): Promise<{ removedNodes: number; removedEdges: number }> {
  const graph = await readExperienceGraph();

  const validNodeIds = new Set(graph.nodes.map(n => n.id));
  const beforeEdges = graph.edges.length;
  graph.edges = graph.edges.filter(e => validNodeIds.has(e.from) && validNodeIds.has(e.to));
  const removedEdges = beforeEdges - graph.edges.length;

  if (graph.nodes.length <= maxNodes) {
    await writeExperienceGraph(graph);
    return { removedNodes: 0, removedEdges };
  }

  const priority = (n: ExperienceGraphNode): number => {
    // Pinned nodes always stay
    if (n.pinned) return -1;
    // By kind priority
    if (['decision', 'lesson', 'fix', 'bug', 'file', 'provider', 'model'].includes(n.kind)) return 0;
    if (['test', 'skill'].includes(n.kind)) return 1;
    return 2;
  };

  graph.nodes.sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    // Within same priority, keep higher importance first, then newer
    const ia = a.importance ?? 50;
    const ib = b.importance ?? 50;
    if (ia !== ib) return ib - ia;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const beforeNodes = graph.nodes.length;
  graph.nodes = graph.nodes.slice(0, maxNodes);
  const removedNodes = beforeNodes - graph.nodes.length;

  const remainingIds = new Set(graph.nodes.map(n => n.id));
  graph.edges = graph.edges.filter(e => remainingIds.has(e.from) && remainingIds.has(e.to));

  await writeExperienceGraph(graph);
  return { removedNodes, removedEdges };
}

// ── searchGraph ──

export async function searchGraph(query: string): Promise<{ nodes: ExperienceGraphNode[]; edges: ExperienceGraphEdge[] }> {
  const graph = await readExperienceGraph();
  const q = query.toLowerCase();
  const matchingNodes = graph.nodes.filter(n =>
    n.label.toLowerCase().includes(q) ||
    (n.summary && n.summary.toLowerCase().includes(q)) ||
    (n.tags && n.tags.some(t => t.toLowerCase().includes(q)))
  );
  const matchingNodeIds = new Set(matchingNodes.map(n => n.id));
  const matchingEdges = graph.edges.filter(e =>
    matchingNodeIds.has(e.from) || matchingNodeIds.has(e.to) ||
    (e.summary && e.summary.toLowerCase().includes(q))
  );
  return { nodes: matchingNodes, edges: matchingEdges };
}

export async function getGraphStats(): Promise<{ nodeCount: number; edgeCount: number; topKinds: { kind: string; count: number }[]; updatedAt: string }> {
  const graph = await readExperienceGraph();
  const kindCount = new Map<string, number>();
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

// ── Auto-logging helpers (with quality scoring) ──

export async function logProviderSuccess(provider: string, model: string): Promise<void> {
  const provNode = await upsertNode({ kind: 'provider', label: provider, source: 'provider' });
  const modelNode = await upsertNode({ kind: 'model', label: model, source: 'provider' });
  const eventNode = await upsertNode({
    kind: 'event',
    label: `provider_succeeded:${provider}/${model}`,
    summary: `${provider}/${model} succeeded`,
    tags: [provider, model],
    importance: 30,
    confidence: 80,
    source: 'provider',
  });
  await addEdge({ from: eventNode.id, to: modelNode.id, kind: 'succeeded_on' });
  await addEdge({ from: eventNode.id, to: provNode.id, kind: 'succeeded_on' });
}

export async function logProviderFailure(provider: string, model: string, reason: string): Promise<void> {
  const provNode = await upsertNode({ kind: 'provider', label: provider, source: 'provider' });
  const modelNode = await upsertNode({ kind: 'model', label: model, source: 'provider' });
  const eventNode = await upsertNode({
    kind: 'event',
    label: `provider_failed:${provider}/${model}`,
    summary: `${provider}/${model} failed: ${reason}`,
    tags: [provider, model, 'failure'],
    importance: 50,
    confidence: 70,
    source: 'provider',
  });
  await addEdge({ from: eventNode.id, to: modelNode.id, kind: 'failed_on' });
  await addEdge({ from: eventNode.id, to: provNode.id, kind: 'failed_on' });
}

export async function logTestPassed(testName: string): Promise<void> {
  const testNode = await upsertNode({ kind: 'test', label: testName, source: 'command' });
  const eventNode = await upsertNode({
    kind: 'event',
    label: `test_passed:${testName}`,
    summary: `Test ${testName} passed`,
    tags: [testName, 'test'],
    importance: 20,
    confidence: 90,
    source: 'command',
  });
  await addEdge({ from: eventNode.id, to: testNode.id, kind: 'verified_by' });
}

export async function logLesson(title: string, summary: string): Promise<void> {
  await upsertNode({
    kind: 'lesson',
    label: title,
    summary,
    tags: ['lesson'],
    importance: 60,
    confidence: 70,
  });
}

export async function logDecision(title: string, summary: string): Promise<void> {
  await upsertNode({
    kind: 'decision',
    label: title,
    summary,
    tags: ['decision'],
    importance: 70,
    confidence: 75,
  });
}

export async function experienceGraphExists(): Promise<boolean> {
  try {
    const raw = await readFile(graphPath(), 'utf8');
    const graph = JSON.parse(raw) as ExperienceGraph;
    return graph.nodes !== undefined;
  } catch {
    return false;
  }
}
