# Prop rebuild tooling

The scripts that rebuild a prop from its approved art and take it through the
capture, the checks and the commit. They sit beside the pipeline scripts in
`scripts/`: those build and place the mesh, these measure it, check it against
the art it was built from and record the result.

Run them with the Python that has Pillow and NumPy - the ComfyUI portable
interpreter, or any other with those two packages:

```bash
python tools/props/predict_dims.py     # what the art says the dimensions are
```

The PowerShell drivers take the interpreter from `$env:PIXAL3D_PYTHON` and fall
back to `python` on the path.

## The order a prop goes through

1. **Sheet** - `scripts/run_minimax_h3_turnaround.py` renders the prop's H3
   four-view turnaround sheet from its alpha cutout. `run_sheets.ps1` runs the
   queue; `reroll_clips.ps1` re-renders the clips that never reach the back
   view; `salvage_clip.ps1` cuts a sheet from a clip that is already in
   ComfyUI's output, so a chain that is restarted mid-clip does not spend the
   GPU on it twice.
2. **Mesh** - `scripts/run_pixal3d_mesh.py <asset_id>` cuts the sheet, runs
   Pixal3D on ComfyUI and places the mesh on the pivot. `mesh_each_sheet.ps1`
   runs the queue as the sheets land.
3. **Pose** - `lean_fit.py` measures how far the placed mesh leans. A prop
   whose approved art is drawn on the diagonal is rolled back onto its pivot,
   and the roll that is asked for is checked against the mesh that was built:
   the sign of a roll is easy to get wrong, and a wrong roll is a prop that
   leans twice as far as it should.
4. **Regions** - `refit_prop.py` re-fits the manifest's validation boxes onto
   the mesh that was built. The boxes are cut from the prop's own alpha
   cutout, so they have to be mapped onto the model's measured box and not
   the spec's.
5. **Capture** - `node scripts/capture_prop_renders.mjs <asset_id>` renders
   the prop and checks it against the manifest.
6. **Orientation** - `compare_front.py` projects the mesh and compares its
   outline with the sheet it was built from. A reconstruction can come out
   turned the wrong way or mirrored in X, and neither shows up in a dimension
   check. `mirror_prop.py` flips a mirrored mesh back.
7. **Record** - `record_prop.py` writes the measured block, the build command
   and the gate into the manifest. `finish_report.py` writes the note for the
   manifest and the comment for the prop's issue.

`auto_prop.ps1 <asset_id> <issue> <sheet_stem>` runs steps 3 to 7 for one
prop and makes its commit; `watch_finish.ps1` runs it for every prop as its
mesh lands.

## What the dimensions are

`predict_dims.py` compares the spec against the prop's own approved art
before the GPU is asked for anything. A reconstruction reproduces the
proportions of the art it is built from, so a prop whose art is a different
shape from the spec shows up there: the spec was measured off the deleted
procedural stand-in, and the art is what the prop looks like.

That is a director's decision - amend `scale_dimensions_cm` to the art's
measurements, or re-cut the alpha so the rebuild lands on the spec. The
tolerance stays at 5%.
