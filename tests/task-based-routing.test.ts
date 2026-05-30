import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTaskBasedRouting } from '../src/ai/smart-router.js';
import { isArabicText } from '../src/ai/task-classifier.js';
import type { HysaConfig } from '../src/config/keys.js';

type RouterCandidate = { provider: string; model: string; label: string; priority: string };

function makeConfig(overrides: Partial<HysaConfig> = {}): HysaConfig {
  return {
    currentProvider: 'openai_router',
    currentModel: 'oc/deepseek-v4-flash-free',
    apiKeys: {},
    ollamaBaseUrl: 'http://localhost:11434',
    ...overrides,
  };
}

// Realistic candidate order matching getCandidatesForTask output:
// openai_router first (currentProvider), configured model promoted to front,
// then ninerouter models (deepseek, gemini) in priority order
function realisticDeepseekFirstCandidates(): RouterCandidate[] {
  return [
    { provider: 'openai_router', model: 'oc/deepseek-v4-flash-free', label: 'OpenAI Router / oc/deepseek-v4-flash-free', priority: 'balanced' },
    { provider: 'openai_router', model: 'qw/qwen3-coder-flash', label: 'OpenAI Router / qw/qwen3-coder-flash', priority: 'fast' },
    { provider: 'openai_router', model: 'qw/qwen3-coder-plus', label: 'OpenAI Router / qw/qwen3-coder-plus', priority: 'stronger' },
    { provider: 'ninerouter', model: 'oc/deepseek-v4-flash-free', label: '9Router / oc/deepseek-v4-flash-free', priority: 'balanced' },
    { provider: 'ninerouter', model: 'gemini/gemini-3.1-flash-lite-preview', label: '9Router / gemini/gemini-3.1-flash-lite-preview', priority: 'balanced' },
    { provider: 'ninerouter', model: 'gemini/gemini-2.5-flash', label: '9Router / gemini/gemini-2.5-flash', priority: 'fast' },
  ];
}

describe('isArabicText', () => {
  it('detects Arabic script text', () => {
    assert.ok(isArabicText('كيف حالك'));
    assert.ok(isArabicText('مرحبا، كيف يمكنني مساعدتك؟'));
    assert.ok(isArabicText('ابحث في الانترنت عن الذكاء الاصطناعي'));
    assert.ok(isArabicText('ما هو الطقس في دبي'));
  });

  it('returns false for English text', () => {
    assert.equal(isArabicText(''), false);
    assert.equal(isArabicText('hello world'), false);
    assert.equal(isArabicText('how are you?'), false);
    assert.equal(isArabicText('search the web'), false);
  });

  it('returns false for non-Arabic text', () => {
    assert.equal(isArabicText('12345'), false);
    assert.equal(isArabicText('!@#$%'), false);
  });
});

describe('applyTaskBasedRouting', () => {
  const config = makeConfig();

  it('routes Arabic general question to Gemini (moves Gemini before DeepSeek)', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'simple_chat', 'كيف حالك؟', config);
    // In the original: DeepSeek is at 0, Gemini at 4
    // In result: Gemini should be before DeepSeek
    const firstGemini = result.findIndex(c => c.provider === 'ninerouter' && /gemini/i.test(c.model));
    const firstDeepSeek = result.findIndex(c => c.model.includes('deepseek'));
    assert.ok(firstGemini >= 0, 'should have Gemini candidates');
    assert.ok(firstDeepSeek >= 0, 'should have DeepSeek candidates');
    assert.ok(firstGemini < firstDeepSeek, 'Gemini should appear before DeepSeek for Arabic general question');
  });

  it('routes Arabic general_qa question to Gemini', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'general_qa', 'ما هو الذكاء الاصطناعي؟', config);
    const firstGemini = result.findIndex(c => c.provider === 'ninerouter' && /gemini/i.test(c.model));
    const firstDeepSeek = result.findIndex(c => c.model.includes('deepseek'));
    assert.ok(firstGemini >= 0);
    assert.ok(firstDeepSeek >= 0);
    assert.ok(firstGemini < firstDeepSeek, 'Gemini should appear before DeepSeek for Arabic general_qa');
  });

  it('routes search task to Gemini', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'search', 'search the web for latest AI news', config);
    const firstGemini = result.findIndex(c => c.provider === 'ninerouter' && /gemini/i.test(c.model));
    const firstDeepSeek = result.findIndex(c => c.model.includes('deepseek'));
    assert.ok(firstGemini >= 0);
    assert.ok(firstDeepSeek >= 0);
    assert.ok(firstGemini < firstDeepSeek, 'Gemini should appear before DeepSeek for search');
  });

  it('routes web_research task to Gemini', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'web_research', 'find information about quantum computing', config);
    const firstGemini = result.findIndex(c => c.provider === 'ninerouter' && /gemini/i.test(c.model));
    const firstDeepSeek = result.findIndex(c => c.model.includes('deepseek'));
    assert.ok(firstGemini >= 0);
    assert.ok(firstDeepSeek >= 0);
    assert.ok(firstGemini < firstDeepSeek, 'Gemini should appear before DeepSeek for web_research');
  });

  it('keeps image_vision routing unchanged (no reorder for vision)', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'image_vision', 'what is in this image?', config);
    const arabicVision = applyTaskBasedRouting(candidates, 'image_vision', 'ما في هذه الصورة؟', config);
    // Both should preserve original order
    assert.deepEqual(result.map(c => `${c.provider}:${c.model}`), candidates.map(c => `${c.provider}:${c.model}`),
      'English vision should not reorder');
    assert.deepEqual(arabicVision.map(c => `${c.provider}:${c.model}`), candidates.map(c => `${c.provider}:${c.model}`),
      'Arabic vision should not reorder');
  });

  it('keeps code_edit routing unchanged (no reorder)', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'code_edit', 'fix this bug in my code', config);
    // Should preserve original order for code tasks
    assert.deepEqual(result.map(c => `${c.provider}:${c.model}`), candidates.map(c => `${c.provider}:${c.model}`),
      'code_edit should not reorder candidates');
  });

  it('keeps debugging routing unchanged', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'debugging', 'why is this code throwing an error?', config);
    assert.deepEqual(result.map(c => `${c.provider}:${c.model}`), candidates.map(c => `${c.provider}:${c.model}`),
      'debugging should not reorder candidates');
  });

  it('keeps code_review routing unchanged', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'code_review', 'review this code for issues', config);
    assert.deepEqual(result.map(c => `${c.provider}:${c.model}`), candidates.map(c => `${c.provider}:${c.model}`),
      'code_review should not reorder candidates');
  });

  it('does not reorder when no Gemini candidates exist', () => {
    const noGemini = [
      { provider: 'openai_router', model: 'oc/deepseek-v4-flash-free', label: 'OpenAI Router / oc/deepseek-v4-flash-free', priority: 'balanced' },
      { provider: 'ninerouter', model: 'oc/deepseek-v4-flash-free', label: '9Router / oc/deepseek-v4-flash-free', priority: 'balanced' },
    ];
    const result = applyTaskBasedRouting(noGemini, 'simple_chat', 'كيف حالك؟', config);
    assert.deepEqual(result, noGemini, 'should not reorder when no Gemini candidates');
  });

  it('does not route every simple_chat to Gemini - only Arabic', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'simple_chat', 'hello, how are you?', config);
    assert.deepEqual(result.map(c => `${c.provider}:${c.model}`), candidates.map(c => `${c.provider}:${c.model}`),
      'English simple chat should not reorder candidates');
  });

  it('does not route code-related Arabic text to Gemini', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'code_edit', 'how to write a Python function كيف اكتب دالة', config);
    // code_edit task should preserve original order
    assert.deepEqual(result.map(c => `${c.provider}:${c.model}`), candidates.map(c => `${c.provider}:${c.model}`),
      'code_edit with Arabic should not reorder');
  });

  it('routes Arabic code_edit task to DeepSeek, not Gemini', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'code_edit', 'fix this bug: هذا الخطأ', config);
    // code_edit is a codeProjectTask - should preserve order (DeepSeek first)
    assert.deepEqual(result.map(c => `${c.provider}:${c.model}`), candidates.map(c => `${c.provider}:${c.model}`),
      'code_edit should not reorder even with Arabic text');
  });

  it('handles empty candidates gracefully', () => {
    const result = applyTaskBasedRouting([], 'simple_chat', 'كيف حالك؟', config);
    assert.deepEqual(result, []);
  });

  it('routes search with Arabic text to Gemini', () => {
    const candidates = realisticDeepseekFirstCandidates();
    // Even though the text "code" appears, the task is 'search' which takes priority
    const result = applyTaskBasedRouting(candidates, 'search', 'ابحث عن معلومات حول البرمجة', config);
    const firstGemini = result.findIndex(c => c.provider === 'ninerouter' && /gemini/i.test(c.model));
    const firstDeepSeek = result.findIndex(c => c.model.includes('deepseek'));
    assert.ok(firstGemini < firstDeepSeek, 'Arabic search should route to Gemini');
  });

  it('all Gemini candidates appear as a contiguous block at front for Arabic', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'simple_chat', 'كيف حالك؟', config);
    const geminiIndices = result
      .map((c, i) => ({ isGemini: c.provider === 'ninerouter' && /gemini/i.test(c.model), idx: i }))
      .filter(x => x.isGemini)
      .map(x => x.idx);
    // Gemini indices should be contiguous starting at 0
    if (geminiIndices.length > 0) {
      assert.equal(geminiIndices[0], 0, 'first Gemini should be at index 0');
      for (let i = 1; i < geminiIndices.length; i++) {
        assert.equal(geminiIndices[i], geminiIndices[i - 1] + 1, 'Gemini indices should be contiguous');
      }
    }
  });

  it('all Gemini candidates appear as a contiguous block at front for search', () => {
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'search', 'search the web for news', config);
    const geminiIndices = result
      .map((c, i) => ({ isGemini: c.provider === 'ninerouter' && /gemini/i.test(c.model), idx: i }))
      .filter(x => x.isGemini)
      .map(x => x.idx);
    if (geminiIndices.length > 0) {
      assert.equal(geminiIndices[0], 0, 'first Gemini should be at index 0');
      for (let i = 1; i < geminiIndices.length; i++) {
        assert.equal(geminiIndices[i], geminiIndices[i - 1] + 1, 'Gemini indices should be contiguous');
      }
    }
  });

  it('routes Arabic to Gemini without manual provider switching', () => {
    // Routing should prefer Gemini for Arabic general questions even when
    // currentProvider is not Gemini (no manual config change required)
    const cfg = makeConfig({ currentProvider: 'openai_router', currentModel: 'oc/deepseek-v4-flash-free' });
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'simple_chat', 'كيف حالك؟', cfg);
    const firstGemini = result.findIndex(c => c.provider === 'ninerouter' && /gemini/i.test(c.model));
    const firstDeepSeek = result.findIndex(c => c.model.includes('deepseek'));
    assert.ok(firstGemini >= 0, 'should have Gemini candidates');
    assert.ok(firstDeepSeek >= 0, 'should have DeepSeek candidates');
    assert.ok(firstGemini < firstDeepSeek, 'Gemini before DeepSeek without switching currentProvider');
  });

  it('routes Arabic general_qa to Gemini without manual provider switching', () => {
    const cfg = makeConfig({ currentProvider: 'openai_router', currentModel: 'oc/deepseek-v4-flash-free' });
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'general_qa', 'ما هو الذكاء الاصطناعي؟', cfg);
    const firstGemini = result.findIndex(c => c.provider === 'ninerouter' && /gemini/i.test(c.model));
    const firstDeepSeek = result.findIndex(c => c.model.includes('deepseek'));
    assert.ok(firstGemini < firstDeepSeek, 'Gemini before DeepSeek for Arabic general_qa without switching');
  });

  it('routes search to Gemini without manual provider switching', () => {
    const cfg = makeConfig({ currentProvider: 'openai_router', currentModel: 'oc/deepseek-v4-flash-free' });
    const candidates = realisticDeepseekFirstCandidates();
    const result = applyTaskBasedRouting(candidates, 'search', 'search the web for latest AI news', cfg);
    const firstGemini = result.findIndex(c => c.provider === 'ninerouter' && /gemini/i.test(c.model));
    const firstDeepSeek = result.findIndex(c => c.model.includes('deepseek'));
    assert.ok(firstGemini < firstDeepSeek, 'Gemini before DeepSeek for search without switching');
  });
});
