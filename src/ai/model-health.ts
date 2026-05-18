const WEAK_FOR_TOOLS = new Set<string>();
const UNHEALTHY = new Set<string>();

export function markWeakForTools(provider: string, model: string): void {
  WEAK_FOR_TOOLS.add(`${provider}:${model}`);
}

export function isWeakForTools(provider: string, model: string): boolean {
  return WEAK_FOR_TOOLS.has(`${provider}:${model}`);
}

export function markUnhealthy(provider: string, model: string): void {
  UNHEALTHY.add(`${provider}:${model}`);
}

export function isUnhealthy(provider: string, model: string): boolean {
  return UNHEALTHY.has(`${provider}:${model}`);
}

export function getPreferredModel(provider: string, models: string[]): string {
  for (const m of models) {
    const key = `${provider}:${m}`;
    if (!UNHEALTHY.has(key) && !WEAK_FOR_TOOLS.has(key)) return m;
  }
  return models[0] || '';
}

export function resetHealth(): void {
  WEAK_FOR_TOOLS.clear();
  UNHEALTHY.clear();
}
