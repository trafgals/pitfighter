"""MiniMax H3 turntable of a prop's alpha cutout, cut down to the four views Pixal3D reconstructs from.

H3 does not turn the object a full circle in the clip: over 124 frames it turns
about 240 degrees, so frames at 1/4, 1/2 and 3/4 of the clip are not the side,
back and other side. The back is found instead as the frame whose silhouette is
the front's silhouette mirrored, the side as the frame halfway to it, and the
other side as the frame as far past the back. When the clip ends before that, a prop
declared symmetric (--symmetric) gets the first side mirrored; any other prop
gets no right view, and Pixal3D reconstructs from the other three.

Writes:
  <sheet>.png   the four views side by side, in Pixal3D's order: front, left, back, right
                (a missing right view is a white tile)
  <sheet>.json  which frame each view came from, its angle, and the H3 settings
  --preview     an animated WebP of the clip, for review (kept out of public/)

Usage: python scripts/run_minimax_h3_turnaround.py <alpha.png> <sheet.png> [--preview out.webp]
       [--symmetric] [--length 124] [--seed 1890] [--steps 16]
"""
import os
import sys
import json
import time
import argparse
import urllib.request
import numpy as np
from PIL import Image, ImageOps

COMFY_HOST = "http://127.0.0.1:8188"
COMFY_INPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\input"
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"

# H3 snaps the length to 17k+5 frames, and 124 is the shortest it was trained on.
# Shorter does not save the back view: at 56 frames the chair turned only a
# quarter and its legs came apart. Most of a run is the VAE decode, not the
# sampling (56 frames: 3 min sampling, 18 min decoding with --fp32-vae).
LENGTH = 124
VIEWS = ["front", "left", "back", "right"]

def prepare_input_image(alpha_image_path, target_size=(768, 768), bg_color=(255, 255, 255)):
    """Composite RGBA alpha image over clean solid background and center it."""
    im = Image.open(alpha_image_path)
    if im.mode != "RGBA":
        im = im.convert("RGBA")

    # Calculate aspect-ratio preserving bounding box
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)

    w, h = im.size
    max_dim = int(target_size[0] * 0.85) # Leave 15% margin
    scale = min(max_dim / w, max_dim / h)
    new_w, new_h = int(w * scale), int(h * scale)
    im_resized = im.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Create solid background
    canvas = Image.new("RGBA", target_size, bg_color + (255,))
    offset_x = (target_size[0] - new_w) // 2
    offset_y = (target_size[1] - new_h) // 2
    canvas.paste(im_resized, (offset_x, offset_y), im_resized)

    final_rgb = canvas.convert("RGB")
    out_filename = "h3_turntable_anchor.png"
    target_path = os.path.join(COMFY_INPUT, out_filename)
    final_rgb.save(target_path, quality=95)
    print(f"[MiniMax H3] Prepared anchor image: {target_path} ({target_size[0]}x{target_size[1]})")
    return out_filename

def build_workflow(anchor_filename, prompt_text, width=768, height=768, length=LENGTH, seed=1890, steps=16):
    workflow = {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
                "weight_dtype": "default"
            }
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                "type": "minimax",
                "device": "default"
            }
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": "minimax_h3_video_vae_fp16.safetensors"
            }
        },
        "4": {
            "class_type": "LoadImage",
            "inputs": {
                "image": anchor_filename
            }
        },
        "5": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["2", 0],
                "vae": ["3", 0],
                "prompt": prompt_text,
                "width": width,
                "height": height,
                "length": length,
                "first_frame": ["4", 0]
            }
        },
        "6": {
            "class_type": "MiniMaxH3SigmaShift",
            "inputs": {
                "model": ["1", 0],
                "shift_video": 12.0,
                "shift_audio": 3.0
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "text": "jitter, blur, motion blur, morphed emblem, distorted geometry, flickering, low quality"
            }
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["6", 0],
                "positive": ["5", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 1],
                "seed": seed,
                "steps": steps,
                "cfg": 3.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0
            }
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["8", 0],
                "vae": ["3", 0]
            }
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["9", 0],
                "filename_prefix": "h3_turntable_frames"
            }
        }
    }
    return workflow

def silhouette(img, size=192, white=240):
    """The object's mask on H3's white background, at a small size."""
    a = np.asarray(img.convert("RGB").resize((size, size), Image.Resampling.BILINEAR)).astype(np.int16)
    return a.min(axis=2) < white

def iou(a, b):
    union = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum()) / union if union else 0.0

def pick_views(frames, symmetric=False, min_rise=0.15, smooth=5):
    """Frame indices of the front, left, back and right views, and whether right is the left mirrored.

    Right is None when the clip ends before it and the prop is not symmetric:
    a mirrored side would put one-sided details on the wrong side.

    The back is the frame, past the first quarter of the clip, whose silhouette best
    matches the front's mirrored: a half turn mirrors the outline. Perspective
    keeps the match well short of perfect (0.7 for the chair), so what is asked
    for is a peak that rises clear of the side views' trough and ends before the
    clip does. The turn is taken to run at constant speed from there.
    """
    sil = [silhouette(f) for f in frames]
    mirrored_front = np.fliplr(sil[0])
    start = len(frames) // 4
    scores = np.array([iou(s, mirrored_front) for s in sil[start:]])
    padded = np.pad(scores, smooth // 2, mode="edge")
    smoothed = np.convolve(padded, np.ones(smooth) / smooth, mode="valid")
    # the side views are the trough; the back is the peak after it
    trough = int(np.argmin(smoothed))
    peak = trough + int(np.argmax(smoothed[trough:]))
    back = start + peak
    rise = smoothed[peak] - smoothed[trough]
    if back >= len(frames) - smooth or rise < min_rise:
        raise RuntimeError(
            f"the clip never shows the back: the best match to the mirrored front is frame {back} "
            f"of {len(frames)}, rising {rise:.2f} over the side views; make the clip longer"
        )
    left = round(back / 2)
    right = back + left
    if right < len(frames):
        return {"front": 0, "left": left, "back": back, "right": right}, False
    if symmetric:
        return {"front": 0, "left": left, "back": back, "right": left}, True
    return {"front": 0, "left": left, "back": back, "right": None}, False

def run_h3_turntable(input_alpha_path, output_sheet_path, prompt=None, preview_path=None,
                     symmetric=False, length=LENGTH, seed=1890, steps=16):
    if prompt is None:
        prompt = (
            "A smooth continuous 360-degree turntable rotation of the exact object around the vertical axis at constant speed. "
            "Isolated on a solid pure white background, studio shadowless lighting. "
            "The geometry, brass badge, crest, and proportions remain strictly rigid and unchanged as the object spins."
        )

    print(f"[MiniMax H3] Starting turnaround generation from {input_alpha_path}...")
    anchor_file = prepare_input_image(input_alpha_path, target_size=(768, 768))

    workflow = build_workflow(anchor_file, prompt, width=768, height=768, length=length, seed=seed, steps=steps)

    req = urllib.request.Request(
        f"{COMFY_HOST}/prompt",
        data=json.dumps({"prompt": workflow}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    print("[MiniMax H3] Enqueuing prompt to ComfyUI on AMD Radeon RX 9070 XT...")
    res = urllib.request.urlopen(req)
    prompt_id = json.loads(res.read()).get("prompt_id")
    print(f"[MiniMax H3] Queued successfully! Prompt ID: {prompt_id}")

    # Await results
    print("[MiniMax H3] Awaiting generation...")
    started = time.time()
    while True:
        time.sleep(4)
        h_res = urllib.request.urlopen(f"{COMFY_HOST}/history/{prompt_id}")
        h_data = json.loads(h_res.read())
        if prompt_id in h_data:
            entry = h_data[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI error: {status.get('messages')}")

            outputs = entry.get("outputs", {})
            if "10" in outputs and "images" in outputs["10"]:
                images_info = outputs["10"]["images"]
                print(f"[MiniMax H3] Generation finished! Got {len(images_info)} frames.")
                break
    seconds = round(time.time() - started)

    frames = [
        Image.open(os.path.join(COMFY_OUTPUT, info.get("subfolder", ""), info["filename"])).convert("RGB")
        for info in images_info
    ]
    picked, right_mirrored = pick_views(frames, symmetric)
    degrees_per_frame = 180.0 / picked["back"]
    print(f"[MiniMax H3] Views: {picked}, {degrees_per_frame:.2f} deg/frame"
          + (", right is the left mirrored" if right_mirrored else "")
          + (", no right view: the clip ends before it" if picked["right"] is None else ""))

    # The four views side by side, in the order Pixal3D takes them
    w, h = frames[0].size
    strip = Image.new("RGB", (w * 4, h), (255, 255, 255))
    for i, view in enumerate(VIEWS):
        if picked[view] is None:
            continue
        img = frames[picked[view]]
        if view == "right" and right_mirrored:
            img = ImageOps.mirror(img)
        strip.paste(img, (i * w, 0))

    os.makedirs(os.path.dirname(os.path.abspath(output_sheet_path)), exist_ok=True)
    strip.save(output_sheet_path)
    record = {
        "views": VIEWS,
        "frames": picked,
        "degrees": {v: None if picked[v] is None else round(picked[v] * degrees_per_frame, 1) for v in VIEWS},
        "right_mirrored": right_mirrored,
        "clip_frames": len(frames),
        "degrees_per_frame": round(degrees_per_frame, 3),
        "h3": {"length": length, "seed": seed, "steps": steps, "width": w, "height": h, "seconds": seconds},
        "comfy_frames": [info["filename"] for info in images_info],
    }
    if right_mirrored:
        record["degrees"]["right"] = round(360 - record["degrees"]["left"], 1)
    with open(os.path.splitext(output_sheet_path)[0] + ".json", "w", newline="\n") as f:
        json.dump(record, f, indent=2)
        f.write("\n")
    print(f"[MiniMax H3] Four-view sheet saved: {output_sheet_path}")

    if preview_path:
        os.makedirs(os.path.dirname(os.path.abspath(preview_path)), exist_ok=True)
        anim = [f.resize((400, 400), Image.Resampling.LANCZOS) for f in frames[::2]]
        anim[0].save(preview_path, save_all=True, append_images=anim[1:], duration=80, loop=0, quality=85)
        print(f"[MiniMax H3] Turntable preview saved: {preview_path}")

    return output_sheet_path, record

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("alpha")
    ap.add_argument("sheet")
    ap.add_argument("--preview")
    ap.add_argument("--symmetric", action="store_true",
                    help="the prop is the same on both sides, so a missing right view may be the left mirrored")
    ap.add_argument("--length", type=int, default=LENGTH)
    ap.add_argument("--seed", type=int, default=1890)
    ap.add_argument("--steps", type=int, default=16)
    a = ap.parse_args()
    run_h3_turntable(a.alpha, a.sheet, preview_path=a.preview, symmetric=a.symmetric,
                     length=a.length, seed=a.seed, steps=a.steps)
