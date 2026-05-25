import { redact, containsSecret } from './store.js';
import { readExperienceGraph, searchGraph } from './graph-store.js';
const BUDGETS = {
    simple: 800,
    code: 2000,
    planning: 3000,
    provider: 1500,
};
// ── Keyword extraction ──
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
    'happen', 'happened', 'going', 'go', 'went', 'fix', 'debug', 'error',
    'make', 'write', 'create', 'add', 'remove', 'change', 'update',
]);
const PROVIDER_KEYWORDS = [
    'provider', 'fallback', 'rate', 'limit', 'cooldown', 'ollama',
    'openrouter', 'opencode_zen', 'groq', 'deepseek', 'gemini',
    'anthropic', 'openai', 'model', 'timeout', 'quota',
];
const CODE_KEYWORDS = [
    'fix', 'debug', 'bug', 'error', 'compile', 'type', 'lint',
    'test', 'fail', 'build', 'refactor', 'implement', 'feature',
];
function extractKeywords(message) {
    const tokens = message.toLowerCase().split(/\s+/);
    return [...new Set(tokens.filter(t => t.length >= 3 && !STOP_WORDS.has(t)))];
}
// ── Determine complexity from task kind + message ──
export function detectComplexity(taskKind, message) {
    const lower = message.toLowerCase();
    if (lower.includes('provider') || lower.includes('fallback') || lower.includes('cooldown') ||
        lower.includes('rate limit') || lower.includes('model health') || lower.includes('why did')) {
        return 'provider';
    }
    if (taskKind === 'code_edit' || taskKind === 'debugging' || taskKind === 'code_review' ||
        taskKind === 'coding_qa' || CODE_KEYWORDS.some(k => lower.includes(k))) {
        return 'code';
    }
    if (taskKind === 'planning' || taskKind === 'architecture' || lower.includes('plan') ||
        lower.includes('design') || lower.includes('architecture')) {
        return 'planning';
    }
    return 'simple';
}
// ── Scoring helpers ──
function scoreRelevance(text, keywords) {
    if (keywords.length === 0)
        return 10; // base score for no keywords
    const lower = text.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
        if (lower.includes(kw))
            score += 10;
    }
    // Title bonus (text before colon)
    const title = lower.includes(':') ? lower.split(':')[0] : lower;
    for (const kw of keywords) {
        if (title.includes(kw))
            score += 5;
    }
    return score;
}
function scoreRecency(createdAt) {
    const age = Date.now() - new Date(createdAt).getTime();
    const DAY_MS = 86_400_000;
    if (age < DAY_MS)
        return 100;
    if (age < 7 * DAY_MS)
        return 80;
    if (age < 30 * DAY_MS)
        return 50;
    if (age < 90 * DAY_MS)
        return 20;
    return 5;
}
// ── Format item as string ──
function formatItem(item) {
    const node = item.node;
    const kind = node.kind === 'decision' ? 'Decision' : node.kind === 'lesson' ? 'Lesson' : node.kind;
    let text = `[${kind}] ${node.label}`;
    if (node.summary && node.summary !== node.label && !containsSecret(node.summary)) {
        text += `: ${redact(node.summary)}`;
    }
    // Truncate to avoid massive context
    if (text.length > 500)
        text = text.slice(0, 497) + '...';
    return text;
}
export async function selectContext(opts) {
    const { message, taskKind, maxItems = 5, debug = false, } = opts;
    const complexity = detectComplexity(taskKind, message);
    const budget = BUDGETS[complexity];
    const keywords = extractKeywords(message);
    const lower = message.toLowerCase();
    const debugLines = [];
    let skippedCount = 0;
    let pinnedIncluded = 0;
    debugLines.push(`[Context Selector] complexity=${complexity}, budget=${budget}, keywords=[${keywords.join(', ')}]`);
    // Fast path: skip for very short messages that don't mention memory topics
    const words = message.split(/\s+/).filter(Boolean);
    const isShortMsg = words.length <= 3;
    const memoryMention = /decision|lesson|provider|fallback|rate|cooldown|ollama|history|bug|fix|memory|recall|error|issue|remember/i.test(lower);
    if (isShortMsg && !memoryMention && complexity === 'simple') {
        debugLines.push('  → Skipped: short non-memory message');
        return { items: [], totalChars: 0, budget, skippedCount: 0, pinnedIncluded: 0, debugExplanation: debugLines.join('\n') };
    }
    // ── Read graph and gather candidates ──
    const graph = await readExperienceGraph();
    if (graph.nodes.length === 0) {
        debugLines.push('  → Empty graph, nothing to inject');
        return { items: [], totalChars: 0, budget, skippedCount: 0, pinnedIncluded: 0, debugExplanation: debugLines.join('\n') };
    }
    // Gather candidates: by keyword search + pinned decisions
    const seen = new Set();
    const candidates = [];
    // First, add pinned decisions always
    const pinnedDecisions = graph.nodes.filter(n => n.kind === 'decision' && n.pinned);
    for (const n of pinnedDecisions) {
        if (!seen.has(n.id)) {
            seen.add(n.id);
            candidates.push(n);
        }
    }
    // Search by each keyword individually
    const searchTerms = keywords.length > 0 ? keywords : message.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    for (const term of searchTerms) {
        const result = await searchGraph(term);
        for (const n of result.nodes) {
            if (!seen.has(n.id)) {
                seen.add(n.id);
                candidates.push(n);
            }
        }
    }
    // If still no candidates, broaden: use full message search as fallback
    if (candidates.length === 0) {
        const result = await searchGraph(message);
        for (const n of result.nodes) {
            if (!seen.has(n.id)) {
                seen.add(n.id);
                candidates.push(n);
            }
        }
    }
    if (candidates.length === 0) {
        debugLines.push('  → No relevant candidates found');
        return { items: [], totalChars: 0, budget, skippedCount: 0, pinnedIncluded: 0, debugExplanation: debugLines.join('\n') };
    }
    // ── Score candidates ──
    const scored = [];
    for (const n of candidates) {
        // Skip if secrets detected in summary
        if (n.summary && containsSecret(n.summary)) {
            skippedCount++;
            debugLines.push(`  ⏭ [SECRET] ${n.kind}:${n.label} — redacted`);
            continue;
        }
        // Preserve pinned items through all filters
        if (n.pinned) {
            // keep pinned regardless of complexity
        }
        else if (complexity === 'provider') {
            // For provider-only tasks: skip non-provider items
            const isProviderRelated = n.kind === 'provider' || n.kind === 'model' ||
                (n.kind === 'event' && (n.label.includes('provider') || (n.tags && n.tags.includes('provider')))) ||
                (n.kind === 'lesson' && ((n.tags && n.tags.includes('provider')) || (n.summary && n.summary.toLowerCase().includes('provider'))));
            if (!isProviderRelated) {
                skippedCount++;
                continue;
            }
        }
        else if (complexity === 'code') {
            // For code tasks: prefer lessons + decisions, skip generic events
            if (n.kind === 'event' && !n.label.includes('fix') && !n.label.includes('bug') && !n.label.includes('test')) {
                skippedCount++;
                continue;
            }
        }
        // Never inject stale low-confidence provider events unless query explicitly asks
        if (n.kind === 'event' && n.label.startsWith('provider_succeeded') && (n.confidence ?? 50) < 40) {
            const isProviderQuery = PROVIDER_KEYWORDS.some(k => lower.includes(k));
            if (!isProviderQuery) {
                skippedCount++;
                debugLines.push(`  ⏭ [low-conf provider] ${n.label} (conf=${n.confidence})`);
                continue;
            }
        }
        const relevanceScore = scoreRelevance(n.label + ' ' + (n.summary || ''), keywords);
        const importanceScore = n.importance ?? 50;
        const confidenceScore = n.confidence ?? 50;
        const recencyScore = scoreRecency(n.createdAt);
        // Combined score: weighted average
        const totalScore = Math.round(relevanceScore * 0.4 + importanceScore * 0.25 + confidenceScore * 0.2 + recencyScore * 0.15);
        const formatted = formatItem({ node: n, relevanceScore, importanceScore, confidenceScore, recencyScore, totalScore, reason: '', charCount: 0 });
        const charCount = formatted.length;
        scored.push({
            node: n,
            relevanceScore,
            importanceScore,
            confidenceScore,
            recencyScore,
            totalScore,
            reason: '',
            charCount,
        });
    }
    if (scored.length === 0) {
        debugLines.push('  → All candidates filtered out');
        return { items: [], totalChars: 0, budget, skippedCount, pinnedIncluded: 0, debugExplanation: debugLines.join('\n') };
    }
    // ── Sort by total score descending ──
    scored.sort((a, b) => b.totalScore - a.totalScore);
    // ── Select items within budget ──
    const selected = [];
    let totalChars = 0;
    let pinnedInBudget = 0;
    for (const item of scored) {
        if (selected.length >= maxItems) {
            debugLines.push(`  ⏭ [max items] ${item.node.kind}:${item.node.label}`);
            skippedCount++;
            continue;
        }
        const wouldBeTotal = totalChars + item.charCount + (selected.length > 0 ? 2 : 0);
        if (wouldBeTotal > budget) {
            debugLines.push(`  ⏭ [budget] ${item.node.kind}:${item.node.label} (${item.charCount}c) — would exceed budget`);
            skippedCount++;
            continue;
        }
        // Assign reason
        const reasons = [];
        if (item.node.pinned) {
            reasons.push('pinned');
            pinnedInBudget++;
        }
        if (item.node.kind === 'lesson')
            reasons.push('lesson');
        if (item.node.kind === 'decision')
            reasons.push('decision');
        if (item.relevanceScore > 20)
            reasons.push('high-relevance');
        if (item.relevanceScore > 0 && item.relevanceScore <= 20)
            reasons.push('relevant');
        reasons.push(`score=${item.totalScore}`);
        item.reason = reasons.join(', ');
        selected.push(item);
        totalChars = wouldBeTotal;
    }
    pinnedIncluded = pinnedInBudget;
    // ── Build debug explanation ──
    debugLines.push(`  → Selected ${selected.length} items (${totalChars}/${budget} chars), skipped ${skippedCount}`);
    for (const item of selected) {
        const pin = item.node.pinned ? ' 📌' : '';
        debugLines.push(`    ✓ [${item.node.kind}] ${item.node.label.slice(0, 50)}${pin}`);
        debugLines.push(`      rel=${item.relevanceScore} imp=${item.importanceScore} conf=${item.confidenceScore} rec=${item.recencyScore} total=${item.totalScore}`);
        debugLines.push(`      reason: ${item.reason}`);
    }
    return {
        items: selected,
        totalChars,
        budget,
        skippedCount,
        pinnedIncluded,
        debugExplanation: debugLines.join('\n'),
    };
}
// ── Format selected context for system prompt ──
export function formatSelectedContext(selected) {
    if (selected.items.length === 0)
        return '';
    const parts = ['\n[Project Memory]'];
    for (const item of selected.items) {
        const formatted = formatItem(item);
        parts.push(`  ${formatted}`);
    }
    return parts.join('\n') + '\n';
}
//# sourceMappingURL=context-selector.js.map