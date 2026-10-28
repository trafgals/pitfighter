"""Predict each prop's width from its own approved art, before the mesh is built.

The reconstruction's proportions come out of the approved cutout, so the
cutout's own silhouette says what the width and depth will be against the
manifest's height. A prop whose art is a different shape from the spec shows
up here, without waiting for the GPU.

Usage: python predict_dims.py
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

# the queued props and the alpha cutout each was cut from
QUEUE = [
    ("prop_pegg_cast_iron_last", "flux3_pegg_shoelast_alpha.png"),
    ("prop_crape_spiked_brolly", "flux3_crape_brolly_alpha.png"),
    ("prop_eleanor_weeping_rapier", "flux3_eleanor_rapier_alpha.png"),
    ("prop_tilly_clinker_tongs", "flux3_tilly_tongs_alpha.png"),
    ("prop_sluice_flatcap", "flux3_sluice_flatcap_alpha.png"),
    ("prop_kilnworth_nursecap", "flux3_kilnworth_nursecap_alpha.png"),
    ("prop_mule_championship_belt", "flux3_mule_belt_alpha.png"),
    ("prop_rook_souwester", "flux3_rook_souwester_alpha.png"),
    ("prop_bulwark_pistons", "flux3_bulwark_pistons_alpha.png"),
    ("prop_crump_samovar", "flux3_crump_samovar_alpha.png"),
    ("weapon_knuckleduster", "flux3_knuckleduster_alpha.png"),
    ("weapon_coal_shovel", "flux3_coal_shovel_alpha.png"),
    ("weapon_bone_saw", "flux3_bone_saw_alpha.png"),
    ("weapon_nail_bat", "flux3_nail_bat_alpha.png"),
    ("weapon_cleaver", "flux3_cleaver_alpha.png"),
    ("weapon_piston_gauntlet", "flux3_piston_gauntlet_alpha.png"),
    ("weapon_lamplighter_pole", "flux3_lamplighter_pole_alpha.png"),
    ("pickup_tonic", "flux3_tonic_alpha.png"),
]


def silhouette(path):
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


def main():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    by_id = {a["id"]: a for a in manifest["assets"]}
    print(f"{'prop':<30} {'spec w x h x d':<24} {'art width':>10} {'art aspect':>12}  verdict")
    for asset_id, alpha_file in QUEUE:
        entry = by_id[asset_id]
        spec = entry["scale_dimensions_cm"]
        mask = silhouette(os.path.join(ROOT, "public", "tex", "props", alpha_file))
        ys, xs = np.where(mask)
        w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        aspect = w / h
        # the width the art would have at the spec's height
        width = aspect * spec["height"]
        off = abs(width - spec["width"]) / spec["width"] * 100
        verdict = "inside the tolerance" if off <= 5 else "OFF THE SPEC"
        print(f"{asset_id:<30} {f'{spec['width']} x {spec['height']} x {spec['depth']}':<24} "
              f"{width:>9.1f} cm {aspect:>11.2f}  {verdict} ({off:.0f}% off)")


if __name__ == "__main__":
    main()
