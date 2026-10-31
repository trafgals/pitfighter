"""Write the game's prop table: the approved props, and where each one goes.

The manifest knows which props exist, what they measure and what they are for.
The game needs to know something the manifest cannot say: which fighter wears
a prop, which piece of kit it replaces, and where on that fighter it stands.

Only approved props go in the table. A prop that is still being built, or
that a reviewer has asked to be redone, is not in the game - the human's
approval on the issue is what puts an asset in, and the manifest carries that
approval as `status:asset-approved`.

The table is `src/data/props.json`, and the game reads it the way it reads
`src/data/characters.json`: as data, committed with the game.

Usage:
    python tools/props/build_prop_table.py            # write the table
    python tools/props/build_prop_table.py --check    # is it up to date?
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")
CHARACTERS = os.path.join(ROOT, "src", "data", "characters.json")
TABLE = os.path.join(ROOT, "src", "data", "props.json")

APPROVED = "status:asset-approved"

# Where each approved prop goes, and what it is.
#
# `kind` is how the game treats it:
#   gear     it rides on a bone, and replaces a piece of the fighter's kit
#   wielded  it is the fighter's own weapon, in their hand from the start
#   gift     it belongs to the Gallery: thrown into the pit, picked up, held
#
# `bone` is the bone it rides on, `offset` where on that bone, and `turn` the
# rotation in radians. The offsets are the ones the procedural gear used, so a
# 3D prop stands exactly where the stand-in stood.
#
# `scale` is how much bigger the prop is than the asset the pipeline built.
# The fighters have big heads, so a realistic helmet has to be grown to cover
# one; a weapon is left at its own size.
#
# `gear` is the piece of kit it replaces - the game's own word for it, from
# the fighter's `kit.gear` list.
#
# A weapon in the hand points along the forearm: the hand's -y runs from the
# wrist towards the elbow and on up the arm, and in the guard the forearm
# points up and forward. So a weapon whose business end is its +y is turned
# about x by half a turn, and one whose business end is its -x (the tongs'
# jaws, the shoe last's toe) is turned about z by a quarter turn.
PLACEMENT = {
    "prop_winch_custodian_helmet": {
        "kind": "gear", "fighter": "constable-winch", "gear": "custodian",
        # the helmet's base opening sits on the origin's plane, and the brim
        # dips below it, so the rim goes just above the brow
        "bone": "head", "offset": [0, 0.26, 0], "turn": [0, 0, 0], "scale": 1.55,
    },
    "prop_smelt_stovepipe": {
        "kind": "gear", "fighter": "hezekiah-smelt", "gear": "stovepipe",
        "bone": "head", "offset": [0, 0.28, 0], "turn": [0, 0, 0], "scale": 1.25,
    },
    "prop_mule_championship_belt": {
        "kind": "gear", "fighter": "bartholomew-mule", "gear": "title",
        "bone": "spine", "offset": [0, 0.08, 0], "turn": [0, 0, 0], "scale": 1.3,
    },
    "prop_bulwark_pistons": {
        # the asset is a matched pair of rams in one mesh, and the kit's pistons
        # are one on each forearm: the loader splits it in half
        "kind": "gear", "fighter": "lady-bulwark", "gear": "pistons",
        "bone": "forearms", "offset": [0, -0.135, 0], "turn": [0, 0, 0], "scale": 1,
    },
    "prop_pegg_cast_iron_last": {
        "kind": "wielded", "fighter": "tabitha-pegg", "gear": "",
        # the toe points forward, so the last is held by the ankle with its
        # toe leading
        "bone": "hand", "offset": [0, -0.3, 0], "turn": [0, 0, 1.5708], "scale": 1,
    },
    "prop_eleanor_weeping_rapier": {
        "kind": "wielded", "fighter": "lady-eleanor", "gear": "",
        "throw": "swordstick",
        # the blade stands up out of the grip, and it points along the arm
        "bone": "hand", "offset": [0, -0.3, 0], "turn": [3.1416, 0, 0], "scale": 1,
    },
    "prop_tilly_clinker_tongs": {
        "kind": "wielded", "fighter": "tilly-tongs", "gear": "",
        # the jaws are at the far end of the tongs, so they lead and the
        # handles lie back along the arm
        "bone": "hand", "offset": [0, -0.3, 0], "turn": [0, 0, 1.5708], "scale": 1,
    },
    "prop_winch_gold_nightstick": {
        "kind": "wielded", "fighter": "constable-winch", "gear": "",
        # the heavy head of the nightstick stands up out of the grip, and it
        # points along the arm
        "bone": "hand", "offset": [0, -0.3, 0], "turn": [3.1416, 0, 0], "scale": 1,
    },
    "prop_sluice_flatcap": {
        "kind": "gear", "fighter": "nell-sluice", "gear": "flatcap",
        # the flatcap's rim sits just above the brow
        "bone": "head", "offset": [0, 0.25, 0], "turn": [0, 0, 0], "scale": 1.45,
    },
    "prop_kilnworth_nursecap": {
        "kind": "gear", "fighter": "matron-kilnworth", "gear": "nursecap",
        # the starched nurse's cap perches on the back of the head
        "bone": "head", "offset": [0, 0.28, -0.05], "turn": [0, 0, 0], "scale": 1.3,
    },
    "prop_rook_souwester": {
        "kind": "gear", "fighter": "bosun-rook", "gear": "",
        # the broad-brimmed sou'wester sits over the brow with the neck flap back
        "bone": "head", "offset": [0, 0.27, 0], "turn": [0, 0, 0], "scale": 1.4,
    },
    "prop_crump_samovar": {
        "kind": "gear", "fighter": "percival-crump", "gear": "obi",
        # the samovar steam boiler is strapped to the tea merchant's back
        "bone": "spine", "offset": [0, 0.08, -0.22], "turn": [0, 3.1416, 0], "scale": 1.1,
    },
    "prop_crape_spiked_brolly": {
        "kind": "wielded", "fighter": "martha-crape", "gear": "",
        "throw": "brolly",
        # the crook handle is in the fist and the ferrule spike points along the arm
        "bone": "hand", "offset": [0, -0.3, 0], "turn": [3.1416, 0, 0], "scale": 1,
    },
    "weapon_nail_bat": {
        "kind": "gift", "fighter": "", "gear": "",
        "throw": "nail-bat",
        # the bat's handle is gripped and the spiked blade leads along the arm
        "bone": "hand", "offset": [0, -0.3, 0], "turn": [3.1416, 0, 0], "scale": 1,
    },
    "weapon_knuckleduster": {
        "kind": "gift", "fighter": "", "gear": "",
        "throw": "knuckleduster",
        # the finger holes are behind and the striking bar is in front, so the
        # duster sits over the knuckles, past the fist
        "bone": "hand", "offset": [0, -0.35, 0], "turn": [0, 0, -1.5708], "scale": 1,
    },
    "weapon_bone_saw": {
        "kind": "gift", "fighter": "", "gear": "",
        "throw": "bone-saw",
        # the blade runs up out of the handle
        "bone": "hand", "offset": [0, -0.3, 0], "turn": [3.1416, 0, 0], "scale": 1,
    },
    "weapon_piston_gauntlet": {
        "kind": "gift", "fighter": "", "gear": "",
        "throw": "piston-gauntlet",
        # the drill points up and forward out of the fist
        "bone": "hand", "offset": [0, -0.26, 0], "turn": [0, 0, 2.3562], "scale": 1,
    },
    "weapon_coal_shovel": {
        "kind": "gift", "fighter": "", "gear": "",
        "throw": "coal-shovel",
        # a hand holds a shovel by its D-handle, so the handle is in the fist
        # and the blade leads: the shovel's origin is halfway up the shaft, so
        # the offset is the length of the shaft above the grip as well
        "bone": "hand", "offset": [0, -0.8, 0], "turn": [0, 0, 0], "scale": 1,
    },
    "weapon_cleaver": {
        "kind": "gift", "fighter": "", "gear": "",
        "throw": "cleaver",
        # the blade runs up out of the handle, and it points along the arm; the
        # mesh was rolled 42.8 degrees because the approved art is drawn on the
        # diagonal, so the roll is undone before it is held
        "bone": "hand", "offset": [0, -0.3, 0], "turn": [3.1416, 0, -0.747], "scale": 1,
    },
    "weapon_chair": {
        "kind": "gift", "fighter": "", "gear": "",
        "throw": "chair",
        # a chair is held by the top of its back, so the seat leads and the
        # chair hangs out in front: the chair's origin is at the seat, so the
        # offset is the height of the back above the grip as well. The chair is
        # half a metre across, so it is held clear of the arm that holds it.
        "bone": "hand", "offset": [0.25, -0.755, 0], "turn": [0, 0, 0], "scale": 1,
    },
    "pickup_tonic": {
        "kind": "gift", "fighter": "", "gear": "",
        "throw": "tonic",
        # a bottle is held by its body, and the neck leads so it can be drunk
        "bone": "hand", "offset": [0, -0.3, 0], "turn": [3.1416, 0, 0], "scale": 1,
    },
}


def same_name(a, b):
    """Whether two names are the same name.

    The manifest writes a fighter's name as it is written on the issue and the
    game writes it as it is written on the character: Tilly "Furnace-Tongs"
    against Tilly Furnace-Tongs.
    """
    def plain(text):
        return "".join(ch for ch in text.lower() if ch.isalnum())
    return plain(a) == plain(b)


def main():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    with open(CHARACTERS, encoding="utf-8") as f:
        characters = json.load(f)

    throws = {t["id"] for t in characters["theme"]["gallery"]["throws"]}
    fighters = {c["name"]: c["id"] for c in characters["characters"]}

    props = []
    for entry in manifest["assets"]:
        asset_id = entry["id"]
        if entry.get("status") != APPROVED:
            continue
        place = PLACEMENT.get(asset_id)
        if place is None:
            raise SystemExit(
                f"{asset_id} is approved but nothing says where it goes; add it to PLACEMENT"
            )
        fighter = place["fighter"]
        # the manifest names the fighter; the table uses the game's own slug
        if fighter:
            owner = entry.get("character", "")
            if not any(same_name(owner, name) for name in fighters if fighters[name] == fighter):
                raise SystemExit(
                    f"{asset_id}: the manifest says it belongs to '{owner}', "
                    f"but the table gives it to '{fighter}'"
                )
        throw = place.get("throw", "")
        if throw and throw not in throws:
            raise SystemExit(f"{asset_id}: '{throw}' is not one of the Gallery's throws")
        glb = entry.get("glb_output")
        if not glb or not os.path.exists(os.path.join(ROOT, glb)):
            raise SystemExit(f"{asset_id}: {glb} is not on disk")
        props.append({
            "id": asset_id,
            "name": entry.get("name", asset_id),
            "kind": place["kind"],
            "fighter": fighter,
            "gear": place["gear"],
            "throw": throw,
            "url": "/" + glb.replace("\\", "/"),
            "bone": place["bone"],
            "offset": place["offset"],
            "turn": place["turn"],
            "scale": place.get("scale", 1),
        })

    props.sort(key=lambda p: p["id"])
    table = {"props": props}
    text = json.dumps(table, indent=2, ensure_ascii=False) + "\n"

    if "--check" in sys.argv:
        with open(TABLE, encoding="utf-8", newline="\n") as f:
            if f.read() != text:
                print("the prop table is out of date: run tools/props/build_prop_table.py")
                return 1
        print("the prop table is up to date")
        return 0

    with open(TABLE, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(f"wrote {TABLE}: {len(props)} approved prop(s)")
    for p in props:
        print(f"  {p['id']:<34} {p['kind']:<8} {p['fighter'] or p['throw']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
