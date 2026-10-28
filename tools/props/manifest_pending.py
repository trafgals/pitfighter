"""Print the files the manifest names that exist on disk but are not in git.

The manifest may only name files that exist, and a file it names has to be in
the tree for the tests to pass on a clean checkout. This finds the ones that
are on disk but still uncommitted, so a commit can pick them up.

Usage: python manifest_pending.py
"""
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
PREFIXES = ("public/tex/", "public/models/", "docs/props/")


def main():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    tracked = set(subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True,
                                  text=True).stdout.splitlines())
    pending = []
    for asset in manifest["assets"]:
        for value in asset.values():
            if not isinstance(value, str) or not value.startswith(PREFIXES):
                continue
            path = os.path.join(ROOT, value)
            if os.path.exists(path) and value not in tracked and value not in pending:
                pending.append(value)
    for value in pending:
        print(value)


if __name__ == "__main__":
    main()
