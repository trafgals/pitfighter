# prop_winch_gold_nightstick


> **This asset is held at a gate.** The capture it came from did not pass
> every check, and the renders are here so the finding can be judged, not
> because the asset is approved. The checks that did not pass:

> - triangle count is under budget (16000 < 16000)
> - the close-up is framed on a declared target (the manifest names no closeup_mesh, no closeup_focus and no front feature)
> - the space beside the prop is clear is clear (13 cm2 of surface <= 10)

The verification renders for this prop, produced by

```
node scripts/capture_prop_renders.mjs prop_winch_gold_nightstick --publish
```

- `front.png` - Front (0deg, +Z to camera).
- `profile.png` - Profile (90deg, right side).
- `badge.png` - The gold engraving and the click catch.
- `report.json` - the capture report: the budgets, the bounding box and the
  checks the run passed.

The renders are committed at 720x880 so a reviewer can open them straight from
the issue; the full-size versions are written to `test-output/props/` by the
capture script and are not in the repository.

The model itself is `public/models/props/prop_winch_gold_nightstick.glb`, and the spec, the frame contract and
the measured figures are in `data/asset_manifest.json`.
