# Handoff: generate character and stage textures with ComfyUI

You are generating texture images for PITFIGHTER, a browser brawler built with
Three.js (repo: `C:\code\trafgals\pitfighter`). Every surface in the game is
currently made from noise in code (`src/render/textures.ts` and
`src/render/anatomy.ts`). As a result, all 21 fighters look like the same devil
in a different colour. Your job is to make **image files** for those surfaces on
the user's local GPU. Another agent will wire them into the renderer, so **do
not change anything under `src/`**.

## Rules (they come from the project; do not bend them)

- **No Namco / Urban Reign material, in any form.** Don't open, mount or extract
  anything in the Urban Reign folders on this machine (`urban-reign-retail\`,
  `urban-reign-web\`, the ISOs, the texture pack). Don't use them as img2img
  sources, ControlNet inputs, IP-Adapter references or LoRA training data.
- **No references to existing IP in prompts.** Don't name games, franchises,
  trademarked characters, studios or living artists. Describe what you want in
  plain words instead.
- **No images from the internet** as inputs (img2img, references, style
  transfer). Every image starts from noise, using models whose licence allows
  the output in a public, free game (see Models).
- **Record where every file came from**, in the manifest (see Deliverables).
- **Size budget:** everything you add must come to **under 25 MB**. The project
  must stay under 1 GB in total and load fast; at the sizes below the whole set
  comes to about 10 MB.
- **Work on a branch.** Commit only on a branch named `textures/comfy`, and only
  files under `public/tex/` plus updates to this doc. **Never push to `main`**: a
  push to `main` deploys the site. Push the branch and stop.
- **Watchdogs:** give every long job (installs, model downloads, batch renders)
  a hard timeout. Run those jobs in the background and don't poll them in a
  tight loop.

## The machine

- GPU: **AMD Radeon RX 9070 XT** (RDNA4, `gfx1201`, 16 GB VRAM), on Windows 11.
- NVIDIA/CUDA builds won't run. Pick a route in this order, and **check what is
  current** before installing, because AMD-on-Windows support changes quickly:
  1. **ComfyUI with ROCm on Windows** (preferred): AMD's own PyTorch wheels for
     Windows, or ComfyUI's AMD/ROCm portable or desktop build, if one exists for
     RDNA4. Check that `torch.cuda.is_available()` is True (ROCm reports itself
     through the CUDA API) and that `torch.version.hip` is set.
  2. **ZLUDA**, using a maintained ComfyUI-ZLUDA fork that supports `gfx1201`.
  3. **DirectML** (`torch-directml`, `--directml`) as a last resort. It works
     but is slow, so drop to SDXL at 1024² and fewer steps.
- Install ComfyUI in its own folder **outside the repo**, for example
  `C:\comfy\`. Keep models there too. Nothing from ComfyUI goes into the repo
  except the finished images and the workflow JSONs.
- If the `comfy` CLI skill is available to you, you may use it to drive
  workflows (`comfy-fragments` for reusable pieces).

## Models

Use base models whose licence allows public use of their output:

- **FLUX.1 [schnell]** (Apache-2.0): fast (4 steps), good on materials. It fits
  in 16 GB at fp8.
- **SDXL 1.0 base** (CreativeML Open RAIL++-M): fine too, and has the best
  tooling for seamless tiling.
- **Don't use** FLUX.1 [dev] or other non-commercial-licence models, or LoRAs
  whose licence you can't confirm.
- For height maps, either derive them from the colour image's luminance after a
  high-pass, or use a depth-estimation node whose model licence allows it (for
  example Depth Anything V2 *Small*, Apache-2.0). Record which you used.

## How the game will use the images

Read this before generating anything. It decides the formats.

1. **Body skin, one per fighter:** a seamless, tiling material.
   - The code wraps it round the trunk, the arms and the skull and then paints
     the muscle grooves, abs, scars and face sockets on top as shading.
   - So the image must be **only a material**: lit flat, no shadows baked in,
     and with no anatomy, faces, eyes or symmetry lines.
   - Think "a 30 × 30 cm patch of this creature's hide".
2. **Cloth, one per fighter:** shorts and belt, also a seamless material.
3. **Face, one per fighter:** a **front-on, orthographic, flat-lit face mask**
   on a transparent background, which the code projects onto the front of the
   skull.
   - Frame only from the brow to the chin, with eyes looking straight ahead and
     a neutral expression.
   - It must be symmetric enough to sit on a sphere. No hair, no horns (the
     horns are separate meshes) and no neck.
4. **Stage surfaces:** seamless materials that tile over floors and walls.

Every material image must **tile seamlessly in both directions**.
- With SDXL, use a circular/seamless padding node (for example a "seamless
  tiling" or "circular VAE decode" custom node). With FLUX, roll the image by
  half its size and inpaint the cross-shaped seam.
- Check every tile with a 2 × 2 contact sheet: no seam may be visible.

The game multiplies a skin by the fighter's colour unless told otherwise. Paint
each texture in its **final colours**, keyed to the palette below; the renderer
will switch the tint off for textured fighters.

## Deliverables

```
public/tex/
  manifest.json
  fighters/<slug>/skin.webp      512×512   seamless colour
  fighters/<slug>/skin_h.webp    512×512   seamless height, greyscale (white = raised)
  fighters/<slug>/cloth.webp     512×512   seamless colour
  fighters/<slug>/face.webp      512×512   RGBA, transparent outside the mask
  stages/<stage>/<surface>.webp  1024×1024 seamless colour
  stages/<stage>/<surface>_h.webp 1024×1024 seamless height
  stages/hell-toilet/basalt_glow.webp  1024×1024 greyscale: white where the lava cracks glow
  workflows/<name>.json          the ComfyUI workflows you used (API format)
  contact/<slug>.png, contact/<stage>.png   2×2 tiling previews + face; for review, under 1 MB each
```

- **WebP:** quality 82–88 for colour and lossless for greyscale height maps.
  Keep each 512² file under ~120 KB and each 1024² file under ~400 KB.
- **Generate large, then downscale:** render at the model's native size (1024²)
  and downscale with a good filter (Lanczos). Don't generate at 512 directly.
- **`<slug>`** is the fighter's name in kebab-case, for example `dale-damnation`.
- **`manifest.json`** has one entry per file:
  ```json
  { "file": "fighters/dale-damnation/skin.webp", "model": "flux1-schnell-fp8", "licence": "Apache-2.0",
    "prompt": "...", "negative": "...", "seed": 1234, "steps": 4, "workflow": "workflows/skin.json",
    "post": "seam-inpaint, lanczos 1024->512, webp q85" }
  ```

## Fighters

Each fighter is a devil from hell's fighting pit. Their gameplay style is in
brackets. Make them **clearly different from each other at a glance**, by both
hue and surface character, not just tint. Hex values are the current body and
accent colours; keep the skin near the body colour and the cloth near the accent.

| slug | name (style) | body / accent | skin idea | face idea |
|---|---|---|---|---|
| dale-damnation | Dale Damnation (All-Round) | #b33a3a / #2b1a1a | plain red devil hide, light pores, faint veins | ordinary, mildly smug |
| brimstone-bruno | Brimstone Bruno (Power) | #7a2e1e / #111111 | thick cracked hide like cooled lava crust, glowing seams very faint | heavy brow, broken nose |
| gutter-gus | Gutter Gus (Street) | #8a5a3a / #3a3a3a | grimy tanned leather with soot, old scrapes | stubble shadow, scarred lip |
| sensei-smoulder | Sensei Smoulder (Karate) | #d9d0c0 / #1a1a1a | pale ash-white skin with fine charcoal scorch marks | calm, narrow eyes, grey eyebrows |
| big-lou-cipher | Big Lou Cipher (Wrestling) | #6b2a6b / #f0c000 | purple, oily, stretched skin with gold-foil tattoo flecks | grinning, face paint stripes |
| eight-limbed-ash | Eight-Limbed Ash (Muay Thai) | #c06020 / #202020 | orange hide dusted with ash, knotted scar tissue | wrapped-forehead look, fierce |
| knuckles-inferno | Knuckles Inferno (Boxing) | #2a4aa0 / #d0d0d0 | cobalt-blue smooth skin, bruising mottles | swollen eye, flattened nose |
| rage-reaper | Rage Reaper (Rush) | #a01010 / #000000 | deep red, raw, ridged like exposed muscle | snarling, bared teeth |
| quickfire-imp | Quickfire Imp (Speed) | #e05050 / #400000 | bright pinkish-red, fine scales like a lizard | big eyes, impish grin |
| crimson-crane | Crimson Crane (Kung Fu) | #c03030 / #f0d060 | red skin with gold painted scrollwork fading into it | long thin moustache marks |
| hellmountain | Hellmountain (Mighty) | #4a3a30 / #902010 | rock: basalt plates and moss-dark crevices, like a cliff face | stony, deep-set eyes |
| choke-chimera | Choke Chimera (Submission) | #3a6a3a / #101010 | green reptilian scales mixed with patches of fur | slit pupils, wide jaw |
| sergeant-sulphur | Sergeant Sulphur (Military) | #4a5a2a / #202010 | olive skin, yellow sulphur crust in the creases | square jaw, permanent scowl |
| cinder-ginga | Cinder Ginga (Capoeira) | #d08040 / #2a1a0a | warm amber skin with glowing ember speckles | joyful, wide smile |
| hellkick-hana | Hellkick Hana (Tae Kwon Do) | #f0f0f0 / #a00000 | porcelain-white skin with thin red crack lines like kintsugi | sharp, focused, red eyeliner marks |
| ronin-of-gehenna | Ronin of Gehenna (Samurai Sword) | #303040 / #c0a030 | slate-grey skin like lacquered armour plates, chipped | stern, a scar across one eye |
| the-old-devil | The Old Devil (Master) | #902020 / #e0e0e0 | wrinkled dark-red skin, liver spots, very old | long white brows, wise squint |
| hellfire-flick | Hellfire Flick (Gun) | #404040 / #ff6000 | charcoal skin with orange glowing burn veins | cocky half-smile, one brow raised |
| brother-blaze | Brother Blaze (Martial Arts) | #e0a040 / #202020 | golden-tan skin, sweat sheen, small burn spots | open-mouthed battle yell |
| ashen-judoka | Ashen Judoka (Judo Based) | #e8e0d0 / #101040 | pale ashen skin with soft grey smudges | composed, heavy-lidded |
| fresh-soul-kevin | Fresh Soul Kevin (Amateur) | #9a9a9a / #3a6aa0 | grey, slightly translucent ghostly skin, faint office-pallor blotches | nervous, wide-eyed, eyebags |

Cloth: plain fabrics keyed to the accent colour, varied in weave and wear: satin
trunks, worn denim, gi canvas, leather, quilted silk, camouflage canvas and so
on. Pick one that suits each fighter.

Write the prompts in plain material terms, for example:
- skin: *"seamless tileable texture, close-up of [skin idea], [colour words], flat even lighting, no shadows, top-down photo scan, highly detailed, 4k material"*
- face: *"front orthographic view of a devil's face, [face idea], [colour words] skin, flat even studio lighting, symmetric, neutral background, game character texture"*
- negative: *"text, watermark, logo, signature, frame, border, perspective, shadows, vignette, hands, multiple faces"*

Lock a seed per fighter so the skin, cloth and face can be regenerated
consistently.

## Stages

| stage | surfaces (file name = current recipe id) | look |
|---|---|---|
| hell-toilet | `basalt` (+ `basalt_glow`) | black volcanic basalt slabs with lava-filled cracks; the glow map is white only in the cracks |
| construction-site | `dirt`, `concrete` | churned muddy dirt with tyre tracks and gravel; stained, cracked poured concrete |
| collapsing-tower | `roof` | tar-and-gravel high-rise rooftop membrane, patched seams |
| hindenburg-blimp | `planks` | varnished wooden deck planks running one way, scuffed, brass nail heads |
| castle-under-siege | `stone` | worn medieval flagstones / ashlar blocks, mortar lines, soot |

## When you are done

1. Check that every file in the tree above exists, decodes, is the stated size,
   and tiles cleanly (look at the contact sheets).
2. Check that the total size of `public/tex/` is under 25 MB.
3. Commit on `textures/comfy` and push that branch, **not `main`**.
4. Report back: which ComfyUI/PyTorch route worked on the 9070 XT, the models
   and licences, the total size, and the 21 fighter contact sheets. The next
   agent will then load these in `src/render/` (per-stage lazy loading, with the
   procedural surfaces kept as a fallback) and turn off the colour tint for
   textured fighters.

## What was delivered

The set is on the branch `textures/comfy`, under `public/tex/`:

```
public/tex/README.md      how the set was made and how to regenerate it
public/tex/manifest.json  one entry per file: model, licence, prompt, negative, seed, steps, workflow, post
public/tex/spec.json      the prompt and the seed for every surface - the source of truth
public/tex/fighters/<slug>/{skin,skin_h,cloth,cloth_h,face}.webp
public/tex/stages/<stage>/<surface>.webp, <surface>_h.webp
public/tex/stages/hell-toilet/basalt_glow.webp
public/tex/workflows/*.json  the API-format ComfyUI graphs
public/tex/contact/*.png     2x2 tiling previews plus the face
```

- **Route:** ComfyUI 0.33.0 on native ROCm - the Windows portable build
  already had PyTorch 2.9.1+rocm7.2.1 for gfx1201, so nothing had to be
  installed. The server has to be started with `--cuda-device 1`, because
  ComfyUI enumerates the iGPU and the 9070 XT in an order that changes
  between boots.
- **Model:** FLUX.1 [schnell] in fp8, Apache-2.0, from the ungated
  `Comfy-Org/Flux-1-Schnell` mirror. FLUX.1 [dev] was on disk and was not
  used, because its licence is not commercial.
- `cloth_h.webp` is beyond the tree above, but `src/render/textures.ts` bakes
  a bump map for the cloth as well as for the skin, so the file is there to
  be used or ignored.
- The renderer change is deliberately not in this branch.
