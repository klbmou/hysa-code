import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getBrainDir, readProjectMap, readRecentEvents, redact } from './store.js';
import { readExperienceGraph, searchGraph } from './graph-store.js';
import type { ExperienceGraphNode } from './graph-types.js';

// ── Session recall cache ──

interface CacheEntry {
  result: RecallContext;
  timestamp: number;
}

const recallCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function cacheKey(message: string, optionsMask: number): string {
  const kw = message.toLowerCase().split(/\s+/).filter(w => w.length > 2).sort().join(',');
  return `${kw}|${optionsMask}`;
}

function getCached(message: string, optionsMask: number): RecallContext | undefined {
  const key = cacheKey(message, optionsMask);
  const entry = recallCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.result;
  }
  if (entry) recallCache.delete(key);
  return undefined;
}

function setCached(message: string, optionsMask: number, result: RecallContext): void {
  const key = cacheKey(message, optionsMask);
  recallCache.set(key, { result, timestamp: Date.now() });
  if (recallCache.size > 50) {
    const oldest = [...recallCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) recallCache.delete(oldest[0]);
  }
}

// ── Fast path: detect if query clearly asks about memory ──

const MEMORY_KEYWORDS = [
  'decision', 'decided', 'decide',
  'lesson', 'learned',
  'provider', 'fallback', 'rate', 'cooldown', 'quota',
  'ollama', 'local_fallback',
  'bug', 'fix', 'error', 'issue',
  'project', 'context', 'brain', 'memory',
  'change', 'changes', 'update',
  'history', 'recall',
];

export function isMemoryQuery(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  const words = lower.split(/\s+/);
  // Very short messages (1-3 words) are unlikely to be memory queries
  // unless they directly contain a memory keyword (as substring)
  if (words.length <= 3) {
    return MEMORY_KEYWORDS.some(kw => lower.includes(kw));
  }
  return true;
}

// ── Types ──

export type RecallIntent =
  | 'none'
  | 'project_context'
  | 'bug_history'
  | 'provider_history'
  | 'browser_history'
  | 'decision_history'
  | 'lesson_history'
  | 'skill_history';

export type RecallContext = {
  intent: RecallIntent;
  summary: string;
  projectMapSummary?: string;
  recentLessons?: string[];
  recentDecisions?: string[];
  relevantGraphNodes?: string[];
  relevantGraphEdges?: string[];
  warnings?: string[];
};

const INTENT_PATTERNS: { intent: RecallIntent; patterns: RegExp[] }[] = [
  {
    intent: 'lesson_history',
    patterns: [
      /(?:what|any|the)\s+lessons?/i,
      /lessons?\s+(?:learn(?:t|ed)?|about)/i,
      /ما\s+آخر\s+(?:الدروس|التعلم)/i,
      /(?:ماذا|ماذا\s+ذا)\s+تعلم/i,
      /rate\s+limit\s+lesson/i,
    ],
  },
  {
    intent: 'decision_history',
    patterns: [
      /(?:what|any|the)\s+decisi(?:on|ons)/i,
      /(?:decide?|decisi(?:on|ons))\s+(?:about|on|regarding|for)/i,
      /what\s+did\s+(?:we|you)\s+decide/i,
      /ماذا\s+قرر(?:نا)?\s+(?:بخصوص|عن|في)/i,
      /decision/i,
      /architecture\s+decision/i,
    ],
  },
  {
    intent: 'bug_history',
    patterns: [
      /(?:what|any|the)\s+(?:bug|bugs|issue|problem|fix|fixes)/i,
      /(?:bug|bugs)\s+(?:in|with|about|fix(?:ed)?)/i,
      /what\s+(?:was|were|is)\s+(?:the|that)\s+(?:bug|issue|problem)/i,
      /(?:bug|issue|problem)\s+in\s+(?:the\s+)?browser/i,
      /ماذا\s+(?:أصلح|صلح)(?:نا)?\s+(?:في|بخصوص)/i,
      /what\s+(?:did\s+)?we\s+fix/i,
      /what\s+was\s+(?:the\s+)?(?:browser|session)\s+(?:bug|issue|problem)/i,
    ],
  },
  {
    intent: 'browser_history',
    patterns: [
      /browser\s+(?:session|daemon|bug|issue|problem|status|history)/i,
      /ما\s+مشكلة\s+(?:المتصفح|browser)/i,
      /browser\s+was/i,
    ],
  },
  {
    intent: 'provider_history',
    patterns: [
      /(?:provider|model|fallback)\s+(?:fail|failure|error|issue|problem|history|slow|rate.limit)/i,
      /why\s+(?:did|was|is)\s+(?:the\s+)?(?:provider|model|fallback)/i,
      /لماذا\s+كان\s+fallback/i,
      /provider\s+(?:cooldown|health|status)/i,
      /rate\s+limit/i,
      /quota/i,
    ],
  },
  {
    intent: 'project_context',
    patterns: [
      /(?:what|summarize|tell|describe)\s+(?:recent|about|the|current|project|changes|update)/i,
      /what\s+(?:did|have)\s+(?:we|you)\s+(?:change|done|update|modify)/i,
      /(?:recent|latest)\s+(?:change|changes|update|updates)/i,
      /what\s+files?\s+(?:are|were|is)\s+(?:important|changed|modify)/i,
      /smart\s+router/i,
      /project\s+(?:structure|memory|map|context)/i,
      /ماذا\s+تغير\s+في/i,
      /what\s+(?:did\s+)?we\s+(?:do|work\s+on)/i,
    ],
  },
  {
    intent: 'skill_history',
    patterns: [
      /(?:skill|skills)\s+(?:about|history|used|availabl)/i,
      /what\s+(?:skill|skills)\s+(?:do|are|exist)/i,
    ],
  },
];

const NEGATIVE_PATTERNS = [
  /^(?:hi|hello|hey|yo|sup|bye|goodbye|cya|salam|مرحبا|اهلا)\b/i,
  /^(?:thanks?|thank\s+you|ok|okay|nice|good|great|perfect|yes|no|sure|lol)\b/i,
  /^write\s+(?:a|an|the)\s+(?:simple\s+)?(?:game|app|program|function|component|script)/i,
  /^explain\s+(?:React|JavaScript|TypeScript|Python|CSS|HTML)/i,
  /^hysa\s+(?:search|websearch|browser|skill)/i,
  /^\/(?:browser|skill)/,
];

export function detectRecallIntent(message: string): RecallIntent {
  const trimmed = message.trim();

  for (const p of NEGATIVE_PATTERNS) {
    if (p.test(trimmed)) return 'none';
  }

  for (const entry of INTENT_PATTERNS) {
    for (const p of entry.patterns) {
      if (p.test(trimmed)) return entry.intent;
    }
  }

  return 'none';
}

// ── Smart truncation: no mid-word cuts, prefers sentence boundaries ──

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  // Try sentence boundary within range [maxLen-40, maxLen]
  const searchStart = Math.max(0, maxLen - 40);
  const searchArea = text.slice(searchStart, maxLen);
  const sentenceEnd = searchArea.search(/[.!?]\s/);
  if (sentenceEnd !== -1) {
    const cutPos = searchStart + sentenceEnd + 1;
    return text.slice(0, cutPos) + '...';
  }

  // Try last word boundary within 10 chars before maxLen
  const wordBoundary = text.lastIndexOf(' ', maxLen - 1);
  if (wordBoundary > maxLen - 10) {
    return text.slice(0, wordBoundary) + '...';
  }

  // Hard truncate at maxLen
  return text.slice(0, maxLen - 3) + '...';
}

// ── Parse lessons/decisions with smart truncation ──

async function readLessons(): Promise<string[]> {
  try {
    const filePath = join(getBrainDir(), 'lessons.md');
    if (!existsSync(filePath)) return [];
    const content = await readFile(filePath, 'utf8');
    const entries: string[] = [];
    let currentTitle = '';
    let currentBody = '';
    for (const line of content.split('\n')) {
      if (line.startsWith('## ')) {
        if (currentTitle) {
          entries.push(`${currentTitle}: ${truncateText(currentBody.trim(), 280)}`);
        }
        currentTitle = line.replace('## ', '').trim();
        currentBody = '';
      } else if (currentTitle) {
        currentBody += line + ' ';
      }
    }
    if (currentTitle) {
      entries.push(`${currentTitle}: ${truncateText(currentBody.trim(), 280)}`);
    }
    return entries;
  } catch {
    return [];
  }
}

async function readDecisions(): Promise<string[]> {
  try {
    const filePath = join(getBrainDir(), 'decisions.md');
    if (!existsSync(filePath)) return [];
    const content = await readFile(filePath, 'utf8');
    const entries: string[] = [];
    let currentTitle = '';
    let currentBody = '';
    for (const line of content.split('\n')) {
      if (line.startsWith('## ')) {
        if (currentTitle) {
          entries.push(`${currentTitle}: ${truncateText(currentBody.trim(), 280)}`);
        }
        currentTitle = line.replace('## ', '').trim();
        currentBody = '';
      } else if (currentTitle) {
        currentBody += line + ' ';
      }
    }
    if (currentTitle) {
      entries.push(`${currentTitle}: ${truncateText(currentBody.trim(), 280)}`);
    }
    return entries;
  } catch {
    return [];
  }
}

// ── Keyword extraction and relevance scoring ──

const STOP_WORDS = new Set([
  'what', 'why', 'did', 'was', 'were', 'the', 'we', 'you', 'about', 'for',
  'that', 'this', 'have', 'has', 'had', 'not', 'are', 'is', 'can', 'do',
  'does', 'done', 'been', 'being', 'will', 'would', 'could', 'should',
  'may', 'might', 'shall', 'our', 'its', 'his', 'her', 'their', 'they',
  'how', 'where', 'when', 'which', 'who', 'whom', 'in', 'on', 'at', 'to',
  'from', 'with', 'without', 'into', 'onto', 'upon', 'after', 'before',
  'during', 'since', 'until', 'of', 'by', 'than', 'then', 'else', 'also',
  'very', 'just', 'only', 'still', 'even', 'too', 'much', 'many', 'some',
  'any', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'into',
  'over', 'under', 'again', 'further', 'once', 'here', 'there', 'and',
  'but', 'or', 'nor', 'as', 'if', 'while', 'because', 'a', 'an', 'hi',
  'hello', 'hey', 'thanks', 'ok', 'okay', 'nice', 'good', 'great',
  'tell', 'describe', 'summarize', 'list', 'show', 'give', 'find',
  'happen', 'happened', 'going', 'go', 'went',
]);

const PROVIDER_TERMS = [
  'provider', 'fallback', 'rate', 'rate_limit', 'limit', 'cooldown',
  'openai_router', 'openrouter', 'ollama', 'local', 'HYSA_ENABLE_LOCAL_FALLBACK',
  'invalid key', 'timeout', 'unavailable', 'quota', 'model', 'test',
  'connection error', 'proxy',
];

function extractKeywords(message: string): string[] {
  const tokens = message.toLowerCase().split(/\s+/);
  return [...new Set(tokens.filter(t => t.length >= 3 && !STOP_WORDS.has(t)))];
}

function computeRelevance(
  text: string,
  keywords: string[],
  queryMessage: string,
  providerOnly?: boolean,
): number {
  const lower = text.toLowerCase();
  let score = 0;

  for (const kw of keywords) {
    if (lower.includes(kw)) {
      score += 10;
    }
  }

  // Title match bonus (text before first colon)
  const titlePart = text.includes(':') ? text.split(':')[0].toLowerCase() : '';
  for (const kw of keywords) {
    if (titlePart.includes(kw)) {
      score += 5;
    }
  }

  // Boost for provider terms when query is provider-related
  if (providerOnly) {
    for (const term of PROVIDER_TERMS) {
      if (lower.includes(term)) {
        score += 8;
      }
    }
  }

  // Penalize generic architecture/brain items when query is not about brain/context
  const mentionsBrain = queryMessage.toLowerCase().includes('brain') || queryMessage.toLowerCase().includes('context') || queryMessage.toLowerCase().includes('memory');
  if (!mentionsBrain) {
    if (titlePart.includes('brain') || titlePart.includes('context injection')) {
      score -= 25;
    }
  }

  // Penalize "Phase 3A" / "Phase 3B" unrelated items unless query mentions "phase"
  const queryLower = queryMessage.toLowerCase();
  if (!queryLower.includes('phase')) {
    if (lower.includes('phase 3a') || lower.includes('phase 3b') || lower.includes('phase 3c')) {
      if (!lower.includes('rate') && !lower.includes('fallback') && !lower.includes('provider') && !lower.includes('cooldown')) {
        score -= 15;
      }
    }
  }

  // Direct provider_term boost when query has provider/fail/rate keywords
  if (providerOnly) {
    const hasOllama = queryLower.includes('ollama');
    const hasFallback = queryLower.includes('fallback');
    const hasLocal = queryLower.includes('local');
    const hasRateLimit = queryLower.includes('rate');

    if (hasOllama && (lower.includes('ollama') || lower.includes('HYSA_ENABLE_LOCAL_FALLBACK'))) {
      score += 20;
    }
    if (hasFallback && (lower.includes('fallback') || lower.includes('cooldown') || lower.includes('HYSA_ENABLE_LOCAL_FALLBACK'))) {
      score += 15;
    }
    if (hasLocal && (lower.includes('local') || lower.includes('ollama') || lower.includes('HYSA_ENABLE_LOCAL_FALLBACK'))) {
      score += 15;
    }
    if (hasRateLimit && (lower.includes('rate') || lower.includes('limit') || lower.includes('cooldown') || lower.includes('timeout'))) {
      score += 15;
    }
  }

  return score;
}

// ── Provider nodes: extract providers from event labels too ──

function extractProvidersFromAllNodes(nodes: ExperienceGraphNode[]): string[] {
  const providers = new Set<string>();

  // From kind=provider nodes
  for (const n of nodes) {
    if (n.kind === 'provider') {
      providers.add(n.label);
    }
  }

  // From event labels like provider_failed:anthropic_proxy/claude-3-haiku-latest
  for (const n of nodes) {
    if (n.kind === 'event' && n.label) {
      const colonIdx = n.label.indexOf(':');
      if (colonIdx !== -1) {
        const rest = n.label.slice(colonIdx + 1); // e.g. "anthropic_proxy/claude-3-haiku-latest"
        const slashIdx = rest.indexOf('/');
        if (slashIdx !== -1) {
          providers.add(rest.slice(0, slashIdx));
        }
      }
    }
  }

  return [...providers].sort();
}

function formatProviderNodes(nodes: ExperienceGraphNode[]): {
  summary: string;
  explanation: string;
  providers: string[];
} {
  const lines: string[] = [];
  const seenEvents = new Set<string>();
  let hasRateLimit = false;
  let hasConnectionError = false;
  let hasTimeout = false;
  let hasUnavailable = false;

  const failureEvents = nodes.filter(n =>
    n.kind === 'event' && n.label && n.label.includes('provider_failed')
  );
  const successEvents = nodes.filter(n =>
    n.kind === 'event' && n.label && n.label.includes('provider_succeeded')
  );

  for (const e of failureEvents) {
    const key = e.label;
    if (!seenEvents.has(key)) {
      seenEvents.add(key);
      const summary = e.summary || e.label;
      const display = summary.replace(/^event:/, '');
      lines.push(`  ❌ ${display}`);
      const lower = summary.toLowerCase();
      if (lower.includes('rate')) hasRateLimit = true;
      if (lower.includes('connection error')) hasConnectionError = true;
      if (lower.includes('timeout')) hasTimeout = true;
      if (lower.includes('unavailable')) hasUnavailable = true;
    }
  }

  for (const e of successEvents) {
    const key = e.label;
    if (!seenEvents.has(key)) {
      seenEvents.add(key);
      const summary = e.summary || e.label;
      const display = summary.replace(/^event:/, '');
      lines.push(`  ✅ ${display}`);
    }
  }

  const providers = extractProvidersFromAllNodes(nodes);
  const models = [...new Set(
    nodes.filter(n => n.kind === 'model').map(n => n.label)
  )];

  // Build explanation paragraph
  const explanationParts: string[] = [];
  if (hasRateLimit) explanationParts.push('some online/free providers previously hit rate limits');
  if (hasConnectionError) explanationParts.push('some providers had connection errors');
  if (hasTimeout) explanationParts.push('some providers timed out');
  if (hasUnavailable) explanationParts.push('some providers were temporarily unavailable');

  let explanation = '';
  if (explanationParts.length > 0) {
    explanation = `Summary: ${explanationParts.join('; ')}. HYSA puts failing models on cooldown and retries other providers. Local fallback (Ollama) is disabled by default — use HYSA_ENABLE_LOCAL_FALLBACK=true or --provider ollama to enable. Tests should mock live provider failures rather than fail when free providers are busy.`;
  } else {
    explanation = 'Summary: HYSA puts failing models/providers on cooldown and retries fallback providers. Local fallback (Ollama) is disabled by default.';
  }

  if (lines.length === 0 && providers.length === 0) {
    return { summary: '[Provider History]\n  No provider events recorded.', explanation, providers: [] };
  }

  let result = '[Provider History]\n';
  if (lines.length > 0) {
    result += lines.join('\n');
  }
  if (providers.length > 0) {
    result += `\n  Providers involved: ${providers.join(', ')}`;
  }
  if (models.length > 0) {
    result += `\n  Models involved: ${models.join(', ')}`;
  }

  return { summary: result, explanation, providers };
}

function formatBugNodes(nodes: ExperienceGraphNode[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  const fixNodes = nodes.filter(n => n.kind === 'fix');
  for (const n of fixNodes) {
    if (!seen.has(n.label)) {
      seen.add(n.label);
      lines.push(`  🔧 Fix: ${n.label}`);
    }
  }

  const bugNodes = nodes.filter(n => n.kind === 'bug');
  for (const n of bugNodes) {
    if (!seen.has(n.label)) {
      seen.add(n.label);
      lines.push(`  🐛 Bug: ${n.label}`);
    }
  }

  if (lines.length === 0) return '[Bug/Fix History]\n  No bug/fix records found.';
  return `[Bug/Fix History]\n${lines.join('\n')}`;
}

export async function buildRecallContext(
  message: string,
  options?: {
    maxTokens?: number;
    includeProjectMap?: boolean;
    includeGraph?: boolean;
    includeLessons?: boolean;
    includeDecisions?: boolean;
  },
): Promise<RecallContext | null> {
  const intent = detectRecallIntent(message);
  if (intent === 'none') return null;

  // Fast path: if not clearly a memory query, skip broad scanning
  if (!isMemoryQuery(message)) return null;

  const maxTokens = options?.maxTokens ?? 800;
  const includeProjectMap = options?.includeProjectMap ?? true;
  const includeGraph = options?.includeGraph ?? true;
  const includeLessons = options?.includeLessons ?? true;
  const includeDecisions = options?.includeDecisions ?? true;
  const optionsMask = (includeProjectMap ? 1 : 0) | (includeGraph ? 2 : 0) | (includeLessons ? 4 : 0) | (includeDecisions ? 8 : 0);

  // Check session cache
  const cached = getCached(message, optionsMask);
  if (cached) return cached;

  const keywords = extractKeywords(message);
  const allDecisions: string[] = [];
  const allLessons: string[] = [];
  let matchedNodes: ExperienceGraphNode[] = [];
  let graphEdgeStrs: string[] = [];
  const warnings: string[] = [];
  let projectMapSummary: string | undefined;

  // Project map
  if (includeProjectMap) {
    try {
      const pm = await readProjectMap();
      if (pm) {
        const parts: string[] = [];
        if (pm.knownSystems.length > 0) {
          parts.push(`Systems: ${pm.knownSystems.join(', ')}`);
        }
        const modNames = Object.keys(pm.modules);
        if (modNames.length > 0) {
          parts.push(`Modules: ${modNames.slice(0, 8).join(', ')}`);
        }
        const cmdNames = Object.keys(pm.commands);
        if (cmdNames.length > 0) {
          parts.push(`Commands: ${cmdNames.join(', ')}`);
        }
        if (parts.length > 0) {
          projectMapSummary = parts.join(' | ');
        }
      }
    } catch { /* skip */ }
  }

  // Lessons & decisions
  if (includeLessons) {
    allLessons.push(...(await readLessons()));
  }
  if (includeDecisions) {
    allDecisions.push(...(await readDecisions()));
  }

  // Graph search
  if (includeGraph) {
    try {
      const graph = await readExperienceGraph();
      if (graph.nodes.length > 0) {
        const searchTerms = message.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
        if (searchTerms.length > 0) {
          const seenIds = new Set<string>();
          for (const term of searchTerms) {
            const result = await searchGraph(term);
            for (const n of result.nodes) {
              if (!seenIds.has(n.id)) {
                seenIds.add(n.id);
                matchedNodes.push(n);
              }
            }
            for (const e of result.edges) {
              const edgeStr = `${e.kind}:${e.from.slice(0, 6)}→${e.to.slice(0, 6)}`;
              if (!graphEdgeStrs.includes(edgeStr)) {
                graphEdgeStrs.push(edgeStr);
              }
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  // ── Intent-specific summaries ──

  if (intent === 'decision_history') {
    const scored = allDecisions.map(d => ({
      text: d,
      score: computeRelevance(d, keywords, message),
    }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored.filter(s => s.score >= 10);

    if (best.length > 0) {
      const chosen = best.slice(0, 3).map(s => s.text).join('\n');
      const ctx: RecallContext = {
        intent,
        summary: `[Decisions]\n${chosen}`,
        recentDecisions: best.slice(0, 3).map(s => s.text),
        warnings: warnings.length > 0 ? warnings : undefined,
        projectMapSummary: projectMapSummary || undefined,
      };
      setCached(message, optionsMask, ctx);
      return ctx;
    }

    const graphDecisions = matchedNodes.filter(n => n.kind === 'decision');
    if (graphDecisions.length > 0) {
      const lines = graphDecisions.slice(0, 3).map(n => `${n.label}: ${n.summary || ''}`).join('\n');
      const ctx: RecallContext = {
        intent,
        summary: `[Decisions]\n${lines}`,
        warnings: warnings.length > 0 ? warnings : undefined,
        projectMapSummary: projectMapSummary || undefined,
      };
      setCached(message, optionsMask, ctx);
      return ctx;
    }

    const noDecision: RecallContext = {
      intent,
      summary: '[Decisions]\n  No relevant decision found for your query.',
      warnings: ['No relevant decision found.'],
    };
    setCached(message, optionsMask, noDecision);
    return noDecision;
  }

  if (intent === 'lesson_history') {
    const scored = allLessons.map(l => ({
      text: l,
      score: computeRelevance(l, keywords, message),
    }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored.filter(s => s.score >= 10);

    if (best.length > 0) {
      const chosen = best.slice(0, 3).map(s => s.text).join('\n');
      const ctx: RecallContext = { intent, summary: `[Lessons]\n${chosen}`, recentLessons: best.slice(0, 3).map(s => s.text) };
      setCached(message, optionsMask, ctx);
      return ctx;
    }

    if (allLessons.length > 0) {
      const ctx: RecallContext = { intent, summary: `[Lessons]\n${allLessons.slice(0, 2).join('\n')}`, recentLessons: allLessons.slice(0, 2), warnings: ['Weak relevance — showing most recent lessons.'] };
      setCached(message, optionsMask, ctx);
      return ctx;
    }

    const noLessons: RecallContext = { intent, summary: '[Lessons]\n  No lessons recorded yet.', warnings: ['No lessons found.'] };
    setCached(message, optionsMask, noLessons);
    return noLessons;
  }

  if (intent === 'provider_history') {
    const formatted = formatProviderNodes(matchedNodes);

    const queryLower = message.toLowerCase();
    const hasFallbackContext = queryLower.includes('ollama') || queryLower.includes('fallback') || queryLower.includes('local') || queryLower.includes('cooldown') || queryLower.includes('rate') || queryLower.includes('limit') || queryLower.includes('provider') || queryLower.includes('model');

    // Build explanation into the summary
    const explanationBlock = `\n\n${formatted.explanation}`;

    let extra = '';
    let relLessons: { text: string; score: number }[] = [];
    let relDecisions: { text: string; score: number }[] = [];

    if (hasFallbackContext) {
      relLessons = allLessons
        .map(l => ({ text: l, score: computeRelevance(l, keywords, message, true) }))
        .filter(l => l.score >= 10)
        .slice(0, 2);
      relDecisions = allDecisions
        .map(d => ({ text: d, score: computeRelevance(d, keywords, message, true) }))
        .filter(d => d.score >= 10)
        .slice(0, 2);

      if (relLessons.length > 0) {
        extra += '\n\nRelated lessons:\n' + relLessons.map(l => `  • ${l.text}`).join('\n');
      }
      if (relDecisions.length > 0) {
        extra += '\n\nRelated decisions:\n' + relDecisions.map(d => `  • ${d.text}`).join('\n');
      }
    }

    const graphNodeLabels = matchedNodes
      .filter(n => n.kind === 'provider' || n.kind === 'model')
      .map(n => `${n.kind}:${n.label}`);

    const provCtx: RecallContext = {
      intent,
      summary: formatted.summary + explanationBlock + extra,
      relevantGraphNodes: graphNodeLabels.length > 0 ? graphNodeLabels.slice(0, 15) : undefined,
      relevantGraphEdges: graphEdgeStrs.length > 0 ? graphEdgeStrs.slice(0, 10) : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      projectMapSummary: projectMapSummary || undefined,
      recentDecisions: relDecisions.length > 0 ? relDecisions.map(d => d.text) : undefined,
      recentLessons: relLessons.length > 0 ? relLessons.map(l => l.text) : undefined,
    };
    setCached(message, optionsMask, provCtx);
    return provCtx;
  }

  if (intent === 'bug_history' || intent === 'browser_history') {
    const summary = formatBugNodes(matchedNodes);
    const bugLabels = matchedNodes
      .filter(n => n.kind === 'bug' || n.kind === 'fix' || n.kind === 'event')
      .map(n => `${n.kind}:${n.label}`);

    const bugCtx: RecallContext = {
      intent,
      summary,
      relevantGraphNodes: bugLabels.length > 0 ? bugLabels.slice(0, 10) : undefined,
      relevantGraphEdges: graphEdgeStrs.length > 0 ? graphEdgeStrs.slice(0, 5) : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      projectMapSummary: projectMapSummary || undefined,
    };
    setCached(message, optionsMask, bugCtx);
    return bugCtx;
  }

  if (intent === 'project_context') {
    const summaryLines: string[] = [];
    if (projectMapSummary) {
      summaryLines.push(`[Project Context]\n${projectMapSummary}`);
    }
    if (allLessons.length > 0) {
      summaryLines.push(`\nLessons: ${allLessons.slice(0, 2).join('; ')}`);
    }
    if (allDecisions.length > 0) {
      summaryLines.push(`\nDecisions: ${allDecisions.slice(0, 2).join('; ')}`);
    }
    const graphLabels = matchedNodes
      .filter(n => n.kind !== 'event' || !n.label.includes('provider_succeeded'))
      .map(n => `${n.kind}:${n.label}`);
    if (graphLabels.length > 0) {
      summaryLines.push(`\nGraph: ${graphLabels.slice(0, 5).join(', ')}`);
    }

    if (summaryLines.length === 0 && !projectMapSummary) return null;

    const projCtx: RecallContext = {
      intent,
      summary: summaryLines.join('\n'),
      projectMapSummary,
      recentLessons: allLessons.length > 0 ? allLessons.slice(0, 2) : undefined,
      recentDecisions: allDecisions.length > 0 ? allDecisions.slice(0, 2) : undefined,
      relevantGraphNodes: graphLabels.length > 0 ? graphLabels.slice(0, 10) : undefined,
    };
    setCached(message, optionsMask, projCtx);
    return projCtx;
  }

  if (intent === 'skill_history') {
    const skillLabels = matchedNodes
      .filter(n => n.kind === 'skill')
      .map(n => `${n.kind}:${n.label}`);

    if (skillLabels.length > 0) {
      const skillCtx: RecallContext = { intent, summary: `[Skills]\n  ${skillLabels.slice(0, 5).join(', ')}`, relevantGraphNodes: skillLabels.slice(0, 5) };
      setCached(message, optionsMask, skillCtx);
      return skillCtx;
    }

    const noSkill: RecallContext = { intent, summary: '[Skills]\n  No skill records found.' };
    setCached(message, optionsMask, noSkill);
    return noSkill;
  }

  // Fallback
  const fallbackParts: string[] = [];
  if (projectMapSummary) fallbackParts.push(`Project: ${projectMapSummary}`);
  if (allLessons.length > 0) fallbackParts.push(`Lessons: ${allLessons.slice(0, 2).join('; ')}`);
  if (allDecisions.length > 0) fallbackParts.push(`Decisions: ${allDecisions.slice(0, 2).join('; ')}`);
  if (matchedNodes.length > 0) {
    const labels = matchedNodes.map(n => `${n.kind}:${n.label}`).slice(0, 5);
    fallbackParts.push(`Graph: ${labels.join(', ')}`);
  }

  if (fallbackParts.length === 0) return null;

  const fbCtx: RecallContext = {
    intent,
    summary: `[Project Memory]\n${fallbackParts.join('\n')}`,
    projectMapSummary,
    recentLessons: allLessons.length > 0 ? allLessons.slice(0, 3) : undefined,
    recentDecisions: allDecisions.length > 0 ? allDecisions.slice(0, 3) : undefined,
    relevantGraphNodes: matchedNodes.map(n => `${n.kind}:${n.label}`).slice(0, 10),
  };
  setCached(message, optionsMask, fbCtx);
  return fbCtx;
}

export function formatRecallContext(ctx: RecallContext): string {
  const redacted = redact(ctx.summary) as string;
  return `\n[Project Memory]\n${redacted}\n`;
}

export async function isRecallAvailable(): Promise<boolean> {
  try {
    const pm = await readProjectMap();
    if (pm) return true;
    const graph = await readExperienceGraph();
    if (graph.nodes.length > 0) return true;
    const lessons = await readLessons();
    if (lessons.length > 0) return true;
    const decisions = await readDecisions();
    if (decisions.length > 0) return true;
    return false;
  } catch {
    return false;
  }
}
