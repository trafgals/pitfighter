import { describe, expect, it } from "vitest";
import { movesetOf } from "../src/sim/movesets";
import { STYLES } from "../src/sim/styles";
import { REATTACH, SPEED } from "../src/sim/moves";
import { RING_R } from "../src/sim/types";
import { alive, arms, legs } from "../src/sim/world";
import { BTN, chop, duel, idle, run, tap } from "./helpers";

describe("limbs", () => {
  it("a limb at 0 HP falls off and lands on the floor as a pickup", () => {
    const w = duel();
    const b = w.fighters[1];
    chop(w, b, "armL", 0);
    expect(b.parts.armL.attached).toBe(false);
    expect(arms(b)).toBe(1);
    expect(w.s.pickups).toHaveLength(1);
    expect(w.s.events.some((e) => e.kind === "detach" && e.part === "armL")).toBe(true);
    run(w, 90);
    expect(w.s.pickups[0].z).toBe(0);
  });

  it("strikes knock limbs off over time", () => {
    const w = duel();
    const b = w.fighters[1];
    b.parts.torso.hp = b.parts.torso.max = 10000; // keep the dummy alive
    let detached = false;
    run(w, 3000, (inp, i) => {
      if (i % 4 === 0) inp[0].buttons = i % 120 < 60 ? BTN.HIGH : BTN.LOW;
      if (w.s.events.some((e) => e.kind === "detach")) detached = true;
      // keep the dummy in range
      if (w.fighters[1].state === "idle") Object.assign(w.fighters[1], { x: w.fighters[0].x + 1, y: 0, facing: Math.PI });
      w.fighters[0].facing = 0;
    });
    expect(detached).toBe(true);
  });

  it("no arms: Square is a headbutt and Circle does nothing", () => {
    const w = duel();
    const a = w.fighters[0];
    chop(w, a, "armL", 1);
    chop(w, a, "armR", 1);
    tap(w, 0, BTN.HIGH);
    expect(a.move).toBe("headbutt");
    run(w, 60);
    tap(w, 0, BTN.GRAB);
    expect(a.state).not.toBe("attack");
  });

  it("one leg: you hop (slower, no run, no low kicks); no legs: you bounce on the torso", () => {
    const w = duel(6);
    const a = w.fighters[0];
    const walk = (frames: number) => {
      const x0 = a.x;
      run(w, frames, (inp) => (inp[0].x = -1));
      return Math.abs(a.x - x0) / frames;
    };
    const full = walk(48);
    chop(w, a, "legR", 1);
    expect(legs(a)).toBe(1);
    Object.assign(a, { x: 0, y: 4 });
    const hop = walk(48);
    expect(hop).toBeLessThan(full);
    expect(hop).toBeCloseTo(SPEED.hop, 3);
    run(w, 2, (inp) => {
      inp[0].x = -1;
      inp[0].buttons = BTN.DASH;
    });
    run(w, 30, (inp) => {
      inp[0].x = -1;
      inp[0].buttons = BTN.DASH;
    });
    expect(a.running).toBe(false);
    tap(w, 0, BTN.LOW);
    expect(a.state).not.toBe("attack");
    chop(w, a, "legL", 1);
    Object.assign(a, { x: 0, y: 4 });
    const bounce = walk(48);
    expect(bounce).toBeCloseTo(SPEED.bounce, 3);
    expect(bounce).toBeLessThan(hop);
    expect(a.hopPhase, "it bounces along").toBeGreaterThan(0);
  });

  it("you can pick your own limb back up and it reattaches at half HP", () => {
    const w = duel(4);
    const a = w.fighters[0];
    chop(w, a, "armR", 1);
    run(w, 90);
    const p = w.s.pickups[0];
    a.x = p.x + 0.3;
    a.y = p.y;
    tap(w, 0, BTN.USE);
    expect(a.state).toBe("reattach");
    run(w, REATTACH.dur);
    expect(a.parts.armR.attached).toBe(true);
    expect(a.parts.armR.hp).toBe(Math.round(a.parts.armR.max * REATTACH.hpFrac));
    expect(w.s.pickups).toHaveLength(0);
  });

  it("Circle picks your own limb up too", () => {
    const w = duel(4);
    const a = w.fighters[0];
    chop(w, a, "legL", 1);
    run(w, 90);
    const p = w.s.pickups[0];
    Object.assign(a, { x: p.x + 0.3, y: p.y });
    tap(w, 0, BTN.GRAB);
    expect(a.state).toBe("reattach");
    run(w, REATTACH.dur);
    expect(a.parts.legL.attached).toBe(true);
  });

  it("Circle over someone else's limb puts it on you, and it fights like its first owner", () => {
    const boxer = STYLES.findIndex((s) => s.style === "Boxing");
    const constable = STYLES.findIndex((s) => s.style === "All-Round");
    const w = duel(4, [constable, boxer]);
    const [a, b] = w.fighters;
    const jab = w.eff(a, "jab1").dmg;
    chop(w, a, "armR", 1);
    chop(w, b, "armL", 0);
    run(w, 90);
    const p = w.s.pickups.find((x) => x.owner === b.id)!;
    expect(p.style).toBe(boxer);
    Object.assign(a, { x: p.x + 0.3, y: p.y });
    // a boxer's left arm goes in the gap on the right
    w.s.pickups = w.s.pickups.filter((x) => x === p);
    tap(w, 0, BTN.GRAB);
    expect(a.state).toBe("reattach");
    run(w, REATTACH.dur);
    expect(a.parts.armR.attached).toBe(true);
    expect(a.parts.armR.style).toBe(boxer);
    expect(w.s.pickups).toHaveLength(0);
    // a boxer's arm throws the boxer's jab, with the boxer's frames and damage
    expect(w.mv(a, "jab1")).toBe(movesetOf(boxer).moves.jab1);
    expect(w.eff(a, "jab1").startup).toBe(movesetOf(boxer).moves.jab1.startup);
    expect(w.eff(a, "jab1").dmg).not.toBeCloseTo(jab, 3);
    expect(w.mv(a, "jab2")).toBe(movesetOf(constable).moves.jab2); // the arm that is still his own throws his own
    // and the boxer grows a new one
    expect(b.parts.armL.regrow).toBeGreaterThan(0);
  });

  it("a transplant lost again keeps its first owner's style; a regrown limb is your own", () => {
    const w = duel(4, [0, 6]);
    const a = w.fighters[0];
    a.parts.armR.style = 6;
    chop(w, a, "armR", 1);
    expect(w.s.pickups[0].style).toBe(6);
    w.s.pickups = [];
    a.parts.armR.regrow = 1;
    run(w, 2);
    expect(a.parts.armR.attached).toBe(true);
    expect(a.parts.armR.style).toBe(0);
  });

  it("R2 on someone else's limb punts it", () => {
    const w = duel(4);
    const [a, b] = w.fighters;
    chop(w, b, "legL", 0);
    run(w, 90);
    const p = w.s.pickups[0];
    Object.assign(a, { x: p.x - 0.3, y: p.y, facing: 0 });
    const x0 = p.x;
    tap(w, 0, BTN.USE);
    run(w, 30);
    expect(w.s.pickups[0]?.x ?? 99).toBeGreaterThan(x0 + 1);
    expect(b.parts.legL.attached).toBe(false);
  });

  it("a limb that lands in the hellfire is not lost: it washes back up on the floor", () => {
    const w = duel();
    const b = w.fighters[1];
    chop(w, b, "armL", 0);
    const p = w.s.pickups[0];
    Object.assign(p, { x: RING_R + 0.5, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    run(w, 60);
    expect(w.s.pickups).toHaveLength(1);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(RING_R);
    expect(p.burning).toBe(0);
    expect(b.parts.armL.regrow).toBe(0);
  });

  it("torso at 0 is not death: every limb comes off, and you hobble round to pick them back up", () => {
    const w = duel();
    const b = w.fighters[1];
    w.damage(b, "torso", 999, 0);
    const kinds = w.s.events.map((e) => e.kind);
    expect(kinds).toContain("strip");
    expect(kinds).not.toContain("ko");
    expect(b.state).toBe("down");
    expect(alive(b)).toBe(true);
    expect(w.fighters[0].kos).toBe(1);
    expect(legs(b) + arms(b)).toBe(0);
    expect(b.parts.torso.hp).toBe(b.parts.torso.max);
    expect(w.s.pickups.filter((p) => p.owner === b.id)).toHaveLength(4);
    // long after a KO would have respawned them they are still here, in pieces, and the limbs still lie about
    run(w, 400);
    expect(alive(b)).toBe(true);
    expect(legs(b) + arms(b)).toBe(0);
    expect(w.s.pickups.filter((p) => p.owner === b.id)).toHaveLength(4);
    // a bare torso goes slower than one hopping on a leg
    expect(SPEED.bounce).toBeLessThan(SPEED.hop);
    // beaten to nothing again: still not dead
    w.damage(b, "torso", 999, 0);
    expect(alive(b)).toBe(true);
    // over to each limb, and pick it back up
    for (let k = 0; k < 4; k++) {
      const p = w.s.pickups.find((q) => q.owner === b.id)!;
      Object.assign(b, { x: p.x, y: p.y });
      w.setState(b, "idle");
      tap(w, 1, BTN.USE);
      run(w, REATTACH.dur + 2);
    }
    expect(legs(b) + arms(b)).toBe(4);
  });

  it("head at 0 HP makes you dizzy", () => {
    const w = duel();
    const b = w.fighters[1];
    w.damage(b, "head", 45, 0);
    expect(b.state).toBe("dizzy");
    w.step(idle(2));
  });
});
