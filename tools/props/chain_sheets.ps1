# Render the H3 four-view turnaround sheet for every prop that still needs one.
#
#   chain_sheets.ps1
#
# The run loops, because a sheet chain is a long job and the loop picks up where
# the last pass stopped: a sheet that is already on disk is skipped, a clip
# that is already in ComfyUI's queue is waited for rather than rendered a
# second time, and a clip that has finished is cut into a sheet from its frames
# rather than paid for again.
#
# A clip that never shows the back view is refused by the sheet script, and a
# prop whose clip is refused is rendered again with another seed: the same
# seed gives the same clip, and an hour of GPU for a clip that will be
# refused is an hour of GPU wasted. A prop that has been refused three times
# is left for a human rather than rendered a fourth time.
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

# the seeds a clip is rendered with: the first attempt, then another seed each
# time a clip is refused
$seeds = @(1890, 4242, 7777, 31337, 2024)
$maxAttempts = 3

# The job in ComfyUI's queue for this prop, by prompt id, if there is one. The
# clip reads its artwork from an anchor file named after the sheet, so one look
# at the queued jobs answers it.
function JobFor($needle) {
  try {
    $q = Invoke-RestMethod -Uri http://127.0.0.1:8188/queue -Method Get -TimeoutSec 15
  } catch { return $null }
  foreach ($job in (@($q.queue_running) + @($q.queue_pending))) {
    if (-not $job) { continue }
    $hit = $false
    foreach ($node in $job[2].PSObject.Properties) {
      $img = $node.Value.inputs.image
      if ($img -and "$img" -like "*$needle*") { $hit = $true }
    }
    if ($hit) { return "$($job[1])" }
  }
  return $null
}

# the first frame of a clip that has finished, from its prompt id
function FirstFrame($promptId) {
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8188/history/$promptId" -Method Get -TimeoutSec 15
  } catch { return $null }
  if (-not ($h.PSObject.Properties.Name -contains $promptId)) { return $null }
  $images = @($h.PSObject.Properties[$promptId].Value.outputs.'10'.images)
  if (-not $images) { return $null }
  return "$($images[0].filename)"
}

function Attempts($id) {
  $file = Join-Path $ROOT "test-output/props/$id/attempts.txt"
  if (Test-Path $file) {
    $n = 0
    if ([int]::TryParse((Get-Content $file -Raw).Trim(), [ref]$n)) { return $n }
  }
  return 0
}
function Set-Attempts($id, $n) {
  $file = Join-Path $ROOT "test-output/props/$id/attempts.txt"
  New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
  Set-Content -Path $file -Value $n -NoNewline
}

while ($true) {
  $rendered = 0
  $waiting = 0
  $exhausted = 0
  foreach ($q in $queue) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($q.sheet)
    $sheetPath = Join-Path $ROOT ("public/tex/props/" + $q.sheet)
    if (Test-Path $sheetPath) { continue }
    $attempts = Attempts $q.id
    if ($attempts -ge $maxAttempts) {
      Write-Output "GIVE UP $($q.id): $attempts clips were refused"
      $exhausted++
      continue
    }
    $clipFile = Join-Path $ROOT "test-output/props/$($q.id)/clip.txt"
    $promptId = JobFor "anchor_$stem"
    if ($promptId) {
      # the clip is in flight: remember it, so its frames are not paid for twice
      New-Item -ItemType Directory -Force -Path (Split-Path $clipFile) | Out-Null
      Set-Content -Path $clipFile -Value $promptId -NoNewline
      Write-Output "WAIT $($q.id): its clip $promptId is in ComfyUI's queue"
      $waiting++
      continue
    }
    $alphaPath  = Join-Path $ROOT ("public/tex/props/" + $q.alpha)
    $previewPath = Join-Path $ROOT ("docs/props/" + $q.id + "/turntable.webp")
    New-Item -ItemType Directory -Force -Path (Split-Path $previewPath) | Out-Null

    # a clip that has finished and was not cut into a sheet is cut now, for
    # the price of reading its frames rather than an hour of GPU
    $salvaged = $false
    if (Test-Path $clipFile) {
      $first = FirstFrame (Get-Content $clipFile -Raw).Trim()
      if ($first) {
        $cliArgs = @('scripts/run_minimax_h3_turnaround.py', '-', $sheetPath, '--from-frames', $first, '--preview', $previewPath)
        if ($q.sym) { $cliArgs += '--symmetric' }
        Write-Output "=== SALVAGE $($q.id) from $first at $(Get-Date -Format o) ==="
        & $PY @cliArgs 2>&1 | ForEach-Object { Write-Output $_ }
        Write-Output "=== END $($q.id) exit=$LASTEXITCODE at $(Get-Date -Format o) ==="
        if ($LASTEXITCODE -eq 0) { $salvaged = $true; $rendered++; continue }
        # the clip itself is the problem: another seed, another clip
        Set-Attempts $q.id ($attempts + 1)
        Set-Content -Path $clipFile -Value 'spent' -NoNewline
        Write-Output "the clip for $($q.id) is refused; attempt $($attempts + 1) of $maxAttempts"
      }
    }
    if ($salvaged) { continue }

    $seed = $seeds[[Math]::Min($attempts, $seeds.Count - 1)]
    $cliArgs = @('scripts/run_minimax_h3_turnaround.py', $alphaPath, $sheetPath, '--preview', $previewPath, '--seed', $seed)
    if ($q.sym) { $cliArgs += '--symmetric' }
    Write-Output "=== START $($q.id) (seed $seed) at $(Get-Date -Format o) ==="
    & $PY @cliArgs 2>&1 | ForEach-Object { Write-Output $_ }
    Write-Output "=== END $($q.id) exit=$LASTEXITCODE at $(Get-Date -Format o) ==="
    if ($LASTEXITCODE) {
      Set-Attempts $q.id ($attempts + 1)
      Write-Output "the clip for $($q.id) is refused; attempt $($attempts + 1) of $maxAttempts"
    }
    $rendered++
  }
  $left = @($queue | Where-Object { -not (Test-Path (Join-Path $ROOT ("public/tex/props/" + $_.sheet))) })
  if ($left.Count -eq 0) { Write-Output "=== EVERY SHEET IS RENDERED at $(Get-Date -Format o) ==="; exit 0 }
  if ($rendered -eq 0) {
    Write-Output "=== NOTHING RENDERED THIS PASS, $($left.Count) to go ($waiting waiting on a clip, $exhausted given up on) ==="
    if ($waiting -eq 0 -and $exhausted -eq $left.Count) {
      Write-Output "=== NO MORE SHEETS CAN BE MADE; the props that need a human are listed above ==="
      exit 0
    }
    Start-Sleep -Seconds 30
  }
}
