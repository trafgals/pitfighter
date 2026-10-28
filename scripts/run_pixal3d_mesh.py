"""Pixal3D reconstruction of a prop from its four-view sheet, shrunk to the game's budget.

The way weapon_chair.glb was made, as a script:

  1. cut the H3 sheet (front, left, back, right; run_minimax_h3_turnaround.py) into
     its four views and upload them to ComfyUI
  2. run public/tex/workflows/pixal3d_multiview.json: Pixal3D multi-view
     conditioning into TRELLIS 2, remeshed, decimated to 20k faces, unwrapped,
     with colour, metal/roughness/occlusion and normals baked at 2048 px
  3. shrink the GLB: colour and ORM to 1024 px, normals to 512 px, all JPEG,
     16-bit indices, no tangents (three.js derives them); 12 MB comes down to
     about 1.3 MB
  4. turn it to face +Z, scale it to the spec's height and stand it on the
     pivot, from the manifest entry's scale_dimensions_cm and validation.frame

A prop whose approved art is drawn the other way up says so in
validation.frame.upside_down, and the sheet is turned over before it is
conditioned on, so the mesh and its baked textures both come out right way up.

The asset's manifest entry (data/asset_manifest.json) names the sheet and the
GLB. The raw ComfyUI GLB stays in ComfyUI's output folder.

Usage: python scripts/run_pixal3d_mesh.py <asset_id> [--seed 42] [--faces 20000] [--out file.glb]
       python scripts/run_pixal3d_mesh.py [asset_id] --shrink <raw.glb> <out.glb>
"""
import io
import os
import sys
import json
import time
import struct
import argparse
import urllib.request
import uuid
from PIL import Image, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
WORKFLOW = os.path.join(ROOT, "public", "tex", "workflows", "pixal3d_multiview.json")
COMFY_HOST = "http://127.0.0.1:8188"
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"
VIEWS = ["front", "left", "back", "right"]

# texture sizes in the shipped GLB, by the material slot that reads them
COLOUR_PX = 1024
ORM_PX = 1024
NORMAL_PX = 512
JPEG_QUALITY = 90


def cut_sheet(sheet_path):
    """The square views of a sheet, in Pixal3D's order, leaving out any its record says is missing."""
    sheet = Image.open(sheet_path).convert("RGB")
    side = sheet.height
    if sheet.width != side * 4:
        raise ValueError(f"{sheet_path} is {sheet.width}x{sheet.height}; a four-view sheet is four squares wide")
    record_path = os.path.splitext(sheet_path)[0] + ".json"
    frames = {}
    if os.path.exists(record_path):
        with open(record_path, encoding="utf-8") as f:
            frames = json.load(f).get("frames", {})
    return {v: sheet.crop((i * side, 0, (i + 1) * side, side))
            for i, v in enumerate(VIEWS) if not (v in frames and frames[v] is None)}


def upload(img, name):
    """Put an image in ComfyUI's input folder through its API, and return its name there."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
        "Content-Type: image/png\r\n\r\n"
    ).encode() + buf.getvalue() + (
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n"
    ).encode()
    req = urllib.request.Request(f"{COMFY_HOST}/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.loads(urllib.request.urlopen(req).read())["name"]


def build_workflow(names, prefix, seed=None, faces=None):
    """The chair's workflow with this asset's views and output names filled in.

    A view missing from names is taken out: its load, mask, crop and save
    nodes, and its input to the conditioning.
    """
    if "front" not in names:
        raise ValueError("Pixal3D poses the mesh on the front view; a sheet needs one")
    with open(WORKFLOW, encoding="utf-8") as f:
        wf = json.loads(f.read().replace("{prefix}", prefix))
    conditioning = next(n for n in wf.values() if n["class_type"] == "Pixal3DMultiViewConditioning")
    for v in VIEWS:
        load = next(k for k, n in wf.items() if n["class_type"] == "LoadImage" and n["inputs"]["image"] == "{" + v + "}")
        if v in names:
            wf[load]["inputs"]["image"] = names[v]
            continue
        # everything fed only by this view's image, short of the conditioning
        chain = {load}
        while True:
            more = {k for k, n in wf.items() if k not in chain and n is not conditioning
                    and any(isinstance(x, list) and x[0] in chain for x in n["inputs"].values())}
            if not more:
                break
            chain |= more
        for k in chain:
            del wf[k]
        del conditioning["inputs"][v]
    if seed is not None:
        for node in wf.values():
            if node["class_type"] == "KSampler":
                node["inputs"]["seed"] += seed - 42
    if faces is not None:
        for node in wf.values():
            if node["class_type"] == "DecimateMesh":
                node["inputs"]["target_face_count"] = faces
    return wf


def run(wf, deadline_s=14400):
    """Queue a workflow and return its history entry once it has finished.

    A reconstruction takes about 8 minutes; four hours without a result means
    ComfyUI lost the prompt (a restart, say), so give up rather than wait
    forever. The wait is generous because ComfyUI is one GPU on a shared
    queue: a reconstruction that waits behind a turnaround clip starts an hour
    late and is still perfectly good.
    """
    req = urllib.request.Request(f"{COMFY_HOST}/prompt", data=json.dumps({"prompt": wf}).encode(),
                                 headers={"Content-Type": "application/json"})
    prompt_id = json.loads(urllib.request.urlopen(req, timeout=60).read())["prompt_id"]
    print(f"[Pixal3D] Queued {prompt_id}")
    give_up = time.time() + deadline_s
    while True:
        if time.time() > give_up:
            raise TimeoutError(f"ComfyUI gave no result for {prompt_id} in {deadline_s} s")
        time.sleep(4)
        hist = json.loads(urllib.request.urlopen(f"{COMFY_HOST}/history/{prompt_id}", timeout=60).read())
        if prompt_id in hist:
            entry = hist[prompt_id]
            if entry["status"].get("status_str") == "error":
                raise RuntimeError(f"ComfyUI error: {entry['status'].get('messages')}")
            return entry


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


def image_sizes(doc):
    """The pixel size each image is shipped at, from the material slots that read it."""
    sizes = {}
    def want(tex, px):
        if tex is None:
            return
        src = doc["textures"][tex["index"]]["source"]
        sizes[src] = max(sizes.get(src, 0), px)
    for m in doc.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        want(pbr.get("baseColorTexture"), COLOUR_PX)
        want(pbr.get("metallicRoughnessTexture"), ORM_PX)
        want(m.get("occlusionTexture"), ORM_PX)
        want(m.get("emissiveTexture"), COLOUR_PX)
        want(m.get("normalTexture"), NORMAL_PX)
    return sizes


def turn_matrix(turn_deg):
    """The rotation that puts the reconstruction on the manifest's pivot.

    Pixal3D builds the object facing -Z with the sheet's front view on the
    image's right, so the sheet's right-hand direction ends up on +X once the
    object is turned to face +Z. A prop whose pivot puts its length on Z
    instead - a shoe last whose toe points forward - says so with a turn, and
    is turned a quarter about Y before it is faced.

    All three matrices are proper rotations, so the winding of the triangles
    is untouched and the mesh stays outside-out.
    """
    import numpy as np
    turn = int(turn_deg) % 360
    if turn == 0:
        return np.array([[-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -1.0]])
    if turn == 90:
        return np.array([[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]])
    if turn == 270:
        return np.array([[0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])
    raise ValueError(f"a prop's turn has to be 0, 90 or 270 degrees, not {turn_deg}")


def roll_matrix(roll_deg):
    """The rotation that stands a reconstruction up on its pivot.

    Some props are approved art drawn leaning: a rapier drawn at an angle
    across the frame, a tool drawn on the diagonal. The drawing's angle is a
    pose, not a shape, and the pivot asks for the prop to stand along its own
    axis, so the reconstruction is rolled back the way the art leans before it
    is turned onto the pivot.

    The roll is about the camera's axis, which is the axis the sheet's front
    view is drawn in, and it happens before the turn so that the turn still
    decides which way the prop faces.

    It is a proper rotation, so the winding of the triangles is untouched and
    the mesh stays outside-out.
    """
    import math
    import numpy as np
    angle = math.radians(float(roll_deg))
    cos, sin = math.cos(angle), math.sin(angle)
    return np.array([[cos, -sin, 0.0], [sin, cos, 0.0], [0.0, 0.0, 1.0]])


def place(doc, views, height_cm, y_min_cm=0.0, centre_x_cm=0.0, centre_z_cm=0.0, turn_deg=0,
          roll_deg=0.0):
    """Turn a reconstruction to face +Z, scale it to the spec's height and put its base on the pivot.

    Pixal3D builds the object facing -Z, about a metre tall, centred on the
    origin; the manifest's pivot wants it facing +Z at its real size. Only the
    height is fitted: width and depth come out of the model, and the validator
    gives them a tolerance.
    """
    import numpy as np
    matrix = turn_matrix(turn_deg) @ roll_matrix(roll_deg)
    prims = [p for mesh in doc["meshes"] for p in mesh["primitives"]]
    def floats(acc_index):
        acc = doc["accessors"][acc_index]
        width = {"VEC3": 3, "VEC4": 4}[acc["type"]]
        view = doc["bufferViews"][acc["bufferView"]]
        if view.get("byteStride", width * 4) != width * 4 or acc.get("byteOffset"):
            raise ValueError("place() expects tightly packed float attributes")
        return acc, np.frombuffer(views[acc["bufferView"]], dtype="<f4", count=acc["count"] * width).reshape(-1, width).copy()
    pos = [floats(p["attributes"]["POSITION"]) for p in prims]
    allp = np.concatenate([a for _, a in pos])
    # the roll happens before the turn, and the height is fitted to the rolled
    # mesh: a prop that is stood up is taller than it was drawn
    rolled = allp @ roll_matrix(roll_deg).T
    scale = height_cm / 100.0 / (rolled[:, 1].max() - rolled[:, 1].min())
    turned = rolled @ turn_matrix(turn_deg).T * scale
    shift = np.array([centre_x_cm / 100.0 - (turned[:, 0].max() + turned[:, 0].min()) / 2,
                      y_min_cm / 100.0 - turned[:, 1].min(),
                      centre_z_cm / 100.0 - (turned[:, 2].max() + turned[:, 2].min()) / 2])
    for p, (acc, a) in zip(prims, pos):
        a = a @ matrix.T * scale + shift
        views[acc["bufferView"]] = a.astype("<f4").tobytes()
        acc["min"], acc["max"] = a.min(axis=0).tolist(), a.max(axis=0).tolist()
        for name in ("NORMAL", "TANGENT"):
            if name in p["attributes"]:
                nacc, n = floats(p["attributes"][name])
                # a tangent carries its handedness in a fourth component, which
                # the rotation does not touch
                if n.shape[1] == 4:
                    n[:, :3] = n[:, :3] @ matrix.T
                else:
                    n = n @ matrix.T
                views[nacc["bufferView"]] = n.astype("<f4").tobytes()
    return scale


def shrink_glb(data, fit=None):
    """Smaller textures as JPEG, 16-bit indices where they fit, and no tangents.

    fit, when given, is place()'s keyword arguments: the reconstruction is turned,
    scaled and moved onto the asset's pivot first.
    """
    doc, blob = read_glb(data)
    views = [bytes(blob[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]) for v in doc["bufferViews"]]
    if fit:
        place(doc, views, **fit)

    for i, px in image_sizes(doc).items():
        img = doc["images"][i]
        im = Image.open(io.BytesIO(views[img["bufferView"]])).convert("RGB")
        if im.width > px:
            im = im.resize((px, px), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        views[img["bufferView"]] = out.getvalue()
        img["mimeType"] = "image/jpeg"

    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            # three.js works tangents out from the UVs when a mesh has none
            t = prim["attributes"].pop("TANGENT", None)
            if t is not None:
                doc["accessors"][t]["_drop"] = True
            ix = prim.get("indices")
            if ix is None:
                continue
            acc = doc["accessors"][ix]
            verts = doc["accessors"][prim["attributes"]["POSITION"]]["count"]
            if acc["componentType"] == 5125 and verts <= 65535 and not acc.get("byteOffset"):
                vals = struct.unpack(f"<{acc['count']}I", views[acc["bufferView"]][:acc["count"] * 4])
                views[acc["bufferView"]] = struct.pack(f"<{acc['count']}H", *vals)
                acc["componentType"] = 5123
                acc.pop("max", None), acc.pop("min", None)

    # drop the accessors and buffer views nothing reads any more, and renumber
    used = {k for k, a in enumerate(doc["accessors"]) if not a.get("_drop")}
    acc_map = {old: new for new, old in enumerate(sorted(used))}
    doc["accessors"] = [a for k, a in enumerate(doc["accessors"]) if k in used]
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            prim["attributes"] = {n: acc_map[a] for n, a in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = acc_map[prim["indices"]]
    read_views = {a["bufferView"] for a in doc["accessors"] if "bufferView" in a}
    read_views |= {im["bufferView"] for im in doc.get("images", []) if "bufferView" in im}
    keep = [k in read_views for k in range(len(views))]
    for a in doc["accessors"]:
        a.pop("_drop", None)
    view_map, out, packed = {}, [], b""
    for k, v in enumerate(doc["bufferViews"]):
        if not keep[k]:
            continue
        packed += b"\0" * (-len(packed) % 4)
        v = dict(v, byteOffset=len(packed), byteLength=len(views[k]))
        packed += views[k]
        view_map[k] = len(out)
        out.append(v)
    doc["bufferViews"] = out
    for a in doc["accessors"]:
        if "bufferView" in a:
            a["bufferView"] = view_map[a["bufferView"]]
    for im in doc.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = view_map[im["bufferView"]]
    packed += b"\0" * (-len(packed) % 4)
    doc["buffers"] = [{"byteLength": len(packed)}]
    return write_glb(doc, packed)


def manifest_entry(asset_id):
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    assets = manifest if isinstance(manifest, list) else manifest["assets"]
    entry = next((a for a in assets if a["id"] == asset_id), None)
    if entry is None:
        raise KeyError(f"{asset_id} is not in {MANIFEST}")
    return entry


def fit_of(entry):
    """place()'s arguments from the asset's spec height and the frame its validation checks."""
    frame = entry.get("validation", {}).get("frame")
    if not frame:
        raise ValueError(f"{entry['id']} has no validation.frame to say where the reconstruction goes")
    return {
        "height_cm": entry["scale_dimensions_cm"]["height"],
        "y_min_cm": frame["y_min_cm"],
        "centre_x_cm": frame.get("centre_x_cm", 0.0),
        "centre_z_cm": frame.get("centre_z_cm", 0.0),
        "turn_deg": frame.get("turn_deg", 0),
        "roll_deg": frame.get("roll_deg", 0.0),
    }


def reconstruct(asset_id, seed=None, faces=None, out=None):
    entry = manifest_entry(asset_id)
    fit = fit_of(entry)
    sheet = os.path.join(ROOT, entry["turnaround_sheet"])
    out_path = out or os.path.join(ROOT, entry["glb_output"])

    views = cut_sheet(sheet)
    if entry.get("validation", {}).get("frame", {}).get("upside_down"):
        # The prop's approved art is drawn the other way up - a swordstick
        # hanging from its pommel, a bat with its handle in the air - while the
        # pivot puts the grip at the origin and the working end above it.
        # The sheet is turned over before it is conditioned on, so the mesh and
        # the textures baked from these same views both come out the right way
        # up; turning the mesh over afterwards would leave the bake upside down
        # on the surface.
        #
        # Turning the object over is a half turn about the front view's
        # horizontal axis, so the two broadside views are turned over the other
        # way and the two side views are turned over sideways: each tile is
        # flipped about the axis the object's turn runs along in that view.
        views = {v: (ImageOps.flip(img) if v in ("front", "back") else ImageOps.mirror(img))
                 for v, img in views.items()}
        print(f"[Pixal3D] {asset_id} is built upside down: the sheet is turned over first")
    names = {v: upload(img, f"{asset_id}_view_{v}.png") for v, img in views.items()}
    print(f"[Pixal3D] Uploaded the {', '.join(names)} views of {entry['turnaround_sheet']}")
    prefix = f"3d/pixal3d_{asset_id}"
    started = time.time()
    entry_h = run(build_workflow(names, prefix, seed, faces))

    glbs = [o for node in entry_h["outputs"].values() for key in ("3d", "glb", "meshes", "files")
            for o in node.get(key, []) if isinstance(o, dict) and "highpoly" not in o.get("filename", "")]
    if not glbs:
        # SaveGLB names its file after the prefix; take the newest one this run wrote
        folder = os.path.join(COMFY_OUTPUT, "3d")
        found = sorted((f for f in os.listdir(folder) if f.startswith(f"pixal3d_{asset_id}_0") and f.endswith(".glb")
                        and os.path.getmtime(os.path.join(folder, f)) >= started),
                       key=lambda f: os.path.getmtime(os.path.join(folder, f)))
        if not found:
            raise FileNotFoundError(f"this run wrote no GLB named pixal3d_{asset_id}_* in {folder}")
        raw = os.path.join(folder, found[-1])
    else:
        raw = os.path.join(COMFY_OUTPUT, glbs[0].get("subfolder", ""), glbs[0]["filename"])
    with open(raw, "rb") as f:
        data = shrink_glb(f.read(), fit)
    with open(out_path, "wb") as f:
        f.write(data)
    print(f"[Pixal3D] {os.path.getsize(raw):,} bytes from {raw} shrunk to {len(data):,} in {out_path}")
    return out_path


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("asset", nargs="?")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--faces", type=int)
    ap.add_argument("--out", help="write the GLB here instead of the manifest's glb_output")
    ap.add_argument("--shrink", nargs=2, metavar=("IN", "OUT"),
                    help="shrink a GLB ComfyUI already made; with an asset, place it on that asset's pivot too")
    a = ap.parse_args()
    if a.shrink:
        with open(a.shrink[0], "rb") as f:
            data = shrink_glb(f.read(), fit_of(manifest_entry(a.asset)) if a.asset else None)
        with open(a.shrink[1], "wb") as f:
            f.write(data)
        print(f"{a.shrink[1]}: {len(data):,} bytes")
    elif a.asset:
        reconstruct(a.asset, a.seed, a.faces, a.out)
    else:
        ap.error("name an asset, or --shrink IN OUT")
