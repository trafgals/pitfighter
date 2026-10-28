# Re-roll the turnaround clips that never showed the back.
#
# H3 turns the object about 240 degrees in 124 frames, and a clip that turns
# less than that never reaches the back view: the sheet script refuses it and
# the prop has to be rendered again with another seed.
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }
Set-Location $ROOT

# id, alpha cutout, sheet stem, symmetric, seed
$rerolls = @(
  @{ id='prop_tilly_clinker_tongs'; alpha='flux3_tilly_tongs_alpha.png';  stem='h3_tilly_tongs_turnaround';  sym=$false; seed=4242 }
  @{ id='prop_sluice_flatcap';      alpha='flux3_sluice_flatcap_alpha.png'; stem='h3_sluice_flatcap_turnaround'; sym=$true; seed=4242 }
)

foreach ($r in $rerolls) {
  $sheetPath = Join-Path $ROOT ("public/tex/props/" + $r.stem + ".png")
  if (Test-Path $sheetPath) { Write-Output "SKIP $($r.id): sheet exists"; continue }
  $alphaPath  = Join-Path $ROOT ("public/tex/props/" + $r.alpha)
  $previewPath = Join-Path $ROOT ("docs/props/" + $r.id + "/turntable.webp")
  $cliArgs = @('scripts/run_minimax_h3_turnaround.py', $alphaPath, $sheetPath, '--preview', $previewPath, '--seed', $r.seed)
  if ($r.sym) { $cliArgs += '--symmetric' }
  Write-Output "=== REROLL $($r.id) (seed $($r.seed)) at $(Get-Date -Format o) ==="
  & $PY @cliArgs 2>&1 | ForEach-Object { Write-Output $_ }
  Write-Output "=== END $($r.id) exit=$LASTEXITCODE at $(Get-Date -Format o) ==="
}
Write-Output "=== REROLL PHASE COMPLETE at $(Get-Date -Format o) ==="
