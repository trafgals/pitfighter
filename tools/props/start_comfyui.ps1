# Start ComfyUI on the discrete card.
#
#   start_comfyui.ps1
#
# The machine has two AMD adapters: an integrated Radeon and the RX 9070 XT.
# ROCm lists them in an order that has changed between runs, and ComfyUI takes
# whichever is first - which was the integrated card, and a model that does not
# fit there fails with "HIP error: invalid kernel file" before it draws
# anything. So the card is picked here by name and pinned for the server.
#
# Set PIXAL3D_COMFY_HOME to the portable ComfyUI if it is not in the default
# place.
$ErrorActionPreference = 'Continue'
$HOME_DIR = if ($env:PIXAL3D_COMFY_HOME) { $env:PIXAL3D_COMFY_HOME } else { 'C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd' }
$PY = Join-Path $HOME_DIR 'python_embeded\python.exe'

$index = & $PY -c "import torch;print(next((i for i in range(torch.cuda.device_count()) if '9070' in torch.cuda.get_device_properties(i).name), 0))" 2>$null
$index = ($index | Select-Object -Last 1).ToString().Trim()
if (-not $index) { $index = '0' }
Write-Output "pinning the discrete card: HIP_VISIBLE_DEVICES=$index"
$env:HIP_VISIBLE_DEVICES = $index
$env:ROCR_VISIBLE_DEVICES = $index

Set-Location $HOME_DIR
& $PY -s ComfyUI\main.py --windows-standalone-build --enable-dynamic-vram *>> (Join-Path $HOME_DIR 'comfyui_pipeline.log')
