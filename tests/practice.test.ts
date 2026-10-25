// Practice: nobody wins, the KO'd come back on any arena, fury never runs
// out, and a body left alone for PRACTICE.refill frames is whole again.
import { describe, expect, it } from "vitest";
import { FURY, KO_FRAMES, PRACTICE } from "../src/sim/moves";
import type { StageId } from "../src/sim/stages";
import { World } from "../src/sim/world";
import { run } from "./helpers";

const world = (practice: boolean, stage: StageId = "hell-toilet") => new World({ seed: 3, styles: [0, 1], humans: [true, false], stage, practice });

describe("practice", () => {
  it("nobody wins: whatever the arena calls a win is not one", () => {
    for (const practice of [false, true]) {
      const w = world(practice);
      w.win(0);
      run(w, 5);
      expect(w.s.winner, `practice ${practice}`).toBe(practice ? -1 : 0);
      expect(w.s.frame).toBe(5); // and the fight goes on
    }
  });

  it("nobody is ever left standing alone: the last-one-standing rule is off", () => {
    const w = world(true, "collapsing-tower");
    for (const f of w.fighters) f.out = true;
    run(w, 2);
    expect(w.s.winner).toBe(-1);
  });

  it("the KO'd come back, even where nobody normally does", () => {
    for (const practice of [false, true]) {
      const w = world(practice, "collapsing-tower");
      const f = w.fighters[1];
      w.damage(f, "torso", 1e4, 0);
      expect(f.state).toBe("ko");
      run(w, KO_FRAMES + 2);
      expect(f.out, `practice ${practice}`).toBe(!practice);
      if (practice) expect(f.parts.torso.hp).toBe(f.parts.torso.max);
    }
  });

  it(`a body nobody has hurt for ${PRACTICE.refill} frames is whole again; one still being hit is not`, () => {
    const w = world(true);
    const f = w.fighters[1];
    w.damage(f, "armR", 10, 0);
    w.damage(f, "head", 10, 0);
    run(w, PRACTICE.refill - 2);
    expect(f.parts.armR.hp).toBeLessThan(f.parts.armR.max);
    w.damage(f, "armR", 1, 0); // hit again: the wait starts over
    run(w, PRACTICE.refill - 2);
    expect(f.parts.armR.hp).toBeLessThan(f.parts.armR.max);
    run(w, 4);
    for (const p of ["armR", "head", "torso"] as const) expect(f.parts[p].hp).toBe(f.parts[p].max);
  });

  it("fury never runs out, so the special is always there to try", () => {
    const w = world(true);
    w.fighters[0].fury = 0;
    run(w, 1);
    expect(w.fighters[0].fury).toBe(FURY.max);
    const live = world(false);
    live.fighters[0].fury = 0;
    run(live, 1);
    expect(live.fighters[0].fury).toBeLessThan(FURY.max);
  });
});
