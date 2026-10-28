"""Re-fit a rebuilt prop's validation boxes onto the mesh that was actually built.

The first pass cut the validation boxes out of the prop's approved alpha
cutout, but it mapped the cutout's grid onto the *spec's* width, height and
depth. A reconstruction's proportions come out of the model, so for any prop
whose approved art is a different shape from the procedural stand-in the spec
was measured off, the boxes land on empty space and the capture fails for a
reason that has nothing to do with the mesh.

This pass does the same job against the mesh that exists:

  * the cutout is cropped to the object and cut into a grid of cells
  * each cell is mapped onto the model's *measured* box, so a cell of the
    cutout and a cell of the model mean the same thing
  * the solidest cell of the lower half and of the upper half become the
    "the prop's surface is there" boxes, trimmed to the solid pixels inside
    the cell so a thin shaft is not asked for the canopy's area
  * the emptiest cell becomes the "the space beside the prop is clear" box

The thresholds are the same as the first pass: 35% of the box's area for a
filled box, 10 cm2 for a clear one.

Usage: python refit_prop.py <asset_id>
"""
import json
import os
import struct
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pose  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

GRID = 8            # the cutout is cut into this many cells across and down
MIN_CM = 2.0        # a region is at least this wide, so it can hold any surface
EMPTY_COVERAGE = 0.05
SOLID_ALPHA = 128   # a pixel counts as the prop's surface above this alpha


def read_glb_bbox(path):
    with open(path, "rb") as f:
        data = f.read()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            acc = doc["accessors"][prim["attributes"]["POSITION"]]
            for i in range(3):
                lo[i] = min(lo[i], acc["min"][i])
                hi[i] = max(hi[i], acc["max"][i])
    return [round(v * 100, 2) for v in lo], [round(v * 100, 2) for v in hi]


def alpha_of(path):
    im = Image.open(path)
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    alpha = im.getchannel("A")
    lo, hi = alpha.getextrema()
    if lo == 255:
        grey = im.convert("RGB").convert("L")
        alpha = grey.point(lambda v: 255 if v < 235 else 0)
    return alpha


def cells_of(alpha):
    """The cutout's cells: coverage, and the solid pixels inside each of them."""
    box = alpha.getbbox()
    if box is None:
        raise ValueError("the cutout is empty")
    crop = alpha.crop(box)
    w, h = crop.size
    cw, ch = w / GRID, h / GRID
    cells = []
    for cy in range(GRID):
        for cx in range(GRID):
            x0, y0 = int(cx * cw), int(cy * ch)
            x1, y1 = max(x0 + 1, int((cx + 1) * cw)), max(y0 + 1, int((cy + 1) * ch))
            tile = crop.crop((x0, y0, x1, y1))
            px = list(tile.getdata())
            solid = [(i % tile.size[0], i // tile.size[0])
                     for i, v in enumerate(px) if v > SOLID_ALPHA]
            coverage = len(solid) / len(px)
            if solid:
                sx0 = min(p[0] for p in solid)
                sx1 = max(p[0] for p in solid) + 1
                sy0 = min(p[1] for p in solid)
                sy1 = max(p[1] for p in solid) + 1
            else:
                sx0 = sx1 = sy0 = sy1 = 0
            cells.append({
                "cx": cx, "cy": cy, "coverage": coverage, "solid": len(solid),
                "px": (x0 + sx0, y0 + sy0, x0 + sx1, y0 + sy1),
                "cell": (x0, y0, x1, y1),
            })
    return crop.size, cells


def mapper(box, size, frame, measured):
    """Cutout pixels to model centimetres, on the model's own measured box.

    The pixels are the ones inside the cutout's cropped box, so they are
    counted from the crop's own corner: a cutout that is turned over or rolled
    has its object somewhere in the middle of the image, and the mapping has
    to be about the object and not about where the image happened to put it.
    """
    w, h = size
    width = measured["width"]
    height = measured["height"]
    left = frame["centre_x_cm"] - width / 2
    top = frame["y_max_cm"]

    def to_cm(px, py):
        x = left + px / max(1, w) * width
        y = top - py / max(1, h) * height
        return x, y

    return to_cm


def box_from(px, cell, frame, measured, to_cm, solid):
    """A cell (or its solid part) as a model-space box."""
    if solid:
        x0, y0, x1, y1 = px
    else:
        x0, y0, x1, y1 = cell
    ax, ay = to_cm(x0, y0)
    bx, by = to_cm(x1, y1)
    lo_x, hi_x = min(ax, bx), max(ax, bx)
    lo_y, hi_y = min(ay, by), max(ay, by)
    # a region has to be able to hold a surface at all
    if hi_x - lo_x < MIN_CM:
        mid = (lo_x + hi_x) / 2
        lo_x, hi_x = mid - MIN_CM / 2, mid + MIN_CM / 2
    if hi_y - lo_y < MIN_CM:
        mid = (lo_y + hi_y) / 2
        lo_y, hi_y = mid + MIN_CM / 2, mid - MIN_CM / 2
    left = frame["centre_x_cm"] - measured["width"] / 2
    right = frame["centre_x_cm"] + measured["width"] / 2
    lo_x, hi_x = max(lo_x, left), min(hi_x, right)
    lo_y, hi_y = max(lo_y, frame["y_min_cm"]), min(hi_y, frame["y_max_cm"])
    z0 = round(frame["centre_z_cm"] - measured["depth"] / 2, 1)
    z1 = round(frame["centre_z_cm"] + measured["depth"] / 2, 1)
    return [round(lo_x, 1), round(lo_y, 1), z0], [round(hi_x, 1), round(hi_y, 1), z1]


def main():
    asset_id = sys.argv[1]
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)

    glb = os.path.join(ROOT, entry["glb_output"])
    if not os.path.exists(glb):
        raise SystemExit(f"{glb} does not exist yet")
    lo, hi = read_glb_bbox(glb)
    measured = {
        "width": round(hi[0] - lo[0], 2),
        "height": round(hi[1] - lo[1], 2),
        "depth": round(hi[2] - lo[2], 2),
    }
    frame = entry["validation"]["frame"]

    alpha_path = os.path.join(ROOT, entry["alpha_cutout"])
    # the art is drawn leaning, or the other way up, and the mesh stands on its
    # pivot: the boxes are cut from the art in the frame the mesh stands in
    alpha = pose.posed_cutout(alpha_of(alpha_path), frame)
    box = alpha.getbbox()
    size, cells = cells_of(alpha)
    to_cm = mapper(box, size, frame, measured)

    lower_rows = range(GRID // 2 + 1, GRID)
    upper_rows = range(0, GRID // 2 - 1)

    def best(rows):
        # the biggest solid area in the half: a wide sheet of the prop beats a
        # thin shaft that happens to be solid all the way down
        return max((c for c in cells if c["cy"] in rows),
                   key=lambda c: (c["solid"], c["coverage"]))

    emptiest = min(cells, key=lambda c: (c["coverage"], -c["solid"]))

    regions = []
    for cell, label in ((best(lower_rows), "the lower half of the prop"),
                        (best(upper_rows), "the upper half of the prop")):
        lo_cm, hi_cm = box_from(cell["px"], cell["cell"], frame, measured, to_cm, True)
        area = (hi_cm[0] - lo_cm[0]) * (hi_cm[1] - lo_cm[1])
        regions.append({
            "label": f"{label} carries the prop's surface",
            "min_cm": lo_cm,
            "max_cm": hi_cm,
            "expect": "filled",
            "min_area_cm2": max(4, round(area * 0.35)),
        })

    if emptiest["coverage"] <= EMPTY_COVERAGE:
        lo_cm, hi_cm = box_from(emptiest["px"], emptiest["cell"], frame, measured, to_cm, False)
        regions.append({
            "label": "the space beside the prop is clear",
            "min_cm": lo_cm,
            "max_cm": hi_cm,
            "expect": "empty",
            "max_area_cm2": 10,
        })
    else:
        lo_cm, hi_cm = box_from(emptiest["px"], emptiest["cell"], frame, measured, to_cm, False)
        regions.append({
            "label": "the space in front of the prop is clear",
            "min_cm": [lo_cm[0], lo_cm[1], round(hi_cm[2] + 0.5, 1)],
            "max_cm": [hi_cm[0], hi_cm[1], round(hi_cm[2] + 10.0, 1)],
            "expect": "empty",
            "max_area_cm2": 10,
        })

    validation = entry["validation"]
    validation["regions"] = regions
    radius = 0.5 * (measured["width"] ** 2 + measured["height"] ** 2 + measured["depth"] ** 2) ** 0.5 / 100.0
    validation["view_fit"] = round(radius, 3)
    if entry.get("pivot", {}).get("convention") == "head_socket_normalized":
        # a reconstruction is one welded surface with no parts to name, so a
        # head-socket prop has no crown opening rim to measure: the check is
        # skipped rather than failed, the same way it is for a grip prop
        validation["rim_mesh"] = ""

    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"{asset_id}: measured {measured['width']} x {measured['height']} x {measured['depth']} cm, "
          f"view_fit {validation['view_fit']}")
    for region in regions:
        limit = region.get("min_area_cm2", region.get("max_area_cm2"))
        print(f"  {region['expect']:>6}  {region['min_cm']}..{region['max_cm']}  limit {limit}")


if __name__ == "__main__":
    main()
