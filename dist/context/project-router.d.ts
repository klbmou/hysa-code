import type { TaskKind } from '../ai/task-classifier.js';
export interface ProjectRouteDecision {
    projectMode: boolean;
    reason: string;
}
export declare function decideProjectMode(message: string, workspaceLoaded: boolean, taskKind: TaskKind): ProjectRouteDecision;
//# sourceMappingURL=project-router.d.ts.map