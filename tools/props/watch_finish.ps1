# Watch for meshes landing and finish each prop as it does.
#
#   watch_finish.ps1
#
# The GPU builds one prop at a time, behind the turnaround sheets, so this
# polls for a mesh that has appeared and runs the finish pipeline over it:
# stand the prop up on its pivot, re-fit the validation boxes, capture it, flip
# it if the reconstruction came out mirrored, record it, commit it, publish the
# renders and comment on the issue. A prop whose manifest entry still has its
# stand_in_measured has not been through the pipeline yet.
#
# A prop whose run fails is left for a while and the queue moves on, so one
# prop that will not settle cannot hold up the props behind it.
param(
  [int]$BackoffMinutes = 15
)
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }
$SCRATCH = $PSScriptRoot
Set-Location $ROOT

# asset id, issue number, the sheet's stem
$queue = @(
  @{ id='prop_pegg_cast_iron_last';      issue=83;  stem='h3_pegg_shoelast_turnaround' }
  @{ id='prop_crape_spiked_brolly';       issue=84;  stem='h3_crape_brolly_turnaround' }
  @{ id='prop_eleanor_weeping_rapier';    issue=85;  stem='h3_eleanor_rapier_turnaround' }
  @{ id='prop_tilly_clinker_tongs';       issue=86;  stem='h3_tilly_tongs_turnaround' }
  @{ id='prop_sluice_flatcap';            issue=87;  stem='h3_sluice_flatcap_turnaround' }
  @{ id='prop_kilnworth_nursecap';        issue=88;  stem='h3_kilnworth_nursecap_turnaround' }
  @{ id='prop_mule_championship_belt';    issue=89;  stem='h3_mule_belt_turnaround' }
  @{ id='prop_rook_souwester';            issue=90;  stem='h3_rook_souwester_turnaround' }
  @{ id='prop_bulwark_pistons';           issue=91;  stem='h3_bulwark_pistons_turnaround' }
  @{ id='prop_crump_samovar';             issue=92;  stem='h3_crump_samovar_turnaround' }
  @{ id='weapon_knuckleduster';           issue=93;  stem='h3_knuckleduster_turnaround' }
  @{ id='weapon_coal_shovel';             issue=94;  stem='h3_coal_shovel_turnaround' }
  @{ id='weapon_bone_saw';                issue=95;  stem='h3_bone_saw_turnaround' }
  @{ id='weapon_nail_bat';                issue=96;  stem='h3_nail_bat_turnaround' }
  @{ id='weapon_cleaver';                 issue=97;  stem='h3_cleaver_turnaround' }
  @{ id='weapon_piston_gauntlet';         issue=98;  stem='h3_piston_gauntlet_turnaround' }
  @{ id='weapon_lamplighter_pole';        issue=99;  stem='h3_lamplighter_pole_turnaround' }
  @{ id='pickup_tonic';                   issue=101; stem='h3_tonic_turnaround' }
)

function Finished($id) {
  $out = & $PY -c "import json;d=json.load(open(r'$ROOT\data\asset_manifest.json',encoding='utf-8'));e=[a for a in d['assets'] if a['id']=='$id'][0];print('yes' if 'stand_in_measured' not in e else 'no')"
  return ($out | Select-Object -Last 1).Trim() -eq 'yes'
}

# the props whose last run did not settle, and when to try them again
$backoff = @{}

while ($true) {
  $worked = $false
  foreach ($item in $queue) {
    $glb = "public/models/props/$($item.id).glb"
    if (-not (Test-Path $glb)) { continue }
    if (Finished $item.id) { continue }
    if ($backoff.ContainsKey($item.id) -and (Get-Date) -lt $backoff[$item.id]) { continue }
    Write-Output "=== FINISH $($item.id) at $(Get-Date -Format o) ==="
    & "$SCRATCH\auto_prop.ps1" $item.id $item.issue $item.stem 2>&1 | ForEach-Object { Write-Output $_ }
    $code = $LASTEXITCODE
    Write-Output "=== DONE $($item.id) exit=$code at $(Get-Date -Format o) ==="
    if ($code) {
      # leave it for a while and let the queue behind it move on
      $backoff[$item.id] = (Get-Date).AddMinutes($BackoffMinutes)
      Write-Output "$($item.id) did not settle; it is left until $(Get-Date).AddMinutes($BackoffMinutes)"
    } else {
      $backoff.Remove($item.id)
    }
    $worked = $true
    break
  }
  if (-not $worked) { Start-Sleep -Seconds 60 }
}
