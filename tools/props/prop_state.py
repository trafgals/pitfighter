"""Where a prop stands, read from the manifest under the manifest's lock.

Two chains read the manifest while the watcher on the issues may be writing
it: the mesh chain, which decides what to build, and the finish chain, which
decides what to capture and publish. Both read it through this, so neither of
them reads a file that is half written, and neither of them decides on a
manifest that has already been changed under it.

What it answers is one question: should the finish pipeline run on this prop
now?

  skip   - the prop has been through the pipeline and nothing is waiting on it
  wait   - a reviewer asked for a rebuild and the new mesh has not landed yet,
           so the mesh on disk is still the one that was reviewed, and
           publishing it again would only republish what the reviewer has
           already seen
  finish - the mesh on disk is the one to capture and publish

The three states come out of what is on the prop's entry:

  `stand_in_measured`   the prop has never been through the pipeline
  `revision_requested_at` a reviewer asked for it to be rebuilt
  `revision_built_at`   the rebuilt mesh has landed
  `revision_published_at` the rebuilt mesh has been captured and published

The last one matters: without it the rebuilt prop would keep its answer of
`finish` for ever, and the finish chain would capture and publish it again and
again. So the rebuild is a small cycle of its own - asked for, built,
published - and `revision_published_at` is where it ends.

Usage:
    python prop_state.py --list        # every prop and its state
    python prop_state.py <asset_id>    # one prop's state
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manifest_io  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

SKIP = "skip"
WAIT = "wait"
FINISH = "finish"


def state_of(entry):
    """What the manifest says about where one prop is."""
    requested = entry.get("revision_requested_at")
    built = entry.get("revision_built_at")
    published = entry.get("revision_published_at")
    if requested and not built and not published:
        # a rebuild is asked for and has not landed: the mesh on disk is the one
        # that was reviewed, so there is nothing new to publish
        return WAIT
    if built and not published:
        # the rebuild has landed: it has to be captured and published again
        return FINISH
    if "stand_in_measured" in entry:
        # the prop has never been through the pipeline
        return FINISH
    return SKIP


def states():
    """Every prop's state, by id."""
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
    return {entry["id"]: state_of(entry) for entry in manifest["assets"]}


def main():
    if "--list" in sys.argv:
        print(json.dumps(states(), indent=2, sort_keys=True))
        return 0
    if "--of" in sys.argv:
        # A debugging affordance: read a manifest entry on stdin and write back
        # what it reads as. The state machine is what decides whether a prop
        # is published, rebuilt or left alone, so it is held down by a test
        # that uses this. The bytes are decoded as UTF-8 rather than left to
        # the system's own codec.
        entry = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        print(state_of(entry))
        return 0
    asset_id = sys.argv[1]
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
    entry = next((a for a in manifest["assets"] if a["id"] == asset_id), None)
    if entry is None:
        print(f"{asset_id} is not in the manifest")
        return 1
    print(state_of(entry))
    return 0


if __name__ == "__main__":
    sys.exit(main())
