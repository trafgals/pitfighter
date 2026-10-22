# The Last Toilet in Hell

An 8-player local brawler for the browser. Eight damned souls spawn around the
edge of a ring of hellfire. In the middle stands the last toilet in hell. Sit
on it for 15 seconds in total to win. Progress is kept between sittings, and
any hit knocks you off.

The combat is modelled on the feel of Namco's *Urban Reign*:

- frame-data strikes measured from the real game: a 12f jab, strings that combo on hit, and heavy enders that knock down;
- high/low reversals that catch a strike landing on their frames 2�14;
- grapples with knees and directional throws;
- guard, combo damage scaling and wake-up invulnerability;
- soft lock-on;
- multi-target hits, kinetic pushback when you land a reversal, and dogpile protection.

All characters, names and art are original.

## Bodies come apart

Every arm and leg has its own HP. A limb at 0 HP falls off and lands on the
floor. Walk over to it and press *pick up* to reattach it at half HP. Anyone
else who touches it punts it away. A limb that lands in the hellfire burns,
and grows back 12 s later.

- One leg: you hop. You're slower, can't guard and can't low kick.
- No legs: you crawl.
- One arm: slower, weaker punches and weaker throws.
- No arms: Square becomes a headbutt, and you can't grab or high-reverse.
- Head at 0 HP: you're dizzy. Torso at 0 HP: you're torn apart and respawn at your spot on the edge.

## Fighters

There is one fighter per *Urban Reign* fighting style, 21 in all. The style
names come from the game's own message table, ids 1347–1367.

| Style | Fighter | Style | Fighter |
|---|---|---|---|
| All-Round | Dale Damnation | Mighty | Hellmountain |
| Power | Brimstone Bruno | Submission | Choke Chimera |
| Street | Gutter Gus | Military | Sergeant Sulphur |
| Karate | Sensei Smoulder | Capoeira | Cinder Ginga |
| Wrestling | Big Lou Cipher | Tae Kwon Do | Hellkick Hana |
| Muay Thai | Eight-Limbed Ash | Samurai Sword | Ronin of Gehenna |
| Boxing | Knuckles Inferno | Master | The Old Devil |
| Rush | Rage Reaper | Gun | Hellfire Flick |
| Speed | Quickfire Imp | Martial Arts | Brother Blaze |
| Kung Fu | Crimson Crane | Judo Based | Ashen Judoka |
| | | Amateur | Fresh Soul Kevin |

A style is a set of modifiers on the shared frame data: tempo, reach, string
length, and damage split between punches, kicks and grapples. Every fighter
keeps the same core feel. See `src/sim/styles.ts`.

## Controls

| Action | Pad | Keyboard P1 | Keyboard P2 |
|---|---|---|---|
| move | stick / d-pad | WASD | arrows |
| high strike (string) | □ | J | Num4 |
| low strike (string) | ✕ | K | Num5 |
| grab, then □ knee / ○ throw toward the stick | ○ | L | Num6 |
| high reversal | △ | I | Num8 |
| low reversal | R1 + △ | Shift + I | Num0 + Num8 |
| guard | R1 | Shift | Num0 |
| switch target | L1 | U | Num7 |
| pick up limb / sit / stand | R2 | O | Num9 |

On the character select:

- join with the high-strike button;
- pick a fighter with the stick, confirm with high strike, back out with grab;
- set the number of fighters with `-` / `+` (or L1 / R1 on a pad);
- start with Enter or Start.

Up to 8 gamepads work, and CPU fighters fill any empty slots.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Add `?auto=1&seed=3` to skip straight into an 8-CPU match.

## Tests

```bash
npm test
```

This runs the Vitest unit tests for the simulation:

- frame data and strings;
- the Urban Reign calibration (`tests/calibration.test.ts`);
- reversals and pushback;
- grapples and the crowd rule;
- limbs, hopping and crawling;
- spawns for 2–8 players;
- toilet rules;
- determinism;
- full 8-bot matches.

```bash
npm run test:browser
```

This runs headless Chrome against the Vite dev server:

- joins on the keyboard, picks a fighter and starts an 8-fighter match;
- checks that the keyboard controls P1;
- plays more than 3600 frames;
- checks that the canvas renders, the HUD shows 8 cards and the page logs no errors.

Screenshots go to `test-output/`.

## Layout

- `src/sim/`: the deterministic simulation (fixed 60 Hz steps, seeded RNG, no clock and no `Math.random`). `world.ts` holds the rules, `moves.ts` the frame data, `styles.ts` the roster and `ai.ts` the CPU fighters.
- `src/render/`: the Three.js scene and the DOM HUD. They only read the simulation.
- `src/input.ts`, `src/select.ts`, `src/main.ts`: devices, the character select and the game loop.

The frame data is calibrated against *Urban Reign*: startup, string timing,
hitstun, the reversal window, grapples and knockdowns were read frame by frame
out of the retail game's EE RAM. See `docs/calibration.md`.
`tests/calibration.test.ts` holds the simulation to those numbers.
