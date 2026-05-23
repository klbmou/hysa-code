export type ErrorCategory = 'rate_limit' | 'quota' | 'timeout' | 'network' | 'invalid_key' | 'model_unavailable' | 'unknown';

export interface FallbackEvent {
  provider: string;
  model: string;
  reason: string;
  timestamp: number;
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
  averageResponseTimeMs?: number;
  requestCount: number;
  totalResponseTimeMs: number;
}

interface LastErrorInfo {
  provider: string;
  model: string;
  category: ErrorCategory;
  reason: string;
  timestamp: number;
}

import { saveProviderHealth } from '../utils/session.js';
import type { ProviderHealthEntry } from '../utils/session.js';

const healthStore = new Map<string, ProviderHealthRecord>();
const requestSkipped = new Set<string>();

const HEALTH_TTL_MS = 60000;

let lastError: LastErrorInfo | null = null;
let lastFallbackUsed: string | null = null;
let lastSuccessfulProvider: string | null = null;
let lastSuccessfulModel: string | null = null;
const fallbackEvents: FallbackEvent[] = [];

function key(provider: string, model: string): string {
  return `${provider}:${model}`;
}

export function markHealth(
  provider: string,
  model: string,
  status: 'healthy' | 'unhealthy',
  reason: string,
  category: ErrorCategory = 'unknown',
  responseTimeMs?: number,
): void {
  const k = key(provider, model);
  const existing = healthStore.get(k);

  if (status === 'unhealthy') {
    const failedCount = (existing?.failedCount ?? 0) + 1;
    const entry: ProviderHealthRecord = {
      status: 'unhealthy',
      reason: category === 'rate_limit' ? `${reason} (Rate limit may be RPM/TPM/daily-quota based, not context tokens)` : reason,
      category,
      timestamp: Date.now(),
      failedCount,
      lastSuccessTime: existing?.lastSuccessTime,
      lastFailureTime: Date.now(),
      failureReason: reason,
      rateLimited: category === 'rate_limit',
      timedOut: category === 'timeout',
      averageResponseTimeMs: existing?.averageResponseTimeMs,
      requestCount: existing?.requestCount ?? 0,
      totalResponseTimeMs: existing?.totalResponseTimeMs ?? 0,
    };
    healthStore.set(k, entry);
    requestSkipped.add(k);

    lastError = { provider, model, category, reason, timestamp: Date.now() };

    if (failedCount >= 2) {
      healthStore.set(k, {
        ...entry,
        reason: `${reason} (failed ${failedCount} times, auto-skipped for rest of session)`,
      });
    }
  } else {
    const requestCount = (existing?.requestCount ?? 0) + 1;
    const totalResponseTimeMs = (existing?.totalResponseTimeMs ?? 0) + (responseTimeMs ?? 0);
    const averageResponseTimeMs = requestCount > 0 ? totalResponseTimeMs / requestCount : undefined;

    healthStore.set(k, {
      status: 'healthy',
      reason: '',
      category: 'unknown',
      timestamp: Date.now(),
      failedCount: 0,
      lastSuccessTime: Date.now(),
      lastFailureTime: existing?.lastFailureTime,
      failureReason: undefined,
      rateLimited: false,
      timedOut: false,
      averageResponseTimeMs,
      requestCount,
      totalResponseTimeMs,
    });
  }

  // Persist to session
  try {
    saveProviderHealth(toHealthEntries());
  } catch { /* session save is best-effort */ }
}

export function isUnhealthy(provider: string, model: string): boolean {
  const rec = healthStore.get(key(provider, model));
  if (!rec) return false;
  if (rec.status !== 'unhealthy') return false;
  // Expired record — allow retry
  if (Date.now() - rec.timestamp > HEALTH_TTL_MS) return false;
  return true;
}

export function isSkippedForRequest(provider: string, model: string): boolean {
  return requestSkipped.has(key(provider, model));
}

export function getHealthRecord(provider: string, model: string): ProviderHealthRecord | null {
  return healthStore.get(key(provider, model)) ?? null;
}

export function getHealthForProvider(provider: string): ProviderHealthRecord | null {
  for (const [k, rec] of healthStore) {
    const sep = k.lastIndexOf(':');
    const p = k.substring(0, sep);
    if (p === provider) return rec;
  }
  return null;
}

export function getHealthSummary(provider?: string, model?: string): string {
  const lines: string[] = ['=== Provider Health Summary ==='];

  for (const [k, rec] of healthStore) {
    if (provider) {
      const sep = k.lastIndexOf(':');
      const p = k.substring(0, sep);
      if (p !== provider) continue;
    }
    if (model && !k.endsWith(`:${model}`)) continue;

    const status = rec.status;
    const fails = rec.failedCount;
    const requests = rec.requestCount;
    const avg = rec.averageResponseTimeMs !== undefined ? `${rec.averageResponseTimeMs.toFixed(0)}ms` : 'N/A';
    const lastSuccess = rec.lastSuccessTime ? new Date(rec.lastSuccessTime).toLocaleTimeString() : 'never';
    const lastFailure = rec.lastFailureTime ? new Date(rec.lastFailureTime).toLocaleTimeString() : 'never';

    lines.push(`  ${k}`);
    lines.push(`    Status: ${status}`);
    lines.push(`    Requests: ${requests}`);
    lines.push(`    Consecutive failures: ${fails}`);
    lines.push(`    Avg response time: ${avg}`);
    lines.push(`    Last success: ${lastSuccess}`);
    lines.push(`    Last failure: ${lastFailure}`);
    if (rec.rateLimited) lines.push(`    Rate limited: yes`);
    if (rec.timedOut) lines.push(`    Timed out: yes`);
    if (rec.status === 'unhealthy' && rec.reason) lines.push(`    Reason: ${rec.reason}`);
  }

  if (lines.length === 1) {
    lines.push('  No health records found.');
  }

  return lines.join('\n');
}

export function getAllHealth(): Map<string, ProviderHealthRecord> {
  return new Map(healthStore);
}

export function getLastError(): LastErrorInfo | null {
  return lastError;
}

export function getLastFallbackUsed(): string | null {
  return lastFallbackUsed;
}

export function setLastFallbackUsed(fb: string | null): void {
  lastFallbackUsed = fb;
}

export function getLastSuccessfulProvider(): string | null {
  return lastSuccessfulProvider;
}

export function getLastSuccessfulModel(): string | null {
  return lastSuccessfulModel;
}

export function setLastSuccessfulProvider(provider: string | null, model: string | null): void {
  lastSuccessfulProvider = provider;
  lastSuccessfulModel = model;
}

export function addFallbackEvent(provider: string, model: string, reason: string): void {
  fallbackEvents.push({ provider, model, reason, timestamp: Date.now() });
}

export function getFallbackEvents(): FallbackEvent[] {
  return [...fallbackEvents];
}

export function clearFallbackEvents(): void {
  fallbackEvents.length = 0;
}

export function clearRequestSkips(): void {
  requestSkipped.clear();
}

export function resetHealth(): void {
  healthStore.clear();
  requestSkipped.clear();
  lastError = null;
  lastFallbackUsed = null;
  fallbackEvents.length = 0;
  try {
    saveProviderHealth([]);
  } catch { /* best-effort */ }
}

export function toHealthSummary(): string[] {
  const lines: string[] = [];
  for (const [k, rec] of healthStore) {
    if (rec.status === 'unhealthy') {
      lines.push(`  ${k} — ${rec.reason} (${rec.failedCount}x, ${new Date(rec.timestamp).toLocaleTimeString()})`);
    }
  }
  return lines;
}

export function toHealthEntries(): ProviderHealthEntry[] {
  const entries: ProviderHealthEntry[] = [];
  for (const [k, rec] of healthStore) {
    if (rec.status === 'unhealthy') {
      const sep = k.lastIndexOf(':');
      const provider = k.substring(0, sep);
      const model = k.substring(sep + 1);
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
        averageResponseTimeMs: rec.averageResponseTimeMs,
        requestCount: rec.requestCount,
        totalResponseTimeMs: rec.totalResponseTimeMs,
      });
    }
  }
  return entries;
}

export function loadHealthFromEntries(entries: ProviderHealthEntry[]): void {
  for (const e of entries) {
    const k = key(e.provider, e.model);
    healthStore.set(k, {
      status: 'unhealthy',
      reason: e.reason,
      category: e.category as ErrorCategory,
      timestamp: e.timestamp,
      failedCount: e.failedCount,
      lastSuccessTime: e.lastSuccessTime,
      lastFailureTime: e.lastFailureTime,
      failureReason: e.failureReason,
      rateLimited: e.rateLimited ?? false,
      timedOut: e.timedOut ?? false,
      averageResponseTimeMs: e.averageResponseTimeMs,
      requestCount: e.requestCount ?? 0,
      totalResponseTimeMs: e.totalResponseTimeMs ?? 0,
    });
  }
}

export { key as healthKey };
