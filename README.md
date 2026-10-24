# Pitfighter

An 8-player local brawler for the browser. Up to eight fighters, one pit; the
stage decides the arena and how a match is won.

## Stages

| Stage | How it plays | How you win |
|---|---|---|
| **Hell Toilet** | A ring of hellfire with the last toilet in hell in the middle. Hellfire geysers erupt across the floor. Any hit knocks the sitter off the throne. | Sit on the toilet for 15 seconds in total (progress is kept between sittings). |
| **Construction Site** | Everyone starts in a different construction vehicle: bulldozer, excavator, dump truck, forklift, steamroller, cement mixer, loader and crane truck. Steer with the stick, boost with high strike, get out (or into a free machine) with USE. Machines crash into each other, run people over and get wrecked by crashes and by strikes; a wreck throws its driver out. The crane drops steel beams. | First to 4 KOs. KO'd fighters come back. |
| **Collapsing Tower** | A rooftop of 8 x 8 tiles high above the city. Tiles crack and fall, mostly from the edges in, faster as the match goes on; the centre four never fall. You cannot walk off an edge, but a knockdown or a throw can send you over. | Last one standing. Nobody comes back. |
| **Hindenburg Blimp** | On top of the burning airship: the fire creeps forward from the tail and gusts of wind push everyone toward the edge. Knock someone over the edge and they are gone. After 30 seconds it hits the ground: the impact throws everyone flat, the wreck is walled in by twisted frame, and the fire burns everyone a little more every second until nobody is left. | Last one standing. Nobody comes back. |
| **Castle Under Siege** | The wall walk of a besieged castle. The parapet stops you, except at the two breaches the siege has knocked in it, which are a long way down. Catapult stones knock you down, arrow volleys sting. | Raise your banner at the flagpole: the fighter nearest the pole raises theirs, 10 seconds alone wins, and it rises at half speed while someone else is in the circle. KO'd fighters come back. |

Every stage is picked on the select screen with `[` / `]`, or started
directly with `?auto=1&stage=<id>` (`hell-toilet`, `construction-site`,
`collapsing-tower`, `hindenburg-blimp`, `castle-under-siege`). The list of
stages is `src/sim/stages.ts`, their rules are `src/sim/arena.ts` (one
`Arena` per stage, which the World asks at fixed points of every step) and
their look is `src/render/stageviews.ts`. A match is started with
`new World({ ..., stage })`, which defaults to Hell Toilet.

The combat is modelled on the feel of Namco's *Urban Reign*:

- frame-data strikes measured from the real game: a 12f jab, strings that combo on hit, and heavy enders that knock down;
- high/low reversals that catch a strike landing on their frames 2�14;
- grapples with knees and directional throws;
- guard, combo damage scaling and wake-up invulnerability;
- soft lock-on;
- multi-target hits, kinetic pushback when you land a reversal, and dogpile protection.

Pitfighter changes two things (`src/sim/moves.ts`, `tests/tweaks.test.ts`):

- **Charged openers.** Hold □ or ✕ to charge the first strike of a string. It
  waits on its last startup frame while you hold, for up to 1 s, and fires on
  release with up to double damage and knockback. A full charge knocks down.
  A tap is the normal strike, and the follow-ups of a string never charge.
  You glow while you charge, and you can be hit out of it.
- **Whiffed reversals.** A reversal that counters nothing takes 3x as long to
  recover from (63 frames after its window instead of 21), so spamming
  reversal gets punished. A reversal that lands ends at once, as before.

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

Each style also has a special, paid for with fury:

| Special | Styles |
|---|---|
| Flurry (four quick hits) | All-Round, Street, Muay Thai, Boxing, Martial Arts |
| Charge (a dash through the crowd) | Power, Rush, Military, Amateur |
| Spin (hits all round) | Karate, Speed, Kung Fu, Capoeira, Tae Kwon Do |
| Slam (a low shockwave) | Wrestling, Mighty, Submission, Judo Based |
| Blade (a long sweep) | Samurai Sword, Master |
| Fire (a long jet) | Gun |

## Combat feel

- **Hitstop:** a landed hit freezes the attacker and the victim for the same
  number of frames, so frame advantage stays as calibrated. Heavier hits,
  reversals, throws and KOs freeze longer. A button pressed during the freeze
  stays buffered and comes out after it.
- **Fury:** the bar under each HUD card fills when you land hits, take hits,
  reverse and throw, and empties on a KO. A special costs half the bar, so a
  full bar holds two. Specials cannot be reversed.
- **Crowd AI:** each target hands out two attack tokens (three for whoever is
  on the throne). CPU fighters without a token circle at a distance and wait
  their turn instead of all piling in.
- **Feedback:** sparks, dust and flash rings on impacts, a hit flash on the
  victim, camera shake with a punch-in on heavy hits, bloom, and synthesised
  sound (Web Audio, no sample files): impacts, swings, a lava rumble, and a
  crowd that swells on big moments.

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
| special (costs fury) | L2, or □ + ✕ together | H, or J + K | Num1, or Num4 + Num5 |
| mute | | M | |

On the character select:

- join with the high-strike button;
- pick a fighter with the stick, confirm with high strike, back out with grab;
- set the number of fighters with `-` / `+` (or L1 / R1 on a pad);
- pick the stage with `[` / `]`;
- turn the blood on or off with `G` (the game remembers your choice);
- start with Enter or Start.

Each match opens with a 3, 2, 1 countdown. While it runs, every human's
fighter stands in a column of their colour under a bouncing tag.

Up to 8 gamepads work, and CPU fighters fill any empty slots.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Add `?auto=1&seed=3` to skip straight into an 8-CPU match.
Add `?lofi=1` to turn off bloom on slow machines, `?mute=1` to start muted, and `?gore=0` to play without blood.
`?auto=1` skips the countdown unless you add `?countdown=1`.

The game is published at https://trafgals.github.io/pitfighter/. Every push to
`main` runs the unit tests, builds the game and deploys it to GitHub Pages
(`.github/workflows/pages.yml`); a failing test publishes nothing.

## Tests

```bash
npm test
```

This runs the Vitest unit tests for the simulation:

- frame data and strings;
- the Urban Reign calibration (`tests/calibration.test.ts`) and the decoded Urban Reign movesets (`tests/urban-reign-movesets.test.ts`);
- reversals and pushback;
- grapples and the crowd rule;
- limbs, hopping and crawling;
- spawns for 2–8 players;
- toilet rules;
- stages (`tests/stages.test.ts`): each stage's rules, and a deterministic 8-bot match on every stage that ends with a winner;
- hitstop, fury and specials (`tests/hitfeel.test.ts`);
- crowd AI attack tokens (`tests/ai.test.ts`);
- the jointed bodies' poses (`tests/body.test.ts`);
- determinism;
- full 8-bot matches.

```bash
npm run test:browser
```

This runs headless Chrome against the Vite dev server:

- checks the Pitfighter title and the stage list (all five playable, Hell Toilet selected, `[` / `]` cycle them);
- joins on the keyboard, picks a fighter and starts an 8-fighter match on Hell Toilet;
- checks that the keyboard controls P1;
- plays more than 3600 frames;
- checks that hitstop froze fighters, impacts spawned sparks and rings, bloom is on, and audio played hit and swing sounds;
- checks that the CPUs used specials and the HUD shows 8 fury bars;
- checks that the canvas renders, the HUD shows 8 cards and the page logs no errors;
- then starts an 8-CPU match on each of the other four stages with `?stage=`, plays it, and checks the stage's own events (machines crashing, the roof falling, the fire and the crash, the siege engines), the HUD headline, the canvas and the console.

Screenshots go to `test-output/`.

```bash
npm run test:live
```

This runs the same browser checks against the published GitHub Pages site.

## Layout

- `src/sim/`: the deterministic simulation (fixed 60 Hz steps, seeded RNG, no clock and no `Math.random`). `world.ts` holds the rules of the fight, `arena.ts` the rules of each stage, `moves.ts` the frame data, `styles.ts` the roster and `ai.ts` the CPU fighters.
- `src/render/`: the Three.js scene (`scene.ts`), the stages' arenas (`stageviews.ts`), the bodies (`body.ts`), effects, sound and the DOM HUD. They only read the simulation.
- `src/input.ts`, `src/select.ts`, `src/main.ts`: devices, the character select and the game loop.

The frame data is calibrated against *Urban Reign*: startup, string timing,
hitstun, the reversal window, grapples and knockdowns were read frame by frame
out of the retail game's EE RAM. See `docs/calibration.md`.
`tests/calibration.test.ts` holds the simulation to those numbers.

The frame data of all 128 Urban Reign movesets is decoded from the game's attack
tables into `docs/calibration/urban-reign-movesets.md` (and `.json`), ready to
base new fighters on. Regenerate it with `node tools/ur-calibration/movesets.cjs`.
