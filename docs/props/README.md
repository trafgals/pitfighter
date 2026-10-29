# Verification renders

Every prop that has been built keeps the renders a reviewer looks at here, in a
directory named after its asset id:

```
docs/props/<asset_id>/front.png     the prop from the front
docs/props/<asset_id>/profile.png   the prop from the side
docs/props/<asset_id>/badge.png     the close-up of the detail that matters
docs/props/<asset_id>/report.json   the capture report: the budgets, the
                                    bounding box and the checks the run passed
docs/props/<asset_id>/README.md     what each render shows
```

The three images are opened straight from the issue, so they are committed at
**720x880**. The capture script renders at 900x1100 and writes its output to
`test-output/props/<asset_id>/`, which is not in the repository - the publish
step is what puts the same picture into the repository at the committed size.

## Publishing

```
node scripts/capture_prop_renders.mjs <asset_id> --publish
```

The publish step resizes the captures with the repo's own PNG codec
(`scripts/lib/png.mjs`), copies the capture's report over unchanged, and
writes a README for an asset that does not have one yet.

It refuses to publish a capture that failed a check. A rejected asset looks
perfectly fine in a picture - a prop on the wrong frame is not a broken
render - so a failed run must not put its images in front of a reviewer as if
they had passed.

`--held` publishes the renders of a prop that is held at a gate, with a README
that says it is held and lists the checks that did not pass. The review
happens on the issue, and a reviewer cannot judge a prop they cannot see, so
the picture is put in front of them - but never as if it had passed. The
README, the issue's 3D section and the comment under it all carry the
finding.

## Why it is a script

The resize used to be done by hand, and it was done wrong: the Smelt's renders
went into the repository at 900x1100 and had to be corrected in a follow-up
PR (#51). A step that is done by hand is a step that gets done differently
twice. Doing it in the pipeline makes the committed size a property of the
pipeline instead of whoever ran it.

The renders committed before this step existed were resized with the same
Lanczos filter by a tool outside the repository, so they are the same picture
as this step produces but not the same bytes. New renders come from the
script.

## Reviewing a rebuilt prop

A rebuilt prop is reviewed **on its GitHub issue**, not here. This folder
holds the evidence the issue points at.

The asset issues are the ones labelled `asset:3d-built` - a prop that has
been rebuilt, so there is a 3D asset to look at:

<https://github.com/trafgals/pitfighter/issues?q=label:asset%3A3d-built>

The labels say where each prop is, so the list can be scanned:

| label | what it means |
| :--- | :--- |
| `asset:3d-built` | the prop has been rebuilt - there is a 3D asset to review |
| `held:finding` | and a check does not pass, so it needs a decision as well |
| `gate:3-review-ingame-3d` | and it passes every check, so it is in the in-game review |
| `stage:h3-turnaround` | the turnaround sheet is still being generated |
| `stage:pixal3d-mesh` | the sheet is done and the mesh is being generated |
| `gate:2-review-turnaround` | the prop is still before its 3D gate |
| `status:asset-approved` | a human has signed it off |

A prop that has no 3D asset yet has no picture on its issue, and that is the
truth of it rather than a gap in the review: it has not been built.

### What is on the issue

Each rebuilt prop's issue carries, in its **3. Model Status** section, what
was built, what it measures, the checks it passed and its renders. The same
numbers are in a comment under the issue, with the render pictures in it.

| what | where |
| :--- | :--- |
| the concept art and the alpha cutout it was built from | section 1 of the issue |
| the four-view turnaround sheet it was reconstructed from | section 2 of the issue |
| what was built, what it measures, the checks, the renders, the gate | section 3 of the issue |
| the render pictures, in a comment | the `Pixal3D Multi-View Reconstruction` comment |
| the full capture report | `docs/props/<asset_id>/report.json` |

### How to review it

1. **Open the renders.** `front.png` is the prop from the front, `profile.png`
   is it from the right side, and `badge.png` is a close-up of the detail the
   capture was pointed at. They are 720x880 so they open straight from the
   issue.
2. **Compare them with the concept art** in section 1 of the same issue. The
   reconstruction is built from the turnaround sheet, so it should be the same
   prop in the same shape - a different silhouette, a missing part or a
   mirrored detail is a defect, not a style difference.
3. **Read the checks.** `report.json` lists every check the capture ran and
   whether it passed. The ones that matter to a reviewer are the dimensions
   against the spec, the triangle and byte budgets, and the validation boxes
   that hold the prop's business end in frame.
4. **Decide.**

### The two things a reviewer can say

**Approve it.** Comment `/approve-3d` on the issue, or add the label
`status:asset-approved`. Then run:

```bash
python tools/props/apply_approvals.py --apply
```

That carries the approval into `data/asset_manifest.json`, moves the issue's
labels to match and commits it. Run it without `--apply` first to see what it
would change. The pipeline never approves anything itself - it only records an
approval a human has already given.

**Send it back.** Add the label `status:revision-requested` and say what is
wrong in a comment. The prop stays at its current gate until the rebuild
answers the comment.

### The dimensions

A prop's `scale_dimensions_cm` was measured off the procedural stand-in this
pipeline replaces, and a reconstruction reproduces the proportions of the art
it is built from - so for a prop whose approved art is a different shape from
its stand-in, the mesh measured the art's shape and not the spec's.

**The manifest has been amended to the art's own measurements**, and the
capture was run again against them. The tolerance is still 5% and was not
widened; what changed is the number the check compares against, and the
amendment is written on the issue and in the entry's `dimensions_note`, so it
is visible rather than hidden inside a passing check.

What that means for a review: the dimension check now says the mesh fits the
prop as the art describes it. The question it can no longer answer is whether
the art and the spec ever agreed - they did not, and the art is the prop. If
you think the *art* is wrong, that is a change to the concept art and not to
this pipeline, and the way to say so is to request a revision with what the
prop should look like.
