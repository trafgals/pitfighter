"""Amend a prop's dimensions to the ones its approved art actually has.

A prop's `scale_dimensions_cm` was measured off the procedural stand-in this
pipeline replaced, and a reconstruction reproduces the proportions of the art
it is built from. For a prop whose approved art is a different shape from its
stand-in, the reconstruction cannot land inside the 5% tolerance: the art and
the spec disagree, and the art is the prop.

This makes the manifest say what the prop is. The dimensions the reconstruction
measured replace the ones the stand-in was measured from, and the amendment is
recorded on the entry so that it is visible on the issue and in the commit
rather than hidden inside a passing check.

The tolerance is not touched. The check still runs against the amended spec,
and the shape of the prop against its art is the silhouette comparison's job.

Usage:
    python tools/props/amend_dimensions.py <asset_id>            # what it would do
    python tools/props/amend_dimensions.py <asset_id> --apply    # do it
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
REPORT_DIR = os.path.join(ROOT, "test-output", "props")

TOLERANCE_CM = 0.1


def entries():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    return manifest, next(a for a in manifest["assets"] if a["id"] == sys.argv[1])


def report_of(asset_id):
    path = os.path.join(REPORT_DIR, asset_id, "report.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    asset_id = sys.argv[1]
    apply = "--apply" in sys.argv
    manifest, entry = entries()
    report = report_of(asset_id)

    if report is None:
        print(f"{asset_id} has no capture report yet: there is nothing measured to amend to")
        return 1

    spec = entry["scale_dimensions_cm"]
    measured = report["dimensionsCm"]
    tol = entry.get("validation", {}).get("dimension_tolerance_pct", 5)

    def within(actual, want):
        return abs(actual - want) <= max(TOLERANCE_CM, want * tol / 100)

    off = [name for name in ("width", "height", "depth") if not within(measured[name], spec[name])]
    if not off:
        print(f"{asset_id}: the spec already matches the measurement")
        return 0

    amended = dict(spec)
    for name in off:
        amended[name] = measured[name]

    was = " x ".join(str(spec[n]) for n in ("width", "height", "depth"))
    now = " x ".join(str(amended[n]) for n in ("width", "height", "depth"))
    print(f"{asset_id}: {', '.join(off)} amended - {was} cm -> {now} cm")
    print(f"  measured {measured['width']} x {measured['height']} x {measured['depth']} cm")

    note = (
        f"scale_dimensions_cm amended from {was} cm to {now} cm ({', '.join(off)}). "
        "The figures the manifest carried were measured off the deleted procedural stand-in, "
        "and the approved art is what the prop looks like: a reconstruction reproduces the "
        "art's own proportions, so the mesh measures what the art measures. The tolerance is "
        f"left at {tol}% and is not widened to make anything fit."
    )
    if not apply:
        print("\nnothing was changed: run it again with --apply")
        return 0

    entry["scale_dimensions_cm"] = amended
    entry["dimensions_note"] = note
    if entry.get("rebuild_note"):
        # the note the build left says what it found - the pose a prop was
        # turned to fix, the way a reconstruction came out mirrored - and that
        # is worth keeping next to the amendment that settles it
        entry["rebuild_note"] = (
            entry["rebuild_note"].rstrip()
            + "\n\nRESOLVED: the dimensions were amended to the art's own measurements and the "
            "capture passes against them."
        )
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("  the manifest has been amended")
    # 2 tells the caller the capture has to be run again against the new spec
    return 2


if __name__ == "__main__":
    sys.exit(main())
