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
  it('formatSearchResults produces concise format', async () => {
    const { formatSearchResults } = await import('../src/tools/web-search.js');
    const result = formatSearchResults('test query', [
      { title: 'Example Title', url: 'http://example.com/page', snippet: 'This is a test snippet.' },
    ]);
    assert.ok(result.includes('Web Search'), 'should include Web Search header');
    assert.ok(result.includes('Summary:'), 'should include Summary header');
    assert.ok(result.includes('Sources:'), 'should include Sources:');
    assert.ok(result.includes('example.com'), 'should include domain');
    assert.ok(result.includes('DO NOT include links to YouTube'), 'should exclude videos');
    assert.ok(result.includes('DO NOT dump raw URLs'), 'should avoid raw URL dumps');
  });

  it('formatSearchResults does not dump raw URLs in output', async () => {
    const { formatSearchResults } = await import('../src/tools/web-search.js');
    const results = [
      { title: 'First Result', url: 'https://example.com/page1', snippet: 'This is the first test result about something interesting.' },
      { title: 'Second Result', url: 'https://example.org/page2', snippet: 'This is the second test result about something else.' },
    ];
    const output = formatSearchResults('test query', results);
    const lines = output.split('\n');
    assert.ok(lines.length < 18, `output should be concise (got ${lines.length} lines)`);
    // Should NOT contain raw http:// or https:// URLs (uses domain format)
    assert.ok(!output.includes('http://'), 'should not contain raw http:// URLs');
    assert.ok(!output.includes('https://'), 'should not contain raw https:// URLs');
    // Should use domain format
    assert.ok(output.includes('[example.com]'), 'should use domain format [domain.com]');
    assert.ok(output.includes('DO NOT include links to YouTube'), 'should exclude videos');
    assert.ok(output.includes('DO NOT dump raw URLs'), 'should avoid raw URL dumps');
  });
});
