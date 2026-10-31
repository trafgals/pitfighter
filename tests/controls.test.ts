// Urban Reign's control layout: Circle strikes, Triangle grapples, Square
// deflects or (with a direction) evades, Cross dashes and runs, L1 picks up,
// L2 taunts, R1 locks on, Circle + Triangle is the special.
import { describe, expect, it } from "vitest";
import { DASH, EVADE, FURY, MOVES, SPECIAL_CHORD, SPEED, TAUNT } from "../src/sim/moves";
import { STYLES } from "../src/sim/styles";
import { PAD_BTN } from "../src/input";
import { BTN, duel, run, tap } from "./helpers";

describe("the pad is laid out like Urban Reign's", () => {
  it("Circle strikes, Triangle grapples, Square dodges, Cross dashes, L1 picks up, L2 taunts, R1 locks on", () => {
    const of = Object.fromEntries(PAD_BTN.map(([i, b]) => [i, b]));
    // standard mapping: 0 Cross, 1 Circle, 2 Square, 3 Triangle, 4 L1, 5 R1, 6 L2, 7 R2
    expect(of[1]).toBe(BTN.HIGH);
    expect(of[3]).toBe(BTN.GRAB);
    expect(of[2]).toBe(BTN.REV);
    expect(of[0]).toBe(BTN.DASH);
    expect(of[4]).toBe(BTN.USE);
    expect(of[6]).toBe(BTN.TAUNT);
    expect(of[5]).toBe(BTN.LOCK);
    expect(Object.values(of)).not.toContain(BTN.LOW); // the low string is back + Circle
  });
});

describe("Cross: dash and run", () => {
  it("a tap dashes about 1.6 m along the stick, faster than walking there", () => {
    const w = duel(6);
    const a = w.fighters[0];
    const x0 = a.x;
    tap(w, 0, BTN.DASH, (inp) => (inp[0].y = 1));
    expect(a.state).toBe("dash");
    run(w, DASH.dur);
    expect(a.y).toBeCloseTo((DASH.move - 1) * DASH.speed, 1);
    expect(Math.abs(a.x - x0)).toBeLessThan(0.05);
    expect(DASH.move * DASH.speed).toBeGreaterThan(DASH.move * SPEED.walk * 2);
    expect(a.state).toBe("idle");
  });

  it("held, the dash runs on at twice the walking speed; let go, and you walk", () => {
    const w = duel(12);
    const a = w.fighters[0];
    Object.assign(a, { x: -4, y: 0 });
    run(w, 40, (inp) => {
      inp[0].y = 1;
      inp[0].buttons = BTN.DASH;
    });
    expect(a.running).toBe(true);
    const y0 = a.y;
    run(w, 20, (inp) => {
      inp[0].y = 1;
      inp[0].buttons = BTN.DASH;
    });
    expect((a.y - y0) / 20).toBeCloseTo(SPEED.run, 3);
    run(w, 2, (inp) => (inp[0].y = 1));
    expect(a.running).toBe(false);
  });

  it("Circle out of a run is a shoulder charge that knocks down", () => {
    const w = duel(3);
    const [a, b] = w.fighters;
    a.y = b.y = 4; // clear of the toilet in the middle
    run(w, 14, (inp) => {
      inp[0].x = 1;
      inp[0].buttons = BTN.DASH;
    });
    tap(w, 0, BTN.HIGH | BTN.DASH, (inp) => (inp[0].x = 1));
    expect(a.move).toBe("dashStrike");
    run(w, 30);
    expect(MOVES.dashStrike.knockdown).toBe(true);
    expect(["down", "wakeup"]).toContain(b.state);
  });
});

describe("Square: deflect or evade", () => {
  it("with a direction, Square evades that way and nothing touches it in the deflect window", () => {
    const w = duel(1.0, [0, 6]); // Winch parries; a boxer evades
    const [, b] = w.fighters;
    tap(w, 0, BTN.HIGH);
    tap(w, 1, BTN.REV, (inp) => (inp[1].y = 1));
    expect(b.state).toBe("evade");
    const y0 = b.y;
    let hit = false;
    run(w, EVADE.dur, () => {
      if (w.s.events.some((e) => e.kind === "hit" && e.b === 1)) hit = true;
    });
    expect(hit).toBe(false);
    expect(b.y - y0).toBeCloseTo((EVADE.move - 1) * EVADE.speed, 1);
    expect(b.state).toBe("idle");
  });
});

describe("Circle + Triangle: the special", () => {
  it("both together (within the chord window) throw the special instead of a jab or a grab", () => {
    for (const first of [BTN.HIGH, BTN.GRAB]) {
      const w = duel(2.5); // out of the grapple's reach, so a lone Triangle would whiff
      const a = w.fighters[0];
      a.fury = FURY.max;
      tap(w, 0, first);
      run(w, SPECIAL_CHORD - 2);
      tap(w, 0, first === BTN.HIGH ? BTN.GRAB : BTN.HIGH);
      expect(a.move).toBe(STYLES[a.style].special);
      expect(a.fury).toBe(FURY.max - FURY.cost);
    }
  });
});

describe("L2: taunt", () => {
  it("a whole taunt fills fury; one cut short by a hit does not", () => {
    const w = duel(4);
    const a = w.fighters[0];
    tap(w, 0, BTN.TAUNT);
    expect(a.state).toBe("taunt");
    run(w, TAUNT.dur);
    expect(a.state).toBe("idle");
    expect(a.fury).toBe(TAUNT.fury);

    const v = duel(1.0);
    const c = v.fighters[0];
    tap(v, 0, BTN.TAUNT);
    tap(v, 1, BTN.HIGH);
    run(v, 30);
    expect(c.fury).toBeLessThan(TAUNT.fury);
  });
});
