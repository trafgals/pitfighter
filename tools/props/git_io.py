"""Commit and push from here, and not from anywhere else.

Two things commit to this repository: the pipeline, which commits a prop it
has just built, and the watcher on the issues, which commits the manifest when
a reviewer has approved a prop. Both work in the same working tree, so both
take the same lock and both commit the same way.

The lock matters because git has one index and one lock file. Two commits at
once do not fail cleanly: one of them takes the index lock, the other fails
with "Unable to create ... .lock" and loses whatever it was doing. The
watcher polls every two minutes and the pipeline commits whenever a prop
finishes, so they will meet sooner or later.

The commit is a partial one, naming the paths it commits. A plain `git commit`
commits *everything that is staged*, and the pipeline stages its prop's files
one at a time - so a commit that named no paths would sweep the pipeline's
half-staged prop into the watcher's approval commit.

Usage:
    from git_io import commit, push, locked

    commit(["data/asset_manifest.json"], ["chore(assets): ..."])
    push()

    # and from the shell, so the PowerShell side commits the same way:
    python git_io.py commit <path> [<path> ...] --message <text> [--push]
"""
import hashlib
import os
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# the branch every change to this work goes out on
BRANCH = "feat/pixal3d-props-rebuild"

# how long a caller waits for the git lock, and how old a lock has to be
# before it is treated as abandoned
LOCK_WAIT_S = 120.0
LOCK_STALE_S = 600.0


def lock_path():
    """Where the git lock is.

    It is in the repository's own output directory rather than in the
    repository itself, so it is not a file of the project and it never shows
    up in `git status`.
    """
    digest = hashlib.md5(os.path.abspath(ROOT).encode("utf-8")).hexdigest()[:12]
    return os.path.join(tempfile.gettempdir(), f"pitfighter-git-{digest}.lock")


@contextmanager
def locked(path=None, wait=LOCK_WAIT_S):
    """Hold the git lock while the index is being changed."""
    path = path or lock_path()
    deadline = time.time() + wait
    fd = None
    while fd is None:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.write(fd, str(os.getpid()).encode("ascii"))
        except FileExistsError:
            # a holder that died leaves the lock behind
            try:
                if time.time() - os.path.getmtime(path) > LOCK_STALE_S:
                    os.unlink(path)
                    continue
            except OSError:
                pass
            if time.time() >= deadline:
                raise TimeoutError(f"the git lock {path} is still held after {wait:.0f}s")
            time.sleep(0.25)
    try:
        yield
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(path)
        except OSError:
            pass


def run(*args, check=True):
    """Run a git command in the repository."""
    result = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if check and result.returncode:
        raise RuntimeError(
            f"git {' '.join(args)} failed: {result.stderr.strip() or result.stdout.strip()}"
        )
    return result


def commit(paths, messages, push_branch=None):
    """Commit the named paths, with the named messages.

    Only the paths are committed. The pipeline stages a prop's files one at a
    time, and a commit that named no paths would take whatever was staged
    along with it.

    A commit with nothing to say is not an error: the watcher polls every two
    minutes, and most of the time there is nothing to record.
    """
    lines = []
    for message in messages:
        lines += ["-m", message]
    with locked():
        run("add", "--", *paths)
        # is there anything to say about these paths? `git commit` fails with
        # "no changes added to commit" when there is not, and that is a
        # normal outcome here rather than a fault
        staged = run("diff", "--cached", "--quiet", "--", *paths, check=False)
        if staged.returncode == 0:
            return False
        run("commit", *lines, "--", *paths)
    if push_branch:
        push(push_branch)
    return True


def push(branch=BRANCH):
    """Push this work to the branch it is reviewed on."""
    result = run("push", "origin", f"HEAD:{branch}", check=False)
    if result.returncode:
        raise RuntimeError(f"the push failed: {result.stderr.strip()}")
    return result


def main(argv=None):
    """Commit from the shell, the same way the Python side commits."""
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] != "commit":
        print(__doc__)
        return 1
    paths = []
    messages = []
    push_after = False
    index = 1
    while index < len(argv):
        argument = argv[index]
        if argument == "--message":
            messages.append(argv[index + 1])
            index += 2
        elif argument == "--push":
            push_after = True
            index += 1
        else:
            paths.append(argument)
            index += 1
    if not paths:
        print("nothing was named to commit")
        return 1
    if not messages:
        messages = ["chore(assets): the manifest is up to date"]
    if commit(paths, messages, push_branch=BRANCH if push_after else None):
        print(f"committed {len(paths)} path(s)")
    else:
        print("there was nothing to commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
