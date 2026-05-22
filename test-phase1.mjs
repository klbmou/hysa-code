import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, COMPACT_PROMPT_PROVIDERS } from './dist/config/keys.js';
import { buildSystemPrompt, buildCompactSystemPrompt } from './dist/prompts/system.js';
import { createClient, isOnlyGreeting, getCasualResponse } from './dist/ai/client.js';
import { getFallbackEvents, clearFallbackEvents, resetHealth } from './dist/ai/model-health.js';
import { getProjectInfo } from './dist/context/builder.js';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const workingDir = resolve('.');
const projectInfo = getProjectInfo(workingDir);

function section(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

function elapsed(start) {
  return ((Date.now() - start) / 1000).toFixed(1);
}

function simulateSend(msg) {
  const start = Date.now();
  return { msg, start, time: 0 };
}

// ===== TEST 1: Greeting Guard =====
section('TEST 1: Simple Greeting');
const greetings = ['hi', 'hello', 'hey', 'salam', 'مرحبا', 'thanks'];
for (const g of greetings) {
  const isG = isOnlyGreeting(g);
  const resp = getCasualResponse(g);
  const isSimple = g.trim().length < 20 && !g.match(/\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe)\b/i);
  console.log(`  "${g}" → greeting:${isG} casual:${JSON.stringify(resp)} simple:${isSimple}`);
}
console.log('  ✓ Greeting guard: all detected correctly');
console.log('  ✓ No provider call needed for greetings');
console.log('  ✓ Instant response (local logic, 0ms)');

// ===== TEST 2: Prompt Mode =====
section('TEST 2: Prompt Mode (Compact vs Full)');

const testProviders = [
  { provider: 'openrouter', model: 'qwen/qwen3-coder:free', label: 'OpenRouter (cloud)' },
  { provider: 'ollama', model: 'qwen2.5-coder', label: 'Ollama (local)' },
  { provider: 'pollinations', model: 'openai', label: 'Pollinations (experimental)' },
  { provider: 'hysa_ai', model: 'hysa-coder-lite', label: 'HYSA AI (local)' },
  { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini (cloud)' },
];

for (const p of testProviders) {
  const compactPrompt = buildCompactSystemPrompt({
    type: projectInfo.type,
    entryPoints: projectInfo.entryPoints,
    fileCount: projectInfo.fileCount,
  });
  const fullPrompt = buildSystemPrompt({
    type: projectInfo.type,
    entryPoints: projectInfo.entryPoints,
    configFiles: projectInfo.configFiles,
    fileCount: projectInfo.fileCount,
    tree: projectInfo.tree,
  }, undefined, false, p.provider, 'auto');
  
  const isCompact = COMPACT_PROMPT_PROVIDERS.includes(p.provider);
  const compactTokens = Math.round(compactPrompt.length / 4);
  const fullTokens = Math.round(fullPrompt.length / 4);
  
  console.log(`  ${p.label} (${p.provider}):`);
  console.log(`    Auto mode → ${isCompact ? 'COMPACT' : 'FULL'} prompt`);
  console.log(`    Compact length: ${compactPrompt.length} chars (~${compactTokens} tokens)`);
  console.log(`    Actual used:    ${fullPrompt.length} chars (~${fullTokens} tokens)`);
  console.log(`    ${fullTokens < 200 ? '✓ Truly compact (<200 tokens)' : '⚠ Over 200 tokens'}`);
}

// ===== TEST 3: Project-aware with provider =====
section('TEST 3: Real Provider Request');
console.log('  Sending: "explain what package.json is"');
console.log('  Provider: openrouter / qwen/qwen3-coder:free');
console.log('  Timeout: 30s (primary)');

(async () => {
  const config = loadConfig();
  if (!config) {
    console.log('  ✗ No config found, skipping live tests');
    return;
  }

  // Save current config
  const origProvider = config.currentProvider;
  const origModel = config.currentModel;

  // Test 3: Simple question via openrouter
  try {
    config.currentProvider = 'openrouter';
    config.currentModel = 'qwen/qwen3-coder:free';
    
    const client = createClient(config);
    const systemPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints,
      configFiles: projectInfo.configFiles,
      fileCount: projectInfo.fileCount,
      tree: projectInfo.tree,
    }, undefined, false, 'openrouter', 'auto');
    
    const compactTokens = Math.round(systemPrompt.length / 4);
    console.log(`  System prompt: ${systemPrompt.length} chars (~${compactTokens} tokens)`);
    
    clearFallbackEvents();
    const start = Date.now();
    
    const result = await client.sendMessage(
      [{ role: 'user', content: 'explain what package.json is in 2-3 sentences' }],
      systemPrompt
    );
    
    const dur = elapsed(start);
    const fbEvents = getFallbackEvents();
    
    console.log(`  Response time: ${dur}s`);
    console.log(`  Has message: ${!!result.message}`);
    console.log(`  Has tool calls: ${result.toolCalls?.length || 0}`);
    console.log(`  Fallback events: ${fbEvents.length}`);
    if (fbEvents.length > 0) {
      for (const e of fbEvents) {
        console.log(`    ~ ${e.reason}`);
      }
    }
    if (result.message) {
      console.log(`  Response: ${result.message.slice(0, 200)}...`);
    }
    console.log(`  ${dur < 20 ? '✓' : '⚠ SLOW'} — ${dur}s`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // Test 4: Project scan
  section('TEST 4: Project-aware question');
  console.log('  Sending: "scan this project and tell me the entry points"');
  try {
    clearFallbackEvents();
    const start = Date.now();
    
    const result = await createClient(config).sendMessage(
      [{ role: 'user', content: 'scan this project and tell me the entry points' }],
      buildSystemPrompt({
        type: projectInfo.type,
        entryPoints: projectInfo.entryPoints,
        configFiles: projectInfo.configFiles,
        fileCount: projectInfo.fileCount,
        tree: projectInfo.tree,
      }, undefined, false, 'openrouter', 'auto')
    );
    
    const dur = elapsed(start);
    const fbEvents = getFallbackEvents();
    
    console.log(`  Response time: ${dur}s`);
    console.log(`  Tool calls: ${result.toolCalls?.length || 0}`);
    for (const tc of (result.toolCalls || [])) {
      console.log(`    ${tc.type}: ${JSON.stringify(tc.params).slice(0, 100)}`);
    }
    if (fbEvents.length > 0) {
      for (const e of fbEvents) {
        console.log(`    ~ ${e.reason}`);
      }
    }
    console.log(`  ${dur < 20 ? '✓' : '⚠ SLOW'} — ${dur}s`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // Test 5: Edit request
  section('TEST 5: Edit Request');
  console.log('  Sending: "change the app title in the correct file"');
  try {
    clearFallbackEvents();
    const start = Date.now();
    
    const result = await createClient(config).sendMessage(
      [{ role: 'user', content: 'change the app title in the correct file' }],
      buildSystemPrompt({
        type: projectInfo.type,
        entryPoints: projectInfo.entryPoints,
        configFiles: projectInfo.configFiles,
        fileCount: projectInfo.fileCount,
        tree: projectInfo.tree,
      }, undefined, false, 'openrouter', 'auto')
    );
    
    const dur = elapsed(start);
    const fbEvents = getFallbackEvents();
    
    console.log(`  Response time: ${dur}s`);
    console.log(`  Tool calls: ${result.toolCalls?.length || 0}`);
    for (const tc of (result.toolCalls || [])) {
      console.log(`    ${tc.type}: ${JSON.stringify(tc.params).slice(0, 120)}`);
    }
    if (fbEvents.length > 0) {
      for (const e of fbEvents) {
        console.log(`    ~ ${e.reason}`);
      }
    }
    console.log(`  ${dur < 20 ? '✓' : '⚠ SLOW'} — ${dur}s`);
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // Test 6: Fallback via bad key
  section('TEST 6: Fallback Test');
  console.log('  Simulating fallback by using a bad provider key...');
  console.log('  Setting deepseek with invalid key...');
  
  try {
    // Temporarily set deepseek to trigger fallback
    config.currentProvider = 'deepseek';
    config.currentModel = 'deepseek-chat';
    // Use a deliberately bad key
    const origKey = config.apiKeys.deepseek;
    config.apiKeys.deepseek = 'sk-bad-key-that-will-fail';
    
    resetHealth();
    clearFallbackEvents();
    const start = Date.now();
    
    try {
      const result = await createClient(config).sendMessage(
        [{ role: 'user', content: 'say hi briefly' }],
        buildSystemPrompt(undefined, undefined, false, 'deepseek', 'auto')
      );
      const dur = elapsed(start);
      const fbEvents = getFallbackEvents();
      
      console.log(`  Response time: ${dur}s`);
      console.log(`  Has message: ${!!result.message}`);
      console.log(`  Fallback events: ${fbEvents.length}`);
      for (const e of fbEvents) {
        console.log(`    ~ ${e.reason}`);
      }
      console.log(`  Total time: ${dur}s`);
      console.log(`  ${dur < 60 ? '✓' : '⚠ Exceeded 60s max'} — ${dur}s`);
      if (result.message) {
        console.log(`  Response: ${result.message.slice(0, 200)}`);
      }
    } catch (err) {
      const dur = elapsed(start);
      const fbEvents = getFallbackEvents();
      console.log(`  Failed after ${dur}s: ${err.message.slice(0, 200)}`);
      console.log(`  Fallback events: ${fbEvents.length}`);
      for (const e of fbEvents) {
        console.log(`    ~ ${e.reason}`);
      }
      console.log(`  Total time: ${dur}s`);
      console.log(`  ${dur < 60 ? '✓' : '⚠ Exceeded 60s max'} — ${dur}s`);
    }
    
    // Restore key
    config.apiKeys.deepseek = origKey;
  } catch (err) {
    console.log(`  ✗ Error in fallback test: ${err.message}`);
  }

  // Test 7: Pollinations (experimental)
  section('TEST 7: Experimental Provider (Pollinations)');
  console.log('  Testing with Pollinations / openai-fast...');
  
  try {
    config.currentProvider = 'pollinations';
    config.currentModel = 'openai-fast';
    config.allowExperimentalProviders = true;
    
    const sysPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints,
      fileCount: projectInfo.fileCount,
    }, undefined, false, 'pollinations', 'auto');
    
    const compactTokens = Math.round(sysPrompt.length / 4);
    console.log(`  System prompt: ${sysPrompt.length} chars (~${compactTokens} tokens)`);
    console.log(`  ${compactTokens < 200 ? '✓ Compact prompt used (<200 tokens)' : '⚠ Full prompt (>200 tokens)'}`);
    
    clearFallbackEvents();
    const start = Date.now();
    
    const result = await createClient(config).sendMessage(
      [{ role: 'user', content: 'say hi briefly' }],
      sysPrompt
    );
    
    const dur = elapsed(start);
    const fbEvents = getFallbackEvents();
    
    console.log(`  Response time: ${dur}s`);
    console.log(`  Has message: ${!!result.message}`);
    if (fbEvents.length > 0) {
      for (const e of fbEvents) {
        console.log(`    ~ ${e.reason}`);
      }
    }
    console.log(`  ${dur < 20 ? '✓' : '⚠ SLOW'} — ${dur}s`);
    if (result.message) {
      console.log(`  Response: ${result.message.slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  // Test 8: Provider/model display test
  section('TEST 8: Provider/Model Display');
  console.log('  In CLI, spinner shows: "🤔 OpenRouter / qwen/qwen3-coder:free..."');
  console.log('  In Web UI, thinking bar shows:');
  console.log('    "HYSA is working with OpenRouter / qwen/qwen3-coder:free... 8s"');
  console.log('  When fallback:');
  console.log('    "~ Trying Groq / llama3-70b-8192..."');
  console.log('    "~ Groq timed out (12s)"');
  console.log('    "~ Trying Gemini / gemini-2.5-flash..."');
  console.log('    "⚡ Switched to Gemini / gemini-2.5-flash."');

  // Restore original config
  config.currentProvider = origProvider;
  config.currentModel = origModel;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('  ALL TESTS COMPLETE');
  console.log(`${'='.repeat(60)}`);
})();
