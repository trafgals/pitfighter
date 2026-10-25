// The camera and the clock answering the fight: the lurch along a blow that
// springs back, the roll and white flash of a heavy one, and the slow motion
// and closing shot of a KO.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Impact, SLOW_FINAL, SLOW_KO } from "../src/render/impact";

const run = (im: Impact, s: number) => {
  for (let t = 0; t < s; t += 1 / 60) im.update(1 / 60);
};
const right = new THREE.Vector3(1, 0, 0);

describe("impact", () => {
  it("a blow lurches the camera along its line, and it springs back", () => {
    const im = new Impact();
    im.hit(right, 6, false);
    run(im, 0.05);
    expect(im.kick.x).toBeGreaterThan(0.02);
    expect(Math.abs(im.kick.z)).toBeLessThan(1e-6);
    run(im, 1);
    expect(im.kick.length()).toBeLessThan(0.005);
  });

  it("a heavy blow lurches harder, rolls the horizon and flashes; a light one does neither", () => {
    const peak = (dmg: number, heavy: boolean) => {
      const im = new Impact();
      im.hit(right, dmg, heavy);
      let k = 0;
      let r = 0;
      const flash = im.flash;
      for (let i = 0; i < 30; i++) {
        im.update(1 / 60);
        k = Math.max(k, im.kick.length());
        r = Math.max(r, Math.abs(im.roll));
      }
      return { k, r, flash };
    };
    const light = peak(4, false);
    const heavy = peak(12, true);
    expect(heavy.k).toBeGreaterThan(light.k * 2);
    expect(light.r).toBe(0);
    expect(light.flash).toBe(0);
    expect(heavy.r).toBeGreaterThan(0.01);
    expect(heavy.r, "a tilt, not a spin").toBeLessThan(0.1);
    expect(heavy.flash).toBeGreaterThan(0.5);
  });

  it("the lurch stays small enough to keep the fight in frame, even under a flurry", () => {
    const im = new Impact();
    let k = 0;
    for (let i = 0; i < 20; i++) {
      im.hit(right, 14, true);
      for (let j = 0; j < 4; j++) {
        im.update(1 / 60);
        k = Math.max(k, im.kick.length());
      }
    }
    expect(k).toBeLessThan(1.2);
  });

  it("the white flash is gone within a few frames", () => {
    const im = new Impact();
    im.hit(right, 12, true);
    run(im, 0.25);
    expect(im.flash).toBeLessThan(0.05);
  });

  it("a KO slows time briefly, then it eases back to real time", () => {
    const im = new Impact();
    expect(im.timeScale).toBe(1);
    im.ko(new THREE.Vector3(), false);
    expect(im.timeScale).toBe(SLOW_KO.scale);
    expect(im.finale).toBeNull();
    run(im, SLOW_KO.hold + SLOW_KO.ease * 0.5);
    expect(im.timeScale).toBeGreaterThan(SLOW_KO.scale);
    expect(im.timeScale).toBeLessThan(1);
    run(im, SLOW_KO.ease);
    expect(im.timeScale).toBe(1);
  });

  it("the KO that wins the match nearly stops time, longer, and holds the camera on the body", () => {
    const im = new Impact();
    const at = new THREE.Vector3(3, 0.6, -2);
    im.ko(at, true);
    expect(im.timeScale).toBe(SLOW_FINAL.scale);
    expect(SLOW_FINAL.scale).toBeLessThan(SLOW_KO.scale);
    expect(im.finale?.toArray()).toEqual(at.toArray());
    run(im, SLOW_FINAL.hold * 0.9);
    expect(im.timeScale).toBe(SLOW_FINAL.scale);
    run(im, 3);
    expect(im.timeScale).toBe(1);
    expect(im.finale, "the closing shot stays until the next match").not.toBeNull();
  });

  it("a fighter KO'd during the final slow motion does not cut it short", () => {
    const im = new Impact();
    im.ko(new THREE.Vector3(), true);
    run(im, 0.1);
    im.ko(new THREE.Vector3(1, 0, 0), false);
    expect(im.timeScale).toBe(SLOW_FINAL.scale);
  });

  it("a new match starts in real time, the camera at rest", () => {
    const im = new Impact();
    im.hit(right, 12, true);
    im.ko(new THREE.Vector3(), true);
    run(im, 0.05);
    im.reset();
    expect(im.timeScale).toBe(1);
    expect(im.finale).toBeNull();
    expect(im.kick.length() + Math.abs(im.roll) + im.flash).toBe(0);
  });
});
