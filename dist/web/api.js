import { resolve } from 'node:path';
import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, TIER_LABELS, LOCAL_FREE_PROVIDERS } from '../config/keys.js';
import { getProjectInfo } from '../context/builder.js';
import { readFile, shouldIgnore } from '../files/reader.js';
import { writeFileWithBackup, previewEdit } from '../files/writer.js';
import { getGitInfo } from '../utils/git.js';
import { createClient, createSingleClient, isOnlyGreeting, categorizeError } from '../ai/client.js';
import { buildSystemPrompt, resolvePromptMode } from '../prompts/system.js';
import { getYolo, setYolo } from '../utils/session.js';
import { toHealthSummary, getLastError, getLastFallbackUsed, getFallbackEvents, getLastSuccessfulProvider, getLastSuccessfulModel, getAllHealth } from '../ai/model-health.js';
import { detectSecrets } from '../utils/secrets.js';
import { searchWeb, formatSearchResults, getSearchDiagnostics } from '../tools/web-search.js';
import { estimateTokens } from '../context/tokens.js';
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
    const actionWords = /\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe|apply|remove|delete|rename|move|copy|refactor)\b/i;
    if (actionWords.test(trimmed))
        return false;
    return true;
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
    const prov = config.currentProvider;
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
        if (lastMessage && lastMessage.role === 'user' && isOnlyGreeting(lastMessage.content)) {
            writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: 'Hi! How can I help with this project?', toolCalls: [] })}\n\n`);
            return;
        }
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
        const lastUserMsgRaw = visionMessages.filter(m => m.role === 'user').pop()?.content || '';
        const lastUserMsgStr = typeof lastUserMsgRaw === 'string' ? lastUserMsgRaw : '';
        const isSimpleQ = isSimpleQuestion(lastUserMsgStr);
        const resolvedMode = resolvePromptMode(config.promptMode || 'auto', config.currentProvider, isSimpleQ);
        const perQueryPrompt = buildSystemPrompt({
            type: projectInfo.type,
            entryPoints: projectInfo.entryPoints,
            configFiles: projectInfo.configFiles,
            fileCount: projectInfo.fileCount,
            tree: projectInfo.tree.length < 3000 ? projectInfo.tree : projectInfo.tree.slice(0, 3000) + '\n... (truncated)',
        }, config.agentMode || 'chat', lightActive, config.currentProvider, resolvedMode);
        const response = await client.sendMessageStream(messages, perQueryPrompt, (event) => {
            if (event.type === 'token') {
                writeEvent(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
            }
        });
        writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response.message, toolCalls: response.toolCalls })}\n\n`);
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
export async function handleChat(req) {
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
        const lastContent = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
        if (lastMessage && lastMessage.role === 'user' && isOnlyGreeting(lastContent)) {
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
        const messages = visionMessages.map(m => ({
            role: m.role,
            content: m.content,
        }));
        injectLanguageInstruction(messages);
        // ── Per-query prompt mode resolution ────────────────
        const lastUserMsgRaw = visionMessages.filter(m => m.role === 'user').pop()?.content || '';
        const lastUserMsg = typeof lastUserMsgRaw === 'string' ? lastUserMsgRaw : '';
        const isSimpleQ = isSimpleQuestion(lastUserMsg);
        const resolvedMode = resolvePromptMode(config.promptMode || 'auto', config.currentProvider, isSimpleQ);
        const perQueryPrompt = buildSystemPrompt({
            type: projectInfo.type,
            entryPoints: projectInfo.entryPoints,
            configFiles: projectInfo.configFiles,
            fileCount: projectInfo.fileCount,
            tree: projectInfo.tree.length < 3000 ? projectInfo.tree : projectInfo.tree.slice(0, 3000) + '\n... (truncated)',
        }, config.agentMode || 'chat', lightActive, config.currentProvider, resolvedMode);
        if (config.debug) {
            const systemTokens = estimateTokens(perQueryPrompt);
            let historyTokens = 0;
            for (const m of messages) {
                if (typeof m.content === 'string') {
                    historyTokens += estimateTokens(m.content);
                }
                else {
                    historyTokens += 100; // rough estimate for image
                }
            }
            const totalTokens = systemTokens + historyTokens;
            console.log(LOG, `[debug] Prompt mode: ${resolvedMode}`);
            console.log(LOG, `[debug] System prompt: ~${systemTokens} tokens`);
            console.log(LOG, `[debug] History/messages: ~${historyTokens} tokens`);
            console.log(LOG, `[debug] Total estimated: ~${totalTokens} tokens`);
            if (lightActive && totalTokens > 2000) {
                console.log(LOG, `[debug] Local prompt trimmed from ~${totalTokens} tokens to ~2000 tokens.`);
            }
        }
        // ── Web search detection ────────────────────────
        const searchLastMsg = messages[messages.length - 1];
        const searchLastContent = typeof searchLastMsg?.content === 'string' ? searchLastMsg.content : '';
        const isExplicitSearchCmd = /^hysa\s+(?:search|websearch)\s+/i.test(searchLastContent);
        const searchPatterns = [
            // Explicit hysa search/websearch commands — check FIRST
            /^hysa\s+(?:search|websearch)\s+"(.+?)"$/i,
            /^hysa\s+(?:search|websearch)\s+'(.+?)'$/i,
            /^hysa\s+(?:search|websearch)\s+(.+)$/i,
            /^(?:search|find|look\s*up|google|bing|search\s*the\s*web)\s+(?:for\s+)?(.+)/i,
            /^(?:what\s+is\s+the\s+(?:current|latest|recent)\s+)/i,
            /^(?:latest\s+(?:news|updates?|info)\s+(?:about|on)\s+)/i,
            /^(?:where\s+can\s+(?:I|we)\s+(?:watch|find|get)\s+)/i,
            /^(?:ابحث\s+في\s+(?:الانترنت|الإنترنت|النت)\s+(?:عن\s+)?)(.+)/i,
            /^(?:آخر\s+أخبار\s+)(.+)/i,
            /^(?:هل\s+هذا\s+صحيح\s+(?:الآن|حاليا|حالياً)?)/i,
            /^(?:ما\s+هو\s+(?:آخر|أحدث)\s+)/i,
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
                        // Replace the raw command with search results
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
        console.log(LOG, `Sending ${messages.length} messages to provider`);
        const response = await client.sendMessage(messages, perQueryPrompt);
        console.log(LOG, 'Provider response received successfully');
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
        const stdout = execSync(command, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            cwd: workingDir,
            shell: process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : undefined,
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