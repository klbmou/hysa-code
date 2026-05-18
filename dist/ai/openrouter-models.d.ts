export interface OpenRouterModel {
    id: string;
    name: string;
    contextLength: number;
    pricing: {
        prompt: string;
        completion: string;
    };
    description: string;
}
export declare function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]>;
export declare function filterFreeModels(models: OpenRouterModel[]): OpenRouterModel[];
export declare function formatModelsTable(models: OpenRouterModel[], freeOnly?: boolean): string;
//# sourceMappingURL=openrouter-models.d.ts.map