// One fighter's animation for one render frame, shared by the scene, the tests
// and the strip tool: the pose the sim state asks for (body.ts targetPose) on
// the joint springs, then the legs on IK.
//
// The feet that carry the weight stay where they were put down: a key of the
// clip plants a foot on the floor where the clip has it, the leg IK holds it
// there while the body turns and lunges over it, and the hips drop when a
// foot would otherwise be out of reach. A foot left too far from where the
// clip wants it steps there. Walking, the gait steps the feet in turn, a
// stride matched to the speed the root is moving at, each foot landing ahead
// of its hip by half a stride so it passes under the body while planted.
//
// The sim decides; this only reads the fighter (src/sim stays deterministic).
import * as THREE from "three";
import type { Fighter, PartId } from "../sim/types";
import type { World } from "../sim/world";
import { LEG, applyPose, copyPose, impulse, targetPose, type Body, type Foot, type Target } from "./body";
import { ragdoll } from "./ragdoll";
import { clipFor, heightOf, mix, reactionFor, type HitStrength, type Plant } from "./motion";

/** Which side of the victim a blow comes from (1: its right, the +x side; -1: its left), and whether it comes from behind. */
export function hitSide(a: Fighter | undefined, d: Fighter): { side: 1 | -1; behind: boolean } {
  if (!a) return { side: 1, behind: false };
  const dx = a.x - d.x;
  const dy = a.y - d.y;
  const dd = Math.hypot(dx, dy) || 1;
  // the victim's forward and its right (+x of the figure) on the sim's floor
  const fx = Math.cos(d.facing);
  const fy = Math.sin(d.facing);
  const lateral = (dx * -fy + dy * fx) / dd;
  const ahead = (dx * fx + dy * fy) / dd;
  // face to face, the attacker's lead (left) hand lands on the victim's right
  const limb = a.state === "attack" && a.move ? clipFor(a.style, a.move)?.limb : undefined;
  const bias = limb === "armL" || limb === "legL" ? 0.4 : limb === "armR" || limb === "legR" ? -0.4 : 0;
  return { side: lateral + bias >= 0 ? 1 : -1, behind: ahead < -0.3 };
}

/** How hard a blow reads: Urban Reign's heavier strikes play the longer reactions (docs/calibration/urban-reign-reactions.json). */
export const strengthOf = (dmg: number, stop: number): HitStrength => (dmg >= 6 || stop >= 9 ? "heavy" : "light");

/** A blow lands on `d`'s body: start its reaction on the pose the blow found, and whip the springs with it. */
export function onHit(v: Body, d: Fighter, a: Fighter | undefined, part: PartId, dmg: number, stop: number): void {
  const { side, behind } = hitSide(a, d);
  const strength = strengthOf(dmg, stop);
  v.cue.react = { ...reactionFor(heightOf(part), side, strength), from: copyPose(v.cur) };
  v.cue.face = behind ? -1 : 1;
  v.cue.side = side;
  v.hurt = { part, age: 0 };
  // a burn from the arena only makes the body flinch
  impulse(v, part, a ? (strength === "heavy" ? 1 : 0.55) : 0.15, side);
}

/** Step the body one render frame: the cue memory, the pose on its springs, the legs on IK. Returns what targetPose decided. */
export function animate(v: Body, f: Fighter, w: World, time: number, dt: number, jitter = 0): Target {
  v.hurt.age += dt;
  v.cue.throwAge += dt;
  if (v.cue.last !== f.state) {
    v.cue.from = v.cue.last;
    v.cue.last = f.state;
  }
  if (f.state !== "hitstun") v.cue.react = null;
  const tp = targetPose(f, w, time, v.hurt, v.cue);
  blendIn(v, f, tp, dt);
  if (f.state === "ko") tp.p.y -= Math.min(1.2, f.t / 120);
  // nothing moves during a hitstop: the pose holds too
  // (a knee or a throw jumps onto its landing pose, so the freeze holds the blow, not the wind-up)
  applyPose(v, tp.p, f.stop > 0 ? 0 : tp.rate, (tp.snap && f.stop === 0) || tp.impact, dt, jitter, tp.drive);
  footwork(v, tp.plant, dt, f.stop > 0);
  ragdoll(v, f, tp, dt, v.cue.from, v.cue.side, v.cue.face);
  // lying down, which way up: the get-up goes by it
  if (f.state === "down" || f.state === "ko") v.cue.lie = UP.set(0, 0, 1).transformDirection(v.spine.matrixWorld).y >= 0 ? 1 : -1;
  else if (f.state !== "wakeup") v.cue.lie = 0;
  return tp;
}

const UP = new THREE.Vector3();

/** A new state or move eases in from the pose the body was in over this many sim frames. */
export const BLEND = 3;

/**
 * A cancel, a string's next blow or a change of state starts from wherever the
 * body was, not from the stance: the target blends out of that pose over
 * BLEND frames, and always lands on the clip by its contact frame. A reaction
 * already plays on the pose the blow found, so it is left alone.
 */
function blendIn(v: Body, f: Fighter, tp: Target, dt: number): void {
  const c = v.cue;
  const key = `${f.state}:${f.move ?? ""}`;
  if (key !== c.key || f.t < c.at) {
    c.key = key;
    c.start = f.t;
    c.age = 0;
    c.blend = f.state === "hitstun" || tp.impact ? null : copyPose(v.cur);
  }
  c.at = f.t;
  if (!c.blend) return;
  // a state whose clock the sim holds still (a seat, a ride) still blends in, on the render's clock; a hitstop holds it
  if (f.stop === 0) c.age += dt * 60;
  const n = tp.T ? Math.min(BLEND, tp.T.hit - c.start) : BLEND;
  const e = Math.max(f.t - c.start, Math.floor(c.age + 1e-6) - 1);
  if (n <= 0 || e >= n) {
    c.blend = null;
    return;
  }
  const k = e / n;
  tp.p = mix(c.blend, tp.p, k * k * (3 - 2 * k));
}

// ---------------------------------------------------------------- the legs
const SIDES = ["L", "R"] as const;
type S = (typeof SIDES)[number];
/** A planted foot this far (m) from where the clip wants it steps there. */
export const STEP_AT = 0.28;
/** A foot the clip has this close (m) to the floor can be put down on it. */
const TOUCH = 0.1;
/** Seconds a recovering step takes. */
const STEP_TIME = 0.14;
/** Below this speed (m/s) a walking fighter stands on both feet. */
const GAIT_MIN = 0.25;
/** Seconds for the IK to take over a foot, or let it go: about 3 frames. */
const IK_IN = 0.05;

/** A step's length (m) at a speed (m/s): longer strides as the fighter goes faster. */
export const strideOf = (speed: number) => Math.min(0.75, 0.25 + 0.15 * speed);

const Y = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const ID = new THREE.Quaternion();
const smooth = (k: number) => k * k * (3 - 2 * k);
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

/** The ankle's world position. */
export function ankleOf(b: Body, s: S, out = new THREE.Vector3()): THREE.Vector3 {
  return b.ankles[s].getWorldPosition(out);
}

/**
 * Two-bone IK for a leg, in the hip's frame: the leg's x and z swing and the
 * knee bend that put the ankle on `target` (world), the knee bending forward.
 * The leg bone turns (legX, -hipY, legZ) in YXZ order under the hips' hipY, so
 * in the hips' frame it is Ry(-hipY) Rx(legX) Rz(legZ).
 */
export function solveLeg(b: Body, s: S, target: THREE.Vector3): { x: number; z: number; knee: number; reach: number } {
  const leg = b.limbs[s === "L" ? "legL" : "legR"];
  const d = b.hips.worldToLocal(tmp.copy(target)).sub(leg.position).applyAxisAngle(Y, b.cur.hipY);
  const L1 = LEG.thigh;
  const L2 = LEG.shin;
  const reach = d.length();
  const D = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-3, reach));
  const knee = Math.acos(Math.max(-1, Math.min(1, (D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2))));
  const P = L1 + L2 * Math.cos(knee);
  const vz = -L2 * Math.sin(knee);
  d.setLength(D);
  const z = Math.asin(Math.max(-1, Math.min(1, d.x / P)));
  const x = Math.atan2(d.z, d.y) - Math.atan2(vz, -P * Math.cos(z));
  return { x, z, knee, reach: reach / (L1 + L2) };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Plant, step and swing the feet, drop the hips to keep the planted feet in reach, and lay the legs on them. */
function footwork(b: Body, mode: Plant | "gait", dt: number, frozen: boolean): void {
  b.root.updateMatrixWorld(true);
  const sc = b.body.scale.x;
  const floor = b.root.position.y + LEG.ankle * sc; // the ankle's height with the foot flat on the floor
  // where the clip has each ankle, put down on the floor
  const fk = { L: ankleOf(b, "L"), R: ankleOf(b, "R") };
  const lifted = { L: fk.L.y - floor, R: fk.R.y - floor }; // how far off the floor the clip has the foot
  for (const s of SIDES) fk[s].y = floor;

  // the root's speed over the floor, for the gait
  const g = b.gait;
  const vel = new THREE.Vector3();
  if (g.prev && dt > 0) vel.subVectors(b.root.position, g.prev).setY(0).divideScalar(dt);
  if (vel.length() > 12) vel.set(0, 0, 0); // a teleport (a respawn), not a run
  g.prev = (g.prev ?? new THREE.Vector3()).copy(b.root.position);
  g.speed = vel.length();
  const walking = mode === "gait" && g.speed > GAIT_MIN;
  const target: Partial<Record<S, THREE.Vector3>> = {};

  if (walking && !g.on) {
    // setting off: the foot further behind steps first
    const back = (s: S) => (b.feet[s].down ? b.feet[s].at : fk[s]).dot(vel);
    g.phase = back("L") <= back("R") ? 0 : 0.5;
  }
  g.on = walking;
  if (walking) {
    const S = strideOf(g.speed);
    if (!frozen) g.phase = (g.phase + (g.speed * dt) / (2 * S)) % 1;
    const lift = 0.06 + 0.02 * g.speed;
    for (const s of SIDES) {
      const ft = b.feet[s];
      const u = ((g.phase + (s === "L" ? 0 : 0.5)) % 1) / 0.5; // 0..1 swinging, 1..2 on the floor
      if (u < 1) {
        if (!ft.swing) ft.swing = { from: (ft.down ? ft.at : fk[s]).clone(), u: 0, dur: 0 };
        ft.down = false;
        ft.swing.u = u;
        // it lands ahead of its hip by half a stride, so it passes under the body while it carries the weight
        const land = tmp2.copy(fk[s]).addScaledVector(vel, S / 2 / Math.max(g.speed, 1e-3));
        const k = smooth(u);
        target[s] = ft.swing.from.clone().lerp(land, k).setY(floor + Math.sin(Math.PI * u) * lift);
      } else {
        // put down where the swing was taking it (or, lifted off by the body, under its hip)
        if (!ft.down) {
          ft.at.copy(fk[s]);
          if (ft.swing) ft.at.addScaledVector(vel, S / 2 / Math.max(g.speed, 1e-3));
          ft.down = true;
        }
        ft.swing = null;
        target[s] = ft.at;
      }
    }
  } else {
    const planted = (s: S) => mode === "both" || mode === "gait" || mode === s;
    for (const s of SIDES) {
      const ft = b.feet[s];
      if (!planted(s)) {
        ft.down = false;
        ft.swing = null;
        continue;
      }
      // a foot is put down when the clip brings it to the floor (a landing from a jump plants it on touching down)
      if (!ft.down && !ft.swing) {
        if (lifted[s] > TOUCH) continue;
        ft.at.copy(fk[s]);
        ft.down = true;
      }
      // left behind by the body (a push, a lunge, a turn): one foot at a time steps back under it
      const other = b.feet[s === "L" ? "R" : "L"];
      if (ft.down && !frozen && !other.swing && flat(ft.at, fk[s]) > STEP_AT) {
        ft.swing = { from: ft.at.clone(), u: 0, dur: STEP_TIME };
        ft.down = false;
      }
      if (ft.swing) {
        if (!frozen) ft.swing.u = Math.min(1, ft.swing.u + dt / ft.swing.dur);
        const u = ft.swing.u;
        target[s] = ft.swing.from.clone().lerp(fk[s], smooth(u)).setY(floor + Math.sin(Math.PI * u) * 0.06);
        if (u >= 1) {
          ft.at.copy(fk[s]);
          ft.down = true;
          ft.swing = null;
        }
      } else target[s] = ft.at;
    }
  }

  // the IK eases in over a few frames when a foot is put down, and out when it is lifted
  for (const s of SIDES) {
    const ft: Foot = b.feet[s];
    const step = dt / IK_IN;
    ft.w = target[s] ? Math.min(1, ft.w + step + 1e-9) : Math.max(0, ft.w - step);
  }

  // the hips drop until every planted foot is in reach
  let drop = 0;
  for (const s of SIDES) {
    const t = target[s];
    if (!t || b.feet[s].w <= 0) continue;
    const hip = b.limbs[s === "L" ? "legL" : "legR"].getWorldPosition(tmp);
    const R = (LEG.thigh + LEG.shin) * sc * 0.985;
    const r = flat(hip, t);
    const top = t.y + Math.sqrt(Math.max(0, R * R - r * r));
    drop = Math.max(drop, (hip.y - top) * b.feet[s].w);
  }
  if (drop > 0) {
    b.body.position.y -= Math.min(drop, 0.2 * sc);
    b.body.updateMatrixWorld(true);
  }
  // a body that leaves its feet behind even so (a jump) takes them off the floor
  for (const s of SIDES) {
    const t = target[s];
    const ft = b.feet[s];
    if (!t || !ft.down) continue;
    const hip = b.limbs[s === "L" ? "legL" : "legR"].getWorldPosition(tmp);
    if (hip.distanceTo(t) > (LEG.thigh + LEG.shin) * sc * 1.005) {
      ft.down = false;
      delete target[s];
    }
  }

  // lay the legs on the IK, blended with the clip's own leg by the IK's weight, and the feet flat
  const c = b.cur;
  b.root.getWorldQuaternion(q1);
  for (const s of SIDES) {
    const ft = b.feet[s];
    const leg = b.limbs[s === "L" ? "legL" : "legR"];
    const knee = b.joints[s === "L" ? "kneeL" : "kneeR"];
    const fkLeg = s === "L" ? c.legL : c.legR;
    const fkKnee = s === "L" ? c.kneeL : c.kneeR;
    const t = target[s];
    if (t && ft.w > 0) {
      const ik = solveLeg(b, s, t);
      const k = ft.w;
      leg.rotation.set(fkLeg[0] + wrap(ik.x - fkLeg[0]) * k, -c.hipY, fkLeg[1] + wrap(ik.z - fkLeg[1]) * k, "YXZ");
      knee.rotation.x = fkKnee + (ik.knee - fkKnee) * k;
      leg.updateMatrixWorld(true);
      // the sole level with the floor, pointing the way the fighter faces
      knee.getWorldQuaternion(q2);
      b.ankles[s].quaternion.copy(q2.invert().multiply(q1)).slerp(ID, 1 - k);
    } else b.ankles[s].quaternion.identity();
  }
}
