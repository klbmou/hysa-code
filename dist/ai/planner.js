const COMPLEX_TASK_KINDS = new Set([
    'code_edit',
    'debugging',
    'code_review',
    'planning',
    'long_reasoning',
    'project_scan',
]);
const FILE_PATTERN = /[\w/\\-]+\.\w+/g;
function extractFiles(text) {
    const matches = text.match(FILE_PATTERN);
    if (!matches)
        return [];
    const seen = new Set();
    return matches.filter(f => {
        const key = f.toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function determineGoal(text, taskKind) {
    const lower = text.toLowerCase();
    if (taskKind === 'debugging') {
        const match = lower.match(/debug\s+(.+?)(?:\s+in\s+|$)/i) || lower.match(/bug\s+(?:in\s+)?(.+?)(?:\s+(?:in|at)\s+|$)/i);
        return match ? `Debug: ${match[1].trim()}` : 'Debug reported issue';
    }
    if (taskKind === 'code_review') {
        const match = lower.match(/review\s+(.+?)(?:\s+(?:in|of|for)\s+|$)/i);
        return match ? `Review: ${match[1].trim()}` : 'Review code for issues';
    }
    if (taskKind === 'code_edit') {
        const match = lower.match(/(?:add|create|implement)\s+(.+?)(?:\s+(?:in|to|for)\s+|$)/i)
            || lower.match(/(?:fix|edit|change|update|modify)\s+(.+?)(?:\s+(?:in|to|at)\s+|$)/i)
            || lower.match(/(?:refactor|rename|rewrite)\s+(.+?)(?:\s+(?:in|to)\s+|$)/i);
        return match ? `Implement: ${match[1].trim()}` : 'Implement requested change';
    }
    if (taskKind === 'project_scan') {
        const match = lower.match(/(?:scan|analyze|explore)\s+(.+?)(?:\s+(?:in|of)\s+|$)/i);
        return match ? `Analyze: ${match[1].trim()}` : 'Analyze project structure';
    }
    if (taskKind === 'planning' || taskKind === 'long_reasoning') {
        const match = lower.match(/(?:plan|design|think through)\s+(.+?)(?:\s+(?:for|in|of|about)\s+|$)/i);
        return match ? `Plan: ${match[1].trim()}` : 'Plan approach for request';
    }
    return 'Execute requested task';
}
function determineRiskLevel(text, steps) {
    const lower = text.toLowerCase();
    const destructive = /\b(?:delete|remove|drop|clear|reset|override|force|rewrite|destroy)\b/i;
    const fileEdit = steps.some(s => s.files && s.files.length > 0 && s.description.toLowerCase().includes('edit'));
    if (destructive.test(lower) && fileEdit)
        return 'high';
    if (fileEdit)
        return 'medium';
    return 'low';
}
export function shouldPlanFor(taskKind) {
    return COMPLEX_TASK_KINDS.has(taskKind);
}
export function clonePlan(plan) {
    return {
        goal: plan.goal,
        riskLevel: plan.riskLevel,
        files: [...plan.files],
        steps: plan.steps.map(s => ({ ...s, files: s.files ? [...s.files] : undefined })),
    };
}
export function updateStepStatus(plan, stepIndex, status) {
    const updated = clonePlan(plan);
    if (stepIndex >= 0 && stepIndex < updated.steps.length) {
        updated.steps[stepIndex] = { ...updated.steps[stepIndex], status };
    }
    return updated;
}
export function markStepRunning(plan, stepIndex) {
    return updateStepStatus(plan, stepIndex, 'running');
}
export function markStepDone(plan, stepIndex) {
    return updateStepStatus(plan, stepIndex, 'done');
}
export function markStepFailed(plan, stepIndex) {
    return updateStepStatus(plan, stepIndex, 'failed');
}
export function inferStepFromToolCall(toolName, args, plan) {
    if (toolName === 'read_file') {
        const filePath = args.filePath || args.path || '';
        for (let i = 0; i < plan.steps.length; i++) {
            const desc = plan.steps[i].description.toLowerCase();
            if (desc.startsWith('read')) {
                if (filePath && plan.steps[i].files) {
                    if (plan.steps[i].files.some(f => filePath.includes(f) || f.includes(filePath)))
                        return i;
                }
                return i;
            }
        }
        return plan.steps.findIndex(s => s.status === 'pending');
    }
    if (toolName === 'edit_file') {
        const filePath = args.filePath || args.path || '';
        for (let i = 0; i < plan.steps.length; i++) {
            const desc = plan.steps[i].description.toLowerCase();
            if (/edit|fix|implement|change|apply|modify|refactor/i.test(desc)) {
                if (filePath && plan.steps[i].files) {
                    if (plan.steps[i].files.some(f => filePath.includes(f) || f.includes(filePath)))
                        return i;
                }
                return i;
            }
        }
    }
    if (toolName === 'execute_command') {
        const cmd = (args.command || '').toLowerCase();
        if (/test|verify|check|run|build|npm|yarn/i.test(cmd)) {
            for (let i = 0; i < plan.steps.length; i++) {
                if (/verify|test|check|run/i.test(plan.steps[i].description.toLowerCase()))
                    return i;
            }
        }
        return plan.steps.length - 1;
    }
    return plan.steps.findIndex(s => s.status === 'pending');
}
export function buildFinalReport(plan, filesTouched, commandsRun, responseSucceeded) {
    const steps = plan.steps;
    const completed = steps.filter(s => s.status === 'done').length;
    const failed = steps.filter(s => s.status === 'failed').length;
    const pending = steps.filter(s => s.status === 'pending').length;
    let finalStatus;
    if (completed === steps.length) {
        finalStatus = 'completed';
    }
    else if (failed > 0) {
        // If a successful final response was produced despite step failures,
        // treat recovered/fixed failures as non-fatal.
        if (responseSucceeded && completed > 0) {
            finalStatus = 'partial';
        }
        else {
            finalStatus = 'failed';
        }
    }
    else {
        finalStatus = 'partial';
    }
    return {
        goal: plan.goal,
        riskLevel: plan.riskLevel,
        fileCount: plan.files.length,
        filesTouched,
        commandsRun,
        totalSteps: steps.length,
        completedSteps: completed,
        failedSteps: failed,
        skippedSteps: pending,
        finalStatus,
    };
}
export function generatePlan(text, taskKind) {
    if (!shouldPlanFor(taskKind))
        return null;
    const files = extractFiles(text);
    const baseSteps = [];
    const lower = text.toLowerCase();
    if (files.length > 0) {
        const readFilesDesc = files.length === 1
            ? `Read ${files[0]}`
            : `Read ${files.length} files: ${files.join(', ')}`;
        baseSteps.push({ description: readFilesDesc, status: 'pending', files: [...files] });
    }
    else if (taskKind !== 'code_review') {
        baseSteps.push({ description: 'Read relevant project files', status: 'pending' });
    }
    if (taskKind === 'debugging') {
        baseSteps.push({ description: 'Analyze error or unexpected behavior', status: 'pending' });
        baseSteps.push({ description: 'Identify root cause', status: 'pending' });
        baseSteps.push({ description: 'Apply fix', status: 'pending', files: files.length > 0 ? [...files] : undefined });
        baseSteps.push({ description: 'Verify fix resolves the issue', status: 'pending' });
    }
    else if (taskKind === 'code_review') {
        baseSteps.push({ description: 'Read target code/files', status: 'pending', files: files.length > 0 ? [...files] : undefined });
        baseSteps.push({ description: 'Evaluate code quality, patterns, and potential issues', status: 'pending' });
        baseSteps.push({ description: 'List findings and recommendations', status: 'pending' });
    }
    else if (taskKind === 'code_edit') {
        const isRefactor = /\b(?:refactor|rewrite|restructure|reorganize)\b/i.test(lower);
        if (isRefactor) {
            baseSteps.push({ description: 'Understand current implementation', status: 'pending' });
            baseSteps.push({ description: 'Plan refactoring changes', status: 'pending' });
            baseSteps.push({ description: 'Apply refactoring edits', status: 'pending', files: files.length > 0 ? [...files] : undefined });
            baseSteps.push({ description: 'Verify no regressions', status: 'pending' });
        }
        else {
            baseSteps.push({ description: 'Understand existing code', status: 'pending' });
            baseSteps.push({ description: 'Implement changes', status: 'pending', files: files.length > 0 ? [...files] : undefined });
            baseSteps.push({ description: 'Review and finalize', status: 'pending' });
        }
    }
    else if (taskKind === 'project_scan') {
        baseSteps.push({ description: 'Scan project structure and key files', status: 'pending' });
        baseSteps.push({ description: 'Analyze architecture and patterns', status: 'pending' });
        baseSteps.push({ description: 'Summarize findings', status: 'pending' });
    }
    else if (taskKind === 'planning' || taskKind === 'long_reasoning') {
        baseSteps.push({ description: 'Gather context and requirements', status: 'pending' });
        baseSteps.push({ description: 'Analyze options and trade-offs', status: 'pending' });
        baseSteps.push({ description: 'Formulate recommended approach', status: 'pending' });
    }
    const goal = determineGoal(text, taskKind);
    const riskLevel = determineRiskLevel(text, baseSteps);
    return {
        goal,
        steps: baseSteps,
        riskLevel,
        files,
    };
}
//# sourceMappingURL=planner.js.map