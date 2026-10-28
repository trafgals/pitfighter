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
# A chain that is already running when the supervisor starts is adopted, not
# started again: a second sheet chain would wait for the same clip and a
# second finish chain would finish the same prop twice, and a clip that is
# forty minutes in is worth more than a clean start.
#
# The supervisor also watches ComfyUI. A ComfyUI that has gone is started
# again, and one that came up on the integrated card rather than the discrete
# one is moved: a model that does not fit there fails with "HIP error: invalid
# kernel file" before it draws anything. The guardian is watched in turn, so
# the pair puts each other back.
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$log = Join-Path $ROOT 'test-output\pipeline.log'
$pidFile = Join-Path $ROOT 'test-output\pipeline.pid'
$guardianPid = Join-Path $ROOT 'test-output\guardian.pid'
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

function Alive($processId) {
  if (-not $processId) { return $false }
  return [bool](Get-Process -Id $processId -ErrorAction SilentlyContinue)
}

# the process running a script, if one is: a chain left behind by a
# supervisor that died is picked up rather than started a second time
function Find-Process($needle) {
  $found = @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.CommandLine -like "*$needle*" } |
             Sort-Object CreationDate)
  if ($found.Count) { return [int]$found[0].ProcessId }
  return 0
}

function Start-Job($name, $script) {
  $out = Join-Path $ROOT "test-output\chain-$name.log"
  $err = Join-Path $ROOT "test-output\chain-$name.err"
  $proc = Start-Process pwsh -ArgumentList '-NoProfile', '-File', $script `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  Note "the $name chain started as process $($proc.Id)"
  return [int]$proc.Id
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

# the props this pipeline is rebuilding
$props = @(
  'prop_pegg_cast_iron_last', 'prop_crape_spiked_brolly', 'prop_eleanor_weeping_rapier',
  'prop_tilly_clinker_tongs', 'prop_sluice_flatcap', 'prop_kilnworth_nursecap',
  'prop_mule_championship_belt', 'prop_rook_souwester', 'prop_bulwark_pistons',
  'prop_crump_samovar', 'weapon_knuckleduster', 'weapon_coal_shovel',
  'weapon_bone_saw', 'weapon_nail_bat', 'weapon_cleaver', 'weapon_piston_gauntlet',
  'weapon_lamplighter_pole', 'pickup_tonic'
)

# Is the work done? Every prop has a mesh, and every prop has been through the
# capture. The pipeline stands down when it is: a ComfyUI left running holds
# the card, and the finish chain waits forever for a mesh that will not come.
function WorkFinished {
  $manifest = Join-Path $ROOT 'data\asset_manifest.json'
  if (-not (Test-Path $manifest)) { return $false }
  try {
    $doc = Get-Content $manifest -Raw | ConvertFrom-Json
  } catch { return $false }
  $entries = @{}
  foreach ($a in $doc.assets) { $entries[$a.id] = $a }
  foreach ($p in $props) {
    if (-not $entries.ContainsKey($p)) { return $false }
    if (-not (Test-Path (Join-Path $ROOT "public/models/props/$p.glb"))) { return $false }
    if ($entries[$p].PSObject.Properties.Name -contains 'stand_in_measured') { return $false }
  }
  return $true
}

function Stand-Down {
  Set-Content -Path (Join-Path $ROOT 'test-output\pipeline.done') -Value "$(Get-Date -Format o)"
  Note "the work is done; the chains and ComfyUI are stopped"
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*ComfyUI*main.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  exit 0
}

$chains = @(
  @{ name = 'sheet';  script = Join-Path $PSScriptRoot 'chain_sheets.ps1'; needle = 'chain_sheets.ps1'; pid = 0 }
  @{ name = 'mesh';   script = Join-Path $PSScriptRoot 'chain_meshes.ps1'; needle = 'chain_meshes.ps1'; pid = 0 }
  @{ name = 'finish'; script = Join-Path $PSScriptRoot 'watch_finish.ps1'; needle = 'watch_finish.ps1'; pid = 0 }
)
foreach ($c in $chains) {
  $c.pid = Find-Process $c.needle
  if ($c.pid) { Note "the $($c.name) chain is already running as process $($c.pid) and is adopted" }
}

Note "the supervisor is up as process $PID"
while ($true) {
  if (WorkFinished) { Stand-Down }
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

  # the guardian is what puts this supervisor back, so it is watched too
  $guardian = 0
  if (Test-Path $guardianPid) {
    $text = (Get-Content $guardianPid -Raw).Trim()
    if ($text -and [int]::TryParse($text, [ref]$guardian)) { $guardian = [int]$text }
  }
  if (-not (Alive $guardian)) {
    Note "the guardian is not running; it is started again"
    $proc = Start-Process pwsh -ArgumentList '-NoProfile', '-File', (Join-Path $PSScriptRoot 'guardian.ps1') -WindowStyle Hidden -PassThru
    Set-Content -Path $guardianPid -Value $proc.Id -NoNewline
    Note "the guardian started as process $($proc.Id)"
  }

  foreach ($c in $chains) {
    if (Alive $c.pid) { continue }
    if ($c.pid) { Note "the $($c.name) chain ended and is started again" }
    $c.pid = Start-Job $c.name $c.script
  }
  Start-Sleep -Seconds 30
}
