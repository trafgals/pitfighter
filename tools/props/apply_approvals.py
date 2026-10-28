"""Record a human's approval of a rebuilt prop.

The asset issues say how the review is signed off: comment `/approve-3d` on
the issue, or add the label `status:asset-approved`. Nothing read either of
those, so a director's verdict had to be carried into the repository by hand.

This script reads the issues and does that carrying: a prop that has been
approved has its manifest entry moved to `status:asset-approved` and its issue
labels moved with it. It never approves anything itself - it only records an
approval a human has already given.

Usage:
    python tools/props/apply_approvals.py            # what would change
    python tools/props/apply_approvals.py --apply    # make the change
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

# the props this pipeline rebuilds, and the issue each is tracked on
ISSUES = {
    "prop_pegg_cast_iron_last": 83,
    "prop_crape_spiked_brolly": 84,
    "prop_eleanor_weeping_rapier": 85,
    "prop_tilly_clinker_tongs": 86,
    "prop_sluice_flatcap": 87,
    "prop_kilnworth_nursecap": 88,
    "prop_mule_championship_belt": 89,
    "prop_rook_souwester": 90,
    "prop_bulwark_pistons": 91,
    "prop_crump_samovar": 92,
    "weapon_knuckleduster": 93,
    "weapon_coal_shovel": 94,
    "weapon_bone_saw": 95,
    "weapon_nail_bat": 96,
    "weapon_cleaver": 97,
    "weapon_piston_gauntlet": 98,
    "weapon_lamplighter_pole": 99,
    "pickup_tonic": 101,
}

GATE_3 = "gate:3-review-ingame-3d"
GATE_2 = "gate:2-review-turnaround"
APPROVED = "status:asset-approved"


def gh(*args):
    # gh writes UTF-8, and an issue body carries characters the system's own
    # codec cannot read, so the decoding is not left to the default.
    result = subprocess.run(
        ["gh", *args], cwd=ROOT, check=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return result.stdout


def entries():
    """The manifest, and its assets by id."""
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    assets = manifest if isinstance(manifest, list) else manifest["assets"]
    return manifest, {a["id"]: a for a in assets}


def write_manifest(manifest):
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")


def issue_state(issue):
    data = json.loads(gh("issue", "view", str(issue), "--json", "labels,comments"))
    labels = [label["name"] for label in data.get("labels", [])]
    comments = [c.get("body", "") for c in data.get("comments", [])]
    approved = APPROVED in labels or any("/approve-3d" in body for body in comments)
    turnaround = any("/approve-turnaround" in body for body in comments)
    return labels, approved, turnaround


def main():
    apply = "--apply" in sys.argv
    manifest, by_id = entries()
    changed = []

    for asset_id, issue in ISSUES.items():
        entry = by_id.get(asset_id)
        if entry is None:
            continue
        labels, approved, turnaround = issue_state(issue)
        glb = os.path.join(ROOT, "public", "models", "props", f"{asset_id}.glb")
        built = os.path.exists(glb)
        status = entry.get("status")

        if approved and built and status != APPROVED:
            changed.append((asset_id, issue, status, APPROVED, labels))
            continue
        # the turnaround sign-off moves the issue on, but only once the asset
        # is built and its capture passed: there is nothing to review in game
        # before then
        if turnaround and built and status == APPROVED:
            continue
        if turnaround and built and GATE_2 in labels and status not in (APPROVED,):
            report = os.path.join(ROOT, "test-output", "props", asset_id, "report.json")
            passed = False
            if os.path.exists(report):
                with open(report, encoding="utf-8") as f:
                    checks = json.load(f).get("checks", [])
                passed = bool(checks) and all(c.get("ok") for c in checks)
            if passed:
                changed.append((asset_id, issue, status, GATE_3, labels))

    if not changed:
        print("no approval has been given that the repository has not recorded")
        return 0

    for asset_id, issue, was, now, labels in changed:
        print(f"{asset_id} (issue #{issue}): {was} -> {now}")
        if not apply:
            continue
        entry = by_id[asset_id]
        entry["status"] = now
        write_manifest(manifest)
        if APPROVED in now:
            gh("issue", "edit", str(issue), "--remove-label", GATE_3, "--remove-label", GATE_2,
               "--add-label", APPROVED)
        else:
            gh("issue", "edit", str(issue), "--remove-label", GATE_2, "--add-label", GATE_3)
        print(f"  issue #{issue} relabelled")

    if apply:
        subprocess.run(["git", "add", "--", "data/asset_manifest.json"], cwd=ROOT, check=True)
        subprocess.run(
            ["git", "commit", "-m", "chore(assets): record the approvals given on the asset issues",
             "-m", "A director's approval is given on the issue, by comment or by label, and carried into the manifest here."],
            cwd=ROOT, check=True,
        )
    else:
        print("\nnothing was changed: run it again with --apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
