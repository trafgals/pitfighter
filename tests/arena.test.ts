import { describe, expect, it } from "vitest";
import { Bot } from "../src/sim/ai";
import { SIT_FRAMES } from "../src/sim/moves";
import { SPAWN_R, TOILET_FRAMES, type PlayerInput } from "../src/sim/types";
import { World, spawnPoints } from "../src/sim/world";
import { BTN, duel, run, tap } from "./helpers";

describe("arena", () => {
  it.each([2, 3, 4, 5, 6, 7, 8])("%i fighters spawn evenly around the edge, facing the toilet", (n) => {
    const pts = spawnPoints(n);
    expect(pts).toHaveLength(n);
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(SPAWN_R, 6);
      const toCentre = Math.atan2(-p.y, -p.x);
      expect(Math.cos(p.facing - toCentre)).toBeCloseTo(1, 6);
    }
    const gap = (2 * Math.PI) / n;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(pts[i].y, pts[i].x);
      const b = Math.atan2(pts[(i + 1) % n].y, pts[(i + 1) % n].x);
      let d = b - a;
      while (d < 0) d += Math.PI * 2;
      expect(d).toBeCloseTo(gap, 6);
    }
  });

  it("rejects fewer than 2 or more than 8 fighters", () => {
    expect(() => new World({ seed: 1, styles: [0] })).toThrow();
    expect(() => new World({ seed: 1, styles: Array(9).fill(0) })).toThrow();
  });

  it("sit on the toilet for long enough and you win", () => {
    const w = duel(6);
    const a = w.fighters[0];
    Object.assign(a, { x: 0.6, y: 0 });
    tap(w, 0, BTN.USE);
    expect(a.state).toBe("sitting");
    expect(w.s.toiletOccupant).toBe(0);
    run(w, SIT_FRAMES + TOILET_FRAMES);
    expect(w.s.winner).toBe(0);
  });

  it("a hit knocks you off the toilet, but your progress is kept", () => {
    const w = duel(6);
    const [a, b] = w.fighters;
    Object.assign(a, { x: 0.6, y: 0 });
    tap(w, 0, BTN.USE);
    run(w, SIT_FRAMES + 100);
    const progress = a.toilet;
    expect(progress).toBeGreaterThan(90);
    Object.assign(b, { x: 1.0, y: 0, facing: Math.PI });
    tap(w, 1, BTN.HIGH);
    run(w, 10);
    expect(a.state).toBe("down");
    expect(w.s.toiletOccupant).toBe(-1);
    const kept = a.toilet;
    expect(kept).toBeGreaterThanOrEqual(progress);
    run(w, 30);
    expect(a.toilet).toBe(kept);
  });

  it("only one sinner fits on the toilet", () => {
    const w = duel(6);
    const [a, b] = w.fighters;
    Object.assign(a, { x: 0.6, y: 0 });
    Object.assign(b, { x: -0.7, y: 0 });
    tap(w, 0, BTN.USE);
    tap(w, 1, BTN.USE);
    expect(w.s.toiletOccupant).toBe(0);
    expect(b.state).not.toBe("sitting");
  });
});

describe("whole matches", () => {
  const playBots = (seed: number, n: number, frames: number) => {
    const w = new World({ seed, styles: Array.from({ length: n }, (_, i) => (i * 5 + seed) % 21) });
    const bots = w.fighters.map((f) => new Bot(f.id, seed));
    const hashes: number[] = [];
    for (let i = 0; i < frames && w.s.winner < 0; i++) {
      const inp: PlayerInput[] = bots.map((b) => b.think(w));
      w.step(inp);
      if (i % 60 === 0) hashes.push(w.hash());
      for (const f of w.fighters) {
        if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.parts.torso.hp)) throw new Error(`NaN at frame ${w.s.frame}`);
      }
    }
    return { w, hashes };
  };

  it("8 bots fight for 2 minutes with no NaNs, and things actually happen", () => {
    const { w } = playBots(42, 8, 7200);
    const totalKos = w.fighters.reduce((a, f) => a + f.kos, 0);
    const sat = w.fighters.some((f) => f.toilet > 0);
    expect(totalKos + (sat ? 1 : 0)).toBeGreaterThan(0);
  });

  it("a match is deterministic: same seed + inputs -> same states", () => {
    const a = playBots(7, 8, 3000).hashes;
    const b = playBots(7, 8, 3000).hashes;
    const c = playBots(8, 8, 3000).hashes;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("bot matches end with someone on the throne", () => {
    let wins = 0;
    for (const seed of [1, 2, 3]) if (playBots(seed, 8, 60 * 60 * 4).w.s.winner >= 0) wins++;
    expect(wins).toBeGreaterThan(0);
  });
});
