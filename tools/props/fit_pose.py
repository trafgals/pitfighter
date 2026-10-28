"""Work out how a posed prop's art maps onto its mesh.

Some props are approved art drawn on the diagonal, and two are drawn the other
way up. The reconstruction is turned over before it is conditioned on and
rolled back onto its pivot afterwards, so the art and the mesh are in
different frames: the region's boxes are cut from the art and checked against
the mesh, and the two have to be brought into the same frame first.

This measures which transformation does that, by projecting the mesh that was
built and comparing its outline with the sheet's views under each candidate:
turned over or not, rolled left or right. The best match is the convention the
tools should use.

Usage: python fit_pose.py <asset_id>
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare_front import ROOT, iou, normalise, project, tile_mask, glb_positions  # noqa: E402

MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
VIEWS = ["front", "left", "back", "right"]


def main():
    asset_id = sys.argv[1]
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    frame = entry["validation"]["frame"]
    roll = float(frame.get("roll_deg", 0.0) or 0.0)
    upside = bool(frame.get("upside_down"))

    sheet = Image.open(os.path.join(ROOT, entry["turnaround_sheet"])).convert("RGB")
    verts, tris = glb_positions(os.path.join(ROOT, entry["glb_output"]))
    model = normalise(project(verts, tris))

    def mask_of(view, flipped, signed_roll):
        i = VIEWS.index(view)
        tile = sheet.crop((i * sheet.height, 0, (i + 1) * sheet.height, sheet.height))
        if flipped:
            tile = ImageOps.flip(tile)
        if signed_roll:
            tile = tile.rotate(signed_roll, resample=Image.BILINEAR, expand=True, fillcolor=(255, 255, 255))
        a = np.asarray(tile).astype(np.int16)
        return normalise(a.min(axis=2) < 235)

    print(f"{asset_id}: roll {roll:+.1f}, upside_down {upside}")
    best = None
    for view in VIEWS:
        for flipped in (False, True):
            for sign in (roll, -roll):
                if sign == 0:
                    continue
                reference = mask_of(view, flipped, sign)
                for mirror in (False, True):
                    shape = model[:, ::-1] if mirror else model
                    score = iou(shape, reference)
                    print(f"  {view:>5}  turned over {str(flipped):>5}  rolled {sign:+7.1f}"
                          f"  mesh {'mirrored' if mirror else 'straight':>8}  -> {score:.3f}")
                    if best is None or score > best[0]:
                        best = (score, view, flipped, sign, mirror)
    print(f"the best match is the {best[1]} view, turned over {best[2]}, rolled {best[3]:+.1f},"
          f" with the mesh {'mirrored' if best[4] else 'straight'} at {best[0]:.3f}")


if __name__ == "__main__":
    main()
