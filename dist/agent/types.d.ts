export type AgentMode = 'chat' | 'builder' | 'debug' | 'refactor' | 'autonomous';
export interface PlanStep {
    description: string;
    file?: string;
    action: 'read' | 'edit' | 'command' | 'analyze';
}
export interface Plan {
    title: string;
    steps: PlanStep[];
    risk: string;
    approved: boolean;
}
export interface TaskStep {
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    result?: string;
}
export interface Task {
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    steps: TaskStep[];
    createdAt: string;
    updatedAt: string;
    mode: AgentMode;
}
//# sourceMappingURL=types.d.ts.map