# Keep a supervisor alive for the prop pipeline.
#
#   guardian.ps1
#
# The supervisor owns the chains and restarts them when they end, but nothing
# owns the supervisor: if it is killed - a shell's process tree going away
# takes its children with it - the pipeline stops until someone notices. This
# watches the supervisor's process file and starts another one if it has gone.
#
# The supervisor watches this one in turn, so neither of them is the weak
# link. Both write their process id to a file for the other to read.
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pidFile = Join-Path $ROOT 'test-output\pipeline.pid'
$guardianPid = Join-Path $ROOT 'test-output\guardian.pid'
$log = Join-Path $ROOT 'test-output\pipeline.log'
Set-Content -Path $guardianPid -Value $PID -NoNewline

while ($true) {
  Start-Sleep -Seconds 60
  if (Test-Path (Join-Path $ROOT 'test-output\pipeline.done')) {
    Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') the work is done; the guardian stands down"
    exit 0
  }
  $alive = $false
  if (Test-Path $pidFile) {
    $sup = 0
    $text = (Get-Content $pidFile -Raw).Trim()
    if ($text -and [int]::TryParse($text, [ref]$sup)) {
      $alive = [bool](Get-Process -Id $sup -ErrorAction SilentlyContinue)
    }
  }
  if (-not $alive) {
    Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') the guardian found no supervisor and is starting one"
    Start-Process pwsh -ArgumentList '-NoProfile', '-File', (Join-Path $PSScriptRoot 'supervisor.ps1') -WindowStyle Hidden
  }
}
