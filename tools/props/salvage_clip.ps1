# Assemble a turnaround sheet from a clip that is already in ComfyUI's output.
#
#   salvage_clip.ps1 <prompt_id> <sheet.png> <preview.webp> [-Symmetric]
#
# The H3 clip takes over an hour of GPU, and a chain that is restarted while a
# clip is in flight would otherwise render the same clip again. The frames are
# already written by ComfyUI, so the sheet is cut from them instead.
#
# The prompt id is enough: ComfyUI's history says which frames the job wrote,
# and the sheet script cuts the views out of them.
param(
  [Parameter(Mandatory = $true)][string]$PromptId,
  [Parameter(Mandatory = $true)][string]$Sheet,
  [Parameter(Mandatory = $true)][string]$Preview,
  [switch]$Symmetric
)
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }
Set-Location $ROOT

# wait for the job to finish, then ask ComfyUI which frames it wrote
$history = $null
for ($i = 0; $i -lt 240; $i++) {
  $history = Invoke-RestMethod -Uri "http://127.0.0.1:8188/history/$PromptId" -Method Get
  if ($history.PSObject.Properties.Name -contains $PromptId) { break }
  Write-Output "waiting for the clip $PromptId to finish"
  Start-Sleep -Seconds 30
}
if (-not ($history.PSObject.Properties.Name -contains $PromptId)) {
  Write-Output "the clip $PromptId never finished"; exit 1
}
$entry = $history.PSObject.Properties[$PromptId].Value
$images = @($entry.outputs.'10'.images)
if (-not $images) { Write-Output "the clip $PromptId wrote no frames"; exit 1 }
$first = $images[0].filename
Write-Output "the clip $PromptId wrote $($images.Count) frames, starting at $first"

$cliArgs = @('scripts/run_minimax_h3_turnaround.py', '-', $Sheet, '--from-frames', $first, '--preview', $Preview)
if ($Symmetric) { $cliArgs += '--symmetric' }
Write-Output "=== SALVAGE $Sheet from $first at $(Get-Date -Format o) ==="
& $PY @cliArgs 2>&1 | ForEach-Object { Write-Output $_ }
Write-Output "=== END exit=$LASTEXITCODE at $(Get-Date -Format o) ==="
if ($LASTEXITCODE) { exit 1 }
