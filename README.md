# [▶ PLAY NOW](https://trafgals.github.io/pitfighter/)

**https://trafgals.github.io/pitfighter/**

# Pitfighter

An 8-player local brawler for the browser. Up to eight fighters, one pit; the
stage decides the arena and how a match is won.

## Stages

| Stage | How it plays | How you win |
|---|---|---|
| **Hell Toilet** | A ring of hellfire with the last toilet in hell in the middle. Hellfire geysers erupt across the floor. Any hit knocks the sitter off the throne. | Sit on the toilet for 15 seconds in total (progress is kept between sittings). |
| **Construction Site** | Everyone starts in a different construction vehicle: bulldozer, excavator, dump truck, forklift, steamroller, cement mixer, loader and crane truck. Steer with the stick, boost with strike, get out (or into a free machine) with USE. Machines crash into each other, run people over and get wrecked by crashes and by strikes; a wreck throws its driver out. The crane drops steel beams. | First to 4 KOs. KO'd fighters come back. |
| **Collapsing Tower** | A rooftop of 8 x 8 tiles high above the city. Tiles crack and fall, mostly from the edges in, faster as the match goes on; the centre four never fall. You cannot walk off an edge, but a knockdown or a throw can send you over. | Last one standing. Nobody comes back. |
| **Hindenburg Blimp** | On top of the burning airship: the fire creeps forward from the tail and gusts of wind push everyone toward the edge. Knock someone over the edge and they are gone. After 30 seconds it hits the ground: the impact throws everyone flat, the wreck is walled in by twisted frame, and the fire burns everyone a little more every second. It burns out 30 seconds later. | Last one standing; if more than one is left when the wreck burns out, whoever has the most limbs on. Nobody comes back. |
| **Castle Under Siege** | The wall walk of a besieged castle. The parapet stops you, except at the two breaches the siege has knocked in it, which are a long way down. Catapult stones knock you down, arrow volleys sting. | Raise your banner at the flagpole: the fighter nearest the pole raises theirs, 10 seconds alone wins, and it rises at half speed while someone else is in the circle. KO'd fighters come back. |

The menu picks the kind of match, not the stage: **King of the Hill** (Hell
Toilet, Castle Under Siege), **Last One Standing** (Collapsing Tower,
Hindenburg Blimp) or **KO Race** (Construction Site). A kind's arenas take
turns, one match each; `MATCH_TYPES` in `src/sim/stages.ts` lists them, and a
new arena joins its kind there. A stage can still be started
directly with `?auto=1&stage=<id>` (`hell-toilet`, `construction-site`,
`collapsing-tower`, `hindenburg-blimp`, `castle-under-siege`). The list of
stages is `src/sim/stages.ts`, their rules are `src/sim/arena.ts` (one
`Arena` per stage, which the World asks at fixed points of every step) and
their look is `src/render/stageviews.ts`. A match is started with
`new World({ ..., stage })`, which defaults to Hell Toilet.

The combat is modelled on the feel of Namco's *Urban Reign*:

- frame-data strikes measured from the real game: a 12f jab, strings that combo on hit, and heavy enders that knock down;
- juggles: the neutral string's finisher launches, as Urban Reign's does, and blows in the air keep the body up;
- a deflect that catches a strike, high or low, landing on its frames 2�14;
- grapples with knees and directional throws;
- no guard (as in Urban Reign): evades, dashes and runs instead; combo damage scaling and wake-up invulnerability;
- soft lock-on, and R1 to lock on and strafe;
- multi-target hits, kinetic pushback when you land a reversal, and dogpile protection.

Pitfighter changes seven things (`src/sim/moves.ts`, `tests/tweaks.test.ts`, `tests/juggle.test.ts`):

- **Charged openers.** Hold ○ to charge the first strike of a string. It
  waits on its last startup frame while you hold, for up to 1 s, and fires on
  release with up to double damage and knockback. A full charge knocks down.
  A tap is the normal strike, and the follow-ups of a string never charge.
  You glow while you charge, and you can be hit out of it.
- **Air control.** A juggled body floats on a soft gravity (two thirds of
  Earth's) that never grows, however long the juggle runs. Every blow in the
  air pops it up again, up to eight. The victim steers with the stick, as in
  Soul Calibur, and harder for every hit taken in the air. Holding the stick
  away from the attacker as a blow lands flies them further off, more for every
  hit so far, so a long juggle gets easier to escape. A body flown above 1.9 m
  is out of reach. It bounces once off the floor and then lies there.
- **Flow combos.** A string trades limbs (right, left, right), and each
  strike comes out of the last one's follow-through. With one arm left, the
  same arm has to come back before it goes again, which costs 4 frames.
  Mid-string, a landed punch flows into the kick string (back + ○) and a
  landed kick into the punch string (○), up to twice in a combo
  (`tests/flow.test.ts`).
- **Air grabs.** Triangle on a juggled body within 1.45 m, and no higher
  than an outstretched arm, catches it out of the air with the style's own air
  grab (`src/sim/airgrabs.ts`): a suplex, a powerbomb, a slingshot, an axe-kick
  spike, and so on. The grab belongs to the torso, so it stays the fighter's
  whatever limbs they wear, but the arms set its strength (70% with one arm,
  half with none). Each ends its own way: down, bounced back up into a fresh
  juggle, flung across the floor, or with an arm torn at. Out of reach, it
  whiffs like any grapple, so the longer a juggle runs and the further it
  drifts, the riskier the cash-out.
- **Free-form limbs.** Every limb that grows rolls its own traits
  (`src/sim/limbs.ts`): its mass, length, how fast it whips, how wide it
  swings, and what it hits with (a fist, a claw, a hoof, a club or a spike).
  The style leans the roll, so a Mighty arm runs heavy and a Kung Fu arm fast, but
  no two limbs are alike. The strikes a fighter throws are generated from the
  limb that throws them, and a string trades hands, so a body stitched together
  from torn-off parts fights like nothing else. A transplant keeps its roll; a
  limb that grows back is a new one. Every generated strike stays inside Urban
  Reign's own timing: first hits on frames 9 to 38, whole actions 36 to 90
  frames, from the decoded movesets (`tests/limbs.test.ts`). Strings stay true
  combos whatever limbs throw them.
- **Crunch.** A body flying fast into a wall, a prop or the toilet is hurt by
  it, limb first, and bounces back off. A juggled body flying fast is a human
  missile: it knocks down whoever it hits, and both of them are hurt. The sim
  decides all of it (`tests/crunch.test.ts`); the ragdoll only follows.
- **Whiffed reversals.** A reversal that counters nothing takes 3x as long to
  recover from (63 frames after its window instead of 21), so spamming
  reversal gets punished. A reversal that lands ends at once, as before.

All characters, names and art are original.

## Bodies come apart

Every arm and leg has its own HP. A limb at 0 HP falls off and lands on the
floor. Walk over to it and press *grab* (or *pick up*) to reattach it at half
HP. Grab someone else's limb and it goes on you instead, keeping its first
owner's colours and fighting like them: a boxer's arm punches like a boxer.
Its owner grows a new one 12 s later. *Pick up* on someone else's limb punts
it away. Limbs never leave the map: one that slides into the hellfire, off an
edge or through a breach washes back up on the nearest floor.

- One leg: you hop. You're slower, can't run and can't low kick.
- No legs: you bounce along on your torso, slowly.
- One arm: slower, weaker punches and weaker throws.
- No arms: Circle becomes a headbutt, and you can't grab.
- Head at 0 HP: you're dizzy. Torso at 0 HP: you don't die. Every limb is torn off and scattered, and you hobble round on your torso to pick them back up. The only way out of a fight is over an edge.

## Fighters

The pit is the Sump of Old Sorrow, a city where it has rained for ninety-one
years. Its finest ladies and gentlemen beat one another to death there for
charity, in their best clothes. There are twelve fighters, each on one of the
*Urban Reign* fighting styles (the style names come from the game's own message
table, ids 1347–1367). Each fighter's limbs are made in a craft of their own,
which sets how they look and how every hit sounds.

| Style | Fighter | Limbs | Special |
|---|---|---|---|
| All-Round | Constable Obadiah Winch | Clockwork Brass | THE RIOT ACT (flurry) |
| Mighty | Mr. Hezekiah Smelt | Foundry Iron | FULL STEAM AHEAD (charge) |
| Street | Nell Sluice | Drainpipe Lead | THE SLUICE GATE (charge) |
| Karate | Matron Prudence Kilnworth | Kiln Porcelain | THE ROUNDS (spin) |
| Wrestling | The Great Bartholomew Mule | Grafted Bear | THE DANCING BEAR (slam) |
| Muay Thai | Bosun Absalom Rook | Ship's Oak | THE CAT O' NINE (flurry) |
| Boxing | Lady Hester Bulwark | Hydraulic Steel | A HUNDRED POUNDS TO THE INCH (flurry) |
| Kung Fu | Percival "Oolong" Crump | Bamboo and Samovar | THE SPILLED SAMOVAR (spin) |
| Tae Kwon Do | Mistress Tabitha Pegg | Cast-Iron Lasts | THE HOT WELT (fire) |
| Judo Based | Mr. Mortimer Crape | Jet and Whalebone | INTERMENT (slam) |
| Samurai Sword | Sir Peregrine Ashby-Lisle, Bt. | Silver and Ebony | A THOUSAND PARDONS (blade) |
| Amateur | Mr. Cuthbert Inkle | Pawnshop Patchwork | THE OVERDRAFT (charge) |

A style is a set of modifiers on the shared frame data: tempo, reach, string
length, and damage split between punches, kicks and grapples. Every fighter
keeps the same core feel. See `src/sim/styles.ts`.

Each fighter also has a special, paid for with fury. It is one of six shapes,
and each fighter calls theirs by its own name:

| Shape | What it does | Fighters |
|---|---|---|
| Flurry | four quick hits | Winch, Rook, Bulwark |
| Charge | a dash through the crowd | Smelt, Sluice, Inkle |
| Spin | hits all round | Kilnworth, Crump |
| Slam | a low shockwave | Mule, Crape |
| Blade | a long sweep | Sir Peregrine |
| Fire | a long jet | Pegg |

Everything about a fighter is in one file, `src/data/characters.json`: the
numbers the sim plays, and the whole design for the moves, looks and sounds
still to be built. That design covers every move in the full *Urban Reign* verb
set, the crowd (the Gallery, which throws weapons and spare limbs into the pit
when a fighter appeals to it after a good blow), each fighter's Tincture (the
other self it lets out), their art and their sound cues. `systems` says which
of those verbs the game has today. See [docs/characters.md](docs/characters.md).

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
  crowd that swells on big moments. The camera sits low and close on the
  humans, the foe each is locked on to and whoever is near them, and backs
  off only as far as they spread (`src/render/camera.ts`); with no human
  playing it frames everyone. Each blow lurches the camera along its
  line; a heavy one tilts it and flashes the picture white. A KO slows time,
  and the blow that wins the match nearly stops it while the camera closes in.
- **Juggled bodies:** up in a juggle a body is on the ragdoll from the launch
  to the floor, one fall with the knockdown it lands in. It tumbles through a
  throw's flight by how far along the arc it is: arms up as it rises, laid back
  over the top, flat on its back for the landing. Its limbs feel every change in
  the body's speed (the launch, each pop, the bounce), lag behind and whip after
  it, and float in between, falling with the body (`tests/airborne.test.ts`).
- **Silhouettes:** every fighter has its own size and gear (a top hat, a
  constable's helmet, mutton chops, a monocle, a stovepipe, piston forearms),
  so they read apart from across the pit before any colour.

## Controls

The layout is Urban Reign's: Circle strikes, Triangle grapples, Square
dodges, Cross runs.

| Action | Pad | Keyboard P1 | Keyboard P2 |
|---|---|---|---|
| move | stick / d-pad | WASD | arrows |
| strike (string) | ○ | J | Num6 |
| low strike (string) | stick back + ○ | back + J | back + Num6 |
| grapple, then ○ knee / △ throw toward the stick; over a limb, put it on | △ | K | Num8 |
| deflect (catches high and low) | □ | L | Num4 |
| evade (a sidestep nothing touches) | □ + a direction | L + a direction | Num4 + a direction |
| dash; hold to run; ○ out of it is a shoulder charge | ✕ | Shift | Num2 |
| lock on and strafe (hold) | R1 | Q | Num9 |
| switch target | R3 | U | Num0 |
| pick up limb / sit / stand | L1 | O | Num7 |
| taunt (a whole one fills fury) | L2 | H | Num1 |
| special (costs fury) | ○ + △ together, or R2 | J + K, or Y | Num6 + Num8, or Num3 |
| mute | | M | |
| move list (holds the fight) | Select | Tab | Num. |

On the character select:

- join with the strike button (○ on a pad, J on the keyboard);
- pick a fighter with the stick, confirm with strike, back out with grapple;
- a match has 4 fighters by default: the first four humans to join each take a CPU's place, and every human after that adds a fighter (up to 8); set the number with `-` / `+` (`O` / `Q`, or L1 / R1 on a pad);
- pick the kind of match by clicking the arrows or a name on the banner, with `[` / `]` or `H` / `Y`, or with L2 / R2 on a pad; a CPU brawl on its next arena plays behind the menu;
- or click a fighter to join on it with the keyboard, and click FIGHT! to start;
- turn the blood on or off with `G` (the game remembers your choice);
- switch practice on or off with `P` (R3 on a pad, or the PRACTICE button). In practice the CPUs are dummies that stand there and take it. Nobody wins, the KO'd come back on every arena, and fury never runs out. On the falling arenas, the KO'd come back on sound floor, never onto roof that has gone or into the blimp's fire. A body nobody has hurt for 1.5 seconds is whole again, torn-off limbs included (`tests/practice.test.ts`);
- start with Enter or Start.

Each match opens with a 3, 2, 1 countdown. While it runs, every human's
fighter stands in a column of their colour under a bouncing tag.

Up to 8 gamepads work, and CPU fighters fill any empty slots.

In a fight, the move list (Tab, Num. or Select) holds the fight and shows one card per human fighter. Each card lists:

- the fighter's limbs' rolls;
- the startup, total frames, damage and reach that those limbs give each strike of the punch and kick strings;
- the dash strike and the special;
- the style's air grab.

The list is read off the sim, so it changes when you lose a limb or put on someone else's (`src/movelist.ts`, `tests/movelist.test.ts`).

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Add `?auto=1&seed=3` to skip straight into an 8-CPU match.
Add `?lofi=1` to turn off bloom on slow machines, `?mute=1` to start muted, and `?gore=0` to play without blood.

### The feel lab

`?lab=1` opens the feel lab: a practice match against one dummy, with a
panel of dials over the numbers that decide how the fight feels.

- **Dials:** the camera, hitstop, knockback, movement, the dash and evade,
  juggles, crunch and the KO slow motion (`src/lab/tunables.ts`). They are
  the live constants the game reads, so a turn takes hold at once. A turned
  dial shows orange; double-click it to put it back. The dials are kept in
  this browser between visits, and **reset all** puts them all back.
- **Takes:** `1` records a take from a fresh start of the match, and `1`
  again stops it. `2` replays it on the dials as they are now; when it runs
  out, the hands are yours again. The sim is deterministic, so the same take
  on the same dials plays out the same, frame for frame.
- **A and B:** save the dials as preset A or B, then `3` and `4` replay the
  last take on A or on B, to feel the same exchange both ways.
- **dummies fight** makes the dummies fight back (the CPU), still the same
  on every replay.
- **copy changes** copies the dials you turned, and A's and B's, as JSON:
  paste it into an issue or a chat to say what felt right.
- `` ` `` hides and shows the panel. Pick your fighter and join with a pad
  or the keyboard as usual.

The lab changes nothing about the game until a number it found is written
back into `src/sim/moves.ts` or `src/render/camera.ts`.
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
- limbs, hopping and bouncing;
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

- checks the Pitfighter title and the match types (King of the Hill first, with its arenas; `[` / `]` and clicks cycle them);
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
- `src/lab/`: the feel lab (`?lab=1`): the dials, the takes and their replay.

The frame data is calibrated against *Urban Reign*: startup, string timing,
hitstun, the reversal window, grapples and knockdowns were read frame by frame
out of the retail game's EE RAM. See `docs/calibration.md`.
`tests/calibration.test.ts` holds the simulation to those numbers.

The frame data of all 128 Urban Reign movesets is decoded from the game's attack
tables into `docs/calibration/urban-reign-movesets.md` (and `.json`), ready to
base new fighters on. Regenerate it with `node tools/ur-calibration/movesets.cjs`.
