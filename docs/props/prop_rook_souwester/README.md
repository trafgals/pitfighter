# prop_rook_souwester


> **This asset is held at a gate.** The capture it came from did not pass
> every check, and the renders are here so the finding can be judged, not
> because the asset is approved. The checks that did not pass:

> - the mesh is one surface, not a pile of shards (5681 of 13404 vertices are duplicates of another vertex (42.4%))
> - the mesh's seams are closed (10082 of 29035 edges are used by only one triangle (34.7%))

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
