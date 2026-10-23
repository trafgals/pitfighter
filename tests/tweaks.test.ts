// Pitfighter's two tweaks to Urban Reign's combat: charged string openers and
// the 3x recovery of a reversal that counters nothing.
import { describe, expect, it } from "vitest";
import { CHARGE, MOVES, REVERSAL, REVERSAL_WHIFF_RECOVERY, REVERSAL_WHIFF_TOTAL } from "../src/sim/moves";
import type { World } from "../src/sim/world";
import { BTN, duel, idle, run, tap } from "./helpers";

/** P1 presses `btn` and holds it for `hold` frames (1 = a tap), then the sim runs on. Returns the first hit on P2. */
function strikeWithHold(btn: number, hold: number, gap = 1.0): { frame: number; dmg: number; state: string } | null {
  const w = duel(gap);
  for (let i = 0; i < 200; i++) {
    const inp = idle(2);
    if (i < hold) inp[0].buttons = btn;
    w.step(inp);
    const hit = w.s.events.find((e) => e.kind === "hit" && e.a === 0 && e.b === 1);
    if (hit) return { frame: i, dmg: hit.dmg ?? 0, state: w.fighters[1].state };
  }
  return null;
}

describe("charged string openers", () => {
  it("a tap is the normal opener: same hit frame, damage and reaction", () => {
    const tapped = strikeWithHold(BTN.HIGH, 1)!;
    const held = strikeWithHold(BTN.HIGH, MOVES.jab1.startup - 1)!; // released before the charge frame
    expect(tapped.frame).toBe(MOVES.jab1.startup);
    expect(held).toEqual(tapped);
    expect(tapped.state).toBe("hitstun");
  });

  it("holding the button delays the jab and adds damage in proportion to the charge", () => {
    const tapped = strikeWithHold(BTN.HIGH, 1)!;
    const extra = CHARGE.max / 2;
    const half = strikeWithHold(BTN.HIGH, MOVES.jab1.startup - 1 + extra)!; // charging starts on its last startup frame
    expect(half.frame).toBeGreaterThan(tapped.frame + extra - 2);
    expect(half.dmg).toBeCloseTo(tapped.dmg * (1 + CHARGE.dmg * 0.5), 5);
    expect(half.state).toBe("hitstun");
  });

  it("a full charge doubles the damage and knocks down, and holding longer adds nothing", () => {
    const tapped = strikeWithHold(BTN.HIGH, 1)!;
    const full = strikeWithHold(BTN.HIGH, MOVES.jab1.startup + CHARGE.max)!;
    const longer = strikeWithHold(BTN.HIGH, MOVES.jab1.startup + CHARGE.max + 90)!;
    expect(full.dmg).toBeCloseTo(tapped.dmg * (1 + CHARGE.dmg), 5);
    expect(full.state).toBe("down");
    expect(longer).toEqual(full); // the charge caps and fires by itself
  });

  it("the low opener charges the same way", () => {
    const tapped = strikeWithHold(BTN.LOW, 1, 1.2)!;
    const full = strikeWithHold(BTN.LOW, MOVES.kick1.startup + CHARGE.max, 1.2)!;
    expect(full.dmg).toBeCloseTo(tapped.dmg * (1 + CHARGE.dmg), 5);
    expect(full.state).toBe("down");
  });

  it("only the opener charges: a held follow-up fires on its normal frame", () => {
    const w = duel(0.9);
    tap(w, 0, BTN.HIGH); // a tapped jab1
    let jab2Start = -1;
    let jab2Hit = -1;
    run(w, 80, (inp, i) => {
      if (i >= 4) inp[0].buttons = BTN.HIGH; // press again during jab1 and keep holding
      const f = w.fighters[0];
      if (jab2Start < 0 && f.move === "jab2") jab2Start = i;
      if (jab2Start >= 0 && jab2Hit < 0 && w.s.events.some((e) => e.kind === "hit" && e.a === 0)) jab2Hit = i;
    });
    expect(jab2Start).toBeGreaterThan(0);
    expect(jab2Hit - jab2Start).toBeLessThanOrEqual(w.eff(w.fighters[0], "jab2").startup);
    expect(w.fighters[0].charge).toBe(0);
  });

  it("a charging fighter can be hit out of the charge", () => {
    const w = duel();
    run(w, MOVES.jab1.startup + 20, (inp) => (inp[0].buttons = BTN.HIGH));
    expect(w.fighters[0].charge).toBeGreaterThan(0);
    tap(w, 1, BTN.HIGH, (inp) => (inp[0].buttons = BTN.HIGH));
    let hit = false;
    run(w, MOVES.jab1.startup + 2, (inp) => {
      inp[0].buttons = BTN.HIGH;
      if (w.s.events.some((e) => e.kind === "hit" && e.a === 1 && e.b === 0)) hit = true;
    });
    expect(hit).toBe(true);
    expect(w.fighters[0].state).not.toBe("attack");
  });
});

describe("whiffed reversals", () => {
  const reversalLength = (w: World): number => {
    let n = 0;
    while (w.fighters[1].state === "reversal" && n < 500) {
      w.step(idle(2));
      n++;
    }
    return n;
  };

  it("a reversal that counters nothing recovers 3x as long after its window", () => {
    expect(REVERSAL_WHIFF_RECOVERY).toBe(3);
    const after = REVERSAL.dur - REVERSAL.window - 1;
    expect(REVERSAL_WHIFF_TOTAL).toBe(REVERSAL.window + 1 + 3 * after);
    const w = duel();
    tap(w, 1, BTN.REV);
    expect(w.fighters[1].state).toBe("reversal");
    expect(reversalLength(w) + 1).toBe(REVERSAL_WHIFF_TOTAL);
  });

  it("a whiffed reversal can still be punished long after the retail length", () => {
    const w = duel();
    tap(w, 1, BTN.REV);
    run(w, REVERSAL.dur + 4); // past where the retail reversal would have ended
    expect(w.fighters[1].state).toBe("reversal");
    tap(w, 0, BTN.HIGH);
    let hit = false;
    run(w, MOVES.jab1.startup + 2, () => {
      if (w.s.events.some((e) => e.kind === "hit" && e.a === 0 && e.b === 1)) hit = true;
    });
    expect(hit).toBe(true);
  });

  it("a reversal that counters something ends at once, as before", () => {
    const w = duel();
    tap(w, 0, BTN.HIGH);
    run(w, MOVES.jab1.startup - 8);
    tap(w, 1, BTN.REV);
    let reversedAt = -1;
    run(w, 20, (_, i) => {
      if (reversedAt < 0 && w.s.events.some((e) => e.kind === "reversal" && e.a === 1)) reversedAt = i;
    });
    expect(reversedAt).toBeGreaterThanOrEqual(0);
    expect(w.fighters[1].state).not.toBe("reversal");
  });
});
