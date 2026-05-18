import type { HysaConfig } from '../config/keys.js';
interface ChatRequest {
    messages: {
        role: string;
        content: string;
    }[];
}
export declare function getStatus(): {
    provider: string;
    model: string;
    tier: string;
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
export declare function handleChat(req: ChatRequest): Promise<{
    message: string;
    toolCalls: {
        type: string;
        params: Record<string, string>;
    }[];
}>;
export declare function runCommand(command: string): Promise<{
    stdout: string;
    stderr: string;
    error?: string;
}>;
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
    } | null;
    lastFallback: string | null;
};
export {};
//# sourceMappingURL=api.d.ts.map