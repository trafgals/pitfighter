#!/usr/bin/env python3
"""
Master Resumable 3D Asset Batch Pipeline for Pit Fighter: Old Sorrow
Executes end-to-end asset generation across all remaining assets:
  Stage 1: 2D Reference & Isolated Watertight Alpha (FLUX 3 + BiRefNet / Rembg)
  Stage 2: MiniMax H3 4-View Orthographic Turnaround (3072x768) + 360 Turntable WebP
  Stage 3: 3D Binary GLB Mesh Synthesis with PBR Materials
  Stage 4: Headless Chrome Verification Renders & Budget Compliance Checks

State is persisted atomically to `data/pipeline_batch_state.json` after every single step.
If interrupted or crashed, re-running this script resumes exactly from the last incomplete step.
"""

import os
import sys
import json
import time
import shutil
import urllib.request
import urllib.error
import subprocess
from datetime import datetime
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STATE_FILE = os.path.join(ROOT, "data", "pipeline_batch_state.json")
LOG_FILE = os.path.join(ROOT, "logs", "pipeline_batch.log")
COMFY_HOST = "http://127.0.0.1:8188"
COMFY_INPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\input"
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"
COMFY_PYTHON = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\python_embeded\python.exe"
COMFY_MAIN = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\main.py"

os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "public", "tex", "props"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "public", "models", "props"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "docs", "props"), exist_ok=True)

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

# ---------------------------------------------------------------------------
# Master Asset Queue Definition
# ---------------------------------------------------------------------------
DEFAULT_QUEUE = [
    # ---- Wave 1: Fighter Signature Props & Weapons ----
    {
        "id": "prop_pegg_cast_iron_last",
        "name": "Calibrated Cast-Iron Shoe Last",
        "character": "Mistress Tabitha Pegg",
        "category": "weapon",
        "slot": "weapon_socket",
        "poly_budget": 30000,
        "scale_dimensions_cm": {"width": 14.0, "height": 34.0, "depth": 12.0},
        "alpha_file": "public/tex/props/flux3_pegg_shoelast_alpha.png",
        "turnaround_file": "public/tex/props/h3_pegg_shoelast_turnaround.png",
        "turntable_file": "public/tex/props/h3_pegg_shoelast_turntable.webp",
        "glb_file": "public/models/props/prop_pegg_cast_iron_last.glb",
        "build_cmd": "node scripts/build_prop_pegg_cast_iron_last.mjs",
        "prompt": "Authentic Victorian cobbler cast-iron foot shoe last bludgeon, calibrated brass rule plate with imperial markings, knurled thumbscrew, cordovan leather grip, isolated on white background.",
    },
    {
        "id": "prop_crape_spiked_brolly",
        "name": "Mourner's Spiked Mortuary Brolly",
        "character": "Mistress Martha Crape",
        "category": "weapon",
        "slot": "weapon_socket",
        "poly_budget": 25000,
        "scale_dimensions_cm": {"width": 12.0, "height": 92.0, "depth": 12.0},
        "alpha_file": "public/tex/props/flux3_crape_brolly_alpha.png",
        "turnaround_file": "public/tex/props/h3_crape_brolly_turnaround.png",
        "turntable_file": "public/tex/props/h3_crape_brolly_turntable.webp",
        "glb_file": "public/models/props/prop_crape_spiked_brolly.glb",
        "build_cmd": "node scripts/build_prop_crape_spiked_brolly.mjs",
        "prompt": "Victorian gentleman's heavy mourning black silk umbrella, long sharpened steel mortuary ferrule spike, carved whalebone crook handle inlaid with faceted jet beads, brass ribs, isolated on solid white background.",
    },
    {
        "id": "prop_eleanor_weeping_rapier",
        "name": "Weeping Rapier Swordstick",
        "character": "Lady Eleanor Ashby-Lisle",
        "category": "weapon",
        "slot": "weapon_socket",
        "poly_budget": 25000,
        "scale_dimensions_cm": {"width": 8.0, "height": 95.0, "depth": 8.0},
        "alpha_file": "public/tex/props/flux3_eleanor_rapier_alpha.png",
        "turnaround_file": "public/tex/props/h3_eleanor_rapier_turnaround.png",
        "turntable_file": "public/tex/props/h3_eleanor_rapier_turntable.webp",
        "glb_file": "public/models/props/prop_eleanor_weeping_rapier.glb",
        "build_cmd": "node scripts/build_prop_eleanor_weeping_rapier.mjs",
        "prompt": "Elegantly carved Victorian malacca walking cane swordstick, polished sterling silver crying maiden head pommel, concealed razor-sharp hollow-ground blued steel rapier blade, isolated on solid white background.",
    },
    {
        "id": "prop_tilly_clinker_tongs",
        "name": "Cast-Iron Sump Clinker-Tongs",
        "character": "Tilly Furnace-Tongs",
        "category": "weapon",
        "slot": "weapon_socket",
        "poly_budget": 25000,
        "scale_dimensions_cm": {"width": 16.0, "height": 72.0, "depth": 10.0},
        "alpha_file": "public/tex/props/flux3_tilly_tongs_alpha.png",
        "turnaround_file": "public/tex/props/h3_tilly_tongs_turnaround.png",
        "turntable_file": "public/tex/props/h3_tilly_tongs_turntable.webp",
        "glb_file": "public/models/props/prop_tilly_clinker_tongs.glb",
        "build_cmd": "node scripts/build_prop_tilly_clinker_tongs.mjs",
        "prompt": "Heavy industrial boiler furnace clinker tongs, pitted blackened cast iron, double scissor pivot joint, clawed serrated clamping jaws, heat-wrapped asbestos grip, glowing coal ember flecks, isolated on solid white background.",
    },
    {
        "id": "prop_sluice_flatcap",
        "name": "Waterlogged Tweed Flatcap",
        "character": "Nell Sluice",
        "category": "headgear",
        "slot": "head_socket",
        "poly_budget": 20000,
        "scale_dimensions_cm": {"width": 24.0, "height": 14.0, "depth": 27.0},
        "alpha_file": "public/tex/props/flux3_sluice_flatcap_alpha.png",
        "turnaround_file": "public/tex/props/h3_sluice_flatcap_turnaround.png",
        "turntable_file": "public/tex/props/h3_sluice_flatcap_turntable.webp",
        "glb_file": "public/models/props/prop_sluice_flatcap.glb",
        "build_cmd": "node scripts/build_prop_sluice_flatcap.mjs",
        "prompt": "Authentic waterlogged Victorian street mudlark tweed flatcap, coarse herringbone wool, stiff curved peak brim, tarnished copper wire brim repair, oilcloth lining, isolated on solid white background.",
    },
    {
        "id": "prop_kilnworth_nursecap",
        "name": "Starched Field-Nurse Cap",
        "character": "Matron Prudence Kilnworth",
        "category": "headgear",
        "slot": "head_socket",
        "poly_budget": 20000,
        "scale_dimensions_cm": {"width": 22.0, "height": 18.0, "depth": 20.0},
        "alpha_file": "public/tex/props/flux3_kilnworth_nursecap_alpha.png",
        "turnaround_file": "public/tex/props/h3_kilnworth_nursecap_turnaround.png",
        "turntable_file": "public/tex/props/h3_kilnworth_nursecap_turntable.webp",
        "glb_file": "public/models/props/prop_kilnworth_nursecap.glb",
        "build_cmd": "node scripts/build_prop_kilnworth_nursecap.mjs",
        "prompt": "Severe Victorian starched white linen field nurse head bonnet cap, folded triangular crown, crimson embroidered Geneva cross emblem, bone sewing pins, clean stiff folds, isolated on solid white background.",
    },
    {
        "id": "prop_mule_championship_belt",
        "name": "Engraved Gilt Championship Belt",
        "character": "The Great Bartholomew Mule",
        "category": "gear",
        "slot": "torso_socket",
        "poly_budget": 25000,
        "scale_dimensions_cm": {"width": 38.0, "height": 22.0, "depth": 32.0},
        "alpha_file": "public/tex/props/flux3_mule_belt_alpha.png",
        "turnaround_file": "public/tex/props/h3_mule_belt_turnaround.png",
        "turntable_file": "public/tex/props/h3_mule_belt_turntable.webp",
        "glb_file": "public/models/props/prop_mule_championship_belt.glb",
        "build_cmd": "node scripts/build_prop_mule_championship_belt.mjs",
        "prompt": "Massive Victorian bare-knuckle prize fighting championship belt, heavy oval embossed gold plate engraved with fighting bears and floral filigree, thick studded oxblood leather strap, brass buckles, isolated on solid white background.",
    },
    {
        "id": "prop_rook_souwester",
        "name": "Foul-Weather Oilskin Sou'wester",
        "character": "Bosun Absalom Rook",
        "category": "headgear",
        "slot": "head_socket",
        "poly_budget": 20000,
        "scale_dimensions_cm": {"width": 28.0, "height": 22.0, "depth": 34.0},
        "alpha_file": "public/tex/props/flux3_rook_souwester_alpha.png",
        "turnaround_file": "public/tex/props/h3_rook_souwester_turnaround.png",
        "turntable_file": "public/tex/props/h3_rook_souwester_turntable.webp",
        "glb_file": "public/models/props/prop_rook_souwester.glb",
        "build_cmd": "node scripts/build_prop_rook_souwester.mjs",
        "prompt": "Traditional 19th-century heavy tarpaulin oilskin sailor sou'wester hat, deep rear neck flap, upturned front brim, brass chin strap eyelets, salty sea-weathered patina, isolated on solid white background.",
    },
    {
        "id": "prop_bulwark_pistons",
        "name": "Hydraulic Arm Rams & Gauges",
        "character": "Lady Hester Bulwark",
        "category": "gear",
        "slot": "arm_sockets",
        "poly_budget": 28000,
        "scale_dimensions_cm": {"width": 20.0, "height": 38.0, "depth": 18.0},
        "alpha_file": "public/tex/props/flux3_bulwark_pistons_alpha.png",
        "turnaround_file": "public/tex/props/h3_bulwark_pistons_turnaround.png",
        "turntable_file": "public/tex/props/h3_bulwark_pistons_turntable.webp",
        "glb_file": "public/models/props/prop_bulwark_pistons.glb",
        "build_cmd": "node scripts/build_prop_bulwark_pistons.mjs",
        "prompt": "Victorian steampunk hydraulic forearm bracers, polished blued steel hydraulic rams, braided red rubber pressure hoses, miniature circular brass pressure gauge with needle, filigree mounting cuffs, isolated on solid white background.",
    },
    {
        "id": "prop_crump_samovar",
        "name": "Brass Tea Samovar Steam Boiler",
        "character": "Percival Oolong Crump",
        "category": "gear",
        "slot": "torso_socket",
        "poly_budget": 28000,
        "scale_dimensions_cm": {"width": 26.0, "height": 42.0, "depth": 22.0},
        "alpha_file": "public/tex/props/flux3_crump_samovar_alpha.png",
        "turnaround_file": "public/tex/props/h3_crump_samovar_turnaround.png",
        "turntable_file": "public/tex/props/h3_crump_samovar_turntable.webp",
        "glb_file": "public/models/props/prop_crump_samovar.glb",
        "build_cmd": "node scripts/build_prop_crump_samovar.mjs",
        "prompt": "Miniature Victorian brass Russian tea samovar back-boiler harness, polished copper urn boiler, twin brass spigots, steam safety whistle valve, leather shoulder straps, isolated on solid white background.",
    },

    # ---- Wave 2: Gallery Throws & Melee Weapons (Issue #28) ----
    {
        "id": "weapon_knuckleduster",
        "name": "Brass Knuckleduster",
        "character": "the Gallery",
        "category": "weapon",
        "slot": "hand_socket",
        "poly_budget": 15000,
        "scale_dimensions_cm": {"width": 12.0, "height": 8.0, "depth": 3.0},
        "alpha_file": "public/tex/props/flux3_knuckleduster_alpha.png",
        "turnaround_file": "public/tex/props/h3_knuckleduster_turnaround.png",
        "turntable_file": "public/tex/props/h3_knuckleduster_turntable.webp",
        "glb_file": "public/models/props/weapon_knuckleduster.glb",
        "build_cmd": "node scripts/build_weapon_knuckleduster.mjs",
        "prompt": "Heavy Victorian solid brass knuckleduster, four oval finger loops, curved palm grip engraved with coat of arms crest, polished brass with dark patina in grooves, isolated on white background.",
    },
    {
        "id": "weapon_coal_shovel",
        "name": "Stoker's Shovel",
        "character": "the Gallery",
        "category": "weapon",
        "slot": "hand_socket",
        "poly_budget": 20000,
        "scale_dimensions_cm": {"width": 24.0, "height": 98.0, "depth": 14.0},
        "alpha_file": "public/tex/props/flux3_coal_shovel_alpha.png",
        "turnaround_file": "public/tex/props/h3_coal_shovel_turnaround.png",
        "turntable_file": "public/tex/props/h3_coal_shovel_turntable.webp",
        "glb_file": "public/models/props/weapon_coal_shovel.glb",
        "build_cmd": "node scripts/build_weapon_coal_shovel.mjs",
        "prompt": "Long-handled heavy forged iron coal shovel, wide scoop blade worn sharp along lip, ash wood D-grip handle, heat-darkened metal with glowing coal dust flecks, isolated on white background.",
    },
    {
        "id": "weapon_bone_saw",
        "name": "Surgeon's Bone Saw",
        "character": "the Gallery",
        "category": "weapon",
        "slot": "hand_socket",
        "poly_budget": 18000,
        "scale_dimensions_cm": {"width": 6.0, "height": 38.0, "depth": 3.0},
        "alpha_file": "public/tex/props/flux3_bone_saw_alpha.png",
        "turnaround_file": "public/tex/props/h3_bone_saw_turnaround.png",
        "turntable_file": "public/tex/props/h3_bone_saw_turntable.webp",
        "glb_file": "public/models/props/weapon_bone_saw.glb",
        "build_cmd": "node scripts/build_weapon_bone_saw.mjs",
        "prompt": "19th-century amputation bone saw, polished carved ivory pistol grip handle, nickel-plated steel frame, fine serrated cross-cut surgical blade, isolated on solid white background.",
    },
    {
        "id": "weapon_nail_bat",
        "name": "Studded Cricket Bat",
        "character": "the Gallery",
        "category": "weapon",
        "slot": "hand_socket",
        "poly_budget": 20000,
        "scale_dimensions_cm": {"width": 11.0, "height": 86.0, "depth": 8.0},
        "alpha_file": "public/tex/props/flux3_nail_bat_alpha.png",
        "turnaround_file": "public/tex/props/h3_nail_bat_turnaround.png",
        "turntable_file": "public/tex/props/h3_nail_bat_turntable.webp",
        "glb_file": "public/models/props/weapon_nail_bat.glb",
        "build_cmd": "node scripts/build_weapon_nail_bat.mjs",
        "prompt": "Traditional English willow cricket bat driven through with rusty square iron horseshoe nails, cane handle wrapped in black cord, oiled wood grain, isolated on solid white background.",
    },
    {
        "id": "weapon_cleaver",
        "name": "Butcher's Cleaver",
        "character": "the Gallery",
        "category": "weapon",
        "slot": "hand_socket",
        "poly_budget": 16000,
        "scale_dimensions_cm": {"width": 14.0, "height": 36.0, "depth": 4.0},
        "alpha_file": "public/tex/props/flux3_cleaver_alpha.png",
        "turnaround_file": "public/tex/props/h3_cleaver_turnaround.png",
        "turntable_file": "public/tex/props/h3_cleaver_turntable.webp",
        "glb_file": "public/models/props/weapon_cleaver.glb",
        "build_cmd": "node scripts/build_weapon_cleaver.mjs",
        "prompt": "Heavy Victorian meat meat cleaver from Smithfield meat market, rectangular carbon steel blade with round hanging hole, brass-pinned walnut scales handle, isolated on solid white background.",
    },
    {
        "id": "weapon_piston_gauntlet",
        "name": "Piston Gauntlet",
        "character": "the Gallery",
        "category": "weapon",
        "slot": "hand_socket",
        "poly_budget": 25000,
        "scale_dimensions_cm": {"width": 18.0, "height": 42.0, "depth": 16.0},
        "alpha_file": "public/tex/props/flux3_piston_gauntlet_alpha.png",
        "turnaround_file": "public/tex/props/h3_piston_gauntlet_turnaround.png",
        "turntable_file": "public/tex/props/h3_piston_gauntlet_turntable.webp",
        "glb_file": "public/models/props/weapon_piston_gauntlet.glb",
        "build_cmd": "node scripts/build_weapon_piston_gauntlet.mjs",
        "prompt": "Heavy steampunk steam gauntlet with spring-loaded steel ram over knuckles, miniature forearm boiler canister, brass exhaust pressure ports, leather strapping, isolated on solid white background.",
    },
    {
        "id": "weapon_lamplighter_pole",
        "name": "Lamplighter's Pole",
        "character": "the Gallery",
        "category": "weapon",
        "slot": "hand_socket",
        "poly_budget": 20000,
        "scale_dimensions_cm": {"width": 10.0, "height": 180.0, "depth": 10.0},
        "alpha_file": "public/tex/props/flux3_lamplighter_pole_alpha.png",
        "turnaround_file": "public/tex/props/h3_lamplighter_pole_turnaround.png",
        "turntable_file": "public/tex/props/h3_lamplighter_pole_turntable.webp",
        "glb_file": "public/models/props/weapon_lamplighter_pole.glb",
        "build_cmd": "node scripts/build_weapon_lamplighter_pole.mjs",
        "prompt": "Long brass-tipped Victorian street lamplighter pole, curved gas-cock shutoff hook at tip, brass oil lamp wick canister, dark ash wood shaft, isolated on solid white background.",
    },
    {
        "id": "weapon_chair",
        "name": "Private Box Chair",
        "character": "the Gallery",
        "category": "weapon",
        "slot": "hand_socket",
        "poly_budget": 25000,
        "scale_dimensions_cm": {"width": 46.0, "height": 88.0, "depth": 48.0},
        "alpha_file": "public/tex/props/flux3_chair_alpha.png",
        "turnaround_file": "public/tex/props/h3_chair_turnaround.png",
        "turntable_file": "public/tex/props/h3_chair_turntable.webp",
        "glb_file": "public/models/props/weapon_chair.glb",
        "build_cmd": "node scripts/build_weapon_chair.mjs",
        "prompt": "Ornate Victorian theatre private box salon chair, carved gilt gold leaf rococo wood frame, tufted crimson velvet upholstery seat and padded oval back, isolated on solid white background.",
    },
    {
        "id": "pickup_tonic",
        "name": "Bottle of Tincture",
        "character": "the Gallery",
        "category": "pickup",
        "slot": "hand_socket",
        "poly_budget": 12000,
        "scale_dimensions_cm": {"width": 7.0, "height": 18.0, "depth": 7.0},
        "alpha_file": "public/tex/props/flux3_tonic_alpha.png",
        "turnaround_file": "public/tex/props/h3_tonic_turnaround.png",
        "turntable_file": "public/tex/props/h3_tonic_turntable.webp",
        "glb_file": "public/models/props/pickup_tonic.glb",
        "build_cmd": "node scripts/build_pickup_tonic.mjs",
        "prompt": "Victorian apothecary elixir bottle, ribbed emerald green glass, wax-sealed cork stopper, stained paper prescription label with engraved apothecary crest, glowing amber fluid inside, isolated on white background.",
    },
]

# ---------------------------------------------------------------------------
# State Management (Atomic & Resumable)
# ---------------------------------------------------------------------------

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
            log(f"Loaded existing state from {STATE_FILE} ({len(state.get('items', []))} tracked items)")
            return state
        except Exception as e:
            log(f"Warning: Corrupt state file ({e}), backing up and creating fresh queue.")
            shutil.copyfile(STATE_FILE, STATE_FILE + f".corrupt.{int(time.time())}")

    # Initialize fresh state
    state = {
        "version": "1.0.0",
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "active_id": None,
        "items": []
    }
    for item in DEFAULT_QUEUE:
        state["items"].append({
            **item,
            "stages": {
                "stage_1_alpha": {"status": "pending", "output": item["alpha_file"]},
                "stage_2_turnaround": {"status": "pending", "output": item["turnaround_file"]},
                "stage_3_glb": {"status": "pending", "output": item["glb_file"]},
                "stage_4_validate": {"status": "pending", "output": f"docs/props/{item['id']}/report.json"},
            }
        })
    save_state(state)
    return state

def save_state(state):
    state["updated_at"] = datetime.now().isoformat()
    tmp_path = STATE_FILE + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp_path, STATE_FILE)

# ---------------------------------------------------------------------------
# ComfyUI Self-Healing & Queue Handling
# ---------------------------------------------------------------------------

def check_comfyui_alive():
    try:
        req = urllib.request.Request(f"{COMFY_HOST}/system_stats")
        res = urllib.request.urlopen(req, timeout=3)
        data = json.loads(res.read())
        return data.get("system", {}).get("os") is not None
    except Exception:
        return False

def ensure_comfyui():
    if check_comfyui_alive():
        return True
    log("ComfyUI server is down! Auto-starting ComfyUI daemon on port 8188...")
    cmd = [
        COMFY_PYTHON, "-s", COMFY_MAIN,
        "--windows-standalone-build",
        "--enable-dynamic-vram",
        "--cuda-device", "1",
        "--port", "8188"
    ]
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # Poll for startup
    for _ in range(30):
        time.sleep(2)
        if check_comfyui_alive():
            log("ComfyUI successfully initialized on port 8188.")
            return True
    raise RuntimeError("Failed to auto-start ComfyUI within 60 seconds.")

# ---------------------------------------------------------------------------
# Pipeline Execution Engine
# ---------------------------------------------------------------------------

def run_stage_1_alpha(item):
    """Generate 2D concept & watertight alpha cutout if not already present."""
    alpha_path = os.path.join(ROOT, item["alpha_file"])
    if os.path.exists(alpha_path) and os.path.getsize(alpha_path) > 10000:
        log(f"  [Stage 1 Alpha] Already exists: {item['alpha_file']} ({os.path.getsize(alpha_path)} bytes)")
        return True

    # Check for raw generated image candidates
    raw_candidates = [
        os.path.join(ROOT, "public", "tex", "props", f"flux3_{item['id']}_00001_.png"),
        os.path.join(ROOT, "public", "tex", "props", f"flux3_prop_{item['id']}_00001_.png"),
        os.path.join(ROOT, "public", "tex", "props", f"flux3_prop_{item['id'].replace('prop_', '')}_00001_.png"),
        os.path.join(ROOT, "public", "tex", "props", f"flux3_weapon_{item['id'].replace('weapon_', '')}_00001_.png"),
        os.path.join(ROOT, "public", "tex", "props", f"flux3_pickup_{item['id'].replace('pickup_', '')}_00001_.png"),
    ]
    raw_img = next((f for f in raw_candidates if os.path.exists(f) and os.path.getsize(f) > 10000), None)

    if not raw_img:
        ensure_comfyui()
        log(f"  [Stage 1 Alpha] Generating {item['id']} via FLUX 3 on RX 9070 XT...")
        script = os.path.join(ROOT, ".agents", "skills", "character-3d-pipeline", "scripts", "generate_character_flux3.py")
        if os.path.exists(script):
            cmd = [sys.executable, script, item["prompt"], item["id"], os.path.join(ROOT, "public", "tex", "props")]
            subprocess.run(cmd, check=True)
            raw_img = next((f for f in raw_candidates if os.path.exists(f) and os.path.getsize(f) > 10000), None)

    if raw_img and (not os.path.exists(alpha_path) or os.path.getsize(alpha_path) < 10000):
        log(f"  [Stage 1 Alpha] Running rembg background isolation on {raw_img} -> {alpha_path}...")
        rembg_cmd = ["uvx", "--from", "rembg[cpu,cli]", "rembg", "i", "--model", "bria-rmbg", raw_img, alpha_path]
        subprocess.run(rembg_cmd, check=True)

    return os.path.exists(alpha_path)

def run_stage_2_turnaround(item):
    """Generate MiniMax H3 4-view orthographic turnaround and turntable webp."""
    turnaround_path = os.path.join(ROOT, item["turnaround_file"])
    turntable_path = os.path.join(ROOT, item["turntable_file"])
    if os.path.exists(turnaround_path) and os.path.exists(turntable_path):
        log(f"  [Stage 2 Turnaround] Already exists: {item['turnaround_file']}")
        return True

    alpha_path = os.path.join(ROOT, item["alpha_file"])
    if not os.path.exists(alpha_path):
        raise FileNotFoundError(f"Missing Stage 1 alpha: {alpha_path}")

    ensure_comfyui()
    log(f"  [Stage 2 Turnaround] Generating MiniMax H3 turntable for {item['id']}...")
    h3_script = os.path.join(ROOT, "scripts", "run_minimax_h3_turnaround.py")
    cmd = [sys.executable, h3_script, alpha_path, turnaround_path]
    subprocess.run(cmd, check=True)
    return os.path.exists(turnaround_path)

def run_stage_3_glb(item):
    """Generate production 3D binary GLB mesh."""
    glb_path = os.path.join(ROOT, item["glb_file"])
    if os.path.exists(glb_path) and os.path.getsize(glb_path) > 10000:
        log(f"  [Stage 3 GLB] Already exists: {item['glb_file']} ({os.path.getsize(glb_path)} bytes)")
        return True

    log(f"  [Stage 3 GLB] Building {item['id']}.glb...")
    build_cmd = item.get("build_cmd")
    if build_cmd:
        res = subprocess.run(build_cmd, shell=True, cwd=ROOT)
        if res.returncode != 0:
            raise RuntimeError(f"Build command failed with code {res.returncode}: {build_cmd}")
    return os.path.exists(glb_path)

def run_stage_4_validate(item):
    """Execute headless Chrome validation and report generation."""
    report_path = os.path.join(ROOT, f"docs/props/{item['id']}/report.json")
    if os.path.exists(report_path):
        log(f"  [Stage 4 Validate] Already validated: {report_path}")
        return True

    log(f"  [Stage 4 Validate] Running headless verification on {item['id']}...")
    validate_cmd = f"node scripts/capture_prop_renders.mjs {item['id']}"
    res = subprocess.run(validate_cmd, shell=True, cwd=ROOT)
    
    # Copy from test-output to docs
    test_out = os.path.join(ROOT, "test-output", "props", item["id"])
    docs_out = os.path.join(ROOT, "docs", "props", item["id"])
    if os.path.exists(test_out):
        os.makedirs(docs_out, exist_ok=True)
        for f in os.listdir(test_out):
            shutil.copyfile(os.path.join(test_out, f), os.path.join(docs_out, f))
        log(f"  [Stage 4 Validate] Published verification renders to {docs_out}")
    return res.returncode == 0

# ---------------------------------------------------------------------------
# Main Orchestrator Loop
# ---------------------------------------------------------------------------

def process_queue():
    state = load_state()
    total = len(state["items"])
    log(f"Starting execution of {total} queue items (resumable mode active)...")

    for idx, item in enumerate(state["items"]):
        item_id = item["id"]
        stages = item["stages"]
        log(f"\n=======================================================")
        log(f"[{idx + 1}/{total}] Processing: {item['name']} ({item_id})")
        log(f"=======================================================")
        state["active_id"] = item_id
        save_state(state)

        # Stage 1: Alpha Cutout
        if stages["stage_1_alpha"]["status"] != "completed":
            stages["stage_1_alpha"]["status"] = "running"
            save_state(state)
            try:
                run_stage_1_alpha(item)
                stages["stage_1_alpha"]["status"] = "completed"
                stages["stage_1_alpha"]["completed_at"] = datetime.now().isoformat()
                save_state(state)
            except Exception as e:
                stages["stage_1_alpha"]["status"] = "failed"
                stages["stage_1_alpha"]["error"] = str(e)
                save_state(state)
                log(f"ERROR in Stage 1 for {item_id}: {e}")
                continue

        # Stage 2: MiniMax H3 Turnaround
        if stages["stage_2_turnaround"]["status"] != "completed":
            stages["stage_2_turnaround"]["status"] = "running"
            save_state(state)
            try:
                run_stage_2_turnaround(item)
                stages["stage_2_turnaround"]["status"] = "completed"
                stages["stage_2_turnaround"]["completed_at"] = datetime.now().isoformat()
                save_state(state)
            except Exception as e:
                stages["stage_2_turnaround"]["status"] = "failed"
                stages["stage_2_turnaround"]["error"] = str(e)
                save_state(state)
                log(f"ERROR in Stage 2 for {item_id}: {e}")
                continue

        # Stage 3: 3D GLB Synthesis
        if stages["stage_3_glb"]["status"] != "completed":
            stages["stage_3_glb"]["status"] = "running"
            save_state(state)
            try:
                run_stage_3_glb(item)
                stages["stage_3_glb"]["status"] = "completed"
                stages["stage_3_glb"]["completed_at"] = datetime.now().isoformat()
                save_state(state)
            except Exception as e:
                stages["stage_3_glb"]["status"] = "failed"
                stages["stage_3_glb"]["error"] = str(e)
                save_state(state)
                log(f"ERROR in Stage 3 for {item_id}: {e}")
                continue

        # Stage 4: Headless Validation
        if stages["stage_4_validate"]["status"] != "completed":
            stages["stage_4_validate"]["status"] = "running"
            save_state(state)
            try:
                run_stage_4_validate(item)
                stages["stage_4_validate"]["status"] = "completed"
                stages["stage_4_validate"]["completed_at"] = datetime.now().isoformat()
                save_state(state)
            except Exception as e:
                stages["stage_4_validate"]["status"] = "failed"
                stages["stage_4_validate"]["error"] = str(e)
                save_state(state)
                log(f"ERROR in Stage 4 for {item_id}: {e}")
                continue

        log(f"COMPLETED ALL 4 STAGES for: {item_id}")

    log("\nMaster 3D Asset Batch Pipeline Run Finished!")

if __name__ == "__main__":
    process_queue()
