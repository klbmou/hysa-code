import type { ToolCall, ToolType } from './types.js';

const VALID_TOOL_TYPES = new Set<string>([
  'read_file', 'edit_file', 'execute_command',
  'list_symbols', 'find_references', 'search_imports',
  'summarize_file', 'explain_function',
]);

const ALL_TOOL_TAGS = [
  /<tool_call>[\s\S]*?<\/tool_call>/g,
  /<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g,
];

function parseParamsFromFunctionStyle(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  // Match key="value" pairs where value may contain escaped quotes or nested parens
  const pairRegex = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let match: RegExpExecArray | null;
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

function parseXmlFormat(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const regex = /<tool_call>[\s\S]*?<tool_name>(\w+)<\/tool_name>[\s\S]*?({[\s\S]*?})[\s\S]*?<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const type = match[1].trim();
    if (!VALID_TOOL_TYPES.has(type)) continue;
    try {
      const params = JSON.parse(match[2]);
      calls.push({ type: type as ToolType, params });
    } catch {
      // malformed
    }
  }
  return calls;
}

function parseAngleBracketFormat(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const regex = /<\|tool_call_start\|>\s*\[(\w+)\(([\s\S]*?)\)\s*\]\s*<\|tool_call_end\|>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const type = match[1].trim();
    if (!VALID_TOOL_TYPES.has(type)) continue;
    const params = parseParamsFromFunctionStyle(match[2]);
    calls.push({ type: type as ToolType, params });
  }
  return calls;
}

function parseFunctionStyleFormat(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  // Strip out content already inside known block delimiters
  let stripped = content
    .replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');

  const regex = /(?<!\w)(\w+)\(([\s\S]*?)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    const type = match[1].trim();
    if (!VALID_TOOL_TYPES.has(type)) continue;
    const params = parseParamsFromFunctionStyle(match[2]);
    if (Object.keys(params).length === 0) continue;
    calls.push({ type: type as ToolType, params });
  }
  return calls;
}

function parseJsonFormat(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const jsonRegex = /({[\s\S]*?"type"\s*:\s*"(\w+)"[\s\S]*?})/g;
  let match: RegExpExecArray | null;
  while ((match = jsonRegex.exec(content)) !== null) {
    const type = match[2].trim();
    if (!VALID_TOOL_TYPES.has(type)) continue;
    try {
      const parsed = JSON.parse(match[1]);
      const { type: _t, ...params } = parsed;
      calls.push({ type: type as ToolType, params });
    } catch {
      // malformed
    }
  }
  return calls;
}

export function parseToolCalls(content: string): ToolCall[] {
  const allCalls: ToolCall[] = [];

  // Try each format in order
  allCalls.push(...parseXmlFormat(content));
  allCalls.push(...parseAngleBracketFormat(content));
  allCalls.push(...parseFunctionStyleFormat(content));
  allCalls.push(...parseJsonFormat(content));

  return allCalls;
}

export function stripToolCallBlocks(content: string): string {
  let result = content;
  // Remove XML blocks
  result = result.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  // Remove angle-bracket blocks
  result = result.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, '');
  // Remove function-style tool calls with known tool names
  result = result.replace(/\b(?:read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)\s*\([\s\S]*?\)\s*/g, '');
  // Remove JSON tool call objects
  result = result.replace(/{[\s\S]*?"type"\s*:\s*"(?:read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)"[\s\S]*?}/g, '');
  return result.trim();
}

export function hasToolSyntax(content: string): boolean {
  return (
    /<tool_call>/.test(content) ||
    /<\|tool_call_start\|>/.test(content) ||
    /\b(read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)\s*\(/.test(content) ||
    /"type"\s*:\s*"(?:read_file|edit_file|execute_command|list_symbols|find_references|search_imports|summarize_file|explain_function)"/.test(content)
  );
}
