import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ignore from 'ignore';
let cachedInfo = null;
const CACHE_TTL = 10000;
const IGNORE_DEFAULTS = [
    'node_modules', '.git', 'dist', 'build', '.next', '.cache',
    '__pycache__', '*.pyc', '*.log', '.env', '.env.*',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
];
export function getProjectInfo(rootDir) {
    const resolved = resolve(rootDir);
    if (cachedInfo && cachedInfo.dir === resolved && Date.now() - cachedInfo.time < CACHE_TTL) {
        return cachedInfo.data;
    }
    const ig = loadGitignore(resolved);
    const allFiles = [];
    const treeLines = [];
    walkDir(resolved, resolved, ig, allFiles, treeLines);
    const info = analyzeProject(resolved, allFiles, treeLines);
    cachedInfo = { data: info, time: Date.now(), dir: resolved };
    return info;
}
export function invalidateCache() {
    cachedInfo = null;
}
function loadGitignore(rootDir) {
    const ig = ignore().add(IGNORE_DEFAULTS);
    try {
        const gitignorePath = join(rootDir, '.gitignore');
        if (existsSync(gitignorePath)) {
            const content = readFileSync(gitignorePath, 'utf-8');
            ig.add(content);
        }
    }
    catch {
        // ignore errors
    }
    return ig;
}
function walkDir(dir, rootDir, ig, allFiles, treeLines) {
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return;
    }
    entries.sort();
    for (const entry of entries) {
        const fullPath = join(dir, entry);
        const relPath = relative(rootDir, fullPath);
        if (ig.ignores(relPath))
            continue;
        try {
            const st = statSync(fullPath);
            if (st.isDirectory()) {
                treeLines.push(relPath + '/');
                walkDir(fullPath, rootDir, ig, allFiles, treeLines);
            }
            else if (st.isFile()) {
                allFiles.push(relPath);
                treeLines.push(relPath);
            }
        }
        catch {
            // skip inaccessible
        }
    }
}
function analyzeProject(rootDir, allFiles, treeLines) {
    const type = detectProjectType(rootDir, allFiles);
    const framework = detectFramework(type);
    const entryPoints = findEntryPoints(allFiles, type, framework);
    const configFiles = findConfigFiles(allFiles);
    const importantFiles = findImportantFiles(allFiles, entryPoints, configFiles);
    let totalSize = 0;
    for (const file of allFiles) {
        try {
            const st = statSync(join(rootDir, file));
            totalSize += st.size;
        }
        catch { }
    }
    const summary = buildSummary(type, framework, entryPoints, configFiles, allFiles.length);
    return { type, framework, entryPoints, configFiles, importantFiles, fileCount: allFiles.length, totalSize, tree: treeLines.join('\n'), summary };
}
function detectProjectType(rootDir, files) {
    const set = new Set(files.map(f => f.toLowerCase()));
    if (set.has('package.json')) {
        try {
            const pkgPath = join(rootDir, 'package.json');
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps.next)
                return 'Next.js';
            if (deps.react || deps['react-dom'])
                return 'React';
            if (deps.express)
                return 'Express';
            if (deps['@nestjs/core'] || deps.nest)
                return 'NestJS';
            if (deps.vue)
                return 'Vue';
            if (deps['@angular/core'] || deps.angular)
                return 'Angular';
            if (deps['@sveltejs/kit'] || deps.svelte)
                return 'Svelte';
            if (deps.electron)
                return 'Electron';
            if (deps['@remix-run/node'] || deps['@remix-run/react'])
                return 'Remix';
            return 'Node.js';
        }
        catch {
            return 'Node.js';
        }
    }
    if (set.has('pyproject.toml') || set.has('setup.py') || set.has('requirements.txt')) {
        if (set.has('manage.py'))
            return 'Django';
        if (set.has('app.py') || set.has('main.py'))
            return 'Python (Flask?)';
        return 'Python';
    }
    if (set.has('go.mod'))
        return 'Go';
    if (set.has('cargo.toml'))
        return 'Rust';
    if (files.some(f => f.endsWith('.rb')))
        return 'Ruby';
    if (files.some(f => f.endsWith('.java'))) {
        if (files.some(f => f.includes('pom.xml') || f.includes('build.gradle')))
            return 'Java';
        return 'Java';
    }
    if (set.has('composer.json'))
        return 'PHP';
    if (set.has('pubspec.yaml'))
        return 'Flutter/Dart';
    return 'Unknown';
}
function detectFramework(type) {
    return type;
}
function findEntryPoints(files, type, framework) {
    const candidates = [];
    const fileSet = new Set(files);
    const patternsMap = {
        'Next.js': ['pages/index.tsx', 'pages/index.js', 'src/pages/index.tsx', 'app/page.tsx', 'app/layout.tsx', 'src/app/page.tsx'],
        'React': ['src/index.tsx', 'src/index.js', 'src/App.tsx', 'src/App.js', 'index.tsx', 'index.js'],
        'Express': ['src/index.ts', 'src/index.js', 'src/app.ts', 'src/app.js', 'index.ts', 'app.ts', 'server.ts', 'server.js'],
        'Node.js': ['src/index.ts', 'src/index.js', 'index.ts', 'index.js', 'src/main.ts', 'main.ts', 'src/cli.ts', 'cli.ts'],
        'Django': ['manage.py'],
        'Python': ['main.py', 'app.py', 'src/main.py', 'src/app.py'],
        'Go': ['main.go', 'cmd/main.go'],
        'Rust': ['src/main.rs', 'src/lib.rs'],
    };
    const patterns = patternsMap[type] || patternsMap[framework] || [];
    for (const p of patterns) {
        if (fileSet.has(p))
            candidates.push(p);
    }
    if (candidates.length === 0) {
        for (const f of files) {
            if (!f.includes('/') && !f.includes('\\') && (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.tsx'))) {
                const lower = f.toLowerCase();
                if (lower.startsWith('index') || lower.startsWith('main') || lower.startsWith('app') || lower.startsWith('cli')) {
                    candidates.push(f);
                }
            }
        }
    }
    return candidates.slice(0, 5);
}
const CONFIG_FILE_NAMES = [
    'package.json', 'tsconfig.json', '.gitignore', '.env.example',
    'next.config.js', 'next.config.ts', 'vite.config.ts', 'vite.config.js',
    'webpack.config.js', 'eslint.config.js', '.prettierrc',
    'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
    'jest.config.ts', 'jest.config.js', 'vitest.config.ts',
    'tailwind.config.ts', 'tailwind.config.js',
    'pyproject.toml', 'setup.py', 'requirements.txt',
    'go.mod', 'cargo.toml', 'composer.json', 'pubspec.yaml',
    '.editorconfig', '.nvmrc', '.node-version',
];
function findConfigFiles(files) {
    const fileSet = new Set(files.map(f => f.toLowerCase()));
    return CONFIG_FILE_NAMES.filter(c => fileSet.has(c));
}
function findImportantFiles(files, entryPoints, configFiles) {
    const important = new Set();
    for (const f of entryPoints)
        important.add(f);
    for (const f of configFiles)
        important.add(f);
    for (const f of files) {
        const lower = f.toLowerCase();
        if (lower === 'readme.md')
            important.add(f);
    }
    return Array.from(important);
}
function buildSummary(type, framework, entryPoints, configFiles, fileCount) {
    const parts = [];
    parts.push(`Project type: ${type}`);
    if (entryPoints.length > 0)
        parts.push(`Entry points: ${entryPoints.join(', ')}`);
    if (configFiles.length > 0)
        parts.push(`Config files: ${configFiles.join(', ')}`);
    parts.push(`Total files: ${fileCount}`);
    return parts.join(' | ');
}
export function buildProjectTree(rootDir) {
    return getProjectInfo(rootDir).tree;
}
//# sourceMappingURL=builder.js.map