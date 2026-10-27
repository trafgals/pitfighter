# prop_smelt_stovepipe

The verification renders for the Ironmaster Chimney Stovepipe Hat, produced by

```
node scripts/capture_prop_renders.mjs prop_smelt_stovepipe
```

- `front.png` - the hat from the front, on the head socket's frame: the crown's
  head-entry rim on the origin's plane, the brim's droop marking the front, and
  the chimney stack running up the middle.
- `profile.png` - the hat from the side, where the chimney's flare and the
  brim's fall read most clearly.
- `badge.png` - the close-up. It is the gold band and its chased scrollwork for
  this asset; the capture script writes the close-up under that name for every
  asset it renders.
- `report.json` - the capture report: the budgets, the bounding box, the mesh
  list and the eighteen checks the run passed.

The renders are committed at 720x880 so a reviewer can open them straight from
the issue; the full-size versions are written to `test-output/props/` by the
capture script and are not in the repository.

The model itself is `public/models/props/prop_smelt_stovepipe.glb`, and
the spec, the frame contract and the measured figures are in
`data/asset_manifest.json`.
