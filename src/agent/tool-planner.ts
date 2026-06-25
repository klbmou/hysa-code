import { isArabicText } from '../ai/task-classifier.js';
import { getTool, listTools } from '../tools/registry.js';
import { isDangerousCommand } from '../tools/approval.js';
import { classifyCommand } from '../utils/commands.js';

export type ProposedToolActionStatus =
  | 'proposed'
  | 'requires_approval'
  | 'blocked'
  | 'ready';

export interface ProposedToolAction {
  id: string;
  toolName: string;
  reason: string;
  input: Record<string, unknown>;
  riskLevel: 'safe' | 'review' | 'dangerous';
  approvalPolicy: 'auto' | 'requires_approval' | 'blocked';
  status: ProposedToolActionStatus;
}

export interface AgentToolPlan {
  taskKind: string;
  summary: string;
  actions: ProposedToolAction[];
  risks: string[];
  requiresApproval: boolean;
  blocked: boolean;
  nextStep: string;
  memoryUsed?: boolean;
  memoryHits?: number;
  memoryReasoning?: string;
}

let actionCounter = 0;

function nextActionId(): string {
  actionCounter++;
  return `act_${actionCounter}`;
}

export function resetActionCounter(): void {
  actionCounter = 0;
}

const TEST_BUILD_PATTERNS = [
  /(?:\brun\b|\bتشغيل|\bشغل|\bاختبار|\bاختبر)/i,
  /\b(?:test|tests)/i,
  /(?:اختبارات)/i,
  /\b(?:build|بناء|بني|compile|ترجمة|تجميع)\b/i,
  /\b(?:lint|typecheck|tsc|check)\b/i,
];

const FILE_EDIT_PATTERNS = [
  /\b(?:edit|change|modify|update|fix|refactor|rewrite|إصلاح|عدل|تعديل|غير|تغيير|أصلح)\b/i,
  /\b(?:create|add|write|أنشئ|انشئ|أنشأ|أضف|اضف|اكتب|كتب)\b/i,
  /\b(?:delete|remove|احذف|حذف|امسح|مسح)\b/i,
];

const FILE_READ_PATTERNS = [
  /\b(?:read|اقرأ|قراءة|display|اعرض|show|أظهر|print|اطبع)\b/i,
  /\b(?:summarize|لخص|تلخيص|describe|صف|وصف)\b/i,
  /\b(?:check|افحص|فحص|inspect|review|راجع|مراجعة)\b/i,
];

const DANGEROUS_USER_PATTERNS = [
  /delete\s+all\b/i,
  /wipe\s+(?:everything|all|project|database)/i,
  /remove\s+(?:all|everything)\b/i,
  /format\s+(?:drive|disk|pc|system)/i,
  /shutdown\s+(?:server|pc|computer|system)/i,
  /reset\s+(?:all|everything|system)\b/i,
  /drop\s+(?:all\s+)?tables/i,
  /truncate\s+(?:all\s+)?tables/i,
];

export type PlannerTaskKind =
  | 'simple_chat'
  | 'code_edit'
  | 'debug_error'
  | 'web_research'
  | 'project_scan'
  | 'run_tests'
  | 'run_build'
  | 'file_read'
  | 'arabic_explanation'
  | 'os_control'
  | 'unknown';

function classifyPlannerTask(text: string): PlannerTaskKind {
  const lower = text.toLowerCase();
  const hasArabic = isArabicText(text);

  const testPattern = /(?:run\s+(?:the\s+)?tests?\b|تشغيل\s+الاختبارات|شغل\s+الاختبارات|npm\s+test|npm\s+run\s+test)\b/i;
  const buildPattern = /\b(?:build|npm\s+run\s+build|npx\s+tsc|compile)\b/i;
  const debugPattern = /\b(?:debug|bug|error|exception|crash|fail|broken|not\s+working|timed?\s*out|rate\s*limit|429|500)\b/i;
  const editPattern = /\b(?:edit|change|modify|update|fix|refactor|rewrite|create|add|write|delete|remove)\b/i;
  const readPattern = /\b(?:read|show|display|summarize|what\s+is\s+in|content\s+of|print)\b/i;
  const searchPattern = /\b(?:search|look\s+up|find\s+info|research|web\s+search)\b/i;

  const osControlPatterns = [
    /\b(?:move|click|press|type)\b(?:\s+\w+){0,3}\s+(?:mouse|cursor|key|keyboard|button)\b/i,
    /\b(?:mouse|cursor|pointer)\s*(?:move|to|position|location|click)\b/i,
    /\b(?:type|enter|input)\s+(?:text|word|sentence|this|the|["'`]|\u201C|\u2018)/i,
    /\btype\s+["'`\u201C\u2018][^"'`\u201C\u2018]+["'`\u201D\u2019]/i,
    /\b(?:press|hit|send)\s+(?:key|enter|tab|escape|ctrl|alt|shift|f\d+|space)\b/i,
    /\b(?:hotkey|shortcut|key\s*combo|keyboard\s*shortcut)\b/i,
    /\b(?:click|double.?click|right.?click|left.?click)\b/i,
    /\b(?:scroll|drag|drop)\b/i,
    /\b(?:move_mouse|click_mouse|type_keyboard|press_key)\b/i,
  ];
  if (osControlPatterns.some(p => p.test(text))) {
    return 'os_control';
  }

  if (/^hi\b|^hello\b|^hey\b|^thanks\b|^ok\b|^yes\b|^no\b|^good\b|^great\b/i.test(text) && text.split(/\s+/).length < 5) {
    return 'simple_chat';
  }

  if (hasArabic && text.split(/\s+/).length < 4 && !/اقرأ|شوف|أصلح|اختبر|شغل|عدل/.test(text)) {
    return 'arabic_explanation';
  }

  if (/\b(?:drop\s+table|truncate\s+table|rm\s+-rf|format\s+\w:\|shutdown)\b/i.test(text)) {
    return 'debug_error';
  }

  if (testPattern.test(text) || buildPattern.test(text)) {
    if (testPattern.test(text)) return 'run_tests';
    return 'run_build';
  }

  if (hasArabic) {
    const testBuildArabic = /اختبر|اختبار|اختبارات|شغل\s+الاختبارات|اختبر\s+الكود|اختبر\s+المشروع|بناء|ابني|بني|ترجمة|تجميع/i;
    if (testBuildArabic.test(text)) {
      if (/اختبر|اختبارات|شغل\s+الاختبارات/i.test(text)) return 'run_tests';
      if (/بناء|ابني|بني|ترجمة|تجميع/i.test(text)) return 'run_build';
    }
  }

  if (searchPattern.test(text)) {
    return 'web_research';
  }

  if (debugPattern.test(text)) return 'debug_error';

  // Arabic debug words (خطأ = error, عطل = fault/crash, etc.)
  if (hasArabic && /خطأ|أخطاء|عطل|أعطال|مشكلة|مشاكل|علة|خلل/i.test(text)) return 'debug_error';

  if (editPattern.test(text)) return 'code_edit';

  const fileKeywords = /\b(?:file|ملف|app\.tsx|component|function|code|كود)\b/i;
  if (readPattern.test(text) && fileKeywords.test(text)) return 'file_read';

  if (text.length < 60 && !editPattern.test(text) && !debugPattern.test(text) && !testPattern.test(text)) {
    return 'simple_chat';
  }

  return 'project_scan';
}

function extractMentionedFiles(text: string): string[] {
  const files: string[] = [];
  const filePatterns = [
    /(['"])([\w/\\\-.]+\.[a-z]+)\1/g,
    /(\b[\w/\\\-.]+\/(?:[\w/\\\-.]+\.[a-z]+))\b/g,
    /\b(src\/[\w/\\\-.]+\.[a-z]+)\b/g,
  ];
  for (const pattern of filePatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const f = m[1].replace(/['"]/g, '');
      if (!files.includes(f)) files.push(f);
    }
  }
  return files;
}

function buildApprovalInfo(toolName: string, input: Record<string, unknown>): {
  riskLevel: 'safe' | 'review' | 'dangerous';
  approvalPolicy: 'auto' | 'requires_approval' | 'blocked';
  status: ProposedToolActionStatus;
} {
  if (toolName === 'run_command') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    if (isDangerousCommand(cmd) || classifyCommand(cmd) === 'dangerous') {
      return { riskLevel: 'dangerous', approvalPolicy: 'blocked', status: 'blocked' };
    }
    return { riskLevel: 'review', approvalPolicy: 'requires_approval', status: 'requires_approval' };
  }

  if (toolName === 'write_file') {
    return { riskLevel: 'review', approvalPolicy: 'requires_approval', status: 'requires_approval' };
  }

  if (toolName === 'read_file' || toolName === 'list_files') {
    const tool = getTool(toolName);
    if (tool) {
      return { riskLevel: tool.riskLevel, approvalPolicy: tool.approvalPolicy, status: 'ready' };
    }
    return { riskLevel: 'safe', approvalPolicy: 'auto', status: 'ready' };
  }

  // OS control tools always require approval
  if (toolName === 'move_mouse' || toolName === 'click_mouse' || toolName === 'type_keyboard' || toolName === 'press_key') {
    return { riskLevel: 'review', approvalPolicy: 'requires_approval', status: 'requires_approval' };
  }

  return { riskLevel: 'safe', approvalPolicy: 'auto', status: 'proposed' };
}

function isPathTraversal(path: string): boolean {
  if (!path) return false;
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:\\/.test(normalized)) return true;
  if (normalized.includes('..')) return true;
  return false;
}

export function planToolActionsForTask(input: {
  userText: string;
  taskKind?: string;
  cwd?: string;
  filesMentioned?: string[];
  memoryContext?: import('./memory-context.js').MemoryContextResult;
}): AgentToolPlan {
  const text = input.userText || '';
  const taskKind: PlannerTaskKind = (input.taskKind as PlannerTaskKind) || classifyPlannerTask(text);
  const mentionedFiles = input.filesMentioned || extractMentionedFiles(text);
  const cwd = input.cwd || process.cwd();
  const memCtx = input.memoryContext;
  const actions: ProposedToolAction[] = [];
  const risks: string[] = [];
  let requiresApproval = false;
  let blocked = false;

  let memoryReasoning = '';
  if (memCtx) {
    if (memCtx.memoryUsed && memCtx.relevantFiles.length > 0) {
      const fileList = memCtx.relevantFiles.length <= 3
        ? memCtx.relevantFiles.join(', ')
        : memCtx.relevantFiles.slice(0, 3).join(', ') + ` and ${memCtx.relevantFiles.length - 3} more`;
      memoryReasoning = `Memory shows recent work in: ${fileList}. `;
      if (memCtx.relevantMemories.length > 0) {
        const kinds = [...new Set(memCtx.relevantMemories.map(m => m.kind))].join(', ');
        memoryReasoning += `Memory has ${memCtx.relevantMemories.length} relevant item(s) (${kinds}). `;
      }
      memoryReasoning += `Prioritizing memory-implied files over generic exploration.`;
    } else if (memCtx.memoryUsed && memCtx.memoryHits === 0) {
      memoryReasoning = 'Memory was checked but no relevant items found.';
    }
  }

  // Check for dangerous user requests
  if (DANGEROUS_USER_PATTERNS.some(p => p.test(text))) {
    actions.push({
      id: nextActionId(),
      toolName: 'run_command',
      reason: 'User requested potentially destructive action',
      input: { command: text },
      riskLevel: 'dangerous',
      approvalPolicy: 'blocked',
      status: 'blocked',
    });
    risks.push('User request contains destructive intent — blocked by safety policy');
    blocked = true;
    return {
      taskKind,
      summary: 'Blocked: task contains dangerous patterns',
      actions,
      risks,
      requiresApproval: false,
      blocked: true,
      nextStep: 'Explain to the user why this action is blocked. Suggest safer alternatives.',
      memoryUsed: memCtx?.memoryUsed,
      memoryHits: memCtx?.memoryHits,
      memoryReasoning: memoryReasoning || undefined,
    };
  }

  // Simple chat — no tools needed
  if (taskKind === 'simple_chat' || taskKind === 'arabic_explanation' || taskKind === 'unknown') {
    return {
      taskKind,
      summary: taskKind === 'arabic_explanation'
        ? 'Arabic explanation/educational query — no local tools needed'
        : 'Simple conversation — no tools needed',
      actions: [],
      risks: [],
      requiresApproval: false,
      blocked: false,
      nextStep: 'Respond directly to the user without tool execution',
      memoryUsed: memCtx?.memoryUsed,
      memoryHits: memCtx?.memoryHits,
      memoryReasoning: memoryReasoning || undefined,
    };
  }

  // Web research — no local tools unless project files mentioned
  if (taskKind === 'web_research') {
    if (mentionedFiles.length > 0) {
      for (const file of mentionedFiles) {
        if (!isPathTraversal(file)) {
          const info = buildApprovalInfo('read_file', { path: file });
          actions.push({
            id: nextActionId(),
            toolName: 'read_file',
            reason: `Research task mentions project file: ${file}`,
            input: { path: file },
            ...info,
          });
        }
      }
    }
    if (actions.length === 0) {
      return {
        taskKind,
        summary: 'Web research task — no local tool actions needed (web search tools not yet implemented)',
        actions: [],
        risks: ['Web search is handled by AI, not local tools'],
        requiresApproval: false,
        blocked: false,
        nextStep: 'Use AI to perform web research (search tools not available in this MVP)',
        memoryUsed: memCtx?.memoryUsed,
        memoryHits: memCtx?.memoryHits,
        memoryReasoning: memoryReasoning || undefined,
      };
    }
  }

  // Run tests
  if (taskKind === 'run_tests') {
    const cmds = ['npm test', 'node ./node_modules/tsx/dist/cli.mjs --test tests/'];
    if (text.includes('npx')) {
      cmds.unshift(text.match(/npx\s+[^\s]+(?:\s+[^\s]+)*/)?.[0] || 'npm test');
    }
    if (text.includes('specific') || /test\s+file/i.test(text) || /اختبار\s+محدد/i.test(text)) {
      cmds.push('npx tsx --test tests/');
    }
    for (const cmd of cmds) {
      if (text.includes(cmd.replace(/^npm /, '')) || text.includes(cmd)) {
        const info = buildApprovalInfo('run_command', { command: cmd });
        actions.push({
          id: nextActionId(),
          toolName: 'run_command',
          reason: `Testing: ${cmd}`,
          input: { command: cmd },
          ...info,
        });
        if (info.status === 'requires_approval') requiresApproval = true;
        break;
      }
    }
    if (actions.length === 0) {
      const cmd = 'npm test';
      const info = buildApprovalInfo('run_command', { command: cmd });
      actions.push({
        id: nextActionId(),
        toolName: 'run_command',
        reason: 'Run project tests',
        input: { command: cmd },
        ...info,
      });
      if (info.status === 'requires_approval') requiresApproval = true;
    }
  }

  // Run build
  if (taskKind === 'run_build') {
    const buildCmds = ['npm run build', 'npx tsc --noEmit'];
    for (const cmd of buildCmds) {
      const info = buildApprovalInfo('run_command', { command: cmd });
      actions.push({
        id: nextActionId(),
        toolName: 'run_command',
        reason: `Build/typecheck: ${cmd}`,
        input: { command: cmd },
        ...info,
      });
      if (info.status === 'requires_approval') requiresApproval = true;
    }
  }

  // Debug error
  if (taskKind === 'debug_error') {
    for (const file of mentionedFiles) {
      if (!isPathTraversal(file)) {
        const info = buildApprovalInfo('read_file', { path: file });
        actions.push({
          id: nextActionId(),
          toolName: 'read_file',
          reason: `Debug task: read mentioned file "${file}" to understand the issue`,
          input: { path: file },
          ...info,
        });
      }
    }
    if (mentionedFiles.length === 0) {
      const memFiles = memCtx?.relevantFiles.filter(f => !isPathTraversal(f)) || [];
      if (memFiles.length > 0) {
        for (const file of memFiles) {
          const info = buildApprovalInfo('read_file', { path: file });
          actions.push({
            id: nextActionId(),
            toolName: 'read_file',
            reason: `Memory suggests reading "${file}" — recently relevant to this project area`,
            input: { path: file },
            ...info,
          });
        }
      } else {
        actions.push({
          id: nextActionId(),
          toolName: 'list_files',
          reason: 'Explore project to find relevant files for debugging',
          input: { path: '.', maxDepth: 2 },
          riskLevel: 'safe',
          approvalPolicy: 'auto',
          status: 'ready',
        });
      }
    }
  }

  // Code edit
  if (taskKind === 'code_edit' || taskKind === 'project_scan') {
    for (const file of mentionedFiles) {
      if (!isPathTraversal(file)) {
        const info = buildApprovalInfo('read_file', { path: file });
        actions.push({
          id: nextActionId(),
          toolName: 'read_file',
          reason: `Read file mentioned in task: "${file}"`,
          input: { path: file },
          ...info,
        });
      }
    }

    // Check if this is a create/write request
    const isWriteRequest = /\b(?:create|add|write|أنشئ|انشئ|أنشأ|أضف|اضف|اكتب|كتب|new)\b/i.test(text);
    if (isWriteRequest && mentionedFiles.length > 0) {
      for (const file of mentionedFiles) {
        if (!isPathTraversal(file)) {
          const info = buildApprovalInfo('write_file', { path: file, content: '' });
          actions.push({
            id: nextActionId(),
            toolName: 'write_file',
            reason: `Write/create file: "${file}" — requires approval before content is provided`,
            input: { path: file, content: '' },
            ...info,
          });
          if (info.status === 'requires_approval') requiresApproval = true;
        }
      }
    }

    const hasTestOrBuild = /\b(?:test|build|compile|typecheck|lint)\b/i.test(text);
    if (hasTestOrBuild) {
      const cmd = /\b(test)\b/i.test(text) ? 'npm test' : 'npm run build';
      const info = buildApprovalInfo('run_command', { command: cmd });
      actions.push({
        id: nextActionId(),
        toolName: 'run_command',
        reason: `${cmd} — required as part of code change workflow`,
        input: { command: cmd },
        ...info,
      });
      if (info.status === 'requires_approval') requiresApproval = true;
    }

    if (mentionedFiles.length === 0) {
      const memFiles = memCtx?.relevantFiles.filter(f => !isPathTraversal(f)) || [];
      if (memFiles.length > 0) {
        for (const file of memFiles) {
          const info = buildApprovalInfo('read_file', { path: file });
          actions.push({
            id: nextActionId(),
            toolName: 'read_file',
            reason: `Memory shows "${file}" is relevant to this project area`,
            input: { path: file },
            ...info,
          });
        }
      } else {
        actions.push({
          id: nextActionId(),
          toolName: 'list_files',
          reason: 'Explore project to understand structure before making changes',
          input: { path: '.', maxDepth: 1 },
          riskLevel: 'safe',
          approvalPolicy: 'auto',
          status: 'ready',
        });
      }
    }
  }

  // File read specific
  if (taskKind === 'file_read') {
    for (const file of mentionedFiles) {
      if (!isPathTraversal(file)) {
        const info = buildApprovalInfo('read_file', { path: file });
        actions.push({
          id: nextActionId(),
          toolName: 'read_file',
          reason: `Read file: "${file}"`,
          input: { path: file },
          ...info,
        });
      }
    }
    if (mentionedFiles.length === 0) {
      const memFiles = memCtx?.relevantFiles.filter(f => !isPathTraversal(f)) || [];
      if (memFiles.length > 0) {
        for (const file of memFiles) {
          const info = buildApprovalInfo('read_file', { path: file });
          actions.push({
            id: nextActionId(),
            toolName: 'read_file',
            reason: `Memory suggests "${file}" may contain the requested information`,
            input: { path: file },
            ...info,
          });
        }
      } else {
        actions.push({
          id: nextActionId(),
          toolName: 'list_files',
          reason: 'Explore project to find requested file',
          input: { path: '.', maxDepth: 1 },
          riskLevel: 'safe',
          approvalPolicy: 'auto',
          status: 'ready',
        });
      }
    }
  }

  // OS control tasks
  if (taskKind === 'os_control') {
    // Add memory coordinate hints to reasoning for os_control tasks
    if (memCtx && memCtx.memoryUsed) {
      const memCoord = extractCoordinateFromMemory(memCtx);
      if (memCoord) {
        memoryReasoning += `Memory record specifies screen coordinates (${memCoord.x}, ${memCoord.y}). Using as fallback when coordinates are not explicitly provided. `;
      }
      const memKey = extractKeyHintFromMemory(memCtx);
      if (memKey) {
        memoryReasoning += `Memory suggests using key "${memKey}". `;
      }
    }

    if (/\b(?:move|position)\b(?:\s+\w+){0,3}\s+(?:mouse|cursor|pointer)\b/i.test(text)) {
      const match = text.match(/(\d+)\s*[, ]\s*(\d+)/);
      const memCoord = !match ? extractCoordinateFromMemory(memCtx) : null;
      const x = match ? parseInt(match[1], 10) : (memCoord ? memCoord.x : 500);
      const y = match ? parseInt(match[2], 10) : (memCoord ? memCoord.y : 500);
      const reason = match
        ? `Move cursor to (${x}, ${y})`
        : (memCoord
          ? `Move cursor to memory-suggested coordinates (${x}, ${y})`
          : `Move cursor to (${x}, ${y}) — estimated; specify exact coordinates for precision`);
      const info = buildApprovalInfo('move_mouse', { x, y });
      actions.push({
        id: nextActionId(),
        toolName: 'move_mouse',
        reason,
        input: { x, y },
        ...info,
      });
      if (info.status === 'requires_approval') requiresApproval = true;
    }
    if (/\b(?:click|double.?click|right.?click)\b/i.test(text)) {
      const isRight = /\bright\b/i.test(text);
      const isDouble = /\bdouble\b/i.test(text);
      const button = isRight ? 'right' : 'left';
      const count = isDouble ? 2 : 1;
      const info = buildApprovalInfo('click_mouse', { button, count });
      actions.push({
        id: nextActionId(),
        toolName: 'click_mouse',
        reason: `${isRight ? 'Right' : 'Left'}-click ${isDouble ? 'double-' : ''}click`,
        input: { button, count },
        ...info,
      });
      if (info.status === 'requires_approval') requiresApproval = true;
    }
    if (/\b(?:type|enter|input)\s+(?:text|the\s+following|this)\b/i.test(text) || /\btype_keyboard\b/i.test(text) || /\btype\s+[""'`\u201C\u2018][^"'`\u201C\u2018]+[""'`\u201D\u2019]/i.test(text)) {
      const textMatch = text.match(/(?:type|enter|input)\s+(?:(?:text|the|following|this)\s+)?["'`\u201C\u2018]([^"'`\u201C\u2018]+)["'`\u201D\u2019]/);
      const typeText = textMatch ? textMatch[1] : '(text from context)';
      const info = buildApprovalInfo('type_keyboard', { text: typeText });
      actions.push({
        id: nextActionId(),
        toolName: 'type_keyboard',
        reason: `Type text: ${typeText.length > 40 ? typeText.slice(0, 40) + '...' : typeText}`,
        input: { text: typeText },
        ...info,
      });
      if (info.status === 'requires_approval') requiresApproval = true;
    }
    if (/\b(?:press|hit|send)\s+(?:key\s+)?(\S+)\b/i.test(text)) {
      const keyMatch = text.match(/(?:press|hit|send)\s+(?:key\s+)?(\S+)/i);
      const key = keyMatch ? keyMatch[1].toLowerCase() : 'enter';
      const info = buildApprovalInfo('press_key', { key });
      actions.push({
        id: nextActionId(),
        toolName: 'press_key',
        reason: `Press key: ${key}`,
        input: { key },
        ...info,
      });
      if (info.status === 'requires_approval') requiresApproval = true;
    }
  }

  // Build summary
  const actionCount = actions.length;
  const hasRisks = risks.length > 0;

  const summary = blocked
    ? 'Plan blocked: task contains destructive requests'
    : actionCount === 0
    ? `No tool actions needed for task kind: ${taskKind}`
    : `Proposed ${actionCount} tool action(s) for task: ${taskKind}${hasRisks ? ' with identified risks' : ''}`;

  // Build memory reasoning for final plan
  const memoryReasoningFinal = memoryReasoning
    ? memoryReasoning
    : memCtx?.memoryUsed && !memCtx?.memoryHits
    ? 'Memory was checked but no relevant items found.'
    : undefined;

  return {
    taskKind,
    summary,
    actions,
    risks,
    requiresApproval,
    blocked,
    nextStep: blocked
      ? 'Explain to the user why this action is blocked. Suggest safer alternatives.'
      : requiresApproval
      ? 'Review proposed actions and approve individually before execution. Use dry-run to preview changes.'
      : actionCount === 0
      ? 'No tools needed — respond to the user directly.'
      : 'All proposed actions are safe and ready for execution.',
    memoryUsed: memCtx?.memoryUsed,
    memoryHits: memCtx?.memoryHits,
    memoryReasoning: memoryReasoningFinal,
  };
}

export function executeApprovedToolPlan(
  plan: AgentToolPlan,
  context: { cwd?: string; approved: boolean; source: 'cli' | 'web' | 'test' },
): Promise<Array<{ actionId: string; toolName: string; ok: boolean; summary: string; error?: string }>> {
  return executeApprovedToolPlanImpl(plan, context);
}

async function executeApprovedToolPlanImpl(
  plan: AgentToolPlan,
  context: { cwd?: string; approved: boolean; source: 'cli' | 'web' | 'test' },
): Promise<Array<{ actionId: string; toolName: string; ok: boolean; summary: string; error?: string }>> {
  const results: Array<{ actionId: string; toolName: string; ok: boolean; summary: string; error?: string }> = [];
  const cwd = context.cwd || process.cwd();

  for (const action of plan.actions) {
    if (action.status === 'blocked') {
      results.push({
        actionId: action.id,
        toolName: action.toolName,
        ok: false,
        summary: 'Blocked action — not executed',
        error: 'Action is blocked by safety policy',
      });
      continue;
    }

    if (action.status === 'requires_approval' && !context.approved) {
      results.push({
        actionId: action.id,
        toolName: action.toolName,
        ok: false,
        summary: 'Action requires approval — use approved=true or dry-run mode',
        error: 'Approval required',
      });
      continue;
    }

    try {
      const { runTool } = await import('../tools/registry.js');
      const result = await runTool(action.toolName, action.input as Record<string, unknown>, {
        cwd,
        approved: context.approved,
        dryRun: !context.approved,
        source: context.source,
      });
      results.push({
        actionId: action.id,
        toolName: action.toolName,
        ok: result.ok,
        summary: result.summary,
        error: result.error,
      });
    } catch (err: unknown) {
      const e = err as Error;
      results.push({
        actionId: action.id,
        toolName: action.toolName,
        ok: false,
        summary: `Execution error: ${e.message}`,
        error: e.message,
      });
    }
  }

  return results;
}

export function formatPlanForDisplay(plan: AgentToolPlan): string {
  const lines: string[] = [];
  lines.push(`Task kind: ${plan.taskKind}`);
  lines.push(`Summary: ${plan.summary}`);
  lines.push('');

  if (plan.actions.length === 0) {
    lines.push('No tool actions proposed.');
  } else {
    for (let i = 0; i < plan.actions.length; i++) {
      const a = plan.actions[i];
      const statusColor = a.status === 'blocked' ? 'BLOCKED' : a.status === 'requires_approval' ? 'NEEDS APPROVAL' : a.status === 'ready' ? 'READY' : 'PROPOSED';
      lines.push(`[${i + 1}] ${a.toolName} (${a.riskLevel}) — ${statusColor}`);
      lines.push(`    Reason: ${a.reason}`);
      lines.push(`    Input: ${JSON.stringify(a.input)}`);
      lines.push('');
    }
  }

  if (plan.risks.length > 0) {
    lines.push('Risks:');
    for (const r of plan.risks) {
      lines.push(`  - ${r}`);
    }
    lines.push('');
  }

  lines.push(`Requires approval: ${plan.requiresApproval}`);
  lines.push(`Blocked: ${plan.blocked}`);
  lines.push(`Next step: ${plan.nextStep}`);

  return lines.join('\n');
}

/**
 * Extract coordinate hints from memory context for OS control tasks.
 * Looks for patterns like "located at X, Y" or "coordinates: X, Y" in memory summaries.
 */
function extractCoordinateFromMemory(
  memCtx?: import('./memory-context.js').MemoryContextResult,
): { x: number; y: number } | null {
  if (!memCtx || !memCtx.memoryUsed) return null;
  const allItems = [...(memCtx.recentMemories || []), ...(memCtx.relevantMemories || [])];
  const coordPatterns = [
    /located at (\d+), (\d+)/i,
    /at coordinates? (\d+),\s*(\d+)/i,
    /position[:\s]+\(?(\d+),\s*(\d+)\)?/i,
    /screen[:\s]+\(?(\d+),\s*(\d+)\)?/i,
    /at \(?(\d+),\s*(\d+)\)?/i,
  ];
  for (const item of allItems) {
    const summary = item.summary || '';
    for (const pattern of coordPatterns) {
      const match = summary.match(pattern);
      if (match) {
        const x = parseInt(match[1], 10);
        const y = parseInt(match[2], 10);
        if (!isNaN(x) && !isNaN(y) && x >= 0 && y >= 0 && x <= 99999 && y <= 99999) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

/**
 * Extract key hints from memory context for OS control press_key tasks.
 */
function extractKeyHintFromMemory(
  memCtx?: import('./memory-context.js').MemoryContextResult,
): string | null {
  if (!memCtx || !memCtx.memoryUsed) return null;
  const allItems = [...(memCtx.recentMemories || []), ...(memCtx.relevantMemories || [])];
  const keyPatterns = [
    /press\s+(?:the\s+)?(\S+)\s+(?:key|button)/i,
    /keyboard shortcut[:\s]+(\S+)/i,
    /hotkey[:\s]+(\S+)/i,
  ];
  for (const item of allItems) {
    const summary = item.summary || '';
    for (const pattern of keyPatterns) {
      const match = summary.match(pattern);
      if (match) return match[1].toLowerCase();
    }
  }
  return null;
}
