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
       python scripts/run_minimax_h3_turnaround.py - <sheet.png> --from-frames h3_turntable_frames_01985_.png [--symmetric]
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

def prepare_input_image(alpha_image_path, target_size=(768, 768), bg_color=(255, 255, 255), name=None):
    """Composite RGBA alpha image over clean solid background and center it.

    The name matters: ComfyUI's LoadImage node reads the file when the job
    runs, not when it is queued, so a clip that waits behind another one reads
    whatever the last prop wrote under a shared name. Every prop gets its own
    anchor file, so a queued clip always conditions on its own artwork.
    """
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
    out_filename = name or "h3_turntable_anchor.png"
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

def greyscale(img, size=192):
    """The frame in grey, at a small size."""
    return np.asarray(img.convert("L").resize((size, size), Image.Resampling.BILINEAR)).astype(np.float64)

def correlate(a, b):
    """How alike two flat images are, in [-1, 1]."""
    a = a - a.mean()
    b = b - b.mean()
    denom = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / denom) if denom else 0.0

def masked_correlate(a, b, mask):
    """How alike two images are over the pixels the mask covers."""
    av = a[mask]
    bv = b[mask]
    if av.size < 32:
        return 0.0
    av = av - av.mean()
    bv = bv - bv.mean()
    denom = np.sqrt((av * av).sum() * (bv * bv).sum())
    return float((av * bv).sum() / denom) if denom else 0.0

def height_spread(sils):
    """How much the silhouette's height changes over the clip, as a fraction.

    A body turning about its own vertical axis keeps its height: it stands as
    tall at the back as it does at the front. A body tumbling in the image
    plane does not - it lies down, stands up and lies down again - so its
    height swings.
    """
    heights = []
    for sil in sils:
        rows = np.nonzero(sil.any(axis=1))[0]
        heights.append(float(np.ptp(rows)) if len(rows) else 0.0)
    heights = [h for h in heights if h > 0]
    if len(heights) < 2:
        return 0.0
    return float((max(heights) - min(heights)) / (sum(heights) / len(heights)))

def peak_after_trough(scores, start, smooth=5):
    """The peak of the smoothed scores after their trough, and its rise."""
    padded = np.pad(scores, smooth // 2, mode="edge")
    smoothed = np.convolve(padded, np.ones(smooth) / smooth, mode="valid")
    # the side views are the trough; the back is the peak after it
    trough = int(np.argmin(smoothed))
    peak = trough + int(np.argmax(smoothed[trough:]))
    return start + peak, float(smoothed[peak] - smoothed[trough])


def peak_before(scores, index, start, smooth=5):
    """The peak before a given one, and its rise over the trough.

    A clip that turns past a full circle comes round to the front again, and
    the front matches its own mirror better than the back does, so the front
    coming round can be the largest peak in the clip and the last frame of it.
    The back is then the peak before it.
    """
    padded = np.pad(scores, smooth // 2, mode="edge")
    smoothed = np.convolve(padded, np.ones(smooth) / smooth, mode="valid")
    trough = int(np.argmin(smoothed))
    limit = max(min(index - start, len(smoothed) - 1), trough + 1)
    peaks = [i for i in range(trough + 1, limit)
             if smoothed[i] >= smoothed[i - 1] and smoothed[i] > smoothed[i + 1]]
    peak = peaks[-1] if peaks else trough + int(np.argmax(smoothed[trough:limit]))
    return start + peak, float(smoothed[peak] - smoothed[trough])

def highest_peak_before_trough(scores, start, smooth=5):
    """The strongest peak before the curve's trough, and its rise.

    The rise is measured over the valley just before the peak - the side view
    the peak stands over - rather than over the trough, which in a clip that
    turns a full circle is the *other* side view and lies after the back.
    """
    padded = np.pad(scores, smooth // 2, mode="edge")
    smoothed = np.convolve(padded, np.ones(smooth) / smooth, mode="valid")
    trough = int(np.argmin(smoothed))
    best = None
    for i in range(1, trough):
        if smoothed[i] >= smoothed[i - 1] and smoothed[i] > smoothed[i + 1]:
            valley = 0
            for j in range(i - 1, 0, -1):
                if smoothed[j] <= smoothed[j - 1] and smoothed[j] < smoothed[j + 1]:
                    valley = j
                    break
            rise = float(smoothed[i] - smoothed[valley])
            if best is None or rise > best[1]:
                best = (start + i, rise)
    if best is None:
        return start + trough, 0.0
    return best


def pick_views(frames, symmetric=False, min_rise=0.15, min_colour_rise=0.06, smooth=5, max_tumble=0.30):
    """Frame indices of the front, left, back and right views, and whether right is the left mirrored.

    Right is None when the clip ends before it and the prop is not symmetric:
    a mirrored side would put one-sided details on the wrong side.

    The back is the frame, past the first quarter of the clip, whose silhouette best
    matches the front's mirrored: a half turn mirrors the outline. Perspective
    keeps the match well short of perfect (0.7 for the chair), so what is asked
    for is a peak that rises clear of the side views' trough.

    Some props have no such peak. A bottle, a flatcap and a samovar keep the
    same outline all the way round - their silhouette barely changes as they
    turn - so the outline match has no peak to find, and a prop like that was
    refused for a clip that was perfectly good. For those the colour is asked
    instead, and only over the object's own pixels: the label, the crest and
    the shading are not the same at the back as at the front, so the colour
    match still finds the turn where the outline cannot.

    The colour match is held to its own, lower bar, because the outline it
    stands in for is a weaker signal: a bottle's own colour barely changes
    over a half turn, and asking for as much rise as an outline would throw
    away a perfectly good clip.

    A clip that tumbles in the image plane is refused whatever its outline
    does: the object lies down and stands up rather than turning about its own
    axis, so it never shows a back view at all.

    A clip that turns a full circle comes round to the front again, and the
    front matches its own mirror better than the back does, so the largest
    peak can be the last frame of the clip. The back is then an earlier peak:
    the peak before it, or - when the curve's own trough is late in the clip
    and there is no peak to be had before the tail - the strongest peak before
    that trough.
    """
    sil = [silhouette(f) for f in frames]
    grey = [greyscale(f) for f in frames]
    mirrored_front = np.fliplr(sil[0])
    mirrored_grey = np.fliplr(grey[0])
    start = len(frames) // 4
    scores = np.array([iou(s, mirrored_front) for s in sil[start:]])
    back, rise = peak_after_trough(scores, start, smooth)
    chosen = scores

    # the object's own pixels, where the colour is worth reading
    mask = sil[0] | sil[start]
    colour_scores = np.array([masked_correlate(g, mirrored_grey, mask) for g in grey[start:]])
    colour_back, colour_rise = peak_after_trough(colour_scores, start, smooth)

    if rise < min_rise and colour_rise >= min_colour_rise and colour_rise > rise:
        # the outline does not change as the prop turns: the colour is asked
        back, rise = colour_back, colour_rise
        threshold = min_colour_rise
        chosen = colour_scores
    else:
        threshold = min_rise

    tumble = height_spread(sil)
    if tumble > max_tumble:
        raise RuntimeError(
            f"the clip tumbles: the object swings in the image plane rather than turning "
            f"about its own axis, so it never shows a back view; its height changes by "
            f"{tumble:.0%} over the clip"
        )

    if back >= len(frames) - smooth:
        # the largest peak is in the last frames of the clip, which means it is
        # the front coming round again rather than the back: the back is the
        # peak before it
        earlier, earlier_rise = peak_before(scores, back, start, smooth)
        if earlier_rise >= threshold and earlier < len(frames) - smooth:
            back, rise = earlier, earlier_rise
        else:
            # the outline has no peak to offer, so the colour is asked
            earlier, earlier_rise = peak_before(colour_scores, back, start, smooth)
            if earlier_rise >= threshold and earlier < len(frames) - smooth:
                back, rise = earlier, earlier_rise
            else:
                # neither curve has a peak before the tail. That happens when
                # the curve's own trough is late in the clip - the sides are
                # then the valley before the back, and the back is the
                # strongest peak before that trough.
                earlier, earlier_rise = highest_peak_before_trough(chosen, start, smooth)
                if earlier_rise >= threshold and earlier < len(frames) - smooth:
                    back, rise = earlier, earlier_rise

    if back >= len(frames) - smooth or rise < threshold:
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
    stem = os.path.splitext(os.path.basename(output_sheet_path))[0]
    anchor_file = prepare_input_image(input_alpha_path, target_size=(768, 768),
                                      name=f"anchor_{stem}.png")

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

    names = [os.path.join(info.get("subfolder", ""), info["filename"]) for info in images_info]
    h3 = {"length": length, "seed": seed, "steps": steps, "seconds": seconds}
    return write_sheet(names, output_sheet_path, preview_path, symmetric, h3)


def clip_from_frames(first, clip_frames=LENGTH):
    """The names of a clip already in ComfyUI's output, from its first frame's name.

    SaveImage numbers frames on from the last file with the prefix, so a clip is
    the run of clip_frames numbers starting at its first frame.
    """
    prefix, number = first.rsplit("_", 2)[0], int(first.rsplit("_", 2)[1])
    names = [f"{prefix}_{number + i:05d}_.png" for i in range(clip_frames)]
    missing = [n for n in names if not os.path.exists(os.path.join(COMFY_OUTPUT, n))]
    if missing:
        raise FileNotFoundError(f"{len(missing)} frames of the clip are not in {COMFY_OUTPUT}, e.g. {missing[0]}")
    return names


def write_sheet(names, output_sheet_path, preview_path=None, symmetric=False, h3=None):
    """Pick the views from a clip's frames (names in ComfyUI's output) and write the sheet and its record."""
    frames = [Image.open(os.path.join(COMFY_OUTPUT, n)).convert("RGB") for n in names]
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
        "h3": {**(h3 or {}), "width": w, "height": h},
        "comfy_frames": [os.path.basename(n) for n in names],
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
    ap.add_argument("alpha", help="the alpha cutout; ignored with --from-frames")
    ap.add_argument("sheet")
    ap.add_argument("--preview")
    ap.add_argument("--from-frames", metavar="FIRST",
                    help="re-cut a clip already in ComfyUI's output instead of rendering one, "
                         "e.g. h3_turntable_frames_01985_.png; no GPU")
    ap.add_argument("--symmetric", action="store_true",
                    help="the prop is the same on both sides, so a missing right view may be the left mirrored")
    ap.add_argument("--length", type=int, default=LENGTH)
    ap.add_argument("--seed", type=int, default=1890)
    ap.add_argument("--steps", type=int, default=16)
    a = ap.parse_args()
    if a.from_frames:
        write_sheet(clip_from_frames(a.from_frames, a.length), a.sheet, a.preview, a.symmetric,
                    {"length": a.length, "reused": a.from_frames})
        sys.exit(0)
    run_h3_turntable(a.alpha, a.sheet, preview_path=a.preview, symmetric=a.symmetric,
                     length=a.length, seed=a.seed, steps=a.steps)
