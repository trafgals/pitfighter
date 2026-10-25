// The frame data against the timings measured in Urban Reign's EE RAM
// (docs/calibration/urban-reign-frames.json, docs/calibration.md). The checks
// drive the simulation itself, so a change to the rules that shifts a timing
// fails here even when the numbers in moves.ts are left alone.
import { describe, expect, it } from "vitest";
import ur from "../docs/calibration/urban-reign-frames.json";
import { DOWN, GRAB, HOLD, MOVES, REVERSAL } from "../src/sim/moves";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";
import { BTN, duel, idle, run, tap } from "./helpers";

const ALL_ROUND = STYLES.findIndex((s) => s.startup === 0 && s.string === 2);
const hitOn = (w: World, b = 1) => w.s.events.some((e) => e.kind === "hit" && e.b === b);
const reversedBy = (w: World, a = 1) => w.s.events.some((e) => e.kind === "reversal" && e.a === a);
const within = (v: number, [lo, hi]: number[]) => v >= lo && v <= hi;
// Hitstop is Pitfighter's feel layer on top of Urban Reign's motions (like the
// pad latency, it is not part of what was measured), so these worlds run without it.
const RAW = false;

describe("Urban Reign calibration", () => {
  it("a lone strike lands on frame 12, lasts as long as Urban Reign's and leaves the attacker ahead", () => {
    const w = duel(1.0, [ALL_ROUND, ALL_ROUND], RAW);
    const press = w.s.frame + 1;
    tap(w, 0, BTN.HIGH);
    let landed = -1;
    let free = -1;
    let victimFree = -1;
    for (let i = 0; i < 90; i++) {
      w.step(idle(2));
      if (landed < 0 && hitOn(w)) landed = w.s.frame;
      if (free < 0 && w.fighters[0].state === "idle") free = w.s.frame;
      if (landed > 0 && victimFree < 0 && w.fighters[1].state === "idle") victimFree = w.s.frame;
    }
    expect(landed - press).toBe(ur.neutralString.hitFrame[0]);
    expect(within(free - press, ur.neutralString.singleTotal)).toBe(true);
    expect(victimFree - landed).toBe(ur.hitReaction.light);
    // Urban Reign: hit on 12, 43 frames in total, 41 frames of reaction = +10
    expect(victimFree - free).toBeGreaterThanOrEqual(8);
    expect(victimFree - free).toBeLessThanOrEqual(12);
  });

  it("a four-hit string spaces its hits 12 / 14 / 20 frames apart", () => {
    const style = STYLES.findIndex((s) => s.string === 3);
    const st = STYLES[style].startup; // the style's tempo shifts every startup alike
    const w = duel(1.0, [style, ALL_ROUND], RAW);
    const hits: number[] = [];
    run(w, 120, (inp, i) => {
      if (i % 6 === 0 && w.fighters[1].state !== "air") inp[0].buttons = BTN.HIGH; // the finisher launches: stop there
      if (hitOn(w)) hits.push(w.s.frame);
    });
    expect(hits.length).toBe(4);
    const gaps = hits.slice(1).map((h, i) => h - hits[i] - st);
    expect(gaps).toEqual(ur.neutralString.hitGaps);
  });

  it("each follow-up starts 3 frames after the previous hit, and the finisher matches", () => {
    for (const id of ["jab1", "jab2", "jab3"]) expect(MOVES[id].active).toBe(ur.neutralString.cancelAfterHit);
    expect([MOVES.jab1, MOVES.jab2, MOVES.jab3, MOVES.punchFin].map((m) => m.startup)).toEqual(ur.neutralString.hitFrame);
    const fin = MOVES.punchFin;
    expect(within(fin.startup + fin.active + fin.recovery, ur.neutralString.finisherTotal)).toBe(true);
  });

  it("the low strikes keep Urban Reign's slower timings", () => {
    const [light, heavy] = ur.lowStrikes;
    const total = (m: (typeof MOVES)[string]) => m.startup + m.active + m.recovery;
    expect(MOVES.kick1.startup).toBe(light.hitFrame);
    expect(total(MOVES.kick1)).toBe(light.total);
    expect(MOVES.sweep.startup).toBe((heavy.hitFrame as number[])[0]);
    expect(within(total(MOVES.sweep), heavy.total as number[])).toBe(true);
  });

  it("a reversal catches a strike that lands on its frames 2..14, and no other", () => {
    expect(REVERSAL.first).toBe(Math.min(...ur.dodge.caughtOnDodgeFrame));
    expect(REVERSAL.window).toBe(Math.max(...ur.dodge.caughtOnDodgeFrame));
    expect(REVERSAL.dur).toBe(ur.dodge.total);
    const caught: number[] = [];
    // `lead`: the reversal's motion frame on which the jab lands
    const S = MOVES.jab1.startup;
    for (let lead = 0; lead <= 24; lead++) {
      const w = duel(1.0, [ALL_ROUND, ALL_ROUND], RAW);
      if (lead < S) {
        // pressed during the jab's startup
        tap(w, 0, BTN.HIGH);
        run(w, S - lead - 1);
        tap(w, 1, BTN.REV);
      } else if (lead === S) {
        tap(w, 0, BTN.HIGH, (inp) => (inp[1].buttons = BTN.REV));
      } else {
        // pressed before the jab started
        tap(w, 1, BTN.REV);
        run(w, lead - S - 1);
        tap(w, 0, BTN.HIGH);
      }
      let reversed = false;
      run(w, S + 2, () => {
        if (reversedBy(w)) reversed = true;
      });
      if (reversed) caught.push(lead);
    }
    const expected = Array.from({ length: REVERSAL.window - REVERSAL.first + 1 }, (_, i) => REVERSAL.first + i);
    expect(caught).toEqual(expected);
  });

  it("a deflection leaves the defender about 15 frames ahead", () => {
    expect(REVERSAL.stun).toBe(ur.deflection.defenderAdvantage);
    const w = duel(1.0, [ALL_ROUND, ALL_ROUND], RAW);
    tap(w, 0, BTN.HIGH);
    run(w, MOVES.jab1.startup - 9);
    tap(w, 1, BTN.REV); // the jab lands on the reversal's frame 8
    let at = -1;
    run(w, 12, () => {
      if (at < 0 && reversedBy(w)) at = w.s.frame;
    });
    expect(at).toBeGreaterThan(0);
    // the defender is free at once; the attacker stays staggered until at + stun
    expect(w.fighters[1].state).toBe("idle");
    expect(w.fighters[0].state).toBe("reversed");
    let attackerFree = -1;
    for (let i = 0; i < 40 && attackerFree < 0; i++) {
      w.step(idle(2));
      if (w.fighters[0].state !== "reversed") attackerFree = w.s.frame;
    }
    expect(attackerFree - at).toBe(REVERSAL.stun);
    // which is just enough for the defender's jab (Urban Reign: 12 + pad latency inside 15)
    expect(MOVES.jab1.startup).toBeLessThan(REVERSAL.stun);
  });

  it("grapples catch at once, whiff for about 45 frames and hold for 100", () => {
    expect(GRAB.startup).toBeLessThanOrEqual(1);
    expect(within(GRAB.startup + GRAB.active + GRAB.whiff, ur.grapple.whiffTotal)).toBe(true);
    expect(Math.abs(HOLD.dur - ur.grapple.hold)).toBeLessThanOrEqual(2);
    const w = duel(0.8, [ALL_ROUND, ALL_ROUND], RAW);
    tap(w, 0, BTN.GRAB);
    run(w, GRAB.startup + 1);
    expect(w.fighters[0].state).toBe("holding");
  });

  it("a knockdown keeps you down and getting up for about 100 frames", () => {
    expect(within(DOWN.dur, ur.knockdown.fallAndFloor)).toBe(true);
    expect(DOWN.wake).toBe(ur.knockdown.getUp);
  });
});
