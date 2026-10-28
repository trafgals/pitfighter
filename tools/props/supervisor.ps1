# Keep the prop rebuild pipeline running.
#
#   supervisor.ps1
#
# A rebuild of the whole prop set is a day's work: a turnaround clip is over an
# hour of GPU and a reconstruction half an hour. So the work is started
# detached from any shell - a process that belongs to a shell's tree is killed
# with it - and this supervisor restarts each chain when it ends.
#
# Every script here is resumable: a sheet that is on disk is skipped, a mesh
# that is built is skipped, a prop that is finished is skipped, and a clip that
# is already in ComfyUI's queue is skipped. So a restart continues where the
# last one stopped rather than starting again.
#
# The supervisor also watches ComfyUI. A ComfyUI that has gone is started
# again, and one that came up on the integrated card rather than the discrete
# one is moved: a model that does not fit there fails with "HIP error: invalid
# kernel file" before it draws anything.
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$log = Join-Path $ROOT 'test-output\pipeline.log'
$pidFile = Join-Path $ROOT 'test-output\pipeline.pid'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Note($text) {
  Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $text"
}

# only one supervisor at a time: a second one would double every chain
if (Test-Path $pidFile) {
  $other = 0
  $text = (Get-Content $pidFile -Raw).Trim()
  if ($text -and [int]::TryParse($text, [ref]$other) -and (Get-Process -Id $other -ErrorAction SilentlyContinue)) {
    Note "another supervisor is already up (process $other); this one stands down"
    exit 0
  }
}
Set-Content -Path $pidFile -Value $PID -NoNewline

function Start-Job($name, $script, $args) {
  $out = Join-Path $ROOT "test-output\chain-$name.log"
  $err = Join-Path $ROOT "test-output\chain-$name.err"
  $proc = Start-Process pwsh -ArgumentList (@('-NoProfile', '-File', $script) + $args) `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  Note "the $name job started as process $($proc.Id)"
  return $proc
}

function ComfyCard {
  try {
    $stats = Invoke-RestMethod -Uri http://127.0.0.1:8188/system_stats -Method Get -TimeoutSec 5
    return "$($stats.devices[0].name)"
  } catch { return '' }
}
function ComfyRunning {
  $found = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.CommandLine -like '*ComfyUI*main.py*' })
  return $found.Count -gt 0
}

$chains = @(
  @{ name = 'sheet';  script = Join-Path $PSScriptRoot 'chain_sheets.ps1' }
  @{ name = 'mesh';   script = Join-Path $PSScriptRoot 'chain_meshes.ps1' }
  @{ name = 'finish'; script = Join-Path $PSScriptRoot 'watch_finish.ps1' }
)
foreach ($c in $chains) { $c.proc = $null }

Note "the supervisor is up as process $PID"
while ($true) {
  $card = ComfyCard
  if ($card -and $card -notlike '*9070*') {
    Note "ComfyUI is on '$card' rather than the discrete card; it is moved"
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*ComfyUI*main.py*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 10
    $card = ''
  }
  if (-not $card -and -not (ComfyRunning)) {
    Note "ComfyUI is not running; it is started again on the discrete card"
    Start-Process pwsh -ArgumentList '-NoProfile', '-File', (Join-Path $PSScriptRoot 'start_comfyui.ps1') -WindowStyle Hidden
    Start-Sleep -Seconds 90
  }
  foreach ($c in $chains) {
    if ($c.proc -and -not $c.proc.HasExited) { continue }
    if ($c.proc) { Note "the $($c.name) chain ended with $($c.proc.ExitCode) and is started again" }
    $c.proc = Start-Job $c.name $c.script @()
  }
  Start-Sleep -Seconds 30
}
