import type { TaskKind } from './task-classifier.js';
export interface PlanStep {
    description: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    files?: string[];
}
export interface ExecutionPlan {
    goal: string;
    steps: PlanStep[];
    riskLevel: 'low' | 'medium' | 'high';
    files: string[];
}
export declare function shouldPlanFor(taskKind: TaskKind): boolean;
export interface PlanReport {
    goal: string;
    riskLevel: string;
    fileCount: number;
    filesTouched: string[];
    commandsRun: number;
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    finalStatus: 'completed' | 'partial' | 'failed';
}
export declare function clonePlan(plan: ExecutionPlan): ExecutionPlan;
export declare function updateStepStatus(plan: ExecutionPlan, stepIndex: number, status: PlanStep['status']): ExecutionPlan;
export declare function markStepRunning(plan: ExecutionPlan, stepIndex: number): ExecutionPlan;
export declare function markStepDone(plan: ExecutionPlan, stepIndex: number): ExecutionPlan;
export declare function markStepFailed(plan: ExecutionPlan, stepIndex: number): ExecutionPlan;
export declare function inferStepFromToolCall(toolName: string, args: Record<string, string>, plan: ExecutionPlan): number;
export declare function buildFinalReport(plan: ExecutionPlan, filesTouched: string[], commandsRun: number): PlanReport;
export declare function generatePlan(text: string, taskKind: TaskKind): ExecutionPlan | null;
//# sourceMappingURL=planner.d.ts.map