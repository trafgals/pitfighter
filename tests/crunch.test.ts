// Crunch: a body flying fast into a wall, a prop or another fighter is hurt by
// it, limb first, and bounces off; a flying body knocks down whoever it hits.
// All of it is decided in the sim, so the renderer's ragdoll only follows.
import { describe, expect, it } from "vitest";
import { CRUNCH } from "../src/sim/moves";
import { World } from "../src/sim/world";
import { idle, run } from "./helpers";
import type { Fighter } from "../src/sim/types";

function world(n = 2): World {
  const w = new World({ seed: 5, styles: Array(n).fill(0), humans: Array(n).fill(true) });
  w.s.nextGeyser = 1e9;
  w.fighters.forEach((f, i) => Object.assign(f, { x: -6, y: -6 + i * 2.5 }));
  return w;
}

/** Up in a juggle at (x, y), flying at (vx, vy). */
function fly(f: Fighter, x: number, y: number, vx: number, vy: number): void {
  Object.assign(f, { state: "air", t: 0, dur: 0, x, y, z: 0.8, vz: 0, juggle: 2, slideX: vx, slideY: vy, moveHits: [] });
}

const limbs = (f: Fighter) => (["head", "armL", "armR", "legL", "legR"] as const).reduce((a, p) => a + f.parts[p].hp, 0);

describe("crunch", () => {
  it("a juggled body flying into the toilet is hurt, limb first, and bounces back off it", () => {
    const w = world();
    const b = w.fighters[1];
    fly(b, 0.9, 0, -0.12, 0);
    const before = limbs(b);
    let crunch;
    for (let i = 0; i < 10 && !crunch; i++) {
      w.step(idle(2));
      crunch = w.s.events.find((e) => e.kind === "crunch" && e.a === 1);
    }
    expect(crunch).toBeTruthy();
    expect(crunch!.dmg).toBeGreaterThan(0);
    expect(limbs(b)).toBeLessThan(before);
    run(w, 3);
    expect(b.slideX).toBeGreaterThan(0); // rebounding away from the bowl
  });

  it("a slow drift into the same wall does nothing", () => {
    const w = world();
    const b = w.fighters[1];
    fly(b, 0.6, 0, -(CRUNCH.speed * 0.5), 0);
    const hp = b.parts.torso.hp;
    run(w, 10, () => expect(w.s.events.some((e) => e.kind === "crunch")).toBe(false));
    expect(b.parts.torso.hp).toBe(hp);
  });

  it("standing fighters walking into a wall never crunch", () => {
    const w = world();
    const a = w.fighters[0];
    Object.assign(a, { x: 0.9, y: 0 });
    run(w, 30, (inp) => {
      inp[0].x = -1;
      expect(w.s.events.some((e) => e.kind === "crunch")).toBe(false);
    });
  });
});

describe("the human missile", () => {
  it("a body flying fast through a standing fighter knocks them down, and both are hurt", () => {
    const w = world(3);
    const [, b, c] = w.fighters;
    Object.assign(c, { x: 3, y: 4, facing: Math.PI });
    fly(b, 1.6, 4, 0.1, 0);
    b.lastHitBy = 0;
    const [hb, hc] = [b.parts.torso.hp, c.parts.torso.hp];
    run(w, 20);
    expect(["down", "wakeup"]).toContain(c.state);
    expect(c.parts.torso.hp).toBeLessThan(hc);
    expect(b.parts.torso.hp).toBeLessThan(hb);
    expect(c.lastHitBy).toBe(0); // credited to whoever launched the missile
  });

  it("a body floating gently past does not", () => {
    const w = world(3);
    const [, b, c] = w.fighters;
    Object.assign(c, { x: 3, y: 4, facing: Math.PI });
    fly(b, 2.4, 4, CRUNCH.knock * 0.5, 0);
    b.vz = 0.03;
    run(w, 20);
    expect(c.state).not.toBe("down");
  });
});

describe("wall-splat and wall grapples", () => {
  it("a body flung fast into the outer perimeter wall enters wallsplat and can be wall-grappled", () => {
    const w = world();
    const [a, b] = w.fighters;
    Object.assign(b, { state: "thrown", t: 0, dur: 24, x: 0.9, y: 0, z: 0.5, vz: 0, slideX: -0.18, slideY: 0, partner: 0, moveHits: [0] });
    let splat;
    for (let i = 0; i < 10 && !splat; i++) {
      w.step(idle(2));
      splat = w.s.events.find((e) => e.kind === "wallsplat" && e.a === 1);
    }
    expect(splat).toBeTruthy();
    expect(b.state).toBe("wallsplat");
    expect(b.z).toBeGreaterThan(0);

    // Attacker steps up and presses Triangle (GRAB) on the wall-splatted victim
    b.stop = 0;
    Object.assign(a, { x: b.x + 0.85, y: b.y, facing: Math.PI });
    const hpBefore = b.parts.torso.hp;
    w.step([{ x: 0, y: 0, buttons: 4 }, { x: 0, y: 0, buttons: 0 }]); // BTN.GRAB = 4
    let wallThrow;
    for (let i = 0; i < 15 && !wallThrow; i++) {
      w.step(idle(2));
      wallThrow = w.s.events.find((e) => e.kind === "throw" && e.a === 0);
    }
    expect(wallThrow).toBeTruthy();
    expect(wallThrow!.what).toBeTruthy();
    expect(b.parts.torso.hp).toBeLessThan(hpBefore);
  });
});
