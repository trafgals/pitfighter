# The character design

`src/data/characters.json` is where a fighter is written down.

One entry per fighter: its name and blurb, its colours, its animation family,
its special, its numbers, its silhouette, its painted face and its textures.
The game reads it through the views in `src/data/characters.ts`; the tools that
generate assets from it read the same file. There is no second copy of a
fighter's design anywhere in the repo.

This replaces five hand-maintained tables that all described the same 21
fighters:

| Was | Where |
|---|---|
| the fighters and their numbers | `src/sim/styles.ts` |
| which special each fighter has | `src/sim/styles.ts` (`SPECIAL_OF`) |
| the silhouettes | `src/render/kit.ts` (`KITS`) |
| the animation family | `src/render/motion.ts` (`FAMILY_OF`) |
| the painted faces | `src/render/anatomy.ts` (`lookOf`) |
| the specials' frame data and names | `src/sim/moves.ts` (`MOVES`, `SPECIAL_NAMES`) |

## Editing a fighter

Change `src/data/characters.json` and run `npm test`. The tests will tell you
what you broke.

Three rules:

1. **Do not reorder the roster.** `Fighter.style` is an index into
   `characters`, and the order is load-bearing: `tests/combat.test.ts` names
   fighters by position, `src/strip.ts` finds a style by scanning for its
   family, and `src/select.ts` picks one at random by index. Adding a fighter
   at the end is fine. Moving one is not.
2. **A change to a fighter is a change to that fighter.** If a fighter's
   numbers change, its face does not need to. The painted face used to be a
   hash of the fighter's index, so it was painted one way and could not be
   chosen; it is now written down like everything else.
3. **The texture half has two homes.** The design says what a fighter's hide
   looks like; `public/tex/spec.json` is the texture pipeline's own record of
   what was rendered from it, with the base seed and any per-surface seed
   overrides. A test compares the two fighter by fighter - the slug, the name,
   the colours, the surface ideas and the base seed - so change both or
   neither.

   The `seed_overrides` block is the pipeline's own bookkeeping: it records
   the seed a surface was re-rendered with, after the first render tiled
   badly. `characters.json` has no field for it and no test compares one
   override against another, so it is not part of the design: changing one
   changes how that surface is rendered, not what the fighter is. A test does
   check that every override still names a real fighter or stage and a real
   surface, so a typo cannot hide there.

## The shape

```jsonc
{
  "schema": "pitfighter-characters/1",

  // the six specials: frame data and the name the HUD shouts
  "specials": {
    "spSpin": { "name": "HELLSPIN", "move": { "id": "spSpin", "startup": 10, ... } }
  },

  "characters": [
    {
      "id": "dale-damnation",     // the slug: the key for public/tex and public/sfx
      "name": "Dale Damnation",
      "style": "All-Round",       // the Urban Reign style label
      "blurb": "A regular sinner who's good at everything and great at nothing.",
      "body": "#b33a3a",
      "accent": "#2b1a1a",
      "family": "karate",          // the animation family it fights in
      "special": "spFlurry",
      "stats": { "speed": 1, "startup": 0, "punch": 1, ... },
      "kit": { "size": 1, "horns": "goat", "tail": "spade", "gear": [] },
      "look": { "def": 0.82, "scar": 1, "paint": 1, ... },
      "texture": {
        "seed": 4101,
        "skin": { "idea": "plain red devil hide, light pores, faint veins", "colour": "warm brick red" },
        "cloth": { "idea": "worn satin fabric, soft sheen, slight pilling", "colour": "dark charcoal grey" },
        "face": { "idea": "ordinary, mildly smug", "colour": "warm brick red" }
      }
    }
  ]
}
```

The types it has to meet are in `src/data/types.ts`, and `src/data/types.ts`
imports nothing, so any tool may read it.

## Where it came from

The file was generated once, from the tables it replaced, by
`tools/character-json/derive.ts`:

```
npx vite-node tools/character-json/derive.ts --force
```

That script is kept because it is the record of the migration: the `look`
numbers are the hash of each fighter's old index in the roster, and the
texture seeds and ideas come from `public/tex/spec.json`. **It refuses to
overwrite the file it wrote** — the JSON is the source of truth now, and a
stray run must not replace it with a stale copy. `--force` is the only way
through, and it is only for rebuilding the file from scratch.

`tools/character-json/snapshot.ts` prints the snapshot that
`tests/characters.test.ts` checks the design against. After a deliberate
change to a fighter, regenerate it and paste it into the test.

## What the tests hold

`tests/characters.test.ts` is the guard:

- the roster is the same 21 fighters, in the same order, with the same names
- every fighter's numbers, kit, face and special are exactly what the tables
  said before the design moved into one file
- every part is one the renderer knows: a known horn, tail, gear piece,
  animation family and special
- every animation family and every special is used by somebody
- the texture half agrees with `public/tex/spec.json`, and every fighter has
  its textures and a contact sheet on disk
- `STYLES`, `KITS`, `FAMILY_OF`, `MOVES` and `lookOf` are all derived from
  this one file and agree with it

## What comes next

The same file is the input for generating each fighter's sound
(issue #4, phase 2). A fighter's size, hide, gear, speed and special already
say a great deal about how it should sound; adding an `audio` block here means
the sound is derived from the design rather than guessed beside it.
