import { Command } from 'commander';
import { input, confirm, password, select } from '@inquirer/prompts';
import pc from 'picocolors';
import { execSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_MODELS, PROVIDER_CATEGORIES, PROVIDER_CATEGORY_LABELS, PROVIDER_DESCRIPTIONS, PROVIDER_SIGNUP_URLS, TIER_LABELS, PROVIDER_TIERS, LOCAL_FREE_PROVIDERS, providerNeedsApiKey, providerHasOptionalApiKey, validateApiKey, getDefaultProviderFromEnv, isLocalFallbackEnabled } from './config/keys.js';
import { detectBestProvider, buildConfigFromDetection, detectedProviderLabel } from './config/provider-detect.js';
import { runDoctor } from './utils/doctor.js';
import { fetchOpenRouterModels, filterFreeModels, formatModelsTable } from './ai/openrouter-models.js';
import { getSettings, updateSettings, updateAgentMode } from './config/settings.js';
import { createClient, isOnlyGreeting, getCasualResponse, createSingleClient } from './ai/client.js';
import { classifyTask } from './ai/task-classifier.js';
import { shouldInjectProjectContext, getAvailableFallbackProviders, getSuggestedFallbackAction } from './ai/provider-policy.js';
import { getProjectInfo, invalidateCache } from './context/builder.js';
import { rankFiles } from './context/ranker.js';
import { estimateTokens, truncateMessages } from './context/tokens.js';
import { buildSystemPrompt, resolvePromptMode } from './prompts/system.js';
import { isProtectedFilePath, PROTECTED_FILE_MESSAGE, normalizeToolParams, containsOnlyToolSyntax, stripToolCallBlocks } from './ai/tools.js';
import { readFile, resolveFileReadPath, isGeneratedOutput } from './files/reader.js';
import { writeFileWithBackup, previewEdit } from './files/writer.js';
import { Spinner } from './utils/spinner.js';
import { detectSecrets } from './utils/secrets.js';
import { getGitInfo } from './utils/git.js';
import { addTask, addRecentFile, addEdit, incrementSessionCount, getYolo, setYolo, getProviderHealth, clearProviderHealth, getUsage, recordPromptMode } from './utils/session.js';
import { grepSearch, findFiles } from './utils/searcher.js';
import { searchWeb, formatSearchResults, getWebSearchConfig, getSearchDiagnostics, isCapabilityQuestion, getCapabilityResponse } from './tools/web-search.js';
import { browserOpen, browserScreenshot, browserText, browserSnapshot, browserClick, browserType, browserClose, getBrowserStatus, checkPlaywrightInstalled, checkChromiumInstalled, getBrowserConfig, cliBrowserOpen, cliBrowserScreenshot, cliBrowserText, cliBrowserSnapshot, cliBrowserClick, cliBrowserType, cliBrowserClose, cliBrowserStatus, getDaemonConfig } from './tools/browser.js';
import { shouldSearchEntity } from './tools/entity-detector.js';
import { classifyCommand } from './utils/commands.js';
import { ALL_MODES, MODE_LABELS, MODE_DESCRIPTIONS } from './agent/modes.js';
import { createTask, getActiveTask } from './agent/tasks.js';
import { listSymbols, findReferences, searchImports, summarizeFile, explainFunction } from './agent/tools.js';
import { getAllHealth, toHealthSummary, resetHealth, getLastError, getLastFallbackUsed, getModelsInCooldown, getProviderCooldowns, getRateLimitedModels, getFallbackEvents, loadHealthFromEntries } from './ai/model-health.js';
import { listOllamaModels } from './ai/ollama.js';
import { initBrainFiles, getBrainStatus, readRecentEvents, readProjectMap, appendBrainEvent, appendLesson, appendDecision, writeProjectMap, generateProjectMap, getGraphStats, searchGraph, compactGraph, readExperienceGraph, logLesson as graphLogLesson, logDecision as graphLogDecision } from './brain/index.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
function getPackageVersion() {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const candidates = [
            join(__dirname, '..', 'package.json'),
            join(__dirname, '..', '..', 'package.json'),
            join(process.cwd(), 'package.json'),
        ];
        for (const p of candidates) {
            try {
                const pkg = JSON.parse(readFileSync(p, 'utf8'));
                if (pkg && typeof pkg.version === 'string')
                    return pkg.version;
            }
            catch { }
        }
    }
    catch { }
    return '0.6.0';
}
// ── Setup ────────────────────────────────────────────────
async function setupFirstRun() {
    // Auto-detect the best available provider first
    const detected = await detectBestProvider();
    if (detected) {
        const config = buildConfigFromDetection(detected);
        saveConfig(config);
        console.log(pc.green(`\n✓ Auto-detected ${detectedProviderLabel(detected)}`));
        console.log(pc.dim('  Start chatting with: hysa chat\n'));
        return config;
    }
    console.clear();
    console.log(pc.bold(pc.magenta('┌─────────────────────────────────────────────┐')));
    console.log(pc.bold(pc.magenta(`│        💜 Welcome to HYSA Code v${getPackageVersion()}         │`)));
    console.log(pc.bold(pc.magenta('└─────────────────────────────────────────────┘')));
    console.log();
    const mode = await select({
        message: 'Choose your AI mode:',
        choices: [
            { name: '☁️  Free API Key     (OpenCode Zen / OpenRouter / Groq / Gemini / DeepSeek, free key)  ★', value: 'cloud_free' },
            { name: '🖥️  Local Free       (Ollama / LM Studio, no API key, requires local server)', value: 'local_free' },
            { name: '🔑  Premium API      (Claude / GPT, paid or billed API)', value: 'premium_api' },
        ],
    });
    if (mode === 'local_free') {
        const localChoice = await select({
            message: 'Select local AI server:',
            choices: [
                { name: 'Ollama     (http://localhost:11434)', value: 'ollama' },
                { name: 'LM Studio  (http://localhost:1234/v1)', value: 'local_openai' },
                { name: 'Custom OpenAI-compatible endpoint', value: 'custom' },
            ],
        });
        if (localChoice === 'ollama') {
            const config = {
                currentProvider: 'ollama',
                currentModel: 'qwen2.5-coder',
                apiKeys: {},
                ollamaBaseUrl: 'http://localhost:11434',
            };
            saveConfig(config);
            console.log(pc.green('\n✓ Local Free mode configured (Ollama)!'));
            console.log(pc.dim('  Start chatting with: hysa chat'));
            console.log(pc.dim('  Make sure Ollama is running with: ollama run qwen2.5-coder\n'));
            return config;
        }
        const baseUrl = localChoice === 'local_openai'
            ? 'http://localhost:1234/v1'
            : await input({ message: 'Enter the base URL of your local server (e.g. http://localhost:8080/v1):', default: 'http://localhost:8080/v1' });
        const model = await input({ message: 'Enter the model name (as it appears in your local server):', default: 'local-model' });
        const config = {
            currentProvider: 'local_openai',
            currentModel: model,
            apiKeys: {},
            ollamaBaseUrl: 'http://localhost:11434',
            localOpenAiBaseUrl: baseUrl,
            localOpenAiModel: model,
        };
        saveConfig(config);
        console.log(pc.green('\n✓ Local Free mode configured!'));
        console.log(pc.dim(`  Server: ${baseUrl}`));
        console.log(pc.dim(`  Model:  ${model}`));
        console.log(pc.dim('  Start chatting with: hysa chat\n'));
        return config;
    }
    if (mode === 'cloud_free') {
        const provider = await select({
            message: 'Select Free API provider (★ recommended: OpenCode Zen):',
            choices: [
                { name: `OpenCode Zen  — ${PROVIDER_DESCRIPTIONS.opencode_zen}`, value: 'opencode_zen' },
                { name: `OpenRouter    — ${PROVIDER_DESCRIPTIONS.openrouter}`, value: 'openrouter' },
                { name: `Groq          — ${PROVIDER_DESCRIPTIONS.groq}`, value: 'groq' },
                { name: `DeepSeek      — ${PROVIDER_DESCRIPTIONS.deepseek}`, value: 'deepseek' },
                { name: `Gemini        — ${PROVIDER_DESCRIPTIONS.gemini}`, value: 'gemini' },
                { name: `OpenAI Router — external proxy/router (9router, etc.)`, value: 'openai_router' },
            ],
        });
        if (provider === 'openai_router') {
            const fromEnv = !!process.env.HYSA_OPENAI_ROUTER_BASE_URL;
            let baseUrl = process.env.HYSA_OPENAI_ROUTER_BASE_URL;
            if (!baseUrl) {
                baseUrl = await input({ message: 'OpenAI router base URL\n  Example: http://localhost:20128/v1', default: 'http://localhost:20128/v1' });
            }
            baseUrl = baseUrl.replace(/\/+$/, '');
            let model = process.env.HYSA_OPENAI_ROUTER_MODEL || PROVIDER_DEFAULTS.openai_router.model;
            model = await input({ message: 'Model name (as accepted by your router):', default: model });
            const askKey = await confirm({ message: 'Does your router require an API key?', default: !!process.env.HYSA_OPENAI_ROUTER_API_KEY });
            let key = '';
            if (askKey) {
                key = await password({ message: 'Enter API key for router:', mask: true });
            }
            const config = {
                currentProvider: 'openai_router',
                currentModel: model,
                apiKeys: { openai_router: key },
                openaiRouterBaseUrl: baseUrl,
                openaiRouterModel: model,
                ollamaBaseUrl: 'http://localhost:11434',
            };
            saveConfig(config);
            console.log(pc.green(`\n✓ OpenAI Router configured!${fromEnv ? ' (from env vars)' : ''}`));
            console.log(pc.dim(`  Base URL: ${baseUrl}`));
            console.log(pc.dim(`  Model:    ${model}`));
            console.log(pc.dim('  Start chatting with: hysa chat\n'));
            return config;
        }
        const rawKey = await password({
            message: `Enter your free ${PROVIDER_DEFAULTS[provider].label} API key\n  Get one: ${PROVIDER_SIGNUP_URLS[provider]}`,
            mask: true,
        });
        const validated = validateApiKey(rawKey, provider);
        if (!validated.valid) {
            console.log(pc.red(`\n✗ ${validated.error}\n`));
            process.exit(1);
        }
        const models = PROVIDER_MODELS[provider];
        const model = await select({
            message: 'Select model:',
            choices: models.map(m => ({ name: m, value: m })),
        });
        const config = {
            currentProvider: provider,
            currentModel: model,
            apiKeys: { [provider]: validated.key },
            ollamaBaseUrl: 'http://localhost:11434',
        };
        saveConfig(config);
        console.log(pc.green('\n✓ Free API Key mode configured!'));
        console.log(pc.dim('  Start chatting with: hysa chat'));
        console.log(pc.dim('  Free API key saved. No local models needed.\n'));
        return config;
    }
    // Premium API
    const provider = await select({
        message: 'Select Premium provider:',
        choices: [
            { name: 'Anthropic Claude', value: 'anthropic' },
            { name: 'OpenAI GPT', value: 'openai' },
            { name: 'Google Gemini', value: 'gemini' },
        ],
    });
    const models = PROVIDER_MODELS[provider];
    const model = await select({
        message: 'Select model:',
        choices: models.map(m => ({ name: m, value: m })),
    });
    const rawKey = await password({ message: `Enter your ${PROVIDER_DEFAULTS[provider].label} API key\n  Get one: ${PROVIDER_SIGNUP_URLS[provider]}`, mask: true });
    const validated = validateApiKey(rawKey, provider);
    if (!validated.valid) {
        console.log(pc.red(`\n✗ ${validated.error}\n`));
        process.exit(1);
    }
    const config = {
        currentProvider: provider,
        currentModel: model,
        apiKeys: { [provider]: validated.key },
        ollamaBaseUrl: 'http://localhost:11434',
    };
    saveConfig(config);
    console.log(pc.green('\n✓ Configuration saved to ~/.hysa/config.json\n'));
    return config;
}
// ── Helpers ──────────────────────────────────────────────
function showHeader(config, gitInfo, contextTokens, agentMode, yolo) {
    const providerLabel = PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider;
    const tier = TIER_LABELS[PROVIDER_TIERS[config.currentProvider]];
    const parts = [];
    parts.push(`${pc.bold('HYSA Code')}  ${pc.dim('·')}  ${providerLabel} ${pc.dim('·')} ${config.currentModel} ${pc.dim('·')} ${tier?.label || ''}`);
    if (agentMode || yolo || gitInfo?.branch) {
        const modeParts = [];
        if (agentMode)
            modeParts.push(`${MODE_LABELS[agentMode] || agentMode}`);
        if (yolo)
            modeParts.push('YOLO');
        const modeStr = modeParts.length > 0 ? ` ${modeParts.join(' · ')}  ${pc.dim('|')}` : '';
        const gitStr = gitInfo?.branch ? `  Git: ${gitInfo.branch} ${gitInfo.hasChanges ? pc.yellow('●') : pc.green('○')}` : '';
        parts.push(` Mode:${modeStr}${gitStr}${contextTokens !== undefined ? `  ${pc.dim('·')}  ~${contextTokens.toLocaleString()} tokens` : ''}`);
    }
    else if (contextTokens !== undefined) {
        parts.push(` Context: ~${contextTokens.toLocaleString()} tokens`);
    }
    console.log(pc.dim(parts.join('\n')));
    console.log();
}
function formatDiff(diff) {
    return diff
        .split('\n')
        .map(line => {
        if (line.startsWith('+'))
            return pc.green(line);
        if (line.startsWith('-'))
            return pc.red(line);
        if (line.startsWith('@@'))
            return pc.cyan(line);
        return line;
    })
        .join('\n');
}
function showHelp(agentMode) {
    console.log(pc.cyan('\nAvailable commands:'));
    console.log(pc.cyan('  /help              Show this help'));
    console.log(pc.cyan('  /mode              Switch agent mode'));
    console.log(pc.cyan('  /model             Switch AI provider / model'));
    console.log(pc.cyan('  /new               Clear conversation history'));
    console.log(pc.cyan('  /tree              Show project tree'));
    console.log(pc.cyan('  /search <pattern>  Search code for a pattern'));
    console.log(pc.cyan('  /find <filename>   Find files by name'));
    console.log(pc.cyan('  /read <path>       Read a file directly'));
    console.log(pc.cyan('  /run <command>     Execute a shell command'));
    console.log(pc.cyan('  /diff              Show git diff'));
    console.log(pc.cyan('  /commit <msg>      Git commit with message'));
    console.log(pc.cyan('  /agents            Show agent status'));
    console.log(pc.cyan('  /health            Show provider health status'));
    console.log(pc.cyan('  /fallback          Show fallback status'));
    console.log(pc.cyan('  /fallback status   Show unhealthy providers'));
    console.log(pc.cyan('  /fallback reset    Clear provider health records'));
    console.log(pc.cyan('  /fallback test     Test configured providers'));
    console.log(pc.cyan('  /usage             Show context estimate and quota info'));
    console.log(pc.cyan('  /models            Show OpenRouter free models (when using OpenRouter)'));
    console.log(pc.cyan('  /providers         List all available providers'));
    console.log(pc.cyan('  /experimental      Toggle experimental free providers'));
    console.log(pc.cyan('  /retry             Retry the last AI response'));
    console.log(pc.cyan('  /debug             Toggle debug mode'));
    console.log(pc.cyan('  /exit              Exit HYSA Code'));
    console.log(pc.cyan('  /apply             Apply the pending edit'));
    console.log(pc.cyan('  /pending           Show pending edit details'));
    console.log(pc.cyan('  /yolo              Toggle YOLO mode (auto-apply edits)'));
    console.log(pc.cyan('  /light             Toggle Light mode (short prompts, fast responses)'));
    console.log(pc.cyan('  /latency           Test provider latency'));
    console.log(pc.cyan('  /brain status            Show brain status'));
    console.log(pc.cyan('  /brain recent            Show recent brain events'));
    console.log(pc.cyan('  /brain map               Update project map'));
    console.log(pc.cyan('  /brain note <text>       Add a note to brain'));
    console.log(pc.cyan('  /brain graph             Show experience graph stats'));
    console.log(pc.cyan('  /brain graph search <q>  Search experience graph'));
    if (agentMode && agentMode !== 'chat') {
        console.log(pc.dim(`\n  Active mode: ${MODE_LABELS[agentMode]}`));
        console.log(pc.dim(`  ${MODE_DESCRIPTIONS[agentMode]}`));
    }
    console.log();
}
// ── Search helpers ───────────────────────────────────────
function showSearchResults(results) {
    if (results.length === 0) {
        console.log(pc.yellow('  No matches found.\n'));
        return;
    }
    console.log(pc.cyan(`  Found ${results.length} matches:\n`));
    for (const r of results.slice(0, 15)) {
        console.log(`  ${pc.dim(`${r.file}:${r.line}`)}`);
        console.log(`    ${r.content}`);
        console.log();
    }
    if (results.length > 15) {
        console.log(pc.dim(`  ... and ${results.length - 15} more results\n`));
    }
}
function showFindResults(results) {
    if (results.length === 0) {
        console.log(pc.yellow('  No files found.\n'));
        return;
    }
    console.log(pc.cyan(`  Found ${results.length} files:\n`));
    for (const r of results.slice(0, 20)) {
        console.log(`  ${pc.dim(r)}`);
    }
    if (results.length > 20) {
        console.log(pc.dim(`  ... and ${results.length - 20} more files`));
    }
    console.log();
}
// ── Model switching ──────────────────────────────────────
const PROVIDER_CHOICES = [
    { name: 'OpenCode Zen (Free API)', value: 'opencode_zen', category: 'cloud_free', tier: 'free_api' },
    { name: 'OpenRouter (Free API)', value: 'openrouter', category: 'cloud_free', tier: 'free_api' },
    { name: 'Groq (Free API)', value: 'groq', category: 'cloud_free', tier: 'free_api' },
    { name: 'DeepSeek (Free API)', value: 'deepseek', category: 'cloud_free', tier: 'free_api' },
    { name: 'Google Gemini (Free API)', value: 'gemini', category: 'cloud_free', tier: 'free_api' },
    { name: 'Ollama (Local Free)', value: 'ollama', category: 'local_free', tier: 'local_free' },
    { name: 'LM Studio / Local OpenAI (Local Free)', value: 'local_openai', category: 'local_free', tier: 'local_free' },
    { name: 'HYSA AI (Local Free)', value: 'hysa_ai', category: 'local_free', tier: 'local_free' },
    { name: 'Anthropic Claude (Premium)', value: 'anthropic', category: 'premium_api', tier: 'premium_api' },
    { name: 'OpenAI GPT (Premium)', value: 'openai', category: 'premium_api', tier: 'premium_api' },
    { name: 'Pollinations AI (Experimental)', value: 'pollinations', category: 'experimental_free', tier: 'experimental_free' },
    { name: 'LLM7 (Experimental)', value: 'llm7', category: 'experimental_free', tier: 'experimental_free' },
    { name: 'Puter AI (Experimental)', value: 'puter', category: 'experimental_free', tier: 'experimental_free' },
    { name: 'Anthropic Proxy (Cloud Free)', value: 'anthropic_proxy', category: 'cloud_free', tier: 'free_api' },
    { name: 'OpenAI Router (Cloud Free)', value: 'openai_router', category: 'cloud_free', tier: 'free_api' },
];
async function switchModel(config) {
    // Filter choices: hide experimental unless enabled
    const filteredChoices = PROVIDER_CHOICES.filter(c => c.tier !== 'experimental_free' || config.allowExperimentalProviders);
    const provider = await select({
        message: 'Select provider:',
        choices: filteredChoices.map(c => ({
            name: `${TIER_LABELS[c.tier].icon} ${c.name}`,
            value: c.value,
        })),
    });
    const models = PROVIDER_MODELS[provider];
    const model = await select({
        message: 'Select model:',
        choices: models.map(m => ({ name: m, value: m })),
    });
    if (provider === 'openrouter' && model === 'openrouter/free') {
        console.log(pc.yellow('  ⚠ openrouter/free may choose a general model and can be weaker for coding.\n'));
        console.log(pc.dim('  Recommended: qwen/qwen3-coder:free or deepseek/deepseek-chat:free\n'));
    }
    if (provider === 'hysa_ai' && model === 'hysa-coder-lite') {
        console.log(pc.yellow('  ⚡ hysa-coder-lite uses a small local model (qwen2.5-coder:1.5b).\n'));
        console.log(pc.dim('  It is free and private, but may be weaker at tool use.\n'));
        console.log(pc.dim('  For better coding, try hysa-coder if your machine can run it.\n'));
    }
    if (PROVIDER_TIERS[provider] === 'experimental_free') {
        console.log(pc.yellow('  ⚠ Experimental free providers may log prompts, rate-limit, disappear, or change behavior. Do not send sensitive code.\n'));
        if (!config.experimentalConfirmed) {
            inPrompt = true;
            const ok = await confirm({ message: 'I understand the risks, continue with experimental provider?', default: false });
            inPrompt = false;
            if (!ok) {
                console.log(pc.dim('  Provider selection cancelled.\n'));
                return { config, changed: false };
            }
        }
    }
    const updatedConfig = { ...config, currentProvider: provider, currentModel: model, experimentalConfirmed: config.experimentalConfirmed || PROVIDER_TIERS[provider] === 'experimental_free' };
    if (provider !== 'ollama' && provider !== 'local_openai' && PROVIDER_TIERS[provider] !== 'experimental_free') {
        if (!config.apiKeys[provider]) {
            if (providerNeedsApiKey(provider)) {
                const rawKey = await password({ message: `Enter ${PROVIDER_DEFAULTS[provider].label} API key\n  Get one: ${PROVIDER_SIGNUP_URLS[provider]}`, mask: true });
                const validated = validateApiKey(rawKey, provider);
                if (!validated.valid) {
                    console.log(pc.red(`\n✗ ${validated.error}\n`));
                    process.exit(1);
                }
                updatedConfig.apiKeys = { ...config.apiKeys, [provider]: validated.key };
            }
            else if (providerHasOptionalApiKey(provider)) {
                const rawKey = await password({ message: `Optional API key for ${PROVIDER_DEFAULTS[provider].label}. Press Enter to skip:`, mask: true });
                if (rawKey) {
                    const validated = validateApiKey(rawKey, provider);
                    if (!validated.valid) {
                        console.log(pc.red(`\n✗ ${validated.error}\n`));
                        process.exit(1);
                    }
                    updatedConfig.apiKeys = { ...config.apiKeys, [provider]: validated.key };
                }
            }
        }
    }
    if (provider === 'anthropic_proxy' && !config.anthropicProxyBaseUrl) {
        const baseUrl = await input({ message: 'Anthropic proxy base URL\n  Example: https://proxy.example.com', default: 'https://' });
        if (baseUrl) {
            updatedConfig.anthropicProxyBaseUrl = baseUrl.replace(/\/+$/, '');
        }
    }
    if (provider === 'openai_router' && !config.openaiRouterBaseUrl) {
        const baseUrl = await input({ message: 'OpenAI router base URL\n  Example: http://localhost:20128/v1', default: 'http://localhost:20128/v1' });
        if (baseUrl) {
            updatedConfig.openaiRouterBaseUrl = baseUrl.replace(/\/+$/, '');
        }
    }
    updateSettings(updatedConfig);
    return { config: updatedConfig, changed: true };
}
// ── Command execution ────────────────────────────────────
function isWindows() {
    return process.platform === 'win32';
}
function resolveCommand(command) {
    if (!isWindows())
        return command;
    // Split command to get the base binary
    const parts = command.trim().split(/\s+/);
    if (parts.length === 0)
        return command;
    const bin = parts[0].toLowerCase();
    // Resolve common Windows commands that need .cmd extension
    const cmdMap = {
        npm: 'npm.cmd',
        npx: 'npx.cmd',
    };
    if (cmdMap[bin] && !bin.endsWith('.cmd') && !bin.endsWith('.exe')) {
        parts[0] = cmdMap[bin];
        return parts.join(' ');
    }
    return command;
}
function runCommandSync(command) {
    const resolved = resolveCommand(command);
    try {
        const stdout = execSync(resolved, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            cwd: resolve('.'),
            shell: isWindows() ? process.env.ComSpec || 'cmd.exe' : undefined,
        });
        return { stdout, stderr: '' };
    }
    catch (error) {
        const err = error;
        const stderr = err.stderr || '';
        if (isWindows() && (stderr.includes('is not recognized') || stderr.includes('not found') || (err.message?.includes('ENOENT')))) {
            throw new Error(`Command not found: "${command.split(/\s+/)[0]}".\n  On Windows, try running this manually in PowerShell:\n  ${command}`);
        }
        throw error;
    }
}
// ── Tool call handler ────────────────────────────────────
async function handleToolCall(toolCall, yolo = false, debug = false) {
    const { type } = toolCall;
    const params = normalizeToolParams(toolCall.params);
    switch (type) {
        case 'read_file': {
            const filePath = params.filePath;
            if (!filePath)
                return 'Error: missing filePath parameter';
            const spinner = new Spinner();
            spinner.start('Searching...');
            const pathsToTry = resolveFileReadPath(filePath);
            let foundPath = '';
            let content = null;
            for (const tryPath of pathsToTry) {
                content = readFile(tryPath);
                if (content !== null) {
                    foundPath = tryPath;
                    break;
                }
            }
            if (content === null) {
                spinner.fail(`ERR  File not found: ${filePath}`);
                return `Error: file not found: ${filePath}`;
            }
            const secrets = detectSecrets(content);
            if (secrets.length > 0) {
                spinner.fail(`ERR  ${secrets.length} potential secret(s) detected in ${foundPath}!`);
                return `Blocked: ${foundPath} contains potential secrets.`;
            }
            if (foundPath !== filePath) {
                spinner.succeed(`OK   Read ${foundPath} (auto-resolved)`);
            }
            else {
                spinner.succeed(`OK   Read ${filePath} (${content.split('\n').length} lines)`);
            }
            addRecentFile(foundPath);
            return `Content of ${foundPath}:\n\`\`\`\n${content}\n\`\`\``;
        }
        case 'edit_file': {
            const filePath = params.filePath;
            const newContent = params.newContent;
            if (!filePath || !newContent)
                return 'Error: missing filePath or newContent parameter';
            // Absolute .env and protected file protection (applies in ALL modes, including YOLO)
            if (isProtectedFilePath(filePath)) {
                if (debug)
                    console.log(pc.dim(`  [debug] blocked protected file edit: ${filePath}`));
                return PROTECTED_FILE_MESSAGE;
            }
            // Block edits to generated output (dist, build, etc.) unless YOLO
            if (isGeneratedOutput(filePath) && !yolo) {
                return `Edit blocked: ${filePath} is in a generated output directory (dist, build, etc.). To edit generated files enable YOLO mode.`;
            }
            const spinner = new Spinner();
            spinner.start(`EDIT ${filePath}`);
            const diff = previewEdit(filePath, newContent);
            if (diff === null) {
                spinner.succeed('OK   No changes needed');
                return `No changes needed for ${filePath}`;
            }
            spinner.stop();
            console.log(`\nProposed edit: ${filePath}`);
            console.log(formatDiff(diff));
            if (yolo) {
                writeFileWithBackup(filePath, newContent);
                invalidateCache();
                console.log(`OK   Applied edit to ${filePath}\n`);
                addEdit({ file: filePath, timestamp: new Date().toISOString(), summary: `Edited ${filePath}` });
                return `Edit applied successfully to ${filePath}`;
            }
            const approved = await confirm({ message: 'Apply this edit?', default: true });
            if (!approved) {
                console.log(`ERR  Edit rejected`);
                return `Edit rejected by user for ${filePath}`;
            }
            writeFileWithBackup(filePath, newContent);
            invalidateCache();
            console.log(`OK   Applied edit to ${filePath}\n`);
            addEdit({ file: filePath, timestamp: new Date().toISOString(), summary: `Edited ${filePath}` });
            return `Edit applied successfully to ${filePath}`;
        }
        case 'execute_command': {
            const command = params.command;
            if (!command)
                return 'Error: missing command parameter';
            const safety = classifyCommand(command);
            console.log(`\nRUN   ${command}`);
            if (safety === 'dangerous') {
                console.log('  WARN: Dangerous command detected');
                const approved = await confirm({ message: 'Are you SURE you want to run this?', default: false });
                if (!approved) {
                    console.log('ERR  Command rejected (dangerous)\n');
                    return `Blocked: dangerous command rejected by user: ${command}`;
                }
                console.log('  Running dangerous command...\n');
            }
            else if (yolo && safety === 'safe') {
                console.log('  YOLO: Running safe command...\n');
            }
            else if (yolo && safety === 'caution') {
                console.log('  Caution command detected.');
                const approved = await confirm({ message: 'Run this command?', default: true });
                if (!approved) {
                    console.log('ERR  Command rejected\n');
                    return `Command execution rejected by user: ${command}`;
                }
            }
            else {
                const approved = await confirm({ message: 'Run this command?', default: safety === 'safe' });
                if (!approved) {
                    console.log('ERR  Command rejected');
                    return `Command execution rejected by user: ${command}`;
                }
            }
            const spinner = new Spinner();
            spinner.start('RUN   (running...)');
            try {
                const result = runCommandSync(command);
                spinner.succeed('OK    Command completed');
                if (result.stdout.trim()) {
                    console.log(result.stdout);
                }
                return `Command executed successfully:\n${result.stdout}`;
            }
            catch (error) {
                const err = error;
                spinner.fail('ERR   Command failed');
                const msg = err.message || 'Unknown error';
                console.log(msg);
                return `Command failed:\n${msg}`;
            }
        }
        case 'list_symbols': {
            const filePath = params.filePath;
            if (!filePath)
                return 'Error: missing filePath parameter';
            const spinner = new Spinner();
            spinner.start(`SYMS ${filePath}`);
            const symbols = listSymbols(filePath);
            if (symbols.length === 0) {
                spinner.fail('ERR  No symbols found');
                return `No symbols found in ${filePath}`;
            }
            spinner.succeed(`OK   Found ${symbols.length} symbols`);
            const result = symbols.map(s => `  ${s.type} ${s.name} (line ${s.line})`).join('\n');
            return `Symbols in ${filePath}:\n${result}`;
        }
        case 'find_references': {
            const symbol = params.symbol;
            if (!symbol)
                return 'Error: missing symbol parameter';
            const spinner = new Spinner();
            spinner.start(`REFS ${symbol}`);
            const refs = findReferences(resolve('.'), symbol);
            if (refs.length === 0) {
                spinner.fail('ERR  No references found');
                return `No references found for "${symbol}"`;
            }
            spinner.succeed(`OK   Found ${refs.length} references`);
            const result = refs.slice(0, 20).map(r => `  ${r.file}:${r.line}  ${r.content}`).join('\n');
            const extra = refs.length > 20 ? `\n  ... and ${refs.length - 20} more` : '';
            return `References to "${symbol}":\n${result}${extra}`;
        }
        case 'search_imports': {
            const mod = params.module;
            if (!mod)
                return 'Error: missing module parameter';
            const spinner = new Spinner();
            spinner.start(`📦 Searching imports: ${mod}`);
            const imports = searchImports(resolve('.'), mod);
            if (imports.length === 0) {
                spinner.fail('No imports found');
                return `No imports found for "${mod}"`;
            }
            spinner.succeed(`Found ${imports.length} imports`);
            const result = imports.map(r => `  ${r.file}:${r.line}  ${r.content}`).join('\n');
            return `Files importing "${mod}":\n${result}`;
        }
        case 'summarize_file': {
            const filePath = params.filePath;
            if (!filePath)
                return 'Error: missing filePath parameter';
            const spinner = new Spinner();
            spinner.start(`📋 Summarizing: ${filePath}`);
            const summary = summarizeFile(filePath);
            if (summary.startsWith('File not found')) {
                spinner.fail('File not found');
                return summary;
            }
            spinner.succeed('Summary complete');
            return summary;
        }
        case 'explain_function': {
            const filePath = params.filePath;
            const functionName = params.functionName;
            if (!filePath || !functionName)
                return 'Error: missing filePath or functionName parameter';
            const spinner = new Spinner();
            spinner.start(`📖 Explaining: ${functionName} in ${filePath}`);
            const explanation = explainFunction(filePath, functionName);
            if (explanation.includes('not found')) {
                spinner.fail('Function not found');
                return explanation;
            }
            spinner.succeed('Function found');
            return explanation;
        }
        default:
            return `Unknown tool type: ${type}`;
    }
}
// ── Chat loop ────────────────────────────────────────────
let thinkingPromise = null;
let cancelThinking = null;
let thinkingCancelled = false;
let inPrompt = false;
// Regex patterns for app title tasks
const APP_TITLE_RE = /change\s+(the\s+)?app\s+(title|name)|update\s+(the\s+)?title|rename\s+(the\s+)?app/i;
const NEW_TITLE_RE = /\b(?:to|as)\s+["']?(.+?)["']?\s*$/i;
function extractReadFilePath(results) {
    for (const r of results) {
        const m = r.match(/^(?:OK\s+)?Read\s+(.+?)(?:\s+\(|\s*$)/im) || r.match(/^Content of\s+(.+?):/);
        if (m)
            return m[1].trim();
    }
    return null;
}
process.on('SIGINT', () => {
    if (cancelThinking) {
        thinkingCancelled = true;
        cancelThinking();
        cancelThinking = null;
        thinkingPromise = null;
    }
    else if (!inPrompt) {
        process.exit(0);
    }
});
// ── Pending edit detection ──────────────────────────────
function detectPendingEdit(aiMsg, projectInfo) {
    if (!aiMsg)
        return null;
    const editKeywords = /\b(edit|update|replace|change|modify|write|create|add)\b/i;
    if (!editKeywords.test(aiMsg))
        return null;
    const blocks = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let m;
    while ((m = codeBlockRegex.exec(aiMsg)) !== null) {
        const content = m[2].trim();
        if (content.length > 20 && !content.includes('<tool_call>')) {
            blocks.push({ content, index: m.index });
        }
    }
    if (blocks.length === 0)
        return null;
    const mainBlock = blocks.reduce((a, b) => a.content.length > b.content.length ? a : b);
    const beforeBlock = aiMsg.substring(0, mainBlock.index);
    const fileMentions = beforeBlock.match(/(\b[\w/\\ .-]+\.\w{1,4}\b)/g);
    const codeFileExts = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rs|go|java|cpp|c|h|hpp|cs|swift|kt|rb|php|vue|svelte|css|scss|less|html|shtml|json|yaml|yml|toml|sh|bash|zsh|fish|ps1|sql|graphql|prisma)$/i;
    if (fileMentions) {
        const codeFiles = fileMentions.filter(f => codeFileExts.test(f));
        if (codeFiles.length > 0) {
            return { filePath: codeFiles[codeFiles.length - 1], content: mainBlock.content };
        }
    }
    if (projectInfo.fileCount <= 2 && projectInfo.entryPoints.length > 0) {
        for (const ep of projectInfo.entryPoints) {
            if (aiMsg.toLowerCase().includes(ep.toLowerCase())) {
                return { filePath: ep, content: mainBlock.content };
            }
        }
        return { filePath: projectInfo.entryPoints[0], content: mainBlock.content };
    }
    return null;
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
function formatRemaining(ms) {
    if (ms <= 0)
        return 'expired';
    const sec = Math.ceil(ms / 1000);
    if (sec < 60)
        return `${sec}s`;
    return `${Math.ceil(sec / 60)}m`;
}
async function getOllamaModelsForStatus(config) {
    if (!config?.ollamaBaseUrl)
        return [];
    try {
        return await listOllamaModels(config.ollamaBaseUrl, 1500);
    }
    catch {
        return [];
    }
}
async function printFallbackStatus(config) {
    const lastErr = getLastError();
    const lastFb = getLastFallbackUsed();
    const rateLimited = getRateLimitedModels();
    const cooldownModels = getModelsInCooldown();
    const providerCooldowns = getProviderCooldowns();
    const fallbackEvents = getFallbackEvents().slice(-8);
    const ollamaModels = await getOllamaModelsForStatus(config);
    const localFallbackEnabled = config ? isLocalFallbackEnabled(config) : false;
    const runtimeModels = config ? { ollama: ollamaModels } : undefined;
    const fallbackProviders = config ? getAvailableFallbackProviders(config, runtimeModels) : [];
    console.log(pc.bold(pc.magenta('\nFallback Status\n')));
    if (config) {
        console.log(`  Current provider: ${PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider}`);
        console.log(`  Current model:    ${config.currentModel}`);
    }
    else {
        console.log(`  Current provider: not configured`);
        console.log(`  Current model:    not configured`);
    }
    console.log(`  Local fallback:   ${localFallbackEnabled ? 'enabled' : 'disabled'}`);
    if (!localFallbackEnabled) {
        console.log(`  To enable:        set HYSA_ENABLE_LOCAL_FALLBACK=true`);
    }
    console.log(`  Last fallback:    ${lastFb || 'None'}`);
    if (lastErr) {
        console.log(`  Last chat error:  ${lastErr.provider}/${lastErr.model} - ${lastErr.category}`);
        console.log(`                    ${lastErr.reason.slice(0, 220)}`);
        console.log(`                    ${new Date(lastErr.timestamp).toLocaleString()}`);
    }
    else {
        console.log(`  Last chat error:  None`);
    }
    console.log(`\n  Rate-limited models:`);
    if (rateLimited.length === 0) {
        console.log(pc.dim('    None recorded'));
    }
    else {
        for (const entry of rateLimited.slice(0, 12)) {
            console.log(`    ${entry.provider}/${entry.model} (${entry.failedCount}x)`);
        }
    }
    console.log(`\n  Models in cooldown:`);
    if (cooldownModels.length === 0 && providerCooldowns.length === 0) {
        console.log(pc.dim('    None'));
    }
    else {
        for (const cd of providerCooldowns) {
            console.log(`    ${cd.provider} provider cooldown - ${formatRemaining(cd.remainingMs)} (${cd.reason})`);
        }
        for (const cd of cooldownModels.slice(0, 12)) {
            console.log(`    ${cd.provider}/${cd.model} - ${formatRemaining(cd.remainingMs)} (${cd.category})`);
        }
    }
    console.log(`\n  Available fallback providers:`);
    if (fallbackProviders.length === 0) {
        console.log(pc.dim('    None currently usable'));
    }
    else {
        for (const fb of fallbackProviders.slice(0, 6)) {
            const label = PROVIDER_DEFAULTS[fb.provider]?.label || fb.provider;
            const models = fb.usableModels.slice(0, 3).join(', ');
            console.log(`    ${label}${models ? ` - ${models}` : ''}`);
        }
    }
    if (ollamaModels.length > 0) {
        console.log(`\n  Ollama local models (informational): ${ollamaModels.slice(0, 6).join(', ')}${ollamaModels.length > 6 ? '...' : ''}`);
    }
    else if (config?.ollamaBaseUrl) {
        console.log(`\n  Ollama local models (informational): not running or no models found`);
    }
    const recommended = lastErr?.provider === 'ollama'
        ? 'Ollama is reachable, but the last local model failed. Pull or select a chat-capable coding model, for example: ollama pull qwen2.5-coder:1.5b.'
        : config
            ? getSuggestedFallbackAction(lastErr?.provider || config.currentProvider, config, lastErr?.reason, runtimeModels)
            : 'Run hysa config to set up a provider.';
    console.log(`\n  Recommended action: ${recommended}`);
    if (fallbackEvents.length > 0) {
        console.log(pc.dim('\n  Recent fallback events:'));
        for (const event of fallbackEvents) {
            console.log(pc.dim(`    ${event.provider}${event.model ? `/${event.model}` : ''}: ${event.reason}`));
        }
    }
    console.log();
}
async function chatLoop(initialConfig, initialYolo = false) {
    let config = initialConfig;
    let yoloMode = initialYolo;
    let client;
    try {
        client = createClient(config);
    }
    catch (err) {
        const e = err;
        console.log(pc.red(`Error: ${e.message}`));
        return;
    }
    const workingDir = resolve('.');
    const projectInfo = getProjectInfo(workingDir);
    const gitInfo = getGitInfo(workingDir);
    incrementSessionCount();
    // Load persistent provider health from session
    const savedHealth = getProviderHealth();
    if (savedHealth.length > 0) {
        loadHealthFromEntries(savedHealth);
    }
    // Build relevant files from important project files
    const relevantFiles = projectInfo.importantFiles;
    // Pre-read README for extra context if available
    let readmeContent = '';
    const readmePath = relevantFiles.find(f => f.toLowerCase() === 'readme.md');
    if (readmePath) {
        const content = readFile(readmePath);
        if (content) {
            readmeContent = content.slice(0, 2000);
        }
    }
    const messages = [];
    let previousUserMessage = null;
    const tokenEstimate = estimateTokens(projectInfo.tree) + estimateTokens(readmeContent);
    // Agent mode tracking
    let currentAgentMode = config.agentMode || 'chat';
    let currentTask = getActiveTask();
    let pendingEdit = null;
    let pendingAppTitle = null;
    showHeader(config, gitInfo, tokenEstimate, currentAgentMode, yoloMode);
    console.log(pc.dim(`📁 ${projectInfo.type} project (${projectInfo.fileCount} files)`));
    if (gitInfo.branch) {
        const status = gitInfo.hasChanges ? pc.yellow('● modified') : pc.green('○ clean');
        console.log(pc.dim(`🌿 ${gitInfo.branch} ${status}`));
    }
    console.log();
    console.log(pc.cyan('  Type a message or use /help for commands.\n'));
    // Determine if light mode is active
    const isLocalProvider = LOCAL_FREE_PROVIDERS.includes(config.currentProvider);
    if (isLocalProvider && config.lightMode === undefined) {
        config.lightMode = true;
        updateSettings({ lightMode: true });
    }
    const lightActive = config.lightMode !== false && isLocalProvider;
    // Build the system prompt with project context and agent mode
    let systemPrompt = buildSystemPrompt({
        type: projectInfo.type,
        entryPoints: projectInfo.entryPoints,
        configFiles: projectInfo.configFiles,
        fileCount: projectInfo.fileCount,
        tree: projectInfo.tree.length < 3000 ? projectInfo.tree : projectInfo.tree.slice(0, 3000) + '\n... (truncated)',
    }, currentAgentMode, lightActive, config.currentProvider, config.promptMode || 'auto');
    // ── Brain context injection (compact, max 800 tokens) ──
    let brainContext = '';
    try {
        const pm = await readProjectMap();
        if (pm) {
            const sysStr = pm.knownSystems.length > 0 ? `Known systems: ${pm.knownSystems.join(', ')}` : '';
            const modStr = Object.keys(pm.modules).length > 0
                ? `Modules: ${Object.entries(pm.modules).map(([k, v]) => `${k} (${v.files.length} files, ${v.purpose.slice(0, 40)})`).join('; ')}`
                : '';
            const cmdStr = Object.keys(pm.commands).length > 0
                ? `Commands: ${Object.keys(pm.commands).join(', ')}`
                : '';
            const parts = [sysStr, modStr, cmdStr].filter(Boolean);
            if (parts.length > 0) {
                brainContext = `\n[Project Memory]\n${parts.join('\n')}\n`;
                if (brainContext.length > 3200)
                    brainContext = brainContext.slice(0, 3200) + '\n...(truncated)';
                systemPrompt += brainContext;
            }
        }
    }
    catch { /* brain not available — skip */ }
    let retryContent = null;
    while (true) {
        let userInput;
        try {
            inPrompt = true;
            userInput = retryContent ? retryContent : await input({ message: pc.magenta('❯') });
        }
        catch {
            inPrompt = false;
            console.log(pc.yellow('\nGoodbye!\n'));
            break;
        }
        finally {
            inPrompt = false;
        }
        retryContent = null;
        // ── Strong pre-request casual guard ──────────────
        const trimmed = userInput.trim();
        if (!trimmed.startsWith('/') && isOnlyGreeting(trimmed)) {
            const casual = getCasualResponse(trimmed);
            if (config.debug) {
                console.log(pc.dim(`  [debug] local casual guard: skipped provider request`));
            }
            if (casual) {
                console.log(pc.cyan(`  ${casual}\n`));
            }
            else {
                console.log(pc.cyan('  Hi! How can I help with this project?\n'));
            }
            continue;
        }
        // ── Built-in commands ────────────────────────────
        if (trimmed.toLowerCase() === '/exit') {
            console.log(pc.yellow('\nGoodbye!\n'));
            break;
        }
        if (trimmed.toLowerCase() === '/help') {
            showHelp(currentAgentMode);
            continue;
        }
        if (trimmed.toLowerCase() === '/new') {
            messages.length = 0;
            console.log(pc.green('✓ Conversation history cleared\n'));
            continue;
        }
        if (trimmed.toLowerCase() === '/tree') {
            console.log(pc.dim(projectInfo.tree));
            continue;
        }
        if (trimmed.toLowerCase() === '/mode') {
            const mode = await select({
                message: 'Select agent mode:',
                choices: ALL_MODES.map(m => ({
                    name: `${MODE_LABELS[m]} - ${MODE_DESCRIPTIONS[m].slice(0, 60)}...`,
                    value: m,
                })),
            });
            currentAgentMode = mode;
            updateAgentMode(mode);
            const modeLightActive = config.lightMode !== false && LOCAL_FREE_PROVIDERS.includes(config.currentProvider);
            systemPrompt = buildSystemPrompt({
                type: projectInfo.type,
                entryPoints: projectInfo.entryPoints,
                configFiles: projectInfo.configFiles,
                fileCount: projectInfo.fileCount,
            }, currentAgentMode, modeLightActive, config.currentProvider, config.promptMode || 'auto');
            if (mode !== 'chat') {
                currentTask = createTask(`Session in ${mode} mode`, mode);
            }
            showHeader(config, gitInfo, estimateTokens(messages.reduce((sum, m) => sum + m.content, '')), currentAgentMode, yoloMode);
            console.log(pc.green(`✓ Switched to ${MODE_LABELS[mode]} mode\n`));
            continue;
        }
        if (trimmed.toLowerCase() === '/model') {
            const result = await switchModel(config);
            config = result.config;
            client = createClient(config);
            const modelLightActive = config.lightMode !== false && LOCAL_FREE_PROVIDERS.includes(config.currentProvider);
            systemPrompt = buildSystemPrompt({
                type: projectInfo.type,
                entryPoints: projectInfo.entryPoints,
                configFiles: projectInfo.configFiles,
                fileCount: projectInfo.fileCount,
            }, currentAgentMode, modelLightActive, config.currentProvider, config.promptMode || 'auto');
            const newTokenEstimate = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
            showHeader(config, gitInfo, newTokenEstimate, currentAgentMode, yoloMode);
            console.log(pc.green(`✓ Switched to ${PROVIDER_DEFAULTS[config.currentProvider].label} (${config.currentModel})\n`));
            continue;
        }
        if (trimmed.toLowerCase() === '/agents') {
            console.log(pc.cyan('\nAgent Status:'));
            console.log(`  Mode: ${MODE_LABELS[currentAgentMode]}`);
            if (currentTask) {
                console.log(`  Task: ${currentTask.description} (${currentTask.status})`);
                console.log(`  Steps: ${currentTask.steps.length}`);
            }
            else {
                console.log(pc.dim('  No active task'));
            }
            console.log();
            continue;
        }
        if (trimmed.toLowerCase() === '/health') {
            console.log(pc.cyan('\nProvider Health:'));
            const prov = config.currentProvider;
            const label = PROVIDER_DEFAULTS[prov]?.label || prov;
            const tier = PROVIDER_TIERS[prov];
            const tierLabel = TIER_LABELS[tier];
            const hasKey = prov === 'ollama' || prov === 'local_openai' || !!config.apiKeys[prov];
            console.log(`  Provider: ${pc.bold(label)}`);
            console.log(`  Model:    ${config.currentModel}`);
            console.log(`  Tier:     ${tierLabel.icon} ${tierLabel.label}`);
            console.log(`  Key:      ${hasKey ? pc.green('✓ set') : pc.red('not set')}`);
            if (prov === 'ollama')
                console.log(`  URL:      ${config.ollamaBaseUrl}`);
            if (prov === 'local_openai')
                console.log(`  URL:      ${config.localOpenAiBaseUrl || 'http://localhost:1234/v1'}`);
            console.log();
            continue;
        }
        // ── Fallback commands ────────────────────────────
        if (trimmed.toLowerCase() === '/fallback status') {
            await printFallbackStatus(config);
            continue;
            const summary = toHealthSummary();
            const lastErr = getLastError();
            const lastFb = getLastFallbackUsed();
            console.log(pc.cyan('\nFallback Status:'));
            if (summary.length === 0) {
                console.log(pc.green('  All providers healthy.\n'));
            }
            else {
                console.log(pc.yellow('  Unhealthy providers/models:'));
                for (const line of summary)
                    console.log(line);
                console.log();
            }
            if (lastErr) {
                console.log(pc.dim(`  Last error: ${lastErr.provider}/${lastErr.model} — ${lastErr.reason.slice(0, 200)}`));
                console.log(pc.dim(`  Time: ${new Date(lastErr.timestamp).toLocaleString()}`));
            }
            if (lastFb) {
                console.log(pc.dim(`  Last fallback used: ${lastFb}`));
            }
            console.log(pc.dim('  Provider rate limits may depend on RPM/TPM/daily quota and are not the same as context tokens.\n'));
            continue;
        }
        if (trimmed.toLowerCase() === '/fallback reset') {
            resetHealth();
            clearProviderHealth();
            console.log(pc.green('  Provider health records cleared. All providers will be retried.\n'));
            continue;
        }
        if (trimmed.toLowerCase() === '/fallback test') {
            console.log(pc.cyan('\nTesting configured providers...\n'));
            const testProviders = ['openrouter', 'gemini', 'deepseek', 'groq', 'opencode_zen', 'anthropic_proxy', 'openai_router'];
            for (const prov of testProviders) {
                if (prov === 'anthropic_proxy' && !config.anthropicProxyBaseUrl) {
                    console.log(`  ${pc.dim(`[skip] Anthropic Proxy: no base URL configured`)}`);
                    continue;
                }
                if (prov === 'openai_router' && !config.openaiRouterBaseUrl) {
                    console.log(`  ${pc.dim(`[skip] OpenAI Router: no base URL configured`)}`);
                    continue;
                }
                const key = config.apiKeys[prov];
                if (!key && !providerHasOptionalApiKey(prov)) {
                    console.log(`  ${pc.dim(`[skip] ${PROVIDER_DEFAULTS[prov]?.label || prov}: no API key`)}`);
                    continue;
                }
                const label = PROVIDER_DEFAULTS[prov]?.label || prov;
                const model = config.currentProvider === prov ? config.currentModel : PROVIDER_DEFAULTS[prov]?.model || '';
                process.stdout.write(`  ${label} (${model || 'default'})... `);
                try {
                    const testClient = createSingleClient(prov, model || 'test', config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel, config);
                    if (!testClient) {
                        console.log(pc.red('✗ could not create client'));
                        continue;
                    }
                    // Just check if the client was creatable - we can't easily do a lightweight ping
                    console.log(pc.green('✓ client created'));
                }
                catch (err) {
                    console.log(pc.red(`✗ ${err.message.slice(0, 80)}`));
                }
            }
            console.log(pc.dim('\n  Note: This only checks if clients can be created. Actual availability depends on network and provider status.\n'));
            continue;
        }
        // Fallback shorthand aliases
        const fbTrim = trimmed.toLowerCase();
        if (fbTrim === '/fallback') {
            await printFallbackStatus(config);
            continue;
            // Show status as default
            const summary = toHealthSummary();
            console.log(pc.cyan('\nFallback Status:'));
            if (summary.length === 0) {
                console.log(pc.green('  All providers healthy.'));
            }
            else {
                console.log(pc.yellow('  Unhealthy providers/models:'));
                for (const line of summary)
                    console.log(line);
            }
            console.log(pc.dim('  Use /fallback status, /fallback reset, /fallback test for details.\n'));
            continue;
        }
        if (trimmed.toLowerCase() === '/providers') {
            console.log(pc.cyan('\nAvailable Providers:\n'));
            const allProviders = ['opencode_zen', 'openrouter', 'groq', 'deepseek', 'gemini', 'ollama', 'local_openai', 'hysa_ai', 'anthropic', 'openai', 'anthropic_proxy', 'openai_router'];
            if (config.allowExperimentalProviders) {
                allProviders.push('pollinations', 'llm7', 'puter');
            }
            for (const p of allProviders) {
                const label = PROVIDER_DEFAULTS[p]?.label || p;
                const tier = PROVIDER_TIERS[p];
                const tierLabel = TIER_LABELS[tier];
                const hasKey = p === 'ollama' || p === 'local_openai' || !!config.apiKeys[p];
                const isCurrent = p === config.currentProvider;
                const marker = isCurrent ? pc.green(' ★') : '';
                const keyStatus = hasKey ? pc.green('✓') : pc.red('✗');
                const experimental = tier === 'experimental_free' ? pc.dim(' 🧪') : '';
                console.log(`  ${tierLabel.icon} ${pc.bold(label.padEnd(24))} ${tierLabel.label.padEnd(18)} key: ${keyStatus}${marker}${experimental}`);
            }
            console.log();
            if (!config.allowExperimentalProviders) {
                console.log(pc.dim('  Experimental providers hidden. Enable with: hysa experimental on\n'));
            }
            continue;
        }
        if (trimmed.toLowerCase() === '/usage') {
            const lastErr = getLastError();
            const lastFb = getLastFallbackUsed();
            const tokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
            const prov = config.currentProvider;
            const label = PROVIDER_DEFAULTS[prov]?.label || prov;
            console.log(pc.cyan('\nUsage Information:'));
            console.log(`  Current provider: ${pc.bold(label)}`);
            console.log(`  Current model:    ${config.currentModel}`);
            console.log(`  Context estimate: ~${tokens.toLocaleString()} tokens`);
            if (lastErr) {
                console.log(`  Last error:       ${pc.red(lastErr.provider + '/' + lastErr.model)} — ${lastErr.reason.slice(0, 120)}`);
            }
            else {
                console.log(pc.dim(`  Last error:       none`));
            }
            if (lastFb) {
                console.log(pc.dim(`  Last fallback:    ${lastFb}`));
            }
            else {
                console.log(pc.dim(`  Last fallback:    none`));
            }
            console.log();
            console.log(pc.yellow('  Note: Provider rate limits may depend on RPM/TPM/daily quota'));
            console.log(pc.yellow('  and are not the same as your local context token estimate.\n'));
            continue;
        }
        if (trimmed.toLowerCase() === '/models') {
            if (config.currentProvider === 'ollama') {
                const modSpin = new Spinner();
                modSpin.start('Fetching Ollama local models...');
                try {
                    const models = await listOllamaModels(config.ollamaBaseUrl);
                    modSpin.succeed(`Found ${models.length} local model${models.length !== 1 ? 's' : ''}`);
                    console.log();
                    for (const model of models)
                        console.log(`  ${model}`);
                    console.log();
                }
                catch (err) {
                    modSpin.fail('Failed');
                    console.log(pc.red(`  ${err.message}\n`));
                }
                continue;
            }
            if (config.currentProvider !== 'openrouter') {
                console.log(pc.yellow('\n  /models is only available when using OpenRouter.\n'));
                continue;
            }
            if (!config.apiKeys.openrouter) {
                console.log(pc.red('\n  OpenRouter API key not configured.\n'));
                continue;
            }
            const modSpin = new Spinner();
            modSpin.start('Fetching OpenRouter free models...');
            try {
                const models = await fetchOpenRouterModels(config.apiKeys.openrouter);
                const free = filterFreeModels(models);
                modSpin.succeed(`Found ${free.length} free models`);
                console.log();
                const table = formatModelsTable(models, true);
                console.log(table);
                console.log(pc.dim('\n  Tip: Use /model to switch to a specific free model.\n'));
            }
            catch (err) {
                modSpin.fail('Failed');
                console.log(pc.red(`  ${err.message}\n`));
            }
            continue;
        }
        if (trimmed.toLowerCase() === '/debug' || trimmed.toLowerCase() === '/debug toggle') {
            config.debug = !config.debug;
            updateSettings({ debug: config.debug });
            console.log(pc.green(`\n  Debug mode: ${config.debug ? 'ON' : 'OFF'}\n`));
            continue;
        }
        if (trimmed.toLowerCase() === '/debug on') {
            config.debug = true;
            updateSettings({ debug: true });
            console.log(pc.green('\n  Debug mode: ON\n'));
            console.log(pc.dim('  Prompt size and timing info will be shown for each request.\n'));
            continue;
        }
        if (trimmed.toLowerCase() === '/debug off') {
            config.debug = false;
            updateSettings({ debug: false });
            console.log(pc.green('  Debug mode: OFF\n'));
            continue;
        }
        if (trimmed.toLowerCase() === '/debug status') {
            const statusTag = config.debug ? pc.yellow('ON') : pc.green('OFF');
            console.log(pc.cyan(`\n  Debug mode: ${statusTag}`));
            if (config.debug) {
                console.log(pc.dim('  Context build time, token estimates, and request duration are shown.'));
            }
            else {
                console.log(pc.dim('  Use /debug on to see prompt size and timing information.\n'));
            }
            continue;
        }
        if (trimmed.toLowerCase() === '/experimental') {
            config.allowExperimentalProviders = !config.allowExperimentalProviders;
            config.experimentalConfirmed = false;
            updateSettings({ allowExperimentalProviders: config.allowExperimentalProviders });
            if (config.allowExperimentalProviders) {
                console.log(pc.yellow('\n  🧪 Experimental free providers enabled.\n'));
                console.log(pc.yellow('  These providers may log prompts, rate-limit, disappear, or change behavior.'));
                console.log(pc.yellow('  Do not send sensitive code to experimental providers.\n'));
            }
            else {
                console.log(pc.green('  Experimental free providers disabled.\n'));
            }
            continue;
        }
        if (trimmed.toLowerCase() === '/retry') {
            if (messages.length === 0) {
                console.log(pc.yellow('  No messages to retry.\n'));
                continue;
            }
            const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user');
            if (lastUserIdx === -1) {
                console.log(pc.yellow('  No user message to retry.\n'));
                continue;
            }
            const lastUserMsg = [...messages].reverse()[lastUserIdx];
            messages.splice(messages.length - 1 - lastUserIdx, lastUserIdx + 1);
            retryContent = lastUserMsg.content;
            console.log(pc.dim('  Retrying last message...\n'));
            continue;
        }
        if (trimmed.toLowerCase() === '/diff') {
            try {
                const diffOut = execSync('git diff', { encoding: 'utf-8', cwd: workingDir });
                if (diffOut.trim()) {
                    console.log(pc.cyan('\nGit diff:'));
                    console.log(formatDiff(diffOut));
                }
                else {
                    console.log(pc.yellow('  No changes to show.\n'));
                }
            }
            catch {
                console.log(pc.red('  Not a git repository or git not available.\n'));
            }
            continue;
        }
        if (trimmed.toLowerCase().startsWith('/commit ')) {
            const msg = trimmed.slice(8).trim();
            if (!msg) {
                console.log(pc.red('Usage: /commit <message>\n'));
                continue;
            }
            try {
                execSync(`git add -A`, { encoding: 'utf-8', cwd: workingDir });
                execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { encoding: 'utf-8', cwd: workingDir });
                console.log(pc.green(`✓ Committed: ${msg}\n`));
            }
            catch (err) {
                const e = err;
                console.log(pc.red(`  Commit failed: ${e.stderr || e.message || 'Unknown error'}\n`));
            }
            continue;
        }
        if (trimmed.startsWith('/search ')) {
            const pattern = trimmed.slice(8).trim();
            if (!pattern) {
                console.log(pc.red('Usage: /search <pattern>\n'));
                continue;
            }
            const results = grepSearch(workingDir, pattern);
            showSearchResults(results);
            continue;
        }
        if (trimmed.startsWith('/find ')) {
            const filename = trimmed.slice(6).trim();
            if (!filename) {
                console.log(pc.red('Usage: /find <filename>\n'));
                continue;
            }
            const results = findFiles(workingDir, filename);
            showFindResults(results);
            continue;
        }
        if (trimmed.startsWith('/read ')) {
            const filePath = trimmed.slice(6).trim();
            const content = readFile(filePath);
            if (content === null) {
                console.log(pc.red(`File not found: ${filePath}`));
            }
            else {
                const lines = content.split('\n');
                const maxLines = Math.min(lines.length, 80);
                console.log(pc.cyan(`\n${filePath} (${lines.length} lines):\n`));
                for (let i = 0; i < maxLines; i++) {
                    const lineNum = `${i + 1}`.padStart(4, ' ');
                    console.log(`${pc.dim(lineNum)} ${lines[i]}`);
                }
                if (lines.length > maxLines) {
                    console.log(pc.dim(`... ${lines.length - maxLines} more lines`));
                }
                console.log();
            }
            continue;
        }
        if (trimmed.startsWith('/run ')) {
            const command = trimmed.slice(5).trim();
            if (!command) {
                console.log(pc.red('Usage: /run <command>\n'));
                continue;
            }
            console.log(`\n$ ${command}`);
            const approved = await confirm({ message: 'Run this command?', default: false });
            if (!approved) {
                console.log('ERR  Rejected\n');
                continue;
            }
            const spinner = new Spinner();
            spinner.start('RUN   (running...)');
            try {
                const result = runCommandSync(command);
                spinner.succeed('OK    Done');
                if (result.stdout.trim()) {
                    console.log(result.stdout);
                }
            }
            catch (error) {
                const err = error;
                spinner.fail('ERR   Failed');
                console.log(err.message || 'Unknown error');
            }
            console.log();
            continue;
        }
        if (trimmed.toLowerCase() === '/pending') {
            if (!pendingEdit) {
                console.log(pc.yellow('  No pending edit.\n'));
            }
            else {
                const relPath = relative(workingDir, pendingEdit.filePath);
                console.log(pc.cyan(`\n📋 Pending edit for ${relPath}`));
                console.log(pc.dim(`  Plan: ${pendingEdit.plan.slice(0, 200)}`));
                console.log(pc.dim(`  Original: "${pendingEdit.userRequest}"`));
                console.log();
            }
            continue;
        }
        // ── Browser slash commands ─────────────────────
        if (trimmed.startsWith('/browser open ')) {
            const url = trimmed.slice(14).trim();
            if (!url) {
                console.log(pc.red('Usage: /browser open <url>\n'));
                continue;
            }
            const result = await browserOpen(url);
            console.log(`  ${result.ok ? pc.green('✓') : pc.red('✗')} ${result.message}\n`);
            continue;
        }
        if (trimmed === '/browser screenshot') {
            const result = await browserScreenshot();
            console.log(`  ${result.ok ? pc.green('✓') : pc.red('✗')} ${result.message}\n`);
            continue;
        }
        if (trimmed === '/browser text') {
            const result = await browserText();
            if (result.ok && result.text) {
                const lines = result.text.split('\n').filter(l => l.trim());
                console.log(`  ${pc.green('✓')} ${result.message}`);
                console.log(`  ${lines.slice(0, 20).join('\n  ')}`);
                if (lines.length > 20)
                    console.log(`  ... (${lines.length - 20} more lines)`);
                console.log();
            }
            else {
                console.log(`  ${result.ok ? pc.green('✓') : pc.red('✗')} ${result.message}\n`);
            }
            continue;
        }
        if (trimmed === '/browser snapshot') {
            const result = await browserSnapshot();
            if (result.ok && result.snapshot) {
                const lines = result.snapshot.split('\n').filter(l => l.trim());
                console.log(`  ${pc.green('✓')} ${result.message}`);
                console.log(`  ${lines.slice(0, 30).join('\n  ')}`);
                if (lines.length > 30)
                    console.log(`  ... (${lines.length - 30} more lines)`);
                console.log();
            }
            else {
                console.log(`  ${result.ok ? pc.green('✓') : pc.red('✗')} ${result.message}\n`);
            }
            continue;
        }
        if (trimmed.startsWith('/browser click ')) {
            const target = trimmed.slice(15).trim();
            if (!target) {
                console.log(pc.red('Usage: /browser click <target>\n'));
                continue;
            }
            const result = await browserClick(target);
            console.log(`  ${result.ok ? pc.green('✓') : pc.red('✗')} ${result.message}\n`);
            continue;
        }
        if (trimmed.startsWith('/browser type ')) {
            const rest = trimmed.slice(14).trim();
            const spaceIdx = rest.indexOf(' ');
            if (spaceIdx < 0) {
                console.log(pc.red('Usage: /browser type <target> <value>\n'));
                continue;
            }
            const target = rest.slice(0, spaceIdx).trim();
            const value = rest.slice(spaceIdx + 1).trim();
            const result = await browserType(target, value);
            console.log(`  ${result.ok ? pc.green('✓') : pc.red('✗')} ${result.message}\n`);
            continue;
        }
        if (trimmed === '/browser status') {
            const status = await getBrowserStatus();
            const cfg = getBrowserConfig();
            console.log(`\n  Browser status:`);
            console.log(`    Active: ${status.active ? pc.green('yes') : pc.red('no')}`);
            if (status.active) {
                console.log(`    URL: ${status.url || '(none)'}`);
                console.log(`    Title: ${status.title || '(none)'}`);
                console.log(`    Engine: ${status.browser || '(unknown)'}`);
            }
            console.log(`    Headless: ${cfg.headless ? pc.green('true') : pc.yellow('false')}`);
            console.log(`    Timeout: ${cfg.timeoutMs}ms\n`);
            continue;
        }
        if (trimmed === '/browser close') {
            const result = await browserClose();
            console.log(`  ${result.ok ? pc.green('✓') : pc.red('✗')} ${result.message}\n`);
            continue;
        }
        // ── YOLO mode ──────────────────────────────────
        if (trimmed.toLowerCase() === '/yolo') {
            yoloMode = !yoloMode;
            setYolo(yoloMode);
            if (yoloMode) {
                console.log(pc.yellow('\n  ⚡ YOLO mode enabled.'));
                console.log(pc.yellow('  Edits will be applied automatically. Backups are still created.'));
                console.log(pc.yellow('  Dangerous commands still require confirmation.\n'));
            }
            else {
                console.log(pc.green('  YOLO mode disabled.\n'));
            }
            showHeader(config, gitInfo, estimateTokens(messages.reduce((sum, m) => sum + m.content, '')), currentAgentMode, yoloMode);
            continue;
        }
        if (trimmed.toLowerCase() === '/yolo on') {
            yoloMode = true;
            setYolo(true);
            console.log(pc.yellow('\n  ⚡ YOLO mode enabled.'));
            console.log(pc.yellow('  Edits will be applied automatically. Backups are still created.'));
            console.log(pc.yellow('  Dangerous commands still require confirmation.\n'));
            showHeader(config, gitInfo, estimateTokens(messages.reduce((sum, m) => sum + m.content, '')), currentAgentMode, yoloMode);
            continue;
        }
        if (trimmed.toLowerCase() === '/yolo off') {
            yoloMode = false;
            setYolo(false);
            console.log(pc.green('  YOLO mode disabled.\n'));
            showHeader(config, gitInfo, estimateTokens(messages.reduce((sum, m) => sum + m.content, '')), currentAgentMode, yoloMode);
            continue;
        }
        if (trimmed.toLowerCase() === '/yolo status') {
            const statusTag = yoloMode ? pc.yellow('ON') : pc.green('OFF');
            console.log(pc.cyan(`\n  YOLO mode: ${statusTag}`));
            if (yoloMode) {
                console.log(pc.dim('  Edits are applied automatically'));
                console.log(pc.dim('  Safe commands run without confirmation'));
                console.log(pc.dim('  Dangerous commands still require approval'));
                console.log(pc.dim('  Backups are still created before edits\n'));
            }
            else {
                console.log(pc.dim('  All edits and commands require approval\n'));
            }
            continue;
        }
        // ── Light mode commands ────────────────────────
        if (trimmed.toLowerCase() === '/light') {
            config.lightMode = !config.lightMode;
            updateSettings({ lightMode: config.lightMode });
            const statusTag = config.lightMode ? pc.yellow('ON') : pc.green('OFF');
            console.log(pc.cyan(`\n  Light mode: ${statusTag}`));
            if (config.lightMode) {
                console.log(pc.dim('  Short prompts, minimal context, fast responses for local models.'));
            }
            else {
                console.log(pc.dim('  Full context mode with rich system prompts.'));
            }
            showHeader(config, gitInfo, estimateTokens(messages.reduce((sum, m) => sum + m.content, '')), currentAgentMode, yoloMode);
            continue;
        }
        if (trimmed.toLowerCase() === '/light on') {
            config.lightMode = true;
            updateSettings({ lightMode: true });
            console.log(pc.yellow('\n  ⚡ Light mode enabled.'));
            console.log(pc.dim('  Short prompts, minimal context, fast responses for local models.\n'));
            showHeader(config, gitInfo, estimateTokens(messages.reduce((sum, m) => sum + m.content, '')), currentAgentMode, yoloMode);
            continue;
        }
        if (trimmed.toLowerCase() === '/light off') {
            config.lightMode = false;
            updateSettings({ lightMode: false });
            console.log(pc.green('  Light mode disabled.\n'));
            showHeader(config, gitInfo, estimateTokens(messages.reduce((sum, m) => sum + m.content, '')), currentAgentMode, yoloMode);
            continue;
        }
        if (trimmed.toLowerCase() === '/light status') {
            const isLocal = LOCAL_FREE_PROVIDERS.includes(config.currentProvider);
            const defaultLight = isLocal;
            const effectiveLight = config.lightMode !== undefined ? config.lightMode : defaultLight;
            const statusTag = effectiveLight ? pc.yellow('ON') : pc.green('OFF');
            const source = config.lightMode !== undefined ? '(configured)' : '(default for local provider)';
            console.log(pc.cyan(`\n  Light mode: ${statusTag} ${pc.dim(source)}`));
            console.log(pc.dim(`  Provider: ${PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider}`));
            if (effectiveLight) {
                console.log(pc.dim('  Short system prompt, minimal history, no full project context.'));
            }
            continue;
        }
        // ── Latency command ──────────────────────────────
        if (trimmed.toLowerCase() === '/latency') {
            console.log(pc.cyan('\n📊 Latency Test\n'));
            const provider = config.currentProvider;
            const model = config.currentModel;
            const label = PROVIDER_DEFAULTS[provider]?.label || provider;
            console.log(`  Provider: ${label}`);
            console.log(`  Model:    ${model}`);
            const usage = (await import('./utils/session.js')).getUsage();
            if (usage.lastRequestDuration) {
                console.log(`  Last request duration: ${usage.lastRequestDuration}ms`);
            }
            if (usage.lastError) {
                console.log(`  Last error: ${usage.lastError.slice(0, 100)}`);
            }
            // Test direct provider latency
            if (provider === 'hysa_ai' || provider === 'ollama' || provider === 'local_openai') {
                const baseUrl = provider === 'ollama' ? config.ollamaBaseUrl
                    : provider === 'hysa_ai' ? 'http://localhost:3002/v1'
                        : config.localOpenAiBaseUrl || 'http://localhost:1234/v1';
                // Test GET /models
                try {
                    const modelStart = Date.now();
                    const modelRes = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
                    const modelDur = Date.now() - modelStart;
                    if (modelRes.ok) {
                        console.log(`  GET /models: ${modelDur}ms ${pc.green('✓')}`);
                    }
                    else {
                        console.log(`  GET /models: ${modelDur}ms ${pc.yellow(`(${modelRes.status})`)}`);
                    }
                }
                catch {
                    console.log(`  GET /models: ${pc.red('failed')}`);
                }
                // Test POST /chat/completions with tiny prompt
                const testStart = Date.now();
                try {
                    const testBody = {
                        model,
                        max_tokens: 10,
                        messages: [
                            { role: 'system', content: 'You are a helpful assistant.' },
                            { role: 'user', content: 'say hi' },
                        ],
                    };
                    const chatRes = await fetch(`${baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(testBody),
                        signal: AbortSignal.timeout(10000),
                    });
                    const chatDur = Date.now() - testStart;
                    if (chatRes.ok) {
                        const data = await chatRes.json();
                        const reply = data.choices?.[0]?.message?.content || '';
                        console.log(`  POST /chat/completions "say hi": ${chatDur}ms ${pc.green('✓')}`);
                        console.log(`  Reply: ${reply.slice(0, 100)}`);
                    }
                    else {
                        const txt = await chatRes.text().catch(() => '');
                        console.log(`  POST /chat/completions: ${chatDur}ms ${pc.yellow(`(${chatRes.status})`)}`);
                        if (txt)
                            console.log(`  ${pc.dim(txt.slice(0, 200))}`);
                    }
                }
                catch (err) {
                    const errMsg = err.message || 'unknown';
                    console.log(`  POST /chat/completions: ${pc.red('failed')} — ${errMsg.slice(0, 100)}`);
                }
            }
            else {
                // Cloud provider: just show info (can't easily test without API key logic)
                console.log(pc.dim('  Direct latency test not available for cloud providers.'));
                console.log(pc.dim('  Check /health for provider status.'));
            }
            console.log();
            continue;
        }
        // ── /brain commands ─────────────────────────────
        if (trimmed.toLowerCase() === '/brain status') {
            const status = await getBrainStatus();
            if (!status.exists) {
                console.log(pc.yellow('\n  Brain not initialized. Run: hysa brain init\n'));
                continue;
            }
            console.log(pc.bold(pc.magenta('\n🧠 Project Brain\n')));
            console.log(`  Events:     ${status.eventCount}`);
            console.log(`  Map date:   ${status.projectMapDate || 'never'}`);
            console.log(`  Systems:    ${status.knownSystems.length > 0 ? status.knownSystems.join(', ') : 'none'}`);
            console.log();
            continue;
        }
        if (trimmed.toLowerCase() === '/brain recent') {
            const events = await readRecentEvents(10);
            if (events.length === 0) {
                console.log(pc.dim('\n  No events yet.\n'));
                continue;
            }
            console.log(pc.bold(pc.magenta('\n🧠 Recent Brain Events\n')));
            for (const e of events) {
                const date = new Date(e.timestamp).toLocaleString();
                console.log(`  ${pc.dim(date)} ${pc.cyan(e.kind.padEnd(20))} ${e.title}`);
                if (e.summary)
                    console.log(`  ${pc.dim('  →')} ${e.summary.slice(0, 100)}`);
            }
            console.log();
            continue;
        }
        if (trimmed.toLowerCase() === '/brain map') {
            try {
                const map = await generateProjectMap(process.cwd());
                await writeProjectMap(map);
                console.log(pc.green(`\n✓ Project map updated (${map.knownSystems.length} systems)\n`));
            }
            catch (err) {
                console.log(pc.red(`\nError: ${err.message}\n`));
            }
            continue;
        }
        if (trimmed.startsWith('/brain note ')) {
            const text = trimmed.slice('/brain note '.length).trim();
            if (text) {
                await appendBrainEvent({ kind: 'manual_note', title: text.slice(0, 80), summary: text, tags: ['manual'] });
                console.log(pc.green('✓ Note saved.\n'));
            }
            continue;
        }
        // ── /brain graph commands ──────────────────────
        if (trimmed.toLowerCase() === '/brain graph' || trimmed.toLowerCase() === '/brain graph stats') {
            try {
                const stats = await getGraphStats();
                console.log(pc.bold(pc.magenta('\n📊 Experience Graph\n')));
                console.log(`  Nodes:   ${stats.nodeCount}`);
                console.log(`  Edges:   ${stats.edgeCount}`);
                console.log(`  Updated: ${new Date(stats.updatedAt).toLocaleString()}`);
                console.log();
            }
            catch {
                console.log(pc.yellow('\n  Graph not available.\n'));
            }
            continue;
        }
        if (trimmed.toLowerCase().startsWith('/brain graph search ')) {
            const query = trimmed.slice('/brain graph search '.length).trim();
            if (query) {
                try {
                    const { nodes, edges } = await searchGraph(query);
                    if (nodes.length === 0 && edges.length === 0) {
                        console.log(pc.dim(`\n  No results for "${query}".\n`));
                    }
                    else {
                        console.log(pc.bold(pc.magenta(`\n🔍 "${query}"\n`)));
                        for (const n of nodes.slice(0, 10)) {
                            console.log(`  ${pc.cyan(n.kind.padEnd(12))} ${n.label.slice(0, 60)}`);
                        }
                        console.log();
                    }
                }
                catch {
                    console.log(pc.yellow('\n  Search failed.\n'));
                }
            }
            continue;
        }
        function checkPendingEditProtected() {
            if (pendingEdit && isProtectedFilePath(pendingEdit.filePath)) {
                if (config.debug)
                    console.log(pc.dim(`  [debug] blocked protected file pending edit: ${pendingEdit.filePath}`));
                console.log(pc.yellow(`  ${PROTECTED_FILE_MESSAGE}\n`));
                pendingEdit = null;
                return true;
            }
            return false;
        }
        if (['/apply', '/doit', '/do it'].includes(trimmed.toLowerCase()) || trimmed.toLowerCase() === '/go ahead') {
            if (!pendingEdit) {
                console.log(pc.yellow('  No pending edit to apply.\n'));
                continue;
            }
            if (checkPendingEditProtected())
                continue;
            const relPath = relative(workingDir, pendingEdit.filePath);
            console.log(pc.cyan(`\n📝 Preview: ${relPath}\n`));
            const diff = previewEdit(pendingEdit.filePath, pendingEdit.content);
            if (diff) {
                console.log(formatDiff(diff));
            }
            console.log();
            if (yoloMode) {
                const sp = new Spinner();
                sp.start('EDIT Applying (YOLO)...');
                try {
                    writeFileWithBackup(pendingEdit.filePath, pendingEdit.content);
                    sp.succeed('OK   Applied');
                    console.log(`Applied edit to ${relPath}\n`);
                }
                catch (err) {
                    sp.fail('ERR   Failed');
                    console.log(`  Error: ${err.message}\n`);
                }
                pendingEdit = null;
                continue;
            }
            const approved = await confirm({ message: 'Apply this edit?', default: true });
            if (!approved) {
                console.log('ERR  Edit rejected.\n');
                pendingEdit = null;
                continue;
            }
            const sp = new Spinner();
            sp.start('EDIT Applying...');
            try {
                writeFileWithBackup(pendingEdit.filePath, pendingEdit.content);
                sp.succeed('OK   Applied');
                console.log(`${relPath} updated with backup created.\n`);
            }
            catch (err) {
                sp.fail('ERR   Failed');
                console.log(`  Error: ${err.message}\n`);
            }
            pendingEdit = null;
            continue;
        }
        // "do it", "apply", "yes", "ok", "go ahead" when pending edit exists
        const applyTrigger = /^(do\s*it|apply|yes|ok|go\s*ahead|yeah|sure|y[!.]?)$/i.test(trimmed.trim());
        if (applyTrigger && pendingEdit) {
            if (checkPendingEditProtected())
                continue;
            const relPath = relative(workingDir, pendingEdit.filePath);
            console.log(`\nPreview: ${relPath}\n`);
            const diff = previewEdit(pendingEdit.filePath, pendingEdit.content);
            if (diff) {
                console.log(formatDiff(diff));
            }
            console.log();
            if (yoloMode) {
                const sp = new Spinner();
                sp.start('EDIT Applying (YOLO)...');
                try {
                    writeFileWithBackup(pendingEdit.filePath, pendingEdit.content);
                    sp.succeed('OK   Applied');
                    console.log(`Applied edit to ${relPath}\n`);
                }
                catch (err) {
                    sp.fail('ERR   Failed');
                    console.log(`  Error: ${err.message}\n`);
                }
                pendingEdit = null;
                continue;
            }
            const approved = await confirm({ message: 'Apply this edit?', default: true });
            if (!approved) {
                console.log('ERR  Edit rejected.\n');
                pendingEdit = null;
                continue;
            }
            const sp = new Spinner();
            sp.start('EDIT Applying...');
            try {
                writeFileWithBackup(pendingEdit.filePath, pendingEdit.content);
                sp.succeed('OK   Applied');
                console.log(`${relPath} updated with backup created.\n`);
            }
            catch (err) {
                sp.fail('ERR   Failed');
                console.log(`  Error: ${err.message}\n`);
            }
            pendingEdit = null;
            continue;
        }
        // ── Pending app title handler ────────────────────
        if (pendingAppTitle && !trimmed.startsWith('/')) {
            const filePath = pendingAppTitle.filePath;
            const content = readFile(filePath);
            if (!content) {
                console.log(`ERR   Could not read ${filePath}\n`);
                pendingAppTitle = null;
                continue;
            }
            const newTitle = trimmed;
            const updated = content.replace(/(<title>)(.*?)(<\/title>)/is, `$1${newTitle}$3`);
            if (updated === content) {
                console.log(`ERR   Could not find <title> tag in ${filePath}\n`);
                pendingAppTitle = null;
                continue;
            }
            pendingEdit = {
                filePath,
                content: updated,
                originalContent: content,
                plan: `Change app title to "${newTitle}"`,
                userRequest: `change app title to ${newTitle}`,
            };
            pendingAppTitle = null;
            const relPath = relative(workingDir, filePath);
            console.log(`\nPreview: ${relPath}\n`);
            const diff = previewEdit(filePath, updated);
            if (diff)
                console.log(formatDiff(diff));
            console.log();
            if (yoloMode) {
                writeFileWithBackup(filePath, updated);
                invalidateCache();
                console.log(`OK   Applied edit to ${relPath}\n`);
                addEdit({ file: filePath, timestamp: new Date().toISOString(), summary: `Edited ${filePath}` });
                pendingEdit = null;
            }
            else {
                console.log(`  Type "apply" or "do it" to confirm.\n`);
            }
            continue;
        }
        // ── AI message ──────────────────────────────────
        if (!trimmed)
            continue;
        // Track the task in session
        addTask(trimmed);
        // ── Capability question detection ──────────────
        if (isCapabilityQuestion(trimmed)) {
            const wsDiag = getSearchDiagnostics();
            const answer = getCapabilityResponse(trimmed, wsDiag.isReliable);
            console.log(`\n  ${answer}\n`);
            previousUserMessage = trimmed;
            continue;
        }
        // ── Detect question type and rebuild prompt ─────
        const taskKind = classifyTask([{ role: 'user', content: trimmed }]);
        const injectProjectContext = shouldInjectProjectContext(trimmed, taskKind);
        const isSimpleQ = isSimpleQuestion(trimmed) || taskKind === 'simple_chat';
        const resolvedMode = resolvePromptMode(config.promptMode || 'auto', config.currentProvider, isSimpleQ || !injectProjectContext);
        const promptProjectInfo = injectProjectContext ? {
            type: projectInfo.type,
            entryPoints: projectInfo.entryPoints,
            configFiles: projectInfo.configFiles,
            fileCount: projectInfo.fileCount,
            tree: projectInfo.tree.length < 3000 ? projectInfo.tree : projectInfo.tree.slice(0, 3000) + '\n... (truncated)',
        } : undefined;
        systemPrompt = buildSystemPrompt(promptProjectInfo, currentAgentMode, lightActive, config.currentProvider, resolvedMode);
        recordPromptMode(resolvedMode);
        // ── Web search intent detection ────────────────
        let webSearchResults = null;
        let isExplicitSearchCmd = false;
        const searchPatterns = [
            // Explicit hysa search/websearch commands — check FIRST
            /^hysa\s+(?:search|websearch)\s+"(.+?)"$/i,
            /^hysa\s+(?:search|websearch)\s+'(.+?)'$/i,
            /^hysa\s+(?:search|websearch)\s+(.+)$/i,
            /^(?:search|find|look\s*up|google|bing|search\s*the\s*web)\s+(?:for\s+)?(.+)/i,
            /^(?:what\s+is\s+the\s+(?:current|latest|recent)\s+)/i,
            /^(?:latest\s+(?:news|updates?|info)\s+(?:about|on)\s+)/i,
            /^(?:where\s+can\s+(?:I|we)\s+(?:watch|find|get)\s+)/i,
            /^(?:who\s+(?:is|are|was|were)\s+the\s+(?:current|latest|new)\s+)/i,
            /^(?:how\s+(?:much|many)\s+(?:is|are|does)\s+)/i,
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
            const m = trimmed.match(p);
            if (m) {
                searchQuery = m[1]?.trim() || trimmed;
                // Check if this was an explicit hysa search/websearch command
                isExplicitSearchCmd = /^hysa\s+(?:search|websearch)\s+/i.test(trimmed);
                break;
            }
        }
        if (searchQuery) {
            console.log(pc.cyan(`  Web search: "${searchQuery}"`));
            const wsConfig = getWebSearchConfig();
            const wsDiag = getSearchDiagnostics();
            if (!wsDiag.isReliable) {
                const hasArabic = /[\u0600-\u06FF]/.test(trimmed);
                const configMsg = hasArabic
                    ? 'البحث في الإنترنت غير مضبوط بشكل موثوق. فعّل TAVILY_API_KEY أو SERPER_API_KEY أو BRAVE_SEARCH_API_KEY.'
                    : 'Web search is not reliably configured. To enable web search, set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.';
                console.log(pc.yellow(`\n  ${configMsg}\n`));
                continue;
            }
            else {
                try {
                    const results = await searchWeb(searchQuery, { maxResults: 5 });
                    webSearchResults = formatSearchResults(searchQuery, results);
                    if (results.length > 0) {
                        console.log(pc.dim(`  ${results.length} result(s) found, injecting into conversation.`));
                    }
                    else {
                        console.log(pc.yellow(`  No results found.`));
                    }
                    if (config.debug)
                        console.log(pc.dim(`  [debug] Web search: ${results.length} results for "${searchQuery}"`));
                }
                catch (err) {
                    webSearchResults = `Web search failed: ${err.message}`;
                    console.log(pc.red(`  Web search failed: ${err.message}`));
                    if (config.debug)
                        console.log(pc.dim(`  [debug] Web search failed: ${err.message}`));
                }
            }
        }
        // ── Entity detection for unknown names/handles ─────
        if (!searchQuery && taskKind !== 'simple_chat') {
            const entityResult = shouldSearchEntity(trimmed, previousUserMessage);
            if (entityResult.shouldSearch && entityResult.query) {
                searchQuery = entityResult.query;
                console.log(pc.cyan(`  Entity search: "${searchQuery}"`));
                const wsDiag = getSearchDiagnostics();
                if (!wsDiag.isReliable) {
                    const hasArabic = /[\u0600-\u06FF]/.test(trimmed);
                    const configMsg = hasArabic
                        ? 'البحث في الإنترنت غير مضبوط بشكل موثوق. فعّل TAVILY_API_KEY أو SERPER_API_KEY أو BRAVE_SEARCH_API_KEY.'
                        : 'Web search is not reliably configured. To enable web search, set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.';
                    console.log(pc.yellow(`\n  ${configMsg}\n`));
                    previousUserMessage = trimmed;
                    continue;
                }
                else {
                    try {
                        const results = await searchWeb(searchQuery, { maxResults: 5 });
                        webSearchResults = formatSearchResults(searchQuery, results);
                        if (results.length > 0) {
                            console.log(pc.dim(`  ${results.length} result(s) found, injecting into conversation.`));
                        }
                        else {
                            console.log(pc.yellow(`  No results found.`));
                        }
                        if (config.debug)
                            console.log(pc.dim(`  [debug] Entity search: ${results.length} results for "${searchQuery}"`));
                    }
                    catch (err) {
                        webSearchResults = `Web search failed: ${err.message}`;
                        console.log(pc.red(`  Web search failed: ${err.message}`));
                        if (config.debug)
                            console.log(pc.dim(`  [debug] Entity search failed: ${err.message}`));
                    }
                }
            }
        }
        const contextStartTime = Date.now();
        // Build context and messages
        // For explicit search commands, don't include the raw command — only search results
        let userMessage;
        if (isExplicitSearchCmd && webSearchResults) {
            userMessage = `[Web search results for "${searchQuery}"]\n\n${webSearchResults}`;
        }
        else if (webSearchResults) {
            userMessage = `${trimmed}\n\n${webSearchResults}`;
        }
        else {
            userMessage = trimmed;
        }
        let allMessages;
        let wasTruncated = false;
        if (lightActive || isExplicitSearchCmd || !injectProjectContext) {
            // Light mode or explicit search: skip file context, aggressive truncation
            const { messages: safeMessages } = truncateMessages([...messages], 2000);
            allMessages = [
                ...safeMessages,
                { role: 'user', content: userMessage },
            ];
            wasTruncated = allMessages.length < messages.length + 1;
        }
        else if (isSimpleQ) {
            // Simple question: skip file context, normal history limit
            const { messages: safeMessages } = truncateMessages([...messages]);
            allMessages = [
                ...safeMessages,
                { role: 'user', content: userMessage },
            ];
            wasTruncated = allMessages.length < messages.length + 1;
        }
        else {
            // Complex query: rank and include relevant files
            const ranked = rankFiles(projectInfo.importantFiles, trimmed, 5);
            const allFiles = projectInfo.tree.split('\n').filter(f => !f.endsWith('/'));
            const rankedAll = rankFiles(allFiles, trimmed, 8);
            const topFiles = rankedAll.filter(r => r.score > 5).map(r => r.path).slice(0, 5);
            let fileContext = '';
            for (const file of topFiles) {
                const content = readFile(file);
                if (content) {
                    const lines = content.split('\n').length;
                    fileContext += `\n--- ${file} (${lines} lines) ---\n${content.slice(0, 3000)}\n`;
                }
            }
            if (projectInfo.fileCount <= 2) {
                for (const file of projectInfo.entryPoints) {
                    if (!topFiles.includes(file)) {
                        const content = readFile(file);
                        if (content) {
                            fileContext += `\n--- ${file} ---\n${content.slice(0, 3000)}\n`;
                        }
                    }
                }
            }
            if (fileContext) {
                const est = estimateTokens(fileContext);
                if (est < 2000) {
                    userMessage = `Relevant project files:\n${fileContext}\n\nUser request: ${trimmed}`;
                }
            }
            const { messages: safeMessages, truncated: trunc } = truncateMessages([...messages]);
            wasTruncated = trunc;
            allMessages = [
                ...safeMessages,
                { role: 'user', content: userMessage },
            ];
        }
        const currentTokens = allMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
        const contextBuildTime = Date.now() - contextStartTime;
        // Debug: show prompt size info
        if (config.debug) {
            const systemTokens = estimateTokens(systemPrompt);
            const historyTokens = allMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
            const totalTokens = systemTokens + historyTokens;
            console.log(pc.dim(`  [debug] Context build time: ${contextBuildTime}ms`));
            console.log(pc.dim(`  [debug] Prompt mode: ${resolvedMode}`));
            console.log(pc.dim(`  [debug] System prompt: ~${systemTokens} tokens`));
            console.log(pc.dim(`  [debug] History/messages: ~${historyTokens} tokens`));
            console.log(pc.dim(`  [debug] Total estimated: ~${totalTokens} tokens`));
            if (lightActive && totalTokens > 2000) {
                console.log(pc.dim(`  [debug] Local prompt trimmed from ~${totalTokens} tokens to ~2000 tokens.`));
            }
        }
        const requestStart = Date.now();
        thinkingCancelled = false;
        const provLabel = PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider;
        // Print user message clearly
        console.log(`\n${pc.bold('You:')} ${trimmed}\n`);
        // Setup cancellation for this user request
        const requestAbortController = new AbortController();
        cancelThinking = () => { if (!requestAbortController.signal.aborted)
            requestAbortController.abort(); };
        // ── Streaming path for simple queries ──────────
        const canStream = isSimpleQ && typeof client.sendMessageStream === 'function';
        if (canStream) {
            const spinnerStream = new Spinner();
            spinnerStream.start(`Working...`);
            let streamedContent = '';
            let streamError = null;
            let lastResponse = null;
            try {
                const signal = requestAbortController.signal;
                const result = await client.sendMessageStream(allMessages, systemPrompt, (event) => {
                    if (event.type === 'token') {
                        if (streamedContent.length === 0) {
                            spinnerStream.stop();
                            console.log(); // newline after spinner line
                        }
                        process.stdout.write(event.text);
                        streamedContent += event.text;
                    }
                }, signal);
                if (streamedContent.length > 0) {
                    console.log(); // final newline
                }
                else {
                    spinnerStream.stop();
                }
                // ── Process stream result ─────────────────────
                const cleanMessage = stripToolCallBlocks(result.message);
                const displayMsg = cleanMessage;
                if (streamedContent.length === 0 && displayMsg) {
                    const lines = displayMsg.split('\n').filter(Boolean);
                    for (const line of lines) {
                        console.log(`  ${line}`);
                    }
                    console.log();
                }
                const safeUserMsg = wasTruncated ? `${trimmed}\n\n[Note: Some older context was trimmed for token safety]` : trimmed;
                allMessages.push({ role: 'assistant', content: result.message });
                messages.push({ role: 'user', content: safeUserMsg }, { role: 'assistant', content: result.message });
                // Handle any tool calls (unlikely for simple Q but safe)
                if (result.toolCalls && result.toolCalls.length > 0) {
                    const spinnerTools = new Spinner();
                    spinnerTools.start('Executing tools...');
                    for (const toolCall of result.toolCalls) {
                        await handleToolCall(toolCall, yoloMode, !!config.debug);
                    }
                    spinnerTools.succeed('Tools executed');
                }
                lastResponse = result;
            }
            catch (err) {
                const e = err;
                streamError = e;
                if (streamedContent.length > 0) {
                    console.log();
                }
                else {
                    spinnerStream.stop();
                }
                if (thinkingCancelled) {
                    console.log(pc.dim('\n  (Cancelled.)\n'));
                }
                else {
                    console.log(pc.red(`\n  ${e.message || 'Stream error'}\n`));
                }
                lastResponse = null;
            }
            // Cleanup
            cancelThinking = null;
            thinkingPromise = null;
            continue;
        }
        // ── Non-streaming path (existing behavior) ─────
        const spinner = new Spinner();
        thinkingCancelled = false;
        spinner.start(`Working...`);
        // Multi-step auto-continue loop
        const MAX_STEPS = lightActive ? 2 : (isSimpleQ ? 1 : 5);
        let steps = 0;
        let lastResponse = null;
        let stepError = null;
        while (steps < MAX_STEPS) {
            if (requestAbortController.signal.aborted || thinkingCancelled) {
                break;
            }
            steps++;
            let response;
            try {
                const timeoutPromise = new Promise((_, reject) => {
                    const timer = setTimeout(() => reject(new Error(`Request timed out after 30s`)), 30000);
                    requestAbortController.signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        reject(new DOMException('Aborted', 'AbortError'));
                    }, { once: true });
                });
                response = await Promise.race([
                    client.sendMessage(allMessages, systemPrompt),
                    timeoutPromise,
                ]);
                stepError = null;
            }
            catch (error) {
                const err = error;
                stepError = err;
                if (steps === 1) {
                    const errorMsg = err.message || 'Unknown error';
                    const elapsed = ((Date.now() - requestStart) / 1000).toFixed(1);
                    const isRateLimit = errorMsg.toLowerCase().includes('rate limit') ||
                        errorMsg.toLowerCase().includes('429') ||
                        errorMsg.toLowerCase().includes('too many requests') ||
                        errorMsg.includes('rate-limited or unavailable');
                    const isTimeout = errorMsg.toLowerCase().includes('timeout') || errorMsg.includes('Abort');
                    const isCancel = errorMsg.includes('Abort') && thinkingCancelled;
                    if (isCancel) {
                        spinner.stop();
                        console.log(pc.dim('\n  (Cancelled.)'));
                    }
                    else {
                        if (config.debug) {
                            const prov = config.currentProvider;
                            console.log(pc.dim(`  [debug] ${PROVIDER_DEFAULTS[prov]?.label || prov} / ${config.currentModel} — ${elapsed}s`));
                        }
                        if (isTimeout) {
                            spinner.fail(`Timed out (${elapsed}s)`);
                            if (isLocalProvider) {
                                console.log(pc.yellow(`  ⚠ HYSA AI request timed out inside hysa-code. Direct provider is fast, so prompt/context may be too large. Try /light on or /debug on.`));
                            }
                            else {
                                console.log(pc.yellow(`  ⚠ Provider timed out after ${elapsed}s. Automatically falling back...`));
                            }
                        }
                        else if (isRateLimit) {
                            spinner.fail('Provider rate limited');
                            if (isLocalProvider) {
                                console.log(pc.yellow(`  ⚠ ${errorMsg}`));
                                console.log(pc.dim('  Local provider rate limited. Try /light on to reduce prompt size.'));
                            }
                            else {
                                console.log(pc.yellow(`  ⚠ ${errorMsg}`));
                                console.log(pc.dim('  The system will automatically try another provider.'));
                            }
                        }
                        else {
                            spinner.fail('Error');
                            console.log(pc.red(`  ${errorMsg}`));
                            if (isLocalProvider) {
                                console.log(pc.dim('  Try /light on to reduce prompt size or /debug on for diagnostics.'));
                            }
                            const signupUrl = PROVIDER_SIGNUP_URLS[config.currentProvider];
                            if (signupUrl && !config.apiKeys[config.currentProvider]) {
                                console.log(pc.dim(`  Get a key: ${signupUrl}`));
                            }
                        }
                    }
                    lastResponse = null;
                    console.log();
                }
                else {
                    // Multi-step failures handled silently
                }
                break;
            }
            lastResponse = response;
            // If no tool calls, check if AI promised to read but didn't execute
            if (response.toolCalls.length === 0) {
                spinner.stop();
                const aiMsg = response.message || '';
                const readingIntent = /\b(let me\s+read|i'?ll\s+(read|check|look\s+at|open|see)|i need to\s+read|i should\s+read|i\s+will\s+read|let's\s+(read|check|look|see)|first,?\s+(let me|i'?ll|i need to)\s+read)/i.test(aiMsg);
                const likelyFiles = projectInfo.fileCount <= 2 ? projectInfo.entryPoints : [];
                if (readingIntent && likelyFiles.length > 0 && steps < MAX_STEPS) {
                    console.log(pc.yellow(`  ⚠ Model said it would read files but did not call the tool.\n`));
                    for (const file of likelyFiles) {
                        const content = readFile(file);
                        if (content) {
                            console.log(`  ${pc.dim(`Auto-read ${file} (${content.split('\n').length} lines)...`)}`);
                            allMessages.push({
                                role: 'user',
                                content: `[Content of ${file}:\n\`\`\`\n${content.slice(0, 5000)}\n\`\`\`]`,
                            });
                        }
                    }
                    console.log(pc.dim('  Continuing...\n'));
                    spinner.start('🤔 Thinking...');
                    continue;
                }
                // Pending edit detection: AI provided code without using edit_file
                if (!pendingEdit && !readingIntent) {
                    const detected = detectPendingEdit(aiMsg, projectInfo);
                    if (detected) {
                        // Block pending edits to protected files
                        if (isProtectedFilePath(detected.filePath)) {
                            if (config.debug)
                                console.log(pc.dim(`  [debug] blocked protected file pending edit: ${detected.filePath}`));
                            console.log(`  ${pc.yellow(PROTECTED_FILE_MESSAGE)}\n`);
                            allMessages.push({ role: 'assistant', content: aiMsg + '\n\n' + PROTECTED_FILE_MESSAGE });
                            messages.push({ role: 'user', content: trimmed }, { role: 'assistant', content: aiMsg + '\n\n' + PROTECTED_FILE_MESSAGE });
                            break;
                        }
                        pendingEdit = {
                            filePath: detected.filePath,
                            content: detected.content,
                            originalContent: readFile(detected.filePath) || '',
                            plan: aiMsg.slice(0, 300),
                            userRequest: trimmed,
                        };
                        const relPath = relative(workingDir, detected.filePath);
                        console.log(`  ${pc.yellow('📋 Detected a proposed edit for')} ${pc.cyan(relPath)}${pc.yellow('.')}`);
                        console.log(`  ${pc.yellow('Type')} ${pc.cyan('"apply"')} ${pc.yellow('or')} ${pc.cyan('"do it"')} ${pc.yellow('to preview and apply.\n')}`);
                    }
                }
                const displayMsg = stripToolCallBlocks(aiMsg);
                if (displayMsg && !containsOnlyToolSyntax(aiMsg)) {
                    const lines = displayMsg.split('\n').filter(Boolean);
                    for (const line of lines) {
                        console.log(`  ${line}`);
                    }
                    console.log();
                }
                const unparseable = /<\|?tool_call/.test(aiMsg) || /\b(edit_file|read_file|execute_command)\s*\(/.test(aiMsg);
                if (unparseable) {
                    console.log(pc.yellow('  ⚠ I detected a tool request but could not parse it. The current model may not support tools properly. Try /model to switch.\n'));
                }
                const safeUserMsg = wasTruncated ? `${trimmed}\n\n[Note: Some older context was trimmed for token safety]` : trimmed;
                allMessages.push({ role: 'assistant', content: aiMsg });
                messages.push({ role: 'user', content: safeUserMsg }, { role: 'assistant', content: aiMsg });
                break;
            }
            // Has tool calls - execute them
            spinner.stop();
            const toolResults = [];
            for (const toolCall of response.toolCalls) {
                const result = await handleToolCall(toolCall, yoloMode, !!config.debug);
                toolResults.push(result);
            }
            // Stop loop after successful edit - don't continue analyzing
            const editApplied = toolResults.some(r => r.startsWith('Edit applied successfully'));
            if (editApplied) {
                const editedFiles = toolResults
                    .filter(r => r.startsWith('Edit applied successfully'))
                    .map(r => r.replace('Edit applied successfully to ', ''));
                console.log(`Done. Applied edit to ${editedFiles.join(', ')}.\n`);
                // Still push results to messages for history
                let assistantContent = response.message || '';
                assistantContent += '\n\nTool results:\n' + toolResults.join('\n');
                allMessages.push({ role: 'assistant', content: assistantContent });
                break;
            }
            // App title task: if model only read files (no edit) and asks for new title, stop loop
            if (APP_TITLE_RE.test(trimmed) && !editApplied) {
                const allReads = response.toolCalls.every(tc => tc.type === 'read_file');
                const htmlRead = response.toolCalls.some(tc => /index\.html/.test(tc.params.filePath || ''));
                const asksForTitle = /what\s+(should|do you want)\s+(the\s+)?(new\s+)?title/i.test(response.message || '');
                const hasNewTitle = NEW_TITLE_RE.test(trimmed);
                if (allReads && htmlRead && (asksForTitle || !hasNewTitle)) {
                    const foundPath = extractReadFilePath(toolResults);
                    if (foundPath) {
                        pendingAppTitle = { filePath: foundPath };
                        const relPath = relative(workingDir, foundPath);
                        console.log(`  I found the app title in ${relPath}. What should the new title be?\n`);
                        let assistantContent = response.message || '';
                        assistantContent += '\n\nTool results:\n' + toolResults.join('\n');
                        allMessages.push({ role: 'assistant', content: assistantContent });
                        break;
                    }
                }
            }
            // Show intermediate thinking (strip raw tool syntax)
            const intermediateMsg = stripToolCallBlocks(response.message || '');
            if (intermediateMsg && !containsOnlyToolSyntax(response.message || '')) {
                const lines = intermediateMsg.split('\n').filter(Boolean);
                for (const line of lines) {
                    console.log(`  ${line}`);
                }
                console.log();
            }
            // Build assistant content with results
            let assistantContent = response.message || '';
            assistantContent += '\n\nTool results:\n' + toolResults.join('\n');
            // Add to all messages for next AI call
            allMessages.push({ role: 'assistant', content: assistantContent });
            // If we have more steps, continue
            if (steps < MAX_STEPS) {
                spinner.start(`Working... (step ${steps}/${MAX_STEPS})`);
            }
        }
        // Handle final state after loop
        // Cleanup cancellation state
        cancelThinking = null;
        thinkingPromise = null;
        if (thinkingCancelled) {
            spinner.stop();
            console.log(pc.dim('\n  (Cancelled.)\n'));
            continue;
        }
        if (stepError && steps === 1) {
            // Error already displayed above, nothing more to do
        }
        if (!lastResponse && !stepError && !thinkingCancelled) {
            // Unhandled case: ensure spinner stopped
            spinner.stop();
        }
        if (steps >= MAX_STEPS && lastResponse?.toolCalls.length && lastResponse?.toolCalls.length > 0) {
            console.log(pc.dim('  (Reached max analysis steps. Type "continue" to keep going.)\n'));
        }
        // Message was handled - show context token count
        if (lastResponse && steps > 0) {
            const finalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
            if (wasTruncated || finalTokens > 3000) {
                console.log(pc.dim(`  Context estimate: ~${finalTokens.toLocaleString()} tokens${wasTruncated ? ' (trimmed for safety)' : ''}\n`));
            }
        }
        // Debug: request timing info
        if (config.debug && lastResponse) {
            const totalElapsed = ((Date.now() - requestStart) / 1000).toFixed(1);
            console.log(pc.dim(`  [debug] Provider request duration: ${totalElapsed}s`));
            if (steps > 1) {
                console.log(pc.dim(`  [debug] Multi-step tools: ${steps} steps`));
            }
        }
        previousUserMessage = trimmed;
    }
}
// ── Main CLI ─────────────────────────────────────────────
export async function start() {
    const program = new Command();
    program
        .name('hysa')
        .description('HYSA Code - AI coding assistant')
        .version(getPackageVersion());
    program
        .command('chat')
        .description('Start an interactive chat with the AI')
        .option('-y, --yolo', 'Enable YOLO mode (auto-apply edits, skip confirmations for safe commands)')
        .option('-p, --provider <name>', 'Provider to use (overrides config)')
        .action(async (opts) => {
        let config = getSettings();
        if (opts.provider) {
            const provider = opts.provider;
            config = config || {
                currentProvider: provider,
                currentModel: PROVIDER_DEFAULTS[provider]?.model || 'default',
                apiKeys: {},
                ollamaBaseUrl: 'http://localhost:11434',
            };
            config.currentProvider = provider;
            config.currentModel = PROVIDER_DEFAULTS[provider]?.model || config.currentModel;
            if (provider === 'openai_router') {
                if (process.env.HYSA_OPENAI_ROUTER_BASE_URL)
                    config.openaiRouterBaseUrl = process.env.HYSA_OPENAI_ROUTER_BASE_URL.replace(/\/+$/, '');
                if (process.env.HYSA_OPENAI_ROUTER_MODEL) {
                    config.currentModel = process.env.HYSA_OPENAI_ROUTER_MODEL;
                    config.openaiRouterModel = process.env.HYSA_OPENAI_ROUTER_MODEL;
                }
                if (process.env.HYSA_OPENAI_ROUTER_API_KEY)
                    config.apiKeys.openai_router = process.env.HYSA_OPENAI_ROUTER_API_KEY.trim();
            }
        }
        else if (!config) {
            const envProvider = getDefaultProviderFromEnv();
            if (envProvider) {
                const envConfig = {
                    currentProvider: envProvider,
                    currentModel: PROVIDER_DEFAULTS[envProvider]?.model || 'default',
                    apiKeys: {},
                    ollamaBaseUrl: 'http://localhost:11434',
                };
                if (envProvider === 'openai_router') {
                    if (process.env.HYSA_OPENAI_ROUTER_BASE_URL)
                        envConfig.openaiRouterBaseUrl = process.env.HYSA_OPENAI_ROUTER_BASE_URL.replace(/\/+$/, '');
                    if (process.env.HYSA_OPENAI_ROUTER_MODEL) {
                        envConfig.currentModel = process.env.HYSA_OPENAI_ROUTER_MODEL;
                        envConfig.openaiRouterModel = process.env.HYSA_OPENAI_ROUTER_MODEL;
                    }
                    if (process.env.HYSA_OPENAI_ROUTER_API_KEY)
                        envConfig.apiKeys.openai_router = process.env.HYSA_OPENAI_ROUTER_API_KEY.trim();
                }
                saveConfig(envConfig);
                config = envConfig;
            }
            else {
                config = await setupFirstRun();
            }
        }
        else {
            const hasApiKey = Object.values(config.apiKeys).some(k => k);
            const needsKey = providerNeedsApiKey(config.currentProvider);
            if (!hasApiKey && needsKey) {
                console.log(pc.yellow('No API keys configured. Running setup...\n'));
                config = await setupFirstRun();
            }
        }
        const yolo = opts.yolo ?? getYolo();
        await chatLoop(config, yolo);
    });
    program
        .command('config')
        .description('View or update configuration')
        .action(async () => {
        const config = getSettings();
        if (config) {
            console.log(pc.cyan('\nCurrent configuration:'));
            const label = PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider;
            const category = PROVIDER_CATEGORIES[config.currentProvider];
            const catLabel = PROVIDER_CATEGORY_LABELS[category] || category;
            console.log(`  Provider: ${label}`);
            console.log(`  Model:    ${config.currentModel}`);
            console.log(`  Type:     ${catLabel}`);
            for (const [prov, key] of Object.entries(config.apiKeys)) {
                const lbl = PROVIDER_DEFAULTS[prov]?.label || prov;
                console.log(`  ${lbl} key: ${key ? pc.green('✓ set') : pc.red('not set')}`);
            }
            if (config.currentProvider === 'ollama') {
                console.log(`  Ollama URL: ${config.ollamaBaseUrl}`);
            }
            if (config.currentProvider === 'openai_router' && config.openaiRouterBaseUrl) {
                console.log(`  OpenAI Router URL: ${config.openaiRouterBaseUrl}`);
            }
            if (config.currentProvider === 'anthropic_proxy' && config.anthropicProxyBaseUrl) {
                console.log(`  Anthropic Proxy URL: ${config.anthropicProxyBaseUrl}`);
            }
            console.log();
        }
        else {
            console.log(pc.yellow('No configuration found. Run: hysa chat\n'));
            return;
        }
        const action = await select({
            message: 'What would you like to do?',
            choices: [
                { name: 'Switch provider / model', value: 'switch' },
                { name: 'Update API key', value: 'key' },
                { name: 'Nothing', value: 'none' },
            ],
        });
        if (action === 'switch') {
            const switchChoices = PROVIDER_CHOICES.filter(c => c.tier !== 'experimental_free' || config.allowExperimentalProviders);
            const provider = await select({
                message: 'Select provider:',
                choices: switchChoices.map(c => ({
                    name: `${TIER_LABELS[c.tier].icon} ${c.name}`,
                    value: c.value,
                })),
            });
            if (PROVIDER_TIERS[provider] === 'experimental_free') {
                console.log(pc.yellow('\n  ⚠ Experimental free providers may log prompts, rate-limit, disappear, or change behavior. Do not send sensitive code.\n'));
                if (!config.experimentalConfirmed) {
                    inPrompt = true;
                    const ok = await confirm({ message: 'I understand the risks, continue?', default: false });
                    inPrompt = false;
                    if (!ok) {
                        console.log(pc.dim('  Provider selection cancelled.\n'));
                        return;
                    }
                }
            }
            const models = PROVIDER_MODELS[provider];
            const model = await select({
                message: 'Select model:',
                choices: models.map(m => ({ name: m, value: m })),
            });
            const updated = { ...config, currentProvider: provider, currentModel: model, experimentalConfirmed: config.experimentalConfirmed || PROVIDER_TIERS[provider] === 'experimental_free' };
            if (provider !== 'ollama' && provider !== 'local_openai' && provider !== 'hysa_ai' && PROVIDER_TIERS[provider] !== 'experimental_free') {
                if (!config.apiKeys[provider]) {
                    if (providerNeedsApiKey(provider)) {
                        const rawKey = await password({ message: `Enter ${PROVIDER_DEFAULTS[provider].label} API key\n  Get one: ${PROVIDER_SIGNUP_URLS[provider]}`, mask: true });
                        const validated = validateApiKey(rawKey, provider);
                        if (!validated.valid) {
                            console.log(pc.red(`\n✗ ${validated.error}\n`));
                            process.exit(1);
                        }
                        updated.apiKeys = { ...config.apiKeys, [provider]: validated.key };
                    }
                    else if (providerHasOptionalApiKey(provider)) {
                        const rawKey = await password({ message: `Optional API key for ${PROVIDER_DEFAULTS[provider].label}. Press Enter to skip:`, mask: true });
                        if (rawKey) {
                            const validated = validateApiKey(rawKey, provider);
                            if (!validated.valid) {
                                console.log(pc.red(`\n✗ ${validated.error}\n`));
                                process.exit(1);
                            }
                            updated.apiKeys = { ...config.apiKeys, [provider]: validated.key };
                        }
                    }
                }
            }
            if (provider === 'anthropic_proxy' && !config.anthropicProxyBaseUrl) {
                const baseUrl = await input({ message: 'Anthropic proxy base URL\n  Example: https://proxy.example.com', default: 'https://' });
                if (baseUrl) {
                    updated.anthropicProxyBaseUrl = baseUrl.replace(/\/+$/, '');
                }
            }
            if (provider === 'openai_router' && !config.openaiRouterBaseUrl) {
                const baseUrl = await input({ message: 'OpenAI router base URL\n  Example: http://localhost:20128/v1', default: 'http://localhost:20128/v1' });
                if (baseUrl) {
                    updated.openaiRouterBaseUrl = baseUrl.replace(/\/+$/, '');
                }
            }
            updateSettings(updated);
            console.log(pc.green('✓ Configuration updated\n'));
        }
        else if (action === 'key') {
            const keyChoices = [
                { name: 'OpenCode Zen (Free API)', value: 'opencode_zen' },
                { name: 'OpenRouter (Free API)', value: 'openrouter' },
                { name: 'Groq (Free API)', value: 'groq' },
                { name: 'DeepSeek (Free API)', value: 'deepseek' },
                { name: 'Google Gemini (Free API)', value: 'gemini' },
                { name: 'Anthropic Claude (Premium)', value: 'anthropic' },
                { name: 'OpenAI GPT (Premium)', value: 'openai' },
                { name: 'Anthropic Proxy (Cloud Free)', value: 'anthropic_proxy' },
                { name: 'OpenAI Router (Cloud Free)', value: 'openai_router' },
            ];
            if (config.allowExperimentalProviders) {
                keyChoices.push({ name: 'Pollinations AI (Experimental)', value: 'pollinations' }, { name: 'LLM7 (Experimental)', value: 'llm7' }, { name: 'Puter AI (Experimental)', value: 'puter' });
            }
            const prov = await select({
                message: 'Which provider?',
                choices: keyChoices,
            });
            if (providerHasOptionalApiKey(prov)) {
                const rawKey = await password({ message: `Optional API key for ${PROVIDER_DEFAULTS[prov].label}. Press Enter to skip:`, mask: true });
                if (rawKey) {
                    const validated = validateApiKey(rawKey, prov);
                    if (!validated.valid) {
                        console.log(pc.red(`\n✗ ${validated.error}\n`));
                        process.exit(1);
                    }
                    updateSettings({ apiKeys: { ...config.apiKeys, [prov]: validated.key } });
                    console.log(pc.green('✓ API key updated\n'));
                }
                else {
                    console.log(pc.dim('  No key provided. Provider will use keyless mode.\n'));
                }
            }
            else if (providerNeedsApiKey(prov)) {
                const rawKey = await password({ message: `Enter ${PROVIDER_DEFAULTS[prov].label} API key\n  Get one: ${PROVIDER_SIGNUP_URLS[prov]}`, mask: true });
                const validated = validateApiKey(rawKey, prov);
                if (!validated.valid) {
                    console.log(pc.red(`\n✗ ${validated.error}\n`));
                    process.exit(1);
                }
                updateSettings({ apiKeys: { ...config.apiKeys, [prov]: validated.key } });
                console.log(pc.green('✓ API key updated\n'));
            }
            else {
                console.log(pc.dim(`  ${PROVIDER_DEFAULTS[prov].label} does not require an API key.\n`));
            }
        }
    });
    // ── local subcommands ──────────────────────────────
    const localCmd = program.command('local').description('Local provider commands');
    localCmd
        .command('setup')
        .description('Print setup instructions for local providers')
        .action(() => {
        const lines = [
            pc.bold('\n📦 HYSA Code — Local Provider Setup\n'),
            '',
            pc.bold('1. Ollama'),
            '   Download: https://ollama.com/download',
            '   Start:    ollama serve',
            '   Model:    ollama pull qwen2.5-coder:1.5b',
            '   Test:     hysa doctor --provider ollama',
            '',
            pc.bold('2. HYSA AI'),
            '   Install:  npm install -g hysa-ai',
            '   Start:    hysa-ai serve',
            '   Test:     hysa doctor --provider hysa-ai',
            '',
            pc.bold('3. LM Studio'),
            '   Download: https://lmstudio.ai',
            '   Start:    Open LM Studio → Local Inference Server → Start',
            '   Default:  http://localhost:1234/v1',
            '   Test:     hysa doctor --provider local-openai',
            '',
            pc.bold('4. llama.cpp'),
            '   Download: https://github.com/ggerganov/llama.cpp',
            '   Build:    Follow build instructions for your OS',
            '   Start:    ./server -m model.gguf --port 8080',
            '   Test:     hysa doctor --provider llama-cpp',
            '',
            pc.dim('After setting up, run: hysa config'),
            pc.dim('to select your local provider.\n'),
        ];
        console.log(lines.join('\n'));
    });
    program
        .command('tree')
        .description('Show project tree')
        .action(() => {
        const info = getProjectInfo(resolve('.'));
        console.log(info.tree);
    });
    program
        .command('doctor')
        .description('Run diagnostics to check your setup')
        .option('--debug', 'Show raw provider error details')
        .option('--provider <name>', 'Test a specific provider (e.g. openrouter, hysa-ai, ollama)')
        .action(async (opts) => {
        const normalized = opts.provider?.replace(/-/g, '_');
        await runDoctor(opts.debug ?? false, normalized);
    });
    program
        .command('models')
        .description('Fetch and display available models from a provider')
        .argument('<provider>', 'Provider name (e.g. openrouter)')
        .option('--free', 'Show only free models')
        .action(async (provider, opts) => {
        const normalizedProvider = provider.replace(/-/g, '_');
        if (normalizedProvider === 'ollama') {
            const hysaConfig = loadConfig();
            const baseUrl = hysaConfig?.ollamaBaseUrl || 'http://localhost:11434';
            const spinner = new Spinner();
            spinner.start('Fetching Ollama local models...');
            try {
                const models = await listOllamaModels(baseUrl);
                spinner.succeed(`Found ${models.length} local model${models.length !== 1 ? 's' : ''}`);
                console.log();
                if (models.length === 0) {
                    console.log(pc.yellow('  No Ollama models found. Pull one with: ollama pull qwen2.5-coder\n'));
                }
                else {
                    for (const model of models)
                        console.log(`  ${model}`);
                    console.log();
                }
            }
            catch (err) {
                spinner.fail('Failed to fetch Ollama models');
                console.log(pc.red(`  ${err.message}`));
                console.log(pc.dim('  Start Ollama with: ollama serve\n'));
            }
            return;
        }
        if (provider !== 'openrouter') {
            console.log(pc.yellow(`\n  Model listing is available for openrouter and ollama.\n`));
            return;
        }
        const hysaConfig = loadConfig();
        if (!hysaConfig || !hysaConfig.apiKeys.openrouter) {
            console.log(pc.red('\n  OpenRouter API key required. Configure it with: hysa config\n'));
            return;
        }
        const spinner = new Spinner();
        spinner.start('Fetching OpenRouter models...');
        try {
            const models = await fetchOpenRouterModels(hysaConfig.apiKeys.openrouter);
            spinner.succeed(`Found ${models.length} models`);
            console.log();
            console.log(formatModelsTable(models, opts.free));
            console.log();
        }
        catch (err) {
            spinner.fail('Failed to fetch models');
            console.log(pc.red(`  ${err.message}`));
        }
    });
    program
        .command('providers')
        .description('Show available AI providers')
        .action(() => {
        const allProviders = [
            { id: 'OpenCode Zen', tier: 'FREE API KEY', needsKey: 'Yes', needsDownload: 'No', notes: 'Curated free/open models, some free for limited time' },
            { id: 'OpenRouter', tier: 'FREE API KEY', needsKey: 'Yes', needsDownload: 'No', notes: 'Gateway to many free + paid models' },
            { id: 'Groq', tier: 'FREE API KEY', needsKey: 'Yes', needsDownload: 'No', notes: 'Fast inference on open models' },
            { id: 'DeepSeek', tier: 'FREE API KEY', needsKey: 'Yes', needsDownload: 'No', notes: 'Strong coding models' },
            { id: 'Google Gemini', tier: 'FREE API KEY', needsKey: 'Yes', needsDownload: 'No', notes: 'Free tier 60 req/min, quotas apply' },
            { id: 'Ollama', tier: 'LOCAL FREE', needsKey: 'No', needsDownload: 'Yes', notes: 'Run models locally, requires download' },
            { id: 'LM Studio / Local', tier: 'LOCAL FREE', needsKey: 'No', needsDownload: 'Yes', notes: 'OpenAI-compatible local server' },
            { id: 'Anthropic Claude', tier: 'PREMIUM API', needsKey: 'Yes', needsDownload: 'No', notes: 'Best for complex coding, paid' },
            { id: 'OpenAI GPT', tier: 'PREMIUM API', needsKey: 'Yes', needsDownload: 'No', notes: 'Fast and versatile, paid' },
            { id: 'Pollinations AI', tier: 'EXPERIMENTAL FREE', needsKey: 'No*', needsDownload: 'No', notes: '🧪 No key by default, may log prompts' },
            { id: 'LLM7', tier: 'EXPERIMENTAL FREE', needsKey: 'Opt', needsDownload: 'No', notes: '🧪 OpenAI-compatible, optional key' },
            { id: 'Puter AI', tier: 'EXPERIMENTAL FREE', needsKey: 'No', needsDownload: 'No', notes: '🧪 Web/browser based, not CLI suitable' },
            { id: 'OpenAI Router', tier: 'FREE API KEY', needsKey: 'Opt', needsDownload: 'No', notes: 'OpenAI-compatible router/proxy (9router etc.)' },
        ];
        console.log(pc.cyan('\nAvailable AI Providers:\n'));
        console.log(`  ${pc.bold('Provider'.padEnd(22))} ${pc.bold('Tier'.padEnd(18))} ${pc.bold('Key'.padEnd(10))} ${pc.bold('Download'.padEnd(12))} ${pc.bold('Notes')}`);
        console.log(`  ${pc.dim('─'.repeat(95))}`);
        for (const p of allProviders) {
            const icon = p.tier === 'FREE API KEY' ? '☁️' : p.tier === 'LOCAL FREE' ? '🖥️' : p.tier === 'EXPERIMENTAL FREE' ? '🧪' : '🔑';
            console.log(`  ${icon} ${p.id.padEnd(20)} ${p.tier.padEnd(18)} ${p.needsKey.padEnd(10)} ${p.needsDownload.padEnd(12)} ${pc.dim(p.notes)}`);
        }
        console.log();
        console.log(pc.dim('  *Keyless experimental providers are not guaranteed stable or private.\n'));
        console.log(pc.dim('  Enable with: hysa experimental on\n'));
    });
    program
        .command('experimental')
        .description('Enable or disable experimental free providers')
        .argument('<state>', 'on or off')
        .action((state) => {
        if (state !== 'on' && state !== 'off') {
            console.log(pc.red('Usage: hysa experimental on|off\n'));
            return;
        }
        const config = getSettings() || {
            currentProvider: 'openrouter',
            currentModel: PROVIDER_DEFAULTS.openrouter.model,
            apiKeys: {},
            ollamaBaseUrl: 'http://localhost:11434',
        };
        const enabled = state === 'on';
        const updated = { ...config, allowExperimentalProviders: enabled };
        updateSettings(updated);
        if (enabled) {
            console.log(pc.yellow('\n  🧪 Experimental free providers enabled.\n'));
            console.log(pc.yellow('  These providers may log prompts, rate-limit, disappear, or change behavior.'));
            console.log(pc.yellow('  Do not send sensitive code to experimental providers.\n'));
        }
        else {
            console.log(pc.green('  Experimental free providers disabled.\n'));
        }
    });
    program
        .command('fallback')
        .description('Show fallback provider status')
        .argument('[action]', 'status or reset', 'status')
        .action(async (action) => {
        if (action === 'reset') {
            resetHealth();
            console.log(pc.green('\n  Provider health has been reset.\n'));
            return;
        }
        const config = loadConfig();
        await printFallbackStatus(config);
        return;
        const healthData = getAllHealth();
        const lastErr = getLastError();
        const lastFb = getLastFallbackUsed();
        console.log(pc.bold(pc.magenta('\n📊 Fallback Status\n')));
        if (config) {
            console.log(`  Current provider: ${PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider}`);
            console.log(`  Current model: ${config.currentModel}`);
        }
        console.log(`  Last fallback: ${lastFb || 'None'}`);
        console.log(`  Last error: ${lastErr ? `${lastErr.provider}/${lastErr.model}: ${lastErr.reason}` : 'None'}`);
        const unhealthy = toHealthSummary();
        if (unhealthy.length > 0) {
            console.log(pc.yellow(`\n  Unhealthy providers:`));
            for (const line of unhealthy)
                console.log(line);
        }
        else {
            console.log(pc.green(`\n  All providers healthy.`));
        }
        console.log();
    });
    program
        .command('search')
        .description('Search the web. Set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.')
        .argument('<query>', 'Search query')
        .option('--max <number>', 'Max results', '5')
        .action(async (query, opts) => {
        const max = Math.min(parseInt(opts.max || '5', 10) || 5, 10);
        try {
            const wsConfig = getWebSearchConfig();
            if (wsConfig.provider === 'none') {
                console.log(pc.yellow('\n  Web search is not configured. Set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.\n'));
                return;
            }
            console.log(pc.cyan(`\n  Searching (${wsConfig.provider})...\n`));
            const results = await searchWeb(query, { maxResults: max });
            if (results.length === 0) {
                if (wsConfig.provider === 'ddg') {
                    console.log(pc.yellow('  No results returned from DuckDuckGo fallback. For reliable search, configure TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.\n'));
                }
                else {
                    console.log(pc.yellow('  No results found.\n'));
                }
                return;
            }
            for (const r of results) {
                console.log(`  ${pc.bold(r.title)}`);
                console.log(`  ${pc.dim(r.url)}`);
                console.log(`  ${r.snippet.slice(0, 200)}`);
                if (r.source)
                    console.log(`  ${pc.dim(`[${r.source}]`)}`);
                console.log();
            }
        }
        catch (err) {
            console.log(pc.red(`  ${err.message}\n`));
        }
    });
    const browserCmd = program.command('browser').description('Browser automation (Playwright)');
    browserCmd
        .command('open')
        .description('Open a URL in the browser')
        .argument('<url>', 'URL to open (http/https only)')
        .action(async (url) => {
        const result = await cliBrowserOpen(url);
        if (result.ok) {
            console.log(`\n  ${pc.green('✓')} ${result.message}\n`);
        }
        else {
            console.log(`\n  ${pc.red('✗')} ${result.message}\n`);
        }
    });
    browserCmd
        .command('screenshot')
        .description('Take a screenshot of the current page')
        .option('--full-page', 'Capture full page (not just viewport)')
        .option('--path <path>', 'Custom save path (inside .hysa/screenshots/)')
        .action(async (opts) => {
        const result = await cliBrowserScreenshot({ fullPage: opts.fullPage, path: opts.path });
        if (result.ok) {
            console.log(`\n  ${pc.green('✓')} ${result.message}\n`);
        }
        else {
            console.log(`\n  ${pc.red('✗')} ${result.message}\n`);
        }
    });
    browserCmd
        .command('text')
        .description('Get visible text content from the current page')
        .action(async () => {
        const result = await cliBrowserText();
        if (result.ok) {
            console.log(`\n  ${pc.green('✓')} ${result.message}`);
            if (result.text) {
                const lines = result.text.split('\n').filter(l => l.trim());
                console.log(`  ${lines.slice(0, 20).join('\n  ')}`);
                if (lines.length > 20)
                    console.log(`  ... (${lines.length - 20} more lines)`);
            }
            console.log();
        }
        else {
            console.log(`\n  ${pc.red('✗')} ${result.message}\n`);
        }
    });
    browserCmd
        .command('snapshot')
        .description('Get an accessibility/ARIA snapshot of the current page')
        .action(async () => {
        const result = await cliBrowserSnapshot();
        if (result.ok) {
            console.log(`\n  ${pc.green('✓')} ${result.message}`);
            if (result.snapshot) {
                const lines = result.snapshot.split('\n').filter(l => l.trim());
                console.log(`  ${lines.slice(0, 30).join('\n  ')}`);
                if (lines.length > 30)
                    console.log(`  ... (${lines.length - 30} more lines)`);
            }
            console.log();
        }
        else {
            console.log(`\n  ${pc.red('✗')} ${result.message}\n`);
        }
    });
    browserCmd
        .command('click')
        .description('Click an element by CSS selector or text')
        .argument('<target>', 'CSS selector or text to click')
        .action(async (target) => {
        const result = await cliBrowserClick(target);
        if (result.ok) {
            console.log(`\n  ${pc.green('✓')} ${result.message}\n`);
        }
        else {
            console.log(`\n  ${pc.red('✗')} ${result.message}\n`);
        }
    });
    browserCmd
        .command('type')
        .description('Type text into an input field')
        .argument('<target>', 'CSS selector or placeholder text')
        .argument('<value>', 'Text to type')
        .action(async (target, value) => {
        const result = await cliBrowserType(target, value);
        if (result.ok) {
            console.log(`\n  ${pc.green('✓')} ${result.message}\n`);
        }
        else {
            console.log(`\n  ${pc.red('✗')} ${result.message}\n`);
        }
    });
    browserCmd
        .command('status')
        .description('Show browser session status')
        .action(async () => {
        const status = await cliBrowserStatus();
        const cfg = getBrowserConfig();
        const pwOk = await checkPlaywrightInstalled();
        const crOk = await checkChromiumInstalled();
        const daemonCfg = getDaemonConfig();
        console.log(`\n  Browser status:`);
        console.log(`    Active: ${status.active ? pc.green('yes') : pc.red('no')}`);
        if (status.active) {
            console.log(`    URL: ${status.url || '(none)'}`);
            console.log(`    Title: ${status.title || '(none)'}`);
            console.log(`    Engine: ${status.browser || '(unknown)'}`);
        }
        if (status.daemon) {
            console.log(`    Daemon PID: ${status.pid}`);
            console.log(`    Daemon port: ${status.port}`);
        }
        console.log(`    Playwright installed: ${pwOk ? pc.green('yes') : pc.red('no')}`);
        console.log(`    Chromium installed: ${crOk === true ? pc.green('yes') : crOk === 'unknown' ? pc.yellow('unknown') : pc.red('no')}`);
        console.log(`    Headless: ${cfg.headless ? pc.green('true') : pc.yellow('false')}`);
        console.log(`    Screenshot dir: ${cfg.screenshotDir}`);
        console.log(`    Daemon support: ${daemonCfg.enabled ? pc.green('enabled') : pc.yellow('disabled')}`);
        console.log(`    Timeout: ${cfg.timeoutMs}ms\n`);
    });
    browserCmd
        .command('close')
        .description('Close the browser session')
        .action(async () => {
        const result = await cliBrowserClose();
        if (result.ok) {
            console.log(`\n  ${pc.green('✓')} ${result.message}\n`);
        }
        else {
            console.log(`\n  ${pc.red('✗')} ${result.message}\n`);
        }
    });
    program
        .command('usage')
        .description('Show provider usage statistics')
        .action(() => {
        const config = loadConfig();
        const usage = getUsage();
        console.log(pc.bold(pc.magenta('\n📈 Usage Statistics\n')));
        if (config) {
            console.log(`  Current provider: ${PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider}`);
            console.log(`  Current model: ${config.currentModel}`);
        }
        console.log(`  Total requests: ${usage.totalRequests}`);
        console.log(`  Total errors: ${usage.totalErrors}`);
        if (usage.lastRequestDuration)
            console.log(`  Last request: ${usage.lastRequestDuration}ms`);
        if (usage.lastRequestTokens)
            console.log(`  Last context: ~${usage.lastRequestTokens} tokens`);
        if (usage.lastError)
            console.log(`  Last error: ${usage.lastError}`);
        console.log(pc.dim('\n  Note: Quota/rate limits are provider-side, not related to context tokens.\n'));
    });
    // ── Brain Commands ──────────────────────────────────
    const brainCmd = program.command('brain').description('Project brain — local project memory and experience logging');
    brainCmd
        .command('init')
        .description('Initialize .hysa/brain files')
        .action(async () => {
        try {
            await initBrainFiles();
            console.log(pc.green('\n✓ Brain initialized at .hysa/brain/\n'));
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    brainCmd
        .command('map')
        .description('Generate/update project-map.json')
        .action(async () => {
        try {
            const map = await generateProjectMap(process.cwd());
            await writeProjectMap(map);
            const sys = map.knownSystems.length > 0 ? map.knownSystems.join(', ') : 'none detected';
            console.log(pc.green(`\n✓ Project map updated (${map.knownSystems.length} systems: ${sys})\n`));
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    brainCmd
        .command('status')
        .description('Show brain status')
        .action(async () => {
        try {
            const status = await getBrainStatus();
            if (!status.exists) {
                console.log(pc.yellow('\n⚠ Brain not initialized. Run: hysa brain init\n'));
                return;
            }
            console.log(pc.bold(pc.magenta('\n🧠 Project Brain Status\n')));
            console.log(`  Directory:  .hysa/brain/`);
            console.log(`  Events:     ${status.eventCount}`);
            console.log(`  Map date:   ${status.projectMapDate || 'never'}`);
            console.log(`  Systems:    ${status.knownSystems.length > 0 ? status.knownSystems.join(', ') : 'none'}`);
            console.log();
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    brainCmd
        .command('recent')
        .description('Show last 10 brain events')
        .action(async () => {
        try {
            const events = await readRecentEvents(10);
            if (events.length === 0) {
                console.log(pc.dim('\n  No events yet.\n'));
                return;
            }
            console.log(pc.bold(pc.magenta('\n🧠 Recent Brain Events\n')));
            for (const e of events) {
                const date = new Date(e.timestamp).toLocaleString();
                console.log(`  ${pc.dim(date)} ${pc.cyan(e.kind.padEnd(20))} ${e.title}`);
                if (e.summary)
                    console.log(`  ${pc.dim('  →')} ${e.summary.slice(0, 120)}`);
                console.log();
            }
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    brainCmd
        .command('note')
        .description('Add a manual note to brain')
        .argument('[text]', 'Note text')
        .action(async (text) => {
        try {
            if (!text) {
                const { input } = await import('@inquirer/prompts');
                text = await input({ message: 'Note:' });
            }
            if (!text) {
                console.log(pc.yellow('No note provided.\n'));
                return;
            }
            await appendBrainEvent({
                kind: 'manual_note',
                title: text.slice(0, 80),
                summary: text,
                tags: ['manual'],
            });
            console.log(pc.green('✓ Note saved.\n'));
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    brainCmd
        .command('lesson')
        .description('Add a lesson learned')
        .argument('<title>', 'Lesson title')
        .argument('<text>', 'Lesson content')
        .action(async (title, text) => {
        try {
            await appendBrainEvent({ kind: 'lesson', title, summary: text, tags: ['lesson'] });
            await appendLesson(title, text, ['lesson']);
            await graphLogLesson(title, text).catch(() => { });
            console.log(pc.green('✓ Lesson saved.\n'));
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    brainCmd
        .command('decision')
        .description('Add a design decision')
        .argument('<title>', 'Decision title')
        .argument('<text>', 'Decision content')
        .action(async (title, text) => {
        try {
            await appendBrainEvent({ kind: 'decision', title, summary: text, tags: ['decision'] });
            await appendDecision(title, text, ['decision']);
            await graphLogDecision(title, text).catch(() => { });
            console.log(pc.green('✓ Decision saved.\n'));
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    // ── Graph Commands ──────────────────────────────────
    const graphCmd = brainCmd.command('graph').description('Experience graph commands');
    graphCmd
        .command('stats')
        .description('Show graph statistics')
        .action(async () => {
        try {
            const stats = await getGraphStats();
            console.log(pc.bold(pc.magenta('\n📊 Experience Graph Stats\n')));
            console.log(`  Nodes:      ${stats.nodeCount}`);
            console.log(`  Edges:      ${stats.edgeCount}`);
            console.log(`  Updated:    ${new Date(stats.updatedAt).toLocaleString()}`);
            if (stats.topKinds.length > 0) {
                console.log(pc.bold('\n  Top Node Kinds:'));
                for (const k of stats.topKinds) {
                    console.log(`    ${pc.cyan(k.kind.padEnd(16))} ${k.count}`);
                }
            }
            console.log();
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    graphCmd
        .command('show')
        .description('Show recent important nodes and edges')
        .action(async () => {
        try {
            const graph = await readExperienceGraph();
            if (graph.nodes.length === 0) {
                console.log(pc.dim('\n  Graph is empty.\n'));
                return;
            }
            console.log(pc.bold(pc.magenta('\n📋 Experience Graph\n')));
            const important = graph.nodes
                .filter(n => ['lesson', 'decision', 'fix', 'bug'].includes(n.kind))
                .slice(0, 15);
            if (important.length > 0) {
                console.log(pc.bold('  Important Nodes:'));
                for (const n of important) {
                    const date = new Date(n.createdAt).toLocaleDateString();
                    console.log(`    ${pc.dim(date)} ${pc.cyan(n.kind.padEnd(12))} ${n.label.slice(0, 60)}`);
                }
            }
            const recent = graph.nodes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10);
            console.log(pc.bold('\n  Recent Nodes:'));
            for (const n of recent) {
                const date = new Date(n.createdAt).toLocaleDateString();
                console.log(`    ${pc.dim(date)} ${pc.cyan(n.kind.padEnd(12))} ${n.label.slice(0, 60)}`);
            }
            console.log();
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    graphCmd
        .command('search')
        .description('Search nodes and edges')
        .argument('<query>', 'Search query')
        .action(async (query) => {
        try {
            const { nodes, edges } = await searchGraph(query);
            if (nodes.length === 0 && edges.length === 0) {
                console.log(pc.dim(`\n  No results for "${query}".\n`));
                return;
            }
            console.log(pc.bold(pc.magenta(`\n🔍 Graph Search: "${query}"\n`)));
            if (nodes.length > 0) {
                console.log(pc.bold(`  Nodes (${nodes.length}):`));
                for (const n of nodes.slice(0, 20)) {
                    console.log(`    ${pc.cyan(n.kind.padEnd(12))} ${n.label.slice(0, 70)}`);
                }
                if (nodes.length > 20)
                    console.log(`    ... and ${nodes.length - 20} more`);
            }
            if (edges.length > 0) {
                console.log(pc.bold(`\n  Edges (${edges.length}):`));
                for (const e of edges.slice(0, 10)) {
                    console.log(`    ${pc.dim(e.kind)} ${e.from.slice(0, 8)} → ${e.to.slice(0, 8)}`);
                }
                if (edges.length > 10)
                    console.log(`    ... and ${edges.length - 10} more`);
            }
            console.log();
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    graphCmd
        .command('compact')
        .description('Remove low-value duplicate/stale nodes')
        .action(async () => {
        try {
            const result = await compactGraph(500);
            console.log(pc.green(`\n✓ Graph compacted: ${result.removedNodes} nodes, ${result.removedEdges} edges removed.\n`));
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    graphCmd
        .command('export')
        .description('Print path to experience-graph.json')
        .action(() => {
        const graphPath = join(process.cwd(), '.hysa/brain/experience-graph.json');
        console.log(`\n  ${graphPath}\n`);
    });
    // `hysa brain graph` without subcommand shows stats
    graphCmd.action(async () => {
        try {
            const stats = await getGraphStats();
            console.log(pc.bold(pc.magenta('\n📊 Experience Graph Stats\n')));
            console.log(`  Nodes:      ${stats.nodeCount}`);
            console.log(`  Edges:      ${stats.edgeCount}`);
            console.log(`  Updated:    ${new Date(stats.updatedAt).toLocaleString()}`);
            if (stats.topKinds.length > 0) {
                console.log(pc.bold('\n  Top Node Kinds:'));
                for (const k of stats.topKinds) {
                    console.log(`    ${pc.cyan(k.kind.padEnd(16))} ${k.count}`);
                }
            }
            console.log();
        }
        catch (err) {
            console.log(pc.red(`\nError: ${err.message}\n`));
        }
    });
    program
        .command('web')
        .description('Start the HYSA Web UI and open in browser')
        .option('-p, --port <number>', 'Port to run on', '8787')
        .option('--no-open', 'Do not auto-open browser')
        .action(async (opts) => {
        const port = parseInt(opts.port || '8787', 10);
        if (isNaN(port) || port < 1 || port > 65535) {
            console.log(pc.red('Invalid port number. Use a port between 1 and 65535.\n'));
            return;
        }
        try {
            const { startWebServer } = await import('./web/server.js');
            await startWebServer(port);
            const shouldOpen = opts.open !== false;
            if (shouldOpen) {
                const url = `http://localhost:${port}/#/chat`;
                try {
                    execSync(`start "" "${url}"`, { stdio: 'ignore', timeout: 3000 });
                }
                catch { }
                console.log(pc.dim(`  ${url}\n`));
            }
        }
        catch (err) {
            console.log(pc.red(`\n  Error: ${err.message}\n`));
        }
        // Keep alive (timer works even without a console in GUI subsystem)
        setInterval(() => { }, 1 << 30);
    });
    // When no arguments (double-click), start web server and open full chat app
    if (process.argv.length <= 2) {
        try {
            const { startWebServer } = await import('./web/server.js');
            await startWebServer(8787);
            const url = 'http://localhost:8787/#/chat';
            try {
                execSync(`start "" "${url}"`, { stdio: 'ignore', timeout: 3000 });
            }
            catch { }
            console.log(`  ${url}\n`);
        }
        catch (err) {
            console.log(`\n  Error: ${err.message}\n`);
        }
        // Keep alive with a timer
        setInterval(() => { }, 1 << 30);
        return;
    }
    await program.parseAsync(process.argv);
}
process.on('SIGINT', () => process.exit(0));
//# sourceMappingURL=cli.js.map