import type { TaskKind } from './task-classifier.js';
import type { Message } from './types.js';
import { PROVIDER_TIERS } from '../config/keys.js';
import type { ProviderType } from '../config/keys.js';

const TASK_TIMEOUTS: Record<string, number> = {
  simple_chat: 20000,
  code_edit: 60000,
  debugging: 60000,
  code_review: 60000,
  coding_qa: 60000,
  long_context: 120000,
  long_reasoning: 180000,
  planning: 120000,
  project_scan: 120000,
  search: 30000,
  web_research: 30000,
  general_qa: 30000,
  image_vision: 30000,
  unknown: 30000,
};

const LOCAL_TIMEOUT_MS = 15000;

export function getTimeoutForTask(taskKind: TaskKind): number {
  return TASK_TIMEOUTS[taskKind] || 30000;
}

export function getProviderTimeoutForTask(provider: string, taskKind: TaskKind): number {
  const tier = PROVIDER_TIERS[provider as ProviderType];
  if (tier === 'local_free') return LOCAL_TIMEOUT_MS;
  return getTimeoutForTask(taskKind);
}

export function estimateTimeoutFromMessages(messages: Message[]): number {
  if (!messages || messages.length === 0) return 30000;

  let totalChars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as { type: string; text?: string }[]) {
        if (part.type === 'text') totalChars += part.text?.length || 0;
      }
    }
  }

  const messageCount = messages.length;

  if (totalChars > 50000 || messageCount > 20) return TASK_TIMEOUTS.long_context;
  if (totalChars > 10000 || messageCount > 10) return 90000;

  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const lastText = typeof lastUser?.content === 'string' ? lastUser.content : '';

  if (lastText.length > 150) return 90000;
  if (lastText.length > 60) return 60000;

  return TASK_TIMEOUTS.simple_chat;
}
