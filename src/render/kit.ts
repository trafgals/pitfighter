// What makes each fighter read as itself from across the pit, before any
// colour: its size, its horns and tail if it has them, and a piece or two of
// gear (a hat, whiskers, a monocle, pistons). All of it rides on the bones, so the
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

/** The horns on the head bone: the twelve fighters in Old Sorrow wear none. */
export function buildHorns(h: Horns, _mat?: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = `horns:${h}`;
  return g;
}

/** The tail on the hips: the twelve fighters in Old Sorrow wear none. */
export function buildTail(t: Tail, _mat?: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = `tail:${t}`;
  g.position.set(0, 0.02, -0.13);
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

/**
 * Put the kit's gear on the bones; it returns what it added (named, for the tests).
 *
 * `skip` names the pieces of gear that a 3D prop is standing in for: the
 * approved asset is the real thing, so the game's own drawing of it is left
 * off rather than worn underneath.
 */
export function buildGear(
  gear: Gear[],
  b: GearBones,
  mats: { accent: THREE.Material; accentColour: number },
  skip: ReadonlySet<string> = new Set(),
): THREE.Object3D[] {
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
    if (skip.has(k)) continue;
    switch (k) {
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
      case "obi": {
        const knot = at(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.04), dark), 0.05, 0.08, 0.19);
        const ends = [-1, 1].map((s) => at(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.17, 0.01), dark), 0.05 + 0.03 * s, -0.01, 0.2, 0, 0, 0.15 * s));
        put(b.spine, "obi", knot, ...ends);
        break;
      }
      case "title": {
        // the championship belt: a gold plate on the belly
        const plate = at(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 6), std(0xe0b030, 0.25, 0.9)), 0, 0.08, 0.2, Math.PI / 2);
        plate.scale.set(1.3, 1, 0.75);
        put(b.spine, "title", plate);
        break;
      }
      case "custodian": {
        // the constable's tall domed helmet, a silver star on the front
        const navy = std(0x1a2038, 0.55);
        const dome = at(new THREE.Mesh(new THREE.SphereGeometry(0.165, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), navy), 0, 0.23, 0);
        dome.scale.set(1, 1.7, 1.1);
        const brim = at(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 24), navy), 0, 0.23, 0);
        brim.scale.set(1, 1, 1.15);
        const star = at(new THREE.Mesh(new THREE.CircleGeometry(0.035, 8), std(0xd8dce4, 0.3, 0.8)), 0, 0.34, 0.16, -0.35);
        const knob = at(new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), std(0xd8dce4, 0.3, 0.8)), 0, 0.51, 0);
        put(b.head, "custodian", dome, brim, star, knob);
        break;
      }
      case "whiskers":
        // mutton chops down both cheeks
        put(
          b.head,
          "whiskers",
          ...[-1, 1].map((s) => at(new THREE.Mesh(taper([V(0.13 * s, 0.2, 0.05), V(0.14 * s, 0.12, 0.08), V(0.11 * s, 0.04, 0.11)], 0.035, 0.5), std(0x6a5a48, 0.95)), 0, 0, 0)),
        );
        break;
      case "pistons":
        // a hydraulic ram along each forearm, a pressure gauge at the wrist
        for (const [el, s] of [
          [b.elbowL, -1],
          [b.elbowR, 1],
        ] as const) {
          const steel = std(0x2a3a5a, 0.3, 0.8);
          const sleeve = at(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.064, b.fore * 0.8, 14), steel), 0, -b.fore * 0.5, 0);
          const ram = at(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, b.fore * 0.7, 10), std(0xc8ccd4, 0.2, 0.9)), 0.05 * s, -b.fore * 0.5, -0.05);
          const gauge = at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.016, 14), std(0xc09040, 0.3, 0.8)), 0, -b.fore * 0.75, 0.065, Math.PI / 2);
          const hose = at(new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.01, 6, 14, Math.PI), std(0xa01818, 0.6)), 0.02 * s, -b.fore * 0.3, -0.06, 0, Math.PI / 2, 0);
          put(el, `piston${s < 0 ? "L" : "R"}`, sleeve, ram, gauge, hose);
        }
        break;
      case "flatcap": {
        const tweed = std(0x4a3c2c, 0.95);
        const cap = at(new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.172, 0.05, 20), tweed), 0, 0.29, 0.01, 0.12);
        const peak = at(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.09), tweed), 0, 0.27, 0.17, 0.2);
        put(b.head, "flatcap", cap, peak);
        break;
      }
      case "nursecap": {
        // a starched white cap with a red cross
        const cap = at(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.1), std(0xf2f0ea, 0.6)), 0, 0.32, 0.02, -0.3);
        const red = std(0xb01818, 0.5);
        const bar = at(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.004), red), 0, 0.33, 0.075, -0.3);
        const post = at(new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.05, 0.004), red), 0, 0.33, 0.075, -0.3);
        put(b.head, "nursecap", cap, bar, post);
        break;
      }
      case "tophat": {
        // a silk top hat in the fighter's trim colour, a black band
        const silk = std(mats.accentColour, 0.35, 0.1);
        const brim = at(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.012, 24), silk), 0, 0.29, 0);
        brim.scale.set(1, 1, 0.9);
        const crown = at(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.26, 20), silk), 0, 0.42, 0);
        const band = at(new THREE.Mesh(new THREE.CylinderGeometry(0.143, 0.143, 0.035, 20), dark), 0, 0.32, 0);
        put(b.head, "tophat", brim, crown, band);
        break;
      }
      case "monocle": {
        const gold = std(0xd8b030, 0.25, 0.9);
        const ring = at(new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.005, 6, 18), gold), 0.06, 0.19, 0.155);
        const cord = at(new THREE.Mesh(taper([V(0.09, 0.17, 0.15), V(0.12, 0.08, 0.13), V(0.1, -0.04, 0.14)], 0.003, 1), dark), 0, 0, 0);
        put(b.head, "monocle", ring, cord);
        break;
      }
      case "stovepipe": {
        // taller than a top hat, soot black, a brass band, and the chimney rising through the crown
        const soot = std(0x1a1714, 0.8);
        const brim = at(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.014, 24), soot), 0, 0.29, 0);
        const crown = at(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.145, 0.4, 20), soot), 0, 0.49, 0);
        const band = at(new THREE.Mesh(new THREE.CylinderGeometry(0.148, 0.148, 0.03, 20), std(0xc09040, 0.3, 0.8)), 0, 0.33, 0);
        const flue = at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 12, 1, true), std(0x2a2420, 0.6, 0.5)), 0, 0.73, 0);
        put(b.head, "stovepipe", brim, crown, band, flue);
        break;
      }
      case "bowler": {
        const felt = std(0x1a1a1a, 0.7);
        const dome = at(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), felt), 0, 0.27, 0);
        dome.scale.set(1, 0.85, 1.05);
        const brim = at(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 24), felt), 0, 0.27, 0);
        brim.scale.set(1, 1, 1.1);
        put(b.head, "bowler", dome, brim);
        break;
      }
      case "goggles": {
        // brass goggles pushed up on the brow, green glass
        const brass = std(0xc09040, 0.3, 0.8);
        const strap = at(new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.014, 8, 28), std(0x3a2a1a, 0.8)), 0, 0.25, 0, Math.PI / 2 - 0.15);
        const lenses = [-1, 1].flatMap((s) => [
          at(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 14), brass), 0.06 * s, 0.25, 0.13, Math.PI / 2 - 0.3),
          at(new THREE.Mesh(new THREE.CircleGeometry(0.033, 14), std(0x60a080, 0.1, 0.2)), 0.06 * s, 0.256, 0.151, -0.3),
        ]);
        put(b.head, "goggles", strap, ...lenses);
        break;
      }
      case "weepers":
        // the mourner's black crape ribbons, hanging from the back of the hat to the waist
        put(
          b.head,
          "weepers",
          ...[-1, 1].map((s) => at(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.7, 0.006), std(0x0c0c0c, 0.9)), 0.04 * s, -0.03, -0.18, 0.12)),
        );
        break;
      case "moustache":
        // a great waxed handlebar
        put(
          b.head,
          "moustache",
          ...[-1, 1].map((s) => at(new THREE.Mesh(taper([V(0.01 * s, 0.115, 0.158), V(0.07 * s, 0.105, 0.148), V(0.12 * s, 0.14, 0.115)], 0.02, 0.2), std(0x2a1a10, 0.6)), 0, 0, 0)),
        );
        break;
    }
  }
  return out;
}
