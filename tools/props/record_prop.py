"""Record a rebuilt prop in the manifest, whichever way its gate went.

  python record_prop.py <asset_id>                  the capture passed: gate 3
  python record_prop.py <asset_id> --blocked "<why>"  it did not: the finding
                                                  is recorded and the gate stays
  python record_prop.py <asset_id> --note "<what the build found>"

Usage: python record_prop.py <asset_id> [--blocked "<reason>"] [--note "<text>"]
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import manifest_io  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

ORDER = [
    "id", "name", "character", "category", "slot", "poly_budget", "file_budget_bytes",
    "scale_dimensions_cm", "status", "pivot", "glb_output", "validation", "measured",
    "source", "build", "validate", "reference_concept", "alpha_cutout",
    "turnaround_sheet", "turntable", "rebuild_note", "dimensions_note",
    "revision_requested_at", "revision_seed", "revision_claimed_at",
    "revision_built_at", "revision_published_at", "revision_note",
]


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    json_len = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + json_len]), len(data)


def measure(doc):
    """The figures the manifest's measured block holds, as the chair's does."""
    triangles = 0
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            indices = prim.get("indices")
            if indices is not None:
                triangles += doc["accessors"][indices]["count"] / 3
            acc = doc["accessors"][prim["attributes"]["POSITION"]]
            for i in range(3):
                lo[i] = min(lo[i], acc["min"][i])
                hi[i] = max(hi[i], acc["max"][i])
    return {
        "triangles": int(triangles),
        "bbox_min_cm": [round(v * 100, 1) for v in lo],
        "bbox_max_cm": [round(v * 100, 1) for v in hi],
        "meshes": len(doc.get("meshes", [])),
        "materials": len(doc.get("materials", [])),
        "embedded_images": len(doc.get("images", [])),
    }


def faces_for(entry):
    """The decimation target the prop's polygon budget allows.

    The workflow decimates to 20,000 faces, which is the chair's budget at
    80%. A prop with a smaller budget is decimated to the same 80% of it, so
    the mesh it ships is under the budget rather than on it.
    """
    budget = entry["poly_budget"]
    return 20000 if budget >= 25000 else int(budget * 0.8)


def main():
    asset_id = sys.argv[1]
    blocked = None
    note = None
    if "--blocked" in sys.argv:
        blocked = sys.argv[sys.argv.index("--blocked") + 1]
    if "--note" in sys.argv:
        note = sys.argv[sys.argv.index("--note") + 1]

    glb = os.path.join(ROOT, "public", "models", "props", f"{asset_id}.glb")
    if not os.path.exists(glb):
        raise SystemExit(f"{glb} does not exist yet")

    doc, size = read_glb(glb)
    measured = measure(doc)
    measured["bytes"] = size

    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
        faces = faces_for(entry)
        build = f"python scripts/run_pixal3d_mesh.py {asset_id}"
        if faces != 20000:
            build += f" --faces {faces}"
        entry["build"] = build
        entry["measured"] = measured
        entry.pop("stand_in_measured", None)
        # the rebuild a reviewer asked for has landed; the seed it used is
        # spent, and so is the claim on it
        entry.pop("revision_seed", None)
        entry.pop("revision_claimed_at", None)
        # the rebuild has now been captured and published, so the cycle is
        # closed: without this the prop would still read as "to be finished"
        # and the finish chain would publish it again and again
        if entry.get("revision_built_at"):
            entry["revision_published_at"] = manifest_io.now()
            entry.pop("revision_built_at", None)

        if blocked:
            # the capture did not pass: the gate stays where it is and the finding
            # is recorded against the entry
            entry["status"] = "gate:2-rebuild-pixal3d"
            entry["rebuild_note"] = blocked
        else:
            entry["status"] = "gate:3-review-ingame-3d"
            if note:
                # what this build found: it replaces the note of an earlier
                # build, which would otherwise name a finding that no longer
                # holds
                entry["rebuild_note"] = note
            # the note the build left is kept when the dimensions were amended:
            # it says what the build found, and the amendment settles the
            # finding rather than replacing it
            elif not entry.get("dimensions_note"):
                entry.pop("rebuild_note", None)

        ranked = sorted(entry.items(),
                        key=lambda kv: (ORDER.index(kv[0]) if kv[0] in ORDER else len(ORDER), kv[0]))
        entry.clear()
        entry.update(ranked)

        manifest_io.save(MANIFEST, manifest)

    print(f"{asset_id}: {measured['triangles']} triangles, {size:,} bytes, "
          f"bbox {measured['bbox_min_cm']}..{measured['bbox_max_cm']} cm, status {entry['status']}")


if __name__ == "__main__":
    main()
