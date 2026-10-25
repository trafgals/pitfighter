# Frame data calibration against Urban Reign

The timings in `src/sim/moves.ts` come from the retail *Urban Reign* engine
(SLUS_212.09, the unpatched reference build of urban-reign-pitfighter). They
were read out of its EE RAM frame by frame in the first story fight: Brad
against Real Deal and two thugs. The measured values are in
`calibration/urban-reign-frames.json`. `tests/calibration.test.ts` drives this
game's simulation against them.

## Method

1. **Find the fields.** `tools/ur-calibration/probe1.mjs` records 4 KB of every
   actor struct (+0x8800..+0x9800) each frame while player 1 presses each face
   button once. The analysis scripts `an1`–`an3` look for fields that change on
   the press, on a hit, or on HP loss. They found these fields:

   | field | offset | notes |
   |---|---|---|
   | motion id | +0x8d40 u16 | the animation currently playing, e.g. 1388–1391 Brad's neutral string, 76 dodge |
   | state class | +0x8d44 u16 | 0 idle, 6 strike, 7 hit reaction, 8 dodge/deflect/grapple, 9 deflected, 10 dodge, 11 down |
   | motion changed | +0x88f0 u16 | 1 on the first frame of a new motion |
   | HP | +0x8e28 u16 | max at +0x8e2a (1500 Brad, 1200 thugs) |
   | hits taken | +0x8ed0 u16 | increments on each hit |

   The HP word at +0x8c50 that the story regression test snapshots reads 0
   during a fight, so it is not HP.

2. **Time things.** `probe2.mjs` and `probe3.mjs` install a sampler in the page.
   It reads those fields for all actors on every game frame, and an in-page
   policy picks player 1's pad input for that frame:
   - **Dodge / deflection.** When an enemy starts a strike motion, press Square
     (*Dodge/Deflection*, message 1112). Probe2 presses it alone, probe3 with a
     stick direction. The press is placed at a cycling offset relative to the
     strike's known hit frame.
   - **Strikes.** From idle, press Circle once or mash it, with and without
     down on the stick.
   - **Grapples.** From idle, press Triangle.

   `an4`–`an6` turn the captures into the reports in `calibration/*.txt`.

Everything is counted from the first frame of a motion. A pad press reaches the
engine about 4 frames later. That latency is Urban Reign's input path plus one
frame of the sampler, and this game does not reproduce it.

## What was measured

| | Urban Reign | moves.ts |
|---|---|---|
| neutral string hit frames | 12 / 9 / 11 / 17 | jab1 12, jab2 9, jab3 11, punchFin 17 |
| follow-up starts | 3 f after the previous hit | `active` 3, since the cancel happens at startup + active |
| hit gaps in a 4-hit string | 12 / 14 / 20 | 12 / 14 / 20 |
| lone strike length | 42–44 f | 12 + 3 + 28 = 43 |
| finisher length | 46–47 f, knocks down | 17 + 4 + 26 = 47 |
| light hit reaction | 41 f (lone strike leaves the attacker +10) | hitstun 41 |
| low strikes | hit on 18 (48 total) and 26 (53–66 total) | kick1 18/48, kick2 20, sweep 26/60 |
| dodge motion | 36 f | REVERSAL.dur 36 |
| deflect window | the strike lands on dodge frames 2..14 | REVERSAL.first 2, window 14 (motion frames) |
| after a deflection | defender locked 41 f, attacker 54–66 f, so the defender ends about +15 | defender free at once, attacker stunned 15 |
| grapple | catches on its first frame, whiffs 42–62 f, holds 101 f | GRAB.startup 1, total 45, HOLD.dur 100 |
| knockdown | about 50 f falling and on the floor, 50 f get-up | DOWN.dur 50, wake 50 |

Enemy strike motions hit on frames 14–26. The thugs' jabs are slower than
Brad's.

## Reactions, knockdowns and throws

`docs/calibration/urban-reign-reactions.json` holds the reaction motions read
from EE RAM in the first story fight (probes 2–4, `an7.cjs`). It records frame
numbers only. The renderer's clips are timed to it, and
`tests/animation.test.ts` checks them against it.

| | Urban Reign | Pitfighter |
|---|---|---|
| light hit reaction | one 41 f record per striking limb (actions 19, 20, 21) | hitstun 41; the reaction is chosen by height, side and strength |
| heavy hit reactions | records of 46, 57, 59, 61 and 74 f (actions 24, 90, 179, 27, 256) | the sim's hitstun for the blow |
| knockdown fall | reaches the floor on frame 11–38, median 27 (action 154) | `FALL_LAND` 27 |
| on the floor | face up (action 170) or face down (177) | `DOWN_BACK` / `DOWN_FRONT`; face down after a blow from behind |
| get-up | 50 f face up (168) or face down (175) | `DOWN.wake` 50, `WAKE_BACK` / `WAKE_FRONT` |
| throw | the thrower's motion runs 48 f, the most common measurement (record 49) | `THROW_TIMING.end` 48 |

Which heavy reaction goes with which height and direction is not measured yet.

## Every moveset, read from the executable

The measurements above cover Brad and the first fight's thugs. The frame data of
every moveset comes from the game's own attack tables instead:
`tools/ur-calibration/movesets.cjs` decodes them into
`calibration/urban-reign-movesets.json` (every record) and
`calibration/urban-reign-movesets.md` (a frame data table per moveset).

The tables are static data in the executable, byte-identical to the same
addresses in an EE RAM dump taken mid-fight, so the dump needs no emulator run.
Their layout comes from the Urban Reign Redux mod
([Jasonafex/urban-reign-redux](https://github.com/Jasonafex/urban-reign-redux),
`runtime/combat-trial13/ur_actions.py`):

| table | address | record | what it gives |
|---|---|---|---|
| action | 0x4616f0 | 64 bytes, indexed by the action id at actor + 0x8d40 | animation, state class, last frame, branch list, reaction record |
| reaction | 0x4ab768 | 236 bytes | the hit list (only strike actions, state 6, have one) |
| hit | 0x51e5a0 | 9 × s16 | the first active frame of each hit |
| branch | 0x5338d8 | 15 × s16 | the follow-up action and the frames in which its input is taken |
| moveset | pointers at 0x59b560 | 128 records | 12 root actions; [0] is the neutral strike |

The branch table is the same one the urban-reign-pitfighter tests read as the
"per-player record table" at 0x5338d8.

`tests/urban-reign-movesets.test.ts` checks the decoded records against
everything measured in EE RAM:

- Brad's moveset (0) roots at 1388, and its branches chain 1388 → 1389 → 1390 → 1391.
- Every measured hit lands 0–2 frames after its record's first active frame, a
  little later when the target stands further away.
- An action that ran to its end lasts its record's last frame + 1: 43 for the
  lone strike, 36 for the dodge, 41 for the hit reaction, 101 for the grapple
  hold. The deflection motions fall inside their measured ranges.
- The actions measured shorter than their record were cut by whatever followed:
  the finisher (57 decoded, 46–47 measured), Brad's stick-down strike 2937
  (59 / 48), the evade (34 / 29–31), the hold follow-up (49 / 47) and the get-up
  (51 / 50).
- The string's follow-up windows open after each hit, and taking them on their
  first frame reproduces the measured hit gaps within a few frames.

Still unidentified: the meaning of moveset roots [1]–[9], the hit fields after
the first (field [3] looks like the limb), the branch fields other than the
target, input and window, and which character uses which moveset (index 0 is
Brad; the index is not the character index of the name table).

### The moves, grouped

`tools/ur-calibration/clusters.cjs` groups every decoded strike (1909 of them,
from 71 distinct movesets) into 29 clusters by the limb that carries it, its
place in a string and its timing, and the grapple-class actions into 6 bands by
length:
[calibration/urban-reign-move-clusters.md](calibration/urban-reign-move-clusters.md),
with the data in `calibration/urban-reign-move-clusters.json`. The move
vocabulary in `src/data/characters.json` is built on them: every archetype a
fighter's moves are written against names the clusters it comes from, and
`tests/roster.test.ts` holds each archetype inside them and each move inside
its archetype ([docs/characters.md](characters.md)).

## Not calibrated

- **Damage, reach and knockback** stay this game's own. Urban Reign scales
  damage by body region and character.
- **Blockstun.** Urban Reign has no guard. Blockstun is set so that every move
  is 4 frames minus on block.
- **Reversal damage and pushback.** An Urban Reign deflection deals no damage.
  The 8 damage and the kinetic pushback are design choices for the 8-player
  game.
- **Style tempo.** Only Brad's (All-Round) frame data feeds `moves.ts`. The style
  tempo modifiers in `styles.ts` were doubled with the frame scale, so every
  style keeps the same relative speed it had before. The other movesets' frame
  data is now dumped (above) but not used yet.

## Reproducing

```bash
# from a checkout of urban-reign-pitfighter, with the reference engine served by UR_CALIB_ROOT
UR_PITFIGHTER=../urban-reign-pitfighter UR_CALIB_ROOT=... UR_CALIB_OUT=out node tools/ur-calibration/probe2.mjs
node tools/ur-calibration/an4.cjs out/cap2.json
```

`UR_CALIB_ROOT` is a directory containing the reference engine
(`ps2web.js/.wasm/.data` built with `PS2_PATCHES=none`) plus urban-reign-pitfighter's
`index.html`, `chunk_driver.js`, `brotli_dec.js`, `coi-serviceworker.min.js`
and `serve.py`. The disc streams from the CDN. Each probe has a hard watchdog
and takes 5–8 minutes, most of it spent booting into the fight.
