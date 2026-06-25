#Requires -Version 5.1
# smoke-e2e-server-start.ps1
# Purpose: start HYSA web server, verify /api/status, stop server
# Uses shared scripts/lib/hysa-test-server.ps1 harness
# This is a targeted diagnostic for server startup reliability

$script:exitCode = 0

$projectRoot = (Get-Item -Path ".").FullName
$port = 18787

. (Join-Path $PSScriptRoot "lib\hysa-test-server.ps1")

Write-Host "=== smoke:e2e-server-start ===" -ForegroundColor Cyan

try {
  # 1. Start server
  Write-Host "`n--- Starting server ---" -ForegroundColor Yellow
  Write-Host "  Port: $port"
  Write-Host "  Command: set PORT=$port&& node .\node_modules\tsx\dist\cli.mjs src\web\render-start.ts"
  Write-Host "  CWD: $projectRoot"
  Write-Host "  Readiness URL: http://127.0.0.1:$port/api/status"

  $proc = Start-HysaTestServer -Port $port -ProjectRoot $projectRoot

  if (-not $proc -or $proc.HasExited) {
    Write-Host "  [FAIL] Server process failed to start" -ForegroundColor Red
    Write-HysaServerDiagnostics
    $script:exitCode = 1
    throw "Server process failed to start"
  }

  Write-Host "  Server process started (PID: $($proc.Id))"

  # 2. Wait for readiness
  Write-Host "`n--- Waiting for readiness ---" -ForegroundColor Yellow
  $ready = Wait-HysaTestServerReady -BaseUrl "http://127.0.0.1:$port" -TimeoutSeconds 70

  if ($ready) {
    Write-Host "  [OK] Server ready - /api/status responds with provider/model/git" -ForegroundColor Green

    # Verify JSON response structure
    try {
      $status = Invoke-HysaStatusCheck -BaseUrl "http://127.0.0.1:$port" -TimeoutSeconds 5
      if ($status) {
        $hasProvider = [bool]($status.PSObject.Properties.Name -contains 'provider')
        $hasModel = [bool]($status.PSObject.Properties.Name -contains 'model')
        $hasGit = [bool]($status.PSObject.Properties.Name -contains 'git')
        Write-Host "  Status fields: provider=$hasProvider model=$hasModel git=$hasGit"
        if ($hasProvider -and $hasModel) {
          Write-Host "  [OK] Status JSON has expected keys (provider, model, git)" -ForegroundColor Green
        } else {
          Write-Host "  [FAIL] Status JSON missing expected keys" -ForegroundColor Red
          $script:exitCode = 1
        }
      }
    } catch {
      Write-Host "  [FAIL] Status check failed: $_" -ForegroundColor Red
      $script:exitCode = 1
    }
  } else {
    Write-Host "  [FAIL] Server did not become ready within timeout" -ForegroundColor Red
    Write-HysaServerDiagnostics
    $script:exitCode = 1
  }

} finally {
  # 3. Stop server
  Write-Host "`n--- Cleanup ---" -ForegroundColor Yellow
  Stop-HysaTestServer

  # Verify port is free
  Start-Sleep -Seconds 1
  $stillListening = Get-ProcessUsingPort -Port $port
  if ($stillListening) {
    Write-Host "  [WARN] Port $port still in use after cleanup - force killing" -ForegroundColor Yellow
    Stop-ProcessUsingPort -Port $port
  } else {
    Write-Host "  [OK] Port $port is free after cleanup" -ForegroundColor Green
  }
}

Write-Host "`n=== smoke:e2e-server-start $(if ($script:exitCode -eq 0) { 'PASSED' } else { 'FAILED' }) ===" -ForegroundColor $(if ($script:exitCode -eq 0) { 'Green' } else { 'Red' })
exit $script:exitCode
