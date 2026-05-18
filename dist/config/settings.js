import { loadConfig, saveConfig } from './keys.js';
import { PROVIDER_DEFAULTS } from './keys.js';
export function getSettings() {
    return loadConfig();
}
export function updateSettings(partial) {
    const current = loadConfig() || {
        currentProvider: 'openrouter',
        currentModel: PROVIDER_DEFAULTS.openrouter.model,
        apiKeys: {},
        ollamaBaseUrl: 'http://localhost:11434',
    };
    const merged = { ...current, ...partial };
    saveConfig(merged);
    return merged;
}
export function updateAgentMode(mode) {
    updateSettings({ agentMode: mode });
}
//# sourceMappingURL=settings.js.map