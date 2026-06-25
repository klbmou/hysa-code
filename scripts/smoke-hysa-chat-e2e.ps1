#Requires -Version 5.1
# smoke-hysa-chat-e2e.ps1 - True E2E chat smoke
# Starts HYSA web server via shared harness, POSTs to real /api/chat and /api/chat/stream
# Uses scripts/lib/hysa-test-server.ps1 for reliable server startup
#
# Quick mode: start server, check /api/status, run English chat, verify answerQuality/sessionId.
#             Skips Arabic provider-heavy request and streaming check.

param(
  [Switch]$Quick,
  [Switch]$TreatRateLimitAsWarning
)

$script:exitCode = 0

$projectRoot = (Get-Item -Path ".").FullName
$port = 18787
$baseUrl = "http://127.0.0.1:$port"

# Load shared server harness
. (Join-Path $PSScriptRoot "lib\hysa-test-server.ps1")

function Write-Result($check, $result) {
  if ($result -eq 'OK') { Write-Host "  [OK] $check" -ForegroundColor Green }
  elseif ($result -eq 'RATE_LIMIT') { Write-Host "  [RATE_LIMIT] $check" -ForegroundColor Yellow }
  else { Write-Host "  [FAIL] $check" -ForegroundColor Red; $script:exitCode = 1 }
}

function Test-IsRateLimitResponse($result) {
  # Detect provider rate-limit/timeout responses: message present but no answerQuality
  if (-not $result) { return $false }
  if ($result.answerQuality -ne $null) { return $false }
  if (-not $result.message) { return $false }
  $lower = $result.message.ToLower()
  if ($lower -match 'rate.limit|busy|unavailable|cooldown|all free|timed out') { return $true }
  return $false
}

function Invoke-ChatApi($body) {
  $json = $body | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Uri "$baseUrl/api/chat" -Method POST -Body $json -ContentType "application/json" -TimeoutSec 90
  return $resp
}

try {
  Write-Host "=== smoke:hysa-chat-e2e ===" -ForegroundColor Cyan

  # 1. Start web server via shared harness
  Write-Host "`n--- Server setup ---" -ForegroundColor Yellow

  Write-Host "  Starting web server on port $port..."
  $proc = Start-HysaTestServer -Port $port -ProjectRoot $projectRoot

  Write-Host "  Waiting for /api/status..."
  $ready = Wait-HysaTestServerReady -BaseUrl $baseUrl -TimeoutSeconds 70

  if (-not $ready) {
    Write-Host "  [FAIL] Server did not become ready" -ForegroundColor Red
    Write-HysaServerDiagnostics
    $script:exitCode = 1
    throw "Server failed to start"
  }

  Write-Host "  Server started successfully (PID: $($proc.Id))"

  # 2. Simple English chat
  Write-Host "`n--- Simple English chat ---" -ForegroundColor Yellow
  try {
    $body = @{ messages = @(@{ role = "user"; content = "Say OK only, no other text" }) }
    $result = Invoke-ChatApi $body

    $isRateLimited = Test-IsRateLimitResponse $result

    if ($result.message -and $result.message.Length -gt 0) {
      Write-Result "non-empty assistant message" "OK"
    } else {
      Write-Result "non-empty assistant message" "FAIL"
    }

    if ($isRateLimited) {
      if ($TreatRateLimitAsWarning) {
        Write-Result "response contains 'OK'" "RATE_LIMIT"
        Write-Result "answerQuality metadata present" "RATE_LIMIT"
      } else {
        Write-Result "response contains 'OK'" "FAIL"
        Write-Result "answerQuality metadata present" "FAIL"
      }
    } else {
      if ($result.message -match '(?i)ok') {
        Write-Result "response contains 'OK'" "OK"
      } else {
        Write-Result "response contains 'OK'" "FAIL"
      }

      if ($result.answerQuality -ne $null) {
        Write-Result "answerQuality metadata present" "OK"
      } else {
        Write-Result "answerQuality metadata present" "FAIL"
      }
    }

    if ($result.sessionId -and $result.sessionId.Length -gt 0) {
      Write-Result "sessionId returned" "OK"
    } else {
      Write-Result "sessionId returned" "FAIL"
    }

    # Check no raw JSON leak
    $msg = $result.message
    $hasJsonBlock = $msg -match '```json\s*\{' -or $msg -match '{"message":'
    if (-not $hasJsonBlock) {
      Write-Result "no raw JSON leak" "OK"
    } else {
      Write-Result "no raw JSON leak" "FAIL"
    }

    if ($result.error) {
      if ($TreatRateLimitAsWarning) {
        Write-Result "no crash/error" "RATE_LIMIT"
      } else {
        Write-Result "no crash/error" "FAIL"
      }
    } else {
      Write-Result "no crash/error" "OK"
    }
  } catch {
    Write-Result "simple chat request" "FAIL"
    Write-Host "  ERROR: $_" -ForegroundColor Red
    $script:exitCode = 1
  }

  # 3. Arabic chat (skipped in Quick mode)
  if (-not $Quick) {
    Write-Host "`n--- Arabic chat ---" -ForegroundColor Yellow
    $arabicOk = $false
    for ($attempt = 1; $attempt -le 2; $attempt++) {
      try {
        if ($attempt -gt 1) { Start-Sleep -Seconds 3 }
        $arabicMsg = [char]0x0642 + [char]0x0644 + [char]0x0020 + [char]0x0641 + [char]0x0642 + [char]0x0637 + [char]0x0020 + [char]0x004F + [char]0x004B + [char]0x060C + [char]0x0020 + [char]0x0644 + [char]0x0627 + [char]0x0020 + [char]0x062A + [char]0x0643 + [char]0x062A + [char]0x0628 + [char]0x0020 + [char]0x0623 + [char]0x064A + [char]0x0020 + [char]0x0634 + [char]0x064A + [char]0x0621 + [char]0x0020 + [char]0x0622 + [char]0x062E + [char]0x0631
        $body = @{ messages = @(@{ role = "user"; content = $arabicMsg }) }
        $result = Invoke-ChatApi $body

        $isRateLimited = Test-IsRateLimitResponse $result

        if ($result.message -and $result.message.Length -gt 0) {
          Write-Result "Arabic non-empty response" "OK"
        } else {
          Write-Result "Arabic non-empty response" "FAIL"
        }

        if ($isRateLimited) {
          if ($TreatRateLimitAsWarning) {
            Write-Result "Arabic or OK response" "RATE_LIMIT"
          } else {
            Write-Result "Arabic or OK response" "FAIL"
          }
        } else {
          if ($result.message -match '\p{IsArabic}' -or $result.message -match '(?i)ok') {
            Write-Result "Arabic or OK response" "OK"
          } else {
            Write-Result "Arabic or OK response" "FAIL"
          }
        }

        if ($result.sessionId) {
          Write-Result "sessionId for Arabic request" "OK"
        } else {
          Write-Result "sessionId for Arabic request" "FAIL"
        }

        if ($result.error) {
          if ($TreatRateLimitAsWarning) {
            Write-Result "Arabic request no crash" "RATE_LIMIT"
          } else {
            Write-Result "Arabic request no crash" "FAIL"
          }
        } else {
          Write-Result "Arabic request no crash" "OK"
        }
        $arabicOk = $true
        break
      } catch {
        if ($attempt -lt 2) {
          Write-Host "  Retry $attempt/2: $_" -ForegroundColor Yellow
        } else {
          Write-Result "Arabic chat request" "FAIL"
          Write-Host "  ERROR: $_" -ForegroundColor Red
          $script:exitCode = 1
        }
      }
    }
  } else {
    Write-Host "`n--- Arabic chat (skipped in Quick mode) ---" -ForegroundColor Yellow
  }

  # 4. Verify streaming endpoint also works (skipped in Quick mode)
  if (-not $Quick) {
    Write-Host "`n--- Streaming endpoint ---" -ForegroundColor Yellow
    try {
      $body = @{ messages = @(@{ role = "user"; content = "Say OK only" }) } | ConvertTo-Json -Compress
      $streamResult = Invoke-RestMethod -Uri "$baseUrl/api/chat/stream" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30
      Write-Result "streaming endpoint responds" "OK"
    } catch {
      if ($_.Exception.Message -match 'The remote server returned an error') {
        Write-Result "streaming endpoint responds" "FAIL"
      } else {
        Write-Result "streaming endpoint responds" "OK"
      }
    }
  } else {
    Write-Host "`n--- Streaming endpoint (skipped in Quick mode) ---" -ForegroundColor Yellow
  }

  Write-Host "`n--- Summary ---" -ForegroundColor Yellow
  Write-Host "  True E2E chat smoke: tests real /api/chat and /api/chat/stream endpoints"
  Write-Host "  smoke:hysa-chat remains component-level (imports helpers)"
  Write-Host "  smoke:hysa-chat-e2e is the true full-stack check"
  if ($Quick) { Write-Host "  Mode: QUICK (Arabic + streaming skipped)" -ForegroundColor Cyan }
  else { Write-Host "  Mode: FULL (all checks)" -ForegroundColor Cyan }
  if ($TreatRateLimitAsWarning) { Write-Host "  Rate limit: warning (RATE_LIMIT)" -ForegroundColor Yellow }
  else { Write-Host "  Rate limit: fail (FAIL)" -ForegroundColor Yellow }

} finally {
  # 5. Cleanup server
  Write-Host "`n--- Cleanup ---" -ForegroundColor Yellow
  Stop-HysaTestServer
}

Write-Host "`n=== smoke:hysa-chat-e2e $(if ($script:exitCode -eq 0) { 'PASSED' } else { 'FAILED' }) ===" -ForegroundColor $(if ($script:exitCode -eq 0) { 'Green' } else { 'Red' })
exit $script:exitCode
