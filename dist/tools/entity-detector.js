import { isOnlyGreeting } from '../ai/client.js';
const COMMON_PROGRAMMING_CONCEPTS = new Set([
    'react', 'vue', 'angular', 'svelte', 'ember', 'backbone', 'lit',
    'node', 'node.js', 'deno', 'bun',
    'typescript', 'javascript', 'js', 'ts', 'python', 'java', 'c#', 'c++', 'ruby', 'php', 'go', 'rust', 'swift', 'kotlin',
    'function', 'variable', 'array', 'object', 'class', 'component', 'module',
    'package.json', 'npm', 'yarn', 'pnpm', 'git', 'github',
    'api', 'rest', 'graphql', 'restful', 'soap', 'grpc',
    'docker', 'kubernetes', 'k8s', 'css', 'html', 'json', 'xml', 'yaml', 'toml',
    'unit test', 'integration test', 'e2e', 'ci/cd', 'pipeline',
    'scope', 'closure', 'promise', 'async', 'await', 'callback', 'event loop',
    'dom', 'event', 'hook', 'state', 'props', 'context', 'reducer',
    'module', 'import', 'export', 'default', 'interface', 'type', 'enum',
    'server', 'client', 'middleware', 'route', 'controller', 'service',
    'database', 'sql', 'nosql', 'schema', 'query', 'migration', 'orm',
    'algorithm', 'data structure', 'complexity', 'big o',
    'compiler', 'interpreter', 'runtime', 'framework', 'library', 'sdk',
    'dependency', 'package', 'repository', 'readme', 'license', 'contributing',
    'devops', 'agile', 'sprint', 'scrum', 'waterfall', 'kanban',
    'ide', 'editor', 'vscode', 'vim', 'emacs', 'webstorm',
    'regex', 'regexp', 'regular expression',
    'http', 'https', 'tcp', 'udp', 'ip', 'dns', 'ssl', 'tls',
    'json', 'xml', 'csv', 'markdown', 'md',
    'jwt', 'oauth', 'session', 'cookie', 'token', 'auth',
    'ui', 'ux', 'gui', 'cli',
    'localhost', 'port', 'endpoint', 'middleware',
    'microservice', 'monolith', 'serverless', 'lambda',
    'oop', 'fp', 'functional', 'object-oriented',
    'ci', 'cd', 'deploy', 'build', 'compile', 'bundle',
]);
const SHORT_ENTITY_WORDS = new Set([
    '@', 'he', 'she', 'it', 'him', 'her', 'his', 'they', 'them',
    'who', 'what', 'where', 'when', 'why', 'how',
    'is', 'are', 'was', 'were', 'am', 'be', 'been',
    'the', 'a', 'an', 'this', 'that', 'these', 'those',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
]);
function isCommonProgrammingConcept(name) {
    return COMMON_PROGRAMMING_CONCEPTS.has(name.toLowerCase().trim());
}
export function looksLikeHandle(s) {
    const trimmed = s.trim();
    if (!trimmed)
        return false;
    if (trimmed.startsWith('@'))
        return trimmed.length > 1;
    if (trimmed.includes(' '))
        return false;
    if (trimmed.length < 3)
        return false;
    if (SHORT_ENTITY_WORDS.has(trimmed.toLowerCase()))
        return false;
    if (isCommonProgrammingConcept(trimmed))
        return false;
    if (trimmed.length > 20)
        return false;
    if (/^[a-zA-Z0-9_.-]+$/.test(trimmed) && /[a-zA-Z]/.test(trimmed))
        return true;
    if (/^[A-Z][a-z]+[A-Z]/.test(trimmed))
        return true;
    if (/[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed) && /^[a-zA-Z0-9]+$/.test(trimmed))
        return true;
    // Non-Latin scripts (Arabic, Cyrillic, CJK, etc.) — single word
    if (!/^[a-zA-Z0-9\s]+$/.test(trimmed) && /[\u0600-\u06FF\u4E00-\u9FFF\u0400-\u04FF]/.test(trimmed)) {
        return true;
    }
    return false;
}
function looksLikeName(s) {
    const trimmed = s.trim();
    if (!trimmed)
        return false;
    if (trimmed.length < 2 || trimmed.length > 50)
        return false;
    // @handle
    if (trimmed.startsWith('@'))
        return trimmed.length > 1;
    // Pure punctuation or symbols
    if (/^[^a-zA-Z0-9\u0600-\u06FF\u4E00-\u9FFF\u0400-\u04FF]+$/.test(trimmed))
        return false;
    const lower = trimmed.toLowerCase();
    // Common entity words
    if (SHORT_ENTITY_WORDS.has(lower))
        return false;
    // Greetings
    if (/^(hi|hello|hey|salam|مرحبا|thanks|thank you|ok|okay|goodbye|bye)$/i.test(trimmed))
        return false;
    // Programming concepts
    if (isCommonProgrammingConcept(trimmed))
        return false;
    // Code-like: contains `=` or `{` or `(` etc
    if (/[={}().;]/.test(trimmed))
        return false;
    // Has file extension
    if (/\.\w{2,4}$/.test(trimmed))
        return false;
    // Looks like a path
    if (/^(\/|[a-zA-Z]:\\)/.test(trimmed))
        return false;
    // Single word, all lowercase or mixed: could be a username (yayahabes, ruflo, graphify)
    if (!trimmed.includes(' ') && trimmed.length >= 3) {
        if (/^[a-z][a-z0-9_.-]+$/.test(trimmed) && /[a-z]{3}/.test(trimmed))
            return true;
        if (/^[a-zA-Z]+$/.test(trimmed) && trimmed.length <= 20)
            return true;
    }
    // Starts with uppercase or has mixed case (potential name)
    if (/^[A-Z\u0600-\u06FF]/.test(trimmed)) {
        const words = trimmed.split(/\s+/);
        if (words.length <= 4)
            return true;
    }
    // Non-Latin scripts (Arabic, CJK, Cyrillic)
    if (/[\u0600-\u06FF\u4E00-\u9FFF\u0400-\u04FF]/.test(trimmed)) {
        const words = trimmed.split(/\s+/);
        if (words.length <= 4)
            return true;
    }
    return false;
}
export function isEntityFollowUpQuery(message) {
    const trimmed = message.trim().toLowerCase();
    if (/^who\s+(is|are|was|were)\s+(he|she|it|they|this|that|this\s+person|this\s+user|this\s+account|this\s+guy|this\s+girl|this\s+dev|this\s+handle|this\s+username|this\s+name)/i.test(trimmed))
        return true;
    if (/^what\s+(is|are)\s+(this|that|it|he|she|this\s+thing|this\s+name|this\s+handle)/i.test(trimmed))
        return true;
    if (/^tell\s+me\s+(more|about)\s+(him|her|it|this|this\s+person)/i.test(trimmed))
        return true;
    if (/^من\s+(هو|هذه|هذا)\s*(الشخص|المستخدم|الاسم|الاكونت)?$/i.test(trimmed))
        return true;
    if (/^ما\s+هو\s+(هذا|هذه)/i.test(trimmed))
        return true;
    return false;
}
const PRONOUNS = new Set([
    'he', 'she', 'it', 'they', 'him', 'her', 'them', 'we', 'you', 'i', 'me',
    'this', 'that', 'these', 'those',
]);
function isFollowUpName(name) {
    const lower = name.trim().toLowerCase();
    return PRONOUNS.has(lower);
}
export function isEntityLookupQuery(message) {
    const trimmed = message.trim();
    const whoMatch = trimmed.match(/^who\s+(?:is|are|was|were)\s+(.+)/i);
    if (whoMatch) {
        const name = whoMatch[1].trim();
        if (!name)
            return false;
        if (isFollowUpName(name))
            return false;
        if (name.match(/^(the|a|an|this|that|these|those|my|your|his|her|its|our|their)\s/i))
            return false;
        return true;
    }
    if (/^من\s+هو\s+(.+)/i.test(trimmed))
        return true;
    const whatMatch = trimmed.match(/^what\s+(?:is|are)\s+(.+)/i);
    if (whatMatch) {
        const name = whatMatch[1].trim().toLowerCase();
        if (!name)
            return false;
        if (isFollowUpName(name))
            return false;
        if (isCommonProgrammingConcept(name))
            return false;
        if (name.match(/^(the|a|an|this|that|these|those|my|your|his|her|its|our|their|a\s+|an\s+)\s/i))
            return false;
        if (name.length > 40)
            return false;
        return true;
    }
    return false;
}
export function extractEntityName(message) {
    const trimmed = message.trim();
    const whoMatch = trimmed.match(/^who\s+(?:is|are|was|were)\s+(.+)/i);
    if (whoMatch)
        return whoMatch[1].trim();
    const whatMatch = trimmed.match(/^what\s+(?:is|are)\s+(.+)/i);
    if (whatMatch) {
        const name = whatMatch[1].trim();
        if (isCommonProgrammingConcept(name.toLowerCase()))
            return null;
        return name;
    }
    const arWhoMatch = trimmed.match(/^من\s+هو\s+(.+)/i);
    if (arWhoMatch)
        return arWhoMatch[1].trim();
    return null;
}
const ACTION_WORDS = /\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|scan|symbol|import|open|check|remove|delete|rename|move|copy|refactor|install|upgrade|build|compile|test|deploy)\b/i;
export function shouldSearchEntity(message, previousUserMessage) {
    const trimmed = message.trim();
    if (isOnlyGreeting(trimmed)) {
        return { shouldSearch: false, query: null };
    }
    if (ACTION_WORDS.test(trimmed)) {
        return { shouldSearch: false, query: null };
    }
    if (trimmed.startsWith('/')) {
        return { shouldSearch: false, query: null };
    }
    // Case 1: Follow-up query referencing previous message
    // "who is he", "من هو", etc. when previous was a name/handle
    if (isEntityFollowUpQuery(trimmed)) {
        if (previousUserMessage) {
            const prev = previousUserMessage.trim();
            if (prev.length < 50 && !prev.startsWith('/') && looksLikeName(prev)) {
                return { shouldSearch: true, query: prev };
            }
        }
        // Follow-up with no valid previous context: do NOT search
        return { shouldSearch: false, query: null };
    }
    // Case 2: Explicit "who is X" or "what is X" where X looks like an entity
    if (isEntityLookupQuery(trimmed)) {
        const entity = extractEntityName(trimmed);
        if (entity) {
            if (looksLikeHandle(entity) || entity.startsWith('@')) {
                return { shouldSearch: true, query: entity };
            }
            if (/^who\s+(?:is|are|was|were)\s+/i.test(trimmed)) {
                return { shouldSearch: true, query: entity };
            }
        }
    }
    // Case 3: Message itself looks like a standalone handle/name
    if (trimmed.length < 50 && looksLikeName(trimmed)) {
        return { shouldSearch: true, query: trimmed };
    }
    return { shouldSearch: false, query: null };
}
//# sourceMappingURL=entity-detector.js.map