# Wait for one prop's mesh to land, and report how it is standing.
#
#   wait_for_prop.ps1 <asset_id> [minutes]
#
# The GPU builds one prop at a time, behind the turnaround sheets, so this
# polls for the mesh that is being built and, when it turns up, says how the
# prop is standing on its pivot. A prop whose approved art is drawn leaning
# has to be rolled back onto its pivot, and this is where that is checked.
param(
  [Parameter(Mandatory = $true)][string]$AssetId,
  [int]$Minutes = 240
)
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }
$SCRATCH = $PSScriptRoot
Set-Location $ROOT

$glb = "public/models/props/$AssetId.glb"
$deadline = (Get-Date).AddMinutes($Minutes)
while (-not (Test-Path $glb)) {
  if ((Get-Date) -gt $deadline) { Write-Output "TIMEOUT waiting for $AssetId"; exit 1 }
  Start-Sleep -Seconds 30
}
Write-Output "=== $AssetId landed at $(Get-Date -Format o) ==="
& $PY "$SCRATCH\lean_fit.py" $AssetId 2>&1 | ForEach-Object { Write-Output $_ }
$sheet = (& $PY -c "import json;d=json.load(open(r'$ROOT\data\asset_manifest.json',encoding='utf-8'));print([a for a in d['assets'] if a['id']=='$AssetId'][0].get('turnaround_sheet',''))" | Select-Object -Last 1).Trim()
if ($sheet) {
  & $PY "$SCRATCH\compare_front.py" $sheet $AssetId --json 2>&1 | ForEach-Object { Write-Output $_ }
}
Write-Output "=== ${AssetId}: $((Get-Item $glb).Length) bytes ==="
