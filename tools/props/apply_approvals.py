"""Record a human's approval of a rebuilt prop.

The asset issues say how the review is signed off: comment `/approve-3d` on
the issue, or add the label `status:asset-approved`. Nothing read either of
those, so a director's verdict had to be carried into the repository by hand.

This script reads the issues and does that carrying: a prop that has been
approved has its manifest entry moved to `status:asset-approved` and its issue
labels moved with it. It never approves anything itself - it only records an
approval a human has already given.

A comment only counts as an approval when the command starts a line of it.
The pipeline's own comment ends with "Comment `/approve-3d` to approve", and
reading that as an approval approved every prop on its own - so a command has
to be issued, not mentioned. The pipeline's own comments are marked as well,
so they are never read as commands at all.

An approval is only recorded for a prop that has actually reached the in-game
review. Nothing is approved past `gate:3-review-ingame-3d`: a prop held on a
finding has to have the finding settled first, and an approval given on one is
said so on the issue rather than quietly applied.

The manifest is written under the manifest's lock, so an approval that arrives
while the pipeline is recording a prop does not lose the pipeline's change. The
commit is a partial one, naming the manifest, so the pipeline's half-staged
prop is never swept into it.

Usage:
    python tools/props/apply_approvals.py            # what would change
    python tools/props/apply_approvals.py --apply    # make the change
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import git_io  # noqa: E402
import manifest_io  # noqa: E402
from issues import (  # noqa: E402
    APPROVE_3D, APPROVE_TURNAROUND, ASSET_ISSUES, LABEL_APPROVED,
    LABEL_TURNAROUND_APPROVED, gh, issues_command, read_issues,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

GATE_3 = "gate:3-review-ingame-3d"
GATE_2 = "gate:2-review-turnaround"
APPROVED = LABEL_APPROVED

# The labels the pipeline puts on an asset issue. An approval clears them
# all and leaves the approval label in their place.
MANAGED = [
    GATE_2,
    GATE_3,
    "stage:h3-turnaround",
    "stage:pixal3d-mesh",
    "stage:minimax-code-3d",
    "held:finding",
    "asset:3d-built",
]


def capture_passed(asset_id):
    """Whether the prop's capture passed every check."""
    report = os.path.join(ROOT, "test-output", "props", asset_id, "report.json")
    if not os.path.exists(report):
        return False
    with open(report, encoding="utf-8") as f:
        checks = json.load(f).get("checks", [])
    return bool(checks) and all(c.get("ok") for c in checks)


def main():
    apply = "--apply" in sys.argv
    issues = read_issues()
    changed = []
    refused = []

    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        by_id = {a["id"]: a for a in manifest["assets"]}

        for asset_id, number in ASSET_ISSUES.items():
            entry = by_id.get(asset_id)
            if entry is None:
                continue
            issue = issues.get(number)
            if issue is None:
                print(f"  issue #{number} could not be read")
                continue
            approved = issue.has_label(APPROVED) or any(
                issues_command(c["body"], APPROVE_3D) for c in issue.reviewer_comments())
            turnaround = issue.has_label(LABEL_TURNAROUND_APPROVED) or any(
                issues_command(c["body"], APPROVE_TURNAROUND) for c in issue.reviewer_comments())
            glb = os.path.join(ROOT, "public", "models", "props", f"{asset_id}.glb")
            built = os.path.exists(glb)
            status = entry.get("status")

            if approved and status != APPROVED:
                # nothing is approved past the in-game review: a prop that is
                # still queued, or held on a finding, has to be settled first
                if not built or status != GATE_3:
                    refused.append((asset_id, number, status))
                    continue
                changed.append((asset_id, number, status, APPROVED, issue.labels))
                continue
            # the turnaround sign-off moves the issue on, but only once the asset
            # is built and its capture passed: there is nothing to review in game
            # before then
            if turnaround and built and status not in (APPROVED, GATE_3):
                if capture_passed(asset_id) and status != GATE_3:
                    changed.append((asset_id, number, status, GATE_3, issue.labels))

        if not changed and not refused:
            print("no approval has been given that the repository has not recorded")
            return 0

        if changed and apply:
            for asset_id, number, was, now, labels in changed:
                by_id[asset_id]["status"] = now
            manifest_io.save(MANIFEST, manifest)

    for asset_id, number, was, now, labels in changed:
        print(f"{asset_id} (issue #{number}): {was} -> {now}")
        if not apply:
            continue
        # the pipeline's own labels come off, and the approval goes on
        args = ["issue", "edit", str(number)]
        for label in MANAGED:
            if label in labels and label != now:
                args += ["--remove-label", label]
        args += ["--add-label", now]
        gh(*args)
        print(f"  issue #{number} relabelled")

    for asset_id, number, status in refused:
        print(f"{asset_id} (issue #{number}): an approval was given, but the prop is at "
              f"'{status}' rather than '{GATE_3}', so it is not approved")
        if not apply:
            continue
        body = (
            f"### The approval is not applied yet\n\n"
            f"This prop is at `{status}`, not `{GATE_3}`. Nothing is approved past the in-game "
            "review, so the approval has not been recorded and the label "
            f"`{APPROVED}` has not been set.\n\n"
            "If the prop is still queued, wait for the build. If it is held on a finding, the "
            "finding has to be settled first - comment `/revision` with what is wrong and the "
            "prop goes back into the build queue.\n"
            "<!-- pixal3d-pipeline -->"
        )
        gh("issue", "comment", str(number), "--body", body)

    if not apply:
        print("\nnothing was changed: run it again with --apply")
        return 0

    if changed:
        # A partial commit: the manifest and nothing else. The pipeline stages
        # a prop's files one at a time, and a commit that named no paths would
        # take whatever was staged along with it.
        git_io.commit(
            ["data/asset_manifest.json"],
            ["chore(assets): record the approvals given on the asset issues",
             "A director's approval is given on the issue, by comment or by label, and carried "
             "into the manifest here."],
        )
        try:
            git_io.push()
        except RuntimeError as error:
            print(f"  the commit is local but the push failed: {error}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
