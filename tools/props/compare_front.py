"""Compare a reconstruction's silhouette with the sheet it was built from.

The four-view sheet is the prop's own approved art turned on a turntable, and
the reconstruction is meant to reproduce it. Two things can go wrong that a
dimension check cannot see: the mesh can come out turned the wrong way, and it
can come out mirrored. Both are caught by projecting the mesh and comparing
the outline with the sheet's tiles.

The mesh is projected down its Z axis, which is the front view, and each
tile's outline is compared with it both ways round. The report says which
tile the mesh matches and whether the match needs a mirror.

Usage: python compare_front.py <sheet.png> <asset_id>
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pose  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
VIEWS = ["front", "left", "back", "right"]
SIZE = 256


def glb_positions(path):
    with open(path, "rb") as f:
        data = f.read()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    verts = []
    tris = []
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            pos = doc["accessors"][prim["attributes"]["POSITION"]]
            idx = doc["accessors"][prim["indices"]]
            buf = prim["attributes"]["POSITION"]
            acc = doc["accessors"][buf]
            start = acc.get("byteOffset", 0) or 0
            n = acc["count"]
            view = doc["bufferViews"][acc["bufferView"]]
            base = (view.get("byteOffset", 0) or 0) + start
            arr = np.frombuffer(data, dtype="<f4", count=n * 3, offset=28 + json_len + base)
            verts.append(arr.reshape(n, 3).copy())
            istart = idx.get("byteOffset", 0) or 0
            iview = doc["bufferViews"][idx["bufferView"]]
            ibase = (iview.get("byteOffset", 0) or 0) + istart
            iarr = np.frombuffer(data, dtype="<u2", count=idx["count"], offset=28 + json_len + ibase)
            tris.append(iarr.reshape(-1, 3).copy())
    return np.vstack(verts), np.vstack(tris)


def normalise(mask):
    """A mask cropped to its object and stretched to a square."""
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return np.zeros((SIZE, SIZE), bool)
    crop = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    img = Image.fromarray((crop * 255).astype(np.uint8))
    img = img.resize((SIZE, SIZE), Image.Resampling.BILINEAR)
    return np.asarray(img) > 127


def tile_mask(sheet, index):
    side = sheet.height
    tile = sheet.crop((index * side, 0, (index + 1) * side, side)).convert("RGB")
    a = np.asarray(tile).astype(np.int16)
    return a.min(axis=2) < 235


def image_mask(img):
    """The outline of the object in a view, whatever the view is."""
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    return a.min(axis=2) < 235


def project(verts, tris):
    """The mesh's outline seen down the Z axis, as a square mask."""
    x, y = verts[:, 0], verts[:, 1]
    lo = np.array([x.min(), y.min()])
    hi = np.array([x.max(), y.max()])
    span = np.maximum(hi - lo, 1e-9)
    scale_x = (SIZE - 1) / span[0]
    scale_y = (SIZE - 1) / span[1]
    img = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(img)
    px = (x - lo[0]) * scale_x
    py = (SIZE - 1) - (y - lo[1]) * scale_y
    for tri in tris:
        draw.polygon([(px[tri[0]], py[tri[0]]), (px[tri[1]], py[tri[1]]), (px[tri[2]], py[tri[2]])], fill=255)
    return np.asarray(img) > 127


def iou(a, b):
    union = np.logical_or(a, b).sum()
    if union == 0:
        return 0.0
    return np.logical_and(a, b).sum() / union


def main():
    sheet_path, asset_id = sys.argv[1], sys.argv[2]
    as_json = "--json" in sys.argv
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    glb = os.path.join(ROOT, entry["glb_output"])
    if not os.path.exists(glb):
        raise SystemExit(f"{glb} does not exist yet")

    verts, tris = glb_positions(glb)
    model = normalise(project(verts, tris))
    sheet = Image.open(sheet_path).convert("RGB")

    # the mesh stands in the frame its art is turned over and rolled into, so
    # the views it is compared with are the sheet's views put in that frame
    frame = entry.get("validation", {}).get("frame", {})
    scores = {}
    for i, view in enumerate(VIEWS):
        tile = sheet.crop((i * sheet.height, 0, (i + 1) * sheet.height, sheet.height))
        posed = pose.posed_view(tile, view, frame)
        mask = normalise(image_mask(posed))
        scores[view] = {"straight": round(float(iou(model, mask)), 3),
                        "mirrored": round(float(iou(model, mask[:, ::-1])), 3)}

    # the mesh is turned onto its pivot, so the view the sheet's front view
    # ended up in is the one the turn says it should be in
    turn = int(entry.get("validation", {}).get("frame", {}).get("turn_deg", 0)) % 360
    expected = VIEWS[(-turn // 90) % 4]
    best_straight = max(scores, key=lambda v: scores[v]["straight"])

    if as_json:
        print(json.dumps({"asset": asset_id, "turn_deg": turn, "expected_view": expected,
                          "scores": scores, "best_straight": best_straight,
                          "mirrored": bool(scores[expected]["mirrored"] > scores[expected]["straight"] + 0.05)}))
        return

    print(f"{asset_id}: the mesh against the sheet it was built from")
    for i, view in enumerate(VIEWS):
        print(f"  {view:>5}: {scores[view]['straight']:.3f} as the sheet has it, "
              f"{scores[view]['mirrored']:.3f} mirrored")
    print(f"  the pivot turns it {turn} degrees, so its front view is the sheet's {expected} view: "
          f"{scores[expected]['straight']:.3f} as the sheet has it, {scores[expected]['mirrored']:.3f} mirrored")
    print(f"  best straight match: the {best_straight} view")


if __name__ == "__main__":
    main()
