export type BrainEventKind =
  | 'task_started'
  | 'task_completed'
  | 'test_failed'
  | 'test_passed'
  | 'provider_failed'
  | 'provider_succeeded'
  | 'bug_found'
  | 'bug_fixed'
  | 'decision'
  | 'lesson'
  | 'skill_suggestion'
  | 'manual_note';

export type BrainEvent = {
  id: string;
  timestamp: string;
  kind: BrainEventKind;
  title: string;
  summary: string;
  files?: string[];
  commands?: string[];
  provider?: string;
  model?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type ProjectMap = {
  version: number;
  updatedAt: string;
  projectType?: string;
  importantFiles: Record<string, string>;
  modules: Record<string, {
    purpose: string;
    files: string[];
    dependsOn?: string[];
  }>;
  commands: Record<string, {
    purpose: string;
    entryFile?: string;
  }>;
  knownSystems: string[];
};
