export type Capability = 'text' | 'code' | 'tool_use' | 'vision' | 'local' | 'free';
export declare function providerHasCapability(provider: string, model: string, capability: Capability): boolean;
export declare function getVisionCapableProviders(): {
    provider: string;
    model: string;
}[];
export declare function hasVisionCapability(provider: string, model: string): boolean;
export declare function isModelVisionCapable(model: string): boolean;
export declare function isProviderVisionCapable(provider: string): boolean;
//# sourceMappingURL=provider-capabilities.d.ts.map