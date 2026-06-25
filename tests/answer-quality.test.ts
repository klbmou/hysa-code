import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { evaluateAnswerQuality, cleanObviousAnswerArtifacts } from '../src/ai/answer-quality.js';
import type { AnswerQualityInput, AnswerQualityResult } from '../src/ai/answer-quality.js';

function check(input: Partial<AnswerQualityInput>): AnswerQualityResult {
  return evaluateAnswerQuality({
    answer: input.answer || '',
    userText: input.userText || '',
    language: input.language || 'en',
    taskKind: input.taskKind || 'simple_chat',
    sourcesCount: input.sourcesCount,
    hasSearchResults: input.hasSearchResults,
    isOpenCodePrompt: input.isOpenCodePrompt,
    isStreaming: input.isStreaming,
    toolResultCount: input.toolResultCount,
  });
}

describe('answer quality', () => {
  it('1. empty answer flagged', () => {
    const r = check({ answer: '' });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some(i => i.code === 'empty_response'));
    assert.equal(r.shouldRegenerate, true);
  });

  it('2. whitespace-only answer flagged', () => {
    const r = check({ answer: '   \n  \n  ' });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some(i => i.code === 'empty_response'));
  });

  it('3. Arabic user + English answer flagged', () => {
    const r = check({ answer: 'This is a perfect answer in English.', userText: 'مرحبا كيف حالك؟', language: 'ar' });
    assert.ok(r.issues.some(i => i.code === 'wrong_language'));
  });

  it('4. Arabic user asking for English is not flagged', () => {
    const r = check({ answer: 'Hello, this is in English as requested.', userText: 'Answer in English please. مرحبا', language: 'ar' });
    assert.ok(!r.issues.some(i => i.code === 'wrong_language'));
  });

  it('5. Arabic mojibake flagged', () => {
    const r = check({ answer: 'Ø§Ù„Ø³Ù„Ø§Ù… Ø¹Ù„ÙŠÙƒÙ…' });
    assert.ok(r.issues.some(i => i.code === 'arabic_mojibake'));
  });

  it('6. Raw JSON source leak flagged', () => {
    const r = check({ answer: 'Here are results:\n[{"title":"AI News","url":"https://x.com","snippet":"Latest","rank":1}]' });
    assert.ok(r.issues.some(i => i.code === 'raw_json_leak' || i.code === 'raw_source_leak'));
  });

  it('7. Code JSON block not falsely flagged when task is code', () => {
    const r = check({ answer: 'Here is a JSON example:\n```json\n[{"name":"test","value":1}]\n```', taskKind: 'code' });
    assert.ok(!r.issues.some(i => i.code === 'raw_json_leak'));
  });

  it('8. Missing sources flagged when search results exist', () => {
    const r = check({ answer: 'Here is the answer without sources.', hasSearchResults: true });
    assert.ok(r.issues.some(i => i.code === 'missing_sources'));
  });

  it('9. No missing sources warning for normal answer', () => {
    const r = check({ answer: 'This is a normal chat answer with no search.' });
    assert.ok(!r.issues.some(i => i.code === 'missing_sources'));
  });

  it('10. Sources present when search results exist is not flagged', () => {
    const r = check({ answer: 'Answer with sources.\n\n### Sources\n1. https://example.com', hasSearchResults: true });
    assert.ok(!r.issues.some(i => i.code === 'missing_sources'));
  });

  it('11. Manual "run npm test yourself" flagged in OpenCode prompt', () => {
    const r = check({ answer: 'You should run npm test to verify the changes.', isOpenCodePrompt: true });
    assert.ok(r.issues.some(i => i.code === 'manual_verification_request'));
  });

  it('12. Correct "OpenCode must run tests itself" not flagged', () => {
    const r = check({ answer: 'I will run npm test to verify the changes before committing.', isOpenCodePrompt: true });
    assert.ok(!r.issues.some(i => i.code === 'manual_verification_request'));
  });

  it('13. Unsafe delete command without approval flagged', () => {
    const r = check({ answer: 'Run rm -rf /tmp/cache to clean up.' });
    assert.ok(r.issues.some(i => i.code === 'unsafe_action_without_approval'));
  });

  it('14. Approval-based destructive action not flagged', () => {
    const r = check({ answer: 'Shall I delete the temporary files? I recommend backing up first.' });
    assert.ok(!r.issues.some(i => i.code === 'unsafe_action_without_approval'));
  });

  it('15. Overconfident unverified claim flagged', () => {
    const r = check({ answer: 'This change definitely fixed the bug. No issues at all.' });
    assert.ok(r.issues.some(i => i.code === 'overconfident_claim'));
  });

  it('16. Generic low-value answer flagged for complex task', () => {
    const r = check({ answer: 'ok', taskKind: 'code_edit' });
    assert.ok(r.issues.some(i => i.code === 'generic_low_value'));
  });

  it('17. Good Arabic answer passes', () => {
    const r = check({ answer: 'مرحباً! هذا هو الجواب المفصل الذي تبحث عنه. سأشرح لك الموضوع بالتفصيل.', userText: 'مرحبا', language: 'ar' });
    assert.equal(r.ok, true);
    assert.equal(r.issues.length, 0);
  });

  it('18. Good implementation prompt passes', () => {
    const r = check({ answer: 'Here\'s how to implement the feature:\n\n1. Create a new file\n2. Add the logic\n3. Run `npm test`\n\nNext step: I will implement this now.', taskKind: 'code_edit' });
    assert.equal(r.ok, true);
  });

  it('19. Streaming mode returns shouldRegenerate=false', () => {
    const r = check({ answer: '', isStreaming: true });
    assert.equal(r.shouldRegenerate, false);
    assert.ok(r.issues.some(i => i.code === 'empty_response'));
  });

  it('20. Score decreases by severity', () => {
    const r1 = check({ answer: 'Good detailed answer with proper content.', taskKind: 'code_edit' });
    const r2 = check({ answer: '', taskKind: 'code_edit' });
    assert.ok(r2.score < r1.score);
  });

  it('21. cleanObviousAnswerArtifacts removes trailing raw JSON', () => {
    const cleaned = cleanObviousAnswerArtifacts('Answer text.\n[{"title":"x","url":"y"}]');
    assert.equal(cleaned, 'Answer text.');
  });

  it('22. cleanObviousAnswerArtifacts does not affect normal answer', () => {
    const cleaned = cleanObviousAnswerArtifacts('Normal answer with text.');
    assert.equal(cleaned, 'Normal answer with text.');
  });

  // ── tool synthesis metadata ────────────────────────────────────────

  it('23. toolSynthesisUsed true when toolResultCount > 0', () => {
    const r = check({ answer: 'I read the file.', toolResultCount: 2 });
    assert.equal(r.toolSynthesisUsed, true);
    assert.equal(r.toolResultCount, 2);
  });

  it('24. toolSynthesisUsed false when no tool results', () => {
    const r = check({ answer: 'Hello.' });
    assert.equal(r.toolSynthesisUsed, false);
    assert.equal(r.toolResultCount, undefined);
  });

  it('25. toolResultCount preserved in output', () => {
    const r = check({ answer: 'Done.', toolResultCount: 5 });
    assert.equal(r.toolResultCount, 5);
  });

  it('26. tool synthesis metadata does not affect score', () => {
    const r = check({ answer: 'I read the file.', toolResultCount: 1 });
    assert.ok(typeof r.score === 'number');
    assert.ok(r.score >= 85);
  });
});
