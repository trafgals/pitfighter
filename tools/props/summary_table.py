"""Print the table of rebuilt props for the pull request.

Every prop the pipeline has rebuilt is in the manifest: its spec, what the
reconstruction measured, the gate it sits at and the note that says what the
finding is. The capture reports hold the check counts.

Usage: python summary_table.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
REPORTS = os.path.join(ROOT, "test-output", "props")

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


def report_of(asset_id):
    path = os.path.join(REPORTS, asset_id, "report.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def measured_of(entry, report):
    """What the mesh measured, from the capture report or the manifest."""
    if report:
        d = report.get("dimensionsCm", {})
        return (d.get("width"), d.get("height"), d.get("depth"))
    box = entry.get("measured") or {}
    lo, hi = box.get("bbox_min_cm"), box.get("bbox_max_cm")
    if not lo or not hi:
        return (None, None, None)
    return tuple(round(hi[i] - lo[i], 1) for i in range(3))


def main():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    print("| prop | issue | triangles | spec (w x h x d) | measured (w x h x d) | checks | gate |")
    print("| :--- | ---: | ---: | :--- | :--- | :--- | :--- |")
    for entry in manifest["assets"]:
        asset_id = entry["id"]
        if asset_id not in ISSUES:
            continue
        report = report_of(asset_id)
        if report is None and "stand_in_measured" in entry:
            # the prop has never been through the pipeline: it is not on the
            # table at all
            continue
        spec = entry["scale_dimensions_cm"]
        got = measured_of(entry, report)
        checks = ""
        if report:
            passed = sum(1 for c in report.get("checks", []) if c.get("ok"))
            total = len(report.get("checks", []))
            checks = f"{passed}/{total}"
        spec_text = f"{spec['width']} x {spec['height']} x {spec['depth']}"
        got_text = " x ".join(str(v) for v in got)
        gate = entry.get("status")
        if entry.get("revision_requested_at") and not entry.get("revision_published_at"):
            # a reviewer has asked for this one to be rebuilt: the mesh on disk
            # is the one that was reviewed, and the new one is on its way
            gate = f"{gate} (rebuilding)"
        print(f"| `{asset_id}` | {ISSUES[asset_id]} | {(entry.get('measured') or {}).get('triangles', 0):,} "
              f"| {spec_text} | {got_text} | {checks} | {gate} |")


if __name__ == "__main__":
    main()
