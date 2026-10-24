// A powered verlet ragdoll for the body's falls: a knockdown, a throw, the drop
// off a ledge. The skeleton's 11 bones are 15 point masses: the pelvis (both
// hip joints and a point in front), the chest (both shoulders and the neck),
// the head, and the elbows, hands, knees and ankles. Sticks keep every bone its
// length; the pelvis and the chest keep their shape, and the chest bends and
// twists on the pelvis about a joint over the hips, within its range. The
// neck, shoulders and hips are held inside a cone; the elbows and knees are
// hinges that bend one way only, as far as a real joint would.
//
// The blow that started the fall throws the points (the upper body harder, so
// the body tips over), gravity pulls them down, the floor stops them, and a
// motor pulls each toward where the clip has it: weak at the start of the
// fall, full on its landing frame, so the body tumbles and its limbs flail but
// it is always on its clip, every bone of it, when the sim says it lands.
// The bones are then turned to lie along the ragdoll's points. The ragdoll
// works in the root's frame, so the sim's own slide along the floor carries it.
import * as THREE from "three";
import type { Fighter } from "../sim/types";
import type { Body, Target } from "./body";
import { FALL_LAND } from "./motion";

const G = -9.8;
/** How strongly the motor pulls toward the clip at the start of a fall (per frame), rising to 1 on the landing frame. */
export const POWER_MIN = 0.06;
/** The speed (m/s, root frame) a knockdown starts with, for a blow from in front: back and up. */
const KICK = new THREE.Vector3(0, 1.8, -3.4);
/** Constraint passes per frame. */
const ITER = 8;

/** Switch for the tests, to compare a fall with and without the ragdoll. */
export const RAGDOLL = { on: true };

/** The points, in order. */
export const POINTS = ["hipL", "hipR", "pelvisF", "shL", "shR", "neck", "head", "elbowL", "handL", "elbowR", "handR", "kneeL", "ankleL", "kneeR", "ankleR"] as const;
const P = Object.fromEntries(POINTS.map((n, i) => [n, i])) as Record<(typeof POINTS)[number], number>;
/** The points' radii (m, at body scale 1): what keeps each off the floor. */
const RADIUS = [0.1, 0.1, 0.1, 0.09, 0.09, 0.07, 0.11, 0.05, 0.05, 0.05, 0.05, 0.06, 0.05, 0.06, 0.05];

/** Rigid sticks: the pelvis, the chest, and each bone of the head and limbs. */
const STICKS: [number, number][] = [
  [P.hipL, P.hipR], [P.hipL, P.pelvisF], [P.hipR, P.pelvisF],
  [P.shL, P.shR], [P.shL, P.neck], [P.shR, P.neck],
  [P.neck, P.head],
  [P.shL, P.elbowL], [P.elbowL, P.handL], [P.shR, P.elbowR], [P.elbowR, P.handR],
  [P.hipL, P.kneeL], [P.kneeL, P.ankleL], [P.hipR, P.kneeR], [P.kneeR, P.ankleR],
];
/** The first stick of the head and limbs (the ones before it are the pelvis's and the chest's). */
const LIMB = 6;
const CLUSTER = { pelvis: [P.hipL, P.hipR, P.pelvisF], chest: [P.shL, P.shR, P.neck] } as const;
const centre = (x: THREE.Vector3[], c: "pelvis" | "chest") => CLUSTER[c].reduce((s, i) => s.add(x[i]), new THREE.Vector3()).divideScalar(3);
/** A cluster's points in its own frame, about their centre. */
function shapeOf(x: THREE.Vector3[], c: "pelvis" | "chest"): THREE.Vector3[] {
  const o = centre(x, c);
  const inv = clusterFrame(x, c).invert();
  return CLUSTER[c].map((i) => x[i].clone().sub(o).applyQuaternion(inv));
}
/** How far (radians) the chest may turn on the pelvis, any way, from how it sits standing. */
export const SPINE_MAX = 0.9;

/** A joint held inside a cone (radians) around a direction of its parent cluster: down from the shoulders and hips, up from the neck. */
export interface Cone {
  joint: number;
  child: number;
  cluster: "pelvis" | "chest";
  /** the cone's axis in the cluster's frame (x: right, y: up, z: forward) */
  axis: [number, number, number];
  max: number;
}
export const CONES: Cone[] = [
  { joint: P.neck, child: P.head, cluster: "chest", axis: [0, 1, 0.15], max: 0.75 },
  { joint: P.shL, child: P.elbowL, cluster: "chest", axis: [0, -1, 0], max: 2.7 },
  { joint: P.shR, child: P.elbowR, cluster: "chest", axis: [0, -1, 0], max: 2.7 },
  { joint: P.hipL, child: P.kneeL, cluster: "pelvis", axis: [0, -1, 0.6], max: 1.9 },
  { joint: P.hipR, child: P.kneeR, cluster: "pelvis", axis: [0, -1, 0.6], max: 1.9 },
];

/** A hinge: the bend at `joint` about the bone's own x axis, between lo and hi (radians; the rig's sign: an elbow bends < 0, a knee > 0). */
export interface Hinge {
  upper: number;
  joint: number;
  lower: number;
  bone: "elbowL" | "elbowR" | "kneeL" | "kneeR";
  lo: number;
  hi: number;
}
export const HINGES: Hinge[] = [
  { upper: P.shL, joint: P.elbowL, lower: P.handL, bone: "elbowL", lo: -2.6, hi: 0.05 },
  { upper: P.shR, joint: P.elbowR, lower: P.handR, bone: "elbowR", lo: -2.6, hi: 0.05 },
  { upper: P.hipL, joint: P.kneeL, lower: P.ankleL, bone: "kneeL", lo: -0.05, hi: 2.6 },
  { upper: P.hipR, joint: P.kneeR, lower: P.ankleR, bone: "kneeR", lo: -0.05, hi: 2.6 },
];

export interface Rag {
  /** the points (POINTS order): where they are, and where they were a frame ago */
  x: THREE.Vector3[];
  prev: THREE.Vector3[];
  len: number[];
  /** the spine: the chest's turn on the pelvis standing, and its joint (over the hips) from each one's centre, in its own frame */
  spine: { rel: THREE.Quaternion; offP: THREE.Vector3; offC: THREE.Vector3 };
  /** the pelvis's and the chest's points in their own frame, about their centre: what keeps each rigid */
  shape: Record<"pelvis" | "chest", THREE.Vector3[]>;
  /** each hinge's axis this frame (root frame), for the tests */
  axes: THREE.Vector3[];
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

// ---------------------------------------------------------------- geometry
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const m4 = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0);
const f1 = new THREE.Vector3();
const f2 = new THREE.Vector3();
const f3 = new THREE.Vector3();

/** An object's rotation in the root's frame. */
function rootQuat(b: Body, o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  b.root.getWorldQuaternion(qb).invert();
  return out.copy(qb).multiply(o.getWorldQuaternion(qa));
}

/** Where the clip has the ragdoll's points, in the root's frame. */
export function ragPoints(b: Body): THREE.Vector3[] {
  b.root.updateMatrixWorld(true);
  const at = (o: THREE.Object3D, x = 0, y = 0, z = 0) => b.root.worldToLocal(o.localToWorld(new THREE.Vector3(x, y, z)));
  const { limbs: l, joints: j } = b;
  return [
    at(l.legL), at(l.legR), at(b.hips, 0, 0, 0.12),
    at(l.armL), at(l.armR), at(b.head), at(b.head, 0, 0.12, 0),
    at(j.elbowL), at(j.elbowL, 0, -0.3, 0), at(j.elbowR), at(j.elbowR, 0, -0.3, 0),
    at(j.kneeL), b.root.worldToLocal(b.ankles.L.getWorldPosition(new THREE.Vector3())),
    at(j.kneeR), b.root.worldToLocal(b.ankles.R.getWorldPosition(new THREE.Vector3())),
  ];
}

/** A cluster's frame (x: right, y: up, z: forward) as a rotation: the pelvis from its hips and front, the chest from its shoulders and neck. */
export function clusterFrame(x: THREE.Vector3[], c: "pelvis" | "chest", out = new THREE.Quaternion()): THREE.Quaternion {
  const [l, r, o] = c === "pelvis" ? [P.hipL, P.hipR, P.pelvisF] : [P.shL, P.shR, P.neck];
  const right = f1.subVectors(x[r], x[l]).normalize();
  const third = f2.addVectors(x[l], x[r]).multiplyScalar(0.5).subVectors(x[o], f2);
  third.addScaledVector(right, -third.dot(right)).normalize();
  // the pelvis's third point is in front of it, the chest's above it
  const up = c === "pelvis" ? f3.crossVectors(third, right) : f3.copy(third);
  const fwd = c === "pelvis" ? third : f2.crossVectors(right, up).clone();
  return out.setFromRotationMatrix(m4.makeBasis(right, up, fwd));
}

/** The signed bend of a hinge (radians) about its axis. */
export function bendOf(x: THREE.Vector3[], h: Hinge, axis: THREE.Vector3): number {
  const u = v1.subVectors(x[h.joint], x[h.upper]);
  const w = v2.subVectors(x[h.lower], x[h.joint]);
  return Math.atan2(v3.crossVectors(u, w).dot(axis), u.dot(w));
}

/** The angle (radians) between a cone's axis and its bone. */
export function coneAngle(x: THREE.Vector3[], c: Cone): number {
  const axis = v1.set(...c.axis).normalize().applyQuaternion(clusterFrame(x, c.cluster, qa));
  return axis.angleTo(v2.subVectors(x[c.child], x[c.joint]));
}

/** The chest's turn on the pelvis, and where the spine's joint is from each, for a standing body's points. */
function spineOf(x: THREE.Vector3[]): Rag["spine"] {
  const qp = clusterFrame(x, "pelvis");
  const qc = clusterFrame(x, "chest");
  const joint = x[P.hipL].clone().add(x[P.hipR]).multiplyScalar(0.5);
  return {
    rel: qp.clone().invert().multiply(qc),
    offP: joint.clone().sub(centre(x, "pelvis")).applyQuaternion(qp.clone().invert()),
    offC: joint.clone().sub(centre(x, "chest")).applyQuaternion(qc.clone().invert()),
  };
}

/** The chest's turn on the pelvis (radians) past how it sat when the fall began. */
export function spineBend(r: Rag): number {
  const q = clusterFrame(r.x, "pelvis").invert().multiply(clusterFrame(r.x, "chest")).premultiply(r.spine.rel.clone().invert());
  return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
}

/** Pull two points to a distance in [lo, hi], each moving half the way. */
function stick(x: THREE.Vector3[], a: number, c: number, lo: number, hi: number): void {
  const d = v1.subVectors(x[c], x[a]);
  const l = d.length() || 1e-6;
  const to = Math.min(hi, Math.max(lo, l));
  if (to === l) return;
  const k = ((l - to) / l) * 0.5;
  x[a].addScaledVector(d, k);
  x[c].addScaledVector(d, -k);
}

// ---------------------------------------------------------------- the ragdoll
/**
 * Step the ragdoll one render frame, after the clip's pose is on the bones,
 * and turn the bones to it. side and face say where the blow came from (side:
 * 1 on the right; face: 1 from in front). Returns the motor's strength (0: off).
 */
export function ragdoll(b: Body, f: Fighter, tp: Target, dt: number, from: Fighter["state"] | null, side: number, face: number): number {
  const win = RAGDOLL.on ? ragWindow(f, tp, from) : null;
  if (!win || dt <= 0) {
    b.rag = null;
    return 0;
  }
  const target = ragPoints(b);
  const sc = b.body.scale.x;
  const key = `${f.state}`;
  if (!b.rag || b.rag.key !== key) {
    // it starts where the body is, with the blow's push: the higher the point, the harder, so the body tips over
    const kick = f.state === "down" ? KICK.clone().set(KICK.x - 0.6 * side, KICK.y, KICK.z * face) : new THREE.Vector3();
    const top = target[P.head].y || 1;
    b.rag = {
      x: target.map((p) => p.clone()),
      prev: target.map((p) => p.clone().addScaledVector(kick, -dt * (0.5 + p.y / top))),
      len: STICKS.map(([a, c]) => target[a].distanceTo(target[c])),
      spine: spineOf(target),
      shape: { pelvis: shapeOf(target, "pelvis"), chest: shapeOf(target, "chest") },
      axes: HINGES.map(() => new THREE.Vector3()),
      key,
    };
  }
  const r = b.rag;
  const x = r.x;
  const u = Math.min(1, f.t / win.land);
  const power = f.t >= win.land ? 1 : POWER_MIN + (1 - POWER_MIN) * u * u * (3 - 2 * u) * u;

  // each hinge's axis: the clip's own, carried round by how far the ragdoll has turned its upper bone
  const fit = (c: "pelvis" | "chest") => clusterFrame(x, c, new THREE.Quaternion()).multiply(clusterFrame(target, c).invert());
  const turn = { pelvis: fit("pelvis"), chest: fit("chest") };
  HINGES.forEach((h, i) => {
    const t = turn[h.bone.startsWith("knee") ? "pelvis" : "chest"];
    const axis = r.axes[i].copy(X).applyQuaternion(rootQuat(b, b.joints[h.bone], qa)).applyQuaternion(t);
    const was = v1.subVectors(target[h.joint], target[h.upper]).applyQuaternion(t).normalize();
    const now = v2.subVectors(x[h.joint], x[h.upper]).normalize();
    axis.applyQuaternion(qa.setFromUnitVectors(was, now));
    axis.addScaledVector(now, -axis.dot(now)).normalize();
  });

  if (f.stop === 0) {
    // verlet: carry on, fall
    for (let i = 0; i < x.length; i++) {
      const vel = v1.subVectors(x[i], r.prev[i]).multiplyScalar(0.995);
      r.prev[i].copy(x[i]);
      x[i].add(vel).y += G * dt * dt;
    }
    if (power >= 1) {
      // landed: on the clip, every bone of it
      for (let i = 0; i < x.length; i++) {
        r.prev[i].copy(target[i]);
        x[i].copy(target[i]);
      }
    } else {
      // the motor pulls each point toward the clip (moving the point drags its velocity with it only in part)
      for (let i = 0; i < x.length; i++) {
        const pull = v1.subVectors(target[i], x[i]).multiplyScalar(power);
        x[i].add(pull);
        r.prev[i].addScaledVector(pull, 1 - power * 0.5);
      }
      for (let it = 0; it < ITER; it++) constrain(r, win.floor, sc);
      // last, the head and limbs' bones exactly their length, parents first, each moving only the end further out
      for (let i = LIMB; i < STICKS.length; i++) {
        const [a, c] = STICKS[i];
        x[c].sub(x[a]).setLength(r.len[i]).add(x[a]);
      }
    }
  }
  pose(b, r, target);
  return power;
}

/** One pass: the bones' lengths and the floor, the trunk's shape and its spine, then the joints' limits, each moving only the bone below it. */
function constrain(r: Rag, floor: boolean, sc: number): void {
  const x = r.x;
  STICKS.forEach(([a, c], i) => i >= LIMB && stick(x, a, c, r.len[i], r.len[i]));
  if (floor)
    for (let i = 0; i < x.length; i++) {
      const p = x[i];
      const rad = RADIUS[i] * sc;
      if (p.y < rad) {
        // the floor stops it, and drags along it: no bounce
        p.y = rad;
        r.prev[i].y = p.y;
        r.prev[i].x = p.x - (p.x - r.prev[i].x) * 0.6;
        r.prev[i].z = p.z - (p.z - r.prev[i].z) * 0.6;
      }
    }
  // the pelvis keeps its shape: laid back on its points where they have gone (the chest is laid on the spine)
  const op = centre(x, "pelvis");
  const qf = clusterFrame(x, "pelvis", qb);
  CLUSTER.pelvis.forEach((i, k) => x[i].copy(r.shape.pelvis[k]).applyQuaternion(qf).add(op));
  // the spine: the chest hangs off its joint over the pelvis, turned on it no further than SPINE_MAX
  const qp = clusterFrame(x, "pelvis", new THREE.Quaternion());
  const rel = qp.clone().invert().multiply(clusterFrame(x, "chest", qb)).premultiply(r.spine.rel.clone().invert());
  if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
  const ang = 2 * Math.acos(Math.min(1, rel.w));
  if (ang > SPINE_MAX) rel.slerp(new THREE.Quaternion(), 1 - SPINE_MAX / ang);
  const qc = qp.clone().multiply(r.spine.rel).multiply(rel);
  const joint = r.spine.offP.clone().applyQuaternion(qp).add(centre(x, "pelvis"));
  const o = r.spine.offC.clone().applyQuaternion(qc).negate().add(joint);
  // the pelvis and the chest share the pull: both shift back by half of how far the chest had to go
  const half = o.clone().sub(centre(x, "chest")).multiplyScalar(0.5);
  CLUSTER.chest.forEach((i, k) => x[i].copy(r.shape.chest[k]).applyQuaternion(qc).add(o).sub(half));
  for (const i of CLUSTER.pelvis) x[i].sub(half);
  for (const c of CONES) {
    const axis = v3.set(...c.axis).normalize().applyQuaternion(clusterFrame(x, c.cluster, qb));
    const bone = v1.subVectors(x[c.child], x[c.joint]);
    const a = axis.angleTo(bone);
    if (a <= c.max) continue;
    // swing the bone back to the cone's edge
    const n = v2.crossVectors(axis, bone);
    if (n.lengthSq() < 1e-12) continue;
    bone.applyAxisAngle(n.normalize(), c.max - a);
    x[c.child].addVectors(x[c.joint], bone);
  }
  HINGES.forEach((h, i) => {
    const axis = r.axes[i];
    const bend = bendOf(x, h, axis);
    const to = Math.min(h.hi, Math.max(h.lo, bend));
    if (to === bend) return;
    const w = v1.subVectors(x[h.lower], x[h.joint]).applyAxisAngle(axis, to - bend);
    x[h.lower].addVectors(x[h.joint], w);
  });
}

/** Turn a bone (in the root's frame) by `q`, about its own origin. */
function turnBone(b: Body, o: THREE.Object3D, q: THREE.Quaternion): void {
  const parent = rootQuat(b, o.parent!, new THREE.Quaternion());
  const self = rootQuat(b, o, new THREE.Quaternion());
  o.quaternion.copy(parent.invert().multiply(q.clone().multiply(self)));
  o.updateMatrixWorld(true);
}

/** Lay the bones along the ragdoll: the body on the pelvis, the spine on the chest, then the head and each bone of the limbs. */
function pose(b: Body, r: Rag, target: THREE.Vector3[]): void {
  const x = r.x;
  // the whole body, so its pelvis lies where the ragdoll's is
  const q = clusterFrame(x, "pelvis", new THREE.Quaternion()).multiply(clusterFrame(target, "pelvis").invert());
  const mid = (p: THREE.Vector3[]) => p[P.hipL].clone().add(p[P.hipR]).multiplyScalar(0.5);
  b.body.position.sub(mid(target)).applyQuaternion(q).add(mid(x));
  b.body.quaternion.premultiply(q);
  b.root.updateMatrixWorld(true);
  // the chest on the spine
  let now = ragPoints(b);
  turnBone(b, b.spine, clusterFrame(x, "chest", new THREE.Quaternion()).multiply(clusterFrame(now, "chest").invert()));
  // each bone along its own two points, parents first
  const along: [THREE.Object3D, number, number][] = [
    [b.head, P.neck, P.head],
    [b.limbs.armL, P.shL, P.elbowL], [b.joints.elbowL, P.elbowL, P.handL],
    [b.limbs.armR, P.shR, P.elbowR], [b.joints.elbowR, P.elbowR, P.handR],
    [b.limbs.legL, P.hipL, P.kneeL], [b.joints.kneeL, P.kneeL, P.ankleL],
    [b.limbs.legR, P.hipR, P.kneeR], [b.joints.kneeR, P.kneeR, P.ankleR],
  ];
  for (const [bone, a, c] of along) {
    now = ragPoints(b);
    const was = v1.subVectors(now[c], now[a]).normalize();
    const want = v2.subVectors(x[c], x[a]).normalize();
    turnBone(b, bone, new THREE.Quaternion().setFromUnitVectors(was, want));
  }
}
