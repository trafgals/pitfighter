# The character design

`src/data/characters.json` is where a fighter is written down.

It holds two things at once. One is the numbers the game plays today: each
fighter's stats, special, animation family, silhouette, painted face, air grab
and textures. The game reads them through the views in
`src/data/characters.ts`. The other is the whole design of the fighter, ready
to hand to whoever builds it next: every move in the full *Urban Reign* verb
set, how the fighter looks, how they sound, who they are and who they hate.
Most of those verbs are not in the game yet. The file says which are.

There is no second copy of a fighter's design anywhere in the repo. The tools
that generate assets from it (textures, sound) read the same file.

## The world

The theme is **Old Sorrow**, a fantasy steampunk city where it has rained for
ninety-one years. Its storm drains meet in the Sump, a drowned amphitheatre
where the Benevolent Society for the Elevation of the Lower Orders by Pugilism
holds its bouts. The city's finest ladies and gentlemen beat one another to
death there for charity, in their best clothes.

The tone is in `theme.tone`: **dignified and extremely violent**. Every fighter
is a lady or a gentleman, and every fighter is a murderer. The comedy is the
distance between the two: the bow before the disembowelling, the apology during
it, the condolence card after. It is an R18+ game, and `theme.blood` sets how
much blood there is (a great deal) and what it does.

Three ideas run through every fighter:

- **The crafts.** Every fighter's limbs are made in a craft of their own:
  clockwork brass, kiln porcelain, ship's oak, aether glass and so on. The
  craft sets how the limbs look, how they break, how they bleed, what they hit
  with (the sim's `tip`), and the sound of every blow they land. A torn-off
  limb keeps its craft on its new owner. The twelve crafts are in `crafts`.
- **The Tincture.** Each fighter has a draught that lets out who they would be
  without their manners: the same person in the same clothes, with no manners
  left. It is their Status Art (`moves.status`). The Hyde to their Jekyll has
  its own voice lines and its own glow.
- **The Gallery.** The crowd in the private boxes round the Sump. A fighter who
  lands a good blow and then appeals to its dignity (a taunt) is answered with
  a gift thrown into the pit: a steampunk weapon, or a spare limb
  (`theme.gallery`). Each fighter has a signature weapon from that list.

## The roster

| # | Fighter | Style | Limbs | Special |
|---|---|---|---|---|
| 0 | Constable Obadiah Winch | All-Round | Clockwork Brass | THE RIOT ACT |
| 1 | Mr. Hezekiah Smelt | Mighty | Foundry Iron | FULL STEAM AHEAD |
| 2 | Nell Sluice | Street | Drainpipe Lead | THE SLUICE GATE |
| 3 | Matron Prudence Kilnworth | Karate | Kiln Porcelain | THE ROUNDS |
| 4 | The Great Bartholomew Mule | Wrestling | Grafted Bear | THE DANCING BEAR |
| 5 | Bosun Absalom Rook | Muay Thai | Ship's Oak | THE CAT O' NINE |
| 6 | Lady Hester Bulwark | Boxing | Hydraulic Steel | A HUNDRED POUNDS TO THE INCH |
| 7 | Percival "Oolong" Crump | Kung Fu | Bamboo and Samovar | THE SPILLED SAMOVAR |
| 8 | Mistress Tabitha Pegg | Tae Kwon Do | Cast-Iron Lasts | THE HOT WELT |
| 9 | Mr. Mortimer Crape | Judo Based | Jet and Whalebone | INTERMENT |
| 10 | Sir Peregrine Ashby-Lisle, Bt. | Samurai Sword | Silver and Ebony | A THOUSAND PARDONS |
| 11 | Mr. Cuthbert Inkle | Amateur | Pawnshop Patchwork | THE OVERDRAFT |

There is one fighter for each group of *Urban Reign*'s 21 styles. `lineage`
names the styles a fighter stands for: Sir Peregrine is both Samurai Sword and
Gun, and Crump is Kung Fu, Speed and Master.

## Editing a fighter

Change `src/data/characters.json` and run `npm test`. The tests will tell you
what you broke.

Five rules:

1. **Do not reorder the roster.** `Fighter.style` is an index into
   `characters`, and the order is load-bearing: `tests/combat.test.ts` names
   fighters by position, `src/strip.ts` finds a style by scanning for its
   family, and `src/select.ts` picks one at random by index. Adding a fighter
   at the end is fine. Moving one is not.
2. **A change to a fighter is a change to that fighter.** If a fighter's
   numbers change, its face does not need to. The painted face (`look`) is
   written down like everything else.
3. **Every move keeps to its archetype.** A move names an `archetype` from
   `vocabulary`, and its frame data has to stay inside that archetype's
   envelope (see below). A fighter built from the design then moves at Urban
   Reign's tempo, however different it looks.
4. **The `sim` fields name what plays the move today.** The string strikes,
   the dash strike, the headbutt, the hold, the knee, the first throw and the
   first deflect each name the sim move that stands in for them (`jab1`,
   `punchFin`, `kick1`, `GRAB`, `THROW` and so on). The high string has
   `stats.string` jabs and a finisher, in the order `World.nextOf` plays them.
   Change `stats.string` and the high string has to change with it.
5. **The texture half has two homes.** The design says what a fighter's hide
   looks like; `public/tex/spec.json` is the texture pipeline's own record of
   what was rendered from it, with the base seed and any per-surface seed
   overrides. A test compares the two fighter by fighter (the slug, the name,
   the colours, the surface ideas and the base seed), so change both or
   neither.

   The `seed_overrides` block is the pipeline's own bookkeeping: it records
   the seed a surface was re-rendered with, after the first render tiled
   badly. `characters.json` has no field for it, so it is not part of the
   design. A test does check that every override still names a real fighter or
   stage and a real surface, so a typo cannot hide there.

## The shape

```jsonc
{
  "schema": "pitfighter-characters/2",

  "theme": { "title": "OLD SORROW", "logline": "...", "world": "...",
             "tone": {...}, "gallery": {...}, "tincture": {...}, "blood": {...}, "stages": [...] },

  // each limb craft: its look, its sound, how it breaks and bleeds, its sim tip, its impact cue
  "crafts": [ { "id": "clockwork-brass", "tip": "fist", "hit": "...", "cue": {...} } ],

  // the move archetypes, grouped from Urban Reign's own measured moves
  "vocabulary": {
    "strikes":  { "jab": { "clusters": ["arm-opener-quick"], "startup": [10, 19], "length": [41, 68] } },
    "grapples": { "throw": { "band": "...", "duration": [...] } },
    "own": { "airGrab": { "duration": [32, 72] } }
  },

  // every verb in the full set, and whether the game has it
  "systems": [ { "id": "charge", "status": "implemented", "where": "CHARGE in src/sim/moves.ts" } ],

  // the six special shapes: frame data and a generic name
  "specials": { "spSpin": { "name": "THE WHIRLIGIG", "move": { "id": "spSpin", "startup": 10, ... } } },

  "characters": [
    {
      // what the game reads today
      "id": "lady-eleanor",        // the slug: the key for public/tex and public/sfx
      "name": "Lady Eleanor Ashby-Lisle",
      "style": "Samurai Sword",    // the Urban Reign style label
      "blurb": "...", "body": "#...", "accent": "#...",
      "family": "brawler",         // the animation family it fights in
      "special": "spBlade",        // which shape its special has
      "specialName": "A THOUSAND PARDONS",  // what the HUD shouts
      "stats": { "speed": 1, "startup": 2, "punch": 1.1, "string": 2, ... },
      "kit": { "size": 1, "horns": "none", "tail": "none", "gear": ["tophat", "monocle"] },
      "look": { "def": 0.82, "scar": 1, ... },
      "airGrab": { "name": "THE CARVING", "dur": 52, "end": "throw", "dist": 4, ... },

      // the design, for hand-off
      "short": "SIR PEREGRINE", "title": "...", "lineage": ["Samurai Sword", "Gun"],
      "ratings": { "power": 4, "speed": 3, "reach": 5, ... },          // 1..5, for the select screen
      "profile": { "bio": "...", "manners": "...", "violence": "...",
                   "otherSelf": "...", "rivals": [...], "partner": {...}, "quotes": [...] },
      "limbs": { "craft": "silver-ebony", "tip": "spike", "lean": "...", "wear": "..." },
      "moves": {
        "high": [ { "id": "by-your-leave", "name": "By Your Leave", "input": "○",
                    "archetype": "jab", "startup": 13, "active": 3, "recovery": 32, "dmg": 5,
                    "anim": "...", "sfx": "...", "vfx": "...", "sim": "jab1" } ],
        "low": [...], "branches": [...], "regional": [...], "dash": [...], "dive": [...],
        "down": [...], "headbutt": [...], "double": [...],
        "hold": {...}, "clinch": [...], "throws": [...], "back": {...}, "wall": {...},
        "grappleDash": {...}, "diveGrab": {...}, "ground": {...}, "deflects": [...],
        "special": {...}, "arts": [...], "status": {...}, "duo": {...},
        "weapons": { "signature": "swordstick", "affinity": ["blade"] }, "appeal": {...}
      },
      "art": { "silhouette": "...", "costume": "...", "face": "...", "gore": "...", "intro": "...", ... },
      "sound": { "voice": "...", "lines": {...}, "impact": { "craft": "silver-ebony", ... },
                 "cues": [ { "id": "peregrine-draw", "category": "foley", "prompt": "...", "seed": 4700 } ] },
      "texture": {
        "seed": 5111,
        "skin":  { "idea": "...", "colour": "..." },
        "cloth": { "idea": "...", "colour": "..." },
        "face":  { "idea": "...", "colour": "..." },
        "limb":  { "idea": "...", "colour": "..." }   // the craft, painted
      }
    }
  ]
}
```

The types it has to meet are in `src/data/types.ts`, and `src/data/types.ts`
imports nothing, so any tool may read it.

## The move vocabulary

Every move is written against an archetype in `vocabulary`. The archetypes are
grouped from *Urban Reign*'s own decoded movesets: the measured moves are
clustered by limb, role and timing in
[docs/calibration/urban-reign-move-clusters.md](calibration/urban-reign-move-clusters.md)
(`tools/ur-calibration/clusters.cjs` writes it, with the data beside it in
`urban-reign-move-clusters.json`). Each strike archetype has a startup and a
whole-action length range; each grapple archetype has a duration range. A
test holds every archetype inside the clusters it came from, and every move
inside its archetype.

A move's `anim` says what the body does, `sfx` what it sounds like and `vfx`
what it sprays. They are written for whoever animates, records and effects
the move.

## What the game has

`systems` lists every verb in the full set and says how far the game has got
with it:

- **implemented**: strings, the charged strike, the dash strike, evades, the
  hold, air grabs, specials, limb loss, juggles and dizzies. Each names where
  it lives in `src/`.
- **partial**: down attacks, headbutts, deflects (one reversal for everyone),
  throws (one throw, not one per direction) and the appeal (the taunt fills
  fury, but the Gallery throws nothing yet).
- **planned**: branches, regional strikes, dive attacks, double-teams, back
  and wall grabs, grapple dashes, dive grabs, ground grapples, Special Arts,
  the Tincture, duo attacks, weapons and the crafts' own sounds and breakage.

When one of those lands, change its status and give it a `where`.

## Handing it off

- **Textures:** the twelve fighters have no textures yet. The pipeline in
  [docs/texture-handoff.md](texture-handoff.md) renders them from
  `public/tex/spec.json`, which mirrors `texture` here. `limb` is new: it is
  the craft, painted, for the limbs.
- **Sound:** each craft has an impact cue, and each fighter has its own cues
  (voice, foley, swings). They are in the same shape as `tools/sfx/prompts.json`,
  with seeds that no shipped cue uses, ready for [docs/sfx.md](sfx.md)'s
  generator.
- **Animation:** every move's `anim`, every fighter's `art.idle`, `intro`,
  `victory` and `defeat`.
- **Models:** `art` describes the silhouette, build, costume, face, hair and
  how the fighter comes apart (`gore`). The renderer's kit already draws the
  hats, helmets, whiskers, monocles and piston forearms.

## Where it came from

Version 1 of this file was generated once, from the hand-maintained tables it
replaced, for the 21 devils of the old hell roster. Version 2 replaces that
roster with the twelve fighters of Old Sorrow. The specials keep the same six
shapes and frame data; only the names changed, and each fighter now calls its
special by its own name. The script that wrote version 1 is gone, since
running it again would only overwrite this file.

`tools/character-json/snapshot.ts` prints the roster and special-name
snapshots that `tests/characters.test.ts` checks the design against. After a
deliberate change to the roster, regenerate them and paste them into the test:

```
npx vite-node tools/character-json/snapshot.ts
```

## What the tests hold

`tests/characters.test.ts` guards what the game reads:

- the roster is these twelve fighters, in this order, with these names
- every part is one the renderer knows: a known horn, tail, gear piece,
  animation family and special
- every animation family and every special is used by somebody
- the texture half agrees with `public/tex/spec.json`, and only fighters on
  the roster have textures on disk, each set whole
- `STYLES`, `KITS`, `FAMILY_OF`, `MOVES`, `AIR_GRABS` and `lookOf` are all
  derived from this one file and agree with it

`tests/roster.test.ts` guards the design:

- every archetype sits inside the *Urban Reign* moves it was grouped from, and
  every move inside its archetype
- every fighter has the whole verb set
- the `sim` fields match the order the sim plays the strings in
- rivals and partners are on the roster, and the double-team is with the partner
- every fighter's limbs are in a craft of their own
- every signature weapon is one the Gallery throws, and no two are the same
- every sound cue has an id and a seed of its own, apart from the shipped set
- every implemented system names a file that exists
