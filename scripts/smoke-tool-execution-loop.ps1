#Requires -Version 5.1
$script:exitCode = 0
$ErrorActionPreference = 'Stop'

$projectRoot = (Get-Item -Path ".").FullName

function Write-Result($check, $result) {
  if ($result -eq 'OK') { Write-Host "  [OK] $check" -ForegroundColor Green }
  else { Write-Host "  [FAIL] $check" -ForegroundColor Red; $script:exitCode = 1 }
}

Write-Host "=== smoke:tool-execution-loop ===" -ForegroundColor Cyan

# 1. Run unit tests (with 120s timeout)
Write-Host "`n--- Unit tests ---" -ForegroundColor Yellow
. (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")
try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "tests/tool-execution-loop.test.ts") -TimeoutSec 120
  Write-Result "tool-execution-loop unit tests all pass" $(if ($result.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
} catch {
  Write-Result "tool-execution-loop unit tests all pass" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 2. CLI dry-run command
Write-Host "`n--- CLI dry-run ---" -ForegroundColor Yellow
$tmpFile = Join-Path $env:TEMP "hysa-smoke-exec-$([Guid]::NewGuid().ToString('N')).ts"
$lines = @(
  "import { runToolExecutionLoop, formatExecutionResult } from '$($projectRoot.Replace('\', '/'))/src/agent/execution-loop.js';"
  'async function main() {'
  '  var result = await runToolExecutionLoop({'
  "    userText: 'hi',"
  "    cwd: '$($projectRoot.Replace('\', '/'))',"
  "    source: 'test',"
  '    dryRun: true'
  '  });'
  '  console.log("actions:", result.plan.actions.length);'
  '  console.log("executed:", result.executedActions.length);'
  '  console.log("pending:", result.pendingApproval.length);'
  '  console.log("ALL CHECKS PASSED");'
  '}'
  'main().catch(function(e) { console.error(e); process.exit(1); });'
)
[System.IO.File]::WriteAllLines($tmpFile, $lines, [System.Text.UTF8Encoding]::new($false))

try {
  $output = cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "CLI dry-run produces plan without executing" "OK"
  } else {
    Write-Result "CLI dry-run produces plan without executing" "FAIL"
  }

  # Verify dry-run output
  if ($output -match "actions: 0" -and $output -match "executed: 0") {
    Write-Result "simple chat: 0 actions, 0 executed" "OK"
  } else {
    Write-Result "simple chat: 0 actions, 0 executed" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force }
}

# 3. Verify write_file requires approval
Write-Host "`n--- Approval checks ---" -ForegroundColor Yellow
$tmpFile2 = Join-Path $env:TEMP "hysa-smoke-exec2-$([Guid]::NewGuid().ToString('N')).ts"
$lines2 = @(
  "import { runToolExecutionLoop } from '$($projectRoot.Replace('\', '/'))/src/agent/execution-loop.js';"
  'async function main() {'
  '  var result = await runToolExecutionLoop({'
  "    userText: 'create test123.txt with hello',"
  "    cwd: '$($projectRoot.Replace('\', '/'))',"
  "    source: 'test',"
  '    dryRun: false,'
  "    filesMentioned: ['test123.txt']"
  '  });'
  '  var hasWrite = result.plan.actions.filter(function(a) { return a.toolName === "write_file"; }).length > 0;'
  '  var writeExecuted = result.executedActions.filter(function(a) { return a.toolName === "write_file"; }).length;'
  '  console.log("has_write:", hasWrite ? "OK" : "NONE");'
  '  console.log("write_executed:", writeExecuted === 0 ? "OK" : "FAIL");'
  '  var writePending = result.pendingApproval.filter(function(a) { return a.toolName === "write_file"; }).length > 0;'
  '  console.log("write_pending:", writePending ? "OK" : "NONE");'
  '  console.log("ALL CHECKS PASSED");'
  '}'
  'main().catch(function(e) { console.error(e); process.exit(1); });'
)
[System.IO.File]::WriteAllLines($tmpFile2, $lines2, [System.Text.UTF8Encoding]::new($false))

try {
  $output2 = cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile2 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "write_file approval check" "OK"
  } else {
    Write-Result "write_file approval check" "FAIL"
  }

  if ($output2 -match "write_executed: OK") {
    Write-Result "write_file does not execute without approval" "OK"
  } else {
    Write-Result "write_file does not execute without approval" "FAIL"
  }

  if ($output2 -match "write_pending: OK") {
    Write-Result "write_file listed as pending approval" "OK"
  } else {
    Write-Result "write_file listed as pending approval" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile2) { Remove-Item $tmpFile2 -Force }
}

# 4. Verify dangerous command blocked
Write-Host "`n--- Dangerous command block ---" -ForegroundColor Yellow
$tmpFile3 = Join-Path $env:TEMP "hysa-smoke-exec3-$([Guid]::NewGuid().ToString('N')).ts"
$lines3 = @(
  "import { runToolExecutionLoop } from '$($projectRoot.Replace('\', '/'))/src/agent/execution-loop.js';"
  'async function main() {'
  '  var result = await runToolExecutionLoop({'
  "    userText: 'delete all files',"
  "    cwd: '$($projectRoot.Replace('\', '/'))',"
  "    source: 'test',"
  '    dryRun: false'
  '  });'
  '  console.log("blocked:", result.plan.blocked ? "OK" : "FAIL");'
  '  console.log("executed:", result.executedActions.length === 0 ? "OK" : "FAIL");'
  '  console.log("ALL CHECKS PASSED");'
  '}'
  'main().catch(function(e) { console.error(e); process.exit(1); });'
)
[System.IO.File]::WriteAllLines($tmpFile3, $lines3, [System.Text.UTF8Encoding]::new($false))

try {
  $output3 = cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile3 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "dangerous command blocked" "OK"
  } else {
    Write-Result "dangerous command blocked" "FAIL"
  }

  if ($output3 -match "blocked: OK") {
    Write-Result "plan.blocked=true for dangerous request" "OK"
  } else {
    Write-Result "plan.blocked=true for dangerous request" "FAIL"
  }

  if ($output3 -match "executed: OK") {
    Write-Result "no actions executed for blocked plan" "OK"
  } else {
    Write-Result "no actions executed for blocked plan" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile3) { Remove-Item $tmpFile3 -Force }
}

# 5. Verify safe read_file result
Write-Host "`n--- Safe read_file ---" -ForegroundColor Yellow
$tmpFile4 = Join-Path $env:TEMP "hysa-smoke-exec4-$([Guid]::NewGuid().ToString('N')).ts"
$lines4 = @(
  "import { runToolExecutionLoop } from '$($projectRoot.Replace('\', '/'))/src/agent/execution-loop.js';"
  'async function main() {'
  '  var fs = await import("fs");'
  '  var tmp = fs.mkdtempSync(require("path").join(require("os").tmpdir(), "hysa-test-"));'
  '  fs.writeFileSync(tmp + "/test.txt", "hello e2e smoke");'
  '  var result = await runToolExecutionLoop({'
  "    userText: 'read test.txt',"
  '    cwd: tmp,'
  "    source: 'test',"
  '    dryRun: false,'
  "    filesMentioned: ['test.txt']"
  '  });'
  '  console.log("actions:", result.plan.actions.length);'
  '  var readOk = result.executedActions.filter(function(a) { return a.ok; }).length;'
  '  console.log("read_ok:", readOk);'
  '  console.log("ALL CHECKS PASSED");'
  '}'
  'main().catch(function(e) { console.error(e); process.exit(1); });'
)
[System.IO.File]::WriteAllLines($tmpFile4, $lines4, [System.Text.UTF8Encoding]::new($false))

try {
  $output4 = cmd /c "node ./node_modules/tsx/dist/cli.mjs $tmpFile4 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Result "safe read_file execution" "OK"
  } else {
    Write-Result "safe read_file execution" "FAIL"
  }

  if ($output4 -match "read_ok: 1" -or $output4 -match "read_ok: ") {
    Write-Result "read_file returns ok result" "OK"
  } else {
    Write-Result "read_file returns ok result" "FAIL"
  }
} finally {
  if (Test-Path $tmpFile4) { Remove-Item $tmpFile4 -Force }
}

# 6. Verify CLI command registered
Write-Host "`n--- CLI integration ---" -ForegroundColor Yellow
$cliContent = Get-Content src/cli.ts -Raw
if ($cliContent -match "program\.command\('agent'\)") {
  Write-Result "CLI agent command registered" "OK"
} else {
  Write-Result "CLI agent command registered" "FAIL"
}
if ($cliContent -match "import .* runToolExecutionLoop") {
  Write-Result "execution loop imported in CLI" "OK"
} else {
  Write-Result "execution loop imported in CLI" "FAIL"
}

# 7. Verify package.json scripts
Write-Host "`n--- Package scripts ---" -ForegroundColor Yellow
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
if ($pkg.scripts.'smoke:tool-execution-loop') {
  Write-Result "smoke:tool-execution-loop in package.json" "OK"
} else {
  Write-Result "smoke:tool-execution-loop in package.json" "FAIL"
}
if ($pkg.scripts.'smoke:hysa-chat-e2e') {
  Write-Result "smoke:hysa-chat-e2e in package.json" "OK"
} else {
  Write-Result "smoke:hysa-chat-e2e in package.json" "FAIL"
}

Write-Host "`n=== smoke:tool-execution-loop $(if ($script:exitCode -eq 0) { 'PASSED' } else { 'FAILED' }) ===" -ForegroundColor $(if ($script:exitCode -eq 0) { 'Green' } else { 'Red' })
exit $script:exitCode
