// Up in a juggle the body is on the ragdoll, not a held pose: it flies the
// sim's arc, its limbs lag behind every change of speed (the launch, a pop)
// and float in between, it tumbles through the throw's flight by how far
// along the arc it is, and the fall goes on into the knockdown it lands in.
// All of it follows the sim, which decides the arc.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBody, type Body } from "../src/render/body";
import { animate } from "../src/render/animate";
import { RAGDOLL, type Rag } from "../src/render/ragdoll";
import { toV, yaw } from "../src/render/stageviews";
import { AIR } from "../src/sim/moves";
import { World } from "../src/sim/world";
import { idle } from "./helpers";

const DT = 1 / 60;
const POP_AT = 30;

interface Frame {
  state: string;
  z: number;
  rag: Rag | null;
  points: THREE.Vector3[];
  hands: THREE.Vector3[]; // the hands and feet in the pelvis's frame
  pitch: number; // the pelvis's tilt off upright (rad)
}

/** Launch fighter 0, pop them once at POP_AT, and render every sim step until they have lain a while. */
function juggle(on: boolean): Frame[] {
  RAGDOLL.on = on;
  try {
    const w = new World({ seed: 3, styles: [0, 0], humans: [true, true], limbs: false });
    w.s.nextGeyser = 1e9;
    const f = w.fighters[0];
    Object.assign(f, { x: 0, y: 4, facing: 0 });
    const b: Body = buildBody(f);
    const place = () => {
      b.root.position.copy(toV(f.x, f.y, f.z));
      b.root.rotation.y = yaw(f.facing);
      b.root.updateMatrixWorld(true);
    };
    let t = 0;
    for (let i = 0; i < 60; i++) {
      w.step(idle(2));
      place();
      animate(b, f, w, (t += DT), DT);
    }
    Object.assign(f, { state: "air", t: 0, stop: 0, vz: AIR.launch, juggle: 1, bounced: false });
    const out: Frame[] = [];
    for (let i = 0; i < 400 && !(f.state === "down" && f.t > 20); i++) {
      if (i === POP_AT) Object.assign(f, { vz: AIR.pop, juggle: 2 });
      w.step(idle(2));
      place();
      animate(b, f, w, (t += DT), DT);
      b.root.updateMatrixWorld(true);
      const local = (v: THREE.Vector3) => b.hips.worldToLocal(v);
      const ends = [b.joints.elbowL, b.joints.elbowR].map((e) => local(e.localToWorld(new THREE.Vector3(0, -0.3, 0))));
      const feet = [b.ankles.L, b.ankles.R].map((a) => local(a.getWorldPosition(new THREE.Vector3())));
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(b.hips.getWorldQuaternion(new THREE.Quaternion()));
      out.push({
        state: f.state,
        z: f.z,
        rag: b.rag,
        points: b.rag ? b.rag.x.map((p) => p.clone()) : [],
        hands: [...ends, ...feet],
        pitch: up.angleTo(new THREE.Vector3(0, 1, 0)),
      });
    }
    return out;
  } finally {
    RAGDOLL.on = true;
  }
}

describe("a juggled body", () => {
  const rag = juggle(true);
  const clip = juggle(false);
  const air = rag.filter((x) => x.state === "air");

  it("flies on the ragdoll from the launch, and the same fall goes on into the knockdown it lands in", () => {
    expect(air.length).toBeGreaterThan(POP_AT + 20);
    const first = air[0].rag;
    expect(first?.key).toBe("thrown");
    for (const x of rag.filter((y) => y.state === "air" || y.state === "down")) expect(x.rag).toBe(first);
    expect(rag.at(-1)!.state).toBe("down");
  });

  it("is not frozen: it tumbles from upright onto its back over the arc", () => {
    expect(air[0].pitch).toBeLessThan(0.6);
    expect(Math.max(...air.map((x) => x.pitch))).toBeGreaterThan(1.2);
  });

  it("its limbs swing on their own, off the clip", () => {
    const off = Math.max(...air.map((x, i) => Math.max(...x.hands.map((h, k) => h.distanceTo(clip[i].hands[k])))));
    expect(off).toBeGreaterThan(0.05);
  });

  it("a pop jolts the limbs: they move more just after it than just before", () => {
    const move = (from: number, to: number) => {
      let m = 0;
      for (let i = from + 1; i <= to; i++) m = Math.max(m, ...rag[i].hands.map((h, k) => h.distanceTo(rag[i - 1].hands[k])));
      return m;
    };
    expect(move(POP_AT, POP_AT + 6)).toBeGreaterThan(move(POP_AT - 7, POP_AT - 1) * 1.2);
  });

  it("keeps its bones their length and never goes through the floor", () => {
    const len = (p: THREE.Vector3[], a: number, c: number) => p[a].distanceTo(p[c]);
    const first = air[0].points;
    for (const x of rag.filter((y) => y.points.length)) {
      for (const [a, c] of [[0, 1], [3, 4], [5, 6], [3, 7], [7, 8], [9, 10], [11, 12], [13, 14]])
        expect(Math.abs(len(x.points, a, c) - len(first, a, c))).toBeLessThan(2e-3);
      // the root is up at the body's height, so the floor is that far below it
      for (const p of x.points) expect(p.y).toBeGreaterThan(-x.z - 0.02);
    }
  });
});
