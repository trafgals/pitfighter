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

## Why it is a script

The resize used to be done by hand, and it was done wrong: the Smelt's renders
went into the repository at 900x1100 and had to be corrected in a follow-up
PR (#51). A step that is done by hand is a step that gets done differently
twice. Doing it in the pipeline makes the committed size a property of the
pipeline instead of of whoever ran it.

The renders committed before this step existed were resized with the same
Lanczos filter by a tool outside the repository, so they are the same picture
as this step produces but not the same bytes. New renders come from the
script.
