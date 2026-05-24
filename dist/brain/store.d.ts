import type { BrainEvent, ProjectMap } from './types.js';
declare function containsSecret(value: unknown): boolean;
declare function redact(obj: unknown): unknown;
export declare function getBrainDir(): string;
export declare function ensureBrainDir(): Promise<void>;
export declare function readProjectMap(): Promise<ProjectMap | null>;
export declare function writeProjectMap(map: ProjectMap): Promise<void>;
export declare function appendBrainEvent(event: Omit<BrainEvent, 'id' | 'timestamp'>): Promise<BrainEvent>;
export declare function readRecentEvents(limit?: number): Promise<BrainEvent[]>;
export declare function countEvents(): Promise<number>;
export declare function appendLesson(title: string, content: string, tags?: string[]): Promise<void>;
export declare function appendDecision(title: string, content: string, tags?: string[]): Promise<void>;
export declare function initBrainFiles(): Promise<void>;
export declare function getBrainStatus(): Promise<{
    exists: boolean;
    projectMapDate: string | null;
    eventCount: number;
    knownSystems: string[];
}>;
export { containsSecret, redact };
//# sourceMappingURL=store.d.ts.map