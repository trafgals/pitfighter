// Weapons that matter: stats, strikes, wear, throws and the ones on the floor.
import { describe, expect, it } from "vitest";
import { GIFT_PROPS, PROPS } from "../src/data/props";
import { STAGES } from "../src/sim/stages";
import { World } from "../src/sim/world";
import { WEAPONS, FLOOR_WEAPONS, shapeOf } from "../src/sim/weapons";
import { MOVES } from "../src/sim/moves";
import { BTN, duel, idle, run, tap } from "./helpers";

/** The damage of the first blow a press of Circle lands, or 0 if it whiffs. */
function jabDamage(w: World): number {
  tap(w, 0, BTN.HIGH);
  let dmg = 0;
  for (let i = 0; i < 40 && !dmg; i++) {
    w.step(idle(2));
    dmg = w.s.events.find((e) => e.kind === "hit" && e.a === 0)?.dmg ?? 0;
  }
  return dmg;
}

describe("weapon stats", () => {
  it("every approved weapon prop has stats; the tonic is a drink, not a weapon", () => {
    for (const p of PROPS) {
      if (p.kind === "gear" || p.id === "pickup_tonic") continue;
      expect(WEAPONS[p.id], p.id).toBeTruthy();
    }
    expect(FLOOR_WEAPONS.length).toBeGreaterThanOrEqual(5);
    expect(GIFT_PROPS.length).toBeGreaterThan(5);
  });

  it("shapes a blow by the move that throws it", () => {
    expect(shapeOf(MOVES.jab1)).toBe("thrust");
    expect(shapeOf(MOVES.kick1)).toBe("swing");
    expect(shapeOf(MOVES.punchFin)).toBe("overhead");
  });
});

describe("a weapon in the hand", () => {
  it("hits harder than bare hands", () => {
    const bare = jabDamage(duel(1));
    const w = duel(1);
    w.fighters[0].weapon = "weapon_nail_bat";
    w.fighters[0].weaponDur = WEAPONS.weapon_nail_bat.dur;
    expect(jabDamage(w)).toBeGreaterThan(bare * 1.3);
  });

  it("reaches where bare hands do not, and starts later", () => {
    const bareReach = duel(2.0);
    expect(jabDamage(bareReach)).toBe(0);
    const w = duel(2.0);
    w.fighters[0].weapon = "weapon_coal_shovel";
    w.fighters[0].weaponDur = 9;
    expect(jabDamage(w)).toBeGreaterThan(0);
    expect(w.eff(w.fighters[0], "jab1").startup).toBeGreaterThan(duel(1).eff(duel(1).fighters[0], "jab1").startup);
  });

  it("wears out with every blow and breaks", () => {
    const w = duel(1);
    const a = w.fighters[0];
    w.fighters[1].parts.torso.hp = w.fighters[1].parts.torso.max = 1e6;
    a.weapon = "weapon_chair";
    a.weaponDur = WEAPONS.weapon_chair.dur;
    let broke = false;
    for (let i = 0; i < 20 && !broke; i++) {
      jabDamage(w);
      run(w, 60);
      broke = w.s.events.some((e) => e.kind === "break") || a.weapon === "";
    }
    expect(a.weapon).toBe("");
    expect(a.weaponDur).toBe(0);
  });

  it("a fighter's own weapon never breaks", () => {
    expect(WEAPONS.prop_eleanor_weeping_rapier.dur).toBe(0);
  });
});

describe("throwing a weapon", () => {
  it("Triangle + L1 throws it, and it hurts whoever it hits", () => {
    const w = duel(4);
    const a = w.fighters[0];
    const b = w.fighters[1];
    a.weapon = "weapon_cleaver";
    a.weaponDur = 10;
    const hp = b.parts.torso.hp + b.parts.head.hp;
    tap(w, 0, BTN.GRAB | BTN.USE);
    expect(a.weapon).toBe("");
    expect(w.s.gifts.some((g) => g.hot > 0 && g.owner === 0)).toBe(true);
    run(w, 60);
    expect(b.parts.torso.hp + b.parts.head.hp).toBeLessThan(hp);
    // and it lands on the floor, still the cleaver, and can be picked up again
    const g = w.s.gifts.find((x) => x.prop === "weapon_cleaver");
    expect(g).toBeTruthy();
    expect(g!.hot).toBe(0);
  });

  it("a weapon too heavy to throw stays in the hand", () => {
    const w = duel(4);
    w.fighters[0].weapon = "debris_beam";
    w.fighters[0].weaponDur = 4;
    tap(w, 0, BTN.GRAB | BTN.USE);
    expect(w.fighters[0].weapon).toBe("debris_beam");
  });

  it("the thrower keeps the weapon's wear", () => {
    const w = duel(4);
    w.fighters[0].weapon = "weapon_cleaver";
    w.fighters[0].weaponDur = 3;
    tap(w, 0, BTN.GRAB | BTN.USE);
    expect(w.s.gifts.find((g) => g.prop === "weapon_cleaver")!.dur).toBe(3);
  });
});

describe("weapons on the floor", () => {
  it("every stage starts with two or three of them lying about, where they can be picked up", () => {
    for (const stage of STAGES) {
      for (const seed of [1, 2, 3]) {
        const w = new World({ seed, styles: [0, 1], humans: [true, true], stage: stage.id });
        const guns = w.s.gifts.filter((g) => WEAPONS[g.prop]);
        expect(guns.length, `${stage.id} ${seed}`).toBeGreaterThanOrEqual(2);
        expect(guns.length).toBeLessThanOrEqual(3);
        for (const g of guns) expect(w.arena.canLand(w, g.x, g.y)).toBe(true);
      }
    }
  });

  it("a fighter picks one up with L1", () => {
    const w = new World({ seed: 4, styles: [0, 1], humans: [true, true] });
    w.s.nextGeyser = 1e9;
    const g = w.s.gifts[0];
    w.fighters[0].weapon = "";
    Object.assign(w.fighters[0], { x: g.x, y: g.y });
    tap(w, 0, BTN.USE);
    expect(w.fighters[0].weapon).toBe(g.prop);
    expect(w.fighters[0].weaponDur).toBe(g.dur);
  });

  it("is in the hash, and deterministic", () => {
    const a = new World({ seed: 9, styles: [0, 1], humans: [false, false] });
    const b = new World({ seed: 9, styles: [0, 1], humans: [false, false] });
    expect(a.hash()).toBe(b.hash());
    const h = a.hash();
    a.s.gifts[0].dur += 1;
    expect(a.hash()).not.toBe(h);
  });
});
