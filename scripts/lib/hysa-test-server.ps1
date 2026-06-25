#Requires -Version 5.1
# hysa-test-server.ps1 — Shared smoke test server harness for HYSA web server
#
# Usage:
#   . .\scripts\lib\hysa-test-server.ps1
#   Start-HysaTestServer -ProjectRoot (Get-Item -Path ".").FullName
#   if (Wait-HysaTestServerReady -ErrorAction Stop) { ... }
#   Stop-HysaTestServer

$script:HysaServer_Process = $null
$script:HysaServer_StdoutLog = $null
$script:HysaServer_StderrLog = $null
$script:HysaServer_Port = $null
$script:HysaServer_BaseUrl = $null
$script:HysaServer_ProjectRoot = $null

function Get-ProcessUsingPort {
  param([int]$Port)
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
      Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
    if ($conn) {
      return Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    }
  } catch {}
  return $null
}

function Stop-ProcessUsingPort {
  param([int]$Port)
  $proc = Get-ProcessUsingPort -Port $Port
  if ($proc) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Milliseconds 500
  }
}

function Invoke-HysaStatusCheck {
  param(
    [string]$BaseUrl,
    [int]$TimeoutSeconds = 5
  )
  try {
    $status = Invoke-RestMethod -Uri "$BaseUrl/api/status" -TimeoutSec $TimeoutSeconds -ErrorAction Stop
    if ($status -and $status.provider -and $status.model) {
      return $status
    }
  } catch {}
  return $null
}

function Wait-HysaTestServerReady {
  param(
    [string]$BaseUrl,
    [int]$TimeoutSeconds = 70,
    [int]$PollIntervalSeconds = 2
  )
  $started = Get-Date
  while ($true) {
    $elapsed = (Get-Date) - $started
    if ($elapsed.TotalSeconds -ge $TimeoutSeconds) { return $false }
    $status = Invoke-HysaStatusCheck -BaseUrl $BaseUrl -TimeoutSeconds 5
    if ($status) { return $true }
    Start-Sleep -Seconds $PollIntervalSeconds
  }
}

function Start-HysaTestServer {
  param(
    [int]$Port = 18787,
    [string]$ProjectRoot,
    [string]$LogDir = (Join-Path $env:TEMP "hysa-test-server"),
    [hashtable]$ExtraEnv = @{}
  )

  # Ensure port is free
  Stop-ProcessUsingPort -Port $Port

  # Create log directory
  if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $script:HysaServer_StdoutLog = Join-Path $LogDir "server-stdout-$timestamp.log"
  $script:HysaServer_StderrLog = Join-Path $LogDir "server-stderr-$timestamp.log"
  $script:HysaServer_Port = $Port
  $script:HysaServer_BaseUrl = "http://localhost:$Port"
  $script:HysaServer_ProjectRoot = $ProjectRoot

  # Write temporary startup cmd file with redirection
  $cmdFile = Join-Path $LogDir "start-hysa.cmd"
  $cmdContent = "@echo off`r`n"
  $cmdContent += "set PORT=$Port`r`n"
  Set-Content -Path $cmdFile -Value $cmdContent -Encoding ASCII

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = "/c set PORT=$Port&&"
  # Append extra env vars inline
  foreach ($kv in $ExtraEnv.GetEnumerator()) {
    $psi.Arguments += " set `"$($kv.Key)=$($kv.Value)`"&&"
  }
  $psi.Arguments += " node .\node_modules\tsx\dist\cli.mjs src\web\render-start.ts 1>> `"$($script:HysaServer_StdoutLog)`" 2>> `"$($script:HysaServer_StderrLog)`""
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WorkingDirectory = $ProjectRoot

  $script:HysaServer_Process = [System.Diagnostics.Process]::Start($psi)

  return $script:HysaServer_Process
}

function Stop-HysaTestServer {
  $process = $script:HysaServer_Process
  $port = $script:HysaServer_Port
  $stdoutLog = $script:HysaServer_StdoutLog
  $stderrLog = $script:HysaServer_StderrLog

  if ($process -and !$process.HasExited) {
    Write-Host "  Stopping server process (PID: $($process.Id))..." -ForegroundColor Yellow
    try {
      $process.CloseMainWindow() | Out-Null
      if (-not $process.WaitForExit(5000)) {
        $process.Kill($true)
      }
    } catch {
      try { $process.Kill($true) } catch {}
    }
    # Wait for process to fully exit
    if (-not $process.WaitForExit(3000)) {
      try { $process.Kill($true) } catch {}
    }
  }

  if ($port) {
    Stop-ProcessUsingPort -Port $port
  }

  $script:HysaServer_Process = $null
}

function Write-HysaServerDiagnostics {
  $process = $script:HysaServer_Process
  $port = $script:HysaServer_Port
  $baseUrl = $script:HysaServer_BaseUrl
  $projectRoot = $script:HysaServer_ProjectRoot
  $stdoutLog = $script:HysaServer_StdoutLog
  $stderrLog = $script:HysaServer_StderrLog

  $cmdDesc = "node .\node_modules\tsx\dist\cli.mjs src\web\render-start.ts"
  Write-Host "  Full command: set PORT=$port&& $cmdDesc" -ForegroundColor Yellow
  Write-Host "  CWD: $projectRoot" -ForegroundColor Yellow
  Write-Host "  Port: $port" -ForegroundColor Yellow
  Write-Host "  Readiness URL: $baseUrl/api/status" -ForegroundColor Yellow

  if ($process) {
    Write-Host "  Process ID: $($process.Id)" -ForegroundColor Yellow
    if ($process.HasExited) {
      Write-Host "  Exit code: $($process.ExitCode)" -ForegroundColor Yellow
    } else {
      Write-Host "  Process still running (has not exited)" -ForegroundColor Yellow
    }
  }

  if ($stdoutLog -and (Test-Path -LiteralPath $stdoutLog)) {
    $stdoutSize = (Get-Item -LiteralPath $stdoutLog).Length
    Write-Host "  Stdout log ($stdoutSize bytes): $stdoutLog" -ForegroundColor Yellow
    if ($stdoutSize -gt 0) {
      Write-Host "  Last stdout lines:" -ForegroundColor Yellow
      Get-Content -LiteralPath $stdoutLog -Tail 30 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    }
  } else {
    Write-Host "  Stdout log: (not available)" -ForegroundColor Yellow
  }

  if ($stderrLog -and (Test-Path -LiteralPath $stderrLog)) {
    $stderrSize = (Get-Item -LiteralPath $stderrLog).Length
    Write-Host "  Stderr log ($stderrSize bytes): $stderrLog" -ForegroundColor Yellow
    if ($stderrSize -gt 0) {
      Write-Host "  Last stderr lines:" -ForegroundColor Yellow
      Get-Content -LiteralPath $stderrLog -Tail 30 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    }
  } else {
    Write-Host "  Stderr log: (not available)" -ForegroundColor Yellow
  }

  $portProc = Get-ProcessUsingPort -Port $port
  if ($portProc) {
    Write-Host "  Process still listening on port ${port}: PID $($portProc.Id)" -ForegroundColor Yellow
  } else {
    Write-Host "  No process listening on port $port" -ForegroundColor Yellow
  }
}
