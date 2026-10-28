# Hand-off: rebuild the props with Pixal3D

Every prop except `weapon_chair` was made by the old pipeline. Its H3 sheets
picked tiles at frames 0/31/62/93, which are really about 0/60/120/180°, not
front/left/back/right, and its meshes were primitive procedural stand-ins that
never used the sheets. Those stand-ins have been deleted: the 18 props with
status `gate:2-rebuild-pixal3d` have no GLB and `build: null`. The custodian
helmet and Smelt stovepipe keep their older hand-built GLBs; rebuild them too
if Pixal3D does better. The chair is the reference: it
was rebuilt by the scripts below and passes 21/21 checks.

## The pipeline

1. **Sheet** — `scripts/run_minimax_h3_turnaround.py`. Picks real
   front/left/back/right frames from an H3 clip by silhouette, writes the
   sheet and `<sheet>.json` (which frames, degrees, whether the right is a
   mirrored left).
2. **Mesh** — `scripts/run_pixal3d_mesh.py <asset_id>`. Cuts the sheet, runs
   `public/tex/workflows/pixal3d_multiview.json` on ComfyUI, then places the
   GLB on the spec's frame and shrinks its textures to budget.
3. **Check** — `node scripts/capture_prop_renders.mjs <asset_id>` then
   `node scripts/publish_prop_renders.mjs <asset_id>`.

Do not hand the bare workflow JSON to ComfyUI: the raw output faces −Z, is
about 1 m tall, 12 MB, and fails most checks. The script does the placing.

ComfyUI: `127.0.0.1:8188`, AMD RX 9070 XT, one GPU, so **one job at a time**.

## Step 1: render a fresh H3 clip and sheet per prop

The old sheets and turntables have been deleted: they were cut at the wrong
angles, and several old clips turn only a quarter of the way round or break
up past the side (bulwark pistons, knuckleduster, piston gauntlet). Each of
the 20 props gets a new clip from its alpha cutout (about 20 minutes each):

```bash
python scripts/run_minimax_h3_turnaround.py <alpha_cutout> public/tex/props/h3_<name>_turnaround.png --preview docs/props/<id>/turntable.webp [--symmetric]
```

Use the `turnaround_file` and `turntable_file` paths the prop has in
`scripts/pipeline_batch_runner.py`'s queue, then set the manifest entry's
`turnaround_sheet` and `turntable` to them (`run_pixal3d_mesh.py` reads the
sheet from the manifest).

`--symmetric`: pass it only when the prop's left and right are mirror images
(helmet, caps, shovel, bat, pole, chair). H3 turns about 240° in 124 frames,
so without it the right view is left out and Pixal3D works from three. The
script refuses a clip that never reaches the back; re-render that one with
another `--seed`.

**Look at every clip and sheet** before going on: front, side, back, side, in
that order, the same object throughout, no speckle or see-through parts.
Reject and re-render rather than build from a bad sheet.

`--from-frames <first frame>` re-cuts a clip already in ComfyUI's output
without the GPU, e.g. to try a different `--symmetric` choice on a new clip.
Don't use it on the clips from before this hand-off.

## Step 2: give each asset a frame

`run_pixal3d_mesh.py` needs `validation.frame` in the manifest entry
(`y_min_cm`, `y_max_cm`, optional `centre_x_cm`/`centre_z_cm`) — see the
chair's entry. The other props validate by named meshes (`origin_mesh`,
`forward_mesh`, grip/head sockets) that a reconstruction doesn't have.

- Take the frame from the entry's `stand_in_measured.bbox_*_cm` (the deleted
  stand-in's bounding box), so the prop sits where the game expects it (grip
  at the origin, etc.). Remove `stand_in_measured` and `rebuild_note` once built.
- Convert the named-mesh checks to region checks, as the chair's were.
- After the build, check width and depth against the spec too, not just
  height. Long thin props (rapier, pole, brolly, bone saw) are the likely
  failures; **stop and report** rather than loosen a tolerance.

## Step 3: build, one prop per commit

```bash
python scripts/run_pixal3d_mesh.py <asset_id>
```

About 8 minutes each. Then capture and publish the renders, look at them,
and set the entry's `build` to the command above (as the chair's is) and its
`status` to `gate:3-review-ingame-3d`. Don't approve any gate past that — the
user approves.

Before each commit: `npm test` (`tests/pixal3d.test.ts` checks every
reconstructed asset's bounds, budgets, textures and indices).

Turntable previews go in `docs/props/<id>/`, never `public/` (it ships with
the game; a test enforces this).

## Done

All 21 assets built by `run_pixal3d_mesh.py`, every capture passing, renders
published, one PR. Never push to `main` — it deploys.
