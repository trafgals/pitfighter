import os
import sys
import json
import time
import shutil
import urllib.request
from PIL import Image

COMFY_HOST = "http://127.0.0.1:8188"
COMFY_INPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\input"
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"

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

def build_workflow(anchor_filename, prompt_text, width=768, height=768, length=124, seed=1890):
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
                "steps": 16,
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

def run_h3_turntable(input_alpha_path, output_sheet_path, prompt=None):
    if prompt is None:
        prompt = (
            "A smooth continuous 360-degree turntable rotation of the exact object around the vertical axis at constant speed. "
            "Isolated on a solid pure white background, studio shadowless lighting. "
            "The geometry, brass badge, crest, and proportions remain strictly rigid and unchanged as the object spins."
        )

    print(f"[MiniMax H3] Starting turnaround generation from {input_alpha_path}...")
    anchor_file = prepare_input_image(input_alpha_path, target_size=(768, 768))

    workflow = build_workflow(anchor_file, prompt, width=768, height=768, length=124)

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

    # Extract 4 orthographic views: 0°, 90°, 180°, 270°
    num_frames = len(images_info)
    indices = [
        0,                        # 0° (Front)
        int(num_frames * 0.25),   # 90° (Right Profile)
        int(num_frames * 0.50),   # 180° (Rear)
        int(num_frames * 0.75)    # 270° (Left Profile)
    ]
    print(f"[MiniMax H3] Extracting keyframe indices: {indices}")

    views = []
    labels = ["Front (0°)", "Right Profile (90°)", "Rear (180°)", "Left Profile (270°)"]
    for i, idx in enumerate(indices):
        frame_name = images_info[idx]["filename"]
        frame_subfolder = images_info[idx].get("subfolder", "")
        frame_path = os.path.join(COMFY_OUTPUT, frame_subfolder, frame_name)
        img = Image.open(frame_path).convert("RGB")
        views.append(img)
        print(f"  - View {labels[i]}: {frame_path}")

    # Stitch into horizontal 4-view strip
    w, h = views[0].size
    strip = Image.new("RGB", (w * 4, h), (255, 255, 255))
    for i, v in enumerate(views):
        strip.paste(v, (i * w, 0))

    os.makedirs(os.path.dirname(output_sheet_path), exist_ok=True)
    strip.save(output_sheet_path, quality=95)
    print(f"[MiniMax H3] 4-view orthographic turnaround sheet saved: {output_sheet_path}")
    return output_sheet_path

if __name__ == "__main__":
    src = "public/tex/props/flux3_winch_custodian_prop_alpha.png"
    dst = "public/tex/props/h3_custodian_helmet_turnaround.png"
    run_h3_turntable(src, dst)
