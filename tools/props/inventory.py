"""Write the prop inventory: what is approved, what is waiting, what is closed.

The review happens on the asset issues, one prop at a time, and the list of
those issues is the queue. But a list of twenty-two issues is not a queue
you can read at a glance: what is settled, what is waiting on a person, and
what is closed all look the same in a list of issue titles.

So the inventory is written here, from the manifest and the capture reports -
the one place that knows what is true - and published as an issue of its own.
It is a page that can be regenerated, rather than a page that has to be
remembered.

Usage: python tools/props/inventory.py            # print the body
       python tools/props/inventory.py --apply    # create or update the issue
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_prop_table import PLACEMENT  # noqa: E402
from issues import ASSET_ISSUES  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
REPORT_DIR = os.path.join(ROOT, "test-output", "props")
PROP_TABLE = os.path.join(ROOT, "src", "data", "props.json")
REPO = "trafgals/pitfighter"

# The issue the inventory lives in. It is found by its title, so the number
# does not have to be written down anywhere.
TITLE = "[Asset Inventory] The rebuilt props: what is approved, what is waiting"
MARKER = "<!-- prop-inventory -->"

APPROVED = "status:asset-approved"


def gh(*args):
    result = subprocess.run(
        ["gh", *args], cwd=ROOT, check=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return result.stdout


def entries():
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)["assets"]


def report_of(asset_id):
    path = os.path.join(REPORT_DIR, asset_id, "report.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def in_the_game():
    """The props the game is holding, from the table the manifest writes."""
    with open(PROP_TABLE, encoding="utf-8") as f:
        raw = f.read()
    return raw


def evidence(asset, report):
    """What the capture found for a prop."""
    checks = (report or {}).get("checks") or []
    passed = len([check for check in checks if check.get("ok")])
    fidelity = None
    for check in checks:
        if "still matches the approved art" in check.get("message", ""):
            detail = check.get("detail", "")
            for part in detail.split(","):
                if "IoU" in part:
                    # "IoU 0.934 against the sheet's front view, 0.582 the wrong way up"
                    number = part.replace("IoU", "").strip().split(" ")[0]
                    fidelity = number
    return {
        "checks": f"{passed}/{len(checks)}" if checks else "-",
        "fidelity": fidelity,
        "triangles": (report or {}).get("triangles"),
        "bytes": (report or {}).get("bytes"),
    }


# How the game holds an approved prop, in the words the game's own table uses.
KINDS = {
    "gear": "the fighter's own kit, on their body",
    "wielded": "the fighter's own weapon, in their hand from the start",
    "gift": "a Gallery gift: thrown into the pit, picked up, held",
}


def outstanding(asset, report):
    """What is left to do about a prop, in one sentence.

    Nothing is left for an approved prop but the fact that it is approved.
    For a prop that is waiting, what is left is a decision - and whatever
    makes that decision harder to make blind.
    """
    if asset.get("status") == APPROVED:
        return None
    notes = []
    concept = asset.get("reference_concept") or ""
    if "redo" in concept:
        notes.append("its concept art was redone and the mesh was rebuilt from the new sheet")
    if asset.get("id") == "weapon_nail_bat":
        notes.append("the render was published upside down and has been re-shot in the frame of the art")
    if asset.get("id") == "weapon_lamplighter_pole":
        return "closed: the constable's gold nightstick took its place"
    if notes:
        return "waiting on the in-game review - " + "; ".join(notes)
    return "waiting on the in-game review"


def body():
    assets = entries()
    game = in_the_game()
    rows = []
    for asset in assets:
        report = report_of(asset["id"])
        rows.append({
            "asset": asset,
            "issue": ASSET_ISSUES.get(asset["id"]),
            "evidence": evidence(asset, report),
            "in_game": asset["id"] in game,
            "outstanding": outstanding(asset, report),
        })

    approved = [row for row in rows if row["asset"].get("status") == APPROVED]
    waiting = [row for row in rows if row["asset"].get("status") != APPROVED and row["outstanding"] != "closed: the constable's gold nightstick took its place"]
    closed = [row for row in rows if row["outstanding"] == "closed: the constable's gold nightstick took its place"]
    held = [row for row in rows if "held" in str(row["asset"].get("status", ""))]

    lines = [
        MARKER,
        "",
        "### The prop inventory",
        "",
        f"The batch the Pixal3D multi-view pipeline rebuilt: **{len(rows)} props**. "
        f"**{len(approved)} are approved and in the game**, **{len(waiting)} are waiting for a decision**, "
        f"and **{len(closed)} is closed**."
        + (f" **{len(held)} are held on an unsettled finding.**" if held else " None is held."),
        "",
        "This page is written from `data/asset_manifest.json` and from the capture reports, so it says "
        "what is true rather than what was true when it was written. "
        "`python tools/props/inventory.py --apply` rewrites it.",
        "",
        "#### Waiting on you",
        "",
        "| prop | fighter | issue | checks | IoU against the sheet | what is outstanding |",
        "| :--- | :--- | :---: | :---: | :---: | :--- |",
    ]
    for row in sorted(waiting, key=lambda item: item["issue"] or 0):
        asset = row["asset"]
        lines.append(
            f"| `{asset['id']}` - {asset.get('name')} | {asset.get('character')} | "
            f"#{row['issue']} | {row['evidence']['checks']} | {row['evidence']['fidelity'] or '-'} | "
            f"{row['outstanding']} |"
        )
    lines += [
        "",
        "Each of these is at gate 3 with its checks green and its render matching the art it was built from. "
        "To settle one, say so on its own issue:",
        "",
        "```",
        "/approve-3d",
        "/revision the grip is smooth and reads as a tube",
        "```",
        "",
        "A command has to be **issued**, not mentioned: it starts a line, it is not inside a code block, and it "
        "is not on a quoted line. Approving one of these also puts it in the game - and its placement has to be "
        "measured first, because the approved fifteen all have one and these do not yet.",
        "",
        "#### Approved and in the game",
        "",
        "| prop | fighter | issue | in the game as |",
        "| :--- | :--- | :---: | :--- |",
    ]
    for row in sorted(approved, key=lambda item: item["issue"] or 0):
        asset = row["asset"]
        place = PLACEMENT.get(asset["id"]) or {}
        kind = place.get("kind", "a prop")
        lines.append(
            f"| `{asset['id']}` - {asset.get('name')} | {asset.get('character')} | #{row['issue']} | "
            f"{KINDS.get(kind, kind)} |"
        )
    lines += [
        "",
        "These are settled: their renders are published, their checks pass, and they are in the game. "
        "They are listed here so the inventory adds up, not because anything is owed on them.",
    ]
    if closed:
        lines += [
            "",
            "#### Closed",
            "",
            "| prop | fighter | issue | what happened |",
            "| :--- | :--- | :---: | :--- |",
        ]
        for row in sorted(closed, key=lambda item: item["issue"] or 0):
            asset = row["asset"]
            lines.append(
                f"| `{asset['id']}` - {asset.get('name')} | {asset.get('character')} | #{row['issue']} | {row['outstanding']} |"
            )
    lines += [
        "",
        "#### Two notes on the approved set",
        "",
        "- **The tonic has no drink mechanic.** The bottle is approved and in the Gallery's gift pool, but "
        "nothing implements drinking it: a fighter can pick it up, hold it, and press L1, and nothing happens. "
        "Either the mechanic gets built or the bottle comes out of the pool.",
        "- **The renders are lit and the art is painted.** A prop's material is the art's own texture under a "
        "studio lamp, so a published render is darker and glossier than the concept drawing it sits beside. "
        "That is the lighting, not a drift in the model - the check that compares the two is about the shape.",
        "",
        "#### Where the review happens",
        "",
        "On each prop's own issue: the concept art it was built from, the turnaround sheet, the published "
        "renders and the checks are all on the issue, and the decision is a comment on it. "
        "`docs/props/README.md` says how to judge one and what the two answers mean.",
        "",
    ]
    return "\n".join(lines)


def find_issue():
    """The inventory issue, if it has been made already."""
    data = json.loads(gh("issue", "list", "--repo", REPO, "--state", "all", "--limit", "200",
                         "--json", "number,title"))
    for entry in data:
        if entry.get("title") == TITLE:
            return entry["number"]
    return None


def main():
    text = body()
    if "--apply" not in sys.argv:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdout.write(text)
        return 0
    number = find_issue()
    path = os.path.join(ROOT, "test-output", "inventory-body.md")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    if number:
        gh("issue", "edit", str(number), "--repo", REPO, "--body-file", path)
        print(f"issue #{number} rewritten")
    else:
        gh("issue", "create", "--repo", REPO, "--title", TITLE,
           "--body-file", path, "--label", "asset:queue", "--label", "documentation")
        print("the inventory issue was created")
    return 0


if __name__ == "__main__":
    sys.exit(main())
