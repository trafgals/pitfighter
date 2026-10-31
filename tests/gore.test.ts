// Blood: drops thrown from a hit or a stump fall, and each leaves a splat on
// the floor where it lands, which stays all match (the oldest are baked into the floor).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BLOOD_SPLATS, Fx, SPLAT_LIFE } from "../src/render/fx";

const cam = new THREE.PerspectiveCamera();
const run = (fx: Fx, s: number) => {
  for (let t = 0; t < s; t += 1 / 60) fx.update(1 / 60, cam);
};

describe("blood", () => {
  it("every drop thrown lands and splats on the floor", () => {
    const fx = new Fx();
    fx.bleed(new THREE.Vector3(0, 1.3, 0), new THREE.Vector3(1, 0.7, 0), { count: 25, speed: 3, spread: 1.4 });
    expect(fx.stats.drops).toBe(25);
    run(fx, 0.05);
    expect(fx.stats.splats, "still in the air").toBe(0);
    run(fx, 2);
    expect(fx.stats.splats).toBe(25);
    expect(fx.stats.live, "no drop left flying").toBe(0);
  });

  it("blood never soaks away: it is still on the floor long after a scorch mark has gone", () => {
    const fx = new Fx();
    fx.splat(1, 2, 1);
    fx.scorch(1, 2, 1);
    run(fx, SPLAT_LIFE + 20);
    expect(fx.stats.splats).toBe(1);
    expect(fx.stats.scorches).toBe(0);
  });

  it("a long brawl's blood is pooled and then baked into the floor: nothing is lost", () => {
    const fx = new Fx();
    const n = BLOOD_SPLATS + 2000;
    for (let i = 0; i < n; i++) fx.splat((i % 100) * 0.1, 0, 0.2);
    run(fx, 0.1);
    expect(fx.stats.splats).toBe(BLOOD_SPLATS);
    expect(fx.stats.baked).toBe(2000);
    expect(fx.stats.splats + fx.stats.baked).toBe(n);
    // a new match starts clean
    fx.clear();
    run(fx, 0.1);
    expect(fx.stats.splats).toBe(0);
    expect(fx.stats.baked).toBe(0);
  });
});
