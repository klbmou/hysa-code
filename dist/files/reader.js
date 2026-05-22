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
const COMMON_PARENT_DIRS = ['', 'public', 'app', 'src', 'client/src', 'client'];
const WELL_KNOWN_FILES = new Set([
    'index.html',
    'App.tsx', 'App.jsx',
    'main.tsx', 'main.jsx',
    'vite.config.ts', 'vite.config.js',
]);
export function resolveFileReadPath(filePath) {
    const paths = [filePath];
    const basename = filePath.split(/[\/\\]/).pop() || '';
    if (WELL_KNOWN_FILES.has(basename)) {
        for (const dir of COMMON_PARENT_DIRS) {
            const candidate = dir ? `${dir}/${basename}` : basename;
            if (!paths.includes(candidate)) {
                paths.push(candidate);
            }
        }
    }
    return paths;
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