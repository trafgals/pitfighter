// The violence bar: what fills it, what a full one buys, and that bots use it.
import { describe, expect, it } from "vitest";
import { VIOLENCE } from "../src/sim/moves";
import { Bot } from "../src/sim/ai";
import { World } from "../src/sim/world";
import { BTN, chop, duel, run, tap } from "./helpers";

describe("violence", () => {
  it("fills with damage dealt", () => {
    const w = duel(1);
    w.damage(w.fighters[1], "torso", 10, 0);
    expect(w.fighters[0].violence).toBeCloseTo(10 * VIOLENCE.dmg);
    expect(w.fighters[1].violence).toBe(0);
  });

  it("does not fill from hurting yourself or the arena", () => {
    const w = duel(1);
    w.damage(w.fighters[0], "torso", 10, 0);
    w.damage(w.fighters[0], "torso", 10, -1);
    expect(w.fighters[0].violence).toBe(0);
  });

  it("fills for a limb torn off", () => {
    const w = duel(1);
    const b = w.fighters[1];
    b.parts.armL.hp = 1;
    w.damage(b, "armL", 1, 0);
    expect(w.fighters[0].violence).toBeGreaterThanOrEqual(VIOLENCE.limb);
  });

  it("fills for a strip", () => {
    const w = duel(1);
    chop(w, w.fighters[1], "torso", 0);
    expect(w.fighters[0].violence).toBeGreaterThanOrEqual(VIOLENCE.strip);
    expect(w.s.events.some((e) => e.kind === "strip")).toBe(true);
  });

  it("is capped at the top of the bar", () => {
    const w = duel(1);
    w.addViolence(w.fighters[0], 1000);
    expect(w.fighters[0].violence).toBe(VIOLENCE.max);
  });

  it("a full bar makes the taunt an appeal that hands over the fighter's signature", () => {
    // Lady Bulwark's signature is the piston gauntlet
    const w = new World({ seed: 3, styles: [6, 6], humans: [true, true] });
    w.s.nextGeyser = 1e9;
    w.s.gifts = [];
    w.fighters[0].violence = VIOLENCE.max;
    tap(w, 0, BTN.TAUNT);
    run(w, 120);
    const appeal = w.s.events.length >= 0 && w.s.gifts[0];
    expect(appeal && appeal.prop).toBe("weapon_piston_gauntlet");
    expect(w.fighters[0].violence).toBe(0);
  });

  it("is in the hash", () => {
    const w = duel(1);
    const h = w.hash();
    w.fighters[0].violence = 50;
    expect(w.hash()).not.toBe(h);
  });

  it("a bot with a full bar appeals", () => {
    const w = new World({ seed: 5, styles: [0, 1], humans: [false, false] });
    w.s.nextGeyser = 1e9;
    w.fighters[0].violence = VIOLENCE.max;
    const bots = w.fighters.map((f) => new Bot(f.id, 5, 0.6));
    let appealed = false;
    for (let i = 0; i < 1500 && !appealed; i++) {
      w.step(bots.map((b) => b.think(w)));
      appealed = w.s.events.some((e) => e.kind === "appeal");
    }
    expect(appealed).toBe(true);
  });
});
