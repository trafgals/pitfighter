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
| `status:revision-requested` | a reviewer has asked for the prop to be rebuilt |
| `stage:h3-turnaround` | the turnaround sheet is still being generated |
| `stage:pixal3d-mesh` | the sheet is done and the mesh is being generated |
| `gate:2-review-turnaround` | the prop is still before its 3D gate |
| `status:asset-approved` | a human has signed it off |

A prop that has no 3D asset yet has no picture on its issue, and that is the
truth of it rather than a gap in the review: it has not been built.

### The inventory

A list of issue titles is the queue, but it is not one you can read at a glance:
what is settled, what is waiting on a person and what is closed all look alike
in it. So the batch is also written up as a single page - the **Asset Inventory**
issue, #108 - that says what is approved, what is waiting and what is closed,
with the issue each prop is judged on.

That page is generated, not written by hand:

```bash
python tools/props/inventory.py            # print the body
python tools/props/inventory.py --apply    # create or update the issue
```

It is written from `data/asset_manifest.json` and from the capture reports, so
it says what is true rather than what was true when it was last regenerated.
`tests/prop_inventory.test.ts` holds it against the manifest, the capture
reports and the game's own prop table, so an inventory that stops adding up
fails the suite rather than misleading the next reader.

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

   The renders are shown in the frame of the art the prop was built from, so
   the two can be compared directly. A reconstruction is turned over before
   it is conditioned on, so some meshes are stored the other way up from
   their art and some are rolled: the capture turns the prop back into the
   art's frame before it photographs it. If a render ever shows up the wrong
   way round again, that is a defect in the capture, not a prop that has
   wandered off the concept art.

   The section 1 references are written from the manifest, which is the one
   place that knows which art a prop was built from. A prop whose art was
   redone has two sets of references, and the issue shows the current one.
3. **Read the checks.** `report.json` lists every check the capture ran and
   whether it passed. The ones that matter to a reviewer are the dimensions
   against the spec, the triangle and byte budgets, the validation boxes
   that hold the prop's business end in frame, and the check that the render
   still matches the art - the model's silhouette against the front tile of
   the sheet it was built from, and against that tile turned over.

   Two of the checks are about the mesh as a surface rather than about its
   size: **the mesh is one surface, not a pile of shards**, and **the mesh's
   seams are closed**. They are there because a reconstruction can come back
   fragmented - every piece of the surface carrying its own copy of the
   vertices it touches - and it then renders as a surface covered in dark
   seams, with a baked texture that is a patchwork, while its triangle count,
   its dimensions and its frame are all exactly right. The nurse's cap is
   the case that matters: it passed twenty-one of twenty-one checks with
   35% of its vertices duplicated, and it looked as if it had been shot
   through. A mesh that is in pieces is not one, and now it does not pass.
4. **Decide.**

### The two things a reviewer can say

Both are said **on the prop's issue**, as a comment. The watcher on the issues
polls them every two minutes and carries what it finds into the manifest and
the labels.

#### Approve it

Comment this on the issue:

```
/approve-3d
```

or add the label `status:asset-approved` to the issue. Either one is an
approval; they mean the same thing, and the label is easier to add from the
issue list.

What the pipeline does with it: the prop's status in `data/asset_manifest.json`
becomes `status:asset-approved`, and the issue's labels follow - the pipeline's
own labels (`asset:3d-built`, `gate:3-review-ingame-3d`) come off and
`status:asset-approved` goes on.

**Nothing is approved past `gate:3-review-ingame-3d`.** An approval given on a
prop that is still queued, or that is held on a finding that has not been
settled, is not applied - the pipeline says so on the issue rather than
quietly doing it. Settle the finding first, or wait for the build.

To do it by hand instead:

```bash
python tools/props/apply_approvals.py          # what it would change
python tools/props/apply_approvals.py --apply  # do it
```

The pipeline never approves anything itself - it only records an approval a
human has already given.

#### Ask for a revision

Comment this on the issue, and say what is wrong:

```
/revision the blade is the wrong shape - it should be a sawback, not a straight edge
```

What is rebuilt is the **mesh**. The approved art is the prop, and the art is
not the pipeline's to change: if the art itself is wrong, say so in the
comment and the prop waits for new art rather than being rebuilt from the same
sheet.

What happens next, in order:

1. The watcher picks the request up (within about two minutes) and puts the
   prop back into the build queue with a **new seed**. The reconstruction that
   was reviewed is not reused - the same approved sheet is reconstructed again
   with a different seed, so it is a different mesh rather than the same one.
2. The issue is relabelled `stage:pixal3d-mesh`, and the pipeline replies on
   the issue saying the revision is in the queue and which seed it is using.
3. The mesh chain builds it. The seed is **claimed**, so the rebuild is built
   exactly once even if two passes of the chain see it at the same time.
4. Until the rebuilt mesh lands, the prop is left alone - the old mesh is the
   one that was reviewed, and publishing it again would only republish what
   the reviewer has already seen.
5. The capture runs again against the new mesh, the renders are published to
   `docs/props/<asset_id>/`, the prop is committed, and the new renders are
   commented on the same issue with the checks it passed.

The label `status:revision-requested` says the same thing to anyone scanning
the list, and is put on when the request is picked up.

To do the re-queue by hand instead:

```bash
python tools/props/request_revision.py          # what would be re-queued
python tools/props/request_revision.py --apply  # re-queue it
```

#### How a command is read

A command has to be **issued**, not mentioned. It is read when:

- it starts a line of the comment - "Comment `/approve-3d` to approve" is
  someone talking about it, not someone saying it
- it is not inside a fenced code block - the example in this guide is an
  example, and pasting it back must not start a rebuild
- it is not on a quoted line (`> /approve-3d`) - that is someone repeating
  something else
- the comment is not the pipeline's own - every comment the pipeline leaves
  carries an invisible marker and is never read as a command

An invisible byte order mark at the start of a line does not stop a command
from being read - a comment written from a Windows shell picks one up without
anyone noticing, and a reviewer whose command was ignored would have no idea
why.

These rules are held down by `tests/prop_review.test.ts`.

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
