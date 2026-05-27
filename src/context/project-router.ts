import type { TaskKind } from '../ai/task-classifier.js';

export interface ProjectRouteDecision {
  projectMode: boolean;
  reason: string;
}

const PROJECT_MODE_KEYWORDS = /\b(?:project|code|codebase|repo|repository|file|files|folder|directory|module|component|function|class|bug|bugs|fix|fixed|fixing|debug|debugging|error|errors|issue|issues|improvement|improvements|refactor|refactoring|structure|architecture|implement|implementation|test|tests|testing|build|compil|deploy|config|configur|route|routes|api|endpoint|hook|state|effect|promise|async|await|callback|import|export|npm|yarn|package|interface|type|types|schema|config|setting|settings|dependency|dependencies)\b/i;

const EXPLICIT_WEB_INTENT = /^(?:search|look\s*up|google|bing|search\s*the\s*web)\s+(?:for\s+)?(.+)/i;

const GENERAL_KNOWLEDGE_TRIGGERS = [
  /^who\s+(?:is|are|was|were)\s+(?!(?:this|the|my|our)\s+(?:project|code|repo|file|app|function|class|component))/i,
  /^what\s+(?:is|are)\s+(?!(?:the|this|my|our)\s+(?:project|code|repo|app|file|function|class|component|structure|architecture))\s+(?:(?!project|code|file|function|class|bug|error|test|api|route).)*$/i,
  /^where\s+(?:is|are|was|were|can|do)\s+/i,
  /^when\s+(?:is|was|did|will|do|does)\s+/i,
  /^why\s+(?:is|are|was|were|do|does|did)\s+(?!(?:this|the)\s+(?:code|test|build|error|bug|function)|\w+\s+(?:failing|breaking|not\s+working))/i,
  /^(?:history\s+of|meaning\s+of|definition\s+of)\s+(?!(?:this|the)\s+(?:project|code|function|class))/i,
  /^(?:tell\s+me\s+about|explain)\s+(?!(?:this|the|my|our)\s+(?:project|codebase|repo|app|code|file|function|class|component|structure|architecture|module))/i,
  /^(?:how\s+(?:much|many|long|far|tall|heavy|old|often))\s+/i,
  /^(?:من\s+هو|ما\s+هي|ما\s+هو|اين|متى|كيف|لماذا)\s+(?!(?:هذا|هذه|المشروع|الكود|الملف|التطبيق))/i,
];

const CODING_TASK_KINDS: readonly TaskKind[] = [
  'code_edit', 'debugging', 'code_review', 'long_context',
  'project_scan', 'coding_qa', 'long_reasoning', 'planning',
];

export function decideProjectMode(
  message: string,
  workspaceLoaded: boolean,
  taskKind: TaskKind,
): ProjectRouteDecision {
  const trimmed = message.trim();
  if (!trimmed || !workspaceLoaded) {
    return { projectMode: false, reason: workspaceLoaded ? 'Empty message' : 'No workspace loaded' };
  }

  const lower = trimmed.toLowerCase();

  // Simple chat with no project keywords → not project mode
  if (taskKind === 'simple_chat' && !PROJECT_MODE_KEYWORDS.test(trimmed)) {
    return { projectMode: false, reason: 'Simple chat with no project keywords' };
  }

  // Explicit web search command → not project mode
  if (EXPLICIT_WEB_INTENT.test(trimmed)) {
    return { projectMode: false, reason: 'Explicit web search command' };
  }

  // General knowledge triggers → not project mode
  for (const p of GENERAL_KNOWLEDGE_TRIGGERS) {
    if (p.test(trimmed)) {
      return { projectMode: false, reason: `General knowledge trigger: ${p}` };
    }
  }

  // Coding task kinds → project mode
  if (CODING_TASK_KINDS.includes(taskKind)) {
    return { projectMode: true, reason: `Coding task kind: ${taskKind}` };
  }

  // Project keywords detected → project mode
  if (PROJECT_MODE_KEYWORDS.test(trimmed)) {
    return { projectMode: true, reason: 'Project keywords matched' };
  }

  // "find X" where X looks like a bug/issue/error/code thing → project mode
  const findProjectMatch = trimmed.match(/^find\s+(?:a\s+|an\s+|the\s+|me\s+)?(.+)/i);
  if (findProjectMatch) {
    const target = findProjectMatch[1];
    if (PROJECT_MODE_KEYWORDS.test(target) || /bug|issue|error|problem|improvement|file|function|class/i.test(target)) {
      return { projectMode: true, reason: `Find-query with project target: "${target}"` };
    }
  }

  // Simple chat → not project mode (greetings are already handled above)
  if (taskKind === 'simple_chat') {
    return { projectMode: false, reason: 'Simple chat, no project keywords' };
  }

  // Explicit web search / entity lookup → not project mode
  if (taskKind === 'search' || taskKind === 'web_research') {
    return { projectMode: false, reason: `Web search task: ${taskKind}` };
  }

  // Default: workspace loaded → project mode
  return { projectMode: true, reason: 'Workspace loaded, unknown task kind, defaulting to project mode' };
}
