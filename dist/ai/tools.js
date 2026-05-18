const VALID_TOOL_TYPES = new Set([
    'read_file', 'edit_file', 'execute_command',
    'list_symbols', 'find_references', 'search_imports',
    'summarize_file', 'explain_function',
]);
const ALL_TOOL_TAGS = [
    /<tool_call>[\s\S]*?<\/tool_call>/g,
    /<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g,
];
function parseParamsFromFunctionStyle(text) {
    const params = {};
    // Match key="value" pairs where value may contain escaped quotes or nested parens
    const pairRegex = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
    let match;
    while ((match = pairRegex.exec(text)) !== null) {
        const key = match[1];
        let value = match[2];
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        params[key] = value;
    }
    return params;
}
function parseXmlFormat(content) {
    const calls = [];
    const regex = /<tool_call>[\s\S]*?<tool_name>(\w+)<\/tool_name>[\s\S]*?({[\s\S]*?})[\s\S]*?<\/tool_call>/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const type = match[1].trim();
        if (!VALID_TOOL_TYPES.has(type))
            continue;
        try {
            const params = JSON.parse(match[2]);
            calls.push({ type: type, params });
        }
        catch {
            // malformed
        }
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
    // Strip out content already inside known block delimiters
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
    // Strip markdown code fences first, then match
    const cleaned = content
        .replace(/```[\s\S]*?```/g, (match) => {
        // Parse inside fence as if it were raw
        const inner = match.replace(/```\w*\n?/, '').replace(/```$/, '');
        return inner;
    });
    // Try on original content first
    const tryMatch = (text) => {
        const regex = /<tool_name>\s*(\w+)\s*<\/tool_name>\s*(\{[\s\S]*?\})/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const type = match[1].trim();
            if (!VALID_TOOL_TYPES.has(type))
                continue;
            try {
                const params = JSON.parse(match[2]);
                calls.push({ type: type, params });
            }
            catch {
                // malformed JSON
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
    // Matches <tool_call>...<tool_name>type</tool_name><arguments>{json}</arguments>...</tool_call>
    // Also supports <arguments> directly after <tool_name>
    const regex = /<tool_call>[\s\S]*?<tool_name>\s*(\w+)\s*<\/tool_name>[\s\S]*?<arguments>\s*(\{[\s\S]*?\})\s*<\/arguments>[\s\S]*?<\/tool_call>/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const type = match[1].trim();
        if (!VALID_TOOL_TYPES.has(type))
            continue;
        try {
            const params = JSON.parse(match[2]);
            calls.push({ type: type, params });
        }
        catch {
            // malformed
        }
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
            calls.push({ type: type, params });
        }
        catch {
            // malformed
        }
    }
    return calls;
}
export function parseToolCalls(content) {
    const allCalls = [];
    // Try each format in order
    allCalls.push(...parseArgumentFormat(content));
    allCalls.push(...parseXmlFormat(content));
    allCalls.push(...parseAngleBracketFormat(content));
    allCalls.push(...parseToolNameFormat(content));
    allCalls.push(...parseFunctionStyleFormat(content));
    allCalls.push(...parseJsonFormat(content));
    return allCalls;
}
export function stripToolCallBlocks(content) {
    let result = content;
    // Remove <tool_call> blocks (with <arguments> or raw JSON)
    result = result.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    // Remove bare <tool_name> + JSON blocks
    result = result.replace(/<tool_name>\s*\w+\s*<\/tool_name>\s*\{[\s\S]*?\}/g, '');
    // Remove bare <tool_name> + <arguments> blocks
    result = result.replace(/<tool_name>\s*\w+\s*<\/tool_name>\s*<arguments>\s*\{[\s\S]*?\}\s*<\/arguments>/g, '');
    // Remove angle-bracket blocks
    result = result.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, '');
    // Remove function-style tool calls with known tool names
    result = result.replace(/\b(?:read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)\s*\([\s\S]*?\)\s*/g, '');
    // Remove JSON tool call objects
    result = result.replace(/{[\s\S]*?"type"\s*:\s*"(?:read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)"[\s\S]*?}/g, '');
    // Remove markdown code fences wrapping tool calls
    result = result.replace(/```[\s\S]*?<\/tool_call>[\s\S]*?```/g, '');
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
//# sourceMappingURL=tools.js.map