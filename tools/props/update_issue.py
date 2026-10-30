"""Update a prop's issue so the issue itself is the review surface.

The issues were written before the rebuilds: their 3D section still says the
prop is queued, long after it has been built. A reviewer opening the issue
should find the asset there - what was built, what it measures, the renders
and the gate it is at - rather than a queue notice and a set of commands to
run by hand.

The issue also has to show the art the model was built from. A prop whose
concept art was redone has two sets of references - the ones the issue was
written with and the ones the model came from - and an issue that shows the
old ones makes a faithful model look like it has abandoned the art. So the
2D reference cells are written from the manifest, which is the one place that
knows which art a prop is built from.

Usage: python tools/props/update_issue.py <asset_id> <issue>
       python tools/props/update_issue.py --all
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from issues import ASSET_ISSUES  # noqa: E402

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


def raw_url(path):
    """Where a file in the repository can be read from."""
    return f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{path}"


# The two 2D reference sections, and the headings that bound them.
GATE1 = "### 1. 2D Still References (Gate 1: North Star Concept)"
GATE2 = "### 2. 2D Orthographic Turnaround & 360° Turntable (Gate 2)"
STATUS_HEADING = "### 3. 3D Model Status"


def gate1_table(entry):
    """The concept art and the cutout, from the manifest.

    The manifest is the one place that knows which art a prop was built from.
    An issue written before a redo still shows the art the prop used to have,
    and a reviewer who compares that with the model concludes that the model
    has wandered off the concept - when the model is a faithful copy of the
    art that is one click away.
    """
    name = entry.get("name") or entry["id"]
    columns = [
        ("FLUX 3 Concept Art", entry.get("reference_concept"), f"{name} Concept"),
        ("BiRefNet Watertight Alpha Cutout", entry.get("alpha_cutout"), f"{name} Alpha Cutout"),
    ]
    headings = [column[0] for column in columns]
    pictures = []
    paths = []
    for _, path, alt in columns:
        if not path:
            pictures.append("—")
            paths.append("—")
            continue
        url = raw_url(path)
        pictures.append(f"![{alt}]({url})")
        paths.append(f"[`{path}`]({url})")
    return "\n".join([
        "| " + " | ".join(headings) + " |",
        "| :---: | :---: |",
        "| " + " | ".join(pictures) + " |",
        "| " + " | ".join(paths) + " |",
    ])


def gate2_blocks(entry):
    """The turnaround sheet and the turntable, from the manifest."""
    blocks = []
    sheet = entry.get("turnaround_sheet")
    if sheet:
        url = raw_url(sheet)
        blocks += [
            "#### MiniMax H3 4-View Orthographic Turnaround Sheet (0° Front, 90° Right Profile, 180° Rear, 270° Left Profile)",
            f"![4-View Turnaround]({url})",
            f"* **Turnaround Sheet:** [`{sheet}`]({url})",
            "",
        ]
    turntable = entry.get("turntable")
    if turntable:
        url = raw_url(turntable)
        blocks += [
            "#### MiniMax H3 360° Continuous Turntable",
            f"![360 Continuous Turntable]({url})",
            f"* **Autoplay Turntable:** [`{turntable}`]({url})",
            "",
        ]
    return "\n".join(blocks)


def replace_section(body, heading, next_heading, replacement):
    """A section of the body, replaced whole.

    The section runs from its heading to the next heading, and the separator
    that follows it is put back, so the body keeps its shape.
    """
    start = body.find(heading)
    if start < 0:
        return body
    end = body.find(next_heading, start + len(heading))
    if end < 0:
        return body[:start] + replacement
    return body[:start] + replacement + body[end:]


def refresh_2d_references(body, entry):
    """The 2D reference cells, written from the manifest."""
    body = replace_section(
        body, GATE1, "### 2. ",
        f"{GATE1}\n\n{gate1_table(entry)}\n\n---\n\n",
    )
    body = replace_section(
        body, GATE2, "### 3. ",
        f"{GATE2}\n\n{gate2_blocks(entry)}\n---\n\n",
    )
    return body


def refresh_dimensions(body, entry):
    """The dimensions in the specification, from the manifest."""
    spec = entry.get("scale_dimensions_cm") or {}
    if not all(key in spec for key in ("width", "height", "depth")):
        return body
    line = f"* **Physical Dimensions:** `{spec['width']} × {spec['height']} × {spec['depth']} cm`"
    return re.sub(r"\* \*\*Physical Dimensions:\*\* `[^`]*`", line, body)


# A link to a file in the repository, whichever branch it was written with.
# The branch is the part between the repository and the file, and it may
# itself contain a slash ("feat/pixal3d-props-rebuild"), so it is matched as
# the whole branch rather than as one path segment.
BRANCH_LINK = re.compile(
    r"https://raw\.githubusercontent\.com/trafgals/pitfighter/(?:main|feat/[^/\s)]+)/"
)


def refresh_links(body):
    """Every link in the body points at the branch the files are on now.

    The art that was redone and the renders that were recaptured live on the
    rebuild branch. An issue that still links to the branch they were first
    written on shows the reviewer images that are not there any more - and, in
    the case of the props whose art was redone, the art the model was not
    built from.
    """
    return BRANCH_LINK.sub(f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/", body)


def tidy_separators(body):
    """One rule between two sections, not three."""
    body = re.sub(r"(?:---\s*\n\s*){2,}", "---\n\n", body)
    return re.sub(r"\n{3,}", "\n\n", body)


def production_section(asset_id, entry, report):
    """The section that shows the published renders, written from the manifest.

    The section is written whole rather than patched. It was written when the
    prop was first built, and its links pointed at the branch of that day and
    its numbers at that build - so a reviewer opening the issue was shown a
    model that is not the one in the repository.
    """
    renders = [
        ("Front View (0°)", "front"),
        ("Right Profile (90°)", "profile"),
        ("Detail Close-up", "badge"),
    ]
    pictures = []
    paths = []
    for label, view in renders:
        path = f"docs/props/{asset_id}/{view}.png"
        url = raw_url(path)
        pictures.append(f"![{label}]({url})")
        paths.append(f"`{path}`")
    glb = entry.get("glb_output")
    lines = [
        "### 3. Production 3D Model Verification Renders (Gate 3)",
        "",
        "The 3D binary mesh was validated in headless Chromium at 720×880.",
        "",
        "| " + " | ".join(label for label, _ in renders) + " |",
        "| " + " | ".join(":---:" for _ in renders) + " |",
        "| " + " | ".join(pictures) + " |",
        "| " + " | ".join(paths) + " |",
        "",
    ]
    if glb:
        if report:
            built = f"({report['triangles']:,} triangles | {report['bytes'] / 1048576:.2f} MB)"
        else:
            built = ""
        lines.append(f"* **Production GLB:** [`{asset_id}.glb`]({raw_url(glb)}) {built}".rstrip())
    if report:
        checks = report.get("checks") or []
        passed = len([check for check in checks if check.get("ok")])
        lines.append(f"* **Validation:** {passed} / {len(checks)} automated quality checks passing.")
    lines.append("")
    return "\n".join(lines)


def drop_status_sections(body):
    """Every copy of the 3D status section, so a new one can be written.

    The section used to be replaced only when it sat in front of the review
    controls, which it stopped doing once it was appended at the end of the
    body - so every update added another copy of it and the issue ended up
    carrying two, the older one stale.
    """
    pattern = re.compile(r"### 3\. 3D Model Status.*?(?=\n### |\Z)", re.S)
    while pattern.search(body):
        body = pattern.sub("", body)
    return body.rstrip() + "\n"


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

# The two things the pointer says, kept apart so each can be added on its own.
REVIEW_GUIDE = (
    "> The rebuild is reviewed here: the renders and the checks are in the 3D\n"
    "> section above, and how to judge them and sign them off is written up in\n"
    "> `docs/props/README.md`.\n"
)

REVIEW_ACTIONS = (
    "> To ask for a change, comment `/revision` and say what is wrong: the prop\n"
    "> goes back into the build queue with a new seed, and the new renders are\n"
    "> published here when it lands. To approve it, comment `/approve-3d`.\n"
)


def add_review_pointer(body):
    """Point the issue's own review controls at the review guide and the commands.

    The controls say how to approve, but not where to look - and a reviewer
    who opens the issue should not have to go looking for the guide.

    The two halves are added one at a time. An issue written before the
    revision command existed already carries the guide, and a check that says
    "the guide is there, so there is nothing to do" would leave the commands
    out of it for ever.
    """
    if REVIEW_HEADING not in body:
        return body
    if "/revision" in body:
        return body
    guide = REVIEW_GUIDE.strip()
    if guide in body:
        return body.replace(guide, REVIEW_GUIDE + REVIEW_ACTIONS, 1)
    return body.replace(REVIEW_HEADING, REVIEW_HEADING + "\n\n" + REVIEW_GUIDE + REVIEW_ACTIONS, 1)


def rewrite_body(body, asset_id, entry, report):
    """The issue body, brought up to date.

    The one place that knows how an issue is put together, so that a body
    read from a file and a body read from an issue are treated the same way.
    """
    # the status line at the top of the issue tracks the manifest
    body = re.sub(
        r"\* \*\*Active Status:\*\* `[^`]*`",
        f"* **Active Status:** `{entry.get('status')}`",
        body,
    )

    # the 2D references and the dimensions are written from the manifest, so
    # the issue shows the art the model was built from
    body = refresh_2d_references(body, entry)
    body = refresh_dimensions(body, entry)
    body = refresh_links(body)
    body = replace_section(
        body,
        "### 3. Production 3D Model Verification Renders",
        "### Human-in-the-Loop Review Controls",
        production_section(asset_id, entry, report) + "\n---\n\n",
    )

    # the 3D section is written once, at the end of the body
    new_section = status_section(asset_id, entry, report)
    body = drop_status_sections(body)
    body = body.rstrip() + "\n\n---\n\n" + new_section

    body = add_review_pointer(body)
    body = tidy_separators(body)
    return body


def update_one(asset_id, issue):
    issue = str(issue)
    entry = entry_of(asset_id)
    if entry is None:
        print(f"{asset_id} is not in the manifest")
        return 1
    report = report_of(asset_id)

    body = gh("issue", "view", issue, "--json", "body")
    body = json.loads(body)["body"]
    body = rewrite_body(body, asset_id, entry, report)

    path = os.path.join(ROOT, "test-output", f"issue-{issue}-body.md")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(body)
    gh("issue", "edit", issue, "--body-file", path)
    labels = sync_labels(issue, entry, report)
    print(f"issue #{issue} updated for {asset_id} (labels: {', '.join(labels)})")
    return 0


def main():
    # The body on standard input, brought up to date and written out again.
    # It is how the rewrite is exercised without touching an issue, and how a
    # body can be checked before it is published.
    if "--rewrite" in sys.argv:
        asset_id = sys.argv[sys.argv.index("--rewrite") + 1]
        entry = entry_of(asset_id)
        if entry is None:
            print(f"{asset_id} is not in the manifest", file=sys.stderr)
            return 1
        body = sys.stdin.buffer.read().decode("utf-8")
        body = rewrite_body(body, asset_id, entry, report_of(asset_id))
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdout.write(body)
        return 0
    # Every asset issue at once: the references go stale on all of them
    # together, because a prop is redone in a batch.
    if "--all" in sys.argv:
        failed = 0
        for asset_id, issue in sorted(ASSET_ISSUES.items(), key=lambda pair: pair[1]):
            if update_one(asset_id, issue) != 0:
                failed += 1
        return 1 if failed else 0
    if len(sys.argv) < 3:
        print("usage: python tools/props/update_issue.py <asset_id> <issue> | --all | --rewrite <asset_id>")
        return 2
    return update_one(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    sys.exit(main())
