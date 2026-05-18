import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const SEARCH_IGNORE = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.cache',
    '__pycache__', '.venv', 'venv', 'env', '.env', 'coverage',
]);
export function grepSearch(rootDir, pattern, maxResults = 20) {
    const results = [];
    const regex = tryCreateRegex(pattern);
    if (!regex)
        return results;
    try {
        searchInDir(rootDir, rootDir, regex, results, maxResults);
    }
    catch {
        // stop on any error
    }
    return results;
}
function tryCreateRegex(pattern) {
    try {
        return new RegExp(pattern, 'gi');
    }
    catch {
        try {
            return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        }
        catch {
            return null;
        }
    }
}
function searchInDir(dir, rootDir, regex, results, maxResults) {
    if (results.length >= maxResults)
        return;
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (results.length >= maxResults)
            return;
        if (SEARCH_IGNORE.has(entry))
            continue;
        const fullPath = join(dir, entry);
        try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
                searchInDir(fullPath, rootDir, regex, results, maxResults);
            }
            else if (stat.isFile() && isSearchableFile(entry)) {
                searchInFile(fullPath, rootDir, regex, results, maxResults);
            }
        }
        catch {
            // skip inaccessible
        }
    }
}
const SEARCHABLE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.json', '.yaml', '.yml', '.toml',
    '.md', '.txt', '.html', '.css', '.scss', '.less',
    '.py', '.rb', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp',
    '.sh', '.bash', '.zsh', '.ps1',
    '.env', '.gitignore', '.dockerfile',
    '.xml', '.svg', '.sql',
    '.vue', '.svelte', '.astro',
    '.php', '.swift', '.kt', '.scala',
]);
function isSearchableFile(filename) {
    const dot = filename.lastIndexOf('.');
    if (dot === -1)
        return false;
    const ext = filename.slice(dot).toLowerCase();
    return SEARCHABLE_EXTENSIONS.has(ext);
}
const MAX_FILE_SIZE = 1024 * 100;
function searchInFile(filePath, rootDir, regex, results, maxResults) {
    try {
        const stat = statSync(filePath);
        if (stat.size > MAX_FILE_SIZE)
            return;
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const relPath = relative(rootDir, filePath);
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
                results.push({
                    file: relPath,
                    line: i + 1,
                    content: lines[i].trim().slice(0, 200),
                });
            }
        }
    }
    catch {
        // skip unreadable
    }
}
export function findFiles(rootDir, filename) {
    const results = [];
    const lowerName = filename.toLowerCase();
    try {
        findFilesInDir(rootDir, rootDir, lowerName, results);
    }
    catch { }
    return results;
}
function findFilesInDir(dir, rootDir, filename, results) {
    if (results.length >= 50)
        return;
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (results.length >= 50)
            return;
        if (SEARCH_IGNORE.has(entry))
            continue;
        const fullPath = join(dir, entry);
        try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
                findFilesInDir(fullPath, rootDir, filename, results);
            }
            else if (stat.isFile() && entry.toLowerCase().includes(filename)) {
                results.push(relative(rootDir, fullPath));
            }
        }
        catch {
            // skip inaccessible
        }
    }
}
//# sourceMappingURL=searcher.js.map