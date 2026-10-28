# Build each prop's Pixal3D mesh as soon as its sheet lands.
#
# The sheet chain and the mesh chain share one GPU and one ComfyUI queue, so
# the meshes trail the sheets by one prop and the GPU never idles. A prop
# whose sheet is not there yet is waited for, not skipped.
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }
Set-Location $ROOT

$queue = @(
  @{ id='prop_pegg_cast_iron_last';      sheet='h3_pegg_shoelast_turnaround';     faces=20000 }
  @{ id='prop_crape_spiked_brolly';       sheet='h3_crape_brolly_turnaround';      faces=20000 }
  @{ id='prop_eleanor_weeping_rapier';    sheet='h3_eleanor_rapier_turnaround';   faces=20000 }
  @{ id='prop_tilly_clinker_tongs';       sheet='h3_tilly_tongs_turnaround';      faces=20000 }
  @{ id='prop_sluice_flatcap';            sheet='h3_sluice_flatcap_turnaround';   faces=16000 }
  @{ id='prop_kilnworth_nursecap';        sheet='h3_kilnworth_nursecap_turnaround'; faces=16000 }
  @{ id='prop_mule_championship_belt';    sheet='h3_mule_belt_turnaround';        faces=20000 }
  @{ id='prop_rook_souwester';            sheet='h3_rook_souwester_turnaround';   faces=16000 }
  @{ id='prop_bulwark_pistons';           sheet='h3_bulwark_pistons_turnaround';  faces=20000 }
  @{ id='prop_crump_samovar';             sheet='h3_crump_samovar_turnaround';    faces=20000 }
  @{ id='weapon_knuckleduster';           sheet='h3_knuckleduster_turnaround';    faces=12000 }
  @{ id='weapon_coal_shovel';             sheet='h3_coal_shovel_turnaround';      faces=16000 }
  @{ id='weapon_bone_saw';                sheet='h3_bone_saw_turnaround';         faces=14400 }
  @{ id='weapon_nail_bat';                sheet='h3_nail_bat_turnaround';         faces=16000 }
  @{ id='weapon_cleaver';                 sheet='h3_cleaver_turnaround';          faces=12800 }
  @{ id='weapon_piston_gauntlet';         sheet='h3_piston_gauntlet_turnaround';  faces=20000 }
  @{ id='weapon_lamplighter_pole';        sheet='h3_lamplighter_pole_turnaround'; faces=16000 }
  @{ id='pickup_tonic';                   sheet='h3_tonic_turnaround';            faces=9600  }
)

$deadline = (Get-Date).AddHours(20)
foreach ($item in $queue) {
  $id = $item.id
  $glb = Join-Path $ROOT "public/models/props/$id.glb"
  if (Test-Path $glb) { Write-Output "SKIP ${id}: mesh already exists"; continue }
  $sheetPath = Join-Path $ROOT "public/tex/props/$($item.sheet).png"
  while (-not (Test-Path $sheetPath)) {
    if ((Get-Date) -gt $deadline) { Write-Output "TIMEOUT waiting for ${id}'s sheet"; exit 1 }
    Start-Sleep -Seconds 60
  }
  Write-Output "=== START $id (--faces $($item.faces)) at $(Get-Date -Format o) ==="
  # the build reads the sheet from the manifest, and the manifest may only
  # name files that exist, so the entry is pointed at the sheet first
  & $PY "$PSScriptRoot\set_sheet_ref.py" $id $item.sheet
  & $PY scripts/run_pixal3d_mesh.py $id --faces $item.faces 2>&1 | ForEach-Object { Write-Output $_ }
  Write-Output "=== END $id exit=$LASTEXITCODE at $(Get-Date -Format o) ==="
}
Write-Output "=== MESH PHASE COMPLETE at $(Get-Date -Format o) ==="
