import { execSync } from 'node:child_process';
import { selectContext } from '../brain/context-selector.js';
import { readProjectMap } from '../brain/store.js';
import type { ScoredMemoryItem } from '../brain/context-selector.js';
import type { ProjectMap } from '../brain/types.js';

export interface MemoryContextItem {
  label: string;
  kind: string;
  summary: string;
  relevanceScore: number;
}

export interface ProjectFact {
  module: string;
  purpose: string;
  files: string[];
}

export interface MemoryContextResult {
  recentMemories: MemoryContextItem[];
  relevantMemories: MemoryContextItem[];
  projectFacts: ProjectFact[];
  summary: string;
  memoryUsed: boolean;
  memoryHits: number;
  relevantFiles: string[];
}

const SRC_PATTERN = /\b(src\/[\w/\\\-.]+\.[a-z]+)\b/g;

function isFilePath(value: string): boolean {
  return /[\w/\\\-.]+\.[a-z]+(?:\.[a-z]+)?/.test(value);
}

function extractFilesFromMemoryItems(items: ScoredMemoryItem[]): string[] {
  const files = new Set<string>();
  for (const item of items) {
    const node = item.node;
    if (node.kind === 'file' && node.label && !node.label.startsWith('.')) {
      files.add(node.label);
    }
    if (node.metadata && typeof node.metadata === 'object') {
      const metaFiles = (node.metadata as Record<string, unknown>).files;
      if (Array.isArray(metaFiles)) {
        for (const f of metaFiles) {
          if (typeof f === 'string' && isFilePath(f)) {
            files.add(f);
          }
        }
      }
    }
    const summary = node.summary || '';
    const matches = summary.match(SRC_PATTERN);
    if (matches) {
      for (const m of matches) files.add(m);
    }
  }
  return [...files].slice(0, 10);
}

function buildSummaryText(
  items: ScoredMemoryItem[],
  facts: ProjectFact[],
  files: string[],
): string {
  const parts: string[] = [];
  if (items.length > 0) {
    parts.push(`Memory has ${items.length} relevant item(s)`);
  }
  if (files.length > 0) {
    parts.push(`Memory mentions ${files.length} file(s)`);
  }
  if (facts.length > 0) {
    const moduleNames = facts.map(f => f.module).join(', ');
    parts.push(`Project has ${facts.length} identified module(s): ${moduleNames}`);
  }
  return parts.length > 0 ? parts.join('. ') + '.' : '';
}

function mapFacts(projectMap: ProjectMap | null): ProjectFact[] {
  if (!projectMap || !projectMap.modules) return [];
  return Object.entries(projectMap.modules).map(([module, info]) => ({
    module,
    purpose: info.purpose || '',
    files: info.files || [],
  }));
}

function getRecentGitFiles(maxFiles: number = 10): string[] {
  try {
    const stdout = execSync('git diff --name-only HEAD~5 HEAD', {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const files = stdout.trim().split('\n').filter(Boolean).map(f => f.replace(/\\/g, '/'));
    return [...new Set(files)].slice(0, maxFiles);
  } catch {
    try {
      const stdout = execSync('git diff --name-only HEAD~3', {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const files = stdout.trim().split('\n').filter(Boolean).map(f => f.replace(/\\/g, '/'));
      return [...new Set(files)].slice(0, maxFiles);
    } catch {
      return [];
    }
  }
}

const TASK_KIND_MAP: Record<string, string> = {
  simple_chat: 'simple',
  code_edit: 'code',
  debug_error: 'code',
  file_read: 'code',
  project_scan: 'planning',
  run_tests: 'code',
  run_build: 'code',
  web_research: 'simple',
  arabic_explanation: 'simple',
  unknown: 'simple',
};

export async function getMemoryContextForTask(input: {
  task: string;
  taskKind?: string;
}): Promise<MemoryContextResult> {
  const emptyResult: MemoryContextResult = {
    recentMemories: [],
    relevantMemories: [],
    projectFacts: [],
    summary: '',
    memoryUsed: false,
    memoryHits: 0,
    relevantFiles: [],
  };

  try {
    const complexity = input.taskKind
      ? (TASK_KIND_MAP[input.taskKind] ?? 'code')
      : 'code';

    const selected = await selectContext({
      message: input.task,
      taskKind: complexity,
      maxItems: 5,
    });

    if (!selected || selected.items.length === 0) {
      const projectMap = await readProjectMap();
      const facts = mapFacts(projectMap);
      const gitFiles = getRecentGitFiles(10);

      if (facts.length > 0 || gitFiles.length > 0) {
        const summaryParts: string[] = [];
        if (facts.length > 0) {
          summaryParts.push(`Project has ${facts.length} identified module(s)`);
        }
        if (gitFiles.length > 0) {
          summaryParts.push(`Recent git changes: ${gitFiles.length} file(s)`);
        }
        return {
          ...emptyResult,
          projectFacts: facts,
          relevantFiles: gitFiles,
          summary: summaryParts.join('. ') + '.',
          memoryHits: gitFiles.length > 0 ? gitFiles.length : 0,
          memoryUsed: gitFiles.length > 0,
        };
      }
      return emptyResult;
    }

    const items = selected.items;
    const projectMap = await readProjectMap();
    const facts = mapFacts(projectMap);
    const files = extractFilesFromMemoryItems(items);

    return {
      recentMemories: items.slice(0, 3).map(i => ({
        label: i.node.label,
        kind: i.node.kind,
        summary: i.node.summary || '',
        relevanceScore: i.relevanceScore,
      })),
      relevantMemories: items.map(i => ({
        label: i.node.label,
        kind: i.node.kind,
        summary: i.node.summary || '',
        relevanceScore: i.relevanceScore,
      })),
      projectFacts: facts,
      summary: buildSummaryText(items, facts, files),
      memoryUsed: true,
      memoryHits: items.length,
      relevantFiles: files,
    };
  } catch {
    return emptyResult;
  }
}
