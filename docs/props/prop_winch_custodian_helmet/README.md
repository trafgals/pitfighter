# prop_winch_custodian_helmet

The verification renders for the Victorian Custodian Bobby Helmet, produced by

```
node scripts/capture_prop_renders.mjs prop_winch_custodian_helmet
```

- `front.png` - the helmet from the front, on the head socket's frame.
- `profile.png` - the helmet from the side.
- `badge.png` - the badge close-up: the eight-point plate with its fluted
  rays, the raised ring and the five-point centre star.
- `report.json` - the capture report: the budgets, the bounding box and the
  eighteen checks the run passed.

The renders are committed at 720x880 so a reviewer can open them straight from
the issue; the full-size versions are written to `test-output/props/` by the
capture script and are not in the repository.

The model itself is `public/models/props/prop_winch_custodian_helmet.glb`, and
the spec, the frame contract and the measured figures are in
`data/asset_manifest.json`.
