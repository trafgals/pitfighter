// The fighters' skeleton: one bone rig with a skin bound to it, joints that
// follow their targets on springs, and hits that whip the body.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BONES, DAMPING, applyPose, buildBody, impulse, syncLimbs, targetPose, type Body } from "../src/render/body";
import { World } from "../src/sim/world";

const fighter = () => new World({ seed: 1, styles: [0, 0], humans: [true, true] }).fighters[0];

/** Where vertex i of a skinned mesh is right now, in body space. */
function skinned(b: Body, m: THREE.SkinnedMesh, i: number): THREE.Vector3 {
  b.root.updateMatrixWorld(true);
  m.skeleton.update();
  const v = new THREE.Vector3().fromBufferAttribute(m.geometry.getAttribute("position") as THREE.BufferAttribute, i);
  m.applyBoneTransform(i, v);
  return v;
}

describe("the skeleton", () => {
  it("is one rig of bones with the trunk, arms and legs skinned to it", () => {
    const b = buildBody(fighter());
    expect(b.skeleton.bones.map((x) => x.isBone)).toEqual(BONES.map(() => true));
    for (const m of Object.values(b.skins)) {
      expect(m.isSkinnedMesh).toBe(true);
      expect(m.skeleton).toBe(b.skeleton);
      // every vertex is fully bound: its four weights add up to 1
      const w = m.geometry.getAttribute("skinWeight") as THREE.BufferAttribute;
      for (let i = 0; i < w.count; i++) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
    }
  });

  it("bending the elbow bends the arm's skin smoothly, without tearing it", () => {
    const b = buildBody(fighter());
    const arm = b.skins.armR;
    const pos = arm.geometry.getAttribute("position") as THREE.BufferAttribute;
    const before = Array.from({ length: pos.count }, (_, i) => skinned(b, arm, i));
    b.joints.elbowR.rotation.x = -1.6;
    const after = Array.from({ length: pos.count }, (_, i) => skinned(b, arm, i));
    const moved = after.map((p, i) => p.distanceTo(before[i]));
    // the shoulder end stays put, the wrist end swings, and the elbow is in between
    const ys = before.map((p) => p.y);
    const top = ys.indexOf(Math.max(...ys));
    const bottom = ys.indexOf(Math.min(...ys));
    expect(moved[top]).toBeLessThan(1e-6);
    expect(moved[bottom]).toBeGreaterThan(0.25);
    const partly = moved.filter((d) => d > 0.005 && d < moved[bottom] * 0.6).length;
    expect(partly).toBeGreaterThan(18); // a whole ring or more blends between the two bones
    // neighbouring vertices up the arm stay close together: the skin stretches, it does not split
    const seg = 19; // 18 segments + the seam vertex per ring
    for (let i = 0; i + seg < pos.count - 2; i++) expect(after[i].distanceTo(after[i + seg])).toBeLessThan(0.12);
  });

  it("a limb that falls off hides its skin and its hand", () => {
    const f = fighter();
    const b = buildBody(f);
    f.parts.armL.attached = false;
    syncLimbs(b, f);
    expect(b.skins.armL.visible).toBe(false);
    expect(b.limbs.armL.visible).toBe(false);
    expect(b.skins.armR.visible).toBe(true);
  });

  it("the joints follow their targets on springs: a little overshoot, then they settle", () => {
    expect(DAMPING).toBeLessThan(1);
    const f = fighter();
    const w = new World({ seed: 1, styles: [0, 0], humans: [true, true] });
    const b = buildBody(f);
    const { p } = targetPose(f, w, 0, b.hurt);
    const target = { ...p, armL: [...p.armL] as typeof p.armL, armR: [...p.armR] as typeof p.armR, legL: [...p.legL] as typeof p.legL, legR: [...p.legR] as typeof p.legR };
    target.elbowR = b.cur.elbowR + 1;
    let peak = -Infinity;
    for (let i = 0; i < 120; i++) {
      applyPose(b, target, 22, false, 1 / 60, 0);
      peak = Math.max(peak, b.cur.elbowR);
    }
    expect(peak).toBeGreaterThan(target.elbowR + 0.005); // it swings past the target
    expect(peak).toBeLessThan(target.elbowR + 0.15); // but not far
    expect(b.cur.elbowR).toBeCloseTo(target.elbowR, 3); // and comes to rest on it
    expect(b.joints.elbowR.rotation.x).toBeCloseTo(target.elbowR, 3);
  });

  it("hitstop holds the body still, and a hit whips it the way the blow drives it", () => {
    const f = fighter();
    const w = new World({ seed: 1, styles: [0, 0], humans: [true, true] });
    const b = buildBody(f);
    const { p } = targetPose(f, w, 0, b.hurt);
    for (let i = 0; i < 120; i++) applyPose(b, p, 22, false, 1 / 60, 0);
    const head0 = b.cur.headX;
    impulse(b, "head", 1);
    applyPose(b, p, 0, false, 1 / 60, 0); // frozen in hitstop
    expect(b.cur.headX).toBe(head0);
    applyPose(b, p, 22, false, 1 / 60, 0);
    expect(b.cur.headX).toBeLessThan(head0 - 0.1); // snapped back
    for (let i = 0; i < 120; i++) applyPose(b, p, 22, false, 1 / 60, 0);
    expect(b.cur.headX).toBeCloseTo(p.headX, 3); // and recovered
  });

  it("a rear-hand punch turns the hips into it and steps in", () => {
    const w = new World({ seed: 1, styles: [0, 0], humans: [true, true] });
    const f = w.fighters[0];
    const b = buildBody(f);
    const idle = targetPose(f, w, 0, b.hurt).p;
    const m = w.eff(f, "jab2"); // the cross, the second strike of the string
    Object.assign(f, { state: "attack", move: "jab2", t: m.startup });
    const out = targetPose(f, w, 0, b.hurt).p;
    expect(out.hipY).toBeLessThan(idle.hipY - 0.3); // the right hip drives through
    expect(out.z).toBeGreaterThan(0.05); // the body steps into it
    expect(out.armR[0]).toBeLessThan(-1.2); // the arm is out
  });
});
