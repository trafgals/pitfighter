"""Stand a prop up on its pivot, from the pose its approved art is drawn in.

Some props are approved art drawn on the diagonal, and some are drawn the
other way up. Both are poses, not shapes: the pivot says where the prop goes
in the hand, and the reconstruction has to be put there.

  * a diagonal prop is rolled about the camera's axis by the angle its own
    art leans, which is measured from the cutout's silhouette
  * a prop drawn the other way up has its sheet turned over before it is
    conditioned on, so the mesh and its baked texture both come out the right
    way up

The roll is a rotation of the mesh, so the texture travels with it.

Usage: python set_pose.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

# The props whose approved art is drawn on the diagonal, and the props whose
# art is drawn the other way up. The lean is measured from the cutout, so it
# is the art that decides, not a number typed in by hand.
DIAGONAL = {
    "prop_eleanor_weeping_rapier": ("flux3_eleanor_rapier_alpha.png", True),
    "prop_tilly_clinker_tongs": ("flux3_tilly_tongs_alpha.png", False),
    "prop_bulwark_pistons": ("flux3_bulwark_pistons_alpha.png", False),
    "weapon_knuckleduster": ("flux3_knuckleduster_alpha.png", False),
    "weapon_coal_shovel": ("flux3_coal_shovel_alpha.png", False),
    "weapon_bone_saw": ("flux3_bone_saw_alpha.png", False),
    "weapon_nail_bat": ("flux3_nail_bat_alpha.png", True),
    "weapon_cleaver": ("flux3_cleaver_alpha.png", False),
    "weapon_piston_gauntlet": ("flux3_piston_gauntlet_alpha.png", False),
}


def mask_of(path):
    im = Image.open(path)
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    alpha = im.getchannel("A")
    lo, hi = alpha.getextrema()
    if lo == 255:
        grey = im.convert("RGB").convert("L")
        alpha = grey.point(lambda v: 255 if v < 235 else 0)
    box = alpha.getbbox()
    if box is None:
        raise ValueError(f"{path} is empty")
    return np.asarray(alpha.crop(box)) > 127


def lean_of(mask):
    ys, xs = np.where(mask)
    points = np.stack([xs, ys]).astype(np.float64)
    centred = points - points.mean(axis=1, keepdims=True)
    values, vectors = np.linalg.eigh(centred @ centred.T / len(xs))
    axis = vectors[:, np.argmax(values)]
    if axis[1] > 0:
        axis = -axis
    return float(np.degrees(np.arctan2(-axis[0], -axis[1])))


def main():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    by_id = {a["id"]: a for a in manifest["assets"]}
    for asset_id, (alpha_file, upside_down) in DIAGONAL.items():
        entry = by_id[asset_id]
        lean = lean_of(mask_of(os.path.join(ROOT, "public", "tex", "props", alpha_file)))
        # a sheet that is turned over mirrors the lean with it
        roll = -lean if upside_down else lean
        frame = entry["validation"]["frame"]
        frame["roll_deg"] = round(roll, 1)
        if upside_down:
            frame["upside_down"] = True
        print(f"{asset_id}: the art leans {lean:+.1f} degrees"
              f"{' (and is drawn the other way up)' if upside_down else ''}"
              f" -> roll {frame['roll_deg']:+.1f} degrees")
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
