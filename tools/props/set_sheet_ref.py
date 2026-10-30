"""Point a prop's manifest entry at the sheet and turntable it was built from.

The manifest may only name files that exist, so a prop's turnaround_sheet and
turntable are recorded once its sheet has been rendered.

The manifest is written under the manifest's lock and put in place in one
step. The mesh chain writes here while the watcher on the issues may be
writing the same file, and a read-modify-write that is not locked loses
whichever of the two changes was made in between.

Usage: python set_sheet_ref.py <asset_id> <sheet_stem>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import manifest_io  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")


def main():
    asset_id, stem = sys.argv[1], sys.argv[2]
    sheet = f"public/tex/props/{stem}.png"
    turntable = f"docs/props/{asset_id}/turntable.webp"
    if not os.path.exists(os.path.join(ROOT, sheet)):
        raise SystemExit(f"{sheet} does not exist")

    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
        entry["turnaround_sheet"] = sheet
        if os.path.exists(os.path.join(ROOT, turntable)):
            entry["turntable"] = turntable
        manifest_io.save(MANIFEST, manifest)
    print(f"{asset_id}: sheet {sheet}")


if __name__ == "__main__":
    main()
