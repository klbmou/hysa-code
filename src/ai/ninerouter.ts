import type { HysaConfig } from '../config/keys.js';

export const DEFAULT_NINEROUTER_ROOT_URL = 'http://localhost:20128';
export const DEFAULT_NINEROUTER_CHAT_MODEL = 'oc/deepseek-v4-flash-free';

export interface NinerouterDiscovery {
  available: boolean;
  rootUrl: string;
  apiBaseUrl: string;
  models: string[];
  visionModels: string[];
  chatModel: string;
  visionModel?: string;
  autoHealthChecked: boolean;
  reason?: string;
}

interface CachedDiscovery {
  expiresAt: number;
  value: NinerouterDiscovery;
}

const CACHE_TTL_MS = 30000;
const NEGATIVE_CACHE_TTL_MS = 10000;
const discoveryCache = new Map<string, CachedDiscovery>();

export function normalizeNinerouterRootUrl(raw?: string): string {
  const input = (raw || DEFAULT_NINEROUTER_ROOT_URL).trim().replace(/\/+$/, '');
  if (!input) return DEFAULT_NINEROUTER_ROOT_URL;
  return input.replace(/\/v1$/i, '');
}

export function toNinerouterApiBaseUrl(rootOrApiUrl?: string): string {
  const normalized = (rootOrApiUrl || DEFAULT_NINEROUTER_ROOT_URL).trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(normalized)) return normalized;
  return `${normalizeNinerouterRootUrl(normalized)}/v1`;
}

export function getPreferredNinerouterChatModel(config: HysaConfig): string {
  const envModel = process.env.HYSA_9ROUTER_CHAT_MODEL || process.env.NINEROUTER_MODEL;
  return (envModel || config.ninerouterModel || DEFAULT_NINEROUTER_CHAT_MODEL).trim() || DEFAULT_NINEROUTER_CHAT_MODEL;
}

export function getPreferredNinerouterVisionModel(config: HysaConfig): string | undefined {
  const envModel = process.env.HYSA_9ROUTER_VISION_MODEL || config.ninerouterVisionModel;
  if (!envModel) return undefined;
  return stripNinerouterPrefix(envModel.trim());
}

export function getNinerouterCandidateRoots(config: HysaConfig): string[] {
  return dedupe([
    process.env.NINEROUTER_URL,
    config.ninerouterRootUrl,
    config.ninerouterBaseUrl,
    DEFAULT_NINEROUTER_ROOT_URL,
  ].filter((url): url is string => !!url && !!url.trim()).map(normalizeNinerouterRootUrl));
}

export async function discoverNinerouter(
  config: HysaConfig,
  options: { includeVision?: boolean; timeoutMs?: number; force?: boolean } = {},
): Promise<NinerouterDiscovery> {
  const includeVision = options.includeVision === true;
  const timeoutMs = options.timeoutMs ?? 1500;
  const preferredChatModel = getPreferredNinerouterChatModel(config);
  const preferredVisionModel = getPreferredNinerouterVisionModel(config);
  const roots = getNinerouterCandidateRoots(config);
  const cacheKey = JSON.stringify({
    roots,
    includeVision,
    preferredChatModel,
    preferredVisionModel,
    key: config.apiKeys.ninerouter ? 'key' : 'nokey',
  });

  if (!options.force) {
    const cached = discoveryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }

  let lastReason = 'not checked';
  for (const rootUrl of roots) {
    const apiBaseUrl = toNinerouterApiBaseUrl(rootUrl);
    try {
      const health = await fetchJson(`${rootUrl}/api/health`, config.apiKeys.ninerouter, timeoutMs);
      if (!health.ok) {
        lastReason = `GET /api/health failed: ${health.reason}`;
        continue;
      }

      const modelsResult = await fetchJson(`${apiBaseUrl}/models`, config.apiKeys.ninerouter, timeoutMs);
      if (!modelsResult.ok) {
        lastReason = `GET /v1/models failed: ${modelsResult.reason}`;
        continue;
      }

      const models = extractModelIds(modelsResult.data);
      if (models.length === 0) {
        lastReason = 'GET /v1/models returned no usable models';
        continue;
      }

      let visionModels: string[] = [];
      let visionModel = preferredVisionModel;
      if (includeVision) {
        const visionResult = await fetchJson(`${apiBaseUrl}/models/image-to-text`, config.apiKeys.ninerouter, timeoutMs);
        if (visionResult.ok) {
          visionModels = extractModelIds(visionResult.data).filter(model => !isAutoModel(model));
        }
        if (!visionModel) visionModel = visionModels[0];
      }

      const result: NinerouterDiscovery = {
        available: true,
        rootUrl,
        apiBaseUrl,
        models,
        visionModels,
        chatModel: isAutoModel(preferredChatModel) ? DEFAULT_NINEROUTER_CHAT_MODEL : preferredChatModel,
        visionModel,
        autoHealthChecked: models.some(isAutoModel),
      };
      setCached(cacheKey, result);
      return result;
    } catch (err) {
      lastReason = (err as Error).message || String(err);
    }
  }

  const rootUrl = roots[0] || DEFAULT_NINEROUTER_ROOT_URL;
  const result: NinerouterDiscovery = {
    available: false,
    rootUrl,
    apiBaseUrl: toNinerouterApiBaseUrl(rootUrl),
    models: [],
    visionModels: [],
    chatModel: isAutoModel(preferredChatModel) ? DEFAULT_NINEROUTER_CHAT_MODEL : preferredChatModel,
    visionModel: preferredVisionModel,
    autoHealthChecked: false,
    reason: lastReason,
  };
  setCached(cacheKey, result, NEGATIVE_CACHE_TTL_MS);
  return result;
}

export async function hydrateNinerouterConfig(
  config: HysaConfig,
  options: { includeVision?: boolean; timeoutMs?: number; force?: boolean } = {},
): Promise<NinerouterDiscovery | null> {
  const discovery = await discoverNinerouter(config, options);
  if (!discovery.available) return discovery;

  config.ninerouterRootUrl = discovery.rootUrl;
  config.ninerouterBaseUrl = discovery.apiBaseUrl;
  config.ninerouterModel = discovery.chatModel;
  config.ninerouterModels = dedupe([discovery.chatModel, ...discovery.models]);
  config.ninerouterAutoHealthChecked = discovery.autoHealthChecked;
  config.ninerouterDiscovered = true;

  if (discovery.visionModel || discovery.visionModels.length > 0) {
    config.ninerouterVisionModel = discovery.visionModel;
    config.ninerouterVisionModels = dedupe([
      ...(discovery.visionModel ? [discovery.visionModel] : []),
      ...discovery.visionModels,
    ]);
  }

  return discovery;
}

export function clearNinerouterDiscoveryCache(): void {
  discoveryCache.clear();
}

function setCached(cacheKey: string, value: NinerouterDiscovery, ttlMs = CACHE_TTL_MS): void {
  discoveryCache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchJson(url: string, apiKey: string | undefined, timeoutMs: number): Promise<{ ok: true; data: unknown } | { ok: false; reason: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const text = await res.text();
    if (!text.trim()) return { ok: true, data: {} };

    try {
      const data = JSON.parse(text);
      if (url.endsWith('/api/health') && !isHealthyPayload(data)) {
        return { ok: false, reason: 'health payload did not report ok' };
      }
      return { ok: true, data };
    } catch {
      return { ok: true, data: {} };
    }
  } catch (err) {
    return { ok: false, reason: (err as Error).message || String(err) };
  }
}

function isHealthyPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  const record = data as Record<string, unknown>;
  if (record.ok === true) return true;
  if (typeof record.status === 'string' && /^(ok|healthy|up)$/i.test(record.status)) return true;
  if (typeof record.health === 'string' && /^(ok|healthy|up)$/i.test(record.health)) return true;
  return !('ok' in record || 'status' in record || 'health' in record);
}

function extractModelIds(data: unknown): string[] {
  if (Array.isArray(data)) {
    return dedupe(data.map(item => typeof item === 'string' ? item : getModelId(item)).filter((id): id is string => !!id));
  }
  if (!data || typeof data !== 'object') return [];

  const record = data as Record<string, unknown>;
  const source = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  return dedupe(source.map(item => typeof item === 'string' ? item : getModelId(item)).filter((id): id is string => !!id));
}

function getModelId(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const value = record.id ?? record.name ?? record.model;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stripNinerouterPrefix(model: string): string {
  if (model.startsWith('ninerouter/')) return model.slice('ninerouter/'.length);
  return model;
}

function isAutoModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'auto' || normalized === 'openai/auto' || normalized === 'ninerouter/auto';
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))];
}
