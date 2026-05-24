import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getBrainDir, readProjectMap, redact } from './store.js';
import { readExperienceGraph, searchGraph } from './graph-store.js';
const INTENT_PATTERNS = [
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
export function detectRecallIntent(message) {
    const trimmed = message.trim();
    // Check negative patterns first
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
                    entries.push(`${currentTitle}: ${currentBody.slice(0, 200)}`);
                }
                currentTitle = line.replace('## ', '').trim();
                currentBody = '';
            }
            else if (currentTitle) {
                currentBody += line + ' ';
            }
        }
        if (currentTitle) {
            entries.push(`${currentTitle}: ${currentBody.slice(0, 200)}`);
        }
        return entries.slice(-5);
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
                    entries.push(`${currentTitle}: ${currentBody.slice(0, 200)}`);
                }
                currentTitle = line.replace('## ', '').trim();
                currentBody = '';
            }
            else if (currentTitle) {
                currentBody += line + ' ';
            }
        }
        if (currentTitle) {
            entries.push(`${currentTitle}: ${currentBody.slice(0, 200)}`);
        }
        return entries.slice(-5);
    }
    catch {
        return [];
    }
}
export async function buildRecallContext(message, options) {
    const intent = detectRecallIntent(message);
    if (intent === 'none')
        return null;
    const maxTokens = options?.maxTokens ?? 800;
    const includeProjectMap = options?.includeProjectMap ?? true;
    const includeGraph = options?.includeGraph ?? true;
    const includeLessons = options?.includeLessons ?? true;
    const includeDecisions = options?.includeDecisions ?? true;
    let summary = '';
    const recentLessons = [];
    const recentDecisions = [];
    const relevantGraphNodes = [];
    const relevantGraphEdges = [];
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
    // Lessons
    if (includeLessons) {
        const lessons = await readLessons();
        recentLessons.push(...lessons);
    }
    // Decisions
    if (includeDecisions) {
        const decisions = await readDecisions();
        recentDecisions.push(...decisions);
    }
    // Graph search
    if (includeGraph) {
        try {
            const graph = await readExperienceGraph();
            if (graph.nodes.length > 0) {
                const query = message.toLowerCase();
                const searchTerms = query.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
                if (searchTerms.length > 0) {
                    for (const term of searchTerms) {
                        const result = await searchGraph(term);
                        for (const n of result.nodes) {
                            const label = `${n.kind}:${n.label}`;
                            if (!relevantGraphNodes.includes(label)) {
                                relevantGraphNodes.push(label);
                            }
                        }
                        for (const e of result.edges) {
                            const edgeStr = `${e.kind}:${e.from.slice(0, 6)}→${e.to.slice(0, 6)}`;
                            if (!relevantGraphEdges.includes(edgeStr)) {
                                relevantGraphEdges.push(edgeStr);
                            }
                        }
                    }
                }
            }
        }
        catch { /* skip */ }
    }
    // Build summary based on intent
    const summaries = [];
    if (intent === 'project_context' && projectMapSummary) {
        summaries.push(`Project: ${projectMapSummary}`);
    }
    if (intent === 'lesson_history' && recentLessons.length > 0) {
        summaries.push(`Lessons: ${recentLessons.join('; ')}`);
    }
    if (intent === 'decision_history' && recentDecisions.length > 0) {
        summaries.push(`Decisions: ${recentDecisions.join('; ')}`);
    }
    if ((intent === 'bug_history' || intent === 'browser_history' || intent === 'provider_history') && relevantGraphNodes.length > 0) {
        const maxNodes = Math.min(relevantGraphNodes.length, 10);
        summaries.push(`Related: ${relevantGraphNodes.slice(0, maxNodes).join(', ')}`);
    }
    if (intent === 'project_context' && relevantGraphNodes.length > 0) {
        const maxNodes = Math.min(relevantGraphNodes.length, 5);
        summaries.push(`Graph: ${relevantGraphNodes.slice(0, maxNodes).join(', ')}`);
    }
    // If we're looking at recent changes/project context, include project map
    if (intent === 'project_context' && projectMapSummary) {
        summary = `[Project Context]\n${projectMapSummary}`;
        if (recentLessons.length > 0) {
            summary += `\nLessons: ${recentLessons.slice(0, 3).join('; ')}`;
        }
        if (recentDecisions.length > 0) {
            summary += `\nDecisions: ${recentDecisions.slice(0, 3).join('; ')}`;
        }
    }
    else if (intent === 'provider_history') {
        const providerNodes = relevantGraphNodes.filter(n => n.startsWith('provider:') || n.startsWith('model:') || n.startsWith('event:provider'));
        const snippet = providerNodes.slice(0, 8).join(', ');
        summary = `[Provider History]\n${snippet || 'No provider events recorded.'}`;
    }
    else if (intent === 'bug_history' || intent === 'browser_history') {
        const bugNodes = relevantGraphNodes.filter(n => n.startsWith('bug:') || n.startsWith('fix:') || n.startsWith('event:'));
        const snippet = bugNodes.slice(0, 8).join(', ');
        summary = `[Bug/Fix History]\n${snippet || 'No bug/fix records found.'}`;
    }
    else if (intent === 'lesson_history') {
        if (recentLessons.length > 0) {
            summary = `[Lessons]\n${recentLessons.join('\n')}`;
        }
        else {
            return null;
        }
    }
    else if (intent === 'decision_history') {
        if (recentDecisions.length > 0) {
            summary = `[Decisions]\n${recentDecisions.join('\n')}`;
        }
        else {
            return null;
        }
    }
    else if (intent === 'skill_history') {
        const skillNodes = relevantGraphNodes.filter(n => n.startsWith('skill:'));
        summary = `[Skills]\n${skillNodes.slice(0, 5).join(', ') || 'No skill records found.'}`;
    }
    else {
        // Fallback for project_context + misc
        if (summaries.length === 0)
            return null;
        summary = `[Project Memory]\n${summaries.join('\n')}`;
    }
    // Truncate by tokens (rough estimate: 4 chars per token)
    const maxChars = maxTokens * 4;
    if (summary.length > maxChars) {
        summary = summary.slice(0, maxChars - 50) + '\n...(truncated)';
    }
    if (!summary)
        return null;
    // Track which sources were used
    const sources = [];
    if (projectMapSummary)
        sources.push('project-map');
    if (recentLessons.length > 0)
        sources.push('lessons');
    if (recentDecisions.length > 0)
        sources.push('decisions');
    if (relevantGraphNodes.length > 0 || relevantGraphEdges.length > 0)
        sources.push('graph');
    return {
        intent,
        summary,
        projectMapSummary,
        recentLessons: recentLessons.length > 0 ? recentLessons : undefined,
        recentDecisions: recentDecisions.length > 0 ? recentDecisions : undefined,
        relevantGraphNodes: relevantGraphNodes.length > 0 ? relevantGraphNodes : undefined,
        relevantGraphEdges: relevantGraphEdges.length > 0 ? relevantGraphEdges : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
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