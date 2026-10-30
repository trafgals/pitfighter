# Watch the asset issues for what a reviewer has said, and act on it.
#
#   watch_revisions.ps1
#
# The review happens on the issues, so what a reviewer says is what the
# pipeline has to act on. This polls the asset issues and:
#
#   * re-queues a prop that a reviewer asked to be revised, with a new seed
#   * records an approval a reviewer has given, into the manifest and the
#     labels
#
# Nothing here approves anything by itself: an approval is only recorded when
# a human has given it on the issue. A command only counts when it starts a
# line of a comment, because the pipeline's own comment says "Comment
# `/approve-3d` to approve".
param(
  [int]$IntervalSeconds = 120
)
$ErrorActionPreference = 'Continue'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }
$SCRATCH = $PSScriptRoot
$LOG = Join-Path $ROOT 'test-output\watch-revisions.log'
Set-Location $ROOT

function Note($text) {
  $line = "$(Get-Date -Format o) $text"
  Write-Output $line
  Add-Content -Path $LOG -Value $line
}

Note "=== the issue watcher is up ==="

while ($true) {
  # a revision asked for on an issue puts the prop back in the build queue
  try {
    $out = & $PY "$SCRATCH\request_revision.py" --apply 2>&1
    $out | Where-Object { $_ -notmatch '^no revision has been asked' } | ForEach-Object { Note "[revision] $_" }
  } catch {
    Note "[revision] the sweep failed: $_"
  }

  # an approval given on an issue is carried into the manifest and the labels
  try {
    $out = & $PY "$SCRATCH\apply_approvals.py" --apply 2>&1
    $out | Where-Object { $_ -notmatch '^no approval has been given' } | ForEach-Object { Note "[approval] $_" }
  } catch {
    Note "[approval] the sweep failed: $_"
  }

  Start-Sleep -Seconds $IntervalSeconds
}
