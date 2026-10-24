// A powered verlet ragdoll for the body's falls: a knockdown, a throw, the drop
// off a ledge. The trunk is three point masses (pelvis, chest, head) on sticks,
// thrown by the blow that started the fall, pulled down by gravity, stopped by
// the floor, and pulled toward the clip's own pose by a motor that is weak at
// the start of the fall and full on its landing frame, so the body tumbles
// freely but is always on the floor when the sim says it is. The clip is then
// moved and turned to where the ragdoll's trunk went; the limbs stay on their
// clip and springs. The ragdoll works in the root's frame, so the sim's own
// slide along the floor carries it.
import * as THREE from "three";
import type { Fighter } from "../sim/types";
import type { Body, Target } from "./body";
import { FALL_LAND } from "./motion";

const G = -9.8;
/** The points' radii (m, at body scale 1): what keeps each off the floor. */
const RADIUS = [0.12, 0.14, 0.11];
/** How strongly the motor pulls toward the clip at the start of a fall (per frame), rising to 1 on the landing frame. */
export const POWER_MIN = 0.06;
/** The speed (m/s, root frame) a knockdown starts with, for a blow from in front: back and up. */
const KICK = new THREE.Vector3(0, 1.8, -3.4);

/** Switch for the tests, to compare a fall with and without the ragdoll. */
export const RAGDOLL = { on: true };

export interface Rag {
  /** pelvis, chest, head: where they are, and where they were a frame ago */
  x: THREE.Vector3[];
  prev: THREE.Vector3[];
  len: number[];
  /** the state it started in */
  key: string;
}

/** The frames a fall is on the ragdoll, and the frame it lands: null when the body is on its clip alone. */
export function ragWindow(f: Fighter, tp: Target, from: Fighter["state"] | null): { land: number; floor: boolean } | null {
  if (f.state === "down" && from !== "thrown" && f.t <= FALL_LAND) return { land: FALL_LAND, floor: true };
  if (f.state === "thrown" && tp.T) return { land: tp.T.end, floor: true };
  if (f.state === "falling") return { land: Infinity, floor: false };
  return null;
}

const trunk = (b: Body): THREE.Vector3[] => {
  b.root.updateMatrixWorld(true);
  const w = [b.hips.getWorldPosition(new THREE.Vector3()), b.spine.localToWorld(new THREE.Vector3(0, 0.3, 0)), b.head.localToWorld(new THREE.Vector3(0, 0.12, 0))];
  return w.map((p) => b.root.worldToLocal(p));
};

/**
 * Step the ragdoll one render frame, after the clip's pose is on the bones,
 * and move the body to it. side and face say where the blow came from (side:
 * 1 on the right; face: 1 from in front). Returns the motor's strength (0: off).
 */
export function ragdoll(b: Body, f: Fighter, tp: Target, dt: number, from: Fighter["state"] | null, side: number, face: number): number {
  const win = RAGDOLL.on ? ragWindow(f, tp, from) : null;
  if (!win || dt <= 0) {
    b.rag = null;
    return 0;
  }
  const target = trunk(b);
  const sc = b.body.scale.x;
  const key = `${f.state}`;
  if (!b.rag || b.rag.key !== key) {
    // it starts where the body is, with the blow's push
    const kick = f.state === "down" ? KICK.clone().set(KICK.x - 0.6 * side, KICK.y, KICK.z * face) : new THREE.Vector3();
    b.rag = {
      x: target.map((p) => p.clone()),
      prev: target.map((p) => p.clone().addScaledVector(kick, -dt)),
      len: [target[0].distanceTo(target[1]), target[1].distanceTo(target[2])],
      key,
    };
  }
  const r = b.rag;
  const u = Math.min(1, f.t / win.land);
  const power = f.t >= win.land ? 1 : POWER_MIN + (1 - POWER_MIN) * u * u * (3 - 2 * u) * u;
  if (f.stop === 0) {
    // verlet: carry on, fall
    for (let i = 0; i < 3; i++) {
      const p = r.x[i];
      const vel = p.clone().sub(r.prev[i]).multiplyScalar(0.995);
      r.prev[i].copy(p);
      p.add(vel).add(new THREE.Vector3(0, G * dt * dt, 0));
    }
    // the trunk keeps its length
    for (let it = 0; it < 3; it++)
      for (let i = 0; i < 2; i++) {
        const a = r.x[i];
        const c = r.x[i + 1];
        const d = c.clone().sub(a);
        const l = d.length() || 1e-6;
        const k = ((l - r.len[i]) / l) * 0.5;
        a.addScaledVector(d, k);
        c.addScaledVector(d, -k);
      }
    // the floor stops it, and drags along it
    if (win.floor)
      for (let i = 0; i < 3; i++) {
        const p = r.x[i];
        const rad = RADIUS[i] * sc;
        if (p.y < rad) {
          p.y = rad;
          r.prev[i].y = p.y; // no bounce
          r.prev[i].x = p.x - (p.x - r.prev[i].x) * 0.6;
          r.prev[i].z = p.z - (p.z - r.prev[i].z) * 0.6;
        }
      }
    // the motor pulls each point toward the clip (moving the point drags its velocity with it only in part)
    for (let i = 0; i < 3; i++) {
      const pull = target[i].clone().sub(r.x[i]).multiplyScalar(power);
      r.x[i].add(pull);
      r.prev[i].addScaledVector(pull, 1 - power * 0.5);
    }
  }
  // move and turn the clip's body so its trunk lies along the ragdoll's
  const aim = target[2].clone().sub(target[0]).normalize();
  const got = r.x[2].clone().sub(r.x[0]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(aim, got);
  b.body.position.sub(target[0]).applyQuaternion(q).add(r.x[0]);
  b.body.quaternion.premultiply(q);
  b.root.updateMatrixWorld(true);
  return power;
}
