// The fighters' bodies: a skeleton of bones (hips, spine, head; shoulders,
// elbows, hips and knees) with a skin bound to it, so the trunk, arms and legs
// are continuous meshes that bend smoothly at every joint instead of hinged
// segments. Hands, feet, the head's features and the tail ride on their bones.
//
// A pose is computed from the sim state as a set of joint targets; every joint
// then follows its target on a damped spring each render frame, so state
// changes blend, limbs overshoot a little and settle, and a hit whips the body
// with an impulse. Strikes chamber during their startup and snap out on their
// active frames, carrying their speed on into a follow-through. Every limb has
// its own bone and its own piece of skin, so a limb that falls off simply hides
// on the body and appears as a pickup on the floor.
import * as THREE from "three";
import { LIMBS, type Fighter, type PartId } from "../sim/types";
import { CHARGE, DOWN, HOP_AIR, HOP_CYCLE } from "../sim/moves";
import { STYLES } from "../sim/styles";
import { legs, type World } from "../sim/world";

export const PLAYER_COLORS = [0xff3b3b, 0x3b8bff, 0x4cff6a, 0xffd23b, 0xff6bf0, 0x3bf0ff, 0xff9a3b, 0xb07bff];

// joint layout (metres, body space; the figure faces +z)
const HIP_Y = 0.88;
const THIGH = 0.42;
const SHIN = 0.4;
const UPPER = 0.3;
const FORE = 0.27;
const SHOULDER_Y = 0.46; // above the hips
const SHOULDER_X = 0.27;

/** Joint targets. Angles in radians; limb x rotation < 0 swings the limb forward. */
export interface Pose {
  y: number; // whole body height offset
  z: number; // whole body forward offset (lying down)
  rx: number; // whole body pitch (falls)
  ry: number; // whole body yaw (spins)
  rz: number; // whole body roll
  spineX: number; // lean forward
  spineY: number; // twist
  spineZ: number;
  headX: number;
  headZ: number;
  armL: [number, number, number];
  armR: [number, number, number];
  elbowL: number; // < 0 bends the forearm forward / up
  elbowR: number;
  legL: [number, number]; // x (forward < 0), z (out)
  legR: [number, number];
  kneeL: number; // > 0 bends the shin back
  kneeR: number;
  hipY: number; // pelvis twist: the hips turn into a punch, the legs keep their feet on the floor
  tail: number;
}

const KEYS = ["y", "z", "rx", "ry", "rz", "spineX", "spineY", "spineZ", "headX", "headZ", "elbowL", "elbowR", "kneeL", "kneeR", "hipY", "tail"] as const;
const WRAP = new Set(["ry", "rz"]);
/** Number of springs in a pose: the scalars, then armL, armR (3 each), legL, legR (2 each). */
const N_DOF = KEYS.length + 10;

function stance(): Pose {
  return {
    y: -0.04,
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    spineX: 0.08,
    spineY: 0,
    spineZ: 0,
    headX: -0.05,
    headZ: 0,
    armL: [-0.8, 0, 0.18], // the lead hand, out in front
    armR: [-0.45, 0, -0.28], // the rear fist, back at the chin
    elbowL: -1.75,
    elbowR: -2.25,
    legL: [-0.38, 0.06],
    legR: [0.12, -0.06],
    kneeL: 0.5,
    kneeR: 0.35,
    hipY: 0,
    tail: 0,
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * A limb segment turned on a lathe, hanging from y = 0 down to y = -len:
 * radius r0 at the top tapering to r1 at the bottom, a muscle that swells
 * by bulge around the fraction at of the way down, and rounded ends.
 * (The limbs on the body are skinned; this is the torn-off limb on the floor.)
 */
export function limbGeometry(len: number, r0: number, r1: number, bulge = 0, at = 0.35): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const cap = 5;
  // the bottom cap, then the shaft, then the top cap: bottom to top, so the normals face out
  for (let k = 0; k <= cap; k++) {
    const a = (k / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r1 * Math.sin(a), -len - r1 * Math.cos(a) + r1 * 0.35));
  }
  const n = 14;
  for (let k = 1; k < n; k++) {
    const t = 1 - k / n; // 0 at the top
    const swell = bulge * Math.exp(-(((t - at) / 0.22) ** 2));
    pts.push(new THREE.Vector2(lerp(r0, r1, t) + swell, -t * len));
  }
  for (let k = cap; k >= 0; k--) {
    const a = (k / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r0 * Math.sin(a), r0 * Math.cos(a) * 0.6));
  }
  return new THREE.LatheGeometry(pts, 20);
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const muscle = (t: number, at: number, k: number) => k * Math.exp(-(((t - at) / 0.22) ** 2));

/** One ring of a skinned tube: an ellipse at height y, bound to up to four bones [bone, weight]. */
interface Ring {
  y: number;
  x: number;
  z: number;
  rx: number;
  rz: number;
  w: [number, number][];
}

/**
 * A skinned tube through rings stacked bottom to top, closed at both ends, in
 * the skeleton's bind pose (every bone unrotated: arms and legs hang straight down).
 */
export function skinTube(rings: Ring[], seg = 20): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const push = (x: number, y: number, z: number, u: number, v: number, w: [number, number][]) => {
    pos.push(x, y, z);
    uv.push(u, v);
    const ws = w.filter(([, k]) => k > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = ws.reduce((s, [, k]) => s + k, 0) || 1;
    for (let k = 0; k < 4; k++) {
      si.push(ws[k]?.[0] ?? 0);
      sw.push(ws[k] ? ws[k][1] / tot : 0);
    }
  };
  const row = seg + 1;
  rings.forEach((r, i) => {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      push(r.x + Math.sin(a) * r.rx, r.y, r.z + Math.cos(a) * r.rz, k / seg, i / (rings.length - 1), r.w);
    }
  });
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < seg; k++) {
      const a = i * row + k;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  // the end caps: a fan round a centre vertex
  const bottom = pos.length / 3;
  push(rings[0].x, rings[0].y, rings[0].z, 0.5, 0, rings[0].w);
  const last = rings[rings.length - 1];
  const top = pos.length / 3;
  push(last.x, last.y, last.z, 0.5, 1, last.w);
  for (let k = 0; k < seg; k++) {
    idx.push(bottom, k + 1, k);
    idx.push(top, (rings.length - 1) * row + k, (rings.length - 1) * row + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the seam: the first and last vertex of every ring are one point, so share one normal
  const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < rings.length; i++) {
    const a = i * row;
    const b = a + seg;
    const n = new THREE.Vector3(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
    nrm.setXYZ(a, n.x, n.y, n.z);
    nrm.setXYZ(b, n.x, n.y, n.z);
  }
  return g;
}

/** The bones, in skeleton order (the skinIndex of a vertex points into this). */
export const BONES = ["hips", "spine", "head", "armL", "elbowL", "armR", "elbowR", "legL", "kneeL", "legR", "kneeR"] as const;
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<(typeof BONES)[number], number>;

export interface Body {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Bone;
  spine: THREE.Bone;
  head: THREE.Bone;
  tail: THREE.Group;
  limbs: Record<PartId, THREE.Object3D>; // arm / leg bones (plus head, torso) for visibility
  joints: { elbowL: THREE.Bone; elbowR: THREE.Bone; kneeL: THREE.Bone; kneeR: THREE.Bone };
  skeleton: THREE.Skeleton;
  skins: Record<"torso" | "armL" | "armR" | "legL" | "legR", THREE.SkinnedMesh>;
  mats: THREE.MeshStandardMaterial[];
  cur: Pose;
  vel: number[]; // the joint springs' velocities, in the order of flat()
  /** the body part the last hit landed on, and how fresh that is (seconds) */
  hurt: { part: PartId; age: number };
  flash: number; // white hit flash, 0..1
}

export function buildBody(f: Fighter): Body {
  const st = STYLES[f.style];
  const skin = new THREE.MeshStandardMaterial({ color: st.color, roughness: 0.62, emissive: 0x000000 });
  const accent = new THREE.MeshStandardMaterial({ color: st.accent, roughness: 0.5, emissive: 0x000000 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffee55 });
  const big = st.torso > 1.1 ? 1.15 : st.torso < 0.9 ? 0.88 : 1;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(big);
  root.add(body);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const x = new THREE.Mesh(g, m);
    x.castShadow = true;
    return x;
  };
  const bone = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };

  // ---- the skeleton
  const hips = bone(body, 0, HIP_Y, 0);
  const spine = bone(hips, 0, 0, 0);
  const head = bone(spine, 0, 0.62, 0);
  const armL = bone(spine, -SHOULDER_X, SHOULDER_Y, 0);
  const elbowL = bone(armL, 0, -UPPER, 0);
  const armR = bone(spine, SHOULDER_X, SHOULDER_Y, 0);
  const elbowR = bone(armR, 0, -UPPER, 0);
  const legL = bone(hips, -0.11, 0, 0);
  const kneeL = bone(legL, 0, -THIGH, 0);
  const legR = bone(hips, 0.11, 0, 0);
  const kneeR = bone(legR, 0, -THIGH, 0);
  const bones = [hips, spine, head, armL, elbowL, armR, elbowR, legL, kneeL, legR, kneeR];

  // ---- the skin, in the bind pose (body space)
  const SH = HIP_Y + SHOULDER_Y; // shoulder height
  // the trunk: a narrow waist widening to the chest and the shoulders, into the neck
  const trunk: [number, number, number, number][] = [
    // [y, half width, half depth, forward]
    [0.93, 0.13, 0.095, 0],
    [0.98, 0.15, 0.105, 0],
    [1.04, 0.155, 0.11, 0.005], // the waist
    [1.12, 0.17, 0.12, 0.01],
    [1.2, 0.2, 0.13, 0.012], // the ribs
    [1.27, 0.235, 0.14, 0.015], // the chest
    [1.33, 0.25, 0.135, 0.01],
    [1.38, 0.235, 0.12, 0],
    [1.42, 0.17, 0.1, -0.005], // the shoulders' slope
    [1.455, 0.085, 0.075, 0],
    [1.48, 0.062, 0.062, 0.005], // the neck
    [1.55, 0.058, 0.058, 0.01],
    [1.58, 0.03, 0.03, 0.01],
  ];
  const torsoGeo = skinTube(
    trunk.map(([y, rx, rz, z]) => {
      const wHead = smooth(1.45, 1.53, y);
      const wHips = 1 - smooth(0.96, 1.1, y);
      return { y, x: 0, z, rx, rz, w: [[B.hips, wHips], [B.spine, Math.max(0, 1 - wHips - wHead)], [B.head, wHead]] as [number, number][] };
    }),
    28,
  );
  // an arm hanging from its shoulder: the biceps swell the upper arm, the forearm tapers to the wrist
  const armGeo = (side: number, shoulder: number, elbow: number) => {
    const rings: Ring[] = [];
    const len = UPPER + FORE;
    for (const d of [len + 0.01, len - 0.03, ...Array.from({ length: 17 }, (_, k) => (len - 0.06) * (1 - k / 16)), -0.035, -0.06]) {
      let r: number;
      if (d < 0) r = 0.075 * Math.sqrt(Math.max(0.05, 1 - (d / 0.075) ** 2));
      else if (d <= UPPER) r = lerp(0.074, 0.056, d / UPPER) + muscle(d / UPPER, 0.45, 0.013);
      else r = lerp(0.058, 0.042, (d - UPPER) / FORE) + muscle((d - UPPER) / FORE, 0.25, 0.01);
      if (d > len) r = 0.035;
      const wSpine = 1 - smooth(-0.05, 0.07, d);
      const wElbow = smooth(UPPER - 0.06, UPPER + 0.05, d);
      rings.push({ y: SH - d, x: side * SHOULDER_X, z: 0, rx: r, rz: r * 0.92, w: [[B.spine, wSpine], [shoulder, Math.max(0, 1 - wSpine - wElbow)], [elbow, wElbow]] });
    }
    return skinTube(rings, 18);
  };
  // a leg from the hip joint: the thigh tapers to the knee, the calf swells high on the shin
  const legGeo = (side: number, hip: number, knee: number) => {
    const rings: Ring[] = [];
    const len = THIGH + SHIN;
    for (const d of [len + 0.005, len - 0.03, ...Array.from({ length: 19 }, (_, k) => (len - 0.06) * (1 - k / 18)), -0.05, -0.1]) {
      let r: number;
      if (d < 0) r = 0.1;
      else if (d <= THIGH) r = lerp(0.1, 0.066, d / THIGH) + muscle(d / THIGH, 0.3, 0.012);
      else r = lerp(0.066, 0.046, (d - THIGH) / SHIN) + muscle((d - THIGH) / SHIN, 0.28, 0.017);
      if (d > len) r = 0.04;
      const wHips = 1 - smooth(-0.09, 0.05, d);
      const wKnee = smooth(THIGH - 0.06, THIGH + 0.05, d);
      rings.push({ y: HIP_Y - d, x: side * 0.11, z: 0, rx: r, rz: r, w: [[B.hips, wHips], [hip, Math.max(0, 1 - wHips - wKnee)], [knee, wKnee]] });
    }
    return skinTube(rings, 18);
  };
  const skinned = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const s = new THREE.SkinnedMesh(g, m);
    s.castShadow = true;
    s.frustumCulled = false; // the bind-pose bounds say nothing about a pose
    body.add(s);
    return s;
  };
  const skins = {
    torso: skinned(torsoGeo, skin),
    armL: skinned(armGeo(-1, B.armL, B.elbowL), skin),
    armR: skinned(armGeo(1, B.armR, B.elbowR), skin),
    legL: skinned(legGeo(-1, B.legL, B.kneeL), accent),
    legR: skinned(legGeo(1, B.legR, B.kneeR), accent),
  };
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  for (const s of Object.values(skins)) s.bind(skeleton);

  // ---- what rides on the bones
  // the shorts and the belt
  const pelvis = mesh(new THREE.SphereGeometry(0.17, 24, 16), accent);
  pelvis.scale.set(1.2, 0.8, 0.85);
  pelvis.position.y = -0.02;
  hips.add(pelvis);
  const belt = mesh(new THREE.TorusGeometry(0.19, 0.035, 10, 32), accent);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1.15, 0.85, 1);
  belt.position.y = 0.08;
  spine.add(belt);
  // pecs, shoulder blades and a hint of abs on the trunk
  for (const s of [-1, 1]) {
    const pec = mesh(new THREE.SphereGeometry(0.1, 16, 12), skin);
    pec.scale.set(1.1, 0.62, 0.42);
    pec.position.set(0.085 * s, 0.39, 0.1);
    pec.rotation.z = 0.25 * s;
    spine.add(pec);
    const blade = mesh(new THREE.SphereGeometry(0.09, 12, 10), skin);
    blade.scale.set(1.1, 1.2, 0.45);
    blade.position.set(0.09 * s, 0.4, -0.095);
    spine.add(blade);
  }
  const abs = mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
  abs.scale.set(0.95, 1.25, 0.55);
  abs.position.set(0, 0.2, 0.07);
  spine.add(abs);

  // the head
  const skull = mesh(new THREE.SphereGeometry(0.155, 28, 20), skin);
  skull.scale.set(1, 1.08, 1);
  skull.position.y = 0.15;
  head.add(skull);
  const jaw = mesh(new THREE.SphereGeometry(0.11, 20, 14), skin);
  jaw.scale.set(1, 0.6, 1.05);
  jaw.position.set(0, 0.07, 0.04);
  head.add(jaw);
  for (const s of [-1, 1]) {
    const horn = mesh(new THREE.ConeGeometry(0.04, 0.22, 14), accent);
    horn.position.set(0.1 * s, 0.3, 0);
    horn.rotation.z = -0.5 * s;
    head.add(horn);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eyeMat);
    eye.position.set(0.055 * s, 0.17, 0.135);
    head.add(eye);
    const brow = mesh(new THREE.BoxGeometry(0.07, 0.018, 0.03), accent);
    brow.position.set(0.055 * s, 0.205, 0.14);
    brow.rotation.z = 0.35 * s;
    head.add(brow);
    // pointed ears
    const ear = mesh(new THREE.ConeGeometry(0.03, 0.09, 8), skin);
    ear.scale.set(1, 1, 0.45);
    ear.position.set(0.152 * s, 0.17, -0.01);
    ear.rotation.z = -1.1 * s;
    head.add(ear);
  }

  // the deltoids cap the shoulders; the elbows and knees keep their volume when they bend
  for (const [side, sh, el] of [
    [-1, armL, elbowL],
    [1, armR, elbowR],
  ] as const) {
    const delt = mesh(new THREE.SphereGeometry(0.088, 16, 12), skin);
    delt.scale.set(1.08, 0.95, 1);
    sh.add(delt);
    el.add(mesh(new THREE.SphereGeometry(0.05, 12, 10), skin));
    // a wrapped fist: a squared-off knuckle ball with a thumb
    const fist = mesh(new THREE.SphereGeometry(0.066, 16, 12), accent);
    fist.scale.set(0.9, 0.95, 1.15);
    fist.position.y = -FORE - 0.03;
    const thumb = mesh(new THREE.CapsuleGeometry(0.018, 0.03, 4, 8), accent);
    thumb.position.set(-side * 0.045, -FORE - 0.02, 0.03);
    thumb.rotation.z = side * 0.6;
    el.add(fist, thumb);
  }
  for (const kn of [kneeL, kneeR]) {
    kn.add(mesh(new THREE.SphereGeometry(0.06, 12, 10), accent));
    // a rounded boot with a toe cap
    const foot = mesh(new THREE.SphereGeometry(0.075, 16, 12), skin);
    foot.scale.set(0.8, 0.5, 1.7);
    foot.position.set(0, -SHIN - 0.03, 0.05);
    const sole = mesh(new THREE.BoxGeometry(0.12, 0.02, 0.25), accent);
    sole.position.set(0, -SHIN - 0.065, 0.05);
    kn.add(foot, sole);
  }

  // the devil's tail
  const tail = new THREE.Group();
  tail.position.set(0, 0.02, -0.13);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.18, -0.15), new THREE.Vector3(0, -0.2, -0.38), new THREE.Vector3(0, 0.02, -0.5)]);
  tail.add(mesh(new THREE.TubeGeometry(curve, 24, 0.022, 10), accent));
  const tip = mesh(new THREE.ConeGeometry(0.05, 0.1, 4), accent); // the spade stays four-sided
  tip.position.set(0, 0.07, -0.5);
  tail.add(tip);
  hips.add(tail);

  const limbs = { armL, armR, legL, legR, head, torso: spine } as Record<PartId, THREE.Object3D>;
  return {
    root,
    body,
    hips,
    spine,
    head,
    tail,
    limbs,
    joints: { elbowL, elbowR, kneeL, kneeR },
    skeleton,
    skins,
    mats: [skin, accent],
    cur: stance(),
    vel: new Array(N_DOF).fill(0),
    hurt: { part: "torso", age: 99 },
    flash: 0,
  };
}

/** The pose a fighter should be in right now. */
export function targetPose(f: Fighter, w: World, time: number, hurt: Body["hurt"]): { p: Pose; rate: number; snap: boolean } {
  const p = stance();
  let rate = 22; // 1/s: how fast the body eases toward the target
  let snap = false;
  const t = f.t;
  const sw = Math.sin(time * 9);
  const nLegs = legs(f);
  // the street fighter's stance: bladed, lead side forward, the chest turned back
  // square to the target, bouncing on bent knees
  const blade = () => {
    p.hipY = 0.32;
    p.spineY = -0.18;
  };
  const guardArms = (k = 1) => {
    p.armL = [lerp(p.armL[0], -1.25, k), 0, lerp(p.armL[2], -0.45, k)];
    p.armR = [lerp(p.armR[0], -1.25, k), 0, lerp(p.armR[2], 0.45, k)];
    p.elbowL = lerp(p.elbowL, -1.7, k);
    p.elbowR = lerp(p.elbowR, -1.7, k);
  };

  switch (f.state) {
    case "idle": {
      blade();
      const bob = Math.abs(Math.sin(time * 4.2));
      p.y = -0.06 - bob * 0.03;
      p.kneeL = 0.5 + bob * 0.16;
      p.kneeR = 0.35 + bob * 0.16;
      p.spineX += 0.04 + Math.sin(time * 2.5) * 0.025;
      p.armL[0] += Math.sin(time * 4.2 + 0.6) * 0.06; // the lead hand paws
      p.armR[0] += Math.sin(time * 4.2) * 0.03;
      p.tail = Math.sin(time * 1.7) * 0.4;
      break;
    }
    case "walk":
      if (nLegs === 2) {
        p.legL = [-0.15 + sw * 0.55, 0.04];
        p.legR = [-0.15 - sw * 0.55, -0.04];
        p.kneeL = 0.25 + Math.max(0, -Math.cos(time * 9)) * 0.7;
        p.kneeR = 0.25 + Math.max(0, Math.cos(time * 9)) * 0.7;
        p.y = -0.03 + Math.abs(sw) * 0.03;
      }
      // guard up while stalking: only a little arm swing, the hips sway with the stride
      blade();
      p.hipY = 0.22 + sw * 0.08;
      p.rz = sw * 0.035;
      p.armL[0] += sw * 0.08;
      p.armR[0] -= sw * 0.08;
      p.tail = Math.sin(time * 6) * 0.5;
      break;
    case "guard":
      blade();
      guardArms();
      p.spineX = 0.2;
      p.headX = 0.15;
      p.y = -0.1;
      p.kneeL = 0.75;
      p.kneeR = 0.6;
      break;
    case "attack": {
      if (!f.move) break;
      rate = 34;
      if (f.move === "grab") {
        p.armL = [-1.45, 0, 0.15];
        p.armR = [-1.45, 0, -0.15];
        p.elbowL = p.elbowR = -0.35;
        p.spineX = 0.3;
        break;
      }
      const m = w.eff(f, f.move);
      const chamber = t < m.startup ? Math.min(1, t / Math.max(1, m.startup)) : 0;
      const ext = t < m.startup ? 0 : t < m.startup + m.active ? 1 : Math.max(0, 1 - (t - m.startup - m.active) / Math.max(1, m.recovery * 0.6));
      const act = t >= m.startup && t < m.startup + m.active ? (t - m.startup) / Math.max(1, m.active) : t >= m.startup + m.active ? 1 : 0;
      const charging = f.chargeHeld && f.charge > 0 ? Math.min(1, f.charge / CHARGE.max) : 0;
      const punch = (right: boolean, k: number, c: number, hook = 0) => {
        const a: [number, number, number] = [lerp(lerp(-0.5, 0.35, c), -1.55 - hook * 0.2, k), 0, (right ? -1 : 1) * lerp(0.2, 0.05 + hook * 0.9, k)];
        const e = lerp(lerp(-1.9, -2.4, c), -0.08 - hook * 0.9, k);
        if (right) {
          p.armR = a;
          p.elbowR = e;
        } else {
          p.armL = a;
          p.elbowL = e;
        }
        p.spineY = (right ? 1 : -1) * (lerp(0, 0.45, c) - (0.4 + hook * 0.4) * k);
        p.spineX = 0.1 + 0.12 * k;
        // the power comes from the floor: the hips wind back, then drive through the
        // punch, the lead foot steps in and the back knee sinks
        p.hipY = 0.32 + (right ? 1 : -1) * (0.25 * c - (0.6 + hook * 0.25) * k);
        p.z = 0.1 * k;
        p.y = -0.06 - 0.05 * k;
        p.legL = [lerp(-0.38, -0.6, k), 0.06];
        p.kneeL = lerp(0.5, 0.4, k);
        p.kneeR = lerp(0.35, 0.65, k);
      };
      switch (f.move) {
        case "jab1":
        case "jab3":
          punch(true, ext, chamber + charging * 0.5);
          break;
        case "jab2":
          punch(false, ext, chamber);
          break;
        case "punchFin":
          punch(true, ext, chamber, 1);
          p.ry = -0.35 * ext;
          p.y = -0.08 * ext;
          break;
        case "kick1":
        case "kick2": {
          const left = f.move === "kick2";
          const c = chamber + charging * 0.4;
          const lx = lerp(lerp(-0.38, -1.2, c), -1.5, ext);
          const kn = lerp(lerp(0.4, 1.9, c), 0.1, ext);
          if (left) {
            p.legL = [lx, 0.05];
            p.kneeL = kn;
            p.kneeR = 0.3;
          } else {
            p.legR = [lx, -0.05];
            p.kneeR = kn;
            p.kneeL = 0.3;
          }
          p.spineX = -0.25 * Math.max(c, ext);
          guardArms(0.6);
          // the hips open into the kick, the arm on the kicking side swings back to balance it
          p.hipY = (left ? 0.45 : -0.45) * Math.max(c, ext);
          if (left) p.armL[0] += 0.5 * ext;
          else p.armR[0] += 0.5 * ext;
          p.y = -0.04 - 0.05 * c;
          break;
        }
        case "sweep":
          p.y = -0.42 * Math.max(chamber, ext);
          p.legR = [-0.3, 1.35 * ext];
          p.kneeR = 0.1;
          p.kneeL = 1.6 * Math.max(chamber, ext);
          p.legL = [-1.0 * Math.max(chamber, ext), 0];
          p.ry = act * Math.PI * 2 * (ext > 0 ? 1 : 0);
          p.spineX = 0.35;
          break;
        case "headbutt":
          p.spineX = lerp(-0.3 * chamber, 0.6, ext);
          p.headX = 0.4 * ext;
          break;
        case "spSpin":
          // a full turn on the active frames, the leading leg out like a roundhouse
          p.ry = t < m.startup ? -0.5 * chamber : act * Math.PI * 2;
          p.legR = [-0.4, 1.4 * Math.max(ext, chamber * 0.3)];
          p.kneeR = 0.15;
          p.kneeL = 0.45;
          p.armL = [-0.3, 0, 1.2 * ext];
          p.armR = [-0.3, 0, -1.2 * ext];
          p.elbowL = p.elbowR = -0.3;
          p.y = 0.15 * ext;
          snap = ext > 0;
          break;
        case "spCharge": {
          const run = Math.sin(t * 1.1);
          p.spineX = lerp(0.2, 0.65, Math.max(chamber, ext));
          p.headX = -0.3;
          p.armR = [-0.2, 0, -0.5];
          p.armL = [-1.0, 0, 0.9];
          p.elbowL = -1.5;
          p.elbowR = -0.4;
          if (ext > 0) {
            p.legL = [-0.2 + run * 0.9, 0];
            p.legR = [-0.2 - run * 0.9, 0];
            p.kneeL = 0.4 + Math.max(0, run) * 0.9;
            p.kneeR = 0.4 + Math.max(0, -run) * 0.9;
          }
          rate = 40;
          break;
        }
        case "spFlurry": {
          const beat = Math.floor(Math.max(0, t - m.startup) / 2) % 2 === 0;
          if (ext > 0) punch(beat, 1, 0);
          else punch(true, 0, chamber);
          p.spineX = 0.2;
          rate = 50;
          break;
        }
        case "spSlam": {
          // up into the air with both fists over the head, then down into the floor
          const up = t < m.startup ? Math.sin(chamber * Math.PI * 0.85) : 0;
          p.y = up * 0.75 - 0.35 * ext;
          p.armL = [lerp(-0.5, -2.9, chamber), 0, 0.2];
          p.armR = [lerp(-0.5, -2.9, chamber), 0, -0.2];
          p.elbowL = p.elbowR = -0.4;
          if (ext > 0) {
            p.armL = [-1.0, 0, 0.1];
            p.armR = [-1.0, 0, -0.1];
            p.spineX = 0.6;
            p.kneeL = p.kneeR = 1.3;
            p.legL = [-0.9, 0.2];
            p.legR = [-0.9, -0.2];
          } else {
            p.kneeL = p.kneeR = 0.9 * up;
            p.legL = [-0.6 * up, 0.1];
            p.legR = [-0.6 * up, -0.1];
          }
          rate = 40;
          break;
        }
        case "spBlade":
          // a wide arc from the far side to the near side
          p.armR = [-1.5, 0, -0.1];
          p.elbowR = -0.1;
          p.spineY = t < m.startup ? 1.1 * chamber : lerp(1.1, -1.3, act);
          p.ry = t < m.startup ? 0.4 * chamber : lerp(0.4, -0.6, act) * (ext > 0 ? 1 : 0);
          p.y = -0.12;
          p.kneeL = 0.8;
          break;
        case "spFire":
          p.armR = [lerp(-0.6, -1.6, Math.max(ext, 0)), 0, -0.05];
          p.elbowR = lerp(-2.2 * chamber, 0, ext);
          p.armL = [-1.3, 0, -0.4];
          p.elbowL = -1.2;
          p.spineY = lerp(0.6 * chamber, -0.3, ext);
          break;
        default:
          break;
      }
      break;
    }
    case "hitstun": {
      rate = 30;
      const k = t < 6 ? 1 : Math.max(0.25, 1 - (t - 6) / 30);
      if (hurt.part === "head") {
        p.headX = -0.7 * k;
        p.spineX = -0.35 * k;
        p.headZ = 0.25 * k;
      } else if (hurt.part === "legL" || hurt.part === "legR") {
        p.y = -0.12 * k;
        if (hurt.part === "legL") p.kneeL = 1.2 * k;
        else p.kneeR = 1.2 * k;
        p.spineZ = (hurt.part === "legL" ? -0.2 : 0.2) * k;
      } else if (hurt.part === "armL" || hurt.part === "armR") {
        p.spineY = (hurt.part === "armL" ? 0.5 : -0.5) * k;
        p.spineX = -0.2 * k;
      } else {
        // doubled over
        p.spineX = 0.55 * k;
        p.headX = 0.3 * k;
        p.armL = [-0.6, 0, -0.5];
        p.armR = [-0.6, 0, 0.5];
        p.elbowL = p.elbowR = -1.4;
      }
      p.legL = [-0.1, 0.06];
      p.legR = [0.35, -0.06];
      break;
    }
    case "blockstun":
      guardArms();
      p.spineX = -0.15;
      p.y = -0.1;
      rate = 30;
      break;
    case "reversal":
      p.armL = [-1.35, 0, -0.65];
      p.armR = [-1.35, 0, 0.65];
      p.elbowL = p.elbowR = -0.6;
      p.spineX = 0.05;
      if (f.revHeight === "low") {
        p.y = -0.25;
        p.kneeL = p.kneeR = 1.0;
        p.legL = [-0.7, 0.1];
        p.legR = [-0.2, -0.1];
      }
      rate = 40;
      break;
    case "reversed":
      p.spineX = -0.5;
      p.headX = -0.4;
      p.armL = [-0.6, 0, 1.3];
      p.armR = [-0.6, 0, -1.3];
      p.elbowL = p.elbowR = -0.3;
      p.legL = [0.3, 0.1];
      p.legR = [-0.3, -0.1];
      rate = 30;
      break;
    case "holding":
      p.armL = [-1.3, 0, 0.1];
      p.armR = [-1.3, 0, -0.1];
      p.elbowL = p.elbowR = -0.7;
      p.spineX = 0.25;
      if (f.holdCool > 10) {
        p.legR = [-1.3, 0];
        p.kneeR = 1.6;
      }
      break;
    case "held":
      p.spineX = 0.5;
      p.headX = 0.3;
      p.y = 0.05;
      p.armL = [-0.2, 0, 0.2];
      p.armR = [-0.2, 0, -0.2];
      p.elbowL = p.elbowR = -0.3;
      break;
    case "thrown":
      p.rx = -Math.PI / 2 + Math.sin(t * 0.5) * 0.3;
      p.rz = t * 0.5;
      p.y = 0.8 + Math.sin((t / 24) * Math.PI) * 1.2;
      p.armL = [-2.5, 0, 0.6];
      p.armR = [-2.5, 0, -0.6];
      p.kneeL = p.kneeR = 0.6;
      snap = true;
      break;
    case "down":
    case "ko":
      p.rx = -Math.PI / 2;
      p.y = 0.18; // the body pivots on its feet, so this lifts it onto the floor
      p.z = -0.3;
      p.spineX = 0;
      p.headX = 0.2;
      p.armL = [-0.3, 0, 1.0];
      p.armR = [-0.3, 0, -1.0];
      p.elbowL = p.elbowR = -0.4;
      p.legL = [0, 0.15];
      p.legR = [0, -0.15];
      p.kneeL = 0.15;
      p.kneeR = 0.4;
      rate = 14;
      break;
    case "wakeup": {
      const k = 1 - t / DOWN.wake;
      p.rx = (-Math.PI / 2) * k;
      p.y = 0.18 * k - 0.25 * Math.sin(k * Math.PI);
      p.kneeL = p.kneeR = 1.2 * Math.sin(k * Math.PI) + 0.3;
      p.legL = [-0.9 * Math.sin(k * Math.PI), 0.1];
      p.legR = [-0.5 * Math.sin(k * Math.PI), -0.1];
      break;
    }
    case "dizzy":
      p.headZ = Math.sin(time * 6) * 0.35;
      p.rz = Math.sin(time * 3) * 0.1;
      p.spineX = 0.25;
      p.armL = [-0.15, 0, 0.25];
      p.armR = [-0.15, 0, -0.25];
      p.elbowL = p.elbowR = -0.2;
      break;
    case "reattach":
      p.y = -0.35;
      p.kneeL = p.kneeR = 1.4;
      p.legL = [-1.0, 0.15];
      p.legR = [-0.6, -0.15];
      p.spineX = 0.6;
      p.armL = [-1.1, 0, 0.1];
      p.armR = [-1.1, 0, -0.1];
      p.elbowL = p.elbowR = -0.3;
      break;
    case "sitting":
    case "seated":
      p.y = -0.36;
      p.legL = [-1.5, 0.12];
      p.legR = [-1.5, -0.12];
      p.kneeL = p.kneeR = 1.5;
      p.spineX = -0.05;
      if (f.state === "seated") {
        p.armL = [-0.75, 0, -0.1];
        p.armR = [-0.75, 0, 0.1];
        p.elbowL = p.elbowR = -0.7;
        p.headX = -0.2 + Math.sin(time * 2) * 0.05;
        p.tail = Math.sin(time * 3) * 0.6;
      }
      break;
    case "driving":
      // in the cab: seated, both hands on the wheel, rocking with the engine
      p.y = -0.36 + Math.sin(time * 23) * 0.006;
      p.legL = [-1.45, 0.12];
      p.legR = [-1.45, -0.12];
      p.kneeL = p.kneeR = 1.45;
      p.spineX = 0.12;
      p.armL = [-1.05, 0, -0.3];
      p.armR = [-1.05, 0, 0.3];
      p.elbowL = p.elbowR = -0.65;
      p.headX = -0.1;
      break;
    case "falling":
      // over the edge: flailing as the body tumbles away (the scene drops the root)
      p.rx = -0.5 - t * 0.04;
      p.rz = Math.sin(t * 0.3) * 0.4;
      p.armL = [-2.6 + Math.sin(t * 0.9) * 0.6, 0, 0.9];
      p.armR = [-2.6 + Math.cos(t * 0.9) * 0.6, 0, -0.9];
      p.elbowL = p.elbowR = -0.5;
      p.legL = [-0.6 + Math.sin(t * 0.8) * 0.5, 0.2];
      p.legR = [-0.6 - Math.sin(t * 0.8) * 0.5, -0.2];
      p.kneeL = p.kneeR = 0.7;
      p.headX = -0.4;
      rate = 10;
      break;
    default:
      break;
  }

  // one leg: hop; no legs: drag the torso along the floor
  if (nLegs === 1 && (f.state === "walk" || f.state === "idle" || f.state === "guard")) {
    const ph = f.hopPhase % HOP_CYCLE;
    p.y += ph < HOP_AIR ? Math.sin((ph / HOP_AIR) * Math.PI) * 0.22 : 0;
    p.legL = [-0.15, 0];
    p.legR = [-0.15, 0];
    p.kneeL = p.kneeR = 0.4;
  }
  if (nLegs === 0 && !["down", "ko", "thrown", "held", "wakeup", "driving", "falling"].includes(f.state)) {
    p.y += -0.78;
    p.spineX += 0.6;
  }
  return { p, rate, snap };
}

/** A pose as one list of numbers: the scalars in KEYS order, then armL, armR, legL, legR. */
function flat(p: Pose): number[] {
  return [...KEYS.map((k) => p[k]), ...p.armL, ...p.armR, ...p.legL, ...p.legR];
}
function unflat(a: number[], p: Pose): void {
  KEYS.forEach((k, i) => (p[k] = a[i]));
  const n = KEYS.length;
  p.armL = [a[n], a[n + 1], a[n + 2]];
  p.armR = [a[n + 3], a[n + 4], a[n + 5]];
  p.legL = [a[n + 6], a[n + 7]];
  p.legR = [a[n + 8], a[n + 9]];
}
const WRAP_I = KEYS.flatMap((k, i) => (WRAP.has(k) ? [i] : []));
/** How springy the joints are: under 1 overshoots a little and settles. */
export const DAMPING = 0.72;

/**
 * Drive the joints toward `target` on damped springs and write the bones.
 * rate (1/s) is the springs' stiffness; 0 holds the body still (hitstop) with
 * its velocity kept for when it lets go. snap jumps to the target, and the
 * speed of that jump carries on as a follow-through.
 */
export function applyPose(b: Body, target: Pose, rate: number, snap: boolean, dt: number, jitter: number): void {
  const x = flat(b.cur);
  const t = flat(target);
  const v = b.vel;
  // spins come to rest the short way round
  if (!snap) for (const i of WRAP_I) x[i] = t[i] + wrapPi(x[i] - t[i]);
  if (snap) {
    const h = Math.max(dt, 1 / 60);
    for (let i = 0; i < x.length; i++) {
      v[i] = ((t[i] - x[i]) / h) * 0.12;
      x[i] = t[i];
    }
  } else if (rate > 0 && dt > 0) {
    const n = Math.ceil(dt * 120); // stable substeps
    const h = dt / n;
    const w2 = rate * rate;
    const c2 = 2 * DAMPING * rate;
    for (let s = 0; s < n; s++)
      for (let i = 0; i < x.length; i++) {
        v[i] += (w2 * (t[i] - x[i]) - c2 * v[i]) * h;
        x[i] += v[i] * h;
      }
  }
  unflat(x, b.cur);
  const c = b.cur;

  b.body.position.set(jitter * (Math.random() - 0.5), c.y, c.z + jitter * (Math.random() - 0.5));
  b.body.rotation.set(c.rx, c.ry, c.rz, "YXZ");
  b.hips.rotation.set(0, c.hipY, 0);
  // the chest turns with the hips and on top of them (spineY), the head stays on the target
  b.spine.rotation.set(c.spineX, c.spineY, c.spineZ);
  b.head.rotation.set(c.headX, -(c.hipY + c.spineY) * 0.5, c.headZ);
  b.limbs.armL.rotation.set(c.armL[0], c.armL[1], c.armL[2]);
  b.limbs.armR.rotation.set(c.armR[0], c.armR[1], c.armR[2]);
  // the legs turn back against the hips' twist so the feet stay planted
  b.limbs.legL.rotation.set(c.legL[0], -c.hipY, c.legL[1], "YXZ");
  b.limbs.legR.rotation.set(c.legR[0], -c.hipY, c.legR[1], "YXZ");
  b.joints.elbowL.rotation.x = c.elbowL;
  b.joints.elbowR.rotation.x = c.elbowR;
  b.joints.kneeL.rotation.x = c.kneeL;
  b.joints.kneeR.rotation.x = c.kneeR;
  b.tail.rotation.y = c.tail;
  for (const m of b.mats) {
    m.emissive.setScalar(b.flash);
  }
}

/** Show the limbs the fighter still has. */
export function syncLimbs(b: Body, f: Fighter): void {
  for (const p of LIMBS) {
    const on = f.parts[p].attached;
    b.limbs[p].visible = on; // the hand or foot riding on the bone
    b.skins[p as keyof Body["skins"]].visible = on; // and the limb's skin
  }
}

/**
 * A hit lands: whip the joint springs the way the blow drives the body.
 * k is how hard (about 0.5 for a light hit, 1 for a heavy one).
 */
export function impulse(b: Body, part: PartId, k: number): void {
  const i = (key: (typeof KEYS)[number]) => KEYS.indexOf(key);
  const v = b.vel;
  if (part === "head") {
    v[i("headX")] -= 14 * k; // the head snaps back
    v[i("spineX")] -= 5 * k;
  } else if (part === "armL" || part === "armR") {
    v[i("spineY")] += (part === "armL" ? 9 : -9) * k; // spun round by the shoulder
    v[i("spineX")] -= 3 * k;
  } else if (part === "legL" || part === "legR") {
    v[i(part === "legL" ? "kneeL" : "kneeR")] += 14 * k; // the leg buckles
    v[i("spineZ")] += (part === "legL" ? -5 : 5) * k;
  } else {
    v[i("spineX")] += 10 * k; // folded over the blow
    v[i("headX")] += 6 * k;
  }
  v[i("y")] -= 0.8 * k; // and the knees give
}
