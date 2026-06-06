import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { generatePlan, clonePlan, updateStepStatus, markStepRunning, markStepDone, markStepFailed, inferStepFromToolCall, buildFinalReport, shouldPlanFor } from '../src/ai/planner.js';

describe('plan execution state', () => {
  const editRequest = 'fix the bug in src/app.ts that causes the login to fail';
  const plan = generatePlan(editRequest, 'debugging')!;

  it('generatePlan produces steps for complex tasks', () => {
    assert.ok(plan);
    assert.equal(plan.riskLevel, 'low');
    assert.ok(plan.steps.length >= 4);
    assert.ok(plan.files.includes('src/app.ts'));
    assert.ok(plan.goal.includes('Debug') || plan.goal.includes('debug'));
  });

  it('shouldPlanFor returns true for complex tasks', () => {
    assert.ok(shouldPlanFor('code_edit'));
    assert.ok(shouldPlanFor('debugging'));
    assert.ok(shouldPlanFor('code_review'));
    assert.ok(shouldPlanFor('planning'));
    assert.ok(shouldPlanFor('project_scan'));
  });

  it('shouldPlanFor returns false for simple tasks', () => {
    assert.equal(shouldPlanFor('simple_chat'), false);
    assert.equal(shouldPlanFor('search'), false);
    assert.equal(shouldPlanFor('general_qa'), false);
    assert.equal(shouldPlanFor('unknown'), false);
  });

  it('clonePlan creates independent copy', () => {
    const cloned = clonePlan(plan!);
    assert.equal(cloned.goal, plan!.goal);
    assert.equal(cloned.steps.length, plan!.steps.length);
    assert.notEqual(cloned.steps, plan!.steps);
    assert.notEqual(cloned.steps[0], plan!.steps[0]);
  });

  it('updateStepStatus updates a single step status', () => {
    const stepIndex = 0;
    const updated = updateStepStatus(plan!, stepIndex, 'running');
    assert.equal(updated.steps[stepIndex].status, 'running');
    assert.equal(plan!.steps[stepIndex].status, 'pending');
  });

  it('markStepRunning sets step to running', () => {
    const r = markStepRunning(plan!, 0);
    assert.equal(r.steps[0].status, 'running');
  });

  it('markStepDone sets step to done', () => {
    const d = markStepDone(plan!, 0);
    assert.equal(d.steps[0].status, 'done');
  });

  it('markStepFailed sets step to failed', () => {
    const f = markStepFailed(plan!, 0);
    assert.equal(f.steps[0].status, 'failed');
  });

  it('inferStepFromToolCall maps read_file to Read step', () => {
    const idx = inferStepFromToolCall('read_file', { filePath: 'src/app.ts' }, plan!);
    assert.ok(idx >= 0);
    assert.ok(plan!.steps[idx].description.toLowerCase().startsWith('read'));
  });

  it('inferStepFromToolCall maps edit_file to edit/fix step', () => {
    const idx = inferStepFromToolCall('edit_file', { filePath: 'src/app.ts', content: 'fixed' }, plan!);
    assert.ok(idx >= 0);
    const desc = plan!.steps[idx].description.toLowerCase();
    assert.ok(/edit|fix|implement|change|apply/i.test(desc));
  });

  it('inferStepFromToolCall maps execute_command with verify to verify step', () => {
    const cmdPlan = generatePlan('verify fix in src/app.ts', 'code_edit')!;
    const idx = inferStepFromToolCall('execute_command', { command: 'npm test verify-fix' }, cmdPlan);
    assert.ok(idx >= 0);
  });

  it('inferStepFromToolCall maps unknown tool to first pending step', () => {
    const idx = inferStepFromToolCall('unknown_tool', {}, plan!);
    assert.ok(idx >= 0);
    assert.equal(plan!.steps[idx].status, 'pending');
  });

  it('buildFinalReport shows all completed', () => {
    let p = plan!;
    p.steps.forEach((_, i) => { p = markStepDone(p, i); });
    const report = buildFinalReport(p, ['src/app.ts', 'src/utils.ts'], 2);
    assert.equal(report.finalStatus, 'completed');
    assert.equal(report.completedSteps, p.steps.length);
    assert.equal(report.failedSteps, 0);
    assert.equal(report.filesTouched.length, 2);
    assert.equal(report.commandsRun, 2);
  });

  it('buildFinalReport shows failed', () => {
    let p = plan!;
    p.steps.forEach((_, i) => { p = markStepDone(p, i); });
    p = markStepFailed(p, 1);
    const report = buildFinalReport(p, [], 0);
    assert.equal(report.finalStatus, 'failed');
    assert.equal(report.failedSteps, 1);
  });

  it('buildFinalReport shows partial when no done/failed', () => {
    const report = buildFinalReport(plan!, [], 0);
    assert.equal(report.finalStatus, 'partial');
  });

  it('buildFinalReport shows partial instead of failed when response succeeded and some steps completed', () => {
    let p = plan!;
    p.steps.forEach((_, i) => { p = markStepDone(p, i); });
    p = markStepFailed(p, 1);
    const report = buildFinalReport(p, [], 0, true);
    assert.equal(report.finalStatus, 'partial', 'recovered failure should be partial, not failed');
    assert.equal(report.failedSteps, 1);
    assert.equal(report.completedSteps, p.steps.length - 1);
  });

  it('buildFinalReport shows failed when response succeeded but no steps completed', () => {
    let p = plan!;
    p.steps.forEach((_, i) => { p = markStepFailed(p, i); });
    const report = buildFinalReport(p, [], 0, true);
    assert.equal(report.finalStatus, 'failed', 'all steps failed even with response');
    assert.equal(report.failedSteps, p.steps.length);
    assert.equal(report.completedSteps, 0);
  });

  it('buildFinalReport with recovered failures shows failed when responseSucceeded is false (legacy behavior)', () => {
    let p = plan!;
    p.steps.forEach((_, i) => { p = markStepDone(p, i); });
    p = markStepFailed(p, 1);
    const report = buildFinalReport(p, [], 0, false);
    assert.equal(report.finalStatus, 'failed', 'without responseSucceeded flag, failed steps remain failed');
  });

  it('buildFinalReport with recovered failures shows failed when responseSucceeded is omitted (backward compat)', () => {
    let p = plan!;
    p.steps.forEach((_, i) => { p = markStepDone(p, i); });
    p = markStepFailed(p, 1);
    const report = buildFinalReport(p, [], 0);
    assert.equal(report.finalStatus, 'failed', 'default behavior without flag must remain failed');
  });

  it('generatePlan returns null for non-complex tasks', () => {
    assert.equal(generatePlan('hi there', 'simple_chat'), null);
  });

  it('steps start as pending', () => {
    plan!.steps.forEach(s => assert.equal(s.status, 'pending'));
  });

  it('inferStepFromToolCall with matching file returns correct step', () => {
    const testPlan = generatePlan('refactor src/utils.ts', 'code_edit')!;
    const readIdx = inferStepFromToolCall('read_file', { filePath: 'src/utils.ts' }, testPlan);
    assert.ok(readIdx >= 0);
    assert.ok(testPlan.steps[readIdx].description.toLowerCase().includes('read'));
  });
});
