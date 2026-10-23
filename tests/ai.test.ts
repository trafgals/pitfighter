// The crowd AI: attack tokens keep the bots from all piling onto one target.
import { describe, expect, it } from "vitest";
import { Bot, CIRCLE_R, TOKENS, hasToken } from "../src/sim/ai";
import { FURY } from "../src/sim/moves";
import { NO_INPUT, type PlayerInput } from "../src/sim/types";
import { World, dist } from "../src/sim/world";

/** n bots spread around fighter 0, a dummy at (0, 5) */
function mob(n: number, seed = 5): { w: World; bots: Bot[] } {
  const w = new World({ seed, styles: Array(n + 1).fill(0), humans: [true, ...Array(n).fill(false)] });
  w.s.nextGeyser = 1e9;
  const [t, ...rest] = w.fighters;
  Object.assign(t, { x: 0, y: 5 });
  rest.forEach((f, i) => {
    const a = (i / n) * Math.PI * 2;
    Object.assign(f, { x: Math.cos(a) * 3.5, y: 5 + Math.sin(a) * 2.5 });
  });
  return { w, bots: rest.map((f) => new Bot(f.id, seed, 0.6)) };
}

describe("crowd AI", () => {
  it("only the nearest fighters hold a target's attack tokens", () => {
    const { w } = mob(5);
    const [t, ...rest] = w.fighters;
    rest.forEach((f, i) => Object.assign(f, { x: 1 + i, y: 5 }));
    const holders = rest.filter((f) => hasToken(w, f, t)).map((f) => f.id);
    expect(holders).toEqual(rest.slice(0, TOKENS.normal).map((f) => f.id));
  });

  it("the throne sitter gets one more attacker than anyone else", () => {
    expect(TOKENS.throne).toBe(TOKENS.normal + 1);
  });

  /** five bots against a throne sitter; returns attackers-at-once stats */
  function siege(tokens: number) {
    const saved = TOKENS.throne;
    TOKENS.throne = tokens;
    try {
      const { w, bots } = mob(5);
      const t = w.fighters[0];
      for (const f of w.fighters.slice(1)) Object.assign(f, { x: f.x, y: f.y - 5 });
      let sum = 0;
      let worst = 0;
      let waiting = 0;
      let hits = 0;
      const frames = 900;
      for (let i = 0; i < frames; i++) {
        // keep the dummy on the throne, unhurt and never winning: every bot's target
        Object.assign(t, { x: 0, y: 0, slideX: 0, slideY: 0, state: "seated", stop: 0, toilet: 0, invuln: 0 });
        w.s.toiletOccupant = 0;
        t.parts.torso.hp = t.parts.torso.max;
        w.step([NO_INPUT, ...bots.map((b) => b.think(w))] as PlayerInput[]);
        hits += w.s.events.filter((e) => e.kind === "hit" && e.b === 0).length;
        if (i < 120) continue; // let them gather first
        // fighters attacking the sitter right now (bodies knocked down beside it do not count)
        const near = w.fighters.filter((f) => f.id !== 0 && dist(f, t) < 1.6 && (f.state === "attack" || f.state === "holding")).length;
        sum += near;
        worst = Math.max(worst, near);
        if (w.fighters.some((f) => f.id !== 0 && Math.abs(dist(f, t) - CIRCLE_R) < 0.8)) waiting++;
      }
      return { mean: sum / (frames - 120), worst, waiting: waiting / (frames - 120), hits };
    } finally {
      TOKENS.throne = saved;
    }
  }

  it("bots take turns on the throne sitter instead of all piling in", () => {
    const turns = siege(TOKENS.throne);
    const pile = siege(99);
    expect(turns.hits).toBeGreaterThan(5); // they do fight it
    expect(turns.worst).toBeLessThanOrEqual(TOKENS.throne + 1); // one more may still be finishing a swing it started with a token
    expect(turns.mean).toBeLessThan(pile.mean);
    expect(turns.waiting).toBeGreaterThan(pile.waiting); // the rest circle, waiting their turn
  });

  it("bots spend fury on their specials", () => {
    const w = new World({ seed: 11, styles: [0, 3, 4, 15, 17, 1, 6, 9], humans: Array(8).fill(false) });
    const bots = w.fighters.map((f) => new Bot(f.id, 11));
    let specials = 0;
    for (let i = 0; i < 60 * 90 && w.s.winner < 0; i++) {
      w.step(bots.map((b) => b.think(w)));
      specials += w.s.events.filter((e) => e.kind === "special").length;
    }
    expect(specials).toBeGreaterThan(0);
    for (const f of w.fighters) expect(f.fury).toBeLessThanOrEqual(FURY.max);
  });
});
