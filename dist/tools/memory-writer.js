import { appendBrainEvent, appendLesson, appendDecision, containsSecret } from '../brain/store.js';
import { upsertNode, logProviderSuccess, logProviderFailure, searchGraph, readExperienceGraph, linkEventToFiles } from '../brain/graph-store.js';
import { invalidateRecallCache } from '../brain/recall-cache.js';
const MAX_SUMMARY_LENGTH = 2000;
const MAX_TITLE_LENGTH = 120;
// ── Size / safety helpers ──
function sanitize(text, maxLen = MAX_SUMMARY_LENGTH) {
    let cleaned = text.trim();
    if (containsSecret(cleaned))
        return '[REDACTED]';
    if (cleaned.length > maxLen)
        cleaned = cleaned.slice(0, maxLen) + '...';
    return cleaned;
}
function makeTitle(kind, ...parts) {
    const label = `${kind}: ${parts.filter(Boolean).join(' — ')}`;
    return label.slice(0, MAX_TITLE_LENGTH);
}
function makeTags(...extra) {
    return ['persistent-memory', ...extra.filter(Boolean)];
}
// ── Importance scoring helpers ──
function scoreImportance(kind, source, text) {
    let base = kind === 'decision' ? 70 : 60;
    // Boost for manual entries
    if (source === 'manual')
        base += 10;
    if (source === 'user')
        base += 5;
    // Longer, more detailed descriptions are more important
    if (text.length > 100)
        base += 5;
    if (text.length > 300)
        base += 5;
    return Math.min(base, 100);
}
function scoreConfidence(kind, source) {
    switch (source) {
        case 'user': return 85;
        case 'manual': return 80;
        case 'auto-fix': return 60;
        case 'command': return 70;
        default: return 50;
    }
}
// ── Core write function ──
export async function writeMemory(kind, title, summary, tags = [], files, source = 'manual') {
    const safeSummary = sanitize(summary);
    const safeTitle = title.slice(0, MAX_TITLE_LENGTH);
    const allTags = makeTags(...tags);
    const importance = scoreImportance(kind, source, safeSummary);
    const confidence = scoreConfidence(kind, source);
    // 1. Check for existing similar memory using fuzzy matching
    const similar = await searchGraph(safeTitle);
    const existing = similar.nodes.find(n => n.kind === kind && (n.label === safeTitle || n.summary === safeSummary));
    if (existing) {
        // Update existing — keep higher confidence summary
        const keepConfidence = Math.max(existing.confidence || 50, confidence);
        await upsertNode({
            id: existing.id,
            kind,
            label: existing.label,
            summary: existing.summary?.length && existing.summary.length >= safeSummary.length ? existing.summary : safeSummary,
            tags: [...new Set([...(existing.tags || []), ...allTags])],
            importance: Math.max(existing.importance || 50, importance),
            confidence: keepConfidence,
            source,
            updatedAt: new Date().toISOString(),
        });
        return;
    }
    // 2. Write to graph with scoring
    await upsertNode({
        kind,
        label: safeTitle,
        summary: safeSummary,
        tags: allTags,
        importance,
        confidence,
        source,
    });
    // 3. Write to event log + markdown files
    await appendBrainEvent({ kind, title: safeTitle, summary: safeSummary, tags: allTags });
    if (kind === 'lesson') {
        await appendLesson(safeTitle, safeSummary, allTags);
    }
    else {
        await appendDecision(safeTitle, safeSummary, allTags);
    }
    // 4. Link to files if provided
    if (files && files.length > 0) {
        const graph = await readExperienceGraph();
        const node = graph.nodes.find(n => n.kind === kind && n.label === safeTitle);
        if (node) {
            await linkEventToFiles(node.id, files);
        }
    }
    // Invalidate recall cache so fresh data is picked up
    invalidateRecallCache();
}
// ── Auto-fix result writer ──
export async function writeAutoFixMemory(fixResult, userRequest) {
    const title = makeTitle('Auto-fix', fixResult.errorType, fixResult.filesTouched[0] || 'unknown');
    const summary = fixResult.fixed
        ? `Auto-fixed ${fixResult.errorType} in ${fixResult.filesTouched.join(', ')}. Context: ${sanitize(userRequest, 200)}`
        : `Failed to auto-fix ${fixResult.errorType} in ${fixResult.filesTouched.join(', ')}. Context: ${sanitize(userRequest, 200)}`;
    await writeMemory('lesson', title, summary, ['auto-fix', fixResult.errorType], fixResult.filesTouched, 'auto-fix');
}
// ── Decision from natural language ──
const DECISION_PREFIXES = /^(we decided|decision|we chose|we picked|we settled on|the plan is|we will use|we should use|let's use|we agreed)/i;
const LESSON_PREFIXES = /^(we learned|lesson|we found|we discovered|note to self|we realized|we noticed|we observed|we saw that)/i;
export function classifyMemoryText(text) {
    const cleaned = text.trim();
    let content = cleaned;
    if (DECISION_PREFIXES.test(cleaned)) {
        content = cleaned.replace(DECISION_PREFIXES, '').replace(/^[:;,\s]+/, '').trim();
        return { kind: 'decision', content };
    }
    if (LESSON_PREFIXES.test(cleaned)) {
        content = cleaned.replace(LESSON_PREFIXES, '').replace(/^[:;,\s]+/, '').trim();
        return { kind: 'lesson', content };
    }
    if (/remember|memorize|save this/i.test(cleaned)) {
        content = cleaned.replace(/remember|memorize|save this/i, '').replace(/^[:;,\s]+/, '').trim();
        return { kind: 'decision', content };
    }
    return { kind: null, content: cleaned };
}
export async function writeMemoryFromText(text) {
    const { kind, content } = classifyMemoryText(text);
    if (!kind || !content)
        return null;
    const title = content.length > 80 ? content.slice(0, 77) + '...' : content;
    const summary = content;
    await writeMemory(kind, title, summary, ['manual'], [], 'user');
    return { kind, title };
}
// ── Provider event writer ──
export async function writeProviderEvent(provider, model, status, reason) {
    if (status === 'success') {
        await logProviderSuccess(provider, model);
    }
    else {
        await logProviderFailure(provider, model, sanitize(reason || 'unknown error', 500));
    }
}
// ── Keyword detection ──
const MEMORY_TRIGGER_RE = /(remember|memorize|decision|we decided|we chose|lesson|we learned|note to self)/i;
export function containsMemoryTrigger(text) {
    return MEMORY_TRIGGER_RE.test(text);
}
//# sourceMappingURL=memory-writer.js.map