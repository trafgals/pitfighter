"""Read and write the asset manifest without losing anyone's change.

Several tools write the manifest at the same time: the finish chain records a
prop while the watcher on the issues may be recording an approval or a request
for a rebuild. Two things go wrong then, and both of them are silent:

  * a write that is not atomic leaves a half-written file for the next reader
  * a read-modify-write that is not locked loses whichever of the two changes
    was made in between

So the file is replaced rather than rewritten, and a writer holds a lock for as
long as it is changing the manifest.

Usage:
    from manifest_io import load, save, locked, update

    with locked(MANIFEST):
        manifest = load(MANIFEST)
        ...
        save(MANIFEST, manifest)

    # or, for the common shape:
    def bump(entry):
        entry["status"] = "gate:3-review-ingame-3d"

    update(MANIFEST, bump)
"""
import datetime
import hashlib
import json
import os
import tempfile
import time
from contextlib import contextmanager

# how long a writer waits for the lock before giving up
LOCK_TIMEOUT_S = 180.0
# a lock older than this is from a writer that died holding it
LOCK_STALE_S = 600.0


def now():
    """The current time, as the manifest writes it.

    The offset is written with it, so a reader in another timezone still reads
    the same instant.
    """
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def load(path):
    """The manifest, as it is on disk."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, manifest):
    """Write the manifest and put it in place in one step.

    The file is written beside the manifest and moved over it, so a reader
    either sees the old manifest or the new one and never half of either.
    """
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".asset_manifest.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _lock_path(path):
    # the lock lives in the temporary directory, not in the repository: it is
    # not a file of the project and it must not show up in git status
    digest = hashlib.md5(os.path.abspath(path).encode("utf-8")).hexdigest()[:12]
    return os.path.join(tempfile.gettempdir(), f"asset-manifest-{digest}.lock")


def _acquire(path, timeout):
    deadline = time.time() + timeout
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.write(fd, str(os.getpid()).encode("ascii"))
            return fd
        except FileExistsError:
            # a writer that died holding the lock leaves it behind
            try:
                if time.time() - os.path.getmtime(path) > LOCK_STALE_S:
                    os.unlink(path)
                    continue
            except OSError:
                pass
            if time.time() >= deadline:
                raise TimeoutError(f"the manifest lock {path} is still held after {timeout:.0f}s")
            time.sleep(0.2)


@contextmanager
def locked(path, timeout=LOCK_TIMEOUT_S):
    """Hold the manifest lock while the manifest is read and written."""
    lock = _lock_path(path)
    fd = _acquire(lock, timeout)
    try:
        yield
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(lock)
        except OSError:
            pass


def update(path, change, timeout=LOCK_TIMEOUT_S):
    """Change the manifest under the lock, and write it back.

    The change is a function that takes the manifest and edits it in place.
    It is called with the lock held, so nothing that changes the manifest in
    between is lost.
    """
    with locked(path, timeout):
        manifest = load(path)
        change(manifest)
        save(path, manifest)
    return manifest


def timestamp_of(value):
    """A manifest timestamp as a comparable instant.

    The timestamps are written with their offset, so two of them can be
    compared whatever timezone wrote them.
    """
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
