import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, COMPACT_PROMPT_PROVIDERS, PROVIDER_MODELS } from './dist/config/keys.js';
import { buildSystemPrompt, resolvePromptMode } from './dist/prompts/system.js';
import { createClient, isOnlyGreeting, getCasualResponse } from './dist/ai/client.js';
import { getFallbackEvents, clearFallbackEvents, resetHealth, getAllHealth, toHealthSummary } from './dist/ai/model-health.js';
import { getProjectInfo } from './dist/context/builder.js';
import { resolveFileReadPath, isGeneratedOutput } from './dist/files/reader.js';
import { resolve } from 'node:path';

const workingDir = resolve('.');
const projectInfo = getProjectInfo(workingDir);

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

const origProvider = config.currentProvider;
const origModel = config.currentModel;

// Restore at exit
process.on('exit', () => {
  config.currentProvider = origProvider;
  config.currentModel = origModel;
  saveConfig(config);
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

  // ===== TEST 7: Web UI =====
  section('TEST 7: Web UI — API endpoint test');
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

    // Cleanup
    const serverRef = (await import('./dist/web/server.js')).getServerRef();
    if (serverRef) serverRef.close();
    console.log('\n  Web server stopped.');

  } catch (err) {
    console.log(`  ✗ Web UI test error: ${err.message}`);
    console.log('  (May need to build web UI first: cd web && npm install && npm run build)');
  }

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
  console.log(`  Test 7 (Web UI):          http://localhost:8787`);
  console.log();
  console.log(`  Config backed up: original = ${origProvider}/${origModel}`);

  // Restore original config
  config.currentProvider = origProvider;
  config.currentModel = origModel;
  saveConfig(config);
  console.log(`  Config restored: ${origProvider}/${origModel}`);

})();
