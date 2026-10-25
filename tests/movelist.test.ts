// The move list is read off the sim: the frame data the fighter's own limbs
// give their strings, the special and the air grab. Reading it changes nothing.
import { describe, expect, it } from "vitest";
import { moveSheet } from "../src/movelist";
import { AIR_GRABS } from "../src/sim/airgrabs";
import { UR_STRIKE } from "../src/sim/limbs";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";
import { chop } from "./helpers";

const styleOf = (label: string) => STYLES.findIndex((s) => s.style === label);
const rolled = (style: number, seed = 5) => new World({ seed, styles: [style, 0], humans: [true, false], limbs: true });

describe("the move list", () => {
  it("lists each style's strings as they play: the jabs its string allows, then the launcher", () => {
    const ids = (label: string) => moveSheet(rolled(styleOf(label)), rolled(styleOf(label)).fighters[0]);
    expect(ids("All-Round").punches.map((r) => r.id)).toEqual(["jab1", "jab2", "punchFin"]);
    expect(ids("Boxing").punches.map((r) => r.id)).toEqual(["jab1", "jab2", "jab3", "punchFin"]);
    expect(ids("Mighty").punches.map((r) => r.id)).toEqual(["jab1", "punchFin"]);
    expect(ids("Karate").kicks.map((r) => r.id)).toEqual(["kick1", "kick2", "sweep"]);
    expect(ids("All-Round").punches.at(-1)!.note).toMatch(/launch/);
  });

  it("its frame data is the fighter's own (World.eff), inside Urban Reign's timing", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = rolled(seed % STYLES.length, seed);
      const f = w.fighters[0];
      const s = moveSheet(w, f);
      for (const r of [...s.punches, ...s.kicks, ...s.extras]) {
        const e = w.eff(f, r.id);
        expect([r.startup, r.active, r.recovery, r.total]).toEqual([e.startup, e.active, e.recovery, e.total]);
        expect(r.limb).toBe(w.strikerOf(f, r.id));
      }
      for (const r of [...s.punches, ...s.kicks]) {
        expect(r.startup).toBeGreaterThanOrEqual(UR_STRIKE.startup[0]);
        expect(r.total).toBeLessThanOrEqual(UR_STRIKE.total[1]);
      }
    }
  });

  it("names the style's air grab and special", () => {
    for (let i = 0; i < STYLES.length; i++) {
      const w = rolled(i);
      const s = moveSheet(w, w.fighters[0]);
      expect(s.airGrab.name).toBe(AIR_GRABS[STYLES[i].style].name);
      expect(s.extras.map((r) => r.id)).toEqual(["dashStrike", STYLES[i].special]);
      expect(s.extras[1].name).toMatch(/^[A-Z ]+$/);
    }
  });

  it("changes with the body: lose the left arm and the right throws the whole string", () => {
    const w = rolled(0);
    const f = w.fighters[0];
    expect(moveSheet(w, f).punches.map((r) => r.limb)).toEqual(["armR", "armL", "armR"]);
    chop(w, f, "armL", 1);
    const s = moveSheet(w, f);
    expect(s.punches.map((r) => r.limb)).toEqual(["armR", "armR", "armR"]);
    expect(s.limbs.find((l) => l.part === "armL")!.attached).toBe(false);
  });

  it("reading it changes nothing in the world", () => {
    const w = rolled(4);
    const before = w.hash();
    for (const f of w.fighters) moveSheet(w, f);
    expect(w.hash()).toBe(before);
  });
});
