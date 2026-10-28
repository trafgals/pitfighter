"""Record a rebuilt prop in the manifest, whichever way its gate went.

  python record_prop.py <asset_id>                  the capture passed: gate 3
  python record_prop.py <asset_id> --blocked "<why>"  it did not: the finding
                                                  is recorded and the gate stays

Usage: python record_prop.py <asset_id> [--blocked "<reason>"]
"""
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

ORDER = [
    "id", "name", "character", "category", "slot", "poly_budget", "file_budget_bytes",
    "scale_dimensions_cm", "status", "pivot", "glb_output", "validation", "measured",
    "source", "build", "validate", "reference_concept", "alpha_cutout",
    "turnaround_sheet", "turntable", "rebuild_note",
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
    if "--blocked" in sys.argv:
        blocked = sys.argv[sys.argv.index("--blocked") + 1]

    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    glb = os.path.join(ROOT, entry["glb_output"])
    if not os.path.exists(glb):
        raise SystemExit(f"{glb} does not exist yet")

    doc, size = read_glb(glb)
    measured = measure(doc)
    measured["bytes"] = size

    faces = faces_for(entry)
    build = f"python scripts/run_pixal3d_mesh.py {asset_id}"
    if faces != 20000:
        build += f" --faces {faces}"
    entry["build"] = build
    entry["measured"] = measured
    entry.pop("stand_in_measured", None)

    if blocked:
        # the capture did not pass: the gate stays where it is and the finding
        # is recorded against the entry
        entry["status"] = "gate:2-rebuild-pixal3d"
        entry["rebuild_note"] = blocked
    else:
        entry["status"] = "gate:3-review-ingame-3d"
        entry.pop("rebuild_note", None)

    ranked = sorted(entry.items(),
                    key=lambda kv: (ORDER.index(kv[0]) if kv[0] in ORDER else len(ORDER), kv[0]))
    entry.clear()
    entry.update(ranked)

    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"{asset_id}: {measured['triangles']} triangles, {size:,} bytes, "
          f"bbox {measured['bbox_min_cm']}..{measured['bbox_max_cm']} cm, status {entry['status']}")


if __name__ == "__main__":
    main()
