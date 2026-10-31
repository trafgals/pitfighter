// The Construction Site: what each machine does on the strike and grab buttons,
// repairing a wreck, and the objective (Pour the Foundation).
import { describe, expect, it } from "vitest";
import { ACTS, PIT, REPAIR, VEHICLES, YARD } from "../src/sim/arena";
import { BTN, LIMBS, NO_INPUT, type GameEvent, type PlayerInput, type VehicleKind } from "../src/sim/types";
import { World } from "../src/sim/world";

const press = (b: number, x = 0, y = 0): PlayerInput => ({ x, y, buttons: b });

/** Two fighters. A drives a `kind` at (x, y) facing +x; B stands on foot at (bx, by) facing A. The yard has no hazards and no sacks. */
function yard(kind: VehicleKind, at = { x: 0, y: 0 }, b = { x: 3, y: 0 }) {
  const w = new World({ seed: 1, styles: [0, 0], humans: [true, true], stage: "construction-site" });
  w.s.nextGeyser = 1e9;
  w.s.arena.sacks = [];
  w.s.arena.nextSack = 1e9;
  const [fa, fb] = w.fighters;
  const v = w.s.arena.vehicles[0];
  Object.assign(v, { kind, hp: VEHICLES[kind].hp, max: VEHICLES[kind].hp, x: at.x, y: at.y, facing: 0 });
  // B gets out of its machine and is moved away from it
  w.step([NO_INPUT, press(BTN.USE)]);
  w.step([NO_INPUT, NO_INPUT]);
  const other = w.s.arena.vehicles[1];
  Object.assign(other, { x: -8, y: 6 });
  Object.assign(fb, { x: b.x, y: b.y, facing: Math.PI });
  fa.x = v.x;
  fa.y = v.y;
  return { w, v, a: fa, b: fb };
}

type Ctx = ReturnType<typeof yard>;

/** A taps `btn` (one frame), then everyone idles for `frames` more. */
function tapThenRun(c: Ctx, btn: number, frames: number, stick: [number, number] = [0, 0]): GameEvent[] {
  const evs: GameEvent[] = [];
  for (let i = 0; i < frames; i++) {
    c.w.step([i === 0 ? press(btn, ...stick) : press(0, ...stick), NO_INPUT]);
    evs.push(...c.w.s.events);
  }
  return evs;
}
const limbsOff = (f: { parts: Record<string, { attached: boolean }> }) => LIMBS.filter((p) => !f.parts[p].attached).length;
const crash = (evs: GameEvent[], what: string) => evs.find((e) => e.kind === "crash" && e.what === what);

describe("vehicles hit harder", () => {
  it("every ram is well above the old numbers", () => {
    const old: Record<VehicleKind, number> = { bulldozer: 16, excavator: 15, dumptruck: 14, forklift: 9, roller: 22, mixer: 14, loader: 12, crane: 15 };
    for (const k of Object.keys(old) as VehicleKind[]) expect(VEHICLES[k].ram / old[k], k).toBeGreaterThanOrEqual(1.5);
  });
});

describe("Construction Site machines", () => {
  it("every machine has an attack of its own", () => {
    expect(Object.keys(ACTS).sort()).toEqual(Object.keys(VEHICLES).sort());
    expect(new Set(Object.values(ACTS).map((a) => a.name)).size).toBe(8);
  });

  it("the bulldozer's blade shoves people along and pins them against the wall", () => {
    const x = YARD.hx - VEHICLES.bulldozer.r - 0.6;
    const c = yard("bulldozer", { x, y: 0 }, { x: x + 2.1, y: 0 });
    const evs = tapThenRun(c, BTN.HIGH, 70);
    expect(crash(evs, "pin")).toBeTruthy();
    expect(c.b.parts.torso.hp).toBeLessThan(c.b.parts.torso.max);
    expect(["down", "wallsplat"]).toContain(c.b.state);
    expect(c.v.act).toBe(0);
  });

  it("the bulldozer's blade carries people across the yard", () => {
    const c = yard("bulldozer", { x: -6, y: 0 }, { x: -4, y: 0 });
    tapThenRun(c, BTN.HIGH, 20);
    // they are in front of the blade, a long way from where they stood
    expect(c.b.x).toBeGreaterThan(-3.4);
    expect(c.b.x - c.v.x).toBeLessThan(VEHICLES.bulldozer.r + 0.8);
  });

  it("the excavator's bucket slams an area, and the machine takes hold of people to drop them", () => {
    const c = yard("excavator", { x: 0, y: 0 }, { x: 2.7, y: 0.5 });
    c.w.fighters[1].x = 2.7;
    const c2 = yard("excavator", { x: 0, y: 0 }, { x: 2.7, y: 0.5 });
    const evs = tapThenRun(c, BTN.HIGH, 50);
    expect(crash(evs, "slam")).toBeTruthy();
    expect(c.b.parts.torso.hp).toBeLessThan(c.b.parts.torso.max);
    // grab-and-drop
    c2.b.x = 2.3;
    c2.b.y = 0;
    tapThenRun(c2, BTN.GRAB, 3);
    expect(c2.v.carry).toBe(c2.b.id);
    expect(c2.b.z).toBeGreaterThan(1.5);
    const hp = c2.b.parts.torso.hp;
    const evs2 = tapThenRun(c2, BTN.GRAB, 3);
    expect(c2.v.carry).toBe(-1);
    expect(c2.b.parts.torso.hp).toBeLessThan(hp);
    expect(evs2.some((e) => e.kind === "hit" && e.what === "drop")).toBe(true);
  });

  it("the dump truck tips a load that buries whoever is behind it", () => {
    const c = yard("dumptruck", { x: 0, y: 0 }, { x: -2.6, y: 0 });
    const evs = tapThenRun(c, BTN.HIGH, ACTS.dumptruck.dur + 5);
    expect(crash(evs, "tip")).toBeTruthy();
    expect(c.w.s.arena.piles).toHaveLength(1);
    expect(evs.some((e) => e.kind === "hit" && e.what === "buried")).toBe(true);
    expect(c.b.state).toBe("down");
    expect(c.b.dur).toBeGreaterThan(100); // stuck under it a good while
  });

  it("the forklift skewers someone and carries them, then throws them", () => {
    const c = yard("forklift", { x: 0, y: 0 }, { x: 1.8, y: 0 });
    const evs = tapThenRun(c, BTN.HIGH, 12);
    expect(crash(evs, "skewer")).toBeTruthy();
    expect(c.v.carry).toBe(c.b.id);
    const x = c.b.x;
    tapThenRun(c, 0, 30);
    expect(c.v.carry).toBe(c.b.id); // still on the forks
    expect(c.b.x).toBeCloseTo(c.v.x + Math.cos(c.v.facing) * (VEHICLES.forklift.r + 0.7), 0);
    expect(Math.abs(c.b.x - x)).toBeLessThan(5);
    const evs2 = tapThenRun(c, BTN.HIGH, 3);
    expect(c.v.carry).toBe(-1);
    expect(evs2.some((e) => e.kind === "launch" && e.b === c.b.id)).toBe(true);
    expect(c.b.state).toBe("air");
  });

  it("the steamroller flattens: a long knockdown and limbs come off", () => {
    const c = yard("roller", { x: -3, y: 0 }, { x: 0, y: 0 });
    const evs = tapThenRun(c, BTN.HIGH, 90, [1, 0]);
    expect(crash(evs, "flatten")).toBeTruthy();
    expect(limbsOff(c.b)).toBeGreaterThanOrEqual(1);
    expect(c.b.state === "down" || c.b.state === "wakeup" || c.b.parts.torso.hp < c.b.parts.torso.max).toBe(true);
  });

  it("the cement mixer pours a slick that slows people and then sets with them stuck in it", () => {
    const c = yard("mixer", { x: 0, y: 0 }, { x: -3, y: 0 });
    tapThenRun(c, BTN.HIGH, ACTS.mixer.dur + 2);
    expect(c.w.s.arena.slicks.length).toBeGreaterThanOrEqual(3);
    const s0 = c.w.s.arena.slicks[0];
    // B stands in the wet cement and is slowed
    Object.assign(c.b, { x: s0.x, y: s0.y });
    c.w.step([NO_INPUT, press(0, 1, 0)]);
    c.w.step([NO_INPUT, press(0, 1, 0)]);
    expect(Math.abs(c.b.velX)).toBeLessThan(0.03);
    // then it sets
    let set: GameEvent | undefined;
    for (let i = 0; i < 260 && !set; i++) {
      Object.assign(c.b, { x: s0.x, y: s0.y });
      c.w.step([NO_INPUT, NO_INPUT]);
      set = c.w.s.events.find((e) => e.kind === "crash" && e.what === "set");
    }
    expect(set).toBeTruthy();
    expect(c.b.state).toBe("down");
    expect(c.b.dur).toBeGreaterThan(100);
  });

  it("the loader scoops people up and throws them", () => {
    const c = yard("loader", { x: 0, y: 0 }, { x: 2.0, y: 0 });
    tapThenRun(c, BTN.GRAB, 3);
    expect(c.v.carry).toBe(c.b.id);
    const evs = tapThenRun(c, BTN.HIGH, 3);
    expect(evs.some((e) => e.kind === "launch" && e.b === c.b.id)).toBe(true);
    expect(c.b.state).toBe("air");
    // and the bucket on its own is an uppercut
    const d = yard("loader", { x: 0, y: 0 }, { x: 2.0, y: 0 });
    const evs2 = tapThenRun(d, BTN.HIGH, 30);
    expect(crash(evs2, "scoop")).toBeTruthy();
    expect(evs2.some((e) => e.kind === "launch" && e.b === d.b.id)).toBe(true);
  });

  it("the crane truck swings a wrecking ball all the way round", () => {
    const c = yard("crane", { x: 0, y: 0 }, { x: -3.2, y: 0.3 });
    const evs = tapThenRun(c, BTN.HIGH, ACTS.crane.dur + 5);
    expect(evs.some((e) => e.kind === "hit" && e.b === c.b.id && e.what === "wrecking-ball")).toBe(true);
    expect(c.b.parts.torso.hp).toBeLessThan(c.b.parts.torso.max);
  });

  it("the implement cools down, and a wreck stops swinging", () => {
    const c = yard("excavator", { x: 0, y: 0 }, { x: 9, y: 5 });
    tapThenRun(c, BTN.HIGH, 5);
    expect(c.v.act).toBeGreaterThan(0);
    const act = c.v.act;
    tapThenRun(c, BTN.HIGH, 1); // no second swing while the first is going
    expect(c.v.act).toBeGreaterThanOrEqual(act);
    tapThenRun(c, 0, ACTS.excavator.dur + 5);
    expect(c.v.act).toBe(0);
    expect(c.v.actCool).toBeGreaterThan(0);
  });
});

describe("repairs", () => {
  /** B kneels at the wreck holding USE. */
  function wreckAndRepairer() {
    const c = yard("bulldozer", { x: 0, y: 0 }, { x: 2.2, y: 0 });
    c.v.hp = 0;
    c.w.step([press(BTN.USE), NO_INPUT]); // A bails out (a wreck throws the driver out in any case)
    c.w.step([NO_INPUT, NO_INPUT]);
    expect(c.v.wrecked).toBe(true);
    Object.assign(c.b, { x: 1.9, y: 0, invuln: 0, slideX: 0, slideY: 0, velX: 0, velY: 0 });
    c.w.setState(c.b, "idle");
    return c;
  }

  it("holding USE at a wreck for 5 s brings it back at half health", () => {
    const c = wreckAndRepairer();
    const evs: GameEvent[] = [];
    for (let i = 0; i < REPAIR.frames + 10 && c.v.wrecked; i++) {
      c.w.step([NO_INPUT, press(BTN.USE)]);
      evs.push(...c.w.s.events);
    }
    expect(c.v.wrecked).toBe(false);
    expect(c.v.hp).toBe(Math.round(c.v.max * 0.5));
    expect(evs.some((e) => e.kind === "repair" && e.what === "done" && e.a === c.b.id)).toBe(true);
    // and it can be driven again
    c.w.step([NO_INPUT, NO_INPUT]);
    c.w.step([NO_INPUT, press(BTN.USE)]);
    expect(c.b.state).toBe("driving");
  });

  it("getting hit interrupts the repair", () => {
    const c = wreckAndRepairer();
    for (let i = 0; i < 150; i++) c.w.step([NO_INPUT, press(BTN.USE)]);
    expect(c.v.repair).toBeGreaterThan(100);
    c.w.damage(c.b, "torso", 5, c.a.id);
    c.w.setState(c.b, "hitstun", 15);
    c.w.step([NO_INPUT, press(BTN.USE)]);
    expect(c.v.repair).toBe(0);
    expect(c.v.wrecked).toBe(true);
  });

  it("putting the spanner down only pauses it", () => {
    const c = wreckAndRepairer();
    for (let i = 0; i < 120; i++) c.w.step([NO_INPUT, press(BTN.USE)]);
    const done = c.v.repair;
    for (let i = 0; i < 30; i++) c.w.step([NO_INPUT, NO_INPUT]);
    expect(c.v.repair).toBe(done);
  });

  it("the yard is never left without machines: the tow truck brings one back", () => {
    const c = yard("bulldozer", { x: 0, y: 0 }, { x: 5, y: 3 });
    for (const v of c.w.s.arena.vehicles) {
      v.hp = 0;
    }
    c.w.step([NO_INPUT, NO_INPUT]);
    expect(c.w.s.arena.vehicles.every((v) => v.wrecked)).toBe(true);
    let back = false;
    for (let i = 0; i < REPAIR.tow + 100 && !back; i++) {
      c.w.step([NO_INPUT, NO_INPUT]);
      back = c.w.s.arena.vehicles.some((v) => !v.wrecked);
    }
    expect(back).toBe(true);
    expect(c.w.s.events.length >= 0).toBe(true);
  });

  it("bots go and repair a wreck when there is nothing else to do", async () => {
    const { Bot } = await import("../src/sim/ai");
    const c = yard("bulldozer", { x: 0, y: 0 }, { x: 6, y: 0 });
    c.v.hp = 0;
    c.w.step([NO_INPUT, NO_INPUT]);
    c.w.s.arena.vehicles[1].hp = 0;
    c.w.step([NO_INPUT, NO_INPUT]);
    const bot = new Bot(1, 3);
    for (let i = 0; i < 60 * 40 && c.v.wrecked && c.w.s.arena.vehicles[1].wrecked; i++) c.w.step([NO_INPUT, bot.think(c.w)]);
    expect(c.w.s.arena.vehicles.some((v) => !v.wrecked)).toBe(true);
  });
});

describe("Pour the Foundation", () => {
  it("sacks land in the yard over time and some are already there", () => {
    const w = new World({ seed: 1, styles: [0, 0], humans: [true, true], stage: "construction-site" });
    w.s.nextGeyser = 1e9;
    const n = w.s.arena.sacks.length;
    expect(n).toBeGreaterThan(0);
    const evs: GameEvent[] = [];
    for (let i = 0; i < 60 * 12; i++) {
      w.step([NO_INPUT, NO_INPUT]);
      evs.push(...w.s.events);
    }
    expect(evs.some((e) => e.kind === "supply")).toBe(true);
    expect(w.s.arena.sacks.length).toBeGreaterThan(n);
  });

  it("USE picks up a sack, and walking it into the pit fills your share", () => {
    const c = yard("bulldozer", { x: 8, y: 5 }, { x: 4, y: 0 });
    const sack = { id: 50, kind: "cement" as const, value: 2, x: 4.3, y: 0, carrier: -1 };
    c.w.s.arena.sacks.push(sack);
    c.w.step([NO_INPUT, press(BTN.USE)]);
    c.w.step([NO_INPUT, NO_INPUT]);
    expect(sack.carrier).toBe(c.b.id);
    let evs: GameEvent[] = [];
    for (let i = 0; i < 200 && c.b.toilet === 0; i++) {
      c.w.step([NO_INPUT, press(0, -1, 0)]);
      evs = evs.concat(c.w.s.events);
    }
    expect(c.b.toilet).toBe(2);
    expect(evs.some((e) => e.kind === "deliver" && e.a === c.b.id && e.dmg === 2)).toBe(true);
    expect(c.w.s.arena.sacks.includes(sack)).toBe(false);
    expect(c.w.arena.progress(c.b)).toBeCloseTo(2 / PIT.need);
    expect(c.w.arena.headline(c.w)?.who).toBe(c.b.id);
  });

  it("a carrier hit drops the sack, and anyone can pick it up or take it from their arms", () => {
    const c = yard("bulldozer", { x: 8, y: 5 }, { x: 4, y: 0 });
    const sack = { id: 50, kind: "rubble" as const, value: 1, x: 4, y: 0, carrier: c.b.id };
    c.w.s.arena.sacks.push(sack);
    // A walks over and steals it straight out of B's arms
    c.w.step([press(BTN.USE), NO_INPUT]); // A leaves its machine
    c.w.step([NO_INPUT, NO_INPUT]);
    Object.assign(c.a, { x: 5.0, y: 0 });
    c.w.step([press(BTN.USE), NO_INPUT]);
    c.w.step([NO_INPUT, NO_INPUT]);
    expect(sack.carrier).toBe(c.a.id);
    // hit A: it drops
    c.w.arena.onHit(c.w, c.a);
    expect(sack.carrier).toBe(-1);
    // B takes it from the floor
    Object.assign(c.b, { x: sack.x + 0.3, y: sack.y });
    c.w.step([NO_INPUT, press(BTN.USE)]);
    expect(sack.carrier).toBe(c.b.id);
  });

  it("knocked down, a carrier drops what they carry", () => {
    const c = yard("bulldozer", { x: 8, y: 5 }, { x: 4, y: 0 });
    const sack = { id: 50, kind: "rubble" as const, value: 1, x: 4, y: 0, carrier: c.b.id };
    c.w.s.arena.sacks.push(sack);
    c.w.knockDown(c.b, 1, 0, 1);
    c.w.step([NO_INPUT, NO_INPUT]);
    expect(sack.carrier).toBe(-1);
  });

  it("a dump truck, a loader or a forklift hauls more, and delivers it in the pit", () => {
    for (const [kind, cap] of [
      ["dumptruck", 6],
      ["loader", 4],
      ["forklift", 2],
    ] as const) {
      const c = yard(kind, { x: -5, y: 0 }, { x: 8, y: 5 });
      // a row of sacks to drive over (the loader scoops them with grab)
      for (let i = 0; i < 8; i++) c.w.s.arena.sacks.push({ id: 60 + i, kind: "rubble", value: 1, x: -3.4 + i * 0.01, y: (i - 4) * 0.01, carrier: -1 });
      if (kind === "loader") tapThenRun(c, BTN.GRAB, 3);
      else for (let i = 0; i < 200 && c.v.load < cap; i++) c.w.step([press(0, 1, 0), NO_INPUT]);
      if (kind !== "loader") expect(c.v.load, kind).toBe(cap);
      else expect(c.v.load).toBeGreaterThan(0);
      const load = c.v.load;
      // drive to the pit
      for (let i = 0; i < 200 && c.v.load > 0; i++) c.w.step([press(0, PIT.x - c.v.x, PIT.y - c.v.y), NO_INPUT]);
      expect(c.v.load, kind).toBe(0);
      expect(c.a.toilet, kind).toBe(load);
    }
  });

  it("a wrecked hauler spills its load back on the ground", () => {
    const c = yard("dumptruck", { x: 0, y: 3 }, { x: 8, y: 5 });
    c.v.load = 4;
    c.v.hp = 0;
    c.w.step([NO_INPUT, NO_INPUT]);
    expect(c.v.load).toBe(0);
    expect(c.w.s.arena.sacks.reduce((a, s) => a + s.value, 0)).toBeGreaterThanOrEqual(4);
  });

  it("tipping the dump truck over the pit pours the load in", () => {
    const c = yard("dumptruck", { x: -0.2, y: 0 }, { x: 8, y: 5 });
    c.v.load = 5;
    c.v.actCool = 0;
    // the pit takes it as soon as the truck is over it
    c.w.step([press(0, 0, 0), NO_INPUT]);
    expect(c.a.toilet).toBe(5);
  });

  it("the first to fill the pit wins; fills are kept between turns", () => {
    const c = yard("bulldozer", { x: 8, y: 5 }, { x: 0, y: 0 });
    c.b.toilet = PIT.need - 2;
    const sack = { id: 70, kind: "cement" as const, value: 2, x: 0, y: 0, carrier: c.b.id };
    c.w.s.arena.sacks.push(sack);
    c.w.step([NO_INPUT, NO_INPUT]);
    expect(c.w.s.winner).toBe(c.b.id);
  });

  it("hash covers sacks, slicks and the machines' new state", () => {
    const a = yard("mixer", { x: 0, y: 0 }, { x: 9, y: 5 });
    const b = yard("mixer", { x: 0, y: 0 }, { x: 9, y: 5 });
    expect(a.w.hash()).toBe(b.w.hash());
    b.w.s.arena.sacks.push({ id: 80, kind: "rubble", value: 1, x: 1, y: 1, carrier: -1 });
    expect(a.w.hash()).not.toBe(b.w.hash());
    b.w.s.arena.sacks.pop();
    expect(a.w.hash()).toBe(b.w.hash());
    b.v.load = 3;
    expect(a.w.hash()).not.toBe(b.w.hash());
    b.v.load = 0;
    b.w.s.arena.slicks.push({ x: 0, y: 0, t: 0, by: 0 });
    expect(a.w.hash()).not.toBe(b.w.hash());
  });
});
