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
An H3 clip takes 45–75 minutes and a reconstruction about 25, so the sheet of
each prop is rendered while the mesh of the one before it is built.

The per-prop tools - the pose check, the region re-fit, the orientation check,
the manifest record and the commit - are in `tools/props/`, with a README that
gives the order.

## Step 1: render a fresh H3 clip and sheet per prop

The old sheets and turntables have been deleted: they were cut at the wrong
angles, and several old clips turn only a quarter of the way round or break
up past the side (bulwark pistons, knuckleduster, piston gauntlet). Each of
the 20 props gets a new clip from its alpha cutout:

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
Don't use it on the clips from before this hand-off. It is also how a chain
that is restarted while a clip is in flight keeps the clip it has already paid
for: `tools/props/salvage_clip.ps1 <prompt_id> <sheet> <preview>` waits for
the job and cuts the sheet from its frames.

## Step 2: give each asset a frame

`run_pixal3d_mesh.py` needs `validation.frame` in the manifest entry
(`y_min_cm`, `y_max_cm`, optional `centre_x_cm`/`centre_z_cm`) — see the
chair's entry. The other props validate by named meshes (`origin_mesh`,
`forward_mesh`, grip/head sockets) that a reconstruction doesn't have.

- Take the frame from the entry's `stand_in_measured.bbox_*_cm` (the deleted
  stand-in's bounding box), so the prop sits where the game expects it (grip
  at the origin, etc.). Remove `stand_in_measured` and `rebuild_note` once built.
- Convert the named-mesh checks to region checks, as the chair's were.
- A reconstruction is one welded surface with no parts to name, so a head-socket
  prop has no `Crown_Opening_Rim` to measure: give it `validation.rim_mesh: ""`
  and the check is skipped rather than failed. The two hand-built helmets keep
  their rim.
- After the build, check width and depth against the spec too, not just
  height. Long thin props (rapier, pole, brolly, bone saw) are the likely
  failures; **stop and report** rather than loosen a tolerance.

## Step 3: stand the prop up on its pivot

Some props are approved art drawn on the diagonal, and two are drawn the other
way up. A drawing's angle is a pose, not a shape, so:

- `validation.frame.roll_deg` rolls the reconstruction back the way the art
  leans. The angle comes from the prop's own alpha cutout: the silhouette's
  principal axis is the prop's long axis, and the angle it makes with the
  vertical is the lean (`tools/props/measure_lean.py`).
- `validation.frame.upside_down` turns the sheet over before it is conditioned
  on, so the mesh and the textures baked from the same views both come out the
  right way up. Turning the mesh over afterwards would leave the bake upside
  down on the surface. Turning the object over is a half turn about the front
  view's horizontal axis: the two broadside views are flipped vertically and
  the two side views are turned over sideways.
- `validation.frame.turn_deg` (0, 90 or 270) turns a prop whose pivot puts its
  length on Z - a shoe last whose toe points forward. 90 is a half turn the
  wrong way; the sheet's front view ends up on the other side.

The sign of a roll is easy to get wrong, and a wrong roll is a prop leaning
twice as far as it should. `tools/props/lean_fit.py` measures the lean of the
mesh that was built and finds the roll that stands it up; the placement is a
post-process on the GPU's output, so a roll that turns out to be wrong costs
nothing to correct - the raw GLB is placed again.

## Step 4: build, one prop per commit

```bash
python scripts/run_pixal3d_mesh.py <asset_id>
```

Then capture and publish the renders, look at them, and set the entry's
`build` to the command above (as the chair's is) and its `status` to
`gate:3-review-ingame-3d`. Don't approve any gate past that — the user
approves.

Two checks have to be made after the build, because a dimension check cannot
see them:

- **The regions.** The validation boxes are cut from the prop's alpha cutout
  and mapped onto the model. Map them onto the model's *measured* box, not the
  spec's, or they land on empty space and the capture fails for a reason that
  has nothing to do with the mesh (`tools/props/refit_prop.py`).
- **The orientation.** A reconstruction can come out turned the wrong way or
  mirrored in X. Project the mesh and compare its outline with the sheet it
  was built from (`tools/props/compare_front.py`); a mirrored mesh is flipped
  back (`tools/props/mirror_prop.py`).

Before each commit: `npm test` (`tests/pixal3d.test.ts` checks every
reconstructed asset's bounds, budgets, textures and indices). The manifest may
only name files that exist, so a commit takes with it every file the manifest
names that is not in the tree yet.

Turntable previews go in `docs/props/<id>/`, never `public/` (it ships with
the game; a test enforces this).

## The dimensions

The specs in `scale_dimensions_cm` were measured off the deleted procedural
stand-ins, and most of the approved arts are a different shape from the stand
they replace. A reconstruction reproduces the proportions of the art it is
built from, so its width and depth come out of the art, not the spec, and the
width and depth checks fail while the height - which the build fits to the
spec exactly - passes.

`tools/props/predict_dims.py` says which props this will happen to before the
GPU is asked for anything. It is a director's decision: amend
`scale_dimensions_cm` to the measured dimensions, or re-cut the alpha so the
rebuild lands on the spec. **Do not widen the tolerance**, and leave the gate
at `gate:2-review-turnaround` for the prop that needs the decision.

## Done

All 21 assets built by `run_pixal3d_mesh.py`, every capture passing, renders
published, one PR. Never push to `main` — it deploys.
