"""The rebuild of a prop, from the moment a reviewer asks for it.

A reviewer asks for a change on the issue. The prop goes back into the build
queue with a new seed, and the mesh is rebuilt from the same approved sheet
with that seed - a fresh reconstruction, not the one that was reviewed.

Two things have to be true of that rebuild, and both of them are about the
GPU being a single, serial thing:

  * it is built exactly once. Two passes of the mesh chain finding the same
    pending rebuild would cost two hours of GPU for the same prop, and the
    second build would land on top of the first. So the seed is *claimed*:
    the claim is written to the manifest under the manifest's lock, and only
    the pass that won the claim is given the seed.
  * the finish chain does not re-publish the mesh that was reviewed while the
    rebuild is in flight. The prop's state is read through `prop_state.py`,
    which says `wait` for exactly that window.

When the rebuilt mesh lands, the prop's measured figures and its build command
are cleared: the mesh on disk is a new one, and the figures that described the
old one would be wrong. The finish chain then captures and publishes it again,
and `record_prop.py` writes the new figures.

Usage:
    python claim_revision.py <asset_id>     # the seed to build with, or nothing
    python claim_revision.py --list         # what is pending, and what is claimed
    python claim_revision.py --built <id>   # the rebuilt mesh has landed
    python claim_revision.py --release <id> # the build failed: give the claim back
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manifest_io  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

# how long a claim is held before it is treated as abandoned. A reconstruction
# is half an hour of GPU and the queue in front of it can be longer, so the
# claim is held generously; it is given up explicitly if the build fails.
CLAIM_HOLD_S = 6 * 3600


def entry_of(manifest, asset_id):
    return next((a for a in manifest["assets"] if a["id"] == asset_id), None)


def pending(entry):
    """The seed this prop is waiting to be built with, if it is waiting."""
    return entry.get("revision_seed") or ""


def claimed(entry):
    """Whether a rebuild has already been claimed for this prop."""
    return bool(entry.get("revision_claimed_at"))


def claim(asset_id):
    """Claim the pending rebuild of a prop, and give the seed to the winner.

    The claim is written under the manifest's lock, so two passes of the mesh
    chain cannot both win it.
    """
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        entry = entry_of(manifest, asset_id)
        if entry is None:
            print(f"{asset_id} is not in the manifest")
            return None
        seed = pending(entry)
        if not seed:
            # nothing to build: the prop is not waiting for a rebuild
            return None
        if claimed(entry):
            # a rebuild is already under way; this pass is not the one that
            # does it
            return None
        entry["revision_claimed_at"] = manifest_io.now()
        manifest_io.save(MANIFEST, manifest)
    return seed


def landed(asset_id):
    """Record that the rebuilt mesh is on disk.

    The measured figures and the build command are cleared with it: the mesh
    that is on disk is a new one, and the figures that described the old one
    would be wrong. The finish chain captures and publishes it again, and
    `record_prop.py` writes the new figures.
    """
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        entry = entry_of(manifest, asset_id)
        if entry is None:
            print(f"{asset_id} is not in the manifest")
            return 1
        if not entry.get("revision_requested_at"):
            print(f"{asset_id} was not waiting for a rebuild")
            return 1
        entry["revision_built_at"] = manifest_io.now()
        entry.pop("measured", None)
        entry.pop("build", None)
        manifest_io.save(MANIFEST, manifest)
    print(f"{asset_id}: the rebuilt mesh has landed")
    return 0


def release(asset_id):
    """Give the claim back, so another pass can build the prop.

    A build that fails - a GPU that runs out of memory, a sheet that turns out
    to be unreadable - leaves the claim held with nothing behind it. The prop
    would then never be rebuilt, because every later pass would see the claim
    and stand aside. So a failed build hands the claim back.
    """
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        entry = entry_of(manifest, asset_id)
        if entry is None:
            print(f"{asset_id} is not in the manifest")
            return 1
        if not entry.get("revision_claimed_at"):
            print(f"{asset_id} has no claim to release")
            return 0
        entry.pop("revision_claimed_at", None)
        manifest_io.save(MANIFEST, manifest)
    print(f"{asset_id}: the claim has been given back")
    return 0


def listing():
    """What is waiting to be rebuilt, and what has been claimed."""
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
    out = []
    for entry in manifest["assets"]:
        if pending(entry) or entry.get("revision_requested_at"):
            out.append({
                "id": entry["id"],
                "seed": pending(entry) or None,
                "claimed_at": entry.get("revision_claimed_at"),
                "requested_at": entry.get("revision_requested_at"),
                "built_at": entry.get("revision_built_at"),
            })
    return out


def main():
    if "--list" in sys.argv:
        print(json.dumps(listing(), indent=2))
        return 0
    if "--built" in sys.argv:
        return landed(sys.argv[sys.argv.index("--built") + 1])
    if "--release" in sys.argv:
        return release(sys.argv[sys.argv.index("--release") + 1])
    asset_id = sys.argv[1]
    seed = claim(asset_id)
    if seed:
        print(seed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
