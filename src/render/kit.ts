// What makes each fighter read as itself from across the pit, before any
// colour: its size, the shape of its horns, its tail, and a piece or two of
// gear (a hat, a beard, gloves, spikes). All of it rides on the bones, so the
// skeleton, the animation and the sim never see it. One kit per fighting style.
//
// The kits themselves are part of the character design and live in
// src/data/characters.json; this module draws them.
import * as THREE from "three";
import type { Gear, Horns, Tail } from "../data/types";

export type { Gear, Horns, Kit, Tail } from "../data/types";
export { KITS } from "../data/characters";

/** A horn, tail or spine along `pts`: a tube that tapers from `r` at the root to a point (or to `end` of r, blunt). */
export function taper(pts: THREE.Vector3[], r: number, end = 0.06, seg = 16, radial = 10): THREE.BufferGeometry {
  const path = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(path, seg, r, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    path.getPointAt(i / seg, c);
    const k = 1 - (1 - end) * (i / seg);
    for (let j = 0; j <= radial; j++) {
      const n = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, n).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(n, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** One horn's path on side s (head space, the skull's crown at y 0.3), and how thick it is at the root. */
function hornPath(h: Horns, s: number, k: number): { pts: THREE.Vector3[]; r: number; end?: number } {
  switch (h) {
    case "goat":
      return { pts: [V(0.09 * s, 0.27, 0.02), V(0.12 * s, 0.4, -0.05), V(0.15 * s, 0.47, -0.17)], r: 0.042 };
    case "bull":
      return { pts: [V(0.12 * s, 0.25, 0), V(0.26 * s, 0.29, 0.02), V(0.34 * s, 0.41, 0.08)], r: 0.05 };
    case "ram":
      return { pts: [V(0.1 * s, 0.27, -0.01), V(0.2 * s, 0.35, -0.09), V(0.27 * s, 0.27, -0.15), V(0.26 * s, 0.15, -0.08), V(0.21 * s, 0.13, 0.03)], r: 0.05 };
    case "long":
      return { pts: [V(0.08 * s, 0.27, 0), V(0.13 * s, 0.45, -0.04), V(0.17 * s, 0.62, -0.1)], r: 0.035 };
    case "swept":
      return { pts: [V(0.09 * s, 0.27, 0.02), V(0.14 * s, 0.35, -0.12), V(0.16 * s, 0.37, -0.33)], r: 0.04 };
    case "nubs":
      return { pts: [V(0.09 * s, 0.27, 0.02), V(0.1 * s, 0.33, 0.01)], r: 0.03, end: 0.35 };
    case "broken":
      // the left one snapped off in some alley
      return s < 0
        ? { pts: [V(0.09 * s, 0.27, 0.02), V(0.11 * s, 0.35, -0.02)], r: 0.042, end: 0.75 }
        : { pts: [V(0.09 * s, 0.27, 0.02), V(0.12 * s, 0.4, -0.05), V(0.15 * s, 0.47, -0.17)], r: 0.042 };
    case "crown":
    case "spikes":
    default:
      return { pts: [V(0.1 * s * k, 0.27, 0), V(0.16 * s * k, 0.44, 0)], r: 0.04 };
  }
}

/** The horns on the head bone. */
export function buildHorns(h: Horns, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = `horns:${h}`;
  const add = (geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
  };
  if (h === "crown") {
    // a ring of short spikes round the crown of the skull
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const x = Math.sin(a);
      const z = Math.cos(a);
      add(taper([V(0.12 * x, 0.26, 0.12 * z), V(0.19 * x, 0.4, 0.19 * z)], 0.032));
    }
    return g;
  }
  for (const s of [-1, 1]) {
    const p = hornPath(h, s, 1);
    add(taper(p.pts, p.r, p.end));
  }
  return g;
}

/** The tail on the hips: its curve, and the spade or barb at the end. */
export function buildTail(t: Tail, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = `tail:${t}`;
  g.position.set(0, 0.02, -0.13);
  const pts =
    t === "stub"
      ? [V(0, 0, 0), V(0, -0.07, -0.08), V(0, -0.05, -0.17)]
      : t === "long"
        ? [V(0, 0, 0), V(0, -0.22, -0.18), V(0, -0.3, -0.45), V(0, -0.12, -0.7), V(0, 0.08, -0.78)]
        : [V(0, 0, 0), V(0, -0.18, -0.15), V(0, -0.2, -0.38), V(0, 0.02, -0.5)];
  const r = t === "stub" ? 0.035 : 0.024;
  const m = new THREE.Mesh(taper(pts, r, t === "stub" ? 0.3 : 0.55, 24, 10), mat);
  m.castShadow = true;
  g.add(m);
  const end = pts[pts.length - 1];
  if (t === "spade" || t === "long") {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(t === "long" ? 0.04 : 0.05, 0.1, 4), mat); // the spade stays four-sided
    tip.position.set(end.x, end.y + 0.05, end.z);
    g.add(tip);
  } else if (t === "barbed") {
    // three barbs, raked back
    for (const [x, y] of [
      [0, 1],
      [-0.7, 0.4],
      [0.7, 0.4],
    ]) {
      const b = new THREE.Mesh(taper([end.clone(), V(end.x + x * 0.07, end.y + y * 0.08, end.z - 0.05)], 0.018), mat);
      g.add(b);
    }
  }
  return g;
}

/** Where each piece of gear goes: the bones it can ride on. */
export interface GearBones {
  head: THREE.Object3D;
  spine: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  /** the forearms: what a glove rides on, at `fore` below the elbow */
  elbowL: THREE.Object3D;
  elbowR: THREE.Object3D;
  fore: number;
}

/** Put the kit's gear on the bones; it returns what it added (named, for the tests). */
export function buildGear(gear: Gear[], b: GearBones, mats: { accent: THREE.Material; accentColour: number }): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const std = (color: number, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const put = (parent: THREE.Object3D, name: string, ...parts: THREE.Object3D[]) => {
    const g = new THREE.Group();
    g.name = name;
    for (const p of parts) {
      p.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      g.add(p);
    }
    parent.add(g);
    out.push(g);
    return g;
  };
  const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T => {
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    return o;
  };
  const dark = std(0x141010, 0.85);
  // a contrasting trim: black on light fighters, bone on dark ones
  const trimColour = new THREE.Color(mats.accentColour).getHSL({ h: 0, s: 0, l: 0 }).l > 0.45 ? 0x1a1010 : 0xe8dcc0;
  const trim = std(trimColour, 0.6);
  for (const k of gear) {
    switch (k) {
      case "mohawk": {
        const fins = [];
        for (let i = 0; i < 6; i++) {
          const a = -0.5 + i * 0.26;
          fins.push(at(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14 - Math.abs(a) * 0.05, 4), mats.accent), 0, 0.15 + Math.cos(a) * 0.17, Math.sin(a) * 0.17, a));
        }
        put(b.head, "mohawk", ...fins);
        break;
      }
      case "topknot": {
        const knot = at(new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), dark), 0, 0.31, -0.06);
        const tail = at(new THREE.Mesh(taper([V(0, 0.3, -0.09), V(0, 0.22, -0.22), V(0, 0.05, -0.27)], 0.03, 0.3), dark), 0, 0, 0);
        put(b.head, "topknot", knot, tail);
        break;
      }
      case "beard": {
        const beard = at(new THREE.Mesh(taper([V(0, 0.06, 0.1), V(0, -0.06, 0.13), V(0, -0.2, 0.1)], 0.07, 0.15), std(0xe8e4dc, 0.95)), 0, 0, 0);
        const brows = [-1, 1].map((s) => at(new THREE.Mesh(taper([V(0.05 * s, 0.215, 0.145), V(0.13 * s, 0.24, 0.13)], 0.016, 0.3), std(0xe8e4dc, 0.95)), 0, 0, 0));
        put(b.head, "beard", beard, ...brows);
        break;
      }
      case "headband": {
        const band = at(new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.018, 8, 28), trim), 0, 0.22, 0, Math.PI / 2 - 0.12);
        const tails = [-1, 1].map((s) => at(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.008), trim), 0.03 * s, 0.14, -0.17, 0.5, 0, 0.25 * s));
        put(b.head, "headband", band, ...tails);
        break;
      }
      case "gloves":
        for (const [el, s] of [
          [b.elbowL, -1],
          [b.elbowR, 1],
        ] as const) {
          const glove = at(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), std(0xb01010, 0.35)), 0, -b.fore - 0.04, 0.01);
          glove.scale.set(0.95, 1.05, 1.15);
          const cuff = at(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 14), std(0xf0f0f0, 0.5)), 0, -b.fore + 0.06, 0);
          put(el, `glove${s < 0 ? "L" : "R"}`, glove, cuff);
        }
        break;
      case "pauldrons":
        for (const [arm, s] of [
          [b.armL, -1],
          [b.armR, 1],
        ] as const) {
          const plate = at(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0x3a3430, 0.4, 0.6)), 0, 0.02, 0, 0, 0, -0.35 * s);
          plate.scale.set(1.15, 0.75, 1.05);
          const spike = at(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.13, 8), std(0xd8d0c0, 0.4)), 0.04 * s, 0.12, 0, 0, 0, -0.5 * s);
          put(arm, `pauldron${s < 0 ? "L" : "R"}`, plate, spike);
        }
        break;
      case "spines": {
        const sp = [];
        for (let i = 0; i < 5; i++) {
          const y = 0.12 + i * 0.1;
          sp.push(at(new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.11 + 0.02 * Math.sin(i), 6), mats.accent), 0, y, -0.15 + i * 0.006, -1.0));
        }
        put(b.spine, "spines", ...sp);
        break;
      }
      case "wings":
        put(
          b.spine,
          "wings",
          ...[-1, 1].map((s) => {
            // a small leathery bat wing: a fan of three fingers with the skin stretched over it
            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.lineTo(0.32, 0.22);
            shape.lineTo(0.28, 0.04);
            shape.lineTo(0.22, -0.02);
            shape.lineTo(0.15, -0.08);
            shape.lineTo(0.08, -0.06);
            shape.closePath();
            const w = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: mats.accentColour, roughness: 0.8, side: THREE.DoubleSide }));
            w.scale.x = s;
            return at(w, 0.06 * s, 0.42, -0.13, 0, -0.5 * s, 0);
          }),
        );
        break;
      case "beret": {
        const cap = at(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.05, 20), std(0x2a3418, 0.9)), 0.03, 0.29, 0, 0, 0, -0.18);
        const badge = at(new THREE.Mesh(new THREE.CircleGeometry(0.02, 10), std(0xd8b030, 0.3, 0.8)), -0.09, 0.27, 0.13, 0, -0.5, 0);
        put(b.head, "beret", cap, badge);
        break;
      }
      case "kasa": {
        // a wide straw hat, the horns through it
        const hat = at(new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.14, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xb09050, roughness: 0.95, side: THREE.DoubleSide })), 0, 0.36, 0);
        put(b.head, "kasa", hat);
        break;
      }
      case "stetson": {
        const felt = std(0x2a1a10, 0.85);
        const brim = at(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.015, 24), felt), 0, 0.29, 0);
        brim.scale.set(1, 1, 0.85);
        const crown = at(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.13, 18), felt), 0, 0.36, 0);
        const band = at(new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.025, 18), std(0xff6000, 0.5)), 0, 0.31, 0);
        put(b.head, "stetson", brim, crown, band);
        break;
      }
      case "lanyard": {
        const cord = at(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 6, 24, Math.PI), std(0x3a6aa0, 0.6)), 0, 0.5, 0.07, 0.5, 0, Math.PI);
        const card = at(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.005), std(0xf4f4f0, 0.4)), 0, 0.31, 0.15, -0.1);
        put(b.spine, "lanyard", cord, card);
        break;
      }
      case "obi": {
        const knot = at(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.04), dark), 0.05, 0.08, 0.19);
        const ends = [-1, 1].map((s) => at(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.17, 0.01), dark), 0.05 + 0.03 * s, -0.01, 0.2, 0, 0, 0.15 * s));
        put(b.spine, "obi", knot, ...ends);
        break;
      }
      case "tusks":
        put(
          b.head,
          "tusks",
          ...[-1, 1].map((s) => at(new THREE.Mesh(taper([V(0.05 * s, 0.05, 0.11), V(0.08 * s, 0.13, 0.15)], 0.016), std(0xe8dcc0, 0.5)), 0, 0, 0)),
        );
        break;
      case "title": {
        // the championship belt: a gold plate on the belly
        const plate = at(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 6), std(0xe0b030, 0.25, 0.9)), 0, 0.08, 0.2, Math.PI / 2);
        plate.scale.set(1.3, 1, 0.75);
        put(b.spine, "title", plate);
        break;
      }
    }
  }
  return out;
}
