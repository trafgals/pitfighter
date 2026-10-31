import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# 12 Crutch Street Modular Limb Crafts (Issue #102)
LIMB_CRAFTS = [
    {
        "id": "pickup_limb_hydraulic_steel",
        "name": "Bulwark Hydraulic Steel Arm",
        "craft_name": "Bulwark Hydraulic Steel",
        "tip": "fist",
        "traits": {"mass": 1.20, "length": 1.05, "swing": 1.05, "arc": "tight", "dmg": 1.25},
        "scale_dimensions_cm": {"width": 18.0, "height": 72.0, "depth": 18.0},
        "prompt": "Authentic Victorian industrial prosthetic arm, polished chrome cylinder forearm with twin brass dial pressure gauges, braided high-pressure steam hose, articulated riveted steel knuckle gauntlet, isolated on white background.",
        "character": "Bulwark"
    },
    {
        "id": "pickup_limb_foundry_iron",
        "name": "Foundry Iron Piston Arm",
        "craft_name": "Foundry Iron Piston",
        "tip": "fist",
        "traits": {"mass": 1.30, "length": 1.00, "swing": 0.90, "arc": "tight", "dmg": 1.35},
        "scale_dimensions_cm": {"width": 20.0, "height": 68.0, "depth": 20.0},
        "prompt": "Heavy Victorian black pig-iron cast mechanical arm, reciprocating steam piston rod, exposed hardened steel gear ratchet, massive iron anvil knuckle block, isolated on white background.",
        "character": "Hezekiah Smelt"
    },
    {
        "id": "pickup_limb_clockwork_brass",
        "name": "Gilded Clockwork Brass Arm",
        "craft_name": "Gilded Clockwork Brass",
        "tip": "fist",
        "traits": {"mass": 0.85, "length": 0.95, "swing": 1.25, "arc": "tight", "dmg": 0.90},
        "scale_dimensions_cm": {"width": 15.0, "height": 65.0, "depth": 15.0},
        "prompt": "Intricate Victorian horological brass prosthetic arm, openwork skeletonized brass plates revealing jeweled balance wheel and coiled escapement mainspring, fluted brass knuckles, isolated on white background.",
        "character": "Professor Crump"
    },
    {
        "id": "pickup_limb_cinder_iron",
        "name": "Furnace Cinder Iron Claw",
        "craft_name": "Furnace Cinder Iron",
        "tip": "claw",
        "traits": {"mass": 1.10, "length": 1.05, "swing": 1.00, "arc": "wide", "dmg": 1.15},
        "scale_dimensions_cm": {"width": 22.0, "height": 70.0, "depth": 18.0},
        "prompt": "Victorian stoker slag-crusted iron gauntlet prosthetic, black wrought iron arm sleeve terminating in three sharp curved glowing-hot clinker slag-hook claws, isolated on white background.",
        "character": "Tilly Clinker"
    },
    {
        "id": "pickup_limb_grafted_bear",
        "name": "Taxidermist's Grafted Bear Forelimb",
        "craft_name": "Taxidermist's Grafted Bear",
        "tip": "claw",
        "traits": {"mass": 1.25, "length": 1.10, "swing": 0.95, "arc": "wide", "dmg": 1.25},
        "scale_dimensions_cm": {"width": 22.0, "height": 75.0, "depth": 22.0},
        "prompt": "Macabre Victorian taxidermy grafted brown bear forelimb, coarse dark fur, iron-riveted harness splints around the humerus, massive curved yellowed bone claws, isolated on white background.",
        "character": "Skinner"
    },
    {
        "id": "pickup_limb_bamboo_samovar",
        "name": "Bamboo & Brass Samovar Arm",
        "craft_name": "Bamboo & Brass Samovar",
        "tip": "fist",
        "traits": {"mass": 0.80, "length": 1.15, "swing": 1.20, "arc": "tight", "dmg": 0.85},
        "scale_dimensions_cm": {"width": 16.0, "height": 78.0, "depth": 16.0},
        "prompt": "Exotic Victorian tea merchant prosthetic arm, bundled dark lacquered bamboo staves bound with raw copper wire around a polished brass tea-steam pressure cylinder, brass ball knuckle tip, isolated on white background.",
        "character": "Professor Crump"
    },
    {
        "id": "pickup_limb_kiln_porcelain",
        "name": "Glazed Medical Porcelain Limb",
        "craft_name": "Glazed Medical Porcelain",
        "tip": "fist",
        "traits": {"mass": 0.90, "length": 1.00, "swing": 1.15, "arc": "tight", "dmg": 0.95},
        "scale_dimensions_cm": {"width": 16.0, "height": 68.0, "depth": 16.0},
        "prompt": "Victorian apothecary surgical prosthetic arm, glazed white Delftware porcelain casing with delicate cobalt blue crackle glaze lines, brass hinge rings and kid-leather lined socket, isolated on white background.",
        "character": "Nurse Kilnworth"
    },
    {
        "id": "pickup_limb_jet_whalebone",
        "name": "Whitby Jet & Whalebone Spike Arm",
        "craft_name": "Whitby Jet & Whalebone",
        "tip": "spike",
        "traits": {"mass": 0.85, "length": 1.15, "swing": 1.15, "arc": "piercing", "dmg": 1.20},
        "scale_dimensions_cm": {"width": 14.0, "height": 80.0, "depth": 14.0},
        "prompt": "Sombre Victorian mourning prosthetic arm, ribbed black baleen whalebone corset-stay splints bound in matte black silk, tapering to a faceted needle-sharp Whitby jet stiletto spike, isolated on white background.",
        "character": "Mistress Martha Crape"
    },
    {
        "id": "pickup_limb_silver_ebony",
        "name": "Aristocratic Silver & Ebony Rapier Arm",
        "craft_name": "Aristocratic Silver & Ebony",
        "tip": "spike",
        "traits": {"mass": 0.80, "length": 1.20, "swing": 1.25, "arc": "piercing", "dmg": 1.25},
        "scale_dimensions_cm": {"width": 14.0, "height": 85.0, "depth": 14.0},
        "prompt": "Aristocratic Victorian prosthetic arm, fluted Gabon ebony shaft, hallmarked sterling silver acanthus leaf filigree casing, terminating in an etched triangular silver rapier stiletto spike, isolated on white background.",
        "character": "Lady Eleanor"
    },
    {
        "id": "pickup_limb_cast_iron_lasts",
        "name": "Cobbler's Cast-Iron Last Leg",
        "craft_name": "Cobbler's Cast-Iron Last",
        "tip": "club",
        "traits": {"mass": 1.25, "length": 1.00, "swing": 0.85, "arc": "overhead", "dmg": 1.30},
        "scale_dimensions_cm": {"width": 18.0, "height": 82.0, "depth": 24.0},
        "prompt": "Heavy Victorian shoe cobbler prosthetic leg, thick bridle leather strapping over calibrated brass rule shins, terminating in a solid blackened cast-iron cobbler shoe-last club foot, isolated on white background.",
        "character": "Mistress Tabitha Pegg"
    },
    {
        "id": "pickup_limb_drainpipe_lead",
        "name": "Plumber's Drainpipe Lead Club Arm",
        "craft_name": "Plumber's Drainpipe Lead",
        "tip": "club",
        "traits": {"mass": 1.35, "length": 1.05, "swing": 0.80, "arc": "overhead", "dmg": 1.40},
        "scale_dimensions_cm": {"width": 20.0, "height": 72.0, "depth": 20.0},
        "prompt": "Brutal Victorian night-soil plumber prosthetic club arm, tarnished grey cast-lead drainpipe casing with flanged brass bolt rings and a heavy brass gate-valve bludgeon knuckle head, isolated on white background.",
        "character": "Nell Sluice"
    },
    {
        "id": "pickup_limb_ship_oak",
        "name": "Iron-Banded Ship Oak Peg-Leg",
        "craft_name": "Iron-Banded Ship Oak",
        "tip": "club",
        "traits": {"mass": 1.20, "length": 1.20, "swing": 0.90, "arc": "overhead", "dmg": 1.25},
        "scale_dimensions_cm": {"width": 16.0, "height": 88.0, "depth": 18.0},
        "prompt": "Nautical Victorian prosthetic peg-leg, weathered dark ship English oak timber charred with pitch, bound in rusted iron cooper's barrel hoops with encrusted barnacles and iron ferrule foot, isolated on white background.",
        "character": "Salt Rook"
    }
]

# 12 Victorian Fighter 3D Heads (Issue #104)
FIGHTER_HEADS = [
    {
        "id": "head_obadiah_winch",
        "name": "Constable Obadiah Winch 3D Head & Mutton Chops",
        "character": "Constable Obadiah Winch",
        "scale_dimensions_cm": {"width": 22.0, "height": 28.0, "depth": 24.0},
        "prompt": "Victorian London police constable head, stern square jaw, weathered ruddy skin, heavy bushy dark-brown mutton chop sideburns, combed back short oiled hair, isolated on white background."
    },
    {
        "id": "head_hezekiah_smelt",
        "name": "Hezekiah Smelt 3D Smelter Head & Beard",
        "character": "Hezekiah Smelt",
        "scale_dimensions_cm": {"width": 26.0, "height": 34.0, "depth": 28.0},
        "prompt": "Gigantic Victorian iron foundry master head, broad thick neck, soot-stained leathery pale skin, thick tangled ash-grey beard singed with embers, fierce coal-dark eyes, isolated on white background."
    },
    {
        "id": "head_tabitha_pegg",
        "name": "Mistress Tabitha Pegg 3D Cobbler Head",
        "character": "Mistress Tabitha Pegg",
        "scale_dimensions_cm": {"width": 20.0, "height": 26.0, "depth": 22.0},
        "prompt": "Wiry sharp-featured Victorian shoemaker woman head, tight grey-streaked bun hair, leather aproned collar, intense piercing hawk eyes, wax-stained weathered pale skin, isolated on white background."
    },
    {
        "id": "head_martha_crape",
        "name": "Mistress Martha Crape 3D Mourner Head",
        "character": "Mistress Martha Crape",
        "scale_dimensions_cm": {"width": 20.0, "height": 27.0, "depth": 23.0},
        "prompt": "Pale Victorian professional funeral mourner head, gaunt hollow cheeks, black crape widow's bonnet frill around hairline, solemn dark eyes with faint tear tracks, isolated on white background."
    },
    {
        "id": "head_nell_sluice",
        "name": "Nell Sluice 3D Sewer Scavenger Head",
        "character": "Nell Sluice",
        "scale_dimensions_cm": {"width": 20.0, "height": 25.0, "depth": 22.0},
        "prompt": "Fierce young Victorian London mudlark toshing scavenger head, dirt-smudged freckled pale cheeks, unruly cropped ginger hair, cocky smirk, sharp cunning eyes, isolated on white background."
    },
    {
        "id": "head_bulwark",
        "name": "Bulwark 3D Armoured Bouncer Head",
        "character": "Bulwark",
        "scale_dimensions_cm": {"width": 25.0, "height": 30.0, "depth": 26.0},
        "prompt": "Massive Victorian illegal pit-fight bouncer head, broken nose, cauliflower ears, close-shaved brutal stubble scalp with jagged scar across left temple, cold calculating eyes, isolated on white background."
    },
    {
        "id": "head_nurse_kilnworth",
        "name": "Nurse Florence Kilnworth 3D Surgical Head",
        "character": "Nurse Kilnworth",
        "scale_dimensions_cm": {"width": 20.0, "height": 26.0, "depth": 22.0},
        "prompt": "Grim Victorian hospital asylum head nurse, pale austere aristocratic face, severe dark hair parted in center, cold clinical surgical stare, faint antiseptic pallor, isolated on white background."
    },
    {
        "id": "head_professor_crump",
        "name": "Professor Crump 3D Horologist Head & Monocle",
        "character": "Professor Crump",
        "scale_dimensions_cm": {"width": 21.0, "height": 27.0, "depth": 23.0},
        "prompt": "Eccentric Victorian chronometer inventor head, wild thinning white side tufts, brass jeweler's monocle eyepiece over left eye, twitching thin mustache, furrowed scholarly brow, isolated on white background."
    },
    {
        "id": "head_lady_eleanor",
        "name": "Lady Eleanor 3D Disgraced Aristocrat Head",
        "character": "Lady Eleanor",
        "scale_dimensions_cm": {"width": 19.0, "height": 26.0, "depth": 22.0},
        "prompt": "Haughty disgraced Victorian noblewoman duelist head, pale high cheekbones, elegant black hair with silver streaks swept into a duel knot, thin disdainful lips, cold steel-grey eyes, isolated on white background."
    },
    {
        "id": "head_skinner",
        "name": "Skinner 3D Taxidermist Head",
        "character": "Skinner",
        "scale_dimensions_cm": {"width": 21.0, "height": 26.0, "depth": 23.0},
        "prompt": "Sinister Victorian Bermondsey tannery skinner head, greasy lank dark hair, tallow-stained sallow skin, patchy stubble, feral unblinking eyes, twitching grimace, isolated on white background."
    },
    {
        "id": "head_mule",
        "name": "Mule 3D Bare-Knuckle Champion Head",
        "character": "Mule",
        "scale_dimensions_cm": {"width": 24.0, "height": 29.0, "depth": 25.0},
        "prompt": "Rugged Victorian bare-knuckle prize fighter head, broad jaw with prominent scar along jawline, cropped buzzcut, fierce bruised brow, heavy thick mustache, isolated on white background."
    },
    {
        "id": "head_tilly_clinker",
        "name": "Tilly Clinker 3D Stoker Head & Goggles",
        "character": "Tilly Clinker",
        "scale_dimensions_cm": {"width": 20.0, "height": 26.0, "depth": 22.0},
        "prompt": "Tough Victorian steamship stoker woman head, soot-blackened cheekbones, wild curly dark hair tied back in kerchief, brass safety stoker goggles pushed up on brow, determined grit, isolated on white background."
    }
]

queue_data = {
    "version": "1.0.0",
    "updated_at": "2026-10-31T00:48:00Z",
    "target_worker": "mcode",
    "target_cron_id": "1c3a5d96-c977-442f-baab-fb823bc39d0f",
    "instruction": "Poll and build next approved assets for Pitfighter into public/models/props/ using Pixal3D and procedural pipelines.",
    "waves": {
        "wave1_limb_crafts": [
            {
                "id": c["id"],
                "name": c["name"],
                "character": c["character"],
                "category": "modular_limb",
                "slot": "limb_socket",
                "tip": c["tip"],
                "traits": c["traits"],
                "poly_budget": 30000,
                "file_budget_bytes": 1572864,
                "scale_dimensions_cm": c["scale_dimensions_cm"],
                "status": "stage:minimax-code-3d",
                "gate": "gate:2-rebuild-pixal3d",
                "pivot": {
                    "convention": "limb_socket_normalized",
                    "origin": "proximal socket at (0, 0, 0), hangs along -Y, forward is +Z",
                    "elbow_split_y": -0.28,
                    "knee_split_y": -0.42
                },
                "alpha_file": f"public/tex/props/flux3_{c['id']}_alpha.png",
                "turnaround_file": f"public/tex/props/h3_{c['id']}_turnaround.png",
                "turntable_file": f"docs/props/{c['id']}/turntable.webp",
                "glb_output": f"public/models/props/{c['id']}.glb",
                "prompt": c["prompt"]
            }
            for c in LIMB_CRAFTS
        ],
        "wave2_fighter_heads": [
            {
                "id": h["id"],
                "name": h["name"],
                "character": h["character"],
                "category": "head_3d",
                "slot": "head_socket",
                "poly_budget": 35000,
                "file_budget_bytes": 1572864,
                "scale_dimensions_cm": h["scale_dimensions_cm"],
                "status": "stage:minimax-code-3d",
                "gate": "gate:2-rebuild-pixal3d",
                "pivot": {
                    "convention": "head_socket_normalized",
                    "origin": "base opening of neck / collar rim at y=0, centred on skull axis, forward +Z",
                    "up": "+Y",
                    "forward": "+Z"
                },
                "alpha_file": f"public/tex/characters/flux3_{h['id']}_alpha.png",
                "turnaround_file": f"public/tex/characters/h3_{h['id']}_turnaround.png",
                "turntable_file": f"docs/characters/{h['id']}/turntable.webp",
                "glb_output": f"public/models/characters/{h['id']}.glb",
                "prompt": h["prompt"]
            }
            for h in FIGHTER_HEADS
        ]
    }
}

out_path = os.path.join(ROOT, "data", "asset_queue_next.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(queue_data, f, indent=2)

print(f"Generated {out_path} with {len(LIMB_CRAFTS)} modular limb crafts and {len(FIGHTER_HEADS)} 3D heads.")
