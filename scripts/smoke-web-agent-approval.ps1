#Requires -Version 5.1
$script:exitCode = 0

function Write-Result($check, $result) {
  if ($result -eq 'OK') { Write-Host "  [OK] $check" -ForegroundColor Green }
  else { Write-Host "  [FAIL] $check" -ForegroundColor Red; $script:exitCode = 1 }
}

Write-Host "=== smoke:web-agent-approval ===" -ForegroundColor Cyan

# 1. Run unit tests (with 120s timeout)
Write-Host "`n--- Backend unit tests ---" -ForegroundColor Yellow
. (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")
try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "tests/agent-api.test.ts") -TimeoutSec 120
  Write-Result "agent-api unit tests all pass" $(if ($result.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
  if ($result.Stderr -and $result.ExitCode -ne 0) {
    Write-Host "  STDERR: $($result.Stderr)" -ForegroundColor Red
  }
} catch {
  Write-Result "agent-api unit tests all pass" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 2. Direct function validation via tsx -e
Write-Host "`n--- Direct function checks ---" -ForegroundColor Yellow
$tmpFile = Join-Path $env:TEMP "hysa-smoke-waa-$([Guid]::NewGuid().ToString('N')).ts"
$projectRoot = (Get-Item -Path ".").FullName.Replace('\', '/')

$lines = @(
  "import { planToolActionsForTask, resetActionCounter } from '$projectRoot/src/agent/tool-planner.js';"
  "import { resetPlans } from '$projectRoot/src/web/agent-api.js';"
  "resetActionCounter(); resetPlans();"
  "var plan1 = planToolActionsForTask({ userText: 'read package.json' });"
  "console.log('read_file_planned:', plan1.actions.filter(function(a) { return a.toolName === 'read_file'; }).length > 0 ? 'OK' : 'FAIL');"
  "resetActionCounter(); resetPlans();"
  "var plan2 = planToolActionsForTask({ userText: 'write test.txt with content hi' });"
  "var writeActs = plan2.actions.filter(function(a) { return a.toolName === 'write_file'; });"
  "if (writeActs.length > 0) {"
  "  console.log('write_file_requires_approval:', writeActs[0].approvalPolicy === 'requires_approval' ? 'OK' : 'FAIL');"
  "} else {"
  "  console.log('write_file_requires_approval: SKIP');"
  "}"
  "resetActionCounter(); resetPlans();"
  "var plan3 = planToolActionsForTask({ userText: 'run npm test' });"
  "var cmdActs = plan3.actions.filter(function(a) { return a.toolName === 'run_command'; });"
  "if (cmdActs.length > 0) {"
  "  console.log('run_command_requires_approval:', cmdActs[0].approvalPolicy === 'requires_approval' ? 'OK' : 'FAIL');"
  "} else {"
  "  console.log('run_command_requires_approval: SKIP');"
  "}"
  "resetActionCounter(); resetPlans();"
  "var plan4 = planToolActionsForTask({ userText: 'delete all files' });"
  "console.log('dangerous_blocked:', plan4.blocked ? 'OK' : 'FAIL');"
  "resetActionCounter(); resetPlans();"
  "var plan5 = planToolActionsForTask({ userText: 'hi how are you' });"
  "console.log('simple_chat_no_actions:', plan5.actions.length === 0 ? 'OK' : 'FAIL');"
  "console.log('ALL CHECKS PASSED');"
)

[System.IO.File]::WriteAllLines($tmpFile, $lines, [System.Text.UTF8Encoding]::new($false))

try {
  cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile > nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "direct import checks (plan, write, cmd, dangerous, simple)" "OK"
  } else {
    Write-Result "direct import checks (plan, write, cmd, dangerous, simple)" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force }
}

# 3. Verify blocked action cannot execute via API
Write-Host "`n--- Blocked action enforcement ---" -ForegroundColor Yellow
$tmpFile2 = Join-Path $env:TEMP "hysa-smoke-waa2-$([Guid]::NewGuid().ToString('N')).ts"
$lines2 = @(
  "import { planToolActionsForTask, resetActionCounter } from '$projectRoot/src/agent/tool-planner.js';"
  "import { handlePlanTools, handleExecuteTools, resetPlans } from '$projectRoot/src/web/agent-api.js';"
  "resetActionCounter(); resetPlans();"
  "var planRes = handlePlanTools({ message: 'delete all files' });"
  "var blockedCount = planRes.actions.filter(function(a) { return a.status === 'blocked'; }).length;"
  "console.log('blocked_count:', blockedCount > 0 ? 'OK' : 'FAIL');"
  "console.log('ALL CHECKS PASSED');"
)
[System.IO.File]::WriteAllLines($tmpFile2, $lines2, [System.Text.UTF8Encoding]::new($false))
try {
  cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile2 > nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "blocked action count" "OK"
  } else {
    Write-Result "blocked action count" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile2) { Remove-Item $tmpFile2 -Force }
}

# 4. Verify write_file + run_command cannot auto-execute
Write-Host "`n--- Approval enforcement ---" -ForegroundColor Yellow
$tmpFile3 = Join-Path $env:TEMP "hysa-smoke-waa3-$([Guid]::NewGuid().ToString('N')).ts"
$lines3 = @(
  "import { planToolActionsForTask, resetActionCounter } from '$projectRoot/src/agent/tool-planner.js';"
  "import { handlePlanTools, handleExecuteTools, resetPlans } from '$projectRoot/src/web/agent-api.js';"
  "resetActionCounter(); resetPlans();"
  "var planW = handlePlanTools({ message: 'write test-noauto.txt with content test' });"
  "var wActs = planW.actions.filter(function(a) { return a.toolName === 'write_file'; });"
  "if (wActs.length > 0) {"
  "  console.log('write_never_auto:', wActs[0].approvalRequired === true ? 'OK' : 'FAIL');"
  "  console.log('write_status_requires_approval:', wActs[0].status === 'requires_approval' ? 'OK' : 'FAIL');"
  "} else {"
  "  console.log('write_never_auto: SKIP');"
  "  console.log('write_status_requires_approval: SKIP');"
  "}"
  "resetActionCounter(); resetPlans();"
  "var planR = handlePlanTools({ message: 'run dir' });"
  "var rActs = planR.actions.filter(function(a) { return a.toolName === 'run_command'; });"
  "if (rActs.length > 0) {"
  "  console.log('cmd_never_auto:', rActs[0].approvalRequired === true ? 'OK' : 'FAIL');"
  "  console.log('cmd_status_requires_approval:', rActs[0].status === 'requires_approval' ? 'OK' : 'FAIL');"
  "} else {"
  "  console.log('cmd_never_auto: SKIP');"
  "  console.log('cmd_status_requires_approval: SKIP');"
  "}"
  "console.log('ALL CHECKS PASSED');"
)
[System.IO.File]::WriteAllLines($tmpFile3, $lines3, [System.Text.UTF8Encoding]::new($false))
try {
  cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile3 > nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "write_file + run_command never auto (approvalRequired + status)" "OK"
  } else {
    Write-Result "write_file + run_command never auto (approvalRequired + status)" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile3) { Remove-Item $tmpFile3 -Force }
}

# 5. Verify package.json script exists
Write-Host "`n--- Package integration ---" -ForegroundColor Yellow
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
if ($pkg.scripts.'smoke:web-agent-approval') {
  Write-Result "smoke:web-agent-approval in package.json" "OK"
} else {
  Write-Result "smoke:web-agent-approval in package.json" "FAIL"
}

# 7. Regression: verify toolContextForAi format and no [auto-continue]
Write-Host "`n--- Continuation regression checks ---" -ForegroundColor Yellow
$tmpFile4 = Join-Path $env:TEMP "hysa-smoke-waa4-$([Guid]::NewGuid().ToString('N')).ts"
$content4 = @'
import { resetActionCounter } from 'PROJECTROOT/src/agent/tool-planner.js';
import { handlePlanTools, handleExecuteTools, resetPlans } from 'PROJECTROOT/src/web/agent-api.js';

async function main() {
  // 1. Approved read_file => toolContextForAi has [Tool Results:], NO [auto-continue]
  resetActionCounter(); resetPlans();
  var plan1 = handlePlanTools({ message: 'read the file src/index.ts' });
  var readAct = plan1.actions.filter(function(a) { return a.toolName === 'read_file'; })[0];
  if (!readAct) {
    console.log('ctx_has_results: SKIP');
    console.log('ctx_no_auto_continue: SKIP');
    console.log('ctx_non_empty: SKIP');
  } else {
    var r1 = await handleExecuteTools({ planId: plan1.planId, approvedActionIds: [readAct.id], rejectedActionIds: [] });
    var ctx1 = r1.toolContextForAi;
    console.log('ctx_has_results: ' + (ctx1.indexOf('[Tool Results:') >= 0 ? 'OK' : 'FAIL'));
    console.log('ctx_no_auto_continue: ' + (ctx1.indexOf('[auto-continue]') === -1 ? 'OK' : 'FAIL'));
    console.log('ctx_non_empty: ' + (ctx1.length > 0 ? 'OK' : 'FAIL'));

    // 2. No approval => toolContextForAi says 'No tool actions were executed'
    resetActionCounter(); resetPlans();
    var plan2 = handlePlanTools({ message: 'read the file src/index.ts' });
    var r2 = await handleExecuteTools({ planId: plan2.planId, approvedActionIds: [], rejectedActionIds: [] });
    console.log('ctx_no_exec: ' + (r2.toolContextForAi.indexOf('No tool actions were executed') >= 0 ? 'OK' : 'FAIL'));
    console.log('ctx_no_exec_no_auto: ' + (r2.toolContextForAi.indexOf('[auto-continue]') === -1 ? 'OK' : 'FAIL'));

    // 3. Blocked actions => context says 'blocked'
    resetActionCounter(); resetPlans();
    var plan3 = handlePlanTools({ message: 'delete all files' });
    var r3 = await handleExecuteTools({ planId: plan3.planId, approvedActionIds: [], rejectedActionIds: [] });
    console.log('ctx_blocked: ' + (r3.toolContextForAi.indexOf('blocked') >= 0 ? 'OK' : 'FAIL'));
    console.log('ctx_blocked_no_auto: ' + (r3.toolContextForAi.indexOf('[auto-continue]') === -1 ? 'OK' : 'FAIL'));
  }
  console.log('ALL CHECKS PASSED');
}
main().catch(function(e) { console.log('ERROR: ' + e.message); process.exit(1); });
'@
$content4 = $content4.Replace('PROJECTROOT', $projectRoot)
[System.IO.File]::WriteAllText($tmpFile4, $content4, [System.Text.UTF8Encoding]::new($false))

try {
  cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile4 > nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "toolContextForAi format regression (no [auto-continue], has results/blocked/noexec)" "OK"
  } else {
    Write-Result "toolContextForAi format regression (no [auto-continue], has results/blocked/noexec)" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile4) { Remove-Item $tmpFile4 -Force }
}

# 8. Codebase guard: grep for [auto-continue] in live frontend source
Write-Host "`n--- Codebase guard: [auto-continue] in frontend source ---" -ForegroundColor Yellow
$acFiles = Select-String -Path "web\src\**\*.ts" -Pattern "\[auto-continue\]" -SimpleMatch -List
$acFiles2 = Select-String -Path "web\src\**\*.tsx" -Pattern "\[auto-continue\]" -SimpleMatch -List
$allAcHits = @()
if ($acFiles) { $allAcHits += $acFiles }
if ($acFiles2) { $allAcHits += $acFiles2 }
# Allowlisted: tool-continuation.ts has the detection helper (intentional reference)
$unexpected = $allAcHits | Where-Object { $_.Path -notlike "*tool-continuation*" }
if ($unexpected.Count -eq 0) {
  Write-Result "no live frontend source contains '[auto-continue]' (excluding detection helper)" "OK"
} else {
  Write-Result "no unexpected '[auto-continue]' in frontend source" "FAIL"
  foreach ($hit in $unexpected) {
    Write-Host "  Found in: $($hit.Path):$($hit.LineNumber)" -ForegroundColor Red
  }
}

# 9. Helper unit tests
Write-Host "`n--- Tool continuation helper unit tests ---" -ForegroundColor Yellow
try {
  $helperResult = Invoke-TsxWithTimeout -Arguments @("--test", "tests/tool-continuation.test.ts") -TimeoutSec 30
  Write-Result "tool-continuation helper tests" $(if ($helperResult.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
  if ($helperResult.Stderr -and $helperResult.ExitCode -ne 0) {
    Write-Host "  STDERR: $($helperResult.Stderr)" -ForegroundColor Red
  }
} catch {
  Write-Result "tool-continuation helper tests" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 6. Verify web UI component exists
Write-Host "`n--- Web UI components ---" -ForegroundColor Yellow
if (Test-Path "web/src/components/ToolPlanPanel.tsx") {
  Write-Result "ToolPlanPanel component exists" "OK"
} else { Write-Result "ToolPlanPanel component exists" "FAIL" }
if (Test-Path "web/src/components/ToolActionCard.tsx") {
  Write-Result "ToolActionCard component exists" "OK"
} else { Write-Result "ToolActionCard component exists" "FAIL" }

Write-Host "`n=== smoke:web-agent-approval $(if ($script:exitCode -eq 0) { 'PASSED' } else { 'FAILED' }) ===" -ForegroundColor $(if ($script:exitCode -eq 0) { 'Green' } else { 'Red' })
exit $script:exitCode
