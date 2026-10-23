// The fighters' bodies: a jointed figure (hips, spine, neck; shoulder, elbow,
// hip and knee joints; hands, feet and a tail) built from primitives, and the
// poses it takes in every simulation state.
//
// A pose is computed from the sim state as a set of joint targets; the body
// then eases toward it each render frame, so state changes blend instead of
// snapping. Strikes chamber during their startup and snap out on their active
// frames. Every limb hangs from its own pivot, so a limb that falls off simply
// hides on the body and appears as a pickup on the floor.
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
  tail: number;
}

const KEYS = ["y", "z", "rx", "ry", "rz", "spineX", "spineY", "spineZ", "headX", "headZ", "elbowL", "elbowR", "kneeL", "kneeR", "tail"] as const;
const WRAP = new Set(["ry", "rz"]);

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
    armL: [-0.55, 0, 0.2],
    armR: [-0.5, 0, -0.2],
    elbowL: -1.9,
    elbowR: -2.0,
    legL: [-0.38, 0.06],
    legR: [0.12, -0.06],
    kneeL: 0.5,
    kneeR: 0.35,
    tail: 0,
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * A limb segment turned on a lathe, hanging from y = 0 down to y = -len:
 * radius r0 at the top tapering to r1 at the bottom, a muscle that swells
 * by bulge around the fraction at of the way down, and rounded ends.
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

/** The torso, turned on a lathe: a narrow waist widening to the chest and the shoulders, closing at the neck. */
function torsoGeometry(): THREE.LatheGeometry {
  const prof: [number, number][] = [
    [0, -0.04],
    [0.1, -0.035],
    [0.15, 0.0],
    [0.155, 0.08], // the waist
    [0.165, 0.18],
    [0.19, 0.3], // the ribs
    [0.205, 0.4], // the chest
    [0.2, 0.47],
    [0.17, 0.53], // the shoulders' slope
    [0.11, 0.575],
    [0.065, 0.59],
    [0, 0.595],
  ];
  return new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    28,
  );
}
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface Body {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  limbs: Record<PartId, THREE.Object3D>; // arm / leg pivots (plus head, torso) for visibility
  joints: { elbowL: THREE.Group; elbowR: THREE.Group; kneeL: THREE.Group; kneeR: THREE.Group };
  mats: THREE.MeshStandardMaterial[];
  cur: Pose;
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

  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  body.add(hips);
  const pelvis = mesh(new THREE.SphereGeometry(0.17, 16, 10), accent);
  pelvis.scale.set(1.15, 0.7, 0.8);
  hips.add(pelvis);

  const spine = new THREE.Group();
  hips.add(spine);
  // a V-tapered trunk with pecs, the shoulder blades and a hint of abs
  const chest = mesh(torsoGeometry(), skin);
  chest.scale.set(1.3, 1, 0.78);
  spine.add(chest);
  for (const s of [-1, 1]) {
    const pec = mesh(new THREE.SphereGeometry(0.1, 16, 12), skin);
    pec.scale.set(1.1, 0.62, 0.42);
    pec.position.set(0.085 * s, 0.39, 0.095);
    pec.rotation.z = 0.25 * s;
    spine.add(pec);
    const blade = mesh(new THREE.SphereGeometry(0.09, 12, 10), skin);
    blade.scale.set(1.1, 1.2, 0.45);
    blade.position.set(0.09 * s, 0.4, -0.1);
    spine.add(blade);
  }
  const abs = mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
  abs.scale.set(0.95, 1.25, 0.6);
  abs.position.set(0, 0.17, 0.075);
  spine.add(abs);
  const belt = mesh(new THREE.TorusGeometry(0.19, 0.035, 8, 24), accent);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1.15, 0.85, 1);
  belt.position.y = 0.06;
  spine.add(belt);

  const head = new THREE.Group();
  head.position.y = 0.62;
  spine.add(head);
  const neck = mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 14), skin);
  neck.position.y = 0.0;
  head.add(neck);
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

  // a limb: pivot -> upper segment -> joint -> lower segment -> hand / foot
  const segment = (len: number, r0: number, r1: number, mat: THREE.Material, bulge = 0, at = 0.35) => mesh(limbGeometry(len, r0, r1, bulge, at), mat);
  const joint = (r: number, mat: THREE.Material) => mesh(new THREE.SphereGeometry(r, 14, 10), mat);
  const arm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
    // the deltoid caps the shoulder; the biceps swell the upper arm, the forearm tapers to the wrist
    const shoulder = mesh(new THREE.SphereGeometry(0.09, 16, 12), skin);
    shoulder.scale.set(1.05, 0.95, 1);
    pivot.add(shoulder, segment(UPPER, 0.07, 0.056, skin, 0.014, 0.45));
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER;
    elbow.add(joint(0.056, skin), segment(FORE, 0.06, 0.045, skin, 0.01, 0.25));
    // a wrapped fist: a squared-off knuckle ball with a thumb
    const fist = mesh(new THREE.SphereGeometry(0.066, 16, 12), accent);
    fist.scale.set(0.9, 0.95, 1.15);
    fist.position.y = -FORE - 0.03;
    const thumb = mesh(new THREE.CapsuleGeometry(0.018, 0.03, 4, 8), accent);
    thumb.position.set(-side * 0.045, -FORE - 0.02, 0.03);
    thumb.rotation.z = side * 0.6;
    elbow.add(fist, thumb);
    pivot.add(elbow);
    spine.add(pivot);
    return { pivot, elbow };
  };
  const leg = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.11, 0, 0);
    // the thigh tapers to the knee, the calf swells high on the shin
    pivot.add(segment(THIGH, 0.092, 0.066, accent, 0.012, 0.3));
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    knee.add(joint(0.066, accent), segment(SHIN, 0.066, 0.045, accent, 0.016, 0.28));
    // a rounded boot with a toe cap
    const foot = mesh(new THREE.SphereGeometry(0.075, 16, 12), skin);
    foot.scale.set(0.8, 0.5, 1.7);
    foot.position.set(0, -SHIN - 0.03, 0.05);
    const sole = mesh(new THREE.BoxGeometry(0.12, 0.02, 0.25), accent);
    sole.position.set(0, -SHIN - 0.065, 0.05);
    knee.add(foot, sole);
    pivot.add(knee);
    hips.add(pivot);
    return { pivot, knee };
  };
  const aL = arm(-1);
  const aR = arm(1);
  const lL = leg(-1);
  const lR = leg(1);

  // the devil's tail
  const tail = new THREE.Group();
  tail.position.set(0, 0.02, -0.13);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.18, -0.15), new THREE.Vector3(0, -0.2, -0.38), new THREE.Vector3(0, 0.02, -0.5)]);
  tail.add(mesh(new THREE.TubeGeometry(curve, 24, 0.022, 10), accent));
  const tip = mesh(new THREE.ConeGeometry(0.05, 0.1, 4), accent); // the spade stays four-sided
  tip.position.set(0, 0.07, -0.5);
  tail.add(tip);
  hips.add(tail);

  const limbs = { armL: aL.pivot, armR: aR.pivot, legL: lL.pivot, legR: lR.pivot, head, torso: spine } as Record<PartId, THREE.Object3D>;
  return {
    root,
    body,
    hips,
    spine,
    head,
    tail,
    limbs,
    joints: { elbowL: aL.elbow, elbowR: aR.elbow, kneeL: lL.knee, kneeR: lR.knee },
    mats: [skin, accent],
    cur: stance(),
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
  const guardArms = (k = 1) => {
    p.armL = [lerp(p.armL[0], -1.25, k), 0, lerp(p.armL[2], -0.45, k)];
    p.armR = [lerp(p.armR[0], -1.25, k), 0, lerp(p.armR[2], 0.45, k)];
    p.elbowL = lerp(p.elbowL, -1.7, k);
    p.elbowR = lerp(p.elbowR, -1.7, k);
  };

  switch (f.state) {
    case "idle":
      p.spineX += Math.sin(time * 2.5) * 0.025;
      p.y += Math.sin(time * 2.5) * 0.008;
      p.tail = Math.sin(time * 1.7) * 0.4;
      break;
    case "walk":
      if (nLegs === 2) {
        p.legL = [-0.15 + sw * 0.55, 0.04];
        p.legR = [-0.15 - sw * 0.55, -0.04];
        p.kneeL = 0.25 + Math.max(0, -Math.cos(time * 9)) * 0.7;
        p.kneeR = 0.25 + Math.max(0, Math.cos(time * 9)) * 0.7;
        p.y = -0.03 + Math.abs(sw) * 0.03;
      }
      p.armL[0] += sw * 0.2;
      p.armR[0] -= sw * 0.2;
      p.tail = Math.sin(time * 6) * 0.5;
      break;
    case "guard":
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

/** Ease the body toward `target` and write the joints. */
export function applyPose(b: Body, target: Pose, rate: number, snap: boolean, dt: number, jitter: number): void {
  const k = snap ? 1 : 1 - Math.exp(-rate * dt);
  const c = b.cur;
  for (const key of KEYS) {
    // spins come to rest the short way round
    if (WRAP.has(key) && !snap) c[key] = target[key] + wrapPi(c[key] - target[key]);
    c[key] = lerp(c[key], target[key], k);
  }
  for (const key of ["armL", "armR"] as const) for (let i = 0; i < 3; i++) c[key][i] = lerp(c[key][i], target[key][i], k);
  for (const key of ["legL", "legR"] as const) for (let i = 0; i < 2; i++) c[key][i] = lerp(c[key][i], target[key][i], k);

  b.body.position.set(jitter * (Math.random() - 0.5), c.y, c.z + jitter * (Math.random() - 0.5));
  b.body.rotation.set(c.rx, c.ry, c.rz, "YXZ");
  b.spine.rotation.set(c.spineX, c.spineY, c.spineZ);
  b.head.rotation.set(c.headX, 0, c.headZ);
  b.limbs.armL.rotation.set(c.armL[0], c.armL[1], c.armL[2]);
  b.limbs.armR.rotation.set(c.armR[0], c.armR[1], c.armR[2]);
  b.limbs.legL.rotation.set(c.legL[0], 0, c.legL[1]);
  b.limbs.legR.rotation.set(c.legR[0], 0, c.legR[1]);
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
  for (const p of LIMBS) b.limbs[p].visible = f.parts[p].attached;
}
