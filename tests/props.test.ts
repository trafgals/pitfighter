// The 3D props in the game.
//
// A prop is a model the asset pipeline built. It only goes into the game
// when a human approved it on the issue, and the approval is recorded in the
// asset manifest. The table in src/data/props.json says which fighter wears
// each approved prop and where it stands on them.
//
// These tests are the guards that keep the two in step:
//
//   1. the table holds every approved prop, and no prop that is not approved
//   2. every prop's model is actually on disk
//   3. the fighter, the piece of kit and the Gallery's throw it names are the
//      game's own, not a guess
//   4. a fighter whose own weapon has been approved starts holding it
//   5. the Gallery throws a gift when a fighter appeals, it lands, and anyone
//      standing by can pick it up
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../data/asset_manifest.json";
import { PROPS, PROP_BY_ID, GIFT_PROPS, gearPropsFor, wieldedPropFor } from "../src/data/props";
import { CHARACTERS, THROW_BY_ID } from "../src/data/characters";
import { World } from "../src/sim/world";
import { BTN } from "../src/sim/types";
import { idle, run, tap, chop } from "./helpers";

const ROOT = path.resolve(__dirname, "..");
const APPROVED = "status:asset-approved";

const assets = (manifest as { assets: { id: string; status?: string; glb_output?: string; character?: string }[] }).assets;
const approved = assets.filter((a) => a.status === APPROVED).map((a) => a.id).sort();

describe("the prop table", () => {
  it("holds every approved prop, and no prop that is not approved", () => {
    expect(PROPS.map((p) => p.id).sort()).toEqual(approved);
  });

  it("is not empty: the approved props are in the game", () => {
    expect(PROPS.length).toBeGreaterThan(0);
  });

  it("has every prop's model on disk", () => {
    for (const p of PROPS) {
      const file = path.join(ROOT, p.url.replace(/^\//, ""));
      expect(fs.existsSync(file), `${p.id} has no model at ${p.url}`).toBe(true);
    }
  });

  it("points at the model the manifest recorded", () => {
    for (const p of PROPS) {
      const asset = assets.find((a) => a.id === p.id)!;
      expect(p.url).toBe("/" + asset.glb_output!.replace(/\\/g, "/"));
    }
  });

  it("names a fighter of the game's own, and the kit that fighter really wears", () => {
    for (const p of PROPS) {
      if (p.kind === "gift") {
        expect(p.fighter, `${p.id} is a gift: it belongs to nobody`).toBe("");
        expect(THROW_BY_ID[p.throw], `${p.id} names a throw the Gallery does not have`).toBeTruthy();
        continue;
      }
      const fighter = CHARACTERS.find((c) => c.id === p.fighter);
      expect(fighter, `${p.id} names a fighter that is not on the roster`).toBeTruthy();
      if (p.kind === "gear") {
        expect(fighter!.kit.gear, `${p.id} replaces a piece of kit ${p.fighter} does not wear`).toContain(p.gear);
      }
    }
  });

  it("has offsets and turns that are numbers, and a scale that is a size", () => {
    for (const p of PROPS) {
      for (const v of [...p.offset, ...p.turn]) expect(Number.isFinite(v)).toBe(true);
      expect(p.scale).toBeGreaterThan(0);
    }
  });

  it("gives every fighter's own weapon to that fighter, and no fighter two", () => {
    const wielded = PROPS.filter((p) => p.kind === "wielded");
    expect(new Set(wielded.map((p) => p.fighter)).size).toBe(wielded.length);
    for (const p of wielded) {
      expect(wieldedPropFor(p.fighter)?.id).toBe(p.id);
    }
  });

  it("gives the Gallery only the gifts it can throw", () => {
    expect(GIFT_PROPS.length).toBeGreaterThan(0);
    for (const p of GIFT_PROPS) expect(THROW_BY_ID[p.throw]).toBeTruthy();
  });

  it("puts the gear on the fighter whose kit it replaces", () => {
    for (const p of PROPS.filter((x) => x.kind === "gear")) {
      expect(gearPropsFor(p.fighter).map((x) => x.id)).toContain(p.id);
    }
  });
});

describe("the props in a fight", () => {
  /** A pit: the arena the game starts in, flat enough to pick a gift up on. */
  const pit = (styles: number[]): World => {
    const w = new World({ seed: 7, styles, humans: styles.map(() => true) });
    w.s.nextGeyser = 1e9;
    return w;
  };

  it("gives a fighter their own approved weapon from the start", () => {
    const w = pit([10, 10]); // Lady Eleanor, the weeping rapier
    expect(w.fighters[0].weapon).toBe("prop_eleanor_weeping_rapier");
    expect(w.fighters[1].weapon).toBe("prop_eleanor_weeping_rapier");
  });

  it("gives a fighter with no approved weapon empty hands", () => {
    const w = pit([5, 5]); // Bosun Rook: nothing of his has been approved
    expect(w.fighters[0].weapon).toBe("");
  });

  it("throws a gift into the pit when a fighter appeals", () => {
    const w = pit([2, 2]);
    tap(w, 0, BTN.TAUNT);
    expect(w.s.gifts).toHaveLength(0); // the appeal is still going
    run(w, 120);
    expect(w.s.gifts).toHaveLength(1);
    expect(GIFT_PROPS.map((g) => g.id)).toContain(w.s.gifts[0].prop);
  });

  it("lands the gift on the floor", () => {
    const w = pit([2, 2]);
    tap(w, 0, BTN.TAUNT);
    run(w, 120);
    const gift = w.s.gifts[0];
    run(w, 120);
    expect(w.s.gifts[0].z).toBe(0);
    expect(w.s.gifts[0].id).toBe(gift.id);
  });

  it("lets a fighter pick the gift up with the use button", () => {
    const w = pit([2, 2]);
    tap(w, 0, BTN.TAUNT);
    run(w, 120);
    const gift = w.s.gifts[0];
    // walk to the gift and take it
    w.fighters[0].x = gift.x;
    w.fighters[0].y = gift.y;
    run(w, 60);
    tap(w, 0, BTN.USE);
    expect(w.s.gifts).toHaveLength(0);
    expect(w.fighters[0].weapon).toBe(gift.prop);
  });

  it("leaves the gift to anyone, not just the fighter who appealed", () => {
    const w = pit([2, 2]);
    tap(w, 0, BTN.TAUNT);
    run(w, 120);
    const gift = w.s.gifts[0];
    w.fighters[1].x = gift.x;
    w.fighters[1].y = gift.y;
    run(w, 60);
    tap(w, 1, BTN.USE);
    expect(w.fighters[1].weapon).toBe(gift.prop);
    expect(w.fighters[0].weapon).toBe("");
  });

  it("drops the weapon a fighter was holding when they take a gift", () => {
    const w = pit([10, 2]); // Eleanor has the rapier; Sluice appeals
    tap(w, 1, BTN.TAUNT);
    run(w, 120);
    const gift = w.s.gifts[0];
    w.fighters[0].x = gift.x;
    w.fighters[0].y = gift.y;
    run(w, 60);
    tap(w, 0, BTN.USE);
    expect(w.fighters[0].weapon).toBe(gift.prop);
    // the rapier is on the floor now
    expect(w.s.gifts.map((g) => g.prop)).toContain("prop_eleanor_weeping_rapier");
  });

  it("drops what a fighter is holding when they are knocked out", () => {
    const w = pit([10, 2]);
    expect(w.fighters[0].weapon).toBe("prop_eleanor_weeping_rapier");
    chop(w, w.fighters[0], "torso", 1);
    expect(w.fighters[0].weapon).toBe("");
    expect(w.s.gifts.map((g) => g.prop)).toContain("prop_eleanor_weeping_rapier");
  });

  it("lands every gift where it can be picked up, not in the fire round the pit", () => {
    // the fighters stand on the spawn ring, right by the edge of the fire, so
    // a gift thrown at random around them would land in it
    for (let seed = 1; seed <= 12; seed++) {
      const w = new World({ seed, styles: [2, 2], humans: [true, true] });
      w.s.nextGeyser = 1e9;
      tap(w, 0, BTN.TAUNT);
      run(w, 240);
      expect(w.s.gifts).toHaveLength(1);
      expect(w.s.gifts[0].burning).toBe(0);
      expect(w.s.gifts[0].z).toBe(0);
      expect(Math.hypot(w.s.gifts[0].x, w.s.gifts[0].y)).toBeLessThanOrEqual(9);
    }
  });

  it("keeps the fighters and the gifts on the same footing: the sim stays whole", () => {    const w = pit([2, 5]);
    tap(w, 0, BTN.TAUNT);
    for (let i = 0; i < 600; i++) {
      const inp = idle(2);
      inp[0].buttons = i % 30 === 0 ? BTN.TAUNT : 0;
      inp[1].buttons = i % 40 === 0 ? BTN.USE : 0;
      w.step(inp);
      expect(w.fighters.every((f) => Number.isFinite(f.x + f.y + f.weapon.length))).toBe(true);
    }
  });
});

describe("the prop ids", () => {
  it("are the manifest's own, so a model and a table entry cannot drift apart", () => {
    for (const p of PROPS) {
      expect(assets.map((a) => a.id)).toContain(p.id);
      expect(PROP_BY_ID[p.id]).toBe(p);
    }
  });
});
