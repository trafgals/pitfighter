// The animation on top of the clips (src/render/animate.ts): feet that stay
// planted, strikes that start in the pelvis and land on the hit frame, hit
// reactions by height, side and strength over the frames the sim gives them,
// knockdowns that reach the floor when Urban Reign's do, and a walk whose
// stride follows the speed.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBody, stance, targetPose, type Body } from "../src/render/body";
import { CONES, HINGES, RAGDOLL, SPINE_MAX, bendOf, coneAngle, spineBend, type Rag } from "../src/render/ragdoll";
import { BLEND, animate, ankleOf, hitSide, onHit, strideOf } from "../src/render/animate";
import { DOWN_BACK, DOWN_FRONT, FALL_LAND, REACTION_CLIPS, THROW_TIMING, WAKE_BACK, WAKE_FRONT, clipFor, familyOf, stateTiming, type Clip } from "../src/render/motion";
import { DOWN, MOVES } from "../src/sim/moves";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";
import type { Fighter } from "../src/sim/types";
import REACT from "../docs/calibration/urban-reign-reactions.json";

const DT = 1 / 60;
const STRING = ["jab1", "jab2", "jab3", "punchFin", "kick1", "kick2", "sweep"] as const;

/** A fighter standing settled in its stance at the origin, facing +z (the sim's facing 0 is +x, so the root stays unturned). */
function standing(style: number): { w: World; f: Fighter; b: Body; time: { t: number } } {
  const w = new World({ seed: 3, styles: [style, 0], humans: [true, true] });
  const f = w.fighters[0];
  const b = buildBody(f);
  Object.assign(f, { state: "idle", t: 0, stop: 0 });
  const time = { t: 0 };
  for (let i = 0; i < 90; i++) step(b, f, w, time);
  return { w, f, b, time };
}
function step(b: Body, f: Fighter, w: World, time: { t: number }): void {
  time.t += DT;
  animate(b, f, w, time.t, DT);
}
/** Play the fighter's frames from..to (f.t = each), calling `each` after every frame. */
function play(b: Body, f: Fighter, w: World, time: { t: number }, from: number, to: number, each?: (t: number) => void): void {
  for (let t = from; t <= to; t++) {
    f.t = t;
    step(b, f, w, time);
    each?.(t);
  }
}
const fistOf = (b: Body, s: "L" | "R") => b.joints[s === "L" ? "elbowL" : "elbowR"].localToWorld(new THREE.Vector3(0, -0.3, 0));
/** The point a strike lands with: the fist, the foot, the point of the elbow, the shoulder. */
function tipOf(b: Body, clip: Clip): THREE.Vector3 {
  const v = new THREE.Vector3();
  if (clip.point === "elbow") return b.joints[clip.limb === "armR" ? "elbowR" : "elbowL"].getWorldPosition(v);
  if (clip.point) return b.limbs[clip.point === "shoulderR" ? "armR" : "armL"].getWorldPosition(v);
  return clip.limb === "legL" ? ankleOf(b, "L", v) : clip.limb === "legR" ? ankleOf(b, "R", v) : fistOf(b, clip.limb === "armR" ? "R" : "L");
}
const yawOf = (o: THREE.Object3D) => {
  const d = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
  return Math.atan2(d.x, d.z);
};
const argmax = (xs: number[]) => xs.indexOf(Math.max(...xs));

describe("planted feet", () => {
  it("a planted foot moves less than 2 cm between being put down and lifted, through every strike of every style", () => {
    for (let style = 0; style < STYLES.length; style++)
      for (const move of [...STRING, STYLES[style].special]) {
        const { w, f, b, time } = standing(style);
        const m = w.eff(f, move);
        Object.assign(f, { state: "attack", move, chargeHeld: false, charge: 0 });
        const seg: Record<"L" | "R", THREE.Vector3 | null> = { L: null, R: null };
        let worst = 0;
        play(b, f, w, time, 0, m.total, () => {
          for (const s of ["L", "R"] as const) {
            const ft = b.feet[s];
            const held = ft.down && ft.w >= 1 && !ft.swing;
            if (!held) seg[s] = null;
            else if (!seg[s]) seg[s] = ankleOf(b, s);
            else worst = Math.max(worst, ankleOf(b, s).distanceTo(seg[s]!));
          }
        });
        expect(worst, `${STYLES[style].style} ${move}`).toBeLessThan(0.02);
      }
  });

  it("the hips drop to keep a planted foot in reach rather than lift it off the floor", () => {
    const { w, f, b, time } = standing(0);
    const at = ankleOf(b, "R");
    // the body pushed forward off the rear foot without a step: the foot stays, the hips sink
    for (let i = 0; i < 4; i++) {
      b.root.position.z += 0.05;
      step(b, f, w, time);
    }
    expect(ankleOf(b, "R").distanceTo(at)).toBeLessThan(0.02);
    expect(b.body.position.y).toBeLessThan(b.cur.y - 0.005);
  });

  it("a foot left behind by the body steps back under it", () => {
    const { w, f, b, time } = standing(0);
    f.state = "idle";
    b.root.position.x += 0.5;
    for (let i = 0; i < 30; i++) step(b, f, w, time);
    for (const s of ["L", "R"] as const) expect(Math.abs(ankleOf(b, s).x - 0.5)).toBeLessThan(0.3);
    expect(b.feet.L.down && b.feet.R.down).toBe(true);
  });

  it("walking, the feet take turns, the planted one stays put, and the stride grows with the speed", () => {
    for (const speed of [1.2, 3]) {
      const { w, f, b, time } = standing(0);
      f.state = "walk";
      const S = strideOf(speed);
      let swings = 0;
      let wasDown = true;
      const held: Record<"L" | "R", THREE.Vector3 | null> = { L: null, R: null };
      let slide = 0;
      const lands: number[] = [];
      for (let i = 0; i < 120; i++) {
        b.root.position.z += speed * DT;
        step(b, f, w, time);
        // walking there is always a foot on the floor (at a run the body can leave both)
        if (speed < 2) expect(b.feet.L.down || b.feet.R.down, `speed ${speed} frame ${i}`).toBe(true);
        if (wasDown && !b.feet.L.down) swings++;
        wasDown = b.feet.L.down;
        for (const s of ["L", "R"] as const) {
          const ft = b.feet[s];
          if (!ft.down) held[s] = null;
          else if (!held[s]) {
            held[s] = ankleOf(b, s);
            if (s === "L") lands.push(held[s]!.z);
          } else if (ft.w >= 1) slide = Math.max(slide, ankleOf(b, s).distanceTo(held[s]!));
        }
      }
      expect(slide, `speed ${speed}`).toBeLessThan(0.02);
      // the left foot lands once a stride, two steps apart
      const cycles = (speed * 2) / (2 * S);
      expect(swings).toBeGreaterThanOrEqual(Math.floor(cycles) - 1);
      expect(swings).toBeLessThanOrEqual(Math.ceil(cycles) + 1);
      const gaps = lands.slice(2).map((z, i) => z - lands[i + 1]);
      for (const g of gaps) expect(g).toBeCloseTo(2 * S, 1);
    }
  });
});

describe("strikes start in the pelvis", () => {
  it("the striking limb is fastest within a frame of the hit, and the pelvis turns ahead of the fist", () => {
    for (let style = 0; style < STYLES.length; style++)
      for (const move of ["jab1", "jab2", "jab3", "punchFin", "kick1", "kick2"]) {
        const { w, f, b, time } = standing(style);
        const m = w.eff(f, move);
        const clip = clipFor(style, move)!;
        Object.assign(f, { state: "attack", move, chargeHeld: false, charge: 0 });
        const speed: number[] = [];
        const turn: number[] = [];
        let prev = tipOf(b, clip);
        let prevYaw = yawOf(b.hips);
        play(b, f, w, time, 0, m.startup + 6, () => {
          const p = tipOf(b, clip);
          speed.push(p.distanceTo(prev) / DT);
          prev = p;
          const y = yawOf(b.hips);
          turn.push(Math.abs(Math.atan2(Math.sin(y - prevYaw), Math.cos(y - prevYaw))) / DT);
          prevYaw = y;
        });
        const why = `${STYLES[style].style} (${familyOf(style)}) ${move}`;
        // from the last stretch of the gather on: the wind-up itself can be quick
        const from = Math.max(0, m.startup - 8);
        const peak = from + argmax(speed.slice(from));
        expect(Math.abs(peak - m.startup), why).toBeLessThanOrEqual(1);
        const hipPeak = from - 4 + argmax(turn.slice(from - 4, m.startup + 2));
        // a punch comes off the hips (an elbow is thrown with the trunk itself)
        if (Math.max(...turn.slice(from - 4)) > 0.5 && (clip.limb === "armL" || clip.limb === "armR") && !clip.point) expect(hipPeak, why).toBeLessThan(peak);
      }
  });
});

describe("hit reactions", () => {
  /** Two fighters: the victim at the origin facing +x on the sim floor, the attacker at (dx, dy). */
  function pair(dx: number, dy: number) {
    const s = standing(0);
    const a = s.w.fighters[1];
    Object.assign(s.f, { x: 0, y: 0, facing: 0 });
    Object.assign(a, { x: dx, y: dy, facing: Math.atan2(-dy, -dx), state: "idle" });
    return { ...s, a };
  }

  it("there are 12 reactions, 3 heights x light / heavy x the side, and the knockdowns land face up or face down", () => {
    expect(Object.keys(REACTION_CLIPS)).toHaveLength(6);
    const sides = new Set<string>();
    for (const [k, c] of Object.entries(REACTION_CLIPS))
      for (const m of [false, true]) sides.add(`${k}:${m}:${JSON.stringify(c.keys[0].p)}`);
    expect(sides.size).toBe(12);
    expect(DOWN_BACK).not.toBe(DOWN_FRONT);
    expect(WAKE_BACK).not.toBe(WAKE_FRONT);
  });

  it("the side a blow comes from is the victim's own: its right is +x of the figure", () => {
    // facing +x on the sim floor, the figure's right (+x) is the sim's +y
    const v = { x: 0, y: 0, facing: 0 } as Fighter;
    expect(hitSide({ x: 1, y: 0.5, state: "idle" } as Fighter, v)).toEqual({ side: 1, behind: false });
    expect(hitSide({ x: 1, y: -0.5, state: "idle" } as Fighter, v)).toEqual({ side: -1, behind: false });
    expect(hitSide({ x: -1, y: 0, state: "idle" } as Fighter, v).behind).toBe(true);
  });

  it("a jab to the head from the fighter's left turns the head to its right", () => {
    const { w, f, b, time, a } = pair(1, -0.4);
    Object.assign(f, { state: "hitstun", dur: 41, t: 0 });
    onHit(b, f, a, "head", 4, 6);
    play(b, f, w, time, 0, 5);
    expect(b.cur.headY).toBeGreaterThan(0.2);
    // and from its right, to its left
    const r = pair(1, 0.4);
    Object.assign(r.f, { state: "hitstun", dur: 41, t: 0 });
    onHit(r.b, r.f, r.a, "head", 4, 6);
    play(r.b, r.f, r.w, r.time, 0, 5);
    expect(r.b.cur.headY).toBeLessThan(-0.2);
  });

  it("a body blow folds the trunk, a leg kick buckles the knee, and a heavy blow plays bigger than a light one", () => {
    const peak = (part: "torso" | "legR", dmg: number) => {
      const { w, f, b, time, a } = pair(1, 0.4);
      Object.assign(f, { state: "hitstun", dur: 41, t: 0 });
      onHit(b, f, a, part, dmg, 6);
      let x = 0;
      play(b, f, w, time, 0, 10, () => (x = Math.max(x, part === "torso" ? b.cur.spineX : b.cur.kneeR)));
      return x;
    };
    const st = stance(familyOf(0));
    expect(peak("torso", 4)).toBeGreaterThan(st.spineX + 0.25);
    expect(peak("legR", 4)).toBeGreaterThan(st.kneeR + 0.4);
    expect(peak("torso", 9)).toBeGreaterThan(peak("torso", 4) + 0.1);
  });

  it("the reaction ends in the stance on the frame the sim lets the fighter go", () => {
    // a real hit in the sim: fighter 1 jabs fighter 0 and the hitstun runs out
    const w = new World({ seed: 5, styles: [0, 0], humans: [true, true] });
    const [d, a] = w.fighters;
    Object.assign(d, { x: 0, y: 0, facing: 0 });
    Object.assign(a, { x: 1, y: 0, facing: Math.PI });
    const b = buildBody(d);
    let frames = 0;
    let hit = false;
    const none = { buttons: 0, x: 0, y: 0 };
    for (let i = 0; i < 200 && !(hit && d.state !== "hitstun"); i++) {
      w.step([none, { buttons: i < 3 ? 1 : 0, x: 0, y: 0 }]);
      for (const e of w.s.events) if (e.kind === "hit" && e.b === 0) onHit(b, d, a, e.part ?? "torso", e.dmg ?? 4, 6);
      animate(b, d, w, i * DT, DT);
      if (d.state === "hitstun") {
        hit = true;
        frames++;
        if (d.t === d.dur - 1) {
          // on the last frame of the hitstun the target is the stance the fighter is let go in
          const goal = targetPose(Object.assign({ ...d }, { state: "idle" as const }), w, 0, b.hurt).p;
          const now = targetPose(Object.assign({ ...d }, { t: d.dur }), w, 0, b.hurt, b.cue).p;
          for (const k of ["spineX", "spineY", "headX", "headY", "y", "z", "kneeL"] as const) expect(now[k], k).toBeCloseTo(goal[k] as number, 1);
        }
      }
    }
    expect(hit).toBe(true);
    expect(frames).toBeGreaterThanOrEqual(MOVES.jab1.hitstun - 1);
  });

  it("two hits in a row keep turning the body rather than starting it over", () => {
    const once = pair(1, 0.4);
    Object.assign(once.f, { state: "hitstun", dur: 41, t: 0 });
    onHit(once.b, once.f, once.a, "head", 4, 6);
    let one = 0;
    play(once.b, once.f, once.w, once.time, 0, 14, () => (one = Math.min(one, once.b.cur.headY + once.b.cur.spineY)));

    const twice = pair(1, 0.4);
    Object.assign(twice.f, { state: "hitstun", dur: 41, t: 0 });
    onHit(twice.b, twice.f, twice.a, "head", 4, 6);
    play(twice.b, twice.f, twice.w, twice.time, 0, 5);
    onHit(twice.b, twice.f, twice.a, "head", 4, 6); // the second blow: the sim restarts the hitstun
    let two = 0;
    play(twice.b, twice.f, twice.w, twice.time, 0, 9, () => (two = Math.min(two, twice.b.cur.headY + twice.b.cur.spineY)));
    expect(two).toBeLessThan(one - 0.15);
  });
});

describe("knockdowns and get-ups", () => {
  for (const [face, name] of [
    [1, "face up"],
    [-1, "face down"],
  ] as const)
    it(`${name}: on the floor on the landing frame, standing at the end of the get-up`, () => {
      const { w, f, b, time } = standing(0);
      b.cue.face = face;
      Object.assign(f, { state: "down", dur: DOWN.dur });
      play(b, f, w, time, 0, FALL_LAND);
      const hips = b.hips.getWorldPosition(new THREE.Vector3());
      expect(hips.y, "the hips on the floor").toBeLessThan(0.35);
      expect(Math.abs(Math.abs(b.cur.rx) - Math.PI / 2)).toBeLessThan(0.35);
      expect(Math.sign(b.cur.rx)).toBe(-face); // on the back, or on the front
      play(b, f, w, time, FALL_LAND + 1, DOWN.dur);
      Object.assign(f, { state: "wakeup", dur: DOWN.wake });
      play(b, f, w, time, 0, DOWN.wake);
      const head = b.head.getWorldPosition(new THREE.Vector3());
      expect(head.y, "the head up at standing height").toBeGreaterThan(1.3);
      expect(Math.abs(b.cur.rx)).toBeLessThan(0.1);
    });

  it("a blow from behind knocks the fighter onto the front", () => {
    const { w, f, b, time } = standing(0);
    const a = w.fighters[1];
    Object.assign(f, { x: 0, y: 0, facing: 0 });
    Object.assign(a, { x: -1, y: 0, state: "idle" });
    onHit(b, f, a, "torso", 9, 10);
    Object.assign(f, { state: "down", dur: DOWN.dur });
    play(b, f, w, time, 0, FALL_LAND);
    expect(b.cur.rx).toBeGreaterThan(1);
  });
});

describe("the ragdoll", () => {
  /** The pelvis and head in the root's frame, every frame of a fall, with or without the ragdoll. */
  function fall(face: 1 | -1, state: "down" | "thrown", on: boolean, frames: number) {
    RAGDOLL.on = on;
    try {
      const { w, f, b, time } = standing(0);
      b.cue.face = face;
      Object.assign(f, { state, dur: state === "down" ? DOWN.dur : 44, stop: 0 });
      const out: { hips: THREE.Vector3; head: THREE.Vector3 }[] = [];
      play(b, f, w, time, 0, frames, () => {
        const at = (o: THREE.Object3D) => b.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
        out.push({ hips: at(b.hips), head: at(b.head) });
      });
      return out;
    } finally {
      RAGDOLL.on = true;
    }
  }

  for (const face of [1, -1] as const)
    it(`a knockdown ${face > 0 ? "face up" : "face down"} is thrown ${face > 0 ? "back" : "forward"} by the blow, stays above the floor, and is on its clip on the landing frame`, () => {
      const rag = fall(face, "down", true, FALL_LAND);
      const clip = fall(face, "down", false, FALL_LAND);
      // carried along by the blow early in the fall
      const push = Math.max(...[4, 6, 8, 10].map((t) => (clip[t].hips.z - rag[t].hips.z) * face));
      expect(push, "pushed the way the blow went").toBeGreaterThan(0.03);
      for (const p of rag) {
        expect(p.hips.y).toBeGreaterThan(0.05);
        expect(p.head.y).toBeGreaterThan(0.05);
      }
      expect(rag[FALL_LAND].hips.distanceTo(clip[FALL_LAND].hips), "on the clip on landing").toBeLessThan(1e-3);
      expect(rag[FALL_LAND].hips.y, "on the floor").toBeLessThan(0.35);
    });

  it("a thrown body tumbles on the ragdoll and lands where its clip does", () => {
    const rag = fall(1, "thrown", true, 44);
    const clip = fall(1, "thrown", false, 44);
    expect(Math.max(...rag.map((p, t) => p.head.distanceTo(clip[t].head)))).toBeGreaterThan(0.02);
    expect(rag[44].hips.distanceTo(clip[44].hips)).toBeLessThan(1e-3);
  });

  /** Every bone's world position and the ragdoll's points, every frame of a fall. */
  function chain(face: 1 | -1, state: "down" | "thrown", on: boolean, frames: number) {
    RAGDOLL.on = on;
    try {
      const { w, f, b, time } = standing(0);
      b.cue.face = face;
      b.cue.side = 1;
      Object.assign(f, { state, dur: state === "down" ? DOWN.dur : 44, stop: 0 });
      const out: { bones: THREE.Vector3[]; hands: THREE.Vector3[]; rag: Rag | null }[] = [];
      play(b, f, w, time, 0, frames, () => {
        b.root.updateMatrixWorld(true);
        const at = (o: THREE.Object3D) => b.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
        const bones = b.skeleton.bones.map(at);
        // the hands and feet, in the pelvis's frame: what the limbs do on their own
        const tips = [fistOf(b, "L"), fistOf(b, "R"), ankleOf(b, "L"), ankleOf(b, "R")].map((p) => b.hips.worldToLocal(p));
        const rag = b.rag && { ...b.rag, x: b.rag.x.map((p) => p.clone()), axes: b.rag.axes.map((a) => a.clone()) };
        out.push({ bones, hands: tips, rag });
      });
      return out;
    } finally {
      RAGDOLL.on = true;
    }
  }

  const falls = [
    { name: "a knockdown face up", face: 1, state: "down", land: FALL_LAND },
    { name: "a knockdown face down", face: -1, state: "down", land: FALL_LAND },
    { name: "a throw", face: 1, state: "thrown", land: 44 },
  ] as const;

  for (const fall of falls) {
    it(`${fall.name}: every bone keeps its length and every joint stays within its limits`, () => {
      const run = chain(fall.face, fall.state, true, fall.land);
      const first = run[0].rag!;
      let worst = { cone: 0, hinge: 0 };
      for (const { rag } of run.slice(0, fall.land)) {
        expect(rag).not.toBeNull();
        const x = rag!.x;
        // the head, the limbs and the pelvis and chest are rigid (within a millimetre)
        for (const [i, [a, c]] of [[0, 1], [0, 2], [3, 4], [5, 6], [3, 7], [7, 8], [11, 12]].entries())
          expect(Math.abs(x[a].distanceTo(x[c]) - first.x[a].distanceTo(first.x[c])), `stick ${i}`).toBeLessThan(2e-3);
        // the chest bends and twists on the pelvis only within its range
        expect(spineBend(rag!)).toBeLessThan(SPINE_MAX + 0.01);
        for (const c of CONES) worst.cone = Math.max(worst.cone, coneAngle(x, c) - c.max);
        HINGES.forEach((h, i) => {
          const bend = bendOf(x, h, rag!.axes[i]);
          worst.hinge = Math.max(worst.hinge, h.lo - bend, bend - h.hi);
        });
        // nothing goes through the floor
        for (const p of x) expect(p.y).toBeGreaterThan(0.03);
      }
      expect(worst.cone, "outside a cone (rad)").toBeLessThan(0.03);
      expect(worst.hinge, "an elbow or knee bent the wrong way or too far (rad)").toBeLessThan(0.03);
    });

    it(`${fall.name}: the arms and legs flail on their own, and on the landing frame every bone is on its clip`, () => {
      const rag = chain(fall.face, fall.state, true, fall.land);
      const clip = chain(fall.face, fall.state, false, fall.land);
      // the hands and feet move against the pelvis, not just with the trunk
      const flail = Math.max(...rag.map((r, t) => Math.max(...r.hands.map((p, i) => p.distanceTo(clip[t].hands[i])))));
      expect(flail, "the limbs move off the clip (m)").toBeGreaterThan(0.05);
      const land = rag[fall.land].bones.map((p, i) => p.distanceTo(clip[fall.land].bones[i]));
      expect(Math.max(...land), "every bone on its clip on landing (m)").toBeLessThan(1e-3);
    });
  }
});

describe("timed to Urban Reign", () => {
  it("the reaction lengths are the ones measured in Urban Reign", () => {
    // a light hit's reaction is 41 frames there, and the sim's hitstun
    expect(REACT.light.len).toBe(41);
    for (const id of ["jab1", "jab2", "jab3", "kick1", "kick2", "headbutt"]) expect(MOVES[id].hitstun).toBe(REACT.light.len);
    // the fall reaches the floor on its median frame
    expect(FALL_LAND).toBe(REACT.knockdown.fall.median);
    // the get-up runs as long as Urban Reign's (49-51 frames)
    const ups = [...REACT.knockdown.faceUp.getup.measured, ...REACT.knockdown.faceDown.getup.measured];
    expect(DOWN.wake).toBeGreaterThanOrEqual(Math.min(...ups) - 1);
    expect(DOWN.wake).toBeLessThanOrEqual(Math.max(...ups) + 1);
    // the thrower's motion: the throw's most common measured length
    const throws = REACT.grapple.throw.measured;
    expect(throws.filter((n) => n === THROW_TIMING.end).length).toBeGreaterThanOrEqual(throws.length / 2);
    expect(stateTiming(DOWN.wake).end).toBe(DOWN.wake);
  });
});

describe("transitions", () => {
  const flat = (p: object): number[] => Object.values(p).flatMap((x) => (Array.isArray(x) ? x : [x]));
  const gap = (a: object, b: object) => Math.max(...flat(a).map((x, i) => Math.abs(x - flat(b)[i])));

  it("a string's next blow starts from where the last one left the body, and is on its clip by the contact frame", () => {
    for (let style = 0; style < STYLES.length; style++)
      for (const [a, next] of [["jab1", "jab2"], ["jab2", "jab3"], ["kick1", "kick2"]] as const) {
        const { w, f, b, time } = standing(style);
        const ma = w.eff(f, a);
        Object.assign(f, { state: "attack", move: a, chargeHeld: false, charge: 0 });
        // cancelled on the first recovery frame
        play(b, f, w, time, 0, ma.startup + ma.active);
        const before = JSON.parse(JSON.stringify(b.cur));
        f.move = next;
        const m = w.eff(f, next);
        const why = `${STYLES[style].style} ${a} > ${next}`;
        for (let t = 0; t <= m.startup; t++) {
          f.t = t;
          time.t += DT;
          const tp = animate(b, f, w, time.t, DT);
          const clean = targetPose(f, w, time.t, b.hurt, b.cue).p;
          if (t === 0) expect(gap(tp.p, before), why).toBeLessThan(1e-6);
          if (t >= Math.min(BLEND, m.startup)) expect(gap(tp.p, clean), `${why} frame ${t}`).toBeLessThan(1e-6);
          if (t > 0 && t < Math.min(BLEND, m.startup)) expect(gap(tp.p, clean), `${why} frame ${t}`).toBeGreaterThan(0);
        }
      }
  });

  it("standing, stalking or guarding, the head and the chest turn to the soft-lock target", () => {
    for (const side of [1, -1]) {
      const { w, f, b, time } = standing(0);
      const o = w.fighters[1];
      Object.assign(f, { state: "guard", t: 0, x: 0, y: 0, facing: 0, target: 1 });
      Object.assign(o, { x: 0.8, y: 2 * side });
      const base = targetPose({ ...f, target: -1 } as Fighter, w, time.t, b.hurt, b.cue).p;
      for (let i = 0; i < 40; i++) step(b, f, w, time);
      expect((b.cur.headY - base.headY) * side, `target on side ${side}`).toBeGreaterThan(0.4);
      expect((b.cur.spineY - base.spineY) * side).toBeGreaterThan(0.2);
    }
  });
});
