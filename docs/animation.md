# Animation

The fighters' motion is our own: every pose is keyframed in `src/render/`. Only the **timing** comes from Urban Reign, measured from EE RAM (`docs/calibration.md`). The sim (`src/sim/`) decides everything and the renderer follows it. Nothing here changes the sim, and the renderer only reads the world state.

## The pipeline, per fighter per frame

`animate()` in `src/render/animate.ts` does this each frame:

1. **`targetPose()`** (`body.ts`) turns the fighter's sim state and frame into a target pose, playing a keyframed clip from `motion.ts`.
2. **`blendIn()`**: a new state or move eases out of the pose the body was in over `BLEND` = 3 frames. It is always on its clip by the contact frame, so a cancel never blurs a hit.
3. **`applyPose()`** drives the joints toward the target on damped springs (`JOINT_SPRINGS`). The striking limb is driven kinematically from the fire phase through the active frames, and a punch takes the chest with it.
4. **`footwork()`** puts the legs on two-bone IK: planted feet, recovery steps, hip drop and the walk cycle.
5. **`ragdoll()`** (`ragdoll.ts`) carries the trunk through knockdowns, throws and falls.

## Clips

A clip is a list of keys anchored to the move's **phases**, not to absolute frames. The phases come from the sim's frame data for the style: `up` (start), `load` (gather), `snap`, `hit`, `act` (end of the active frames) and `rec` (recovery). One clip therefore fits every style's timing.

- `strike()` builds the standard blow:
  - the gather, with counter-movement;
  - the snap;
  - the contact pose, keyed exactly on the hit frame;
  - a drive 15 % past contact two frames later (`THROUGH`), so the limb is fastest on the hit frame;
  - the follow-through, held to the end of the active frames;
  - recovery to the family's guard.
- **Overlap** (`sampleOverlap`): the pelvis leads by 2 frames and the chest by 1, and the head trails by 1. Each strike therefore comes off the hips.
  - Elbows set `lead: 0`, because they are thrown with the trunk itself.
  - `Clip.point` names a striking point other than the fist or foot: an elbow or a shoulder.
- **Plants**: a key can mark which feet carry the weight (`plant: "L" | "R" | "both" | "none"`).
- **Families** (`FAMILIES`): each family has its own string, stance (`STANCES`) and idle (`IDLE`). The families are boxing, karate, Muay Thai, kung fu, brawler, power, grappler and kicker.
- **Specials** (`SPECIALS`): each style's special is its own clip.

## Springs

`JOINT_SPRINGS` gives each degree of freedom a stiffness (relative to the clip's rate) and a damping ratio:

- the pelvis and trunk are stiff and well damped;
- the head rides loose and overshoots a blow;
- the tail trails everything.

`impulse()` whips the spine and head springs on a hit, in the direction of the blow.

## Feet and IK

- Feet plant when the clip brings them to the floor. A planted foot stays put (under 2 cm, tested) until the clip lifts it, or until it is more than `STEP_AT` (28 cm) from where the clip wants it, which triggers a recovery step.
- The hips drop to keep a planted foot in reach.
- Walking and guarding use a gait: stride length follows the measured speed, and the feet take turns.
- Standing, walking and guarding, the head and chest turn toward the soft-lock target.

## Reactions

- A reaction is chosen by **height** (head, body, legs), **side** (left or right of the victim, from the attacker's position) and **strength** (light, or heavy at 6+ damage or 9+ hitstop). That makes 12 additive clips, played on the pose the blow found.
- Each reaction eases back to the stance on the frame the sim frees the fighter. A light reaction lasts 41 f, as measured.
- Knockdowns land face up, or face down for a blow from behind, on frame 27 (the measured median). The get-ups match, face up or face down.

## Ragdoll

During a knockdown fall, a throw and a fall off a ledge, the trunk is three verlet points: pelvis, chest and head.

- The blow throws them back and up, gravity pulls them down, and the floor stops them.
- A motor pulls them toward the clip. It starts weak and is full on the landing frame, so the body is on the floor exactly when the sim says.
- The clip's body is moved and turned to follow the ragdoll's trunk.

## Seeing it

- `?debug=motion` shows a line per fighter: state, frame, clip, phase, plant, feet and the striking limb's speed. It also draws foot markers: green for planted, yellow for stepping.
- `node tools/strip.mjs [set[:family]]` writes contact sheets to `test-output/strips/`. The hit frame is boxed red and the active frames orange, with foot contacts and speed shown under each frame.

| Strip | What it shows |
|---|---|
| `moves-<family>.png` | the string (`jab1`–`kick2`), the low sweep, the special, the headbutt, the grapple, the clinch with knees, high and low deflects, a blocked hit |
| `reactions.png` | 12 reactions: head, body and legs × light and heavy × right and left |
| `down.png` | knockdowns face up and face down, both get-ups, the thrower, the thrown |
| `locomotion-<family>.png` | idle, guard, walk and run |

The browser test checks that animating 8 fighters fits well inside a 60 fps frame.

## Not done yet

- **Clips for the decoded moveset actions** (the stick strings, the running strike, the ground attack) wait for the per-style movesets to be wired into the sim ([trafgals/pitfighter#1](https://github.com/trafgals/pitfighter/issues/1)). Today every style plays the shared string with its own timing.
- **Heavy reactions by height and direction.** Urban Reign's heavy reaction records (46–74 f) are measured (`docs/calibration.md`), but which one plays for which height and direction is not. Every reaction lasts the sim's hitstun for the blow.

## Timing table

This table is measured by `tests/timing.test.ts`. Each row gives:

- the sim's hit frame and move length;
- the frame the body arrives at its contact pose (the striking point within 1 cm of where the contact key puts it, relative to the pelvis);
- the frame the striking point moves fastest in the world.

The test fails if contact is off the hit frame, if the speed peak is more than a frame away from it, or if this table is stale. Regenerate it with `UPDATE_DOCS=1 npx vitest run tests/timing.test.ts`.

<!-- timing table: generated by tests/timing.test.ts -->

| Style | Family | Move | Sim hit | Sim length | Contact lands | Δ | Fastest | Δ |
|---|---|---|---:|---:|---:|---:|---:|---:|
| All-Round | karate | jab1 | 12 | 43 | 12 | 0 | 11 | -1 |
| All-Round | karate | jab2 | 9 | 36 | 9 | 0 | 8 | -1 |
| All-Round | karate | jab3 | 11 | 38 | 11 | 0 | 11 | 0 |
| All-Round | karate | punchFin | 17 | 47 | 17 | 0 | 16 | -1 |
| All-Round | karate | kick1 | 18 | 48 | 18 | 0 | 18 | 0 |
| All-Round | karate | kick2 | 20 | 51 | 20 | 0 | 20 | 0 |
| All-Round | karate | sweep | 26 | 60 | 26 | 0 | 27 | +1 |
| Power | power | jab1 | 16 | 47 | 16 | 0 | 15 | -1 |
| Power | power | jab2 | 13 | 40 | 13 | 0 | 12 | -1 |
| Power | power | jab3 | 15 | 42 | 15 | 0 | 15 | 0 |
| Power | power | kick1 | 22 | 52 | 22 | 0 | 21 | -1 |
| Power | power | kick2 | 24 | 55 | 24 | 0 | 24 | 0 |
| Power | power | sweep | 30 | 64 | 30 | 0 | 30 | 0 |
| Street | brawler | jab1 | 12 | 43 | 12 | 0 | 11 | -1 |
| Street | brawler | jab2 | 9 | 36 | 9 | 0 | 8 | -1 |
| Street | brawler | jab3 | 11 | 38 | 11 | 0 | 10 | -1 |
| Street | brawler | punchFin | 17 | 47 | 17 | 0 | 16 | -1 |
| Street | brawler | kick1 | 18 | 48 | 18 | 0 | 17 | -1 |
| Street | brawler | kick2 | 20 | 51 | 20 | 0 | 20 | 0 |
| Street | brawler | sweep | 26 | 60 | 26 | 0 | 26 | 0 |
| Karate | karate | jab1 | 10 | 41 | 10 | 0 | 9 | -1 |
| Karate | karate | jab2 | 7 | 34 | 7 | 0 | 6 | -1 |
| Karate | karate | jab3 | 9 | 36 | 9 | 0 | 9 | 0 |
| Karate | karate | punchFin | 15 | 45 | 15 | 0 | 14 | -1 |
| Karate | karate | kick1 | 16 | 46 | 16 | 0 | 16 | 0 |
| Karate | karate | kick2 | 18 | 49 | 18 | 0 | 18 | 0 |
| Karate | karate | sweep | 24 | 58 | 24 | 0 | 25 | +1 |
| Karate | karate | spSpin | 8 | 44 | 8 | 0 | 8 | 0 |
| Wrestling | power | jab1 | 12 | 43 | 12 | 0 | 11 | -1 |
| Wrestling | power | jab2 | 9 | 36 | 9 | 0 | 8 | -1 |
| Wrestling | power | jab3 | 11 | 38 | 11 | 0 | 11 | 0 |
| Wrestling | power | kick1 | 18 | 48 | 18 | 0 | 17 | -1 |
| Wrestling | power | kick2 | 20 | 51 | 20 | 0 | 20 | 0 |
| Wrestling | power | sweep | 26 | 60 | 26 | 0 | 26 | 0 |
| Muay Thai | muay | jab1 | 12 | 43 | 12 | 0 | 11 | -1 |
| Muay Thai | muay | jab2 | 9 | 36 | 9 | 0 | 8 | -1 |
| Muay Thai | muay | jab3 | 11 | 38 | 11 | 0 | 10 | -1 |
| Muay Thai | muay | punchFin | 17 | 47 | 17 | 0 | 17 | 0 |
| Muay Thai | muay | kick1 | 18 | 48 | 18 | 0 | 18 | 0 |
| Muay Thai | muay | kick2 | 20 | 51 | 20 | 0 | 20 | 0 |
| Muay Thai | muay | sweep | 26 | 60 | 26 | 0 | 25 | -1 |
| Boxing | boxing | jab1 | 10 | 41 | 10 | 0 | 9 | -1 |
| Boxing | boxing | jab2 | 7 | 34 | 7 | 0 | 6 | -1 |
| Boxing | boxing | jab3 | 9 | 36 | 9 | 0 | 8 | -1 |
| Boxing | boxing | punchFin | 15 | 45 | 15 | 0 | 15 | 0 |
| Boxing | boxing | kick1 | 16 | 46 | 16 | 0 | 15 | -1 |
| Boxing | boxing | kick2 | 18 | 49 | 18 | 0 | 18 | 0 |
| Boxing | boxing | sweep | 24 | 58 | 24 | 0 | 24 | 0 |
| Rush | brawler | jab1 | 10 | 41 | 10 | 0 | 9 | -1 |
| Rush | brawler | jab2 | 7 | 34 | 7 | 0 | 6 | -1 |
| Rush | brawler | jab3 | 9 | 36 | 9 | 0 | 8 | -1 |
| Rush | brawler | punchFin | 15 | 45 | 15 | 0 | 14 | -1 |
| Rush | brawler | kick1 | 16 | 46 | 16 | 0 | 15 | -1 |
| Rush | brawler | kick2 | 18 | 49 | 18 | 0 | 18 | 0 |
| Rush | brawler | sweep | 24 | 58 | 24 | 0 | 24 | 0 |
| Speed | kungfu | jab1 | 8 | 39 | 8 | 0 | 7 | -1 |
| Speed | kungfu | jab2 | 5 | 32 | 5 | 0 | 4 | -1 |
| Speed | kungfu | jab3 | 7 | 34 | 7 | 0 | 7 | 0 |
| Speed | kungfu | kick1 | 14 | 44 | 14 | 0 | 14 | 0 |
| Speed | kungfu | kick2 | 16 | 47 | 16 | 0 | 16 | 0 |
| Speed | kungfu | sweep | 22 | 56 | 22 | 0 | 23 | +1 |
| Speed | kungfu | spSpin | 6 | 42 | 6 | 0 | 6 | 0 |
| Kung Fu | kungfu | jab1 | 10 | 41 | 10 | 0 | 9 | -1 |
| Kung Fu | kungfu | jab2 | 7 | 34 | 7 | 0 | 6 | -1 |
| Kung Fu | kungfu | jab3 | 9 | 36 | 9 | 0 | 9 | 0 |
| Kung Fu | kungfu | kick1 | 16 | 46 | 16 | 0 | 16 | 0 |
| Kung Fu | kungfu | kick2 | 18 | 49 | 18 | 0 | 18 | 0 |
| Kung Fu | kungfu | sweep | 24 | 58 | 24 | 0 | 25 | +1 |
| Kung Fu | kungfu | spSpin | 8 | 44 | 8 | 0 | 8 | 0 |
| Mighty | power | jab1 | 18 | 49 | 18 | 0 | 17 | -1 |
| Mighty | power | jab2 | 15 | 42 | 15 | 0 | 14 | -1 |
| Mighty | power | jab3 | 17 | 44 | 17 | 0 | 17 | 0 |
| Mighty | power | kick1 | 24 | 54 | 24 | 0 | 23 | -1 |
| Mighty | power | kick2 | 26 | 57 | 26 | 0 | 26 | 0 |
| Mighty | power | sweep | 32 | 66 | 32 | 0 | 32 | 0 |
| Submission | grappler | jab1 | 12 | 43 | 12 | 0 | 11 | -1 |
| Submission | grappler | jab2 | 9 | 36 | 9 | 0 | 8 | -1 |
| Submission | grappler | jab3 | 11 | 38 | 11 | 0 | 11 | 0 |
| Submission | grappler | kick1 | 18 | 48 | 18 | 0 | 18 | 0 |
| Submission | grappler | kick2 | 20 | 51 | 20 | 0 | 20 | 0 |
| Submission | grappler | sweep | 26 | 60 | 26 | 0 | 26 | 0 |
| Military | karate | jab1 | 12 | 43 | 12 | 0 | 11 | -1 |
| Military | karate | jab2 | 9 | 36 | 9 | 0 | 8 | -1 |
| Military | karate | jab3 | 11 | 38 | 11 | 0 | 11 | 0 |
| Military | karate | punchFin | 17 | 47 | 17 | 0 | 16 | -1 |
| Military | karate | kick1 | 18 | 48 | 18 | 0 | 18 | 0 |
| Military | karate | kick2 | 20 | 51 | 20 | 0 | 20 | 0 |
| Military | karate | sweep | 26 | 60 | 26 | 0 | 27 | +1 |
| Capoeira | kicker | jab1 | 12 | 43 | 12 | 0 | 11 | -1 |
| Capoeira | kicker | jab2 | 9 | 36 | 9 | 0 | 8 | -1 |
| Capoeira | kicker | jab3 | 11 | 38 | 11 | 0 | 11 | 0 |
| Capoeira | kicker | punchFin | 17 | 47 | 17 | 0 | 16 | -1 |
| Capoeira | kicker | kick1 | 18 | 48 | 18 | 0 | 18 | 0 |
| Capoeira | kicker | kick2 | 20 | 51 | 20 | 0 | 20 | 0 |
| Capoeira | kicker | sweep | 26 | 60 | 26 | 0 | 25 | -1 |
| Capoeira | kicker | spSpin | 10 | 46 | 10 | 0 | 10 | 0 |
| Tae Kwon Do | kicker | jab1 | 10 | 41 | 10 | 0 | 9 | -1 |
| Tae Kwon Do | kicker | jab2 | 7 | 34 | 7 | 0 | 6 | -1 |
| Tae Kwon Do | kicker | jab3 | 9 | 36 | 9 | 0 | 9 | 0 |
| Tae Kwon Do | kicker | punchFin | 15 | 45 | 15 | 0 | 14 | -1 |
| Tae Kwon Do | kicker | kick1 | 16 | 46 | 16 | 0 | 16 | 0 |
| Tae Kwon Do | kicker | kick2 | 18 | 49 | 18 | 0 | 18 | 0 |
| Tae Kwon Do | kicker | sweep | 24 | 58 | 24 | 0 | 23 | -1 |
| Tae Kwon Do | kicker | spSpin | 8 | 44 | 8 | 0 | 8 | 0 |
| Samurai Sword | brawler | jab1 | 14 | 45 | 14 | 0 | 13 | -1 |
| Samurai Sword | brawler | jab2 | 11 | 38 | 11 | 0 | 10 | -1 |
| Samurai Sword | brawler | jab3 | 13 | 40 | 13 | 0 | 12 | -1 |
| Samurai Sword | brawler | punchFin | 19 | 49 | 19 | 0 | 18 | -1 |
| Samurai Sword | brawler | kick1 | 20 | 50 | 20 | 0 | 19 | -1 |
| Samurai Sword | brawler | kick2 | 22 | 53 | 22 | 0 | 22 | 0 |
| Samurai Sword | brawler | sweep | 28 | 62 | 28 | 0 | 28 | 0 |
| Samurai Sword | brawler | spBlade | 16 | 49 | 16 | 0 | 15 | -1 |
| Master | kungfu | jab1 | 10 | 41 | 10 | 0 | 9 | -1 |
| Master | kungfu | jab2 | 7 | 34 | 7 | 0 | 6 | -1 |
| Master | kungfu | jab3 | 9 | 36 | 9 | 0 | 9 | 0 |
| Master | kungfu | kick1 | 16 | 46 | 16 | 0 | 16 | 0 |
| Master | kungfu | kick2 | 18 | 49 | 18 | 0 | 18 | 0 |
| Master | kungfu | sweep | 24 | 58 | 24 | 0 | 25 | +1 |
| Master | kungfu | spBlade | 12 | 45 | 12 | 0 | 11 | -1 |
| Gun | brawler | jab1 | 14 | 45 | 14 | 0 | 13 | -1 |
| Gun | brawler | jab2 | 11 | 38 | 11 | 0 | 10 | -1 |
| Gun | brawler | jab3 | 13 | 40 | 13 | 0 | 12 | -1 |
| Gun | brawler | punchFin | 19 | 49 | 19 | 0 | 18 | -1 |
| Gun | brawler | kick1 | 20 | 50 | 20 | 0 | 19 | -1 |
| Gun | brawler | kick2 | 22 | 53 | 22 | 0 | 22 | 0 |
| Gun | brawler | sweep | 28 | 62 | 28 | 0 | 28 | 0 |
| Gun | brawler | spFire | 18 | 54 | 18 | 0 | 17 | -1 |
| Martial Arts | karate | jab1 | 8 | 39 | 8 | 0 | 7 | -1 |
| Martial Arts | karate | jab2 | 5 | 32 | 5 | 0 | 4 | -1 |
| Martial Arts | karate | jab3 | 7 | 34 | 7 | 0 | 7 | 0 |
| Martial Arts | karate | punchFin | 13 | 43 | 13 | 0 | 12 | -1 |
| Martial Arts | karate | kick1 | 14 | 44 | 14 | 0 | 14 | 0 |
| Martial Arts | karate | kick2 | 16 | 47 | 16 | 0 | 16 | 0 |
| Martial Arts | karate | sweep | 22 | 56 | 22 | 0 | 23 | +1 |
| Judo Based | grappler | jab1 | 12 | 43 | 12 | 0 | 11 | -1 |
| Judo Based | grappler | jab2 | 9 | 36 | 9 | 0 | 8 | -1 |
| Judo Based | grappler | jab3 | 11 | 38 | 11 | 0 | 11 | 0 |
| Judo Based | grappler | kick1 | 18 | 48 | 18 | 0 | 18 | 0 |
| Judo Based | grappler | kick2 | 20 | 51 | 20 | 0 | 20 | 0 |
| Judo Based | grappler | sweep | 26 | 60 | 26 | 0 | 26 | 0 |
| Amateur | boxing | jab1 | 14 | 45 | 14 | 0 | 13 | -1 |
| Amateur | boxing | jab2 | 11 | 38 | 11 | 0 | 10 | -1 |
| Amateur | boxing | jab3 | 13 | 40 | 13 | 0 | 12 | -1 |
| Amateur | boxing | punchFin | 19 | 49 | 19 | 0 | 19 | 0 |
| Amateur | boxing | kick1 | 20 | 50 | 20 | 0 | 19 | -1 |
| Amateur | boxing | kick2 | 22 | 53 | 22 | 0 | 22 | 0 |
| Amateur | boxing | sweep | 28 | 62 | 28 | 0 | 28 | 0 |

<!-- end of timing table -->
