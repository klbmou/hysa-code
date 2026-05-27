import { resolve } from 'node:path';
import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, TIER_LABELS, LOCAL_FREE_PROVIDERS, getDefaultProviderFromEnv } from '../config/keys.js';
import { getProjectInfo } from '../context/builder.js';
import { readFile, shouldIgnore } from '../files/reader.js';
import { writeFileWithBackup, previewEdit } from '../files/writer.js';
import { getGitInfo } from '../utils/git.js';
import { createClient, createSingleClient, categorizeError } from '../ai/client.js';
import { buildSystemPrompt, resolvePromptMode } from '../prompts/system.js';
import { classifyTask } from '../ai/task-classifier.js';
import { shouldInjectProjectContext } from '../ai/provider-policy.js';
import { rankFiles } from '../context/ranker.js';
import { decideProjectMode } from '../context/project-router.js';
import { getYolo, setYolo } from '../utils/session.js';
import { toHealthSummary, getLastError, getLastFallbackUsed, getFallbackEvents, getLastSuccessfulProvider, getLastSuccessfulModel, getAllHealth } from '../ai/model-health.js';
import { detectSecrets } from '../utils/secrets.js';
import { translateCommand } from '../utils/shell.js';
import { searchWeb, formatSearchResults, getSearchDiagnostics, isCapabilityQuestion, getCapabilityResponse } from '../tools/web-search.js';
import { shouldSearchEntity } from '../tools/entity-detector.js';
import { estimateTokens } from '../context/tokens.js';
import { selectContext, formatSelectedContext } from '../brain/context-selector.js';
import { classifyCommand } from '../utils/commands.js';
const LOG = '[HYSA Chat]';
let apiRequestCounter = 0;
// ── Language detection ──────────────────────────────────
const ARABIC_PATTERN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
function isArabic(text) {
    if (!text)
        return false;
    let arabicCount = 0;
    for (const char of text) {
        if (ARABIC_PATTERN.test(char))
            arabicCount++;
    }
    return arabicCount > 0;
}
function getResponseLanguage(text) {
    return isArabic(text) ? 'arabic' : 'english';
}
function injectLanguageInstruction(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'user')
            continue;
        if (typeof msg.content === 'string') {
            const isAr = isArabic(msg.content);
            if (isAr) {
                msg.content += '\n\nRespond in Arabic. Use natural Arabic. Do not switch to English.';
            }
        }
        break;
    }
}
// ── Simple question detection ──────────────────────────
function isSimpleQuestion(text) {
    const trimmed = text.trim().toLowerCase();
    if (trimmed.length > 60)
        return false;
    const actionWords = /\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe|apply|remove|delete|rename|move|copy|refactor|explain|summarize|analyze|inspect|improve|implement|build|compile|deploy|test|investigate|review|audit)\b/i;
    if (actionWords.test(trimmed))
        return false;
    return true;
}
// ── Project intent detection ─────────────────────────────
const PROJECT_INTENT_PATTERNS = [
    /(?:explain|describe|summarize|show|tell)\s+(?:me\s+)?(?:about\s+)?(?:the\s+)?(?:project|codebase|repo|app|structure|architecture)/i,
    /(?:find|look\s+for|search\s+for|detect|identify|spot)\s+(?:a\s+)?(?:small\s+)?(?:bug|issue|problem|improvement|vulnerability|mistake)/i,
    /(?:improve|enhance|optimize|refactor|clean\s+up)\s+(?:this|the|my)\s+(?:code|project|app|repo|file|implementation)/i,
    /(?:inspect|analyze|audit|scan|review)\s+(?:the\s+)?(?:repo|project|codebase|files|code|app|source)/i,
    /(?:fix|correct|resolve|solve)\s+(?:this|the|my)\s+(?:code|bug|issue|problem|error|implementation)/i,
    /(?:what|how)\s+(?:changed|is\s+the\s+structure|does\s+this\s+project|are\s+the\s+files|is\s+in\s+the)\s+(?:in|of|the)/i,
    /(?:generate|create|write|add)\s+(?:tests?|unit\s+tests?|test\s+cases?|specs?)/i,
    /(?:do\s+not|don'?t)\s+(?:edit|change|modify|alter)\s+(?:files|anything)/i,
    /what\s+(?:does|is)\s+(?:this|the)\s+(?:project|code|repo|app)\s+(?:do|about)/i,
    /(?:analyze|check|look\s+at)\s+(?:my|the|this)\s+(?:code|project|repo)/i,
    /tell\s+me\s+(?:about|what)\s+(?:this\s+)?(?:project|codebase|repo)\s+(?:does|is|contains)/i,
];
const PROJECT_SKIP_PATTERNS = [
    /^(?:hi|hello|hey|yo|sup|salam|مرحبا|اهلا|شكرا|thanks?)\b/i,
    /^(?:who|what|where|when|why|how)\s+(?:is|are|was|were|created|invented|discovered)\s+/i,
    /^(?:tell\s+me\s+about|who\s+is|what\s+is)\s+(?!the\s+project|this\s+project|the\s+code|the\s+repo)/i,
    /^(?:history\s+of|meaning\s+of|definition\s+of)/i,
    /^(?:من\s+هو|ما\s+هي|ما\s+هو|اين|متى|كيف|لماذا)\s/i,
];
function detectProjectIntent(message) {
    const trimmed = message.trim();
    if (!trimmed)
        return false;
    const lower = trimmed.toLowerCase();
    if (PROJECT_SKIP_PATTERNS.some(p => p.test(trimmed)))
        return false;
    if (PROJECT_INTENT_PATTERNS.some(p => p.test(trimmed)))
        return true;
    return false;
}
class TimingTracker {
    spans = [];
    completed = [];
    start(name) {
        this.spans.push({ name, start: performance.now() });
    }
    stop(name) {
        const idx = this.spans.findIndex(s => s.name === name);
        if (idx !== -1) {
            const span = this.spans.splice(idx, 1)[0];
            this.completed.push({ name, ms: Math.round(performance.now() - span.start) });
        }
    }
    report() {
        const result = {};
        for (const c of this.completed) {
            result[c.name] = c.ms;
        }
        return result;
    }
}
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)),
    ]);
}
const workingDir = resolve('.');
// Known vision-capable models per provider (for supportsVision check)
const VISION_CAPABLE_MODELS = {
    gemini: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'],
    openrouter: ['google/gemini-2.5-flash', 'qwen/qwen2.5-vl-72b-instruct:free'],
};
function supportsVision(provider, model) {
    const models = VISION_CAPABLE_MODELS[provider];
    if (!models)
        return false;
    return models.some(m => model.includes(m.replace('google/', '').replace(':free', '')) || model === m);
}
// Preferred ordered list of vision fallback models (max 3 attempted)
const VISION_FALLBACK_ORDER = [
    { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
    { provider: 'openrouter', model: 'qwen/qwen2.5-vl-72b-instruct:free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
];
function hasImageAttachments(attachments) {
    if (!attachments || attachments.length === 0)
        return false;
    return attachments.some(a => a.kind === 'image' && a.dataUrl);
}
function getVisionFallbackCandidates(config) {
    const candidates = [];
    const currentProv = config.currentProvider;
    for (const fb of VISION_FALLBACK_ORDER) {
        if (fb.provider !== currentProv) {
            const key = config.apiKeys[fb.provider];
            if (!key)
                continue;
        }
        const label = `${PROVIDER_DEFAULTS[fb.provider]?.label || fb.provider} / ${fb.model}`;
        candidates.push({ provider: fb.provider, model: fb.model, label });
        if (candidates.length >= 3)
            break;
    }
    return candidates;
}
function getVisionFallbackErrorMessage(lang, failures, debug) {
    if (lang === 'arabic') {
        let msg = 'لم أستطع تحليل الصورة الآن لأن نماذج الرؤية المتاحة غير متوفرة أو وصلت للحد اليومي. جرّب لاحقًا أو غيّر المزود إلى Gemini/OpenRouter Vision.';
        if (debug && failures.length > 0) {
            msg += '\n\nجرّبت ' + failures.length + ' نماذج رؤية:\n' + failures.map(f => '• ' + f.label + ' — ' + f.reason).join('\n');
        }
        return msg;
    }
    let msg = 'I couldn\'t analyze the image right now because the available vision models are unavailable or quota-limited. Try again later or switch to Gemini/OpenRouter Vision.';
    if (debug && failures.length > 0) {
        msg += '\n\nTried ' + failures.length + ' vision models:\n' + failures.map(f => '• ' + f.label + ' — ' + f.reason).join('\n');
    }
    return msg;
}
// ── Friendly error messages (language-matched) ────────
const ERROR_MESSAGES = {
    rate_limit: {
        arabic: 'لم أستطع إكمال الطلب الآن لأن المزود الحالي وصل إلى حد الاستخدام أو غير متاح. جرّب بعد قليل أو غيّر المزود من الإعدادات.',
        english: 'I couldn\'t complete the request because the current provider is rate-limited or unavailable. Try again shortly or switch providers.',
    },
    invalid_key: {
        arabic: 'لم أستطع الاتصال بالمزود لأن مفتاح API غير صحيح. تحقق من المفتاح في الإعدادات أو جرّب مزود آخر.',
        english: 'I couldn\'t connect because the API key is invalid. Check your key in settings or try a different provider.',
    },
    timeout: {
        arabic: 'لم يحصل رد من المزود خلال الوقت المحدد. المزود قد يكون بطيئًا أو غير متاح. جرّب بعد قليل أو استخدم مزود آخر.',
        english: 'The provider did not respond in time. It may be slow or unavailable. Try again shortly or use a different provider.',
    },
    network: {
        arabic: 'تعذر الاتصال بالمزود بسبب مشكلة في الشبكة. تحقق من اتصال الإنترنت وجرّب مرة أخرى.',
        english: 'Could not reach the provider due to a network issue. Check your internet connection and try again.',
    },
    unavailable: {
        arabic: 'المزود الحالي غير متاح حاليًا. جرّب بعد قليل أو غيّر المزود من الإعدادات.',
        english: 'The current provider is not available right now. Try again shortly or switch providers.',
    },
    generic: {
        arabic: 'حدث خطأ غير متوقع. جرّب بعد قليل أو غيّر المزود.',
        english: 'An unexpected error occurred. Try again shortly or switch providers.',
    },
};
function categorizeErrorMessage(msg) {
    const lower = msg.toLowerCase();
    if (lower.includes('rate') || lower.includes('limit') || lower.includes('quota') || lower.includes('429') || lower.includes('overloaded'))
        return 'rate_limit';
    if (lower.includes('401') || lower.includes('403') || lower.includes('invalid') && lower.includes('key') || lower.includes('auth'))
        return 'invalid_key';
    if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('timedout'))
        return 'timeout';
    if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('fetch failed') || lower.includes('dns'))
        return 'network';
    if (lower.includes('unavailable') || lower.includes('not available') || lower.includes('503') || lower.includes('502') || lower.includes('offline') || lower.includes('fallback'))
        return 'unavailable';
    return 'generic';
}
function getFriendlyErrorMessage(langs, errorMsg, debug, provider) {
    const cat = categorizeErrorMessage(errorMsg);
    const messages = ERROR_MESSAGES[cat] || ERROR_MESSAGES.generic;
    let msg = langs === 'arabic' ? messages.arabic : messages.english;
    if (debug) {
        const lines = [msg];
        if (provider)
            lines.push(`Provider: ${provider}`);
        lines.push(`Reason: ${cat}`);
        const snippet = errorMsg.slice(0, 120);
        if (snippet)
            lines.push(`Detail: ${snippet}`);
        msg = lines.join('\n');
    }
    return msg;
}
function buildVisionMessages(messages, attachments) {
    const result = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === 'user' && i === messages.length - 1) {
            const parts = [];
            if (msg.content) {
                parts.push({ type: 'text', text: msg.content });
            }
            for (const att of attachments) {
                if (att.kind === 'image' && att.dataUrl) {
                    parts.push({ type: 'image_url', image_url: { url: att.dataUrl } });
                }
            }
            if (parts.length > 0) {
                result.push({ role: 'user', content: parts });
            }
            else {
                result.push(msg);
            }
        }
        else {
            result.push(msg);
        }
    }
    return result;
}
export function getStatus() {
    const config = loadConfig();
    if (!config) {
        return { provider: 'not configured', model: '', tier: '', visionCapable: false, git: null };
    }
    const prov = (getDefaultProviderFromEnv() || config.currentProvider);
    const label = PROVIDER_DEFAULTS[prov]?.label || prov;
    const tier = PROVIDER_TIERS[prov];
    const tierLabel = tier ? TIER_LABELS[tier]?.label || '' : '';
    const gitInfo = getGitInfo(workingDir);
    return {
        provider: label,
        model: config.currentModel,
        tier: tierLabel,
        visionCapable: supportsVision(prov, config.currentModel),
        git: gitInfo.isRepo ? { branch: gitInfo.branch, hasChanges: gitInfo.hasChanges } : null,
    };
}
export function getConfig() {
    return loadConfig();
}
export function updateConfig(partial) {
    const current = loadConfig() || {
        currentProvider: 'openrouter',
        currentModel: PROVIDER_DEFAULTS.openrouter.model,
        apiKeys: {},
        ollamaBaseUrl: 'http://localhost:11434',
    };
    const merged = { ...current, ...partial };
    saveConfig(merged);
    return merged;
}
export function getProjectTree() {
    const info = getProjectInfo(workingDir);
    return {
        tree: info.tree,
        files: info.importantFiles,
        fileCount: info.fileCount,
    };
}
export function getFileContent(filePath) {
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
export function saveFile(path, content) {
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
const LOCAL_HINTS = {
    ollama: { name: 'Ollama', command: 'ollama serve' },
    local_openai: { name: 'LM Studio', command: 'Start LM Studio and enable the local server (http://localhost:1234/v1)' },
    hysa_ai: { name: 'HYSA AI', command: 'hysa-ai serve' },
};
function getLocalProviderHint(msg, provider) {
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
export async function handleChatStream(req, writeEvent) {
    const config = loadConfig();
    if (!config) {
        writeEvent(`data: ${JSON.stringify({ type: 'token', text: 'No configuration found. Run: hysa chat' })}\n\n`);
        writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: 'No configuration found. Run: hysa chat', toolCalls: [] })}\n\n`);
        return;
    }
    const prov = config.currentProvider;
    if (!req.messages || !Array.isArray(req.messages) || req.messages.length === 0) {
        writeEvent(`data: ${JSON.stringify({ type: 'token', text: 'No messages provided.' })}\n\n`);
        writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: 'No messages provided.', toolCalls: [] })}\n\n`);
        return;
    }
    const reqId = ++apiRequestCounter;
    console.log(LOG, `[req:${reqId}] handleChatStream called, messages=${req.messages.length}, attachments=${req.attachments?.length || 0}`);
    if (config.debug) {
        console.log(LOG, `[req:${reqId}] Provider: ${PROVIDER_DEFAULTS[prov]?.label || prov}, Model: ${config.currentModel}`);
        console.log(LOG, `[req:${reqId}] Tier: ${PROVIDER_TIERS[prov]}, Keys: openrouter=${!!config.apiKeys.openrouter}, gemini=${!!config.apiKeys.gemini}, deepseek=${!!config.apiKeys.deepseek}, opencode_zen=${!!config.apiKeys.opencode_zen}, groq=${!!config.apiKeys.groq}, anthropic_proxy=${!!config.apiKeys.anthropic_proxy}, openai_router=${!!config.apiKeys.openai_router}`);
    }
    try {
        const hasImages = hasImageAttachments(req.attachments);
        const visionAvailable = supportsVision(prov, config.currentModel);
        // ── Vision fallback: if images present but current provider not vision-capable ──
        if (hasImages && !visionAvailable) {
            if (req.attachments) {
                for (const att of req.attachments) {
                    if (att.kind === 'image') {
                        console.log(LOG, `image attachment: ${att.name}, ${att.size}B, hasDataUrl ${!!att.dataUrl}`);
                    }
                }
            }
            const visionCandidates = getVisionFallbackCandidates(config);
            const failures = [];
            if (visionCandidates.length > 0) {
                console.log(LOG, `Current provider ${prov} not vision-capable, trying ${visionCandidates.length} vision-capable fallback(s)...`);
                const visionMsgs = buildVisionMessages(req.messages, req.attachments);
                const fbProjectInfo = getProjectInfo(workingDir);
                const fbSysPrompt = buildSystemPrompt({
                    type: fbProjectInfo.type,
                    entryPoints: fbProjectInfo.entryPoints,
                    configFiles: fbProjectInfo.configFiles,
                    fileCount: fbProjectInfo.fileCount,
                    tree: fbProjectInfo.tree.length < 3000 ? fbProjectInfo.tree : fbProjectInfo.tree.slice(0, 3000) + '\n... (truncated)',
                }, config.agentMode || 'chat', false, prov, config.promptMode || 'auto');
                const fbMessages = visionMsgs.map(m => ({
                    role: m.role,
                    content: m.content,
                }));
                injectLanguageInstruction(fbMessages);
                for (const c of visionCandidates) {
                    const timeoutMs = 10000;
                    try {
                        console.log(LOG, `Trying vision provider: ${c.label}`);
                        const client = createSingleClient(c.provider, c.model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel, config);
                        if (client.sendMessageStream) {
                            const response = await withTimeout(client.sendMessageStream(fbMessages, fbSysPrompt, (event) => {
                                if (event.type === 'token') {
                                    writeEvent(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
                                }
                            }), timeoutMs);
                            console.log(LOG, `Vision fallback succeeded with ${c.label}`);
                            writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response.message, toolCalls: response.toolCalls })}\n\n`);
                            return;
                        }
                        else {
                            const result = await withTimeout(client.sendMessage(fbMessages, fbSysPrompt), timeoutMs);
                            if (result.message) {
                                console.log(LOG, `Vision fallback succeeded with ${c.label}`);
                                writeEvent(`data: ${JSON.stringify({ type: 'token', text: result.message })}\n\n`);
                                writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: result.message, toolCalls: result.toolCalls })}\n\n`);
                                return;
                            }
                        }
                    }
                    catch (err) {
                        const e = err;
                        const cat = categorizeError(e.message || '');
                        let reasonStr;
                        if (cat === 'rate_limit')
                            reasonStr = 'rate-limited';
                        else if (cat === 'quota')
                            reasonStr = 'quota exceeded';
                        else if (cat === 'timeout')
                            reasonStr = 'timed out';
                        else if (cat === 'invalid_key')
                            reasonStr = 'invalid key';
                        else if (cat === 'model_unavailable')
                            reasonStr = 'unavailable';
                        else if (cat === 'network')
                            reasonStr = 'network error';
                        else
                            reasonStr = 'failed';
                        failures.push({ label: c.label, reason: reasonStr });
                        console.log(LOG, `Vision fallback failed with ${c.label}: ${e.message?.slice(0, 100)}`);
                    }
                }
            }
            // All vision fallbacks failed — friendly message in user's language
            const userLastMsg = req.messages.filter(m => m.role === 'user').pop()?.content || '';
            const lang = getResponseLanguage(userLastMsg);
            const errorText = getVisionFallbackErrorMessage(lang, failures, !!config.debug);
            writeEvent(`data: ${JSON.stringify({ type: 'token', text: errorText })}\n\n`);
            writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: errorText, toolCalls: [] })}\n\n`);
            return;
        }
        // Inject attachment text content as context before the user's question
        if (req.attachments && req.attachments.length > 0) {
            console.log(LOG, `Attachments: ${req.attachments.length} file(s)`);
            for (const att of req.attachments) {
                const hasText = !!att.textContent && att.textContent.length > 0;
                const hasDataUrl = !!att.dataUrl;
                console.log(LOG, `  ${att.name} (${att.kind}, ${att.size}B, hasText: ${hasText}${att.kind === 'image' ? `, hasDataUrl: ${hasDataUrl}` : ''})`);
                if (hasText && att.kind !== 'image') {
                    const contextMsg = {
                        role: 'user',
                        content: `Attached document content:\nFilename: ${att.name}\nType: ${att.kind.toUpperCase()}\nExtracted text:\n\`\`\`\n${att.textContent}\n\`\`\`\nUse this extracted text to answer the user's question. Do not say you cannot read the ${att.kind.toUpperCase()}.`,
                    };
                    const insertAt = Math.max(0, req.messages.length - 1);
                    req.messages.splice(insertAt, 0, contextMsg);
                    console.log(LOG, `  Injected context before user's message`);
                }
            }
        }
        const lastMessage = req.messages[req.messages.length - 1];
        // Format messages for vision if image attachments exist
        let visionMessages = req.messages;
        if (hasImages && visionAvailable) {
            visionMessages = buildVisionMessages(req.messages, req.attachments);
        }
        const client = createClient(config);
        if (!client.sendMessageStream) {
            // Fall back to non-streaming
            const result = await handleChat(req);
            const msg = result.error || result.message || '';
            if (result.error) {
                writeEvent(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
            }
            else {
                writeEvent(`data: ${JSON.stringify({ type: 'token', text: msg })}\n\n`);
                writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: msg, toolCalls: result.toolCalls || [] })}\n\n`);
            }
            return;
        }
        const projectInfo = getProjectInfo(workingDir);
        const isLocal = LOCAL_FREE_PROVIDERS.includes(config.currentProvider);
        const lightActive = config.lightMode !== false && isLocal;
        const messages = visionMessages.map(m => ({
            role: m.role,
            content: m.content,
        }));
        injectLanguageInstruction(messages);
        const streamLastUserRaw = req.messages.filter(m => m.role === 'user').pop()?.content || '';
        const streamLastContent = typeof streamLastUserRaw === 'string' ? streamLastUserRaw : '';
        // ── Timing / task classification ─────────────────
        const timer = new TimingTracker();
        timer.start('total');
        timer.start('classification');
        const taskKind = classifyTask(visionMessages, req.attachments);
        const projectDecision = decideProjectMode(streamLastContent, true, taskKind);
        const isProjectQuery = detectProjectIntent(streamLastContent);
        const useProjectCtx = projectDecision.projectMode || shouldInjectProjectContext(streamLastContent, taskKind) || isProjectQuery;
        const simpleMode = !projectDecision.projectMode && (isSimpleQuestion(streamLastContent) || taskKind === 'simple_chat');
        timer.stop('classification');
        console.log(LOG, `[req:${reqId}] task=${taskKind} projectMode=${projectDecision.projectMode} reason=${projectDecision.reason} simple=${simpleMode}`);
        // ── Capability question detection ────────────────
        const capLastMsg = messages[messages.length - 1];
        const capContent = typeof capLastMsg?.content === 'string' ? capLastMsg.content : '';
        if (capContent && isCapabilityQuestion(capContent)) {
            const wsDiag = getSearchDiagnostics();
            const response = getCapabilityResponse(capContent, wsDiag.isReliable);
            console.log(LOG, `[req:${reqId}] Capability question, returning direct response`);
            writeEvent(`data: ${JSON.stringify({ type: 'token', text: response })}\n\n`);
            writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response, toolCalls: [] })}\n\n`);
            return;
        }
        const resolvedMode = resolvePromptMode(config.promptMode || 'auto', config.currentProvider, simpleMode);
        let perQueryPrompt = buildSystemPrompt({
            type: projectInfo.type,
            entryPoints: useProjectCtx ? projectInfo.entryPoints : [],
            configFiles: useProjectCtx ? projectInfo.configFiles : [],
            fileCount: projectInfo.fileCount,
            tree: useProjectCtx && projectInfo.tree.length < 3000 ? projectInfo.tree : '',
        }, config.agentMode || 'chat', lightActive, config.currentProvider, resolvedMode);
        if (config.debug) {
            console.log(LOG, `[debug] Stream: task=${taskKind}, projectCtx=${useProjectCtx}, mode=${resolvedMode}`);
        }
        // ── Project file injection ──────────────────────
        timer.start('project_scan');
        const lastUserMsgRaw = visionMessages.filter(m => m.role === 'user').pop()?.content || '';
        const lastUserMsgStr = typeof lastUserMsgRaw === 'string' ? lastUserMsgRaw : '';
        let fileInjection = '';
        if (useProjectCtx && (isProjectQuery || taskKind === 'project_scan' || taskKind === 'code_review' || taskKind === 'debugging' || taskKind === 'code_edit' || taskKind === 'coding_qa')) {
            const allFiles = projectInfo.tree.split('\n').filter(f => !f.endsWith('/') && f.length > 0);
            const ranked = rankFiles(allFiles, lastUserMsgStr, 8);
            const topFiles = ranked.filter(r => r.score > 5).map(r => r.path).slice(0, 5);
            const fileParts = [];
            for (const file of topFiles) {
                const fullPath = resolve(workingDir, file);
                if (shouldIgnore(fullPath, workingDir))
                    continue;
                const content = readFile(fullPath);
                if (content) {
                    const lines = content.split('\n').length;
                    fileParts.push(`\n--- ${file} (${lines} lines) ---\n${content.slice(0, 3000)}\n`);
                }
            }
            if (fileParts.length > 0) {
                fileInjection = fileParts.join('');
                const est = estimateTokens(fileInjection);
                if (est < 2000) {
                    const fileMsg = { role: 'user', content: `Relevant project files:\n${fileInjection}\n\nUser request: ${lastUserMsgStr}` };
                    messages[messages.length - 1] = fileMsg;
                    console.log(LOG, `[req:${reqId}] Injected ${topFiles.length} relevant files (~${est} tokens)`);
                }
            }
        }
        timer.stop('project_scan');
        // ── Brain context injection (scored selection) ──
        timer.start('context_select');
        if (!simpleMode) {
            try {
                const selected = await selectContext({
                    message: lastUserMsgStr,
                    taskKind,
                    maxItems: 5,
                    debug: !!config.debug,
                });
                if (selected.items.length > 0) {
                    perQueryPrompt += formatSelectedContext(selected);
                }
            }
            catch { /* skip */ }
        }
        timer.stop('context_select');
        // ── Timing log ──
        timer.stop('total');
        const timingReport = timer.report();
        if (config.debug) {
            console.log(LOG, `[timing] classification=${timingReport.classification}ms, project_scan=${timingReport.project_scan}ms, context_select=${timingReport.context_select}ms, total=${timingReport.total}ms`);
        }
        let response = await client.sendMessageStream(messages, perQueryPrompt, (event) => {
            if (event.type === 'token') {
                writeEvent(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
            }
        });
        // ── YOLO tool continuation loop (streaming) ──
        let steps = 0;
        let streamMessages = [...messages];
        while (steps < MAX_TOOL_STEPS && response.toolCalls.length > 0) {
            const yoloMode = getYolo();
            if (!yoloMode)
                break;
            const autoTools = response.toolCalls.filter(tc => tc.type === 'read_file' ||
                (tc.type === 'execute_command' && classifyCommand(tc.params.command || '') === 'safe'));
            if (autoTools.length < response.toolCalls.length)
                break;
            steps++;
            if (config?.debug) {
                console.log(LOG, `[req:${reqId}] YOLO stream tool loop step ${steps}/${MAX_TOOL_STEPS}: ${autoTools.length} tools`);
            }
            writeEvent(`data: ${JSON.stringify({ type: 'tool_result', step: steps, total: autoTools.length, status: 'executing' })}\n\n`);
            const { results } = await executeToolCalls(autoTools, true);
            const feedText = response.message
                ? `${response.message}\n\nTool results:\n${formatToolResults(autoTools, results)}`
                : `Tool results:\n${formatToolResults(autoTools, results)}`;
            streamMessages.push({ role: 'assistant', content: feedText });
            writeEvent(`data: ${JSON.stringify({ type: 'tool_result', step: steps, total: autoTools.length, status: 'done', results: formatToolResults(autoTools, results) })}\n\n`);
            response = await client.sendMessageStream(streamMessages, perQueryPrompt, (event) => {
                if (event.type === 'token') {
                    writeEvent(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
                }
            });
        }
        writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response.message, toolCalls: response.toolCalls, timing: timingReport })}\n\n`);
    }
    catch (err) {
        const e = err;
        const rawMsg = e.message || 'Unknown stream error';
        console.log(LOG, `Stream failed: ${rawMsg}`);
        const userLastMsg = req.messages.filter(m => m.role === 'user').pop()?.content || '';
        const lang = getResponseLanguage(userLastMsg);
        const fbEvents = getFallbackEvents();
        let friendlyMsg;
        if (rawMsg.includes('All free providers')) {
            friendlyMsg = lang === 'arabic'
                ? 'جميع المزودات المجانية مشغولة أو وصلت للحد المسموح حاليًا. جرّب بعد قليل أو استخدم مزود مدفوع.'
                : 'All free providers are currently busy or rate-limited. Try again shortly or configure a paid/stable provider.';
        }
        else {
            friendlyMsg = getFriendlyErrorMessage(lang, rawMsg, !!config?.debug, config?.currentProvider ? PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider : undefined);
        }
        if (config?.debug && fbEvents.length > 0) {
            const triedLines = fbEvents.map(e => `  • ${e.reason}`).join('\n');
            friendlyMsg += `\n\nTried:\n${triedLines}`;
        }
        writeEvent(`data: ${JSON.stringify({ type: 'token', text: friendlyMsg })}\n\n`);
        writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: friendlyMsg, toolCalls: [] })}\n\n`);
    }
}
export const MAX_TOOL_STEPS = 5;
export function formatToolResults(toolCalls, results) {
    return toolCalls.map((tc, i) => {
        const label = tc.type === 'read_file' ? `Read ${tc.params.filePath}` :
            tc.type === 'execute_command' ? `Command: ${tc.params.command}` :
                `Tool: ${tc.type}`;
        return `${label}\n${results[i] || '(no output)'}`;
    }).join('\n\n');
}
export async function executeToolCalls(toolCalls, yolo) {
    const results = [];
    let dangerous = false;
    for (const tc of toolCalls) {
        if (tc.type === 'read_file') {
            const fullPath = resolve(workingDir, tc.params.filePath || '');
            const content = await import('../files/reader.js').then(m => m.readFile(fullPath));
            results.push(content ? content.slice(0, 5000) : 'File not found or empty');
            continue;
        }
        if (tc.type === 'execute_command') {
            const cmd = tc.params.command || '';
            if (!yolo) {
                const safety = classifyCommand(cmd);
                if (safety !== 'safe') {
                    dangerous = true;
                    results.push('Requires manual approval');
                    continue;
                }
            }
            try {
                const { execSync } = await import('node:child_process');
                const translated = translateCommand(cmd);
                const shell = process.platform === 'win32'
                    ? (translated !== cmd && (translated.includes('Get-') || translated.includes('Select-'))
                        ? 'powershell.exe -NoProfile -Command'
                        : process.env.ComSpec || 'cmd.exe')
                    : undefined;
                const stdout = execSync(translated, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, cwd: workingDir, shell });
                results.push(stdout.trim().slice(0, 5000) || '(empty output)');
            }
            catch (err) {
                const e = err;
                results.push(`Error: ${e.stderr || e.message || 'Command failed'}`);
            }
            continue;
        }
        // Non-auto tools (edit_file, etc.) — skip for YOLO loop, let client handle
        dangerous = true;
        results.push('Requires manual review');
    }
    return { results, dangerous };
}
export async function continueChat(messages, toolCalls, toolResults) {
    const config = loadConfig();
    if (!config)
        return { message: '', toolCalls: [], error: 'No configuration' };
    const prov = config.currentProvider;
    const client = createClient(config);
    const systemPrompt = buildSystemPrompt(undefined, 'chat', false, config.currentProvider);
    const resultText = '\n\nTool results:\n' + formatToolResults(toolCalls, toolResults);
    messages.push({ role: 'assistant', content: resultText });
    try {
        const response = await client.sendMessage(messages, systemPrompt);
        return {
            message: response.message,
            toolCalls: response.toolCalls.map(tc => ({ type: tc.type, params: tc.params })),
        };
    }
    catch (err) {
        const e = err;
        return { message: `Tool continuation failed: ${e.message}`, toolCalls: [] };
    }
}
export async function handleChat(req) {
    const config = loadConfig();
    if (!config) {
        console.log(LOG, 'No config found');
        return { message: '', toolCalls: [], error: 'No configuration found. Run: hysa chat' };
    }
    // Apply env-based default provider resolution (same as CLI)
    const envProvider = getDefaultProviderFromEnv();
    if (envProvider) {
        config.currentProvider = envProvider;
    }
    const prov = config.currentProvider;
    if (!req.messages || !Array.isArray(req.messages) || req.messages.length === 0) {
        console.log(LOG, 'Missing or empty messages array in request body');
        return { message: '', toolCalls: [], error: 'Missing or empty messages array in request body' };
    }
    const reqId = ++apiRequestCounter;
    console.log(LOG, `[req:${reqId}] handleChat called, messages=${req.messages.length}, attachments=${req.attachments?.length || 0}`);
    if (config.debug) {
        console.log(LOG, `[req:${reqId}] Provider: ${PROVIDER_DEFAULTS[prov]?.label || prov}, Model: ${config.currentModel}`);
        console.log(LOG, `[req:${reqId}] Tier: ${PROVIDER_TIERS[prov]}, Keys: openrouter=${!!config.apiKeys.openrouter}, gemini=${!!config.apiKeys.gemini}, deepseek=${!!config.apiKeys.deepseek}, opencode_zen=${!!config.apiKeys.opencode_zen}, groq=${!!config.apiKeys.groq}, anthropic_proxy=${!!config.apiKeys.anthropic_proxy}, openai_router=${!!config.apiKeys.openai_router}`);
    }
    try {
        const hasImages = hasImageAttachments(req.attachments);
        const visionAvailable = supportsVision(prov, config.currentModel);
        // ── Vision fallback: if images present but current provider not vision-capable ──
        if (hasImages && !visionAvailable) {
            if (req.attachments) {
                for (const att of req.attachments) {
                    if (att.kind === 'image') {
                        console.log(LOG, `image attachment: ${att.name}, ${att.size}B, hasDataUrl ${!!att.dataUrl}`);
                    }
                }
            }
            const visionCandidates = getVisionFallbackCandidates(config);
            const failures = [];
            if (visionCandidates.length > 0) {
                console.log(LOG, `Current provider ${prov} not vision-capable, trying ${visionCandidates.length} vision-capable fallback(s)...`);
                const visionMsgs = buildVisionMessages(req.messages, req.attachments);
                const fbProjectInfo = getProjectInfo(workingDir);
                const fbSysPrompt = buildSystemPrompt({
                    type: fbProjectInfo.type,
                    entryPoints: fbProjectInfo.entryPoints,
                    configFiles: fbProjectInfo.configFiles,
                    fileCount: fbProjectInfo.fileCount,
                    tree: fbProjectInfo.tree.length < 3000 ? fbProjectInfo.tree : fbProjectInfo.tree.slice(0, 3000) + '\n... (truncated)',
                }, config.agentMode || 'chat', false, prov, config.promptMode || 'auto');
                const fbMessages = visionMsgs.map(m => ({
                    role: m.role,
                    content: m.content,
                }));
                injectLanguageInstruction(fbMessages);
                for (const c of visionCandidates) {
                    const timeoutMs = 10000;
                    try {
                        console.log(LOG, `Trying vision provider: ${c.label}`);
                        const client = createSingleClient(c.provider, c.model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel, config);
                        const result = await withTimeout(client.sendMessage(fbMessages, fbSysPrompt), timeoutMs);
                        if (result.message) {
                            console.log(LOG, `Vision fallback succeeded with ${c.label}`);
                            return {
                                message: result.message,
                                toolCalls: result.toolCalls,
                                provider: PROVIDER_DEFAULTS[c.provider]?.label || c.provider,
                                model: c.model,
                            };
                        }
                    }
                    catch (err) {
                        const e = err;
                        const cat = categorizeError(e.message || '');
                        let reasonStr;
                        if (cat === 'rate_limit')
                            reasonStr = 'rate-limited';
                        else if (cat === 'quota')
                            reasonStr = 'quota exceeded';
                        else if (cat === 'timeout')
                            reasonStr = 'timed out';
                        else if (cat === 'invalid_key')
                            reasonStr = 'invalid key';
                        else if (cat === 'model_unavailable')
                            reasonStr = 'unavailable';
                        else if (cat === 'network')
                            reasonStr = 'network error';
                        else
                            reasonStr = 'failed';
                        failures.push({ label: c.label, reason: reasonStr });
                        console.log(LOG, `Vision fallback failed with ${c.label}: ${e.message?.slice(0, 100)}`);
                    }
                }
            }
            // All vision providers failed — friendly message in user's language
            const userLastMsg = req.messages.filter(m => m.role === 'user').pop()?.content || '';
            const lang = getResponseLanguage(userLastMsg);
            const msg = getVisionFallbackErrorMessage(lang, failures, !!config.debug);
            return { message: msg, toolCalls: [] };
        }
        // Inject attachment text content as context before the user's question
        if (req.attachments && req.attachments.length > 0) {
            console.log(LOG, `Attachments: ${req.attachments.length} file(s)`);
            for (const att of req.attachments) {
                const hasText = !!att.textContent && att.textContent.length > 0;
                const hasDataUrl = !!att.dataUrl;
                console.log(LOG, `  ${att.name} (${att.kind}, ${att.size}B, hasText: ${hasText}${att.kind === 'image' ? `, hasDataUrl: ${hasDataUrl}` : ''})`);
                if (hasText && att.kind !== 'image') {
                    const contextMsg = {
                        role: 'user',
                        content: `Attached document content:\nFilename: ${att.name}\nType: ${att.kind.toUpperCase()}\nExtracted text:\n\`\`\`\n${att.textContent}\n\`\`\`\nUse this extracted text to answer the user's question. Do not say you cannot read the ${att.kind.toUpperCase()}.`,
                    };
                    const insertAt = Math.max(0, req.messages.length - 1);
                    req.messages.splice(insertAt, 0, contextMsg);
                    console.log(LOG, `  Injected context before user's message`);
                }
            }
        }
        // Format messages for vision if image attachments exist
        let visionMessages = req.messages;
        if (hasImages && visionAvailable) {
            visionMessages = buildVisionMessages(req.messages, req.attachments);
        }
        const lastMessage = visionMessages[visionMessages.length - 1];
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
        const messages = visionMessages.map(m => ({
            role: m.role,
            content: m.content,
        }));
        injectLanguageInstruction(messages);
        // ── Timing / task classification ─────────────────
        const timer = new TimingTracker();
        timer.start('total');
        timer.start('classification');
        const lastContent = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
        const taskKind = classifyTask(visionMessages, req.attachments);
        const projectDecision = decideProjectMode(lastContent, true, taskKind);
        const isProjectQuery = detectProjectIntent(lastContent);
        const useProjectCtx = projectDecision.projectMode || shouldInjectProjectContext(lastContent, taskKind) || isProjectQuery;
        const isSimpleQ = !projectDecision.projectMode && (isSimpleQuestion(lastContent) || taskKind === 'simple_chat');
        timer.stop('classification');
        console.log(LOG, `[req:${reqId}] task=${taskKind} projectMode=${projectDecision.projectMode} reason=${projectDecision.reason} simple=${isSimpleQ} projectQuery=${isProjectQuery}`);
        // ── Capability question detection ────────────────
        const capLastMsg = messages[messages.length - 1];
        const capContent = typeof capLastMsg?.content === 'string' ? capLastMsg.content : '';
        if (capContent && isCapabilityQuestion(capContent)) {
            const wsDiag = getSearchDiagnostics();
            const response = getCapabilityResponse(capContent, wsDiag.isReliable);
            console.log(LOG, `[req:${reqId}] Capability question, returning direct response`);
            return { message: response, toolCalls: [] };
        }
        // ── Per-query prompt mode resolution ────────────────
        const lastUserMsgRaw = visionMessages.filter(m => m.role === 'user').pop()?.content || '';
        const lastUserMsg = typeof lastUserMsgRaw === 'string' ? lastUserMsgRaw : '';
        const simpleMode = isSimpleQ;
        const resolvedMode = resolvePromptMode(config.promptMode || 'auto', config.currentProvider, simpleMode);
        let perQueryPrompt = buildSystemPrompt({
            type: projectInfo.type,
            entryPoints: useProjectCtx ? projectInfo.entryPoints : [],
            configFiles: useProjectCtx ? projectInfo.configFiles : [],
            fileCount: projectInfo.fileCount,
            tree: useProjectCtx && projectInfo.tree.length < 3000 ? projectInfo.tree : '',
        }, config.agentMode || 'chat', lightActive, config.currentProvider, resolvedMode);
        if (config.debug) {
            const systemTokens = estimateTokens(perQueryPrompt);
            let historyTokens = 0;
            for (const m of messages) {
                if (typeof m.content === 'string') {
                    historyTokens += estimateTokens(m.content);
                }
                else {
                    historyTokens += 100;
                }
            }
            const totalTokens = systemTokens + historyTokens;
            console.log(LOG, `[debug] Task: ${taskKind}, projectCtx=${useProjectCtx}, mode: ${resolvedMode}`);
            console.log(LOG, `[debug] System prompt: ~${systemTokens} tokens`);
            console.log(LOG, `[debug] History/messages: ~${historyTokens} tokens`);
            console.log(LOG, `[debug] Total estimated: ~${totalTokens} tokens`);
        }
        // ── Web search detection ────────────────────────
        const searchLastMsg = messages[messages.length - 1];
        const searchLastContent = typeof searchLastMsg?.content === 'string' ? searchLastMsg.content : '';
        const isExplicitSearchCmd = /^hysa\s+(?:search|websearch)\s+/i.test(searchLastContent);
        const searchPatterns = [
            /^hysa\s+(?:search|websearch)\s+"(.+?)"$/i,
            /^hysa\s+(?:search|websearch)\s+'(.+?)'$/i,
            /^hysa\s+(?:search|websearch)\s+(.+)$/i,
            /^(?:search|look\s*up|google|bing|search\s*the\s*web)\s+(?:for\s+)?(.+)/i,
            /^(?:what\s+is\s+the\s+(?:current|latest|recent)\s+)/i,
            /^(?:latest\s+(?:news|updates?|info)\s+(?:about|on)\s+)/i,
            /^(?:where\s+can\s+(?:I|we)\s+(?:watch|find|get)\s+)/i,
            /^(?:ابحث\s+في\s+(?:الانترنت|الإنترنت|النت)\s+(?:عن\s+)?)(.+)/i,
            /^(?:ابحث\s+(?:لي\s+)?عن\s+)(.+)/i,
            /^(?:اعطني|أعطني)\s+(?:مصادر|معلومة)\s+(?:عن|حول)\s+(.+)/i,
            /^(?:مصادر)\s+(?:عن|حول)\s+(.+)/i,
            /^(?:آخر\s+أخبار\s+)(.+)/i,
            /^(?:هل\s+هذا\s+صحيح\s+(?:الآن|حاليا|حالياً)?)/i,
            /^(?:ما\s+هو\s+(?:آخر|أحدث)\s+)/i,
            /^(?:من\s+أين\s+أتيت\s+)/i,
            /^(?:هل\s+هذه\s+المعلومة\s+محدثة)/i,
            /^(?:هل\s+عندك\s+معلومات\s+(?:عن|حول)\s+)(.+)/i,
            /^(?:دور\s+(?:لي\s+)?(?:على\s+)?)(.+)/i,
        ];
        let searchQuery = null;
        for (const p of searchPatterns) {
            const m = searchLastContent.match(p);
            if (m) {
                searchQuery = m[1]?.trim() || searchLastContent;
                break;
            }
        }
        if (searchQuery) {
            const wsDiag = getSearchDiagnostics();
            if (!wsDiag.isReliable) {
                const hasArabic = /[\u0600-\u06FF]/.test(searchLastContent);
                const configMsg = hasArabic
                    ? 'البحث في الإنترنت غير مضبوط بشكل موثوق. فعّل TAVILY_API_KEY أو SERPER_API_KEY أو BRAVE_SEARCH_API_KEY.'
                    : 'Web search is not reliably configured. To enable web search, set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.';
                console.log(LOG, `[req:${reqId}] Web search skipped (provider: ${wsDiag.provider}, no reliable API keys)`);
                return { message: configMsg, toolCalls: [] };
            }
            else {
                try {
                    const results = await searchWeb(searchQuery, { maxResults: 5 });
                    const formatted = formatSearchResults(searchQuery, results);
                    if (isExplicitSearchCmd) {
                        searchLastMsg.content = `[Web search results for "${searchQuery}"]\n\n${formatted}`;
                    }
                    else {
                        const searchMsg = { role: 'user', content: formatted };
                        messages.splice(messages.length - 1, 0, searchMsg);
                    }
                    console.log(LOG, `[req:${reqId}] Web search: ${results.length} results for "${searchQuery}"`);
                }
                catch (err) {
                    console.log(LOG, `[req:${reqId}] Web search failed: ${err.message}`);
                }
            }
        }
        // ── Entity detection for unknown names/handles ─────
        if (!searchQuery) {
            let previousUserMessage;
            for (let i = messages.length - 2; i >= 0; i--) {
                if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
                    previousUserMessage = messages[i].content;
                    break;
                }
            }
            const entityResult = shouldSearchEntity(searchLastContent, previousUserMessage);
            if (entityResult.shouldSearch && entityResult.query) {
                searchQuery = entityResult.query;
                console.log(LOG, `[req:${reqId}] Entity search: "${searchQuery}"`);
                const wsDiag = getSearchDiagnostics();
                if (!wsDiag.isReliable) {
                    const hasArabic = /[\u0600-\u06FF]/.test(searchLastContent);
                    const configMsg = hasArabic
                        ? 'البحث في الإنترنت غير مضبوط بشكل موثوق. فعّل TAVILY_API_KEY أو SERPER_API_KEY أو BRAVE_SEARCH_API_KEY.'
                        : 'Web search is not reliably configured. To enable web search, set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.';
                    console.log(LOG, `[req:${reqId}] Entity search skipped (provider: ${wsDiag.provider}, no reliable API keys)`);
                    return { message: configMsg, toolCalls: [] };
                }
                else {
                    try {
                        const results = await searchWeb(searchQuery, { maxResults: 5 });
                        const formatted = formatSearchResults(searchQuery, results);
                        const searchMsg = { role: 'user', content: formatted };
                        messages.splice(messages.length - 1, 0, searchMsg);
                        console.log(LOG, `[req:${reqId}] Entity search: ${results.length} results for "${searchQuery}"`);
                    }
                    catch (err) {
                        console.log(LOG, `[req:${reqId}] Entity search failed: ${err.message}`);
                    }
                }
            }
        }
        // ── Project file injection ──────────────────────
        timer.start('project_scan');
        let fileInjection = '';
        if (!searchQuery && useProjectCtx && (isProjectQuery || taskKind === 'project_scan' || taskKind === 'code_review' || taskKind === 'debugging' || taskKind === 'code_edit' || taskKind === 'coding_qa')) {
            // Rank project files by relevance to the query
            const allFiles = projectInfo.tree.split('\n').filter(f => !f.endsWith('/') && f.length > 0);
            const ranked = rankFiles(allFiles, lastUserMsg, 8);
            const topFiles = ranked.filter(r => r.score > 5).map(r => r.path).slice(0, 5);
            const fileParts = [];
            for (const file of topFiles) {
                const fullPath = resolve(workingDir, file);
                if (shouldIgnore(fullPath, workingDir))
                    continue;
                const content = readFile(fullPath);
                if (content) {
                    const lines = content.split('\n').length;
                    fileParts.push(`\n--- ${file} (${lines} lines) ---\n${content.slice(0, 3000)}\n`);
                }
            }
            if (fileParts.length > 0) {
                fileInjection = fileParts.join('');
                const est = estimateTokens(fileInjection);
                if (est < 2000) {
                    // Inject file content as a separate user message before the last message
                    const fileMsg = { role: 'user', content: `Relevant project files:\n${fileInjection}\n\nUser request: ${lastUserMsg}` };
                    messages[messages.length - 1] = fileMsg;
                    console.log(LOG, `[req:${reqId}] Injected ${topFiles.length} relevant files (~${est} tokens)`);
                }
            }
        }
        timer.stop('project_scan');
        // ── Brain context injection (scored selection) ──
        timer.start('context_select');
        if (!isSimpleQ && !searchQuery) {
            try {
                const selected = await selectContext({
                    message: lastUserMsg,
                    taskKind,
                    maxItems: 5,
                    debug: !!config.debug,
                });
                if (selected.items.length > 0) {
                    perQueryPrompt += formatSelectedContext(selected);
                    if (config.debug) {
                        console.log(LOG, `[debug] Context selection: ${selected.items.length} items (${selected.totalChars}/${selected.budget} chars)`);
                    }
                }
            }
            catch { /* skip */ }
        }
        timer.stop('context_select');
        // ── Timing log ──
        timer.stop('total');
        const timingReport = timer.report();
        if (config.debug) {
            console.log(LOG, `[timing] classification=${timingReport.classification}ms, project_scan=${timingReport.project_scan}ms, context_select=${timingReport.context_select}ms, total=${timingReport.total}ms`);
        }
        console.log(LOG, `Sending ${messages.length} messages to provider`);
        let response = await client.sendMessage(messages, perQueryPrompt);
        console.log(LOG, 'Provider response received successfully');
        // ── YOLO tool continuation loop ──────────────
        let steps = 0;
        let currentMessages = [...messages];
        while (steps < MAX_TOOL_STEPS && response.toolCalls.length > 0) {
            const yoloMode = getYolo();
            if (!yoloMode)
                break;
            const autoTools = response.toolCalls.filter(tc => tc.type === 'read_file' ||
                (tc.type === 'execute_command' && classifyCommand(tc.params.command || '') === 'safe'));
            // If any tool needs manual approval, stop and return remaining
            if (autoTools.length < response.toolCalls.length)
                break;
            steps++;
            if (config.debug) {
                console.log(LOG, `[req:${reqId}] YOLO tool loop step ${steps}/${MAX_TOOL_STEPS}: ${autoTools.length} tools`);
            }
            const { results } = await executeToolCalls(autoTools, true);
            const feedText = response.message
                ? `${response.message}\n\nTool results:\n${formatToolResults(autoTools, results)}`
                : `Tool results:\n${formatToolResults(autoTools, results)}`;
            currentMessages.push({ role: 'assistant', content: feedText });
            response = await client.sendMessage(currentMessages, perQueryPrompt);
        }
        // If still has tool calls after loop, return them to client
        if (response.toolCalls.length > 0 && steps > 0) {
            console.log(LOG, `[req:${reqId}] Tool loop stopped after ${steps} steps, ${response.toolCalls.length} remaining tools`);
        }
        const fbEvents = getFallbackEvents();
        const fallbackEvents = fbEvents.map(e => e.reason);
        const actualProvider = getLastSuccessfulProvider();
        const actualModel = getLastSuccessfulModel();
        return {
            message: response.message,
            toolCalls: response.toolCalls.map(tc => ({
                type: tc.type,
                params: tc.params,
            })),
            fallbackEvents: fallbackEvents.length > 0 ? fallbackEvents : undefined,
            provider: actualProvider ? (PROVIDER_DEFAULTS[actualProvider]?.label || actualProvider) : (PROVIDER_DEFAULTS[prov]?.label || prov),
            model: actualModel || config.currentModel,
            timing: timingReport,
        };
    }
    catch (err) {
        const e = err;
        const rawMsg = e.message || 'Unknown provider error';
        console.log(LOG, `[req:${reqId}] Provider failed: ${rawMsg}`);
        const userLastMsg = req.messages.filter(m => m.role === 'user').pop()?.content || '';
        const lang = getResponseLanguage(userLastMsg);
        const lastErr = getLastError();
        const lastFb = getLastFallbackUsed();
        const fbEvents = getFallbackEvents();
        // If ALL free providers failed, use the clean "all busy" message
        const allFailedRaw = rawMsg.includes('All free providers');
        let friendlyMsg;
        if (allFailedRaw) {
            if (lang === 'arabic') {
                friendlyMsg = 'جميع المزودات المجانية مشغولة أو وصلت للحد المسموح حاليًا. جرّب بعد قليل أو استخدم مزود مدفوع.';
            }
            else {
                friendlyMsg = 'All free providers are currently busy or rate-limited. Try again shortly or configure a paid/stable provider.';
            }
        }
        else {
            friendlyMsg = getFriendlyErrorMessage(lang, rawMsg, !!config.debug, PROVIDER_DEFAULTS[prov]?.label || prov);
        }
        if (config.debug && fbEvents.length > 0) {
            const triedLines = fbEvents.map(e => `  • ${e.reason}`).join('\n');
            friendlyMsg += `\n\nTried:\n${triedLines}`;
        }
        return {
            message: friendlyMsg,
            toolCalls: [],
            fallbackEvents: fbEvents.length > 0 ? fbEvents.map(e => e.reason) : undefined,
            provider: lastFb || PROVIDER_DEFAULTS[prov]?.label || prov,
            model: lastErr?.model || config.currentModel,
        };
    }
}
export async function runCommand(command) {
    try {
        const { execSync } = await import('node:child_process');
        const translated = translateCommand(command);
        const needsPowerShell = translated !== command && (translated.includes('Get-') || translated.includes('Select-'));
        const shell = process.platform === 'win32'
            ? (needsPowerShell ? 'powershell.exe -NoProfile -Command' : process.env.ComSpec || 'cmd.exe')
            : undefined;
        const stdout = execSync(translated, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            cwd: workingDir,
            shell,
        });
        return { stdout: stdout.trim(), stderr: '' };
    }
    catch (err) {
        const e = err;
        return {
            stdout: e.stdout?.toString().trim() || '',
            stderr: e.stderr?.toString().trim() || '',
            error: e.message || 'Command failed',
        };
    }
}
export function getFilePreview(path, content) {
    const fullPath = resolve(workingDir, path);
    return previewEdit(fullPath, content);
}
export function getYoloStatus() {
    return { enabled: getYolo() };
}
export function setYoloStatus(enabled) {
    setYolo(enabled);
    return { enabled };
}
export function getFallbackStatus() {
    const summary = toHealthSummary();
    const lastErr = getLastError();
    const health = getAllHealth();
    let lastAttemptedProvider = null;
    let lastAttemptedModel = null;
    let lastAttemptedCategory = null;
    // Find the most recently attempted entry: lastError or the latest health timestamp
    if (lastErr) {
        lastAttemptedProvider = lastErr.provider;
        lastAttemptedModel = lastErr.model;
        lastAttemptedCategory = lastErr.category;
    }
    else {
        let latestTs = 0;
        for (const [k, rec] of health) {
            if (rec.lastFailureTime && rec.lastFailureTime > latestTs) {
                latestTs = rec.lastFailureTime;
                const sep = k.lastIndexOf(':');
                lastAttemptedProvider = k.substring(0, sep);
                lastAttemptedModel = k.substring(sep + 1);
                lastAttemptedCategory = rec.category;
            }
        }
    }
    return {
        unhealthy: summary,
        lastError: lastErr ? { provider: lastErr.provider, model: lastErr.model, reason: lastErr.reason, category: lastErr.category } : null,
        lastFallback: getLastFallbackUsed(),
        lastSuccessful: {
            provider: getLastSuccessfulProvider(),
            model: getLastSuccessfulModel(),
        },
        lastAttempted: {
            provider: lastAttemptedProvider,
            model: lastAttemptedModel,
            category: lastAttemptedCategory,
        },
    };
}
//# sourceMappingURL=api.js.map