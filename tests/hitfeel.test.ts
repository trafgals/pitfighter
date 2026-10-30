// Hitstop, fury and the style specials: the sim side of the hit-feel and
// combat-depth passes.
import { describe, expect, it } from "vitest";
import { FURY, HITSTOP, MOVES, REVERSAL, hitstopFor } from "../src/sim/moves";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";
import { BTN, duel, idle, run, tap } from "./helpers";

const hitOn = (w: World, b = 1) => w.s.events.find((e) => e.kind === "hit" && e.b === b);
const styleWith = (sp: string) => STYLES.findIndex((s) => s.special === sp);

/** frames from the press until the victim and the attacker are both idle again */
function exchange(hitstop: boolean) {
  const w = duel(1.0, [0, 0], hitstop);
  tap(w, 0, BTN.HIGH);
  let a = -1;
  let b = -1;
  let stop = 0;
  for (let i = 0; i < 120; i++) {
    w.step(idle(2));
    stop = Math.max(stop, hitOn(w)?.stop ?? 0);
    if (a < 0 && w.fighters[0].state === "idle" && w.s.frame > 5) a = w.s.frame;
    if (b < 0 && w.fighters[1].state === "idle" && w.fighters[1].parts.torso.hp < 100) b = w.s.frame;
  }
  return { a, b, stop };
}

describe("hitstop", () => {
  it("a landed jab freezes both fighters by the same amount, so the advantage is unchanged", () => {
    const raw = exchange(false);
    const feel = exchange(true);
    expect(raw.stop).toBe(0);
    expect(feel.stop).toBe(hitstopFor(MOVES.jab1.dmg, false));
    expect(feel.a - raw.a).toBe(feel.stop);
    expect(feel.b - raw.b).toBe(feel.stop);
    expect(feel.b - feel.a).toBe(raw.b - raw.a);
  });

  it("frozen fighters neither advance their state nor slide", () => {
    const v = duel(1.0);
    tap(v, 0, BTN.HIGH);
    while (!hitOn(v)) v.step(idle(2));
    const [va, vb] = v.fighters;
    expect(va.stop).toBeGreaterThan(0);
    expect(vb.stop).toBe(va.stop);
    const t = [va.t, vb.t];
    const pos = [vb.x, vb.y];
    v.step(idle(2));
    expect([va.t, vb.t]).toEqual(t);
    expect([vb.x, vb.y]).toEqual(pos);
  });

  it("heavier hits freeze longer, and a KO freezes longest", () => {
    expect(hitstopFor(MOVES.punchFin.dmg, true)).toBeGreaterThan(hitstopFor(MOVES.jab1.dmg, false));
    expect(hitstopFor(1000, true)).toBe(HITSTOP.max);
    expect(HITSTOP.ko).toBeGreaterThan(HITSTOP.max);
  });

  it("a follow-up pressed during the freeze still comes out after it", () => {
    const seen: string[] = [];
    const v = duel(1.0);
    tap(v, 0, BTN.HIGH);
    while (!hitOn(v)) v.step(idle(2));
    tap(v, 0, BTN.HIGH); // pressed once, on the first frame of the freeze
    for (let i = 0; i < 40; i++) {
      v.step(idle(2));
      if (v.fighters[0].move) seen.push(v.fighters[0].move);
    }
    expect(seen).toContain("jab2");
  });

  it("reversals and throws freeze too", () => {
    const w = duel(1.0);
    tap(w, 1, BTN.REV);
    tap(w, 0, BTN.HIGH);
    let rev;
    for (let i = 0; i < 20 && !rev; i++) {
      w.step(idle(2));
      rev = w.s.events.find((e) => e.kind === "reversal");
    }
    expect(rev?.stop).toBe(HITSTOP.reversal);
    expect(REVERSAL.stun).toBeGreaterThan(0);

  });
});

describe("fury and specials", () => {
  it("landing and taking hits fill fury", () => {
    const w = duel(1.0);
    tap(w, 0, BTN.HIGH);
    run(w, 30);
    expect(w.fighters[0].fury).toBe(FURY.hit);
    expect(w.fighters[1].fury).toBe(FURY.taken);
  });

  it("without fury, Circle + Triangle is just a grapple", () => {
    const w = duel(3.0);
    tap(w, 0, BTN.HIGH | BTN.GRAB);
    run(w, 2);
    expect(w.fighters[0].move).toBe("grab");
  });

  it("with fury, Circle + Triangle (or R2) starts the style's special and spends fury", () => {
    for (const buttons of [BTN.HIGH | BTN.GRAB, BTN.SPECIAL]) {
      const style = styleWith("spSpin");
      const w = duel(1.0, [style, 0]);
      w.fighters[0].fury = FURY.max;
      tap(w, 0, buttons);
      expect(w.fighters[0].move).toBe("spSpin");
      expect(w.fighters[0].fury).toBe(FURY.max - FURY.cost);
      expect(w.s.events.some((e) => e.kind === "special" && e.a === 0)).toBe(true);
    }
  });

  it("a chord whose second button lands a frame late replaces the opener", () => {
    const w = duel(1.0, [styleWith("spBlade"), 0]);
    w.fighters[0].fury = FURY.cost;
    tap(w, 0, BTN.HIGH);
    expect(w.fighters[0].move).toBe("jab1");
    tap(w, 0, BTN.GRAB);
    expect(w.fighters[0].move).toBe("spBlade");
  });

  it("a spin hits a fighter standing behind", () => {
    const w = new World({ seed: 3, styles: [styleWith("spSpin"), 0, 0], humans: [true, true, true] });
    w.s.nextGeyser = 1e9;
    const [a, b, c] = w.fighters;
    Object.assign(a, { x: 0, y: 4, facing: 0 });
    Object.assign(b, { x: 1, y: 4, facing: Math.PI });
    Object.assign(c, { x: -1, y: 4, facing: 0 });
    a.fury = FURY.cost;
    tap(w, 0, BTN.SPECIAL);
    run(w, 40);
    expect(b.parts.torso.hp).toBeLessThan(b.parts.torso.max);
    expect(c.parts.torso.hp).toBeLessThan(c.parts.torso.max);
  });

  it("a special goes straight through a reversal", () => {
    const w = duel(1.0, [styleWith("spBlade"), 0]);
    w.fighters[0].fury = FURY.cost;
    tap(w, 1, BTN.REV);
    tap(w, 0, BTN.SPECIAL);
    run(w, 30);
    expect(w.fighters[1].parts.torso.hp).toBeLessThan(w.fighters[1].parts.torso.max);
    expect(["down", "wakeup"]).toContain(w.fighters[1].state);
  });

  it("the flurry hits the same fighter several times", () => {
    const w = duel(1.0, [styleWith("spFlurry"), 0]);
    w.fighters[0].fury = FURY.cost;
    tap(w, 0, BTN.SPECIAL);
    let hits = 0;
    run(w, 90, () => {
      hits += w.s.events.filter((e) => e.kind === "hit" && e.b === 1).length;
    });
    expect(hits).toBeGreaterThanOrEqual(4);
  });

  it("the charge carries the attacker forward", () => {
    const w = duel(5.0, [styleWith("spCharge"), 0]);
    const [a, b] = w.fighters;
    a.y = -3; // clear of the toilet in the middle
    b.y = 3; // and of the opponent
    a.fury = FURY.cost;
    const x0 = a.x;
    tap(w, 0, BTN.SPECIAL);
    run(w, 40);
    expect(a.x - x0).toBeGreaterThan(2);
  });

  it("every style has a special that exists", () => {
    for (const s of STYLES) expect(MOVES[s.special]?.kind).toBe("special");
  });

  it("a KO empties the fury bar", () => {
    const w = duel(1.0);
    const b = w.fighters[1];
    b.fury = 80;
    w.damage(b, "torso", 1000, 0);
    expect(b.state).toBe("ko");
    expect(b.fury).toBe(0);
  });
});

describe("combat depth: counter-hits, regional targeting, ground grapples, and Gallery appeal", () => {
  it("striking an opponent during their attack startup triggers a counter-hit with bonus damage and stun", () => {
    const w = duel(1.0, [0, 0], false);
    const [, b] = w.fighters;
    // Put b into slow heavy startup
    b.state = "attack";
    b.move = "punchFin";
    b.t = 1;
    const hp0 = b.parts.torso.hp;
    tap(w, 0, BTN.HIGH);
    let counterEv;
    for (let i = 0; i < 20; i++) {
      w.step(idle(2));
      counterEv ??= w.s.events.find((e) => e.kind === "counter");
    }
    expect(counterEv).toBeTruthy();
    expect(b.parts.torso.hp).toBeLessThan(hp0);
  });

  it("holding R1 (LOCK) + stick aims strikes at head, torso, or legs intentionally", () => {
    for (const [stickY, expected] of [
      [-1, "head"],
      [0, "torso"],
      [1, "legs"],
    ] as const) {
      const w = duel(1.0, [0, 0], false);
      w.step([
        { x: 0, y: stickY, buttons: BTN.LOCK | BTN.HIGH },
        { x: 0, y: 0, buttons: 0 },
      ]);
      let hitPart: string | undefined;
      for (let i = 0; i < 20 && !hitPart; i++) {
        w.step([{ x: 0, y: stickY, buttons: BTN.LOCK }, { x: 0, y: 0, buttons: 0 }]);
        const h = hitOn(w);
        if (h) hitPart = h.part;
      }
      if (expected === "legs") expect(["legL", "legR"]).toContain(hitPart);
      else expect(hitPart).toBe(expected);
    }
  });

  it("pressing Triangle near a downed opponent executes a style ground grapple", () => {
    const w = duel(0.9, [0, 0], false);
    const [, b] = w.fighters;
    w.knockDown(b, 1, 0, 0.2);
    b.invuln = 0;
    const legHpBefore = b.parts.legL.hp + b.parts.legR.hp;
    tap(w, 0, BTN.GRAB);
    const grabEv = w.s.events.find((e) => e.kind === "grab" && e.a === 0);
    expect(grabEv).toBeTruthy();
    expect(grabEv!.what).toBeTruthy();
    expect(b.parts.legL.hp + b.parts.legR.hp).toBeLessThan(legHpBefore);
  });

  it("completing a taunt shortly after a big blow triggers the Gallery appeal gift drop", () => {
    const w = duel(1.0, [0, 0], false);
    const [a] = w.fighters;
    a.lastBigBlow = w.s.frame;
    const pickupsBefore = w.s.pickups.length;
    tap(w, 0, BTN.TAUNT);
    let appealEv;
    for (let i = 0; i < 75; i++) {
      w.step(idle(2));
      appealEv ??= w.s.events.find((e) => e.kind === "appeal" && e.a === 0);
    }
    expect(appealEv).toBeTruthy();
    expect(w.s.pickups.length).toBe(pickupsBefore + 1);
  });
});
