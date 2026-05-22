import { resolve } from 'node:path';
import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, TIER_LABELS, LOCAL_FREE_PROVIDERS } from '../config/keys.js';
import { getProjectInfo } from '../context/builder.js';
import { readFile, shouldIgnore } from '../files/reader.js';
import { writeFileWithBackup, previewEdit } from '../files/writer.js';
import { getGitInfo } from '../utils/git.js';
import { createClient, isOnlyGreeting } from '../ai/client.js';
import { buildSystemPrompt, resolvePromptMode } from '../prompts/system.js';
import { getYolo, setYolo } from '../utils/session.js';
import { toHealthSummary, getLastError, getLastFallbackUsed, getFallbackEvents } from '../ai/model-health.js';
import { detectSecrets } from '../utils/secrets.js';
import { estimateTokens } from '../context/tokens.js';
const LOG = '[HYSA Chat]';
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
        return { provider: 'not configured', model: '', tier: '', git: null };
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
        if (hasImages && !visionAvailable) {
            writeEvent(`data: ${JSON.stringify({ type: 'token', text: 'Image understanding needs a vision-capable provider. Try Gemini (gemini-2.5-flash) or OpenRouter with a vision model like google/gemini-2.5-flash:free.' })}\n\n`);
            writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: 'Image understanding needs a vision-capable provider. Try Gemini (gemini-2.5-flash) or OpenRouter with a vision model like google/gemini-2.5-flash:free.', toolCalls: [] })}\n\n`);
            return;
        }
        // Inject attachment text content as context before the user's question
        if (req.attachments && req.attachments.length > 0) {
            console.log(LOG, `Attachments: ${req.attachments.length} file(s)`);
            for (const att of req.attachments) {
                const hasText = !!att.textContent && att.textContent.length > 0;
                console.log(LOG, `  ${att.name} (${att.kind}, ${att.size}B, hasText: ${hasText})`);
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
        if (hasImages && !visionAvailable) {
            const msg = 'Image understanding needs a vision-capable provider. Try Gemini (gemini-2.5-flash) or OpenRouter with a vision model like google/gemini-2.5-flash:free.';
            return { message: msg, toolCalls: [], hint: 'Switch to a vision-capable provider to analyze images.' };
        }
        // Inject attachment text content as context before the user's question
        if (req.attachments && req.attachments.length > 0) {
            console.log(LOG, `Attachments: ${req.attachments.length} file(s)`);
            for (const att of req.attachments) {
                const hasText = !!att.textContent && att.textContent.length > 0;
                console.log(LOG, `  ${att.name} (${att.kind}, ${att.size}B, hasText: ${hasText})`);
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