import json
import sys

def update_roster():
    json_path = 'src/data/characters.json'
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 1. Update Mistress Tabitha Pegg (index 8)
    tabitha = data['characters'][8]
    tabitha['id'] = 'tabitha-pegg'
    tabitha['name'] = 'Mistress Tabitha Pegg'
    tabitha['style'] = 'Tae Kwon Do'
    tabitha['blurb'] = 'Obsessive East End cordwainer and bootmaker engineered to deliver the mechanically perfect human kick with articulated cast-iron shoe lasts, brass rule gauges, and heavy steel-welted brogues.'
    tabitha['accent'] = '#c8963e'
    tabitha['family'] = 'kicker'
    tabitha['short'] = 'TABITHA'
    tabitha['title'] = "The Cobbler's Automaton"
    tabitha['lineage'] = ['Tae Kwon Do', 'Savate']
    tabitha['ratings'] = {
        'power': 4,
        'speed': 4,
        'reach': 4,
        'grapple': 2,
        'defence': 3,
        'technique': 5,
        'difficulty': 4
    }
    tabitha['stats'] = {
        'speed': 1.06,
        'startup': -2,
        'punch': 0.85,
        'kick': 1.40,
        'grab': 0.90,
        'reach': 1.10,
        'string': 2,
        'torso': 0.95,
        'grabReach': 1
    }
    tabitha['kit'] = {
        'size': 0.98,
        'horns': 'none',
        'tail': 'none',
        'gear': ['spectacles', 'cordwainer-apron']
    }
    tabitha['look'] = {
        'def': 1.0,
        'scar': 1,
        'paint': 0,
        'wrinkles': False,
        'stubble': False,
        'veins': True
    }
    tabitha['airGrab'] = {
        'name': 'THE LAST DROP',
        'end': 'bounce',
        'dmg': 15,
        'slam': 22,
        'lift': 0.85,
        'dur': 40
    }
    tabitha['special'] = 'spBarrage'
    tabitha['specialName'] = 'THE OVERWOUND LAST'

    # Profile
    tabitha['profile'] = {
        'age': 31,
        'from': 'Barrow & Sons Cordwainers, Spitalfields',
        'trade': 'Master Cordwainer & Prosthetic Last-Fitter',
        'height': '1.72 m',
        'bio': "Tabitha Pegg spent fourteen years hammering box calf and pigskin over iron lasts in the damp cellars of Spitalfields, until an industrial steam-press crushed both her feet during a rush order for the Royal Horse Guards. Rather than beg, Pegg shut herself in her workshop for six months and emerged on legs of her own forging: articulated cast-iron shoemaker lasts, calibrated brass measuring calipers, and heavy triple-soled steel brogues fitted with spring-ratchet clockwork. She treats human combat as an exacting sizing problem—every knee strike, roundhouse, and spinning hook kick measured to the millimeter and driven home with thirty pounds of cold pig-iron.",
        'personality': "Methodical, acerbic, relentlessly exacting. She views every opponent not as a fighter, but as an ill-fitting boot that needs stretching, paring down, or hammering flat.",
        'manners': "Takes chalk from behind her ear and marks the opponent's lapel or cheek before kicking it. Measures distances with a brass sliding gauge. 'Stand straight; you're throwing my welt off.'",
        'violence': "Rapid-fire machine-gun kicks with mathematical precision. High-speed staccato Tae Kwon Do roundhouses, piercing steel-tipped toe jabs, and shattering iron-welt heel drops.",
        'otherSelf': "Overwound Springs: she clicks a tension ratchet behind her knee; the clockwork springs scream at double speed, unleashing an uncontrollable blizzard of rhythmic kicks.",
        'rivals': [
            {
                'id': 'hezekiah-smelt',
                'why': "Smelt's chimney-sweep furnace soot ruins her fine top-grain box calf leather and gums up her knee ratchets."
            },
            {
                'id': 'lady-bulwark',
                'why': "The Bulwark gas company attempted to seize Pegg's Spitalfields workshop for a coal storage depot; Tabitha drove Hester's bailiffs into the street with a flurry of iron shoe lasts."
            }
        ],
        'partner': {
            'id': 'bartholomew-mule',
            'why': "Mule brings in heavy scrap iron lasts and railway boots; Tabitha welds them into indestructible weapons and braces for him."
        },
        'quotes': {
            'intro': "Hold still. Let's see what size you take.",
            'appeal': "Good leather, clean welt, no excuses.",
            'victory': "Hammered, stitched, and put out to dry.",
            'defeat': "The mainspring... has snapped..."
        }
    }

    # Limbs
    tabitha['limbs'] = {
        'craft': 'cast-iron-lasts',
        'arms': 'Her own, sinewy and scarred with awl slips, wearing studded leather arm bracers, chalk smudges on the knuckles.',
        'legs': 'Both legs from mid-thigh down: forged cast-iron shoemaker lasts fitted with engraved brass measuring rules, tension leaf-springs behind the calves, and heavy triple-soled steel oxfords with serrated welt rims.',
        'tip': 'iron-welt',
        'lean': {
            'mass': 1.15,
            'length': 1.05,
            'swing': 1.10
        },
        'wear': 'Sparks fly from the steel welts on hard impact; clockwork springs whine as tension builds; chipped black iron flakes off the lasts during heavy exchanges.'
    }

    # Art
    tabitha['art'] = {
        'silhouette': 'A stern, sharp-featured artisan in a heavy cowhide cordwainer apron over dark wool, spectacles perched on a brass chain, standing on heavy cast-iron shoe lasts with visible clockwork springs.',
        'build': 'Lean, muscular, upright craftsman posture with broad shoulders and heavy metallic legs.',
        'palette': {
            'primary': {
                'hex': '#2b241e',
                'name': 'oiled cowhide'
            },
            'secondary': {
                'hex': '#4a3528',
                'name': 'cordovan leather'
            },
            'metal': {
                'hex': '#c8963e',
                'name': 'burnished brass rules'
            },
            'iron': {
                'hex': '#3a3d40',
                'name': 'cast pig-iron'
            }
        },
        'costume': "A heavy oiled leather cobbler's apron with brass eyelets and awl pockets over a high-collared dark wool work dress, rolled linen sleeves with studded leather vambraces, spectacles on a fine brass chain, dark hair pinned tightly under a baker boy cap.",
        'alternates': [
            {
                'name': 'Sunday Best',
                'note': 'dark green corduroy apron and polished brass lasts'
            },
            {
                'name': 'Foundry Shift',
                'note': 'blackened leather, soot-stained cheeks, red-hot iron welts'
            },
            {
                'name': 'Workhouse Grey',
                'note': 'coarse unbleached canvas apron and rusted raw iron lasts'
            }
        ],
        'limbs': 'The legs are heavy cast-iron lasts calibrated with engraved brass imperial rules along the shins; tension springs run along the calf into ratchet gears at the ankle; the feet are heavy square-toed brogues with hardened steel welts.',
        'face': 'A severe, handsome, sharp-jawed London face with acute hazel eyes behind round wire-rimmed spectacles, a pencil tucked behind the left ear.',
        'hair': 'Dark chestnut brown, pinned back in a practical braided bun under a wool baker boy cap.',
        'gore': 'Shattering concussions: broken cheekbones, teeth knocked loose by steel-welted heels, sparks and hot iron fragments embedded in flesh.',
        'vfx': [
            'sparks shower from her steel shoe welts on impact',
            'brass gear particles burst when her tension springs release',
            'kinetic shockwaves ripple along the ground from heel drops'
        ],
        'idle': 'Stands in an upright Tae Kwon Do guard, occasionally tapping her lead iron shoe last against the stone with a clear metallic ring.',
        'intro': 'Pulls a wooden ruler from her apron pocket, measures the distance to the opponent, taps her iron heel to engage the ratchet, and raises her fists.',
        'victory': 'Pulls a piece of chalk from behind her ear, makes a chalk tick-mark on the defeated opponent, and slides her spectacles down to inspect her work.',
        'defeat': 'A knee ratchet gives way with a sharp metallic snap; she falls to one knee, gripping the broken spring with a furious scowl.',
        'portrait': 'A three-quarter stance in her Spitalfields workshop, apron tied, spectacles glinting, one iron last resting on a wooden cobbler bench.'
    }

    # Sound
    tabitha['sound'] = {
        'voice': {
            'casting': 'a sharp, dry, articulate contralto in her early thirties',
            'accent': 'unapologetic East London / Spitalfields artisan cockney, brisk and precise',
            'texture': 'acerbic, dry, confident, entirely unruffled'
        },
        'lines': {
            'intro': [
                "Hold still. Let's see what size you take.",
                "Stand straight; you're throwing my welt off.",
                "I've broken stouter lasts than you."
            ],
            'appeal': [
                "Good leather, clean welt, no excuses.",
                "Anyone else need stretching?",
                "That's sixteen stitches to the inch!"
            ],
            'victory': [
                "Hammered, stitched, and put out to dry.",
                "A poor fit from the start.",
                "Next time, break them in gently."
            ],
            'defeat': [
                "The mainspring... has snapped...",
                "My bench... who's minding the shop?...",
                "A bad batch... of iron..."
            ]
        },
        'cues': [
            {
                'id': 'pegg-spring-ratchet',
                'category': 'foley',
                'note': 'the sharp click-clack of the tension ratchet in her iron knee',
                'prompt': 'A heavy mechanical ratchet clicks five times rapidly under spring tension, followed by a metallic latch engaging.',
                'seed': 5210
            },
            {
                'id': 'pegg-iron-clank',
                'category': 'foley',
                'note': 'the dull, resonant clang of the cast-iron shoe last striking stone',
                'prompt': 'A solid cast-iron anvil weight strikes hard cobblestone with a sharp ring and heavy low thump.',
                'seed': 5211
            }
        ]
    }

    # Texture
    tabitha['texture'] = {
        'seed': 5212,
        'skin': {
            'idea': 'weathered pale East End complexion, strong jaw, smudged with black cobbler wax',
            'colour': 'fair with grey-black smudge'
        },
        'cloth': {
            'idea': 'heavy oiled cowhide apron with brass eyelets, dark wool work dress, rolled linen sleeves',
            'colour': 'dark brown and charcoal wool'
        },
        'face': {
            'idea': 'sharp, observant, spectacles reflecting lamplight, pencil tucked behind ear',
            'colour': 'fair with light freckling'
        }
    }

    # Moves: Update special and duo
    tabitha['moves']['special'] = {
        'name': 'THE OVERWOUND LAST',
        'sim': 'spBarrage',
        'anim': 'Clicks the tension ratchet behind both knees; unleashes an explosive flurry of ten machine-speed piston roundhouses driven with cold pig-iron shoe lasts, finishing with an iron-welt drop stomp.',
        'sfx': 'rapid ratcheting clockwork whine, metallic anvil clangs, heavy dull impact on bone',
        'vfx': 'sparks flying from steel shoe welts, brass gear particles, impact shockwaves'
    }
    tabitha['moves']['duo'] = {
        'partner': 'bartholomew-mule',
        'name': 'The Last Fitting',
        'archetype': 'cinematic',
        'duration': 290,
        'dmg': 28,
        'anim': "Mule lifts the victim by the collar; Tabitha leaps, using Mule's shoulder as a fulcrum to deliver a calibrated dual-heel drop directly into the victim's chest, driving them through the floorboards."
    }

    # 2. Update Bartholomew Mule (index 4)
    mule = data['characters'][4]
    if mule['id'] == 'bartholomew-mule':
        mule['profile']['partner'] = {
            'id': 'tabitha-pegg',
            'why': "Mule brings in heavy scrap iron lasts and railway boots; Tabitha welds them into indestructible weapons and braces for him."
        }
        mule['moves']['duo'] = {
            'partner': 'tabitha-pegg',
            'name': 'The Last Fitting',
            'archetype': 'cinematic',
            'duration': 290,
            'dmg': 28,
            'anim': "Mule lifts the victim by the lapels; Tabitha leaps, using Mule's shoulder as a fulcrum to deliver a calibrated dual-heel drop into the chest, driving them into the floor."
        }
        print("Updated Bartholomew Mule partner & duo.")

    # 3. Update Lady Hester Bulwark (index 6)
    bulwark = data['characters'][6]
    if bulwark['id'] == 'lady-bulwark':
        for rival in bulwark['profile']['rivals']:
            if rival['id'] == 'columbine-vesper':
                rival['id'] = 'tabitha-pegg'
                rival['why'] = "The Bulwark gas company attempted to seize Pegg's Spitalfields workshop for a coal storage depot; Tabitha drove Hester's bailiffs into the street with a flurry of iron shoe lasts."
        print("Updated Lady Bulwark rival.")

    # Save cleanly
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print("Successfully updated src/data/characters.json with Mistress Tabitha Pegg!")

if __name__ == '__main__':
    update_roster()
