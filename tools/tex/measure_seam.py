"""Measure the heal band and the blend width the texture pipeline used.

The manifest records the band and the blend for every repaired tile. This
reads those two numbers back out of the artifacts, so the record can be
checked rather than taken on trust.

Two things are measured:

1. The band, from the mask the heal ran on. The mask is a cross: a vertical
   arm and a horizontal arm, full strength down the middle and feathering out
   to nothing at the edges. The band is the full strength part of the arm, so
   the half width is where the mask stops being white.

2. The blend, by fitting the shipped tile. The heal output and the rolled
   original are both on disk, so the composite that was shipped can be
   rebuilt: for a candidate blend, alpha ramps from 1 at the middle of the
   cross to 0 at some distance out, the healed image is laid over the rolled
   one with it, the result is scaled down the way the pipeline scales it, and
   the result is compared with the tile that shipped. The half width that
   fits best is the blend that was used.

Usage:

    python tools/tex/measure_seam.py \
        --comfy "C:/Users/dimit/Documents/comfy/ComfyUI" \
        --repo  "C:/code/trafgals/pitfighter" \
        --slugs eight-limbed-ash knuckles-inferno quickfire-imp brother-blaze

Needs numpy and Pillow; the ComfyUI python has both.
"""

import argparse
import os
import sys

import numpy as np
from PIL import Image


def load(path, size=None):
    im = Image.open(path).convert("RGB")
    if size is not None and im.size != size:
        im = im.resize(size, Image.LANCZOS)
    return np.asarray(im, dtype=np.float32)


def band_half(mask_path):
    """the half width of the band's full strength core, and where the feather ends"""
    im = Image.open(mask_path).convert("L")
    a = np.asarray(im, dtype=np.float32)
    n = a.shape[0]
    # the top row crosses only the vertical arm, the left column only the
    # horizontal one, so each is measured on its own
    out = {}
    for label, profile in (("vertical", a[0]), ("horizontal", a[:, 0])):
        c = n // 2
        left = c
        while left > 0 and profile[left] >= 255:
            left -= 1
        right = c
        while right < n - 1 and profile[right] >= 255:
            right += 1
        far_left = c
        while far_left > 0 and profile[far_left] > 0:
            far_left -= 1
        far_right = c
        while far_right < n - 1 and profile[far_right] > 0:
            far_right += 1
        out[label] = (min(c - left, right - c), max(c - far_left, far_right - c))
    return out


def ramp_alpha(half, n):
    x = np.arange(n, dtype=np.float32) - n // 2
    return np.clip((half - np.abs(x)) / half, 0.0, 1.0)


def blend_errors(rolled_path, heal_path, shipped_path, halves):
    """the error of every candidate blend half width against the shipped tile"""
    rolled = load(rolled_path)
    heal = load(heal_path)
    shipped = load(shipped_path)
    n = rolled.shape[0]
    small_size = (shipped.shape[1], shipped.shape[0])
    errs = {}
    for half in halves:
        a = ramp_alpha(half, n)
        a2 = np.maximum(a[:, None], a[None, :])
        comp = rolled * (1.0 - a2[:, :, None]) + heal * a2[:, :, None]
        small = np.asarray(
            Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8)).resize(small_size, Image.LANCZOS),
            dtype=np.float32,
        )
        d = np.abs(small - shipped).mean(axis=2)
        c = small_size[0] // 2
        errs[half] = float(d[:, max(0, c - 60):c + 61].mean())
    return errs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--comfy", required=True, help="the ComfyUI folder (its input and output folders are used)")
    ap.add_argument("--repo", required=True, help="the pitfighter checkout (the shipped textures are read from it)")
    ap.add_argument("--mask", default="repair_h16.png", help="the mask the third heal ran on")
    ap.add_argument("--heal-dir", default="healrepair", help="the folder under ComfyUI/output/outputs with the heal outputs")
    ap.add_argument("--surface", default="cloth", help="the surface to measure")
    ap.add_argument("--slugs", nargs="+", required=True, help="the fighters to measure")
    args = ap.parse_args()

    mask_path = os.path.join(args.comfy, "input", args.mask)
    if not os.path.exists(mask_path):
        sys.exit(f"no mask at {mask_path}")
    bands = band_half(mask_path)
    core, feather = bands["vertical"]
    print(f"mask {args.mask}: the band is {core} px either side of the middle "
          f"({core * 2} px across), feathering to nothing by {feather} px")
    print()

    halves = list(range(12, 61, 2))
    totals = {h: [] for h in halves}
    for slug in args.slugs:
        rolled_path = os.path.join(args.comfy, "input", f"rolled_{slug}__{args.surface}.png")
        shipped_path = os.path.join(args.repo, "public", "tex", "fighters", slug, f"{args.surface}.webp")
        heal_dir = os.path.join(args.comfy, "output", "outputs", args.heal_dir)
        cands = sorted(f for f in os.listdir(heal_dir) if f.startswith(f"{slug}__{args.surface}_"))
        if not cands:
            print(f"!! no heal output for {slug}")
            continue
        # the heal output that reproduces the tile best is the one that was used
        best = None
        for name in cands:
            errs = blend_errors(rolled_path, os.path.join(heal_dir, name), shipped_path, halves)
            half = min(errs, key=errs.get)
            if best is None or errs[half] < best[1]:
                best = (name, errs[half], half, errs)
        name, err, half, errs = best
        for h, e in errs.items():
            totals[h].append(e)
        print(f"{slug:20s} best fit {name}  blend half width {half} px ({half * 2} px across)  error {err:.4f}")
    print()
    if totals:
        print("blend half width -> mean error over the tiles")
        for half in sorted(totals, key=lambda h: sum(totals[h]) / len(totals[h])):
            print(f"  {half:3d} px  {sum(totals[half]) / len(totals[half]):.4f}")


if __name__ == "__main__":
    main()
