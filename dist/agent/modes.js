export const ALL_MODES = ['chat', 'builder', 'debug', 'refactor', 'autonomous'];
export const MODE_LABELS = {
    chat: '💬 Chat',
    builder: '🏗️  Builder',
    debug: '🐛 Debug',
    refactor: '♻️  Refactor',
    autonomous: '🤖 Autonomous',
};
export const MODE_DESCRIPTIONS = {
    chat: 'Simple assistant replies. You answer questions and help with code.',
    builder: 'Focus on creating features, files, and projects. Generate complete, production-ready code.',
    debug: 'Focus on finding and fixing bugs. Be thorough, read files, analyze errors, and fix root causes.',
    refactor: 'Improve architecture and code quality. Suggest and apply refactoring with explanations.',
    autonomous: 'Full autonomous mode. Plan, execute, verify, and iterate without requiring step-by-step approval.',
};
export function getModePromptAddendum(mode, modePlan) {
    const parts = [];
    switch (mode) {
        case 'chat':
            return '';
        case 'builder':
            parts.push(`\n## Agent Mode: Builder`);
            parts.push(`You are in BUILDER mode. Your priorities:`);
            parts.push(`1. Create complete, working production-ready code`);
            parts.push(`2. Generate full file contents (not just snippets)`);
            parts.push(`3. Consider error handling, edge cases, and best practices`);
            parts.push(`4. Explain the architecture and design decisions`);
            parts.push(`5. After creating files, suggest build/test commands`);
            break;
        case 'debug':
            parts.push(`\n## Agent Mode: Debug`);
            parts.push(`You are in DEBUG mode. Your process:`);
            parts.push(`1. Reproduce and understand the issue first`);
            parts.push(`2. Read relevant source code thoroughly`);
            parts.push(`3. Identify the root cause (not just symptoms)`);
            parts.push(`4. Apply minimal, targeted fixes`);
            parts.push(`5. Verify the fix doesn't break other functionality`);
            break;
        case 'refactor':
            parts.push(`\n## Agent Mode: Refactor`);
            parts.push(`You are in REFACTOR mode. Your principles:`);
            parts.push(`1. Improve code without changing external behavior`);
            parts.push(`2. Identify code smells and technical debt`);
            parts.push(`3. Explain WHY each change improves the code`);
            parts.push(`4. Show before/after for key changes`);
            parts.push(`5. Keep changes focused and safe`);
            break;
        case 'autonomous':
            parts.push(`\n## Agent Mode: Autonomous`);
            parts.push(`You are in AUTONOMOUS mode. Follow this workflow:`);
            parts.push(`1. ANALYZE the request and project context`);
            parts.push(`2. PLAN your approach (explain steps, files, and risks)`);
            parts.push(`3. EXECUTE: read files, make edits, run commands`);
            parts.push(`4. VERIFY: check if the goal was achieved`);
            parts.push(`5. ITERATE: if not complete, continue working`);
            parts.push(`\nSelf-assessment: After each step, evaluate if you're done.`);
            parts.push(`If more work is needed, describe what's remaining and continue.`);
            if (modePlan) {
                parts.push(`\nActive plan:\n${modePlan}`);
            }
            break;
    }
    return parts.join('\n');
}
//# sourceMappingURL=modes.js.map