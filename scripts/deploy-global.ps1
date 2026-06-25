<#
.SYNOPSIS
  One-click global deploy for HYSA production server.

.DESCRIPTION
  Builds everything, starts the production daemon via PM2, and prints
  connection info.  Supports HYSA_PUBLIC_URL, HYSA_PUBLIC_API_KEY,
  HYSA_BIND_HOST, and PORT environment variables.

.PARAMETER Daemonize
  If set, runs with PM2 (true daemon).  Otherwise starts in foreground.

.PARAMETER SkipBuild
  Skip the build step (use existing dist/ and web/dist/).

.EXAMPLE
  .\scripts\deploy-global.ps1

.EXAMPLE
  HYSA_PUBLIC_URL=https://my-hysa.example.com HYSA_PUBLIC_API_KEY=secret123 .\scripts\deploy-global.ps1
#>

param(
  [switch]$Daemonize = $true,
  [switch]$SkipBuild
)

# ── helpers ─────────────────────────────────────────────────────────
$Host.UI.RawUI.ForegroundColor = "Cyan"
Write-Host "`n╔══════════════════════════════════════════════╗"
Write-Host "║     HYSA Global Deployment                   ║"
Write-Host "╚══════════════════════════════════════════════╝`n"
$Host.UI.RawUI.ForegroundColor = "Gray"

$ROOT = Resolve-Path "$PSScriptRoot\.."
$LOG_DIR = Join-Path $ROOT "logs"

if (-not (Test-Path $LOG_DIR)) {
  New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
}

# ── 1. Build ────────────────────────────────────────────────────────
if (-not $SkipBuild) {
  Write-Host "[1/3] Building TypeScript backend ..."
  Push-Location $ROOT
  try {
    $buildResult = & node ./node_modules/typescript/bin/tsc 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  [FAIL] tsc failed:" -ForegroundColor Red
      $buildResult | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
      exit 1
    }
    Write-Host "  [OK] TypeScript compiled" -ForegroundColor Green
  } finally {
    Pop-Location
  }
}

if (-not $SkipBuild) {
  Write-Host "[2/3] Building web frontend ..."
  Push-Location (Join-Path $ROOT "web")
  try {
    $webResult = & npm run build 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  [FAIL] web build failed:" -ForegroundColor Red
      $webResult | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
      exit 1
    }
    Write-Host "  [OK] Web frontend built" -ForegroundColor Green
  } finally {
    Pop-Location
  }
}

# ── 3. Check PM2 ────────────────────────────────────────────────────
Write-Host "[3/3] Starting production server ..."

$pm2Available = $null
try { $pm2Available = Get-Command "pm2" -ErrorAction Stop } catch {}

$env:NODE_ENV = "production"

if ($Daemonize -and $pm2Available) {
  $env:HYSA_BIND_HOST = if ($env:HYSA_BIND_HOST) { $env:HYSA_BIND_HOST } else { "0.0.0.0" }
  $env:PORT = if ($env:PORT) { $env:PORT } else { "10000" }

  Push-Location $ROOT
  try {
    pm2 delete hysa-prod 2>$null
    pm2 start ecosystem.config.json
    if ($LASTEXITCODE -eq 0) {
      Write-Host "`n  [OK] Production daemon started via PM2" -ForegroundColor Green
      Start-Sleep 2
      pm2 show hysa-prod --no-color
    } else {
      Write-Host "  [FAIL] PM2 start failed" -ForegroundColor Red
      exit 1
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "  [INFO] PM2 not found - starting in foreground mode" -ForegroundColor Yellow
  Write-Host "  [INFO] Install PM2 for daemon mode: npm install -g pm2" -ForegroundColor Yellow
  Push-Location $ROOT
  try {
    & node dist/web/prod-cluster.cjs
  } finally {
    Pop-Location
  }
  return
}

# ── Connection info ─────────────────────────────────────────────────
$port = if ($env:PORT) { $env:PORT } else { "10000" }
$networkIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^127' -and $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1).IPAddress
$hostAddr = if ($env:HYSA_BIND_HOST) { $env:HYSA_BIND_HOST } else { "0.0.0.0" }

$summary = @"
════════════════════════════════════════════════
  HYSA Global Deployment Summary
════════════════════════════════════════════════

  Deployed at:    $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  Local URL:      http://127.0.0.1:$port
  Network URL:    http://$($networkIP):$($port)
  Production:     YES (NODE_ENV=production)
  Public URL:     $($env:HYSA_PUBLIC_URL)
  API Key:        $($env:HYSA_PUBLIC_API_KEY)
  PM2 Process:    hysa-prod

  Commands:
    pm2 status                - View process status
    pm2 logs hysa-prod        - View live logs
    pm2 stop hysa-prod        - Stop the server
    pm2 restart hysa-prod     - Restart the server

  Endpoints:
    GET /api/health           - Health check (unauthenticated)
    GET /api/status           - Server status
    GET /api/logs             - Live log tail
    POST /api/chat            - Chat API
"@

$summary | Out-File -Encoding utf8 -FilePath (Join-Path $ROOT "DEPLOYMENT_SUMMARY.txt")

$Host.UI.RawUI.ForegroundColor = "Cyan"
Write-Host "`n════════════════════════════════════════════════"
Write-Host "  HYSA is now globally accessible!"
Write-Host "════════════════════════════════════════════════`n"
$Host.UI.RawUI.ForegroundColor = "Gray"

if ($env:HYSA_PUBLIC_URL) {
  Write-Host "  Public URL:    $($env:HYSA_PUBLIC_URL)" -ForegroundColor Green
}
if ($env:HYSA_PUBLIC_API_KEY) {
  Write-Host "  API Key:       $($env:HYSA_PUBLIC_API_KEY)" -ForegroundColor Yellow
}
Write-Host "  Summary:       DEPLOYMENT_SUMMARY.txt"
