#Requires -Version 5.1
$script:exitCode = 0

function Write-Result($check, $result) {
  if ($result -eq 'OK') { Write-Host "  [OK] $check" -ForegroundColor Green }
  else { Write-Host "  [FAIL] $check" -ForegroundColor Red; $script:exitCode = 1 }
}

Write-Host "=== smoke:web-brain-api ===" -ForegroundColor Cyan

. (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")

# 1. Run web-brain-api unit tests
Write-Host "`n--- Brain API unit tests ---" -ForegroundColor Yellow
try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "tests/web-brain-api.test.ts") -TimeoutSec 60
  Write-Result "web-brain-api unit tests all pass" $(if ($result.ExitCode -eq 0) { 'OK' } else { 'FAIL' })
} catch {
  Write-Result "web-brain-api unit tests all pass" "FAIL"
  Write-Host "  ERROR: $_" -ForegroundColor Red
}

# 2. Verify brain API exports
Write-Host "`n--- Brain API exports ---" -ForegroundColor Yellow
$tmpFile = Join-Path $env:TEMP "hysa-smoke-bapi-$([Guid]::NewGuid().ToString('N')).ts"
$projectRoot = (Get-Item -Path ".").FullName.Replace('\', '/')
$lines = @(
  "import { getBrainStatusHandler, getBrainRecallHandler, getBrainRecentEventsHandler, getBrainInspectHandler } from '$projectRoot/src/web/brain-api.js';"
  '(async function() {'
  'var status = await getBrainStatusHandler();'
  'console.log("status_exists_type:", typeof status.exists);'
  'console.log("status_has_eventCount:", typeof status.eventCount === "number" ? "OK" : "FAIL");'
  'var recall = await getBrainRecallHandler("");'
  'console.log("recall_empty:", recall.found === false ? "OK" : "FAIL");'
  'var events = await getBrainRecentEventsHandler(3);'
  'console.log("recent_events:", Array.isArray(events.events) ? "OK" : "FAIL");'
  'var inspect = await getBrainInspectHandler();'
  'console.log("inspect_nodes:", typeof inspect.totalNodes === "number" ? "OK" : "FAIL");'
  '})();'
)
[System.IO.File]::WriteAllLines($tmpFile, $lines, [System.Text.UTF8Encoding]::new($false))

try {
  $out = & "node" "./node_modules/tsx/dist/cli.mjs" $tmpFile 2>&1
  $ec = $LASTEXITCODE
  if ($ec -eq 0) {
    Write-Result "brain API direct function checks" "OK"
  } else {
    Write-Result "brain API direct function checks" "FAIL"
    Write-Host "  Output: $out" -ForegroundColor Gray
  }
} finally {
  if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force }
}

# 3. Verify server routes exist
Write-Host "`n--- Route verification ---" -ForegroundColor Yellow
$serverContent = Get-Content (Join-Path $PSScriptRoot "..\src\web\server.ts") -Raw
if ($serverContent -match '/api/brain/status') {
  Write-Result "brain/status route registered" "OK"
} else {
  Write-Result "brain/status route registered" "FAIL"
}
if ($serverContent -match '/api/brain/recall') {
  Write-Result "brain/recall route registered" "OK"
} else {
  Write-Result "brain/recall route registered" "FAIL"
}
if ($serverContent -match '/api/brain/recent') {
  Write-Result "brain/recent route registered" "OK"
} else {
  Write-Result "brain/recent route registered" "FAIL"
}
if ($serverContent -match '/api/brain/inspect') {
  Write-Result "brain/inspect route registered" "OK"
} else {
  Write-Result "brain/inspect route registered" "FAIL"
}

# 4. Verify package.json script
Write-Host "`n--- Package integration ---" -ForegroundColor Yellow
$pkg = Get-Content (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json
if ($pkg.scripts.'smoke:web-brain-api') {
  Write-Result "smoke:web-brain-api in package.json" "OK"
} else {
  Write-Result "smoke:web-brain-api in package.json" "FAIL"
}

Write-Host "`n=== smoke:web-brain-api $(if ($script:exitCode -eq 0) { 'PASSED' } else { 'FAILED' }) ===" -ForegroundColor $(if ($script:exitCode -eq 0) { 'Green' } else { 'Red' })
exit $script:exitCode
