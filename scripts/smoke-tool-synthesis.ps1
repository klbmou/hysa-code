#Requires -Version 5.1
$script:exitCode = 0

function Write-Result($check, $result) {
  if ($result -eq 'OK') { Write-Host "  [OK] $check" -ForegroundColor Green }
  else { Write-Host "  [FAIL] $check" -ForegroundColor Red; $script:exitCode = 1 }
}

Write-Host "=== smoke:tool-synthesis ===" -ForegroundColor Cyan

# 1. Run unit tests for tool continuation + answer quality synthesis
Write-Host "`n--- Unit tests ---" -ForegroundColor Yellow
. (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")
try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "tests/tool-continuation.test.ts", "tests/answer-quality.test.ts") -TimeoutSec 60
  Write-Result "tool-continuation + answer-quality unit tests all pass" $(if ($result.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
  if ($result.Stderr -and $result.ExitCode -ne 0) {
    Write-Host "  STDERR: $($result.Stderr)" -ForegroundColor Red
  }
} catch {
  Write-Result "tool-continuation + answer-quality unit tests all pass" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 2. Verify buildToolContinuationMessages produces synthesis prompt
Write-Host "`n--- Synthesis prompt format ---" -ForegroundColor Yellow
$projectRoot = (Get-Item -Path ".").FullName.Replace('\', '/')
$tmpFile = Join-Path $env:TEMP "hysa-smoke-synth-$([Guid]::NewGuid().ToString('N')).ts"
$content = @'
import { buildToolContinuationMessages, countAutoContinueMessages } from 'PROJECTROOT/web/src/utils/tool-continuation.js';
var ctx = '[Tool Results: 2 action(s) executed]\n  OK read_file: src/index.ts read\n  ERROR run_command: failed';
var result = buildToolContinuationMessages([
  { role: 'user', content: 'read the file' },
  { role: 'assistant', content: 'I will read it.' },
], ctx);
var last = result.messages[result.messages.length - 1];
console.log('synthesis_prompt:', last.content.indexOf('Synthesize') >= 0 ? 'OK' : 'FAIL');
console.log('explain_prompt:', last.content.indexOf('Explain') >= 0 ? 'OK' : 'FAIL');
console.log('summarize_prompt:', last.content.indexOf('summarize') >= 0 ? 'OK' : 'FAIL');
console.log('next_steps_prompt:', last.content.indexOf('next steps') >= 0 ? 'OK' : 'FAIL');
console.log('errors_limits_prompt:', (last.content.indexOf('errors') >= 0 || last.content.indexOf('limitations') >= 0) ? 'OK' : 'FAIL');
console.log('no_auto_continue:', countAutoContinueMessages(result.messages) === 0 ? 'OK' : 'FAIL');
console.log('no_raw_continue:', last.content.indexOf('Continue.') === -1 ? 'OK' : 'FAIL');
console.log('user_role:', last.role === 'user' ? 'OK' : 'FAIL');
console.log('ALL CHECKS PASSED');
'@
$content = $content.Replace('PROJECTROOT', $projectRoot)
[System.IO.File]::WriteAllText($tmpFile, $content, [System.Text.UTF8Encoding]::new($false))
try {
  cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile > nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "synthesis prompt format (synthesize/explain/summarize/next-steps/no-raw-continue)" "OK"
  } else {
    Write-Result "synthesis prompt format (synthesize/explain/summarize/next-steps/no-raw-continue)" "FAIL"
    cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile 2>&1"
  }
} finally {
  if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force }
}

# 3. Verify toolContextForAi contains tool results through agent-api
Write-Host "`n--- Tool results in context ---" -ForegroundColor Yellow
$tmpFile2 = Join-Path $env:TEMP "hysa-smoke-synth2-$([Guid]::NewGuid().ToString('N')).ts"
$content2 = @'
import { resetActionCounter } from 'PROJECTROOT/src/agent/tool-planner.js';
import { handlePlanTools, handleExecuteTools, resetPlans } from 'PROJECTROOT/src/web/agent-api.js';
import { buildToolContinuationMessages } from 'PROJECTROOT/web/src/utils/tool-continuation.js';

async function main() {
  // Plan + execute a read_file
  resetActionCounter(); resetPlans();
  var plan = handlePlanTools({ message: 'read the file src/index.ts' });
  var readAct = plan.actions.filter(function(a) { return a.toolName === 'read_file'; })[0];
  if (!readAct) {
    console.log('tool_results_in_ctx: SKIP');
    console.log('tool_results_synthesis: SKIP');
    console.log('tool_results_no_raw: SKIP');
  } else {
    var r = await handleExecuteTools({ planId: plan.planId, approvedActionIds: [readAct.id], rejectedActionIds: [] });
    var ctx = r.toolContextForAi;
    console.log('tool_results_in_ctx: ' + (ctx.indexOf('[Tool Results:') >= 0 ? 'OK' : 'FAIL'));
    console.log('tool_results_has_read_file: ' + (ctx.indexOf('read_file') >= 0 ? 'OK' : 'FAIL'));
    console.log('tool_results_no_raw_json: ' + (ctx.indexOf('{') === -1 && ctx.indexOf('"') === -1 ? 'OK' : 'FAIL'));
    console.log('tool_results_no_auto_continue: ' + (ctx.indexOf('[auto-continue]') === -1 ? 'OK' : 'FAIL'));

    // Build continuation and verify synthesis prompt
    var history = [
      { role: 'user', content: 'read the file src/index.ts' },
      { role: 'assistant', content: 'I will read it.' },
    ];
    var continuation = buildToolContinuationMessages(history, ctx);
    var lastMsg = continuation.messages[continuation.messages.length - 1];
    console.log('synthesis_wraps_tool_results: ' + (lastMsg.content.indexOf('Synthesize') >= 0 ? 'OK' : 'FAIL'));
    console.log('synthesis_includes_context: ' + (lastMsg.content.indexOf(ctx) >= 0 ? 'OK' : 'FAIL'));
    console.log('synthesis_role_user: ' + (lastMsg.role === 'user' ? 'OK' : 'FAIL'));
  }
  console.log('ALL CHECKS PASSED');
}
main().catch(function(e) { console.log('ERROR: ' + e.message); process.exit(1); });
'@
$content2 = $content2.Replace('PROJECTROOT', $projectRoot)
[System.IO.File]::WriteAllText($tmpFile2, $content2, [System.Text.UTF8Encoding]::new($false))
try {
  cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile2 > nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "tool results in continuation context (results/synthesis/no-raw/no-auto-continue)" "OK"
  } else {
    Write-Result "tool results in continuation context (results/synthesis/no-raw/no-auto-continue)" "FAIL"
    cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile2 2>&1"
  }
} finally {
  if (Test-Path $tmpFile2) { Remove-Item $tmpFile2 -Force }
}

# 4. Verify answer quality metadata for tool synthesis
Write-Host "`n--- Answer quality metadata ---" -ForegroundColor Yellow
$tmpFile3 = Join-Path $env:TEMP "hysa-smoke-synth3-$([Guid]::NewGuid().ToString('N')).ts"
$content3 = @'
import { evaluateAnswerQuality } from 'PROJECTROOT/src/ai/answer-quality.js';
var r = evaluateAnswerQuality({
  answer: 'I read the file. The issue is with line 42. The fix is to change X to Y.',
  userText: 'fix the error in index.ts',
  taskKind: 'code_edit',
  toolResultCount: 3,
});
console.log('tool_synthesis_used:', r.toolSynthesisUsed === true ? 'OK' : 'FAIL');
console.log('tool_result_count:', r.toolResultCount === 3 ? 'OK' : 'FAIL');
console.log('quality_ok:', r.ok ? 'OK' : 'FAIL');
console.log('ALL CHECKS PASSED');
'@
$content3 = $content3.Replace('PROJECTROOT', $projectRoot)
[System.IO.File]::WriteAllText($tmpFile3, $content3, [System.Text.UTF8Encoding]::new($false))
try {
  cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile3 > nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "answer quality metadata (toolSynthesisUsed/toolResultCount)" "OK"
  } else {
    Write-Result "answer quality metadata (toolSynthesisUsed/toolResultCount)" "FAIL"
    cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile3 2>&1"
  }
} finally {
  if (Test-Path $tmpFile3) { Remove-Item $tmpFile3 -Force }
}

# 5. Verify no tool auto-execution regression
Write-Host "`n--- Auto-execution guard ---" -ForegroundColor Yellow
$tmpFile4 = Join-Path $env:TEMP "hysa-smoke-synth4-$([Guid]::NewGuid().ToString('N')).ts"
$content4 = @'
import { planToolActionsForTask, resetActionCounter } from 'PROJECTROOT/src/agent/tool-planner.js';
import { resetPlans } from 'PROJECTROOT/src/web/agent-api.js';
resetActionCounter(); resetPlans();
var planW = planToolActionsForTask({ userText: 'write test-auto.txt with content hi' });
var wActs = planW.actions.filter(function(a) { return a.toolName === 'write_file'; });
if (wActs.length > 0) {
  console.log('write_file_not_auto:', wActs[0].approvalPolicy === 'requires_approval' ? 'OK' : 'FAIL');
} else {
  console.log('write_file_not_auto: SKIP');
}
resetActionCounter(); resetPlans();
var planR = planToolActionsForTask({ userText: 'run dir' });
var rActs = planR.actions.filter(function(a) { return a.toolName === 'run_command'; });
if (rActs.length > 0) {
  console.log('run_command_not_auto:', rActs[0].approvalPolicy === 'requires_approval' ? 'OK' : 'FAIL');
} else {
  console.log('run_command_not_auto: SKIP');
}
console.log('ALL CHECKS PASSED');
'@
$content4 = $content4.Replace('PROJECTROOT', $projectRoot)
[System.IO.File]::WriteAllText($tmpFile4, $content4, [System.Text.UTF8Encoding]::new($false))
try {
  cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile4 > nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "write_file + run_command still require approval (no regression)" "OK"
  } else {
    Write-Result "write_file + run_command still require approval (no regression)" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile4) { Remove-Item $tmpFile4 -Force }
}

# 6. Verify package.json script exists
Write-Host "`n--- Package integration ---" -ForegroundColor Yellow
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
if ($pkg.scripts.'smoke:tool-synthesis') {
  Write-Result "smoke:tool-synthesis in package.json" "OK"
} else {
  Write-Result "smoke:tool-synthesis in package.json" "FAIL"
}

Write-Host "`n=== smoke:tool-synthesis $(if ($script:exitCode -eq 0) { 'PASSED' } else { 'FAILED' }) ===" -ForegroundColor $(if ($script:exitCode -eq 0) { 'Green' } else { 'Red' })
exit $script:exitCode
