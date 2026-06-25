import { getBrainStatus, readProjectMap, readRecentEvents } from '../brain/store.js';
import { getGraphStats, getInspectReport } from '../brain/graph-store.js';
import { buildRecallContext, formatRecallContext, isRecallAvailable } from '../brain/recall.js';
import { getWebSessionCount } from '../brain/web-session.js';
import { getGitInfo } from '../utils/git.js';

const workingDir = process.cwd();

export interface BrainStatusResult {
  exists: boolean;
  brainDirExists: boolean;
  eventCount: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  projectMapDate: string | null;
  knownSystems: string[];
  webSessionCount: number;
  recallAvailable: boolean;
  git: { branch: string | null; hasChanges: boolean } | null;
}

export async function getBrainStatusHandler(): Promise<BrainStatusResult> {
  try {
    const status = await getBrainStatus();
    const graphStats = await getGraphStats().catch(() => null);
    const recallAvail = await isRecallAvailable().catch(() => false);
    const gitInfo = getGitInfo(workingDir);

    return {
      exists: status.exists,
      brainDirExists: status.exists,
      eventCount: status.eventCount,
      graphNodeCount: graphStats?.nodeCount ?? 0,
      graphEdgeCount: graphStats?.edgeCount ?? 0,
      projectMapDate: status.projectMapDate,
      knownSystems: status.knownSystems,
      webSessionCount: getWebSessionCount(),
      recallAvailable: recallAvail,
      git: gitInfo.isRepo ? { branch: gitInfo.branch, hasChanges: gitInfo.hasChanges } : null,
    };
  } catch {
    return {
      exists: false,
      brainDirExists: false,
      eventCount: 0,
      graphNodeCount: 0,
      graphEdgeCount: 0,
      projectMapDate: null,
      knownSystems: [],
      webSessionCount: 0,
      recallAvailable: false,
      git: null,
    };
  }
}

export interface BrainRecallResult {
  found: boolean;
  summary: string;
  intent: string;
  projectMapSummary?: string;
  recentLessons?: string[];
  recentDecisions?: string[];
  relevantGraphNodes?: string[];
  relevantGraphEdges?: string[];
}

export async function getBrainRecallHandler(query: string): Promise<BrainRecallResult> {
  try {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return { found: false, summary: 'No query provided.', intent: 'none' };
    }

    const ctx = await buildRecallContext(query.trim(), { debugMode: false });

    if (!ctx) {
      return { found: false, summary: 'No relevant memories found.', intent: 'none' };
    }

    return {
      found: true,
      summary: ctx.summary,
      intent: ctx.intent,
      projectMapSummary: ctx.projectMapSummary,
      recentLessons: ctx.recentLessons,
      recentDecisions: ctx.recentDecisions,
      relevantGraphNodes: ctx.relevantGraphNodes,
      relevantGraphEdges: ctx.relevantGraphEdges,
    };
  } catch (err) {
    return { found: false, summary: `Recall error: ${(err as Error).message}`, intent: 'none' };
  }
}

export interface BrainRecentEventsResult {
  events: Array<{
    id: string;
    timestamp: string;
    kind: string;
    title: string;
    summary: string;
    tags?: string[];
  }>;
}

export async function getBrainRecentEventsHandler(limit: number = 10): Promise<BrainRecentEventsResult> {
  try {
    const events = await readRecentEvents(limit);
    return {
      events: events.map(e => ({
        id: e.id,
        timestamp: e.timestamp,
        kind: e.kind,
        title: e.title,
        summary: e.summary,
        tags: e.tags,
      })),
    };
  } catch {
    return { events: [] };
  }
}

export interface BrainInspectResult {
  totalNodes: number;
  totalEdges: number;
  countsByKind: { kind: string; count: number }[];
  pinned: number;
  staleEvents: number;
  duplicateGroups: number;
  lowImportanceNodes: number;
}

export async function getBrainInspectHandler(): Promise<BrainInspectResult> {
  try {
    const report = await getInspectReport();
    return {
      totalNodes: report.totalNodes,
      totalEdges: report.totalEdges,
      countsByKind: report.countsByKind,
      pinned: report.pinned,
      staleEvents: report.staleEvents,
      duplicateGroups: report.duplicateGroups.length,
      lowImportanceNodes: report.lowImportanceNodes,
    };
  } catch {
    return {
      totalNodes: 0,
      totalEdges: 0,
      countsByKind: [],
      pinned: 0,
      staleEvents: 0,
      duplicateGroups: 0,
      lowImportanceNodes: 0,
    };
  }
}
