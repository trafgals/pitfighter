// The five stages: their rules (arena.ts) and that a full 8-bot match on each
// one is deterministic and ends with a winner.
import { describe, expect, it } from "vitest";
import { Bot } from "../src/sim/ai";
import { BLIMP, CASTLE, PIT, TOWER, VEHICLE_KINDS, onDeck, tileRing } from "../src/sim/arena";
import { FALL_FRAMES, KO_FRAMES } from "../src/sim/moves";
import { DEFAULT_STAGE, PLAYABLE_STAGES, STAGES, type StageId } from "../src/sim/stages";
import { BTN, NO_INPUT, type GameEvent, type PlayerInput } from "../src/sim/types";
import { World, alive } from "../src/sim/world";

/** step n frames; `inp(i)` gives the inputs of frame i; returns every event */
function run(w: World, n: number, inp: (i: number) => PlayerInput[] = () => w.fighters.map(() => NO_INPUT)): GameEvent[] {
  const evs: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    w.step(inp(i));
    evs.push(...w.s.events);
  }
  return evs;
}
const press = (b: number, x = 0, y = 0): PlayerInput => ({ x, y, buttons: b });
const two = (stage: StageId) => {
  const w = new World({ seed: 1, styles: [0, 0], humans: [true, true], stage });
  w.s.nextGeyser = 1e9; // no hazards unless a test asks for one
  return w;
};

describe("stages", () => {
  it("has five playable stages, Hell Toilet first and the default", () => {
    expect(STAGES.map((s) => [s.name, s.playable])).toEqual([
      ["Hell Toilet", true],
      ["Construction Site", true],
      ["Collapsing Tower", true],
      ["Hindenburg Blimp", true],
      ["Castle Under Siege", true],
    ]);
    expect(PLAYABLE_STAGES).toHaveLength(5);
    expect(DEFAULT_STAGE).toBe("hell-toilet");
    expect(new World({ seed: 1, styles: [0, 1] }).s.stage).toBe("hell-toilet");
  });

  for (const st of STAGES) {
    it(`${st.name}: an 8-bot match is deterministic and ends with a winner`, () => {
      const play = () => {
        const w = new World({ seed: 2, styles: [0, 3, 4, 10, 11, 1, 6, 9], humans: Array(8).fill(false), stage: st.id });
        const bots = w.fighters.map((f) => new Bot(f.id, 2));
        const hashes: number[] = [];
        for (let i = 0; i < 60 * 360 && w.s.winner < 0; i++) {
          w.step(bots.map((b) => b.think(w)));
          if (i % 600 === 0) hashes.push(w.hash());
        }
        return { w, hashes };
      };
      const a = play();
      const b = play();
      expect(a.hashes).toEqual(b.hashes);
      expect(a.w.s.winner).toBeGreaterThanOrEqual(0);
      for (const f of a.w.fighters) expect(Number.isFinite(f.x + f.y + f.facing)).toBe(true);
    }, 60000);
  }
});

describe("Construction Site", () => {
  it("everyone starts in a different construction vehicle", () => {
    const w = new World({ seed: 1, styles: Array(8).fill(0), stage: "construction-site" });
    expect(w.fighters.every((f) => f.state === "driving")).toBe(true);
    expect(new Set(w.s.arena.vehicles.map((v) => v.kind)).size).toBe(8);
    expect(w.s.arena.vehicles.map((v) => v.kind)).toEqual(VEHICLE_KINDS);
    expect(w.fighters.map((f) => f.vehicle)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("gets out with USE, and back in beside a free vehicle", () => {
    const w = two("construction-site");
    const [, b] = w.fighters;
    run(w, 2, (i) => [NO_INPUT, i === 0 ? press(BTN.USE) : NO_INPUT]);
    expect(b.state).toBe("idle");
    expect(b.vehicle).toBe(-1);
    expect(w.s.arena.vehicles[1].driver).toBe(-1);
    run(w, 2, (i) => [NO_INPUT, i === 0 ? press(BTN.USE) : NO_INPUT]);
    expect(b.state).toBe("driving");
    expect(b.vehicle).toBe(1);
  });

  it("runs people over", () => {
    const w = two("construction-site");
    const [a, b] = w.fighters;
    run(w, 2, (i) => [NO_INPUT, i === 0 ? press(BTN.USE) : NO_INPUT]);
    const v = w.s.arena.vehicles[0];
    Object.assign(b, { x: v.x + Math.cos(v.facing) * 4, y: v.y + Math.sin(v.facing) * 4 });
    const evs: GameEvent[] = [];
    for (let i = 0; i < 120 && !evs.some((e) => e.kind === "hit" && e.what === "ram"); i++) evs.push(...run(w, 1, () => [press(0, Math.cos(v.facing), Math.sin(v.facing)), NO_INPUT]));
    const ram = evs.find((e) => e.kind === "hit" && e.what === "ram");
    expect(ram).toMatchObject({ a: a.id, b: b.id });
    expect(b.parts.torso.hp).toBeLessThan(b.parts.torso.max);
  });

  it("strikes damage a vehicle, and a wreck throws its driver out", () => {
    const w = two("construction-site");
    const [a, b] = w.fighters;
    run(w, 2, (i) => [NO_INPUT, i === 0 ? press(BTN.USE) : NO_INPUT]);
    const v = w.s.arena.vehicles[0];
    // b walks up to a's machine and hits it
    Object.assign(b, { x: v.x + 1.5, y: v.y, facing: Math.PI });
    const hp = v.hp;
    const evs = run(w, 30, (i) => [NO_INPUT, i === 0 ? press(BTN.HIGH) : NO_INPUT]);
    expect(evs.some((e) => e.kind === "crash" && e.what === "strike" && e.a === b.id)).toBe(true);
    expect(v.hp).toBeLessThan(hp);
    v.hp = 1;
    run(w, 30, (i) => [NO_INPUT, i === 0 ? press(BTN.HIGH) : NO_INPUT]);
    expect(v.wrecked).toBe(true);
    expect(a.state).not.toBe("driving");
    expect(a.vehicle).toBe(-1);
  });

  it("the first to fill the foundation wins the yard", () => {
    const w = two("construction-site");
    w.fighters[1].toilet = PIT.need - 1;
    w.setState(w.fighters[1], "idle");
    w.fighters[1].vehicle = -1;
    Object.assign(w.fighters[1], { x: PIT.x, y: PIT.y });
    w.s.arena.sacks.push({ id: 99, kind: "rubble", value: 1, x: PIT.x, y: PIT.y, carrier: 1 });
    const evs = run(w, 2);
    expect(w.s.winner).toBe(1);
    expect(evs.some((e) => e.kind === "win")).toBe(true);
  });

  it("the crane drops steel beams", () => {
    const w = two("construction-site");
    run(w, 2, (i) => [NO_INPUT, i === 0 ? press(BTN.USE) : NO_INPUT]);
    const b = w.fighters[1];
    w.s.geysers.push({ kind: "beam", x: b.x, y: b.y, t: 0 });
    const evs = run(w, 90);
    expect(evs.some((e) => e.kind === "hit" && e.b === b.id && e.what === "beam")).toBe(true);
  });
});

describe("Collapsing Tower", () => {
  it("falls apart from the edges in, and the centre four tiles never go", () => {
    const w = two("collapsing-tower");
    Object.assign(w.fighters[0], { x: -0.5, y: 0.2 });
    Object.assign(w.fighters[1], { x: 0.5, y: -0.2 });
    const evs = run(w, 60 * 150);
    const cracks = evs.filter((e) => e.kind === "crack");
    const ringOf = (e: GameEvent) => tileRing(Math.floor((e.y! + 8) / TOWER.tile) * TOWER.n + Math.floor((e.x! + 8) / TOWER.tile));
    const first = cracks.slice(0, 12).map(ringOf);
    expect(first.reduce((a, b) => a + b, 0) / first.length).toBeGreaterThan(2.3);
    const tiles = w.s.arena.tiles;
    tiles.forEach((t, k) => expect(t).toBe(tileRing(k) === 0 ? 0 : -1));
    expect(w.fighters.every((f) => f.state !== "falling" && !f.out)).toBe(true);
  });

  it("you cannot walk off the edge", () => {
    const w = two("collapsing-tower");
    const a = w.fighters[0];
    Object.assign(a, { x: 7.3, y: 0 });
    run(w, 120, () => [press(0, 1, 0), NO_INPUT]);
    expect(a.x).toBeLessThan(8);
    expect(a.state).not.toBe("falling");
  });

  it("knocked off the edge, you fall and are out; the last one standing wins", () => {
    const w = two("collapsing-tower");
    const [a, b] = w.fighters;
    Object.assign(b, { x: 7.4, y: 0 });
    b.lastHitBy = a.id;
    w.knockDown(b, 1, 0, 3);
    const evs = run(w, FALL_FRAMES + 5);
    expect(evs.find((e) => e.kind === "fall")).toMatchObject({ a: b.id, b: a.id });
    expect(b.out).toBe(true);
    expect(a.kos).toBe(1);
    expect(w.s.winner).toBe(a.id);
  });
});

describe("Hindenburg Blimp", () => {
  it("a gust blows fighters across the deck", () => {
    const w = two("hindenburg-blimp");
    const a = w.fighters[0];
    Object.assign(a, { x: -2, y: 0 });
    Object.assign(w.fighters[1], { x: 4, y: 0 });
    w.s.arena.nextWind = 1;
    const evs = run(w, BLIMP.windWarn + 50);
    const warn = evs.find((e) => e.kind === "wind" && e.what === "warn")!;
    expect(warn).toBeDefined();
    expect(evs.some((e) => e.kind === "wind" && e.what === "gust")).toBe(true);
    expect(a.y * w.s.arena.windDir).toBeGreaterThan(0.8);
  });

  it("the fire burns whoever stands behind it", () => {
    const w = two("hindenburg-blimp");
    const a = w.fighters[0];
    Object.assign(a, { x: 7, y: 0 });
    w.s.arena.fireX = 6;
    run(w, 60);
    expect(a.parts.torso.hp).toBeLessThan(a.parts.torso.max);
  });

  it("the blimp hits the ground: everyone aboard is knocked down and hurt", () => {
    const w = two("hindenburg-blimp");
    const [a, b] = w.fighters;
    w.s.frame = BLIMP.crashAt - 1;
    const hp = a.parts.torso.hp;
    const evs = run(w, 1);
    expect(evs.some((e) => e.kind === "impact")).toBe(true);
    for (const f of [a, b]) expect(f.state).toBe("down");
    expect(a.parts.torso.hp).toBeCloseTo(hp - BLIMP.impactDmg, 5);
    expect(w.arena.headline(w)?.text).toMatch(/2 survivors in the burning wreck/);
  });

  it("before the crash a knockdown off the edge is a fall; after it the wreck's edge holds", () => {
    const w = two("hindenburg-blimp");
    const [a] = w.fighters;
    Object.assign(a, { x: 0, y: BLIMP.width + 0.2 });
    run(w, 1);
    expect(a.state).toBe("falling");

    const v = two("hindenburg-blimp");
    const [c] = v.fighters;
    v.s.frame = BLIMP.crashAt;
    run(v, 1);
    Object.assign(c, { x: 0, y: BLIMP.width + 0.5 });
    run(v, 1);
    expect(c.state).not.toBe("falling");
    expect(c.out).toBe(false);
    expect(onDeck(c.x, c.y)).toBe(true);
    // and you cannot walk off it either
    run(v, 120, () => [press(0, 0, 1), NO_INPUT]);
    expect(onDeck(c.x, c.y)).toBe(true);
  });

  it("in the wreck the burn grows every second, and when the fire burns out somebody wins with nobody dead", () => {
    const w = two("hindenburg-blimp");
    const [a, b] = w.fighters;
    // at the nose, away from the fire, and nobody presses a button: only the burn hurts here
    Object.assign(a, { x: -6, y: -2 });
    Object.assign(b, { x: -6, y: 2 });
    w.s.frame = BLIMP.crashAt - 1;
    run(w, 1);
    let prev = a.parts.torso.hp;
    const lost: number[] = [];
    for (let sec = 0; sec < 4; sec++) {
      run(w, 60 * 5);
      lost.push(prev - a.parts.torso.hp);
      prev = a.parts.torso.hp;
      if (!alive(a)) break;
    }
    expect(lost[1]).toBeGreaterThan(lost[0]); // it ramps
    // the fire strips them but never kills them; when it burns out one of them wins
    for (let k = 0; k < 3600 && w.s.winner < 0; k++) run(w, 1);
    expect(w.s.winner).toBeGreaterThanOrEqual(0);
    expect(w.fighters.every((f) => alive(f) && !f.out)).toBe(true);
    expect(w.s.frame - BLIMP.crashAt).toBe(BLIMP.wreckFor);
  });

  it("when the wreck burns out, whoever has the most limbs on wins", () => {
    const w = new World({ seed: 3, styles: [0, 1, 2], humans: [true, true, true], stage: "hindenburg-blimp" });
    const [a, b, c] = w.fighters;
    Object.assign(a, { x: -6, y: 0 });
    Object.assign(b, { x: 0, y: 0 });
    Object.assign(c, { x: 6, y: 0 });
    w.s.frame = BLIMP.crashAt + BLIMP.wreckFor - 2;
    for (const f of [a, b, c]) f.parts.torso.hp = 1e4; // nobody is stripped on the last ticks
    a.parts.armL.attached = false;
    c.parts.armL.attached = c.parts.legR.attached = false;
    run(w, 3);
    expect(w.s.winner).toBe(b.id);
  });

});

describe("Castle Under Siege", () => {
  it("the banner rises for the fighter nearest the pole, at half speed while contested", () => {
    const w = two("castle-under-siege");
    const [a, b] = w.fighters;
    Object.assign(a, { x: 0.3, y: 0 });
    Object.assign(b, { x: 1.2, y: 0 });
    const evs = run(w, 60);
    expect(evs.some((e) => e.kind === "capture" && e.a === a.id)).toBe(true);
    expect(a.toilet).toBeCloseTo(60 * CASTLE.contested, 5);
    expect(b.toilet).toBe(0);
    Object.assign(b, { x: 5, y: 0 });
    run(w, 60);
    expect(a.toilet).toBeCloseTo(60 * CASTLE.contested + 60, 5);
    a.toilet = CASTLE.bannerFrames - 1;
    run(w, 1);
    expect(w.s.winner).toBe(a.id);
  });

  it("the parapet holds, but a breach is a long way down (and you come back)", () => {
    const w = two("castle-under-siege");
    const [a, b] = w.fighters;
    Object.assign(a, { x: 0, y: -4.8 });
    w.knockDown(a, 0, -1, 3);
    run(w, 40);
    expect(a.y).toBeGreaterThanOrEqual(-CASTLE.hy);
    expect(a.state).not.toBe("falling");
    const br = CASTLE.breaches.find((x) => x.side === -1)!;
    Object.assign(b, { x: (br.x0 + br.x1) / 2, y: -4.8 });
    w.knockDown(b, 0, -1, 3);
    const evs = run(w, 40);
    expect(evs.some((e) => e.kind === "fall" && e.a === b.id)).toBe(true);
    run(w, FALL_FRAMES + KO_FRAMES + 5);
    expect(b.out).toBe(false);
    expect(b.state).toBe("idle");
    expect(b.deaths).toBe(1);
  });

  it("catapult stones knock you down, arrow volleys only sting", () => {
    const w = two("castle-under-siege");
    const [a, b] = w.fighters;
    Object.assign(a, { x: -4, y: 0 });
    Object.assign(b, { x: 4, y: 0 });
    w.s.geysers.push({ kind: "boulder", x: a.x, y: a.y, t: 0 }, { kind: "arrows", x: b.x, y: b.y, t: 0 });
    const evs = run(w, 80);
    expect(evs.some((e) => e.kind === "hit" && e.b === a.id && e.what === "boulder")).toBe(true);
    expect(evs.some((e) => e.kind === "hit" && e.b === b.id && e.what === "arrows")).toBe(true);
    expect(["down", "wakeup"]).toContain(a.state);
    expect(["down", "wakeup"]).not.toContain(b.state);
  });
});
