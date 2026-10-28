# Finish one rebuilt prop, end to end, once its mesh is on disk.
#
#   auto_prop.ps1 <asset_id> <issue_number> <h3_stem> [-DryRun]
#
# The steps are the ones the pipeline needs, in order:
#
#   1. the prop is stood up: a prop whose approved art is drawn leaning is
#      rolled back onto its pivot, and the mesh is placed again if the roll
#      that is asked for leaves it visibly leaning
#   2. the validation boxes are re-fitted onto the mesh that was actually
#      built, because the boxes are cut from the prop's own alpha cutout and
#      have to be mapped onto the model's measured box, not the spec's
#   3. the prop is captured
#   4. the mesh is compared with the sheet it was built from: a reconstruction
#      that comes out mirrored is flipped and captured again
#   5. a prop whose capture passes is published, recorded at gate 3, committed
#      and moved on at its issue; a prop whose capture fails is recorded with
#      the finding, committed, and commented on without a label change
param(
  [Parameter(Mandatory = $true)][string]$AssetId,
  [Parameter(Mandatory = $true)][int]$Issue,
  [Parameter(Mandatory = $true)][string]$H3Stem,
  [switch]$DryRun
)
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }
$SCRATCH = $PSScriptRoot
Set-Location $ROOT

$sheet = "public/tex/props/$H3Stem.png"

function Capture($id) {
  Write-Output "=== CAPTURE $id ==="
  node scripts/capture_prop_renders.mjs $id 2>&1 | ForEach-Object { Write-Output $_ }
}

Write-Output "=== POSE $AssetId ==="
& $PY "$SCRATCH\lean_fit.py" $AssetId --fix 2>&1 | ForEach-Object { Write-Output $_ }

# The mesh is compared with the sheet it was built from before the validation
# boxes are fitted onto it: a reconstruction can come out mirrored, and the
# boxes are cut from the art, so they have to be fitted on the mesh as it
# ends up.
Write-Output "=== ORIENTATION $AssetId ==="
$check = & $PY "$SCRATCH\compare_front.py" $sheet $AssetId --json
Write-Output $check
$info = $check | Select-Object -Last 1 | ConvertFrom-Json
if ($info.mirrored) {
  Write-Output "the reconstruction came out mirrored: flipping it"
  & $PY "$SCRATCH\mirror_prop.py" $AssetId 2>&1 | ForEach-Object { Write-Output $_ }
  $check = & $PY "$SCRATCH\compare_front.py" $sheet $AssetId --json
  Write-Output $check
  $after = $check | Select-Object -Last 1 | ConvertFrom-Json
  if ($after.mirrored) {
    Write-Output "the flip did not make it match: flipping it back"
    & $PY "$SCRATCH\mirror_prop.py" $AssetId 2>&1 | ForEach-Object { Write-Output $_ }
  }
}

Write-Output "=== REFIT $AssetId ==="
& $PY "$SCRATCH\refit_prop.py" $AssetId 2>&1 | ForEach-Object { Write-Output $_ }

Capture $AssetId

$commentPath = "test-output/$AssetId-comment.md"
Write-Output "=== REPORT $AssetId ==="
& $PY "$SCRATCH\finish_report.py" $AssetId --comment $commentPath 2>&1 | ForEach-Object { Write-Output $_ }

$reportPath = "test-output/props/$AssetId/report.json"
if (-not (Test-Path $reportPath)) { Write-Output "NO REPORT: the capture did not get as far as one"; exit 1 }
$report = Get-Content $reportPath -Raw | ConvertFrom-Json
$failed = @($report.checks | Where-Object { -not $_.ok })
$passed = @($report.checks | Where-Object { $_.ok }).Count
$total = @($report.checks).Count

if ($failed.Count) {
  Write-Output ""
  Write-Output "=== ${AssetId}: $passed/$total checks pass, $($failed.Count) FAIL ==="
  foreach ($f in $failed) { Write-Output "  - $($f.message) ($($f.detail))" }
  $note = (& $PY "$SCRATCH\finish_report.py" $AssetId | Select-String -Pattern '^Pixal3D reconstruction built' | Select-Object -First 1)
  $note = "$note".Trim()
  & $PY "$SCRATCH\record_prop.py" $AssetId --blocked $note
  # The renders are published for a held prop as well: the review happens on
  # the issue, and the reviewer has to be able to see the asset to settle the
  # finding. The README written with them says the prop is held.
  Write-Output ""
  Write-Output "=== PUBLISH (held) $AssetId ==="
  node scripts/publish_prop_renders.mjs $AssetId --held 2>&1 | ForEach-Object { Write-Output $_ }
  if ($LASTEXITCODE) { Write-Output "the publish step failed"; exit 1 }
} else {
  Write-Output ""
  Write-Output "=== PUBLISH $AssetId ==="
  node scripts/publish_prop_renders.mjs $AssetId 2>&1 | ForEach-Object { Write-Output $_ }
  if ($LASTEXITCODE) { Write-Output "the publish step failed"; exit 1 }
  & $PY "$SCRATCH\record_prop.py" $AssetId
}
if ($LASTEXITCODE) { Write-Output "recording failed"; exit 1 }

# every file the manifest names has to be in the tree, so the commit takes the
# ones that are on disk but not yet in git with it
$paths = @(
  "public/models/props/$AssetId.glb",
  "docs/props/$AssetId",
  "data/asset_manifest.json",
  "public/tex/props/$H3Stem.png",
  "public/tex/props/$H3Stem.json"
)
$pending = & $PY "$SCRATCH\manifest_pending.py"
foreach ($p in $pending) { if ($paths -notcontains $p) { $paths += $p } }

if ($DryRun) {
  Write-Output ""
  Write-Output "=== DRY RUN: nothing is committed and no issue is touched ==="
  Write-Output "would commit: $($paths -join ', ')"
  if ($failed.Count) {
    Write-Output "would record the finding and comment on issue $Issue, gate held at 2"
  } else {
    Write-Output "would publish the renders, move the manifest to gate 3, comment on issue $Issue and move its label"
  }
  if (Test-Path $commentPath) { Write-Output "the comment would be:"; Get-Content $commentPath | ForEach-Object { Write-Output "  $_" } }
  exit 0
}

git add -- $paths
if ($LASTEXITCODE) { Write-Output "git add failed"; exit 1 }

if ($failed.Count) {
  $why = ($failed | ForEach-Object { $_.message }) -join '; '
  git commit -m "feat(props): rebuild $AssetId with Pixal3D multi-view pipeline" -m "$passed of $total automated checks pass. The checks that do not pass: $why. The finding is recorded in the manifest, the tolerance is left at 5%, and issue $Issue carries the ways forward for the director."
} else {
  git commit -m "feat(props): rebuild $AssetId with Pixal3D multi-view pipeline" -m "$passed of $total automated checks pass: the budgets, the frame and pivot placement, the surface regions and the rendering. The renders are published in docs/props/$AssetId for review."
}
if ($LASTEXITCODE) { Write-Output "git commit failed"; exit 1 }

# The review happens on the issue, and the issue links the renders on the
# branch, so the branch has to carry the commit before the comment goes up.
git push origin HEAD:feat/pixal3d-props-rebuild 2>&1 | ForEach-Object { Write-Output $_ }
if ($LASTEXITCODE) { Write-Output "the push failed; the issue links will not resolve until it is pushed" }

gh issue comment $Issue --body-file $commentPath
if ($LASTEXITCODE) { Write-Output "gh issue comment failed"; exit 1 }

# the issue's own 3D section says the prop is queued; it says what was built
# from here on, so the issue is the whole story. It also puts the issue's
# labels in line with what was built - a rebuilt prop is in the review queue,
# a prop that is still being made carries the stage it is at.
& $PY "$SCRATCH\update_issue.py" $AssetId $Issue 2>&1 | ForEach-Object { Write-Output $_ }
if ($LASTEXITCODE) { Write-Output "the issue body could not be updated" }

if (-not $failed.Count) {
  Write-Output "=== SHIPPED $AssetId (issue #$Issue, $passed/$total checks) ==="
} else {
  Write-Output "=== RECORDED $AssetId (issue #$Issue, $passed/$total checks, held on the finding) ==="
}
