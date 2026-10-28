# prop_crape_spiked_brolly


> **This asset is held at a gate.** The capture it came from did not pass
> every check, and the renders are here so the finding can be judged, not
> because the asset is approved. The checks that did not pass:

> - width matches the spec (11.9 cm +/- 5%) (64.7 cm)
> - depth matches the spec (11.9 cm +/- 5%) (35 cm)

The verification renders for this prop, produced by

```
node scripts/capture_prop_renders.mjs prop_crape_spiked_brolly --publish
```

- `front.png` - Front (0deg, +Z to camera).
- `profile.png` - Profile (90deg, right side).
- `badge.png` - The crook handle and the ferrule spike.
- `report.json` - the capture report: the budgets, the bounding box and the
  checks the run passed.

The renders are committed at 720x880 so a reviewer can open them straight from
the issue; the full-size versions are written to `test-output/props/` by the
capture script and are not in the repository.

The model itself is `public/models/props/prop_crape_spiked_brolly.glb`, and the spec, the frame contract and
the measured figures are in `data/asset_manifest.json`.
