# Render the H3 four-view turnaround sheet for every prop that still needs one.
#
#   chain_sheets.ps1
#
# The run loops, because a sheet chain is a long job and the loop picks up where
# the last pass stopped: a sheet that is already on disk is skipped, and a clip
# that is already in ComfyUI's queue is waited for rather than rendered a
# second time.
#
# The chain only ends when every sheet is on disk. A clip that is in flight
# belongs to the queue, and a chain that gave up before the clip landed would
# leave the prop without a sheet.
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }
Set-Location $ROOT

$queue = @(
  @{ id='prop_rook_souwester';             alpha='flux3_rook_souwester_alpha.png';    sheet='h3_rook_souwester_turnaround.png';    sym=$true  }
  @{ id='prop_sluice_flatcap';             alpha='flux3_sluice_flatcap_alpha.png';    sheet='h3_sluice_flatcap_turnaround.png';    sym=$true  }
  @{ id='prop_bulwark_pistons';            alpha='flux3_bulwark_pistons_alpha.png';   sheet='h3_bulwark_pistons_turnaround.png';   sym=$false }
  @{ id='prop_crump_samovar';              alpha='flux3_crump_samovar_alpha.png';     sheet='h3_crump_samovar_turnaround.png';     sym=$false }
  @{ id='weapon_knuckleduster';            alpha='flux3_knuckleduster_alpha.png';     sheet='h3_knuckleduster_turnaround.png';     sym=$true  }
  @{ id='weapon_coal_shovel';              alpha='flux3_coal_shovel_alpha.png';       sheet='h3_coal_shovel_turnaround.png';       sym=$true  }
  @{ id='weapon_bone_saw';                 alpha='flux3_bone_saw_alpha.png';          sheet='h3_bone_saw_turnaround.png';          sym=$false }
  @{ id='weapon_nail_bat';                 alpha='flux3_nail_bat_alpha.png';          sheet='h3_nail_bat_turnaround.png';          sym=$true  }
  @{ id='weapon_cleaver';                  alpha='flux3_cleaver_alpha.png';           sheet='h3_cleaver_turnaround.png';           sym=$false }
  @{ id='weapon_piston_gauntlet';          alpha='flux3_piston_gauntlet_alpha.png';   sheet='h3_piston_gauntlet_turnaround.png';   sym=$false }
  @{ id='weapon_lamplighter_pole';         alpha='flux3_lamplighter_pole_alpha.png';  sheet='h3_lamplighter_pole_turnaround.png';  sym=$true  }
  @{ id='pickup_tonic';                    alpha='flux3_tonic_alpha.png';             sheet='h3_tonic_turnaround.png';             sym=$true  }
)

# Is a job for this prop already in ComfyUI's queue? The clip reads its artwork
# from an anchor file named after the sheet, and a reconstruction reads views
# named after the asset, so one look at the queued jobs answers it.
function JobMentions($needle) {
  try {
    $q = Invoke-RestMethod -Uri http://127.0.0.1:8188/queue -Method Get -TimeoutSec 15
  } catch { return $false }
  foreach ($job in (@($q.queue_running) + @($q.queue_pending))) {
    if (-not $job) { continue }
    foreach ($node in $job[2].PSObject.Properties) {
      $img = $node.Value.inputs.image
      if ($img -and "$img" -like "*$needle*") { return $true }
    }
  }
  return $false
}

while ($true) {
  $rendered = 0
  $waiting = 0
  foreach ($q in $queue) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($q.sheet)
    $sheetPath = Join-Path $ROOT ("public/tex/props/" + $q.sheet)
    if (Test-Path $sheetPath) { continue }
    if (JobMentions "anchor_$stem") {
      Write-Output "WAIT $($q.id): its clip is in ComfyUI's queue"
      $waiting++
      continue
    }
    $alphaPath  = Join-Path $ROOT ("public/tex/props/" + $q.alpha)
    $previewPath = Join-Path $ROOT ("docs/props/" + $q.id + "/turntable.webp")
    New-Item -ItemType Directory -Force -Path (Split-Path $previewPath) | Out-Null
    $cliArgs = @('scripts/run_minimax_h3_turnaround.py', $alphaPath, $sheetPath, '--preview', $previewPath)
    if ($q.sym) { $cliArgs += '--symmetric' }
    Write-Output "=== START $($q.id) at $(Get-Date -Format o) ==="
    & $PY @cliArgs 2>&1 | ForEach-Object { Write-Output $_ }
    Write-Output "=== END $($q.id) exit=$LASTEXITCODE at $(Get-Date -Format o) ==="
    $rendered++
  }
  $left = @($queue | Where-Object { -not (Test-Path (Join-Path $ROOT ("public/tex/props/" + $_.sheet))) })
  if ($left.Count -eq 0) { Write-Output "=== EVERY SHEET IS RENDERED at $(Get-Date -Format o) ==="; exit 0 }
  if ($rendered -eq 0) {
    Write-Output "=== NOTHING RENDERED THIS PASS, $($left.Count) to go ($waiting waiting on a clip) ==="
    Start-Sleep -Seconds 30
  }
}
