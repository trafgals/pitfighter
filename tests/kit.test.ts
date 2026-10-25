// Silhouettes: every style has its own size, horns, tail and gear, no two
// fighters read alike, and the gear rides on the bones (so it goes where the
// body goes).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyPose, buildBody, stance, syncLimbs } from "../src/render/body";
import { KITS, taper } from "../src/render/kit";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";

const fighterOf = (style: number) => new World({ seed: 1, styles: [style, 0], humans: [true, true] }).fighters[0];
const styleIx = (label: string) => STYLES.findIndex((s) => s.style === label);
const named = (root: THREE.Object3D, name: string) => {
  let hit: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!hit && o.name === name) hit = o;
  });
  return hit;
};
/** standing height (m), from the feet to the top of the horns or the hat */
const height = (style: number) => {
  const b = buildBody(fighterOf(style));
  applyPose(b, stance(), 1, true, 1 / 60, 0);
  b.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(b.root, true);
  return box.max.y - box.min.y;
};

describe("silhouettes", () => {
  it("every style has a kit", () => {
    for (const s of STYLES) expect(KITS[s.style], s.style).toBeDefined();
  });

  it("no two fighters share a silhouette", () => {
    const keys = STYLES.map((s) => {
      const k = KITS[s.style];
      return `${k.horns}/${k.tail}/${[...k.gear].sort().join("+")}/${Math.round(k.size * 10)}`;
    });
    expect(new Set(keys).size).toBe(STYLES.length);
  });

  it("the ironmaster stands well over the professor", () => {
    const professor = height(styleIx("Kung Fu"));
    const ironmaster = height(styleIx("Mighty"));
    const constable = height(styleIx("All-Round"));
    expect(ironmaster).toBeGreaterThan(professor * 1.35);
    expect(constable).toBeGreaterThan(professor);
    expect(constable).toBeLessThan(ironmaster);
  });

  it("each body wears its kit's horns, tail and gear", () => {
    for (const [i, s] of STYLES.entries()) {
      const b = buildBody(fighterOf(i));
      const k = KITS[s.style];
      expect(named(b.head, `horns:${k.horns}`), s.style).toBeDefined();
      expect(b.tail.name).toBe(`tail:${k.tail}`);
      expect(b.body.scale.x).toBeCloseTo(k.size);
      for (const g of k.gear) {
        const pieces = g === "gloves" || g === "pauldrons" || g === "pistons" ? [`${g.replace(/s$/, "")}L`, `${g.replace(/s$/, "")}R`] : [g];
        for (const p of pieces) expect(named(b.root, p), `${s.style} ${p}`).toBeDefined();
      }
    }
  });

  it("the hats and horns ride on the head, so every blow to it carries them", () => {
    for (const label of ["All-Round", "Mighty", "Street", "Karate", "Judo Based", "Samurai Sword", "Amateur"]) {
      const b = buildBody(fighterOf(styleIx(label)));
      const k = KITS[label];
      expect(named(b.root, k.gear[0])!.parent, label).toBe(b.head);
      expect(named(b.root, `horns:${k.horns}`)!.parent, label).toBe(b.head);
    }
  });

  it("the pistons ride on the forearms, out where the fists are", () => {
    const b = buildBody(fighterOf(styleIx("Boxing")));
    expect(named(b.root, "pistonL")!.parent).toBe(b.joints.elbowL);
    expect(named(b.root, "pistonR")!.parent).toBe(b.joints.elbowR);
  });

  it("a horn tapers from its root to a point", () => {
    const g = taper([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)], 0.1, 0.05, 8, 6);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const radiusAt = (ring: number) => Math.hypot(pos.getX(ring * 7), pos.getZ(ring * 7));
    expect(radiusAt(0)).toBeCloseTo(0.1, 3);
    expect(radiusAt(8)).toBeCloseTo(0.005, 3);
    expect(radiusAt(4)).toBeLessThan(radiusAt(0));
  });

  it("a transplanted limb wears its first owner's colours; the rest of the body keeps its own", () => {
    const f = fighterOf(0);
    const b = buildBody(f);
    f.parts.armR.style = 6;
    syncLimbs(b, f);
    const hex = (m: THREE.MeshStandardMaterial) => m.color.getHex();
    expect(hex(b.limbLook.armR.skin[0])).toBe(new THREE.Color(STYLES[6].color).getHex());
    expect(hex(b.limbLook.armR.accent[0])).toBe(new THREE.Color(STYLES[6].accent).getHex());
    expect(hex(b.limbLook.armL.skin[0])).toBe(new THREE.Color(STYLES[0].color).getHex());
  });
});
