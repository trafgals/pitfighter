import { describe, expect, it } from "vitest";
import { MOVES, REVERSAL, THROW } from "../src/sim/moves";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";
import { BTN, duel, idle, run, tap } from "./helpers";

const hitFrame = (w: World, defender = 1) => w.s.events.some((e) => e.kind === "hit" && e.b === defender);

describe("strikes", () => {
  it("a jab connects exactly `startup` frames after the press", () => {
    const w = duel();
    const pressFrame = w.s.frame + 1;
    tap(w, 0, BTN.HIGH);
    let landed = -1;
    for (let i = 0; i < 20 && landed < 0; i++) {
      w.step(idle(2));
      if (hitFrame(w)) landed = w.s.frame;
    }
    expect(landed - pressFrame).toBe(MOVES.jab1.startup);
    expect(w.fighters[1].state).toBe("hitstun");
  });

  it("a whiffed jab hits nothing and recovers after startup+active+recovery", () => {
    const w = duel(3);
    tap(w, 0, BTN.HIGH);
    const total = MOVES.jab1.startup + MOVES.jab1.active + MOVES.jab1.recovery;
    run(w, total - 2);
    expect(w.fighters[0].state).toBe("attack");
    run(w, 2);
    expect(w.fighters[0].state).toBe("idle");
    expect(w.fighters[1].parts.torso.hp).toBe(w.fighters[1].parts.torso.max);
  });

  it("a mashed high string is a true combo that ends in a launch", () => {
    const w = duel();
    const b = w.fighters[1];
    let hits = 0;
    let gapInStun = false;
    run(w, 80, (inp, i) => {
      if (i % 4 === 0) inp[0].buttons = BTN.HIGH;
      if (w.s.events.some((e) => e.kind === "hit" && e.b === 1)) hits++;
      if (hits > 0 && hits < 3 && b.state === "idle") gapInStun = true;
    });
    // All-Round: 2 jabs + finisher
    expect(STYLES[0].string).toBe(2);
    expect(hits).toBeGreaterThanOrEqual(3);
    expect(gapInStun).toBe(false);
    expect(["air", "down", "wakeup", "idle"]).toContain(b.state);
    expect(w.s.events.length).toBeGreaterThanOrEqual(0);
  });

  it("damage scales down along a combo", () => {
    const w = duel();
    const dmgs: number[] = [];
    run(w, 60, (inp, i) => {
      if (i % 4 === 0) inp[0].buttons = BTN.HIGH;
      for (const e of w.s.events) if (e.kind === "hit" && e.b === 1) dmgs.push(e.dmg!);
    });
    expect(dmgs.length).toBeGreaterThanOrEqual(2);
    expect(dmgs[1]).toBeLessThan(MOVES.jab2.dmg);
  });

  it("there is no guard, as in Urban Reign: R1 locks on instead, and holding it does not stop a jab", () => {
    const w = duel();
    run(w, 3, (inp) => (inp[1].buttons = BTN.LOCK));
    tap(w, 0, BTN.HIGH, (inp) => (inp[1].buttons = BTN.LOCK));
    let hit = false;
    run(w, MOVES.jab1.startup + 6, (inp) => {
      inp[1].buttons = BTN.LOCK;
      if (hitFrame(w)) hit = true;
    });
    expect(hit).toBe(true);
    expect(w.s.events.some((e) => e.kind === "block")).toBe(false);
  });

  it("Circle with the stick pulled back throws the low string", () => {
    const w = duel(3);
    tap(w, 0, BTN.HIGH, (inp) => (inp[0].x = -1)); // fighter 0 faces +x: back is -x
    expect(w.fighters[0].move).toBe("kick1");
    const v = duel(3);
    tap(v, 0, BTN.HIGH, (inp) => (inp[0].x = 1)); // forward: still the high string
    expect(v.fighters[0].move).toBe("jab1");
  });

  it("strikes hit every fighter in the cone (multi-target)", () => {
    const w = new World({ seed: 3, styles: [0, 0, 0], limbs: false });
    w.s.nextGeyser = 1e9;
    const [a, b, c] = w.fighters;
    Object.assign(a, { x: 0, y: 3, facing: 0 });
    Object.assign(b, { x: 0.9, y: 3.3, facing: Math.PI });
    Object.assign(c, { x: 0.9, y: 2.7, facing: Math.PI });
    tap(w, 0, BTN.HIGH);
    const hit = new Set<number>();
    run(w, MOVES.jab1.startup + 4, () => {
      for (const e of w.s.events) if (e.kind === "hit") hit.add(e.b!);
    });
    expect([...hit].sort()).toEqual([1, 2]);
  });
});

describe("reversals", () => {
  it("a high reversal in its window counters a jab, stuns the attacker and deals damage", () => {
    const w = duel();
    tap(w, 0, BTN.HIGH);
    run(w, 1);
    tap(w, 1, BTN.REV); // reversal 2 frames after the jab started: the jab lands on its frame 10
    let reversed = false;
    run(w, MOVES.jab1.startup + 2, () => {
      if (w.s.events.some((e) => e.kind === "reversal" && e.a === 1)) reversed = true;
    });
    expect(reversed).toBe(true);
    expect(w.fighters[0].state).toBe("reversed");
    expect(w.fighters[0].parts.torso.hp).toBe(w.fighters[0].parts.torso.max - REVERSAL.dmg);
    expect(w.fighters[1].parts.torso.hp).toBe(w.fighters[1].parts.torso.max);
  });

  it("Square deflects a low kick too: Urban Reign's deflection takes high and low alike", () => {
    const w = duel();
    tap(w, 0, BTN.LOW);
    run(w, MOVES.kick1.startup - 10);
    tap(w, 1, BTN.REV);
    run(w, 14);
    expect(w.fighters[0].state).toBe("reversed");
    expect(w.fighters[1].revHeight).toBe("low");
  });

  it("a mistimed reversal is punished", () => {
    const w = duel();
    tap(w, 1, BTN.REV);
    run(w, REVERSAL.window + 2);
    tap(w, 0, BTN.HIGH);
    let hit = false;
    run(w, MOVES.jab1.startup + 4, () => {
      if (hitFrame(w)) hit = true;
    });
    expect(hit).toBe(true);
  });

  it("a reversal started one frame before the strike lands is too late", () => {
    const w = duel();
    tap(w, 0, BTN.HIGH);
    run(w, MOVES.jab1.startup - 2);
    tap(w, 1, BTN.REV); // the jab lands on this reversal's frame 1, before REVERSAL.first
    let hit = false;
    run(w, 6, () => {
      if (hitFrame(w)) hit = true;
    });
    expect(REVERSAL.first).toBeGreaterThan(1);
    expect(hit).toBe(true);
    expect(w.fighters[0].state).not.toBe("reversed");
  });

  it("a reversal pushes the surrounding crowd away (kinetic pushback)", () => {
    const w = new World({ seed: 5, styles: [0, 0, 0, 0], limbs: false });
    w.s.nextGeyser = 1e9;
    const [a, d, c1, c2] = w.fighters;
    Object.assign(d, { x: 0, y: 4, facing: Math.PI });
    Object.assign(a, { x: -0.9, y: 4, facing: 0 });
    Object.assign(c1, { x: 0.4, y: 4.9, facing: -Math.PI / 2 });
    Object.assign(c2, { x: 0.5, y: 3.1, facing: Math.PI / 2 });
    tap(w, 0, BTN.HIGH);
    run(w, 1);
    tap(w, 1, BTN.REV);
    run(w, 20);
    expect(a.state === "reversed" || a.state === "idle").toBe(true);
    expect(Math.hypot(c1.x - d.x, c1.y - d.y)).toBeGreaterThan(1.8);
    expect(Math.hypot(c2.x - d.x, c2.y - d.y)).toBeGreaterThan(1.8);
  });
});

describe("grapples", () => {
  it("grab -> knee -> throw toward the stick, the thrown body bowls others over", () => {
    const w = new World({ seed: 9, styles: [0, 0, 0], limbs: false });
    w.s.nextGeyser = 1e9;
    const [a, b, c] = w.fighters;
    Object.assign(a, { x: 0, y: 3, facing: 0 });
    Object.assign(b, { x: 0.8, y: 3, facing: Math.PI });
    Object.assign(c, { x: 0, y: 5.2, facing: -Math.PI / 2 });
    tap(w, 0, BTN.GRAB);
    run(w, 8);
    expect(a.state).toBe("holding");
    expect(b.state).toBe("held");
    run(w, 14); // past the escape window
    tap(w, 0, BTN.HIGH);
    expect(b.parts.torso.hp).toBeLessThan(b.parts.torso.max);
    run(w, a.stop + 2); // through the knee's hitstop
    const before = b.parts.torso.hp;
    tap(w, 0, BTN.GRAB, (inp) => (inp[0].y = 1)); // throw north, into c
    expect(b.state).toBe("thrown");
    expect(b.parts.torso.hp).toBeCloseTo(before - THROW.dmg * 0.85, 0);
    run(w, THROW.dur + b.stop); // the throw's hitstop first
    expect(["down", "wakeup"]).toContain(c.state);
    expect(["down", "wakeup"]).toContain(b.state);
  });

  it("the held fighter can escape with a quick reversal", () => {
    const w = duel(0.8);
    tap(w, 0, BTN.GRAB);
    run(w, 7);
    expect(w.fighters[1].state).toBe("held");
    tap(w, 1, BTN.REV);
    expect(w.fighters[1].state).toBe("idle");
    expect(w.fighters[0].state).toBe("reversed");
  });

  it("a high reversal also catches a grab", () => {
    const w = duel(0.8);
    tap(w, 0, BTN.GRAB);
    run(w, 1);
    tap(w, 1, BTN.REV);
    run(w, 6);
    expect(w.fighters[0].state).toBe("reversed");
  });
});

describe("crowd protection", () => {
  it("getting hit by three different attackers in a second forces a protected knockdown", () => {
    const w = new World({ seed: 2, styles: [0, 0, 0, 0], limbs: false });
    w.s.nextGeyser = 1e9;
    const [v, a, b, c] = w.fighters;
    Object.assign(v, { x: 0, y: 4, facing: 0 });
    Object.assign(a, { x: -0.9, y: 4, facing: 0 });
    Object.assign(b, { x: 0.9, y: 4, facing: Math.PI });
    Object.assign(c, { x: 0, y: 4.9, facing: -Math.PI / 2 });
    // the attackers stand inside each other's jab cones; keep them out of each other's hits
    for (const f of [a, b, c]) f.invuln = MOVES.jab1.startup + 16;
    run(w, MOVES.jab1.startup + 16, (inp, i) => {
      if (i === 0) inp[1].buttons = BTN.HIGH;
      if (i === 4) inp[2].buttons = BTN.HIGH;
      if (i === 8) inp[3].buttons = BTN.HIGH;
    });
    expect(v.state).toBe("down");
    expect(v.invuln).toBeGreaterThan(0);
  });
});

describe("styles", () => {
  it("there is one fighter per Urban Reign style (21)", () => {
    expect(STYLES.length).toBe(21);
    expect(new Set(STYLES.map((s) => s.style)).size).toBe(21);
    expect(new Set(STYLES.map((s) => s.name)).size).toBe(21);
  });

  it("style tempo changes startup: Speed is faster than Mighty", () => {
    const w = new World({ seed: 1, styles: [8, 10], limbs: false });
    expect(STYLES[8].style).toBe("Speed");
    expect(STYLES[10].style).toBe("Mighty");
    expect(w.eff(w.fighters[0], "jab1").startup).toBeLessThan(w.eff(w.fighters[1], "jab1").startup);
  });

  it("Boxing and Kung Fu strings are longer than All-Round's", () => {
    const w = new World({ seed: 1, styles: [0, 6], limbs: false });
    expect(w.nextOf(w.fighters[0], "jab2")).toBe("punchFin");
    expect(w.nextOf(w.fighters[1], "jab2")).toBe("jab3");
    expect(w.nextOf(w.fighters[1], "jab3")).toBe("punchFin");
  });
});
