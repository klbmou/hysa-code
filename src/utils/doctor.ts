import pc from 'picocolors';
import { loadConfig, PROVIDER_SIGNUP_URLS, PROVIDER_DEFAULTS, PROVIDER_TIERS, TIER_LABELS, FREE_API_PROVIDERS, LOCAL_FREE_PROVIDERS, EXPERIMENTAL_FREE_PROVIDERS, EXPERIMENTAL_BASE_URLS, validateApiKey, normalizeApiKey, providerNeedsApiKey, providerHasOptionalApiKey } from '../config/keys.js';
import type { ProviderType, HysaConfig } from '../config/keys.js';
import { checkOpenCodeZenAPI } from '../ai/opencode-zen.js';
import { checkAnthropicProxyAPI } from '../ai/anthropic-proxy.js';
import { checkOpenAICompatibleAPI } from '../ai/openai-compatible.js';

const DOCTOR_TIMEOUT_MS = 15000;

interface DoctorResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${timeoutMs / 1000}s`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

async function checkInternet(): Promise<DoctorResult> {
  try {
    await withTimeout(
      fetch('https://google.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) }).then(r => r),
      5000,
    );
    return { name: 'Internet', status: 'ok', message: 'Connected' };
  } catch {
    return { name: 'Internet', status: 'error', message: 'No internet connection' };
  }
}

async function checkOllama(baseUrl: string): Promise<DoctorResult> {
  try {
    const res = await withTimeout(
      fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (res.ok) {
      const data = (await res.json()) as { models?: unknown[] };
      const count = data.models?.length ?? 0;
      return { name: 'Ollama', status: 'ok', message: `Running (${count} model${count !== 1 ? 's' : ''})` };
    }
    return { name: 'Ollama', status: 'warn', message: `HTTP ${res.status}` };
  } catch {
    return { name: 'Ollama', status: 'error', message: 'Not running' };
  }
}

async function checkLocalOpenAI(baseUrl: string): Promise<DoctorResult> {
  try {
    const res = await withTimeout(
      fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (res.ok) {
      const data = (await res.json()) as { data?: { id: string }[] };
      const models = data.data?.map((m: { id: string }) => m.id) || [];
      const modelList = models.slice(0, 3).join(', ');
      return { name: 'LM Studio / Local', status: 'ok', message: `Running (${modelList}${models.length > 3 ? '...' : ''})` };
    }
    return { name: 'LM Studio / Local', status: 'warn', message: `HTTP ${res.status}` };
  } catch {
    return { name: 'LM Studio / Local', status: 'error', message: 'Not running' };
  }
}

async function checkOpenCodeZen(apiKey?: string): Promise<DoctorResult> {
  if (!apiKey) {
    return { name: 'OpenCode Zen', status: 'error', message: 'No API key configured' };
  }
  const result = await checkOpenCodeZenAPI(apiKey);
  if (result.ok) {
    return { name: 'OpenCode Zen', status: 'ok', message: 'Reachable' };
  }
  return { name: 'OpenCode Zen', status: 'warn', message: result.message || 'Unreachable' };
}

async function checkOpenRouterAPI(apiKey?: string, debug = false): Promise<DoctorResult> {
  if (!apiKey) {
    return { name: 'OpenRouter', status: 'error', message: 'No API key configured' };
  }

  const cleaned = validateApiKey(apiKey, 'openrouter');
  if (!cleaned.valid) {
    if (debug) {
      return { name: 'OpenRouter', status: 'error', message: `Key validation failed: ${cleaned.error}` };
    }
    return { name: 'OpenRouter', status: 'error', message: 'Key contains invalid characters. Run hysa config and paste the key again.' };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleaned.key}`,
      'HTTP-Referer': 'https://github.com/hysa-code',
      'X-Title': 'HYSA Code',
    };
    const res = await withTimeout(
      fetch('https://openrouter.ai/api/v1/models', { headers, signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (res.ok) {
      return { name: 'OpenRouter', status: 'ok', message: 'API reachable' };
    }
    if (res.status === 401) {
      return { name: 'OpenRouter', status: 'error', message: 'Invalid API key (401). Run hysa config to update it.' };
    }
    const detail = debug ? ` (HTTP ${res.status})` : '';
    return { name: 'OpenRouter', status: 'warn', message: `API responded with status ${res.status}${detail}` };
  } catch (err: unknown) {
    const e = err as Error;
    const detail = debug ? `: ${e.message}` : '';
    return { name: 'OpenRouter', status: 'error', message: `Cannot reach API${detail}` };
  }
}

async function checkOpenRouterDetailed(apiKey: string, debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];

  const cleaned = validateApiKey(apiKey, 'openrouter');
  if (!cleaned.valid) {
    results.push({ name: 'OpenRouter Key Format', status: 'error', message: cleaned.error || 'Invalid key' });
    return results;
  }
  results.push({ name: 'OpenRouter Key Format', status: 'ok', message: 'Valid' });

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleaned.key}`,
      'HTTP-Referer': 'https://github.com/hysa-code',
      'X-Title': 'HYSA Code',
    };
    const getRes = await withTimeout(
      fetch('https://openrouter.ai/api/v1/models', { headers, signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (getRes.ok) {
      results.push({ name: 'OpenRouter GET /models', status: 'ok', message: `HTTP ${getRes.status}` });
    } else {
      const body = debug ? ` (HTTP ${getRes.status})` : '';
      results.push({ name: 'OpenRouter GET /models', status: 'error', message: `Failed with status ${getRes.status}${body}` });
    }
  } catch (err: unknown) {
    const e = err as Error;
    results.push({ name: 'OpenRouter GET /models', status: 'error', message: `Cannot reach API: ${debug ? e.message : 'check internet'}` });
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleaned.key}`,
      'HTTP-Referer': 'https://github.com/hysa-code',
      'X-Title': 'HYSA Code',
    };
    const body = JSON.stringify({
      model: 'openrouter/free',
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      max_tokens: 10,
    });
    const postRes = await withTimeout(
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS),
      }),
      DOCTOR_TIMEOUT_MS,
    );
    if (postRes.ok) {
      results.push({ name: 'OpenRouter POST /chat', status: 'ok', message: 'Chat completion works' });
    } else {
      let detail = `HTTP ${postRes.status}`;
      if (postRes.status === 401) detail = 'Invalid API key (401)';
      else if (postRes.status === 402) detail = 'Credits required (402). Try openrouter/free model.';
      else if (postRes.status === 404) detail = 'Model not found (404). Try a different model.';
      else if (postRes.status === 429) detail = 'Rate limited (429). Try again later.';
      else if (postRes.status >= 500) detail = 'Provider overloaded (5xx). Try again later.';
      if (debug) {
        try {
          const respBody = await postRes.text();
          detail += `\n  Response: ${respBody.slice(0, 300)}`;
        } catch { /* ignore */ }
      }
      results.push({ name: 'OpenRouter POST /chat', status: 'error', message: detail });
    }
  } catch (err: unknown) {
    const e = err as Error;
    results.push({ name: 'OpenRouter POST /chat', status: 'error', message: `Request failed: ${debug ? e.message : 'check internet or try again'}` });
  }

  return results;
}

async function checkApiReachability(name: ProviderType, debug = false): Promise<DoctorResult> {
  const url = PROVIDER_SIGNUP_URLS[name];
  if (!url) return { name: `${name} API`, status: 'warn', message: 'No URL' };
  try {
    const res = await withTimeout(
      fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (res.ok || res.status < 500) return { name: `${PROVIDER_DEFAULTS[name]?.label || name}`, status: 'ok', message: 'Reachable' };
    return { name: `${PROVIDER_DEFAULTS[name]?.label || name}`, status: 'warn', message: `HTTP ${res.status}` };
  } catch {
    return { name: `${PROVIDER_DEFAULTS[name]?.label || name}`, status: 'warn', message: 'Unreachable' };
  }
}

async function checkOpenAICompatibleEndpoint(label: string, baseURL: string, apiKey: string | undefined, debug: boolean): Promise<DoctorResult> {
  const keyStatus = apiKey ? 'with key' : 'without key';
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await withTimeout(
      fetch(`${baseURL}/models`, { headers, signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (res.ok) {
      return { name: label, status: 'ok', message: `API reachable ${keyStatus}` };
    }
    const detail = debug ? ` (HTTP ${res.status})` : '';
    return { name: label, status: 'warn', message: `API responded with status ${res.status}${detail}` };
  } catch (err: unknown) {
    const e = err as Error;
    const detail = debug ? `: ${e.message}` : '';
    return { name: label, status: 'error', message: `Cannot reach API${detail}` };
  }
}

async function checkChatCompletion(provider: ProviderType, baseURL: string, apiKey: string | undefined, debug: boolean): Promise<DoctorResult> {
  const label = `${PROVIDER_DEFAULTS[provider]?.label || provider} POST /chat`;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = JSON.stringify({
      model: PROVIDER_DEFAULTS[provider]?.model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      max_tokens: 10,
    });

    const res = await withTimeout(
      fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS),
      }),
      DOCTOR_TIMEOUT_MS,
    );
    if (res.ok) {
      return { name: label, status: 'ok', message: 'Chat completion works' };
    }
    let detail = `HTTP ${res.status}`;
    if (res.status === 400) detail = 'Bad request - model may not exist';
    else if (res.status === 401) detail = 'Invalid API key (401)';
    else if (res.status === 404) detail = 'Endpoint not found (404)';
    else if (res.status === 429) detail = 'Rate limited (429)';
    if (debug) {
      try {
        const respBody = await res.text();
        detail += `\n  Response: ${respBody.slice(0, 300)}`;
      } catch { /* ignore */ }
    }
    return { name: label, status: 'error', message: detail };
  } catch (err: unknown) {
    const e = err as Error;
    return { name: label, status: 'error', message: `Request failed: ${debug ? e.message : 'check internet or try again'}` };
  }
}

async function checkPollinations(debug = false): Promise<DoctorResult> {
  const baseURL = EXPERIMENTAL_BASE_URLS.pollinations || 'https://text.pollinations.ai/v1';
  return checkOpenAICompatibleEndpoint('Pollinations AI', baseURL, undefined, debug);
}

async function checkPollinationsDetailed(debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const baseURL = EXPERIMENTAL_BASE_URLS.pollinations || 'https://text.pollinations.ai/v1';

  results.push(await checkOpenAICompatibleEndpoint('Pollinations GET /models', baseURL, undefined, debug));
  results.push(await checkChatCompletion('pollinations', baseURL, undefined, debug));

  return results;
}

async function checkLLM7(debug = false): Promise<DoctorResult> {
  const baseURL = EXPERIMENTAL_BASE_URLS.llm7 || 'https://api.llm7.io/v1';
  return checkOpenAICompatibleEndpoint('LLM7', baseURL, undefined, debug);
}

async function checkLLM7Detailed(debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const baseURL = EXPERIMENTAL_BASE_URLS.llm7 || 'https://api.llm7.io/v1';

  results.push(await checkOpenAICompatibleEndpoint('LLM7 GET /models', baseURL, undefined, debug));
  results.push(await checkChatCompletion('llm7', baseURL, undefined, debug));

  return results;
}

async function checkPuter(debug = false): Promise<DoctorResult> {
  const baseURL = EXPERIMENTAL_BASE_URLS.puter || 'https://api.puter.com/v1';
  return checkOpenAICompatibleEndpoint('Puter AI', baseURL, undefined, debug);
}

async function checkPuterDetailed(debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const baseURL = EXPERIMENTAL_BASE_URLS.puter || 'https://api.puter.com/v1';

  results.push(await checkOpenAICompatibleEndpoint('Puter GET /models', baseURL, undefined, debug));
  results.push(await checkChatCompletion('puter', baseURL, undefined, debug));

  return results;
}

async function checkDeepSeekDetailed(apiKey: string, debug: boolean): Promise<DoctorResult[]> {
  return checkOpenAICompatibleDetailed('DeepSeek', 'https://api.deepseek.com/v1', apiKey, debug);
}

async function checkGeminiDetailed(apiKey: string, debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  try {
    const res = await withTimeout(
      fetch(url, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (res.ok) {
      results.push({ name: 'Gemini GET /models', status: 'ok', message: 'API reachable' });
    } else {
      results.push({ name: 'Gemini GET /models', status: 'error', message: debug ? `HTTP ${res.status}` : 'API returned error' });
    }
  } catch (err: unknown) {
    const e = err as Error;
    results.push({ name: 'Gemini GET /models', status: 'error', message: `Cannot reach API: ${debug ? e.message : 'check internet'}` });
  }
  return results;
}

async function checkGroqDetailed(apiKey: string, debug: boolean): Promise<DoctorResult[]> {
  return checkOpenAICompatibleDetailed('Groq', 'https://api.groq.com/openai/v1', apiKey, debug);
}

async function checkOpenAICompatibleDetailed(label: string, baseURL: string, apiKey: string | undefined, debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  results.push(await checkOpenAICompatibleEndpoint(`${label} GET /models`, baseURL, apiKey, debug));
  results.push(await checkChatCompletionForLabel(label, baseURL, apiKey, debug));
  return results;
}

async function checkChatCompletionForLabel(label: string, baseURL: string, apiKey: string | undefined, debug: boolean): Promise<DoctorResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      max_tokens: 10,
    });

    const res = await withTimeout(
      fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS),
      }),
      DOCTOR_TIMEOUT_MS,
    );
    if (res.ok) {
      return { name: `${label} POST /chat`, status: 'ok', message: 'Chat completion works' };
    }
    let detail = `HTTP ${res.status}`;
    if (res.status === 400) detail = 'Bad request - model may not exist';
    else if (res.status === 401) detail = 'Invalid API key (401)';
    else if (res.status === 404) detail = 'Endpoint not found (404)';
    else if (res.status === 429) detail = 'Rate limited (429)';
    if (debug) {
      try {
        const respBody = await res.text();
        detail += `\n  Response: ${respBody.slice(0, 300)}`;
      } catch { /* ignore */ }
    }
    return { name: `${label} POST /chat`, status: 'error', message: detail };
  } catch (err: unknown) {
    const e = err as Error;
    return { name: `${label} POST /chat`, status: 'error', message: `Request failed: ${debug ? e.message : 'check internet or try again'}` };
  }
}

async function checkHysaAIDetailed(debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const baseURL = 'http://localhost:3002/v1';
  const apiKey = 'hysa_dev_key';

  const modelsResult = await checkOpenAICompatibleEndpoint('HYSA AI GET /models', baseURL, apiKey, debug);
  results.push(modelsResult);

  if (modelsResult.status === 'error') {
    results.push({ name: 'HYSA AI POST /chat', status: 'error', message: 'Skipped - server not reachable' });
    return results;
  }

  const chatResult = await checkChatCompletionForModel('hysa-ai', baseURL, apiKey, 'hysa-coder-lite', debug);
  results.push(chatResult);

  return results;
}

async function checkAnthropicProxyDetailed(config: HysaConfig, debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const baseUrl = config.anthropicProxyBaseUrl;
  if (!baseUrl) {
    results.push({ name: 'Base URL', status: 'error', message: 'Not configured. Set HYSA_ANTHROPIC_PROXY_BASE_URL.' });
    return results;
  }

  try {
    const parsedUrl = new URL(baseUrl);
    results.push({ name: 'Base URL', status: 'ok', message: parsedUrl.href });
  } catch {
    results.push({ name: 'Base URL', status: 'error', message: `Invalid URL: ${baseUrl}` });
    return results;
  }

  const checkResult = await checkAnthropicProxyAPI(baseUrl, config.apiKeys.anthropic_proxy);
  if (checkResult.ok) {
    results.push({ name: 'API Connection', status: 'ok', message: 'Proxy endpoint is reachable' });
  } else {
    results.push({ name: 'API Connection', status: 'error', message: checkResult.message });
    return results;
  }

  const model = config.anthropicProxyModel || 'claude-3-5-sonnet-latest';
  results.push({ name: 'Default Model', status: 'ok', message: model });

  if (config.apiKeys.anthropic_proxy) {
    results.push({ name: 'API Key', status: 'ok', message: 'Configured' });
  } else {
    results.push({ name: 'API Key', status: 'warn', message: 'Not configured (optional)' });
  }

  return results;
}

async function checkOpenAIRouterDetailed(config: HysaConfig, debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const baseUrl = config.openaiRouterBaseUrl;
  if (!baseUrl) {
    results.push({ name: 'Base URL', status: 'error', message: 'Not configured. Set HYSA_OPENAI_ROUTER_BASE_URL.' });
    return results;
  }

  try {
    const parsedUrl = new URL(baseUrl);
    results.push({ name: 'Base URL', status: 'ok', message: parsedUrl.href });
  } catch {
    results.push({ name: 'Base URL', status: 'error', message: `Invalid URL: ${baseUrl}` });
    return results;
  }

  const checkResult = await checkOpenAICompatibleAPI(baseUrl, config.apiKeys.openai_router);
  if (checkResult.ok) {
    results.push({ name: 'API Connection', status: 'ok', message: 'Router endpoint is reachable' });
  } else {
    results.push({ name: 'API Connection', status: 'error', message: checkResult.message });
    return results;
  }

  const model = config.openaiRouterModel || 'gpt-4o-mini (default)';
  results.push({ name: 'Default Model', status: 'ok', message: model });

  if (config.apiKeys.openai_router) {
    results.push({ name: 'API Key', status: 'ok', message: 'Configured' });
  } else {
    results.push({ name: 'API Key', status: 'warn', message: 'Not configured (optional)' });
  }

  return results;
}

async function checkChatCompletionForModel(provider: string, baseURL: string, apiKey: string | undefined, model: string, debug: boolean): Promise<DoctorResult> {
  const label = `${provider} POST /chat`;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      max_tokens: 10,
    });

    const res = await withTimeout(
      fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS),
      }),
      DOCTOR_TIMEOUT_MS,
    );
    if (res.ok) {
      return { name: label, status: 'ok', message: 'Chat completion works' };
    }
    let detail = `HTTP ${res.status}`;
    if (res.status === 400) detail = 'Bad request - model may not exist';
    else if (res.status === 401) detail = 'Invalid API key (401)';
    else if (res.status === 404) detail = 'Endpoint not found (404)';
    if (debug) {
      try {
        const respBody = await res.text();
        detail += `\n  Response: ${respBody.slice(0, 300)}`;
      } catch { /* ignore */ }
    }
    return { name: label, status: 'error', message: detail };
  } catch (err: unknown) {
    const e = err as Error;
    return { name: label, status: 'error', message: `Request failed: ${debug ? e.message : 'check internet or try again'}` };
  }
}

async function checkOllamaDetailed(config: HysaConfig, debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const baseUrl = config.ollamaBaseUrl || 'http://localhost:11434';

  // Server reachable?
  try {
    const res = await withTimeout(
      fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (!res.ok) {
      results.push({ name: 'Ollama Server', status: 'error', message: `HTTP ${res.status} — is Ollama running?` });
      return results;
    }
    results.push({ name: 'Ollama Server', status: 'ok', message: `Reachable at ${baseUrl}` });
  } catch {
    results.push({ name: 'Ollama Server', status: 'error', message: 'Not running. Start it: ollama serve' });
    return results;
  }

  // Models available?
  try {
    const data = await (await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) })).json() as { models?: unknown[] };
    const count = data.models?.length ?? 0;
    if (count === 0) {
      results.push({ name: 'Ollama Models', status: 'warn', message: 'No models found. Pull one: ollama pull qwen2.5-coder:1.5b' });
    } else {
      results.push({ name: 'Ollama Models', status: 'ok', message: `${count} model${count !== 1 ? 's' : ''} available` });
    }
  } catch {
    results.push({ name: 'Ollama Models', status: 'warn', message: 'Could not list models' });
  }

  return results;
}

async function checkLocalOpenAIDetailed(config: HysaConfig, debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const baseUrl = config.localOpenAiBaseUrl || 'http://localhost:1234/v1';

  try {
    const res = await withTimeout(
      fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (!res.ok) {
      results.push({ name: 'LM Studio Server', status: 'error', message: `HTTP ${res.status} — is LM Studio / local server running?` });
      return results;
    }
    results.push({ name: 'LM Studio Server', status: 'ok', message: `Reachable at ${baseUrl}` });
  } catch {
    results.push({ name: 'LM Studio Server', status: 'error', message: 'Not running. Start LM Studio → Local Inference Server → Start' });
    return results;
  }

  // Models loaded?
  try {
    const data = await (await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) })).json() as { data?: { id: string }[] };
    const models = data.data?.map(m => m.id) || [];
    if (models.length === 0) {
      results.push({ name: 'LM Studio Models', status: 'warn', message: 'No models loaded. Load a model in LM Studio first.' });
    } else {
      results.push({ name: 'LM Studio Models', status: 'ok', message: `${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}` });
    }
  } catch {
    results.push({ name: 'LM Studio Models', status: 'warn', message: 'Could not list models' });
  }

  return results;
}

async function checkLlamaCppDetailed(config: HysaConfig, debug: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const baseUrl = 'http://localhost:8080/v1';

  try {
    const res = await withTimeout(
      fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) }),
      DOCTOR_TIMEOUT_MS,
    );
    if (!res.ok) {
      results.push({ name: 'llama.cpp Server', status: 'error', message: `HTTP ${res.status} — is llama.cpp running?` });
      return results;
    }
    results.push({ name: 'llama.cpp Server', status: 'ok', message: `Reachable at ${baseUrl}` });
  } catch {
    results.push({ name: 'llama.cpp Server', status: 'error', message: 'Not running. Start: ./server -m model.gguf --port 8080' });
    return results;
  }

  // Models available?
  try {
    const data = await (await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(DOCTOR_TIMEOUT_MS) })).json() as { data?: { id: string }[] };
    const models = data.data?.map(m => m.id) || [];
    if (models.length === 0) {
      results.push({ name: 'llama.cpp Models', status: 'warn', message: 'No models loaded. Specify a model with -m flag.' });
    } else {
      results.push({ name: 'llama.cpp Models', status: 'ok', message: `${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}` });
    }
  } catch {
    results.push({ name: 'llama.cpp Models', status: 'warn', message: 'Could not list models' });
  }

  return results;
}

export async function runDoctor(debug = false, provider?: string): Promise<void> {
  if (provider) {
    const config = loadConfig();
    if (!config) {
      console.log(pc.red('\nNo config found. Run: hysa chat\n'));
      return;
    }

    const label = (PROVIDER_DEFAULTS as Record<string, { model: string; label: string }>)[provider]?.label || provider;
    console.log(pc.bold(pc.magenta(`\n🔍 Detailed Diagnostics: ${label}\n`)));

    let results: DoctorResult[] = [];

    if (provider === 'openrouter') {
      if (!config.apiKeys.openrouter) {
        console.log(pc.red('  ✘ No OpenRouter API key configured.\n'));
        return;
      }
      results = await checkOpenRouterDetailed(config.apiKeys.openrouter, debug);
    } else if (provider === 'pollinations') {
      results = await checkPollinationsDetailed(debug);
    } else if (provider === 'llm7') {
      results = await checkLLM7Detailed(debug);
    } else if (provider === 'puter') {
      results = await checkPuterDetailed(debug);
    } else if (provider === 'deepseek') {
      if (!config.apiKeys.deepseek) {
        console.log(pc.red('  ✘ No DeepSeek API key configured.\n'));
        return;
      }
      results = await checkDeepSeekDetailed(config.apiKeys.deepseek, debug);
    } else if (provider === 'gemini') {
      if (!config.apiKeys.gemini) {
        console.log(pc.red('  ✘ No Gemini API key configured.\n'));
        return;
      }
      results = await checkGeminiDetailed(config.apiKeys.gemini, debug);
    } else if (provider === 'groq') {
      if (!config.apiKeys.groq) {
        console.log(pc.red('  ✘ No Groq API key configured.\n'));
        return;
      }
      results = await checkGroqDetailed(config.apiKeys.groq, debug);
    } else if (provider === 'ollama') {
      results = await checkOllamaDetailed(config, debug);
    } else if (provider === 'local_openai') {
      results = await checkLocalOpenAIDetailed(config, debug);
    } else if (provider === 'llama_cpp') {
      results = await checkLlamaCppDetailed(config, debug);
    } else if (provider === 'hysa_ai') {
      results = await checkHysaAIDetailed(debug);
    } else if (provider === 'anthropic_proxy') {
      results = await checkAnthropicProxyDetailed(config, debug);
    } else if (provider === 'openai_router') {
      results = await checkOpenAIRouterDetailed(config, debug);
    } else if (provider === 'anthropic' || provider === 'openai' || provider === 'opencode_zen') {
      console.log(pc.yellow(`  Diagnostics for "${provider}" not yet supported in detailed mode. Try:\n  hysa doctor\n  hysa doctor --provider hysa-ai\n`));
      return;
    } else {
      console.log(pc.yellow(`  Diagnostics for "${provider}" not yet supported. Try:\n  hysa doctor --provider openrouter\n  hysa doctor --provider hysa-ai\n`));
      return;
    }

    for (const r of results) {
      const icon = r.status === 'ok' ? pc.green('✔') : r.status === 'warn' ? pc.yellow('⚠') : pc.red('✘');
      console.log(`  ${icon} ${pc.bold(r.name.padEnd(32))} ${r.message}`);
    }

    const hasIssues = results.some(r => r.status === 'error');
    if (hasIssues) {
      console.log(pc.yellow('\n  Some tests failed. Check the errors above and verify your setup.\n'));
    } else {
      console.log(pc.green('\n  All checks passed!\n'));
    }
    return;
  }

  // Full general diagnostic
  console.log(pc.bold(pc.magenta('\n🔍 HYSA Code Diagnostic\n')));

  const config = loadConfig();
  const results: DoctorResult[] = [];

  results.push(await checkInternet());

  if (config) {
    results.push({ name: 'Config', status: 'ok', message: '~/.hysa/config.json found' });

    if (config.currentProvider === 'ollama' || config.ollamaBaseUrl) {
      results.push(await checkOllama(config.ollamaBaseUrl));
    }
    const localOpenAiUrl = config.localOpenAiBaseUrl || 'http://localhost:1234/v1';
    if (config.currentProvider === 'local_openai') {
      results.push(await checkLocalOpenAI(localOpenAiUrl));
    }
    const hysaAiUrl = config.hysaAiBaseUrl || 'http://localhost:3002/v1';
    if (config.currentProvider === 'hysa_ai') {
      results.push(await checkLocalOpenAI(hysaAiUrl));
    }

    for (const [prov, key] of Object.entries(config.apiKeys)) {
      const label = PROVIDER_DEFAULTS[prov as ProviderType]?.label || prov;
      const tier = PROVIDER_TIERS[prov as ProviderType];
      const tierLabel = tier ? TIER_LABELS[tier]?.label || '' : '';
      if (key) {
        const masked = key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '[set]';
        results.push({ name: `${label}`, status: 'ok', message: `${tierLabel} key: ${masked}` });
      } else {
        results.push({ name: `${label}`, status: 'error', message: `${tierLabel} key not set` });
      }
    }

    for (const prov of FREE_API_PROVIDERS) {
      if (prov === 'openrouter') continue;
      if (config.apiKeys[prov as keyof typeof config.apiKeys]) {
        results.push(await checkApiReachability(prov, debug));
      }
    }

    if (config.apiKeys.openrouter) {
      results.push(await checkOpenRouterAPI(config.apiKeys.openrouter, debug));
    }

    const current = config.currentProvider;
    const currentLabel = PROVIDER_DEFAULTS[current]?.label || current;
    const currentTier = PROVIDER_TIERS[current];
    const currentTierLabel = currentTier ? TIER_LABELS[currentTier]?.label || '' : '';
    const hasKey = current === 'ollama' || current === 'local_openai' || current === 'hysa_ai' || !!config.apiKeys[current as keyof typeof config.apiKeys];
    results.push({
      name: 'Current Provider',
      status: hasKey ? 'ok' : 'error',
      message: `${currentLabel} (${currentTierLabel})`,
    });

    if (config.apiKeys.opencode_zen) {
      results.push(await checkOpenCodeZen(config.apiKeys.opencode_zen));
    }

    if (config.allowExperimentalProviders) {
      for (const prov of EXPERIMENTAL_FREE_PROVIDERS) {
        if (config.currentProvider === prov) {
          if (prov === 'pollinations') results.push(await checkPollinations(debug));
          else if (prov === 'llm7') results.push(await checkLLM7(debug));
          else if (prov === 'puter') results.push(await checkPuter(debug));
        }
      }
    }

    if (config.apiKeys.gemini && config.currentProvider === 'gemini') {
      results.push({
        name: 'Gemini Quota',
        status: 'warn',
        message: 'Free tier: 60 requests/min. Daily limit applies.',
      });
    }

    // Anthropic proxy status
    if (config.anthropicProxyBaseUrl) {
      results.push({ name: 'Anthropic Proxy', status: 'ok', message: `Base URL: ${config.anthropicProxyBaseUrl}` });
      const proxyModel = config.anthropicProxyModel || 'claude-3-5-sonnet-latest (default)';
      results.push({ name: 'Proxy Model', status: 'ok', message: proxyModel });
      if (config.apiKeys.anthropic_proxy) {
        results.push({ name: 'Proxy Key', status: 'ok', message: 'Configured (optional)' });
      } else {
        results.push({ name: 'Proxy Key', status: 'warn', message: 'Not configured (optional)' });
      }
    } else {
      results.push({ name: 'Anthropic Proxy', status: 'warn', message: 'Not configured. Set HYSA_ANTHROPIC_PROXY_BASE_URL.' });
    }

    // OpenAI router status
    if (config.openaiRouterBaseUrl) {
      results.push({ name: 'OpenAI Router', status: 'ok', message: `Base URL: ${config.openaiRouterBaseUrl}` });
      const routerModel = config.openaiRouterModel || 'gpt-4o-mini (default)';
      results.push({ name: 'Router Model', status: 'ok', message: routerModel });
      if (config.apiKeys.openai_router) {
        results.push({ name: 'Router Key', status: 'ok', message: 'Configured (optional)' });
      } else {
        results.push({ name: 'Router Key', status: 'warn', message: 'Not configured (optional)' });
      }
    } else {
      results.push({ name: 'OpenAI Router', status: 'warn', message: 'Not configured. Set HYSA_OPENAI_ROUTER_BASE_URL.' });
    }
  } else {
    results.push({ name: 'Config', status: 'error', message: 'No config found. Run: hysa chat' });
  }

  console.log();
  for (const r of results) {
    const icon = r.status === 'ok' ? pc.green('✔') : r.status === 'warn' ? pc.yellow('⚠') : pc.red('✘');
    console.log(`  ${icon} ${pc.bold(r.name.padEnd(22))} ${r.message}`);
  }

  if (debug) {
      console.log(pc.dim(`\n  Debug info: Current provider: ${config?.currentProvider}, model: ${config?.currentModel}`));
    if (config?.apiKeys.openrouter) {
      console.log(pc.dim(`  OpenRouter key: [configured]`));
    }
  }

  const hasError = results.some(r => r.status === 'error');
  if (hasError) {
    console.log(pc.yellow('\n  Some issues found. Run "hysa config" to review your setup.\n'));
  } else {
    console.log(pc.green('\n  All checks passed! HYSA Code is ready to use.\n'));
  }
}
