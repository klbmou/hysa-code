import React, { useState, useEffect, useCallback, useRef } from 'react';
import TopBar from './components/TopBar.js';
import FileTree from './components/FileTree.js';
import RightPanel from './components/RightPanel.js';
import Composer, { Attachment } from './components/Composer.js';
import MessageBubble from './components/MessageBubble.js';
import HysaIntro from './components/HysaIntro.js';
import ToolEvent from './components/ToolEvent.js';
import DiffCard from './components/DiffCard.js';
import CommandCard from './components/CommandCard.js';
import PlanCard from './components/PlanCard.js';
import StatusBar from './components/StatusBar.js';

const TIMEOUT_MS = 30000;
const CONFIRM_PATTERNS = [/^(ok\s*)?do\s*it$/i, /^yes$/i, /^apply$/i, /^go\s*ahead$/i, /^proceed$/i, /^yeah\s*do\s*it$/i];
const PROPOSAL_PATTERNS = [/should I/i, /would you like/i, /i can start/i, /shall I/i];

type LoadingPhase = 'thinking' | 'reading' | 'running' | 'continuing' | 'finalizing' | '';

const PHASE_LABELS: Record<Exclude<LoadingPhase, ''>, string> = {
  thinking: 'Thinking...',
  reading: 'Reading project files...',
  running: 'Running safe command...',
  continuing: 'Continuing after tool result...',
  finalizing: 'Finalizing answer...',
};

interface TimingData {
  classification?: number;
  project_scan?: number;
  context_select?: number;
  provider?: number;
  total?: number;
  tool_steps?: number;
  routing_mode?: string;
  capability?: string;
  project_mode?: boolean;
  files_selected?: number;
}

const LOG = '[HYSA Web Chat]';

function getAssistantText(data: any): string {
  return data.message || data.response || data.content || data.text || data.assistantMessage || '';
}

interface StatusData {
  provider: string;
  model: string;
  tier: string;
  visionCapable: boolean;
  git: { branch: string | null; hasChanges: boolean } | null;
}

interface ToolCall {
  type: string;
  params: Record<string, string>;
}

interface Source {
  title: string;
  url: string;
  snippet?: string;
  rank: number;
}

type ChatItem = {
  id: string;
} & (
  | { kind: 'user_msg'; content: string; attachments?: Attachment[]; skipInHistory?: boolean }
  | { kind: 'ai_msg'; content: string; sources?: Source[] }
  | { kind: 'plan_card'; plan: any; currentStep?: number }
  | { kind: 'tool_event'; eventType: 'read' | 'edit' | 'done' | 'run' | 'error' | 'fallback' | 'search' | 'file' | 'image'; message: string }
  | { kind: 'diff_card'; filePath: string; content: string; diff: string }
  | { kind: 'command_card'; command: string; toolCall?: ToolCall }
  | { kind: 'tool_result'; content: string }
  | { kind: 'image_card'; imageUrl: string; prompt: string; promptUsed?: string }
);

type RightTab = 'code' | 'diff' | 'terminal';

function isArabic(text: string): boolean {
  const arabicRange = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return arabicRange.test(text);
}

let idCounter = 0;
function nextId(): string { return `item_${++idCounter}`; }

function hasProposal(text: string): boolean {
  return PROPOSAL_PATTERNS.some(p => p.test(text)) || text.includes('```');
}

function isConfirmation(text: string): boolean {
  return CONFIRM_PATTERNS.some(p => p.test(text.trim()));
}

function stripSearchTags(text: string): string {
  return text
    .replace(/<[\/]?Ø¨Ø­Ø«>/g, '')
    .replace(/<[\/]?search>/gi, '')
    .replace(/<[\/]?RESULT>/g, '')
    .replace(/<[\/]?result>/gi, '');
}

function stripSourcesSection(text: string): string {
  const lines = text.split('\n');
  let stripIdx = -1;

  // Detect source section headers and URL/domain blocks from bottom up
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();

    // Match source section headers (including bold markdown, colon variants)
    if (/^(?:\*\*)?(?:Sources?|References?|Citations?|Links?|Ù…ØµØ§Ø¯Ø±|Ø§Ù„Ù…ØµØ§Ø¯Ø±|Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹|Ø±ÙˆØ§Ø¨Ø·|Ø§Ù„Ù…ØµØ¯Ø±|Ù…ØµØ¯Ø±)(?:\*\*)?:?\s*$/i.test(line)) {
      let nextNonEmpty = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) { nextNonEmpty = j; break; }
      }
      if (nextNonEmpty < 0) { stripIdx = i; break; }
      const next = lines[nextNonEmpty].trim();
      if (/^\d+[.)]\s/.test(next) || /^[-*]\s/.test(next) || /https?:\/\//i.test(next) || /^\[.+\]/.test(next)) {
        stripIdx = i; break;
      }
    }

    // Also match bold with colon inside: **Ø§Ù„Ù…ØµØ§Ø¯Ø±:**
    if (!line) continue;
    if (/^\*\*(?:Sources?|References?|Citations?|Links?|Ù…ØµØ§Ø¯Ø±|Ø§Ù„Ù…ØµØ§Ø¯Ø±|Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹|Ø±ÙˆØ§Ø¨Ø·|Ø§Ù„Ù…ØµØ¯Ø±|Ù…ØµØ¯Ø±):\s*\*\*$/i.test(line)) {
      let nextNonEmpty = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) { nextNonEmpty = j; break; }
      }
      if (nextNonEmpty < 0) { stripIdx = i; break; }
      const next = lines[nextNonEmpty].trim();
      if (/^\d+[.)]\s/.test(next) || /^[-*]\s/.test(next) || /https?:\/\//i.test(next) || /^\[.+\]/.test(next)) {
        stripIdx = i; break;
      }
    }
  }

  if (stripIdx >= 0) {
    const result = lines.slice(0, stripIdx).join('\n').trim();
    console.log(`[Sources] stripped: removed ${lines.length - stripIdx} lines from "${text.slice(-150)}"`);
    return result;
  }
  return text.trim();
}

const AR_TO_EN_IMG: Record<string, string> = {
  'Ù‚Ø±Ø¯': 'monkey', 'Ù‚Ø·': 'cat', 'Ù‚Ø·Ø©': 'cat', 'ÙƒÙ„Ø¨': 'dog',
  'Ù…Ø¯ÙŠÙ†Ø© Ù…Ø³ØªÙ‚Ø¨Ù„ÙŠØ©': 'futuristic city', 'Ø´Ø¹Ø§Ø±': 'logo',
  'Ø±Ø¬Ù„': 'man', 'Ø§Ù…Ø±Ø£Ø©': 'woman', 'Ø³ÙŠØ§Ø±Ø©': 'car', 'Ù…Ù†Ø²Ù„': 'house',
  'Ø´Ø§Ø·Ø¦': 'beach', 'ÙØ¶Ø§Ø¡': 'space', 'Ø±ÙˆØ¨ÙˆØª': 'robot', 'ØªÙ†ÙŠÙ†': 'dragon',
  'ÙˆØ±Ø¯': 'flower', 'Ø²Ù‡Ø±Ø©': 'flower', 'Ø·Ø§Ø¦Ø±': 'bird', 'Ø­ØµØ§Ù†': 'horse',
  'Ø£Ø³Ø¯': 'lion', 'Ø³Ù…Ø§Ø¡': 'sky', 'Ø¨Ø­Ø±': 'sea', 'ØºØ±ÙˆØ¨': 'sunset',
  'Ù…Ù†Ø¸Ø± Ø·Ø¨ÙŠØ¹ÙŠ': 'nature landscape', 'ÙØ§ÙƒÙ‡Ø©': 'fruit', 'Ø´Ø¬Ø±Ø©': 'tree',
  'Ø¬Ø¨Ù„': 'mountain', 'Ù†Ù‡Ø±': 'river', 'ØºØ§Ø¨Ø©': 'forest', 'ØµØ­Ø±Ø§Ø¡': 'desert',
  'Ù‚Ù…Ø±': 'moon', 'Ù†Ø¬Ù…Ø©': 'star', 'Ù…Ø·Ø±': 'rain', 'Ø«Ù„Ø¬': 'snow',
  'Ù†Ø§Ø±': 'fire', 'Ù…Ø§Ø¡': 'water', 'ÙƒØªØ§Ø¨': 'book', 'Ø·Ø§ÙˆÙ„Ø©': 'table',
  'ÙƒØ±Ø³ÙŠ': 'chair', 'Ø¨Ø§Ø¨': 'door', 'Ù†Ø§ÙØ°Ø©': 'window', 'Ù‡Ø§ØªÙ': 'phone',
  'Ø­Ø§Ø³ÙˆØ¨': 'computer', 'Ø·Ø¹Ø§Ù…': 'food', 'Ø³Ù…Ø§Ø¡ Ù„ÙŠÙ„': 'night sky',
  'ØºØ±ÙˆØ¨ Ø´Ù…Ø³': 'sunset', 'Ø´Ø±ÙˆÙ‚ Ø´Ù…Ø³': 'sunrise',
};

function normalizeImagePrompt(prompt: string): { original: string; used: string; normalized: boolean } {
  const trimmed = prompt.trim();
  if (!/[\u0600-\u06FF]/.test(trimmed)) return { original: trimmed, used: trimmed, normalized: false };
  let cleaned = trimmed.replace(/^(?:ØµÙˆØ±Ø©|Ø±Ø³Ù…Ø©|Ø´Ø¹Ø§Ø±|ØªØµÙ…ÙŠÙ…|Ù„ÙˆØ­Ø©)\s+(?:Ù„Ù€?|Ø¹Ù†|Ù…Ù†)?\s*/i, '').trim();
  for (const [ar, en] of Object.entries(AR_TO_EN_IMG)) {
    if (cleaned === ar || cleaned.startsWith(ar + ' ') || cleaned.endsWith(' ' + ar)) {
      return { original: trimmed, used: en, normalized: true };
    }
  }
  let bestMatch = '';
  let bestKey = '';
  for (const [ar, en] of Object.entries(AR_TO_EN_IMG)) {
    if (cleaned.includes(ar) && ar.length > bestKey.length) {
      bestMatch = en;
      bestKey = ar;
    }
  }
  if (bestMatch) return { original: trimmed, used: bestMatch, normalized: true };
  return { original: trimmed, used: trimmed, normalized: false };
}

const I18N: Record<string, Record<string, string>> = {
  en: {
    'hero.ready': 'Ready when you are.',
    'hero.sub': 'Ask about code, search the web, generate images, or just chat.',
    'hero.explain': 'Explain',
    'hero.search': 'Search',
    'hero.generate': 'Generate',
    'hero.findBugs': 'Find bugs',
    'hero.improveUI': 'Improve UI',
    'hero.tests': 'Tests',
    'home.suggested': 'Suggested Workflows',
    'dash.status': 'Status',
    'dash.provider': 'Provider',
    'dash.model': 'Model',
    'dash.branch': 'Branch',
    'dash.files': 'Files',
    'dash.tips': 'Quick Tips',
    'dash.capabilities': 'Capabilities',
    'dash.activity': 'Activity',
    'dash.empty': 'No recent activity yet',
    'dash.commands': 'Quick Commands',
    'dash.cmd.chat': 'hysa chat â€” interactive AI',
    'dash.cmd.web': 'hysa web â€” browser UI',
    'dash.cmd.config': 'hysa config â€” settings',
    'dash.cmd.doctor': 'hysa doctor â€” diagnose',
    'dash.cmd.providers': 'hysa providers â€” list',
    'dash.shortcuts': 'Keyboard Shortcuts',
    'dash.sc.send': 'Enter â€” send message',
    'dash.sc.newline': 'Shift+Enter â€” new line',
    'dash.sc.sidebar': 'Ctrl+B â€” toggle sidebar',
    'dash.sc.settings': 'Ctrl+, â€” open settings',
    'dash.sc.upload': 'Ctrl+U â€” upload file',
    'dash.tip.imagine': 'Type /imagine to generate images',
    'dash.tip.search': 'Ask "Search the web for..."',
    'dash.tip.attach': 'Attach files, PDFs, or images',
    'dash.tip.debug': 'Use /debug to toggle debug mode',
    'dash.tip.start': 'Click a card above to get started',
    'image.generated': 'Generated',
    'image.promptUsed': 'Prompt used:',
    'image.loading': 'Loading image...',
    'image.retrying': 'Retrying...',
    'image.retry': 'Retry',
    'image.failed': 'Image failed to load',
    'image.open': 'Open image',
    'image.openDirectly': 'Open directly',
    'settings.title': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.theme': 'Theme',
    'settings.compact': 'Compact mode',
    'settings.language': 'UI Language',
    'settings.languageGroup': 'Language',
    'settings.responseLang': 'Default response language',
    'settings.features': 'Features',
    'settings.webSearch': 'Web search',
    'settings.imageGen': 'Image generation',
    'settings.showSources': 'Show sources',
    'settings.actions': 'Actions',
    'settings.clearChat': 'Clear chat',
    'settings.clearCache': 'Clear local cache',
    'settings.dark': 'Dark',
    'settings.light': 'Light',
    'settings.system': 'System',
    'settings.auto': 'Auto',
    'settings.arabic': 'Arabic',
    'settings.english': 'English',
    'status.connecting': 'Connecting to server...',
    'composer.placeholder': 'Ask about code, files, PDFs, images, or anything...',
    'composer.hint': 'Enter to send \u00B7 Shift+Enter for newline',
    'source.sources': 'Sources',
    'image.genDisabled': 'Image generation is disabled in Settings.',
    'search.webSearch': 'Search the web for',
  },
  ar: {
    'hero.ready': 'Ø¬Ø§Ù‡Ø² Ø¹Ù†Ø¯Ù…Ø§ ØªÙƒÙˆÙ†.',
    'hero.sub': 'Ø§Ø³Ø£Ù„ Ø¹Ù† Ø§Ù„ÙƒÙˆØ¯ØŒ Ø§Ø¨Ø­Ø« ÙÙŠ Ø§Ù„ÙˆÙŠØ¨ØŒ Ø£Ù†Ø´Ø¦ ØµÙˆØ±Ù‹Ø§ØŒ Ø£Ùˆ ÙÙ‚Ø· ØªØ­Ø¯Ø«.',
    'hero.explain': 'Ø´Ø±Ø­',
    'hero.search': 'Ø¨Ø­Ø«',
    'hero.generate': 'Ø¥Ù†Ø´Ø§Ø¡',
    'hero.findBugs': 'Ø¥ÙŠØ¬Ø§Ø¯ Ø§Ù„Ø£Ø®Ø·Ø§Ø¡',
    'hero.improveUI': 'ØªØ­Ø³ÙŠÙ† Ø§Ù„ÙˆØ§Ø¬Ù‡Ø©',
    'hero.tests': 'Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª',
    'home.suggested': 'Ø³ÙŠØ± Ø§Ù„Ø¹Ù…Ù„ Ø§Ù„Ù…Ù‚ØªØ±Ø­Ø©',
    'dash.status': 'Ø§Ù„Ø­Ø§Ù„Ø©',
    'dash.provider': 'Ø§Ù„Ù…ÙˆØ²Ø¹',
    'dash.model': 'Ø§Ù„Ù†Ù…ÙˆØ°Ø¬',
    'dash.branch': 'Ø§Ù„ÙØ±Ø¹',
    'dash.files': 'Ø§Ù„Ù…Ù„ÙØ§Øª',
    'dash.tips': 'Ù†ØµØ§Ø¦Ø­ Ø³Ø±ÙŠØ¹Ø©',
    'dash.capabilities': 'Ø§Ù„Ø¥Ù…ÙƒØ§Ù†ÙŠØ§Øª',
    'dash.activity': 'Ø§Ù„Ù†Ø´Ø§Ø·',
    'dash.empty': 'Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ù†Ø´Ø§Ø· Ø­Ø¯ÙŠØ« Ø¨Ø¹Ø¯',
    'dash.commands': 'Ø£ÙˆØ§Ù…Ø± Ø³Ø±ÙŠØ¹Ø©',
    'dash.cmd.chat': 'hysa chat â€” Ù…Ø­Ø§Ø¯Ø«Ø© ØªÙØ§Ø¹Ù„ÙŠØ©',
    'dash.cmd.web': 'hysa web â€” ÙˆØ§Ø¬Ù‡Ø© Ø§Ù„Ù…ØªØµÙØ­',
    'dash.cmd.config': 'hysa config â€” Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª',
    'dash.cmd.doctor': 'hysa doctor â€” Ø§Ù„ØªØ´Ø®ÙŠØµ',
    'dash.cmd.providers': 'hysa providers â€” Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©',
    'dash.shortcuts': 'Ø§Ø®ØªØµØ§Ø±Ø§Øª Ù„ÙˆØ­Ø© Ø§Ù„Ù…ÙØ§ØªÙŠØ­',
    'dash.sc.send': 'Enter â€” Ø¥Ø±Ø³Ø§Ù„',
    'dash.sc.newline': 'Shift+Enter â€” Ø³Ø·Ø± Ø¬Ø¯ÙŠØ¯',
    'dash.sc.sidebar': 'Ctrl+B â€” ÙØªØ­ Ø§Ù„Ø´Ø±ÙŠØ· Ø§Ù„Ø¬Ø§Ù†Ø¨ÙŠ',
    'dash.sc.settings': 'Ctrl+, â€” Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª',
    'dash.sc.upload': 'Ctrl+U â€” Ø±ÙØ¹ Ù…Ù„Ù',
    'dash.tip.imagine': '/imagine Ø§ÙƒØªØ¨ Ù„Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„ØµÙˆØ±',
    'dash.tip.search': 'Ø§Ø·Ù„Ø¨ "Ø§Ø¨Ø­Ø« ÙÙŠ Ø§Ù„ÙˆÙŠØ¨ Ø¹Ù†..."',
    'dash.tip.attach': 'Ø£Ø±ÙÙ‚ Ù…Ù„ÙØ§Øª Ø£Ùˆ PDF Ø£Ùˆ ØµÙˆØ±Ù‹Ø§',
    'dash.tip.debug': '/debug Ø§Ø³ØªØ®Ø¯Ù… Ù„ØªÙØ¹ÙŠÙ„ ÙˆØ¶Ø¹ Ø§Ù„ØªØµØ­ÙŠØ­',
    'dash.tip.start': 'Ø§Ù†Ù‚Ø± Ø¹Ù„Ù‰ Ø¨Ø·Ø§Ù‚Ø© Ø£Ø¹Ù„Ø§Ù‡ Ù„Ù„Ø¨Ø¯Ø¡',
    'image.generated': 'ØªÙ… Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡',
    'image.promptUsed': 'Ø§Ù„Ù†Øµ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…:',
    'image.loading': 'Ø¬Ø§Ø±Ù ØªØ­Ù…ÙŠÙ„ Ø§Ù„ØµÙˆØ±Ø©...',
    'image.retrying': 'Ø¬Ø§Ø±Ù Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©...',
    'image.retry': 'Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©',
    'image.failed': 'ÙØ´Ù„ ØªØ­Ù…ÙŠÙ„ Ø§Ù„ØµÙˆØ±Ø©',
    'image.open': 'ÙØªØ­ Ø§Ù„ØµÙˆØ±Ø©',
    'image.openDirectly': 'ÙØªØ­ Ù…Ø¨Ø§Ø´Ø±Ø©',
    'settings.title': 'Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª',
    'settings.appearance': 'Ø§Ù„Ù…Ø¸Ù‡Ø±',
    'settings.theme': 'Ø§Ù„Ø³Ù…Ø©',
    'settings.compact': 'Ø§Ù„ÙˆØ¶Ø¹ Ø§Ù„Ù…Ø¶ØºÙˆØ·',
    'settings.language': 'Ù„ØºØ© Ø§Ù„ÙˆØ§Ø¬Ù‡Ø©',
    'settings.languageGroup': 'Ø§Ù„Ù„ØºØ©',
    'settings.responseLang': 'Ù„ØºØ© Ø§Ù„Ø±Ø¯ Ø§Ù„Ø§ÙØªØ±Ø§Ø¶ÙŠØ©',
    'settings.features': 'Ø§Ù„Ù…ÙŠØ²Ø§Øª',
    'settings.webSearch': 'Ø§Ù„Ø¨Ø­Ø« ÙÙŠ Ø§Ù„ÙˆÙŠØ¨',
    'settings.imageGen': 'Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„ØµÙˆØ±',
    'settings.showSources': 'Ø¥Ø¸Ù‡Ø§Ø± Ø§Ù„Ù…ØµØ§Ø¯Ø±',
    'settings.actions': 'Ø§Ù„Ø¥Ø¬Ø±Ø§Ø¡Ø§Øª',
    'settings.clearChat': 'Ù…Ø³Ø­ Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø©',
    'settings.clearCache': 'Ù…Ø³Ø­ Ø§Ù„Ø°Ø§ÙƒØ±Ø© Ø§Ù„Ù…Ø¤Ù‚ØªØ©',
    'settings.dark': 'Ø¯Ø§ÙƒÙ†',
    'settings.light': 'ÙØ§ØªØ­',
    'settings.system': 'ØªÙ„Ù‚Ø§Ø¦ÙŠ',
    'settings.auto': 'ØªÙ„Ù‚Ø§Ø¦ÙŠ',
    'settings.arabic': 'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©',
    'settings.english': 'Ø§Ù„Ø¥Ù†Ø¬Ù„ÙŠØ²ÙŠØ©',
    'status.connecting': 'Ø¬Ø§Ø±Ù Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ø§Ù„Ø®Ø§Ø¯Ù…...',
    'composer.placeholder': 'Ø§Ø³Ø£Ù„ Ø¹Ù† Ø§Ù„ÙƒÙˆØ¯ Ø£Ùˆ Ø§Ù„Ù…Ù„ÙØ§Øª Ø£Ùˆ PDF Ø£Ùˆ Ø§Ù„ØµÙˆØ± Ø£Ùˆ Ø£ÙŠ Ø´ÙŠØ¡...',
    'composer.hint': 'Enter Ù„Ù„Ø¥Ø±Ø³Ø§Ù„ \u00B7 Shift+Enter Ù„Ø³Ø·Ø± Ø¬Ø¯ÙŠØ¯',
    'source.sources': 'Ø§Ù„Ù…ØµØ§Ø¯Ø±',
    'image.genDisabled': 'Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„ØµÙˆØ± Ù…Ø¹Ø·Ù„ ÙÙŠ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª.',
    'search.webSearch': 'Ø§Ø¨Ø­Ø« ÙÙŠ Ø§Ù„ÙˆÙŠØ¨ Ø¹Ù†',
  },
};

function useT(lang: string, key: string): string {
  if (lang === 'auto') lang = 'en';
  return I18N[lang]?.[key] || I18N.en[key] || key;
}

function isSimpleQuestion(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length > 60) return false;
  const actionWords = /\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe|apply|remove|delete|rename|move|copy|refactor)\b/i;
  return !actionWords.test(trimmed);
}

function ImageCard({ imageUrl, prompt, promptUsed, lang }: { imageUrl: string; prompt: string; promptUsed?: string; lang: string }) {
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayPromptUsed = promptUsed && promptUsed !== prompt ? promptUsed : undefined;
  const imgPrompt = displayPromptUsed || prompt;
  const cacheBuster = retryCount > 0 ? `${Date.now()}_${retryCount}` : '';
  const proxyUrl = buildProxyUrl(imgPrompt, cacheBuster);
  const directUrl = buildPollinationsUrl(imgPrompt);

  useEffect(() => {
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);

  const handleImgError = () => {
    if (retryCount < 2) {
      console.log(`[WebImage] load error, auto-retry ${retryCount + 1}/2 proxyUrl="${proxyUrl}"`);
      retryTimerRef.current = setTimeout(() => {
        setRetryCount(prev => prev + 1);
        setLoadError(false);
        setLoaded(false);
      }, 2000);
    } else {
      console.log(`[WebImage] load error, giving up after ${retryCount} retries`);
      setLoadError(true);
    }
  };

  const handleRetry = () => {
    console.log(`[WebImage] manual retry`);
    setRetryCount(prev => prev + 1);
    setLoadError(false);
    setLoaded(false);
  };

  const t = (key: string) => useT(lang, key);

  return (
    <div className="msg-row">
      <div className="assistant-inner">
        <div className="avatar">
          <span className="avatar-h">H</span>
        </div>
        <div className="assistant-block">
          <div className="image-card">
            <div className="image-card-header">
              <span className="image-card-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </span>
              <span className="image-card-label">{t('image.generated')}</span>
              <span className="image-card-prompt">{prompt}</span>
            </div>
            {displayPromptUsed && (
              <div className="image-card-prompt-used">{t('image.promptUsed')} {displayPromptUsed}</div>
            )}
            <div className={`image-card-preview${loadError ? ' error' : ''}`}>
              {!loaded && !loadError && (
                <div className="image-card-loading">
                  <span className="image-card-spinner" />
                  <span>{retryCount > 0 ? t('image.retrying') : t('image.loading')}</span>
                </div>
              )}
              {loadError ? (
                <div className="image-card-error">
                  <span className="image-card-error-text">{t('image.failed')}</span>
                  <div className="image-card-error-actions">
                    <button className="image-card-retry-btn" onClick={handleRetry}>{t('image.retry')}</button>
                    <a href={directUrl} target="_blank" rel="noopener noreferrer" className="image-card-link">{t('image.openDirectly')}</a>
                  </div>
                </div>
              ) : (
                <img
                  key={proxyUrl}
                  src={proxyUrl}
                  alt={prompt}
                  className={`image-card-img${loaded ? ' loaded' : ''}`}
                  onLoad={() => { setLoaded(true); console.log(`[WebImage] loaded proxy="${proxyUrl}"`); }}
                  onError={handleImgError}
                />
              )}
            </div>
            <div className="image-card-footer">
              <a href={directUrl} target="_blank" rel="noopener noreferrer" className="image-card-link">{t('image.open')}</a>
              <span className="image-card-url" title={directUrl}>{directUrl}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('code');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string | null>(null);
  const [terminalType, setTerminalType] = useState<'output' | 'error'>('output');
  const [yolo, setYolo] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [thinkingWarning, setThinkingWarning] = useState('');
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('');
  const [timingData, setTimingData] = useState<TimingData | null>(null);
  const [debug, setDebug] = useState(false);
  const [lastRawResponse, setLastRawResponse] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealPos, setRevealPos] = useState(0);
  const [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('hysa-web-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          theme: parsed.theme || 'dark',
          language: parsed.language || 'auto',
          defaultResponseLang: parsed.defaultResponseLang || 'auto',
          webSearch: parsed.webSearch !== false,
          imageGen: parsed.imageGen !== false,
          showSources: parsed.showSources !== false,
          compactMode: parsed.compactMode || false,
          mobileLayout: parsed.mobileLayout || 'default',
        };
      }
    } catch {}
    return {
      theme: 'dark' as 'dark' | 'system' | 'light',
      language: 'auto' as 'ar' | 'en' | 'auto',
      defaultResponseLang: 'auto' as 'ar' | 'en' | 'auto',
      webSearch: true,
      imageGen: true,
      showSources: true,
      compactMode: false,
      mobileLayout: 'default' as 'default' | 'drawer',
    };
  });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const thinkingStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingMsgsRef = useRef<{ role: string; content: string }[] | null>(null);
  const treeCacheRef = useRef<{ files: string[]; fileCount: number } | null>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatItems]);
  useEffect(() => { if (loading) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [loading]);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    // Use cached tree if available
    if (treeCacheRef.current) {
      setFiles(treeCacheRef.current.files);
      setFileCount(treeCacheRef.current.fileCount);
    } else {
      fetch('/api/project/tree').then(r => r.json()).then(data => {
        const result = { files: data.files || [], fileCount: data.fileCount || 0 };
        treeCacheRef.current = result;
        setFiles(result.files);
        setFileCount(result.fileCount);
      }).catch(() => {});
    }
    fetch('/api/yolo').then(r => r.json()).then(data => {
      if (data && typeof data.enabled === 'boolean') setYolo(data.enabled);
    }).catch(() => {});
  }, []);

  const openFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    setRightOpen(true);
    setRightTab('code');
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setFileContent(data.content !== undefined ? data.content : `// ${data.error || 'Cannot read file'}`);
    } catch { setFileContent('// Error loading file'); }
  }, []);

  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const res = await fetch('/api/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: fileContent }),
      });
      const data = await res.json();
      if (data.success) { setSaveMsg('Saved'); setTimeout(() => setSaveMsg(null), 2000); }
      else { setSaveMsg(`Error: ${data.error}`); setTimeout(() => setSaveMsg(null), 4000); }
    } catch { setSaveMsg('Error saving file'); setTimeout(() => setSaveMsg(null), 4000); }
  }, [selectedFile, fileContent]);

  const applyEdit = useCallback(async (filePath: string, content: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await res.json();
      if (data.success) { if (selectedFile === filePath) setFileContent(content); return null; }
      return data.error || 'Failed to save';
    } catch (err: unknown) { return (err as Error).message; }
  }, [selectedFile]);

  const runCommand = useCallback(async (command: string) => {
    try {
      setRightOpen(true); setRightTab('terminal');
      setTerminalOutput(`Running: ${command}...`); setTerminalType('output');
      const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) });
      const data = await res.json();
      const outputText = data.stdout || ''; const errorText = data.error || data.stderr || '';
      if (errorText) { setTerminalType('error'); setTerminalOutput(errorText); }
      else { setTerminalOutput(outputText); }
      return { stdout: outputText, stderr: errorText, error: data.error };
    } catch (err: unknown) {
      const msg = (err as Error).message;
      setTerminalType('error'); setTerminalOutput(msg);
      return { stdout: '', stderr: msg, error: msg };
    }
  }, []);

  const buildMessages = useCallback((items: ChatItem[]): { role: string; content: string }[] => {
    const msgs: { role: string; content: string }[] = [];
    let skippedCount = 0;
    for (const item of items) {
      if (item.kind === 'user_msg' && !item.content.startsWith('/') && !item.skipInHistory) {
        msgs.push({ role: 'user', content: item.content });
      } else if (item.kind === 'ai_msg' && item.content) {
        msgs.push({ role: 'assistant', content: item.content });
      } else if (item.kind === 'user_msg' && (item.content.startsWith('/') || item.skipInHistory)) {
        skippedCount++;
      }
    }
    if (skippedCount > 0) console.log(`[ChatMode] filtered ${skippedCount} UI-only user messages from history`);
    return msgs;
  }, []);

  const updateProviderStatus = useCallback((provider?: string, model?: string) => {
    if (!provider && !model) return;
    setStatus(prev => prev
      ? { ...prev, provider: provider || prev.provider, model: model || prev.model }
      : prev);
  }, []);

  const continueAfterTool = useCallback(async (tc: ToolCall, result: string) => {
    const msgs = pendingMsgsRef.current || buildMessages(chatItems);
    setLoading(true);
    setLoadingPhase('continuing');
    try {
      const res = await fetch('/api/chat/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs,
          toolCalls: [tc],
          toolResults: [result],
        }),
      });
      const data = await res.json();
      updateProviderStatus(data.provider, data.model);

      if (data.message) {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: data.message }]);
        pendingMsgsRef.current = msgs ? [...msgs, { role: 'assistant', content: data.message }] : null;
      }

      if (data.toolCalls && data.toolCalls.length > 0) {
        const toolItems: ChatItem[] = [];
        for (const t of data.toolCalls as ToolCall[]) {
          if (t.type === 'read_file') {
            toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'done', message: `Read ${t.params.filePath || ''}` });
            openFile(t.params.filePath || '');
          } else if (t.type === 'edit_file') {
            const fp = t.params.filePath || '';
            const nc = t.params.newContent || t.params.content || '';
            toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'edit', message: `Proposed edit for ${fp}` });
            try {
              const previewRes = await fetch('/api/file/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fp, content: nc }) });
              const previewData = await previewRes.json();
              toolItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: previewData.diff || 'No diff available' });
            } catch { toolItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: 'Error generating diff' }); }
          } else if (t.type === 'execute_command') {
            toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Command: ${t.params.command || ''}` });
            toolItems.push({ id: nextId(), kind: 'command_card', command: t.params.command || '', toolCall: t });
          } else {
            toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Tool: ${t.type}` });
          }
        }
        setChatItems(prev => [...prev, ...toolItems]);
      } else {
        pendingMsgsRef.current = null;
      }
    } catch {
      setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'Continuation failed. Please try again.' }]);
      pendingMsgsRef.current = null;
    } finally {
      setLoading(false);
      setLoadingPhase('');
    }
  }, [chatItems, buildMessages, openFile, updateProviderStatus]);

  const toggleYolo = useCallback(async () => {
    const newVal = !yolo; setYolo(newVal);
    try { await fetch('/api/yolo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: newVal }) }); } catch {}
  }, [yolo]);

  const clearState = useCallback(() => {
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
    setLoading(false);
    setElapsedSecs(0);
    setThinkingWarning('');
    setLoadingPhase('');
    setRevealingId(null);
    setRevealPos(0);
    setNotice('');
  }, []);

  const cancelThinking = useCallback(() => {
    console.debug(LOG, 'Cancel button clicked');
    clearState();
    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: 'Request canceled.' }]);
  }, [clearState]);

  const clearChat = useCallback(() => {
    console.debug(LOG, 'Clear chat');
    setChatItems([]);
    setLastRawResponse(null);
    setNotice('');
  }, []);

  const addError = useCallback((msg: string) => {
    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'error', message: msg }]);
  }, []);

  const sendMessage = useCallback(async (input: string, attachments?: Attachment[]) => {
    console.debug(LOG, '=== sendMessage start ===');
    console.debug(LOG, 'Input:', JSON.stringify(input));
    console.debug(LOG, 'Attachments:', attachments?.length || 0);
    console.debug(LOG, 'loading:', loading, 'debug:', debug);
    console.debug(LOG, 'chatItems count:', chatItems.length);

    if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
    setRevealingId(null);
    setRevealPos(0);

    if (input.startsWith('/')) {
      const cmd = input.slice(1).trim().toLowerCase();
      if (cmd === 'debug') {
        const newVal = !debug;
        setDebug(newVal);
        console.debug(LOG, 'Debug mode toggled:', newVal);
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: `Debug mode ${newVal ? 'ON' : 'OFF'}` }]);
        return;
      }
      if (cmd.startsWith('imagine')) {
        if (!settings.imageGen) {
          setChatItems(prev => [...prev, { id: nextId(), kind: 'user_msg', content: input }]);
          setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: useT(settings.language, 'image.genDisabled') }]);
          return;
        }
        const rawPrompt = cmd.slice(8).trim();
        if (!rawPrompt) {
          setNotice('Describe the image you want to generate.');
          setPrefillValue('/imagine ');
          return;
        }
        const { original, used, normalized } = normalizeImagePrompt(rawPrompt);
        const imagePrompt = used;
        setNotice('');
        const userItem: ChatItem = { id: nextId(), kind: 'user_msg', content: `/imagine ${rawPrompt}` };
        setChatItems(prev => [...prev, userItem]);
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'image', message: `Generating image for: "${rawPrompt}"...` }]);
        setLoading(true);
        try {
          console.log(`[WebImage] /imagine prompt="${rawPrompt}" -> used="${imagePrompt}"`);
          const result = await safeFetchJson('/api/image/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: imagePrompt }),
          });
          console.log(`[WebImage] POST /api/image/generate ok=${result.ok}`, result.data || result.error);
          if (result.ok && result.data?.imageUrl) {
            const imageUrl = result.data.imageUrl;
            console.log(`[WebImage] originalPrompt="${original}" promptUsed="${imagePrompt}" imageUrl="${imageUrl}"`);
            setChatItems(prev => [...prev, { id: nextId(), kind: 'image_card', imageUrl, prompt: original, promptUsed: normalized ? imagePrompt : undefined }]);
          } else {
            const directUrl = buildPollinationsUrl(imagePrompt);
            console.log(`[WebImage] Backend unavailable, using direct Pollinations URL: ${directUrl}`);
            setChatItems(prev => [...prev, { id: nextId(), kind: 'image_card', imageUrl: directUrl, prompt: original, promptUsed: normalized ? imagePrompt : undefined }]);
          }
        } catch (err) {
          const directUrl = buildPollinationsUrl(imagePrompt);
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[WebImage] /imagine failed entirely: ${errMsg}. Using direct URL: ${directUrl}`);
          setChatItems(prev => [...prev, { id: nextId(), kind: 'image_card', imageUrl: directUrl, prompt: original, promptUsed: normalized ? imagePrompt : undefined }]);
        } finally {
          setLoading(false);
        }
        return;
      }
    }

    // â”€â”€ Natural language image intent detection â”€â”€â”€â”€â”€â”€
    {
      const trimmed = input.trim();
      let imagePrompt: string | null = null;
      const arImgPat = /^(?:Ø§Ù†Ø´Ø¦|Ø§Ù†Ø´Ø§|Ø§Ù†Ø´Ø£|Ø§Ø±Ø³Ù…|Ø§Ø±Ø³Ø§Ù…|Ø§ØµÙ†Ø¹|ØµÙ…Ù…|ÙˆÙ„Ø¯|ÙƒÙˆÙ†)\s+(?:Ù„ÙŠ\s+)?(?:ØµÙˆØ±Ø©|Ø±Ø³Ù…Ø©|Ø±Ø³Ù…Ø§|Ø´Ø¹Ø§Ø±|ØªØµÙ…ÙŠÙ…|Ù„ÙˆØ­Ø©)\s+(?:Ù„Ù€?|Ø¹Ù†|Ù…Ù†\s+)?(.+)/i;
      const arShortPat = /^(?:Ø§Ø±Ø³Ù…|Ø§Ø±Ø³Ø§Ù…|ØµÙˆØ±|Ø§Ø±Ø³Ù…Ù„ÙŠ)\s+(?:Ù„ÙŠ\s+)?(.+)/i;
      const enImgPat = /^(?:generate|create|draw|make|render|produce)\s+(?:a|an|the|me\s+a|me\s+an)?\s*(?:image|picture|logo|photo|portrait|illustration|art|drawing)\s+(?:of|with|showing)\s+(.+)/i;
      const enShortPat = /^(?:generate|create|draw|make)\s+(.+?)\s+(?:image|picture|logo|photo|illustration|art)/i;
      const arCatchPat = /^(?:Ø§Ù†Ø´Ø¦|Ø§Ù†Ø´Ø§|Ø§Ù†Ø´Ø£|Ø§Ø±Ø³Ù…|Ø§Ø±Ø³Ø§Ù…|Ø§ØµÙ†Ø¹|ØµÙ…Ù…|ÙˆÙ„Ø¯|ÙƒÙˆÙ†)\s+(?:Ù„ÙŠ\s+)?(?:ØµÙˆØ±Ø©|Ø±Ø³Ù…Ø©|Ø±Ø³Ù…Ø§|Ø´Ø¹Ø§Ø±|ØªØµÙ…ÙŠÙ…|Ù„ÙˆØ­Ø©)\s*$/i;
      const enCatchPat = /^(?:generate|create|draw|make)\s+(?:a|an|the|me\s+a|me\s+an)?\s*(?:image|picture|logo|photo|illustration|art)\s*$/i;
      const pats = [arImgPat, arShortPat, enImgPat, enShortPat];
      for (const p of pats) {
        const m = trimmed.match(p);
        if (m && m[1]) { imagePrompt = m[1].trim(); break; }
      }
      if (!imagePrompt && (arCatchPat.test(trimmed) || enCatchPat.test(trimmed))) {
        imagePrompt = trimmed;
      }
      if (imagePrompt) {
        if (!settings.imageGen) {
          setChatItems(prev => [...prev, { id: nextId(), kind: 'user_msg', content: input, skipInHistory: true }]);
          setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: useT(settings.language, 'image.genDisabled') }]);
          return;
        }
        const { original, used, normalized } = normalizeImagePrompt(imagePrompt);
        const imgPrompt = used;
        setNotice('');
        const userItem: ChatItem = { id: nextId(), kind: 'user_msg', content: input, skipInHistory: true };
        setChatItems(prev => [...prev, userItem]);
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'image', message: `Generating image for: "${imagePrompt}"...` }]);
        setLoading(true);
        try {
          console.log(`[WebImage] originalPrompt="${original}" promptUsed="${imgPrompt}"`);
          const result = await safeFetchJson('/api/image/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: imgPrompt }),
          });
          console.log(`[WebImage] POST /api/image/generate ok=${result.ok}`, result.data || result.error);
          if (result.ok && result.data?.imageUrl) {
            console.log(`[WebImage] imageUrl="${result.data.imageUrl}"`);
            setChatItems(prev => [...prev, { id: nextId(), kind: 'image_card', imageUrl: result.data.imageUrl, prompt: original, promptUsed: normalized ? imgPrompt : undefined }]);
          } else {
            const directUrl = buildPollinationsUrl(imgPrompt);
            console.log(`[WebImage] Backend unavailable, using direct Pollinations URL: ${directUrl}`);
            setChatItems(prev => [...prev, { id: nextId(), kind: 'image_card', imageUrl: directUrl, prompt: original, promptUsed: normalized ? imgPrompt : undefined }]);
          }
        } catch {
          const directUrl = buildPollinationsUrl(imgPrompt);
          console.log(`[WebImage] Fetch failed, using direct Pollinations URL: ${directUrl}`);
          setChatItems(prev => [...prev, { id: nextId(), kind: 'image_card', imageUrl: directUrl, prompt: original, promptUsed: normalized ? imgPrompt : undefined }]);
        } finally {
          setLoading(false);
        }
        return;
      }
    }

    // â”€â”€ Request mode classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    type RequestMode = 'image_generation' | 'web_search' | 'code_project' | 'normal_chat';
    let currentMode: RequestMode = 'normal_chat';
    const trimmedInput = input.trim().toLowerCase();
    const arSearchPat = /^(?:Ù…Ù†\s+(?:Ù‡Ùˆ|Ù‡ÙŠ)|Ù…Ø§\s+Ù‡Ùˆ|Ù…Ø§\s+Ù‡ÙŠ|Ø§ÙŠÙ†|Ù…ØªÙ‰|ÙƒÙŠÙ|Ù‡Ù„|Ù…Ø§\s+Ù…Ø¹Ù†Ù‰|Ù…Ø§\s+Ù‡ÙŠ|Ù…Ø¹Ù„ÙˆÙ…Ø§Øª\s+Ø¹Ù†|Ø¨Ø­Ø«\s+Ø¹Ù†|Ø§Ø¨Ø­Ø«\s+Ø¹Ù†|ÙˆÙƒÙ…|ÙƒÙ…\s+(?:Ø¹Ø¯Ø¯|Ø¹Ù†Ø¯|Ø¹Ù†Ø¯Ù‡|Ù„Ø¯ÙŠÙ‡|Ù…Ø´ØªØ±Ùƒ|Ù…ØªØ§Ø¨Ø¹)|Ø¹Ù„Ù‰\s+(?:Ø§Ù„ÙŠÙˆØªÙŠÙˆØ¨|ÙŠÙˆØªÙŠÙˆØ¨|Ø§Ù†Ø³ØªØºØ±Ø§Ù…|ØªÙŠÙƒ\s*ØªÙˆÙƒ|ØªÙˆÙŠØªØ±|ÙÙŠØ³Ø¨ÙˆÙƒ)|tell\s+me\s+(?:about|who|what)|who\s+is|what\s+is|where\s+is|when\s+is|how\s+(?:to|do|is|does|many)|search\s+(?:the\s+web\s+)?(?:for\s+)?)/i;
    if (!input.startsWith('/') && arSearchPat.test(trimmedInput)) {
      currentMode = 'web_search';
    }
    console.log(`[ChatMode] input="${input.slice(0, 60)}" mode=${currentMode}`);
    const filteredBefore = buildMessages(chatItems).length;
    const totalHistoryBefore = chatItems.filter(i => i.kind === 'user_msg' || i.kind === 'ai_msg').length;
    console.log(`[ChatMode] history: ${filteredBefore} model messages from ${totalHistoryBefore} user/ai items`);

    let finalInput = input;
    const lastAiItem = [...chatItems].reverse().find(i => i.kind === 'ai_msg' && i.content);
    if (lastAiItem && lastAiItem.kind === 'ai_msg') {
      const lastText = lastAiItem.content;
      if (isConfirmation(input) && hasProposal(lastText)) {
        finalInput = 'Proceed now. Use tools to inspect files and apply the requested change. Do not ask for confirmation again unless a dangerous command is required.';
        console.debug(LOG, 'Confirmation detected, replaced with proceed instruction');
      }
    }

    const userItem: ChatItem = { id: nextId(), kind: 'user_msg', content: finalInput, attachments };
    if (attachments && attachments.length > 0) {
      const fileNames = attachments.map(a => a.name).join(', ');
      setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'file', message: `Attached: ${fileNames}` }]);
    }
    setChatItems(prev => [...prev, userItem]);
    setLoading(true);
    setLoadingPhase('thinking');
    setTimingData(null);
    setElapsedSecs(0);
    setThinkingWarning('');

    console.debug(LOG, 'User message added, loading=true');

    thinkingStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - thinkingStartRef.current) / 1000);
      setElapsedSecs(secs);
      if (secs >= 8 && secs < 20) setThinkingWarning('Still working... provider may be slow.');
      else if (secs >= 20) setThinkingWarning('Provider may be slow or rate-limited. Try OpenRouter, Gemini, or HYSA AI.');
    }, 1000);

    const controller = new AbortController();
    abortRef.current = controller;

    timeoutRef.current = setTimeout(() => {
      console.debug(LOG, 'Request timed out after 45s');
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      clearState();
      setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'The provider did not respond in time. Try again shortly or switch providers.' }]);
    }, TIMEOUT_MS);

    try {
      const chatMessages = buildMessages([...chatItems, userItem]);
      const systemInstructions: string[] = [];
      if (currentMode === 'web_search') {
        systemInstructions.push('The current user request is a web-search question. Answer only the current question using web search results. Ignore and do not reference any previous image generation requests, image UI events, or failed image loads. Do not mention image creation, generation, or drawing capabilities unless the user explicitly asks for an image.');
        console.log(`[ChatMode] injecting search-focused system instruction`);
      }
      if (!settings.webSearch) {
        systemInstructions.push('Web search is disabled. Do not use any search tools.');
      }
      if (settings.defaultResponseLang === 'ar') {
        systemInstructions.push('Respond in Arabic (Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©).');
      } else if (settings.defaultResponseLang === 'en') {
        systemInstructions.push('Respond in English.');
      }
      if (systemInstructions.length > 0) {
        chatMessages.unshift({ role: 'system', content: systemInstructions.join(' ') });
        console.log(`[ChatMode] added ${systemInstructions.length} system instructions`);
      }
      const payload: any = { messages: chatMessages };
      if (attachments && attachments.length > 0) {
        payload.attachments = attachments.map(a => ({
          name: a.name, ext: a.ext, size: a.size, kind: a.kind,
          textContent: (a.kind === 'text' || a.kind === 'pdf') ? a.textContent : undefined,
          dataUrl: a.kind === 'image' ? a.previewUrl : undefined,
        }));
      }
      const lastUserContent = finalInput;
      const useStream = isSimpleQuestion(lastUserContent);
      const apiEndpoint = useStream ? '/api/chat/stream' : '/api/chat';

      console.debug(LOG, `Sending to ${apiEndpoint}, messages:`, chatMessages.length, 'stream:', useStream);

      const res = await fetch(apiEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      console.debug(LOG, 'Response status:', res.status, res.statusText);

      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.debug(LOG, 'Non-200 response body:', errText);
        if (debug) setLastRawResponse(errText || `Status ${res.status}`);
        const newItems: ChatItem[] = [];
        newItems.push({ id: nextId(), kind: 'ai_msg', content: isRateLimited(errText) ? 'The provider is rate-limited or unavailable. Try again shortly or switch providers.' : 'Could not reach the server. Try again.' });
        if (debug) newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'error', message: errText || `Status ${res.status}` });
        setChatItems(prev => [...prev, ...newItems]);
        return;
      }

      // â”€â”€ Streaming path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (useStream) {
        const reader = res.body?.getReader();
        if (!reader) { setStreamingId(null); setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'Stream not available. Try again without streaming.' }]); return; }

        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedText = '';
        let streamDone = false;
        let streamError: string | null = null;
        let finalToolCalls: any[] | null = null;
        let streamItemId: string | null = null;
        let lastSearchSources: Source[] | null = null;

        const placeholderItem: ChatItem = { id: nextId(), kind: 'ai_msg', content: '' };
        streamItemId = placeholderItem.id;
        setStreamingId(placeholderItem.id);
        setChatItems(prev => [...prev, placeholderItem]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            try {
              const event = JSON.parse(trimmed.slice(6));

                  if (event.type === 'token') {
                    if (!accumulatedText) {
                      setLoading(false);
                    }
                    accumulatedText += event.text;
                    setChatItems(prev => prev.map(item =>
                      item.id === streamItemId && item.kind === 'ai_msg'
                        ? { ...item, content: accumulatedText }
                        : item
                    ));
                  } else if (event.type === 'tool_result' && event.status === 'executing') {
                    setLoadingPhase('running');
                    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: `Step ${event.step}/${event.total}: Auto-executing tools...` }]);
                  } else if (event.type === 'tool_result' && event.status === 'done') {
                    setLoadingPhase('finalizing');
                    const resultItem: ChatItem = { id: nextId(), kind: 'tool_result', content: event.results || '' };
                    setChatItems(prev => [...prev, resultItem]);
                  } else if (event.type === 'search_start' || event.type === 'search') {
                    setLoadingPhase('thinking');
                    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'search', message: `Searching web for "${event.query}"...` }]);
                  } else if (event.type === 'search_done') {
                    if (event.sources) lastSearchSources = event.sources;
                    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'search', message: `Search complete â€” ${event.resultCount || 0} result(s) found` }]);
                  } else if (event.type === 'search_error') {
                    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'search', message: event.message || 'Web search failed' }]);
                  } else if (event.type === 'fallback' && debug) {
                    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'fallback', message: event.message || '' }]);
                  } else if (event.type === 'plan') {
                    setChatItems(prev => [...prev, { id: nextId(), kind: 'plan_card', plan: event.plan }]);
                  } else if (event.type === 'plan_update') {
                    setChatItems(prev => {
                      const idx = prev.length - 1;
                      for (let i = prev.length - 1; i >= 0; i--) {
                        if (prev[i].kind === 'plan_card') {
                          return prev.map((item, j) => j === i ? { ...item, plan: event.plan, currentStep: event.stepIndex } : item);
                        }
                      }
                      return prev;
                    });
                  } else if (event.type === 'done') {
                    streamDone = true;
                    accumulatedText = event.fullText || accumulatedText;
                    if (lastSearchSources) {
                      console.log(`[Sources] rawAssistantText="${accumulatedText.slice(-300)}"`);
                      console.log(`[Sources] attachedSourcesCount=${lastSearchSources.length}`);
                      accumulatedText = stripSourcesSection(accumulatedText);
                      console.log(`[Sources] strippedAssistantText="${accumulatedText.slice(-300)}"`);
                    }
                    finalToolCalls = event.toolCalls || [];
                    if (event.timing) setTimingData(event.timing);
                    updateProviderStatus(event.provider, event.model);
                    if (event.plan) {
                      setChatItems(prev => {
                        for (let i = prev.length - 1; i >= 0; i--) {
                          if (prev[i].kind === 'plan_card') {
                            return prev.map((item, j) => j === i ? { ...item, plan: event.plan } : item);
                          }
                        }
                        return [...prev, { id: nextId(), kind: 'plan_card', plan: event.plan }];
                      });
                    }
                  } else if (event.type === 'error') {
                    streamError = event.message || '';
                  }
            } catch { /* skip malformed SSE */ }
          }
        }

        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const event = JSON.parse(trimmed.slice(6));
              if (event.type === 'token') {
                accumulatedText += event.text;
              } else if (event.type === 'tool_result' && event.status === 'executing') {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: `Step ${event.step}/${event.total}: Auto-executing tools...` }]);
              } else if (event.type === 'tool_result' && event.status === 'done') {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_result', content: event.results || '' }]);
              } else if (event.type === 'search_start' || event.type === 'search') {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'search', message: `Searching web for "${event.query}"...` }]);
              } else if (event.type === 'search_done') {
                if (event.sources) lastSearchSources = event.sources;
                setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'search', message: `Search complete â€” ${event.resultCount || 0} result(s) found` }]);
              } else if (event.type === 'search_error') {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'search', message: event.message || 'Web search failed' }]);
              } else if (event.type === 'fallback' && debug) {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'fallback', message: event.message || '' }]);
              } else if (event.type === 'plan') {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'plan_card', plan: event.plan }]);
              } else if (event.type === 'plan_update') {
                setChatItems(prev => {
                  for (let i = prev.length - 1; i >= 0; i--) {
                    if (prev[i].kind === 'plan_card') {
                      return prev.map((item, j) => j === i ? { ...item, plan: event.plan, currentStep: event.stepIndex } : item);
                    }
                  }
                  return prev;
                });
              } else if (event.type === 'done') {
                streamDone = true;
                accumulatedText = event.fullText || accumulatedText;
                if (lastSearchSources) {
                  console.log(`[Sources] rawAssistantText="${accumulatedText.slice(-300)}"`);
                  console.log(`[Sources] attachedSourcesCount=${lastSearchSources.length}`);
                  accumulatedText = stripSourcesSection(accumulatedText);
                  console.log(`[Sources] strippedAssistantText="${accumulatedText.slice(-300)}"`);
                }
                finalToolCalls = event.toolCalls || [];
                if (event.timing) setTimingData(event.timing);
                updateProviderStatus(event.provider, event.model);
                if (event.plan) {
                  setChatItems(prev => {
                    for (let i = prev.length - 1; i >= 0; i--) {
                      if (prev[i].kind === 'plan_card') {
                        return prev.map((item, j) => j === i ? { ...item, plan: event.plan } : item);
                      }
                    }
                    return [...prev, { id: nextId(), kind: 'plan_card', plan: event.plan }];
                  });
                }
              } else if (event.type === 'error') {
                streamError = event.message || '';
              }
            } catch { /* skip */ }
          }
        }

        setStreamingId(null);
        if (streamError) {
          setChatItems(prev => prev.map(item =>
            item.id === streamItemId && item.kind === 'ai_msg'
              ? { ...item, content: accumulatedText || streamError }
              : item
          ));
        } else if (streamDone) {
          const finalSources = lastSearchSources;
          setChatItems(prev => prev.map(item =>
            item.id === streamItemId && item.kind === 'ai_msg'
              ? { ...item, content: accumulatedText, sources: finalSources || undefined }
              : item
          ));

          if (finalToolCalls && finalToolCalls.length > 0) {
            const toolItems: ChatItem[] = [];
            for (const tc of finalToolCalls) {
              if (tc.type === 'read_file') {
                const fp = tc.params.filePath || '';
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'done', message: `Read ${fp}` });
                openFile(fp);
              } else if (tc.type === 'edit_file') {
                const fp = tc.params.filePath || '';
                const nc = tc.params.newContent || tc.params.content || '';
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'edit', message: `Proposed edit for ${fp}` });
                try {
                  const previewRes = await fetch('/api/file/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fp, content: nc }) });
                  const previewData = await previewRes.json();
                  toolItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: previewData.diff || 'No diff available' });
                } catch { toolItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: 'Error generating diff' }); }
              } else if (tc.type === 'execute_command') {
                const cmd = tc.params.command || '';
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Command: ${cmd}` });
                toolItems.push({ id: nextId(), kind: 'command_card', command: cmd, toolCall: tc });
              } else {
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Tool: ${tc.type}` });
              }
            }
            if (toolItems.length > 0) {
              setChatItems(prev => [...prev, ...toolItems]);
            }
            // Save pending messages for continuation (include streaming AI response)
            const streamMsgs = buildMessages(chatItems);
            if (accumulatedText) {
              streamMsgs.push({ role: 'assistant', content: accumulatedText });
            }
            pendingMsgsRef.current = streamMsgs;
          }
        } else {
          setStreamingId(null);
          setChatItems(prev => prev.map(item =>
            item.id === streamItemId && item.kind === 'ai_msg'
              ? { ...item, content: accumulatedText || '(Incomplete response)' }
              : item
          ));
        }
        return;
      }

      // â”€â”€ Non-streaming path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const contentType = res.headers.get('content-type') || '';
      console.log(`[WebClient] ${apiEndpoint} status=${res.status} content-type="${contentType}"`);
      let rawText: string;
      try {
        rawText = await res.text();
        if (debug) setLastRawResponse(rawText);
      } catch {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'An unexpected error occurred. Try again shortly.' }]);
        return;
      }

      if (contentType.includes('text/html') || contentType.includes('text/plain') || rawText.trim().startsWith('<!')) {
        const snippet = rawText.slice(0, 300).replace(/\n/g, ' ');
        console.error(`[WebClient] ERROR: ${apiEndpoint} returned HTML (content-type: ${contentType}) body="${snippet}"`);
        setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: `API route returned HTML instead of JSON. Backend/proxy is misconfigured. status=${res.status} content-type=${contentType}` }]);
        return;
      }

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'The server returned an unexpected response. Try again or switch providers.' }]);
        return;
      }

      const assistantText = getAssistantText(data);
      const hasToolCalls = data.toolCalls && data.toolCalls.length > 0;
      if (data.timing) setTimingData(data.timing);
      updateProviderStatus(data.provider, data.model);

      if (data.error && !assistantText && !hasToolCalls) {
        const newItems: ChatItem[] = [];
        newItems.push({ id: nextId(), kind: 'ai_msg', content: debug ? `Error: ${data.error}` : 'An unexpected error occurred. Try again shortly.' });
        if (debug && data.debugError) {
          newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'error', message: data.debugError });
        }
        setChatItems(prev => [...prev, ...newItems]);
        return;
      }

      if (!assistantText && !hasToolCalls) {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'HYSA returned an empty response. Try again or switch providers.' }]);
        return;
      }

      const newItems: ChatItem[] = [];

      // Display search_start/search_done for non-streaming responses
      if (data.searchQuery) {
        newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'search', message: `Searching web for "${data.searchQuery}"...` });
        if (data.searchError) {
          newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'search', message: `Web search failed: ${data.searchError}` });
        } else if (data.searchResultCount !== undefined) {
          newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'search', message: `Search complete â€” ${data.searchResultCount} result(s) found` });
        }
      }

      if (debug && data.fallbackEvents && data.fallbackEvents.length > 0) {
        for (const event of data.fallbackEvents) {
          newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'fallback', message: event });
        }
      }

      if (data.plan) {
        newItems.push({ id: nextId(), kind: 'plan_card', plan: data.plan });
      }

      if (assistantText) {
        const msgId = nextId();
        const cleanedText = data.searchSources ? stripSourcesSection(assistantText) : assistantText;
        newItems.push({ id: msgId, kind: 'ai_msg', content: cleanedText, sources: data.searchSources || undefined });
        if (!useStream) {
          if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
          setRevealingId(msgId);
          setRevealPos(0);
          const totalChars = assistantText.length;
          const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(assistantText);
          if (hasArabic) {
            const wordEnds: number[] = [];
            for (let i = 1; i <= totalChars; i++) {
              if (i === totalChars || /\s/.test(assistantText[i])) {
                wordEnds.push(i);
              }
            }
            if (wordEnds.length === 0) wordEnds.push(totalChars);
            let wi = 0;
            const msPer = Math.max(35, Math.min(80, Math.round(Math.min(5000, wordEnds.length * 50) / wordEnds.length)));
            revealTimerRef.current = setInterval(() => {
              wi++;
              if (wi >= wordEnds.length) {
                if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
                setRevealingId(null);
                setRevealPos(0);
                return;
              }
              setRevealPos(wordEnds[wi]);
            }, msPer);
          } else {
            const chunkSize = totalChars > 800 ? 15 : totalChars > 400 ? 8 : totalChars > 100 ? 5 : 3;
            const totalMs = Math.min(5000, Math.round(totalChars * 0.1));
            const steps = Math.ceil(totalChars / chunkSize);
            const msPerChunk = Math.max(25, Math.min(65, Math.round(totalMs / steps)));
            let pos = 0;
            revealTimerRef.current = setInterval(() => {
              pos += chunkSize;
              if (pos >= totalChars) {
                if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
                setRevealingId(null);
                setRevealPos(0);
                return;
              }
              setRevealPos(pos);
            }, msPerChunk);
          }
        }
      }

      if (hasToolCalls) {
        for (const tc of data.toolCalls as ToolCall[]) {
          if (tc.type === 'read_file') {
            const fp = tc.params.filePath || '';
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'done', message: `Read ${fp}` });
            openFile(fp);
          } else if (tc.type === 'edit_file') {
            const fp = tc.params.filePath || '';
            const nc = tc.params.newContent || tc.params.content || '';
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'edit', message: `Proposed edit for ${fp}` });
            try {
              const previewRes = await fetch('/api/file/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fp, content: nc }) });
              const previewData = await previewRes.json();
              newItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: previewData.diff || 'No diff available' });
            } catch { newItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: 'Error generating diff' }); }
          } else if (tc.type === 'execute_command') {
            const cmd = tc.params.command || '';
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Command: ${cmd}` });
            newItems.push({ id: nextId(), kind: 'command_card', command: cmd, toolCall: tc });
          } else {
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Tool: ${tc.type}` });
          }
        }
        // Save pending messages for continuation
        const msgsBefore = buildMessages(chatItems);
        msgsBefore.push({ role: 'user', content: finalInput });
        if (assistantText) {
          msgsBefore.push({ role: 'assistant', content: assistantText });
        }
        pendingMsgsRef.current = msgsBefore;
      }

      setChatItems(prev => [...prev, ...newItems]);
    } catch (err: unknown) {
      console.debug(LOG, 'Caught error:', err);
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      const alreadyHandled = !abortRef.current;
      if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setLoading(false);
      setElapsedSecs(0);
      setThinkingWarning('');

      if (alreadyHandled) {
        console.debug(LOG, 'Error already handled (abortRef was null), skipping');
        return;
      }

      const e = err as Error;
      if (e.name === 'AbortError') {
        console.debug(LOG, 'Request was aborted');
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: 'Request canceled.' }]);
        return;
      }

      const fallbackMsg = 'An unexpected error occurred. Try again shortly or switch providers.';
      const newItems: ChatItem[] = [];
      newItems.push({ id: nextId(), kind: 'ai_msg', content: fallbackMsg });
      if (debug && e.message) {
        newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'error', message: e.message.slice(0, 200) });
      }
      setChatItems(prev => [...prev, ...newItems]);
    } finally {
      console.debug(LOG, '=== sendMessage finally ===');
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
      setLoading(false);
      setElapsedSecs(0);
      setThinkingWarning('');
      setLoadingPhase('');
      console.debug(LOG, '=== sendMessage end ===');
    }
  }, [chatItems, openFile, buildMessages, clearState, addError, debug, loading, updateProviderStatus]);

  const handleCopyMessage = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const updateSetting = useCallback(<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem('hysa-web-settings', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const clearUiCache = useCallback(() => {
    localStorage.clear();
    setNotice('Local cache cleared');
    setTimeout(() => setNotice(''), 3000);
  }, []);

  // Persist settings to localStorage whenever they change
  useEffect(() => {
    try { localStorage.setItem('hysa-web-settings', JSON.stringify(settings)); } catch {}
  }, [settings]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    const apply = (theme: string) => {
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        root.setAttribute('data-theme', theme);
      }
    };
    apply(settings.theme);
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => apply('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [settings.theme]);

  // Apply UI language to document
  useEffect(() => {
    const root = document.documentElement;
    const lang = settings.language;
    if (lang === 'ar') {
      root.setAttribute('dir', 'rtl');
      root.setAttribute('lang', 'ar');
    } else if (lang === 'en') {
      root.setAttribute('dir', 'ltr');
      root.setAttribute('lang', 'en');
    } else {
      root.removeAttribute('dir');
      root.removeAttribute('lang');
    }
  }, [settings.language]);

  // Apply compact mode class
  useEffect(() => {
    const root = document.documentElement;
    if (settings.compactMode) {
      root.classList.add('compact-mode');
    } else {
      root.classList.remove('compact-mode');
    }
  }, [settings.compactMode]);

  const hasItems = chatItems.length > 0;

  const [prefillValue, setPrefillValue] = useState('');

  const handleCardPrefill = useCallback((text: string) => {
    setPrefillValue(text);
  }, []);

  const handleClearPrefill = useCallback(() => {
    setPrefillValue('');
  }, []);

  const handleSearchWeb = useCallback(() => {
    if (!settings.webSearch) {
      setNotice(useT(settings.language, 'settings.webSearch') + ' is disabled in Settings.');
      setTimeout(() => setNotice(''), 3000);
      return;
    }
    setPrefillValue(useT(settings.language, 'search.webSearch') + ' ');
  }, [settings.webSearch, settings.language]);

  const handleGenerateImage = useCallback(() => {
    if (!settings.imageGen) {
      setNotice(useT(settings.language, 'image.genDisabled'));
      setTimeout(() => setNotice(''), 3000);
      return;
    }
    setPrefillValue('/imagine ');
  }, [settings.imageGen, settings.language]);

  return (
    <div className="app">
      <TopBar
        status={status}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        yolo={yolo}
        onToggleYolo={toggleYolo}
        debug={debug}
        onToggleDebug={() => setDebug(!debug)}
        onClearChat={clearChat}
        onFilesPage={() => { window.location.hash = '#/files'; }}
        onLanding={() => { window.location.hash = '#/'; }}
        hasItems={hasItems}
        onOpenSettings={openSettings}
      />
      <div className="app-body">
        <FileTree files={files} fileCount={fileCount} selectedFile={selectedFile} onSelect={openFile} collapsed={!sidebarOpen} onClose={() => setSidebarOpen(false)} />
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        <div className="chat-panel">
          <div className="messages-scroll">
            {!hasItems ? (
              showIntro ? (
                <HysaIntro onDone={() => setShowIntro(false)} />
              ) : (
                <div className="home-workspace-shell">
                <div className="home-workspace">
                  <div className="home-main">
                    {/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    <div className="home-header">
                      <span className="home-logo">HYSA</span>
                      <h2 className="home-title">{useT(settings.language, 'hero.ready')}</h2>
                    </div>

                    {notice && <div className="home-notice">{notice}</div>}

                    {/* â”€â”€ Composer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    <div className="home-composer-wrap">
                      <Composer onSend={sendMessage} loading={loading} status={status} onCancel={cancelThinking} prefillValue={prefillValue} onClearPrefill={handleClearPrefill} />
                    </div>

                    {/* â”€â”€ Quick Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    <div className="home-actions-grid">
                      <button className="hero-card-btn" onClick={() => handleCardPrefill('Read the project files and explain the architecture and structure.')} title="Explain project">
                        <span className="hero-card-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        </span>
                        {useT(settings.language, 'hero.explain')}
                      </button>
                      <button className="hero-card-btn" onClick={handleSearchWeb} title="Search the web">
                        <span className="hero-card-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        </span>
                        {useT(settings.language, 'hero.search')}
                      </button>
                      <button className="hero-card-btn" onClick={handleGenerateImage} title="Generate an image">
                        <span className="hero-card-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        </span>
                        {useT(settings.language, 'hero.generate')}
                      </button>
                      <button className="hero-card-btn" onClick={() => handleCardPrefill('Find and fix bugs in the codebase.')} title="Find bugs">
                        <span className="hero-card-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        </span>
                        {useT(settings.language, 'hero.findBugs')}
                      </button>
                      <button className="hero-card-btn" onClick={() => handleCardPrefill('Review the UI components and suggest improvements.')} title="Improve UI">
                        <span className="hero-card-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </span>
                        {useT(settings.language, 'hero.improveUI')}
                      </button>
                      <button className="hero-card-btn" onClick={() => handleCardPrefill('Generate comprehensive unit or integration tests.')} title="Generate tests">
                        <span className="hero-card-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                        </span>
                        {useT(settings.language, 'hero.tests')}
                      </button>
                    </div>

                    {/* â”€â”€ Suggested Workflows â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    <div className="home-suggested">
                      <div className="home-suggested-label">{useT(settings.language, 'home.suggested') || 'Suggested'}</div>
                      <div className="home-suggested-items">
                        <button className="home-suggested-btn" onClick={() => handleCardPrefill('Review the project architecture and document the key modules.')}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          Document architecture
                        </button>
                        <button className="home-suggested-btn" onClick={() => handleCardPrefill('Run the tests and fix any failures.')}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                          Fix test failures
                        </button>
                        <button className="home-suggested-btn" onClick={() => handleCardPrefill('Find and fix performance bottlenecks in the codebase.')}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                          Optimize performance
                        </button>
                      </div>
                    </div>

                    {/* â”€â”€ Recent Activity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    <div className="home-card">
                      <div className="home-card-header">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>{useT(settings.language, 'dash.activity')}</span>
                      </div>
                      <div className="home-card-body">
                        <div className="dash-empty">{useT(settings.language, 'dash.empty')}</div>
                        <div className="dash-row"><span className="dash-label">{useT(settings.language, 'hero.explain')} project files</span></div>
                        <div className="dash-row"><span className="dash-label">Run code analysis</span></div>
                        <div className="dash-row"><span className="dash-label">{useT(settings.language, 'hero.search')} with sources</span></div>
                      </div>
                    </div>

                    {/* â”€â”€ Quick Tips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    <div className="home-card">
                      <div className="home-card-header">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
                        <span>{useT(settings.language, 'dash.tips')}</span>
                      </div>
                      <div className="home-card-body">
                        <ul className="dash-tips">
                          <li dangerouslySetInnerHTML={{ __html: useT(settings.language, 'dash.tip.imagine').replace('/imagine', '<code>/imagine</code>') }} />
                          <li>{useT(settings.language, 'dash.tip.search')}</li>
                          <li>{useT(settings.language, 'dash.tip.attach')}</li>
                          <li dangerouslySetInnerHTML={{ __html: useT(settings.language, 'dash.tip.debug').replace('/debug', '<code>/debug</code>') }} />
                          <li>{useT(settings.language, 'dash.tip.start')}</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="home-sidebar">
                    {/* â”€â”€ Sidebar Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    <div className="home-sidebar-panel">
                      <div className="home-sidebar-panel-header">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                        <span>Workspace Overview</span>
                      </div>

                      {/* â”€â”€ Project Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                      <div className="home-sidebar-card">
                        <div className="home-sidebar-card-header">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                          <span>{useT(settings.language, 'dash.status')}</span>
                        </div>
                        <div className="home-sidebar-card-body">
                          {status ? (
                            <>
                              <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.provider')}</span><span className="dash-value">{status.provider}</span></div>
                              <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.model')}</span><span className="dash-value">{status.model}</span></div>
                              {status.git?.branch && <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.branch')}</span><span className="dash-value">{status.git.branch}{status.git.hasChanges ? ' *' : ''}</span></div>}
                              <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.files')}</span><span className="dash-value">{fileCount}</span></div>
                            </>
                          ) : (
                            <div className="dash-empty">{useT(settings.language, 'status.connecting')}</div>
                          )}
                        </div>
                      </div>

                      {/* â”€â”€ Feature Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                      <div className="home-sidebar-card">
                        <div className="home-sidebar-card-header">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                          <span>{useT(settings.language, 'dash.capabilities')}</span>
                        </div>
                        <div className="home-sidebar-card-body">
                          <div className="home-feature-row">
                            <span className="home-feature-label">Web Search</span>
                            <span className={`home-feature-status ${settings.webSearch ? 'on' : 'off'}`}>{settings.webSearch ? 'ON' : 'OFF'}</span>
                          </div>
                          <div className="home-feature-row">
                            <span className="home-feature-label">Image Gen</span>
                            <span className={`home-feature-status ${settings.imageGen ? 'on' : 'off'}`}>{settings.imageGen ? 'ON' : 'OFF'}</span>
                          </div>
                          <div className="home-feature-row">
                            <span className="home-feature-label">Show Sources</span>
                            <span className={`home-feature-status ${settings.showSources ? 'on' : 'off'}`}>{settings.showSources ? 'ON' : 'OFF'}</span>
                          </div>
                        </div>
                      </div>

                      {/* â”€â”€ Quick Commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                      <div className="home-sidebar-card">
                        <div className="home-sidebar-card-header">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                          <span>{useT(settings.language, 'dash.commands')}</span>
                        </div>
                        <div className="home-sidebar-card-body">
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.cmd.chat')}</span></div>
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.cmd.web')}</span></div>
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.cmd.config')}</span></div>
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.cmd.doctor')}</span></div>
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.cmd.providers')}</span></div>
                        </div>
                      </div>

                      {/* â”€â”€ Keyboard Shortcuts â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                      <div className="home-sidebar-card">
                        <div className="home-sidebar-card-header">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01"/></svg>
                          <span>{useT(settings.language, 'dash.shortcuts')}</span>
                        </div>
                        <div className="home-sidebar-card-body">
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.sc.send')}</span></div>
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.sc.newline')}</span></div>
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.sc.sidebar')}</span></div>
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.sc.settings')}</span></div>
                          <div className="dash-row"><span className="dash-label">{useT(settings.language, 'dash.sc.upload')}</span></div>
                        </div>
                      </div>
                    </div>

                    {/* â”€â”€ Provider Info â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    {status && (
                      <div className="home-provider-info">
                        <span className="ps-dot" />
                        <span>{status.provider} Â· {status.model}</span>
                      </div>
                    )}
                  </div>
                </div>
                </div>
              )
            ) : (
              <>
                <div className="chat-column">
                  {notice && <div className="composer-notice">{notice}</div>}
                  {chatItems.map((item, idx) => {
                    if (item.kind === 'user_msg') {
                      return (
                        <MessageBubble
                          key={item.id}
                          kind="user"
                          content={stripSearchTags(item.content)}
                          attachments={item.attachments}
                        />
                      );
                    }
                    if (item.kind === 'ai_msg') {
                      const prevItem = idx > 0 ? chatItems[idx - 1] : null;
                      const sourceFiles = prevItem?.kind === 'user_msg' && prevItem.attachments?.length
                        ? prevItem.attachments.map(a => a.name).join(', ')
                        : null;
                      const isRevealing = item.id === revealingId;
                      const isStreaming = item.id === streamingId;
                      const displayContent = stripSearchTags(isRevealing
                        ? item.content.slice(0, revealPos)
                        : item.content);
                      return (
                        <MessageBubble
                          key={item.id}
                          kind="assistant"
                          content={displayContent}
                          onCopy={handleCopyMessage}
                          sourceFiles={sourceFiles || undefined}
                          streaming={isRevealing || isStreaming}
                          className={isRevealing || isStreaming ? 'streaming-row' : undefined}
                          sources={settings.showSources ? item.sources : undefined}
                        />
                      );
                    }
                    if (item.kind === 'tool_event') {
                      return <ToolEvent key={item.id} type={item.eventType} message={item.message} />;
                    }
                    if (item.kind === 'diff_card') {
                      return (
                        <DiffCard
                          key={item.id}
                          filePath={item.filePath}
                          diff={item.diff}
                          content={item.content}
                          onApply={applyEdit}
                          onOpenFile={openFile}
                          yolo={yolo}
                          onComplete={(ok) => {
                            if (ok && pendingMsgsRef.current) {
                              const msgs = pendingMsgsRef.current;
                              pendingMsgsRef.current = null;
                              sendMessage('[auto-continue]', undefined);
                              { /* re-trigger */ }
                            }
                            setLoading(false);
                          }}
                        />
                      );
                    }
                    if (item.kind === 'command_card') {
                      return (
                        <CommandCard
                          key={item.id}
                          command={item.command}
                          onComplete={(ok) => {
                            if (ok && pendingMsgsRef.current) {
                              const msgs = pendingMsgsRef.current;
                              pendingMsgsRef.current = null;
                              sendMessage('[auto-continue]', undefined);
                            }
                            setLoading(false);
                          }}
                        />
                      );
                    }
                    if (item.kind === 'plan_card') {
                      return <PlanCard key={item.id} plan={item.plan} currentStep={item.currentStep} />;
                    }
                    if (item.kind === 'tool_result') {
                      return (
                        <div className="tool-result-card">
                          <pre className="tool-result-pre">{item.content}</pre>
                        </div>
                      );
                    }
                    if (item.kind === 'image_card') {
                      return <ImageCard key={item.id} imageUrl={item.imageUrl} prompt={item.prompt} promptUsed={item.promptUsed} lang={settings.language} />;
                    }
                    return null;
                  })}
                  <div ref={chatEndRef} />
                </div>

              </>
            )}
          </div>

          {hasItems && (
            <div className="chat-bottom-area">
              {notice && <div className="composer-notice">{notice}</div>}

              {loading && (() => {
                const lastUser = [...chatItems].reverse().find(i => i.kind === 'user_msg');
                const lastUserArabic = lastUser?.kind === 'user_msg' && isArabic(lastUser.content);
                const phaseText = loadingPhase ? PHASE_LABELS[loadingPhase] : (
                  lastUserArabic ? 'Ø¬Ø§Ø±Ù Ù†Ø³Ø¬ Ø§Ù„Ø±Ø¯...' : 'Weaving response...'
                );
                const warnText = lastUserArabic
                  ? elapsedSecs >= 20 ? 'Ù‚Ø¯ ÙŠÙƒÙˆÙ† Ø§Ù„Ù…Ø²ÙˆØ¯ Ø¨Ø·ÙŠØ¦Ù‹Ø§ Ø£Ùˆ Ù…Ø­Ø¯ÙˆØ¯ Ø§Ù„Ù…Ø¹Ø¯Ù„. Ø¬Ø±Ù‘Ø¨ OpenRouter Ø£Ùˆ Gemini Ø£Ùˆ HYSA AI.' : elapsedSecs >= 8 ? 'Ù„Ø§ ÙŠØ²Ø§Ù„ Ù‚ÙŠØ¯ Ø§Ù„Ø¹Ù…Ù„... Ù‚Ø¯ ÙŠÙƒÙˆÙ† Ø§Ù„Ù…Ø²ÙˆØ¯ Ø¨Ø·ÙŠØ¦Ù‹Ø§.' : ''
                  : thinkingWarning;
                return (
                  <div className={`thinking-bar${loadingPhase ? ` phase-${loadingPhase}` : ''}`}>
                    <span className="tb-pixel-icon">&gt;</span>
                    <span className="tb-text">{phaseText}</span>
                    <span className="tb-timer">{elapsedSecs}s</span>
                    {warnText && <span className={`tb-warn ${elapsedSecs >= 25 ? 'tb-slow' : ''}`}>{warnText}</span>}
                    <button className="tb-cancel" onClick={cancelThinking}>Cancel</button>
                  </div>
                );
              })()}

              {debug && lastRawResponse && (
                <div className="debug-panel">
                  <div className="debug-panel-header">
                    <span>Last API Response</span>
                    <button className="debug-panel-close" onClick={() => setLastRawResponse(null)}>x</button>
                  </div>
                  <pre className="debug-panel-body">{lastRawResponse}</pre>
                </div>
              )}
              {debug && timingData && (
                <div className="debug-panel timing-panel">
                  <div className="debug-panel-header">
                    <span>Timing &amp; Routing</span>
                    <button className="debug-panel-close" onClick={() => setTimingData(null)}>x</button>
                  </div>
                  <div className="timing-grid">
                    {timingData.routing_mode !== undefined && <div className="timing-row"><span className="timing-label">Routing mode</span><span className="timing-value">{timingData.routing_mode}</span></div>}
                    {timingData.capability !== undefined && <div className="timing-row"><span className="timing-label">Capability</span><span className="timing-value">{timingData.capability}</span></div>}
                    {timingData.project_mode !== undefined && <div className="timing-row"><span className="timing-label">Project mode</span><span className="timing-value">{String(timingData.project_mode)}</span></div>}
                    {timingData.files_selected !== undefined && <div className="timing-row"><span className="timing-label">Files selected</span><span className="timing-value">{timingData.files_selected}</span></div>}
                    {timingData.tool_steps !== undefined && <div className="timing-row"><span className="timing-label">Tool steps</span><span className="timing-value">{timingData.tool_steps}</span></div>}
                    {timingData.classification !== undefined && <div className="timing-row"><span className="timing-label">Classification</span><span className="timing-value">{timingData.classification}ms</span></div>}
                    {timingData.project_scan !== undefined && <div className="timing-row"><span className="timing-label">Project scan</span><span className="timing-value">{timingData.project_scan}ms</span></div>}
                    {timingData.context_select !== undefined && <div className="timing-row"><span className="timing-label">Context select</span><span className="timing-value">{timingData.context_select}ms</span></div>}
                    {timingData.provider !== undefined && <div className="timing-row"><span className="timing-label">Provider</span><span className="timing-value">{timingData.provider}ms</span></div>}
                    {timingData.total !== undefined && <div className="timing-row timing-total"><span className="timing-label">Total</span><span className="timing-value">{timingData.total}ms</span></div>}
                  </div>
                </div>
              )}

              {status && !loading && (
                <div className="provider-status">
                  <span className="ps-dot" />
                  <span>Using {status.provider} Â· {status.model}</span>
                </div>
              )}
              <Composer onSend={sendMessage} loading={loading} status={status} onCancel={cancelThinking} hideSuggestions={true} />
            </div>
          )}
        </div>
        {rightOpen && (
          <RightPanel tab={rightTab} onTabChange={setRightTab} onClose={() => setRightOpen(false)} selectedFile={selectedFile} fileContent={fileContent} onFileChange={setFileContent} onSave={saveFile} saveMsg={saveMsg} diffContent={diffContent} diffPath={diffPath} terminalOutput={terminalOutput} terminalType={terminalType} />
        )}
      </div>
      <StatusBar fileCount={fileCount} loading={loading} messageCount={chatItems.length} yolo={yolo} />

      {settingsOpen && (
        <>
          <div className="settings-overlay" onClick={closeSettings} />
          <div className="settings-modal">
            <div className="settings-modal-header">
              <span>{useT(settings.language, 'settings.title')}</span>
              <button className="settings-modal-close" onClick={closeSettings}>Ã—</button>
            </div>
            <div className="settings-modal-body">
              <div className="settings-group">
                <div className="settings-group-title">{useT(settings.language, 'settings.appearance')}</div>
                <div className="settings-row">
                  <label>{useT(settings.language, 'settings.theme')}</label>
                  <select value={settings.theme} onChange={e => updateSetting('theme', e.target.value as any)}>
                    <option value="dark">{useT(settings.language, 'settings.dark')}</option>
                    <option value="system">{useT(settings.language, 'settings.system')}</option>
                    <option value="light">{useT(settings.language, 'settings.light')}</option>
                  </select>
                </div>
                <div className="settings-row">
                  <label>{useT(settings.language, 'settings.compact')}</label>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={settings.compactMode} onChange={e => updateSetting('compactMode', e.target.checked)} />
                    <span className="settings-toggle-slider" />
                  </label>
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-group-title">{useT(settings.language, 'settings.languageGroup')}</div>
                <div className="settings-row">
                  <label>{useT(settings.language, 'settings.language')}</label>
                  <select value={settings.language} onChange={e => updateSetting('language', e.target.value as any)}>
                    <option value="auto">{useT(settings.language, 'settings.auto')}</option>
                    <option value="ar">{useT(settings.language, 'settings.arabic')}</option>
                    <option value="en">{useT(settings.language, 'settings.english')}</option>
                  </select>
                </div>
                <div className="settings-row">
                  <label>{useT(settings.language, 'settings.responseLang')}</label>
                  <select value={settings.defaultResponseLang} onChange={e => updateSetting('defaultResponseLang', e.target.value as any)}>
                    <option value="auto">{useT(settings.language, 'settings.auto')}</option>
                    <option value="ar">{useT(settings.language, 'settings.arabic')}</option>
                    <option value="en">{useT(settings.language, 'settings.english')}</option>
                  </select>
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-group-title">{useT(settings.language, 'settings.features')}</div>
                <div className="settings-row">
                  <label>{useT(settings.language, 'settings.webSearch')}</label>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={settings.webSearch} onChange={e => updateSetting('webSearch', e.target.checked)} />
                    <span className="settings-toggle-slider" />
                  </label>
                </div>
                <div className="settings-row">
                  <label>{useT(settings.language, 'settings.imageGen')}</label>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={settings.imageGen} onChange={e => updateSetting('imageGen', e.target.checked)} />
                    <span className="settings-toggle-slider" />
                  </label>
                </div>
                <div className="settings-row">
                  <label>{useT(settings.language, 'settings.showSources')}</label>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={settings.showSources} onChange={e => updateSetting('showSources', e.target.checked)} />
                    <span className="settings-toggle-slider" />
                  </label>
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-group-title">{useT(settings.language, 'settings.actions')}</div>
                <button className="settings-action-btn" onClick={clearChat}>{useT(settings.language, 'settings.clearChat')}</button>
                <button className="settings-action-btn" onClick={clearUiCache}>{useT(settings.language, 'settings.clearCache')}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function isRateLimited(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('rate') || lower.includes('limit') || lower.includes('quota') || lower.includes('429') || lower.includes('overloaded');
}

async function safeFetchJson(url: string, options?: RequestInit): Promise<{ ok: boolean; data?: any; error?: string; status?: number; contentType?: string }> {
  console.log(`[WebClient] ${options?.method || 'GET'} ${url}`);
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    console.log(`[WebClient] ${options?.method || 'GET'} ${url} status=${res.status} content-type="${contentType}"`);
    if (contentType.includes('text/html') || contentType.includes('text/plain')) {
      const text = await res.text();
      const snippet = text.slice(0, 200).replace(/\n/g, ' ');
      console.error(`[WebClient] ERROR: ${url} returned HTML/text instead of JSON. status=${res.status} body="${snippet}"`);
      return { ok: false, error: `API route returned ${contentType} instead of JSON. Backend/proxy is misconfigured. status=${res.status}`, status: res.status, contentType };
    }
    const data = await res.json();
    return { ok: res.ok, data, status: res.status, contentType };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebClient] FETCH FAILED: ${url} â€” ${msg}`);
    return { ok: false, error: msg };
  }
}

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';

function buildPollinationsUrl(prompt: string): string {
  return `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?width=1024&height=1024&nofeed=true`;
}

function buildProxyUrl(prompt: string, cacheBuster?: string): string {
  const base = `/api/image/proxy?prompt=${encodeURIComponent(prompt)}`;
  return cacheBuster ? `${base}&_=${cacheBuster}` : base;
}

