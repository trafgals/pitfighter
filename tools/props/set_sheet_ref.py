"""Point a prop's manifest entry at the sheet and turntable it was built from.

The manifest may only name files that exist, so a prop's turnaround_sheet and
turntable are recorded once its sheet has been rendered.

Usage: python set_sheet_ref.py <asset_id> <sheet_stem>
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")


def main():
    asset_id, stem = sys.argv[1], sys.argv[2]
    sheet = f"public/tex/props/{stem}.png"
    turntable = f"docs/props/{asset_id}/turntable.webp"
    if not os.path.exists(os.path.join(ROOT, sheet)):
        raise SystemExit(f"{sheet} does not exist")

    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    entry["turnaround_sheet"] = sheet
    if os.path.exists(os.path.join(ROOT, turntable)):
        entry["turntable"] = turntable
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"{asset_id}: sheet {sheet}")


if __name__ == "__main__":
    main()
