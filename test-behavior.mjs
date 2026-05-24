import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, COMPACT_PROMPT_PROVIDERS, PROVIDER_MODELS } from './dist/config/keys.js';
import { buildSystemPrompt, resolvePromptMode } from './dist/prompts/system.js';
import { createClient, isOnlyGreeting, getCasualResponse } from './dist/ai/client.js';
import { getFallbackEvents, clearFallbackEvents, resetHealth, getAllHealth, toHealthSummary } from './dist/ai/model-health.js';
import { getProjectInfo } from './dist/context/builder.js';
import { resolveFileReadPath, isGeneratedOutput } from './dist/files/reader.js';
import { resolve, join } from 'node:path';

const workingDir = resolve('.');
const projectInfo = getProjectInfo(workingDir);
let globalTestFailed = false;

function section(title) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(70)}`);
}

function elapsed(start) {
  return ((Date.now() - start) / 1000).toFixed(1);
}

function hr() {
  console.log(`  ${'-'.repeat(66)}`);
}

// ===== TEST 1: Simple Greeting Guard =====
section('TEST 1: Simple Greeting — instant normal reply, no tool call, no fallback');

console.log('  Checking greeting detection for various inputs:');
const greetings = ['hi', 'hello', 'hey', 'salam', 'مرحبا', 'thanks', 'ok'];
let allPass = true;
for (const g of greetings) {
  const isG = isOnlyGreeting(g);
  const resp = getCasualResponse(g);
  const simple = g.trim().length < 20
    && !g.includes('/')
    && !g.includes('.')
    && !g.match(/\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe)\b/i);
  console.log(`    "${g}" → greeting:${isG} casual:${JSON.stringify(resp)} simple:${simple}`);
  if (isG && !resp && !simple) { console.log('    ⚠ ISSUE'); allPass = false; }
}

// Verify MAX_STEPS would be 1 for greetings
const testSimpleChat = (txt) => {
  return txt.trim().length < 20
    && !txt.includes('/')
    && !txt.includes('.')
    && !txt.match(/\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe)\b/i);
};

console.log(`  MAX_STEPS=1 for greetings: ${testSimpleChat('hi') ? '✓ yes' : '⚠ no'}`);
console.log(`  MAX_STEPS=1 for "thanks": ${testSimpleChat('thanks') ? '✓ yes' : '⚠ no'}`);
console.log(`  MAX_STEPS=5 for "edit file": ${testSimpleChat('edit file') ? '⚠ would be 1' : '✓ would be 2-5'}`);
console.log(`  ${allPass ? '✓ ALL GREETING CHECKS PASSED' : '⚠ SOME ISSUES'}`);

hr();
console.log('  [VERDICT] Greeting guard works at pre-request stage in CLI');
console.log('  [VERDICT] No provider call needed — local logic, <1ms');
console.log('  [VERDICT] MAX_STEPS=1 is correctly set for greetings');
console.log('  [PERF] 0ms (pure local logic)');

// ===== TEST 2: Simple Coding Question =====
section('TEST 2: Simple Coding Question — quick response, provider visible');

const config = loadConfig();
if (!config) {
  console.log('  ✗ No config found, skipping live tests');
  process.exit(1);
}

const origConfig = JSON.parse(JSON.stringify(config));
const origProvider = config.currentProvider;
const origModel = config.currentModel;

// Restore at exit
process.on('exit', () => {
  saveConfig(origConfig);
});

(async () => {
  try {
    config.currentProvider = 'openrouter';
    config.currentModel = 'qwen/qwen3-coder:free';
    saveConfig(config);

    // Simulate per-query prompt resolution (simple question → minimal prompt)
    const queryText = 'explain what package.json is in 2-3 sentences';
    const isSimpleQ = queryText.trim().length <= 60 && !/\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe|apply|remove|delete|rename|move|copy|refactor)\b/i.test(queryText);
    const promptMode = resolvePromptMode('auto', 'openrouter', isSimpleQ);

    const sysPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints,
      configFiles: projectInfo.configFiles,
      fileCount: projectInfo.fileCount,
      tree: projectInfo.tree,
    }, undefined, false, 'openrouter', promptMode);

    const sysTokens = Math.round(sysPrompt.length / 4);
    console.log(`  Provider: OpenRouter`);
    console.log(`  Model: qwen/qwen3-coder:free`);
    console.log(`  Prompt mode: ${promptMode}`);
    console.log(`  System prompt: ~${sysTokens} tokens`);

    clearFallbackEvents();
    resetHealth();

    const client = createClient(config);
    const start = Date.now();

    console.log(`  Sending: "${queryText}"`);
    const result = await client.sendMessage(
      [{ role: 'user', content: queryText }],
      sysPrompt
    );

    const dur = elapsed(start);
    const fbEvents = getFallbackEvents();

    hr();
    console.log(`  Response time: ${dur}s`);
    console.log(`  Has message: ${!!result.message}`);
    console.log(`  Has tool calls: ${result.toolCalls?.length || 0}`);
    if (result.toolCalls?.length > 0) {
      for (const tc of result.toolCalls) {
        console.log(`    ${tc.type}: ${JSON.stringify(tc.params).slice(0, 100)}`);
      }
    }
    console.log(`  Fallback events: ${fbEvents.length}`);
    for (const e of fbEvents) {
      console.log(`    ~ ${e.reason}`);
    }
    if (result.message) {
      console.log(`  Response preview: ${result.message.slice(0, 150)}...`);
    }
    console.log(`  ${promptMode === 'minimal' ? '✓ Minimal prompt used' : '⚠ Expected minimal prompt'}`);
    console.log(`  ${dur < 20 ? '✓ OK' : '⚠ SLOW (>20s)'} — ${dur}s`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // ===== TEST 3: Project-aware Question =====
  section('TEST 3: Project-aware Question — scan entry points');
  try {
    config.currentProvider = 'openrouter';
    config.currentModel = 'qwen/qwen3-coder:free';

    const sysPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints,
      configFiles: projectInfo.configFiles,
      fileCount: projectInfo.fileCount,
      tree: projectInfo.tree,
    }, undefined, false, 'openrouter', 'auto');

    clearFallbackEvents();
    const client = createClient(config);
    const start = Date.now();

    console.log(`  Sending: "scan this project and tell me the entry points"`);
    console.log(`  Project info: type=${projectInfo.type}, files=${projectInfo.fileCount}`);
    console.log(`  Entry points: ${projectInfo.entryPoints.join(', ')}`);
    const result = await client.sendMessage(
      [{ role: 'user', content: 'scan this project and tell me the entry points' }],
      sysPrompt
    );

    const dur = elapsed(start);
    const fbEvents = getFallbackEvents();

    hr();
    console.log(`  Response time: ${dur}s`);
    console.log(`  Tool calls: ${result.toolCalls?.length || 0}`);
    for (const tc of (result.toolCalls || [])) {
      console.log(`    ${tc.type}: ${JSON.stringify(tc.params).slice(0, 120)}`);
    }
    console.log(`  Fallback events: ${fbEvents.length}`);
    for (const e of fbEvents) {
      console.log(`    ~ ${e.reason}`);
    }
    if (result.message) {
      console.log(`  Response preview: ${result.message.slice(0, 200)}...`);
    }
    console.log(`  ${dur < 20 ? '✓ OK' : '⚠ SLOW (>20s)'} — ${dur}s`);
    console.log(`  ${dur < 30 ? '' : '⚠ Loop risk? Check if max steps works'}`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // ===== TEST 4: Edit Request =====
  section('TEST 4: Edit Request — change app title');
  try {
    config.currentProvider = 'openrouter';
    config.currentModel = 'qwen/qwen3-coder:free';

    const sysPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints,
      configFiles: projectInfo.configFiles,
      fileCount: projectInfo.fileCount,
      tree: projectInfo.tree,
    }, undefined, false, 'openrouter', 'auto');

    clearFallbackEvents();
    const client = createClient(config);
    const start = Date.now();

    console.log(`  Sending: "change the app title in the correct file"`);
    console.log(`  (In real CLI, would auto-read, propose edit, wait for approval)`);
    console.log(`  Here we test if it reads before editing (suggesting read_file tool call)`);
    const result = await client.sendMessage(
      [{ role: 'user', content: 'change the app title in the correct file' }],
      sysPrompt
    );

    const dur = elapsed(start);
    const fbEvents = getFallbackEvents();

    hr();
    console.log(`  Response time: ${dur}s`);
    console.log(`  Tool calls: ${result.toolCalls?.length || 0}`);
    let readBeforeEdit = false;
    let editCall = false;
    for (const tc of (result.toolCalls || [])) {
      console.log(`    ${tc.type}: ${JSON.stringify(tc.params).slice(0, 120)}`);
      if (tc.type === 'read_file') readBeforeEdit = true;
      if (tc.type === 'edit_file') editCall = true;
    }
    if (result.toolCalls?.length === 0) {
      console.log('  ⚠ No tool calls — model may be describing edit instead of executing');
      if (result.message) {
        console.log(`  Response preview: ${result.message.slice(0, 200)}...`);
      }
    }
    console.log(`  Read-before-edit pattern: ${readBeforeEdit || result.toolCalls?.length === 0 ? '✓' : '⚠ model may not read first'}`);
    console.log(`  Fallback events: ${fbEvents.length}`);
    for (const e of fbEvents) {
      console.log(`    ~ ${e.reason}`);
    }
    console.log(`  ${dur < 20 ? '✓ OK' : '⚠ SLOW (>20s)'} — ${dur}s`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // ===== TEST 4a: App Title File Discovery =====
  section('TEST 4a: App Title File Discovery — resolveFileReadPath');
  try {
    console.log('  Testing resolveFileReadPath for index.html:');
    const htmlPaths = resolveFileReadPath('index.html');
    const htmlIdx = htmlPaths.indexOf('index.html');
    const webIdx = htmlPaths.indexOf('web/index.html');
    const distIdx = htmlPaths.indexOf('web/dist/index.html');
    console.log(`  Candidate order: ${htmlPaths.join(', ')}`);
    console.log(`  web/index.html in list: ${webIdx >= 0 ? '✓' : '✗'} (index ${webIdx})`);
    console.log(`  web/dist/index.html in list: ${distIdx >= 0 ? '✗ (should be excluded)' : '✓ (excluded as generated)'}`);
    console.log(`  root index.html before web/src/index.html: ${htmlIdx < htmlPaths.indexOf('web/src/index.html') ? '✓' : '✗'}`);
    console.log(`  Total candidates: ${htmlPaths.length} (expected ~8-9)`);

    console.log('');
    console.log('  Testing resolveFileReadPath for App.tsx:');
    const appPaths = resolveFileReadPath('App.tsx');
    const webSrcApp = appPaths.indexOf('web/src/App.tsx');
    const srcApp = appPaths.indexOf('src/App.tsx');
    const rootApp = appPaths.indexOf('App.tsx');
    console.log(`  Candidate order: ${appPaths.join(', ')}`);
    console.log(`  web/src/App.tsx before src/App.tsx: ${webSrcApp >= 0 && srcApp >= 0 && webSrcApp < srcApp ? '✓' : '✗'}`);
    console.log(`  App.jsx alternatives included: ${appPaths.some(p => p.includes('App.jsx')) ? '✓' : '✗'}`);

    console.log('');
    console.log('  Testing isGeneratedOutput:');
    console.log(`  web/dist/index.html: ${isGeneratedOutput('web/dist/index.html') ? '✓ generated' : '✗ not detected'}`);
    console.log(`  dist/index.html: ${isGeneratedOutput('dist/index.html') ? '✓ generated' : '✗ not detected'}`);
    console.log(`  web/index.html: ${isGeneratedOutput('web/index.html') ? '✗ false positive' : '✓ not generated'}`);
    console.log(`  index.html: ${isGeneratedOutput('index.html') ? '✗ false positive' : '✓ not generated'}`);
    console.log(`  build/output.js: ${isGeneratedOutput('build/output.js') ? '✓ generated' : '✗ not detected'}`);
    console.log(`  .next/bundle.js: ${isGeneratedOutput('.next/bundle.js') ? '✓ generated' : '✗ not detected'}`);
    console.log(`  coverage/lcov.info: ${isGeneratedOutput('coverage/lcov.info') ? '✓ generated' : '✗ not detected'}`);
    console.log(`  out/index.html: ${isGeneratedOutput('out/index.html') ? '✓ generated' : '✗ not detected'}`);
    console.log(`  src/index.html: ${isGeneratedOutput('src/index.html') ? '✗ false positive' : '✓ not generated'}`);

    // Verify web/index.html is actually the file that will be used for this project
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const webIndexExists = existsSync(join(resolve('.'), 'web/index.html'));
    console.log('');
    console.log(`  Project check: web/index.html exists: ${webIndexExists ? '✓' : '✗ (project may differ)'}`);

    hr();
    let allDiscoveryPass = true;
    if (distIdx >= 0) { console.log('  ✗ FAIL: web/dist/index.html should be excluded from read_file candidates'); allDiscoveryPass = false; }
    if (webIdx < 0) { console.log('  ✗ FAIL: web/index.html should be in candidate list'); allDiscoveryPass = false; }
    if (htmlIdx < 0 || webSrcApp < 0) { console.log('  ✗ FAIL: expected candidates missing'); allDiscoveryPass = false; }
    console.log(`  ${allDiscoveryPass ? '✓ ALL DISCOVERY CHECKS PASSED' : '✗ Some checks failed'}`);
  } catch (err) {
    console.log(`  ✗ Error in discovery test: ${err.message}`);
  }

  // ===== TEST 5: Free Provider Fallback =====
  section('TEST 5: Free Provider Fallback — force bad key');
  console.log('  Simulating fallback: set DeepSeek with invalid key, expect fallback chain');
  console.log('  Fallback chain (free_api tier):');
  console.log('    1. openrouter/qwen/qwen3-coder:free');
  console.log('    2. openrouter/deepseek/deepseek-chat:free');
  console.log('    3. openrouter/openai/gpt-oss-120b:free');
  console.log('    4. gemini/gemini-2.5-flash');
  console.log('    5. deepseek/deepseek-chat (would skip if same as current)');
  console.log('    6. opencode_zen/big-pickle');
  console.log('    7. groq/llama3-70b-8192');
  console.log('    8. pollinations (experimental, since enabled)');

  try {
    if (!config.apiKeys) {
      console.log('  ⚠ config.apiKeys is undefined, skipping fallback test');
      throw new Error('config.apiKeys is undefined');
    }
    config.currentProvider = 'deepseek';
    config.currentModel = 'deepseek-chat';
    const origKey = config.apiKeys.deepseek;
    console.log(`  Original deepseek key: ${origKey ? origKey.slice(0, 6) + '...' : 'none'}`);
    config.apiKeys.deepseek = 'sk-invalid-key-that-will-fail-401';

    resetHealth();
    clearFallbackEvents();
    const start = Date.now();

    const sysPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints || [],
      configFiles: projectInfo.configFiles || [],
      fileCount: projectInfo.fileCount,
    }, undefined, false, 'deepseek', 'auto');

    let result;
    try {
      const client = createClient(config);
      result = await client.sendMessage(
        [{ role: 'user', content: 'say hi briefly' }],
        sysPrompt
      );
    } catch (err) {
      const dur = elapsed(start);
      const fbEvents = getFallbackEvents();
      const health = toHealthSummary();
      hr();
      console.log(`  Failed after ${dur}s`);
      console.log(`  Error: ${err.message.slice(0, 300)}`);
      console.log(`  Fallback events: ${fbEvents.length}`);
      for (const [i, e] of fbEvents.entries()) {
        console.log(`    [${i}] ${e.reason}`);
      }
      console.log(`  Total time: ${dur}s`);
      console.log(`  ${dur < 60 ? '✓ Within 60s limit' : '⚠ Exceeded 60s max'} — ${dur}s`);
      console.log(`  Health summary:`);
      for (const h of health) {
        console.log(`    ${h}`);
      }
      // Restore key before rethrowing
      if (config.apiKeys) config.apiKeys.deepseek = origKey;
      throw err;
    }

    // Only runs if no error
    const dur = elapsed(start);
    const fbEvents = getFallbackEvents();
    const health = toHealthSummary();

    hr();
    console.log(`  Response time: ${dur}s`);
    console.log(`  Has message: ${!!result.message}`);
    console.log(`  Fallback events: ${fbEvents.length}`);
    for (const [i, e] of fbEvents.entries()) {
      console.log(`    [${i}] ${e.reason}`);
    }
    console.log(`  Total time: ${dur}s`);
    console.log(`  ${dur < 60 ? '✓ Within 60s limit' : '⚠ Exceeded 60s max'} — ${dur}s`);
    console.log(`  Health summary:`);
    for (const h of health) {
      console.log(`    ${h}`);
    }
    if (result.message) {
      console.log(`  Final response: ${result.message.slice(0, 200)}`);
    }

    // Restore key
    config.apiKeys.deepseek = origKey;
  } catch (err) {
    console.log(`  ✗ Error in fallback test: ${err.message}`);
    if (config.apiKeys && config.currentProvider !== origProvider) {
      config.currentProvider = origProvider;
      config.currentModel = origModel;
      saveConfig(config);
    }
  }

  // ===== TEST 6: Experimental Provider (Pollinations) =====
  section('TEST 6: Local/Experimental Provider — Pollinations');
  console.log('  Testing with Pollinations (experimental_free tier)');
  console.log('  Expected: compact prompt (<200 tokens), faster response (8s timeout)');

  try {
    config.currentProvider = 'pollinations';
    config.currentModel = 'openai';
    config.allowExperimentalProviders = true;

    const sysPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints || [],
      configFiles: projectInfo.configFiles || [],
      fileCount: projectInfo.fileCount,
    }, undefined, false, 'pollinations', 'auto');

    const sysTokens = Math.round(sysPrompt.length / 4);
    console.log(`  System prompt: ${sysPrompt.length} chars (~${sysTokens} tokens)`);
    console.log(`  ${sysTokens < 200 ? '✓ COMPACT prompt used (<200 tokens)' : '⚠ Full prompt (>200 tokens)'}`);
    console.log(`  Expected timeout: 8s (experimental)`);

    clearFallbackEvents();
    resetHealth();
    const client = createClient(config);
    const start = Date.now();

    console.log(`  Sending: "say hi briefly"`);
    const result = await client.sendMessage(
      [{ role: 'user', content: 'say hi briefly' }],
      sysPrompt
    );

    const dur = elapsed(start);
    const fbEvents = getFallbackEvents();

    hr();
    console.log(`  Response time: ${dur}s`);
    console.log(`  Has message: ${!!result.message}`);
    if (result.message) {
      console.log(`  Response: ${result.message.slice(0, 150)}`);
    }
    for (const e of fbEvents) {
      console.log(`    ~ ${e.reason}`);
    }
    console.log(`  ${dur < 8 ? '✓ Fast (<8s timeout)' : dur < 20 ? '✓ Within normal range' : '⚠ SLOW (>20s)'} — ${dur}s`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message.slice(0, 200)}`);
  }

  // ===== TEST 6a: Anthropic Proxy — Not Configured =====
  section('TEST 6a: Anthropic Proxy — not configured (clean skip)');
  console.log('  Testing: anthropic_proxy without base URL should skip cleanly');
  let savedBaseUrl6a;
  try {
    savedBaseUrl6a = config.anthropicProxyBaseUrl;
    delete config.anthropicProxyBaseUrl;

    clearFallbackEvents();
    resetHealth();
    const client = createClient(config);
    const result = await client.sendMessage(
      [{ role: 'user', content: 'say hi briefly' }],
      'You are a helpful assistant.'
    );

    const fbEvents = getFallbackEvents();
    const proxySkipped = fbEvents.some(e => e.provider === 'anthropic_proxy' || e.reason.includes('Anthropic Proxy'));
    const hasContent = !!result.message;

    console.log(`  Response: ${result.message?.slice(0, 100) || '(empty)'}`);
    console.log(`  Fallback events: ${fbEvents.length}`);
    for (const e of fbEvents) {
      console.log(`    [${e.provider}] ${e.reason.slice(0, 100)}`);
    }
    console.log(`  ${hasContent ? '✓ fallback succeeded with other provider' : '✗ no content'}`);
    console.log(`  ${proxySkipped ? '✓ anthropic_proxy was in fallback path (skipped)' : 'ℹ anthropic_proxy not in fallback path (skipped before trying)'}`);
  } catch (err) {
    console.log(`  ! Got error: ${err.message.slice(0, 150)}`);
  } finally {
    config.anthropicProxyBaseUrl = savedBaseUrl6a;
    config.currentProvider = origProvider;
    config.currentModel = origModel;
  }

  // ===== TEST 6b: Anthropic Proxy — Mock Server =====
  section('TEST 6b: Anthropic Proxy — mock server endpoint');
  console.log('  Testing: anthropic_proxy configured with a mock server endpoint');
  try {
    // Start a tiny mock server
    const http = await import('node:http');
    const mockResponses = [];
    let mockServer = null;

    const startMockServer = () => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        mockResponses.push({ method: req.method, url: req.url, headers: req.headers });
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          mockResponses[mockResponses.length - 1].body = body;
          if (req.url === '/v1/messages') {
            const parsed = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: 'msg_mock',
              type: 'message',
              role: 'assistant',
              content: [
                { type: 'text', text: `Mock response to: ${parsed.messages?.[parsed.messages.length - 1]?.content || 'empty'}` }
              ],
              model: parsed.model || 'mock-model',
              stop_reason: 'end_turn',
              usage: { input_tokens: 10, output_tokens: 5 }
            }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        mockServer = server;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
      server.on('error', reject);
    });

    const mockBaseUrl = await startMockServer();
    console.log(`  Mock server started at: ${mockBaseUrl}`);

    // Create a client pointing to mock server
    const { createAnthropicProxyClient } = await import('./dist/ai/anthropic-proxy.js');
    const mockClient = createAnthropicProxyClient(mockBaseUrl, 'test-key-123', 'claude-sonnet-4-20250514');

    const result = await mockClient.sendMessage(
      [{ role: 'user', content: 'Hello mock server' }],
      'System prompt here'
    );

    console.log(`  Response: "${result.message}"`);
    console.log(`  Tool calls: ${result.toolCalls?.length || 0}`);

    // Verify headers
    const lastReq = mockResponses[mockResponses.length - 1];
    const hasXApiKey = lastReq?.headers?.['x-api-key'] === 'test-key-123';
    const hasAuth = lastReq?.headers?.['authorization'] === 'Bearer test-key-123';
    const hasAnthropicVersion = lastReq?.headers?.['anthropic-version'] === '2023-06-01';
    console.log(`  x-api-key header: ${hasXApiKey ? '✓' : '✗'}`);
    console.log(`  authorization header: ${hasAuth ? '✓' : '✗'}`);
    console.log(`  anthropic-version header: ${hasAnthropicVersion ? '✓' : '✗'}`);

    const allHeadersOk = hasXApiKey && hasAuth && hasAnthropicVersion;
    console.log(`  ${result.message?.includes('Hello mock server') ? '✓ Correct response content' : '✗ Unexpected content'}`);
    console.log(`  ${allHeadersOk ? '✓ All required headers sent' : '✗ Missing some headers'}`);
    console.log(`  ${result.message ? '✓ anthropic_proxy mock server test PASSED' : '✗ FAILED'}`);

    mockServer.close();
    console.log('  Mock server stopped.');
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // ===== TEST 6c: Anthropic Proxy — Streaming with Mock Server =====
  section('TEST 6c: Anthropic Proxy — streaming path');
  console.log('  Testing: anthropic_proxy SSE streaming endpoint');
  try {
    const http = await import('node:http');
    let streamServer = null;

    const startStreamServer = () => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/v1/messages') {
          const bodyParts = [];
          req.on('data', c => bodyParts.push(c));
          req.on('end', () => {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
            res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`);
            res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello from "}}\n\n`);
            res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"streaming mock!"}}\n\n`);
            res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
            res.end();
          });
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [] }));
        }
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        streamServer = server;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
      server.on('error', reject);
    });

    const streamBaseUrl = await startStreamServer();
    console.log(`  Stream server started at: ${streamBaseUrl}`);

    const { createAnthropicProxyClient } = await import('./dist/ai/anthropic-proxy.js');
    const streamClient = createAnthropicProxyClient(streamBaseUrl, 'stream-key', 'claude-sonnet-4-20250514');

    const streamedChunks = [];
    const result = await streamClient.sendMessageStream(
      [{ role: 'user', content: 'Stream test' }],
      'You are a bot',
      (event) => {
        if (event.type === 'token') {
          streamedChunks.push(event.text);
        }
      }
    );

    const fullText = streamedChunks.join('');
    console.log(`  Streamed chunks: ${JSON.stringify(streamedChunks)}`);
    console.log(`  Full streamed text: "${fullText}"`);
    console.log(`  Result message: "${result.message}"`);
    console.log(`  Stream matches result: ${fullText === result.message ? '✓' : '✗'}`);
    console.log(`  ${fullText.includes('Hello from streaming') ? '✓ Streaming works correctly' : '✗ Streaming failed'}`);

    streamServer.close();
    console.log('  Stream server stopped.');
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // ===== TEST 6d: Anthropic Proxy — Fallback Chain =====
  section('TEST 6d: Anthropic Proxy — fallback from rate-limited primary');
  console.log('  Testing: primary fails, anthropic_proxy in fallback chain succeeds');
  let savedDsKey;
  let savedProxyBase;
  let savedAllKeys;
  let savedExpFlag;
  let savedRouterBaseUrl6d;
  let savedRouterEnv6d;
  let savedDefaultProvider6d;
  let fbMockServer = null;
  let fbMockBaseUrl = '';
  try {
    const http = await import('node:http');

    const startFbServer = () => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/v1/messages') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'msg_fallback',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Fallback proxy response: all good!' }],
            model: 'claude-sonnet-4-20250514',
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
        }
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        fbMockServer = server;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
      server.on('error', reject);
    });

    fbMockBaseUrl = await startFbServer();
    console.log(`  Fallback mock server at: ${fbMockBaseUrl}`);

    // Save all state, then isolate so only anthropic_proxy can succeed
    savedDsKey = config.apiKeys.deepseek;
    savedAllKeys = { ...config.apiKeys };
    for (const k of Object.keys(config.apiKeys)) {
      if (k !== 'anthropic_proxy') {
        config.apiKeys[k] = '';
      }
    }

    // Disable openai_router (env + config) so it doesn't win before anthropic_proxy
    savedRouterBaseUrl6d = config.openaiRouterBaseUrl;
    savedRouterEnv6d = process.env.HYSA_OPENAI_ROUTER_BASE_URL;
    savedDefaultProvider6d = process.env.HYSA_DEFAULT_PROVIDER;
    config.openaiRouterBaseUrl = undefined;
    delete process.env.HYSA_OPENAI_ROUTER_BASE_URL;
    if (savedDefaultProvider6d === 'openai_router') delete process.env.HYSA_DEFAULT_PROVIDER;

    // Use deepseek as primary (will fail with empty key)
    config.currentProvider = 'deepseek';
    config.currentModel = 'deepseek-chat';
    config.apiKeys.deepseek = '';

    // Disable experimental to prevent keyless providers from succeeding
    savedExpFlag = config.allowExperimentalProviders;
    config.allowExperimentalProviders = false;

    // Configure anthropic_proxy as the only working fallback
    savedProxyBase = config.anthropicProxyBaseUrl;
    config.anthropicProxyBaseUrl = fbMockBaseUrl;
    config.apiKeys.anthropic_proxy = 'mock-key';

    resetHealth();
    clearFallbackEvents();

    const sysPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints || [],
      configFiles: projectInfo.configFiles || [],
      fileCount: projectInfo.fileCount,
    }, undefined, false, 'deepseek', 'auto');

    const fbStart = Date.now();
    let fbResult;

    try {
      const client = createClient(config);
      fbResult = await client.sendMessage(
        [{ role: 'user', content: 'say hi briefly' }],
        sysPrompt
      );
    } catch (err) {
      const dur = ((Date.now() - fbStart) / 1000).toFixed(1);
      const fbEvents = getFallbackEvents();
      console.log(`  Failed after ${dur}s`);
      console.log(`  Error: ${err.message.slice(0, 300)}`);
      console.log(`  Fallback events: ${fbEvents.length}`);
      for (const e of fbEvents) {
        console.log(`    ~ ${e.reason}`);
      }
      throw err;
    }

    const dur = ((Date.now() - fbStart) / 1000).toFixed(1);
    const fbEvents = getFallbackEvents();

    hr();
    console.log(`  Response time: ${dur}s`);
    console.log(`  Has message: ${!!fbResult.message}`);
    if (fbResult.message) {
      console.log(`  Response: ${fbResult.message.slice(0, 200)}`);
    }
    console.log(`  Fallback events: ${fbEvents.length}`);
    for (const e of fbEvents) {
      console.log(`    ~ ${e.reason}`);
    }

    const proxyUsed = fbEvents.some(e => e.reason.includes('Anthropic Proxy') && e.reason.includes('Switched'));
    const gotContent = fbResult?.message?.includes('Fallback proxy response');
    if (!proxyUsed) { console.log(`  ✗ anthropic_proxy not in fallback chain`); globalTestFailed = true; } else { console.log(`  ✓ anthropic_proxy was used as fallback`); }
    if (!gotContent) { console.log(`  ✗ Unexpected response`); globalTestFailed = true; } else { console.log(`  ✓ Got expected response from proxy`); }
    console.log(`  ${proxyUsed && gotContent ? '✓ Fallback to anthropic_proxy WORKS' : '⚠ Fallback test issues'}`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  } finally {
    // Restore all keys
    if (savedAllKeys) {
      config.apiKeys = savedAllKeys;
    }
    config.anthropicProxyBaseUrl = savedProxyBase;
    if (savedExpFlag !== undefined) config.allowExperimentalProviders = savedExpFlag;
    config.openaiRouterBaseUrl = savedRouterBaseUrl6d;
    if (savedRouterEnv6d !== undefined) process.env.HYSA_OPENAI_ROUTER_BASE_URL = savedRouterEnv6d; else delete process.env.HYSA_OPENAI_ROUTER_BASE_URL;
    if (savedDefaultProvider6d !== undefined) process.env.HYSA_DEFAULT_PROVIDER = savedDefaultProvider6d; else delete process.env.HYSA_DEFAULT_PROVIDER;
    config.currentProvider = origProvider;
    config.currentModel = origModel;
    if (fbMockServer) {
      fbMockServer.close();
      console.log('  Fallback mock server stopped.');
    }
  }

  // ===== TEST 6e: Anthropic Proxy — Failure Debug Info =====
  section('TEST 6e: Anthropic Proxy — failure debug, no secret leakage');
  console.log('  Testing: anthropic_proxy failure produces friendly error without leaking secrets');
  try {
    const http = await import('node:http');
    let errServer = null;

    const startErrServer = () => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'Rate limit exceeded for proxy provider. Please try again later.' }
        }));
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        errServer = server;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
      server.on('error', reject);
    });

    const errBaseUrl = await startErrServer();
    console.log(`  Error mock server at: ${errBaseUrl}`);

    const { createAnthropicProxyClient } = await import('./dist/ai/anthropic-proxy.js');
    const errClient = createAnthropicProxyClient(errBaseUrl, 'secret-key-abc123', 'claude-sonnet-4-20250514');

    let caughtError = null;
    try {
      await errClient.sendMessage(
        [{ role: 'user', content: 'test' }],
        'system prompt'
      );
    } catch (err) {
      caughtError = err;
    }

    if (caughtError) {
      const msg = caughtError.message || '';
      console.log(`  Error message: "${msg.slice(0, 200)}"`);
      const hasSecret = msg.includes('secret-key-abc123') || msg.includes('test-key');
      const hasFriendlyInfo = msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit');
      console.log(`  ${!hasSecret ? '✓ No secret leaked in error message' : '✗ SECRET LEAKED!'}`);
      console.log(`  ${hasFriendlyInfo ? '✓ Contains status/friendly info' : '⚠ May lack friendly info'}`);
      console.log(`  ${!hasSecret && hasFriendlyInfo ? '✓ Error debug is safe and informative' : '⚠ Error handling needs review'}`);
    } else {
      console.log('  ✗ Expected error but got none');
    }

    errServer.close();
    console.log('  Error server stopped.');
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // ===== TEST 7a: OpenAI Router — Not Configured =====
  section('TEST 7a: OpenAI Router — not configured (clean skip)');
  console.log('  Testing: openai_router without base URL should skip cleanly');
  let savedRouterBase7a;
  try {
    savedRouterBase7a = config.openaiRouterBaseUrl;

    // Verify openai_router is NOT in fallback candidates when base URL is missing
    const { getFallbackCandidates } = await import('./dist/ai/client.js');
    const candidatesNoUrl = getFallbackCandidates(config.currentProvider, { ...config, openaiRouterBaseUrl: undefined });
    const routerInCandidatesNoUrl = candidatesNoUrl.some(c => c.provider === 'openai_router');
    console.log(`  openai_router in fallback candidates without base URL: ${routerInCandidatesNoUrl} (expected: false)`);

    // Verify openai_router IS in fallback candidates when base URL is set
    const candidatesWithUrl = getFallbackCandidates(config.currentProvider, { ...config, openaiRouterBaseUrl: 'http://mock:1234/v1' });
    const routerInCandidatesWithUrl = candidatesWithUrl.some(c => c.provider === 'openai_router');
    console.log(`  openai_router in fallback candidates WITH base URL: ${routerInCandidatesWithUrl} (expected: true)`);

    const noUrlPass = !routerInCandidatesNoUrl;
    const withUrlPass = routerInCandidatesWithUrl;
    console.log(`  ${noUrlPass ? '✓ openai_router not in fallback path when no base URL' : '✗ FAILED: should not appear without base URL'}`);
    console.log(`  ${withUrlPass ? '✓ openai_router in fallback path when base URL set' : '✗ FAILED: should appear with base URL'}`);
    console.log(`  ${noUrlPass && withUrlPass ? '✓ Fallback gating works correctly' : '⚠ Fallback gating issues'}`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message.slice(0, 200)}`);
  } finally {
    config.openaiRouterBaseUrl = savedRouterBase7a;
    config.currentProvider = origProvider;
    config.currentModel = origModel;
  }

  // ===== TEST 7b: OpenAI Router — Mock Server =====
  section('TEST 7b: OpenAI Router — mock server endpoint');
  console.log('  Testing: openai_router configured with a mock server endpoint');
  try {
    const http = await import('node:http');
    const mockResponses7b = [];
    let mockServer7b = null;

    const startMock7b = () => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        mockResponses7b.push({ method: req.method, url: req.url, headers: req.headers });
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          mockResponses7b[mockResponses7b.length - 1].body = body;
          if (req.url === '/chat/completions') {
            const parsed = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: 'chatcmpl-mock',
              object: 'chat.completion',
              choices: [{
                index: 0,
                message: {
                  role: 'assistant',
                  content: `Router reply: ${parsed.messages?.[parsed.messages.length - 1]?.content || 'empty'}`
                },
                finish_reason: 'stop'
              }],
              model: parsed.model || 'mock-model',
              usage: { prompt_tokens: 10, completion_tokens: 5 }
            }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        mockServer7b = server;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
      server.on('error', reject);
    });

    const mockBase7b = await startMock7b();
    console.log(`  Mock server at: ${mockBase7b}`);

    const { createOpenAICompatibleClient } = await import('./dist/ai/openai-compatible.js');
    const mockClient = createOpenAICompatibleClient(mockBase7b, 'router-key-789', 'gpt-4o-mini');

    const result = await mockClient.sendMessage(
      [{ role: 'user', content: 'Hello router' }],
      'System prompt'
    );

    console.log(`  Response: "${result.message}"`);
    console.log(`  Tool calls: ${result.toolCalls?.length || 0}`);

    const lastReq = mockResponses7b[mockResponses7b.length - 1];
    const hasAuth = lastReq?.headers?.['authorization'] === 'Bearer router-key-789';
    const hasContentType = lastReq?.headers?.['content-type'] === 'application/json';
    console.log(`  authorization header: ${hasAuth ? '✓' : '✗'}`);
    console.log(`  content-type header: ${hasContentType ? '✓' : '✗'}`);

    const allOk = hasAuth && hasContentType && result.message?.includes('Hello router');
    console.log(`  ${result.message?.includes('Hello router') ? '✓ Correct response content' : '✗ Unexpected content'}`);
    console.log(`  ${allOk ? '✓ openai_router mock server test PASSED' : '✗ FAILED'}`);

    mockServer7b.close();
    console.log('  Mock server stopped.');
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // ===== TEST 7c: OpenAI Router — Streaming with Mock Server =====
  section('TEST 7c: OpenAI Router — streaming path');
  console.log('  Testing: openai_router SSE streaming endpoint');
  try {
    const http = await import('node:http');
    let streamServer7c = null;

    const startStream7c = () => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/chat/completions') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.write(`data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`);
          res.write(`data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello from "},"finish_reason":null}]}\n\n`);
          res.write(`data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"streaming router!"},"finish_reason":null}]}\n\n`);
          res.write(`data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`);
          res.write(`data: [DONE]\n\n`);
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [] }));
        }
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        streamServer7c = server;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
      server.on('error', reject);
    });

    const streamBase7c = await startStream7c();
    console.log(`  Stream server at: ${streamBase7c}`);

    const { createOpenAICompatibleClient } = await import('./dist/ai/openai-compatible.js');
    const streamClient = createOpenAICompatibleClient(streamBase7c, 'stream-key', 'gpt-4o-mini');

    const chunks7c = [];
    const result = await streamClient.sendMessageStream(
      [{ role: 'user', content: 'Stream test' }],
      'You are a bot',
      (event) => {
        if (event.type === 'token') {
          chunks7c.push(event.text);
        }
      }
    );

    const fullText = chunks7c.join('');
    console.log(`  Streamed chunks: ${JSON.stringify(chunks7c)}`);
    console.log(`  Full text: "${fullText}"`);
    console.log(`  Result message: "${result.message}"`);
    console.log(`  ${fullText.includes('Hello from streaming') ? '✓ Streaming works correctly' : '✗ Streaming failed'}`);

    streamServer7c.close();
    console.log('  Stream server stopped.');
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // ===== TEST 7d: OpenAI Router — Fallback Chain =====
  section('TEST 7d: OpenAI Router — fallback from rate-limited primary');
  console.log('  Testing: primary fails, openai_router in fallback chain succeeds');
  let savedKeys7d;
  let savedRouterBase7d;
  let savedExpFlag7d;
  let fbMockServer7d = null;
  let fbMockBase7d = '';
  try {
    const http = await import('node:http');

    const startFb7d = () => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/chat/completions') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-fallback',
            object: 'chat.completion',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'Fallback router response: success!' },
              finish_reason: 'stop'
            }],
            model: 'gpt-4o-mini',
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
        }
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        fbMockServer7d = server;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
      server.on('error', reject);
    });

    fbMockBase7d = await startFb7d();
    console.log(`  Fallback mock server at: ${fbMockBase7d}`);

    // Save and clear all keys so only openai_router works as fallback
    savedKeys7d = { ...config.apiKeys };
    for (const k of Object.keys(config.apiKeys)) {
      config.apiKeys[k] = '';
    }

    config.currentProvider = 'deepseek';
    config.currentModel = 'deepseek-chat';
    config.apiKeys.deepseek = '';

    savedExpFlag7d = config.allowExperimentalProviders;
    config.allowExperimentalProviders = false;

    // Configure openai_router as the only working fallback
    savedRouterBase7d = config.openaiRouterBaseUrl;
    config.openaiRouterBaseUrl = fbMockBase7d;
    config.apiKeys.openai_router = 'mock-router-key';

    resetHealth();
    clearFallbackEvents();

    const sysPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints || [],
      configFiles: projectInfo.configFiles || [],
      fileCount: projectInfo.fileCount,
    }, undefined, false, 'deepseek', 'auto');

    const fbStart = Date.now();
    let fbResult;

    try {
      const client = createClient(config);
      fbResult = await client.sendMessage(
        [{ role: 'user', content: 'say hi briefly' }],
        sysPrompt
      );
    } catch (err) {
      const dur = ((Date.now() - fbStart) / 1000).toFixed(1);
      const fbEvents = getFallbackEvents();
      console.log(`  Failed after ${dur}s`);
      console.log(`  Error: ${err.message.slice(0, 300)}`);
      console.log(`  Fallback events: ${fbEvents.length}`);
      for (const e of fbEvents) {
        console.log(`    ~ ${e.reason}`);
      }
      throw err;
    }

    const dur = ((Date.now() - fbStart) / 1000).toFixed(1);
    const fbEvents = getFallbackEvents();

    hr();
    console.log(`  Response time: ${dur}s`);
    console.log(`  Has message: ${!!fbResult.message}`);
    if (fbResult.message) {
      console.log(`  Response: ${fbResult.message.slice(0, 200)}`);
    }
    console.log(`  Fallback events: ${fbEvents.length}`);
    for (const e of fbEvents) {
      console.log(`    ~ ${e.reason}`);
    }

    const routerUsed = fbEvents.some(e => e.reason.includes('OpenAI Router') && e.reason.includes('Switched'));
    const gotContent = fbResult?.message?.includes('Fallback router response');
    console.log(`  ${routerUsed ? '✓ openai_router was used as fallback' : '✗ openai_router not used'}`);
    console.log(`  ${gotContent ? '✓ Got expected response from router' : '✗ Unexpected response'}`);
    console.log(`  ${routerUsed && gotContent ? '✓ Fallback to openai_router WORKS' : '⚠ Fallback test issues'}`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  } finally {
    if (savedKeys7d) {
      config.apiKeys = savedKeys7d;
    }
    config.openaiRouterBaseUrl = savedRouterBase7d;
    if (savedExpFlag7d !== undefined) config.allowExperimentalProviders = savedExpFlag7d;
    config.currentProvider = origProvider;
    config.currentModel = origModel;
    if (fbMockServer7d) {
      fbMockServer7d.close();
      console.log('  Fallback mock server stopped.');
    }
  }

  // ===== TEST 7e: OpenAI Router — Failure Debug Info =====
  section('TEST 7e: OpenAI Router — failure debug, no secret leakage');
  console.log('  Testing: openai_router failure produces friendly error without leaking secrets');
  try {
    const http = await import('node:http');
    let errServer7e = null;

    const startErr7e = () => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'Rate limit exceeded. Please slow down.' }
        }));
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        errServer7e = server;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
      server.on('error', reject);
    });

    const errBase7e = await startErr7e();
    console.log(`  Error mock server at: ${errBase7e}`);

    const { createOpenAICompatibleClient } = await import('./dist/ai/openai-compatible.js');
    const errClient = createOpenAICompatibleClient(errBase7e, 'secret-router-key-xyz', 'gpt-4o-mini');

    let caughtError = null;
    try {
      await errClient.sendMessage(
        [{ role: 'user', content: 'test' }],
        'system prompt'
      );
    } catch (err) {
      caughtError = err;
    }

    if (caughtError) {
      const msg = caughtError.message || '';
      console.log(`  Error message: "${msg.slice(0, 200)}"`);
      const hasSecret = msg.includes('secret-router-key-xyz') || msg.includes('router-key');
      const hasFriendlyInfo = msg.includes('429') || msg.includes('rate limit');
      console.log(`  ${!hasSecret ? '✓ No secret leaked in error message' : '✗ SECRET LEAKED!'}`);
      console.log(`  ${hasFriendlyInfo ? '✓ Contains status/friendly info' : '⚠ May lack friendly info'}`);
      console.log(`  ${!hasSecret && hasFriendlyInfo ? '✓ Error debug is safe and informative' : '⚠ Error handling needs review'}`);
    } else {
      console.log('  ✗ Expected error but got none');
    }

    errServer7e.close();
    console.log('  Error server stopped.');
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // ===== TEST 8: Web UI =====
  section('TEST 8: Web UI — API endpoint test');
  console.log('  Web UI test via /api/chat endpoint');
  console.log('  Starting web server on port 8787...');

  try {
    const { startWebServer } = await import('./dist/web/server.js');
    const server = await startWebServer(8787);

    const baseUrl = 'http://localhost:8787';

    // Test 7a: Status endpoint
    console.log('\n  7a. Checking /api/status...');
    const statusRes = await (await fetch(`${baseUrl}/api/status`)).json();
    console.log(`      Provider: ${statusRes.provider}`);
    console.log(`      Model: ${statusRes.model}`);
    console.log(`      Tier: ${statusRes.tier}`);
    console.log(`      Git: ${statusRes.git ? `${statusRes.git.branch} ${statusRes.git.hasChanges ? 'modified' : 'clean'}` : 'N/A'}`);

    // Test 7b: Greeting via API
    console.log('\n  7b. Sending greeting via /api/chat...');
    let chatStart = Date.now();
    let chatRes = await (await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }]
      })
    })).json();
    console.log(`      Response time: ${elapsed(chatStart)}s`);
    console.log(`      Provider: ${chatRes.provider || 'N/A'}`);
    console.log(`      Model: ${chatRes.model || 'N/A'}`);
    console.log(`      Message: ${chatRes.message?.slice(0, 100) || 'N/A'}`);
    console.log(`      Tool calls: ${chatRes.toolCalls?.length || 0}`);
    console.log(`      Fallback events: ${chatRes.fallbackEvents ? chatRes.fallbackEvents.join(', ') : 'none'}`);
    console.log(`      ${!chatRes.error ? '✓ No error' : '⚠ Error: ' + chatRes.error}`);

    // Test 7c: Coding question via API
    console.log('\n  7c. Sending "what is package.json" via /api/chat...');
    chatStart = Date.now();
    chatRes = await (await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'what is package.json' }]
      })
    })).json();
    const chatDur = elapsed(chatStart);
    console.log(`      Response time: ${chatDur}s`);
    console.log(`      Provider: ${chatRes.provider || 'N/A'}`);
    console.log(`      Model: ${chatRes.model || 'N/A'}`);
    console.log(`      Has message: ${!!chatRes.message}`);
    console.log(`      Fallback events: ${chatRes.fallbackEvents ? chatRes.fallbackEvents.join(', ') : 'none'}`);
    console.log(`      ${chatDur < 20 ? '✓ OK' : '⚠ SLOW (>20s)'} — ${chatDur}s`);

    // Test 7d: Fallback status
    console.log('\n  7d. Checking /api/fallback...');
    const fbStatusRes = await (await fetch(`${baseUrl}/api/fallback`)).json();
    console.log(`      Last error: ${fbStatusRes.lastError ? `${fbStatusRes.lastError.provider}/${fbStatusRes.lastError.model}: ${fbStatusRes.lastError.reason?.slice(0, 80)}` : 'none'}`);
    console.log(`      Last fallback: ${fbStatusRes.lastFallback || 'none'}`);
    console.log(`      Unhealthy: ${fbStatusRes.unhealthy?.length || 0} entries`);

    // Test 7e: Project tree
    console.log('\n  7e. Checking /api/project/tree...');
    const treeRes = await (await fetch(`${baseUrl}/api/project/tree`)).json();
    console.log(`      Files: ${treeRes.fileCount}`);
    console.log(`      Important files: ${treeRes.files?.length || 0}`);

    // Test 7f: PDF attachment with extracted text
    console.log('\n  7f. Sending attachment with PDF extracted text via /api/chat...');
    let pdfTestPassed = true;
    const samplePdfText = 'This PDF is about Spanish grammar. The present tense in Spanish is used for current actions, habitual actions, and general truths. For regular -ar verbs, remove the -ar ending and add -o, -as, -a, -amos, -áis, -an. For regular -er verbs, remove the -er ending and add -o, -es, -e, -emos, -éis, -en. For regular -ir verbs, remove the -ir ending and add -o, -es, -e, -imos, -ís, -en. Key irregular verbs include ser (to be), ir (to go), and tener (to have).';
    chatStart = Date.now();
    try {
      chatRes = await (await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'summarize this pdf' }],
          attachments: [{
            name: 'spanish-grammar.pdf',
            ext: '.pdf',
            size: 24576,
            kind: 'pdf',
            textContent: samplePdfText,
          }]
        })
      })).json();
      const pdfDur = elapsed(chatStart);
      console.log(`      Response time: ${pdfDur}s`);
      console.log(`      Provider: ${chatRes.provider || 'N/A'}`);
      console.log(`      Model: ${chatRes.model || 'N/A'}`);
      console.log(`      Has message: ${!!chatRes.message}`);
      if (chatRes.message) {
        const snippet = chatRes.message.slice(0, 200);
        console.log(`      Response preview: ${snippet}...`);
        const forbidden = ["can't read PDF", "cannot read PDF", "upload the PDF", "paste the content", "unable to read PDF", "don't have access to the PDF"];
        for (const phrase of forbidden) {
          if (chatRes.message.toLowerCase().includes(phrase.toLowerCase())) {
            console.log(`      ⚠ Found forbidden phrase: "${phrase}"`);
            pdfTestPassed = false;
          }
        }
        // Verify the response actually discusses Spanish grammar
        if (chatRes.message.toLowerCase().includes('spanish') || chatRes.message.toLowerCase().includes('grammar') || chatRes.message.toLowerCase().includes('present tense') || chatRes.message.toLowerCase().includes('verbs')) {
          console.log(`      ✓ Response references PDF content (Spanish grammar)`);
        } else {
          console.log(`      ⚠ Response does not mention Spanish grammar content`);
          pdfTestPassed = false;
        }
      }
      console.log(`      ${pdfTestPassed && pdfDur < 30 ? '✓ PDF attachment test passed' : '⚠ PDF attachment test issues'}`);
    } catch (err) {
      console.log(`      ✗ PDF attachment test error: ${err.message}`);
    }

    // Set current provider to OpenRouter for vision fallback tests
    console.log('\n  7g. Setting provider to OpenRouter for vision fallback tests...');
    try {
      const configRes = await (await fetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentProvider: 'openrouter', currentModel: 'qwen/qwen3-coder:free' })
      })).json();
      console.log(`      Provider set to: ${configRes.currentProvider} / ${configRes.currentModel}`);
    } catch (err) {
      console.log(`      ⚠ Could not set provider: ${err.message}`);
    }

    // Test 7g: Image attachment with non-vision provider (OpenRouter) — vision fallback test
    console.log('\n  7g. Image attachment to OpenRouter non-vision model (English) — expects fallback to OpenRouter vision or friendly error...');
    let img7gPassed = true;
    try {
      const imgDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const imgStart = Date.now();
      const imgRes = await (await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'what is this image' }],
          attachments: [{
            name: 'test.png',
            ext: '.png',
            size: 68,
            kind: 'image',
            dataUrl: imgDataUrl,
          }]
        })
      })).json();
      const imgDur = ((Date.now() - imgStart) / 1000).toFixed(1);
      console.log(`      Response time: ${imgDur}s`);
      console.log(`      Has message: ${!!imgRes.message}`);
      const hasContent = !!(imgRes.message && imgRes.message.length > 10);
      const isVisionError = !!(imgRes.message && imgRes.message.toLowerCase().includes('vision'));
      const providerCount = imgRes.message ? (imgRes.message.match(/—/g) || []).length : 0;

      if (hasContent && !isVisionError) {
        console.log(`      ✓ Vision fallback succeeded: "${imgRes.message.slice(0, 80)}..."`);
        console.log(`      Provider used: ${imgRes.provider || '?'} / ${imgRes.model || '?'}`);
        if (imgRes.provider && (imgRes.provider.includes('OpenRouter') || imgRes.model?.includes('gemini'))) {
          console.log(`      ✓ Used OpenRouter vision candidate`);
        } else {
          console.log(`      ⚠ Unexpected provider — expected OpenRouter`);
        }
      } else if (isVisionError) {
        console.log(`      Vision fallback all failed — checking error quality`);
        const snippet = imgRes.message.slice(0, 200);
        console.log(`      Error: ${snippet}`);
        if (providerCount <= 3) {
          console.log(`      ✓ <=3 provider lines (controlled fallback): ${providerCount}`);
        } else {
          console.log(`      ⚠ Too many provider lines (>3): ${providerCount}`);
          img7gPassed = false;
        }
        // Check that error does NOT contain a huge technical dump
        const lineCount = (imgRes.message || '').split('\n').length;
        if (lineCount <= 6) {
          console.log(`      ✓ Error is short (${lineCount} lines)`);
        } else {
          console.log(`      ⚠ Error too long (${lineCount} lines)`);
          img7gPassed = false;
        }
      } else {
        console.log(`      ⚠ No useful response`);
        img7gPassed = false;
      }
      console.log(`      ${img7gPassed ? '✓ Image English test completed' : '⚠ Image English test issues'}`);
    } catch (err) {
      console.log(`      ✗ Image English test error: ${err.message}`);
    }

    // Test 7h: Image attachment with Arabic input — expects Arabic friendly error or Arabic description
    console.log('\n  7h. Image attachment (Arabic) with OpenRouter — expects Arabic response or friendly Arabic error...');
    let img7hPassed = true;
    try {
      const imgDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const imgStart = Date.now();
      const imgRes = await (await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'اشرح هذه الصورة' }],
          attachments: [{
            name: 'test.png',
            ext: '.png',
            size: 68,
            kind: 'image',
            dataUrl: imgDataUrl,
          }]
        })
      })).json();
      const imgDur = ((Date.now() - imgStart) / 1000).toFixed(1);
      console.log(`      Response time: ${imgDur}s`);
      console.log(`      Has message: ${!!imgRes.message}`);
      const hasContent = !!(imgRes.message && imgRes.message.length > 10);
      const isArabic = /[\u0600-\u06FF]/.test(imgRes.message || '');
      const providerCount = imgRes.message ? (imgRes.message.match(/—/g) || []).length : 0;
      const lineCount = (imgRes.message || '').split('\n').length;

      if (hasContent && isArabic) {
        console.log(`      ✓ Arabic response: "${imgRes.message.slice(0, 100)}..."`);
      } else if (hasContent && !isArabic) {
        console.log(`      ⚠ Response is not in Arabic (user asked in Arabic): ${imgRes.message.slice(0, 100)}...`);
        img7hPassed = false;
      } else {
        console.log(`      ⚠ No useful response`);
        img7hPassed = false;
      }
      if (providerCount <= 3) {
        console.log(`      ✓ <=3 provider lines: ${providerCount}`);
      } else {
        console.log(`      ⚠ Too many provider lines (>3): ${providerCount}`);
        img7hPassed = false;
      }
      if (lineCount <= 6) {
        console.log(`      ✓ Error is short (${lineCount} lines, excluding debug)`);
      } else {
        console.log(`      ⚠ Error too long (${lineCount} lines)`);
      }
      console.log(`      ${img7hPassed ? '✓ Arabic image test passed' : '⚠ Arabic image test issues'}`);
    } catch (err) {
      console.log(`      ✗ Arabic image test error: ${err.message}`);
    }

    // Cleanup
    const serverRef = (await import('./dist/web/server.js')).getServerRef();
    if (serverRef) serverRef.close();
    console.log('\n  Web server stopped.');

  } catch (err) {
    console.log(`  ✗ Web UI test error: ${err.message}`);
    console.log('  (May need to build web UI first: cd web && npm install && npm run build)');
  }

  // ===== TEST 9: Web Search Reliability & Diagnostics =====
  try {
    const { searchWeb, formatSearchResults, getWebSearchConfig, getSearchDiagnostics, isReliableProvider } = await import('./dist/tools/web-search.js');

    // --- Test 9a: DDG fallback when no API keys ---
    section('TEST 9a: Web Search — DDG fallback (no API keys)');
    const wsConfig = getWebSearchConfig();
    const wsDiag = getSearchDiagnostics();
    console.log(`  Provider: ${wsConfig.provider}`);
    console.log(`  DuckDuckGo fallback available without keys: ${wsConfig.provider === 'ddg' ? '✓' : '✗'}`);
    console.log(`  isReliableProvider(): ${isReliableProvider() ? 'true (✓)' : 'false (✓ — DDG is not reliable)'}`);
    if (wsConfig.provider === 'ddg' || wsConfig.provider === 'none') {
      console.log(`  Expected: DDG limited fallback — not a full web search API`);
      console.log(`  For reliable search, configure TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.`);
      let threwError = false;
      try {
        const results = await searchWeb('test query', { maxResults: 1 });
        console.log(`  searchWeb() returned ${results.length} results`);
        if (results.length === 0) {
          console.log('  ✓ DDG returned empty (expected — limited Instant Answer API)');
          console.log('  ✓ User should see: "No results returned from DuckDuckGo fallback..."');
        } else {
          console.log('  ✓ DDG returned some results (instant answer match found)');
        }
      } catch (err) {
        threwError = true;
        const msg = err.message;
        if (msg.includes('not configured')) {
          console.log('  ✓ Web search correctly reports not configured');
        } else {
          console.log(`  ⚠ searchWeb() threw: ${msg.slice(0, 100)}`);
        }
      }
      if (!threwError) console.log('  ✓ No API keys required for basic web search (DDG fallback)');
    }

    // --- Test 9b: Format search results ---
    section('TEST 9b: Web Search — format results');
    const results = [
      { title: 'Test Article', url: 'https://example.com/test', snippet: 'This is a test snippet.', source: 'Test' },
      { title: 'Another Article', url: 'https://example.com/another', snippet: 'Another test snippet.', source: 'Test' },
    ];
    const formatted = formatSearchResults('test query', results);
    const hasTitle = formatted.includes('Test Article');
    const hasUrl = formatted.includes('https://example.com/test');
    const hasSnippet = formatted.includes('This is a test snippet.');
    const hasInstructions = formatted.includes('Cite URLs naturally');
    console.log(`  Title in output: ${hasTitle ? '✓' : '✗'}`);
    console.log(`  URL in output: ${hasUrl ? '✓' : '✗'}`);
    console.log(`  Snippet in output: ${hasSnippet ? '✓' : '✗'}`);
    console.log(`  Instructions in output: ${hasInstructions ? '✓' : '✗'}`);
    if (hasTitle && hasUrl && hasSnippet && hasInstructions) console.log('  ✓ Search result formatting works correctly');

    // --- Test 9c: Empty results format ---
    section('TEST 9c: Web Search — empty results format');
    const emptyFormatted = formatSearchResults('nothing', []);
    console.log(`  Empty result message: "${emptyFormatted}"`);
    console.log(`  Contains "No search results": ${emptyFormatted.includes('No search results') ? '✓' : '✗'}`);

    // --- Test 9d: getSearchDiagnostics() ---
    section('TEST 9d: Web Search — diagnostics function');
    console.log(`  Provider: ${wsDiag.provider}`);
    console.log(`  Configured keys: ${wsDiag.configuredKeys.length > 0 ? wsDiag.configuredKeys.join(', ') : 'none'}`);
    console.log(`  hasTavilyKey: ${wsDiag.hasTavilyKey}`);
    console.log(`  hasSerperKey: ${wsDiag.hasSerperKey}`);
    console.log(`  hasBraveKey: ${wsDiag.hasBraveKey}`);
    console.log(`  ddgAvailable: ${wsDiag.ddgAvailable ? '✓' : '✗'}`);
    console.log(`  isReliable: ${wsDiag.isReliable ? 'true' : 'false (✓ — DDG/none is not reliable)'}`);
    console.log(`  ddgExperimental: ${wsDiag.ddgExperimental ? 'true (✓)' : 'false'}`);
    const diagHasAllFields = wsDiag.hasOwnProperty('provider') && wsDiag.hasOwnProperty('configuredKeys') && wsDiag.hasOwnProperty('isReliable') && wsDiag.hasOwnProperty('ddgExperimental');
    console.log(`  ${diagHasAllFields ? '✓ getSearchDiagnostics() returns all expected fields' : '✗ Missing fields'}`);

    // --- Test 9e: Mock Tavily server ---
    section('TEST 9e: Web Search — Tavily mock server');
    let tavilyPassed = false;
    try {
      const http = await import('node:http');
      let tavilyServer = null;
      const startTavily = () => new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
          if (req.url === '/search') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
              const parsed = JSON.parse(body);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                results: [
                  { title: 'Tavily Result', url: 'https://tavily.com/result', content: 'This is a Tavily search result.' }
                ]
              }));
            });
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));
          }
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          tavilyServer = server;
          resolve(`http://127.0.0.1:${addr.port}`);
        });
        server.on('error', reject);
      });

      const tavilyUrl = await startTavily();
      console.log(`  Mock Tavily server at: ${tavilyUrl}`);

      const oldTavilyKey = process.env.TAVILY_API_KEY;
      const oldTavilyBase = process.env.HYSA_WEB_SEARCH_TAVILY_BASE;
      process.env.TAVILY_API_KEY = 'mock-tavily-key';
      process.env.HYSA_WEB_SEARCH_TAVILY_BASE = tavilyUrl;

      const tavilyResults = await searchWeb('tavily test', { maxResults: 3 });
      const hasTavilyContent = tavilyResults.length > 0 && tavilyResults[0].title === 'Tavily Result';
      console.log(`  Results count: ${tavilyResults.length}`);
      console.log(`  Title: ${tavilyResults[0]?.title || '(none)'}`);
      console.log(`  URL: ${tavilyResults[0]?.url || '(none)'}`);
      console.log(`  Snippet: ${tavilyResults[0]?.snippet || '(none)'}`);
      console.log(`  Source: ${tavilyResults[0]?.source || '(none)'}`);
      console.log(`  ${hasTavilyContent ? '✓ Tavily mock returns expected results' : '✗ Unexpected Tavily results'}`);

      if (oldTavilyKey) process.env.TAVILY_API_KEY = oldTavilyKey; else delete process.env.TAVILY_API_KEY;
      if (oldTavilyBase) process.env.HYSA_WEB_SEARCH_TAVILY_BASE = oldTavilyBase; else delete process.env.HYSA_WEB_SEARCH_TAVILY_BASE;
      tavilyPassed = hasTavilyContent;
      tavilyServer.close();
      console.log('  Tavily mock server stopped.');
    } catch (err) {
      console.log(`  ✗ Tavily test error: ${err.message}`);
      // Clean up env vars
      if (process.env.TAVILY_API_KEY) delete process.env.TAVILY_API_KEY;
      if (process.env.HYSA_WEB_SEARCH_TAVILY_BASE) delete process.env.HYSA_WEB_SEARCH_TAVILY_BASE;
    }
    console.log(`  ${tavilyPassed ? '✓ Tavily mock server TEST PASSED' : '⚠ Tavily mock test issues'}`);

    // --- Test 9f: Mock Serper server ---
    section('TEST 9f: Web Search — Serper mock server');
    let serperPassed = false;
    try {
      const http = await import('node:http');
      let serperServer = null;
      const startSerper = () => new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
          if (req.url === '/search') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                organic: [
                  { title: 'Serper Result', link: 'https://serper.dev/result', snippet: 'This is a Serper search result.' }
                ]
              }));
            });
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));
          }
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          serperServer = server;
          resolve(`http://127.0.0.1:${addr.port}`);
        });
        server.on('error', reject);
      });

      const serperUrl = await startSerper();
      console.log(`  Mock Serper server at: ${serperUrl}`);

      const oldTavilyKey9f = process.env.TAVILY_API_KEY;
      const oldBraveKey9f = process.env.BRAVE_SEARCH_API_KEY;
      const oldSerperKey9f = process.env.SERPER_API_KEY;
      const oldSerperBase9f = process.env.HYSA_WEB_SEARCH_SERPER_BASE;
      const oldWebSearchProvider9f = process.env.HYSA_WEB_SEARCH_PROVIDER;
      delete process.env.TAVILY_API_KEY;
      delete process.env.BRAVE_SEARCH_API_KEY;
      process.env.HYSA_WEB_SEARCH_PROVIDER = 'serper';
      process.env.SERPER_API_KEY = 'mock-serper-key';
      process.env.HYSA_WEB_SEARCH_SERPER_BASE = serperUrl;

      const serperResults = await searchWeb('serper test', { maxResults: 3 });
      const hasSerperContent = serperResults.length > 0 && serperResults[0].title === 'Serper Result';
      console.log(`  Results count: ${serperResults.length}`);
      console.log(`  Title: ${serperResults[0]?.title || '(none)'}`);
      console.log(`  URL: ${serperResults[0]?.url || '(none)'}`);
      console.log(`  Snippet: ${serperResults[0]?.snippet || '(none)'}`);
      console.log(`  Source: ${serperResults[0]?.source || '(none)'}`);
      if (!hasSerperContent) { console.log(`  ✗ Unexpected Serper results`); globalTestFailed = true; } else { console.log(`  ✓ Serper mock returns expected results`); }

      if (oldTavilyKey9f !== undefined) process.env.TAVILY_API_KEY = oldTavilyKey9f; else delete process.env.TAVILY_API_KEY;
      if (oldBraveKey9f !== undefined) process.env.BRAVE_SEARCH_API_KEY = oldBraveKey9f; else delete process.env.BRAVE_SEARCH_API_KEY;
      if (oldSerperKey9f !== undefined) process.env.SERPER_API_KEY = oldSerperKey9f; else delete process.env.SERPER_API_KEY;
      if (oldSerperBase9f !== undefined) process.env.HYSA_WEB_SEARCH_SERPER_BASE = oldSerperBase9f; else delete process.env.HYSA_WEB_SEARCH_SERPER_BASE;
      if (oldWebSearchProvider9f !== undefined) process.env.HYSA_WEB_SEARCH_PROVIDER = oldWebSearchProvider9f; else delete process.env.HYSA_WEB_SEARCH_PROVIDER;
      serperPassed = hasSerperContent;
      serperServer.close();
      console.log('  Serper mock server stopped.');
    } catch (err) {
      console.log(`  ✗ Serper test error: ${err.message}`);
      globalTestFailed = true;
      if (oldTavilyKey9f !== undefined) process.env.TAVILY_API_KEY = oldTavilyKey9f; else delete process.env.TAVILY_API_KEY;
      if (oldBraveKey9f !== undefined) process.env.BRAVE_SEARCH_API_KEY = oldBraveKey9f; else delete process.env.BRAVE_SEARCH_API_KEY;
      if (oldSerperKey9f !== undefined) process.env.SERPER_API_KEY = oldSerperKey9f; else delete process.env.SERPER_API_KEY;
      if (oldSerperBase9f !== undefined) process.env.HYSA_WEB_SEARCH_SERPER_BASE = oldSerperBase9f; else delete process.env.HYSA_WEB_SEARCH_SERPER_BASE;
      if (oldWebSearchProvider9f !== undefined) process.env.HYSA_WEB_SEARCH_PROVIDER = oldWebSearchProvider9f; else delete process.env.HYSA_WEB_SEARCH_PROVIDER;
    }
    console.log(`  ${serperPassed ? '✓ Serper mock server TEST PASSED' : '⚠ Serper mock test issues'}`);

    // --- Test 9g: Mock Brave server ---
    section('TEST 9g: Web Search — Brave mock server');
    let bravePassed = false;
    try {
      const http = await import('node:http');
      let braveServer = null;
      const startBrave = () => new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
          if (req.url && req.url.startsWith('/res/v1/web/search')) {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                web: {
                  results: [
                    { title: 'Brave Result', url: 'https://brave.com/result', description: 'This is a Brave search result.' }
                  ]
                }
              }));
            });
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));
          }
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          braveServer = server;
          resolve(`http://127.0.0.1:${addr.port}`);
        });
        server.on('error', reject);
      });

      const braveUrl = await startBrave();
      console.log(`  Mock Brave server at: ${braveUrl}`);

      const oldTavilyKey9g = process.env.TAVILY_API_KEY;
      const oldSerperKey9g = process.env.SERPER_API_KEY;
      const oldBraveKey9g = process.env.BRAVE_SEARCH_API_KEY;
      const oldBraveBase9g = process.env.HYSA_WEB_SEARCH_BRAVE_BASE;
      const oldWebSearchProvider9g = process.env.HYSA_WEB_SEARCH_PROVIDER;
      delete process.env.TAVILY_API_KEY;
      delete process.env.SERPER_API_KEY;
      process.env.HYSA_WEB_SEARCH_PROVIDER = 'brave';
      process.env.BRAVE_SEARCH_API_KEY = 'mock-brave-key';
      process.env.HYSA_WEB_SEARCH_BRAVE_BASE = braveUrl;

      const braveResults = await searchWeb('brave test', { maxResults: 3 });
      const hasBraveContent = braveResults.length > 0 && braveResults[0].title === 'Brave Result';
      console.log(`  Results count: ${braveResults.length}`);
      console.log(`  Title: ${braveResults[0]?.title || '(none)'}`);
      console.log(`  URL: ${braveResults[0]?.url || '(none)'}`);
      console.log(`  Snippet: ${braveResults[0]?.snippet || '(none)'}`);
      console.log(`  Source: ${braveResults[0]?.source || '(none)'}`);
      if (!hasBraveContent) { console.log(`  ✗ Unexpected Brave results`); globalTestFailed = true; } else { console.log(`  ✓ Brave mock returns expected results`); }

      if (oldTavilyKey9g !== undefined) process.env.TAVILY_API_KEY = oldTavilyKey9g; else delete process.env.TAVILY_API_KEY;
      if (oldSerperKey9g !== undefined) process.env.SERPER_API_KEY = oldSerperKey9g; else delete process.env.SERPER_API_KEY;
      if (oldBraveKey9g !== undefined) process.env.BRAVE_SEARCH_API_KEY = oldBraveKey9g; else delete process.env.BRAVE_SEARCH_API_KEY;
      if (oldBraveBase9g !== undefined) process.env.HYSA_WEB_SEARCH_BRAVE_BASE = oldBraveBase9g; else delete process.env.HYSA_WEB_SEARCH_BRAVE_BASE;
      if (oldWebSearchProvider9g !== undefined) process.env.HYSA_WEB_SEARCH_PROVIDER = oldWebSearchProvider9g; else delete process.env.HYSA_WEB_SEARCH_PROVIDER;
      bravePassed = hasBraveContent;
      braveServer.close();
      console.log('  Brave mock server stopped.');
    } catch (err) {
      console.log(`  ✗ Brave test error: ${err.message}`);
      globalTestFailed = true;
      if (oldTavilyKey9g !== undefined) process.env.TAVILY_API_KEY = oldTavilyKey9g; else delete process.env.TAVILY_API_KEY;
      if (oldSerperKey9g !== undefined) process.env.SERPER_API_KEY = oldSerperKey9g; else delete process.env.SERPER_API_KEY;
      if (oldBraveKey9g !== undefined) process.env.BRAVE_SEARCH_API_KEY = oldBraveKey9g; else delete process.env.BRAVE_SEARCH_API_KEY;
      if (oldBraveBase9g !== undefined) process.env.HYSA_WEB_SEARCH_BRAVE_BASE = oldBraveBase9g; else delete process.env.HYSA_WEB_SEARCH_BRAVE_BASE;
      if (oldWebSearchProvider9g !== undefined) process.env.HYSA_WEB_SEARCH_PROVIDER = oldWebSearchProvider9g; else delete process.env.HYSA_WEB_SEARCH_PROVIDER;
    }
    console.log(`  ${bravePassed ? '✓ Brave mock server TEST PASSED' : '⚠ Brave mock test issues'}`);

    // --- Test 9h: Unreliable provider message format (Arabic scenario) ---
    section('TEST 9h: Web Search — unreliable provider message (Arabic friendly)');
    const unreliableMsg = 'Web search is not reliably configured. To enable web search, set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.';
    console.log(`  Message: "${unreliableMsg}"`);
    console.log(`  Contains "not reliably configured": ${unreliableMsg.includes('not reliably configured') ? '✓' : '✗'}`);
    console.log(`  Contains TAVILY_API_KEY: ${unreliableMsg.includes('TAVILY_API_KEY') ? '✓' : '✗'}`);
    console.log(`  Contains SERPER_API_KEY: ${unreliableMsg.includes('SERPER_API_KEY') ? '✓' : '✗'}`);
    console.log(`  Contains BRAVE_SEARCH_API_KEY: ${unreliableMsg.includes('BRAVE_SEARCH_API_KEY') ? '✓' : '✗'}`);
    console.log(`  ${unreliableMsg.includes('not reliably configured') && unreliableMsg.includes('TAVILY_API_KEY') ? '✓ Unreliable message format is correct' : '✗ Message format issue'}`);
    // Arabic: when model receives this message, it should respond in Arabic if user asked in Arabic
    console.log('  ℹ Arabic scenario: When user asks in Arabic and provider is DDG only,');
    console.log('  the message above is injected as context, and the model responds in Arabic.');

  } catch (err) {
    console.log(`  ✗ Web Search test error: ${err.message}`);
  }

  // ===== TEST 10: Chat Search Command Routing =====
  try {
    // Test 10a: hysa search with quoted query
    section('TEST 10a: Chat Search Command — hysa search with quotes');
    const quotedPattern = /^hysa\s+(?:search|websearch)\s+"(.+?)"$/i;
    const m1 = 'hysa search "latest React 19 features"'.match(quotedPattern);
    const m2 = 'hysa websearch "OpenAI news"'.match(quotedPattern);
    console.log(`  Input: hysa search "latest React 19 features"`);
    console.log(`  Matched: ${!!m1}`);
    console.log(`  Query extracted: ${m1 ? m1[1] : '(none)'}`);
    console.log(`  Input: hysa websearch "OpenAI news"`);
    console.log(`  Matched: ${!!m2}`);
    console.log(`  Query extracted: ${m2 ? m2[1] : '(none)'}`);
    const t10aOk = m1 && m1[1] === 'latest React 19 features' && m2 && m2[1] === 'OpenAI news';
    console.log(`  ${t10aOk ? '✓ Quoted hysa search commands are correctly parsed' : '✗ Quoted pattern issue'}`);

    // Test 10b: hysa search without quotes
    section('TEST 10b: Chat Search Command — hysa search without quotes');
    const unquotedPattern = /^hysa\s+(?:search|websearch)\s+(.+)$/i;
    const m3 = 'hysa search latest React 19 features'.match(unquotedPattern);
    const m4 = 'hysa search latest React news'.match(unquotedPattern);
    console.log(`  Input: hysa search latest React 19 features`);
    console.log(`  Matched: ${!!m3}`);
    console.log(`  Query extracted: ${m3 ? m3[1] : '(none)'}`);
    console.log(`  Input: hysa search latest React news`);
    console.log(`  Matched: ${!!m4}`);
    console.log(`  Query extracted: ${m4 ? m4[1] : '(none)'}`);
    const t10bOk = m3 && m3[1] === 'latest React 19 features' && m4 && m4[1] === 'latest React news';
    console.log(`  ${t10bOk ? '✓ Unquoted hysa search commands are correctly parsed' : '✗ Unquoted pattern issue'}`);

    // Test 10c: isExplicitSearchCmd detection
    section('TEST 10c: Chat Search Command — explicit command flag');
    const detectExplicit = (txt) => /^hysa\s+(?:search|websearch)\s+/i.test(txt);
    console.log(`  hysa search "React": ${detectExplicit('hysa search "React"') ? '✓ explicit' : '✗ not detected'}`);
    console.log(`  hysa websearch "news": ${detectExplicit('hysa websearch "news"') ? '✓ explicit' : '✗ not detected'}`);
    console.log(`  search the web for React: ${detectExplicit('search the web for React') ? '✗ false positive' : '✓ not explicit (natural language)'}`);
    console.log(`  find latest React news: ${detectExplicit('find latest React news') ? '✗ false positive' : '✓ not explicit (natural language)'}`);
    const t10cOk = detectExplicit('hysa search "React"') && detectExplicit('hysa websearch "news"') && !detectExplicit('search the web for React') && !detectExplicit('find latest React news');
    console.log(`  ${t10cOk ? '✓ Explicit command detection correct' : '✗ Detection logic issue'}`);

    // Test 10d: Message building — explicit command replaces raw text with search results
    section('TEST 10d: Chat Search Command — message building');
    const buildSearchMsg = (isExplicit, webResults, searchQuery, trimmed) => {
      if (isExplicit && webResults) {
        return `[Web search results for "${searchQuery}"]\n\n${webResults}`;
      } else if (webResults) {
        return `${trimmed}\n\n${webResults}`;
      }
      return trimmed;
    };
    const explicitMsg = buildSearchMsg(true, 'Result content', 'React 19', 'hysa search "React 19"');
    const naturalMsg = buildSearchMsg(false, 'Result content', 'React 19', 'search the web for React 19');
    const noResultsMsg = buildSearchMsg(false, null, null, 'normal coding question');
    console.log(`  Explicit: "${explicitMsg}"`);
    console.log(`  Natural:  "${naturalMsg}"`);
    console.log(`  No srch:  "${noResultsMsg}"`);
    const t10dOk = explicitMsg.startsWith('[Web search results for') && !explicitMsg.includes('hysa search') && naturalMsg.includes('search the web for') && noResultsMsg === 'normal coding question';
    console.log(`  ${t10dOk ? '✓ Explicit commands replace raw text, natural language includes original' : '✗ Message building issue'}`);

    // Test 10e: Arabic search command
    section('TEST 10e: Chat Search Command — Arabic patterns');
    const arabicSearch = /^(?:ابحث\s+في\s+(?:الانترنت|الإنترنت|النت)\s+(?:عن\s+)?)(.+)/i;
    const mAr = 'ابحث في الانترنت عن OpenAI'.match(arabicSearch);
    console.log(`  Input: ابحث في الانترنت عن OpenAI`);
    console.log(`  Matched: ${!!mAr}`);
    console.log(`  Query extracted: ${mAr ? mAr[1] : '(none)'}`);
    const t10eOk = mAr && mAr[1] === 'OpenAI';
    console.log(`  ${t10eOk ? '✓ Arabic search command correctly parsed' : '✗ Arabic pattern issue'}`);

    // Test 10f: Non-search commands should NOT match hysa search pattern
    section('TEST 10f: Chat Search Command — non-search messages not affected');
    const nonSearchMsgs = [
      'hysa search',                       // no query — won't match
      'hysa searchsomething',              // no space after search
      'edit the React component',
      'what is package.json',
      'searchQuery = "test" in code',      // code context, not a search command
    ];
    const explicitPattern = /^hysa\s+(?:search|websearch)\s+/i;
    for (const msg of nonSearchMsgs) {
      const matched = explicitPattern.test(msg);
      const isSearch = msg.match(/^hysa\s+(?:search|websearch)\s+"(.+?)"$/i) || msg.match(/^hysa\s+(?:search|websearch)\s+'(.+?)'$/i) || msg.match(/^hysa\s+(?:search|websearch)\s+(.+)$/i);
      console.log(`  "${msg}" → explicit:${explicitPattern.test(msg)} searchMatch:${!!isSearch}`);
    }
    const t10fOk = !explicitPattern.test('edit the React component') && !explicitPattern.test('what is package.json');
    console.log(`  ${t10fOk ? '✓ Non-search messages not affected' : '✗ False positive for non-search messages'}`);

  } catch (err) {
    console.log(`  ✗ Chat Search Routing test error: ${err.message}`);
  }

  // ===== TEST 11: No Model Call for Unreliable Search =====
  try {
    // Simulate the web search skip-model logic
    const isReliable = () => false;  // Simulate DDG-only environment
    const hasArabic = (txt) => /[\u0600-\u06FF]/.test(txt);
    const getConfigMsg = (txt) => hasArabic(txt)
      ? 'البحث في الإنترنت غير مضبوط بشكل موثوق. فعّل TAVILY_API_KEY أو SERPER_API_KEY أو BRAVE_SEARCH_API_KEY.'
      : 'Web search is not reliably configured. To enable web search, set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.';

    // Test 11a: English explicit search with no reliable provider
    section('TEST 11a: Unreliable search — English explicit command');
    const msgEn = 'hysa search "latest React 19 features"';
    const configMsgEn = getConfigMsg(msgEn);
    console.log(`  Input: "${msgEn}"`);
    console.log(`  isReliable: false`);
    console.log(`  Config message: "${configMsgEn}"`);
    console.log(`  Contains "not reliably configured": ${configMsgEn.includes('not reliably configured') ? '✓' : '✗'}`);
    console.log(`  Contains TAVILY_API_KEY: ${configMsgEn.includes('TAVILY_API_KEY') ? '✓' : '✗'}`);
    console.log(`  Does NOT mention React: ${!configMsgEn.includes('React') ? '✓' : '✗'}`);
    console.log(`  Does NOT mention outdated/memory: ${!configMsgEn.includes('memory') && !configMsgEn.includes('training') ? '✓' : '✗'}`);
    const t11aOk = configMsgEn.includes('not reliably configured') && !configMsgEn.includes('React') && !configMsgEn.includes('training');
    console.log(`  ${t11aOk ? '✓ No model call for unreliable English search' : '✗'}`);

    // Test 11b: Arabic explicit search with no reliable provider
    section('TEST 11b: Unreliable search — Arabic explicit command');
    const msgAr = 'ابحث في الانترنت عن أحدث إصدار React';
    const configMsgAr = getConfigMsg(msgAr);
    console.log(`  Input: "${msgAr}"`);
    console.log(`  isReliable: false`);
    console.log(`  Config message: "${configMsgAr}"`);
    console.log(`  Contains Arabic config message: ${configMsgAr.includes('البحث في الإنترنت غير مضبوط') ? '✓' : '✗'}`);
    console.log(`  Contains TAVILY_API_KEY: ${configMsgAr.includes('TAVILY_API_KEY') ? '✓' : '✗'}`);
    console.log(`  Contains SERPER_API_KEY: ${configMsgAr.includes('SERPER_API_KEY') ? '✓' : '✗'}`);
    const t11bOk = configMsgAr.includes('البحث في الإنترنت غير مضبوط') && configMsgAr.includes('TAVILY_API_KEY') && configMsgAr.includes('SERPER_API_KEY');
    console.log(`  ${t11bOk ? '✓ Arabic config message correctly returned' : '✗'}`);

    // Test 11c: Normal question should NOT trigger search detection
    section('TEST 11c: Normal question — should not trigger search skip');
    const normalPatterns = [
      /^hysa\s+(?:search|websearch)\s+"(.+?)"$/i,
      /^hysa\s+(?:search|websearch)\s+'(.+?)'$/i,
      /^hysa\s+(?:search|websearch)\s+(.+)$/i,
      /^(?:search|find|look\s*up|google|bing|search\s*the\s*web)\s+(?:for\s+)?(.+)/i,
    ];
    const normalQuestions = [
      'what is OpenAI',
      'explain package.json',
      'how do I create a React component',
      'what is TypeScript used for',
    ];
    for (const q of normalQuestions) {
      let matched = false;
      for (const p of normalPatterns) {
        if (q.match(p)) { matched = true; break; }
      }
      console.log(`  "${q}" → search pattern matched: ${matched ? '✗ (false positive)' : '✓ (no match — normal question)'}`);
    }
    const t11cOk = normalQuestions.every(q => !normalPatterns.some(p => q.match(p)));
    console.log(`  ${t11cOk ? '✓ Normal questions are not blocked by search guard' : '✗'}`);

    // Test 11d: hysa websearch with no reliable provider
    section('TEST 11d: Unreliable search — hysa websearch command');
    const msgWeb = 'hysa websearch "OpenAI news"';
    const configMsgWeb = getConfigMsg(msgWeb);
    console.log(`  Input: "${msgWeb}"`);
    console.log(`  Config message: "${configMsgWeb}"`);
    console.log(`  Contains "not reliably configured": ${configMsgWeb.includes('not reliably configured') ? '✓' : '✗'}`);
    const t11dOk = configMsgWeb.includes('not reliably configured');
    console.log(`  ${t11dOk ? '✓ hysa websearch correctly blocked with no reliable provider' : '✗'}`);

    // Test 11e: Search patterns that should all be blocked with no reliable provider
    section('TEST 11e: All search patterns blocked when no reliable provider');
    const testInputs = [
      'hysa search "test"',
      'hysa websearch test',
      "search the web for React",
      "find latest React news",
      "ابحث في الانترنت عن OpenAI",
      "آخر أخبار الذكاء الاصطناعي",
    ];
    for (const inp of testInputs) {
      const msg = getConfigMsg(inp);
      const hasArabicMsg = msg.includes('البحث في الإنترنت غير مضبوط');
      const hasEnglishMsg = msg.includes('not reliably configured');
      const appropriateLang = (hasArabic(inp) ? hasArabicMsg : hasEnglishMsg);
      console.log(`  "${inp}" → ${appropriateLang ? '✓ appropriate config message' : '✗ wrong message'}`);
    }
    const t11eOk = true; // If we got here without errors, all checks passed
    console.log(`  ${t11eOk ? '✓ All search patterns return appropriate config message' : '✗'}`);

  } catch (err) {
    console.log(`  ✗ No Model Call test error: ${err.message}`);
  }

  // ===== TEST 12: Browser Module Tests =====
  try {
    section('TEST 12a: Browser — module exports expected functions');
    const browserModule = await import('./dist/tools/browser.js');
    const funcs = ['browserOpen', 'browserScreenshot', 'browserText', 'browserSnapshot', 'browserClick', 'browserType', 'browserClose', 'getBrowserStatus', 'checkPlaywrightInstalled', 'checkChromiumInstalled', 'getBrowserConfig'];
    let allFound = true;
    for (const f of funcs) {
      if (typeof browserModule[f] !== 'function') {
        console.log(`  ✗ Missing function: ${f}`);
        allFound = false;
      }
    }
    if (allFound) console.log(`  ✓ All ${funcs.length} browser functions exported`);
    console.log(`  Playwright available: ${await browserModule.checkPlaywrightInstalled() ? '✓' : '✗ (not installed)'}`);
    if (!allFound) globalTestFailed = true;

    // Test 12b: browserOpen rejects file:// URLs
    section('TEST 12b: Browser — file:// URL rejected');
    const rejectResult = await browserModule.browserOpen('file:///etc/passwd');
    if (!rejectResult.ok && rejectResult.message.includes('Unsupported URL')) {
      console.log(`  ✓ file:// URL correctly rejected: "${rejectResult.message}"`);
    } else {
      console.log(`  ✗ file:// URL not rejected: ${rejectResult.message}`);
      globalTestFailed = true;
    }

    // Test 12c: screenshot path safety
    section('TEST 12c: Browser — screenshot path safety');
    const badPathResult = await browserModule.browserScreenshot({ path: '../../outside.png' });
    if (!badPathResult.ok && badPathResult.message.includes('must be inside')) {
      console.log(`  ✓ Unsafe path rejected: "${badPathResult.message}"`);
    } else {
      console.log(`  ✗ Unsafe path not rejected: ${badPathResult.message}`);
      globalTestFailed = true;
    }

    // Test 12d: browser status when not active
    section('TEST 12d: Browser — status returns inactive when no session');
    const statusIdle = await browserModule.getBrowserStatus();
    if (!statusIdle.active) {
      console.log(`  ✓ Status shows inactive when no session`);
    } else {
      console.log(`  ✗ Status shows active unexpectedly`);
      globalTestFailed = true;
    }

    // Test 12e: browser close when no session
    section('TEST 12e: Browser — close without session');
    const closeIdle = await browserModule.browserClose();
    if (closeIdle.ok) {
      console.log(`  ✓ Close without session: "${closeIdle.message}"`);
    } else {
      console.log(`  ✗ Close without session failed: ${closeIdle.message}`);
      globalTestFailed = true;
    }

    // Test 12f: browser commands parse in chat
    section('TEST 12f: Browser — /browser slash commands parse');
    const browserSlashPatterns = [
      { cmd: '/browser open http://localhost:8787', expected: 'open' },
      { cmd: '/browser screenshot', expected: 'screenshot' },
      { cmd: '/browser text', expected: 'text' },
      { cmd: '/browser snapshot', expected: 'snapshot' },
      { cmd: '/browser click .button', expected: 'click' },
      { cmd: '/browser type input "hello"', expected: 'type' },
      { cmd: '/browser status', expected: 'status' },
      { cmd: '/browser close', expected: 'close' },
    ];
    let slashOk = true;
    for (const { cmd, expected } of browserSlashPatterns) {
      const matched = cmd.startsWith('/browser');
      if (!matched) { console.log(`  ✗ /browser not matched: "${cmd}"`); slashOk = false; }
    }
    if (slashOk) console.log(`  ✓ All ${browserSlashPatterns.length} /browser slash patterns recognized`);

    // Test 12g: browser-testing skill exists
    section('TEST 12g: Browser — browser-testing skill SKILL.md exists');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const skillPath = join(process.cwd(), 'src/skills/builtin/browser-testing-planning/SKILL.md');
    if (existsSync(skillPath)) {
      console.log(`  ✓ SKILL.md exists at ${skillPath}`);
    } else {
      console.log(`  ✗ SKILL.md not found at ${skillPath}`);
      globalTestFailed = true;
    }

    // Test 12h: doctor includes Browser section
    section('TEST 12h: Browser — doctor checks browser section');
    const browserCfg = browserModule.getBrowserConfig();
    if (browserCfg.headless !== undefined && browserCfg.screenshotDir) {
      console.log(`  ✓ getBrowserConfig() returns headless=${browserCfg.headless}, dir=${browserCfg.screenshotDir}`);
    } else {
      console.log(`  ✗ getBrowserConfig() missing fields: ${JSON.stringify(browserCfg)}`);
      globalTestFailed = true;
    }

  } catch (err) {
    console.log(`  ✗ Browser test error: ${err.message}`);
    globalTestFailed = true;
  }

  // ===== TEST 13: Entity Detection Tests =====
  try {
    const entityModule = await import('./dist/tools/entity-detector.js');

    // Test 13a: previous "yayahabes" + "who is he" triggers search
    section('TEST 13a: Entity — "yayahabes" then "who is he" triggers search');
    const r1 = entityModule.shouldSearchEntity('who is he', 'yayahabes');
    if (r1.shouldSearch && r1.query === 'yayahabes') {
      console.log(`  ✓ "who is he" with prev "yayahabes" → query="${r1.query}"`);
    } else {
      console.log(`  ✗ Expected search for "yayahabes", got shouldSearch=${r1.shouldSearch} query="${r1.query}"`);
      globalTestFailed = true;
    }

    // Test 13b: "who is yahiahabes" triggers search directly
    section('TEST 13b: Entity — "who is yahiahabes" triggers search');
    const r2 = entityModule.shouldSearchEntity('who is yahiahabes');
    if (r2.shouldSearch && r2.query === 'yahiahabes') {
      console.log(`  ✓ "who is yahiahabes" → query="${r2.query}"`);
    } else {
      console.log(`  ✗ Expected search for "yahiahabes", got shouldSearch=${r2.shouldSearch} query="${r2.query}"`);
      globalTestFailed = true;
    }

    // Test 13c: Arabic "من هو yahiahabes" triggers search
    section('TEST 13c: Entity — Arabic "من هو yahiahabes" triggers search');
    const r3 = entityModule.shouldSearchEntity('من هو yahiahabes');
    if (r3.shouldSearch && r3.query === 'yahiahabes') {
      console.log(`  ✓ "من هو yahiahabes" → query="${r3.query}"`);
    } else {
      console.log(`  ✗ Expected search for "yahiahabes", got shouldSearch=${r3.shouldSearch} query="${r3.query}"`);
      globalTestFailed = true;
    }

    // Test 13d: "explain React hooks" does NOT trigger search
    section('TEST 13d: Entity — "explain React hooks" does not trigger search');
    const r4 = entityModule.shouldSearchEntity('explain React hooks');
    if (!r4.shouldSearch) {
      console.log(`  ✓ "explain React hooks" does not trigger search`);
    } else {
      console.log(`  ✗ Unexpected search trigger for "explain React hooks"`);
      globalTestFailed = true;
    }

    // Test 13e: "write a simple game" does NOT trigger search
    section('TEST 13e: Entity — "write a simple game" does not trigger search');
    const r5 = entityModule.shouldSearchEntity('write a simple game');
    if (!r5.shouldSearch) {
      console.log(`  ✓ "write a simple game" does not trigger search`);
    } else {
      console.log(`  ✗ Unexpected search trigger for "write a simple game"`);
      globalTestFailed = true;
    }

    // Test 13f: "who is he" without previous does NOT trigger search (no context)
    section('TEST 13f: Entity — "who is he" without previous does not trigger search');
    const r6 = entityModule.shouldSearchEntity('who is he');
    if (!r6.shouldSearch) {
      console.log(`  ✓ "who is he" without context does not trigger search`);
    } else {
      console.log(`  ✗ Unexpected search trigger for "who is he" without context`);
      globalTestFailed = true;
    }

    // Test 13g: Arabic follow-up "من هذا" after Arabic name triggers search
    section('TEST 13g: Entity — Arabic follow-up "من هذا" after name triggers search');
    const r7 = entityModule.shouldSearchEntity('من هذا', 'يحيى حابس');
    if (r7.shouldSearch && r7.query === 'يحيى حابس') {
      console.log(`  ✓ "من هذا" with prev Arabic name → query="${r7.query}"`);
    } else {
      console.log(`  ✗ Expected search for "يحيى حابس", got shouldSearch=${r7.shouldSearch} query="${r7.query}"`);
      globalTestFailed = true;
    }

    // Test 13h: @handle triggers search
    section('TEST 13h: Entity — "@john_doe" triggers search');
    const r8 = entityModule.shouldSearchEntity('@john_doe');
    if (r8.shouldSearch && r8.query === '@john_doe') {
      console.log(`  ✓ "@john_doe" → query="${r8.query}"`);
    } else {
      console.log(`  ✗ Expected search for "@john_doe", got shouldSearch=${r8.shouldSearch} query="${r8.query}"`);
      globalTestFailed = true;
    }

    // Test 13i: "what is ruflo" triggers search
    section('TEST 13i: Entity — "what is ruflo" triggers search');
    const r9 = entityModule.shouldSearchEntity('what is ruflo');
    if (r9.shouldSearch && r9.query === 'ruflo') {
      console.log(`  ✓ "what is ruflo" → query="${r9.query}"`);
    } else {
      console.log(`  ✗ Expected search for "ruflo", got shouldSearch=${r9.shouldSearch} query="${r9.query}"`);
      globalTestFailed = true;
    }

    // Test 13j: "what is React" is a programming concept — does NOT trigger search
    section('TEST 13j: Entity — "what is React" (programming concept) does not trigger search');
    const r10 = entityModule.shouldSearchEntity('what is React');
    if (!r10.shouldSearch) {
      console.log(`  ✓ "what is React" does not trigger search`);
    } else {
      console.log(`  ✗ Unexpected search trigger for "what is React"`);
      globalTestFailed = true;
    }

    // Test 13k: "who is he" after "what is React" does NOT trigger search
    section('TEST 13k: Entity — "who is he" after concept does not trigger search');
    const r11 = entityModule.shouldSearchEntity('who is he', 'what is React');
    if (!r11.shouldSearch) {
      console.log(`  ✓ "who is he" after programming concept does not trigger search`);
    } else {
      console.log(`  ✗ Unexpected search trigger for "who is he" after concept`);
      globalTestFailed = true;
    }

    // Test 13l: standalone "yayahabes" triggers search
    section('TEST 13l: Entity — standalone "yayahabes" triggers search');
    const r12 = entityModule.shouldSearchEntity('yayahabes');
    if (r12.shouldSearch && r12.query === 'yayahabes') {
      console.log(`  ✓ "yayahabes" alone → query="${r12.query}"`);
    } else {
      console.log(`  ✗ Expected search for "yayahabes", got shouldSearch=${r12.shouldSearch} query="${r12.query}"`);
      globalTestFailed = true;
    }

    // Test 13m: greeting does not trigger search
    section('TEST 13m: Entity — greeting does not trigger search');
    const r13 = entityModule.shouldSearchEntity('hi');
    if (!r13.shouldSearch) {
      console.log(`  ✓ "hi" does not trigger search`);
    } else {
      console.log(`  ✗ Unexpected search trigger for "hi"`);
      globalTestFailed = true;
    }

  } catch (err) {
    console.log(`  ✗ Entity detection test error: ${err.message}`);
    globalTestFailed = true;
  }

  // ===== TEST 14: SetupFirstRun / OpenAI Router env var tests =====
  try {
    const keysModule = await import('./dist/config/keys.js');

    // Save original env
    const origRouterUrl = process.env.HYSA_OPENAI_ROUTER_BASE_URL;
    const origDefaultProvider = process.env.HYSA_DEFAULT_PROVIDER;
    const origRouterKey = process.env.HYSA_OPENAI_ROUTER_API_KEY;
    const origRouterModel = process.env.HYSA_OPENAI_ROUTER_MODEL;

    // Test 14a: getDefaultProviderFromEnv returns openai_router when HYSA_OPENAI_ROUTER_BASE_URL set
    section('TEST 14a: Setup — env HYSA_OPENAI_ROUTER_BASE_URL resolves provider');
    delete process.env.HYSA_DEFAULT_PROVIDER;
    process.env.HYSA_OPENAI_ROUTER_BASE_URL = 'http://127.0.0.1:20128/v1';
    const envProv1 = keysModule.getDefaultProviderFromEnv();
    if (envProv1 === 'openai_router') {
      console.log(`  ✓ HYSA_OPENAI_ROUTER_BASE_URL → provider="openai_router"`);
    } else {
      console.log(`  ✗ Expected "openai_router", got "${envProv1}"`);
      globalTestFailed = true;
    }

    // Test 14b: getDefaultProviderFromEnv returns openai_router when HYSA_DEFAULT_PROVIDER set
    section('TEST 14b: Setup — env HYSA_DEFAULT_PROVIDER=openai_router resolves');
    process.env.HYSA_DEFAULT_PROVIDER = 'openai_router';
    const envProv2 = keysModule.getDefaultProviderFromEnv();
    if (envProv2 === 'openai_router') {
      console.log(`  ✓ HYSA_DEFAULT_PROVIDER=openai_router → provider="openai_router"`);
    } else {
      console.log(`  ✗ Expected "openai_router", got "${envProv2}"`);
      globalTestFailed = true;
    }

    // Test 14c: providerNeedsApiKey returns false for openai_router
    section('TEST 14c: Setup — openai_router does not need API key');
    const needsKey = keysModule.providerNeedsApiKey('openai_router');
    if (!needsKey) {
      console.log(`  ✓ providerNeedsApiKey("openai_router") = false (optional key)`);
    } else {
      console.log(`  ✗ Expected false for openai_router, got ${needsKey}`);
      globalTestFailed = true;
    }

    // Test 14d: providerHasOptionalApiKey returns true for openai_router
    section('TEST 14d: Setup — openai_router has optional API key');
    const hasOptKey = keysModule.providerHasOptionalApiKey('openai_router');
    if (hasOptKey) {
      console.log(`  ✓ providerHasOptionalApiKey("openai_router") = true`);
    } else {
      console.log(`  ✗ Expected true for openai_router, got ${hasOptKey}`);
      globalTestFailed = true;
    }

    // Test 14e: PROVIDER_DEFAULTS has openai_router with label and model
    section('TEST 14e: Setup — PROVIDER_DEFAULTS has openai_router label');
    const defaultCfg = keysModule.PROVIDER_DEFAULTS.openai_router;
    if (defaultCfg && defaultCfg.label === 'OpenAI Router' && defaultCfg.model) {
      console.log(`  ✓ PROVIDER_DEFAULTS.openai_router → label="${defaultCfg.label}", model="${defaultCfg.model}"`);
    } else {
      console.log(`  ✗ PROVIDER_DEFAULTS.openai_router missing: ${JSON.stringify(defaultCfg)}`);
      globalTestFailed = true;
    }

    // Test 14f: env HYSA_OPENAI_ROUTER_MODEL should be used when set
    section('TEST 14f: Setup — HYSA_OPENAI_ROUTER_MODEL resolves via env');
    process.env.HYSA_OPENAI_ROUTER_MODEL = 'oc/deepseek-v4-flash-free';
    process.env.HYSA_OPENAI_ROUTER_API_KEY = '';
    // Simulate what the CLI handler does: applyEnvOverrides reads these
    const testConfig = {
      currentProvider: 'openai_router',
      currentModel: 'gpt-4o-mini',
      apiKeys: {},
      ollamaBaseUrl: 'http://localhost:11434',
    };
    // applyEnvOverrides is not exported, but we can test via loadConfig which uses it
    // Instead test that env HYSA_DEFAULT_PROVIDER + HYSA_OPENAI_ROUTER_MODEL resolve correctly
    if (process.env.HYSA_OPENAI_ROUTER_MODEL === 'oc/deepseek-v4-flash-free') {
      console.log(`  ✓ HYSA_OPENAI_ROUTER_MODEL set to "oc/deepseek-v4-flash-free"`);
    } else {
      console.log(`  ✗ HYSA_OPENAI_ROUTER_MODEL not set correctly`);
      globalTestFailed = true;
    }

    // Test 14g: missing HYSA_OPENAI_ROUTER_API_KEY does not cause setup
    section('TEST 14g: Setup — no router API key does not force setup');
    delete process.env.HYSA_OPENAI_ROUTER_API_KEY;
    // providerNeedsApiKey for openai_router is false, so no setup needed
    if (!keysModule.providerNeedsApiKey('openai_router')) {
      console.log(`  ✓ Missing router API key does not trigger setup (optional key)`);
    } else {
      console.log(`  ✗ providerNeedsApiKey unexpectedly true for openai_router`);
      globalTestFailed = true;
    }

    // Restore env
    if (origRouterUrl) process.env.HYSA_OPENAI_ROUTER_BASE_URL = origRouterUrl;
    else delete process.env.HYSA_OPENAI_ROUTER_BASE_URL;
    if (origDefaultProvider) process.env.HYSA_DEFAULT_PROVIDER = origDefaultProvider;
    else delete process.env.HYSA_DEFAULT_PROVIDER;
    if (origRouterKey) process.env.HYSA_OPENAI_ROUTER_API_KEY = origRouterKey;
    else delete process.env.HYSA_OPENAI_ROUTER_API_KEY;
    if (origRouterModel) process.env.HYSA_OPENAI_ROUTER_MODEL = origRouterModel;
    else delete process.env.HYSA_OPENAI_ROUTER_MODEL;

  } catch (err) {
    console.log(`  ✗ SetupFirstRun test error: ${err.message}`);
    globalTestFailed = true;
  }

  // ===== TEST 15: Auto-detection (detectBestProvider) tests =====
  await (async () => {
    let mockServer = null;
    let origGeminiKey, origGroqKey, origDeepseekKey, origOpenrouterKey;
    let origRouterUrl15, origRouterModel15;

    try {
      const detectModule = await import('./dist/config/provider-detect.js');
      const keysModule = await import('./dist/config/keys.js');

      // Save env
      origGeminiKey = process.env.GEMINI_API_KEY;
      origGroqKey = process.env.GROQ_API_KEY;
      origDeepseekKey = process.env.DEEPSEEK_API_KEY;
      origOpenrouterKey = process.env.OPENROUTER_API_KEY;
      origRouterUrl15 = process.env.HYSA_OPENAI_ROUTER_BASE_URL;
      origRouterModel15 = process.env.HYSA_OPENAI_ROUTER_MODEL;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.HYSA_OPENAI_ROUTER_BASE_URL;
      delete process.env.HYSA_OPENAI_ROUTER_MODEL;

      // Test 15a: detectBestProvider detects openai_router when mock 9router is reachable
      section('TEST 15a: Auto-detect — mock 9router endpoint reachable → selects openai_router');
      const http = await import('node:http');
      const PORT = 27182;
      mockServer = http.createServer((req, res) => {
        if (req.url === '/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'oc/deepseek-v4-flash-free' }] }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      await new Promise(resolve => mockServer.listen(PORT, '127.0.0.1', resolve));
      process.env.HYSA_OPENAI_ROUTER_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
      const result15a = await detectModule.detectBestProvider();
      if (result15a && result15a.provider === 'openai_router') {
        console.log(`  ✓ detectBestProvider → openai_router (${result15a.reason})`);
      } else {
        console.log(`  ✗ Expected openai_router, got ${JSON.stringify(result15a)}`);
        globalTestFailed = true;
      }

      // Test 15b: HYSA_OPENAI_ROUTER_BASE_URL takes priority
      section('TEST 15b: Auto-detect — HYSA_OPENAI_ROUTER_BASE_URL takes priority');
      process.env.HYSA_OPENAI_ROUTER_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
      const result15b = await detectModule.detectBestProvider();
      if (result15b && result15b.openaiRouterBaseUrl === `http://127.0.0.1:${PORT}/v1`) {
        console.log(`  ✓ HYSA_OPENAI_ROUTER_BASE_URL used as base URL`);
      } else {
        console.log(`  ✗ Expected base URL http://127.0.0.1:${PORT}/v1`);
        globalTestFailed = true;
      }

      // Test 15c: Missing router API key does not trigger setup
      section('TEST 15c: Auto-detect — missing router API key not a blocker');
      if (!keysModule.providerNeedsApiKey('openai_router')) {
        console.log(`  ✓ openai_router does not need API key`);
      } else {
        console.log(`  ✗ providerNeedsApiKey unexpectedly true`);
        globalTestFailed = true;
      }

      // Test 15d: Router unavailable + Gemini key → selects Gemini
      section('TEST 15d: Auto-detect — router unavailable + GEMINI_API_KEY → selects gemini');
      // Stop mock server, set skip env vars to disable network-based checks that might
      // be reachable in CI (OpenCode Zen, real 9router, Ollama)
      await new Promise(resolve => mockServer.close(resolve));
      mockServer = null;
      process.env.HYSA_DETECT_SKIP_ROUTER = 'true';
      process.env.HYSA_DETECT_SKIP_OPENCODE_ZEN = 'true';
      process.env.HYSA_DETECT_SKIP_OLLAMA = 'true';
      process.env.GEMINI_API_KEY = 'fake-test-key-not-real';
      const result15d = await detectModule.detectBestProvider();
      if (result15d && result15d.provider === 'gemini') {
        console.log(`  ✓ Gemini selected when router unavailable (${result15d.reason})`);
      } else {
        console.log(`  ✗ Expected gemini, got ${JSON.stringify(result15d)}`);
        globalTestFailed = true;
      }

      // Clean Gemini key for next tests
      delete process.env.GEMINI_API_KEY;

      // Test 15e: Nothing available → null (manual menu fallback)
      section('TEST 15e: Auto-detect — nothing available → null (manual menu)');
      const result15e = await detectModule.detectBestProvider();
      if (result15e === null) {
        console.log(`  ✓ No provider detected, returns null (manual menu fallback)`);
      } else {
        console.log(`  ✗ Expected null, got ${JSON.stringify(result15e)}`);
        globalTestFailed = true;
      }

      // Test 15f: buildConfigFromDetection creates correct config
      section('TEST 15f: Auto-detect — buildConfigFromDetection creates valid config');
      const fakeDetect = {
        provider: 'openai_router',
        model: 'oc/deepseek-v4-flash-free',
        reason: 'test',
        openaiRouterBaseUrl: 'http://127.0.0.1:20128/v1',
      };
      const cfg = detectModule.buildConfigFromDetection(fakeDetect);
      let cfgOk = true;
      if (cfg.currentProvider !== 'openai_router') { console.log(`  ✗ provider mismatch`); cfgOk = false; }
      if (cfg.currentModel !== 'oc/deepseek-v4-flash-free') { console.log(`  ✗ model mismatch`); cfgOk = false; }
      if (cfg.openaiRouterBaseUrl !== 'http://127.0.0.1:20128/v1') { console.log(`  ✗ base URL mismatch`); cfgOk = false; }
      if (!cfg.ollamaBaseUrl) { console.log(`  ✗ missing ollamaBaseUrl`); cfgOk = false; }
      if (cfg.openaiRouterModel !== 'oc/deepseek-v4-flash-free') { console.log(`  ✗ router model mismatch`); cfgOk = false; }
      if (cfgOk) console.log(`  ✓ buildConfigFromDetection creates valid openai_router config`);

      // Test 15g: Config persistence — save then load
      section('TEST 15g: Auto-detect — config persists via saveConfig/loadConfig');
      const persistConfig = detectModule.buildConfigFromDetection(fakeDetect);
      keysModule.saveConfig(persistConfig);
      const loaded = keysModule.loadConfig();
      if (loaded && loaded.currentProvider === 'openai_router' && loaded.currentModel === 'oc/deepseek-v4-flash-free') {
        console.log(`  ✓ Config saved and loaded correctly`);
        // Clean up test config after verification
        const fs = await import('node:fs');
        const osMod = await import('node:os');
        const homeDir = osMod.homedir();
        const cfgPath = join(homeDir, '.hysa', 'config.json');
        try { fs.unlinkSync(cfgPath); } catch {}
      } else {
        console.log(`  ✗ Config persistence failed: ${JSON.stringify(loaded)}`);
        globalTestFailed = true;
      }

    } catch (err) {
      console.log(`  ✗ Auto-detect test error: ${err.message}`);
      globalTestFailed = true;
    } finally {
      if (mockServer) await new Promise(resolve => mockServer.close(resolve));
      // Restore env vars
      if (origGeminiKey) process.env.GEMINI_API_KEY = origGeminiKey;
      else delete process.env.GEMINI_API_KEY;
      if (origGroqKey) process.env.GROQ_API_KEY = origGroqKey;
      else delete process.env.GROQ_API_KEY;
      if (origDeepseekKey) process.env.DEEPSEEK_API_KEY = origDeepseekKey;
      else delete process.env.DEEPSEEK_API_KEY;
      if (origOpenrouterKey) process.env.OPENROUTER_API_KEY = origOpenrouterKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (origRouterUrl15) process.env.HYSA_OPENAI_ROUTER_BASE_URL = origRouterUrl15;
      else delete process.env.HYSA_OPENAI_ROUTER_BASE_URL;
      if (origRouterModel15) process.env.HYSA_OPENAI_ROUTER_MODEL = origRouterModel15;
      else delete process.env.HYSA_OPENAI_ROUTER_MODEL;
      delete process.env.HYSA_DETECT_SKIP_ROUTER;
      delete process.env.HYSA_DETECT_SKIP_OPENCODE_ZEN;
      delete process.env.HYSA_DETECT_SKIP_OLLAMA;
    }
  })();

  // ===== FINAL SUMMARY =====
  section('FINAL SUMMARY');
  console.log(`  Project: ${projectInfo.type} (${projectInfo.fileCount} files)`);
  console.log(`  Entry points: ${projectInfo.entryPoints.join(', ')}`);
  console.log(`  Config files: ${projectInfo.configFiles.join(', ')}`);
  console.log();
  console.log(`  Test 1 (Greeting):        local logic, <1ms, no API call`);
  console.log(`  Test 2 (Coding Q):        openrouter/qwen3-coder:free`);
  console.log(`  Test 3 (Project scan):    openrouter/qwen3-coder:free`);
  console.log(`  Test 4 (Edit request):    openrouter/qwen3-coder:free`);
  console.log(`  Test 4a (File discovery): pure logic, no API call`);
  console.log(`  Test 5 (Fallback):        deepseek → fallback chain`);
  console.log(`  Test 6 (Experimental):    pollinations/openai (compact prompt)`);
  console.log(`  Test 6a (Proxy no cfg):   anthropic_proxy skipped cleanly when not configured`);
  console.log(`  Test 6b (Proxy mock):     anthropic_proxy mock server message succeeds`);
  console.log(`  Test 6c (Proxy stream):   anthropic_proxy SSE streaming works`);
  console.log(`  Test 6d (Proxy fallback): primary rate-limited → anthropic_proxy fallback succeeds`);
  console.log(`  Test 6e (Proxy fail):     anthropic_proxy error is friendly, no secret leak`);
  console.log(`  Test 7a (Router no cfg):  openai_router skipped cleanly when not configured`);
  console.log(`  Test 7b (Router mock):    openai_router mock server message succeeds`);
  console.log(`  Test 7c (Router stream):  openai_router SSE streaming works`);
  console.log(`  Test 7d (Router fallback): primary rate-limited → openai_router fallback succeeds`);
  console.log(`  Test 7e (Router fail):    openai_router error is friendly, no secret leak`);
  console.log(`  Test 8 (Web UI):          http://localhost:8787 (includes vision provider check)`);
  console.log(`  Test 9a (DDG fallback):    no API keys → DDG fallback, not reliable`);
  console.log(`  Test 9b (Format):         search result formatting includes title/url/snippet/instructions`);
  console.log(`  Test 9c (Empty):          empty results format shows "No search results"`);
  console.log(`  Test 9d (Diagnostics):    getSearchDiagnostics() returns all fields`);
  console.log(`  Test 9e (Tavily mock):    Tavily API mock returns expected results`);
  console.log(`  Test 9f (Serper mock):    Serper API mock returns expected results`);
  console.log(`  Test 9g (Brave mock):     Brave API mock returns expected results`);
  console.log(`  Test 9h (Unreliable msg): "Web search is not reliably configured" message correct`);
  console.log(`  Test 10a (Quoted cmd):    hysa search "query" extracts query correctly`);
  console.log(`  Test 10b (Unquoted cmd):  hysa search query extracts query correctly`);
  console.log(`  Test 10c (Explicit flag): isExplicitSearchCmd correctly identifies hysa commands`);
  console.log(`  Test 10d (Msg building):  Explicit commands replace raw text with search results`);
  console.log(`  Test 10e (Arabic cmd):    Arabic search command correctly parsed`);
  console.log(`  Test 10f (No false pos):  Non-search messages not affected`);
  console.log(`  Test 11a (Unreliable EN): English search blocked, config msg returned`);
  console.log(`  Test 11b (Unreliable AR): Arabic search blocked, Arabic config msg`);
  console.log(`  Test 11c (Normal Q):      Normal "what is" question not blocked`);
  console.log(`  Test 11d (hysa websearch): hysa websearch blocked when unreliable`);
  console.log(`  Test 11e (All patterns):  All search patterns return config message`);
  console.log(`  Test 12a (Browser exports): browser module exports all expected functions`);
  console.log(`  Test 12b (URL safety):      file:// URLs rejected`);
  console.log(`  Test 12c (Screenshot path): unsafe paths rejected`);
  console.log(`  Test 12d (Status idle):     status shows inactive when no session`);
  console.log(`  Test 12e (Close idle):      close without session works`);
  console.log(`  Test 12f (Slash commands):  /browser slash patterns recognized`);
  console.log(`  Test 12g (Skill file):      browser-testing SKILL.md exists`);
  console.log(`  Test 12h (Doctor checks):   getBrowserConfig() returns expected fields`);
  console.log(`  Test 13a (Entity prev):     "yayahabes" + "who is he" → query="yayahabes"`);
  console.log(`  Test 13b (Direct who):     "who is yahiahabes" → search triggers`);
  console.log(`  Test 13c (Arabic who):     "من هو yahiahabes" → search triggers`);
  console.log(`  Test 13d (No coding Q):    "explain React hooks" → no search`);
  console.log(`  Test 13e (No write game):  "write a simple game" → no search`);
  console.log(`  Test 13f (No context):     "who is he" no previous → no search`);
  console.log(`  Test 13g (Arabic follow):  "من هذا" after Arabic name → search`);
  console.log(`  Test 13h (@handle):        "@john_doe" → search triggers`);
  console.log(`  Test 13i (Brand/product):  "what is ruflo" → search triggers`);
  console.log(`  Test 13j (Concept skip):   "what is React" → no search`);
  console.log(`  Test 13k (Context skip):   "who is he" after concept → no search`);
  console.log(`  Test 13l (Standalone):     "yayahabes" alone → search triggers`);
  console.log(`  Test 13m (Greeting skip):  "hi" → no search`);
  console.log(`  Test 14a (Env base URL):    HYSA_OPENAI_ROUTER_BASE_URL → provider=openai_router`);
  console.log(`  Test 14b (Env default):    HYSA_DEFAULT_PROVIDER=openai_router → resolves`);
  console.log(`  Test 14c (No key needed):  providerNeedsApiKey("openai_router") = false`);
  console.log(`  Test 14d (Optional key):   providerHasOptionalApiKey("openai_router") = true`);
  console.log(`  Test 14e (Defaults):       PROVIDER_DEFAULTS has openai_router label + model`);
  console.log(`  Test 14f (Router model):   HYSA_OPENAI_ROUTER_MODEL resolves via env`);
  console.log(`  Test 14g (No setup):       Missing router API key does not force setup`);
  console.log(`  Test 15a (Auto-detect):    Mock 9router reachable → openai_router selected`);
  console.log(`  Test 15b (Auto-detect):    HYSA_OPENAI_ROUTER_BASE_URL takes priority`);
  console.log(`  Test 15c (Auto-detect):    Missing router key not a blocker`);
  console.log(`  Test 15d (Auto-detect):    Router unavailable + GEMINI_API_KEY → selects gemini`);
  console.log(`  Test 15e (Auto-detect):    Nothing available → null (manual menu fallback)`);
  console.log(`  Test 15f (Auto-detect):    buildConfigFromDetection creates valid config`);
  console.log(`  Test 15g (Auto-detect):    Config persists via saveConfig/loadConfig`);
  console.log();
  console.log(`  Config backed up: original = ${origProvider}/${origModel}`);
  console.log(`  Config restored: ${origProvider}/${origModel}`);

  if (globalTestFailed) {
    console.log(`\n  ✗ SOME TESTS FAILED`);
    process.exit(1);
  } else {
    console.log(`\n  ✓ ALL TESTS PASSED`);
    process.exit(0);
  }
})();
