#!/usr/bin/env python3
"""
Inspects and manages the next asset generation queue for MiniMax Code (`mcode`).

Loads `data/asset_queue_next.json` and formats assets for:
  1. Inclusion in `data/asset_manifest.json`
  2. Batch processing via `scripts/pipeline_batch_runner.py`
  3. GitHub issue creation with labels: `stage:minimax-code-3d`, `status:turnaround-approved`
"""

import os
import sys
import json
import argparse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
QUEUE_PATH = os.path.join(ROOT, "data", "asset_queue_next.json")
MANIFEST_PATH = os.path.join(ROOT, "data", "asset_manifest.json")

def load_queue():
    with open(QUEUE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def print_summary(queue):
    print("=================================================================")
    print("  Pitfighter: Next Asset Generation Queue for mcode")
    print(f"  Target Worker: {queue.get('target_worker')} (cron {queue.get('target_cron_id')})")
    print("=================================================================\n")
    
    waves = queue.get("waves", {})
    for wname, items in waves.items():
        print(f"[{wname.upper()}] - {len(items)} assets:")
        for it in items:
            tip_str = f" [tip: {it['tip']}]" if "tip" in it else ""
            print(f"  - {it['id']:<32} | {it['name']}{tip_str}")
            print(f"    Dimensions: {it['scale_dimensions_cm']['width']}x{it['scale_dimensions_cm']['height']}x{it['scale_dimensions_cm']['depth']} cm | Budget: {it['poly_budget']} tris")
            print(f"    Prompt: \"{it['prompt'][:75]}...\"\n")

def inject_manifest(queue, dry_run=False):
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    
    existing_ids = {a["id"] for a in manifest.get("assets", [])}
    new_count = 0
    for wname, items in queue.get("waves", {}).items():
        for item in items:
            if item["id"] not in existing_ids:
                entry = {
                    "id": item["id"],
                    "name": item["name"],
                    "character": item.get("character", "Unknown"),
                    "category": item.get("category", "modular_limb"),
                    "slot": item.get("slot", "limb_socket"),
                    "poly_budget": item.get("poly_budget", 30000),
                    "file_budget_bytes": item.get("file_budget_bytes", 1572864),
                    "scale_dimensions_cm": item.get("scale_dimensions_cm", {}),
                    "status": "stage:minimax-code-3d",
                    "pivot": item.get("pivot", {}),
                    "prompt": item.get("prompt", ""),
                    "glb_output": item.get("glb_output", f"public/models/props/{item['id']}.glb")
                }
                manifest.setdefault("assets", []).append(entry)
                new_count += 1
                existing_ids.add(item["id"])
    
    if dry_run:
        print(f"[Dry Run] Would inject {new_count} new assets into {MANIFEST_PATH}")
    else:
        with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print(f"Successfully injected {new_count} new assets into {MANIFEST_PATH}")

def main():
    parser = argparse.ArgumentParser(description="Manage mcode asset generation queue.")
    parser.add_argument("--inject", action="store_true", help="Inject queue assets into data/asset_manifest.json")
    parser.add_argument("--dry-run", action="store_true", help="Preview injection without modifying files")
    args = parser.parse_args()

    queue = load_queue()
    print_summary(queue)
    if args.inject or args.dry_run:
        inject_manifest(queue, dry_run=args.dry_run)

if __name__ == "__main__":
    main()
