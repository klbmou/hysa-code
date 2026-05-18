import { resolve } from 'node:path';
import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, TIER_LABELS } from '../config/keys.js';
import { getProjectInfo } from '../context/builder.js';
import { readFile, shouldIgnore } from '../files/reader.js';
import { writeFileWithBackup, previewEdit } from '../files/writer.js';
import { getGitInfo } from '../utils/git.js';
import { createClient, isOnlyGreeting } from '../ai/client.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { getYolo, setYolo } from '../utils/session.js';
import { toHealthSummary, getLastError, getLastFallbackUsed } from '../ai/model-health.js';
import { detectSecrets } from '../utils/secrets.js';
import { truncateMessages } from '../context/tokens.js';
const workingDir = resolve('.');
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
export async function handleChat(req) {
    const lastMessage = req.messages[req.messages.length - 1];
    if (lastMessage && lastMessage.role === 'user' && isOnlyGreeting(lastMessage.content)) {
        return { message: 'Hi! How can I help with this project?', toolCalls: [] };
    }
    const config = loadConfig();
    if (!config) {
        throw new Error('No configuration found. Run: hysa chat');
    }
    const client = createClient(config);
    const projectInfo = getProjectInfo(workingDir);
    const gitInfo = getGitInfo(workingDir);
    const systemPrompt = buildSystemPrompt({
        type: projectInfo.type,
        entryPoints: projectInfo.entryPoints,
        configFiles: projectInfo.configFiles,
        fileCount: projectInfo.fileCount,
        tree: projectInfo.tree.length < 3000 ? projectInfo.tree : projectInfo.tree.slice(0, 3000) + '\n... (truncated)',
    }, config.agentMode || 'chat');
    const messages = req.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));
    const { messages: safeMessages } = truncateMessages(messages);
    const response = await client.sendMessage(safeMessages, systemPrompt);
    return {
        message: response.message,
        toolCalls: response.toolCalls.map(tc => ({
            type: tc.type,
            params: tc.params,
        })),
    };
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