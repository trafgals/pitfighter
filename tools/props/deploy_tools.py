"""Deploy the per-prop tooling to the scratch directory the pipeline runs from.

The rebuild runs from a scratch directory so that it outlives the shell that
started it. That directory is outside the repository, so the scripts there
cannot find the repository from their own path and the paths they need are
written in instead. Everything else is the repository's own file, so a change
made in the repository is the change that runs.

This is the way back: `sync_tools.py` copies the scratch scripts into the
repository in a portable form, and this copies them out again in the form the
scratch directory needs. Without it the two drift, and a fix that was made in
the repository silently does not run.

Usage:
    python tools/props/deploy_tools.py <scratch dir>            # deploy
    python tools/props/deploy_tools.py <scratch dir> --check    # report drift
    python tools/props/deploy_tools.py <scratch dir> --only a.py b.ps1
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, "tools", "props")

# The scripts the pipeline runs from the scratch directory. The ones that are
# only run by hand from the repository are not deployed.
FILES = [
    "amend_dimensions.py",
    "apply_approvals.py",
    "auto_prop.ps1",
    "chain_meshes.ps1",
    "chain_sheets.ps1",
    "claim_revision.py",
    "compare_front.py",
    "finish_report.py",
    "git_io.py",
    "guardian.ps1",
    "issues.py",
    "lean_fit.py",
    "manifest_io.py",
    "manifest_pending.py",
    "measure_sheet.py",
    "mesh_each_sheet.ps1",
    "mirror_prop.py",
    "predict_dims.py",
    "prop_state.py",
    "record_prop.py",
    "refit_prop.py",
    "reroll_clips.ps1",
    "request_revision.py",
    "salvage_clip.ps1",
    "set_pose.py",
    "set_rim_skip.py",
    "set_sheet_ref.py",
    "start_comfyui.ps1",
    "supervisor.ps1",
    "update_issue.py",
    "wait_for_prop.ps1",
    "watch_finish.ps1",
    "watch_revisions.ps1",
]

PORTABLE_ROOT = 'ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))'
PORTABLE_ROOT_PS = "$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\\..')).Path"
PORTABLE_PY_PS = "$PY = if ($env:PIXAL3D_PYTHON) { $env:PIXAL3D_PYTHON } else { 'python' }"
PORTABLE_SCRATCH_PS = "$SCRATCH = $PSScriptRoot"


def deployed_python(text, worktree):
    # the replacement is a function, so the path's backslashes are not read
    # as escapes in a replacement template
    return re.sub(r'^ROOT = os\.path\.dirname\(.*$',
                  lambda m: f'ROOT = r"{worktree}"', text, flags=re.MULTILINE)


def deployed_powershell(text, worktree, python, scratch):
    text = re.sub(r"^\$ROOT = \(Resolve-Path .*$",
                  lambda m: f"$ROOT = '{worktree}'", text, flags=re.MULTILINE)
    text = re.sub(r"^\$PY\s*= if \(\$env:PIXAL3D_PYTHON\).*$",
                  lambda m: f"$PY  = '{python}'", text, flags=re.MULTILINE)
    text = re.sub(r"^\$SCRATCH = \$PSScriptRoot$",
                  lambda m: f"$SCRATCH = '{scratch}'", text, flags=re.MULTILINE)
    return text


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 1
    scratch = os.path.abspath(args[0])
    check = "--check" in sys.argv
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1:]

    python = sys.executable
    names = only or FILES
    drifted = []

    for name in names:
        src = os.path.join(HERE, name)
        if not os.path.exists(src):
            print(f"not in the repository: {name}")
            continue
        with open(src, encoding="utf-8") as f:
            text = f.read()
        if name.endswith(".ps1"):
            text = deployed_powershell(text, ROOT, python, scratch)
        else:
            text = deployed_python(text, ROOT)

        dst = os.path.join(scratch, name)
        if not os.path.exists(dst):
            # a tool that is new to the repository is new to the scratch
            # directory too: it is written there rather than skipped
            if check:
                print(f"missing in the scratch directory: {name}")
                drifted.append(name)
                continue
            with open(dst, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            print(f"deployed {name} (new)")
            continue
        with open(dst, encoding="utf-8") as f:
            current = f.read()
        if current == text:
            continue
        drifted.append(name)
        if check:
            continue
        with open(dst, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"deployed {name}")

    if check:
        if drifted:
            print(f"{len(drifted)} file(s) differ from the repository:")
            for name in drifted:
                print(f"  {name}")
        else:
            print("the scratch directory matches the repository")
    elif not drifted:
        print("the scratch directory already matched the repository")
    return 0


if __name__ == "__main__":
    sys.exit(main())
