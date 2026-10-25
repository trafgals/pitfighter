// Free-form limbs: every limb rolls its own traits, the strikes it throws are
// generated from them inside Urban Reign's timing, and the roll goes wherever
// the limb goes. Property tests over many rolls are the guardrails.
import { describe, expect, it } from "vitest";
import ur from "../docs/calibration/urban-reign-movesets.json";
import { MOVES } from "../src/sim/moves";
import { PLAIN, UR_STRIKE, rollLimb, shape } from "../src/sim/limbs";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";
import { BTN, chop, duel, idle, run, tap } from "./helpers";

const STRIKES = ["jab1", "jab2", "jab3", "punchFin", "kick1", "kick2", "sweep"];
const styleOf = (label: string) => STYLES.findIndex((s) => s.style === label);
const rolled = (seed: number, styles = [0, 0]) => {
  const w = duel(1.0, styles, true, true);
  // duel() seeds every world alike; a different match seed is a different set of limbs
  return seed === 1 ? w : new World({ seed, styles, humans: styles.map(() => true), limbs: true });
};

describe("Urban Reign's timing bounds every generated strike", () => {
  it("UR_STRIKE is what the decoded movesets show (first hits 9..38, actions up to 90 frames: 5th..95th percentile)", () => {
    const used = new Set((ur.movesets as { actions: number[] }[]).flatMap((m) => m.actions));
    const acts = Object.values(ur.actions as Record<string, { id: number; startFrame: number; endFrame: number; hits: { first: number }[] }>)
      .filter((a) => used.has(a.id) && a.hits.length)
      .map((a) => [a.hits[0].first, a.endFrame - a.startFrame])
      .filter(([h, l]) => l > h);
    const q = (xs: number[], f: number) => [...xs].sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))];
    expect(Math.min(...acts.map(([h]) => h))).toBe(UR_STRIKE.startup[0]);
    expect(q(acts.map(([h]) => h), 0.95)).toBe(UR_STRIKE.startup[1]);
    expect(q(acts.map(([, l]) => l), 0.95)).toBe(UR_STRIKE.total[1]);
    expect(UR_STRIKE.total[0]).toBeLessThanOrEqual(Math.min(...acts.map(([, l]) => l)));
  });

  it("over 2000 rolled limbs, every strike starts and ends inside it", () => {
    for (let i = 0; i < 2000; i++) {
      const t = rollLimb(i * 7919, i % 8, i % 2 ? "armR" : "legL", i % 5, i % STYLES.length);
      for (const id of STRIKES) {
        const m = MOVES[id];
        const e = shape({ ...m, total: m.startup + m.active + m.recovery }, t);
        expect(e.startup).toBeGreaterThanOrEqual(UR_STRIKE.startup[0]);
        expect(e.startup).toBeLessThanOrEqual(UR_STRIKE.startup[1]);
        expect(e.total).toBeGreaterThanOrEqual(UR_STRIKE.total[0]);
        expect(e.total).toBeLessThanOrEqual(UR_STRIKE.total[1]);
        expect(e.total).toBe(e.startup + e.active + e.recovery);
        expect(e.dmg).toBeGreaterThan(0);
      }
    }
  });

  it("the plain limb is the frame data exactly", () => {
    const m = { ...MOVES.jab1, total: 43 };
    expect(shape(m, PLAIN)).toBe(m);
  });
});

describe("no two bodies play the same", () => {
  it("200 fighters of the same style, 200 different sets of frame data", () => {
    const sigs = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const w = rolled(seed + 100);
      const f = w.fighters[0];
      sigs.add(["jab1", "jab2", "kick1"].map((id) => { const e = w.eff(f, id); return `${e.startup}/${e.total}/${e.reach.toFixed(3)}/${e.dmg.toFixed(2)}`; }).join(" "));
    }
    expect(sigs.size).toBeGreaterThanOrEqual(198);
  });

  it("a string trades hands: the two arms of one body throw their own jabs", () => {
    let differ = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const w = rolled(seed + 500);
      const f = w.fighters[0];
      if (w.eff(f, "jab1").reach !== w.eff(f, "jab2").reach * (MOVES.jab1.reach / MOVES.jab2.reach)) differ++;
    }
    expect(differ).toBeGreaterThan(25);
  });

  it("the same match seed grows the same limbs (deterministic)", () => {
    const a = rolled(77).fighters[1];
    const b = rolled(77).fighters[1];
    expect(a.parts.armR.trait).toEqual(b.parts.armR.trait);
    expect(rolled(78).fighters[1].parts.armR.trait).not.toEqual(a.parts.armR.trait);
  });

  it("the style leans the roll: Power grows heavy arms, Speed fast ones", () => {
    const avg = (style: number, k: "mass" | "swing") => {
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += rollLimb(i, 0, "armR", 0, style)[k];
      return sum / 400;
    };
    expect(avg(styleOf("Power"), "mass")).toBeGreaterThan(avg(styleOf("Speed"), "mass") + 0.1);
    expect(avg(styleOf("Speed"), "swing")).toBeGreaterThan(avg(styleOf("Mighty"), "swing") + 0.1);
  });
});

describe("the roll goes where the limb goes", () => {
  it("a torn-off arm keeps its traits on whoever puts it on, and strikes with them there", () => {
    const w = rolled(9);
    const [a, b] = w.fighters;
    Object.assign(a, { x: -0.5, y: 4 });
    Object.assign(b, { x: 0.5, y: 4 });
    const trait = a.parts.armR.trait;
    chop(w, a, "armR", 1);
    chop(w, b, "armR", 0);
    const p = w.s.pickups.find((q) => q.owner === a.id && q.part === "armR")!;
    expect(p.trait).toEqual(trait);
    Object.assign(p, { x: b.x, y: b.y, z: 0, vx: 0, vy: 0, vz: 0 });
    b.invuln = 0;
    Object.assign(b, { state: "idle", t: 0 });
    run(w, 30); // let the chop's knockdown play out
    Object.assign(b, { state: "idle", t: 0, stop: 0 });
    Object.assign(p, { x: b.x, y: b.y, z: 0 });
    tap(w, 1, BTN.GRAB);
    run(w, 40);
    expect(b.parts.armR.attached).toBe(true);
    expect(b.parts.armR.trait).toEqual(trait);
  });

  it("a limb that grows back is a new limb with a new roll", () => {
    const w = rolled(21);
    const f = w.fighters[0];
    const old = f.parts.legL.trait;
    chop(w, f, "legL", 1);
    w.s.pickups = [];
    f.parts.legL.regrow = 1;
    w.step(idle(2));
    expect(f.parts.legL.attached).toBe(true);
    expect(f.parts.legL.trait).not.toEqual(old);
  });
});

describe("whatever the limbs, the string is still a true combo", () => {
  it("over 40 rolled bodies, a mashed string never lets the victim out of stun before the finisher", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = rolled(seed + 900);
      const [a, b] = w.fighters;
      Object.assign(a, { x: -0.5, y: 4, facing: 0 });
      Object.assign(b, { x: 0.5, y: 4, facing: Math.PI });
      w.s.nextGeyser = 1e9;
      let hits = 0;
      let gap = false;
      run(w, 120, (inp, i) => {
        if (i % 4 === 0 && b.state !== "air") inp[0].buttons = BTN.HIGH;
        hits += w.s.events.filter((e) => e.kind === "hit" && e.b === 1).length;
        if (hits > 0 && hits < 3 && b.state === "idle") gap = true;
      });
      expect(gap, `seed ${seed + 900}`).toBe(false);
      expect(hits, `seed ${seed + 900}`).toBeGreaterThanOrEqual(3);
    }
  });
});
