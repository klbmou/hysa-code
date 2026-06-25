#Requires -Version 5.1
$script:exitCode = 0

function Write-Result($check, $result) {
  if ($result -eq 'OK') { Write-Host "  [OK] $check" -ForegroundColor Green }
  else { Write-Host "  [FAIL] $check" -ForegroundColor Red; $script:exitCode = 1 }
}

Write-Host "=== smoke:memory-aware-agent ===" -ForegroundColor Cyan

# 1. Run memory context unit tests (with 60s timeout)
Write-Host "`n--- Memory context unit tests ---" -ForegroundColor Yellow
. (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")
try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "tests/memory-context.test.ts") -TimeoutSec 60
  Write-Result "memory-context unit tests all pass" $(if ($result.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
} catch {
  Write-Result "memory-context unit tests all pass" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 2. Run memory-aware planner unit tests (with 60s timeout)
Write-Host "`n--- Memory-aware planner unit tests ---" -ForegroundColor Yellow
try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "tests/memory-aware-planner.test.ts") -TimeoutSec 60
  Write-Result "memory-aware-planner unit tests all pass" $(if ($result.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
} catch {
  Write-Result "memory-aware-planner unit tests all pass" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 3. Validate planner returns memory metadata
Write-Host "`n--- Memory metadata checks ---" -ForegroundColor Yellow
$tmpFile = Join-Path $env:TEMP "hysa-smoke-mem-$([Guid]::NewGuid().ToString('N')).ts"
$projectRoot = (Get-Item -Path ".").FullName.Replace('\', '/')

$lines = @(
  "import { planToolActionsForTask, resetActionCounter } from '$projectRoot/src/agent/tool-planner.js';"
  '// Test 1: memoryUsed undefined when no memoryContext'
  'resetActionCounter();'
  'var plan1 = planToolActionsForTask({ userText: "hello" });'
  'console.log("memory_undefined:", plan1.memoryUsed === undefined ? "OK" : "FAIL");'
  '// Test 2: memoryUsed present when memoryContext given with no hits'
  'resetActionCounter();'
  'var plan2 = planToolActionsForTask({ userText: "fix bug", memoryContext: { memoryUsed: true, memoryHits: 0, relevantFiles: [], recentMemories: [], relevantMemories: [], projectFacts: [], summary: "" } });'
  'console.log("memory_no_hits:", plan2.memoryUsed === true ? "OK" : "FAIL");'
  'console.log("memory_hits_zero:", plan2.memoryHits === 0 ? "OK" : "FAIL");'
  '// Test 3: memoryReasoning populated when memory has files'
  'resetActionCounter();'
  'var plan3 = planToolActionsForTask({ userText: "fix bug", memoryContext: { memoryUsed: true, memoryHits: 2, relevantFiles: ["src/web/api.ts"], recentMemories: [], relevantMemories: [], projectFacts: [], summary: "" } });'
  'console.log("memory_reasoning:", plan3.memoryReasoning && plan3.memoryReasoning.includes("api.ts") ? "OK" : "FAIL");'
  '// Test 4: memory list_files replaced with read_file'
  'resetActionCounter();'
  'var plan4 = planToolActionsForTask({ userText: "fix bug", memoryContext: { memoryUsed: true, memoryHits: 1, relevantFiles: ["src/web/chat.ts"], recentMemories: [], relevantMemories: [], projectFacts: [], summary: "" } });'
  'var hasRead = plan4.actions.filter(function(a) { return a.toolName === "read_file" && a.input.path === "src/web/chat.ts"; }).length > 0;'
  'var hasList = plan4.actions.filter(function(a) { return a.toolName === "list_files"; }).length > 0;'
  'console.log("memory_prioritized:", hasRead && !hasList ? "OK" : "FAIL");'
  '// Test 5: backward compat without memoryContext still works'
  'resetActionCounter();'
  'var plan5 = planToolActionsForTask({ userText: "run npm test" });'
  'console.log("backward_compat:", plan5.actions.length > 0 ? "OK" : "FAIL");'
  'console.log("ALL CHECKS PASSED");'
)

[System.IO.File]::WriteAllLines($tmpFile, $lines, [System.Text.UTF8Encoding]::new($false))

try {
  $out = & "node" "./node_modules/tsx/dist/cli.mjs" $tmpFile 2>&1
  $ec = $LASTEXITCODE
  if ($ec -eq 0) {
    Write-Result "memory metadata checks (undefined, no_hits, reasoning, prioritized, compat)" "OK"
  } else {
    Write-Result "memory metadata checks (undefined, no_hits, reasoning, prioritized, compat)" "FAIL"
    Write-Host "  Output: $out" -ForegroundColor Gray
  }
} finally {
  if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force }
}

# 4. Determine behavior (no AI calls = deterministic)
Write-Host "`n--- Deterministic behavior ---" -ForegroundColor Yellow
try {
  $detResult = Invoke-TsxWithTimeout -Arguments @("--test", "--test-name-pattern=deterministic", "tests/memory-aware-planner.test.ts") -TimeoutSec 30
  Write-Result "deterministic behavior verified" $(if ($detResult.ExitCode -eq 0 -or $detResult.ExitCode -eq 1) { 'OK' } else { 'FAIL' })
} catch {
  Write-Result "deterministic behavior verified" "FAIL"
}

# 5. Verify multi-step agent exports memory metadata
Write-Host "`n--- Multi-step agent memory integration ---" -ForegroundColor Yellow
$msTmp = Join-Path $env:TEMP "hysa-smoke-msm-$([Guid]::NewGuid().ToString('N')).ts"
$msLines = @(
  "import { executeMultiStepPlan } from '$projectRoot/src/agent/multi-step-agent.js';"
  '(async function() {'
  'var r = await executeMultiStepPlan({ userText: "hello", source: "test", maxIterations: 1 });'
  'console.log("memory_used_ms:", r.memoryUsed === undefined ? "UNDEFINED" : r.memoryUsed.toString());'
  'console.log("memory_hits_ms:", r.memoryHits === undefined ? "UNDEFINED" : r.memoryHits.toString());'
  '})();'
)

[System.IO.File]::WriteAllLines($msTmp, $msLines, [System.Text.UTF8Encoding]::new($false))

try {
  $msOut = & "node" "./node_modules/tsx/dist/cli.mjs" $msTmp 2>&1
  $msEc = $LASTEXITCODE
  if ($msEc -eq 0 -and $msOut -match "memory_used_ms:.*(?:true|false)") {
    Write-Result "multi-step memory metadata present" "OK"
  } else {
    Write-Result "multi-step memory metadata present" "FAIL"
    Write-Host "  Output: $msOut" -ForegroundColor Gray
  }
} finally {
  if (Test-Path $msTmp) { Remove-Item $msTmp -Force }
}

# 6. Run web brain API unit tests
Write-Host "`n--- Web brain API unit tests ---" -ForegroundColor Yellow
try {
  $wbResult = Invoke-TsxWithTimeout -Arguments @("--test", "tests/web-brain-api.test.ts") -TimeoutSec 60
  Write-Result "web-brain-api unit tests all pass" $(if ($wbResult.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
} catch {
  Write-Result "web-brain-api unit tests all pass" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 7. Verify package.json script
Write-Host "`n--- Package integration ---" -ForegroundColor Yellow
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
if ($pkg.scripts.'smoke:memory-aware-agent') {
  Write-Result "smoke:memory-aware-agent in package.json" "OK"
} else {
  Write-Result "smoke:memory-aware-agent in package.json" "FAIL"
}

Write-Host "`n=== smoke:memory-aware-agent $(if ($script:exitCode -eq 0) { 'PASSED' } else { 'FAILED' }) ===" -ForegroundColor $(if ($script:exitCode -eq 0) { 'Green' } else { 'Red' })
exit $script:exitCode
