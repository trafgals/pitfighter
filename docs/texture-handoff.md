# Handoff: generate character and stage textures with ComfyUI

You are generating texture images for PITFIGHTER, a browser brawler built with
Three.js (repo: `C:\code\trafgals\pitfighter`). Every surface in the game is
currently made from noise in code (`src/render/textures.ts` and
`src/render/anatomy.ts`). As a result, all 12 fighters look like the same body
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
  fighters/<slug>/limb.webp      512×512   seamless colour: the limbs' craft
  fighters/<slug>/limb_h.webp    512×512   seamless height, greyscale (white = raised)
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
- **`<slug>`** is the fighter's `id` in `src/data/characters.json`, for example `sir-peregrine`.
- **`manifest.json`** has one entry per file:
  ```json
  { "file": "fighters/sir-peregrine/skin.webp", "model": "flux1-schnell-fp8", "licence": "Apache-2.0",
    "prompt": "...", "negative": "...", "seed": 1234, "steps": 4, "workflow": "workflows/skin.json",
    "post": "seam-inpaint, lanczos 1024->512, webp q85" }
  ```

## Fighters

The fighters are the ladies and gentlemen of Old Sorrow, a rain-soaked
steampunk city, who fight to the death in their best clothes
([docs/characters.md](characters.md)). Their gameplay style is in brackets.
Make them **clearly different from each other at a glance**, by both hue and
surface character, not just tint. Hex values are the body and accent colours;
keep the skin near the body colour and the cloth near the accent.

Every fighter's limbs are made in a craft of their own (clockwork brass, kiln
porcelain, ship's oak, aether glass...), and the **limb** surface is that
craft, painted. It is the one surface that is not skin or cloth, so let it be
the loudest thing about the fighter. The crafts are described in full in
`crafts` in `src/data/characters.json`.

| slug | name (style) | body / accent | skin idea | limb idea | face idea |
|---|---|---|---|---|---|
| constable-winch | Constable Obadiah Winch (All-Round) | #c69472 / #1c2340 | weathered ruddy skin with broken veins over the cheeks, rain-wet | polished brass casing with engraved scrollwork, rivets and small glass windows over a watch movement | a broad ruddy face, grey mutton-chop whiskers, a cab-wheel scar across the right cheek, steady pale eyes |
| hezekiah-smelt | Mr. Hezekiah Smelt (Mighty) | #d8b8a0 / #26201c | thin pale elderly skin, pink at the cheeks, fine wrinkles, soot in the creases | rough black sand-cast iron with mould seams, big rivets and glowing orange grated vents | a small pleasant old man's face, white side whiskers, half-moon spectacles, framed by iron |
| nell-sluice | Nell Sluice (Street) | #a87656 / #4a3b2a | weathered brown skin with freckles, mud on the shins, a ridged scar across the chest | dull grey cast-lead drainpipe in soldered sections with brass solder lines and water running down | a broad freckled cheerful face with a gap-toothed grin, a scar on the collarbone, bright brown eyes |
| matron-kilnworth | Matron Prudence Kilnworth (Karate) | #e2c4ac / #28406e | pale lined skin, rain-wet, a fine scar through the left eyebrow | glazed white bone porcelain painted with blue willow branches and swallows, cracks mended with gold | a long handsome lined face, grey eyes, a thin mouth, a scar through the left eyebrow |
| bartholomew-mule | The Great Bartholomew Mule (Wrestling) | #c48a64 / #7a1420 | tanned sweating skin with thick chest hair and old claw scars, staples at the shoulder seams | thick matted brown bear fur, black claws and pads, a shaved seam sewn with black gut and brass staples | a broad sweating handsome face with a waxed black handlebar moustache and a broken nose |
| bosun-rook | Bosun Absalom Rook (Muay Thai) | #8a5a3c / #1e2a36 | deep sun-darkened weathered skin with naval tattoos of a ship, an anchor and a list of names | weathered grey ship's oak with curved grain, rusted iron bands, black tar seams and barnacles | a craggy weathered face with a huge white braided beard, deep-set blue eyes, a scar through the left eye |
| lady-bulwark | Lady Hester Bulwark (Boxing) | #f0d2bc / #3c4a2e | fair smooth skin, a flush at the cheeks, rain on it, a faint split lip | mirror-polished blued steel rams with engraved brass end caps, red rubber hoses, white-faced gauges | a fine-boned cool aristocratic face, grey-green eyes, a straight nose, chestnut hair pinned up |
| percival-crump | Percival "Oolong" Crump (Kung Fu) | #d2a679 / #5c2a38 | ruddy weathered skin flushed with drink, with broken red veins and beads of steam-sweat | amber lacquered bamboo cane in engraved brass hoops with small riveted brass boilers, beaded with steam | a round ruddy cheerful face with heavy-lidded twinkling eyes and broken veins across the nose and cheeks |
| tabitha-pegg | Mistress Tabitha Pegg (Tae Kwon Do) | #e2c2a6 / #c8963e | weathered pale East End complexion, strong jaw, smudged with black cobbler wax | black cast pig-iron shoe lasts with engraved brass imperial rules and steel leaf-springs, the welts serrated | a severe sharp-jawed fair face with acute hazel eyes and light freckles, a pencil behind the ear |
| mortimer-crape | Mr. Mortimer Crape (Judo Based) | #e0d6cc / #141214 | deathly pale papery skin, cold and grey under the eyes | faceted polished black jet plates over cream whalebone stays, laced with black silk ribbon in a cross pattern | a long pale kind mournful face painted with a faint white skull mask, sunken eyes, long white hair |
| sir-peregrine | Sir Peregrine Ashby-Lisle, Bt. (Samurai Sword) | #f2dcc8 / #2a2a34 | fair, smooth, well-kept skin, a fine duelling scar on the right cheek | polished black ebony under a fine hallmarked silver filigree of leaves and a family crest, sharpened silver nails | a handsome fine-featured smiling face, blue eyes, a small blond moustache, a duelling scar on the right cheek |
| cuthbert-inkle | Mr. Cuthbert Inkle (Amateur) | #ddb894 / #3a3428 | pale freckled skin, ink-stained fingertips, the faint start of a moustache | a mismatched pawnbroker's fitting: leather straps and buckles at the joint, a brown paper pawn ticket on a string; the limb itself rolled from the other crafts | a thin pale anxious freckled face, round wire spectacles, a weak chin |

Cloth, keyed to the accent colour:

- **constable-winch:** heavy navy wool serge, wet, with silver buttons and black leather straps
- **hezekiah-smelt:** black wool frock coat with soot, a grey silk waistcoat, gold watch chain
- **nell-sluice:** knitted grey wool shawl over a patched brown cotton dress, soaked and muddy
- **matron-kilnworth:** starched white cotton apron and cap over a dark blue wool dress, red-lined cape
- **bartholomew-mule:** crimson velvet and leopard-print strongman's leotard, a gold belt set with paste diamonds
- **bosun-rook:** navy wool pea-coat, rolled canvas trousers, a red silk sash embroidered with a ship's name
- **lady-bulwark:** white silk blouse, hunting-green wool riding skirt, laced brown leather corset belt
- **percival-crump:** a quilted oxblood silk waistcoat with a long black sash, a collarless cream shirt, loose canvas trousers
- **tabitha-pegg:** heavy oiled cowhide apron with brass eyelets, dark wool work dress, rolled linen sleeves
- **mortimer-crape:** black wool frock coat and silk waistcoat, black crape mourning band, rain-dark
- **sir-peregrine:** charcoal wool morning coat with a silk lapel, dove-grey silk waistcoat, grey striped trousers, white spats
- **cuthbert-inkle:** shiny threadbare brown wool frock coat, a frayed shirt with paper cuffs, a cheap celluloid collar

The source of truth for every idea, colour and seed is `public/tex/spec.json`,
which mirrors the `texture` block of each fighter in
`src/data/characters.json` (a test keeps them equal).

Write the prompts in plain material terms, for example:
- skin: *"seamless tileable texture, close-up of [skin idea], [colour words], flat even lighting, no shadows, top-down photo scan, highly detailed, 4k material"*
- limb: *"seamless tileable texture, close-up of [limb idea], [colour words], flat even lighting, no shadows, top-down material scan, highly detailed, 4k material"*
- face: *"front orthographic view of a person's face, [face idea], [colour words] skin, flat even studio lighting, symmetric, neutral background, game character texture"*
- negative: `negative_material` and `negative_face` in `public/tex/spec.json`

Hats, helmets, monocles and big whiskers are drawn by the renderer in 3D
(`src/render/kit.ts`), so keep them out of the faces: the face is brow to
chin. A moustache or a beard in a face idea is painted on the skin. Some face
ideas name facial hair, which `negative_face` lists as `hair`; leave `hair` out
of the negative for those faces, or the moustache will not come. Where a face
idea names the hair on the head, it only says what colour it is: the face
still stops at the brow.

`cuthbert-inkle` fights in borrowed limbs: his limb surface is the pawnbroker's
fitting (straps, buckles, a pawn ticket), and the limb itself is drawn in the
other crafts.

Lock a seed per fighter so the skin, cloth, limb and face can be regenerated
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
   and licences, the total size, and the 12 fighter contact sheets. The next
   agent will then load these in `src/render/` (per-stage lazy loading, with the
   procedural surfaces kept as a fallback) and turn off the colour tint for
   textured fighters.

## What was delivered

The first set was made for the old roster of 21 devils. When the roster was
replaced, its fighter files were removed; the stage files, the workflows and
everything learned below stay. The notes are kept as the record of how it was
done.

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
- 152 files, 12,119,024 bytes - 11.56 MiB - in total, against the 25 MB
  budget. Every 512 square file is under 120 KB and every 1024 square file
  under 400 KB.
- Every material tile's cross seam measures below 2.5. The cross is the seam
  the gate measures: the wrap on each axis is continuous by construction
  because the tile is rolled, so the cross down the middle is the only
  boundary that can be a fault. The four that were over it - the satin and
  drape folds, whose scale is close to the 512 square tile - were repaired
  with a third heal: the same 32 pixel band, at a stronger inpaint. A band
  that narrow cannot repaint a fold whose scale is close to the size of the
  tile - it can only blur the edge of one - so what repairs the fold is the
  strength of the inpaint, not the width of the band. The worst of them,
  `fighters/brother-blaze/cloth.webp`, came down from 4.52 to 0.63. The worst
  tile in the set is now `fighters/fresh-soul-kevin/skin.webp` at 2.46, a
  smooth pale skin where the cross is a soft change of shading rather than a
  step.
- The faces are all brow to chin, symmetric, with no hair and no neck. The
  frame is anchored on the brow line, measured on the run of the silhouette
  that holds the symmetry axis: a horn stands off that axis, so the run is
  the face itself. That is not the same as saying no face carries a horn or
  an ear: a horn that rises from below the brow, or an ear at the temple, is
  inside the frame, and a horn fused to the skull cannot be cropped away at
  all. Measured on the delivered files, 18 of the 21 masks are a single
  connected piece; `gutter-gus` carries one piece of 494 pixels,
  `rage-reaper` one of 351, and `sergeant-sulphur` thirteen - its jaw plate
  and the horn and ear bits around the head.
- The background flood also has to be tight, or it walks through the dark
  horn above a face and into the shadow it throws across the cheek, and the
  face comes out with a hole in it.
- The renderer change is deliberately not in this branch.
