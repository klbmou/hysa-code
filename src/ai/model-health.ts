import {
  getChatRuntimeState,
  getProviderHealth,
  saveChatRuntimeState,
  saveProviderHealth,
} from '../utils/session.js';
import type {
  ChatRuntimeState,
  FallbackEventEntry,
  LastChatErrorEntry,
  ProviderCooldownEntry,
  ProviderHealthEntry,
} from '../utils/session.js';

export type ErrorCategory = 'rate_limit' | 'quota' | 'timeout' | 'network' | 'invalid_key' | 'model_unavailable' | 'unknown';

export interface FallbackEvent {
  provider: string;
  model: string;
  reason: string;
  timestamp: number;
}

export interface ProviderAnalytics {
  totalRequests: number;
  totalErrors: number;
  timeoutCount: number;
  rateLimitCount: number;
  recoverySuccessCount: number;
  streamInterruptionCount: number;
  lastLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  totalLatencyMs: number;
  lastRecoveryTime?: number;
}

export interface ProviderHealthRecord {
  status: 'healthy' | 'unhealthy';
  reason: string;
  category: ErrorCategory;
  timestamp: number;
  failedCount: number;
  lastSuccessTime?: number;
  lastFailureTime?: number;
  failureReason?: string;
  rateLimited: boolean;
  timedOut: boolean;
  cooldownUntil?: number;
  cooldownReason?: string;
  averageResponseTimeMs?: number;
  requestCount: number;
  totalResponseTimeMs: number;
  analytics?: ProviderAnalytics;
}

export interface LastErrorInfo {
  provider: string;
  model: string;
  category: ErrorCategory;
  reason: string;
  timestamp: number;
}

export interface CooldownInfo {
  provider: string;
  model: string;
  reason: string;
  category: ErrorCategory;
  cooldownUntil: number;
  remainingMs: number;
}

export interface ProviderCooldownInfo {
  provider: string;
  reason: string;
  category: ErrorCategory;
  timestamp: number;
  cooldownUntil: number;
  remainingMs: number;
  failedCount: number;
}

interface CooldownRecord {
  until: number;
  reason: string;
  category: ErrorCategory;
  timestamp: number;
}

interface ProviderCooldownRecord extends CooldownRecord {
  failedCount: number;
}

const KEY_SEP = '\t';
const healthStore = new Map<string, ProviderHealthRecord>();
const requestSkipped = new Set<string>();
const cooldowns = new Map<string, CooldownRecord>();
const providerCooldowns = new Map<string, ProviderCooldownRecord>();
const fallbackEvents: FallbackEvent[] = [];

const HEALTH_TTL_MS = parseInt(process.env.HYSA_MODEL_HEALTH_TTL_MS || '60000', 10);
const DEFAULT_COOLDOWN_MS = parseInt(process.env.HYSA_MODEL_COOLDOWN_MS || '60000', 10);
const RATE_LIMIT_COOLDOWN_MS = parseInt(process.env.HYSA_RATE_LIMIT_COOLDOWN_MS || '120000', 10);
const PROVIDER_COOLDOWN_MS = parseInt(process.env.HYSA_PROVIDER_COOLDOWN_MS || '120000', 10);

const providerAnalyticsStore = new Map<string, ProviderAnalytics>();

let loadedFromSession = false;
let lastError: LastErrorInfo | null = null;
let lastFallbackUsed: string | null = null;
let lastSuccessfulProvider: string | null = null;
let lastSuccessfulModel: string | null = null;

function key(provider: string, model: string): string {
  return `${provider}${KEY_SEP}${model}`;
}

function splitKey(k: string): { provider: string; model: string } {
  const sep = k.indexOf(KEY_SEP);
  if (sep >= 0) {
    return { provider: k.slice(0, sep), model: k.slice(sep + KEY_SEP.length) };
  }

  const legacySep = k.indexOf(':');
  if (legacySep >= 0) {
    return { provider: k.slice(0, legacySep), model: k.slice(legacySep + 1) };
  }

  return { provider: k, model: '' };
}

function normalizeCategory(category: string | undefined): ErrorCategory {
  if (
    category === 'rate_limit' ||
    category === 'quota' ||
    category === 'timeout' ||
    category === 'network' ||
    category === 'invalid_key' ||
    category === 'model_unavailable' ||
    category === 'unknown'
  ) {
    return category;
  }
  return 'unknown';
}

const TIMEOUT_COOLDOWN_MS = 30000;
const NETWORK_COOLDOWN_MS = 20000;

function getCooldownMs(category: ErrorCategory): number {
  switch (category) {
    case 'timeout': return TIMEOUT_COOLDOWN_MS;
    case 'rate_limit': return RATE_LIMIT_COOLDOWN_MS;
    case 'model_unavailable': return DEFAULT_COOLDOWN_MS;
    case 'network': return NETWORK_COOLDOWN_MS;
    case 'quota': return Math.max(RATE_LIMIT_COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
    case 'invalid_key': return Math.max(300000, DEFAULT_COOLDOWN_MS);
    default: return DEFAULT_COOLDOWN_MS;
  }
}

function ensureLoaded(): void {
  if (loadedFromSession) return;
  loadedFromSession = true;
  loadHealthFromEntries(getProviderHealth());
  loadRuntimeState(getChatRuntimeState());
  pruneExpiredCooldowns(false);
}

function loadRuntimeState(state: ChatRuntimeState): void {
  lastError = state.lastError
    ? {
        provider: state.lastError.provider,
        model: state.lastError.model,
        category: normalizeCategory(state.lastError.category),
        reason: state.lastError.reason,
        timestamp: state.lastError.timestamp,
      }
    : lastError;
  lastFallbackUsed = state.lastFallbackUsed ?? null;
  lastSuccessfulProvider = state.lastSuccessfulProvider ?? null;
  lastSuccessfulModel = state.lastSuccessfulModel ?? null;

  providerCooldowns.clear();
  for (const entry of state.providerCooldowns ?? []) {
    if (entry.cooldownUntil > Date.now()) {
      providerCooldowns.set(entry.provider, {
        until: entry.cooldownUntil,
        reason: entry.reason,
        category: normalizeCategory(entry.category),
        timestamp: entry.timestamp,
        failedCount: entry.failedCount ?? 1,
      });
    }
  }

  fallbackEvents.length = 0;
  for (const entry of state.fallbackEvents ?? []) {
    fallbackEvents.push({
      provider: entry.provider,
      model: entry.model,
      reason: entry.reason,
      timestamp: entry.timestamp,
    });
  }
}

function pruneExpiredCooldowns(shouldPersist = true): void {
  const now = Date.now();
  let changed = false;

  for (const [k, cd] of cooldowns) {
    if (now >= cd.until) {
      cooldowns.delete(k);
      const rec = healthStore.get(k);
      if (rec?.cooldownUntil) {
        healthStore.set(k, { ...rec, cooldownUntil: undefined, cooldownReason: undefined });
      }
      changed = true;
    }
  }

  for (const [provider, cd] of providerCooldowns) {
    if (now >= cd.until) {
      providerCooldowns.delete(provider);
      changed = true;
    }
  }

  if (changed && shouldPersist) persistState();
}

function persistState(): void {
  const runtime: ChatRuntimeState = {
    lastError: lastError ? { ...lastError } : null,
    lastFallbackUsed,
    lastSuccessfulProvider,
    lastSuccessfulModel,
    providerCooldowns: buildProviderCooldownEntries(),
    fallbackEvents: fallbackEvents.slice(-30).map(e => ({ ...e })),
    providerAnalytics: buildAnalyticsEntries(),
    updatedAt: Date.now(),
  };

  try {
    saveProviderHealth(buildHealthEntries());
    saveChatRuntimeState(runtime);
  } catch {
    // Session persistence is best-effort. Routing should continue even if the file cannot be written.
  }
}

function buildHealthEntries(): ProviderHealthEntry[] {
  const entries: ProviderHealthEntry[] = [];
  for (const [k, rec] of healthStore) {
    const cd = cooldowns.get(k);
    if (rec.status !== 'unhealthy' && !cd) continue;
    const { provider, model } = splitKey(k);
    entries.push({
      provider,
      model,
      reason: rec.reason,
      category: rec.category,
      timestamp: rec.timestamp,
      failedCount: rec.failedCount,
      lastSuccessTime: rec.lastSuccessTime,
      lastFailureTime: rec.lastFailureTime,
      failureReason: rec.failureReason,
      rateLimited: rec.rateLimited,
      timedOut: rec.timedOut,
      cooldownUntil: cd?.until ?? rec.cooldownUntil,
      cooldownReason: cd?.reason ?? rec.cooldownReason,
      averageResponseTimeMs: rec.averageResponseTimeMs,
      requestCount: rec.requestCount,
      totalResponseTimeMs: rec.totalResponseTimeMs,
    });
  }
  return entries;
}

function buildProviderCooldownEntries(): ProviderCooldownEntry[] {
  const entries: ProviderCooldownEntry[] = [];
  for (const [provider, cd] of providerCooldowns) {
    entries.push({
      provider,
      reason: cd.reason,
      category: cd.category,
      timestamp: cd.timestamp,
      cooldownUntil: cd.until,
      failedCount: cd.failedCount,
    });
  }
  return entries;
}

function buildAnalyticsEntries(): { provider: string; model: string; analytics: ProviderAnalytics }[] {
  const entries: { provider: string; model: string; analytics: ProviderAnalytics }[] = [];
  for (const [k, a] of providerAnalyticsStore) {
    const { provider, model } = splitKey(k);
    entries.push({ provider, model, analytics: a });
  }
  return entries;
}

export function markHealth(
  provider: string,
  model: string,
  status: 'healthy' | 'unhealthy',
  reason: string,
  category: ErrorCategory = 'unknown',
  responseTimeMs?: number,
): void {
  ensureLoaded();
  const k = key(provider, model);
  const existing = healthStore.get(k);

  if (status === 'unhealthy') {
    const now = Date.now();
    const failedCount = (existing?.failedCount ?? 0) + 1;
    const friendlyReason = category === 'rate_limit'
      ? `${reason} (Rate limit may be RPM/TPM/daily-quota based, not context tokens)`
      : reason;
    const cooldownMs = getCooldownMs(category);
    const cooldownUntil = now + cooldownMs;

    const entry: ProviderHealthRecord = {
      status: 'unhealthy',
      reason: failedCount >= 2
        ? `${friendlyReason} (failed ${failedCount} times, auto-skipped while cooling down)`
        : friendlyReason,
      category,
      timestamp: now,
      failedCount,
      lastSuccessTime: existing?.lastSuccessTime,
      lastFailureTime: now,
      failureReason: reason,
      rateLimited: category === 'rate_limit',
      timedOut: category === 'timeout',
      cooldownUntil,
      cooldownReason: reason,
      averageResponseTimeMs: existing?.averageResponseTimeMs,
      requestCount: existing?.requestCount ?? 0,
      totalResponseTimeMs: existing?.totalResponseTimeMs ?? 0,
    };
    healthStore.set(k, entry);
    requestSkipped.add(k);
    cooldowns.set(k, { until: cooldownUntil, reason, category, timestamp: now });
    lastError = { provider, model, category, reason, timestamp: now };
  } else {
    const now = Date.now();
    const requestCount = (existing?.requestCount ?? 0) + 1;
    const totalResponseTimeMs = (existing?.totalResponseTimeMs ?? 0) + (responseTimeMs ?? 0);
    const averageResponseTimeMs = requestCount > 0 ? totalResponseTimeMs / requestCount : undefined;

    healthStore.set(k, {
      status: 'healthy',
      reason: '',
      category: 'unknown',
      timestamp: now,
      failedCount: 0,
      lastSuccessTime: now,
      lastFailureTime: existing?.lastFailureTime,
      failureReason: undefined,
      rateLimited: false,
      timedOut: false,
      averageResponseTimeMs,
      requestCount,
      totalResponseTimeMs,
    });
    cooldowns.delete(k);
    if (providerCooldowns.has(provider)) providerCooldowns.delete(provider);
  }

  persistState();
}

export function markModelCooldown(provider: string, model: string, reason: string, seconds: number, category: ErrorCategory = 'rate_limit'): void {
  ensureLoaded();
  const now = Date.now();
  const until = now + Math.max(1, seconds) * 1000;
  const k = key(provider, model);
  const existing = healthStore.get(k);
  cooldowns.set(k, { until, reason, category, timestamp: now });

  if (existing) {
    healthStore.set(k, {
      ...existing,
      status: 'unhealthy',
      category,
      reason: existing.reason || reason,
      timestamp: now,
      lastFailureTime: existing.lastFailureTime ?? now,
      failureReason: existing.failureReason ?? reason,
      rateLimited: existing.rateLimited || category === 'rate_limit',
      timedOut: existing.timedOut || category === 'timeout',
      cooldownUntil: until,
      cooldownReason: reason,
    });
  } else {
    healthStore.set(k, {
      status: 'unhealthy',
      reason,
      category,
      timestamp: now,
      failedCount: 1,
      lastFailureTime: now,
      failureReason: reason,
      rateLimited: category === 'rate_limit',
      timedOut: category === 'timeout',
      cooldownUntil: until,
      cooldownReason: reason,
      requestCount: 0,
      totalResponseTimeMs: 0,
    });
  }

  lastError = { provider, model, category, reason, timestamp: now };
  persistState();
}

export function markProviderCooldown(provider: string, reason: string, seconds: number, category: ErrorCategory = 'rate_limit'): void {
  ensureLoaded();
  const now = Date.now();
  const existing = providerCooldowns.get(provider);
  providerCooldowns.set(provider, {
    until: now + Math.max(1, seconds) * 1000,
    reason,
    category,
    timestamp: now,
    failedCount: (existing?.failedCount ?? 0) + 1,
  });
  persistState();
}

export function isOnCooldown(provider: string, model: string): boolean {
  ensureLoaded();
  pruneExpiredCooldowns();
  return cooldowns.has(key(provider, model));
}

export function isProviderOnCooldown(provider: string): boolean {
  ensureLoaded();
  pruneExpiredCooldowns();
  return providerCooldowns.has(provider);
}

export function getCooldownRemaining(provider: string, model: string): number {
  ensureLoaded();
  pruneExpiredCooldowns();
  const until = cooldowns.get(key(provider, model))?.until;
  if (!until) return 0;
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function getProviderCooldownRemaining(provider: string): number {
  ensureLoaded();
  pruneExpiredCooldowns();
  const until = providerCooldowns.get(provider)?.until;
  if (!until) return 0;
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function clearCooldowns(): void {
  ensureLoaded();
  cooldowns.clear();
  providerCooldowns.clear();
  for (const [k, rec] of healthStore) {
    if (rec.cooldownUntil || rec.cooldownReason) {
      healthStore.set(k, { ...rec, cooldownUntil: undefined, cooldownReason: undefined });
    }
  }
  persistState();
}

export function isUnhealthy(provider: string, model: string): boolean {
  ensureLoaded();
  pruneExpiredCooldowns();
  const rec = healthStore.get(key(provider, model));
  if (!rec || rec.status !== 'unhealthy') return false;
  if (cooldowns.has(key(provider, model))) return true;
  if (Date.now() - rec.timestamp > HEALTH_TTL_MS) return false;
  return true;
}

export function isSkippedForRequest(provider: string, model: string): boolean {
  ensureLoaded();
  return requestSkipped.has(key(provider, model));
}

export function getHealthRecord(provider: string, model: string): ProviderHealthRecord | null {
  ensureLoaded();
  return healthStore.get(key(provider, model)) ?? null;
}

export function getHealthRecordsForProvider(provider: string): ProviderHealthRecord[] {
  ensureLoaded();
  const records: ProviderHealthRecord[] = [];
  for (const [k, rec] of healthStore) {
    if (splitKey(k).provider === provider) records.push(rec);
  }
  return records;
}

export function getHealthForProvider(provider: string): ProviderHealthRecord | null {
  const records = getHealthRecordsForProvider(provider);
  if (records.length === 0) return null;
  return records.sort((a, b) => b.timestamp - a.timestamp)[0];
}

export function getHealthSummary(provider?: string, model?: string): string {
  ensureLoaded();
  pruneExpiredCooldowns();
  const lines: string[] = ['=== Provider Health Summary ==='];

  for (const [k, rec] of healthStore) {
    const parsed = splitKey(k);
    if (provider && parsed.provider !== provider) continue;
    if (model && parsed.model !== model) continue;

    const status = rec.status;
    const fails = rec.failedCount;
    const requests = rec.requestCount;
    const avg = rec.averageResponseTimeMs !== undefined ? `${rec.averageResponseTimeMs.toFixed(0)}ms` : 'N/A';
    const lastSuccess = rec.lastSuccessTime ? new Date(rec.lastSuccessTime).toLocaleTimeString() : 'never';
    const lastFailure = rec.lastFailureTime ? new Date(rec.lastFailureTime).toLocaleTimeString() : 'never';

    lines.push(`  ${parsed.provider}/${parsed.model}`);
    lines.push(`    Status: ${status}`);
    lines.push(`    Requests: ${requests}`);
    lines.push(`    Consecutive failures: ${fails}`);
    lines.push(`    Avg response time: ${avg}`);
    lines.push(`    Last success: ${lastSuccess}`);
    lines.push(`    Last failure: ${lastFailure}`);
    if (rec.rateLimited) lines.push(`    Rate limited: yes`);
    if (rec.timedOut) lines.push(`    Timed out: yes`);
    if (rec.cooldownUntil && rec.cooldownUntil > Date.now()) {
      lines.push(`    Cooldown: ${Math.ceil((rec.cooldownUntil - Date.now()) / 1000)}s remaining`);
    }
    if (rec.status === 'unhealthy' && rec.reason) lines.push(`    Reason: ${rec.reason}`);
  }

  if (lines.length === 1) {
    lines.push('  No health records found.');
  }

  return lines.join('\n');
}

export function getAllHealth(): Map<string, ProviderHealthRecord> {
  ensureLoaded();
  pruneExpiredCooldowns();
  return new Map(healthStore);
}

export function getLastError(): LastErrorInfo | null {
  ensureLoaded();
  return lastError;
}

export function getLastFallbackUsed(): string | null {
  ensureLoaded();
  return lastFallbackUsed;
}

export function setLastFallbackUsed(fb: string | null): void {
  ensureLoaded();
  lastFallbackUsed = fb;
  persistState();
}

export function getLastSuccessfulProvider(): string | null {
  ensureLoaded();
  return lastSuccessfulProvider;
}

export function getLastSuccessfulModel(): string | null {
  ensureLoaded();
  return lastSuccessfulModel;
}

export function setLastSuccessfulProvider(provider: string | null, model: string | null): void {
  ensureLoaded();
  lastSuccessfulProvider = provider;
  lastSuccessfulModel = model;
  persistState();
}

export function addFallbackEvent(provider: string, model: string, reason: string): void {
  ensureLoaded();
  fallbackEvents.push({ provider, model, reason, timestamp: Date.now() });
  if (fallbackEvents.length > 50) fallbackEvents.splice(0, fallbackEvents.length - 50);
  persistState();
}

export function getFallbackEvents(): FallbackEvent[] {
  ensureLoaded();
  return [...fallbackEvents];
}

export function clearFallbackEvents(): void {
  ensureLoaded();
  fallbackEvents.length = 0;
  persistState();
}

export function clearRequestSkips(): void {
  ensureLoaded();
  requestSkipped.clear();
}

let analyticsInitialized = false;

function ensureAnalytics(): void {
  if (analyticsInitialized) return;
  analyticsInitialized = true;
  loadAnalytics();
}

function analyticsKey(provider: string, model: string): string {
  return `${provider}${KEY_SEP}${model}`;
}

function loadAnalytics(): void {
  const state = getChatRuntimeState();
  if (state.providerAnalytics) {
    for (const entry of state.providerAnalytics) {
      const k = analyticsKey(entry.provider, entry.model);
      providerAnalyticsStore.set(k, entry.analytics);
    }
  }
}

function persistAnalytics(): void {
  const entries: { provider: string; model: string; analytics: ProviderAnalytics }[] = [];
  for (const [k, a] of providerAnalyticsStore) {
    const { provider, model } = splitKey(k);
    entries.push({ provider, model, analytics: a });
  }
  try {
    const state = getChatRuntimeState();
    state.providerAnalytics = entries;
    saveChatRuntimeState(state);
  } catch {
    // best-effort
  }
}

function getOrCreateAnalytics(provider: string, model: string): ProviderAnalytics {
  const k = analyticsKey(provider, model);
  let a = providerAnalyticsStore.get(k);
  if (!a) {
    a = {
      totalRequests: 0,
      totalErrors: 0,
      timeoutCount: 0,
      rateLimitCount: 0,
      recoverySuccessCount: 0,
      streamInterruptionCount: 0,
      lastLatencyMs: 0,
      minLatencyMs: Infinity,
      maxLatencyMs: 0,
      totalLatencyMs: 0,
    };
    providerAnalyticsStore.set(k, a);
  }
  return a;
}

export function recordRequestLatency(provider: string, model: string, latencyMs: number): void {
  ensureAnalytics();
  const a = getOrCreateAnalytics(provider, model);
  a.totalRequests++;
  a.lastLatencyMs = latencyMs;
  a.totalLatencyMs += latencyMs;
  if (latencyMs < a.minLatencyMs) a.minLatencyMs = latencyMs;
  if (latencyMs > a.maxLatencyMs) a.maxLatencyMs = latencyMs;
  persistAnalytics();
}

export function recordErrorAnalytics(provider: string, model: string, category: ErrorCategory): void {
  ensureAnalytics();
  const a = getOrCreateAnalytics(provider, model);
  a.totalErrors++;
  if (category === 'timeout') a.timeoutCount++;
  if (category === 'rate_limit') a.rateLimitCount++;
  persistAnalytics();
}

export function recordRecoverySuccess(provider: string, model: string): void {
  ensureAnalytics();
  const a = getOrCreateAnalytics(provider, model);
  a.recoverySuccessCount++;
  a.lastRecoveryTime = Date.now();
  persistAnalytics();
}

export function recordStreamInterruption(provider: string, model: string): void {
  ensureAnalytics();
  const a = getOrCreateAnalytics(provider, model);
  a.streamInterruptionCount++;
  persistAnalytics();
}

export function getProviderAnalytics(provider: string, model: string): ProviderAnalytics | null {
  ensureAnalytics();
  return providerAnalyticsStore.get(analyticsKey(provider, model)) ?? null;
}

export function getAllProviderAnalytics(): Map<string, ProviderAnalytics> {
  ensureAnalytics();
  return new Map(providerAnalyticsStore);
}

export function getTimeoutRate(provider: string, model: string): number {
  ensureAnalytics();
  const a = providerAnalyticsStore.get(analyticsKey(provider, model));
  if (!a || a.totalRequests === 0) return 0;
  return a.timeoutCount / a.totalRequests;
}

export function getRecoveryRate(provider: string, model: string): number {
  ensureAnalytics();
  const a = providerAnalyticsStore.get(analyticsKey(provider, model));
  if (!a || a.streamInterruptionCount === 0) return 1;
  return a.recoverySuccessCount / a.streamInterruptionCount;
}

export function getAverageLatency(provider: string, model: string): number {
  ensureAnalytics();
  const a = providerAnalyticsStore.get(analyticsKey(provider, model));
  if (!a || a.totalRequests === 0) return 0;
  return a.totalLatencyMs / a.totalRequests;
}

export function resetHealth(): void {
  ensureLoaded();
  healthStore.clear();
  requestSkipped.clear();
  cooldowns.clear();
  providerCooldowns.clear();
  providerAnalyticsStore.clear();
  lastError = null;
  lastFallbackUsed = null;
  lastSuccessfulProvider = null;
  lastSuccessfulModel = null;
  fallbackEvents.length = 0;
  try {
    saveProviderHealth([]);
    saveChatRuntimeState({});
  } catch {
    // best-effort
  }
}

export function toHealthSummary(): string[] {
  ensureLoaded();
  pruneExpiredCooldowns();
  const lines: string[] = [];

  for (const [provider, cd] of providerCooldowns) {
    const remaining = Math.ceil((cd.until - Date.now()) / 1000);
    if (remaining > 0) {
      lines.push(`  ${provider} - provider cooldown: ${cd.reason} (${remaining}s remaining)`);
    }
  }

  for (const [k, rec] of healthStore) {
    const cd = cooldowns.get(k);
    if (rec.status === 'unhealthy' || cd) {
      const { provider, model } = splitKey(k);
      const cooldownText = cd && cd.until > Date.now()
        ? `, cooldown ${Math.ceil((cd.until - Date.now()) / 1000)}s`
        : '';
      lines.push(`  ${provider}/${model} - ${rec.reason} (${rec.failedCount}x${cooldownText}, ${new Date(rec.timestamp).toLocaleTimeString()})`);
    }
  }

  return lines;
}

export function toHealthEntries(): ProviderHealthEntry[] {
  ensureLoaded();
  pruneExpiredCooldowns();
  return buildHealthEntries();
}

export function getModelsInCooldown(provider?: string): CooldownInfo[] {
  ensureLoaded();
  pruneExpiredCooldowns();
  const now = Date.now();
  const entries: CooldownInfo[] = [];
  for (const [k, cd] of cooldowns) {
    const parsed = splitKey(k);
    if (provider && parsed.provider !== provider) continue;
    entries.push({
      provider: parsed.provider,
      model: parsed.model,
      reason: cd.reason,
      category: cd.category,
      cooldownUntil: cd.until,
      remainingMs: Math.max(0, cd.until - now),
    });
  }
  return entries.sort((a, b) => a.cooldownUntil - b.cooldownUntil);
}

export function getProviderCooldowns(provider?: string): ProviderCooldownInfo[] {
  ensureLoaded();
  pruneExpiredCooldowns();
  const now = Date.now();
  const entries: ProviderCooldownInfo[] = [];
  for (const [p, cd] of providerCooldowns) {
    if (provider && p !== provider) continue;
    entries.push({
      provider: p,
      reason: cd.reason,
      category: cd.category,
      timestamp: cd.timestamp,
      cooldownUntil: cd.until,
      remainingMs: Math.max(0, cd.until - now),
      failedCount: cd.failedCount,
    });
  }
  return entries.sort((a, b) => a.cooldownUntil - b.cooldownUntil);
}

export function getRateLimitedModels(provider?: string): ProviderHealthEntry[] {
  ensureLoaded();
  return buildHealthEntries()
    .filter(e => e.rateLimited && (!provider || e.provider === provider))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function loadHealthFromEntries(entries: ProviderHealthEntry[]): void {
  const now = Date.now();
  let newestError: LastErrorInfo | null = lastError;
  for (const e of entries) {
    const category = normalizeCategory(e.category);
    const k = key(e.provider, e.model);
    healthStore.set(k, {
      status: 'unhealthy',
      reason: e.reason,
      category,
      timestamp: e.timestamp,
      failedCount: e.failedCount,
      lastSuccessTime: e.lastSuccessTime,
      lastFailureTime: e.lastFailureTime,
      failureReason: e.failureReason,
      rateLimited: e.rateLimited ?? category === 'rate_limit',
      timedOut: e.timedOut ?? category === 'timeout',
      cooldownUntil: e.cooldownUntil,
      cooldownReason: e.cooldownReason,
      averageResponseTimeMs: e.averageResponseTimeMs,
      requestCount: e.requestCount ?? 0,
      totalResponseTimeMs: e.totalResponseTimeMs ?? 0,
    });

    if (e.cooldownUntil && e.cooldownUntil > now) {
      cooldowns.set(k, {
        until: e.cooldownUntil,
        reason: e.cooldownReason || e.failureReason || e.reason,
        category,
        timestamp: e.timestamp,
      });
    }

    if (!newestError || e.timestamp > newestError.timestamp) {
      newestError = {
        provider: e.provider,
        model: e.model,
        category,
        reason: e.failureReason || e.reason,
        timestamp: e.timestamp,
      };
    }
  }
  lastError = newestError;
}

export { key as healthKey };
