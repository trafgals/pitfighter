"""Do the validation boxes in the manifest agree with the meshes they sit on?

Every prop the pipeline rebuilt carries validation regions: boxes cut from the
prop's art that ask the capture to find the prop's surface in them, and boxes
that ask it to find clear space. A box that the mesh disagrees with is a box
that cannot pass, and the capture says so.

This measures the surface in each region the way the capture measures it, and
says which regions the mesh agrees with. It changes nothing.

With an asset id, the box the prop's own art gives is measured as well, so
the two can be compared: the art's box and the box that was cut from the
sheet instead.

Usage:
    python tools/props/check_regions.py
    python tools/props/check_regions.py <asset_id>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mesh_surface  # noqa: E402
import refit_prop  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")


def entries():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    assets = manifest if isinstance(manifest, list) else manifest["assets"]
    return assets


def surface_of(entry, points, weights):
    """The surface in each of a prop's regions, with what the region asks for."""
    out = []
    for region in entry.get("validation", {}).get("regions") or []:
        limit = region.get("min_area_cm2", region.get("max_area_cm2"))
        area = mesh_surface.area_in(points, weights, (region["min_cm"], region["max_cm"]))
        ok = area >= limit if region["expect"] == "filled" else area <= limit
        out.append({"label": region["label"], "expect": region["expect"],
                    "limit": limit, "area": area, "ok": ok,
                    "min_cm": region["min_cm"], "max_cm": region["max_cm"]})
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv
    wanted = args[0] if args else None
    assets = entries()
    if wanted:
        assets = [a for a in assets if a["id"] == wanted]
        if not assets:
            print(f"{wanted} is not in the manifest")
            return 1

    failures = 0
    reported = []
    for entry in assets:
        glb = os.path.join(ROOT, entry.get("glb_output", ""))
        if not os.path.exists(glb) or not entry.get("validation", {}).get("regions"):
            continue
        tris = mesh_surface.read_glb(glb)
        points, weights = mesh_surface.sample(tris)
        for region in surface_of(entry, points, weights):
            if not region["ok"]:
                failures += 1
                print(f"FAIL {entry['id']}: {region['label']} holds {region['area']:.0f} cm2, "
                      f"limit {region['limit']} ({region['min_cm']}..{region['max_cm']})")
            elif wanted:
                print(f"  {entry['id']}: {region['label']} holds {region['area']:.0f} cm2, "
                      f"limit {region['limit']}")
            reported.append({"asset": entry["id"], "source": "manifest", **region})

        if wanted:
            # the box the prop's own art gives, for comparison
            frame = entry["validation"]["frame"]
            lo, hi = refit_prop.read_glb_bbox(glb)
            measured = {"width": round(hi[0] - lo[0], 2),
                        "height": round(hi[1] - lo[1], 2),
                        "depth": round(hi[2] - lo[2], 2)}
            art = refit_prop.derive_regions(entry, frame, measured)
            for region in art:
                area = mesh_surface.area_in(points, weights, (region["min_cm"], region["max_cm"]))
                limit = region.get("min_area_cm2", region.get("max_area_cm2"))
                ok = area >= limit if region["expect"] == "filled" else area <= limit
                print(f"  from the art: {region['label']} holds {area:.0f} cm2, limit {limit} "
                      f"({region['min_cm']}..{region['max_cm']})")
                reported.append({"asset": entry["id"], "source": "art", "label": region["label"],
                                 "expect": region["expect"], "limit": limit, "area": area,
                                 "ok": ok, "min_cm": region["min_cm"], "max_cm": region["max_cm"]})

    if as_json:
        print(json.dumps(reported))
        return 1 if failures else 0
    if failures:
        print(f"\n{failures} region(s) the mesh does not agree with")
        return 1
    print("every region's box is a box the mesh agrees with")
    return 0


if __name__ == "__main__":
    sys.exit(main())
