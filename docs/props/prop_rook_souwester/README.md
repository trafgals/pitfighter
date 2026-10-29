# prop_rook_souwester

The verification renders for this prop, produced by

```
node scripts/capture_prop_renders.mjs prop_rook_souwester --publish
```

- `front.png` - Front (0deg, +Z to camera).
- `profile.png` - Profile (90deg, right side).
- `badge.png` - The oilskin crown and the rear neck flap.
- `report.json` - the capture report: the budgets, the bounding box and the
  checks the run passed.

The renders are committed at 720x880 so a reviewer can open them straight from
the issue; the full-size versions are written to `test-output/props/` by the
capture script and are not in the repository.

The model itself is `public/models/props/prop_rook_souwester.glb`, and the spec, the frame contract and
the measured figures are in `data/asset_manifest.json`.
