#Requires -Version 5.1
$script:exitCode = 0

function Write-Result($check, $result) {
  if ($result -eq 'OK') { Write-Host "  [OK] $check" -ForegroundColor Green }
  else { Write-Host "  [FAIL] $check" -ForegroundColor Red; $script:exitCode = 1 }
}

Write-Host "=== smoke:tool-system ===" -ForegroundColor Cyan

# 1. Run unit tests (with 120s timeout)
Write-Host "`n--- Unit tests ---" -ForegroundColor Yellow
. (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")
try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "tests/tool-system.test.ts") -TimeoutSec 120
  Write-Result "tool-system unit tests all pass" $(if ($result.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
} catch {
  Write-Result "tool-system unit tests all pass" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 2. Verify tool-system files exist
Write-Host "`n--- File existence ---" -ForegroundColor Yellow
$files = @(
  "src/tools/types.ts",
  "src/tools/registry.ts",
  "src/tools/approval.ts",
  "src/tools/action-log.ts",
  "src/tools/list-files.ts",
  "src/tools/read-file.ts",
  "src/tools/write-file.ts",
  "src/tools/run-command.ts",
  "tests/tool-system.test.ts",
  "docs/brain/HYSA_AGENT_TOOL_SYSTEM.md"
)
$allExist = $true
foreach ($f in $files) {
  if (-not (Test-Path $f)) {
    Write-Host "  [FAIL] Missing: $f" -ForegroundColor Red
    $allExist = $false
  }
}
Write-Result "all tool-system files exist" $(if ($allExist) { 'OK' } else { 'FAIL' })

# 3. CLI tool command registered
Write-Host "`n--- CLI integration ---" -ForegroundColor Yellow
$cliContent = Get-Content src/cli.ts -Raw
if ($cliContent -match "program\.command\('tool'\)") {
  Write-Result "CLI tool command registered" "OK"
} else {
  Write-Result "CLI tool command registered" "FAIL"
}
if ($cliContent -match "import .* runTool, listTools, getTool") {
  Write-Result "tool system imported in CLI" "OK"
} else {
  Write-Result "tool system imported in CLI" "FAIL"
}

# 4. package.json has smoke script
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
if ($pkg.scripts.'smoke:tool-system') {
  Write-Result "smoke:tool-system in package.json" "OK"
} else {
  Write-Result "smoke:tool-system in package.json" "FAIL"
}

Write-Host "`n=== smoke:tool-system $(if ($script:exitCode -eq 0) { 'PASSED' } else { 'FAILED' }) ===" -ForegroundColor $(if ($script:exitCode -eq 0) { 'Green' } else { 'Red' })
exit $script:exitCode
