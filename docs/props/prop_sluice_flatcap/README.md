# prop_sluice_flatcap


> **This asset is held at a gate.** The capture it came from did not pass
> every check, and the renders are here so the finding can be judged, not
> because the asset is approved. The checks that did not pass:

> - the mesh is one surface, not a pile of shards (4662 of 12438 vertices are duplicates of another vertex (37.5%))
> - the mesh's seams are closed (8500 of 28238 edges are used by only one triangle (30.1%))

The verification renders for this prop, produced by

```
node scripts/capture_prop_renders.mjs prop_sluice_flatcap --publish
```

- `front.png` - Front (0deg, +Z to camera).
- `profile.png` - Profile (90deg, right side).
- `badge.png` - The tweed crown and the copper brim wire.
- `report.json` - the capture report: the budgets, the bounding box and the
  checks the run passed.

The renders are committed at 720x880 so a reviewer can open them straight from
the issue; the full-size versions are written to `test-output/props/` by the
capture script and are not in the repository.

The model itself is `public/models/props/prop_sluice_flatcap.glb`, and the spec, the frame contract and
the measured figures are in `data/asset_manifest.json`.
