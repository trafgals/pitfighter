"""Measure how far a rebuilt prop leans, and stand it up.

Some props are approved art drawn on the diagonal: a rapier drawn across the
frame, a tool drawn on the diagonal. The lean is a pose, not a shape, so the
reconstruction is rolled back by the angle the art leans before it is turned
onto its pivot.

The roll is applied when the raw reconstruction is placed, which is a post
process on the GPU's output, so a roll that turns out to have the wrong sign
costs nothing to correct: the raw GLB is placed again.

This measures the lean of the mesh as it sits on the pivot - the long axis of
its silhouette against the vertical - and searches the rolls around the one the
manifest asks for, so the right one is chosen from the geometry rather than from
a sign convention.

The lean only means something for a prop that is longer than it is wide: an
open parasol's canopy is wider than the parasol is tall, and its outline's long
axis is across the prop, not along it. So the correction is only applied to a
prop that stands taller than it is wide, and only when the roll that is already
asked for leaves it visibly leaning.

Usage: python lean_fit.py <asset_id> [--fix]
"""
import json
import math
import os
import sys
import struct
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manifest_io  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"
PYTHON = sys.executable

TURN = {
    0: np.array([[-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -1.0]]),
    90: np.array([[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]]),
    270: np.array([[0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]]),
}

LEAN_LIMIT = 8.0        # a lean of more than this is a pose that has to go
UPRIGHT_LIMIT = 3.0     # the best roll has to leave it within this


def roll_matrix(roll_deg):
    angle = math.radians(float(roll_deg))
    cos, sin = math.cos(angle), math.sin(angle)
    return np.array([[cos, -sin, 0.0], [sin, cos, 0.0], [0.0, 0.0, 1.0]])


def read_positions(path):
    """Every vertex of every primitive in a GLB, as an (n, 3) array."""
    with open(path, "rb") as f:
        data = f.read()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    # the binary chunk follows its own eight byte header
    blob = data[28 + json_len:]
    out = []
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            acc = doc["accessors"][prim["attributes"]["POSITION"]]
            view = doc["bufferViews"][acc["bufferView"]]
            start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
            vals = struct.unpack_from(f"<{acc['count'] * 3}f", blob, start)
            out.append(np.asarray(vals, dtype=np.float64).reshape(-1, 3))
    return np.concatenate(out) if out else np.zeros((0, 3))


def place_points(points, fit, roll_deg):
    """The same placement run_pixal3d_mesh.py does, on the points alone."""
    turn = TURN[int(fit.get("turn_deg", 0)) % 360]
    rolled = points @ roll_matrix(roll_deg).T
    height = rolled[:, 1].max() - rolled[:, 1].min()
    if height <= 0:
        return None
    scale = fit["height_cm"] / 100.0 / height
    turned = rolled @ turn.T * scale
    shift = np.array([
        fit["centre_x_cm"] / 100.0 - (turned[:, 0].max() + turned[:, 0].min()) / 2,
        fit["y_min_cm"] / 100.0 - turned[:, 1].min(),
        fit["centre_z_cm"] / 100.0 - (turned[:, 2].max() + turned[:, 2].min()) / 2,
    ])
    return turned + shift


def lean_of(points, turn_deg):
    """The long axis of the silhouette against the vertical.

    Positive means the prop's top leans toward +X. The axis is taken from the
    surface points, which is the silhouette of the prop as the front view sees
    it. A prop turned onto the Z axis leans in the XZ plane instead.
    """
    if len(points) < 3:
        return 0.0
    if int(turn_deg) % 360 in (90, 270):
        pts = points[:, (0, 2)]
    else:
        pts = points[:, (0, 1)]
    centred = pts - pts.mean(axis=0, keepdims=True)
    covariance = centred.T @ centred / len(pts)
    values, vectors = np.linalg.eigh(covariance)
    axis = vectors[:, np.argmax(values)]
    if axis[1] < 0:
        axis = -axis
    return math.degrees(math.atan2(axis[0], axis[1]))


def lean_is_meaningful(points, turn_deg):
    """Whether the silhouette's long axis is the prop's own long axis.

    An open parasol is taller than it is wide, but the canopy is a wide flat
    dome and the points on it outnumber the points on the shaft, so the
    outline's long axis lies across the prop. The lean only says something when
    the axis the silhouette gives agrees with the direction the prop is longest
    in, and when the prop is long enough for that to mean anything.
    """
    if len(points) < 3:
        return False, "there is nothing to measure"
    if int(turn_deg) % 360 in (90, 270):
        span = points[:, (0, 2)].max(axis=0) - points[:, (0, 2)].min(axis=0)
    else:
        span = points[:, (0, 1)].max(axis=0) - points[:, (0, 1)].min(axis=0)
    long_side, short_side = max(span), min(span)
    if short_side <= 0 or long_side / short_side < 1.5:
        return False, (f"the prop is {long_side * 100:.1f} cm by {short_side * 100:.1f} cm, "
                       "so it is not long enough for its pose to mean anything")
    lean = lean_of(points, turn_deg)
    # the direction the prop is longest in, as an angle from the vertical
    longest = 0.0 if span[1] >= span[0] else 90.0
    off = abs(abs(lean) - longest)
    off = min(off, 180 - off)
    if off > 45:
        return False, (f"the outline's long axis lies across the prop, so the "
                       f"{lean:+.1f} degrees is the canopy's axis, not the prop's")
    return True, f"the prop is {long_side * 100:.1f} cm by {short_side * 100:.1f} cm"


def fit_of(entry):
    frame = entry["validation"]["frame"]
    return {
        "height_cm": entry["scale_dimensions_cm"]["height"],
        "y_min_cm": frame["y_min_cm"],
        "centre_x_cm": frame.get("centre_x_cm", 0.0),
        "centre_z_cm": frame.get("centre_z_cm", 0.0),
        "turn_deg": frame.get("turn_deg", 0),
    }


def raw_glb_for(asset_id):
    folder = os.path.join(COMFY_OUTPUT, "3d")
    if not os.path.isdir(folder):
        return None
    found = [f for f in os.listdir(folder)
             if f.startswith(f"pixal3d_{asset_id}_0") and f.endswith(".glb")
             and "highpoly" not in f]
    if not found:
        return None
    found.sort(key=lambda f: os.path.getmtime(os.path.join(folder, f)))
    return os.path.join(folder, found[-1])


def set_roll(asset_id, roll):
    """Write the roll back into the manifest, under its lock.

    The finish chain and the watcher on the issues both write the manifest, and
    a read-modify-write that is not locked loses whichever of the two changes
    was made in between.
    """
    def change(manifest):
        target = next(a for a in manifest["assets"] if a["id"] == asset_id)
        target["validation"]["frame"]["roll_deg"] = round(roll, 1)

    manifest_io.update(MANIFEST, change)


def main():
    args = sys.argv[1:]
    asset_id = args[0]
    fix = "--fix" in args

    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    fit = fit_of(entry)
    current = float(entry["validation"]["frame"].get("roll_deg", 0.0) or 0.0)

    placed_path = os.path.join(ROOT, entry["glb_output"])
    if not os.path.exists(placed_path):
        print(f"{asset_id}: no placed mesh yet")
        return
    points = read_positions(placed_path)
    lean = lean_of(points, fit["turn_deg"])
    span = points.max(axis=0) - points.min(axis=0)
    meaningful, why = lean_is_meaningful(points, fit["turn_deg"])
    print(f"{asset_id}: the placed mesh leans {lean:+.1f} degrees "
          f"(the manifest asks for a roll of {current:+.1f}); it is "
          f"{span[0] * 100:.1f} cm wide and {span[1] * 100:.1f} cm tall")
    print(f"  the lean says something here: {meaningful} ({why})")

    raw = raw_glb_for(asset_id)
    if not raw or not os.path.exists(raw):
        print("no raw reconstruction to fit a roll against")
        return

    raw_points = read_positions(raw)
    best = None
    for step in range(-180, 181):
        roll = current + step * 0.5
        placed = place_points(raw_points, fit, roll)
        if placed is None:
            continue
        tilt = abs(lean_of(placed, fit["turn_deg"]))
        score = (tilt, abs(roll - current))
        if best is None or score < best[0]:
            best = (score, roll, tilt)
    score, roll, tilt = best
    print(f"the best roll is {roll:+.1f} degrees, which leaves the prop leaning "
          f"{tilt:+.1f}")

    if not fix:
        return
    if abs(current) < 0.01:
        # the manifest does not ask for a roll, so this prop's art is not
        # known to be drawn leaning: a shoe last leans a little because that
        # is the shape of a shoe last, and nothing here should turn it
        print("the manifest does not ask for a roll, so the prop's pose is left alone")
        return
    if not meaningful:
        print(f"the roll is left alone: {why}")
        return
    if abs(lean) <= LEAN_LIMIT:
        print(f"the prop is standing straight enough ({lean:+.1f} degrees)")
        return
    if tilt > UPRIGHT_LIMIT:
        print(f"no roll stands it up ({tilt:+.1f} degrees is the best), so the "
              "roll is left alone and the pose stays a finding")
        return

    set_roll(asset_id, roll)
    print(f"the manifest now asks for a roll of {roll:+.1f}")
    out = os.path.join(ROOT, entry["glb_output"])
    result = subprocess.run([PYTHON, os.path.join(ROOT, "scripts", "run_pixal3d_mesh.py"),
                             asset_id, "--shrink", raw, out], cwd=ROOT,
                            capture_output=True, text=True)
    print(result.stdout.strip() or result.stderr.strip())
    if result.returncode:
        raise SystemExit("placing the raw reconstruction again failed")


if __name__ == "__main__":
    main()
