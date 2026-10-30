"""A mesh's surface, read and measured the way the capture measures it.

The capture asks how much surface lies inside a box, so a box can be placed
by looking at the surface rather than by guessing where it should go. This
reads a glb's triangles and samples them the way the capture does: each
triangle is sampled on a barycentric grid fine enough to resolve about 5 mm,
and the part of a sample inside a box is counted, so a large face that only
crosses the box counts for the part inside it.
"""
import json
import os
import struct

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

COMP = {5126: ("f4", 4), 5125: ("u4", 4), 5123: ("u2", 2), 5121: ("u1", 1)}


def read_glb(path):
    """The triangles of a glb, in metres, as an (n, 3, 3) array."""
    with open(path, "rb") as f:
        data = f.read()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    bin_off = 20 + json_len + 8

    def accessor(index):
        acc = doc["accessors"][index]
        view = doc["bufferViews"][acc["bufferView"]]
        fmt, size = COMP[acc["componentType"]]
        ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
        base = bin_off + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride") or size * ncomp
        raw = np.frombuffer(data, dtype=np.uint8)
        out = np.empty((acc["count"], ncomp),
                       dtype=np.float32 if fmt == "f4" else np.int32)
        for i in range(acc["count"]):
            chunk = raw[base + i * stride: base + i * stride + size * ncomp]
            out[i] = np.frombuffer(chunk.tobytes(), dtype=np.dtype(fmt).newbyteorder("<"))
        return out

    tris = []
    for node in doc.get("nodes", []):
        mesh = doc["meshes"][node["mesh"]] if node.get("mesh") is not None else None
        if mesh is None:
            continue
        for prim in mesh.get("primitives", []):
            if prim.get("mode", 4) != 4:
                continue
            pos = accessor(prim["attributes"]["POSITION"])
            if prim.get("indices") is not None:
                idx = accessor(prim["indices"]).reshape(-1)
                pos = pos[idx]
            tris.append(pos.reshape(-1, 3, 3))
    if not tris:
        raise ValueError(f"{path} has no triangles")
    return np.concatenate(tris, axis=0)


def sample(tris):
    """Every triangle sampled on a barycentric grid, with the area each sample stands for."""
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    u, v = b - a, c - a
    tri_area = np.linalg.norm(np.cross(u, v), axis=1) / 2
    longest = np.maximum.reduce([np.linalg.norm(u, axis=1), np.linalg.norm(v, axis=1),
                                 np.linalg.norm(c - b, axis=1)])
    n = np.minimum(64, np.maximum(1, np.ceil(longest / 0.005))).astype(int)

    points, weights = [], []
    for k in range(len(tris)):
        ni = int(n[k])
        if ni <= 0 or tri_area[k] <= 0:
            continue
        ii, jj = np.meshgrid(np.arange(ni), np.arange(ni), indexing="ij")
        one = ii + jj <= ni - 2
        two = ii + jj == ni - 1
        for mask, s_off, r_off in ((one, 1 / 3, 1 / 3), (one, 2 / 3, 2 / 3), (two, 1 / 3, 1 / 3)):
            if not mask.any():
                continue
            s = (ii[mask] + s_off) / ni
            r = (jj[mask] + r_off) / ni
            p = a[k] + u[k] * s[:, None] + v[k] * r[:, None]
            points.append(p)
            weights.append(np.full(len(p), tri_area[k] / (ni * ni)))
    return np.concatenate(points), np.concatenate(weights)


def area_in(points, weights, box_cm):
    """The surface inside a box, in square centimetres."""
    x0, y0, z0 = [v / 100 for v in box_cm[0]]
    x1, y1, z1 = [v / 100 for v in box_cm[1]]
    inside = ((points[:, 0] >= x0) & (points[:, 0] <= x1) &
              (points[:, 1] >= y0) & (points[:, 1] <= y1) &
              (points[:, 2] >= z0) & (points[:, 2] <= z1))
    return float(weights[inside].sum()) * 1e4


def bbox_cm(tris):
    """The mesh's own box, in centimetres."""
    lo = (tris.reshape(-1, 3).min(axis=0) * 100).round(1).tolist()
    hi = (tris.reshape(-1, 3).max(axis=0) * 100).round(1).tolist()
    return lo, hi
