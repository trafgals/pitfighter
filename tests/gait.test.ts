// The walk, the run and the shuffle (src/render/animate.ts footwork): a foot that
// is planted stays where it was put down, whatever the family's gait, the feet
// do not cross when strafing, and a gait that stops mid-step does not snap a foot.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBody } from "../src/render/body";
import { GAITS, familyOf, FAMILIES } from "../src/render/motion";
import { animate, ankleOf } from "../src/render/animate";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";

const DT = 1 / 60;
const SIDES = ["L", "R"] as const;

function setup(style: number) {
  const w = new World({ seed: 3, styles: [style, 0], humans: [true, true] });
  const f = w.fighters[0];
  const b = buildBody(f);
  Object.assign(f, { state: "idle", t: 0, stop: 0, facing: Math.PI / 2 });
  const time = { t: 0 };
  const step = () => {
    time.t += DT;
    animate(b, f, w, time.t, DT);
  };
  for (let i = 0; i < 60; i++) step();
  return { f, b, step };
}

/** Walk the fighter along (vx, vz) m/s; the largest drift of any planted foot (fully on the IK) from where it was put down. */
/** The sim's own ramp: the velocity closes 35% of the way to the stick's each frame. */
const ramp = (cur: number, want: number) => cur + (want - cur) * 0.35;

function plantedDrift(style: number, vx: number, vz: number, running = false): { slide: number; planted: number; steps: number } {
  const { f, b, step } = setup(style);
  Object.assign(f, { state: "walk", running });
  const held: Record<"L" | "R", THREE.Vector3 | null> = { L: null, R: null };
  let slide = 0;
  let planted = 0;
  let steps = 0;
  for (let i = 0; i < 180; i++) {
    f.velX = ramp(f.velX, vx * DT);
    f.velY = ramp(f.velY, vz * DT);
    b.root.position.x += f.velX;
    b.root.position.z += f.velY;
    step();
    for (const s of SIDES) {
      const ft = b.feet[s];
      if (!ft.down) {
        if (held[s]) steps++;
        held[s] = null;
      } else if (!held[s]) held[s] = ankleOf(b, s);
      else if (ft.w >= 1) {
        planted++;
        slide = Math.max(slide, ankleOf(b, s).distanceTo(held[s]!));
      }
    }
  }
  return { slide, planted, steps };
}

describe("planted feet do not slide", () => {
  // one fighter of each family
  const styles = FAMILIES && (Object.keys(GAITS) as (keyof typeof GAITS)[]).map((fam) => STYLES.findIndex((_, i) => familyOf(i) === fam)).filter((i) => i >= 0);
  it("covers every family", () => expect(styles.length).toBe(Object.keys(GAITS).length));
  for (const [name, v, running] of [["walk", 1.5, false], ["fast walk", 3, false], ["run", 6, true]] as const)
    it(`at a ${name} (${v} m/s) a planted foot stays within 3 cm of where it was put down`, () => {
      for (const style of styles) {
        const r = plantedDrift(style, 0, v, running);
        expect(r.planted, `${familyOf(style)}`).toBeGreaterThan(60);
        expect(r.steps, `${familyOf(style)}`).toBeGreaterThan(3);
        expect(r.slide, `${familyOf(style)} at ${v} m/s`).toBeLessThan(0.03);
      }
    });
  it("strafing, a planted foot stays put too, and the shuffle is told from a walk", () => {
    const { f, b, step } = setup(styles[0]);
    Object.assign(f, { state: "walk", running: false });
    const held: Record<"L" | "R", THREE.Vector3 | null> = { L: null, R: null };
    let slide = 0;
    for (let i = 0; i < 180; i++) {
      f.velX = ramp(f.velX, 3 * DT);
      b.root.position.x += f.velX;
      step();
      for (const s of SIDES) {
        const ft = b.feet[s];
        if (!ft.down) held[s] = null;
        else if (!held[s]) held[s] = ankleOf(b, s);
        else if (ft.w >= 1 && i > 30) slide = Math.max(slide, ankleOf(b, s).distanceTo(held[s]!));
      }
    }
    expect(b.gait.strafe).toBeGreaterThan(0.9);
    expect(slide).toBeLessThan(0.03);
  });
});

describe("stopping", () => {
  it("a foot in the air when the stick is let go finishes its step, not snaps, and both soles come back flat", () => {
    const { f, b, step } = setup(0);
    Object.assign(f, { state: "walk" });
    for (let i = 0; i < 50; i++) {
      f.velY = ramp(f.velY, 3 * DT);
      b.root.position.z += f.velY;
      step();
    }
    const before = SIDES.map((s) => ankleOf(b, s));
    f.state = "idle";
    let v = 3;
    let jump = 0;
    let prev = before;
    for (let i = 0; i < 40; i++) {
      v *= 0.72;
      Object.assign(f, { velX: 0, velY: v * DT });
      b.root.position.z += v * DT;
      step();
      const now = SIDES.map((s) => ankleOf(b, s));
      jump = Math.max(jump, ...now.map((p, k) => p.distanceTo(prev[k]) - v * DT));
      prev = now;
    }
    expect(jump).toBeLessThan(0.12);
    for (let i = 0; i < 40; i++) step();
    for (const s of SIDES) expect(Math.abs(b.feet[s].roll)).toBeLessThan(0.02);
  });
});
