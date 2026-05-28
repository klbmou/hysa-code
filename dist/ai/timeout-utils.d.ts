import type { TaskKind } from './task-classifier.js';
import type { Message } from './types.js';
export declare function getTimeoutForTask(taskKind: TaskKind): number;
export declare function getProviderTimeoutForTask(provider: string, taskKind: TaskKind): number;
export declare function estimateTimeoutFromMessages(messages: Message[]): number;
//# sourceMappingURL=timeout-utils.d.ts.map