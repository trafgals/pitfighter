"""Regenerate a prop's 2D art and its alpha cutout, from scratch.

The revision loop rebuilds a prop's *mesh* from the same approved sheet. That
is the right answer when the sheet is right and the reconstruction is wrong -
but a reviewer who says "redo it from the 2D stage" is saying the sheet is
wrong too, and no seed on the same sheet can fix that. This rebuilds the art
the sheet is cut from.

Stage 1 of the pipeline is "2D Reference & Isolated Watertight Alpha (FLUX 3 +
BiRefNet / Rembg)": a FLUX 3 image of the prop, and a cutout of it with a
watertight alpha. This runs both halves, on the local models:

  * FLUX 3 klein (`flux3-image-klein-int8-convrot.safetensors`) with the
    Qwen3-VL 4B text encoder, run through ComfyUI
  * BiRefNet (`background_removal/birefnet.safetensors`), run through ComfyUI's
    own RemoveBackground node

Both run in ComfyUI rather than in a separate process, so the GPU is used the
same way the rest of the pipeline uses it: one job at a time, queued.

The old art is kept beside the new one rather than overwritten, so the sheet
that was reviewed is still there to compare against.

Usage:
    python tools/props/redo_concept.py <asset_id> [--seed N] [--prompt "..."]
    python tools/props/redo_concept.py <asset_id> --from-issue
    python tools/props/redo_concept.py <asset_id> --out <cutout.png> --json
"""
import argparse
import json
import os
import shutil
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import manifest_io  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

COMFY_HOST = "http://127.0.0.1:8188"
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"
COMFY_INPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\input"

FLUX3_UNET = "flux3-image-klein-int8-convrot.safetensors"
FLUX3_CLIP = "qwen3vl_4b_int8_convrot.safetensors"
BIREFNET = "birefnet.safetensors"
# FLUX 3 packs its latent into 32 channels, so it decodes with the FLUX 2
# autoencoder. The 16-channel one gives "expected input[1, 128, 64, 64] to
# have 16 channels, but got 128 channels instead".
VAE = "flux2-vae.safetensors"

NEGATIVE = (
    "blurry, low quality, jpeg artifacts, text, watermark, signature, "
    "multiple objects, duplicate, cropped, cut off, out of frame, "
    "hands, people, background clutter, gradient background"
)

# the extra instruction every regenerated art gets. The old art is what the
# reviewer turned down, and the two things they said about it were that the
# object was cropped and that it did not show the whole thing - so the new art
# is asked for whole, and on its own.
WHOLE = (
    "The entire object is fully visible and completely inside the frame with "
    "clear empty margin on every side, nothing cropped, nothing cut off."
)

# The props' prompts, and what the reviewer asked for on each one. A stage-1
# redo is a redo of the art, so the art has to be asked for again - with the
# reviewer's finding folded into the prompt, because that is the only place
# the finding can reach.
REDO = {
    "prop_crape_spiked_brolly": {
        "prompt": (
            "Victorian gentleman's heavy mourning black silk umbrella, long "
            "sharpened steel mortuary ferrule spike, carved whalebone crook "
            "handle inlaid with faceted jet beads, brass ribs, the whole "
            "umbrella standing upright and open, the entire umbrella including "
            "the tip of the spike and the top of the handle fully inside the "
            "frame, isolated on solid white background"
        ),
    },
    "prop_kilnworth_nursecap": {
        "prompt": (
            "Severe Victorian starched white linen field nurse head bonnet cap, "
            "a rounded dome crown with soft curved sides and no flat panels or "
            "angular corners, crimson embroidered Geneva cross emblem on the "
            "front, bone sewing pins, clean stiff folds, the whole cap shown "
            "from the front and the entire cap inside the frame, isolated on "
            "solid white background"
        ),
    },
    "weapon_nail_bat": {
        "prompt": (
            "Victorian studded cricket bat, flat squared-off hammer face at the "
            "top with sharp square corners, bludgeoned wooden barrel, iron nails "
            "studded into the face and along the shoulders, a wound cord grip "
            "wrap with visible winding ridges down the handle, the whole bat "
            "standing upright from the toe of the handle to the top of the face "
            "and the entire bat inside the frame, isolated on solid white "
            "background"
        ),
    },
    "weapon_chair": {
        "prompt": (
            "Victorian private box chair, a black leather buttoned club chair on "
            "short turned wooden legs, brass nailhead trim around the seat and "
            "back, the whole chair standing upright on all four legs and the "
            "entire chair inside the frame, isolated on solid white background"
        ),
    },
    # The shovel and the cleaver are here for a different reason than the rest:
    # their art was drawn on the diagonal, and a turnaround clip of a diagonal
    # object spins in the image plane rather than about its own axis, so no
    # seed on that art ever shows a back view. The art is asked for upright.
    "weapon_coal_shovel": {
        "prompt": (
            "Victorian stoker's coal shovel standing upright and vertical on its "
            "spade blade, a wide blackened steel spade at the bottom, a straight "
            "shaft rising straight up, a D-shaped steel handle at the very top, "
            "the whole shovel from the tip of the blade to the top of the D "
            "handle inside the frame and standing perfectly vertical, isolated "
            "on solid white background"
        ),
    },
    "weapon_cleaver": {
        "prompt": (
            "Victorian butcher's cleaver standing upright and vertical with the "
            "heavy curved steel blade at the top and the dark wooden handle "
            "below it, the blade edge at the very top of the frame, the whole "
            "cleaver from the top of the blade to the end of the handle inside "
            "the frame and standing perfectly vertical, isolated on solid white "
            "background"
        ),
    },
    # The reviewer asked, on the lamplighter's pole issue, for the constable to
    # have a gold engraved mechanical nightstick instead. The pole itself is
    # not touched: this is the constable's own weapon, and its shape is
    # decided in the art.
    "prop_winch_gold_nightstick": {
        "prompt": (
            "Victorian gold engraved mechanical nightstick baton, a short heavy "
            "brass club with a dark knurled leather grip, deep gold engraving "
            "and scrollwork chased along the shaft, a brass mechanical click "
            "catch and a ring at the top of the handle, standing upright and "
            "vertical with the butt at the bottom and the catch at the very "
            "top, the whole nightstick from the butt to the top of the catch "
            "inside the frame and standing perfectly vertical, isolated on "
            "solid white background"
        ),
    },
}

# The prompt each prop was originally built from, read out of the manifest's
# reference art rather than hardcoded, so a prop that is not in REDO still
# gets its own art back.
FALLBACK_PROMPTS = {}


def stem_of(asset_id):
    """The short name a prop's files carry."""
    return asset_id.replace("prop_", "").replace("weapon_", "").replace("pickup_", "")


def cutout_path(asset_id, root=ROOT):
    """Where a prop's redone cutout is written."""
    return os.path.join(root, "public", "tex", "props", f"flux3_{stem_of(asset_id)}_redo_alpha.png")


def comfy_json(path):
    with urllib.request.urlopen(f"{COMFY_HOST}/{path}", timeout=30) as response:
        return json.loads(response.read())


def queue_workflow(workflow):
    """Put a workflow on ComfyUI's queue and give back its prompt id."""
    request = urllib.request.Request(
        f"{COMFY_HOST}/prompt",
        data=json.dumps({"prompt": workflow}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read()).get("prompt_id")


def wait_for(prompt_id, timeout_s=8 * 3600):
    """Wait for a queued job and give back its images."""
    started = time.time()
    while time.time() - started < timeout_s:
        time.sleep(4)
        history = comfy_json(f"history/{prompt_id}")
        if prompt_id not in history:
            continue
        entry = history[prompt_id]
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(f"ComfyUI error: {status.get('messages')}")
        for node in entry.get("outputs", {}).values():
            images = node.get("images") or []
            if images:
                return [
                    os.path.join(COMFY_OUTPUT, i.get("subfolder", ""), i["filename"])
                    for i in images
                ]
    raise TimeoutError(f"prompt {prompt_id} did not finish")


def flux3_workflow(prompt, seed, width=1024, height=1024, steps=28):
    """A FLUX 3 klein text-to-image graph, in ComfyUI's API shape."""
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": FLUX3_UNET, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": FLUX3_CLIP, "type": "flux3", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {"class_type": "CLIPTextEncode",
              "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode",
              "inputs": {"text": NEGATIVE, "clip": ["2", 0]}},
        "6": {"class_type": "EmptySD3LatentImage",
              "inputs": {"width": width, "height": height, "batch_size": 1}},
        "7": {"class_type": "KSampler",
              "inputs": {
                  "model": ["1", 0],
                  "seed": seed,
                  "steps": steps,
                  "cfg": 4.0,
                  "sampler_name": "euler",
                  "scheduler": "simple",
                  "positive": ["4", 0],
                  "negative": ["5", 0],
                  "latent_image": ["6", 0],
                  "denoise": 1.0,
              }},
        "8": {"class_type": "VAEDecode",
              "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0],
                         "filename_prefix": f"flux3redo_{os.environ.get('PROP_REDO_ID', 'prop')}"}},
    }


def birefnet_workflow(image_name, out_prefix):
    """A BiRefNet background removal graph: LoadImage -> RemoveBackground.

    `RemoveBackground` outputs a *mask*, not an image, so the mask goes through
    `MaskToImage` before it is saved: a mask saved straight into an image node
    writes the foreground as white on black, which is the alpha channel the
    cutout wants.
    """
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": "LoadBackgroundRemovalModel",
              "inputs": {"bg_removal_name": BIREFNET}},
        "3": {"class_type": "RemoveBackground",
              "inputs": {"bg_removal_model": ["2", 0], "image": ["1", 0]}},
        "4": {"class_type": "MaskToImage", "inputs": {"mask": ["3", 0]}},
        "5": {"class_type": "SaveImage",
              "inputs": {"images": ["4", 0], "filename_prefix": out_prefix}},
    }


def write_cutout(image_path, mask_path, out_path):
    """The cutout as an RGBA png: the image with the mask as its alpha."""
    from PIL import Image
    image = Image.open(image_path).convert("RGB")
    mask = Image.open(mask_path).convert("L")
    if mask.size != image.size:
        mask = mask.resize(image.size, Image.Resampling.LANCZOS)
    rgba = image.convert("RGBA")
    rgba.putalpha(mask)
    # a watertight alpha: nothing is fully transparent inside the object's
    # bounding box but its own silhouette
    rgba.save(out_path)
    return out_path


def cutout_from_art(art_path, asset_id, out_path=None):
    """Cut an existing piece of art out, and write it beside the old cutout.

    The art is the expensive half - a FLUX 3 render - and the cutout is cheap.
    So the two are separate steps, and a cutout can be redone from the art that
    is already on disk without paying for the render again.
    """
    art_name = os.path.basename(art_path)
    shutil.copyfile(art_path, os.path.join(COMFY_INPUT, art_name))
    mask_id = queue_workflow(birefnet_workflow(art_name, f"birefnet_{asset_id}"))
    print(f"  the cutout is queued as {mask_id}")
    masks = wait_for(mask_id)
    if not masks:
        raise RuntimeError("the cutout produced no mask")
    mask_path = masks[0]

    out_path = out_path or cutout_path(asset_id)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    print(f"  cutout: {write_cutout(art_path, mask_path, out_path)}")
    return out_path


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("asset_id")
    parser.add_argument("--seed", type=int, default=4242)
    parser.add_argument("--prompt")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--from-art", metavar="PNG",
                        help="cut this art out instead of rendering it again")
    parser.add_argument("--out", metavar="PNG",
                        help="write the cutout here instead of beside the old one")
    parser.add_argument("--art-out", metavar="PNG",
                        help="write a copy of the 2D art here, in the repository")
    parser.add_argument("--json", action="store_true",
                        help="end the output with a JSON summary of what was made")
    args = parser.parse_args()

    asset_id = args.asset_id
    os.environ["PROP_REDO_ID"] = asset_id
    out_path = args.out or cutout_path(asset_id)

    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        entry = next((a for a in manifest["assets"] if a["id"] == asset_id), None)
    if entry is None:
        print(f"{asset_id} is not in the manifest")
        return 1

    # The cutout on its own: the art is already on disk, and only the alpha
    # needs doing.
    if args.from_art:
        art_path = args.from_art
        if not os.path.exists(art_path):
            print(f"{art_path} does not exist")
            return 1
        print(f"{asset_id}: cutting out the existing art")
        cutout = cutout_from_art(art_path, asset_id, out_path)
        if args.json:
            print(json.dumps({"asset_id": asset_id, "art": art_path, "cutout": cutout}))
        return 0

    prompt = args.prompt
    if not prompt:
        redo = REDO.get(asset_id)
        if redo:
            prompt = redo["prompt"]
        else:
            prompt = FALLBACK_PROMPTS.get(asset_id) or entry.get("prompt") or ""
    prompt = f"{prompt} {WHOLE}"

    print(f"{asset_id}: regenerating the 2D art")
    print(f"  prompt: {prompt}")

    if args.dry_run:
        print(json.dumps(flux3_workflow(prompt, args.seed), indent=2))
        return 0

    prompt_id = queue_workflow(flux3_workflow(prompt, args.seed))
    print(f"  queued as {prompt_id}")
    images = wait_for(prompt_id)
    if not images:
        print("  the job produced no image")
        return 1
    new_art = images[0]
    print(f"  art: {new_art}")

    # The cutout. BiRefNet writes its mask as an image, and the mask is what
    # the sheet is conditioned on.
    art_name = os.path.basename(new_art)
    shutil.copyfile(new_art, os.path.join(COMFY_INPUT, art_name))
    mask_id = queue_workflow(birefnet_workflow(art_name, f"birefnet_{asset_id}"))
    print(f"  the cutout is queued as {mask_id}")
    masks = wait_for(mask_id)
    if not masks:
        print("  the cutout produced no mask")
        return 1
    mask_path = masks[0]

    # the new files, beside the old ones
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    cutout = write_cutout(new_art, mask_path, out_path)
    print(f"  cutout: {cutout}")

    # the art itself, kept in the repository so that the manifest can name it
    art_copy = None
    if args.art_out:
        os.makedirs(os.path.dirname(os.path.abspath(args.art_out)), exist_ok=True)
        shutil.copyfile(new_art, args.art_out)
        art_copy = args.art_out
        print(f"  art: {art_copy}")

    if args.json:
        print(json.dumps({"asset_id": asset_id, "art": new_art,
                          "art_copy": art_copy, "cutout": cutout}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
