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

export type Phase = "s" | "up" | "load" | "snap" | "hit" | "act" | "rec" | "end";
export type Ease = "in" | "out" | "io" | "lin";
export interface Key {
  at: [Phase, number];
  p: Partial<Pose>;
  ease?: Ease;
  reset?: boolean; // start this key from the stance rather than the key before
  load?: boolean; // the gathered pose a charged strike waits in
}
export type Limb = "armL" | "armR" | "legL" | "legR" | "both" | "head" | "body";
export interface Clip {
  keys: Key[];
  limb: Limb; // what lands the blow
  hold?: boolean; // stay on the last key instead of coming back to the stance
  rate?: number; // joint spring rate (1/s) while the clip plays
}
/** The frames a clip is laid on: the first active frame, the end of the active frames, the end. */
export interface Timing {
  hit: number;
  act: number;
  end: number;
}

/** Frames the contact pose is keyed ahead of the hit frame, for the springs to catch up. */
export const LEAD = 2;
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

function mix(a: Pose, b: Pose, k: number): Pose {
  const o = merge(a, {});
  for (const key of Object.keys(a) as (keyof Pose)[]) {
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x)) (o as unknown as Record<string, number[]>)[key] = x.map((v, i) => v + ((y as number[])[i] - v) * k);
    else (o as unknown as Record<string, number>)[key] = WRAP.has(key) ? (x as number) + wrapPi((y as number) - (x as number)) * k : (x as number) + ((y as number) - (x as number)) * k;
  }
  return o;
}

/** The poses of a clip's keys, on their frames: the stance first, the stance last unless it holds. */
export function resolve(clip: Clip, T: Timing, base: Pose): { at: number; pose: Pose; ease: Ease; load: boolean }[] {
  const out = [{ at: 0, pose: base, ease: "lin" as Ease, load: false }];
  let cur = base;
  for (const k of clip.keys) {
    cur = merge(k.reset ? base : cur, k.p);
    const at = Math.min(T.end, Math.max(out[out.length - 1].at, frameOf(k.at, T)));
    out.push({ at, pose: cur, ease: k.ease ?? "io", load: !!k.load });
  }
  if (!clip.hold) out.push({ at: Math.max(out[out.length - 1].at, T.end), pose: base, ease: "io", load: false });
  return out;
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

/** A strike: gather, land on the hit frame, stay out through the active frames, retract, settle. */
function strike(limb: Limb, load: Partial<Pose>, hit: Partial<Pose>, o: { follow?: Partial<Pose>; back?: Partial<Pose>; gather?: number } = {}): Clip {
  return {
    limb,
    rate: STRIKE_RATE,
    keys: [
      { at: ["load", o.gather ?? 0.55], p: load, ease: "out" },
      { at: ["snap", 0], p: {}, load: true }, // held here while the button charges it
      { at: ["hit", -LEAD], p: hit, ease: "in" },
      { at: ["act", 0], p: o.follow ?? {}, ease: "out" },
      // the limb comes back quickly, the body takes the rest of the recovery to settle
      { at: ["rec", 0.4], p: o.back ?? {}, ease: "io", reset: true },
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
      { follow: turn(s, 0.7, 0.5) },
    ),
  /** a hook: the elbow comes up level with the fist and the whole trunk turns through it */
  hook: (s: Side, wide = 0) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -0.9, 0.55 + wide * 0.2, -1.9), turn(s, -0.3 - wide * 0.15, -0.35), { y: -0.1, kneeL: 0.65, kneeR: 0.55 }),
      all(arm(s, -1.75, 0.95 + wide * 0.15, -1.0 + wide * 0.25), cover(other(s)), turn(s, 0.42 + wide * 0.15, 0.32 + wide * 0.15), { z: 0.05, y: -0.1, spineX: 0.18 }),
      { follow: turn(s, 0.55 + wide * 0.2, 0.45 + wide * 0.2) },
    ),
  /** an uppercut: dip low on bent knees, then drive up off the legs, the fist rising in front of the chin */
  upper: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -0.25, 0.25, -1.55), turn(s, -0.2, -0.25), { y: -0.22, kneeL: 1.05, kneeR: 0.95, spineX: 0.35, spineZ: 0.1 * sgn(s) }),
      all(arm(s, -1.6, 0.12, -1.85), cover(other(s)), turn(s, 0.5, 0.35), { z: 0.08, y: 0.02, kneeL: 0.25, kneeR: 0.3, spineX: -0.12, headX: -0.1, spineZ: 0 }),
      { follow: { y: 0.05, spineX: -0.18 } },
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
  elbow: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -1.0, 0.85, -2.5), turn(s, -0.35, -0.3), { y: -0.06 }),
      all(arm(s, -1.5, 1.15, -2.55), cover(other(s)), turn(s, 0.48, 0.4), { z: 0.08, y: -0.08, spineX: 0.2, headX: 0.08 }),
      { follow: turn(s, 0.62, 0.52) },
    ),
  /** a downward elbow from a hop: the Thai finisher */
  elbowDown: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -2.6, 0.5, -2.55), turn(s, -0.15, -0.2), { y: 0.12, kneeL: 0.9, kneeR: 1.0, spineX: -0.15 }),
      all(arm(s, -1.25, 0.6, -2.55), cover(other(s)), turn(s, 0.5, 0.45), { z: 0.14, y: -0.15, spineX: 0.55, headX: 0.1, kneeL: 0.75 }),
      { gather: 0.6 },
    ),
  /** an open palm heel, the arm and the back leg in one line */
  palm: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, -0.4, 0.1, -2.3), turn(s, -0.2, -0.3), { y: -0.14, kneeL: 0.85, kneeR: 0.55 }),
      all(arm(s, -1.5, 0.0, -0.22), arm(other(s), -0.35, 0.2, -2.2), turn(s, 0.55, 0.35), { z: 0.12, y: -0.16, spineX: 0.12 }, leg("L", -0.75, 0.06, 0.75), { kneeR: 0.15 }),
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
      { follow: { z: 0.24 } },
    ),
  /** a lunging straight with a full step in, the back leg locked: the karate finisher */
  lunge: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, 0.35, 0.15, -2.4), turn(s, -0.2, -0.35), { y: -0.12, kneeL: 0.8 }),
      all(arm(s, -1.57, 0.02, -0.05), arm(other(s), 0.25, 0.25, -2.3), turn(s, 0.7, 0.45), { z: 0.28, y: -0.2, spineX: 0.12 }, leg("L", -0.95, 0.06, 0.95), leg("R", 0.5, -0.06, 0.05)),
      { gather: 0.6, follow: { z: 0.32 } },
    ),
  /** a haymaker: wound right back, slung round in a wide arc, the whole body turning after it */
  haymaker: (s: Side) =>
    strike(
      `arm${s}` as Limb,
      all(arm(s, 0.5, 0.9, -1.4), turn(s, -0.5, -0.55), { y: -0.06, spineX: -0.05, headX: -0.08 }),
      all(arm(s, -1.6, 1.1, -0.7), arm(other(s), -0.5, 0.5, -1.4), turn(s, 0.85, 0.75), { z: 0.15, y: -0.12, spineX: 0.3 }, leg("L", -0.65, 0.06, 0.55)),
      { gather: 0.6, follow: { ...turn(s, 1.1, 1.0), ry: -0.35 * sgn(s), spineX: 0.38 } },
    ),
  /** a shoulder barge: the body lowered and driven in behind the shoulder */
  barge: (s: Side) =>
    strike(
      "body",
      all(arm(s, -0.6, -0.2, -2.3), arm(other(s), -0.7, -0.3, -2.2), turn(s, -0.4, -0.3), { y: -0.2, kneeL: 1.0, kneeR: 0.8, spineX: 0.2 }),
      all(arm(s, -0.4, -0.3, -2.4), arm(other(s), -0.8, -0.3, -2.2), turn(s, 0.9, 0.4), { z: 0.32, y: -0.24, spineX: 0.55, headX: 0.25 }, leg("L", -0.9, 0.06, 0.9), leg("R", 0.55, -0.06, 0.15)),
      { gather: 0.6 },
    ),
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
      { at: ["up", 0.4], p: all(leg(s, -0.4, 0.2, 0.9), { ry: sgn(s) * 1.4, y: -0.06 }), ease: "out", load: true },
      { at: ["hit", -LEAD], p: all(leg(s, -0.85, 0.9, 0.1), { ry: sgn(s) * 3.6, spineZ: 0.25 * sgn(s), spineX: -0.1 }), ease: "in" },
      { at: ["act", 0], p: { ry: sgn(s) * 4.4 } },
      { at: ["rec", 0.45], p: { ry: sgn(s) * 6.28, spineZ: 0 }, reset: true },
    ],
  }) as Clip,
};

/** A low spinning sweep: drop onto one knee and swing the straight leg a full turn round at the ankles. */
const sweep = (s: Side): Clip => ({
  limb: `leg${s}` as Limb,
  rate: STRIKE_RATE,
  keys: [
    { at: ["up", 0.6], p: all(leg(other(s), -1.0, 0, 1.75), leg(s, -0.3, 0.6, 0.6), { y: -0.42, spineX: 0.35, ry: -0.5 * sgn(s) }, arm("L", -0.6, 0.6, -0.4), arm("R", -0.6, 0.6, -0.4)), ease: "out", load: true },
    { at: ["hit", -LEAD], p: all(leg(s, -0.3, 1.4, 0.08), { ry: 1.1 * sgn(s) }), ease: "in" },
    { at: ["act", 0], p: { ry: 2.6 * sgn(s) } },
    { at: ["rec", 0.35], p: { ry: 4.3 * sgn(s) }, ease: "out" },
    { at: ["rec", 0.7], p: { ry: 6.28 * sgn(s), y: -0.25 }, reset: true },
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
export type MoveClips = Record<"jab1" | "jab2" | "jab3" | "punchFin" | "kick1" | "kick2" | "sweep" | "headbutt", Clip>;
const fam = (c: Omit<MoveClips, "headbutt">): MoveClips => ({ ...c, headbutt });

export const FAMILIES = {
  // jab, cross, lead hook, rear uppercut; the kicks are scrappy
  boxing: fam({ jab1: P.jab("L"), jab2: P.cross("R"), jab3: P.hook("L"), punchFin: P.upper("R"), kick1: K.stomp("R"), kick2: K.knee("L"), sweep: reap("R") }),
  // straight lines: lead punch, reverse punch, backfist, a lunging punch; front kick, roundhouse, spinning sweep
  karate: fam({ jab1: P.jab("L"), jab2: P.cross("R", 0.14), jab3: P.backfist("L"), punchFin: P.lunge("R"), kick1: K.front("R"), kick2: K.round("L"), sweep: sweep("R") }),
  // jab, cross, lead elbow, a hopping down elbow; low kick, teep, spinning heel
  muay: fam({ jab1: P.jab("L"), jab2: P.cross("R"), jab3: P.elbow("L"), punchFin: P.elbowDown("R"), kick1: K.low("R"), kick2: K.teep("L"), sweep: K.spinHeel("R") }),
  // palm, vertical fist, backfist, double palm; snap kick, crescent, spinning sweep
  kungfu: fam({ jab1: P.palm("L"), jab2: P.cross("R", 0.12), jab3: P.backfist("L"), punchFin: P.doublePalm(), kick1: K.front("L"), kick2: K.round("R", 0.6), sweep: sweep("R") }),
  // a flicked jab, an overhand, a wide hook, the haymaker; stomp, knee, a scrappy sweep
  brawler: fam({ jab1: P.jab("L"), jab2: P.overhand("R"), jab3: P.hook("L", 1), punchFin: P.haymaker("R"), kick1: K.stomp("R"), kick2: K.knee("L"), sweep: reap("R") }),
  // clubbing overhand, a hook, the hammer fist, the double axe handle; stomp, knee, a low kick
  power: fam({ jab1: P.overhand("R"), jab2: P.hook("L", 1), jab3: P.hammer("R"), punchFin: P.axeHandle(), kick1: K.stomp("R"), kick2: K.knee("L"), sweep: K.low("R") }),
  // a palm into the chest, a short straight, a forearm, the shoulder barge; low kick, knee, foot sweep
  grappler: fam({ jab1: P.palm("L"), jab2: P.cross("R", 0.06), jab3: P.elbow("L"), punchFin: P.barge("R"), kick1: K.low("R"), kick2: K.knee("L"), sweep: reap("L") }),
  // the hands only set up the feet: roundhouse, axe kick, spinning heel
  kicker: fam({ jab1: P.jab("L"), jab2: P.cross("R"), jab3: P.backfist("L"), punchFin: P.hook("R"), kick1: K.round("L"), kick2: K.axe("R"), sweep: K.spinHeel("R") }),
};
export type Family = keyof typeof FAMILIES;

/** The family each Urban Reign style label fights in. */
export const FAMILY_OF: Record<string, Family> = {
  Boxing: "boxing",
  Amateur: "boxing",
  Karate: "karate",
  "Martial Arts": "karate",
  "All-Round": "karate",
  Military: "karate",
  "Muay Thai": "muay",
  "Kung Fu": "kungfu",
  Master: "kungfu",
  Speed: "kungfu",
  Street: "brawler",
  Rush: "brawler",
  Gun: "brawler",
  "Samurai Sword": "brawler",
  Power: "power",
  Mighty: "power",
  Wrestling: "power",
  "Judo Based": "grappler",
  Submission: "grappler",
  "Tae Kwon Do": "kicker",
  Capoeira: "kicker",
};

export const familyOf = (style: number): Family => FAMILY_OF[STYLES[style]?.style] ?? "karate";

/** The clip a style throws a move with, or null for the moves drawn by formula (the specials). */
export function clipFor(style: number, move: string): Clip | null {
  const f = FAMILIES[familyOf(style)] as Record<string, Clip>;
  return f[move] ?? REACTIONS[move] ?? null;
}

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
  // a blow to the head snaps it back and walks the fighter back a step
  hitHead: {
    limb: "head",
    rate: 34,
    keys: [
      { at: ["s", 3], p: all({ headX: -0.75, spineX: -0.4, headZ: 0.25, y: -0.06, z: -0.06 }, arm("L", -0.55, 0.4, -1.2), arm("R", -0.5, 0.35, -1.4), leg("R", 0.4, -0.06, 0.3), leg("L", -0.15, 0.06, 0.35)), ease: "out" },
      { at: ["s", 10], p: { headX: -0.55, spineX: -0.3, z: -0.12 } },
      { at: ["rec", 0.55], p: all({ headX: -0.15, spineX: 0, headZ: 0.08 }, arm("L", -1.0, 0.0, -1.7), arm("R", -0.8, 0.1, -2.0)), ease: "io" },
    ],
  },
  // a blow to the body folds the fighter over it, both arms wrapping the belly
  hitBody: {
    limb: "body",
    rate: 34,
    keys: [
      { at: ["s", 3], p: all({ spineX: 0.65, headX: 0.35, y: -0.12, z: -0.05 }, arm("L", -0.6, -0.5, -1.4), arm("R", -0.6, -0.5, -1.4), { kneeL: 0.85, kneeR: 0.7 }), ease: "out" },
      { at: ["s", 14], p: { spineX: 0.55, y: -0.1 } },
      { at: ["rec", 0.6], p: { spineX: 0.25, headX: 0.1, y: -0.06 }, ease: "io" },
    ],
  },
  // a blow to a leg buckles it
  hitLegL: {
    limb: "legL",
    rate: 34,
    keys: [
      { at: ["s", 3], p: all(leg("L", -0.1, 0.1, 1.35), { y: -0.16, spineZ: -0.22, spineX: 0.2 }, arm("L", -0.5, 0.6, -1.0), arm("R", -0.9, 0.3, -1.6)), ease: "out" },
      { at: ["s", 12], p: { y: -0.14 } },
      { at: ["rec", 0.55], p: { kneeL: 0.7, y: -0.08, spineZ: -0.08 } },
    ],
  },
  hitLegR: {
    limb: "legR",
    rate: 34,
    keys: [
      { at: ["s", 3], p: all(leg("R", 0.2, 0.1, 1.35), { y: -0.16, spineZ: 0.22, spineX: 0.2 }, arm("R", -0.5, 0.6, -1.0), arm("L", -0.9, 0.3, -1.6)), ease: "out" },
      { at: ["s", 12], p: { y: -0.14 } },
      { at: ["rec", 0.55], p: { kneeR: 0.7, y: -0.08, spineZ: 0.08 } },
    ],
  },
  // a blow to an arm spins the trunk round with that shoulder
  hitArmL: {
    limb: "armL",
    rate: 34,
    keys: [
      { at: ["s", 3], p: all({ spineY: 0.45, hipY: 0.6, spineX: -0.2 }, arm("L", 0.2, 0.7, -0.6)), ease: "out" },
      { at: ["rec", 0.5], p: { spineY: 0.05, hipY: 0.4, spineX: 0 } },
    ],
  },
  hitArmR: {
    limb: "armR",
    rate: 34,
    keys: [
      { at: ["s", 3], p: all({ spineY: -0.75, hipY: 0.05, spineX: -0.2 }, arm("R", 0.3, 0.7, -0.6)), ease: "out" },
      { at: ["rec", 0.5], p: { spineY: -0.3, hipY: 0.25, spineX: 0 } },
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
  // knocked down: the legs go, the body tips back and hits the floor, bounces once and lies there
  down: {
    limb: "body",
    rate: 30,
    hold: true,
    keys: [
      { at: ["s", 6], p: all({ rx: -0.75, y: -0.08, spineX: -0.3, headX: 0.25 }, arm("L", -2.2, 0.8, -0.4), arm("R", -2.2, 0.8, -0.4), leg("L", -0.7, 0.1, 0.9), leg("R", -0.4, 0.1, 0.6)), ease: "out" },
      { at: ["s", 14], p: all({ rx: -Math.PI / 2, y: 0.17, z: -0.32, spineX: 0, headX: 0.35 }, arm("L", -0.5, 1.1, -0.3), arm("R", -0.5, 1.1, -0.3), leg("L", -0.35, 0.15, 0.4), leg("R", -0.2, 0.15, 0.2)), ease: "in" },
      { at: ["s", 18], p: { rx: -1.38, y: 0.24, headX: 0.1 }, ease: "out" },
      { at: ["s", 24], p: all({ rx: -Math.PI / 2, y: 0.18, z: -0.3, headX: 0.2 }, arm("L", -0.3, 1.0, -0.4), arm("R", -0.3, 1.0, -0.4), leg("L", 0, 0.15, 0.15), leg("R", 0, 0.15, 0.4)), ease: "in" },
    ],
  },
  // the get-up: roll onto a hip, sit up on one hand, gather the feet under the body, stand into the guard
  wakeup: {
    limb: "body",
    rate: 26,
    keys: [
      { at: ["s", 0], p: all({ rx: -Math.PI / 2, y: 0.18, z: -0.3, headX: 0.2 }, arm("L", -0.3, 1.0, -0.4), arm("R", -0.3, 1.0, -0.4), leg("L", 0, 0.15, 0.15), leg("R", 0, 0.15, 0.4)) },
      { at: ["s", 12], p: all({ rx: -1.3, rz: 0.35, y: 0.12, z: -0.25, spineX: 0.25, headX: 0.35 }, leg("L", -0.9, 0.1, 1.4), leg("R", -0.5, 0.1, 0.9), arm("R", 0.4, 0.5, -0.2)), ease: "io" },
      { at: ["s", 24], p: all({ rx: -0.85, rz: 0.15, y: -0.05, z: -0.18, spineX: 0.45, headX: 0.1 }, leg("L", -1.3, 0.1, 1.9), leg("R", -0.8, 0.1, 1.6), arm("R", 0.6, 0.4, -0.1), arm("L", -1.0, 0.2, -1.5)), ease: "io" },
      { at: ["s", 36], p: all({ rx: -0.15, rz: 0, y: -0.38, z: -0.06, spineX: 0.45, headX: -0.05 }, leg("L", -1.05, 0.1, 1.7), leg("R", -0.25, 0.1, 1.8), arm("L", -1.2, -0.3, -1.8), arm("R", -1.2, -0.3, -1.9)), ease: "io" },
      { at: ["s", 45], p: { rx: 0, y: -0.12, spineX: 0.18, kneeL: 0.75, kneeR: 0.6 }, ease: "io" },
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
export const THROW_TIMING: Timing = { hit: 0, act: 4, end: 30 };
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
  keys: [
    { at: ["s", 0], p: all({ rx: -Math.PI / 2, y: 0.17, z: -0.32, headX: 0.35 }, arm("L", -0.5, 1.1, -0.3), arm("R", -0.5, 1.1, -0.3), leg("L", -0.35, 0.15, 0.4), leg("R", -0.2, 0.15, 0.2)) },
    { at: ["s", 4], p: { rx: -1.36, y: 0.25, headX: 0.1 }, ease: "out" },
    { at: ["s", 10], p: all({ rx: -Math.PI / 2, y: 0.18, z: -0.3, headX: 0.2 }, arm("L", -0.3, 1.0, -0.4), arm("R", -0.3, 1.0, -0.4), leg("L", 0, 0.15, 0.15), leg("R", 0, 0.15, 0.4)), ease: "in" },
  ],
};

/** The clip of a hit reaction, by the part that took the blow. */
export function hitClip(part: string): Clip {
  if (part === "head") return REACTIONS.hitHead;
  if (part === "legL") return REACTIONS.hitLegL;
  if (part === "legR") return REACTIONS.hitLegR;
  if (part === "armL") return REACTIONS.hitArmL;
  if (part === "armR") return REACTIONS.hitArmR;
  return REACTIONS.hitBody;
}

