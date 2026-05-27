import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getBrainDir, readProjectMap, redact } from './store.js';
import { readExperienceGraph, searchGraph } from './graph-store.js';
import { getCached, setCached } from './recall-cache.js';
// ── Lightweight stemmer ──
function stem(word) {
    if (word.length < 4)
        return word;
    let s = word.toLowerCase();
    // -tion → t (e.g., "implementation" -> "implementat", matches "implement")
    if (s.endsWith('tion') && s.length > 5)
        s = s.slice(0, -3);
    // -ing → (e.g., "running" -> "runn", matches "run" partially; also "formatting" -> "formatt")
    if (s.endsWith('ing') && s.length > 4)
        s = s.slice(0, -3);
    // -ed → (e.g., "changed" -> "chang", matches "change")
    if (s.endsWith('ed') && s.length > 4 && !s.endsWith('eed'))
        s = s.slice(0, -2);
    // -ly → (e.g., "recently" -> "recent")
    if (s.endsWith('ly') && s.length > 4)
        s = s.slice(0, -2);
    // -es → (e.g., "changes" -> "chang", matches "change")
    if (s.endsWith('es') && s.length > 4)
        s = s.slice(0, -2);
    // -s (but not ss) → (e.g., "projects" -> "project")
    if (s.endsWith('s') && !s.endsWith('ss') && s.length > 3)
        s = s.slice(0, -1);
    // -er → (e.g., "provider" -> "provid", matches "provide" loosely)
    if (s.endsWith('er') && s.length > 4) {
        const without = s.slice(0, -2);
        if (without.endsWith('id') || without.endsWith('ov') || without.endsWith('form')) {
            // keep er for common stems
        }
        else {
            s = without;
        }
    }
    return s;
}
function stemToken(token) {
    return stem(token.replace(/[^a-zA-Z0-9]/g, ''));
}
// ── Token overlap scoring ──
function tokenOverlap(query, text) {
    const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2).map(stemToken);
    const textTokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 2).map(stemToken);
    if (queryTokens.length === 0 || textTokens.length === 0)
        return 0;
    const overlap = queryTokens.filter(qt => textTokens.some(tt => tt === qt || tt.includes(qt) || qt.includes(tt))).length;
    const unique = new Set([...queryTokens, ...textTokens]).size;
    return Math.round((overlap / unique) * 100);
}
// ── Partial match score ──
function partialMatchScore(query, text) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const lowerText = text.toLowerCase();
    let score = 0;
    for (const qw of queryWords) {
        if (lowerText.includes(qw)) {
            score += 10;
        }
        else {
            const stemmed = stemToken(qw);
            if (stemmed.length > 2 && lowerText.includes(stemmed)) {
                score += 5;
            }
        }
    }
    return score;
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
export function isMemoryQuery(message) {
    const trimmed = message.trim();
    if (!trimmed)
        return false;
    const lower = trimmed.toLowerCase();
    const words = lower.split(/\s+/);
    if (words.length <= 3) {
        return MEMORY_KEYWORDS.some(kw => lower.includes(kw));
    }
    return true;
}
// ── Intent detection ──
const INTENT_PATTERNS = [
    {
        intent: 'lesson_history',
        patterns: [
            /(?:what|any|the)\s+lessons?/i,
            /lessons?\s+(?:learn(?:t|ed)?|about)/i,
            /rate\s+limit\s+lesson/i,
        ],
    },
    {
        intent: 'decision_history',
        patterns: [
            /(?:what|any|the)\s+decisi(?:on|ons)/i,
            /(?:decide?|decisi(?:on|ons))\s+(?:about|on|regarding|for)/i,
            /what\s+did\s+(?:we|you)\s+decide/i,
            /decision/i,
            /architecture\s+decision/i,
        ],
    },
    {
        intent: 'session_recall',
        patterns: [
            /(?:last|previous|recent)\s+session/i,
            /what\s+(?:happened|changed)\s+(?:in|during|last)\s+(?:session|the\s+session)/i,
            /what\s+did\s+(?:we|you)\s+do\s+(?:last\s+time|in\s+the\s+last\s+session|yesterday)/i,
            /what\s+did\s+(?:we|you)\s+fix\s+(?:yesterday|last\s+time)/i,
        ],
    },
    {
        intent: 'bug_history',
        patterns: [
            /(?:what|any|the)\s+(?:bug|bugs|issue|problem|fix|fixes)/i,
            /(?:bug|bugs)\s+(?:in|with|about|fix(?:ed)?)/i,
            /what\s+(?:was|were|is)\s+(?:the|that)\s+(?:bug|issue|problem)/i,
            /(?:bug|issue|problem)\s+in\s+(?:the\s+)?browser/i,
            /what\s+(?:did\s+)?we\s+fix/i,
            /what\s+was\s+(?:the\s+)?(?:browser|session)\s+(?:bug|issue|problem)/i,
            /how\s+did\s+(?:we|you)\s+(?:fix|resolve|solve)/i,
        ],
    },
    {
        intent: 'browser_history',
        patterns: [
            /browser\s+(?:session|daemon|bug|issue|problem|status|history)/i,
            /browser\s+was/i,
        ],
    },
    {
        intent: 'provider_history',
        patterns: [
            /(?:provider|model|fallback)\s+(?:fail|failure|error|issue|problem|history|slow|rate.limit)/i,
            /why\s+(?:did|was|is)\s+(?:the\s+)?(?:provider|model|fallback)/i,
            /provider\s+(?:cooldown|health|status)/i,
            /rate\s+limit/i,
            /quota/i,
            /what\s+happened\s+(?:with|to)\s+(?:fallback|provider)/i,
        ],
    },
    {
        intent: 'project_context',
        patterns: [
            /(?:tell|show|give|list)\s+(?:me\s+)?(?:about|what)\s+(?:the\s+)?(?:project|changes?|update|session|work)/i,
            /(?:what|summarize|tell|describe)\s+(?:me\s+)?(?:recent|about|the|current|project|changes|update)/i,
            /what\s+(?:did|have)\s+(?:we|you)\s+(?:change|done|update|modify)/i,
            /(?:recent|latest)\s+(?:change|changes|update|updates)/i,
            /what\s+files?\s+(?:are|were|is)\s+(?:important|changed|modify)/i,
            /smart\s+router/i,
            /project\s+(?:structure|memory|map|context)/i,
            /what\s+(?:did\s+)?we\s+(?:do|work\s+on)/i,
            /what\s+changed\s+recently/i,
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
    /^(?:hi|hello|hey|yo|sup|bye|goodbye|cya|salam)\b/i,
    /^(?:thanks?|thank\s+you|ok|okay|nice|good|great|perfect|yes|no|sure|lol)\b/i,
    /^write\s+(?:a|an|the)\s+(?:simple\s+)?(?:game|app|program|function|component|script)/i,
    /^explain\s+(?:React|JavaScript|TypeScript|Python|CSS|HTML)/i,
    /^hysa\s+(?:search|websearch|browser|skill)/i,
    /^\/(?:browser|skill)/,
];
export function detectRecallIntent(message) {
    const trimmed = message.trim();
    for (const p of NEGATIVE_PATTERNS) {
        if (p.test(trimmed))
            return 'none';
    }
    for (const entry of INTENT_PATTERNS) {
        for (const p of entry.patterns) {
            if (p.test(trimmed))
                return entry.intent;
        }
    }
    return 'none';
}
// ── Smart truncation: no mid-word cuts, prefers sentence boundaries ──
function truncateText(text, maxLen) {
    if (text.length <= maxLen)
        return text;
    const searchStart = Math.max(0, maxLen - 40);
    const searchArea = text.slice(searchStart, maxLen);
    const sentenceEnd = searchArea.search(/[.!?]\s/);
    if (sentenceEnd !== -1) {
        const cutPos = searchStart + sentenceEnd + 1;
        return text.slice(0, cutPos) + '...';
    }
    const wordBoundary = text.lastIndexOf(' ', maxLen - 1);
    if (wordBoundary > maxLen - 10) {
        return text.slice(0, wordBoundary) + '...';
    }
    return text.slice(0, maxLen - 3) + '...';
}
// ── Parse lessons/decisions with smart truncation ──
async function readLessons() {
    try {
        const filePath = join(getBrainDir(), 'lessons.md');
        if (!existsSync(filePath))
            return [];
        const content = await readFile(filePath, 'utf8');
        const entries = [];
        let currentTitle = '';
        let currentBody = '';
        for (const line of content.split('\n')) {
            if (line.startsWith('## ')) {
                if (currentTitle) {
                    entries.push(`${currentTitle}: ${truncateText(currentBody.trim(), 280)}`);
                }
                currentTitle = line.replace('## ', '').trim();
                currentBody = '';
            }
            else if (currentTitle) {
                currentBody += line + ' ';
            }
        }
        if (currentTitle) {
            entries.push(`${currentTitle}: ${truncateText(currentBody.trim(), 280)}`);
        }
        return entries;
    }
    catch {
        return [];
    }
}
async function readDecisions() {
    try {
        const filePath = join(getBrainDir(), 'decisions.md');
        if (!existsSync(filePath))
            return [];
        const content = await readFile(filePath, 'utf8');
        const entries = [];
        let currentTitle = '';
        let currentBody = '';
        for (const line of content.split('\n')) {
            if (line.startsWith('## ')) {
                if (currentTitle) {
                    entries.push(`${currentTitle}: ${truncateText(currentBody.trim(), 280)}`);
                }
                currentTitle = line.replace('## ', '').trim();
                currentBody = '';
            }
            else if (currentTitle) {
                currentBody += line + ' ';
            }
        }
        if (currentTitle) {
            entries.push(`${currentTitle}: ${truncateText(currentBody.trim(), 280)}`);
        }
        return entries;
    }
    catch {
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
function extractKeywords(message) {
    const tokens = message.toLowerCase().split(/\s+/);
    return [...new Set(tokens.filter(t => t.length >= 3 && !STOP_WORDS.has(t)))];
}
function computeRelevance(text, keywords, queryMessage, providerOnly) {
    const lower = text.toLowerCase();
    let score = 0;
    // Direct keyword match
    for (const kw of keywords) {
        if (lower.includes(kw)) {
            score += 10;
        }
        else {
            // Try stemmed match
            const stemmed = stemToken(kw);
            if (stemmed.length > 2 && lower.includes(stemmed)) {
                score += 5;
            }
        }
    }
    // Title match bonus (text before first colon)
    const titlePart = text.includes(':') ? text.split(':')[0].toLowerCase() : '';
    for (const kw of keywords) {
        if (titlePart.includes(kw)) {
            score += 5;
        }
        else {
            const stemmed = stemToken(kw);
            if (stemmed.length > 2 && titlePart.includes(stemmed)) {
                score += 3;
            }
        }
    }
    // Token overlap bonus
    const overlap = tokenOverlap(queryMessage, text);
    score += Math.round(overlap * 0.3);
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
function computeNodeRelevanceV2(node, queryMessage, keywords) {
    const nodeText = `${node.label} ${node.summary || ''}`;
    const lower = nodeText.toLowerCase();
    // Title direct match
    let titleScore = 0;
    const titleLower = node.label.toLowerCase();
    for (const kw of keywords) {
        if (titleLower.includes(kw))
            titleScore += 15;
    }
    if (titleScore === 0) {
        for (const kw of keywords) {
            const stemmed = stemToken(kw);
            if (stemmed.length > 2 && titleLower.includes(stemmed))
                titleScore += 8;
        }
    }
    // Body direct match
    let bodyScore = 0;
    const bodyLower = (node.summary || '').toLowerCase();
    for (const kw of keywords) {
        if (bodyLower.includes(kw))
            bodyScore += 10;
    }
    if (bodyScore === 0) {
        for (const kw of keywords) {
            const stemmed = stemToken(kw);
            if (stemmed.length > 2 && bodyLower.includes(stemmed))
                bodyScore += 5;
        }
    }
    // Fuzzy token overlap
    const fuzzyScore = tokenOverlap(queryMessage, nodeText);
    // Recency boost (0-20)
    const age = Date.now() - new Date(node.createdAt).getTime();
    const DAY_MS = 86_400_000;
    let recencyBoost = 0;
    if (age < DAY_MS)
        recencyBoost = 20;
    else if (age < 7 * DAY_MS)
        recencyBoost = 15;
    else if (age < 30 * DAY_MS)
        recencyBoost = 10;
    else if (age < 90 * DAY_MS)
        recencyBoost = 5;
    // Pinned boost
    const pinnedBoost = node.pinned ? 20 : 0;
    // Importance/confidence weighting
    const imp = (node.importance ?? 50) / 50;
    const conf = (node.confidence ?? 50) / 50;
    const importanceConfidenceBoost = Math.round((imp * conf - 1) * 15);
    const total = titleScore + bodyScore + fuzzyScore + recencyBoost + pinnedBoost + importanceConfidenceBoost;
    return { titleScore, bodyScore, fuzzyScore, recencyBoost, pinnedBoost, importanceConfidenceBoost, total };
}
// ── Provider nodes: extract providers from event labels too ──
function extractProvidersFromAllNodes(nodes) {
    const providers = new Set();
    for (const n of nodes) {
        if (n.kind === 'provider') {
            providers.add(n.label);
        }
    }
    for (const n of nodes) {
        if (n.kind === 'event' && n.label) {
            const colonIdx = n.label.indexOf(':');
            if (colonIdx !== -1) {
                const rest = n.label.slice(colonIdx + 1);
                const slashIdx = rest.indexOf('/');
                if (slashIdx !== -1) {
                    providers.add(rest.slice(0, slashIdx));
                }
            }
        }
    }
    return [...providers].sort();
}
function formatProviderNodes(nodes) {
    const lines = [];
    const seenEvents = new Set();
    let hasRateLimit = false;
    let hasConnectionError = false;
    let hasTimeout = false;
    let hasUnavailable = false;
    const failureEvents = nodes.filter(n => n.kind === 'event' && n.label && n.label.includes('provider_failed'));
    const successEvents = nodes.filter(n => n.kind === 'event' && n.label && n.label.includes('provider_succeeded'));
    for (const e of failureEvents) {
        const key = e.label;
        if (!seenEvents.has(key)) {
            seenEvents.add(key);
            const summary = e.summary || e.label;
            const display = summary.replace(/^event:/, '');
            lines.push(`  ❌ ${display}`);
            const lower = summary.toLowerCase();
            if (lower.includes('rate'))
                hasRateLimit = true;
            if (lower.includes('connection error'))
                hasConnectionError = true;
            if (lower.includes('timeout'))
                hasTimeout = true;
            if (lower.includes('unavailable'))
                hasUnavailable = true;
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
    const models = [...new Set(nodes.filter(n => n.kind === 'model').map(n => n.label))];
    const explanationParts = [];
    if (hasRateLimit)
        explanationParts.push('some online/free providers previously hit rate limits');
    if (hasConnectionError)
        explanationParts.push('some providers had connection errors');
    if (hasTimeout)
        explanationParts.push('some providers timed out');
    if (hasUnavailable)
        explanationParts.push('some providers were temporarily unavailable');
    let explanation = '';
    if (explanationParts.length > 0) {
        explanation = `Summary: ${explanationParts.join('; ')}. HYSA puts failing models on cooldown and retries other providers. Local fallback (Ollama) is disabled by default — use HYSA_ENABLE_LOCAL_FALLBACK=true or --provider ollama to enable. Tests should mock live provider failures rather than fail when free providers are busy.`;
    }
    else {
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
function formatBugNodes(nodes) {
    const lines = [];
    const seen = new Set();
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
    if (lines.length === 0)
        return '[Bug/Fix History]\n  No bug/fix records found.';
    return `[Bug/Fix History]\n${lines.join('\n')}`;
}
// ── Session recall ──
async function formatSessionRecall() {
    try {
        const { loadSession, generateSummary, isTrivialSession } = await import('./session-tracker.js');
        const state = await loadSession();
        if (!state || isTrivialSession(state)) {
            return '[Session]\n  No previous session data found.';
        }
        const summary = await generateSummary();
        const lines = ['[Last Session]'];
        lines.push(`  Duration: ${summary.duration}`);
        lines.push(`  Status: ${summary.finalStatus}`);
        if (summary.commandsRun.length > 0) {
            lines.push(`  Commands: ${summary.commandsRun.join(', ')}`);
        }
        if (summary.filesChanged.length > 0) {
            lines.push(`  Files changed: ${summary.filesChanged.join(', ')}`);
        }
        if (summary.decisionsMade.length > 0) {
            lines.push(`  Decisions: ${summary.decisionsMade.join('; ')}`);
        }
        if (summary.lessonsLearned.length > 0) {
            lines.push(`  Lessons: ${summary.lessonsLearned.join('; ')}`);
        }
        if (summary.unresolvedIssues.length > 0) {
            lines.push(`  Unresolved: ${summary.unresolvedIssues.join('; ')}`);
        }
        lines.push(`  Build/Tests: ${summary.testsBuildStatus}`);
        return lines.join('\n');
    }
    catch {
        return '[Session]\n  Unable to load session data.';
    }
}
// ── Main recall builder ──
export async function buildRecallContext(message, options) {
    const intent = detectRecallIntent(message);
    const debugMode = options?.debugMode ?? false;
    const debugInfo = {
        query: message,
        intent,
        intentDetected: intent !== 'none',
        cacheHit: false,
    };
    if (intent === 'none') {
        if (debugMode) {
            return {
                intent: 'none',
                summary: '[No Intent]\n  Query did not match any recall intent pattern.',
                debugInfo,
            };
        }
        return null;
    }
    // Fast path: if not clearly a memory query, skip broad scanning
    if (!isMemoryQuery(message)) {
        if (debugMode) {
            debugInfo.skippedMemories = [{ text: 'all', reason: 'Not a memory query (isMemoryQuery returned false)' }];
            return {
                intent,
                summary: '',
                debugInfo,
            };
        }
        return null;
    }
    const maxTokens = options?.maxTokens ?? 800;
    const includeProjectMap = options?.includeProjectMap ?? true;
    const includeGraph = options?.includeGraph ?? true;
    const includeLessons = options?.includeLessons ?? true;
    const includeDecisions = options?.includeDecisions ?? true;
    const optionsMask = (includeProjectMap ? 1 : 0) | (includeGraph ? 2 : 0) | (includeLessons ? 4 : 0) | (includeDecisions ? 8 : 0);
    // Check cache
    const cached = getCached(message, optionsMask);
    if (cached) {
        debugInfo.cacheHit = true;
        const ctx = cached;
        if (debugMode) {
            ctx.debugInfo = debugInfo;
        }
        return ctx;
    }
    const keywords = extractKeywords(message);
    const allDecisions = [];
    const allLessons = [];
    let matchedNodes = [];
    let graphEdgeStrs = [];
    const warnings = [];
    let projectMapSummary;
    // Project map
    if (includeProjectMap) {
        try {
            const pm = await readProjectMap();
            if (pm) {
                const parts = [];
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
        }
        catch { /* skip */ }
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
                    const seenIds = new Set();
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
                // If no keywords matched, try node-level scoring with V2
                if (matchedNodes.length === 0 && keywords.length > 0) {
                    const scored = graph.nodes.map(n => ({
                        node: n,
                        score: computeNodeRelevanceV2(n, message, keywords),
                    })).filter(s => s.score.total > 0)
                        .sort((a, b) => b.score.total - a.score.total);
                    matchedNodes = scored.slice(0, 10).map(s => s.node);
                }
            }
        }
        catch { /* skip */ }
    }
    // ── Session recall path ──
    if (intent === 'session_recall') {
        const sessionSummary = await formatSessionRecall();
        const ctx = {
            intent,
            summary: sessionSummary,
            debugInfo: debugMode ? debugInfo : undefined,
        };
        setCached(message, optionsMask, ctx);
        return ctx;
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
            const ctx = {
                intent,
                summary: `[Decisions]\n${chosen}`,
                recentDecisions: best.slice(0, 3).map(s => s.text),
                warnings: warnings.length > 0 ? warnings : undefined,
                projectMapSummary: projectMapSummary || undefined,
                debugInfo: debugMode ? debugInfo : undefined,
            };
            setCached(message, optionsMask, ctx);
            return ctx;
        }
        const graphDecisions = matchedNodes.filter(n => n.kind === 'decision');
        if (graphDecisions.length > 0) {
            const lines = graphDecisions.slice(0, 3).map(n => `${n.label}: ${n.summary || ''}`).join('\n');
            const ctx = {
                intent,
                summary: `[Decisions]\n${lines}`,
                warnings: warnings.length > 0 ? warnings : undefined,
                projectMapSummary: projectMapSummary || undefined,
                debugInfo: debugMode ? debugInfo : undefined,
            };
            setCached(message, optionsMask, ctx);
            return ctx;
        }
        const noDecision = {
            intent,
            summary: '[Decisions]\n  No relevant decision found for your query.',
            warnings: ['No relevant decision found.'],
            debugInfo: debugMode ? debugInfo : undefined,
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
            const ctx = { intent, summary: `[Lessons]\n${chosen}`, recentLessons: best.slice(0, 3).map(s => s.text), debugInfo: debugMode ? debugInfo : undefined };
            setCached(message, optionsMask, ctx);
            return ctx;
        }
        if (allLessons.length > 0) {
            const ctx = { intent, summary: `[Lessons]\n${allLessons.slice(0, 2).join('\n')}`, recentLessons: allLessons.slice(0, 2), warnings: ['Weak relevance — showing most recent lessons.'], debugInfo: debugMode ? debugInfo : undefined };
            setCached(message, optionsMask, ctx);
            return ctx;
        }
        const noLessons = { intent, summary: '[Lessons]\n  No lessons recorded yet.', warnings: ['No lessons found.'], debugInfo: debugMode ? debugInfo : undefined };
        setCached(message, optionsMask, noLessons);
        return noLessons;
    }
    if (intent === 'provider_history') {
        const formatted = formatProviderNodes(matchedNodes);
        const queryLower = message.toLowerCase();
        const hasFallbackContext = queryLower.includes('ollama') || queryLower.includes('fallback') || queryLower.includes('local') || queryLower.includes('cooldown') || queryLower.includes('rate') || queryLower.includes('limit') || queryLower.includes('provider') || queryLower.includes('model');
        const explanationBlock = `\n\n${formatted.explanation}`;
        let extra = '';
        let relLessons = [];
        let relDecisions = [];
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
        const provCtx = {
            intent,
            summary: formatted.summary + explanationBlock + extra,
            relevantGraphNodes: graphNodeLabels.length > 0 ? graphNodeLabels.slice(0, 15) : undefined,
            relevantGraphEdges: graphEdgeStrs.length > 0 ? graphEdgeStrs.slice(0, 10) : undefined,
            warnings: warnings.length > 0 ? warnings : undefined,
            projectMapSummary: projectMapSummary || undefined,
            recentDecisions: relDecisions.length > 0 ? relDecisions.map(d => d.text) : undefined,
            recentLessons: relLessons.length > 0 ? relLessons.map(l => l.text) : undefined,
            debugInfo: debugMode ? debugInfo : undefined,
        };
        setCached(message, optionsMask, provCtx);
        return provCtx;
    }
    if (intent === 'bug_history' || intent === 'browser_history') {
        const summary = formatBugNodes(matchedNodes);
        const bugLabels = matchedNodes
            .filter(n => n.kind === 'bug' || n.kind === 'fix' || n.kind === 'event')
            .map(n => `${n.kind}:${n.label}`);
        const bugCtx = {
            intent,
            summary,
            relevantGraphNodes: bugLabels.length > 0 ? bugLabels.slice(0, 10) : undefined,
            relevantGraphEdges: graphEdgeStrs.length > 0 ? graphEdgeStrs.slice(0, 5) : undefined,
            warnings: warnings.length > 0 ? warnings : undefined,
            projectMapSummary: projectMapSummary || undefined,
            debugInfo: debugMode ? debugInfo : undefined,
        };
        setCached(message, optionsMask, bugCtx);
        return bugCtx;
    }
    if (intent === 'project_context') {
        const summaryLines = [];
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
        if (summaryLines.length === 0 && !projectMapSummary) {
            if (debugMode) {
                return { intent, summary: '', debugInfo };
            }
            return null;
        }
        const projCtx = {
            intent,
            summary: summaryLines.join('\n'),
            projectMapSummary,
            recentLessons: allLessons.length > 0 ? allLessons.slice(0, 2) : undefined,
            recentDecisions: allDecisions.length > 0 ? allDecisions.slice(0, 2) : undefined,
            relevantGraphNodes: graphLabels.length > 0 ? graphLabels.slice(0, 10) : undefined,
            debugInfo: debugMode ? debugInfo : undefined,
        };
        setCached(message, optionsMask, projCtx);
        return projCtx;
    }
    if (intent === 'skill_history') {
        const skillLabels = matchedNodes
            .filter(n => n.kind === 'skill')
            .map(n => `${n.kind}:${n.label}`);
        if (skillLabels.length > 0) {
            const skillCtx = { intent, summary: `[Skills]\n  ${skillLabels.slice(0, 5).join(', ')}`, relevantGraphNodes: skillLabels.slice(0, 5), debugInfo: debugMode ? debugInfo : undefined };
            setCached(message, optionsMask, skillCtx);
            return skillCtx;
        }
        const noSkill = { intent, summary: '[Skills]\n  No skill records found.', debugInfo: debugMode ? debugInfo : undefined };
        setCached(message, optionsMask, noSkill);
        return noSkill;
    }
    // Fallback
    const fallbackParts = [];
    if (projectMapSummary)
        fallbackParts.push(`Project: ${projectMapSummary}`);
    if (allLessons.length > 0)
        fallbackParts.push(`Lessons: ${allLessons.slice(0, 2).join('; ')}`);
    if (allDecisions.length > 0)
        fallbackParts.push(`Decisions: ${allDecisions.slice(0, 2).join('; ')}`);
    if (matchedNodes.length > 0) {
        const labels = matchedNodes.map(n => `${n.kind}:${n.label}`).slice(0, 5);
        fallbackParts.push(`Graph: ${labels.join(', ')}`);
    }
    if (fallbackParts.length === 0) {
        if (debugMode) {
            return { intent, summary: '', debugInfo };
        }
        return null;
    }
    const fbCtx = {
        intent,
        summary: `[Project Memory]\n${fallbackParts.join('\n')}`,
        projectMapSummary,
        recentLessons: allLessons.length > 0 ? allLessons.slice(0, 3) : undefined,
        recentDecisions: allDecisions.length > 0 ? allDecisions.slice(0, 3) : undefined,
        relevantGraphNodes: matchedNodes.map(n => `${n.kind}:${n.label}`).slice(0, 10),
        debugInfo: debugMode ? debugInfo : undefined,
    };
    setCached(message, optionsMask, fbCtx);
    return fbCtx;
}
export function formatRecallContext(ctx) {
    const redacted = redact(ctx.summary);
    return `\n[Project Memory]\n${redacted}\n`;
}
export async function isRecallAvailable() {
    try {
        const pm = await readProjectMap();
        if (pm)
            return true;
        const graph = await readExperienceGraph();
        if (graph.nodes.length > 0)
            return true;
        const lessons = await readLessons();
        if (lessons.length > 0)
            return true;
        const decisions = await readDecisions();
        if (decisions.length > 0)
            return true;
        return false;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=recall.js.map