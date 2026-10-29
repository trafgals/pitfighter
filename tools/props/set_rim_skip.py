"""Tell the capture that a head-socket prop has no crown rim to measure.

A reconstruction is one welded surface with no parts to name, so the capture's
default of a mesh called Crown_Opening_Rim can never be found in one. Naming
an empty rim says the check does not apply to this prop, the same way it does
not apply to a grip-normalized one.

Usage: python set_rim_skip.py [asset_id ...]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import manifest_io  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

# the props being rebuilt. The two helmets that were made by hand keep their
# crown opening rim, and the check that goes with it.
REBUILDING = {
    "prop_pegg_cast_iron_last", "prop_crape_spiked_brolly", "prop_eleanor_weeping_rapier",
    "prop_tilly_clinker_tongs", "prop_sluice_flatcap", "prop_kilnworth_nursecap",
    "prop_mule_championship_belt", "prop_rook_souwester", "prop_bulwark_pistons",
    "prop_crump_samovar", "weapon_knuckleduster", "weapon_coal_shovel", "weapon_bone_saw",
    "weapon_nail_bat", "weapon_cleaver", "weapon_piston_gauntlet",
    "weapon_lamplighter_pole", "pickup_tonic",
}


def main():
    wanted = sys.argv[1:]
    changed = []

    # The manifest is written under its lock and put in place in one step: the
    # finish chain and the watcher on the issues both write this file.
    def change(manifest):
        for entry in manifest["assets"]:
            if wanted and entry["id"] not in wanted:
                continue
            if entry.get("pivot", {}).get("convention") != "head_socket_normalized":
                continue
            if not entry.get("validation"):
                continue
            if entry["id"] not in REBUILDING:
                # a prop that was made by hand keeps its crown opening rim, and
                # the check that goes with it
                validation = entry["validation"]
                if validation.get("rim_mesh") != "Crown_Opening_Rim":
                    validation["rim_mesh"] = "Crown_Opening_Rim"
                    changed.append(f"{entry['id']} (restored)")
                if list(validation)[0] != "rim_mesh":
                    # keep the entry's own key order, so the diff stays small
                    ordered = {"rim_mesh": validation.pop("rim_mesh")}
                    ordered.update(validation)
                    entry["validation"] = ordered
                    changed.append(f"{entry['id']} (reordered)")
                continue
            if entry["validation"].get("rim_mesh") == "":
                continue
            entry["validation"]["rim_mesh"] = ""
            changed.append(entry["id"])

    # the change is always applied: it is idempotent, and a prop that is
    # already right is not changed by it
    manifest_io.update(MANIFEST, change)
    for asset_id in changed:
        print(f"{asset_id}: no crown opening rim to measure")


if __name__ == "__main__":
    main()
