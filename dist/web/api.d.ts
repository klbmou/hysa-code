import type { ProviderType, HysaConfig } from '../config/keys.js';
import type { TaskKind } from '../ai/task-classifier.js';
import type { ExecutionPlan, PlanReport } from '../ai/planner.js';
interface AttachmentPayload {
    name: string;
    ext: string;
    size: number;
    kind: 'text' | 'image' | 'pdf' | 'docx';
    textContent?: string;
    dataUrl?: string;
}
declare function supportsVision(provider: string, model: string): boolean;
declare const VISION_FALLBACK_ORDER: {
    provider: ProviderType;
    model: string;
    requiresKey: boolean;
    requiresHealthCheck?: boolean;
}[];
export declare function clearNinerouterVisionCache(): void;
declare function hasImageAttachments(attachments?: AttachmentPayload[]): boolean;
declare function getVisionFallbackCandidates(config: HysaConfig): Promise<{
    provider: ProviderType;
    model: string;
    label: string;
}[]>;
declare function getVisionFallbackErrorMessage(lang: 'arabic' | 'english', failures: {
    label: string;
    reason: string;
    error?: string;
}[], debug: boolean): string;
declare function buildVisionMessages(messages: {
    role: string;
    content: string;
}[], attachments: AttachmentPayload[]): any[];
declare function sanitizeMessagesForTextModel(messages: {
    role: string;
    content: string | any[];
}[], provider: string, model: string): number;
interface ChatRequest {
    messages: {
        role: string;
        content: string;
    }[];
    attachments?: AttachmentPayload[];
}
interface ChatResult {
    message: string;
    toolCalls: {
        type: string;
        params: Record<string, string>;
    }[];
    plan?: ExecutionPlan;
    planReport?: PlanReport;
    error?: string;
    hint?: string;
    fallbackEvents?: string[];
    provider?: string;
    model?: string;
    timing?: Record<string, number>;
    visionDebug?: {
        taskKind: string;
        requiredCapability: string;
        selectedProvider: string;
        selectedModel: string;
        providerSupportsVision: boolean;
        imageCount: number;
        failures: {
            label: string;
            reason: string;
            error?: string;
        }[];
    };
}
export declare function getStatus(): {
    provider: string;
    model: string;
    tier: string;
    visionCapable: boolean;
    visionModel: string | null;
    textModel: string | null;
    git: {
        branch: string | null;
        hasChanges: boolean;
    } | null;
};
export declare function getConfig(): HysaConfig | null;
export declare function updateConfig(partial: Partial<HysaConfig>): HysaConfig;
export declare function getProjectTree(): {
    tree: string;
    files: string[];
    fileCount: number;
};
export declare function getFileContent(filePath: string): {
    content: string | null;
    error?: string;
};
export declare function saveFile(path: string, content: string): {
    success: boolean;
    error?: string;
    diff?: string;
};
export declare function handleChatStream(req: ChatRequest, writeEvent: (event: string) => void): Promise<void>;
export declare const MAX_TOOL_STEPS = 10;
export declare function getMaxToolSteps(taskKind: TaskKind): number;
export declare function formatToolResults(toolCalls: {
    type: string;
    params: Record<string, string>;
}[], results: string[]): string;
export declare function executeToolCalls(toolCalls: {
    type: string;
    params: Record<string, string>;
}[], yolo: boolean): Promise<{
    results: string[];
    dangerous: boolean;
}>;
export declare function continueChat(messages: {
    role: string;
    content: string;
}[], toolCalls: {
    type: string;
    params: Record<string, string>;
}[], toolResults: string[]): Promise<ChatResult>;
export declare function handleChat(req: ChatRequest): Promise<ChatResult>;
export declare function runCommand(command: string): Promise<{
    stdout: string;
    stderr: string;
    error?: string;
}>;
export { getVisionFallbackCandidates, getVisionFallbackErrorMessage, buildVisionMessages, hasImageAttachments, supportsVision, sanitizeMessagesForTextModel, VISION_FALLBACK_ORDER };
export declare function getFilePreview(path: string, content: string): string | null;
export declare function getYoloStatus(): {
    enabled: boolean;
};
export declare function setYoloStatus(enabled: boolean): {
    enabled: boolean;
};
export declare function getFallbackStatus(): {
    unhealthy: string[];
    lastError: {
        provider: string;
        model: string;
        reason: string;
        category: string;
    } | null;
    lastFallback: string | null;
    lastSuccessful: {
        provider: string | null;
        model: string | null;
    };
    lastAttempted: {
        provider: string | null;
        model: string | null;
        category: string | null;
    };
};
//# sourceMappingURL=api.d.ts.map