import { readFile } from '../files/reader.js';
import { writeFileWithBackup, previewEdit } from '../files/writer.js';
import { classifyCommand } from '../utils/commands.js';
const TS_ERROR_RE = /([\w/\\\-.]+\.[a-z]+)\((\d+)(?:,(\d+))?\)/i;
const TS_ERROR_RE2 = /([\w/\\\-.]+\.[a-z]+):(\d+):(\d+)/i;
const ERROR_AT_RE = /at\s+(?:[\w./\\-]+\.\w+):(\d+):(\d+)/i;
const MODULE_NOT_FOUND_RE = /(?:Cannot find module|cannot find name|Module not found|Cannot resolve)\s+['"]?([\w/\\\-@.]+)['"]?/i;
const FILE_IN_ERROR_RE = /(?:error|Error|ERROR)\s+in\s+([\w/\\\-.]+\.[a-z]+)/i;
const AUTO_FIX_TASK_KINDS = new Set([
    'code_edit', 'coding_qa', 'debugging', 'project_scan',
    'code_review', 'skill_task',
]);
export function isAutoFixTask(taskKind) {
    return AUTO_FIX_TASK_KINDS.has(taskKind);
}
export function classifyError(result, toolType) {
    const trimmed = result.slice(0, 2000);
    if (/path traversal blocked|Blocked:.*protected/i.test(trimmed)) {
        return { category: 'permission_error', message: trimmed.slice(0, 200), originalOutput: result };
    }
    if (/timed out after \d+ms/i.test(trimmed)) {
        return { category: 'command_timeout', message: trimmed.slice(0, 200), originalOutput: result };
    }
    if (/error TS\d+|TS\d+\b|\.ts\(\d+,\d+\)|TypeScript|TS_ERROR/i.test(trimmed)) {
        const fi = extractFileInfo(trimmed);
        return { category: 'typescript_error', message: trimmed.slice(0, 300), originalOutput: result, ...fi };
    }
    if (/ESLint|eslint|\.eslintrc|no-unused-vars|no-undef|@typescript-eslint/i.test(trimmed)) {
        const fi = extractFileInfo(trimmed);
        return { category: 'eslint_error', message: trimmed.slice(0, 300), originalOutput: result, ...fi };
    }
    if (/SyntaxError|Unexpected token|Parse error|Parsing error|Unexpected identifier/i.test(trimmed)) {
        const fi = extractFileInfo(trimmed);
        return { category: 'syntax_error', message: trimmed.slice(0, 300), originalOutput: result, ...fi };
    }
    if (/FAIL |failed.*test|AssertionError|expect\(|assert\.|✗|✘|tests?.*fail|test.*failed|Test suite/i.test(trimmed)) {
        const fi = extractFileInfo(trimmed);
        return { category: 'test_failure', message: trimmed.slice(0, 300), originalOutput: result, ...fi };
    }
    if (/Cannot find module|cannot find name|Module not found|Cannot resolve|Module parse failed/i.test(trimmed)) {
        const fi = extractFileInfo(trimmed);
        return { category: 'missing_import', message: trimmed.slice(0, 300), originalOutput: result, ...fi };
    }
    return { category: 'unknown', message: trimmed.slice(0, 200), originalOutput: result };
}
export function extractFileInfo(text) {
    let m;
    m = TS_ERROR_RE2.exec(text);
    if (m)
        return { filePath: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10) || undefined };
    m = TS_ERROR_RE.exec(text);
    if (m)
        return { filePath: m[1], line: parseInt(m[2], 10), column: m[3] ? parseInt(m[3], 10) : undefined };
    m = ERROR_AT_RE.exec(text);
    if (m)
        return { line: parseInt(m[1], 10), column: parseInt(m[2], 10) };
    m = FILE_IN_ERROR_RE.exec(text);
    if (m)
        return { filePath: m[1] };
    return {};
}
export function isErrorResult(result) {
    return result.startsWith('Error:') || result.startsWith('Command failed:') || result.startsWith('Blocked:') || result.startsWith('Edit blocked');
}
export function isFixableError(details) {
    if (!details.filePath)
        return false;
    if (details.category === 'command_timeout')
        return false;
    if (details.category === 'permission_error')
        return false;
    return true;
}
function extractCodeBlock(text) {
    const fenceMatch = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (fenceMatch)
        return fenceMatch[1].trim();
    const backtickMatch = text.match(/`{3}([\s\S]*?)`{3}/);
    if (backtickMatch)
        return backtickMatch[1].trim();
    return null;
}
function buildFixPrompt(details, userMessage, filePath, fileContent, contextLines) {
    return `Fix the following error in the code below.

User request: ${userMessage}

Error:
${details.message}

File: ${filePath}${details.line ? ` (around line ${details.line})` : ''}

Relevant code section:
\`\`\`
${contextLines}
\`\`\`

Return ONLY the fixed file content in a code block. Keep all existing code intact except the fix.`;
}
function computeErrorHash(result) {
    const lines = result.split('\n').filter(l => /error|Error|TS\d+|fail|Fail|✗|✘/.test(l));
    return lines.slice(0, 3).join('|').replace(/\s+/g, ' ').slice(0, 200);
}
export function shouldAutoFix(result, toolType, taskKind) {
    if (!isAutoFixTask(taskKind))
        return false;
    if (toolType !== 'execute_command')
        return false;
    if (!isErrorResult(result))
        return false;
    const details = classifyError(result, toolType);
    return isFixableError(details);
}
export async function attemptAutoFix(result, toolCall, client, workingDir, userMessage, state, runCommand, debug) {
    const debugLog = [];
    const details = classifyError(result, toolCall.type);
    debugLog.push(`Error category: ${details.category}`);
    if (!isFixableError(details)) {
        debugLog.push(`Error not fixable: category=${details.category}, hasFile=${!!details.filePath}`);
        return { fixed: false, errorType: details.category, filesTouched: [], debugLog };
    }
    const filePath = details.filePath;
    if (isLikelyProtected(filePath)) {
        debugLog.push(`Protected file: ${filePath}, skipping auto-fix`);
        return { fixed: false, errorType: 'permission_error', filesTouched: [], debugLog };
    }
    const content = readFile(filePath);
    if (content === null) {
        debugLog.push(`Cannot read file: ${filePath}`);
        return { fixed: false, errorType: details.category, filesTouched: [], debugLog };
    }
    const lines = content.split('\n');
    const errLine = details.line || 1;
    const startLine = Math.max(0, errLine - 15);
    const endLine = Math.min(lines.length, errLine + 15);
    const contextLines = lines.slice(startLine, endLine).map((l, i) => `  ${startLine + i + 1}: ${l}`).join('\n');
    debugLog.push(`File: ${filePath}, line ~${errLine}, reading ${endLine - startLine} context lines`);
    const fixPrompt = buildFixPrompt(details, userMessage, filePath, content, contextLines);
    const fixSystem = 'You are an automated code fixer. Fix the error. Return ONLY the fixed file content in a code block.';
    let fixResponse;
    try {
        const aiResult = await client.sendMessage([{ role: 'user', content: fixPrompt }], fixSystem);
        fixResponse = aiResult.message;
    }
    catch (err) {
        const e = err;
        debugLog.push(`AI fix call failed: ${e.message}`);
        return { fixed: false, errorType: details.category, filesTouched: [], debugLog };
    }
    const fixedContent = extractCodeBlock(fixResponse);
    if (!fixedContent) {
        debugLog.push('AI did not return a code block');
        debugLog.push(`AI response preview: ${fixResponse.slice(0, 200)}`);
        return { fixed: false, errorType: details.category, filesTouched: [], debugLog };
    }
    const diff = previewEdit(filePath, fixedContent);
    if (!diff) {
        debugLog.push('AI returned identical content — no changes made');
        return { fixed: false, errorType: details.category, filesTouched: [], debugLog };
    }
    writeFileWithBackup(filePath, fixedContent);
    const filesTouched = [filePath];
    debugLog.push(`Applied fix to ${filePath}`);
    const command = toolCall.params.command;
    if (!command) {
        debugLog.push('No command to rerun — fix applied but not verified');
        return { fixed: true, newResult: `Auto-fix applied to ${filePath}.`, errorType: details.category, filesTouched, debugLog };
    }
    const safety = classifyCommand(command);
    if (safety === 'dangerous') {
        debugLog.push(`Skipping rerun: dangerous command "${command}"`);
        return { fixed: true, newResult: `Auto-fix applied to ${filePath}. Command not rerun (too dangerous).`, errorType: details.category, filesTouched, debugLog };
    }
    debugLog.push(`Rerunning: ${command}`);
    try {
        const rerunResult = runCommand(command);
        if (rerunResult.stderr) {
            debugLog.push(`Rerun stderr: ${rerunResult.stderr.slice(0, 200)}`);
        }
        const output = rerunResult.stdout || rerunResult.stderr;
        debugLog.push(`Rerun succeeded`);
        return {
            fixed: true,
            newResult: `Command executed successfully:\n${output || '(no output)'}\n# Auto-fixed: ${details.category} in ${filePath}${details.line ? `:${details.line}` : ''}`,
            errorType: details.category,
            filesTouched,
            debugLog,
        };
    }
    catch (err) {
        const e = err;
        debugLog.push(`Rerun failed: ${e.message}`);
        const newErrorHash = computeErrorHash(e.message);
        if (newErrorHash && newErrorHash === state.lastErrorHash) {
            debugLog.push('Same error repeated — stopping auto-fix loop');
            return {
                fixed: false,
                newResult: `Auto-fix applied to ${filePath} but command still fails with same error.\n${e.message}`,
                errorType: details.category,
                filesTouched,
                debugLog,
            };
        }
        return {
            fixed: false,
            newResult: `Auto-fix applied to ${filePath} but command still fails.\n${e.message}`,
            errorType: details.category,
            filesTouched,
            debugLog,
        };
    }
}
function isLikelyProtected(filePath) {
    const base = filePath.split(/[\/\\]/).pop() || '';
    if (/^\.env($|\.)/i.test(base))
        return true;
    if (/\b(secret|key|token)\b/i.test(base))
        return true;
    if (/node_modules[/\\]/i.test(filePath))
        return true;
    if (/[/\\](dist|build|out)[/\\]/i.test(filePath))
        return true;
    return false;
}
//# sourceMappingURL=auto-fix.js.map