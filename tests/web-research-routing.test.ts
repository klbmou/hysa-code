import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTask } from '../src/ai/task-classifier.js';
import { isEntityFollowUpQuery } from '../src/tools/entity-detector.js';
import { isCapabilityQuestion } from '../src/tools/web-search.js';
import { getSearchDiagnostics } from '../src/tools/web-search.js';

function msg(text: string) {
  return [{ role: 'user' as const, content: text }];
}

describe('web research routing', () => {
  // ── Arabic search phrase detection ───────────────
  it('Arabic "ابحث عنها في الانترنت" triggers search task', () => {
    assert.equal(classifyTask(msg('ابحث عنها في الانترنت')), 'search');
  });

  it('Arabic "ابحث عنه" triggers search task', () => {
    assert.equal(classifyTask(msg('ابحث عنه')), 'search');
  });

  it('Arabic "ابحث عنهم" triggers search task', () => {
    assert.equal(classifyTask(msg('ابحث عنهم')), 'search');
  });

  it('Arabic "هات مصادر" triggers search task', () => {
    assert.equal(classifyTask(msg('هات مصادر')), 'search');
  });

  it('Arabic "أعطني روابط" triggers search task', () => {
    assert.equal(classifyTask(msg('أعطني روابط')), 'search');
  });

  it('Arabic "دور عليها في الانترنت" triggers search task', () => {
    assert.equal(classifyTask(msg('دور عليها في الانترنت')), 'search');
  });

  it('Arabic "شوف في النت" triggers search task', () => {
    assert.equal(classifyTask(msg('شوف في النت')), 'search');
  });

  it('Arabic "فتش في غوغل" triggers search task', () => {
    assert.equal(classifyTask(msg('فتش في غوغل عن شيء')), 'search');
  });

  it('Arabic "مصادر عن الطقس" triggers search task', () => {
    assert.equal(classifyTask(msg('مصادر عن الطقس')), 'search');
  });

  it('Arabic "روابط حول الموضوع" triggers search task', () => {
    assert.equal(classifyTask(msg('روابط حول الموضوع')), 'search');
  });

  it('Arabic "كم لديه من متابع؟" triggers search task', () => {
    assert.equal(classifyTask(msg('كم لديه من متابع')), 'search');
  });

  it('Arabic "كم عدد مشتركي قناة X" triggers search task', () => {
    assert.equal(classifyTask(msg('كم عدد مشتركي قناة الهلال على يوتيوب')), 'search');
  });

  it('Arabic "آخر أخبار X" triggers search task', () => {
    assert.equal(classifyTask(msg('آخر أخبار البورصة')), 'search');
  });

  it('Arabic "ما آخر أخبار X" triggers search task', () => {
    assert.equal(classifyTask(msg('ما آخر أخبار الأسواق')), 'search');
  });

  it('Arabic "ابحث عن آخر إحصائيات" triggers search task', () => {
    assert.equal(classifyTask(msg('ابحث عن آخر إحصائيات كورونا')), 'search');
  });

  it('English "how many subscribers does X have" triggers search task', () => {
    assert.equal(classifyTask(msg('how many subscribers does pewdiepie have')), 'search');
  });

  it('English "what is the current price of" triggers search task', () => {
    assert.equal(classifyTask(msg('what is the current price of bitcoin')), 'search');
  });

  // ── Existing patterns still work ─────────────────
  it('English "search the web for X" triggers search task', () => {
    assert.equal(classifyTask(msg('search the web for latest news')), 'search');
  });

  it('English "google X" triggers search task', () => {
    assert.equal(classifyTask(msg('google python tutorial')), 'search');
  });

  it('Arabic "ابحث في الانترنت عن" triggers search task', () => {
    assert.equal(classifyTask(msg('ابحث في الانترنت عن الذكاء الاصطناعي')), 'search');
  });

  // ── Non-search messages ──────────────────────────
  it('simple chat does not trigger search', () => {
    assert.notEqual(classifyTask(msg('كيف حالك')), 'search');
    assert.notEqual(classifyTask(msg('hello')), 'search');
  });

  it('code question does not trigger search', () => {
    assert.notEqual(classifyTask(msg('how to write a function in python')), 'search');
  });

  // ── Entity follow-up for Arabic search ────────────
  it('isEntityFollowUpQuery detects "ابحث عنها"', () => {
    assert.ok(isEntityFollowUpQuery('ابحث عنها'));
  });

  it('isEntityFollowUpQuery detects "دور عليه"', () => {
    assert.ok(isEntityFollowUpQuery('دور عليه'));
  });

  it('isEntityFollowUpQuery detects "ابحث عنهم"', () => {
    assert.ok(isEntityFollowUpQuery('ابحث عنهم'));
  });

  // ── Capability question (not an action search) ────
  it('isCapabilityQuestion detects "هل يمكنك البحث"', () => {
    assert.ok(isCapabilityQuestion('هل يمكنك البحث في الإنترنت'));
  });

  it('isCapabilityQuestion is false for action search "ابحث عنها"', () => {
    assert.equal(isCapabilityQuestion('ابحث عنها في الانترنت'), false);
  });

  // ── No-search-tool-configured case ────────────────
  it('getSearchDiagnostics shows isReliable status', () => {
    const diag = getSearchDiagnostics();
    assert.ok(typeof diag.isReliable === 'boolean');
    assert.ok(typeof diag.provider === 'string');
    assert.ok(typeof diag.configuredKeys !== 'undefined');
  });

  // ── Search result formatting ──
  it('formatSearchResults includes Sources section instructions', async () => {
    const { formatSearchResults } = await import('../src/tools/web-search.js');
    const result = formatSearchResults('test query', [
      { title: 'Example Title', url: 'http://example.com/page', snippet: 'This is a test snippet.' },
    ]);
    assert.ok(result.includes('Web Search'), 'should include Web Search header');
    assert.ok(result.includes('Summary:'), 'should include Summary header');
    assert.ok(result.includes('Sources:'), 'should include Sources:');
    assert.ok(result.includes('example.com'), 'should include domain');
    // Must tell LLM to include Sources section
    assert.ok(result.includes('MUST include a "Sources" section'), 'should require Sources section at end');
    assert.ok(result.includes('List 3-5'), 'should limit to 3-5 sources');
    assert.ok(result.includes('title, domain or URL, and a 1-line summary'), 'each source needs title+url+summary');
    assert.ok(result.includes('Do NOT dump raw'), 'should avoid raw URL dumps');
    assert.ok(result.includes('Do NOT include links to YouTube'), 'should exclude videos');
  });

  it('formatSearchResults gives each source a snippet line', async () => {
    const { formatSearchResults } = await import('../src/tools/web-search.js');
    const result = formatSearchResults('test query', [
      { title: 'Example Title', url: 'http://example.com/page', snippet: 'This is a test snippet.' },
    ]);
    // Each source should have title and snippet line
    assert.ok(result.includes('Example Title'), 'should include source title');
    assert.ok(result.includes('This is a test snippet.'), 'should include source snippet');
  });

  it('formatSearchResults limits to 5 sources max', async () => {
    const { formatSearchResults } = await import('../src/tools/web-search.js');
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i + 1}`,
      url: `https://example${i}.com/page`,
      snippet: `This is result number ${i + 1}.`,
    }));
    const output = formatSearchResults('test query', manyResults);
    // Should only show 5 sources
    const sourceMatches = output.match(/^\d+\.\s+\[/gm);
    assert.ok(sourceMatches, 'should have source entries');
    assert.ok(sourceMatches.length <= 5, `should have at most 5 sources (got ${sourceMatches.length})`);
  });

  it('formatSearchResults Arabic query uses مصادر section', async () => {
    const { formatSearchResults } = await import('../src/tools/web-search.js');
    const result = formatSearchResults('ما هو الذكاء الاصطناعي', [
      { title: 'AI Article', url: 'https://example.com/ai', snippet: 'Artificial intelligence is transforming technology.' },
    ]);
    assert.ok(result.includes('المصادر:'), 'should use Arabic مصادر header');
    assert.ok(result.includes('تعليمات للإجابة:'), 'should include Arabic instructions');
    assert.ok(result.includes('مصادر" في النهاية'), 'should tell LLM to include مصادر section');
    assert.ok(result.includes('ادرج 3-5'), 'should limit to 3-5 in Arabic');
    assert.ok(result.includes('لا تضع روابط طويلة'), 'should avoid raw URLs in Arabic');
    assert.ok(result.includes('لا تدرج روابط يوتيوب'), 'should exclude videos in Arabic');
  });

  it('formatSearchResults does not dump raw URLs in output', async () => {
    const { formatSearchResults } = await import('../src/tools/web-search.js');
    const results = [
      { title: 'First Result', url: 'https://example.com/page1', snippet: 'This is the first test result about something interesting.' },
      { title: 'Second Result', url: 'https://example.org/page2', snippet: 'This is the second test result about something else.' },
    ];
    const output = formatSearchResults('test query', results);
    // Should NOT contain raw http:// or https:// URLs (uses domain format)
    assert.ok(!output.includes('http://'), 'should not contain raw http:// URLs');
    assert.ok(!output.includes('https://'), 'should not contain raw https:// URLs');
    // Should use domain format
    assert.ok(output.includes('[example.com]'), 'should use domain format [domain.com]');
  });
});
