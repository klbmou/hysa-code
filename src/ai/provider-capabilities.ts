export type Capability = 'text' | 'code' | 'tool_use' | 'vision' | 'local' | 'free';

interface ProviderModelCapability {
  provider: string;
  model: string;
  capabilities: Capability[];
}

const CAPABILITY_MAP: ProviderModelCapability[] = [
  // ── Gemini ──
  { provider: 'gemini', model: 'gemini-2.5-flash', capabilities: ['text', 'code', 'tool_use', 'vision', 'free'] },
  { provider: 'gemini', model: 'gemini-1.5-flash', capabilities: ['text', 'code', 'tool_use', 'vision', 'free'] },
  { provider: 'gemini', model: 'gemini-2.0-flash', capabilities: ['text', 'code', 'tool_use', 'vision', 'free'] },

  // ── OpenAI ──
  { provider: 'openai', model: 'gpt-4o', capabilities: ['text', 'code', 'tool_use', 'vision'] },
  { provider: 'openai', model: 'gpt-4o-mini', capabilities: ['text', 'code', 'tool_use', 'vision'] },
  { provider: 'openai', model: 'gpt-4-turbo', capabilities: ['text', 'code', 'tool_use', 'vision'] },

  // ── Anthropic ──
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', capabilities: ['text', 'code', 'tool_use', 'vision'] },
  { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', capabilities: ['text', 'code', 'tool_use', 'vision'] },

  // ── OpenRouter vision models ──
  { provider: 'openrouter', model: 'google/gemini-2.5-flash', capabilities: ['text', 'code', 'tool_use', 'vision', 'free'] },
  { provider: 'openrouter', model: 'google/gemini-2.5-flash:free', capabilities: ['text', 'code', 'tool_use', 'vision', 'free'] },
  { provider: 'openrouter', model: 'qwen/qwen2.5-vl-72b-instruct:free', capabilities: ['text', 'code', 'vision', 'free'] },
  { provider: 'openrouter', model: 'qwen/qwen-vl-plus', capabilities: ['text', 'code', 'vision'] },

  // ── OpenAI Router — vision depends on backend; not guaranteed ──
  // openai/gpt-4o-mini removed from vision here: router backend may not support vision.

  // ── 9Router — auto model may be vision-capable depending on backend ──
  { provider: 'ninerouter', model: 'auto', capabilities: ['text', 'code', 'tool_use', 'vision', 'free'] },
  // 9Router explicit vision model combos
  { provider: 'ninerouter', model: 'gemini/gemini-2.5-flash', capabilities: ['text', 'code', 'tool_use', 'vision', 'free'] },
  { provider: 'ninerouter', model: 'gemini/gemini-1.5-flash', capabilities: ['text', 'code', 'tool_use', 'vision', 'free'] },
  { provider: 'ninerouter', model: 'openai/gpt-4o', capabilities: ['text', 'code', 'tool_use', 'vision'] },
  { provider: 'ninerouter', model: 'openai/gpt-4o-mini', capabilities: ['text', 'code', 'tool_use', 'vision'] },

  // ── Anthropic Proxy vision models ──
  { provider: 'anthropic_proxy', model: 'claude-sonnet-4-6', capabilities: ['text', 'code', 'tool_use', 'vision'] },

  // ── Local ──
  { provider: 'ollama', model: '', capabilities: ['text', 'code', 'tool_use', 'local'] },
];

export function providerHasCapability(provider: string, model: string, capability: Capability): boolean {
  const lowerModel = model.toLowerCase();
  for (const entry of CAPABILITY_MAP) {
    if (entry.provider !== provider) continue;
    if (entry.model && !lowerModel.includes(entry.model.toLowerCase())) continue;
    if (entry.capabilities.includes(capability)) return true;
  }
  return false;
}

export function getVisionCapableProviders(): { provider: string; model: string }[] {
  const result: { provider: string; model: string }[] = [];
  const seen = new Set<string>();
  for (const entry of CAPABILITY_MAP) {
    if (!entry.capabilities.includes('vision')) continue;
    if (!entry.model) continue;
    const key = `${entry.provider}:${entry.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ provider: entry.provider, model: entry.model });
  }
  return result;
}

export function hasVisionCapability(provider: string, model: string): boolean {
  return providerHasCapability(provider, model, 'vision');
}

export function isModelVisionCapable(model: string): boolean {
  const lower = model.toLowerCase();
  return CAPABILITY_MAP.some(e =>
    e.model && lower.includes(e.model.toLowerCase()) && e.capabilities.includes('vision'),
  );
}

export function isProviderVisionCapable(provider: string): boolean {
  return CAPABILITY_MAP.some(e => e.provider === provider && e.capabilities.includes('vision'));
}
