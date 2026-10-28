"""Update a prop's issue so the issue itself is the review surface.

The issues were written before the rebuilds: their 3D section still says the
prop is queued, long after it has been built. A reviewer opening the issue
should find the asset there - what was built, what it measures, the renders
and the gate it is at - rather than a queue notice and a set of commands to
run by hand.

Usage: python tools/props/update_issue.py <asset_id> <issue>
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
REPORT_DIR = os.path.join(ROOT, "test-output", "props")

BRANCH = "feat/pixal3d-props-rebuild"
REPO = "trafgals/pitfighter"


def gh(*args):
    # gh writes UTF-8, and an issue body carries characters the system's own
    # codec cannot read, so the decoding is not left to the default.
    result = subprocess.run(
        ["gh", *args], cwd=ROOT, check=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return result.stdout


def entry_of(asset_id):
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    assets = manifest if isinstance(manifest, list) else manifest["assets"]
    return next((a for a in assets if a["id"] == asset_id), None)


def report_of(asset_id):
    path = os.path.join(REPORT_DIR, asset_id, "report.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def render_links(asset_id):
    """The published renders, linked to the branch they are committed on."""
    report = report_of(asset_id)
    if not report:
        return ""
    renders = report.get("renders") or []
    if not renders:
        return ""
    links = []
    for render in renders:
        view = render.get("view", "?")
        label = render.get("label", view)
        url = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/docs/props/{asset_id}/{view}.png"
        links.append(f"[{label}]({url})")
    return " | ".join(links)


def status_section(asset_id, entry, report):
    """The 3D section of the issue body, from what was actually built."""
    if not report:
        return (
            "### 3. 3D Model Status (Gate 3: Pixal3D Rebuild Queue)\n"
            "\n"
            "* **Pipeline Queue:** This asset is queued for Pixal3D multi-view reconstruction on branch "
            f"`{BRANCH}`.\n"
        )
    spec = entry["scale_dimensions_cm"]
    measured = report["dimensionsCm"]
    tol = entry.get("validation", {}).get("dimension_tolerance_pct", 5)
    checks = report.get("checks", [])
    failed = [c for c in checks if not c.get("ok")]
    passed = len(checks) - len(failed)

    off = []
    for name in ("width", "height", "depth"):
        want, got = spec[name], measured[name]
        if want and abs(got - want) / want * 100 > tol:
            off.append(f"{name} {got} cm against {want} cm ({(got - want) / want * 100:+.0f}%)")

    lines = [
        "### 3. 3D Model Status (Gate 3: Pixal3D Rebuild Queue)",
        "",
        f"* **Built:** `{asset_id}.glb` - Pixal3D multi-view reconstruction from the approved H3 four-view "
        f"sheet, shrunk to **{report['bytes'] / 1e6:.2f} MB** at **{report['triangles']:,} triangles** "
        f"(budgets: {entry['file_budget_bytes'] / 1e6:.2f} MB / {entry['poly_budget']:,}).",
        f"* **Measured:** {measured['width']} x {measured['height']} x {measured['depth']} cm against a spec of "
        f"{spec['width']} x {spec['height']} x {spec['depth']} cm.",
    ]
    if off:
        lines.append(
            f"* **Off the spec:** {', '.join(off)}. The spec was measured off the deleted procedural stand-in, "
            "and a reconstruction reproduces the proportions of the approved art it is built from, so this needs "
            "a director's decision - amend the spec or re-cut the alpha. The tolerance is left at "
            f"{tol}%."
        )
    lines.append(f"* **Checks:** **{passed} / {len(checks)}** automated quality checks pass.")
    links = render_links(asset_id)
    if links:
        lines.append(f"* **Renders:** {links}")
    lines.append(
        f"* **Gate:** `{entry.get('status')}`"
        + (" - held for the decision above." if off else " - ready for the in-game review.")
    )
    lines.append("")
    return "\n".join(lines)


def main():
    asset_id, issue = sys.argv[1], sys.argv[2]
    entry = entry_of(asset_id)
    if entry is None:
        print(f"{asset_id} is not in the manifest")
        return 1
    report = report_of(asset_id)

    body = gh("issue", "view", issue, "--json", "body")
    body = json.loads(body)["body"]

    # the status line at the top of the issue tracks the manifest
    body = re.sub(
        r"\* \*\*Active Status:\*\* `[^`]*`",
        f"* **Active Status:** `{entry.get('status')}`",
        body,
    )

    # the 3D section is replaced whole, from its heading to the review controls
    new_section = status_section(asset_id, entry, report)
    pattern = re.compile(r"### 3\. 3D Model Status.*?(?=### Human-in-the-Loop Review Controls)", re.S)
    if pattern.search(body):
        body = pattern.sub(new_section + "\n---\n\n", body)
    else:
        body = body.rstrip() + "\n\n---\n\n" + new_section

    path = os.path.join(ROOT, "test-output", f"issue-{issue}-body.md")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(body)
    gh("issue", "edit", issue, "--body-file", path)
    print(f"issue #{issue} updated for {asset_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
