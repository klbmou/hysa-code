import type { Task, AgentMode } from './types.js';
export declare function loadTasks(): Task[];
export declare function saveTasks(tasks: Task[]): void;
export declare function createTask(description: string, mode: AgentMode): Task;
export declare function updateTask(id: string, updates: Partial<Task>): void;
export declare function getActiveTask(): Task | null;
export declare function showTaskStatus(task: Task): string;
//# sourceMappingURL=tasks.d.ts.map