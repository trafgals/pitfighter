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
import { feelOf } from "./limbfeel";
import { GAITS, clipFor, familyOf, heightOf, mix, reactionFor, type Family, type HitStrength, type Plant } from "./motion";

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
  v.cue.gait = v.gait; // the upper body swings with the feet
  const tp = targetPose(f, w, time, v.hurt, v.cue);
  blendIn(v, f, tp, dt);
  if (f.state === "ko") tp.p.y -= Math.min(1.2, f.t / 120);
  // nothing moves during a hitstop: the pose holds too
  // (a knee or a throw jumps onto its landing pose, so the freeze holds the blow, not the wind-up)
  applyPose(v, tp.p, f.stop > 0 ? 0 : tp.rate, (tp.snap && f.stop === 0) || tp.impact, dt, jitter, tp.drive, f.state === "attack" ? feelOf(f) : undefined);
  footwork(v, f, tp.plant, dt, f.stop > 0);
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
/** A planted foot this many steps (of STEP_AT) behind steps even while the other foot is in the air. */
export const STEP_FAR = 1.85;
/** A planted foot this far (m) over the midline, onto the other leg's side, steps back. */
export const CROSS = 0.06;
/** Seconds a recovering step takes. */
const STEP_TIME = 0.14;
/** Below this speed (m/s) a walking fighter stands on both feet. */
const GAIT_MIN = 0.25;
/** Seconds for the IK to take over a foot, or let it go: about 3 frames. */
const IK_IN = 0.05;

/** How fast (1/s) the sole's roll follows the gait's. */
const ROLL_RATE = 30;
/** The sole's pitch (rad) at heel strike (toe up, negative) and at push-off (toe down), and where on the stance each begins to end. */
export const HEEL_STRIKE = -0.3;
export const PUSH_OFF = 0.5;
/**
 * The foot's roll through the walk cycle, u in 0..2 (0..1 swinging, 1..2 on the
 * floor): it leaves the floor toe down, swings up to land on its heel, rolls
 * flat, and lifts its heel to push off on the ball of the foot.
 */
export function rollOf(u: number): number {
  if (u < 1) return PUSH_OFF * (1 - u) * (1 - u) + HEEL_STRIKE * u * u * u;
  const s = u - 1; // 0..1 down
  if (s < 0.2) return HEEL_STRIKE * (1 - s / 0.2);
  if (s > 0.65) return PUSH_OFF * Math.min(1, (s - 0.65) / 0.35);
  return 0;
}

/** Past this speed (m/s) a walk becomes a run: the feet leave the floor together for a moment. */
const RUN_FROM = 4;
/** A step's length (m) at a speed (m/s): longer strides as the fighter goes faster. */
export const strideOf = (speed: number, family?: Family) => Math.min(1.25, 0.3 + 0.17 * speed) * (family ? GAITS[family].stride : 1);
/** The share of a cycle a foot is in the air: half at a walk, more as it breaks into a run. */
export const airOf = (speed: number, family?: Family) => 0.5 + ((family ? GAITS[family].air : 0.6) - 0.5) * Math.min(1, Math.max(0, (speed - 2.5) / (RUN_FROM - 2.5)));

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const qx = new THREE.Quaternion();
const qz = new THREE.Quaternion();
const qt = new THREE.Quaternion();
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

/** How far a thigh may swing out (rad), and across the midline: a hip is not a frog's. */
export const HIP_OUT_MAX = 1.1;
export const HIP_IN_MAX = 0.45;
/**
 * Where the knee points, in the root's frame: forward, and a little up so a foot straight ahead of the hip (a front kick) bulges the knee up rather than flips it.
 * Not out: a knee that points out tilts the hinge off the pelvis's, and the ragdoll that starts from this pose seeds its hinge axes from it.
 */
const POLE = { up: 0.25, lift: 3, fwd: 1 };

const mBasis = new THREE.Matrix4();
const eul = new THREE.Euler();
const vDir = new THREE.Vector3();
const vPole = new THREE.Vector3();
const vThigh = new THREE.Vector3();
const vShin = new THREE.Vector3();
const vX = new THREE.Vector3();
const vY = new THREE.Vector3();
const vZ = new THREE.Vector3();

/** The scale a grafted limb is drawn at: the bone carries it, so the leg is that much longer. */
export const legHeft = (b: Body, s: S): number => b.limbs[s === "L" ? "legL" : "legR"].scale.x || 1;

/**
 * Two-bone IK for a leg with a pole: the thigh's swing (x, z), its twist about
 * its own axis, and the knee bend that put the ankle on `target` (world).
 *
 * The knee lies in the plane through the hip, the ankle and a pole that points
 * forward, a little out and a little up, so it always bends the way a knee
 * does. The leg bone turns Ry(-hipY) Rx(x) Rz(z) Ry(twist) in the hips'
 * frame: the twist is the third degree of freedom that keeps the knee's hinge
 * on the pole when the foot is out to the side or up in a kick. Without it
 * the thigh has to tip the hinge itself, and a bent knee with a foot out to
 * the side folds the hinge over to the vertical (the splayed, backward legs).
 * There is no atan2 branch cut to cross either: the whole frame is built from
 * vectors, and the bone lengths follow the limb's own scale.
 */
export function solveLeg(b: Body, s: S, target: THREE.Vector3): { x: number; z: number; twist: number; knee: number; reach: number } {
  const leg = b.limbs[s === "L" ? "legL" : "legR"];
  const heft = legHeft(b, s);
  const d = b.hips.worldToLocal(tmp.copy(target)).sub(leg.position).applyAxisAngle(Y, b.cur.hipY);
  const L1 = LEG.thigh * heft;
  const L2 = LEG.shin * heft;
  const reach = d.length();
  const D = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-3, reach));
  const knee = Math.acos(Math.max(-1, Math.min(1, (D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2))));
  // the hip-to-ankle line, and the knee's side of it
  if (reach > 1e-6) vDir.copy(d).divideScalar(reach);
  else vDir.set(0, -1, 0);
  const out = s === "R" ? 1 : -1;
  // a leg hanging down has its knee forward; as the foot comes up to the hip's height (a side or front kick) the knee comes up with it
  const lift = Math.min(1, Math.max(0, (vDir.y + 0.85) / 0.6));
  vPole.set(0, POLE.up + POLE.lift * lift * lift * (3 - 2 * lift), POLE.fwd);
  vPole.addScaledVector(vDir, -vPole.dot(vDir));
  if (vPole.lengthSq() < 1e-8) vPole.set(0, 1, 0).addScaledVector(vDir, -vDir.y);
  vPole.normalize();
  // the thigh: off the hip-ankle line toward the pole by the angle the law of cosines gives
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  vThigh.copy(vDir).multiplyScalar(cosA).addScaledVector(vPole, sinA);
  // the shin, and the thigh's own frame: y up the bone, z where the knee faces (the shin bends back off it), x the hinge
  vShin.copy(vDir).multiplyScalar(D).addScaledVector(vThigh, -L1).normalize();
  vZ.copy(vShin).addScaledVector(vThigh, -vShin.dot(vThigh)).negate();
  if (vZ.lengthSq() < 1e-10) vZ.copy(vPole);
  vZ.addScaledVector(vThigh, -vZ.dot(vThigh)).normalize();
  vY.copy(vThigh).negate();
  vX.crossVectors(vY, vZ);
  eul.setFromRotationMatrix(mBasis.makeBasis(vX, vY, vZ), "XZY");
  // a thigh can swing only so far out, and not far across the other leg
  const swing = Math.max(-HIP_IN_MAX, Math.min(HIP_OUT_MAX, eul.z * out));
  return { x: eul.x, z: swing * out, twist: eul.y, knee, reach: reach / (L1 + L2) };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Plant, step and swing the feet, drop the hips to keep the planted feet in reach, and lay the legs on them. */
function footwork(b: Body, f: Fighter, mode: Plant | "gait", dt: number, frozen: boolean): void {
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
  // In the browser, requestAnimationFrame runs between 60 Hz sim steps where b.root.position
  // has not stepped yet (vel === 0), which would otherwise drop g.speed to 0, abort the swing,
  // and reset g.phase on the next tick. Use the fighter's sim velocity when moving.
  const simSpeedSq = f.velX * f.velX + f.velY * f.velY;
  if (simSpeedSq > 1e-6) vel.set(f.velX * 60, 0, f.velY * 60);
  g.speed = vel.length();
  // which way it moves against the way it faces: sideways or backwards is a shuffle, not a walk
  if (g.speed > 0.05 && g.speed > GAIT_MIN * 0.5) {
    const lv = vel.clone().applyQuaternion(b.root.getWorldQuaternion(q1).invert());
    const ang = Math.atan2(Math.abs(lv.x), lv.z); // 0 straight ahead .. pi straight back
    g.strafe += (smooth(Math.min(1, Math.max(0, (ang - 0.6) / 0.7))) - g.strafe) * Math.min(1, dt * 8);
  } else g.strafe -= g.strafe * Math.min(1, dt * 8);
  const walking = mode === "gait" && g.speed > (g.on ? GAIT_MIN * 0.5 : GAIT_MIN);
  const target: Partial<Record<S, THREE.Vector3>> = {};
  const roll: Record<S, number> = { L: 0, R: 0 };

  if (walking && !g.on) {
    // setting off: the foot further behind steps first
    const back = (s: S) => (b.feet[s].down ? b.feet[s].at : fk[s]).dot(vel);
    g.phase = back("L") <= back("R") ? 0 : 0.5;
  }
  g.on = walking;
  if (walking) {
    const fam = familyOf(f.style);
    const gt = GAITS[fam];
    const st = g.strafe;
    const S = strideOf(g.speed, fam) * (1 - 0.4 * st);
    // the share of the cycle a foot swings: half at a walk (one foot always down), more at a run (both leave the floor)
    const sf = airOf(g.speed, fam) * (1 - st) + 0.5 * st;
    const run = Math.min(1, Math.max(0, (g.speed - 2.5) / (RUN_FROM - 2.5))) * (1 - st);
    if (!frozen) g.phase = (g.phase + (g.speed * dt) / (2 * S)) % 1;
    const lift = (0.12 + 0.02 * g.speed) * gt.lift * (1 - 0.55 * st);
    // a foot lands ahead of its hip by half the ground the body covers while it is down, so it passes under the body without sliding
    const ahead = S * (1 - sf);
    const dir = tmp.copy(vel).divideScalar(Math.max(g.speed, 1e-3));
    const landing = (s: S, out: THREE.Vector3) => {
      out.copy(fk[s]).addScaledVector(dir, ahead);
      if (st > 0.5) {
        // a shuffle: the feet stay either side of the midline instead of crossing
        b.root.worldToLocal(out);
        out.x = s === "R" ? Math.max(out.x, 0.07 * sc) : Math.min(out.x, -0.07 * sc);
        b.root.localToWorld(out);
      }
      return out;
    };
    // the pelvis: dips as a foot lands and vaults over the stance leg walking, springs off it running, and shifts over the foot it stands on
    const x = (((g.phase - sf) * 2) % 1 + 1) % 1;
    const bob = gt.bob * Math.min(1, g.speed / 3) * (1 - 0.5 * st);
    b.body.position.y -= ((1 - run) * (1 - Math.sin(Math.PI * x)) + run * 0.8 * Math.sin(Math.PI * x)) * bob * sc;
    b.body.position.x += Math.sin(2 * Math.PI * g.phase) * gt.shift * Math.min(1, g.speed / 3) * (1 - 0.5 * run) * sc;
    b.body.updateMatrixWorld(true);
    for (const s of SIDES) {
      const ft = b.feet[s];
      const ph = (g.phase + (s === "L" ? 0 : 0.5)) % 1;
      const u = ph < sf ? ph / sf : 1 + (ph - sf) / (1 - sf); // 0..1 swinging, 1..2 on the floor
      if (u < 1) {
        if (!ft.swing) ft.swing = { from: (ft.down ? ft.at : fk[s]).clone(), u: 0, dur: 0 };
        ft.down = false;
        ft.swing.u = u;
        const land = landing(s, tmp2);
        const k = smooth(u);
        target[s] = ft.swing.from.clone().lerp(land, k).setY(floor + Math.sin(Math.PI * u) * lift);
        ft.swing.pos = target[s]!.clone();
        roll[s] = rollOf(u) * (1 - 0.7 * st);
      } else {
        // put down where the swing was taking it (or, lifted off by the body, under its hip)
        if (!ft.down) {
          ft.at.copy(fk[s]);
          if (ft.swing) landing(s, ft.at);
          ft.down = true;
        }
        ft.swing = null;
        target[s] = ft.at;
        roll[s] = rollOf(u) * (1 - 0.7 * st);
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
      // the gait stopping mid-step: the foot finishes the step from where it is, over a step's time, not in one frame
      if (ft.swing && ft.swing.dur === 0) ft.swing = { from: ft.swing.pos ?? ft.swing.from, u: 0, dur: STEP_TIME };
      // a foot is put down when the clip brings it to the floor (a landing from a jump plants it on touching down)
      if (!ft.down && !ft.swing) {
        if (lifted[s] > TOUCH) continue;
        ft.at.copy(fk[s]);
        ft.down = true;
      }
      // left behind by the body (a push, a lunge, a turn): one foot at a time steps back under it
      const other = b.feet[s === "L" ? "R" : "L"];
      // one foot at a time, unless this one has been left far behind (a slide, a dash, a spin) or has crossed the other leg
      const gap = flat(ft.at, fk[s]);
      const localAt = b.root.worldToLocal(tmp.copy(ft.at));
      const crossed = localAt.x * (s === "R" ? 1 : -1) < -CROSS;
      const behind = localAt.z < -STEP_AT * 1.2;
      if (ft.down && !frozen && gap > STEP_AT && (!other.swing || gap > STEP_AT * STEP_FAR || crossed || behind)) {
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
    ft.roll += (roll[s] - ft.roll) * Math.min(1, dt * ROLL_RATE);
  }

  // the hips drop until every planted foot is in reach
  let drop = 0;
  for (const s of SIDES) {
    const t = target[s];
    if (!t || b.feet[s].w <= 0) continue;
    const hip = b.limbs[s === "L" ? "legL" : "legR"].getWorldPosition(tmp);
    const R = (LEG.thigh + LEG.shin) * legHeft(b, s) * sc * 0.985;
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
    if (hip.distanceTo(t) > (LEG.thigh + LEG.shin) * legHeft(b, s) * sc * 1.005) {
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
      // Ry(-hipY) Rx(x) Rz(z) Ry(twist): the clip's own leg has no twist, so it blends in from none
      leg.quaternion
        .setFromAxisAngle(Y, -c.hipY)
        .multiply(qx.setFromAxisAngle(X, fkLeg[0] + wrap(ik.x - fkLeg[0]) * k))
        .multiply(qz.setFromAxisAngle(Z, fkLeg[1] + wrap(ik.z - fkLeg[1]) * k))
        .multiply(qt.setFromAxisAngle(Y, ik.twist * k));
      knee.rotation.x = fkKnee + (ik.knee - fkKnee) * k;
      leg.updateMatrixWorld(true);
      // the sole level with the floor, pointing the way the fighter faces
      knee.getWorldQuaternion(q2);
      b.ankles[s].quaternion.copy(q2.invert().multiply(q1)).slerp(ID, 1 - k).multiply(qt.setFromAxisAngle(X, ft.roll * k));
    } else b.ankles[s].quaternion.identity();
  }
}
