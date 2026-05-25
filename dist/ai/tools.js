const VALID_TOOL_TYPES = new Set([
    'read_file', 'edit_file', 'execute_command',
    'list_symbols', 'find_references', 'search_imports',
    'summarize_file', 'explain_function',
]);
// ── Protected file detection ─────────────────────────
const PROTECTED_FILE_PATTERNS = [
    /(^|[\/\\])\.env($|[\/\\.])/i,
    /(^|[\/\\])node_modules[\/\\]/,
    /(^|[\/\\])\.git[\/\\]/,
    /(^|[\/\\])dist[\/\\]/,
    /(^|[\/\\])build[\/\\]/,
    /package-lock\.json$/i,
];
export function isProtectedFilePath(filePath) {
    if (PROTECTED_FILE_PATTERNS.some(p => p.test(filePath)))
        return true;
    const basename = filePath.split(/[\/\\]/).pop() || '';
    if (/^\.env($|\.)/i.test(basename))
        return true;
    if (/\b(secret|key|token)\b/i.test(basename))
        return true;
    return false;
}
export const PROTECTED_FILE_MESSAGE = 'Blocked: HYSA will not edit .env or secret files.';
// ── Param normalization ──────────────────────────────
const PARAM_ALIASES = {
    file: 'filePath',
    path: 'filePath',
    content: 'newContent',
    new_content: 'newContent',
    cmd: 'command',
};
export function normalizeToolParams(params) {
    const normalized = {};
    for (const [key, value] of Object.entries(params)) {
        const mappedKey = PARAM_ALIASES[key] || key;
        normalized[mappedKey] = value;
    }
    return normalized;
}
// ── Safe JSON extraction ─────────────────────────────
function safeExtractJSON(text, startIdx) {
    const braceStart = text.indexOf('{', startIdx);
    if (braceStart === -1)
        return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = braceStart; i < text.length; i++) {
        const char = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (char === '\\' && inString) {
            escape = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (!inString) {
            if (char === '{')
                depth++;
            if (char === '}')
                depth--;
            if (depth === 0) {
                const json = text.substring(braceStart, i + 1);
                return { json, endIdx: i + 1 };
            }
        }
    }
    return null;
}
function tryParseJSON(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function safeParseJSON(raw) {
    // First try direct parse
    const result = tryParseJSON(raw);
    if (result)
        return result;
    // Try removing trailing garbage after closing brace
    const braceEnd = raw.lastIndexOf('}');
    if (braceEnd !== -1 && braceEnd < raw.length - 1) {
        const cleaned = raw.substring(0, braceEnd + 1);
        const r2 = tryParseJSON(cleaned);
        if (r2)
            return r2;
    }
    // Try removing trailing spaces/quotes
    const trimmed = raw.replace(/[^}]*$/, '');
    if (trimmed !== raw) {
        const r3 = tryParseJSON(trimmed);
        if (r3)
            return r3;
    }
    return null;
}
function extractAndParseJSON(text, startIdx) {
    const extracted = safeExtractJSON(text, startIdx);
    if (!extracted)
        return null;
    const params = safeParseJSON(extracted.json);
    if (!params)
        return null;
    return { params, endIdx: extracted.endIdx };
}
// ── Parsers ──────────────────────────────────────────
function parseParamsFromFunctionStyle(text) {
    const params = {};
    const pairRegex = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
    let match;
    while ((match = pairRegex.exec(text)) !== null) {
        const key = match[1];
        let value = match[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        params[key] = value;
    }
    return normalizeToolParams(params);
}
function parseXmlFormat(content) {
    const calls = [];
    // Match <tool_call>...<tool_name>type</tool_name>...{json}...</tool_call>
    // Also handle case where JSON has trailing garbage after closing brace
    let searchIdx = 0;
    while (true) {
        const tcStart = content.indexOf('<tool_call>', searchIdx);
        if (tcStart === -1)
            break;
        const tcEnd = content.indexOf('</tool_call>', tcStart);
        if (tcEnd === -1)
            break;
        const block = content.substring(tcStart + 11, tcEnd);
        const nameMatch = block.match(/<tool_name>\s*(\w+)\s*<\/tool_name>/);
        if (!nameMatch) {
            searchIdx = tcEnd + 12;
            continue;
        }
        const type = nameMatch[1].trim();
        if (!VALID_TOOL_TYPES.has(type)) {
            searchIdx = tcEnd + 12;
            continue;
        }
        // Try to find JSON in the block
        const extracted = extractAndParseJSON(block, nameMatch.index);
        if (extracted) {
            calls.push({ type: type, params: extracted.params });
        }
        searchIdx = tcEnd + 12;
    }
    return calls;
}
function parseAngleBracketFormat(content) {
    const calls = [];
    const regex = /<\|tool_call_start\|>\s*\[(\w+)\(([\s\S]*?)\)\s*\]\s*<\|tool_call_end\|>/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const type = match[1].trim();
        if (!VALID_TOOL_TYPES.has(type))
            continue;
        const params = parseParamsFromFunctionStyle(match[2]);
        calls.push({ type: type, params });
    }
    return calls;
}
function parseFunctionStyleFormat(content) {
    const calls = [];
    let stripped = content
        .replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, '')
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    const regex = /(?<!\w)(\w+)\(([\s\S]*?)\)/g;
    let match;
    while ((match = regex.exec(stripped)) !== null) {
        const type = match[1].trim();
        if (!VALID_TOOL_TYPES.has(type))
            continue;
        const params = parseParamsFromFunctionStyle(match[2]);
        if (Object.keys(params).length === 0)
            continue;
        calls.push({ type: type, params });
    }
    return calls;
}
function parseToolNameFormat(content) {
    const calls = [];
    const cleaned = content
        .replace(/```[\s\S]*?```/g, (match) => {
        const inner = match.replace(/```\w*\n?/, '').replace(/```$/, '');
        return inner;
    });
    const tryMatch = (text) => {
        let searchIdx = 0;
        while (true) {
            const nameStart = text.indexOf('<tool_name>', searchIdx);
            if (nameStart === -1)
                break;
            const nameEnd = text.indexOf('</tool_name>', nameStart);
            if (nameEnd === -1)
                break;
            const type = text.substring(nameStart + 11, nameEnd).trim();
            if (!VALID_TOOL_TYPES.has(type)) {
                searchIdx = nameEnd + 12;
                continue;
            }
            // Look for JSON after </tool_name>
            const extracted = extractAndParseJSON(text, nameEnd + 12);
            if (extracted) {
                calls.push({ type: type, params: extracted.params });
                searchIdx = extracted.endIdx;
            }
            else {
                searchIdx = nameEnd + 12;
            }
        }
    };
    tryMatch(content);
    if (calls.length === 0) {
        tryMatch(cleaned);
    }
    return calls;
}
function parseArgumentFormat(content) {
    const calls = [];
    let searchIdx = 0;
    while (true) {
        const tcStart = content.indexOf('<tool_call>', searchIdx);
        if (tcStart === -1)
            break;
        const tcEnd = content.indexOf('</tool_call>', tcStart);
        if (tcEnd === -1)
            break;
        const block = content.substring(tcStart + 11, tcEnd);
        const nameMatch = block.match(/<tool_name>\s*(\w+)\s*<\/tool_name>/);
        if (!nameMatch) {
            searchIdx = tcEnd + 12;
            continue;
        }
        const type = nameMatch[1].trim();
        if (!VALID_TOOL_TYPES.has(type)) {
            searchIdx = tcEnd + 12;
            continue;
        }
        // Look for <arguments>...</arguments> with robust JSON extraction
        const argsMatch = block.match(/<arguments>\s*([\s\S]*?)\s*<\/arguments>/);
        if (argsMatch) {
            const parsed = safeParseJSON(argsMatch[1]);
            if (parsed) {
                calls.push({ type: type, params: parsed });
                searchIdx = tcEnd + 12;
                continue;
            }
        }
        // Fallback: find JSON directly in block
        const extracted = extractAndParseJSON(block, nameMatch.index);
        if (extracted) {
            calls.push({ type: type, params: extracted.params });
        }
        searchIdx = tcEnd + 12;
    }
    return calls;
}
function parseJsonFormat(content) {
    const calls = [];
    const jsonRegex = /({[\s\S]*?"type"\s*:\s*"(\w+)"[\s\S]*?})/g;
    let match;
    while ((match = jsonRegex.exec(content)) !== null) {
        const type = match[2].trim();
        if (!VALID_TOOL_TYPES.has(type))
            continue;
        try {
            const parsed = JSON.parse(match[1]);
            const { type: _t, ...params } = parsed;
            calls.push({ type: type, params: normalizeToolParams(params) });
        }
        catch {
            // malformed
        }
    }
    return calls;
}
export function parseToolCalls(content) {
    const allCalls = [];
    allCalls.push(...parseArgumentFormat(content));
    allCalls.push(...parseXmlFormat(content));
    allCalls.push(...parseAngleBracketFormat(content));
    allCalls.push(...parseToolNameFormat(content));
    allCalls.push(...parseFunctionStyleFormat(content));
    allCalls.push(...parseJsonFormat(content));
    // Deduplicate by type + params
    const seen = new Set();
    return allCalls.filter(c => {
        const key = `${c.type}:${JSON.stringify(c.params)}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
export function findToolCallErrors(content) {
    const errors = [];
    // Detect unknown tool types in XML tool_call blocks
    const xmlBlockRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let m;
    while ((m = xmlBlockRegex.exec(content)) !== null) {
        const nameMatch = m[1].match(/<tool_name>\s*(\w+)\s*<\/tool_name>/);
        if (nameMatch) {
            const toolType = nameMatch[1].trim();
            if (!VALID_TOOL_TYPES.has(toolType)) {
                errors.push(`Unknown tool type "${toolType}" in <tool_call> block`);
            }
        }
        else if (m[1].includes('<tool_name>')) {
            // Has tool_name tag but couldn't parse — likely malformed
            errors.push('Malformed <tool_name> tag in <tool_call> block');
        }
    }
    // Detect unknown tool types in angle-bracket format
    const angleRegex = /<\|tool_call_start\|>\s*\[(\w+)\(/g;
    while ((m = angleRegex.exec(content)) !== null) {
        const toolType = m[1].trim();
        if (!VALID_TOOL_TYPES.has(toolType)) {
            errors.push(`Unknown tool type "${toolType}" in angle-bracket format`);
        }
    }
    // Detect unknown tool types in JSON format
    const jsonRegex = /"type"\s*:\s*"(\w+)"/g;
    while ((m = jsonRegex.exec(content)) !== null) {
        const toolType = m[1].trim();
        if (!VALID_TOOL_TYPES.has(toolType)) {
            errors.push(`Unknown tool type "${toolType}" in JSON format`);
        }
    }
    // Detect partial/incomplete tool_call tags (opening without closing)
    const openCount = (content.match(/<tool_call>/g) || []).length;
    const closeCount = (content.match(/<\/tool_call>/g) || []).length;
    if (openCount > closeCount) {
        errors.push(`Incomplete <tool_call>: ${openCount - closeCount} unclosed tag(s)`);
    }
    // Detect unclosed JSON braces after tool names
    const toolNameRegex = /<tool_name>\s*\w+\s*<\/tool_name>/g;
    while ((m = toolNameRegex.exec(content)) !== null) {
        const after = content.slice(m.index + m[0].length);
        const braceStart = after.indexOf('{');
        if (braceStart !== -1) {
            const afterBrace = after.slice(braceStart);
            const openBraces = (afterBrace.match(/\{/g) || []).length;
            const closeBraces = (afterBrace.match(/\}/g) || []).length;
            if (openBraces > closeBraces) {
                const snippet = afterBrace.slice(0, 60).replace(/\n/g, '\\n');
                errors.push(`Incomplete JSON after <tool_name>: \`${snippet}…\` (${openBraces - closeBraces} unclosed brace(s))`);
            }
        }
    }
    return errors;
}
export function parseToolCallsSafe(content) {
    const calls = parseToolCalls(content);
    const errors = findToolCallErrors(content);
    return { calls, errors };
}
export function stripToolCallBlocks(content) {
    let result = content;
    // Remove <tool_call>...</tool_call> blocks
    result = result.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    // Remove bare <tool_name> + JSON (with or without trailing garbage)
    result = result.replace(/<tool_name>\s*\w+\s*<\/tool_name>[\s\S]*?(?=\n|$)/g, '');
    // Remove <tool_name> + <arguments> blocks (even with malformed JSON)
    result = result.replace(/<tool_name>\s*\w+\s*<\/tool_name>\s*<arguments>[\s\S]*?<\/arguments>/g, '');
    // Remove bare <tool_name> (unclosed or partial)
    result = result.replace(/<tool_name>\s*\w+\s*<\/tool_name>/g, '');
    // Remove bare <arguments> blocks
    result = result.replace(/<arguments>[\s\S]*?<\/arguments>/g, '');
    // Remove angle-bracket blocks
    result = result.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, '');
    // Remove function-style tool calls
    result = result.replace(/\b(?:read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)\s*\([\s\S]*?\)\s*/g, '');
    // Remove JSON tool call objects
    result = result.replace(/{[\s\S]*?"type"\s*:\s*"(?:read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)"[\s\S]*?}/g, '');
    // Remove bare JSON after tool names that wasn't caught
    result = result.replace(/\{[^}]*"(?:filePath|file|path|newContent|content|command|cmd|symbol|module|functionName)"[^}]*\}/g, '');
    // Remove any leftover XML tags related to tools
    result = result.replace(/<\/?tool_call>/g, '');
    result = result.replace(/<\/?tool_name>/g, '');
    result = result.replace(/<\/?arguments>/g, '');
    result = result.replace(/<\|tool_call_start\|>/g, '');
    result = result.replace(/<\|tool_call_end\|>/g, '');
    // Remove markdown code fences wrapping tool calls
    result = result.replace(/```[\s\S]*?```/g, (match) => {
        if (hasToolSyntax(match))
            return '';
        return match;
    });
    return result.trim();
}
export function hasToolSyntax(content) {
    return (/<tool_call>/.test(content) ||
        /<\|tool_call_start\|>/.test(content) ||
        /<tool_name>\s*\w+\s*<\/tool_name>/.test(content) ||
        /<arguments>/.test(content) ||
        /\b(read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)\s*\(/.test(content) ||
        /"type"\s*:\s*"(?:read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)"/.test(content));
}
export function containsOnlyToolSyntax(content) {
    const stripped = stripToolCallBlocks(content);
    return !stripped || stripped.length === 0;
}
//# sourceMappingURL=tools.js.map