// Nothing leaves the map: gifts wash back like limbs, hazards leave debris that
// is a weapon, and a severed limb can be swung as a club.
import { describe, expect, it } from "vitest";
import { HAZARDS } from "../src/sim/arena";
import { WEAPONS } from "../src/sim/weapons";
import { World } from "../src/sim/world";
import { BTN, chop, disarm, duel, run, tap } from "./helpers";

function stage(id: "construction-site" | "castle-under-siege" | "hell-toilet"): World {
  const w = new World({ seed: 2, styles: [0, 1], humans: [true, true], stage: id });
  w.s.nextGeyser = 1e9;
  disarm(w);
  return w;
}

describe("gifts that go off an edge", () => {
  it("wash back onto the floor, like limbs", () => {
    const w = stage("hell-toilet");
    const g = {
      id: 99, prop: "weapon_nail_bat", throw: "nail-bat", owner: -1, x: 9.8, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      burning: 0, spin: 0, dur: 8, hot: 0,
    };
    w.s.gifts.push(g);
    run(w, 90);
    expect(w.s.gifts).toHaveLength(1);
    expect(w.s.gifts[0].burning).toBe(0);
    expect(Math.hypot(w.s.gifts[0].x, w.s.gifts[0].y)).toBeLessThanOrEqual(9);
  });
});

describe("hazard debris", () => {
  const strike = (w: World, kind: "beam" | "boulder" | "arrows", x: number, y: number) => {
    w.s.geysers.push({ kind, x, y, t: 0 });
    run(w, HAZARDS[kind].warn + 2);
  };

  it("a beam leaves a beam on the floor, and it is slow and huge", () => {
    const w = stage("construction-site");
    strike(w, "beam", 1, 1);
    run(w, 200);
    const d = w.s.gifts.find((g) => g.prop === "debris_beam");
    expect(d).toBeTruthy();
    expect(d!.z).toBe(0);
    expect(WEAPONS.debris_beam.dmg).toBeGreaterThan(WEAPONS.weapon_nail_bat.dmg);
    expect(WEAPONS.debris_beam.startup).toBeGreaterThan(WEAPONS.weapon_nail_bat.startup);
    expect(WEAPONS.debris_beam.reach).toBeGreaterThan(WEAPONS.weapon_nail_bat.reach);
  });

  it("a boulder leaves a stone that can be thrown; arrows leave an arrow", () => {
    const w = stage("castle-under-siege");
    strike(w, "boulder", 0, 0);
    strike(w, "arrows", 2, 2);
    run(w, 200);
    const stone = w.s.gifts.find((g) => g.prop === "debris_stone");
    expect(stone).toBeTruthy();
    expect(w.s.gifts.some((g) => g.prop === "debris_arrow")).toBe(true);
    expect(WEAPONS.debris_stone.throwDmg).toBeGreaterThan(0);
  });

  it("a fighter picks the beam up and swings it", () => {
    const w = stage("castle-under-siege"); // (on foot from the start)
    strike(w, "beam", 3, 3);
    run(w, 200);
    const d = w.s.gifts.find((g) => g.prop === "debris_beam")!;
    Object.assign(w.fighters[0], { x: d.x, y: d.y });
    tap(w, 0, BTN.USE);
    expect(w.fighters[0].weapon).toBe("debris_beam");
    expect(w.eff(w.fighters[0], "jab1").reach).toBeGreaterThan(duel(1).eff(duel(1).fighters[0], "jab1").reach + 0.5);
  });

  it("stops adding debris past the cap", () => {
    const w = stage("construction-site");
    for (let i = 0; i < 40; i++) strike(w, "beam", (i % 5) - 2, 0);
    expect(w.s.gifts.filter((g) => g.prop === "debris_beam").length).toBeLessThanOrEqual(24);
  });
});

describe("a severed limb as a club", () => {
  it("is wielded with Grab when no gap fits it, and dropped back as the same limb", () => {
    const w = duel(5);
    const [a, b] = w.fighters;
    chop(w, b, "armL", 0);
    const limb = w.s.pickups[0];
    Object.assign(a, { x: limb.x, y: limb.y });
    run(w, 80);
    // the limb may have bounced about; stand on it
    Object.assign(a, { x: w.s.pickups[0].x, y: w.s.pickups[0].y });
    tap(w, 0, BTN.GRAB);
    expect(a.weapon).toBe("limb");
    expect(a.club?.part).toBe("armL");
    expect(w.s.pickups).toHaveLength(0);
    // swinging it hits harder than a fist
    expect(w.eff(a, "jab1").dmg).toBeGreaterThan(duel(1).eff(duel(1).fighters[0], "jab1").dmg);
    run(w, 30);
    tap(w, 0, BTN.USE);
    expect(a.weapon).toBe("");
    expect(w.s.pickups).toHaveLength(1);
    expect(w.s.pickups[0].part).toBe("armL");
    expect(w.s.pickups[0].owner).toBe(1);
  });

  it("a tap of Grab still reattaches a limb that fits a gap", () => {
    const w = duel(5);
    const a = w.fighters[0];
    chop(w, a, "armL", 1);
    run(w, 80);
    Object.assign(a, { x: w.s.pickups[0].x, y: w.s.pickups[0].y });
    tap(w, 0, BTN.GRAB);
    expect(a.weapon).toBe("");
    expect(a.state).toBe("reattach");
  });

  it("can be thrown, and is a limb on the floor again", () => {
    const w = duel(5);
    const [a, b] = w.fighters;
    chop(w, b, "legR", 0);
    run(w, 80);
    Object.assign(a, { x: w.s.pickups[0].x, y: w.s.pickups[0].y });
    tap(w, 0, BTN.GRAB);
    expect(a.weapon).toBe("limb");
    run(w, 10);
    tap(w, 0, BTN.GRAB | BTN.USE);
    expect(a.weapon).toBe("");
    expect(w.s.pickups).toHaveLength(1);
    expect(Math.hypot(w.s.pickups[0].vx, w.s.pickups[0].vy)).toBeGreaterThan(0.2);
  });
});
