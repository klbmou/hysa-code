import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';
const IGNORED_PATTERNS = [
    '.env',
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.cache',
    '__pycache__',
    '*.pyc',
    '*.log',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
];
const GENERATED_DIRS = new Set(['dist', 'build', 'out', '.next', 'coverage', '__pycache__']);
export function isGeneratedOutput(filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    for (let i = 0; i < parts.length - 1; i++) {
        if (GENERATED_DIRS.has(parts[i]))
            return true;
    }
    return false;
}
// Fallback parent dirs for files not in WELL_KNOWN_SEARCH_ORDER
const FALLBACK_PARENT_DIRS = ['web', '', 'public', 'app', 'src', 'web/src', 'client', 'client/public', 'client/src'];
// Explicit search order for well-known files — ensures correct priority
const WELL_KNOWN_SEARCH_ORDER = {
    'index.html': [
        'web/index.html',
        'index.html',
        'public/index.html',
        'app/index.html',
        'src/index.html',
        'client/index.html',
        'client/public/index.html',
        'web/src/index.html',
        'client/src/index.html',
    ],
    'App.tsx': [
        'web/src/App.tsx',
        'src/App.tsx',
        'App.tsx',
        'web/App.tsx',
        'client/App.tsx',
        'public/App.tsx',
        'app/App.tsx',
        'client/src/App.tsx',
        'client/public/App.tsx',
    ],
    'App.jsx': [
        'web/src/App.jsx',
        'src/App.jsx',
        'App.jsx',
        'web/App.jsx',
        'client/App.jsx',
        'public/App.jsx',
        'app/App.jsx',
        'client/src/App.jsx',
        'client/public/App.jsx',
    ],
    'main.tsx': [
        'web/src/main.tsx',
        'src/main.tsx',
        'main.tsx',
        'web/main.tsx',
        'client/main.tsx',
        'public/main.tsx',
        'app/main.tsx',
        'client/src/main.tsx',
        'client/public/main.tsx',
    ],
    'main.jsx': [
        'web/src/main.jsx',
        'src/main.jsx',
        'main.jsx',
        'web/main.jsx',
        'client/main.jsx',
        'public/main.jsx',
        'app/main.jsx',
        'client/src/main.jsx',
        'client/public/main.jsx',
    ],
};
const EXTENSION_ALTERNATIVES = {
    'App.tsx': ['App.jsx'],
    'App.jsx': ['App.tsx'],
    'main.tsx': ['main.jsx'],
    'main.jsx': ['main.tsx'],
};
export function readFile(filePath) {
    try {
        if (!existsSync(filePath))
            return null;
        return readFileSync(filePath, 'utf-8');
    }
    catch {
        return null;
    }
}
function addUnique(paths, candidate) {
    if (!paths.includes(candidate))
        paths.push(candidate);
}
export function resolveFileReadPath(filePath) {
    const paths = [filePath];
    const basename = filePath.split(/[\/\\]/).pop() || '';
    if (WELL_KNOWN_SEARCH_ORDER[basename]) {
        // Use explicit search order for well-known files
        for (const candidate of WELL_KNOWN_SEARCH_ORDER[basename]) {
            addUnique(paths, candidate);
        }
        // Also try extension alternatives (e.g. App.tsx → App.jsx)
        const altExts = EXTENSION_ALTERNATIVES[basename];
        if (altExts) {
            for (const alt of altExts) {
                const altOrder = WELL_KNOWN_SEARCH_ORDER[alt];
                if (altOrder) {
                    for (const candidate of altOrder) {
                        addUnique(paths, candidate);
                    }
                }
            }
        }
    }
    else {
        // Fallback: try common parent dirs
        for (const dir of FALLBACK_PARENT_DIRS) {
            const candidate = dir ? `${dir}/${basename}` : basename;
            addUnique(paths, candidate);
        }
    }
    // Filter out generated output from auto-resolution candidates
    // but always keep the original path the model asked for
    const generatedPaths = paths.filter(p => p !== filePath && isGeneratedOutput(p));
    return paths.filter(p => !generatedPaths.includes(p));
}
export function shouldIgnore(filePath, rootDir) {
    const rel = relative(rootDir, filePath).replace(/\\/g, '/');
    const parts = rel.split('/');
    const fileName = parts[parts.length - 1];
    return IGNORED_PATTERNS.some(pattern => {
        if (pattern.startsWith('*.')) {
            return fileName.endsWith(pattern.slice(1));
        }
        return rel.includes(pattern) || parts.some(part => part === pattern);
    });
}
//# sourceMappingURL=reader.js.map