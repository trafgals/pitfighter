# MotionBricks hand-off: the motions Urban Reign's data does not give us

This brief is for an agent who will use [NVlabs/motionbricks](https://github.com/NVlabs/motionbricks) offline to
author the clips Pitfighter is missing. Read [animation-handoff.md](animation-handoff.md) and
[calibration.md](calibration.md) first. Every rule in them still applies; this file adds to them.

## Goal

Urban Reign's measured data (calibration.md) gives us strike strings, reaction lengths, the knockdown,
the throw, the grapple and dodge timings. It does not give us locomotion shapes, transitions, taunts,
get-up shapes, stumbles or wall bounces, and the renderer draws most of those as hand formulas in
`targetPose()` (`src/render/body.ts`). Use MotionBricks to generate those motions, then **bake** them into
ordinary keyed `Clip` data (`src/render/motion.ts`). MotionBricks is an authoring tool only: the game
ships no model, no ONNX, no Python and no runtime dependency.

## Hard rules

1. **No Namco or Urban Reign material** in anything committed: no ripped animation, no poses traced from
   footage. Timing numbers from calibration.md are fine; shapes are ours.
2. **The sim decides, the renderer follows.** Do not change anything under `src/sim/`. Clips are fitted to
   the sim's durations, never the other way round.
3. **MotionBricks licences.** The code is Apache-2.0 and the weights are under the NVIDIA Open Model
   Agreement (commercial use allowed). The sample BVH clips bundled with the repo are under the NVIDIA Sample
   Data Evaluation License, internal evaluation only. **Never use them as context or target poses for
   anything you commit, and never ship motion derived from them.** All context and target poses come from
   Pitfighter's own poses (`STANCES`, `IDLE`, existing clip keys) or poses you author by hand.
4. **Keep the tool out of the repo.** Clone and install MotionBricks outside the repo (e.g.
   `C:\code\motionbricks`). Checkpoints, TensorRT engines, caches and raw generated takes stay outside git;
   only the bridge scripts in `tools/motionbricks/` and the baked clips are committed.
5. **Every change lands with tests** (`npm test` green, `npm run test:browser` green; don't edit files while
   the browser test runs).
6. **Work on a branch off `main`, open a PR, never push to `main`** — a push to `main` deploys Pages. No
   auto-merge. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, PR bodies with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
7. No real-world IP names in any prompt, file name or comment.

## Setup

- Needs an NVIDIA GPU with TensorRT, `git lfs` and `uv`. In the MotionBricks clone: `git lfs pull`, `uv sync`.
  The first TensorRT engine build takes several minutes; that's normal.
- Smoke test with `docs/examples/generate_once.py`, then `docs/examples/locomotion_loop.py`. The in-betweener
  demo (`uv run python -m app.inbetweener_demo`) and Scene Preview's "Combat" style mode are useful for
  eyeballing, not for output.
- If the machine has no suitable GPU, stop and report that; don't try to run it on CPU or a cloud service
  without asking.

### The API you'll use

```python
engine = MotionBricksSOMAEngine(SOMA_N1_FP32_ONNX_PATH, model_to_runtime=...)
context, target, output = engine.create_input(skeleton)   # see generate_once.py for the exact shape
context.update_from_poses(...)    # 4 context poses (where the motion starts)
target.update_from_poses(...)     # 1-4 target poses (where it must arrive)
engine.generate_animation(context, target, output)
for i in range(output.num_frames):
    output.sample(i / 30.0, pose, stream=...)
contacts = sample_foot_contacts(...)
```

Facts that shape the pipeline:

- Skeleton is SOMA: 30 joints, root `Hips`, Y up, metres, 6D rotations.
- Output is 30 Hz. The model chooses the length: 24-64 raw frames, 18-58 after the engine trims boundary
  frames. You can't ask for an exact length, so you time-warp afterwards (step 4).
- Long motions (KO, taunt, dizzy) are chains of several generations, each one's last 4 frames feeding the
  next one's context.
- Fix the seed for every take you keep and record it.

## What to generate, in order

Durations are sim frames at 60 Hz, from `src/sim/moves.ts`. Fit to these exactly.

| # | Motion | Sim timing | Replaces in `body.ts` | Notes |
|---|--------|-----------|------------------------|-------|
| 1 | Turn on the spot, L and R | new; no sim state, renderer-only | snap of `ry` | 90° and 180°, per family stance |
| 2 | Walk start / stop, run start / stop | `SPEED.walk 0.05`, `SPEED.run 0.1` units/frame | instant blend in `animate.ts` | upper body only, see "Gait layers" |
| 3 | Dash | `DASH.dur 20`, moves frames 0-12, strikes from 4 | `dash` formula | must be strike-ready by frame 4 |
| 4 | Evade (back and side) | `EVADE.dur 34`, moves 0-14, invulnerable 0-15 | `evade` formula | |
| 5 | Taunt / appeal | `TAUNT.dur 70` | shared `taunt` formula | one per fighter; describe it from that fighter's `moves.appeal.anim` in `src/data/characters.json` |
| 6 | Get up face up / face down | `DOWN.wake 50` (invulnerable 30) | `WAKE_BACK`, `WAKE_FRONT` | start from `DOWN_BACK` / `DOWN_FRONT` end keys, end on stance |
| 7 | Knockdown fall | lands on `FALL_LAND = 27` | `DOWN_LANDED` lead-in | ground contact on frame 27 exactly |
| 8 | KO collapse | `KO_FRAMES 180` | down clip + sink | the ragdoll layer (`ragdoll.ts`) stays on top; give it a clean base |
| 9 | Dizzy loop | `DIZZY.dur 90` | static `dizzy` pose | seamless loop, feet planted |
| 10 | Falling off the edge | `FALL_FRAMES 50` | static `falling` pose | airborne, no contacts |
| 11 | Limb reattach | reattach state | static `reattach` pose | |
| 12 | Stumbles, wall bounce | renderer-only, inside the existing hitstun | none today | must fit inside light hitstun 41 |
| 13 | Gait layers per family | walk / run cycles | shared walk | see below |

**Out of scope:** strikes, specials, grapples, throws and the light/heavy reaction clips. They're tied to
measured frame data and hand-keyed phases, and the families already cover them. Don't regenerate them.

**Not something to generate:** heavy-reaction lengths per hit height and strength (calibration.md has the
records 46, 57, 59, 61, 74 but not the mapping). That needs an emulator RAM measurement; leave it as the open
question in animation-handoff.md.

### Gait layers

The walk is an IK gait (`animate.ts`, `strideOf`) that keeps the feet planted, and it must stay. From
generated walk/run cycles take only the pelvis (`y`, `rx`, `rz`), spine, head and arms, and add them as a
per-family layer on top of the IK legs. Don't take the leg rotations.

## Pipeline

All scripts live in `tools/motionbricks/` (Python run with `uv` from the MotionBricks clone, with the bridge
on its path, plus Node for the TS emit if that's easier).

1. **Pose bridge (`bridge.py`).** Map Pitfighter's `Pose` (`src/render/body.ts`: `y, z, rx, ry, rz`,
   `spineX/Y/Z`, `headX/Y/Z`, `armL[3]`, `armR[3]`, `elbowL/R`, `legL[2]`, `legR[2]` (x forward is negative,
   z out), `kneeL/R`, `hipY`, `tail`) to SOMA joints and back. The body and legs use Euler order `YXZ`
   (`body.ts` around line 1066); check the arms and head there too. Our rig has 11 bones; SOMA joints with
   no counterpart get a rest value going in and are dropped coming out. Scale the root height so our
   standing `y` lines up with SOMA's hip height. Write a round-trip test: every `STANCES` pose →
   SOMA → `Pose` comes back within 1e-3 rad.
2. **Author inputs.** Context poses are the motion's start state, target poses its end state, both built
   with the bridge from `STANCES[family]`, `IDLE`, or the end keys of existing clips (`DOWN_BACK`,
   `DOWN_FRONT`, …). For taunts, hand-author 1-3 key target poses per fighter from their appeal text.
   Save these inputs as JSON next to the baked clip so a take can be regenerated.
3. **Generate** at 30 Hz with a fixed seed. Keep 3-5 takes per motion, pick one by eye with the strip tool.
4. **Resample and time-warp** to 60 Hz and the sim duration. Warp piecewise so that anchors land exactly:
   foot contacts from `sample_foot_contacts`, the landing on frame 27, the dash's strike-ready frame 4, the
   move windows of dash and evade. Root translation must match the sim's travel (the sim moves the fighter;
   the clip must not add or lose distance, or the feet will skate).
5. **Reduce to keys.** Fit 4-8 keys per clip on the phases (`"s"`, `"up"`, `"act"`, `"rec"`, `"end"`, …)
   with `ease` per key and `plant` where a foot is down. Error budget: under 0.05 rad on any joint
   against the warped take, planted feet under 2 cm.
6. **Emit** as TS in `src/render/motion.ts` (or a new `src/render/clips/generated.ts` imported by it), in
   the same `Clip`/`Key` shape as the hand-made clips. Put a provenance comment on each one (MotionBricks
   commit, model file, seed, input file) and add an entry to a manifest, `tools/motionbricks/manifest.json`.
7. **Wire it up** in `targetPose()` (`body.ts`) case by case, replacing the formula for that state. One
   motion per commit, so each one can be reverted alone.

## Checks before each PR

- New tests in `tests/` for each clip: its length matches the sim constant it's named after (import them
  from `src/sim/moves.ts`, don't copy the numbers); it starts and ends on the fighter's stance within
  tolerance; planted feet stay under 2 cm; the dash is strike-ready by frame 4 and the fall lands on 27;
  loops (dizzy, gait) join seamlessly.
- The bridge round-trip test.
- A test that every manifest entry names a clip that exists and every generated clip has a manifest entry.
- `npm test`, `npm run build` (`tsc --noEmit && vite build`), `npm run test:browser`.
- Look at it: `node tools/strip.mjs moves:<family>` and `reactions` for contact sheets in
  `test-output/strips/`, and the game with `?debug=motion` for the motion overlay. Attach the strips to the
  PR.
- Frame time: no measurable change; baked keys cost the same as the hand-made ones.

## Done means

All 13 rows are baked clips in place of the formulas, each with tests and provenance; the IK gait is
untouched underneath the gait layers; nothing in `src/sim/` changed; no MotionBricks code, weights or sample
data in the repo; one PR per group of rows (1-4, 5, 6-8, 9-12, 13), each with strips attached.
