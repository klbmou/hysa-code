import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
const IGNORED_DIRS = new Set([
    'node_modules', 'dist', 'web/dist', '.git', 'github',
    '.hysa', 'coverage', 'build', '.next',
]);
const SRC_DIRS = ['src', 'web', 'client', 'app', 'lib', 'utils'];
const KNOWN_SYSTEM_FILES = {
    'src/cli.ts': [{ system: 'cli', label: 'CLI' }],
    'src/web/api.ts': [{ system: 'web_api', label: 'Web API' }],
    'src/ai/client.ts': [
        { system: 'ai_client', label: 'AI Client' },
    ],
    'src/ai/client-factory.ts': [{ system: 'ai_client', label: 'AI Client' }],
    'src/ai/smart-router.ts': [{ system: 'smart_router', label: 'Smart Router' }],
    'src/ai/task-classifier.ts': [{ system: 'smart_router', label: 'Smart Router' }],
    'src/ai/model-registry.ts': [{ system: 'smart_router', label: 'Smart Router' }],
    'src/ai/model-health.ts': [{ system: 'smart_router', label: 'Smart Router' }],
    'src/config/keys.ts': [{ system: 'provider_config', label: 'Provider Config' }],
    'src/config/provider-detect.ts': [{ system: 'provider_config', label: 'Provider Config' }],
    'src/tools/research-agent.ts': [{ system: 'research_agent', label: 'Research Agent' }],
    'src/tools/web-search.ts': [{ system: 'research_agent', label: 'Research Agent' }],
    'src/tools/entity-detector.ts': [{ system: 'research_agent', label: 'Research Agent' }],
    'src/tools/browser.ts': [{ system: 'browser_tools', label: 'Browser Tools' }],
    'src/tools/browser-daemon.ts': [{ system: 'browser_tools', label: 'Browser Tools' }],
    'src/tools/browser-session.ts': [{ system: 'browser_tools', label: 'Browser Tools' }],
};
const PACKAGE_JSON_KEYS = [
    { key: 'scripts', label: 'Commands' },
    { key: 'dependencies', label: 'Dependencies' },
    { key: 'devDependencies', label: 'Dev Dependencies' },
];
const MODULE_HEURISTICS = {
    'src/ai/': { purpose: 'AI model clients, smart router, and model health tracking', system: 'ai_client' },
    'src/config/': { purpose: 'Configuration loading, provider detection, settings', system: 'provider_config' },
    'src/tools/': { purpose: 'Research agent, web search, entity detection, browser automation', system: 'tools' },
    'src/context/': { purpose: 'Project context building, file ranking, token estimation', system: 'context' },
    'src/prompts/': { purpose: 'System prompt templates and prompt mode resolution', system: 'prompts' },
    'src/files/': { purpose: 'File reading and writing utilities', system: 'files' },
    'src/utils/': { purpose: 'Session tracking, git, search, secrets detection, doctor', system: 'utils' },
    'src/agent/': { purpose: 'Agent modes, task management, code analysis tools', system: 'agent' },
    'src/skills/': { purpose: 'Built-in skill system', system: 'skills' },
    'src/brain/': { purpose: 'Project brain — local memory and experience logging', system: 'brain' },
    'src/web/': { purpose: 'Web UI server and API routes', system: 'web_api' },
};
async function isDir(p) {
    try {
        return (await stat(p)).isDirectory();
    }
    catch {
        return false;
    }
}
async function scanDir(dir, root, depth = 0) {
    if (depth > 4)
        return [];
    const results = [];
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = join(dir, entry.name);
            const rel = relative(root, full).replace(/\\/g, '/');
            if (entry.isDirectory()) {
                if (IGNORED_DIRS.has(entry.name))
                    continue;
                const sub = await scanDir(full, root, depth + 1);
                results.push(...sub);
            }
            else if (entry.isFile() && /\.(ts|tsx|js|jsx|json|md|mjs)$/.test(entry.name)) {
                results.push(rel);
            }
        }
    }
    catch { }
    return results;
}
function detectProjectType(files) {
    if (files.some(f => f.startsWith('web/') || f === 'web/index.html'))
        return 'React + Vite';
    if (files.some(f => f.startsWith('src/') || f === 'index.html'))
        return 'React';
    if (files.some(f => f.endsWith('.csproj') || f.endsWith('.sln')))
        return 'C# / .NET';
    if (files.some(f => f.startsWith('lib/') && (f.endsWith('.dart') || f.endsWith('.rb'))))
        return 'Dart / Ruby';
    if (existsSync('package.json'))
        return 'Node.js';
    return 'Unknown';
}
function findImportantFiles(files) {
    const important = {};
    const patterns = [
        [/package\.json$/, 'Project dependencies and scripts'],
        [/tsconfig\.json$/, 'TypeScript configuration'],
        [/vite\.config\.(ts|js)$/, 'Vite build configuration'],
        [/index\.html$/, 'App entry HTML'],
        [/main\.tsx?$/, 'App entry point'],
        [/App\.tsx?$/, 'Root React component'],
        [/\.env\.example$/, 'Environment variable template'],
        [/docker-compose\.(yml|yaml)$/, 'Docker compose configuration'],
        [/Dockerfile$/, 'Docker build file'],
    ];
    for (const f of files) {
        for (const [re, desc] of patterns) {
            if (re.test(f)) {
                important[f] = desc;
                break;
            }
        }
    }
    return important;
}
function detectModules(files) {
    const modules = {};
    for (const [prefix, info] of Object.entries(MODULE_HEURISTICS)) {
        const matched = files.filter(f => f.startsWith(prefix));
        if (matched.length > 0) {
            modules[info.system] = {
                purpose: info.purpose,
                files: matched.sort().slice(0, 20),
            };
        }
    }
    // Dependencies
    if (modules.ai_client && modules.smart_router) {
        modules.ai_client.dependsOn = ['smart_router'];
    }
    if (modules.provider_config) {
        if (modules.ai_client)
            modules.provider_config.dependsOn = ['ai_client'];
        if (modules.smart_router)
            modules.provider_config.dependsOn = ['smart_router'];
    }
    if (modules.research_agent) {
        modules.research_agent.dependsOn = ['web_search'];
    }
    if (modules.browser_tools) {
        modules.browser_tools.dependsOn = ['tools'];
    }
    return modules;
}
async function detectCommands(files) {
    const commands = {};
    if (files.some(f => f === 'src/cli.ts')) {
        commands.cli = { purpose: 'Main CLI interface', entryFile: 'src/cli.ts' };
    }
    if (files.some(f => f === 'src/web/api.ts' || f === 'src/web/server.ts')) {
        commands.web = { purpose: 'Web UI server', entryFile: 'src/web/server.ts' };
    }
    if (files.some(f => f.startsWith('src/skills/'))) {
        commands.skills = { purpose: 'Built-in skill system', entryFile: 'src/skills/' };
    }
    // package.json scripts
    if (existsSync('package.json')) {
        try {
            const pkgRaw = await readFile('package.json', 'utf8');
            const pkg = JSON.parse(pkgRaw);
            if (pkg.scripts) {
                for (const [name, script] of Object.entries(pkg.scripts)) {
                    if (['build', 'dev', 'start', 'check', 'test'].includes(name)) {
                        commands[name] = { purpose: script };
                    }
                }
            }
        }
        catch { }
    }
    return commands;
}
function detectKnownSystems(files) {
    const systems = new Set();
    for (const f of files) {
        const matches = KNOWN_SYSTEM_FILES[f];
        if (matches) {
            for (const m of matches) {
                systems.add(m.label);
            }
        }
    }
    return Array.from(systems).sort();
}
export async function generateProjectMap(projectRoot) {
    const files = await scanDir(projectRoot, projectRoot);
    const map = {
        version: 1,
        updatedAt: new Date().toISOString(),
        projectType: detectProjectType(files),
        importantFiles: findImportantFiles(files),
        modules: detectModules(files),
        commands: await detectCommands(files),
        knownSystems: detectKnownSystems(files),
    };
    return map;
}
//# sourceMappingURL=project-map.js.map