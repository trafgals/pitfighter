# weapon_nail_bat


> **This asset is held at a gate.** The capture it came from did not pass
> every check, and the renders are here so the finding can be judged, not
> because the asset is approved. The checks that did not pass:

> - the mesh is one surface, not a pile of shards (4231 of 12233 vertices are duplicates of another vertex (34.6%))
> - the mesh's seams are closed (7908 of 27954 edges are used by only one triangle (28.3%))

The verification renders for this prop, produced by

```
node scripts/capture_prop_renders.mjs weapon_nail_bat --publish
```

- `front.png` - Front (0deg, +Z to camera).
- `profile.png` - Profile (90deg, right side).
- `badge.png` - The iron nails in the bat's face.
- `report.json` - the capture report: the budgets, the bounding box and the
  checks the run passed.

The renders are committed at 720x880 so a reviewer can open them straight from
the issue; the full-size versions are written to `test-output/props/` by the
capture script and are not in the repository.

The model itself is `public/models/props/weapon_nail_bat.glb`, and the spec, the frame contract and
the measured figures are in `data/asset_manifest.json`.
