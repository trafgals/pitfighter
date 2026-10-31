// The legs (src/render/animate.ts solveLeg and footwork): the knee always hinges
// the way a knee does, a thigh never splays past a hip's range, and a foot that
// has been left behind by a spin or a slide steps back instead of dragging the
// leg across the body.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LEG, buildBody, type Body } from "../src/render/body";
import { CROSS, HEEL_STRIKE, HIP_IN_MAX, PUSH_OFF, rollOf, strideOf, HIP_OUT_MAX, STEP_AT, STEP_FAR, ankleOf, animate, legHeft, solveLeg } from "../src/render/animate";
import { World } from "../src/sim/world";
import type { Fighter } from "../src/sim/types";

const DT = 1 / 60;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

function standing(style = 0): { w: World; f: Fighter; b: Body; time: { t: number } } {
  const w = new World({ seed: 3, styles: [style, 0], humans: [true, true] });
  const f = w.fighters[0];
  const b = buildBody(f);
  Object.assign(f, { state: "idle", t: 0, stop: 0 });
  const time = { t: 0 };
  for (let i = 0; i < 90; i++) step(b, f, w, time);
  return { w, f, b, time };
}
function step(b: Body, f: Fighter, w: World, time: { t: number }): void {
  time.t += DT;
  animate(b, f, w, time.t, DT);
}

const SIDES = ["L", "R"] as const;

/** What a leg looks like in the root's frame: how far out the thigh is, how vertical the knee's hinge has gone, and how far the knee is bent. */
function legShape(b: Body, s: "L" | "R") {
  b.root.updateMatrixWorld(true);
  const leg = b.limbs[s === "L" ? "legL" : "legR"];
  const knee = b.joints[s === "L" ? "kneeL" : "kneeR"];
  const rootQ = b.root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const legQ = leg.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQ);
  const hinge = X.clone().applyQuaternion(legQ);
  const thigh = new THREE.Vector3(0, -1, 0).applyQuaternion(legQ);
  const shin = new THREE.Vector3(0, -1, 0).applyQuaternion(knee.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQ));
  const out = thigh.x * (s === "R" ? 1 : -1);
  return { hingeUp: Math.abs(hinge.y), out: Math.asin(Math.max(-1, Math.min(1, out))), bend: thigh.angleTo(shin) };
}

describe("two-bone leg IK with a pole", () => {
  /** Put a leg on `target` the way footwork does and see where the ankle goes. */
  function lay(b: Body, s: "L" | "R", target: THREE.Vector3) {
    const ik = solveLeg(b, s, target);
    const leg = b.limbs[s === "L" ? "legL" : "legR"];
    const knee = b.joints[s === "L" ? "kneeL" : "kneeR"];
    leg.quaternion
      .setFromAxisAngle(Y, -b.cur.hipY)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X, ik.x))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ik.z))
      .multiply(new THREE.Quaternion().setFromAxisAngle(Y, ik.twist));
    knee.rotation.x = ik.knee;
    b.root.updateMatrixWorld(true);
    return { ik, ankle: ankleOf(b, s) };
  }

  it("puts the ankle on any reachable target, and never folds the knee's hinge over", () => {
    const { b } = standing();
    const sc = b.body.scale.x;
    const reach = 0.9 * (LEG.thigh + LEG.shin) * sc;
    let worst = 0;
    let hinge = 0;
    let n = 0;
    for (const s of SIDES) {
      const hip = b.limbs[s === "L" ? "legL" : "legR"].getWorldPosition(new THREE.Vector3());
      for (let dx = -0.35; dx <= 0.351; dx += 0.175)
        for (let dz = -0.5; dz <= 0.501; dz += 0.25)
          for (let dy = -0.8; dy <= -0.2; dy += 0.15) {
            const off = new THREE.Vector3(dx, dy, dz);
            if (off.length() > reach) continue;
            const { ik, ankle } = lay(b, s, hip.clone().add(off));
            const err = ankle.distanceTo(hip.clone().add(off));
            if (err > 0.01) {
              // only a thigh at the end of its range may miss
              const out = ik.z * (s === "R" ? 1 : -1);
              expect(Math.min(Math.abs(out - HIP_OUT_MAX), Math.abs(out + HIP_IN_MAX)), `${s} ${off.toArray()}`).toBeLessThan(1e-6);
              continue;
            }
            worst = Math.max(worst, err);
            hinge = Math.max(hinge, legShape(b, s).hingeUp);
            n++;
          }
    }
    expect(n).toBeGreaterThan(40);
    expect(worst).toBeLessThan(0.01);
    // the hinge stays near horizontal: the old solve turned it vertical with a bent knee and a foot out to the side
    expect(hinge).toBeLessThan(0.75);
  });

  it("clamps a thigh to a hip's range", () => {
    const { b } = standing();
    const hips = b.hips.getWorldPosition(new THREE.Vector3());
    for (const s of SIDES) {
      const side = s === "R" ? 1 : -1;
      for (const dx of [-0.8, -0.4, 0.4, 0.8]) {
        const { ik } = lay(b, s, hips.clone().add(new THREE.Vector3(dx, -0.4, 0.1)));
        const out = ik.z * side;
        expect(out).toBeLessThanOrEqual(HIP_OUT_MAX + 1e-9);
        expect(out).toBeGreaterThanOrEqual(-HIP_IN_MAX - 1e-9);
      }
    }
  });

  it("the knee bends the way a knee does: the shin goes back off the thigh, whatever the foot does", () => {
    const { b } = standing();
    const hips = b.hips.getWorldPosition(new THREE.Vector3());
    for (const s of SIDES)
      for (const t of [new THREE.Vector3(0, -0.5, 0.1), new THREE.Vector3(0.1, -0.2, 0.55), new THREE.Vector3(0.2, -0.6, -0.3), new THREE.Vector3(-0.1, -0.35, 0.4)]) {
        lay(b, s, hips.clone().add(t));
        const knee = b.joints[s === "L" ? "kneeL" : "kneeR"];
        expect(knee.rotation.x).toBeGreaterThanOrEqual(0);
        expect(knee.rotation.x).toBeLessThan(Math.PI);
      }
  });
});

describe("legs through spins, slides and a limb of another length", () => {
  it("a fighter spun right round over planted feet never folds a hinge over or splays a thigh past its range", () => {
    for (const style of [0, 3, 7]) {
      const { w, f, b, time } = standing(style);
      let hinge = 0;
      let out = 0;
      // turn the body over its feet in a few frames, then slide it sideways, as a knockback does
      for (let i = 0; i < 90; i++) {
        b.root.rotation.y += i < 6 ? Math.PI / 6 : 0;
        if (i >= 20 && i < 40) b.root.position.x += 0.03;
        step(b, f, w, time);
        for (const s of SIDES) {
          const sh = legShape(b, s);
          hinge = Math.max(hinge, sh.hingeUp);
          out = Math.max(out, sh.out * (1));
        }
      }
      expect(hinge, `style ${style} hinge`).toBeLessThan(0.8);
      expect(out, `style ${style} out`).toBeLessThan(HIP_OUT_MAX + 0.05);
    }
  });

  it("a planted foot left far behind steps even while the other is in the air, and a crossed one steps back", () => {
    expect(STEP_FAR * STEP_AT).toBeGreaterThan(STEP_AT);
    expect(CROSS).toBeGreaterThan(0);
    const { w, f, b, time } = standing();
    // knock the root half a metre away in one frame: the planted feet are far behind
    b.root.position.x += 0.5;
    b.feet.L.swing = { from: b.feet.L.at.clone(), u: 0.3, dur: 0.14 };
    b.feet.L.down = false;
    for (let i = 0; i < 40; i++) step(b, f, w, time);
    for (const s of SIDES) expect(Math.abs(ankleOf(b, s).x - 0.5), `foot ${s}`).toBeLessThan(0.35);
  });

  it("a grafted limb that is longer or shorter is reached for by its own length: the foot is on the floor and the knee not locked", () => {
    for (const heft of [0.8, 1, 1.25]) {
      const { b, f, w, time } = standing();
      b.limbs.legL.scale.setScalar(heft);
      expect(legHeft(b, "L")).toBeCloseTo(heft, 6);
      for (let i = 0; i < 40; i++) step(b, f, w, time);
      const floor = b.root.position.y;
      const sole = ankleOf(b, "L").y - floor;
      expect(Math.abs(sole), `heft ${heft}`).toBeLessThan(0.12);
      expect(b.joints.kneeL.rotation.x, `heft ${heft}`).toBeGreaterThan(0.02);
    }
  });
});

describe("the foot rolls through a step", () => {
  it("lands on its heel, rolls flat, and pushes off on the ball of the foot, without a jump between swing and stance", () => {
    expect(rollOf(1)).toBeCloseTo(HEEL_STRIKE, 6);
    expect(rollOf(0)).toBeCloseTo(PUSH_OFF, 6);
    expect(rollOf(2)).toBeCloseTo(PUSH_OFF, 6);
    expect(rollOf(1.4)).toBe(0);
    let jump = 0;
    for (let u = 0.001; u < 2; u += 0.001) jump = Math.max(jump, Math.abs(rollOf(u) - rollOf(u - 0.001)));
    expect(jump).toBeLessThan(0.02);
  });

  it("a walking fighter's soles pitch toe up and toe down while the ankle stays where it was planted", () => {
    const { w, f, b, time } = standing();
    f.state = "walk";
    const speed = 1.6;
    const pitch = { min: 0, max: 0 };
    let held: THREE.Vector3 | null = null;
    let slide = 0;
    for (let i = 0; i < 150; i++) {
      b.root.position.z += speed * DT;
      step(b, f, w, time);
      pitch.min = Math.min(pitch.min, b.feet.R.roll);
      pitch.max = Math.max(pitch.max, b.feet.R.roll);
      const ft = b.feet.R;
      if (!ft.down) held = null;
      else if (!held) held = ankleOf(b, "R");
      else if (ft.w >= 1) slide = Math.max(slide, ankleOf(b, "R").distanceTo(held));
    }
    expect(pitch.min).toBeLessThan(-0.15);
    expect(pitch.max).toBeGreaterThan(0.3);
    expect(slide).toBeLessThan(0.02);
    expect(strideOf(speed)).toBeGreaterThan(0.3);
    // and standing again, the soles come back flat
    f.state = "idle";
    for (let i = 0; i < 60; i++) step(b, f, w, time);
    expect(Math.abs(b.feet.R.roll)).toBeLessThan(0.02);
  });

  it("keeps the walk cycle stepping smoothly across high-refresh sub-frames between 60 Hz sim ticks", () => {
    const { w, f, b, time } = standing();
    f.state = "walk";
    f.velY = 0.035; // 2.1 m/s in sim units
    const subDt = 1 / 120;
    let maxLiftL = 0;
    let maxLiftR = 0;
    let phaseWrapped = 0;
    let prevPhase = 0;
    for (let i = 0; i < 240; i++) {
      // Only step root position on even frames (60 Hz sim vs 120 Hz render)
      if (i % 2 === 0) b.root.position.z += f.velY;
      time.t += subDt;
      animate(b, f, w, time.t, subDt);
      expect(b.gait.on).toBe(true);
      if (b.gait.phase < prevPhase - 0.5) phaseWrapped++;
      prevPhase = b.gait.phase;
      maxLiftL = Math.max(maxLiftL, ankleOf(b, "L").y);
      maxLiftR = Math.max(maxLiftR, ankleOf(b, "R").y);
    }
    expect(phaseWrapped).toBeGreaterThanOrEqual(2);
    expect(maxLiftL).toBeGreaterThan(0.12);
    expect(maxLiftR).toBeGreaterThan(0.12);
  });
});