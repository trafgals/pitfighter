"""Flip a reconstruction that came out mirrored against its own sheet.

Pixal3D reconstructs what it is given, and for some props it hands back the
mirror image of the object: the silhouette matches the sheet's back view
instead of its front. A mirrored prop is not the approved art, so it is
flipped back.

The flip is a mirror, which is not a rotation, so two things move together:

  * the positions are mirrored in X, about the model's own centre
  * the triangle winding is reversed, because a mirror reverses the winding
    and the mesh has to stay outside-out

The texture is left alone. The UVs are a property of the vertices, so they
travel with them: a material point that the reconstruction put on the right
keeps the colour it was baked with, and the mirrored geometry carries the
colours back to where the approved art has them.

Usage: python mirror_prop.py <asset_id> [--uv] [--dry-run]

  --uv  flip the texture's U only, to undo a flip of it
"""
import json
import os
import struct
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")


def read_glb(data):
    if data[:4] != b"glTF":
        raise ValueError("not a binary glTF")
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    bin_len = struct.unpack("<I", data[20 + json_len:24 + json_len])[0]
    return doc, data[bin_start:bin_start + bin_len]


def write_glb(doc, blob):
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    blob += b"\0" * (-len(blob) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    return (struct.pack("<III", 0x46546C67, 2, total)
            + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(blob), 0x004E4942) + blob)


def accessor_array(doc, views, index, dtype):
    acc = doc["accessors"][index]
    width = {"VEC3": 3, "VEC4": 4, "VEC2": 2}[acc["type"]]
    view = doc["bufferViews"][acc["bufferView"]]
    if view.get("byteStride", width * 4) != width * 4 or acc.get("byteOffset"):
        raise ValueError("expected tightly packed attributes")
    return acc, np.frombuffer(views[acc["bufferView"]], dtype=dtype,
                              count=acc["count"] * width).reshape(-1, width).copy()


def main():
    asset_id = sys.argv[1]
    dry_run = "--dry-run" in sys.argv
    uv_only = "--uv" in sys.argv
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    path = os.path.join(ROOT, entry["glb_output"])
    with open(path, "rb") as f:
        data = f.read()
    doc, blob = read_glb(data)
    blob = bytearray(blob)
    views = [bytes(blob[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])
             for v in doc["bufferViews"]]

    def store(view_index, payload):
        """Put a view's bytes back where it was, so the layout does not move."""
        offset = doc["bufferViews"][view_index].get("byteOffset", 0)
        blob[offset:offset + len(payload)] = payload

    prims = [p for mesh in doc["meshes"] for p in mesh["primitives"]]

    # the model's own centre, which is what the mirror is about
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for p in prims:
        acc, a = accessor_array(doc, views, p["attributes"]["POSITION"], "<f4")
        for i in range(3):
            lo[i] = min(lo[i], a[:, i].min())
            hi[i] = max(hi[i], a[:, i].max())
    centre_x = (lo[0] + hi[0]) / 2

    for p in prims:
        if not uv_only:
            acc, a = accessor_array(doc, views, p["attributes"]["POSITION"], "<f4")
            a[:, 0] = 2 * centre_x - a[:, 0]
            store(acc["bufferView"], a.astype("<f4").tobytes())
            acc["min"], acc["max"] = a.min(axis=0).tolist(), a.max(axis=0).tolist()

            if "NORMAL" in p["attributes"]:
                nacc, n = accessor_array(doc, views, p["attributes"]["NORMAL"], "<f4")
                n[:, 0] = -n[:, 0]
                store(nacc["bufferView"], n.astype("<f4").tobytes())
                nacc["min"], nacc["max"] = n.min(axis=0).tolist(), n.max(axis=0).tolist()

        if uv_only:
            for uv_name in ("TEXCOORD_0", "TEXCOORD_1"):
                if uv_name in p["attributes"]:
                    uacc, uv = accessor_array(doc, views, p["attributes"][uv_name], "<f4")
                    uv[:, 0] = 1.0 - uv[:, 0]
                    store(uacc["bufferView"], uv.astype("<f4").tobytes())
                    uacc["min"], uacc["max"] = uv.min(axis=0).tolist(), uv.max(axis=0).tolist()

        if uv_only:
            continue

        ix = p.get("indices")
        if ix is None:
            continue
        iacc = doc["accessors"][ix]
        if iacc["componentType"] == 5123:
            dtype = "<u2"
        elif iacc["componentType"] == 5125:
            dtype = "<u4"
        else:
            raise ValueError(f"unexpected index type {iacc['componentType']}")
        iacc_view = doc["bufferViews"][iacc["bufferView"]]
        if iacc_view.get("byteStride") or iacc.get("byteOffset"):
            raise ValueError("expected tightly packed indices")
        idx = np.frombuffer(views[iacc["bufferView"]], dtype=dtype, count=iacc["count"]).copy()
        if idx.size % 3:
            raise ValueError("the index buffer is not triangles")
        tris = idx.reshape(-1, 3)
        tris[:, [1, 2]] = tris[:, [2, 1]]
        store(iacc["bufferView"], tris.reshape(-1).astype(dtype).tobytes())

    out = write_glb(doc, bytes(blob))
    print(f"{asset_id}: mirrored in X about {centre_x * 100:.1f} cm, {len(prims)} primitives, "
          f"{len(data):,} -> {len(out):,} bytes")
    if dry_run:
        print("dry run: nothing written")
        return
    with open(path, "wb") as f:
        f.write(out)
    print(f"written to {path}")


if __name__ == "__main__":
    main()
