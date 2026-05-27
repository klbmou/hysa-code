export type TaskKind = 'simple_chat' | 'code_review' | 'search' | 'planning' | 'long_context' | 'debugging' | 'general_qa' | 'coding_qa' | 'code_edit' | 'project_scan' | 'web_research' | 'browser_task' | 'image_vision' | 'skill_task' | 'long_reasoning' | 'unknown';
export declare function classifyTask(messages: {
    role: string;
    content: string | any[];
}[], attachments?: {
    kind: string;
}[]): TaskKind;
//# sourceMappingURL=task-classifier.d.ts.map