import { loadConfig, saveConfig } from './keys.js';
import type { HysaConfig, ProviderType } from './keys.js';
import { PROVIDER_DEFAULTS } from './keys.js';

export type { HysaConfig, ProviderType } from './keys.js';

export function getSettings(): HysaConfig | null {
  return loadConfig();
}

export function updateSettings(partial: Partial<HysaConfig>): HysaConfig {
  const current = loadConfig() || {
    currentProvider: 'openrouter' as ProviderType,
    currentModel: PROVIDER_DEFAULTS.openrouter.model,
    apiKeys: {},
    ollamaBaseUrl: 'http://localhost:11434',
  };
  const merged = { ...current, ...partial };
  saveConfig(merged);
  return merged;
}

export function updateAgentMode(mode: 'chat' | 'builder' | 'debug' | 'refactor' | 'autonomous'): void {
  updateSettings({ agentMode: mode });
}
