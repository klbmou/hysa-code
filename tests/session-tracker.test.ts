import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DIR = join(process.cwd(), '.hysa-test-session');
let origCwd = process.cwd();

async function setupTestBrain(): Promise<void> {
  await mkdir(TEST_DIR, { recursive: true });
  process.chdir(TEST_DIR);
  const brainDir = join(TEST_DIR, '.hysa', 'brain');
  await mkdir(brainDir, { recursive: true });

  await writeFile(join(brainDir, 'experience-graph.json'), JSON.stringify({
    version: 2,
    updatedAt: new Date().toISOString(),
    nodes: [],
    edges: [],
  }));

  await writeFile(join(brainDir, 'experience-log.jsonl'), '');
  await writeFile(join(brainDir, 'lessons.md'), '# Lessons Learned\n\n');
  await writeFile(join(brainDir, 'decisions.md'), '# Design Decisions\n\n');
  await writeFile(join(brainDir, 'README.md'), '# Test Brain\n');
  await writeFile(join(brainDir, 'project-map.json'), JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    importantFiles: {},
    modules: {},
    commands: {},
    knownSystems: [],
  }));
}

async function teardownTestBrain(): Promise<void> {
  process.chdir(origCwd);
  await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
}

describe('session-tracker', { concurrency: false }, () => {
  before(async () => {
    await setupTestBrain();
  });

  after(async () => {
    await teardownTestBrain();
  });

  // Test 1: session tracker records events
  it('records tool/file/command events', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    await st.recordEvent('command_run', 'npm run build');
    await st.recordEvent('file_read', 'src/cli.ts');
    await st.recordEvent('file_edited', 'src/brain/session-tracker.ts');
    await st.recordEvent('tool_used', 'read');
    await st.recordEvent('error_encountered', 'TypeError in build step');
    await st.recordEvent('auto_fix', 'auto-fixed lint error');
    await st.recordEvent('provider_fallback', 'fell back to ollama');
    await st.recordEvent('memory_injected', 'context injected for TypeScript');

    const state = await st.getOrCreateSession();
    assert.ok(state.commandsRun.includes('npm run build'), 'should record command');
    assert.ok(state.filesRead.includes('src/cli.ts'), 'should record file read');
    assert.ok(state.filesEdited.includes('src/brain/session-tracker.ts'), 'should record file edit');
    assert.ok(state.toolsUsed.includes('read'), 'should record tool');
    assert.equal(state.errorsEncountered.length, 1, 'should record error');
    assert.equal(state.autoFixAttempts, 1, 'should count auto-fix');
    assert.equal(state.providerFallbacks, 1, 'should count provider fallback');
    assert.equal(state.memoriesInjected, 1, 'should count memory injection');

    await st.clearSession();
  });

  // Test 2: summary includes files changed and final status
  it('summary includes files changed and final status', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    await st.recordEvent('file_edited', 'src/foo.ts');
    await st.recordEvent('file_edited', 'src/bar.ts');
    await st.recordEvent('command_run', 'npm test');
    await st.recordEvent('build_result', 'build passed');
    await st.recordEvent('test_result', 'tests passed');
    await st.endSession('success');

    const summary = await st.generateSummary();
    assert.ok(summary.filesChanged.includes('src/foo.ts'), 'should include foo.ts');
    assert.ok(summary.filesChanged.includes('src/bar.ts'), 'should include bar.ts');
    assert.equal(summary.finalStatus, 'success', 'should reflect final status');
    assert.ok(summary.testsBuildStatus.includes('pass'), 'should reflect test status');
    assert.ok(summary.duration.length > 0, 'should have duration');

    await st.clearSession();
  });

  // Test 3: save writes memory nodes
  it('save writes memory nodes to brain', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    // Seed session with non-trivial activity
    await st.recordEvent('file_edited', 'src/main.ts');
    await st.recordEvent('command_run', 'npm run build');
    await st.recordEvent('error_encountered', 'build failed with syntax error');
    await st.endSession('partial');

    const result = await st.saveSessionToBrain();
    assert.ok(!result.skipped, 'should not skip non-trivial session');
    assert.ok(result.saved >= 1, `should save at least 1 memory node, got ${result.saved}`);

    // Verify the graph has the saved nodes
    const { readExperienceGraph } = await import('../src/brain/graph-store.js');
    const graph = await readExperienceGraph();
    const sessionNodes = graph.nodes.filter(n => n.tags && n.tags.includes('session-summary'));
    assert.ok(sessionNodes.length >= 1, 'should have at least one session-summary node');

    await st.clearSession();
  });

  // Test 4: trivial session is not saved
  it('trivial session is not saved', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    // Create session but don't record any meaningful events
    await st.getOrCreateSession();
    await st.endSession('success');

    const state = await st.getOrCreateSession();
    assert.ok(st.isTrivialSession(state), 'empty session should be trivial');

    const result = await st.saveSessionToBrain();
    assert.ok(result.skipped, 'trivial session should be skipped');
    assert.ok(result.reason, 'should have a reason');

    await st.clearSession();
  });

  // Test 5: secrets are redacted
  it('secrets are redacted in session output', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    await st.recordEvent('error_encountered', 'API key sk-abc123def456 is invalid');
    await st.recordEvent('file_read', '/path/to/file');

    const state = await st.getOrCreateSession();
    const secretError = state.errorsEncountered.find(e => e.includes('sk-'));
    assert.ok(!secretError, 'secret should be redacted from error');
    const redactedError = state.errorsEncountered.find(e => e.includes('REDACTED'));
    assert.ok(redactedError, 'error should contain REDACTED');

    await st.clearSession();
  });

  // Test 6: clear resets session
  it('clear resets session state', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    await st.recordEvent('command_run', 'npm test');
    await st.recordEvent('file_edited', 'src/test.ts');
    await st.endSession('success');

    // Use loadSession to inspect ended session (getOrCreateSession creates new one)
    let state = await st.loadSession();
    assert.ok(state, 'should have saved session');
    assert.equal(state!.commandsRun.length, 1, 'should have recorded command');
    assert.ok(state!.endedAt, 'should have endedAt after endSession');

    // Clear resets: after clear, a fresh session starts
    await st.clearSession();

    // Load the cleared file directly — it should have empty arrays
    const cleared = await st.loadSession();
    assert.equal(cleared!.commandsRun.length, 0, 'cleared file should have empty commands');
    assert.equal(cleared!.finalStatus, 'cleared', 'should be marked cleared');

    // A fresh recording shows the new event (not the old one)
    await st.recordEvent('command_run', 'npm run build');
    const fresh = await st.getOrCreateSession();
    assert.equal(fresh.commandsRun.length, 1, 'new recording should have its own events');
    assert.equal(fresh.commandsRun[0], 'npm run build', 'should only have the new command');

    await st.clearSession();
  });

  // Test 7: endSession updates final status
  it('endSession sets final status and timestamp', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    await st.recordEvent('file_edited', 'src/app.ts');
    const ended = await st.endSession('failure');

    assert.equal(ended.finalStatus, 'failure');
    assert.ok(ended.endedAt, 'should have endedAt timestamp');

    await st.clearSession();
  });

  // Test 8: formatSummaryForChat produces non-empty string
  it('formatSummaryForChat produces output', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    await st.recordEvent('command_run', 'npm run build');
    await st.recordEvent('file_edited', 'src/out.ts');
    await st.endSession('success');

    const formatted = await st.formatSummaryForChat();
    assert.ok(formatted.length > 20, 'formatted summary should be non-trivial');
    assert.ok(formatted.includes('Session Report'), 'should have header');

    await st.clearSession();
  });

  // Test 9: recordEvent deduplicates files and tools
  it('recordEvent deduplicates files and tools', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    await st.recordEvent('file_read', 'src/cli.ts');
    await st.recordEvent('file_read', 'src/cli.ts');
    await st.recordEvent('file_read', 'src/cli.ts');
    await st.recordEvent('file_edited', 'src/main.ts');
    await st.recordEvent('file_edited', 'src/main.ts');

    const state = await st.getOrCreateSession();
    assert.equal(state.filesRead.length, 1, 'should deduplicate reads');
    assert.equal(state.filesEdited.length, 1, 'should deduplicate edits');

    await st.clearSession();
  });

  // Test 10: summary is capped
  it('summary is capped at MAX_SUMMARY_LENGTH', async () => {
    const st = await import('../src/brain/session-tracker.js');
    await st.clearSession();

    const bigText = 'x'.repeat(10000);
    await st.recordEvent('error_encountered', bigText);

    const state = await st.getOrCreateSession();
    const recorded = state.errorsEncountered[0];
    assert.ok(recorded.length < 5000, `should cap long text, was ${recorded.length} chars`);

    await st.clearSession();
  });
});
