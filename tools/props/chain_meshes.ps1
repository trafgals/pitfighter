# Build each prop's Pixal3D mesh as soon as its sheet lands.
#
#   chain_meshes.ps1
#
# The sheet chain and the mesh chain share one GPU and one ComfyUI queue, so
# the meshes trail the sheets by one prop and the GPU never idles.
#
# A prop whose sheet is not there yet is left for this round and the chain
# moves on, so one prop that will not settle cannot hold up the props behind
# it. A reconstruction that is already in ComfyUI's queue is left alone too: a
# second one for the same prop would cost half an hour of GPU for nothing.
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }
$SCRATCH = $PSScriptRoot
$COMFY_3D = if ($env:PIXAL3D_COMFY_OUTPUT) { $env:PIXAL3D_COMFY_OUTPUT } else { 'C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output\3d' }
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

# The raw GLB ComfyUI wrote for a prop, if it wrote one. A reconstruction whose
# placement was lost - a chain that was killed between the job finishing and
# the mesh being put on the pivot - is put on the pivot from the raw file
# instead of being rebuilt.
function RawGlb($id) {
  $found = Get-ChildItem $COMFY_3D -Filter "pixal3d_${id}_*.glb" -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -notmatch 'highpoly' } |
           Sort-Object LastWriteTime
  if ($found) { return $found[-1].FullName }
  return $null
}

while ($true) {
  $built = 0
  foreach ($item in $queue) {
    $id = $item.id
    $glb = Join-Path $ROOT "public/models/props/$id.glb"
    if (Test-Path $glb) { continue }
    $sheetPath = Join-Path $ROOT "public/tex/props/$($item.sheet).png"
    if (-not (Test-Path $sheetPath)) {
      Write-Output "SKIP ${id}: its sheet is not on disk yet"
      continue
    }
    if (JobMentions $id) {
      Write-Output "SKIP ${id}: a reconstruction is already in ComfyUI's queue"
      continue
    }
    $raw = RawGlb $id
    if ($raw) {
      Write-Output "=== PLACE ${id} from the raw GLB $raw at $(Get-Date -Format o) ==="
      & $PY "$SCRATCH\set_sheet_ref.py" $id $item.sheet 2>&1 | ForEach-Object { Write-Output $_ }
      & $PY scripts/run_pixal3d_mesh.py $id --shrink $raw $glb 2>&1 | ForEach-Object { Write-Output $_ }
      Write-Output "=== END ${id} exit=$LASTEXITCODE at $(Get-Date -Format o) ==="
      $built++
      continue
    }
    Write-Output "=== START ${id} (--faces $($item.faces)) at $(Get-Date -Format o) ==="
    # the build reads the sheet from the manifest, and the manifest may only
    # name files that exist, so the entry is pointed at the sheet first
    & $PY "$SCRATCH\set_sheet_ref.py" $id $item.sheet 2>&1 | ForEach-Object { Write-Output $_ }
    & $PY scripts/run_pixal3d_mesh.py $id --faces $item.faces 2>&1 | ForEach-Object { Write-Output $_ }
    Write-Output "=== END ${id} exit=$LASTEXITCODE at $(Get-Date -Format o) ==="
    $built++
  }
  if ($built -eq 0) {
    $left = @($queue | Where-Object { -not (Test-Path (Join-Path $ROOT "public/models/props/$($_.id).glb")) })
    if ($left.Count -eq 0) { Write-Output "=== EVERY MESH IS BUILT at $(Get-Date -Format o) ==="; exit 0 }
    Write-Output "=== NOTHING TO DO YET, $($left.Count) to go ==="
  }
  Start-Sleep -Seconds 30
}
