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

## Not calibrated

- **Damage, reach and knockback** stay this game's own. Urban Reign scales
  damage by body region and character.
- **Blockstun.** Urban Reign has no guard. Blockstun is set so that every move
  is 4 frames minus on block.
- **Reversal damage and pushback.** An Urban Reign deflection deals no damage.
  The 8 damage and the kinetic pushback are design choices for the 8-player
  game.
- **Style tempo.** Only Brad's (All-Round) frame data was measured. The style
  tempo modifiers in `styles.ts` were doubled with the frame scale, so every
  style keeps the same relative speed it had before.

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
