// The twelve fighters play differently: each throws strikes from its own table
// (built from characters.json), inside Urban Reign's timing, and each family has
// one mechanic only it has.
import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/data/characters";
import { UR_STRIKE } from "../src/sim/limbs";
import { FAMILY, familyRules, movesetOf, type Mv } from "../src/sim/movesets";
import { World } from "../src/sim/world";
import { duel } from "./helpers";

const N = CHARACTERS.length;
const slots = (s: number) => {
  const set = movesetOf(s);
  return [...new Set([...set.high, ...set.low, ...Object.keys(set.moves)])];
};
/** frame data, reach and damage of a table, as one comparable string */
const profile = (s: number) =>
  slots(s)
    .map((id) => {
      const m = movesetOf(s).moves[id] as Mv;
      return m ? `${id}:${m.startup}/${m.active}/${m.recovery}/${m.dmg}/${m.reach}` : id;
    })
    .join("|");

describe("per-fighter movesets", () => {
  it("there is a table for every fighter and no two fighters share frame data, reach and damage", () => {
    const seen = new Map<string, number>();
    for (let s = 0; s < N; s++) {
      const p = profile(s);
      expect(seen.has(p), `${CHARACTERS[s].id} duplicates ${CHARACTERS[seen.get(p) ?? 0]?.id}`).toBe(false);
      seen.set(p, s);
    }
    expect(seen.size).toBe(N);
  });

  it("every pair differs in more than a few moves (not one number nudged)", () => {
    for (let a = 0; a < N; a++)
      for (let b = a + 1; b < N; b++) {
        const diff = slots(a).filter((id) => {
          const x = movesetOf(a).moves[id];
          const y = movesetOf(b).moves[id];
          return !x || !y || x.startup !== y.startup || x.dmg !== y.dmg || x.reach !== y.reach || x.recovery !== y.recovery;
        });
        expect(diff.length, `${CHARACTERS[a].id} vs ${CHARACTERS[b].id}`).toBeGreaterThanOrEqual(3);
      }
  });

  it("every strike keeps inside the Urban Reign timing envelope", () => {
    for (let s = 0; s < N; s++) {
      const sets = [movesetOf(s), movesetOf(s).alt].filter((x): x is NonNullable<typeof x> => !!x);
      for (const set of sets)
        for (const [id, m] of Object.entries(set.moves)) {
          if (m.kind === "special") continue;
          const why = `${CHARACTERS[s].id} ${id}`;
          expect(m.startup, why).toBeGreaterThanOrEqual(UR_STRIKE.startup[0]);
          expect(m.startup, why).toBeLessThanOrEqual(UR_STRIKE.startup[1]);
          expect(m.startup + m.active + m.recovery, why).toBeLessThanOrEqual(UR_STRIKE.total[1]);
        }
    }
  });

  it("each family has a rule line, and each fighter has at least one mechanic no other family shares", () => {
    const lines = new Set(Object.values(FAMILY).map((r) => r.mechanic));
    expect(lines.size).toBe(Object.keys(FAMILY).length);
    for (const c of CHARACTERS) expect(familyRules(c.family).mechanic.length).toBeGreaterThan(20);
  });

  it("the sim reads the table: the same slot is a different strike for different fighters", () => {
    const w = duel(1.0, [0, 3]);
    const [a, b] = w.fighters;
    expect(w.mv(a, "jab1").startup === w.mv(b, "jab1").startup && w.mv(a, "jab1").dmg === w.mv(b, "jab1").dmg).toBe(false);
  });

  it("is deterministic: the same inputs give the same hash", () => {
    const run = () => {
      const w = new World({ seed: 7, styles: [2, 9], humans: [false, false] });
      for (let i = 0; i < 300; i++) w.step([{ x: 0, y: 0, buttons: i % 7 === 0 ? 1 : 0 }, { x: 0, y: 0, buttons: i % 11 === 0 ? 2 : 0 }]);
      return w.hash();
    };
    expect(run()).toBe(run());
  });
});

describe("family mechanics", () => {
  const byFamily = (fam: string) => CHARACTERS.map((c, i) => ({ c, i })).filter((x) => x.c.family === fam);

  it("boxers throw no kicks and have the weave counter", () => {
    for (const { i } of byFamily("boxing")) {
      const set = movesetOf(i);
      expect(set.moves.weave).toBeTruthy();
      expect(set.low.every((id) => set.moves[id]?.kind !== "kick")).toBe(true);
    }
  });

  it("power fighters have armoured heavies and a command grab, and their holds cannot be broken", () => {
    for (const { i } of byFamily("power")) {
      const ms = Object.values(movesetOf(i).moves);
      expect(ms.some((m) => m.armor)).toBe(true);
      expect(ms.some((m) => m.cmdGrab)).toBe(true);
    }
    expect(familyRules("power").unbreakable).toBe(true);
  });

  it("the grappler has a command grab; kung fu has a second stance", () => {
    for (const { i } of byFamily("grappler")) expect(Object.values(movesetOf(i).moves).some((m) => m.cmdGrab)).toBe(true);
    for (const { i } of byFamily("kungfu")) expect(movesetOf(i).alt).toBeTruthy();
  });

  it("Muay clinch knees are faster and harder; elbows bleed", () => {
    for (const { i } of byFamily("muay")) {
      expect(familyRules("muay").knees.max).toBeGreaterThan(familyRules("boxing").knees.max);
      expect(Object.values(movesetOf(i).moves).some((m) => m.bleed)).toBe(true);
    }
  });

  it("karate finishers charge", () => {
    for (const { i } of byFamily("karate")) expect(Object.values(movesetOf(i).moves).some((m) => m.chargeable)).toBe(true);
  });

  it("brawlers have dirt and a low blow", () => {
    for (const { i } of byFamily("brawler")) {
      const ms = Object.values(movesetOf(i).moves);
      expect(ms.some((m) => m.blind)).toBe(true);
      expect(ms.some((m) => m.lowBlow)).toBe(true);
    }
  });

  it("the kicker's strings lead with a kick", () => {
    for (const { i } of byFamily("kicker")) {
      const set = movesetOf(i);
      expect(set.moves[set.high[0]].kind).toBe("kick");
    }
  });
});
