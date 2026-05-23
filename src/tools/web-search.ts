export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface WebSearchConfig {
  provider: 'tavily' | 'serper' | 'brave' | 'ddg' | 'none';
  tavilyKey?: string;
  serperKey?: string;
  braveKey?: string;
}

export interface SearchDiagnostics {
  provider: string;
  configuredKeys: string[];
  hasTavilyKey: boolean;
  hasSerperKey: boolean;
  hasBraveKey: boolean;
  ddgAvailable: boolean;
  isReliable: boolean;
  ddgExperimental: boolean;
}

const DDG_TIMEOUT_MS = 8000;

function getConfig(): WebSearchConfig {
  const preferredProvider = (process.env.HYSA_WEB_SEARCH_PROVIDER || 'auto').toLowerCase();
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  const serperKey = process.env.SERPER_API_KEY?.trim();
  const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim();

  if (preferredProvider !== 'auto') {
    if (preferredProvider === 'tavily') {
      if (tavilyKey) return { provider: 'tavily', tavilyKey };
      return { provider: 'none' };
    }
    if (preferredProvider === 'serper') {
      if (serperKey) return { provider: 'serper', serperKey };
      return { provider: 'none' };
    }
    if (preferredProvider === 'brave') {
      if (braveKey) return { provider: 'brave', braveKey };
      return { provider: 'none' };
    }
    if (preferredProvider === 'ddg') return { provider: 'ddg' };
    return { provider: 'none' };
  }

  if (tavilyKey) return { provider: 'tavily', tavilyKey };
  if (serperKey) return { provider: 'serper', serperKey };
  if (braveKey) return { provider: 'brave', braveKey };
  return { provider: 'ddg' };
}

export function getSearchDiagnostics(): SearchDiagnostics {
  const config = getConfig();
  const configuredKeys: string[] = [];
  if (config.tavilyKey) configuredKeys.push('Tavily');
  if (config.serperKey) configuredKeys.push('Serper');
  if (config.braveKey) configuredKeys.push('Brave');
  return {
    provider: config.provider,
    configuredKeys,
    hasTavilyKey: !!config.tavilyKey,
    hasSerperKey: !!config.serperKey,
    hasBraveKey: !!config.braveKey,
    ddgAvailable: true,
    isReliable: config.provider !== 'ddg' && config.provider !== 'none',
    ddgExperimental: config.provider === 'ddg',
  };
}

export function isReliableProvider(): boolean {
  return getSearchDiagnostics().isReliable;
}

export function getWebSearchConfig(): WebSearchConfig {
  return getConfig();
}

function getTavilyBaseUrl(): string {
  return process.env.HYSA_WEB_SEARCH_TAVILY_BASE || 'https://api.tavily.com';
}

function getSerperBaseUrl(): string {
  return process.env.HYSA_WEB_SEARCH_SERPER_BASE || 'https://google.serper.dev';
}

function getBraveBaseUrl(): string {
  return process.env.HYSA_WEB_SEARCH_BRAVE_BASE || 'https://api.search.brave.com';
}

async function searchTavily(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch(`${getTavilyBaseUrl()}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: 'basic' }),
  });
  if (!res.ok) throw new Error(`Tavily API error (${res.status})`);
  const data = await res.json() as { results?: Array<{ title: string; url: string; content: string }> };
  return (data.results || []).slice(0, maxResults).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
    source: 'Tavily',
  }));
}

async function searchSerper(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch(`${getSerperBaseUrl()}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: maxResults }),
  });
  if (!res.ok) throw new Error(`Serper API error (${res.status})`);
  const data = await res.json() as { organic?: Array<{ title: string; link: string; snippet: string }> };
  return (data.organic || []).slice(0, maxResults).map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    source: 'Serper',
  }));
}

async function searchBrave(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(maxResults) });
  const res = await fetch(`${getBraveBaseUrl()}/res/v1/web/search?${params}`, {
    headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey },
  });
  if (!res.ok) throw new Error(`Brave Search API error (${res.status})`);
  const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
  return (data.web?.results || []).slice(0, maxResults).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    source: 'Brave',
  }));
}

// DuckDuckGo Instant Answer API — experimental fallback only.
// This is NOT a full web search API. It only returns results when
// a direct Wikipedia-style "instant answer" match exists. For most
// general web queries it returns zero results.
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DDG_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });
    const res = await fetch(`https://api.duckduckgo.com/?${params}`, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`DuckDuckGo API error (${res.status})`);
    const data = await res.json() as { AbstractText?: string; AbstractURL?: string; Results?: Array<{ Text: string; FirstURL: string }> };
    const results: SearchResult[] = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({ title: 'Abstract', url: data.AbstractURL, snippet: data.AbstractText, source: 'DuckDuckGo' });
    }
    if (data.Results) {
      for (const r of data.Results) {
        if (results.length >= maxResults) break;
        results.push({ title: r.Text.split(' - ')[0] || r.Text, url: r.FirstURL, snippet: r.Text, source: 'DuckDuckGo' });
      }
    }
    return results;
  } catch (err: unknown) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') {
      throw new Error('DuckDuckGo API timed out (8s). The fallback may be rate-limited or blocked.');
    }
    throw err;
  }
}

export async function searchWeb(query: string, options?: { maxResults?: number }): Promise<SearchResult[]> {
  const maxResults = options?.maxResults || 5;
  const config = getConfig();

  if (config.provider === 'none') {
    throw new Error('Web search is not configured. Set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.');
  }

  switch (config.provider) {
    case 'tavily':
      if (!config.tavilyKey) throw new Error('Tavily key not configured.');
      return searchTavily(query, maxResults, config.tavilyKey);
    case 'serper':
      if (!config.serperKey) throw new Error('Serper key not configured.');
      return searchSerper(query, maxResults, config.serperKey);
    case 'brave':
      if (!config.braveKey) throw new Error('Brave key not configured.');
      return searchBrave(query, maxResults, config.braveKey);
    case 'ddg':
      return searchDuckDuckGo(query, maxResults);
    default:
      throw new Error('No web search provider configured.');
  }
}

export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `No search results found for: ${query}`;
  let output = `Web search results for: ${query}\n\n`;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    output += `${i + 1}. ${r.title}\n`;
    output += `URL: ${r.url}\n`;
    output += `Snippet: ${r.snippet}\n`;
    if (r.source) output += `Source: ${r.source}`;
    output += '\n\n';
  }
  output += 'Instructions:\n';
  output += '- Use these results to answer.\n';
  output += '- Cite URLs naturally.\n';
  output += '- If results are insufficient, say so.\n';
  output += '- Match the user\'s language.\n';
  return output.trim();
}
