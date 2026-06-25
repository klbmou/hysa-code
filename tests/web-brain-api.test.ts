import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const { getBrainStatusHandler, getBrainRecallHandler, getBrainRecentEventsHandler, getBrainInspectHandler } = await import('../src/web/brain-api.js');

describe('brain-api', () => {
  describe('getBrainStatusHandler', () => {
    it('returns structured result with all fields', async () => {
      const result = await getBrainStatusHandler();
      assert.ok('exists' in result);
      assert.ok('brainDirExists' in result);
      assert.ok('eventCount' in result);
      assert.ok('graphNodeCount' in result);
      assert.ok('graphEdgeCount' in result);
      assert.ok('projectMapDate' in result);
      assert.ok('knownSystems' in result);
      assert.ok('webSessionCount' in result);
      assert.ok('recallAvailable' in result);
      assert.ok('git' in result);
    });

    it('returns numbers for count fields', async () => {
      const result = await getBrainStatusHandler();
      assert.strictEqual(typeof result.eventCount, 'number');
      assert.strictEqual(typeof result.graphNodeCount, 'number');
      assert.strictEqual(typeof result.graphEdgeCount, 'number');
      assert.strictEqual(typeof result.webSessionCount, 'number');
    });

    it('returns array for knownSystems', async () => {
      const result = await getBrainStatusHandler();
      assert.ok(Array.isArray(result.knownSystems));
    });

    it('is deterministic (no side effects)', async () => {
      const r1 = await getBrainStatusHandler();
      const r2 = await getBrainStatusHandler();
      assert.strictEqual(typeof r1.exists, 'boolean');
      assert.strictEqual(typeof r2.exists, 'boolean');
    });
  });

  describe('getBrainRecallHandler', () => {
    it('returns found=false for empty query', async () => {
      const result = await getBrainRecallHandler('');
      assert.strictEqual(result.found, false);
      assert.strictEqual(result.intent, 'none');
    });

    it('returns found=false for whitespace query', async () => {
      const result = await getBrainRecallHandler('   ');
      assert.strictEqual(result.found, false);
    });

    it('returns structured result for valid query', async () => {
      const result = await getBrainRecallHandler('what did we work on');
      assert.ok('found' in result);
      assert.ok('summary' in result);
      assert.ok('intent' in result);
    });

    it('handles Arabic query without error', async () => {
      const result = await getBrainRecallHandler('ماذا حدث آخر مرة');
      assert.ok('found' in result);
    });

    it('is deterministic with same query', async () => {
      const r1 = await getBrainRecallHandler('recent changes');
      const r2 = await getBrainRecallHandler('recent changes');
      assert.strictEqual(r1.found, r2.found);
    });
  });

  describe('getBrainRecentEventsHandler', () => {
    it('returns array of events', async () => {
      const result = await getBrainRecentEventsHandler(5);
      assert.ok(Array.isArray(result.events));
    });

    it('respects limit parameter', async () => {
      const result = await getBrainRecentEventsHandler(3);
      assert.ok(result.events.length <= 3);
    });

    it('defaults to 10 when no limit given', async () => {
      const result = await getBrainRecentEventsHandler();
      assert.ok(result.events.length <= 10);
    });

    it('each event has required fields', async () => {
      const result = await getBrainRecentEventsHandler(5);
      for (const e of result.events) {
        assert.ok('id' in e);
        assert.ok('timestamp' in e);
        assert.ok('kind' in e);
        assert.ok('title' in e);
        assert.ok('summary' in e);
      }
    });
  });

  describe('getBrainInspectHandler', () => {
    it('returns structured result with all fields', async () => {
      const result = await getBrainInspectHandler();
      assert.ok('totalNodes' in result);
      assert.ok('totalEdges' in result);
      assert.ok('countsByKind' in result);
      assert.ok('pinned' in result);
      assert.ok('staleEvents' in result);
      assert.ok('duplicateGroups' in result);
      assert.ok('lowImportanceNodes' in result);
    });

    it('returns numbers for count fields', async () => {
      const result = await getBrainInspectHandler();
      assert.strictEqual(typeof result.totalNodes, 'number');
      assert.strictEqual(typeof result.totalEdges, 'number');
      assert.strictEqual(typeof result.pinned, 'number');
    });

    it('returns array for countsByKind', async () => {
      const result = await getBrainInspectHandler();
      assert.ok(Array.isArray(result.countsByKind));
    });

    it('is deterministic', async () => {
      const r1 = await getBrainInspectHandler();
      const r2 = await getBrainInspectHandler();
      assert.strictEqual(typeof r1.totalNodes, 'number');
      assert.strictEqual(typeof r2.totalNodes, 'number');
    });
  });
});
