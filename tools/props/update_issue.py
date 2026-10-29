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

# The labels the pipeline manages on an asset issue, and nothing else. A
# reviewer's own labels - an approval, a revision request - are left alone.
MANAGED_LABELS = [
    "gate:2-review-turnaround",
    "gate:3-review-ingame-3d",
    "stage:h3-turnaround",
    "stage:pixal3d-mesh",
    "stage:minimax-code-3d",
    "held:finding",
    "asset:3d-built",
]


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


def render_table(asset_id):
    """The published renders, as a table of pictures.

    The reviewer is on the issue, not on the branch, so the prop is put in
    front of them there rather than as links they have to follow.
    """
    report = report_of(asset_id)
    if not report:
        return ""
    renders = report.get("renders") or []
    if not renders:
        return ""
    labels = []
    cells = []
    for render in renders:
        view = render.get("view", "?")
        label = render.get("label", view)
        url = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/docs/props/{asset_id}/{view}.png"
        labels.append(label)
        cells.append(f"![{label}]({url})")
    return (
        "| " + " | ".join(labels) + " |\n"
        "| " + " | ".join(":---:" for _ in labels) + " |\n"
        "| " + " | ".join(cells) + " |\n"
    )


def labels_for(entry, report):
    """The labels an asset issue carries, from what has actually been built.

    The issue list is the review surface, so the label has to say whether
    there is a 3D asset to look at. A prop that has been rebuilt carries
    `asset:3d-built`, and whether it also needs a decision is a second label
    rather than a second gate: a prop held on a finding is still at gate 2,
    and saying so with a gate label would claim a gate it has not reached.
    """
    if report:
        labels = ["asset:3d-built"]
        if any(not c.get("ok") for c in report.get("checks", [])):
            labels.append("held:finding")
        else:
            labels.append("gate:3-review-ingame-3d")
        return labels
    if entry.get("turnaround_sheet"):
        # the sheet is made; the mesh is the one still to come
        return ["stage:pixal3d-mesh", "gate:2-review-turnaround"]
    return ["stage:h3-turnaround", "gate:2-review-turnaround"]


def sync_labels(issue, entry, report):
    """Put the issue's labels in line with what the manifest says.

    The label used to be the same on every asset issue, so a prop with a
    built 3D asset and a prop still waiting for one looked alike in the
    list. It is the label the reviewer scans, so it carries the state.
    """
    labels = labels_for(entry, report)
    current = json.loads(gh("issue", "view", str(issue), "--json", "labels"))["labels"]
    names = [label["name"] for label in current]
    if "status:asset-approved" in names:
        # a human has signed this one off; leave their labels alone
        return labels
    if sorted(names) == sorted(set(names) & set(MANAGED_LABELS) | set(labels)):
        return labels

    args = ["issue", "edit", str(issue)]
    for label in MANAGED_LABELS:
        if label in names and label not in labels:
            args += ["--remove-label", label]
    for label in labels:
        if label not in names:
            args += ["--add-label", label]
    if len(args) > 3:
        gh(*args)
    return labels


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
    elif entry.get("dimensions_note"):
        lines.append(
            f"* **Spec:** the dimensions were amended to {spec['width']} x {spec['height']} x {spec['depth']} cm - "
            "the figures the manifest carried were measured off the deleted procedural stand-in, and the approved "
            f"art is what the prop looks like. The tolerance was left at {tol}%."
        )
    lines.append(f"* **Checks:** **{passed} / {len(checks)}** automated quality checks pass.")
    table = render_table(asset_id)
    if table:
        lines.append("* **Renders:** the verification renders, below and in the comment.")
        lines.append("")
        lines.append(table.rstrip("\n"))
        lines.append("")
    lines.append(
        f"* **Gate:** `{entry.get('status')}`"
        + (" - held for the decision above." if off else " - ready for the in-game review.")
    )
    lines.append("")
    return "\n".join(lines)


REVIEW_HEADING = "### Human-in-the-Loop Review Controls"

REVIEW_POINTER = (
    "\n\n"
    "> The rebuild is reviewed here: the renders and the checks are in the 3D\n"
    "> section above, and how to judge them and sign them off is written up in\n"
    "> `docs/props/README.md`.\n"
    ">\n"
    "> To ask for a change, comment `/revision` and say what is wrong: the prop\n"
    "> goes back into the build queue with a new seed, and the new renders are\n"
    "> published here when it lands. To approve it, comment `/approve-3d`.\n"
)


def add_review_pointer(body):
    """Point the issue's own review controls at the review guide.

    The controls say how to approve, but not where to look - and a reviewer
    who opens the issue should not have to go looking for the guide.
    """
    if "docs/props/README.md" in body:
        return body
    if REVIEW_HEADING not in body:
        return body
    return body.replace(REVIEW_HEADING, REVIEW_HEADING + REVIEW_POINTER, 1)


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

    body = add_review_pointer(body)

    path = os.path.join(ROOT, "test-output", f"issue-{issue}-body.md")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(body)
    gh("issue", "edit", issue, "--body-file", path)
    labels = sync_labels(issue, entry, report)
    print(f"issue #{issue} updated for {asset_id} (labels: {', '.join(labels)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
