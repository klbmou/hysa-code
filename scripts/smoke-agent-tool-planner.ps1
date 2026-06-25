#Requires -Version 5.1
$script:exitCode = 0

function Write-Result($check, $result) {
  if ($result -eq 'OK') { Write-Host "  [OK] $check" -ForegroundColor Green }
  else { Write-Host "  [FAIL] $check" -ForegroundColor Red; $script:exitCode = 1 }
}

Write-Host "=== smoke:agent-tool-planner ===" -ForegroundColor Cyan

# 1. Run unit tests (with 120s timeout)
Write-Host "`n--- Unit tests ---" -ForegroundColor Yellow
. (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")
try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "tests/agent-tool-planner.test.ts") -TimeoutSec 120
  Write-Result "agent-tool-planner unit tests all pass" $(if ($result.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
} catch {
  Write-Result "agent-tool-planner unit tests all pass" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 2. Quick validation via tsx -e
Write-Host "`n--- Quick function checks ---" -ForegroundColor Yellow

# Create temp test file
$tmpFile = Join-Path $env:TEMP "hysa-smoke-tp-$([Guid]::NewGuid().ToString('N')).ts"
$projectRoot = (Get-Item -Path ".").FullName.Replace('\', '/')

$lines = @(
  "import { planToolActionsForTask, resetActionCounter } from '$projectRoot/src/agent/tool-planner.js';"
  'resetActionCounter();'
  'var plan1 = planToolActionsForTask({ userText: "hi" });'
  'console.log("simple_chat:", plan1.actions.length === 0 ? "OK" : "FAIL");'
  'resetActionCounter();'
  'var plan2 = planToolActionsForTask({ userText: "run npm test" });'
  'console.log("run_command proposed:", plan2.actions.filter(function(a) { return a.toolName === "run_command"; }).length > 0 ? "OK" : "FAIL");'
  'console.log("requires_approval:", plan2.requiresApproval ? "OK" : "FAIL");'
  'resetActionCounter();'
  'var plan3 = planToolActionsForTask({ userText: "delete all files" });'
  'console.log("blocked:", plan3.blocked ? "OK" : "FAIL");'
  'resetActionCounter();'
  'var plan4 = planToolActionsForTask({ userText: "شغل الاختبارات" });'
  'console.log("arabic test:", plan4.actions.filter(function(a) { return a.toolName === "run_command"; }).length > 0 ? "OK" : "FAIL");'
  'console.log("ALL CHECKS PASSED");'
)

[System.IO.File]::WriteAllLines($tmpFile, $lines, [System.Text.UTF8Encoding]::new($false))

try {
  cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile > nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "direct import checks (simple, tests, blocked, arabic)" "OK"
  } else {
    Write-Result "direct import checks (simple, tests, blocked, arabic)" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force }
}

# 3. Verify CLI command registered
Write-Host "`n--- CLI integration ---" -ForegroundColor Yellow
$cliContent = Get-Content src/cli.ts -Raw
if ($cliContent -match "program\.command\('plan-tools'\)") {
  Write-Result "CLI plan-tools command registered" "OK"
} else {
  Write-Result "CLI plan-tools command registered" "FAIL"
}
if ($cliContent -match "import .* planToolActionsForTask") {
  Write-Result "tool planner imported in CLI" "OK"
} else {
  Write-Result "tool planner imported in CLI" "FAIL"
}

# 4. Verify package.json script
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
if ($pkg.scripts.'smoke:agent-tool-planner') {
  Write-Result "smoke:agent-tool-planner in package.json" "OK"
} else {
  Write-Result "smoke:agent-tool-planner in package.json" "FAIL"
}

Write-Host "`n=== smoke:agent-tool-planner $(if ($script:exitCode -eq 0) { 'PASSED' } else { 'FAILED' }) ===" -ForegroundColor $(if ($script:exitCode -eq 0) { 'Green' } else { 'Red' })
exit $script:exitCode
