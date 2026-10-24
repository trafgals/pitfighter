# Handoff: original fighter animation, timed to Urban Reign

## Goal

Make Pitfighter's fighters move as well as *Urban Reign*'s motion-captured fighters do: weight, anticipation, follow-through, solid feet, readable hits. Every pose must be our own; only the **timing** comes from Urban Reign. When you're done, a player who knows Urban Reign should feel the same rhythm in every move: when a strike gathers, when it lands, how long it stays out, how long the body takes to recover. The animation itself is visibly Pitfighter's.

## Hard rules

1. The timing, movement, groove and feel of combat must match Urban Reign as much as possible, but not directly use Namco assets. Spend the time to regenerate them yourself. 
2. **The sim decides; the renderer follows.** `src/sim/` is deterministic and must not change for the sake of animation. Everything here happens in `src/render/` (`motion.ts`, `body.ts`, `anatomy.ts`, `fx.ts`, `scene.ts`). The renderer only reads `world.s`. If a move's sim timing is wrong, that's a separate calibration issue, not something to fix in the animation.
3. Every change lands with a test (`npm test` and `npm run test:browser`). Push to `main` only after both pass; a push to `main` deploys to GitHub Pages. Commits end with the repo's usual `Co-Authored-By` line.
4. Delegate simple tasks to mcode (Minimax Code), in parallel if they won't conflict

## What exists today (read these first)

- **`src/render/motion.ts`: the clip system.**
  - A `Clip` is a list of keyed partial poses. Each key is anchored to a **phase** of the move, not a fixed frame:
    - `s`: n frames into the state;
    - `up`, `load`, `snap`: points in the startup, the gather and the fire;
    - `hit`, `act`: relative to the first and last active frames;
    - `rec`, `end`: points in the recovery and the end of the state.
  - Because keys are anchored to phases, one clip lands its contact pose on the hit frame of a fast style and a slow style alike.
  - `LEAD = 2` keys contact two frames early so the springs arrive on time.
  - `SNAP = 4` is the gather-to-fire time.
  - Strikes come in style families, picked through `FAMILY_OF` / `familyOf()`. There are also `SPECIALS`, `REACTIONS`, `CLINCH`, the knees, `THROWER` / `THROWN` and `DOWN_LANDED`.
- **`src/render/body.ts`: the skeleton and the `Pose`.**
  - The skeleton is 11 bones; the `Pose` has about 26 degrees of freedom: body offset and rotation, three spine axes, two head axes, 3-axis shoulders, elbows, 2-axis hips, knees, pelvis twist and tail.
  - `targetPose()` picks the target pose from the fighter's sim state.
  - `applyPose()` drives every joint toward the target on damped springs. Rate 0 means hitstop: the body holds still.
- **Tests:** `tests/motion.test.ts`, `tests/skeleton.test.ts` and `tests/body.test.ts` already check, for example, that every style's contact pose lands on the hit frame (not before), that knees are up on the frame they land, and that the deflection is out over frames 2–14.
- **Visual check:** earlier sessions rendered strips of a move (one frame per column) with a scratch script that isn't in the repo. Add a proper one (step 1).

## Local Urban Reign folders on this machine

All under `C:\code\trafgals\`. In short, they serve two purposes:
- **measurement:** run the retail engine and read numbers out of EE RAM;
- **reference:** notes and screenshots for rhythm, spacing and camera framing.

They are **never** a source of poses, motions, models or textures (hard rule 1).

| Folder | What's in it | Use it for |
|---|---|---|
| `pitfighter\` | This repo (GitHub `trafgals/pitfighter`). `docs\calibration\` holds the measured frames and the decoded movesets; `tools\ur-calibration\` holds the EE RAM probes (`probe1-3.mjs`), the analysis scripts (`an1-6.cjs`) and the moveset decoder (`movesets.cjs`). | Every timing you animate to. |
| `urban-reign-pitfighter\` | The statically recompiled Urban Reign engine (WebAssembly + WebGPU) with the 8-player patch set. Read its `AGENTS.md` first. `test_lib\harness.mjs` boots the engine in headless Chrome and installs EE RAM readers (`window.__ur.u8/u16/s16/u32/f32`); `test_lib\navigator.mjs` drives the menus into a fight. Serve it with `python serve.py` (port 8620). | New timing measurements: hit reactions, get-ups, throws and other things not yet measured. The actor fields are listed in `docs\calibration.md` and in `urban-reign-pitfighter\AGENTS.md` §4.1. |
| `ur-analysis\` | The research workspace: `disasm.txt` (disassembly of the executable, lines `addr:\tword\tinsn`), `elftool.py`, the pristine and patched ELFs, and `reference-engine\` (the **unpatched** build, `ps2web.js/.wasm/.data`). | Measuring against the unpatched game: point `UR_CALIB_ROOT` at a folder holding `reference-engine\` plus urban-reign-pitfighter's web files (see "Reproducing" in `docs\calibration.md`). Look up a table or field address in `disasm.txt`. |
| `urp-notes\` | Findings and task notes from the engine work (`findings_*.md`, `task_*.md`), calibration captures (`calib\`, including `actors.json`) and screenshots (`h_shots\`, `i_shots\`, `probe_shots\`). | How the actor struct and battle flow work, and screenshots to judge camera distance and how readable 8 fighters are on screen. Not for copying poses. |
| `urban-reign-retail\` | The retail disc split into Brotli chunks that the engine streams (`chunks\`). | Nothing directly: the engine reads it. **Do not unpack it or extract assets from it.** |
| `urban-reign-web\` | The original ISOs and the *Urban Reign Redux* mod (with its texture pack). | Nothing for this work. **Do not open, mount or extract the ISOs or the texture pack.** The mod's `ur_actions.py` (upstream: [Jasonafex/urban-reign-redux](https://github.com/Jasonafex/urban-reign-redux)) documents the table layout `docs\calibration.md` already uses. |

A new measurement goes into `pitfighter\docs\calibration\` as data (frame numbers in JSON) with a test in `tests\calibration.test.ts` or `tests\urban-reign-movesets.test.ts`, the same way the existing ones were done. Every probe needs a hard watchdog timeout: the engine takes 5–8 minutes to boot into a fight, so run probes in the background and don't poll them.

## Delegating to mcode (MiniMax Code)

`mcode` is a terminal coding agent installed at `%USERPROFILE%\.minimax-code\`; use version **0.6.9**. You can hand it whole steps of the work below. These details were learned the hard way:

- **Launch it through `mcode.cmd`, not the Git Bash `mcode` shim.** The shim at `~/.minimax-code/mcode` runs a stale 0.0.1-beta copy and fails with "Database schema mismatch". `%USERPROFILE%\.minimax-code\mcode.cmd` starts `releases\0.6.9`. Check with `mcode.cmd --version`.
- **Write the brief to a file and pipe it in.** Don't pass a long prompt on the command line. Run it as a background job with a hard timeout, from PowerShell:

  ```powershell
  $S = "<a scratch folder>"   # holds task.txt; the output goes next to it
  $j = Start-Job -ArgumentList $S { param($S)
    Get-Content "$S\task.txt" -Raw |
      & "$env:USERPROFILE\.minimax-code\mcode.cmd" exec --cwd "C:\code\trafgals\pitfighter" `
        --permission full --timeout 90m --max-steps 250 --input - *> "$S\task.out" }
  if (-not (Wait-Job $j -Timeout 5700)) { Stop-Job $j; "TIMEOUT" }
  Get-Content "$S\task.out" -Tail 120
  ```

  - `--timeout` is mcode's own limit. The `Wait-Job -Timeout` is the watchdog, in seconds, set a little longer.
  - Run the whole thing as a background task and wait for it to finish. **Don't poll** `task.out` or loop on its status.
  - `-o <path>` (`--output-last-message`) writes mcode's final report to its own file if you want it separate from the log.
- **One step per run.** Give it one numbered step from "The work, in order" at a time, not the whole roadmap. A good brief contains:
  - the goal and the hard rules above, copied in, especially "no Namco animation data" and "don't touch `src/sim/`";
  - the exact files, functions and timings involved (paste the frame numbers; don't make it rediscover them);
  - the tests to add, with their assertions spelled out;
  - the commands to run (`npm test`, `npm run test:browser`, `node tools/strip.mjs ...`), each wrapped in a timeout;
  - "do not commit or push": you land the work after review;
  - "report every change, every test's PASS/FAIL lines, and the strip paths".
- **Audit everything it returns. Never accept its summary as-is.** On the urban-reign work its reports were confidently wrong several times:
  - it encoded `sw` instead of `sltiu`, and wired the wrong register;
  - it inverted a condition;
  - it misread a function's purpose;
  - it blamed "no network" for a test it had set up wrong.

  So, for each run:
  1. Read the report, then read the actual diff (`git diff`, `git status`).
  2. Re-run the tests yourself. For animation, also look at the strips.
  3. Check the hard rules: nothing in `src/sim/` changed unless the step asked for it, and nothing was derived from Namco data.
  4. Write the defects you find into a follow-up brief: quote the wrong code and say what it must be. Run mcode again on that brief, or fix small things yourself.
  5. Commit and push to `main` only once `npm test` and `npm run test:browser` pass on your own run.
- **Measurement runs:** if mcode needs a new timing from the Urban Reign engine, include in the brief:
  - the folder table above;
  - the instruction to boot the **unpatched** reference engine;
  - the actor fields to read;
  - the rule that every probe has a hard timeout and tears down Chrome and the server when it ends.

  Check its numbers against an independent run before they go into `docs\calibration\`.

## The work, in order

### 1. A way to see and measure motion
- Add `tools/strip.mjs`. It runs headless Chrome against `npm run dev`, takes a style and a list of moves, steps a fixed-seed match frame by frame, and saves a PNG strip of N frames per move to `test-output/strips/`. Mark the hit frame, active frames and recovery under each column. Every later step uses it to show its work.
- Add a debug overlay, `?debug=motion`, that draws the current phase, frame-in-state, clip name and the striking limb's world velocity.

### 2. Root motion and planted feet
Today the body is placed by the sim position, and the legs only pose, so feet slide.
- Add two-bone IK for the legs, driven by foot targets: plant each foot at its world position while it's weighted, and let the IK solve the hip and knee.
- Mark weight shifts in the clips (`plant: "L" | "R" | "both"` on keys). Steps in strikes, dashes and throws then move a foot deliberately rather than gliding.
- Add a hip-height drop from the IK so a wide stance lowers the pelvis.
- **Test:** during any strike from the strings, a planted foot moves less than 2 cm in world space between its plant and release keys. The contact frames stay unchanged.

### 3. Weight: anticipation, overlap, follow-through
- Every strike gets a gather (`load`) with counter-movement: the hips and shoulder wind the opposite way, the rear heel lifts and weight shifts back.
- Contact comes off the hips. Order the joints so the pelvis leads, then the spine, the shoulder, the elbow and the fist. Use a per-joint delay (overlapping action) instead of all joints arriving together.
- Follow-through past contact, then recovery back into a guard that differs per family (boxer high guard, Thai long guard, brawler low hands). Recovery length must equal the sim's recovery frames.
- Review the springs: a per-joint stiffness and damping table instead of one rate per clip. The head and hands lag slightly; the hips are stiff.
- **Tests:**
  - the contact pose still lands on the hit frame for all 21 styles (the existing test);
  - the striking limb's velocity peaks within ±1 frame of the hit frame;
  - the pelvis's yaw velocity peaks before the fist's.

### 4. Hit reactions that read
- Pick the reaction by **height** (head, body, legs), **side** (left or right, from the hit direction relative to facing) and **strength** (light, heavy, knockdown, launch). That gives at least 12 reaction clips plus the knockdown family. `hitClip(part)` already exists; extend it.
- Reactions start from the current pose plus an impulse at the contact point, not a hard cut. Implement an additive "hit whip": apply an angular kick to the spine and head springs in the blow's direction, then blend into the reaction clip.
- Each reaction's length must equal the sim's hitstun (41 f light, measured), and the knockdown and get-up the measured 50 / 50 f.
- **Tests:**
  - a jab to the head from the fighter's left turns the head to the right;
  - the reaction ends on the frame the sim frees the fighter;
  - two hits in a row keep turning the body, rather than resetting it.

### 5. Transitions
- Blend from the current pose (the spring state) into the next clip over 2–4 frames for cancels: string follow-ups, guard to strike, and any move to a reaction. Never blend across the frames that carry a contact pose.
- Idle and stance: a breathing and bobbing loop per family, weight shifts while circling, and guard turned toward the soft lock-on target.
- Locomotion: a walk/run cycle with stride length matched to the sim's speed. The feet come from step 2.

### 6. Knockdowns, falls and ragdoll
- Knockdowns, throws, launches and falls off edges blend into a lightweight ragdoll: a verlet chain of the 11 bones with joint limits. Blend back into a get-up clip that starts from whatever pose the body landed in (face up or face down: two get-ups).
- The sim still owns the fighter's position and timing. The ragdoll is visual only, and the body settles within the measured 50 f down time.
- **Test:** the body is on the floor on the sim's landing frame, and standing on the frame the get-up ends.

### 7. Every family's moves, then every style
- Pass over each family's clips (strings, stick strings, specials, grapple, clinch, throws, deflect, guard) for silhouette and readability: a strike should read from the camera's distance with 8 fighters on screen.
- Once the per-style movesets from the decoded tables are wired into the sim (separate issue [trafgals/pitfighter#1](https://github.com/trafgals/pitfighter/issues/1)), add clips for the extra actions those movesets introduce. Match each one to its action's hit frames and length from `urban-reign-movesets.json`.

## Definition of done

- `npm test` and `npm run test:browser` pass, with the new tests above.
- A strip of every family's string, low string, special, grapple, throw, deflect, three reactions, knockdown and get-up is in `test-output/strips/`. Each is linked from a short `docs/animation.md` that explains the clip system, IK, springs, reactions and ragdoll.
- The timing table in `docs/animation.md` shows, per move, the sim's hit frame and length next to the frame on which the clip's contact pose actually lands, measured by a test. The difference is 0 for contact and within 1 frame for the velocity peak.
- 8 fighters at 60 fps on the dev machine with the new animation. Add a frame-time check to the browser test.
- No file in the repo contains, or was derived from, Namco animation, model or video data.

## Open questions (fill in as you go)

- Which action ids of each moveset are the stick strings, the running strike and the ground attack? This is needed for step 7 and is tracked in #1.
- How long are the reaction motions per height and strength? Only the light 41 f reaction is measured. Ask for an EE RAM measurement; don't guess from footage.
