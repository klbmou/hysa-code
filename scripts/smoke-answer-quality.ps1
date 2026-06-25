# smoke-answer-quality.ps1
# Tests the answer quality critic via direct function import + unit tests.

Write-Host "=== Smoke Answer Quality ===" -ForegroundColor Cyan
Write-Host ""

$Script:exitCode = 0

function Result($status, $label, $detail) {
  $icon = if ($status -eq "ok") { "[OK]" } else { "[FAIL]" }
  $color = if ($status -eq "ok") { "Green" } else { "Red" }
  Write-Host $icon.PadRight(6) -ForegroundColor $color -NoNewline
  Write-Host "$label".PadRight(42) -ForegroundColor White -NoNewline
  Write-Host "$detail" -ForegroundColor Gray
}

# ── Step 1: Run unit tests (with 120s timeout) ──
Write-Host "Running answer-quality unit tests..." -ForegroundColor Cyan
. (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")
try {
  $result = Invoke-TsxWithTimeout -Arguments @("--test", "--test-reporter=spec", "tests/answer-quality.test.ts") -TimeoutSec 120
  $out = $result.Output
  $ec = $result.ExitCode
  $out | Select-Object -Last 10 | ForEach-Object { Write-Host "  $_" }
  if ($ec -eq 0) {
    Result "ok" "Unit tests" "All answer-quality tests passed"
  } else {
    Result "fail" "Unit tests" "Some tests failed (exit $ec)"
    $Script:exitCode = 1
  }
} catch {
  Result "fail" "Unit tests" "Timed out or failed"
  Write-Host "  ERROR: $_" -ForegroundColor Red
  $Script:exitCode = 1
}

# ── Step 2: Direct function import tests ──
Write-Host ""
Write-Host "Testing direct function imports..." -ForegroundColor Cyan
$tsCode = @"
const { evaluateAnswerQuality, cleanObviousAnswerArtifacts } = await import('./src/ai/answer-quality.js');

let allOk = true;

// 1. Arabic user + English answer
const r1 = evaluateAnswerQuality({ answer: 'Hello this is English.', userText: '\u0645\u0631\u062D\u0628\u0627', language: 'ar' });
if (r1.issues.some(i => i.code === 'wrong_language')) { console.log('PASS: Arabic user + English answer flagged'); }
else { console.log('FAIL: Arabic user + English answer not flagged'); allOk = false; }

// 2. Good Arabic answer passes
const goodAr = evaluateAnswerQuality({ answer: '\u0645\u0631\u062D\u0628\u0627! \u0647\u0630\u0627 \u0647\u0648 \u0627\u0644\u062C\u0648\u0627\u0628 \u0627\u0644\u0645\u0641\u0635\u0644.', userText: '\u0645\u0631\u062D\u0628\u0627', language: 'ar' });
if (goodAr.ok) { console.log('PASS: Good Arabic answer passes'); }
else { console.log('FAIL: Good Arabic answer flagged: ' + goodAr.issues.map(i => i.code).join(',')); allOk = false; }

// 3. Manual verification in OpenCode prompt flagged
const r3 = evaluateAnswerQuality({ answer: 'You should run npm test yourself.', isOpenCodePrompt: true });
if (r3.issues.some(i => i.code === 'manual_verification_request')) { console.log('PASS: Manual verification request flagged'); }
else { console.log('FAIL: Manual verification request not flagged'); allOk = false; }

// 4. Safe prompt not flagged
const r4 = evaluateAnswerQuality({ answer: 'I will run npm test to verify.', isOpenCodePrompt: true });
if (!r4.issues.some(i => i.code === 'manual_verification_request')) { console.log('PASS: Safe prompt not flagged'); }
else { console.log('FAIL: Safe prompt was incorrectly flagged'); allOk = false; }

// 5. Clean artifacts
const cleaned = cleanObviousAnswerArtifacts('Answer text.\n[{"title":"x","url":"y"}]');
if (cleaned === 'Answer text.') { console.log('PASS: cleanObviousAnswerArtifacts removed trailing JSON'); }
else { console.log('FAIL: cleanObviousAnswerArtifacts result: ' + JSON.stringify(cleaned)); allOk = false; }

// 6. Normal answer not modified
const normal = cleanObviousAnswerArtifacts('Normal answer with text.');
if (normal === 'Normal answer with text.') { console.log('PASS: Normal answer not modified'); }
else { console.log('FAIL: Normal answer was modified: ' + JSON.stringify(normal)); allOk = false; }

if (allOk) { console.log('All direct function tests passed'); }
else { process.exitCode = 1; }
"@

$tmpFile = Join-Path (Get-Location) ".answer-quality-check-$([System.Guid]::NewGuid()).mjs"
try {
  Set-Content -Path $tmpFile -Value $tsCode -Encoding UTF8
  $out = & "node.exe" ".\node_modules\tsx\dist\cli.mjs" $tmpFile 2>&1
  $ec = $LASTEXITCODE
  $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
  if ($ec -eq 0) {
    Result "ok" "Direct function tests" "All quality checks passed"
  } else {
    Result "fail" "Direct function tests" "Some quality checks failed"
    $Script:exitCode = 1
  }
} finally {
  Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($Script:exitCode -eq 0) { Write-Host "=== Smoke Answer Quality PASSED ===" -ForegroundColor Green }
else { Write-Host "=== Smoke Answer Quality FAILED ===" -ForegroundColor Red }
exit $Script:exitCode
