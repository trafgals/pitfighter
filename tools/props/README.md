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
   four-view turnaround sheet from its alpha cutout. `chain_sheets.ps1` runs the
   queue; `reroll_clips.ps1` re-renders the clips that never reach the back
   view; `salvage_clip.ps1` cuts a sheet from a clip that is already in
   ComfyUI's output, so a chain that is restarted mid-clip does not spend the
   GPU on it twice.
2. **Mesh** - `scripts/run_pixal3d_mesh.py <asset_id>` cuts the sheet, runs
   Pixal3D on ComfyUI and places the mesh on the pivot. `chain_meshes.ps1`
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
6. **Amend** - `amend_dimensions.py` replaces the dimensions the
   reconstruction contradicts with the ones it measured, for the props whose
   spec was measured off the deleted stand-in. The capture is run again
   against them, and the amendment is recorded on the entry.
7. **Orientation** - `compare_front.py` projects the mesh and compares its
   outline with the sheet it was built from. A reconstruction can come out
   turned the wrong way or mirrored in X, and neither shows up in a dimension
   check. `mirror_prop.py` flips a mirrored mesh back.
8. **Record** - `record_prop.py` writes the measured block, the build command
   and the gate into the manifest. `finish_report.py` writes the note for the
   manifest and the comment for the prop's issue.

`auto_prop.ps1 <asset_id> <issue> <sheet_stem>` runs steps 3 to 8 for one
prop and makes its commit; `watch_finish.ps1` runs it for every prop as its
mesh lands.

## What the dimensions are

`predict_dims.py` compares the spec against the prop's own approved art
before the GPU is asked for anything. A reconstruction reproduces the
proportions of the art it is built from, so a prop whose art is a different
shape from the spec shows up there: the spec was measured off the deleted
procedural stand-in, and the art is what the prop looks like.

**The manifest is amended to the art's own measurements.** The approved art is
the prop, and the stand-in's numbers are the stale ones, so
`amend_dimensions.py` replaces the dimensions the reconstruction contradicts
with the ones it measured and the capture is run again. The tolerance stays
at 5% and is not widened; the amendment is written on the entry as
`dimensions_note` and onto the issue, so it is visible rather than hidden
inside a passing check.

What the dimension check can no longer catch is the difference between the art
and the spec, because there is no longer a difference to catch. Whether the
mesh is the shape of the art it was built from is `compare_front.py`'s job.

## Running it for hours

The whole set is a day's work on one GPU, so the pipeline is run detached from
any shell: a process that belongs to a shell's tree is killed with it. Started
through the WMI service it belongs to the service instead, and outlives the
shell that asked for it:

```powershell
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = 'pwsh -NoProfile -File "C:\path\to\tools\props\supervisor.ps1"'
}
```

`supervisor.ps1` runs the three chains and restarts each one when it ends.
`guardian.ps1` watches the supervisor and starts another if it goes.
`start_comfyui.ps1` brings ComfyUI up on the discrete card, because ROCm lists
the integrated Radeon first some of the time and a model that does not fit
there fails with "HIP error: invalid kernel file" before it draws anything.
The supervisor watches for that too and moves a ComfyUI that came up on the
wrong card.

Three things about ComfyUI's queue are worth knowing before changing it:

- **A clip conditions on the file that is on disk when it runs, not the one
  that was on disk when it was queued.** ComfyUI's LoadImage node reads the
  anchor file when the job starts, so a clip that waits behind another one
  picks up whatever prop wrote the anchor last - the bulwark was once queued
  to render the sluice. Each prop writes its own anchor file now, named after
  its sheet.
- **A queue does not survive a restart.** A clip or a reconstruction that was
  in flight when ComfyUI went is lost, and the chains re-queue it, so nothing
  has to be salvaged by hand.
- **One job at a time.** The sheet chain and the mesh chain share the queue,
  so a mesh waits behind the clips and the GPU never idles.

## Reviewing

The review happens on the prop's GitHub issue, and `docs/props/README.md` is
the guide a reviewer follows: what is on the issue, how to judge the renders
against the concept art, and how to approve a prop or send it back.

Two scripts carry a reviewer's verdict back into the repository:

- `update_issue.py <asset_id> <issue>` rewrites the issue's 3D section from
  what was actually built - the measured block, the checks that did not pass,
  the renders and the gate - and points the issue's own review controls at the
  guide.
- `apply_approvals.py` reads the issues and moves the manifest and the labels
  to match an approval a human has already given, by a `/approve-3d` comment
  or a `status:asset-approved` label. It is a dry run until it is given
  `--apply`, and it never approves anything itself.
