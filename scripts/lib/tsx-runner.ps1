#Requires -Version 5.1
# tsx-runner.ps1 — Shared tsx timeout wrapper for smoke scripts
# Runs tsx with a timeout guard to prevent indefinite hangs.
# Usage: . (Join-Path $PSScriptRoot "lib\tsx-runner.ps1")

function Invoke-TsxWithTimeout {
  param(
    [string]$FileName = "node.exe",
    [string]$TsxPath = ".\node_modules\tsx\dist\cli.mjs",
    [string[]]$Arguments = @(),
    [int]$TimeoutSec = 120,
    [string]$WorkingDirectory
  )

  if (-not $WorkingDirectory) { $WorkingDirectory = (Get-Item -Path ".").FullName }

  $allArgs = @($TsxPath) + $Arguments
  $argStr = ($allArgs | ForEach-Object {
    if ($_ -match '\s') { "`"$_`"" } else { $_ }
  }) -join ' '

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FileName
  $psi.Arguments = $argStr
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $psi.WorkingDirectory = $WorkingDirectory

  $process = [System.Diagnostics.Process]::Start($psi)

  # Read stdout/stderr on background runspaces to avoid pipe-buffer deadlock
  $pshOut = [powershell]::Create().AddScript({ param($p) $p.StandardOutput.ReadToEnd() }).AddArgument($process)
  $pshErr = [powershell]::Create().AddScript({ param($p) $p.StandardError.ReadToEnd() }).AddArgument($process)
  $asyncOut = $pshOut.BeginInvoke()
  $asyncErr = $pshErr.BeginInvoke()

  $exited = $process.WaitForExit($TimeoutSec * 1000)

  if (-not $exited) {
    try { $process.Kill($true) } catch {}
    $pshOut.Dispose(); $pshErr.Dispose()
    throw "tsx command timed out after ${TimeoutSec}s: node $argStr"
  }

  # Signal background readers to drain remaining data
  $outText = $pshOut.EndInvoke($asyncOut)
  $errText = $pshErr.EndInvoke($asyncErr)
  $pshOut.Dispose(); $pshErr.Dispose()

  return @{
    ExitCode = $process.ExitCode
    Output = "$outText`n$errText"
  }
}
