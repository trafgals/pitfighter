import urllib.request
import json
import time
import os
import shutil

COMFY_HOST = "http://127.0.0.1:8188"
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"
OUTPUT_DIR = "public/tex/characters/amateur_reimagined"

OPTIONS = [
    # 1. The Rogue Taxidermist
    {
        "id": "amateur_1a_taxidermist_male",
        "title": "Concept 1A: The Rogue Taxidermist (Male) — Barnaby Gallowglass",
        "seed": 4001,
        "prompt": (
            "Full-length action portrait of an eccentric Victorian rogue taxidermist pitfighter, nervous lanky male, 29 years old, "
            "crouching in an unhinged feral combat stance in a dimly lit Victorian natural history workshop. "
            "Both arms and legs are cobbled from preserved museum animal armatures: Left arm a taxidermy brown bear claw with wire-strung sinews, "
            "Right arm a badger-jaw knuckle bracket with brass glass eye studs, legs bound in leather-wrapped deer hock splints. "
            "Wearing a stained oilcloth taxidermy apron over a moth-eaten waistcoat, dissecting tweezers and curved bone needles stuck in lapel, round brass magnifying spectacles. "
            "Terrified yet dangerous expression, jars of pickled specimens and mounted skulls on shelves, feathers flying in air, gritty Victorian steampunk photorealism."
        )
    },
    {
        "id": "amateur_1b_taxidermist_female",
        "title": "Concept 1B: The Rogue Taxidermist (Female) — Morag Gallowglass",
        "seed": 4002,
        "prompt": (
            "Full-length action portrait of an intense Victorian natural history preparator and feral amateur pitfighter, wiry fierce female, 27 years old, "
            "lunging forward in an erratic predatory pounce in an East End curiosity shop. "
            "Both arms and legs are stitched rogue-taxidermy beast grafts: articulated grey wolf jaw gauntlets on her forearms, claws bound with copper wire and dried sinew tension cords, "
            "legs reinforced with carved horn splints and badger fur spats. "
            "Wearing a heavy waxed leather specimen apron over a dark woolen dress, leather utility bandolier with specimen jars, wild windblown hair. "
            "Fierce feral glare, jars of formaldehyde catching amber gaslight, gritty Victorian steampunk photorealism."
        )
    },

    # 2. The Sump Furnace Stoker
    {
        "id": "amateur_2a_stoker_male",
        "title": "Concept 2A: The Sump Furnace Stoker (Male) — Tam 'Cinder-Spit'",
        "seed": 4003,
        "prompt": (
            "Full-length action portrait of a scrappy Victorian coal stoker street brawler, wiry tough male youth, 17 years old, "
            "winding up a wild desperate haymaker in a subterranean ironworks boiler room. "
            "Both arms are wrapped in scorched asbestos pipe-lagging with glowing copper steam-pipes and heavy cast-iron boiler-tongs gripped in hand, "
            "shins protected by riveted sheet-iron stovepipe plates. "
            "Wearing a grease-stained sleeveless stoker undershirt, soot-blackened leather braces, heavy dock boots, and an iron stoker cap tilted back. "
            "Smirking cockney defiance, spitting coal sparks, roaring furnace glow casting fiery orange rim light through heavy steam, gritty Victorian steampunk photorealism."
        )
    },
    {
        "id": "amateur_2b_stoker_female",
        "title": "Concept 2B: The Sump Furnace Stoker (Female) — Tilly 'Furnace-Tongs'",
        "seed": 4004,
        "prompt": (
            "Full-length action portrait of a fierce young Victorian furnace scraper and amateur brawler, agile muscular female, 18 years old, "
            "ducking low in an aggressive street scrap stance in a subterranean boiler house. "
            "Both arms are encased in heat-resistant asbestos wraps, braided copper heat lines, and glowing hot iron clinker-tongs integrated into her forearm braces, "
            "legs wrapped in soot-blackened canvas and iron boiler plates. "
            "Wearing rolled-up dungarees, red bandanna tied over soot-dusted hair, heavy welding gloves, and coal dust smudged across cheekbones. "
            "Gutter-fighter grit, fiery coal furnace backlighting, swirling sparks and escaping white steam, gritty Victorian steampunk photorealism."
        )
    },

    # 3. The Galvanic Escapologist
    {
        "id": "amateur_3a_escapologist_male",
        "title": "Concept 3A: The Galvanic Escapologist (Male) — Septimus 'Twitch'",
        "seed": 4005,
        "prompt": (
            "Full-length action portrait of a manic escaped Victorian Bedlam asylum inmate and amateur brawler, gaunt frantic male, 32 years old, "
            "caught in mid-spasm launching an erratic flying strike in a foggy London alley. "
            "Fights half-bound in heavy canvas straitjacket wraps with dangling brass padlocks and leather restraint straps; "
            "both arms and legs are rigged with copper-zinc galvanic battery coils and spark gap electrodes that discharge crackling blue static electricity when struck. "
            "Wearing ragged asylum trousers, bare feet taped in canvas, wildly disheveled hair, manic unhinged grin. "
            "Arcs of blue electrical discharge dancing across wet cobblestones, heavy rain, dramatic chiaroscuro lighting, gritty Victorian steampunk photorealism."
        )
    },
    {
        "id": "amateur_3b_escapologist_female",
        "title": "Concept 3B: The Galvanic Escapologist (Female) — Sybilla 'The Straitjacket'",
        "seed": 4006,
        "prompt": (
            "Full-length action portrait of an unhinged Victorian asylum escapee and unpredictable brawler, pale intense female, 28 years old, "
            "poised in a tense contorted grappling stance in a shadowy Victorian clinic. "
            "Bound in torn canvas restraint sleeves with heavy brass buckles and leather cinches, her limbs fitted with galvanic shock plates, copper coils, "
            "and humming Leyden jar accumulators wired to her wrists. "
            "Wearing a tattered white asylum gown over dark skirts, wild dark curls framing a feverish smiling face. "
            "Crackling blue static lightning arcs between her hands, flickering gas lamps, rainy night window, gritty Victorian steampunk photorealism."
        )
    },

    # 4. The Penny-Dreadful Scribe
    {
        "id": "amateur_4a_scribe_male",
        "title": "Concept 4A: The Penny-Dreadful Scribe (Male) — Ignatius Quill",
        "seed": 4007,
        "prompt": (
            "Full-length action portrait of a terrified Victorian penny-dreadful horror writer and bumbling amateur pitfighter, frantic bookish male, 30 years old, "
            "swinging an enormous iron-bound legal ledger in wild panic in a foggy London alley. "
            "Both arms are cobbled from printing press parts: cast-iron lead typesetting blocks riveted across his knuckles like brass knuckles, "
            "brass bookbinder hinge elbows, and heavy lead paperweight shoe soles. "
            "Wearing an ink-splattered tweed frock coat, celluloid collar, green paper eye-shade visor, round spectacles askew on his nose, "
            "parchment murder mystery manuscript pages flying everywhere. "
            "Wide-eyed hysterical scream, spilled black ink splashing across stone, gritty Victorian steampunk photorealism."
        )
    },
    {
        "id": "amateur_4b_scribe_female",
        "title": "Concept 4B: The Penny-Dreadful Scribe (Female) — Hester Quill",
        "seed": 4008,
        "prompt": (
            "Full-length action portrait of an eccentric Victorian crime novelist and accidental pitfighter, frantic sharp-featured female, 28 years old, "
            "flinging a heavy glass inkpot while ducking in comedic terror in an East End print shop. "
            "Her forearms are reinforced with brass printer's galleys, sharpened steel dip-pen stylus clusters, and heavy book-press clamp boots. "
            "Wearing an ink-smeared Victorian walking dress, green eye-shade, leather writer's satchel spilling sensational pamphlets with gory headlines. "
            "Anxious frantic grimace, black ink sprays frozen in mid-air, dramatic gaslit print shop atmosphere, gritty Victorian steampunk photorealism."
        )
    },

    # 5. The Gentleman Slummer
    {
        "id": "amateur_5a_slummer_male",
        "title": "Concept 5A: The Gentleman Slummer (Male) — The Hon. Algernon Fotheringay",
        "seed": 4009,
        "prompt": (
            "Full-length portrait of a pompous Victorian aristocratic dandy attempting amateur bare-knuckle prize fighting, handsome flush-faced male, 26 years old, "
            "standing in a ridiculously exaggerated and rigid 18th-century Queensberry pugilist stance in an underground pit. "
            "Both arms are exquisitely ornate, ridiculously expensive bespoke sporting prosthetics made of polished brass clockwork, mother-of-pearl inlays, "
            "and gold filigree knuckle guards commissioned from Savile Row. "
            "Wearing an immaculate silk brocade waistcoat, spotless white cravat, tailored fawn trousers, but with a bleeding nose and a sudden horrified realization that this is not a game. "
            "Hilariously out-of-place high-society refinement, cheering rowdy pit crowd in background, gritty Victorian steampunk photorealism."
        )
    },
    {
        "id": "amateur_5b_slummer_female",
        "title": "Concept 5B: The Gentleman Slummer (Female) — Lady Clara Fotheringay",
        "seed": 4010,
        "prompt": (
            "Full-length portrait of a haughty aristocratic lady who entered the underground brawling pit on a wager, fashionable female, 24 years old, "
            "striking an awkward dramatic pugilist posture with fists raised. "
            "Both arms are bespoke high-society sporting prosthetics crafted from mirror-polished rose-gold, carved ivory plating, and brass filigree wrist cuffs. "
            "Wearing a tailored velvet riding habit with gold buttons, top hat with silk veil pushed up, pearl earrings, and an expression shifting from arrogant amusement to wide-eyed aristocratic panic. "
            "Gritty Victorian underground brawling pit backdrop, flickering torches, smoke and blood-stained canvas, gritty Victorian steampunk photorealism."
        )
    }
]

def build_workflow(prompt_text, seed, width=896, height=1152):
    workflow = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux3-image-klein-int8-convrot.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_4b_int8_convrot.safetensors", "type": "flux3", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt_text}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": "blurry, low quality, deformed, extra limbs, cartoon, anime, 3d render"}},
        "6": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "7": {"class_type": "ModelSamplingFlux", "inputs": {"model": ["1", 0], "max_shift": 1.15, "base_shift": 0.5, "width": width, "height": height}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["7", 0], "positive": ["4", 0], "negative": ["5", 0], "latent_image": ["6", 0], "seed": seed, "steps": 16, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": "flux3_amateur"}}
    }
    return workflow

def run_batch():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    total = len(OPTIONS)
    print(f"Starting batch generation of {total} Re-Imagined Amateur Brawler options...")
    start_all = time.time()

    for idx, item in enumerate(OPTIONS, 1):
        item_id = item["id"]
        title = item["title"]
        seed = item["seed"]
        prompt = item["prompt"]
        out_path = os.path.join(OUTPUT_DIR, f"{item_id}.png")

        if os.path.exists(out_path) and os.path.getsize(out_path) > 100000:
            print(f"[{idx}/{total}] Skipping (already exists): {item_id}")
            continue

        print(f"\n[{idx}/{total}] [FLUX3] Generating: {title}...")
        t0 = time.time()
        wf = build_workflow(prompt, seed)

        req = urllib.request.Request(
            f"{COMFY_HOST}/prompt",
            data=json.dumps({"prompt": wf}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = urllib.request.urlopen(req)
        prompt_id = json.loads(res.read()).get("prompt_id")
        print(f"  - Queued: {prompt_id}")

        while True:
            time.sleep(1)
            h_res = urllib.request.urlopen(f"{COMFY_HOST}/history/{prompt_id}")
            h_data = json.loads(h_res.read())
            if prompt_id in h_data:
                entry = h_data[prompt_id]
                status = entry.get("status", {})
                if status.get("status_str") == "error":
                    raise RuntimeError(f"ComfyUI error: {status.get('messages')}")
                
                outputs = entry.get("outputs", {})
                if "10" in outputs and "images" in outputs["10"]:
                    img_info = outputs["10"]["images"][0]
                    fn = img_info["filename"]
                    sub = img_info.get("subfolder", "")
                    src_path = os.path.join(COMFY_OUTPUT, sub, fn)
                    shutil.copyfile(src_path, out_path)
                    elapsed = time.time() - t0
                    print(f"  - Saved to {out_path} ({os.path.getsize(out_path)} bytes) in {elapsed:.1f}s")
                    break

    total_time = time.time() - start_all
    print(f"\n[ALL COMPLETE] Finished {total} options in {total_time:.1f}s!")

if __name__ == "__main__":
    run_batch()
