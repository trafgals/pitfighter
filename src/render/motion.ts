// The fighters' moves as keyframed motions, authored for Pitfighter to the
// timing and combat structure measured from Urban Reign (see src/sim/moves.ts
// and docs/calibration.md): no animation data of Namco's is used, only the
// frame numbers - when a strike gathers, when it lands, how long it stays out,
// how long the body takes to come back to its stance.
//
// A clip is a list of keyed poses. A key is anchored to a phase of the move,
// not to a fixed frame, so the same clip lands its contact pose on the hit
// frame of a fast Karate jab and of a slow Mighty one:
//
//   ["s", n]    n frames into the state
//   ["up", k]   a fraction k of the startup
//   ["load", k] the gather: a fraction k of the startup, but at least SNAP
//               frames before the contact key, so a fast jab still gathers
//   ["snap", 0] SNAP frames before the contact key: where a strike fires from
//   ["hit", n]  n frames from the first active frame
//   ["act", n]  n frames from the end of the active frames
//   ["rec", k]  a fraction k of the recovery
//   ["end", n]  n frames from the end of the state
//
// Keys carry forward: a field a key leaves out keeps the value of the key
// before it (`reset` starts from the stance instead), and every clip that does
// not `hold` comes back to the stance on its last frame. Between keys the
// fields are eased; contact keys ease "in", so the limb is at full speed when
// it lands, and the joint springs carry that speed on into a follow-through.
//
// The strikes come in style families - the boxer's jab-cross-hook-uppercut,
// the karateka's straight lines, the Thai elbows and shins, the brawler's
// haymakers, the heavyweight's clubbing overhands - and each family keeps the
// string structure of the sim: high string jab1 > jab2 > jab3 > punchFin, low
// string kick1 > kick2 > sweep.
import type { Pose } from "./body";
import { GRAB, HOLD, REVERSAL } from "../sim/moves";
import { STYLES } from "../sim/styles";
import { FAMILY_OF as CHARACTER_FAMILIES } from "../data/characters";
import type { Family } from "../data/types";

export type { Family };

export type Phase = "s" | "up" | "load" | "snap" | "hit" | "act" | "rec" | "end";
export type Ease = "in" | "out" | "io" | "lin";
/** Which feet carry the weight: a planted foot stays where it was put down until a key lifts it. */
export type Plant = "L" | "R" | "both" | "none";
export interface Key {
  at: [Phase, number];
  p: Partial<Pose>;
  ease?: Ease;
  reset?: boolean; // start this key from the stance rather than the key before
  load?: boolean; // the gathered pose a charged strike waits in
  plant?: Plant; // the feet on the floor from this key on (carried forward like the pose)
}
export type Limb = "armL" | "armR" | "legL" | "legR" | "both" | "head" | "body";
export interface Clip {
  keys: Key[];
  limb: Limb; // what lands the blow
  hold?: boolean; // stay on the last key instead of coming back to the stance
  rate?: number; // joint spring rate (1/s) while the clip plays
  plant?: Plant; // the feet before the first key that says otherwise (default: both, or the standing leg of a kick)
  overlap?: boolean; // false: every joint on the clip's own time (no pelvis-first lead)
  point?: "elbow" | "shoulderL" | "shoulderR"; // what lands, if not the fist or the foot of `limb`
  lead?: number; // scales the pelvis-first lead (OVERLAP): an elbow is thrown with the trunk, so its trunk keeps the clip's time
}
/** The frames a clip is laid on: the first active frame, the end of the active frames, the end. */
export interface Timing {
  hit: number;
  act: number;
  end: number;
}

/** Frames the contact pose is keyed ahead of the hit frame, for the springs to catch up. */
export const LEAD = 0;
/** How far past the contact pose a strike drives through (a fraction of its fire), keyed just after the hit so the limb is still at full speed on contact. */
export const THROUGH = 0.15;
/** Frames a strike takes from its gathered pose to contact: Urban Reign's strikes wind up, then fire. */
export const SNAP = 4;
/** Spring rate of the strikes: fast enough that the fist lands on its frame. */
export const STRIKE_RATE = 60;

const WRAP = new Set<keyof Pose>(["ry", "rz"]);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (e: Ease, k: number) => (e === "in" ? k * k : e === "out" ? 1 - (1 - k) * (1 - k) : e === "io" ? k * k * (3 - 2 * k) : k);

export function frameOf(at: [Phase, number], T: Timing): number {
  const [ph, n] = at;
  switch (ph) {
    case "s":
      return n;
    case "up":
      return T.hit * n;
    case "load":
      return Math.max(0, Math.min(T.hit * n, T.hit - LEAD - SNAP));
    case "snap":
      return T.hit - LEAD - SNAP;
    case "hit":
      return T.hit + n;
    case "act":
      return T.act + n;
    case "rec":
      return T.act + (T.end - T.act) * n;
    case "end":
      return T.end + n;
  }
}

function merge(a: Pose, b: Partial<Pose>): Pose {
  const o = { ...a, armL: [...a.armL], armR: [...a.armR], legL: [...a.legL], legR: [...a.legR] } as Pose;
  for (const k of Object.keys(b) as (keyof Pose)[]) {
    const v = b[k];
    if (Array.isArray(v)) (o as unknown as Record<string, number[]>)[k] = [...v];
    else if (typeof v === "number") (o as unknown as Record<string, number>)[k] = v;
  }
  return o;
}

/** a + (b - a) k for every joint (spins the short way round). */
export function mix(a: Pose, b: Pose, k: number): Pose {
  const o = merge(a, {});
  for (const key of Object.keys(a) as (keyof Pose)[]) {
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x)) (o as unknown as Record<string, number[]>)[key] = x.map((v, i) => v + ((y as number[])[i] - v) * k);
    else (o as unknown as Record<string, number>)[key] = WRAP.has(key) ? (x as number) + wrapPi((y as number) - (x as number)) * k : (x as number) + ((y as number) - (x as number)) * k;
  }
  return o;
}

/** The feet a clip starts on: both, or the standing leg of a kick. */
const firstPlant = (clip: Clip): Plant => clip.plant ?? (clip.limb === "legL" ? "R" : clip.limb === "legR" ? "L" : "both");

/** The poses of a clip's keys, on their frames: the stance first, the stance last unless it holds. */
export function resolve(clip: Clip, T: Timing, base: Pose): { at: number; pose: Pose; ease: Ease; load: boolean; plant: Plant }[] {
  const out = [{ at: 0, pose: base, ease: "lin" as Ease, load: false, plant: firstPlant(clip) }];
  let cur = base;
  for (const k of clip.keys) {
    cur = merge(k.reset ? base : cur, k.p);
    const at = Math.min(T.end, Math.max(out[out.length - 1].at, frameOf(k.at, T)));
    out.push({ at, pose: cur, ease: k.ease ?? "io", load: !!k.load, plant: k.plant ?? out[out.length - 1].plant });
  }
  if (!clip.hold) out.push({ at: Math.max(out[out.length - 1].at, T.end), pose: base, ease: "io", load: false, plant: "both" });
  return out;
}

/** The feet carrying the weight on frame t: a key puts its feet down (or lifts them) on its own frame. */
export function plantAt(clip: Clip, t: number, T: Timing, base: Pose): Plant {
  const ks = resolve(clip, T, base);
  let pl = ks[0].plant;
  for (const k of ks) if (k.at <= t) pl = k.plant;
  return pl;
}

/** Where frame t falls in a move: gathering, firing (the last SNAP + LEAD frames before contact), out, or coming back. */
export type MovePhase = "gather" | "fire" | "active" | "recovery";
export function phaseOf(t: number, T: Timing): MovePhase {
  return t < T.hit - LEAD - SNAP ? "gather" : t < T.hit ? "fire" : t < T.act ? "active" : "recovery";
}

/**
 * Overlapping action: the joints of a strike do not all arrive together. The
 * pelvis turns first, the trunk a frame after it, the shoulder and the arm on
 * the clip's own time (they carry the contact pose onto the hit frame), and
 * the head trails. Frames each group runs ahead of the clip:
 */
export const OVERLAP: [number, (keyof Pose)[]][] = [
  [2, ["hipY"]],
  [1, ["spineY", "spineZ", "ry"]],
  [-1, ["headX", "headY", "headZ", "tail"]],
];
/** A clip sampled with every joint group on its own lead (see OVERLAP). */
export function sampleOverlap(clip: Clip, t: number, T: Timing, base: Pose): Pose {
  const p = sampleClip(clip, t, T, base);
  if (clip.overlap === false) return p;
  for (const [d, fields] of OVERLAP) {
    // a head strike lands with the head, so the head keeps the clip's time
    if (clip.limb === "head" && d < 0) continue;
    const lead = d > 0 ? d * (clip.lead ?? 1) : d;
    if (lead === 0) continue;
    const q = sampleClip(clip, t + lead, T, base);
    for (const k of fields) (p as unknown as Record<string, number>)[k] = q[k] as number;
  }
  return p;
}

/** The pose of a clip on frame t. */
export function sampleClip(clip: Clip, t: number, T: Timing, base: Pose): Pose {
  const ks = resolve(clip, T, base);
  if (t < 0) return ks[0].pose;
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i].at) {
      const span = ks[i].at - ks[i - 1].at;
      return span <= 0 ? ks[i].pose : mix(ks[i - 1].pose, ks[i].pose, ease(ks[i].ease, (t - ks[i - 1].at) / span));
    }
  }
  return ks[ks.length - 1].pose;
}

/** The frame of the clip's gathered pose, where a charged strike waits (or -1). */
export function loadFrame(clip: Clip, T: Timing, base: Pose): number {
  const k = resolve(clip, T, base).find((x) => x.load);
  return k ? k.at : -1;
}

/** The same motion with the other hand / foot: for a fighter who lost the limb a clip strikes with. */
export function mirror(p: Pose): Pose {
  return {
    ...p,
    ry: -p.ry,
    rz: -p.rz,
    spineZ: -p.spineZ,
    headY: -p.headY,
    headZ: -p.headZ,
    // the twists mirror about the bladed stance
    hipY: 0.64 - p.hipY,
    spineY: -0.36 - p.spineY,
    armL: [p.armR[0], -p.armR[1], -p.armR[2]],
    armR: [p.armL[0], -p.armL[1], -p.armL[2]],
    elbowL: p.elbowR,
    elbowR: p.elbowL,
    legL: [p.legR[0], -p.legR[1]],
    legR: [p.legL[0], -p.legL[1]],
    kneeL: p.kneeR,
    kneeR: p.kneeL,
  };
}

// ------------------------------------------------------------ the vocabulary
type Side = "L" | "R";
const sgn = (s: Side) => (s === "R" ? 1 : -1);
/** An arm: x swings it forward (< 0), out lifts it away from the body sideways, e bends the elbow (< 0). */
const arm = (s: Side, x: number, out: number, e: number): Partial<Pose> => (s === "L" ? { armL: [x, 0, out], elbowL: e } : { armR: [x, 0, -out], elbowR: e });
/** A leg: x swings it forward (< 0), out lifts it sideways, knee bends the shin back. */
const leg = (s: Side, x: number, out: number, knee: number): Partial<Pose> => (s === "L" ? { legL: [x, -out], kneeL: knee } : { legR: [x, out], kneeR: knee });
/** Turn the hips and chest so the `s` side drives forward by `hip` / `chest` radians, off the bladed stance. */
const turn = (s: Side, hip: number, chest = 0): Partial<Pose> => ({ hipY: 0.32 - sgn(s) * hip, spineY: -0.18 - sgn(s) * chest });
const other = (s: Side): Side => (s === "L" ? "R" : "L");
/** The hand that is not striking stays up at the chin. */
const cover = (s: Side): Partial<Pose> => arm(s, -1.15, -0.35, -2.1);
const all = (...ps: Partial<Pose>[]): Partial<Pose> => Object.assign({}, ...ps);
/** The pose `k` of the way on past `hit` from `load`: what a strike is driving through to. */
function extend(load: Partial<Pose>, hit: Partial<Pose>, k: number): Partial<Pose> {
  const o: Record<string, number | number[]> = {};
  for (const [key, v] of Object.entries(hit) as [keyof Pose, number | number[]][]) {
    const l = load[key] as number | number[] | undefined;
    if (Array.isArray(v)) o[key] = Array.isArray(l) ? v.map((x, i) => x + (x - l[i]) * k) : [...v];
    else o[key] = typeof l === "number" ? v + (v - l) * k : v;
  }
  return o as Partial<Pose>;
}

/**
 * A strike: gather, land on the hit frame, stay out through the active frames, retract, settle.
 * The gather is a counter-movement - the hips and the chest wind the other way
 * (each load pose turns them back) and the weight rocks back off the lead foot
 * - so the fire comes off the hips. `step` is the foot that steps in with the
 * blow: it comes off the floor on the gather, lands with the contact and steps
 * back on the recovery; a kick stands on its other leg until it is back down.
 */
function strike(limb: Limb, load: Partial<Pose>, hit: Partial<Pose>, o: { follow?: Partial<Pose>; back?: Partial<Pose>; gather?: number; step?: Side } = {}): Clip {
  const kick = limb === "legL" ? "R" : limb === "legR" ? "L" : null;
  const lift: Plant = kick ?? (o.step ? other(o.step) : "both");
  return {
    limb,
    rate: STRIKE_RATE,
    plant: kick ?? "both",
    keys: [
      { at: ["load", o.gather ?? 0.55], p: { z: -0.035, ...load }, ease: "out", plant: lift },
      { at: ["snap", 0], p: {}, load: true }, // held here while the button charges it
      { at: ["hit", -LEAD], p: hit, ease: "in", plant: kick ?? "both" },
      // driving on through the target: still at speed on the hit frame
      { at: ["hit", 2], p: extend(load, hit, THROUGH), ease: "out" },
      // the stepping foot comes up again as the follow-through ends and goes back under the body
      { at: ["act", 0], p: o.follow ?? hit, ease: "out", plant: o.step ? other(o.step) : undefined },
      // the limb comes back quickly, the body takes the rest of the recovery to settle
      { at: ["rec", 0.4], p: o.back ?? {}, ease: "io", reset: true, plant: "both" },
    ],
  };
}

// The punches. Each is a gathered pose and a contact pose; the stance between
// them, the step and the hips are what make it read as a punch with weight.
const P = {
  /** a lead jab: a short dip and a snap out, the shoulder covering the chin */
  jab: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -0.6, 0.15, -2.15), turn(s, -0.08, -0.05), { y: -0.07, kneeL: 0.6 }),
      all(arm(s, -1.58, 0.04, -0.06), cover(other(s)), turn(s, 0.3, 0.25), { z: 0.06, spineX: 0.16, headX: 0.05 }),
      { back: { z: 0.03 } },
    ),
  /** a straight from the rear hand: the hips wind back, then the back foot pivots and the hips drive it through */
  cross: (s: Side, step = 0.1) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, 0.3, 0.2, -2.4), turn(s, -0.25, -0.4), { y: -0.08, spineX: 0.06 }),
      all(arm(s, -1.56, 0.05, -0.08), cover(other(s)), turn(s, 0.6, 0.42), { z: step, y: -0.11, spineX: 0.22 }, leg("L", -0.6, 0.06, 0.4), { kneeR: 0.7 }),
      { follow: turn(s, 0.7, 0.5), step: "L" },
    ),
  /** a hook: the elbow comes up level with the fist and the whole trunk turns through it */
  hook: (s: Side, wide = 0) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -0.9, 0.55 + wide * 0.2, -1.9), turn(s, -0.3 - wide * 0.15, -0.35), { y: -0.1, kneeL: 0.65, kneeR: 0.55 }),
      all(arm(s, -1.75, 0.95 + wide * 0.15, -1.0 + wide * 0.25), cover(other(s)), turn(s, 0.42 + wide * 0.15, 0.32 + wide * 0.15), { z: 0.05, y: -0.1, spineX: 0.18 }),
      { follow: turn(s, 0.55 + wide * 0.2, 0.45 + wide * 0.2) },
    ),
  /** an uppercut: dip low on bent knees, then drive skyward off the legs, the fist rising high above the brow */
  upper: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -0.15, 0.25, -1.5), turn(s, -0.25, -0.3), { y: -0.24, kneeL: 1.1, kneeR: 1.0, spineX: 0.38, spineZ: 0.12 * sgn(s) }),
      all(arm(s, -1.92, 0.1, -1.55), cover(other(s)), turn(s, 0.55, 0.4), { z: 0.08, y: 0.05, kneeL: 0.2, kneeR: 0.25, spineX: -0.18, headX: -0.15, spineZ: 0 }),
      { follow: { y: 0.07, spineX: -0.22 } },
    ),
  /** a rising dragon uppercut: deep horse-stance gather into a vertical skyward corkscrew punch */
  risingDragon: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, 0.28, 0.2, -2.2), arm(other(s), -0.9, 0.15, -1.8), turn(s, -0.3, -0.35), { y: -0.24, kneeL: 1.08, kneeR: 0.98, spineX: 0.36 }),
      all(arm(s, -2.05, 0.06, -1.25), cover(other(s)), turn(s, 0.65, 0.48), { z: 0.1, y: 0.06, kneeL: 0.22, kneeR: 0.25, spineX: -0.22, headX: -0.18 }),
      { follow: { y: 0.08, spineX: -0.26 } },
    ),
  /** twin rising lotus palms: scooped low at the waist, then thrust diagonally skyward */
  heavenPalm: () =>
    strike(
      "both",
      all(arm("L", 0.25, 0.28, -2.15), arm("R", 0.25, 0.28, -2.15), { y: -0.25, spineX: 0.34, kneeL: 1.1, kneeR: 0.95, hipY: 0.25, spineY: 0 }),
      all(arm("L", -2.0, 0.14, -0.35), arm("R", -2.0, 0.14, -0.35), { z: 0.1, y: 0.05, spineX: -0.22, headX: -0.16, kneeL: 0.22, kneeR: 0.25, hipY: 0.18, spineY: 0 }),
      { follow: { y: 0.07, spineX: -0.26 } },
    ),
  /** a street-fighter bolo uppercut: slung from down by the ankle up into the sky */
  boloUpper: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, 0.45, 0.55, -1.15), turn(s, -0.45, -0.5), { y: -0.24, kneeL: 1.05, kneeR: 0.95, spineX: 0.38, headX: -0.1 }),
      all(arm(s, -2.05, 0.3, -1.1), arm(other(s), -0.6, 0.45, -1.5), turn(s, 0.78, 0.65), { z: 0.1, y: 0.05, kneeL: 0.25, kneeR: 0.3, spineX: -0.2, headX: -0.15 }),
      { gather: 0.58, follow: { ...turn(s, 0.92, 0.78), y: 0.07, spineX: -0.24 } },
    ),
  /** a two-handed tectonic scoop: both arms dug low between the knees and heaved overhead */
  tectonicScoop: () =>
    strike(
      "both",
      all(arm("L", 0.35, 0.25, -1.45), arm("R", 0.35, 0.25, -1.45), { y: -0.26, spineX: 0.46, headX: -0.15, kneeL: 1.15, kneeR: 1.05, hipY: 0.1, spineY: 0 }),
      all(arm("L", -2.18, 0.18, -0.45), arm("R", -2.18, 0.18, -0.45), { z: 0.1, y: 0.06, spineX: -0.28, headX: -0.2, kneeL: 0.2, kneeR: 0.22, hipY: 0.1, spineY: 0 }),
      { gather: 0.6, follow: { y: 0.08, spineX: -0.34 } },
    ),
  /** an uprooting shoulder & forearm gore that lifts the opponent off their boots */
  liftBarge: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, 0.3, 0.25, -2.0), arm(other(s), -0.7, -0.25, -2.1), turn(s, -0.35, -0.35), { y: -0.25, kneeL: 1.1, kneeR: 0.95, spineX: 0.42 }),
      all(arm(s, -1.95, 0.15, -1.35), arm(other(s), -0.9, -0.25, -2.0), turn(s, 0.72, 0.52), { z: 0.11, y: 0.05, kneeL: 0.22, kneeR: 0.28, spineX: -0.18, headX: -0.12 }),
      { gather: 0.58, follow: { y: 0.07, spineX: -0.24 } },
    ),
  /** an overhand: loops up over the shoulder and comes down on top of the guard */
  overhand: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, 0.15, 0.6, -2.0), turn(s, -0.3, -0.35), { y: -0.05, spineX: -0.08, spineZ: -0.15 * sgn(s) }),
      all(arm(s, -1.85, 0.35, -0.45), cover(other(s)), turn(s, 0.7, 0.45), { z: 0.12, y: -0.14, spineX: 0.4, spineZ: 0.12 * sgn(s), kneeL: 0.8 }),
      { follow: { spineX: 0.5 } },
    ),
  /** a hammer fist: the fist goes up over the head and is clubbed straight down */
  hammer: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -2.75, 0.3, -1.3), turn(s, -0.1, -0.15), { y: 0.02, spineX: -0.2, headX: -0.15 }),
      all(arm(s, -1.3, 0.15, -0.3), cover(other(s)), turn(s, 0.35, 0.25), { z: 0.08, y: -0.16, spineX: 0.5, kneeL: 0.85, kneeR: 0.6 }),
      { gather: 0.6 },
    ),
  /** both fists locked together over the head and brought down: the heavyweight's finisher */
  axeHandle: () =>
    strike(
      "both",
      all(arm("L", -2.85, 0.1, -1.0), arm("R", -2.85, 0.1, -1.0), { y: 0.04, spineX: -0.3, headX: -0.2, hipY: 0.1, spineY: 0 }),
      all(arm("L", -1.2, -0.2, -0.35), arm("R", -1.2, -0.2, -0.35), { z: 0.14, y: -0.22, spineX: 0.7, headX: 0.15, kneeL: 1.0, kneeR: 0.8, hipY: 0.1, spineY: 0 }),
      { gather: 0.65, follow: { spineX: 0.8 } },
    ),
  /** a horizontal elbow: the forearm folded tight, the point of the elbow swung across with a big hip turn */
  elbow: (s: Side): Clip => ({
    ...strike(
      `arm${s}` as Limb,
      all(arm(s, -0.75, 0.3, -2.5), turn(s, -0.35, -0.3), { y: -0.06 }),
      all(arm(s, -1.5, 1.15, -2.55), cover(other(s)), turn(s, 0.48, 0.4), { z: 0.08, y: -0.08, spineX: 0.2, headX: 0.08 }),
      { follow: turn(s, 0.62, 0.52) },
    ),
    point: "elbow",
    lead: 0,
  }),
  /** a downward elbow from a hop: the Thai finisher */
  elbowDown: (s: Side): Clip => ({
    ...strike(
      `arm${s}` as Limb,
      all(arm(s, -2.6, 0.5, -2.55), turn(s, -0.15, -0.2), { y: 0.12, kneeL: 0.9, kneeR: 1.0, spineX: -0.15 }),
      all(arm(s, -1.25, 0.6, -2.55), cover(other(s)), turn(s, 0.5, 0.45), { z: 0.14, y: -0.15, spineX: 0.55, headX: 0.1, kneeL: 0.75 }),
      { gather: 0.6 },
    ),
    point: "elbow",
    lead: 0,
  }),
  /** an open palm heel, the arm and the back leg in one line */
  palm: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -0.4, 0.1, -2.3), turn(s, -0.2, -0.3), { y: -0.14, kneeL: 0.85, kneeR: 0.55 }),
      all(arm(s, -1.5, 0.0, -0.22), arm(other(s), -0.35, 0.2, -2.2), turn(s, 0.55, 0.35), { z: 0.12, y: -0.16, spineX: 0.12 }, leg("L", -0.75, 0.06, 0.75), { kneeR: 0.15 }),
      { step: "L" },
    ),
  /** a backfist: the lead arm folded across the chest, then whipped out from the elbow */
  backfist: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -1.3, -0.55, -2.4), turn(s, -0.3, -0.45), { y: -0.06 }),
      all(arm(s, -1.6, 0.75, -0.12), cover(other(s)), turn(s, 0.2, 0.15), { z: 0.05, spineX: 0.08 }),
      { gather: 0.5 },
    ),
  /** both palms driven out together from the hip: the kung fu finisher */
  doublePalm: () =>
    strike(
      "both",
      all(arm("L", 0.2, 0.25, -2.3), arm("R", 0.2, 0.25, -2.3), { y: -0.2, spineX: -0.05, kneeL: 1.0, kneeR: 0.8, hipY: 0.25, spineY: 0 }),
      all(arm("L", -1.5, 0.12, -0.15), arm("R", -1.5, 0.12, -0.15), { z: 0.2, y: -0.2, spineX: 0.2, hipY: 0.2, spineY: 0 }, leg("L", -0.85, 0.06, 0.8), leg("R", 0.35, -0.06, 0.1)),
      { follow: { z: 0.24 }, step: "L" },
    ),
  /** a lunging straight with a full step in, the back leg locked: the karate finisher */
  lunge: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, 0.35, 0.15, -2.4), turn(s, -0.2, -0.35), { y: -0.12, kneeL: 0.8 }),
      all(arm(s, -1.57, 0.02, -0.05), arm(other(s), 0.25, 0.25, -2.3), turn(s, 0.7, 0.45), { z: 0.28, y: -0.2, spineX: 0.12 }, leg("L", -0.95, 0.06, 0.95), leg("R", 0.5, -0.06, 0.05)),
      { gather: 0.6, follow: { z: 0.32 }, step: "L" },
    ),
  /** a haymaker: wound right back, slung round in a wide arc, the whole body turning after it */
  haymaker: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, 0.5, 0.9, -1.4), turn(s, -0.5, -0.55), { y: -0.06, spineX: -0.05, headX: -0.08 }),
      all(arm(s, -1.6, 1.1, -0.7), arm(other(s), -0.5, 0.5, -1.4), turn(s, 0.85, 0.75), { z: 0.15, y: -0.12, spineX: 0.3 }, leg("L", -0.65, 0.06, 0.55)),
      { gather: 0.6, follow: { ...turn(s, 1.1, 1.0), ry: -0.35 * sgn(s), spineX: 0.38 }, step: "L" },
    ),
  /** a shoulder barge: the body lowered and driven in behind the shoulder */
  barge: (s: Side): Clip => ({
    ...strike(
      "body",
      all(arm(s, -0.6, -0.2, -2.3), arm(other(s), -0.7, -0.3, -2.2), turn(s, -0.4, -0.3), { y: -0.2, kneeL: 1.0, kneeR: 0.8, spineX: 0.2 }),
      all(arm(s, -0.4, -0.3, -2.4), arm(other(s), -0.8, -0.3, -2.2), turn(s, 0.9, 0.4), { z: 0.32, y: -0.24, spineX: 0.55, headX: 0.25 }, leg("L", -0.9, 0.06, 0.9), leg("R", 0.55, -0.06, 0.15)),
      { gather: 0.6, step: "L" },
    ),
    point: `shoulder${s}`,
  }),
};

// The kicks of the low string: they land at the legs and the belly.
const K = {
  /** a front kick: the knee chambered high, then the foot pushed out through the target */
  front: (s: Side, high = 0) =>
    strike(
      `leg${s}` as Limb,
      all(leg(s, -1.25 - high * 0.3, 0, 1.95), leg(other(s), s === "R" ? -0.25 : 0.15, 0.04, 0.35), { y: -0.04, spineX: -0.1 }, arm(other(s), -1.2, -0.4, -1.8)),
      all(leg(s, -1.05 - high * 0.5, 0, 0.08), { spineX: -0.3, z: 0.05 }, arm(s, 0.1, 0.35, -1.6)),
      { gather: 0.55 },
    ),
  /** a roundhouse: the hips turn over, the shin comes round level, the body leans away from it */
  round: (s: Side, height = 0) =>
    strike(
      `leg${s}` as Limb,
      all(leg(s, -0.9 - height * 0.3, 0.35, 1.75), turn(s, 0.35, 0.1), { spineZ: 0.12 * sgn(s), y: -0.03 }, arm(other(s), -1.25, -0.4, -1.8)),
      all(leg(s, -0.9 - height * 0.5, 0.75 + height * 0.2, 0.12), turn(s, 0.95, 0.35), { spineZ: 0.3 * sgn(s), rz: -0.12 * sgn(s), spineX: -0.12 }, arm(s, 0.45, 0.45, -1.2)),
      { follow: { ...turn(s, 1.15, 0.45) } },
    ),
  /** a low kick: the shin swung down into the thigh, the hips turning over hard */
  low: (s: Side) =>
    strike(
      `leg${s}` as Limb,
      all(leg(s, -0.35, 0.3, 1.2), turn(s, 0.25, 0.1), { y: -0.05 }, arm(other(s), -1.25, -0.4, -1.8)),
      all(leg(s, -0.55, 0.62, 0.1), turn(s, 0.95, 0.4), { y: -0.1, spineZ: 0.22 * sgn(s), spineX: -0.05 }, arm(s, 0.4, 0.4, -1.3)),
      { follow: { ...turn(s, 1.2, 0.55) } },
    ),
  /** a teep: a lead push kick with the sole, the body leaning back over the standing leg */
  teep: (s: Side) =>
    strike(
      `leg${s}` as Limb,
      all(leg(s, -1.35, 0, 2.05), { spineX: -0.15, y: -0.03 }),
      all(leg(s, -1.25, -0.05, 0.05), { spineX: -0.4, headX: 0.2, z: 0.04 }, arm(s, -0.4, 0.3, -1.6)),
    ),
  /** a knee: the hips pushed forward under it, the hands pulling the head down */
  knee: (s: Side) =>
    strike(
      `leg${s}` as Limb,
      all(leg(s, 0.35, 0, 0.9), arm("L", -1.45, 0.1, -1.0), arm("R", -1.45, 0.1, -1.0), { y: 0.0, spineX: 0.05 }),
      all(leg(s, -1.55, 0.05, 2.25), arm("L", -1.15, -0.1, -1.6), arm("R", -1.15, -0.1, -1.6), { y: 0.05, spineX: -0.2, z: 0.1, hipY: 0.32 - sgn(s) * 0.3 }),
    ),
  /** a skyward Tiger Knee: deep coil, hands yanking down while the knee erupts toward the jaw */
  skyKnee: (s: Side) =>
    strike(
      `leg${s}` as Limb,
      all(leg(s, 0.4, 0, 0.85), arm("L", -1.55, 0.12, -0.9), arm("R", -1.55, 0.12, -0.9), { y: -0.22, spineX: 0.32, kneeL: 0.95 }),
      all(leg(s, -1.78, 0.05, 2.35), arm("L", -0.65, -0.15, -1.75), arm("R", -0.65, -0.15, -1.75), { y: 0.08, spineX: -0.26, headX: -0.15, z: 0.1, hipY: 0.32 - sgn(s) * 0.38 }),
      { follow: { y: 0.1, spineX: -0.3 } },
    ),
  /** a rising flash crescent kick: deep crouch into a vertical sky-high kick */
  flashKick: (s: Side) =>
    strike(
      `leg${s}` as Limb,
      all(leg(s, 0.35, 0.1, 1.85), leg(other(s), -0.35, 0.04, 0.85), arm("L", -0.8, 0.35, -1.5), arm("R", 0.3, 0.35, -1.4), { y: -0.23, spineX: 0.32 }),
      all(leg(s, -2.15, 0.12, 0.08), arm("L", 0.35, 0.45, -1.2), arm("R", 0.45, 0.45, -1.2), { y: 0.06, spineX: -0.38, headX: 0.18, z: 0.06 }),
      { gather: 0.58, follow: { y: 0.08, spineX: -0.42 } },
    ),
  /** a stomp: the knee comes up and the heel is driven down into the shin or knee */
  stomp: (s: Side) =>
    strike(
      `leg${s}` as Limb,
      all(leg(s, -1.4, 0.1, 1.9), { y: 0.0, spineX: -0.15 }, arm(other(s), -1.2, -0.3, -1.8)),
      all(leg(s, -0.6, 0.05, 0.05), { y: -0.12, spineX: 0.2, z: 0.1, kneeL: s === "R" ? 0.7 : 0.05 }),
    ),
  /** an axe kick: the straight leg swung up high, then chopped down */
  axe: (s: Side) =>
    strike(
      `leg${s}` as Limb,
      all(leg(s, -2.3, 0.25, 0.05), { spineX: -0.35, headX: 0.25, y: 0.02 }, arm(other(s), -1.2, -0.3, -1.8)),
      all(leg(s, -0.95, 0.05, 0.08), { spineX: -0.05, y: -0.06, z: 0.06 }),
      { gather: 0.65 },
    ),
  /** a spinning heel: the body turns its back, then the leg comes round with the spin */
  spinHeel: (s: Side) => ({
    limb: `leg${s}` as Limb,
    rate: STRIKE_RATE,
    keys: [
      { at: ["up", 0.4], p: all(leg(s, -0.4, 0.2, 0.9), { ry: sgn(s) * 1.4, y: -0.06 }), ease: "out", load: true, plant: "none" },
      { at: ["hit", -LEAD], p: all(leg(s, -0.85, 0.9, 0.1), { ry: sgn(s) * 3.6, spineZ: 0.25 * sgn(s), spineX: -0.1 }), ease: "in" },
      { at: ["act", 0], p: { ry: sgn(s) * 4.4 } },
      { at: ["rec", 0.45], p: { ry: sgn(s) * 6.28, spineZ: 0 }, reset: true, plant: "both" },
    ],
  }) as Clip,
};

/** A low spinning sweep: drop onto one knee and swing the straight leg a full turn round at the ankles. */
const sweep = (s: Side): Clip => ({
  limb: `leg${s}` as Limb,
  rate: STRIKE_RATE,
  keys: [
    { at: ["up", 0.6], p: all(leg(other(s), -1.0, 0, 1.75), leg(s, -0.3, 0.6, 0.6), { y: -0.42, spineX: 0.35, ry: -0.5 * sgn(s) }, arm("L", -0.6, 0.6, -0.4), arm("R", -0.6, 0.6, -0.4)), ease: "out", load: true, plant: "none" },
    { at: ["hit", -LEAD], p: all(leg(s, -0.3, 1.4, 0.08), { ry: 1.1 * sgn(s) }), ease: "in" },
    { at: ["act", 0], p: { ry: 2.6 * sgn(s) }, ease: "out" },
    { at: ["rec", 0.35], p: { ry: 4.3 * sgn(s) }, ease: "out" },
    { at: ["rec", 0.7], p: { ry: 6.28 * sgn(s), y: -0.25 }, reset: true, plant: "both" },
  ],
});
/** A foot sweep: the sole hooks the opponent's ankle and reaps it out from under them. */
const reap = (s: Side): Clip =>
  strike(
    `leg${s}` as Limb,
    all(leg(s, 0.2, -0.25, 0.4), turn(s, -0.3, -0.2), arm("L", -1.35, 0.1, -0.9), arm("R", -1.35, 0.1, -0.9), { y: -0.06 }),
    all(leg(s, -0.7, 0.5, 0.05), turn(s, 0.7, 0.3), arm("L", -0.6, 0.2, -1.0), arm("R", -0.6, 0.2, -1.0), { spineX: 0.15, spineZ: -0.2 * sgn(s), y: -0.1 }),
    { follow: { ...turn(s, 0.95, 0.4) } },
  );

/** No arms: the head goes back and then into the opponent's face. */
const headbutt: Clip = strike("head", { spineX: -0.35, headX: -0.4, y: -0.02, z: -0.04 }, { spineX: 0.6, headX: 0.45, z: 0.18, y: -0.08 }, { gather: 0.65 });

// ------------------------------------------------------------ the families
export type MoveClips = Record<"jab1" | "jab2" | "jab3" | "punchFin" | "wallFin" | "boundFin" | "kick1" | "kick2" | "sweep" | "headbutt", Clip>;
const fam = (c: Omit<MoveClips, "headbutt">): MoveClips => ({ ...c, headbutt });

export const FAMILIES: Record<Family, MoveClips> = {
  // jab, cross, lead hook, rear uppercut launcher (plus straight wall-carry and overhand bound smash)
  boxing: fam({ jab1: P.jab("L"), jab2: P.cross("R"), jab3: P.hook("L"), punchFin: P.upper("R"), wallFin: P.cross("R", 0.26), boundFin: P.overhand("R"), kick1: K.stomp("R"), kick2: K.knee("L"), sweep: reap("R") }),
  // straight lines: lead punch, reverse punch, backfist, rising dragon launcher (lunge wall-carry, hammer bound smash)
  karate: fam({ jab1: P.jab("L"), jab2: P.cross("R", 0.14), jab3: P.backfist("L"), punchFin: P.risingDragon("R"), wallFin: P.lunge("R"), boundFin: P.hammer("R"), kick1: K.front("R"), kick2: K.round("L"), sweep: sweep("R") }),
  // jab, cross, lead elbow, soaring sky knee launcher (teep wall-carry, hopping down elbow bound smash)
  muay: fam({ jab1: P.jab("L"), jab2: P.cross("R"), jab3: P.elbow("L"), punchFin: K.skyKnee("R"), wallFin: K.teep("R"), boundFin: P.elbowDown("R"), kick1: K.low("R"), kick2: K.teep("L"), sweep: K.spinHeel("R") }),
  // palm, vertical fist, backfist, twin heaven palms launcher (double palm wall-carry, hammer bound smash)
  kungfu: fam({ jab1: P.palm("L"), jab2: P.cross("R", 0.12), jab3: P.backfist("L"), punchFin: P.heavenPalm(), wallFin: P.doublePalm(), boundFin: P.hammer("R"), kick1: K.front("L"), kick2: K.round("R", 0.6), sweep: sweep("R") }),
  // a flicked jab, an overhand, a wide hook, bolo uppercut launcher (haymaker wall-carry, overhand bound smash)
  brawler: fam({ jab1: P.jab("L"), jab2: P.overhand("R"), jab3: P.hook("L", 1), punchFin: P.boloUpper("R"), wallFin: P.haymaker("R"), boundFin: P.overhand("R"), kick1: K.stomp("R"), kick2: K.knee("L"), sweep: reap("R") }),
  // clubbing overhand, a hook, the hammer fist, tectonic scoop launcher (barge wall-carry, double axe handle bound smash)
  power: fam({ jab1: P.overhand("R"), jab2: P.hook("L", 1), jab3: P.hammer("R"), punchFin: P.tectonicScoop(), wallFin: P.barge("R"), boundFin: P.axeHandle(), kick1: K.stomp("R"), kick2: K.knee("L"), sweep: K.low("R") }),
  // a palm into the chest, a short straight, a forearm, uprooting lift-barge launcher (shoulder barge wall-carry, axe handle bound smash)
  grappler: fam({ jab1: P.palm("L"), jab2: P.cross("R", 0.06), jab3: P.elbow("L"), punchFin: P.liftBarge("R"), wallFin: P.barge("R"), boundFin: P.axeHandle(), kick1: K.low("R"), kick2: K.knee("L"), sweep: reap("L") }),
  // the hands set up the feet: rising flash crescent kick launcher (high roundhouse wall-carry, axe kick bound smash)
  kicker: fam({ jab1: P.jab("L"), jab2: P.cross("R"), jab3: P.backfist("L"), punchFin: K.flashKick("R"), wallFin: K.round("R", 0.7), boundFin: K.axe("R"), kick1: K.round("L"), kick2: K.axe("R"), sweep: K.spinHeel("R") }),
};
/** The family each Urban Reign style label fights in, from the character design. */
export const FAMILY_OF: Record<string, Family> = CHARACTER_FAMILIES;

export const familyOf = (style: number): Family => FAMILY_OF[STYLES[style]?.style] ?? "karate";

/** The clip a style throws a move with, or null for the moves drawn by formula (the specials). */
export function clipFor(style: number, move: string): Clip | null {
  const f = FAMILIES[familyOf(style)] as Record<string, Clip>;
  if (move === "cmdLaunch") return f.punchFin;
  return f[move] ?? SPECIALS[move === "dashStrike" ? "spCharge" : move] ?? REACTIONS[move] ?? null;
}

// ------------------------------------------------------------ the specials
// Pitfighter's own fury moves (Urban Reign has no such thing), keyed to their
// frame data like the strikes: they gather on the startup, do their work over
// the active frames - a spin of all of them, a charge that runs, a flurry
// that lands a fist on every rehit frame - and recover.

/** Keys that run the legs: a stride every `step` frames from `from` to `to` frames after the hit frame. */
function strides(from: number, to: number, step: number, lean: number): Key[] {
  const ks: Key[] = [];
  for (let n = from, i = 0; n <= to; n += step, i++) {
    const s: Side = i % 2 === 0 ? "L" : "R";
    ks.push({ at: ["hit", n], p: all(leg(s, -1.0, 0.04, 0.55), leg(other(s), 0.55, 0.04, 1.25), { spineX: lean, y: i % 2 === 0 ? -0.1 : -0.04 }), ease: "io" });
  }
  return ks;
}

/** Fists on every rehit frame of the active frames, the hands alternating, retracting in between. */
function flurry(): Clip {
  const ks: Key[] = [{ at: ["load", 0.6], p: all(arm("L", -0.9, -0.2, -2.3), arm("R", -0.9, -0.2, -2.3), { y: -0.12, spineX: 0.18, kneeL: 0.7, kneeR: 0.6, hipY: 0.2, spineY: 0 }), ease: "out" }];
  const REHIT = 4;
  for (let k = 0; k < 6; k++) {
    const s: Side = k % 2 === 0 ? "L" : "R";
    // out in two frames as the other hand comes back, held out over the frame it lands on
    ks.push({ at: ["hit", REHIT * k - LEAD], p: all(arm(s, -1.56, 0.06, -0.08), arm(other(s), -1.0, -0.25, -2.2), turn(s, 0.35, 0.3), { z: 0.06 + 0.02 * (k % 2), spineX: 0.22 }), ease: "in" });
    ks.push({ at: ["hit", REHIT * k], p: {} });
  }
  ks.push({ at: ["rec", 0.4], p: {}, reset: true });
  return { limb: "both", rate: STRIKE_RATE, keys: ks };
}

export const SPECIALS: Record<string, Clip> = {
  // the spin (THE WHIRLIGIG): a crouch, then a whole turn on the active frames with the leg swung out like a roundhouse
  spSpin: {
    limb: "legR",
    rate: STRIKE_RATE,
    keys: [
      { at: ["load", 0.6], p: all({ ry: -0.5, y: -0.12, kneeL: 0.8, kneeR: 0.7, spineX: 0.15 }, arm("L", -1.1, -0.3, -2.0), arm("R", -1.1, -0.3, -2.0)), ease: "out" },
      { at: ["snap", 0], p: {}, plant: "none" },
      { at: ["hit", -LEAD], p: all({ ry: 1.2, y: 0.1, spineX: -0.1, spineZ: 0.2, kneeL: 0.3 }, leg("R", -0.4, 1.35, 0.12), arm("L", -0.3, 1.2, -0.3), arm("R", -0.3, 1.2, -0.3)), ease: "in" },
      { at: ["hit", 3], p: { ry: 2.6 }, ease: "lin" },
      { at: ["hit", 6], p: { ry: 4.1 }, ease: "lin" },
      { at: ["act", 0], p: { ry: 5.6 }, ease: "lin" },
      { at: ["rec", 0.3], p: { ry: 6.28, y: -0.08, spineZ: 0 }, ease: "out", reset: true, plant: "both" },
    ],
  },
  // BRIMSTONE CHARGE: the shoulder lowered and the feet pawing, then a flat-out run behind the shoulder
  spCharge: {
    limb: "body",
    rate: 40,
    keys: [
      { at: ["load", 0.6], p: all({ spineX: 0.5, headX: -0.35, y: -0.2, kneeL: 1.0, kneeR: 0.9, hipY: 0.55, spineY: 0.1 }, arm("L", -1.0, 0.9, -1.5), arm("R", -0.2, 0.5, -0.4), leg("L", -0.7, 0.06, 0.9), leg("R", 0.4, -0.06, 0.6)), ease: "out", plant: "none" },
      ...strides(0, 15, 3, 0.65),
      { at: ["act", 0], p: all(leg("L", -0.8, 0.06, 0.6), leg("R", 0.4, 0.06, 0.8), { spineX: 0.5 }) },
      // the brakes: the lead foot planted, the body straightening up behind it
      { at: ["rec", 0.35], p: all(leg("L", -0.75, 0.06, 0.45), leg("R", 0.35, -0.06, 0.4), { spineX: 0.15, y: -0.1, headX: 0 }), ease: "out", reset: true, plant: "both" },
    ],
  },
  // INFERNAL FLURRY: a fist on every rehit frame
  spFlurry: flurry(),
  // PIT SLAM: a crouch, up into the air with both fists over the head, and down into the floor on the hit frame
  spSlam: {
    limb: "both",
    rate: 40,
    keys: [
      { at: ["up", 0.25], p: all({ y: -0.28, kneeL: 1.2, kneeR: 1.1, spineX: 0.35 }, arm("L", 0.5, 0.3, -0.5), arm("R", 0.5, 0.3, -0.5), leg("L", -0.8, 0.1, 1.2), leg("R", -0.5, 0.1, 1.1)), ease: "out" },
      { at: ["up", 0.65], p: all({ y: 0.75, kneeL: 1.1, kneeR: 1.1, spineX: -0.2, headX: -0.15 }, arm("L", -2.9, 0.15, -0.4), arm("R", -2.9, 0.15, -0.4), leg("L", -0.7, 0.15, 1.1), leg("R", -0.6, 0.15, 1.0)), ease: "out", plant: "none" },
      { at: ["hit", -LEAD], p: all({ y: -0.35, spineX: 0.6, headX: 0.15 }, arm("L", -1.0, 0.1, -0.35), arm("R", -1.0, 0.1, -0.35), leg("L", -0.9, 0.2, 1.3), leg("R", -0.9, 0.2, 1.3)), ease: "in", plant: "both" },
      { at: ["act", 0], p: {} },
      { at: ["rec", 0.5], p: all({ y: -0.2, spineX: 0.3 }, leg("L", -0.6, 0.1, 0.9), leg("R", -0.3, 0.1, 0.8)), ease: "io", reset: true },
    ],
  },
  // PITCHFORK ARC: wound right round to the far side, then a wide sweep across the front on the active frames
  spBlade: {
    limb: "armR",
    rate: STRIKE_RATE,
    keys: [
      { at: ["load", 0.6], p: all(arm("R", -1.45, 0.15, -0.15), arm("L", -1.0, -0.6, -1.4), { spineY: 1.1, ry: 0.4, y: -0.12, kneeL: 0.8, kneeR: 0.5 }), ease: "out" },
      { at: ["snap", 0], p: {} },
      { at: ["hit", -LEAD], p: { spineY: 0.2, ry: 0.0, spineX: 0.15 }, ease: "in" },
      { at: ["act", 0], p: { spineY: -1.3, ry: -0.6 }, ease: "lin" },
      { at: ["rec", 0.3], p: { spineY: -1.45, ry: -0.7 }, ease: "out" },
      { at: ["rec", 0.7], p: { spineY: -0.5, ry: -0.2 }, reset: true },
    ],
  },
  // HELLFIRE FLICK: the fingers cocked back by the ear, then flicked out at the target as the fire leaves them
  spFire: {
    limb: "armR",
    rate: STRIKE_RATE,
    keys: [
      { at: ["load", 0.6], p: all(arm("R", 0.2, 0.35, -2.25), arm("L", -1.3, -0.4, -1.2), { spineY: 0.6, hipY: 0.5, y: -0.08, headX: 0.05 }), ease: "out" },
      { at: ["snap", 0], p: {} },
      { at: ["hit", -LEAD], p: all(arm("R", -1.6, 0.05, -0.02), arm("L", -0.6, 0.4, -1.5), turn("R", 0.55, 0.3), { z: 0.06, spineX: 0.15 }), ease: "in" },
      { at: ["act", 0], p: {} },
      { at: ["rec", 0.4], p: {}, reset: true },
    ],
  },
};

// ------------------------------------------------------------ being hit, and the rest
/** The timing of a state that has no move: everything happens from frame 0, `act` frames in, over `dur`. */
export const stateTiming = (dur: number, hit = 0, act = hit): Timing => ({ hit, act, end: Math.max(dur, act) });

export const GRAB_TIMING: Timing = { hit: GRAB.startup, act: GRAB.startup + GRAB.active, end: GRAB.startup + GRAB.active + GRAB.whiff };
export const REVERSAL_TIMING = (dur: number): Timing => ({ hit: REVERSAL.first, act: REVERSAL.window + 1, end: Math.max(dur, REVERSAL.window + 1) });

export const REACTIONS: Record<string, Clip> = {
  // Triangle: both hands shoot out for the collar, then the body over-reaches if it catches nothing
  grab: {
    limb: "both",
    rate: STRIKE_RATE,
    keys: [
      { at: ["hit", 0], p: all(arm("L", -1.45, 0.12, -0.35), arm("R", -1.45, 0.12, -0.35), { spineX: 0.32, z: 0.12, y: -0.08 }, leg("L", -0.6, 0.06, 0.55)), ease: "out" },
      { at: ["act", 0], p: {} },
      { at: ["act", 6], p: all(arm("L", -1.25, 0.05, -0.6), arm("R", -1.25, 0.05, -0.6), { spineX: 0.42, z: 0.16, headX: 0.15 }), ease: "out" },
      { at: ["rec", 0.6], p: { spineX: 0.2, z: 0.05 }, reset: true },
    ],
  },
  // a blow taken on the guard: the forearms absorb it and the body gives a little
  block: {
    limb: "body",
    rate: 34,
    keys: [
      { at: ["s", 2], p: all(arm("L", -1.25, -0.45, -1.7), arm("R", -1.25, -0.45, -1.7), { spineX: -0.18, headX: 0.15, y: -0.12, z: -0.05, kneeL: 0.8, kneeR: 0.65 }), ease: "out" },
      { at: ["rec", 0.5], p: { spineX: 0.12, z: -0.07 } },
    ],
  },
  // Square: the deflection. The lead forearm sweeps the blow aside on frames
  // 2..14 while the body slips back off the line, then it settles
  parry: {
    limb: "armL",
    rate: 45,
    keys: [
      { at: ["hit", 0], p: all(arm("L", -1.45, 0.55, -1.05), arm("R", -1.2, -0.3, -2.1), { hipY: 0.62, spineY: 0.05, spineX: -0.08, y: -0.1, z: -0.06, kneeR: 0.6 }), ease: "out" },
      { at: ["act", -4], p: all(arm("L", -1.35, 0.75, -1.25), { hipY: 0.7, spineY: 0.12 }) },
      { at: ["act", 3], p: { hipY: 0.5, spineY: 0, z: -0.04 }, ease: "io" },
    ],
  },
  // the low deflection: down on the knees, both forearms dropped onto the kick
  parryLow: {
    limb: "both",
    rate: 45,
    keys: [
      { at: ["hit", 0], p: all(arm("L", -0.85, 0.4, -0.45), arm("R", -0.85, 0.4, -0.45), leg("L", -0.75, 0.1, 1.05), leg("R", -0.2, 0.1, 1.05), { y: -0.27, spineX: 0.25 }), ease: "out" },
      { at: ["act", -2], p: { spineX: 0.3 } },
      { at: ["act", 4], p: { y: -0.15, spineX: 0.15 } },
    ],
  },
  // deflected: the strike is knocked wide and the attacker staggers off balance
  deflected: {
    limb: "body",
    rate: 34,
    keys: [
      { at: ["s", 3], p: all({ spineX: -0.45, headX: -0.4, spineY: 0.45, hipY: 0.55, z: -0.05 }, arm("L", -0.6, 1.25, -0.3), arm("R", -0.6, 1.25, -0.3), leg("L", 0.3, 0.1, 0.4), leg("R", -0.3, -0.1, 0.5)), ease: "out" },
      { at: ["s", 9], p: { spineX: -0.25, spineY: 0.6, headX: -0.25, y: -0.08 } },
    ],
  },
  // counter-hit crumple: knees buckle inward, hands clutch the solar plexus as the fighter sags forward
  crumple: {
    limb: "body",
    rate: 28,
    keys: [
      { at: ["s", 4], p: all({ spineX: 0.52, headX: 0.32, y: -0.16, z: -0.06, kneeL: 0.85, kneeR: 0.9 }, arm("L", -0.75, -0.25, -1.6), arm("R", -0.75, -0.25, -1.6)), ease: "out" },
      { at: ["s", 16], p: all({ spineX: 0.68, headX: 0.42, y: -0.28, z: -0.08, kneeL: 1.2, kneeR: 1.25 }, arm("L", -0.55, -0.15, -1.4), arm("R", -0.55, -0.15, -1.4)), ease: "io" },
      { at: ["rec", 0.75], p: { spineX: 0.25, headX: 0.12, y: -0.1, kneeL: 0.65, kneeR: 0.6 }, ease: "io" },
    ],
  },
};

// ------------------------------------------------------------ the grapple
// Triangle catches on its first frame and the two fighters lock up for up to
// 101 frames: the holder has the victim by the back of the neck, head pulled
// down, and drives knees up into the body (each knee lands on its press frame
// and the hitstop holds it up there), or turns and throws. The thrown body
// goes up and over for 24 frames and lands on its back.

/** The clinch: both hands round the back of the victim's neck, the elbows in, the chest over the head. */
export const CLINCH: Clip = {
  limb: "both",
  rate: 30,
  hold: true,
  keys: [
    { at: ["s", 2], p: all(arm("L", -1.45, 0.1, -0.5), arm("R", -1.45, 0.1, -0.5), { spineX: 0.3, z: 0.1, y: -0.06 }), ease: "out" },
    { at: ["s", 7], p: all(arm("L", -1.3, -0.22, -1.25), arm("R", -1.3, -0.22, -1.25), { spineX: 0.24, headX: 0.12, z: 0.05, y: -0.05, hipY: 0.12, spineY: 0, kneeL: 0.55, kneeR: 0.45 }), ease: "io" },
  ],
};
/** The knee timing: up on the press frame, held through the hitstop, down again before the next one is allowed. */
export const KNEE_TIMING: Timing = { hit: 0, act: 3, end: HOLD.kneeCool };
/** A knee from the clinch, played on top of it: the hands yank the head down onto the rising knee. */
export const clinchKnee = (s: Side): Clip => ({
  limb: `leg${s}` as Limb,
  rate: STRIKE_RATE,
  keys: [
    { at: ["hit", 0], p: all(leg(s, -1.6, 0.05, 2.3), leg(other(s), 0.2, 0.04, 0.2), arm("L", -1.0, -0.2, -1.55), arm("R", -1.0, -0.2, -1.55), { spineX: -0.08, headX: 0.3, y: 0.07, z: 0.04 }, turn(s, 0.3, -0.2)), ease: "lin" },
    { at: ["act", 0], p: {} },
    { at: ["rec", 0.45], p: leg(s, -0.7, 0.05, 1.2), ease: "io" },
  ],
});
/** Held: bent over at the waist with the head trapped, the hands clawing at the holder's forearms. */
export const HELD: Clip = {
  limb: "body",
  rate: 30,
  hold: true,
  keys: [
    { at: ["s", 3], p: { spineX: 0.35, headX: 0.25, y: -0.02 }, ease: "out" },
    { at: ["s", 8], p: all({ spineX: 0.6, headX: 0.38, y: -0.08, hipY: 0.15, spineY: 0 }, arm("L", -1.15, -0.15, -1.0), arm("R", -1.15, -0.15, -1.0), leg("L", -0.2, 0.08, 0.75), leg("R", 0.25, -0.08, 0.65)), ease: "io" },
  ],
};
// the thrower's throw motion runs 48 frames in Urban Reign (docs/calibration/urban-reign-reactions.json, grapple.throw)
export const THROW_TIMING: Timing = { hit: 0, act: 4, end: 48 };
/** The thrower's follow-through: a hip turned in and the body bent over the throw, then up again. */
export const THROWER: Clip = {
  limb: "both",
  rate: 40,
  keys: [
    { at: ["hit", 0], p: all(arm("L", -0.7, -0.6, -0.6), arm("R", -0.5, 0.5, -0.4), { spineX: 0.6, headX: 0.2, hipY: -0.5, spineY: -0.4, y: -0.2, z: 0.1, kneeL: 0.95, kneeR: 0.75 }), ease: "lin" },
    { at: ["act", 0], p: {} },
    { at: ["rec", 0.45], p: { spineX: 0.25, hipY: 0.1, spineY: -0.2, y: -0.08 }, ease: "io" },
  ],
};
/** Thrown: up off the feet, over onto the back at the top of the arc, and down flat on it. */
export const THROWN: Clip = {
  limb: "body",
  rate: 40,
  hold: true,
  plant: "none",
  overlap: false,
  keys: [
    { at: ["s", 3], p: all({ rx: -0.45, y: 0.3, spineX: -0.35, headX: -0.3 }, arm("L", -2.3, 0.6, -0.4), arm("R", -2.3, 0.6, -0.4), leg("L", -0.6, 0.15, 0.7), leg("R", -0.3, 0.15, 0.5)), ease: "out" },
    { at: ["s", 10], p: all({ rx: -1.15, y: 0.95, rz: 0.25 }, leg("L", -1.4, 0.15, 0.4), leg("R", -1.1, 0.2, 0.3), arm("L", -2.7, 0.9, -0.3), arm("R", -2.6, 0.9, -0.3)), ease: "out" },
    { at: ["s", 18], p: { rx: -1.4, y: 0.65, rz: 0.15 }, ease: "lin" },
    { at: ["end", 0], p: all({ rx: -Math.PI / 2, y: 0.18, z: -0.3, rz: 0, spineX: 0, headX: 0.35 }, arm("L", -0.5, 1.1, -0.3), arm("R", -0.5, 1.1, -0.3), leg("L", -0.35, 0.15, 0.4), leg("R", -0.2, 0.15, 0.2)), ease: "in" },
  ],
};
/** Landing from a throw: already flat, so only the bounce and the settle of a knockdown. */
export const DOWN_LANDED: Clip = {
  limb: "body",
  rate: 30,
  hold: true,
  plant: "none",
  overlap: false,
  keys: [
    { at: ["s", 0], p: all({ rx: -Math.PI / 2, y: 0.17, z: -0.32, headX: 0.35 }, arm("L", -0.5, 1.1, -0.3), arm("R", -0.5, 1.1, -0.3), leg("L", -0.35, 0.15, 0.4), leg("R", -0.2, 0.15, 0.2)) },
    { at: ["s", 4], p: { rx: -1.36, y: 0.25, headX: 0.1 }, ease: "out" },
    { at: ["s", 10], p: all({ rx: -Math.PI / 2, y: 0.18, z: -0.3, headX: 0.2 }, arm("L", -0.3, 1.0, -0.4), arm("R", -0.3, 1.0, -0.4), leg("L", 0, 0.15, 0.15), leg("R", 0, 0.15, 0.4)), ease: "in" },
  ],
};



// ------------------------------------------------------------ the hit reactions
// Measured in Urban Reign's EE RAM (docs/calibration/urban-reign-reactions.json):
// a light hit plays a 41-frame reaction, which one depends on the side the blow
// comes from; heavier blows play 46-59 frames; a knockdown falls for about 27
// frames, stays on the floor face up or face down, and gets up in 50. The sim
// owns the lengths (the fighter's hitstun, DOWN); a reaction only fills them.
//
// A reaction is played on top of the pose the blow found the body in: the
// clip is an offset from that pose, which itself eases back to the stance
// over the reaction. So a second blow before the first has settled turns the
// body further rather than starting it over, and the reaction ends in the
// stance on the frame the sim lets the fighter go.

/** Frames from the start of a knockdown to the body landing on the floor (measured: the fall action runs a median 27 frames). */
export const FALL_LAND = 27;

export type HitHeight = "head" | "body" | "legs";
export type HitStrength = "light" | "heavy" | "knockdown" | "launch";
/** The pose every reaction offset is added to: nothing moved. */
export const ZERO: Pose = { y: 0, z: 0, rx: 0, ry: 0, rz: 0, spineX: 0, spineY: 0, spineZ: 0, headX: 0, headY: 0, headZ: 0, armL: [0, 0, 0], armR: [0, 0, 0], elbowL: 0, elbowR: 0, legL: [0, 0], legR: [0, 0], kneeL: 0, kneeR: 0, hipY: 0, tail: 0 };

/**
 * The offset of a reaction to a blow that lands on the fighter's right (the
 * left is its mirror): the struck part is driven away from the blow and turned
 * with it, peaking a few frames after contact, then easing off.
 */
function reaction(height: HitHeight, heavy: boolean): Clip {
  const k = heavy ? 1.6 : 1;
  const peak = heavy ? 5 : 3;
  const out: Record<HitHeight, Partial<Pose>> = {
    // the head snaps away from the fist, turning and tilting off it; the chest follows it round
    head: all({ headY: -0.55 * k, headX: -0.35 * k, headZ: 0.22 * k, spineY: -0.22 * k, spineX: -0.16 * k, spineZ: 0.08 * k, z: -0.04 * k, y: -0.03 * k }, { armL: [0.35 * k, 0, 0.3 * k], armR: [0.25, 0, -0.2 * k], elbowL: 0.4 }),
    // the trunk folds over the blow and turns away from it, the knees give, the arms come in
    body: all({ spineX: 0.42 * k, headX: 0.22 * k, spineY: -0.2 * k, spineZ: 0.1 * k, y: -0.08 * k, z: -0.03 * k, kneeL: 0.3 * k, kneeR: 0.25 * k }, { armL: [0.25, 0, -0.35 * k], armR: [0.25, 0, 0.35 * k], elbowL: 0.3, elbowR: 0.3 }),
    // the struck leg buckles under the body and the body drops toward it
    legs: all({ kneeR: 0.75 * k, legR: [0.3 * k, 0], y: -0.1 * k, spineZ: 0.18 * k, spineX: 0.16 * k, spineY: -0.12 * k }, { armL: [0, 0, 0.35 * k], armR: [0.2, 0, 0.2] }),
  };
  // a heavy blow walks the fighter back a step
  const step: Partial<Pose> = heavy ? { z: (out[height].z ?? 0) - 0.1, legR: [0.35, 0], kneeL: (out[height].kneeL ?? 0) + 0.2 } : {};
  return {
    limb: height === "head" ? "head" : height === "legs" ? "legR" : "body",
    rate: 34,
    plant: "both",
    overlap: false,
    keys: [
      { at: ["s", peak], p: all(out[height], step), ease: "out" },
      { at: ["s", peak + (heavy ? 12 : 8)], p: all(out[height], step, { headY: (out[height].headY ?? 0) * 0.7, spineY: (out[height].spineY ?? 0) * 0.8 }), ease: "io" },
      { at: ["rec", 0.7], p: { headX: 0, headY: 0, headZ: 0, spineY: 0, spineZ: 0, spineX: (out[height].spineX ?? 0) * 0.2, armL: [0, 0, 0], armR: [0, 0, 0], elbowL: 0, elbowR: 0 }, ease: "io" },
    ],
  };
}

/** The mirror of a reaction offset: the same blow from the other side (the offsets have no stance to mirror about). */
/** A pose with an offset (a reaction) added to every joint. */
export function addPose(a: Pose, d: Pose): Pose {
  const o = merge(a, {});
  for (const key of Object.keys(a) as (keyof Pose)[]) {
    const x = a[key];
    const y = d[key];
    if (Array.isArray(x)) (o as unknown as Record<string, number[]>)[key] = x.map((v, i) => v + (y as number[])[i]);
    else (o as unknown as Record<string, number>)[key] = (x as number) + (y as number);
  }
  return o;
}
export function mirrorOffset(p: Pose): Pose {
  return {
    ...p,
    ry: -p.ry,
    rz: -p.rz,
    spineY: -p.spineY,
    spineZ: -p.spineZ,
    headY: -p.headY,
    headZ: -p.headZ,
    hipY: -p.hipY,
    armL: [p.armR[0], -p.armR[1], -p.armR[2]],
    armR: [p.armL[0], -p.armL[1], -p.armL[2]],
    elbowL: p.elbowR,
    elbowR: p.elbowL,
    legL: [p.legR[0], -p.legR[1]],
    legR: [p.legL[0], -p.legL[1]],
    kneeL: p.kneeR,
    kneeR: p.kneeL,
  };
}

const REACT = Object.fromEntries((["head", "body", "legs"] as HitHeight[]).flatMap((h) => [false, true].map((heavy) => [`${h}:${heavy}`, reaction(h, heavy)]))) as Record<string, Clip>;
/** The reaction clips: 3 heights x light / heavy, each for a blow on the right (a blow on the left plays it mirrored). */
export const REACTION_CLIPS: Readonly<Record<string, Clip>> = REACT;

/** The reaction to a blow: the clip (an offset for a blow on the right) and whether to mirror it for one on the left. */
export function reactionFor(height: HitHeight, side: number, strength: HitStrength): { clip: Clip; mirror: boolean } {
  return { clip: REACT[`${height}:${strength !== "light"}`], mirror: side < 0 };
}
/** The height a blow on a body part reads at. */
export const heightOf = (part: string): HitHeight => (part === "head" ? "head" : part === "legL" || part === "legR" ? "legs" : "body");

/** Flat on the floor: face up (1) or face down (-1). */
const lying = (face: 1 | -1): Partial<Pose> =>
  all({ rx: (-face * Math.PI) / 2, y: 0.18, z: -face * 0.3, spineX: 0, headX: face > 0 ? 0.2 : -0.35, headY: 0 }, arm("L", face > 0 ? -0.3 : -2.6, 1.0, -0.4), arm("R", face > 0 ? -0.3 : -2.6, 1.0, -0.4), leg("L", 0, 0.15, face > 0 ? 0.15 : 0.3), leg("R", 0, 0.15, face > 0 ? 0.4 : 0.1));

/** Knocked down onto the back: the legs go, the body tips back and lands on FALL_LAND, bounces once and lies there. */
export const DOWN_BACK: Clip = {
  limb: "body",
  rate: 30,
  hold: true,
  plant: "both",
  overlap: false,
  keys: [
    // the blow drives the chest back over the feet
    { at: ["s", 5], p: all({ rx: -0.3, y: -0.04, spineX: -0.45, headX: -0.3 }, arm("L", -1.8, 0.9, -0.5), arm("R", -1.6, 0.9, -0.6), leg("R", 0.35, -0.06, 0.4)), ease: "out" },
    // the legs give and the body goes back past its feet
    { at: ["s", 13], p: all({ rx: -0.85, y: -0.2, spineX: -0.2, headX: 0.25 }, arm("L", -2.4, 1.0, -0.4), arm("R", -2.3, 1.0, -0.4), leg("L", -0.8, 0.1, 0.9), leg("R", -0.5, 0.1, 0.7)), ease: "io", plant: "none" },
    { at: ["s", FALL_LAND - 4], p: all({ rx: -1.38, y: 0.1, z: -0.25, headX: 0.4 }, leg("L", -0.6, 0.15, 0.6), leg("R", -0.4, 0.15, 0.4)), ease: "in" },
    { at: ["s", FALL_LAND], p: all(lying(1), { y: 0.17, z: -0.32, headX: 0.35 }, arm("L", -0.5, 1.1, -0.3), arm("R", -0.5, 1.1, -0.3), leg("L", -0.35, 0.15, 0.4), leg("R", -0.2, 0.15, 0.2)), ease: "in" },
    { at: ["s", FALL_LAND + 4], p: { rx: -1.38, y: 0.24, headX: 0.1 }, ease: "out" },
    { at: ["s", FALL_LAND + 10], p: lying(1), ease: "in" },
  ],
};
/** Knocked down onto the front, by a blow from behind: pitched forward over the feet, the arms out to break the fall. */
export const DOWN_FRONT: Clip = {
  limb: "body",
  rate: 30,
  hold: true,
  plant: "both",
  overlap: false,
  keys: [
    { at: ["s", 5], p: all({ rx: 0.3, y: -0.04, spineX: 0.5, headX: -0.4 }, arm("L", -0.4, 0.6, -0.4), arm("R", -0.5, 0.6, -0.4), leg("L", 0.3, 0.06, 0.3)), ease: "out" },
    { at: ["s", 13], p: all({ rx: 0.85, y: -0.18, spineX: 0.3, headX: -0.5 }, arm("L", -1.5, 0.5, -0.3), arm("R", -1.5, 0.5, -0.3), leg("L", 0.4, 0.1, 0.8), leg("R", 0.2, 0.1, 1.0)), ease: "io", plant: "none" },
    { at: ["s", FALL_LAND - 4], p: all({ rx: 1.35, y: 0.1, z: 0.25, headX: -0.4 }, arm("L", -2.2, 0.8, -0.6), arm("R", -2.2, 0.8, -0.6)), ease: "in" },
    { at: ["s", FALL_LAND], p: all(lying(-1), { y: 0.15 }), ease: "in" },
    { at: ["s", FALL_LAND + 4], p: { rx: 1.4, y: 0.21 }, ease: "out" },
    { at: ["s", FALL_LAND + 10], p: lying(-1), ease: "in" },
  ],
};

/** The get-up from the back: roll onto a hip, sit up on one hand, gather the feet under the body, stand into the guard. */
export const WAKE_BACK: Clip = {
  limb: "body",
  rate: 26,
  plant: "none",
  overlap: false,
  keys: [
    { at: ["s", 0], p: lying(1) },
    { at: ["s", 12], p: all({ rx: -1.3, rz: 0.35, y: 0.12, z: -0.25, spineX: 0.25, headX: 0.35 }, leg("L", -0.9, 0.1, 1.4), leg("R", -0.5, 0.1, 0.9), arm("R", 0.4, 0.5, -0.2)), ease: "io" },
    { at: ["s", 24], p: all({ rx: -0.85, rz: 0.15, y: -0.05, z: -0.18, spineX: 0.45, headX: 0.1 }, leg("L", -1.3, 0.1, 1.9), leg("R", -0.8, 0.1, 1.6), arm("R", 0.6, 0.4, -0.1), arm("L", -1.0, 0.2, -1.5)), ease: "io" },
    { at: ["s", 36], p: all({ rx: -0.15, rz: 0, y: -0.38, z: -0.06, spineX: 0.45, headX: -0.05 }, leg("L", -1.05, 0.1, 1.7), leg("R", -0.25, 0.1, 1.8), arm("L", -1.2, -0.3, -1.8), arm("R", -1.2, -0.3, -1.9)), ease: "io", plant: "both" },
    { at: ["s", 45], p: { rx: 0, y: -0.12, spineX: 0.18, kneeL: 0.75, kneeR: 0.6 }, ease: "io" },
  ],
};
/** The get-up from the front: push up on both hands, draw a knee under the chest, rise off it into the guard. */
export const WAKE_FRONT: Clip = {
  limb: "body",
  rate: 26,
  plant: "none",
  overlap: false,
  keys: [
    { at: ["s", 0], p: lying(-1) },
    // the hands come under the shoulders and press the chest off the floor
    { at: ["s", 10], p: all({ rx: 1.25, y: 0.22, z: 0.28, spineX: -0.35, headX: -0.4 }, arm("L", -1.4, 0.35, -0.2), arm("R", -1.4, 0.35, -0.2), leg("L", 0.1, 0.12, 0.5), leg("R", 0.05, 0.12, 0.3)), ease: "io" },
    // up on the hands and one knee, the other foot drawn forward under the body
    { at: ["s", 22], p: all({ rx: 0.85, y: -0.12, z: 0.2, spineX: 0.1, headX: -0.3 }, arm("L", -1.15, 0.2, -0.1), arm("R", -1.15, 0.2, -0.1), leg("L", -1.4, 0.1, 1.9), leg("R", 0.25, 0.1, 1.8)), ease: "io" },
    // the hands leave the floor: a crouch over the front foot
    { at: ["s", 34], p: all({ rx: 0.2, y: -0.36, z: 0.06, spineX: 0.55, headX: -0.15 }, leg("L", -1.05, 0.1, 1.7), leg("R", -0.2, 0.1, 1.8), arm("L", -1.2, -0.3, -1.8), arm("R", -1.2, -0.3, -1.9)), ease: "io", plant: "both" },
    { at: ["s", 45], p: { rx: 0, y: -0.12, spineX: 0.18, kneeL: 0.75, kneeR: 0.6 }, ease: "io" },
  ],
};

// ------------------------------------------------------------ the stances
/**
 * Each family's guard, laid over the bladed stance: what every move of the
 * family recovers into. The boxer's fists are up at the brows, the Thai fighter
 * stands tall behind a long lead arm, the brawler carries the hands low.
 */
export const STANCES: Record<Family, Partial<Pose>> = {
  boxing: { armL: [-1.0, 0, -0.2], elbowL: -2.2, armR: [-0.85, 0, 0.32], elbowR: -2.35, spineX: 0.16, headX: 0.08, kneeL: 0.6, kneeR: 0.5, y: -0.06 },
  karate: {},
  muay: { armL: [-1.4, 0, 0.0], elbowL: -0.95, armR: [-0.95, 0, 0.25], elbowR: -2.2, spineX: 0.0, headX: -0.06, kneeL: 0.4, kneeR: 0.32, y: -0.02 },
  kungfu: { armL: [-1.15, 0, 0.05], elbowL: -1.15, armR: [-0.7, 0, 0.0], elbowR: -1.9, spineX: 0.06, kneeL: 0.78, kneeR: 0.72, y: -0.1 },
  brawler: { armL: [-0.5, 0, 0.3], elbowL: -1.5, armR: [-0.35, 0, -0.3], elbowR: -1.7, spineX: 0.16, headX: -0.14, kneeL: 0.45, kneeR: 0.35 },
  power: { armL: [-0.65, 0, 0.45], elbowL: -1.5, armR: [-0.55, 0, -0.45], elbowR: -1.6, legL: [-0.4, 0.14], legR: [0.15, -0.14], spineX: 0.2, kneeL: 0.62, kneeR: 0.55, y: -0.08 },
  grappler: { armL: [-1.05, 0, 0.35], elbowL: -1.05, armR: [-0.95, 0, -0.35], elbowR: -1.15, spineX: 0.36, headX: -0.2, kneeL: 0.85, kneeR: 0.75, y: -0.13 },
  kicker: { armL: [-0.75, 0, 0.25], elbowL: -1.65, armR: [-0.4, 0, -0.3], elbowR: -1.95, spineX: 0.03, kneeL: 0.36, kneeR: 0.3, y: -0.02 },
};
/** How each family breathes and bounces in its stance: bounce rate (rad/s), bounce depth (m), sway of the hips, and how much the lead hand paws. */
export const IDLE: Record<Family, { rate: number; bob: number; sway: number; paw: number }> = {
  boxing: { rate: 4.6, bob: 0.035, sway: 0.05, paw: 0.08 },
  karate: { rate: 4.2, bob: 0.03, sway: 0.02, paw: 0.06 },
  muay: { rate: 2.4, bob: 0.02, sway: 0.1, paw: 0.1 },
  kungfu: { rate: 3.2, bob: 0.015, sway: 0.04, paw: 0.05 },
  brawler: { rate: 3.6, bob: 0.03, sway: 0.07, paw: 0.04 },
  power: { rate: 2.0, bob: 0.02, sway: 0.03, paw: 0.02 },
  grappler: { rate: 2.8, bob: 0.02, sway: 0.05, paw: 0.07 },
  kicker: { rate: 5.0, bob: 0.045, sway: 0.03, paw: 0.05 },
};
