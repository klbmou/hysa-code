import { resolve } from 'node:path';
import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, TIER_LABELS, LOCAL_FREE_PROVIDERS } from '../config/keys.js';
import { getProjectInfo } from '../context/builder.js';
import { readFile, shouldIgnore } from '../files/reader.js';
import { writeFileWithBackup, previewEdit } from '../files/writer.js';
import { getGitInfo } from '../utils/git.js';
import { createClient, createSingleClient, isOnlyGreeting, categorizeError } from '../ai/client.js';
import { buildSystemPrompt, resolvePromptMode } from '../prompts/system.js';
import { getYolo, setYolo } from '../utils/session.js';
import { toHealthSummary, getLastError, getLastFallbackUsed, getFallbackEvents } from '../ai/model-health.js';
import { detectSecrets } from '../utils/secrets.js';
import { estimateTokens } from '../context/tokens.js';
const LOG = '[HYSA Chat]';
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
const VISION_CAPABLE_PROVIDERS = {
    gemini: ['gemini-2.5-flash', 'gemini-1.5-flash'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'],
    openrouter: [
        'google/gemini-2.5-flash',
        'google/gemini-2.5-flash:free',
        'google/gemini-1.5-flash',
        'google/gemini-1.5-flash:free',
        'qwen/qwen2.5-vl-72b-instruct:free',
        'qwen/qwen-vl-plus',
        'qwen/qwen-vl-plus:free',
        'meta-llama/llama-3.2-11b-vision-instruct:free',
    ],
};
function supportsVision(provider, model) {
    const models = VISION_CAPABLE_PROVIDERS[provider];
    if (!models)
        return false;
    return models.some(m => model.includes(m.replace('google/', '').replace(':free', '')) || model === m);
}
function hasImageAttachments(attachments) {
    if (!attachments || attachments.length === 0)
        return false;
    return attachments.some(a => a.kind === 'image' && a.dataUrl);
}
function getVisionFallbackCandidates(config) {
    const candidates = [];
    const added = new Set();
    const currentProv = config.currentProvider;
    const tryAddOther = (provider) => {
        if (provider === currentProv)
            return;
        const models = VISION_CAPABLE_PROVIDERS[provider];
        if (!models)
            return;
        const key = config.apiKeys[provider];
        if (!key)
            return;
        for (const model of models) {
            const k = `${provider}:${model}`;
            if (!added.has(k)) {
                added.add(k);
                candidates.push({ provider, model, label: `${PROVIDER_DEFAULTS[provider]?.label || provider} / ${model}` });
            }
        }
    };
    // 1. Same provider vision models first (already authenticated, no key check needed)
    const currentVisionModels = VISION_CAPABLE_PROVIDERS[currentProv];
    if (currentVisionModels) {
        for (const model of currentVisionModels) {
            const k = `${currentProv}:${model}`;
            if (!added.has(k)) {
                added.add(k);
                candidates.push({ provider: currentProv, model, label: `${PROVIDER_DEFAULTS[currentProv]?.label || currentProv} / ${model}` });
            }
        }
    }
    // 2. Other providers with API keys
    tryAddOther('gemini');
    tryAddOther('openrouter');
    tryAddOther('openai');
    tryAddOther('anthropic');
    return candidates;
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
        writeEvent(`data: ${JSON.stringify({ type: 'error', message: 'No configuration found. Run: hysa chat' })}\n\n`);
        return;
    }
    const prov = config.currentProvider;
    if (!req.messages || !Array.isArray(req.messages) || req.messages.length === 0) {
        writeEvent(`data: ${JSON.stringify({ type: 'error', message: 'Missing or empty messages array in request body' })}\n\n`);
        return;
    }
    console.log(LOG, `handleChatStream called, messages=${req.messages.length}, attachments=${req.attachments?.length || 0}`);
    try {
        const hasImages = hasImageAttachments(req.attachments);
        const visionAvailable = supportsVision(prov, config.currentModel);
        // ── Vision fallback: if images present but current provider not vision-capable ──
        if (hasImages && !visionAvailable) {
            // Debug log for image dataUrl presence
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
                    const timeoutMs = 15000;
                    writeEvent(`data: ${JSON.stringify({ type: 'fallback', message: `Trying vision model: ${c.label}` })}\n\n`);
                    try {
                        console.log(LOG, `Trying vision provider: ${c.label}`);
                        const client = createSingleClient(c.provider, c.model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel);
                        if (client.sendMessageStream) {
                            const response = await withTimeout(client.sendMessageStream(fbMessages, fbSysPrompt, (event) => {
                                if (event.type === 'token') {
                                    writeEvent(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
                                }
                            }), timeoutMs);
                            writeEvent(`data: ${JSON.stringify({ type: 'fallback', message: `Switched to vision model: ${c.label}` })}\n\n`);
                            writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response.message, toolCalls: response.toolCalls })}\n\n`);
                            return;
                        }
                        else {
                            const result = await withTimeout(client.sendMessage(fbMessages, fbSysPrompt), timeoutMs);
                            if (result.message) {
                                writeEvent(`data: ${JSON.stringify({ type: 'fallback', message: `Switched to vision model: ${c.label}` })}\n\n`);
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
                        failures.push({ label: c.label, reason: reasonStr, detail: e.message?.slice(0, 80) || '' });
                        writeEvent(`data: ${JSON.stringify({ type: 'fallback', message: `Vision model failed: ${c.label} — ${reasonStr}` })}\n\n`);
                        console.log(LOG, `Vision fallback failed with ${c.label}: ${e.message?.slice(0, 100)}`);
                    }
                }
            }
            // All vision fallbacks failed
            let errorText = 'Image understanding failed because all vision providers were unavailable or quota-limited.';
            if (failures && failures.length > 0) {
                errorText += '\nTried:\n' + failures.map(f => `- ${f.label} — ${f.reason}`).join('\n');
            }
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
        const msg = e.message || 'Unknown stream error';
        console.log(LOG, `Stream failed: ${msg}`);
        writeEvent(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
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
    console.log(LOG, `handleChat called, messages=${req.messages.length}, attachments=${req.attachments?.length || 0}`);
    try {
        const hasImages = hasImageAttachments(req.attachments);
        const visionAvailable = supportsVision(prov, config.currentModel);
        // ── Vision fallback: if images present but current provider not vision-capable ──
        if (hasImages && !visionAvailable) {
            // Debug log for image dataUrl presence
            if (req.attachments) {
                for (const att of req.attachments) {
                    if (att.kind === 'image') {
                        console.log(LOG, `image attachment: ${att.name}, ${att.size}B, hasDataUrl ${!!att.dataUrl}`);
                    }
                }
            }
            const visionCandidates = getVisionFallbackCandidates(config);
            const fbEvents = [];
            const failures = [];
            if (visionCandidates.length > 0) {
                console.log(LOG, `Current provider ${prov} not vision-capable, trying ${visionCandidates.length} vision-capable fallback(s)...`);
                // Build vision messages
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
                    const timeoutMs = 15000;
                    fbEvents.push(`Trying vision model: ${c.label}`);
                    try {
                        console.log(LOG, `Trying vision provider: ${c.label}`);
                        const client = createSingleClient(c.provider, c.model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel);
                        const result = await withTimeout(client.sendMessage(fbMessages, fbSysPrompt), timeoutMs);
                        if (result.message) {
                            console.log(LOG, `Vision fallback succeeded with ${c.label}`);
                            fbEvents.push(`Switched to vision model: ${c.label}`);
                            return {
                                message: result.message,
                                toolCalls: result.toolCalls,
                                fallbackEvents: fbEvents,
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
                        fbEvents.push(`Vision model failed: ${c.label} — ${reasonStr}`);
                        console.log(LOG, `Vision fallback failed with ${c.label}: ${e.message?.slice(0, 100)}`);
                    }
                }
            }
            // All vision providers failed — return hint with actual reasons
            let msg = 'Image understanding failed because all vision providers were unavailable or quota-limited.';
            if (failures.length > 0) {
                msg += '\nTried:\n' + failures.map(f => `- ${f.label} — ${f.reason}`).join('\n');
            }
            return { message: msg, toolCalls: [], fallbackEvents: fbEvents, hint: 'All vision providers failed.' };
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
        console.log(LOG, `Sending ${messages.length} messages to provider`);
        const response = await client.sendMessage(messages, perQueryPrompt);
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
    }
    catch (err) {
        const e = err;
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
    return {
        unhealthy: summary,
        lastError: lastErr ? { provider: lastErr.provider, model: lastErr.model, reason: lastErr.reason } : null,
        lastFallback: getLastFallbackUsed(),
    };
}
//# sourceMappingURL=api.js.map