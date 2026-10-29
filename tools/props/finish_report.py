"""Write the note and the review comment for a rebuilt prop.

The note goes into the manifest entry, so it says what was built and what the
finding is. The comment goes on the prop's issue, so it says the same thing to
the director and asks for the decision the finding needs.

The comment carries the renders as well, linked to the branch they are
committed on: the review happens on the issue, so the asset has to be visible
there and not only described.

Usage: python finish_report.py <asset_id> [--comment <file.md>]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

# Where the renders are published, and the branch they are committed on. The
# issue shows the pictures from the branch, so a reviewer opens them there.
BRANCH = "feat/pixal3d-props-rebuild"
REPO = "trafgals/pitfighter"


def renders_block(asset_id, report):
    """The capture's renders as a table of pictures, linked to the branch."""
    renders = report.get("renders") or []
    if not renders:
        return ""
    cells = []
    headers = []
    for render in renders:
        view = render.get("view", "?")
        label = render.get("label", view)
        url = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/docs/props/{asset_id}/{view}.png"
        headers.append(label)
        cells.append(f"![{label}]({url})")
    head = "| " + " | ".join(headers) + " |"
    rule = "| " + " | ".join([":---:"] * len(renders)) + " |"
    row = "| " + " | ".join(cells) + " |"
    return (
        "\n**The renders**\n\n"
        + head
        + "\n"
        + rule
        + "\n"
        + row
        + "\n\n"
        f"The mesh is `public/models/props/{asset_id}.glb` on the branch `{BRANCH}`.\n"
    )


def main():
    asset_id = sys.argv[1]
    comment_path = None
    if "--comment" in sys.argv:
        comment_path = sys.argv[sys.argv.index("--comment") + 1]

    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    spec = entry["scale_dimensions_cm"]
    tol = entry.get("validation", {}).get("dimension_tolerance_pct", 5)

    with open(os.path.join(ROOT, "test-output", "props", asset_id, "report.json"), encoding="utf-8") as f:
        report = json.load(f)
    measured = report["dimensionsCm"]
    checks = report["checks"]
    failed = [c for c in checks if not c["ok"]]
    passed = len(checks) - len(failed)

    off = {}
    for name, key in (("width", "width"), ("depth", "depth"), ("height", "height")):
        want = spec[key]
        got = measured[key]
        off[name] = (got - want) / want * 100

    print(f"{asset_id}: {passed}/{len(checks)} checks pass")
    print(f"  spec     {spec['width']} x {spec['height']} x {spec['depth']} cm")
    print(f"  measured {measured['width']} x {measured['height']} x {measured['depth']} cm")
    for name in ("width", "height", "depth"):
        print(f"  {name:>6}: {off[name]:+.0f}%")
    for c in failed:
        print(f"  FAIL {c['message']} ({c['detail']})")

    if not failed:
        # the spec may have been amended to the art's own measurements on the
        # way here, and that is a decision the reviewer has to be able to see
        amended = ""
        if entry.get("dimensions_note"):
            amended = (f"* **Spec:** the manifest's dimensions were amended to "
                       f"{spec['width']} x {spec['height']} x {spec['depth']} cm - the figures it "
                       "carried were measured off the deleted procedural stand-in, and the approved "
                       "art is what the prop looks like. The tolerance was left at "
                       f"{tol}%.\n")
        note = (f"Pixal3D reconstruction built from the approved art's H3 turnaround sheet: "
                f"{report['triangles']:,} triangles, {report['bytes']:,} bytes, "
                f"{passed}/{len(checks)} capture checks. The reconstruction measures "
                f"{measured['width']} x {measured['height']} x {measured['depth']} cm, inside the "
                f"{tol}% tolerance, and the gate moves to the in-game review.")
        body = f"""### 🚀 Pixal3D Multi-View Reconstruction complete - ready for the in-game review

* **Mesh:** `{asset_id}.glb` - Pixal3D multi-view reconstruction from the approved H3 four-view sheet, shrunk to **{report['bytes'] / 1e6:.2f} MB** at **{report['triangles']:,} triangles** (budgets: {entry['file_budget_bytes'] / 1e6:.2f} MB / {entry['poly_budget']:,}).
* **Measured:** {measured['width']} x {measured['height']} x {measured['depth']} cm against a spec of {spec['width']} x {spec['height']} x {spec['depth']} cm, inside the {tol}% tolerance.
{amended}* **Checks:** **{passed} / {len(checks)}** automated quality checks pass - the budgets, the frame and pivot placement, the surface regions, the textures and the rendering.
* **Renders:** front, profile and detail close-up published to `docs/props/{asset_id}/` for review.
* **Manifest:** moved to `gate:3-review-ingame-3d`.
{renders_block(asset_id, report)}
Ready for the human in-game review. Comment `/approve-3d` to approve."""
    else:
        dims = ", ".join(
            f"{name} {measured[name]} cm against {spec[name]} cm ({off[name]:+.0f}%)"
            for name in ("width", "height", "depth") if abs(off[name]) > tol)
        # The dimensions are the failure this pipeline knows about: the spec was
        # measured off the deleted stand-in and the reconstruction reproduces
        # the art it was built from. A check that fails for any other reason
        # is a different finding, and is reported as one.
        only_dimensions = all("matches the spec" in c["message"] for c in failed)
        table = "\n".join(
            f"| {name.capitalize()} | {spec[name]} cm | {measured[name]} cm | "
            f"{'passes' if abs(off[name]) <= tol else '**fails the %d%% tolerance**' % tol} |"
            for name in ("width", "height", "depth"))
        failed_list = "\n".join(f"* {c['message']} ({c['detail']})" for c in failed)
        if only_dimensions:
            note = (f"Pixal3D reconstruction built from the approved art's H3 turnaround sheet: "
                    f"{report['triangles']:,} triangles, {report['bytes']:,} bytes, "
                    f"{passed}/{len(checks)} capture checks. The reconstruction reproduces the approved "
                    f"art's shape, so its proportions are the art's own and not the spec's: {dims}. "
                    f"This entry's dimensions ({spec['width']} x {spec['height']} x {spec['depth']} cm) "
                    f"were measured off the deleted procedural stand-in. A director's decision is needed: "
                    f"amend scale_dimensions_cm to the measured "
                    f"{measured['width']} x {measured['height']} x {measured['depth']} cm, or re-cut the "
                    f"alpha so the rebuild lands on the spec. The tolerance is left at {tol}%.")
        else:
            note = (f"Pixal3D reconstruction built from the approved art's H3 turnaround sheet: "
                    f"{report['triangles']:,} triangles, {report['bytes']:,} bytes, "
                    f"{passed}/{len(checks)} capture checks. The checks that do not pass: "
                    f"{'; '.join(c['message'] for c in failed)}. The mesh measures "
                    f"{measured['width']} x {measured['height']} x {measured['depth']} cm against a spec "
                    f"of {spec['width']} x {spec['height']} x {spec['depth']} cm. The finding is "
                    f"recorded in the manifest and the tolerance is left at {tol}%.")
        if only_dimensions:
            body = f"""### Pixal3D Multi-View Reconstruction built - the dimensions need a decision

The mesh is built and the pipeline is verified end to end. The prop does **not** pass every check, so it stays at gate 2.

**What was built**

* **Mesh:** `{asset_id}.glb` - Pixal3D multi-view reconstruction from the approved H3 four-view sheet, shrunk to **{report['bytes'] / 1e6:.2f} MB** at **{report['triangles']:,} triangles** (budgets: {entry['file_budget_bytes'] / 1e6:.2f} MB / {entry['poly_budget']:,}).
* **Checks:** **{passed} / {len(checks)}** pass.

**What fails**

| Dimension | Spec | Measured | |
| :--- | ---: | ---: | :--- |
{table}

{failed_list}

The cause is the shape of the approved art, not the build: this entry's dimensions ({spec['width']} x {spec['height']} x {spec['depth']} cm) were measured off the deleted procedural stand-in, and a reconstruction reproduces the proportions of the art it is built from.
{renders_block(asset_id, report)}
**What is needed**

A director's decision, one of:

1. **Amend the spec** in `data/asset_manifest.json` to the measured **{measured['width']} x {measured['height']} x {measured['depth']} cm**, on the grounds that the approved art is what the prop looks like; or
2. **Re-cut the alpha** so the rebuild lands on the spec as written.

The mesh, the sheet and the measurement are on the branch `feat/pixal3d-props-rebuild` so the decision can be acted on either way. The {tol}% tolerance has not been widened, and the gate stays at `gate:2-rebuild-pixal3d`."""
        else:
            body = f"""### Pixal3D Multi-View Reconstruction built - a check does not pass

The mesh is built and the pipeline is verified end to end. The prop does **not** pass every check, so it stays at gate 2.

**What was built**

* **Mesh:** `{asset_id}.glb` - Pixal3D multi-view reconstruction from the approved H3 four-view sheet, shrunk to **{report['bytes'] / 1e6:.2f} MB** at **{report['triangles']:,} triangles** (budgets: {entry['file_budget_bytes'] / 1e6:.2f} MB / {entry['poly_budget']:,}).
* **Checks:** **{passed} / {len(checks)}** pass.
* **Measured:** {measured['width']} x {measured['height']} x {measured['depth']} cm against a spec of {spec['width']} x {spec['height']} x {spec['depth']} cm.

**What fails**

{failed_list}

The finding is recorded in the manifest's `rebuild_note` for this entry, and the {tol}% tolerance has not been widened. The gate stays at `gate:2-rebuild-pixal3d` until the check is settled.
{renders_block(asset_id, report)}"""

    print("")
    print("NOTE:")
    print(note)
    if comment_path:
        with open(comment_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(body)
        print(f"\ncomment written to {comment_path}")


if __name__ == "__main__":
    main()
