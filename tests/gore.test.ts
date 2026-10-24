// Blood: drops thrown from a hit or a stump fall, and each leaves a splat on
// the floor where it lands, which soaks away after SPLAT_LIFE.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Fx, SPLAT_LIFE } from "../src/render/fx";

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

  it("splats stay on the floor most of a minute, then soak away", () => {
    const fx = new Fx();
    fx.splat(1, 2, 1);
    run(fx, SPLAT_LIFE - 8);
    expect(fx.stats.splats).toBe(1);
    run(fx, 9);
    expect(fx.stats.splats).toBe(0);
  });

  it("a long brawl's splats are pooled: the oldest go first, and a new match starts clean", () => {
    const fx = new Fx();
    for (let i = 0; i < 2000; i++) fx.splat(i * 0.01, 0, 0.2);
    run(fx, 0.1);
    expect(fx.stats.splats).toBeLessThanOrEqual(1200);
    expect(fx.stats.splats).toBeGreaterThan(1100);
    fx.clear();
    run(fx, 0.1);
    expect(fx.stats.splats).toBe(0);
  });
});
