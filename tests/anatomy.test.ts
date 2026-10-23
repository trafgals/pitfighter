// The anatomy painted on the fighters' skin: the muscles and the face land
// where they belong on the body, every style looks its own way, and painting
// eight fighters is quick.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { armRecipe, faceRecipe, jawRecipe, lookOf, torsoRecipe, type Look } from "../src/render/anatomy";
import type { Recipe, Texel } from "../src/render/textures";
import { buildBody } from "../src/render/body";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";

const sample = (r: Recipe, u: number, v: number): Texel => {
  const o: Texel = { r: 0, g: 0, b: 0, h: 0, er: 0, eg: 0, eb: 0 };
  r(((u % 1) + 1) % 1, v, o);
  return o;
};
const lum = (t: Texel) => 0.3 * t.r + 0.59 * t.g + 0.11 * t.b;
const plain: Look = { def: 1, scar: 0, paint: 0, wrinkles: false, stubble: false, veins: false };

// a straight trunk from y 0.93 to 1.58, half width 0.15
const ys = Array.from({ length: 14 }, (_, i) => 0.93 + i * 0.05);
const rxs = ys.map(() => 0.15);
const trunkAt = (x: number, y: number, back = false) => {
  const a = Math.asin(x / 0.15);
  return { u: (back ? Math.PI - a : a) / (2 * Math.PI), v: (y - 0.93) / 0.65 };
};
/** the UV of a point on a unit sphere, as three's SphereGeometry lays them out */
const sphereUv = (x: number, y: number, z: number) => {
  const n = Math.hypot(x, y, z);
  const theta = Math.acos(y / n);
  return { u: Math.atan2(z / n, -x / n) / (2 * Math.PI), v: 1 - theta / Math.PI };
};

describe("painted anatomy", () => {
  it("the six-pack: the midline and the rows are sunk, the pads stand out", () => {
    const t = torsoRecipe(ys, rxs, plain);
    const at = (x: number, y: number, back = false) => {
      const p = trunkAt(x, y, back);
      return sample(t, p.u, p.v);
    };
    const pad = at(0.045, 1.015);
    expect(at(0, 1.015).h).toBeLessThan(pad.h - 0.2); // the line down the middle
    expect(at(0.045, 1.045).h).toBeLessThan(pad.h - 0.2); // between the rows
    expect(lum(at(0, 1.015))).toBeLessThan(lum(pad) * 0.85);
    // the pecs stand out above their lower edge
    expect(at(0.1, 1.31).h).toBeGreaterThan(at(0.1, 1.24).h + 0.2);
    // and the spine runs down the back
    expect(at(0, 1.2, true).h).toBeLessThan(at(0.045, 1.05, true).h - 0.2);
  });

  it("a more cut style has deeper grooves", () => {
    const p = trunkAt(0, 1.1);
    const soft = sample(torsoRecipe(ys, rxs, { ...plain, def: 0.7 }), p.u, p.v);
    const cut = sample(torsoRecipe(ys, rxs, { ...plain, def: 1.3 }), p.u, p.v);
    expect(cut.h).toBeLessThan(soft.h);
  });

  it("the biceps swell up the front of the upper arm, the elbow creases", () => {
    const ds = Array.from({ length: 21 }, (_, i) => 0.58 - i * 0.03); // wrist to shoulder
    const rs = ds.map(() => 0.06);
    const arm = armRecipe(ds, rs, 0.3, 0.57, 1, plain);
    const v = (d: number) => (0.58 - d) / 0.6;
    expect(sample(arm, 0, v(0.17)).h).toBeGreaterThan(sample(arm, 0.25, v(0.17)).h + 0.1); // the belly vs its side
    expect(sample(arm, 0, v(0.31)).h).toBeLessThan(sample(arm, 0, v(0.42)).h - 0.1); // the crease vs the forearm
    // veins only on the styles that have them
    const veiny = armRecipe(ds, rs, 0.3, 0.57, 1, { ...plain, veins: true });
    let differs = 0;
    for (let k = 0; k < 64; k++) if (Math.abs(sample(veiny, k / 64, v(0.45)).h - sample(arm, k / 64, v(0.45)).h) > 0.05) differs++;
    expect(differs).toBeGreaterThan(0);
  });

  it("the face: sunk eye sockets under a brow ridge, a nose, symmetric unless scarred", () => {
    const f = faceRecipe(plain);
    const on = (x: number, y: number, z: number) => {
      const p = sphereUv(x, y, z);
      return sample(f, p.u, p.v);
    };
    const socket = on(0.355, 0.13, 0.87);
    const brow = on(0.3, 0.3, 0.9);
    expect(socket.h).toBeLessThan(brow.h - 0.25);
    expect(lum(socket)).toBeLessThan(lum(brow) * 0.8);
    expect(on(0, -0.1, 1).h).toBeGreaterThan(on(0.2, -0.1, 0.97).h); // the bridge of the nose
    // left and right mirror each other
    for (const [x, y] of [[0.355, 0.13], [0.5, -0.1], [0.2, 0.3]]) {
      const z = Math.sqrt(1 - x * x - y * y);
      expect(on(x, y, z).h).toBeCloseTo(on(-x, y, z).h, 1);
    }
    // a scar through the left eye breaks the symmetry, on the left only
    const scarred = faceRecipe({ ...plain, scar: 1 });
    const l = sphereUv(-0.44, 0.3, 0.846); // on the scar, which runs up and out from the eye
    const r = sphereUv(0.44, 0.3, 0.846);
    expect(sample(scarred, l.u, l.v).h).toBeGreaterThan(sample(f, l.u, l.v).h + 0.05);
    expect(sample(scarred, r.u, r.v).h).toBeCloseTo(sample(f, r.u, r.v).h, 5);
  });

  it("the mouth is a dark line in the jaw, stubble darkens the chin", () => {
    const j = jawRecipe(plain);
    const m = sphereUv(0, -0.08, 1);
    const lip = sphereUv(0, -0.21, 0.98);
    expect(lum(sample(j, m.u, m.v))).toBeLessThan(lum(sample(j, lip.u, lip.v)) * 0.8);
    const stubbly = jawRecipe({ ...plain, stubble: true });
    let dark = 0;
    for (let k = 0; k < 200; k++) {
      const p = sphereUv(-0.5 + k / 200, -0.6, 0.8);
      if (lum(sample(stubbly, p.u, p.v)) < lum(sample(j, p.u, p.v)) - 0.05) dark++;
    }
    expect(dark).toBeGreaterThan(5);
  });

  it("the styles look different from each other", () => {
    const looks = STYLES.map((st, i) => lookOf(i, st));
    expect(new Set(looks.map((l) => l.paint)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(looks.map((l) => l.scar)).size).toBeGreaterThanOrEqual(3);
    expect(looks.some((l) => l.stubble) && looks.some((l) => !l.stubble)).toBe(true);
    expect(lookOf(3, STYLES[3])).toEqual(lookOf(3, STYLES[3])); // and always the same
  });

  it("every fighter wears its style's painted skin; eight fighters paint quickly", () => {
    const t0 = performance.now();
    const w = new World({ seed: 2, styles: [0, 1, 2, 3, 4, 5, 6, 7], humans: Array(8).fill(false) });
    const bodies = w.fighters.map((f) => buildBody(f));
    expect(performance.now() - t0).toBeLessThan(6000);
    const mapOf = (m: THREE.Material | THREE.Material[]) => (m as THREE.MeshStandardMaterial).map!;
    const a = bodies[0];
    const torso = mapOf(a.skins.torso.material);
    expect(torso.image.width).toBe(256);
    expect(mapOf(a.skins.armL.material)).not.toBe(mapOf(a.skins.armR.material)); // mirrored arms
    expect(mapOf(bodies[1].skins.torso.material)).not.toBe(torso); // another style, another skin
    expect(buildBody(w.fighters[0]).skins.torso.material).not.toBe(a.skins.torso.material);
    expect(mapOf(buildBody(w.fighters[0]).skins.torso.material)).toBe(torso); // the same style shares the pixels
    // the hit flash reaches the painted skins too
    expect(a.mats).toContain(a.skins.torso.material);
    expect(a.mats).toContain(a.skins.armL.material);
  });
});
