import { resolve } from 'node:path';
import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, PROVIDER_MODELS, TIER_LABELS, LOCAL_FREE_PROVIDERS, COMPACT_PROMPT_PROVIDERS } from '../config/keys.js';
import type { ProviderType, HysaConfig } from '../config/keys.js';
import { getProjectInfo } from '../context/builder.js';
import { readFile, shouldIgnore } from '../files/reader.js';
import { writeFileWithBackup, previewEdit } from '../files/writer.js';
import { getGitInfo } from '../utils/git.js';
import { createClient, isOnlyGreeting } from '../ai/client.js';
import type { Message } from '../ai/types.js';
import { buildSystemPrompt, resolvePromptMode } from '../prompts/system.js';
import { getYolo, setYolo, getProviderHealth } from '../utils/session.js';
import { toHealthSummary, getLastError, getLastFallbackUsed, getFallbackEvents } from '../ai/model-health.js';
import { detectSecrets } from '../utils/secrets.js';
import { estimateTokens, truncateMessages } from '../context/tokens.js';

const LOG = '[HYSA Chat]';

// ── Simple question detection ──────────────────────────

function isSimpleQuestion(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length > 60) return false;
  const actionWords = /\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe|apply|remove|delete|rename|move|copy|refactor)\b/i;
  if (actionWords.test(trimmed)) return false;
  return true;
}
const workingDir = resolve('.');

interface ChatRequest {
  messages: { role: string; content: string }[];
}

interface SaveFileRequest {
  path: string;
  content: string;
}

interface RunCommandRequest {
  command: string;
}

interface ChatResult {
  message: string;
  toolCalls: { type: string; params: Record<string, string> }[];
  error?: string;
  hint?: string;
  fallbackEvents?: string[];
  provider?: string;
  model?: string;
}

export function getStatus(): { provider: string; model: string; tier: string; git: { branch: string | null; hasChanges: boolean } | null } {
  const config = loadConfig();
  if (!config) {
    return { provider: 'not configured', model: '', tier: '', git: null };
  }
  const prov = config.currentProvider;
  const label = PROVIDER_DEFAULTS[prov]?.label || prov;
  const tier = PROVIDER_TIERS[prov];
  const tierLabel = tier ? TIER_LABELS[tier]?.label || '' : '';
  const gitInfo = getGitInfo(workingDir);
  return {
    provider: label,
    model: config.currentModel,
    tier: tierLabel,
    git: gitInfo.isRepo ? { branch: gitInfo.branch, hasChanges: gitInfo.hasChanges } : null,
  };
}

export function getConfig(): HysaConfig | null {
  return loadConfig();
}

export function updateConfig(partial: Partial<HysaConfig>): HysaConfig {
  const current = loadConfig() || {
    currentProvider: 'openrouter' as ProviderType,
    currentModel: PROVIDER_DEFAULTS.openrouter.model,
    apiKeys: {},
    ollamaBaseUrl: 'http://localhost:11434',
  };
  const merged = { ...current, ...partial };
  saveConfig(merged);
  return merged;
}

export function getProjectTree(): { tree: string; files: string[]; fileCount: number } {
  const info = getProjectInfo(workingDir);
  return {
    tree: info.tree,
    files: info.importantFiles,
    fileCount: info.fileCount,
  };
}

export function getFileContent(filePath: string): { content: string | null; error?: string } {
  const fullPath = resolve(workingDir, filePath);
  if (shouldIgnore(fullPath, workingDir)) {
    return { content: null, error: 'File is ignored (e.g. .env, node_modules)' };
  }
  const content = readFile(fullPath);
  if (content === null) {
    return { content: null, error: 'File not found or cannot be read' };
  }
  return { content };
}

export function saveFile(path: string, content: string): { success: boolean; error?: string; diff?: string } {
  const fullPath = resolve(workingDir, path);
  if (shouldIgnore(fullPath, workingDir)) {
    return { success: false, error: 'Cannot save: file is ignored or protected' };
  }
  const secrets = detectSecrets(content);
  if (secrets) {
    return { success: false, error: 'File contains potential secrets. Save blocked for safety.' };
  }
  const diff = previewEdit(fullPath, content);
  writeFileWithBackup(fullPath, content);
  return { success: true, diff: diff || undefined };
}

const LOCAL_HINTS: Record<string, { name: string; command: string }> = {
  ollama: { name: 'Ollama', command: 'ollama serve' },
  local_openai: { name: 'LM Studio', command: 'Start LM Studio and enable the local server (http://localhost:1234/v1)' },
  hysa_ai: { name: 'HYSA AI', command: 'hysa-ai serve' },
};

function getLocalProviderHint(msg: string, provider: string): string | undefined {
  const lower = msg.toLowerCase();
  if (provider === 'ollama' || lower.includes('ollama')) {
    return 'Ollama is not running locally. Start it with: ollama serve';
  }
  if (provider === 'local_openai' || lower.includes('lm studio') || lower.includes('local_openai')) {
    return 'LM Studio is not running. Start LM Studio → Local Inference Server → Start';
  }
  if (provider === 'hysa_ai' || lower.includes('hysa ai')) {
    return 'HYSA AI is not running. Start it with: hysa-ai serve';
  }
  return undefined;
}

export async function handleChatStream(
  req: ChatRequest,
  writeEvent: (event: string) => void,
): Promise<void> {
  const config = loadConfig();
  if (!config) {
    writeEvent(`data: ${JSON.stringify({ type: 'error', message: 'No configuration found. Run: hysa chat' })}\n\n`);
    return;
  }

  const prov = config.currentProvider;

  if (!req.messages || !Array.isArray(req.messages) || req.messages.length === 0) {
    writeEvent(`data: ${JSON.stringify({ type: 'error', message: 'Missing or empty messages array in request body' })}\n\n`);
    return;
  }

  try {
    const lastMessage = req.messages[req.messages.length - 1];
    if (lastMessage && lastMessage.role === 'user' && isOnlyGreeting(lastMessage.content)) {
      writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: 'Hi! How can I help with this project?', toolCalls: [] })}\n\n`);
      return;
    }

    const client = createClient(config);
    if (!client.sendMessageStream) {
      // Fall back to non-streaming
      const result = await handleChat(req);
      const msg = result.error || result.message || '';
      if (result.error) {
        writeEvent(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
      } else {
        writeEvent(`data: ${JSON.stringify({ type: 'token', text: msg })}\n\n`);
        writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: msg, toolCalls: result.toolCalls || [] })}\n\n`);
      }
      return;
    }

    const projectInfo = getProjectInfo(workingDir);
    const isLocal = LOCAL_FREE_PROVIDERS.includes(config.currentProvider);
    const lightActive = config.lightMode !== false && isLocal;

    const messages: Message[] = req.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    const maxTokens = lightActive ? 2000 : 8000;
    const { messages: safeMessages } = truncateMessages(messages, maxTokens);

    const lastUserMsg = safeMessages.filter(m => m.role === 'user').pop()?.content || '';
    const isSimpleQ = isSimpleQuestion(lastUserMsg);
    const resolvedMode = resolvePromptMode(config.promptMode || 'auto', config.currentProvider, isSimpleQ);

    const perQueryPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints,
      configFiles: projectInfo.configFiles,
      fileCount: projectInfo.fileCount,
      tree: projectInfo.tree.length < 3000 ? projectInfo.tree : projectInfo.tree.slice(0, 3000) + '\n... (truncated)',
    }, config.agentMode || 'chat', lightActive, config.currentProvider, resolvedMode);

    const response = await client.sendMessageStream(safeMessages, perQueryPrompt, (event) => {
      if (event.type === 'token') {
        writeEvent(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
      }
    });

    writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response.message, toolCalls: response.toolCalls })}\n\n`);
  } catch (err: unknown) {
    const e = err as Error;
    const msg = e.message || 'Unknown stream error';
    console.log(LOG, `Stream failed: ${msg}`);
    writeEvent(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
  }
}

export async function handleChat(req: ChatRequest): Promise<ChatResult> {
  const config = loadConfig();
  if (!config) {
    console.log(LOG, 'No config found');
    return { message: '', toolCalls: [], error: 'No configuration found. Run: hysa chat' };
  }

  const prov = config.currentProvider;

  if (!req.messages || !Array.isArray(req.messages) || req.messages.length === 0) {
    console.log(LOG, 'Missing or empty messages array in request body');
    return { message: '', toolCalls: [], error: 'Missing or empty messages array in request body' };
  }

  try {
    const lastMessage = req.messages[req.messages.length - 1];
    if (lastMessage && lastMessage.role === 'user' && isOnlyGreeting(lastMessage.content)) {
      console.log(LOG, 'Greeting detected, returning casual response');
      return { message: 'Hi! How can I help with this project?', toolCalls: [] };
    }
    const label = PROVIDER_DEFAULTS[prov]?.label || prov;
    console.log(LOG, `Starting chat with provider: ${label}, model: ${config.currentModel}`);

    const client = createClient(config);
    const projectInfo = getProjectInfo(workingDir);
    const gitInfo = getGitInfo(workingDir);

    const isLocal = LOCAL_FREE_PROVIDERS.includes(config.currentProvider);
    const lightActive = config.lightMode !== false && isLocal;
    const systemPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints,
      configFiles: projectInfo.configFiles,
      fileCount: projectInfo.fileCount,
      tree: projectInfo.tree.length < 3000 ? projectInfo.tree : projectInfo.tree.slice(0, 3000) + '\n... (truncated)',
    }, config.agentMode || 'chat', lightActive, config.currentProvider, config.promptMode || 'auto');

    const messages: Message[] = req.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const maxTokens = lightActive ? 2000 : 8000;
    const { messages: safeMessages, truncated: wasTruncated } = truncateMessages(messages, maxTokens);

    // ── Per-query prompt mode resolution ────────────────
    const lastUserMsg = safeMessages.filter(m => m.role === 'user').pop()?.content || '';
    const isSimpleQ = isSimpleQuestion(lastUserMsg);
    const resolvedMode = resolvePromptMode(
      config.promptMode || 'auto',
      config.currentProvider,
      isSimpleQ,
    );
    const perQueryPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints,
      configFiles: projectInfo.configFiles,
      fileCount: projectInfo.fileCount,
      tree: projectInfo.tree.length < 3000 ? projectInfo.tree : projectInfo.tree.slice(0, 3000) + '\n... (truncated)',
    }, config.agentMode || 'chat', lightActive, config.currentProvider, resolvedMode);

    if (config.debug) {
      const systemTokens = estimateTokens(perQueryPrompt);
      const historyTokens = safeMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      const totalTokens = systemTokens + historyTokens;
      console.log(LOG, `[debug] Prompt mode: ${resolvedMode}`);
      console.log(LOG, `[debug] System prompt: ~${systemTokens} tokens`);
      console.log(LOG, `[debug] History/messages: ~${historyTokens} tokens`);
      console.log(LOG, `[debug] Total estimated: ~${totalTokens} tokens`);
      if (lightActive && totalTokens > 2000) {
        console.log(LOG, `[debug] Local prompt trimmed from ~${totalTokens} tokens to ~2000 tokens.`);
      }
    }

    console.log(LOG, `Sending ${safeMessages.length} messages to provider ${wasTruncated ? '(trimmed)' : ''}`);
    const response = await client.sendMessage(safeMessages, perQueryPrompt);
    console.log(LOG, 'Provider response received successfully');

    const fbEvents = getFallbackEvents();
    const fallbackEvents = fbEvents.map(e => e.reason);

    return {
      message: response.message,
      toolCalls: response.toolCalls.map(tc => ({
        type: tc.type,
        params: tc.params,
      })),
      fallbackEvents: fallbackEvents.length > 0 ? fallbackEvents : undefined,
      provider: PROVIDER_DEFAULTS[prov]?.label || prov,
      model: config.currentModel,
    };
  } catch (err: unknown) {
    const e = err as Error;
    const msg = e.message || 'Unknown provider error';
    console.log(LOG, `Provider failed: ${msg}`);
    const lastErr = getLastError();
    const fbEvents = getFallbackEvents();
    const fallbackEvents = fbEvents.map(e => e.reason);
    const hint = getLocalProviderHint(msg, prov);
    return {
      message: '',
      toolCalls: [],
      error: msg,
      hint,
      fallbackEvents: fallbackEvents.length > 0 ? fallbackEvents : undefined,
    };
  }
}

export async function runCommand(command: string): Promise<{ stdout: string; stderr: string; error?: string }> {
  try {
    const { execSync } = await import('node:child_process');
    const stdout = execSync(command, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      cwd: workingDir,
      shell: process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : undefined,
    });
    return { stdout: stdout.trim(), stderr: '' };
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string; stdout?: string };
    return {
      stdout: e.stdout?.toString().trim() || '',
      stderr: e.stderr?.toString().trim() || '',
      error: e.message || 'Command failed',
    };
  }
}

export function getFilePreview(path: string, content: string): string | null {
  const fullPath = resolve(workingDir, path);
  return previewEdit(fullPath, content);
}

export function getYoloStatus(): { enabled: boolean } {
  return { enabled: getYolo() };
}

export function setYoloStatus(enabled: boolean): { enabled: boolean } {
  setYolo(enabled);
  return { enabled };
}

export function getFallbackStatus(): { unhealthy: string[]; lastError: { provider: string; model: string; reason: string } | null; lastFallback: string | null } {
  const summary = toHealthSummary();
  const lastErr = getLastError();
  return {
    unhealthy: summary,
    lastError: lastErr ? { provider: lastErr.provider, model: lastErr.model, reason: lastErr.reason } : null,
    lastFallback: getLastFallbackUsed(),
  };
}
