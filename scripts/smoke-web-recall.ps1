#Requires -Version 5.1
# smoke-web-recall.ps1
# Tests web recall building by running the existing unit tests.
# Does not require a live AI provider.

. (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")

Write-Host "=== smoke:web-recall ===" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "tests/web-recall.test.ts") -TimeoutSec 120
  if ($result.ExitCode -ne 0) {
    Write-Host "FAIL: smoke-web-recall (exit $($result.ExitCode))" -ForegroundColor Red
    exit 1
  }
  Write-Host $result.Output
  Write-Host "PASS: smoke-web-recall" -ForegroundColor Green
} catch {
  Write-Host "FAIL: smoke-web-recall timed out" -ForegroundColor Red
  exit 1
}
