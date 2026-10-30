import { describe, expect, it } from "vitest";
import { CAMERA, cameraOffset, focusOf, frameShot, type Framee } from "../src/render/camera";

const at = (x: number, z: number, human = false, alive = true): Framee => ({ x, z, human, alive });

describe("the camera", () => {
  it("frames the humans and whoever is fighting them, not a brawl across the pit", () => {
    const me = at(0, 0, true);
    const foe = at(1.5, 0);
    const far = at(12, 9);
    expect(focusOf([me, foe, far])).toEqual([me, foe]);
    const shot = frameShot([me, foe, far]);
    expect(shot.spread).toBeCloseTo(0.75);
    expect(shot.dist).toBeLessThan(10);
  });

  it("keeps a human's locked-on foe in the shot, however far off", () => {
    const me: Framee = { ...at(0, 0, true), target: 2 };
    const fs = [me, at(14, 0), at(-9, 3)];
    expect(focusOf(fs)).toEqual([me, fs[2]]);
  });

  it("frames everyone standing when no human plays", () => {
    const fs = [at(-6, 0), at(6, 0), at(0, 20, false, false)];
    expect(focusOf(fs)).toHaveLength(2);
    expect(frameShot(fs).spread).toBeCloseTo(6);
  });

  it("backs off with the spread, up to its furthest", () => {
    const near = frameShot([at(0, 0, true), at(1, 0, true)]).dist;
    const wide = frameShot([at(-5, 0, true), at(5, 0, true)]).dist;
    expect(wide).toBeGreaterThan(near);
    expect(frameShot([at(-50, 0, true), at(50, 0, true)]).dist).toBe(CAMERA.far);
  });

  it("can be drawn toward the arena's middle", () => {
    expect(frameShot([at(10, 0, true)]).x).toBeCloseTo(10 * (1 - CAMERA.pull));
    expect(frameShot([at(10, 0, true)], { ...CAMERA, pull: 0.5 }).x).toBeCloseTo(5);
  });

  it("looks down at its pitch", () => {
    const o = cameraOffset(10);
    expect((Math.atan2(o.y, o.z) * 180) / Math.PI).toBeCloseTo(CAMERA.pitch);
    expect(Math.hypot(o.y, o.z)).toBeCloseTo(10);
  });
});
