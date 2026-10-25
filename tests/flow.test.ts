// Combos from the flow of the body: a string trades limbs, the same limb twice
// running has to come back first, and mid-string a landed punch flows into the
// kick string (back + Circle) and a landed kick into the punch string (Circle).
import { describe, expect, it } from "vitest";
import { FLOW, MOVES } from "../src/sim/moves";
import type { World } from "../src/sim/world";
import { BTN, chop, duel, run } from "./helpers";

const BACK = -1; // fighter 0 faces +x

/** Mash Circle every 4 frames for `frames`, with the stick at `x` while `back(i)` says so; returns the moves thrown in order. */
function mash(w: World, frames: number, back: (i: number) => boolean): string[] {
  const seen: string[] = [];
  const a = w.fighters[0];
  run(w, frames, (inp, i) => {
    if (i % 4 === 0 && w.fighters[1].state !== "air") inp[0].buttons = BTN.HIGH;
    if (back(i)) inp[0].x = BACK;
    if (a.state === "attack" && a.move && seen[seen.length - 1] !== a.move) seen.push(a.move);
  });
  return seen;
}

describe("strings", () => {
  it("a player's low string goes on with back + Circle (it used to stop at the first kick)", () => {
    const w = duel(1.2);
    w.fighters[0].y = w.fighters[1].y = 4;
    const seen = mash(w, 90, () => true);
    expect(seen.slice(0, 3)).toEqual(["kick1", "kick2", "sweep"]);
  });

  it("the strikes of a string trade sides: right, left, right", () => {
    const w = duel();
    const a = w.fighters[0];
    expect(["jab1", "jab2", "jab3"].map((id) => w.strikerOf(a, id))).toEqual(["armR", "armL", "armR"]);
    expect(["kick1", "kick2", "sweep"].map((id) => w.strikerOf(a, id))).toEqual(["legR", "legL", "legR"]);
    expect(w.strikerOf(a, "punchFin")).toBe("armR"); // All-Round's two jabs end on the left, so the finisher is the right
  });
});

describe("flowing from one string into the other", () => {
  it("a landed kick flows into the punch string on a plain Circle", () => {
    const w = duel(1.2);
    w.fighters[0].y = w.fighters[1].y = 4;
    const seen = mash(w, 60, (i) => i < 4); // back + Circle opens the kicks, then plain Circle
    expect(seen[0]).toBe("kick1");
    expect(seen[1]).toBe("jab1");
  });

  it("a landed jab flows into the kick string on back + Circle", () => {
    const w = duel(1.0);
    w.fighters[0].y = w.fighters[1].y = 4;
    const seen = mash(w, 60, (i) => i >= 4); // a plain jab, then back + Circle
    expect(seen.slice(0, 2)).toEqual(["jab1", "kick1"]);
  });

  it(`a combo crosses at most ${FLOW.max} times; after that the press carries the string on`, () => {
    const w = duel(1.0);
    w.fighters[0].y = w.fighters[1].y = 4;
    // alternate: plain, back, plain, back... every press asks to cross
    const seen = mash(w, 120, (i) => Math.floor(i / 4) % 2 === 1);
    const kinds = seen.map((id) => MOVES[id].kind);
    let crossings = 0;
    for (let i = 1; i < kinds.length; i++) if (kinds[i] !== kinds[i - 1] && MOVES[seen[i]].kind !== "special") crossings++;
    expect(crossings).toBe(FLOW.max);
  });

  it("a whiffed strike flows into nothing", () => {
    const w = duel(4);
    const seen = mash(w, MOVES.jab1.startup + MOVES.jab1.active + MOVES.jab1.recovery - 1, (i) => i >= 4); // until the jab recovers
    expect(seen).toEqual(["jab1"]);
  });

  it("an opener crossed into mid-combo never charges, however long Circle is held", () => {
    const w = duel(1.2);
    w.fighters[0].y = w.fighters[1].y = 4;
    const a = w.fighters[0];
    mash(w, 20, (i) => i < 4); // kick1, crossing to jab1 queued
    let charge = 0;
    run(w, 40, (inp) => {
      inp[0].buttons = BTN.HIGH;
      charge = Math.max(charge, a.charge);
    });
    expect(charge).toBe(0);
  });
});

describe("the same limb twice running", () => {
  it("with one arm left, the second jab comes out FLOW.same frames later than with two", () => {
    const gap = (oneArm: boolean) => {
      const w = duel();
      const a = w.fighters[0];
      if (oneArm) chop(w, a, "armL", 1);
      Object.assign(a, { state: "idle", t: 0, stop: 0, invuln: 0 });
      const hits: number[] = [];
      run(w, 60, (inp, i) => {
        if (i % 4 === 0) inp[0].buttons = BTN.HIGH;
        for (const e of w.s.events) if (e.kind === "hit" && e.b === 1) hits.push(w.s.frame - (e.stop ?? 0));
      });
      return { gap: hits[1] - hits[0], same: w.strikerOf(a, "jab1") === w.strikerOf(a, "jab2") };
    };
    const two = gap(false);
    const one = gap(true);
    expect(two.same).toBe(false);
    expect(one.same).toBe(true);
    expect(one.gap - two.gap).toBeGreaterThanOrEqual(FLOW.same);
  });
});
