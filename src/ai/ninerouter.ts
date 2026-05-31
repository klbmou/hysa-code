import type { HysaConfig } from '../config/keys.js';
import { hasVisionCapability } from './provider-capabilities.js';

export const DEFAULT_NINEROUTER_ROOT_URL = 'http://localhost:20128';
export const DEFAULT_NINEROUTER_CHAT_MODEL = 'oc/deepseek-v4-flash-free';

export type NinerouterProbeStatus =
  | 'usable'
  | 'rate_limited'
  | 'missing_credentials'
  | 'invalid_model'
  | 'unavailable'
  | 'unknown_error';

export interface NinerouterDiscovery {
  available: boolean;
  rootUrl: string;
  apiBaseUrl: string;
  models: string[];
  visionModels: string[];
  chatModel: string;
  visionModel?: string;
  promotedVisionModels?: string[];
  visionPromotionReason?: string;
  autoHealthChecked: boolean;
  reason?: string;
}

export interface NinerouterErrorDetails {
  httpStatus?: number;
  errorType?: string;
  errorMessage?: string;
  upstreamProvider?: string;
  rawBody?: string;
}

export interface NinerouterProbeResult extends NinerouterErrorDetails {
  model: string;
  usable: boolean;
  status: NinerouterProbeStatus;
  reason: string;
  latencyMs: number;
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
  const model = normalizeNinerouterModelId(envModel || config.ninerouterModel || DEFAULT_NINEROUTER_CHAT_MODEL);
  return model || DEFAULT_NINEROUTER_CHAT_MODEL;
}

export function getPreferredNinerouterVisionModel(config: HysaConfig): string | undefined {
  const envModel = process.env.HYSA_9ROUTER_VISION_MODEL || config.ninerouterVisionModel;
  if (!envModel) return undefined;
  return normalizeNinerouterModelId(envModel.trim());
}

function isLikelyLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1'
      || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^192\.168\./.test(h);
  } catch { return false; }
}

function addIpv4Fallback(url: string): string[] {
  const result: string[] = [url];
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      result.push(parsed.toString().replace(/\/+$/, ''));
    }
  } catch { /* invalid URL, keep as-is */ }
  return result;
}

export function getNinerouterCandidateRoots(config: HysaConfig): string[] {
  const extras: string[] = [];
  if (config.openaiRouterBaseUrl && isLikelyLocalUrl(config.openaiRouterBaseUrl)) {
    extras.push(config.openaiRouterBaseUrl);
  }
  const roots: (string | undefined)[] = [
    process.env.NINEROUTER_URL,
    config.ninerouterRootUrl,
    config.ninerouterBaseUrl,
    ...extras,
  ];
  // Only include the default fallback root if no user-configured root is set
  if (!config.ninerouterRootUrl && !config.ninerouterBaseUrl && !process.env.NINEROUTER_URL) {
    roots.push(DEFAULT_NINEROUTER_ROOT_URL);
  }
  return dedupe(
    roots.filter((url): url is string => !!url && !!url.trim()).map(normalizeNinerouterRootUrl).flatMap(addIpv4Fallback),
  );
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
      // Health check is optional — if /api/health doesn't exist (404) or fails,
      // proceed to check /v1/models. Only fail for this root if the server is
      // completely unreachable at the network level.
      const health = await fetchJson(`${rootUrl}/api/health`, config.apiKeys.ninerouter, timeoutMs);
      if (!health.ok) {
        const healthReason = health.reason || 'unknown';
        if (/fetch failed|econnrefused|econnreset|enotfound|econnaborted|network|timeout/i.test(healthReason)) {
          lastReason = `GET /api/health failed: ${healthReason}`;
          continue;
        }
        // Non-critical failure (404, 4xx, etc.) — log but proceed
        lastReason = `GET /api/health (non-critical): ${healthReason}`;
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
      let promotedVisionModels: string[] = [];
      let visionPromotionReason: string | undefined;
      if (includeVision) {
        const visionResult = await fetchJson(`${apiBaseUrl}/models/image-to-text`, config.apiKeys.ninerouter, timeoutMs);
        if (visionResult.ok) {
          visionModels = extractModelIds(visionResult.data).filter(model => !isAutoModel(model));
        }
        if (visionModels.length === 0) {
          promotedVisionModels = getNinerouterPromotableVisionChatModels(models);
          if (promotedVisionModels.length > 0) {
            visionModels = promotedVisionModels;
            visionPromotionReason = 'GET /v1/models/image-to-text returned no models; promoted multimodal Gemini chat models from /v1/models';
          }
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
        promotedVisionModels,
        visionPromotionReason,
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
    promotedVisionModels: [],
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
  config.ninerouterModels = orderNinerouterChatModels(discovery.models, discovery.chatModel);
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

export function orderNinerouterChatModels(models: string[], preferred?: string): string[] {
  const discovered = dedupe(models.map(normalizeNinerouterModelId).filter(isUsableNinerouterChatModel));
  const preferredModel = normalizeNinerouterModelId(preferred || '');
  const ordered: string[] = [];

  function add(model: string | undefined): void {
    if (!model || !isUsableNinerouterChatModel(model)) return;
    if (!ordered.includes(model)) ordered.push(model);
  }

  add(preferredModel);
  add(DEFAULT_NINEROUTER_CHAT_MODEL);

  for (const model of discovered.filter(isGeminiFlashLiteModel)) add(model);
  for (const model of discovered.filter(isNvidiaOrFreeModel)) add(model);
  for (const model of discovered) add(model);

  return ordered;
}

export function isUsableNinerouterChatModel(model: string): boolean {
  const normalized = normalizeNinerouterModelId(model);
  if (!normalized) return false;
  if (isAutoModel(normalized)) return false;
  return true;
}

export function getNinerouterPromotableVisionChatModels(models: string[]): string[] {
  return orderNinerouterChatModels(models)
    .filter(model => /^gemini\//i.test(model))
    .filter(model => hasVisionCapability('ninerouter', model));
}

export function extractNinerouterErrorDetails(error: unknown): NinerouterErrorDetails {
  const record = isRecord(error) ? error : {};
  const response = isRecord(record.response) ? record.response : {};
  const parsedError = isRecord(record.error) ? record.error : undefined;
  const responseData = response.data ?? response.body;
  const rawBody = firstString(
    record.rawBody,
    record.body,
    responseData,
    parsedError,
  );
  const parsedRaw = parseJsonObject(rawBody);
  const rawError = isRecord(parsedRaw?.error) ? parsedRaw.error : isRecord(parsedRaw) ? parsedRaw : undefined;
  const errObj = parsedError ?? rawError;

  const httpStatus = firstNumber(
    record.status,
    record.statusCode,
    response.status,
    errObj?.status,
  ) ?? parseStatusFromText(firstString(record.message, rawBody));

  let errorType = firstNonEmptyString(
    errObj?.type,
    errObj?.code,
    record.type,
    record.code,
    parsedRaw?.type,
    parsedRaw?.code,
  );
  const errorMessage = firstNonEmptyString(
    errObj?.message,
    parsedRaw?.message,
    record.message,
    rawBody,
  );
  const upstreamProvider = firstNonEmptyString(
    errObj?.upstream_provider,
    errObj?.upstreamProvider,
    errObj?.provider,
    parsedRaw?.upstream_provider,
    parsedRaw?.upstreamProvider,
    parsedRaw?.provider,
    record.upstreamProvider,
    record.provider,
  );

  if (!errorType && httpStatus === undefined && errorMessage) {
    const lowerMsg = errorMessage.toLowerCase();
    if (/econnrefused|econnreset|enotfound|econnaborted|fetch failed|network|connection|timeout|timed out|aborted|service unavailable|unavailable|dns|resolve|hostname/i.test(lowerMsg)) {
      errorType = 'network';
    }
  }

  return {
    httpStatus,
    errorType,
    errorMessage,
    upstreamProvider,
    rawBody: rawBody ? rawBody.slice(0, 1200) : undefined,
  };
}

export function classifyNinerouterFailure(errorOrDetails: unknown): NinerouterProbeStatus {
  const details = looksLikeErrorDetails(errorOrDetails)
    ? errorOrDetails as NinerouterErrorDetails
    : extractNinerouterErrorDetails(errorOrDetails);
  const combined = [
    details.errorType,
    details.errorMessage,
    details.rawBody,
  ].filter(Boolean).join(' ').toLowerCase();

  if (details.httpStatus === 429 || /freeusagelimiterror/i.test(combined)) {
    return 'rate_limited';
  }
  if (/no active credentials|missing credentials?|credential.*missing|total connections:\s*0|no available models/i.test(combined)) {
    return 'missing_credentials';
  }
  if (/invalid[_ -]?model|model not found|unknown model|model .*does not exist|does not exist|not found|end of life|\bgone\b/i.test(combined)) {
    return 'invalid_model';
  }
  if (details.httpStatus === 401 || details.httpStatus === 403) {
    return 'missing_credentials';
  }
  if (details.httpStatus === 400 || details.httpStatus === 404 || details.httpStatus === 410) {
    return 'invalid_model';
  }
  if (
    details.httpStatus && details.httpStatus >= 500 ||
    /econnrefused|econnreset|enotfound|fetch failed|network|connection|timeout|timed out|aborted|service unavailable|unavailable/i.test(combined)
  ) {
    return 'unavailable';
  }
  return 'unknown_error';
}

export function ninerouterProbeStatusToErrorCategory(status: NinerouterProbeStatus): 'rate_limit' | 'invalid_key' | 'model_unavailable' | 'network' | 'unknown' {
  switch (status) {
    case 'rate_limited': return 'rate_limit';
    case 'missing_credentials': return 'invalid_key';
    case 'invalid_model': return 'model_unavailable';
    case 'unavailable': return 'network';
    default: return 'unknown';
  }
}

export async function probe9RouterModel(
  config: HysaConfig,
  model: string,
  options: { timeoutMs?: number } = {},
): Promise<NinerouterProbeResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const started = Date.now();
  const normalizedModel = normalizeNinerouterModelId(model);

  if (!normalizedModel) {
    return {
      model,
      usable: false,
      status: 'invalid_model',
      reason: 'empty model id',
      latencyMs: Date.now() - started,
    };
  }

  if (!config.ninerouterBaseUrl) {
    const discovery = await hydrateNinerouterConfig(config, { timeoutMs: Math.min(timeoutMs, 1500) });
    if (!discovery?.available) {
      return {
        model: normalizedModel,
        usable: false,
        status: 'unavailable',
        reason: discovery?.reason || '9Router is not reachable',
        latencyMs: Date.now() - started,
      };
    }
  }

  const apiBaseUrl = toNinerouterApiBaseUrl(config.ninerouterBaseUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKeys.ninerouter) headers.Authorization = `Bearer ${config.apiKeys.ninerouter}`;

  try {
    const res = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: normalizedModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    const rawBody = await res.text().catch(() => '');

    if (res.ok) {
      return {
        model: normalizedModel,
        usable: true,
        status: 'usable',
        reason: 'chat completion works',
        latencyMs,
        httpStatus: res.status,
        rawBody: rawBody.slice(0, 1200) || undefined,
      };
    }

    const details = extractNinerouterErrorDetails({
      status: res.status,
      rawBody,
      message: rawBody || `HTTP ${res.status}`,
    });
    const status = classifyNinerouterFailure(details);
    return {
      model: normalizedModel,
      usable: false,
      status,
      reason: details.errorMessage || `HTTP ${res.status}`,
      latencyMs,
      ...details,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const details = extractNinerouterErrorDetails(err);
    const status = classifyNinerouterFailure({
      ...details,
      errorMessage: details.errorMessage || (err as Error).message || String(err),
      rawBody: details.rawBody || (err as Error).message || String(err),
    });
    return {
      model: normalizedModel,
      usable: false,
      status: status === 'unknown_error' ? 'unavailable' : status,
      reason: details.errorMessage || (err as Error).message || String(err),
      latencyMs,
      ...details,
    };
  }
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

function normalizeNinerouterModelId(model: string): string {
  const trimmed = (model || '').trim();
  if (trimmed.startsWith('ninerouter/')) return trimmed.slice('ninerouter/'.length);
  return trimmed;
}

function isAutoModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'auto' || normalized === 'openai/auto' || normalized === 'ninerouter/auto';
}

function isGeminiFlashLiteModel(model: string): boolean {
  return /^gemini\/.*(?:flash|lite)/i.test(model);
}

function isNvidiaOrFreeModel(model: string): boolean {
  return /^nvidia\//i.test(model) || /(?:^|[-/:])free(?:$|[-/:])/i.test(model);
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) return Number(value.trim());
  }
  return undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') return value;
    if (value !== undefined && value !== null && typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
  }
  return undefined;
}

function parseJsonObject(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseStatusFromText(value?: string): number | undefined {
  const match = value?.match(/\b([45]\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function looksLikeErrorDetails(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return 'httpStatus' in value || 'errorType' in value || 'errorMessage' in value || 'rawBody' in value;
}
