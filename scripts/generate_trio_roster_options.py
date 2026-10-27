import urllib.request
import json
import time
import os
import shutil

COMFY_HOST = "http://127.0.0.1:8188"
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"

# 30 Total Options: 3 Characters x 5 Archetypes x 2 (Male & Female)
CHARACTERS = {
    "crape": {
        "folder": "public/tex/characters/ideation_crape",
        "items": [
            # Archetype 1: The Jet & Whalebone Memento Mori
            {
                "id": "crape_1a_jet_male",
                "title": "Crape 1A: The Jet & Whalebone Memento Mori (Male) — Mortimer Crape",
                "seed": 3001,
                "prompt": (
                    "Full-length action portrait of an eerie Victorian undertaker and judo pitfighter, tall gaunt male, 48 years old, "
                    "standing in a low, ominous judo grappling stance in a foggy London churchyard at dusk. "
                    "Both arms and legs are crafted from polished cream whalebone stays encased in faceted black mourning jet armor plates, "
                    "laced up with black silk ribbons like a widow's corset, with flexible double-jointed elbows and wrists that bend both ways. "
                    "Wearing a tailored pitch-black mourning frock coat with dull black crape hatband and weeping armbands, high collar, and jet buttons up spats. "
                    "Holding a steel-ribbed black mourning umbrella, hollow sunken eyes, solemn macabre expression, misty cemetery backdrop, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "crape_1b_jet_female",
                "title": "Crape 1B: The Jet & Whalebone Memento Mori (Female) — Mistress Martha Crape",
                "seed": 3002,
                "prompt": (
                    "Full-length action portrait of a severe Victorian mourning undertaker and judo pitfighter, gaunt imposing female, 45 years old, "
                    "poised in an eerie judo clinch stance in a cobblestone mortuary courtyard in the rain. "
                    "Both arms and legs are segmented faceted black mourning jet plates over flexible polished whalebone ribs, laced with black mourning silk ribbons, "
                    "double-jointed wrists and ankles that pivot freely in all directions. "
                    "Wearing a high-collared black bombazine mourning dress with weeping crape veil pinned back, mourning jet necklace, holding a brass mortuary caliper. "
                    "Pale spectral complexion, razor-sharp cheekbones, solemn cold stare, weeping fog, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 2: The Coffin-Wright & Lead-Liner
            {
                "id": "crape_2a_coffinwright_male",
                "title": "Crape 2A: The Coffin-Wright (Male) — Gabriel Crape",
                "seed": 3003,
                "prompt": (
                    "Full-length portrait of a grim heavy-set Victorian coffin-maker and judoka pitfighter, burly male, 52 years old, "
                    "standing in a wide grappling stance inside a sawdust-strewn coffin carpentry workshop. "
                    "Both arms and legs are hand-carved English black bog-oak limbs bound with heavy lead coffin-sealing straps, forged brass casket-corner brackets, and zinc tacks. "
                    "Wearing an oiled black leather joiner's apron over a soot-stained wool waistcoat, brass folding ruler protruding from his breast pocket, iron casket handles at his belt. "
                    "Stern calloused face, grey-streaked beard, sawdust and wood shavings flying, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "crape_2b_coffinwright_female",
                "title": "Crape 2B: The Coffin-Wright (Female) — Tabitha Crape",
                "seed": 3004,
                "prompt": (
                    "Full-length portrait of a formidable Victorian coffin-joiner and judoka pitfighter, broad-shouldered muscular female, 46 years old, "
                    "gripping an iron casket handle in a low sweeping grappling stance in an East End funeral workshop. "
                    "Both arms and legs are charred black bog-oak prosthetics reinforced with lead-soldered brass hinges, iron casket handles, and heavy zinc-headed nails. "
                    "Wearing a studded black cowhide leather apron over a dark woolen work dress, rolled linen sleeves, leather arm bracers, hair tied back in a leather thong. "
                    "Grim focused scowl, wood shavings on boots, gritty Victorian steampunk photorealism, moody gaslamp rim lighting."
                )
            },

            # Archetype 3: The Crypt Bone-Mason & Ossuary Scribe
            {
                "id": "crape_3a_bonemason_male",
                "title": "Crape 3A: The Crypt Bone-Mason (Male) — Ebenezer Crape",
                "seed": 3005,
                "prompt": (
                    "Full-length portrait of a skeletal Victorian cemetery crypt-mason and grappling pitfighter, pale gaunt male, 55 years old, "
                    "standing in a crouched judo ready stance amidst damp gothic catacombs and stone tombs. "
                    "Both arms and legs are carved from bleached ivory and polished ebony bone-stays linked by anatomical brass ball-and-socket joints with sliding measurement calipers. "
                    "Wearing a threadbare raven-black frock coat dusted with white lime and grave chalk, round wire-rimmed dark mourning spectacles, fingerless gloves. "
                    "Sunken hollow cheeks, chillingly calm expression, dripping stone walls, eerie green moss, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "crape_3b_bonemason_female",
                "title": "Crape 3B: The Crypt Bone-Mason (Female) — Hester Crape",
                "seed": 3006,
                "prompt": (
                    "Full-length portrait of an ethereal Victorian ossuary caretaker and judoka pitfighter, slender tall female, 40 years old, "
                    "poised in a graceful yet lethal grappling stance in an underground Victorian crypt. "
                    "Both arms and legs are sculpted bone-white ivory stays encased in polished black jet filigree cages with sliding mortuary measurement verniers. "
                    "Wearing a tattered black mourning silk gown, draped black lace mourning shawl, silver casket-screw bandolier across her chest. "
                    "Porcelain-pale face, piercing dark eyes, spectral gothic aura, volumetric catacomb torchlight, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 4: The Mourning Brolly Judoka
            {
                "id": "crape_4a_brolly_male",
                "title": "Crape 4A: The Mourning Brolly Judoka (Male) — Silas Crape",
                "seed": 3007,
                "prompt": (
                    "Full-length action portrait of an imposing Victorian funeral mute and judo master, tall austere male, 44 years old, "
                    "executing a dynamic judo leg sweep with a heavy black mourning umbrella hooked around the ankles on rain-drenched cobblestones. "
                    "Both arms and legs are sculpted matte-black vulcanite and ebonite limbs with brass locking joints and double-jointed ankles for extreme joint levers. "
                    "Wearing a high black silk stovepipe hat with long weeping crape veil, tailored black frock coat with velvet collar, black gloves. "
                    "Severe unblinking gaze, splashing puddle reflections, rainy London street at night, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "crape_4b_brolly_female",
                "title": "Crape 4B: The Mourning Brolly Judoka (Female) — Lavinia Crape",
                "seed": 3008,
                "prompt": (
                    "Full-length action portrait of an austere Victorian funeral mute and judoka pitfighter, statuesque female, 38 years old, "
                    "hooking a steel-shafted black mourning umbrella into an aggressive judo hip-throw stance in the rain. "
                    "Both arms and legs are seamless matte-black ebonite prosthetics with brass caliper hinges and quick-release lever locks. "
                    "Wearing a fitted black velvet mourner's tailcoat, pleated black wool skirt, black mourning bonnet with heavy weeping veil tossed over her shoulder. "
                    "Stern, commanding expression, windblown rain, cinematic streetlamp backlighting, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 5: The Hearse-Master
            {
                "id": "crape_5a_hearse_male",
                "title": "Crape 5A: The Hearse-Master (Male) — Thaddeus Crape",
                "seed": 3009,
                "prompt": (
                    "Full-length portrait of a menacing Victorian funeral carriage driver and grappling pitfighter, imposing male, 50 years old, "
                    "standing beside an ornate glass-walled horse-drawn hearse in a misty graveyard. "
                    "Both arms and legs are forged from heavy black carriage leaf-springs, iron wheel-axle joints, and polished brass casket-roller wheels built into the soles of his boots for sweeping slides. "
                    "Wearing a multi-tiered black coachman's cape, heavy leather driving gauntlets, and a cocked stovepipe hat with brass carriage-lamp fittings. "
                    "Chiseled granite jaw, steely gaze, iron chassis steam, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "crape_5b_hearse_female",
                "title": "Crape 5B: The Hearse-Master (Female) — Cordelia Crape",
                "seed": 3010,
                "prompt": (
                    "Full-length portrait of a formidable Victorian funeral hearse coachwoman and judoka pitfighter, tall powerful female, 42 years old, "
                    "in a sweeping judo stance beside a black funeral carriage in swirling London fog. "
                    "Both arms and legs are heavy black carriage leaf-springs and iron axle armatures with brass casket-roller bearings embedded in the boot heels. "
                    "Wearing a tailored black equestrian coach coat with silver buttons, leather driving harness, and high-crowned silk top hat with a black ostrich plume. "
                    "Fierce resolute expression, rain glistening on coach ironwork, volumetric carriage lantern glow, gritty Victorian steampunk photorealism."
                )
            }
        ]
    },

    "peregrine": {
        "folder": "public/tex/characters/ideation_peregrine",
        "items": [
            # Archetype 1: The Hallmarked Dandy Duelist (The Classic Ashby-Lisle)
            {
                "id": "peregrine_1a_dandy_male",
                "title": "Sir Peregrine 1A: The Hallmarked Dandy (Male) — Sir Peregrine Ashby-Lisle",
                "seed": 3011,
                "prompt": (
                    "Full-length portrait of an aristocratic Victorian dandy swordsman and pitfighter, elegant handsome male, 34 years old, "
                    "drawing a gleaming steel rapier from a polished malacca cane in a polite en-garde fencing stance in an ornate gaslit drawing room. "
                    "Both arms from the shoulder are sculpted from solid black ebony wood sheathed in hallmarked repoussé sterling silver filigree, "
                    "fluted like ecclesiastical candlesticks with the Ashby-Lisle crest at each shoulder, and long fine fingers ending in sharpened silver stiletto nails. "
                    "Wearing a tailored midnight-blue evening dress coat with silk lapels, high wing collar, silver-embroidered Ascot cravat, grey striped trousers, and white spats. "
                    "Impeccably groomed moustache, apologetic polite smile, aristocratic refinement, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "peregrine_1b_dandy_female",
                "title": "Sir Peregrine 1B: The Hallmarked Dandy (Female) — Lady Cecily Ashby-Lisle",
                "seed": 3012,
                "prompt": (
                    "Full-length portrait of an aristocratic Victorian noblewoman duelist and pitfighter, poised elegant female, 32 years old, "
                    "drawing an exquisite rapier from an ebony cane in a classical en-garde fencing stance before a foggy ballroom colonnade. "
                    "Both arms from the shoulder are carved black ebony encased in pierced hallmarked sterling silver filigree scrollwork, with silver crest medallions at the shoulders and delicate sharpened silver claws. "
                    "Wearing a tailored emerald-green velvet fencing coat with silver frogging over a corseted silk vest, ruffled lace cravat, dark tailored trousers, and polished riding boots with silver spurs. "
                    "Arched eyebrows, serene courteous smile, aristocratic poise, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 2: The Clockwork Fencing Master
            {
                "id": "peregrine_2a_clockwork_male",
                "title": "Sir Peregrine 2A: The Clockwork Fencer (Male) — Sir Julian Ashby-Lisle",
                "seed": 3013,
                "prompt": (
                    "Full-length action portrait of an aristocratic Victorian fencing master, athletic lean male, 36 years old, "
                    "executing a lightning-fast rapier lunge in a duel salon at dawn. "
                    "Both arms are damascened blued-steel and polished sterling silver armature with visible jeweled escapement gears and coiled mainsprings for supersonic ripostes. "
                    "Wearing a padded black velvet fencing doublet embroidered with silver wire, high leather duel boots, and a silver monocle with fine crosshair vernier reticle. "
                    "Razor-sharp focus, calm courteous expression, glinting sword tip, dust motes in morning sunbeams, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "peregrine_2b_clockwork_female",
                "title": "Sir Peregrine 2B: The Clockwork Fencer (Female) — Lady Vivienne Ashby-Lisle",
                "seed": 3014,
                "prompt": (
                    "Full-length action portrait of an aristocratic master swordsman noblewoman, poised lethal female, 30 years old, "
                    "holding a slender rapier in a lightning parry stance on a wet cobblestone terrace. "
                    "Both arms are articulated blued-steel and sterling silver clockwork prosthetics with exposed balance wheels and coiled tension springs along the forearms. "
                    "Wearing a quilted black silk fencing plastron over a high-collared white linen shirt, tailored breeches, dark leather gloves, hair pinned in a sleek braided chignon. "
                    "Calm aristocratic gaze, polite slight bow, glinting steel blade, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 3: The Disgraced Regency Gambler
            {
                "id": "peregrine_3a_gambler_male",
                "title": "Sir Peregrine 3A: The Disgraced Gambler (Male) — Sir Alistair Ashby-Lisle",
                "seed": 3015,
                "prompt": (
                    "Full-length portrait of a decadent Victorian aristocratic gambler and swordsman, dashing male, 38 years old, "
                    "leaning casually with a silver swordstick in a shadowy London gambling den. "
                    "Both arms are tarnished antique sterling silver skeletal limbs featuring intricate repoussé vine engravings and deep rose-cut garnet stones embedded in the knuckles. "
                    "Wearing an open-collared embroidered burgundy velvet frock coat, disheveled silk cravat, silver watch-fob chain, and scuffed patent leather shoes. "
                    "Cynical charm, tired aristocratic smirk, cigar smoke swirling around silver fingers, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "peregrine_3b_gambler_female",
                "title": "Sir Peregrine 3B: The Disgraced Gambler (Female) — Lady Genevieve Ashby-Lisle",
                "seed": 3016,
                "prompt": (
                    "Full-length portrait of a reckless Victorian noblewoman gambler and duelist, glamorous dangerous female, 34 years old, "
                    "holding an ebony-and-silver rapier cane tipped against the floor of an underground private club. "
                    "Both arms are tarnished solid sterling silver filigree prosthetics studded with cabochon red garnets along the wrists and knuckles. "
                    "Wearing a deep crimson velvet riding coat with tarnished silver buttons, black silk cravat, gold signet rings, dark tailored trousers. "
                    "Daring arched eyebrow, sly apologetic smile, smoky atmospheric tavern lighting, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 4: The Gaslight Swashbuckler
            {
                "id": "peregrine_4a_swashbuckler_male",
                "title": "Sir Peregrine 4A: The Gaslight Swashbuckler (Male) — Sir Valentine Ashby-Lisle",
                "seed": 3017,
                "prompt": (
                    "Full-length action portrait of an operatic Victorian nobleman blade, flamboyant athletic male, 33 years old, "
                    "lunging forward on a rain-slicked Victorian bridge at night with a rapier drawn from a silver cane with integrated multi-barrel pepperbox handle. "
                    "Both arms are mirror-polished chrome-silver and pearlescent ivory segmented arms engraved with the Latin motto 'Perdonen Mi Espada'. "
                    "Wearing a dramatic black silk-lined opera cloak billowing in the wind, ruffled lace jabot, tailored evening trousers, and leather boots with silver spurs. "
                    "Windblown dark hair, charming roguish expression, gaslamp halos in heavy river fog, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "peregrine_4b_swashbuckler_female",
                "title": "Sir Peregrine 4B: The Gaslight Swashbuckler (Female) — Lady Beatrice Ashby-Lisle",
                "seed": 3018,
                "prompt": (
                    "Full-length action portrait of an operatic Victorian duelist noblewoman, daring athletic female, 29 years old, "
                    "poised on a misty terrace balustrade with a flashing rapier drawn from a silver-pommeled cane. "
                    "Both arms are bright polished silver and carved ivory filigree prosthetics with miniature brass pepperbox pistol barrels integrated at the wrists. "
                    "Wearing a dark violet velvet opera cape, silver filigree domino mask pushed up into dark curls, corseted duel vest, and polished leather boots. "
                    "Confident dashing smile, river fog and moonlit gaslight reflections, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 5: The Weeping Silver Mourning Duelist
            {
                "id": "peregrine_5a_weeping_male",
                "title": "Sir Peregrine 5A: The Weeping Silver Duelist (Male) — Sir Sebastian Ashby-Lisle",
                "seed": 3019,
                "prompt": (
                    "Full-length portrait of a somber Victorian aristocratic avenger and swordsman, austere male, 35 years old, "
                    "standing motionless with a silver rapier cane on a rain-swept cobblestone alley. "
                    "Both arms are chiseled solid silver filigree over black obsidian glass, sculpted with stylized weeping silver tears streaming down the forearms. "
                    "Wearing a pitch-black Victorian mourning coat with matte silk lapels, black gloves, black cravat with a mourning pearl pin, and black top hat. "
                    "Melancholic courteous stare, absolute cold precision, pouring rain, wet pavement reflections, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "peregrine_5b_weeping_female",
                "title": "Sir Peregrine 5B: The Weeping Silver Duelist (Female) — Lady Eleanor Ashby-Lisle",
                "seed": 3020,
                "prompt": (
                    "Full-length portrait of a lethal Victorian noblewoman in mourning, pale somber female, 31 years old, "
                    "holding an unsheathed rapier pointing down in a formal duel salute in misty rain. "
                    "Both arms are sculpted obsidian glass and antique silver vine filigree with teardrop-shaped silver ornaments dangling along the forearms. "
                    "Wearing a black silk mourning gown with tailored fencing cutaway, black lace veil pinned to a dark velvet hat, high black boots. "
                    "Sorrowful yet lethal calm gaze, raindrop ripples in puddles, atmospheric gaslight, gritty Victorian steampunk photorealism."
                )
            }
        ]
    },

    "inkle": {
        "folder": "public/tex/characters/ideation_inkle",
        "items": [
            # Archetype 1: The Crutch Street Pawnshop Patchwork (The Classic Inkle)
            {
                "id": "inkle_1a_pawnshop_male",
                "title": "Inkle 1A: The Pawnshop Patchwork (Male) — Cuthbert Inkle",
                "seed": 3021,
                "prompt": (
                    "Full-length action portrait of an impoverished, terrified Victorian legal clerk pitfighter, scrawny wiry male, 24 years old, "
                    "flailing in an awkward accidental martial arts stance in a dingy Victorian alleyway. "
                    "His limbs are wildly mismatched borrowed pawnshop prosthetics with yellow parchment pawn tickets fluttering on red string: "
                    "Left arm is a delicate cracked porcelain doll arm with ticket #204, Right arm is a massive hairy brown taxidermy bear paw with ticket #88, "
                    "Left leg is a spindly brass telescoping telescope stilt, Right leg is a clunky cast-iron stovepipe boot. "
                    "Wearing a threadbare black alpaca office coat with frayed ink-stained cuffs, crooked wire-rimmed spectacles, ink smudges on nose, legal parchment writs stuffed in pockets. "
                    "Wide-eyed terrified expression, hysterical panic, papers flying, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "inkle_1b_pawnshop_female",
                "title": "Inkle 1B: The Pawnshop Patchwork (Female) — Clara Inkle",
                "seed": 3022,
                "prompt": (
                    "Full-length action portrait of an impoverished desperate Victorian legal copyist and amateur pitfighter, thin anxious female, 22 years old, "
                    "stumbling in an awkward defensive fighting posture in a damp cobblestone alley. "
                    "Her limbs are wildly mismatched borrowed pawnshop prosthetics with yellowed pawn tickets on string: "
                    "Left arm is a polished brass clockmaker's gear-hand with pawn ticket #315, Right arm is a heavy carved wooden ship-figurehead arm with ticket #94, "
                    "Left leg is a delicate white porcelain doll leg, Right leg is a heavy riveted iron boiler-pipe boot. "
                    "Wearing an ink-splattered calico work blouse, patched wool skirt, wire spectacles tied with twine, hair flying loose from a bun. "
                    "Frantic panicked expression, dropped legal papers fluttering in rain, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 2: The Chancery Scrivener Automaton
            {
                "id": "inkle_2a_scrivener_male",
                "title": "Inkle 2A: The Chancery Scrivener (Male) — Barnaby Inkle",
                "seed": 3023,
                "prompt": (
                    "Full-length portrait of a frantic Victorian chancery copyist and brawler, gaunt sweaty male, 27 years old, "
                    "standing in an erratic boxing stance amid piles of overflowing legal briefs. "
                    "Both arms are cobbled-together printing machinery: Left arm an articulated copper printing-press roller arm, Right arm a cluster of sharpened steel dip-pens on a brass stylus armature, "
                    "Left leg an iron bookbinder's screw-clamp, Right leg a wooden ledger-table spindle. "
                    "Wearing an ink-soaked waistcoat, paper celluloid collar, green parchment eye-shade visor, ink bottle hanging from neck on string. "
                    "Frazzled wild-eyed look, ink splatters on clothes and face, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "inkle_2b_scrivener_female",
                "title": "Inkle 2B: The Chancery Scrivener (Female) — Constance Inkle",
                "seed": 3024,
                "prompt": (
                    "Full-length portrait of an exhausted Victorian court copyist and brawler, nervous intense female, 25 years old, "
                    "holding up an ink-well armature in an anxious fighting stance in a clerk's office. "
                    "Her arms are cobbled printing office mechanisms with rotating ink rollers, brass paper-punch stylus fingers, and a heavy bookbinder press vice leg, all bearing dangling pawn tags. "
                    "Wearing a green transparent eye-shade visor, black cloth sleeve protectors over white linen blouse, dark pleated wool skirt with ink stains. "
                    "Anxious furrowed brow, dark circles under eyes, legal parchment scrolls tucked under arm, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 3: The Junk-Shop Brawler
            {
                "id": "inkle_3a_junkshop_male",
                "title": "Inkle 3A: The Junk-Shop Brawler (Male) — Felix Inkle",
                "seed": 3025,
                "prompt": (
                    "Full-length portrait of a shivering Victorian pauper clerk and amateur pitfighter, underfed pale male, 23 years old, "
                    "crouched in an improvised boxing stance in an East End scrap-metal dump. "
                    "His limbs are scavenged salvage parts with greasy pawn tags: Left arm a copper boiler water-pipe with brass pressure gauge, Right arm a rusted cast-iron dock crane winch, "
                    "Left leg an ornate cast-iron gas lamppost stem, Right leg a wooden ship-pulley block. "
                    "Wearing an oversized ragged overcoat held together by large brass safety pins, wool fingerless mittens, tattered scarf. "
                    "Shivering anxious grin, desperate grit, scrap iron and Thames mud backdrop, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "inkle_3b_junkshop_female",
                "title": "Inkle 3B: The Junk-Shop Brawler (Female) — Florence Inkle",
                "seed": 3026,
                "prompt": (
                    "Full-length portrait of a ragged Victorian pauper copyist, shivering wiry female, 21 years old, "
                    "standing with fists raised defensively in a muddy London scrap yard. "
                    "Her limbs are scavenged pawnshop junk: Left arm a copper tea-kettle boiler arm with steam pressure relief valve, Right arm a rusted iron pulley winch, "
                    "Left leg a tall brass grandfather clock pendulum rod, Right leg a heavy coal-chute bracket, all bearing flapping pawn tickets. "
                    "Wearing a patched wool shawl over a threadbare dark dress, muddy apron, fingerless knit gloves, tangled brown hair. "
                    "Determined teary-eyed expression, swirling coal smoke and fog, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 4: The Bailiff's Nightmare
            {
                "id": "inkle_4a_bailiff_male",
                "title": "Inkle 4A: The Bailiff's Nightmare (Male) — Arthur Inkle",
                "seed": 3027,
                "prompt": (
                    "Full-length action portrait of a panicked Victorian articled clerk fleeing debt bailiffs, skinny disheveled male, 25 years old, "
                    "accidentally striking a devastating blow with a pawned limb while running through a rain-soaked alley. "
                    "Left arm is an exquisite gold-plated clockmaker's gear-work arm with fluttering pawn ticket #409, "
                    "Right arm is a brutal forged-iron butcher's meat-hanging hook with blood-stained pawn ticket #112. "
                    "Wearing a disheveled clerk's suit, flying coat-tails, papers spilling from an open leather satchel, spectacles askew. "
                    "Screaming in horror at his own lethal strike, splashing water, lantern light reflections, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "inkle_4b_bailiff_female",
                "title": "Inkle 4B: The Bailiff's Nightmare (Female) — Alice Inkle",
                "seed": 3028,
                "prompt": (
                    "Full-length action portrait of a terrified Victorian legal copyist caught in a brawl, petite trembling female, 23 years old, "
                    "flailing in accidental combat in a foggy London gaslit passage. "
                    "Left arm is an ornate jeweler's brass measuring caliper arm with ticket #551, Right arm is a massive dockworker's iron gaff-hook with red sealing wax pawn tag #019. "
                    "Wearing a dark blue clerk's dress, white apron smeared with black ink, hair coming undone, court summonses flying in the air. "
                    "Gasping in terrified shock, explosive dynamic motion, gritty Victorian steampunk photorealism."
                )
            },

            # Archetype 5: The Relic-Pawn Gladiator
            {
                "id": "inkle_5a_relic_male",
                "title": "Inkle 5A: The Relic-Pawn Gladiator (Male) — Percival Inkle",
                "seed": 3029,
                "prompt": (
                    "Full-length portrait of an absurd yet dangerous Victorian legal clerk, scrawny timid male, 26 years old, "
                    "standing in an ill-fitting knight's combat stance in a cobblestone square. "
                    "Left arm is an antique 16th-century blackened gothic tournament plate-armor gauntlet with a large yellow pawn ticket reading 'UNCLE GIDEON - CRUTCH ST', "
                    "Right arm is a raw copper plumber's pipe, Left leg is an ancient carved oak table leg, Right leg is a splintered pine peg leg with rubber stopper. "
                    "Wearing an oversized secondhand houndstooth gentleman's waistcoat, collar buttoned too tight, round fogged spectacles. "
                    "Puzzled timid squint, dust flying from heavy gauntlet, gritty Victorian steampunk photorealism."
                )
            },
            {
                "id": "inkle_5b_relic_female",
                "title": "Inkle 5B: The Relic-Pawn Gladiator (Female) — Penelope Inkle",
                "seed": 3030,
                "prompt": (
                    "Full-length portrait of a nervous Victorian clerk and accidental gladiator, frail pale female, 24 years old, "
                    "attempting an en-garde stance with mismatched pawnshop relics in a foggy alley. "
                    "Left arm is an embossed brass museum suit-of-armor gauntlet with a dangling pawnbroker tag, Right arm is an unpolished pine carpenter's rule arm, "
                    "Left foot is an iron sadiron shoe, Right leg a slender carved chair leg. "
                    "Wearing an oversized dark woolen coat, spectacles perched on nose, hair pinned up hastily, court briefs peeking from pocket. "
                    "Nervous apologetic grimace, dramatic atmospheric street lighting, gritty Victorian steampunk photorealism."
                )
            }
        ]
    }
}

def build_workflow(prompt_text, seed, width=896, height=1152):
    workflow = {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "flux3-image-klein-int8-convrot.safetensors",
                "weight_dtype": "default"
            }
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen3vl_4b_int8_convrot.safetensors",
                "type": "flux3",
                "device": "default"
            }
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": "flux2-vae.safetensors"
            }
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "text": prompt_text
            }
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "text": "blurry, low quality, deformed, extra limbs, cartoon, anime, 3d render"
            }
        },
        "6": {
            "class_type": "EmptyFlux2LatentImage",
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1
            }
        },
        "7": {
            "class_type": "ModelSamplingFlux",
            "inputs": {
                "model": ["1", 0],
                "max_shift": 1.15,
                "base_shift": 0.5,
                "width": width,
                "height": height
            }
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["7", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
                "seed": seed,
                "steps": 16,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0
            }
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["8", 0],
                "vae": ["3", 0]
            }
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["9", 0],
                "filename_prefix": "flux3_ideation"
            }
        }
    }
    return workflow

def run_batch():
    total = sum(len(c["items"]) for c in CHARACTERS.values())
    print(f"Starting batch generation of {total} character options across Crape, Ashby-Lisle, and Inkle...")
    start_all = time.time()
    count = 0

    for char_key, char_info in CHARACTERS.items():
        out_folder = char_info["folder"]
        os.makedirs(out_folder, exist_ok=True)
        print(f"\n=================== Generating {char_key.upper()} ({len(char_info['items'])} items) ===================")

        for item in char_info["items"]:
            count += 1
            item_id = item["id"]
            title = item["title"]
            seed = item["seed"]
            prompt = item["prompt"]
            out_path = os.path.join(out_folder, f"{item_id}.png")

            if os.path.exists(out_path) and os.path.getsize(out_path) > 100000:
                print(f"[{count}/{total}] Skipping (already exists): {item_id}")
                continue

            print(f"\n[{count}/{total}] [FLUX3] Generating: {title}...")
            t0 = time.time()
            wf = build_workflow(prompt, seed)

            req = urllib.request.Request(
                f"{COMFY_HOST}/prompt",
                data=json.dumps({"prompt": wf}).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            res = urllib.request.urlopen(req)
            prompt_id = json.loads(res.read()).get("prompt_id")
            print(f"  - Queued: {prompt_id}")

            # Poll for completion
            while True:
                time.sleep(1)
                h_res = urllib.request.urlopen(f"{COMFY_HOST}/history/{prompt_id}")
                h_data = json.loads(h_res.read())
                if prompt_id in h_data:
                    entry = h_data[prompt_id]
                    status = entry.get("status", {})
                    if status.get("status_str") == "error":
                        raise RuntimeError(f"ComfyUI error: {status.get('messages')}")
                    
                    outputs = entry.get("outputs", {})
                    if "10" in outputs and "images" in outputs["10"]:
                        img_info = outputs["10"]["images"][0]
                        fn = img_info["filename"]
                        sub = img_info.get("subfolder", "")
                        src_path = os.path.join(COMFY_OUTPUT, sub, fn)
                        shutil.copyfile(src_path, out_path)
                        elapsed = time.time() - t0
                        print(f"  - Saved to {out_path} ({os.path.getsize(out_path)} bytes) in {elapsed:.1f}s")
                        break

    total_time = time.time() - start_all
    print(f"\n[ALL COMPLETE] Finished {total} character options in {total_time:.1f}s!")

if __name__ == "__main__":
    run_batch()
