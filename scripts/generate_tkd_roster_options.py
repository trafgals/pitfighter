import urllib.request
import json
import time
import os
import shutil

COMFY_HOST = "http://127.0.0.1:8188"
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"
OUTPUT_DIR = "public/tex/characters/tkd_options"

OPTIONS = [
    # 1. The Steeplejack
    {
        "id": "tkd_1a_steeplejack_male",
        "title": "Option 1A: The Steeplejack (Male) — Barnaby Callow",
        "seed": 2041,
        "prompt": (
            "Full-length action portrait of a Victorian church steeplejack pitfighter, athletic wiry male, 26 years old, "
            "leaping in mid-air executing a dynamic Tae Kwon Do flying side kick between rain-slicked church spires above Victorian London. "
            "Both legs below the knee are crafted from high-tensile spring-steel railway leaf springs, ratcheted brass calipers, and forged climbing crampons. "
            "Wearing an oiled canvas climbing smock, knotted hemp safety ropes, heavy leather climbing braces, and a battered rigger's flat cap with brass goggles pushed up. "
            "Windswept ginger hair, confident grin, dramatic rooftop vertigo atmosphere, gritty Victorian steampunk photorealism, volumetric fog and chimney smoke."
        )
    },
    {
        "id": "tkd_1b_steeplejack_female",
        "title": "Option 1B: The Steeplejack (Female) — Bridget Callow",
        "seed": 2042,
        "prompt": (
            "Full-length action portrait of a Victorian church steeplejack pitfighter, athletic agile female, 24 years old, "
            "perched in an acrobatic Tae Kwon Do high chamber kick stance on the narrow parapet of a gothic cathedral overlooking foggy London. "
            "Both legs below the knee are forged from high-tensile leaf-spring steel, brass climbing calipers, and spiked iron mountaineering spurs. "
            "Wearing a tailored oiled leather climbing coat, leather tool belt with carabiners, chalk pouch, and a weather-worn baker boy cap. "
            "Windswept auburn braid, fierce daring expression, misty rain, dramatic church spire vertigo, gritty Victorian steampunk photorealism."
        )
    },

    # 2. The Cobbler's Automaton
    {
        "id": "tkd_2a_cobbler_male",
        "title": "Option 2A: The Cobbler's Automaton (Male) — Master Thaddeus Pegg",
        "seed": 2043,
        "prompt": (
            "Full-length portrait of an eccentric Victorian East End bootmaker pitfighter, craggy male, 58 years old, "
            "poised in a sharp Tae Kwon Do kicking stance in a cobblestone workshop alley. "
            "Both legs are heavy solid cast-iron cobbler shoe-lasts with brass sizing dials, measuring calipers, and massive triple-soled steel-toed brogues with rotary spur-wheels. "
            "Wearing a thick oiled cowhide cobbler apron stuffed with awls and shoemaker tacks, rolled shirtsleeves, horn-rimmed magnifying spectacles, and a folded paper trade cap. "
            "Grumpy squint, soot-stained cheeks, industrial leathercraft aesthetic, gritty Victorian steampunk photorealism, sharp mechanical details."
        )
    },
    {
        "id": "tkd_2b_cobbler_female",
        "title": "Option 2B: The Cobbler's Automaton (Female) — Mistress Tabitha Pegg",
        "seed": 2044,
        "prompt": (
            "Full-length portrait of a fierce Victorian master cordwainer pitfighter, stern sharp-eyed female, 50 years old, "
            "standing in a powerful Tae Kwon Do chambered front-kick stance in a rain-slicked Victorian alleyway. "
            "Both legs from the knee down are cast-iron boot-makers lasts with engraved brass measuring rules, awl brackets, and polished heavy steel-capped oxfords. "
            "Wearing a heavy studded leather cordwainer apron over a dark woolen dress, leather arm bracers, spectacles on a brass chain, hair pinned in a tight severe bun. "
            "Stern perfectionist scowl, gritty Victorian steampunk photorealism, sparks flying from heel studs, dramatic low-angle composition."
        )
    },

    # 3. The Gasometer Stilt-Walker
    {
        "id": "tkd_3a_stiltman_male",
        "title": "Option 3A: The Gasometer Stilt-Man (Male) — Ignatius Finch",
        "seed": 2045,
        "prompt": (
            "Full-length action portrait of an eerie tall Victorian gas lamp-lighter pitfighter, gaunt scarecrow-like male, 42 years old, "
            "striding through flooded London streets executing a massive sweeping Tae Kwon Do crescent kick above the gas lamps. "
            "His legs are supernaturally long 7-foot telescoping brass and cast-iron stilts wrapped in tarred canvas, with brass pendulum counter-weights at the knees and roaring gas igniter flame jets at the heels. "
            "Wearing a ragged tattered black greatcoat billowing like crow wings, brass lamp-lighting pole in one hand, tall battered stovepipe hat with torch bracket. "
            "Haunting amber gaslight glow, fiery orange arc trail from the heel jet in the rain, gritty Victorian steampunk photorealism."
        )
    },
    {
        "id": "tkd_3b_stiltwoman_female",
        "title": "Option 3B: The Gasometer Stilt-Walker (Female) — Constance Finch",
        "seed": 2046,
        "prompt": (
            "Full-length action portrait of a tall Victorian gasometer knocker-up and sluice wader pitfighter, lean imposing female, 36 years old, "
            "standing high above the canal in a soaring Tae Kwon Do axe-kick posture on 7-foot articulated brass and iron telescoping stilts. "
            "Her stilt legs feature heavy brass counter-weights, pressure gauges, and fiery blue-and-yellow gas jet burners at the heels. "
            "Wearing a hooded oilskin duster coat cinched with a wide brass belt, gasmask goggles around her throat, and a high-crowned bowler hat. "
            "Piercing eyes, eerie silhouette against foggy Victorian gas tanks, dramatic lighting, gritty steampunk photorealism."
        )
    },

    # 4. The Shipyard Rivet-Runner
    {
        "id": "tkd_4a_rivetrunner_male",
        "title": "Option 4A: The Shipyard Rivet-Runner (Male) — Mickey O'Rourke",
        "seed": 2047,
        "prompt": (
            "Full-length action portrait of a scrappy young Victorian shipyard runner pitfighter, muscular athletic male, 20 years old, "
            "executing an explosive flying Tae Kwon Do jump-spin kick on the iron deck of a dry-docked warship. "
            "Both legs from the knee down are exposed blued-steel pneumatic steam pistons with braided copper pressure hoses, venting sharp white steam clouds from exhaust valves. "
            "Wearing a grimy sleeveless boiler-worker henley, heavy leather braces, grease-smeared face, and a woolen docker newsboy cap cocked over one eye. "
            "Cocky reckless grin, steam plumes, glowing shipyard furnaces in the background, gritty Victorian industrial photorealism."
        )
    },
    {
        "id": "tkd_4b_rivetrunner_female",
        "title": "Option 4B: The Shipyard Rivet-Runner (Female) — Molly O'Rourke",
        "seed": 2048,
        "prompt": (
            "Full-length action portrait of a fearless Victorian shipyard boiler-room runner pitfighter, athletic muscular female, 21 years old, "
            "delivering a lightning-fast Tae Kwon Do spinning hook kick across a metal gangway. "
            "Both legs are dual-action pneumatic steam rams with brass pressure valves, copper steam lines, and knurled steel boiler-plate boots. "
            "Wearing grease-stained work dungarees rolled at the calves, striped cotton shirt, leather welding gloves, and a red bandanna tied over dark curls. "
            "Fierce spirited smile, plumes of hissing white steam, rain pouring over dark iron shipyard cranes, cinematic industrial photorealism."
        )
    },

    # 5. The Music Hall Aerialist
    {
        "id": "tkd_5a_aerialist_male",
        "title": "Option 5A: The Music Hall Aerialist (Male) — Peregrine Skite",
        "seed": 2049,
        "prompt": (
            "Full-length action portrait of a flamboyant Victorian music hall acrobatic trickster pitfighter, slender male, 28 years old, "
            "executing an inverted handstand Tae Kwon Do helicopter kick on a velvet-draped theater stage. "
            "His legs are intricate polished brass clockwork assemblies with spinning internal gyroscopic flywheels, coiled spiral springs, and chime bells at the ankles. "
            "Wearing a faded plum velvet theatrical coat with gold braided frogging, mismatched striped silk hose, and a feathered tricorne hat tilted cockily. "
            "Theatrical painted smile, cynical theatrical charm, footlight glare, brass reflections, gritty Victorian steampunk theater aesthetic."
        )
    },
    {
        "id": "tkd_5b_aerialist_female",
        "title": "Option 5B: The Music Hall Aerialist (Female) — Peggy Skite",
        "seed": 2050,
        "prompt": (
            "Full-length action portrait of an eccentric Victorian carnival tumbler and contortionist pitfighter, lithe athletic female, 25 years old, "
            "mid-spin executing a breathtaking Tae Kwon Do 540-degree wheel kick under a circus tent. "
            "Both legs are articulated polished brass clockwork gyro-legs with visible whirring escapements, spiral balance springs, and ornate filigree ankle bells. "
            "Wearing a gold-embroidered harlequin velvet bodice, shredded silk acrobatic shorts, and a small velvet jester cap with brass bells. "
            "Mischievous mocking wink, blurred spinning motion, sawdust and rain under lantern light, dramatic Victorian steampunk photorealism."
        )
    }
]

def generate_option(opt):
    print(f"\n[FLUX3] Generating: {opt['title']}...")
    workflow = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux3-image-klein-int8-convrot.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_4b_int8_convrot.safetensors", "type": "flux3", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": opt["prompt"]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": "blurry, low quality, cartoon, modern sneakers, digital 3d render"}},
        "6": {"class_type": "ModelSamplingFlux", "inputs": {"model": ["1", 0], "max_shift": 1.15, "base_shift": 0.5, "width": 896, "height": 1152}},
        "7": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 896, "height": 1152, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["6", 0], "positive": ["4", 0], "negative": ["5", 0], "latent_image": ["7", 0], "seed": opt["seed"], "steps": 20, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": f"flux3_{opt['id']}"}}
    }

    req = urllib.request.Request(
        f"{COMFY_HOST}/prompt",
        data=json.dumps({"prompt": workflow}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    res = urllib.request.urlopen(req)
    prompt_id = json.loads(res.read()).get("prompt_id")
    print(f"  - Queued: {prompt_id}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    target_path = os.path.join(OUTPUT_DIR, f"{opt['id']}.png")

    while True:
        time.sleep(2)
        h_res = urllib.request.urlopen(f"{COMFY_HOST}/history/{prompt_id}")
        h_data = json.loads(h_res.read())
        if prompt_id in h_data:
            entry = h_data[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI error on {opt['id']}: {status.get('messages')}")
            outputs = entry.get("outputs", {})
            if "10" in outputs:
                filename = outputs["10"]["images"][0]["filename"]
                src = os.path.join(COMFY_OUTPUT, filename)
                shutil.copyfile(src, target_path)
                print(f"  - Saved to {target_path} ({os.path.getsize(target_path)} bytes)")
                return target_path

if __name__ == "__main__":
    print(f"Starting batch generation of {len(OPTIONS)} Tae Kwon Do archetype options...")
    t0 = time.time()
    for opt in OPTIONS:
        generate_option(opt)
    print(f"\n[ALL COMPLETE] Finished {len(OPTIONS)} character options in {time.time() - t0:.1f}s!")
