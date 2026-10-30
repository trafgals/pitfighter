"""Where a validation box should sit on the mesh that was actually built.

The validation boxes are cut out of a prop's approved art and mapped onto the
mesh by stretching the art's crop over the mesh's bounding box. A
reconstruction's proportions are not the drawing's, so for some props a box
lands in the wrong place: the shovel's and the cleaver's box that asks for
the prop's surface comes out with no surface in it at all, and the chair's
box that asks for clear space comes out full of the chair.

This searches for a better place for a box, keeping the box's *size* and
the half of the prop it belongs to, and taking its *place* from the mesh:

  * a box that has to be filled goes where the mesh's surface is
  * a box that has to be clear goes where the mesh's surface is not

The mesh is read the way the capture reads it - the triangles of the model as
it stands - and the surface is measured the same way the capture measures
it: each triangle is sampled on a barycentric grid fine enough to resolve
about 5 mm, and the part of it inside the box is counted.

Usage: python tools/props/fit_region.py <asset_id>
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mesh_surface  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

STEP_CM = 0.5


def area_in(points, weights, box_cm):
    """The surface inside a box, in square centimetres."""
    return mesh_surface.area_in(points, weights, box_cm)


def candidates(entry, region, points, weights, lo, hi):
    """Places the same box could sit, with the surface each would hold."""
    size = [region["max_cm"][i] - region["min_cm"][i] for i in range(3)]
    frame = entry["validation"]["frame"]
    mid = (frame["y_min_cm"] + frame["y_max_cm"]) / 2
    lower = region["label"].startswith("the lower half")
    upper = region["label"].startswith("the upper half")

    def steps(lo_v, hi_v, size_v):
        span = hi_v - size_v
        if span < lo_v:
            return [lo_v]
        return list(np.round(np.arange(lo_v, span + 1e-9, STEP_CM), 1))

    xs = steps(lo[0], hi[0], size[0])
    ys = steps(lo[1], hi[1], size[1])
    zs = steps(lo[2], hi[2], size[2])
    if lower:
        ys = [y for y in ys if y + size[1] <= mid + 1e-9]
    if upper:
        ys = [y for y in ys if y >= mid - 1e-9]
    out = []
    for x in xs:
        for y in ys:
            for z in zs:
                box = ([x, y, z], [round(x + size[0], 1), round(y + size[1], 1), round(z + size[2], 1)])
                out.append((box, area_in(points, weights, box)))
    out.sort(key=lambda p: p[1], reverse=(region["expect"] == "filled"))
    return out


def main():
    asset_id = sys.argv[1]
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    tris = mesh_surface.read_glb(os.path.join(ROOT, entry["glb_output"]))
    lo, hi = mesh_surface.bbox_cm(tris)
    points, weights = mesh_surface.sample(tris)
    print(f"{asset_id}: {len(tris)} triangles, {len(points)} samples, "
          f"bbox {lo}..{hi} cm")
    for region in entry["validation"].get("regions", []):
        limit = region.get("min_area_cm2", region.get("max_area_cm2"))
        here = area_in(points, weights, (region["min_cm"], region["max_cm"]))
        print(f"\n{region['label']} ({region['expect']}, limit {limit})")
        print(f"  as it is: {region['min_cm']}..{region['max_cm']} -> {here:.0f} cm2")
        for box, area in candidates(entry, region, points, weights, lo, hi)[:4]:
            print(f"  {box[0]}..{box[1]} -> {area:.0f} cm2")


if __name__ == "__main__":
    main()
