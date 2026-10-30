"""Measure the silhouette each view of a turnaround sheet occupies.

The sheet is four square views side by side. The front and back views show
the prop's width across the image, the left and right views show its depth,
and all four show its height. The proportions of the reconstruction come out
of these silhouettes, so they say whether the mesh will land on the spec's
width and depth before the GPU is asked to build it.

Usage: python measure_sheet.py <sheet.png> <asset_id>
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
VIEWS = ["front", "left", "back", "right"]


def mask_of(view):
    """The object in one view: the pixels that are not white."""
    a = np.asarray(view.convert("RGB")).astype(np.int16)
    return a.min(axis=2) < 235


def measure(sheet_path, asset_id):
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    spec = entry["scale_dimensions_cm"]

    sheet = Image.open(sheet_path).convert("RGB")
    side = sheet.height
    record_path = os.path.splitext(sheet_path)[0] + ".json"
    frames = {}
    if os.path.exists(record_path):
        with open(record_path, encoding="utf-8") as f:
            frames = json.load(f).get("frames", {})

    print(f"{asset_id}  spec {spec['width']} x {spec['height']} x {spec['depth']} cm")
    ratios = {}
    for i, view in enumerate(VIEWS):
        if view in frames and frames[view] is None:
            print(f"  {view:>5}: not in the sheet")
            continue
        tile = sheet.crop((i * side, 0, (i + 1) * side, side))
        mask = mask_of(tile)
        if not mask.any():
            print(f"  {view:>5}: empty tile")
            continue
        cols = np.where(mask.any(axis=0))[0]
        rows = np.where(mask.any(axis=1))[0]
        w = (cols[-1] - cols[0] + 1) / side
        h = (rows[-1] - rows[0] + 1) / side
        ratios[view] = (w, h)
        print(f"  {view:>5}: {w:.3f} of the frame wide, {h:.3f} tall  ({w / h:.3f} aspect)")

    heights = [h for _, h in ratios.values()]
    if not heights:
        return
    height = max(heights)
    # the tallest view is the prop's height; the front view's width is the
    # prop's width and the side view's is its depth
    width = next((w for v, (w, h) in ratios.items() if v == "front"), None)
    depth = next((w for v, (w, h) in ratios.items() if v == "left"), None)
    if width is None or depth is None:
        return
    scale = spec["height"] / height
    print(f"  -> predicted at the spec's height: width {width * scale:.1f} cm "
          f"(spec {spec['width']}), depth {depth * scale:.1f} cm (spec {spec['depth']})")
    for label, actual, wanted in (("width", width * scale, spec["width"]),
                                   ("depth", depth * scale, spec["depth"])):
        off = abs(actual - wanted) / wanted * 100
        flag = "OK" if off <= 5 else "OUTSIDE the 5% tolerance"
        print(f"     {label}: {actual:.1f} vs {wanted} cm  ({off:.0f}% off)  {flag}")


if __name__ == "__main__":
    measure(sys.argv[1], sys.argv[2])
