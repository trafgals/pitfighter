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

## Step 1: re-cut the sheets — no GPU needed

The 20 original H3 clips are still in ComfyUI's output folder, 124 frames
each. Re-cut them instead of re-rendering (a new H3 clip costs about 20 min):

```bash
python scripts/run_minimax_h3_turnaround.py - <turnaround_sheet> --from-frames h3_turntable_frames_NNNNN_.png [--symmetric]
```

| asset | first frame |
|---|---|
| prop_winch_custodian_helmet | 00001 |
| prop_smelt_stovepipe | 00125 |
| prop_pegg_cast_iron_last | 00249 |
| prop_crape_spiked_brolly | 00373 |
| prop_eleanor_weeping_rapier | 00497 |
| prop_tilly_clinker_tongs | 00621 |
| prop_sluice_flatcap | 00745 |
| prop_kilnworth_nursecap | 00869 |
| prop_mule_championship_belt | 00993 |
| prop_rook_souwester | 01117 |
| prop_bulwark_pistons | 01241 |
| prop_crump_samovar | 01365 |
| weapon_knuckleduster | 01489 |
| weapon_coal_shovel | 01613 |
| weapon_bone_saw | 01737 |
| weapon_nail_bat | 01861 |
| weapon_cleaver | 01985 |
| weapon_piston_gauntlet | 02109 |
| weapon_lamplighter_pole | 02233 |
| weapon_chair (reference) | 02357 |
| pickup_tonic | 02481 |

**Check the first frame of each clip matches the prop before cutting** — the
numbering is inferred from the order the batch ran in. If it doesn't, find
the clip by eye; if a clip is missing, render a new one with the same script
without `--from-frames`.

`--symmetric`: pass it only when the prop's left and right are mirror images
(helmet, caps, shovel, bat, pole, chair). H3 turns about 240° in 124 frames,
so without it the right view is left out and Pixal3D works from three. The
script refuses a clip that never reaches the back; re-render that one.

Look at every sheet. Front, side, back, side, in that order, same object.

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
