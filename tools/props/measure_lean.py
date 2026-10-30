"""Measure how far a prop's approved art leans, so it can be stood up.

Some props are approved art drawn on the diagonal: a rapier drawn across the
frame rather than upright. The lean is a pose, not a shape, and the pivot asks
for the prop to stand along its own axis, so the reconstruction is rolled back
by the angle the art leans.

The angle comes from the prop's own alpha cutout, which is the art the sheet
is made from. The silhouette's principal axis is the prop's long axis, and the
angle it makes with the vertical is the lean. The sign is the one the mesh
needs: a prop whose top leans to the image's left is rolled the same way, so
that the image's left is the model's +X.

Usage: python measure_lean.py <alpha.png> [sheet.png]
"""
import sys

import numpy as np
from PIL import Image


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
    covariance = centred @ centred.T / len(xs)
    values, vectors = np.linalg.eigh(covariance)
    axis = vectors[:, np.argmax(values)]
    if axis[1] > 0:      # point the axis up the image
        axis = -axis
    # the angle from the image's vertical, positive when the top leans left
    lean = np.degrees(np.arctan2(-axis[0], -axis[1]))
    return lean, axis


def main():
    alpha_path = sys.argv[1]
    lean, axis = lean_of(mask_of(alpha_path))
    print(f"{alpha_path.split(chr(92))[-1]}: leans {lean:+.1f} degrees "
          f"(axis {axis[0]:+.2f}, {axis[1]:+.2f} in image coordinates)")
    if len(sys.argv) > 2:
        sheet = Image.open(sys.argv[2]).convert("RGB")
        side = sheet.height
        tile = np.asarray(sheet.crop((0, 0, side, side)).convert("RGB")).astype(np.int16)
        mask = tile.min(axis=2) < 235
        sheet_lean, _ = lean_of(mask)
        print(f"the sheet's front view leans {sheet_lean:+.1f} degrees")


if __name__ == "__main__":
    main()
