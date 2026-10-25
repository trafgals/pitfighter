// Juggles: the neutral string's finisher launches (as Urban Reign's does), the
// body floats on a soft gravity that never grows, every blow in the air pops it
// up again, and the victim steers with the stick, harder for every hit taken.
import { describe, expect, it } from "vitest";
import { AIR, MOVES } from "../src/sim/moves";
import type { World } from "../src/sim/world";
import { BTN, duel, idle, run, tap } from "./helpers";

/** Mash the string until the dummy goes up; returns the world on the launch frame. */
function launched(gap = 1.0): World {
  const w = duel(gap);
  w.fighters[0].y = w.fighters[1].y = 4; // clear of the toilet in the middle
  for (let i = 0; i < 120 && w.fighters[1].state !== "air"; i++) {
    const inp = idle(2);
    if (i % 4 === 0) inp[0].buttons = BTN.HIGH;
    w.step(inp);
  }
  expect(w.fighters[1].state).toBe("air");
  return w;
}

/** Step until fighter 0 can act again (the launcher's recovery and its hitstop), then step in under the body. */
function recover(w: World): void {
  for (let i = 0; i < 120 && !["idle", "walk"].includes(w.fighters[0].state); i++) w.step(idle(2));
  run(w, 6, (inp) => (inp[0].x = 1));
}

describe("the launch", () => {
  it("the string's finisher sends the dummy up, floats it, bounces it once and lays it down", () => {
    expect(MOVES.punchFin.launch).toBe(true);
    const w = launched();
    const b = w.fighters[1];
    let peak = 0;
    let bounces = 0;
    let frames = 0;
    while (b.state === "air" && frames < 400) {
      w.step(idle(2));
      peak = Math.max(peak, b.z);
      bounces += w.s.events.filter((e) => e.kind === "bounce" && e.a === 1).length;
      frames++;
    }
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThan(AIR.high); // a follow-up can still reach it
    expect(frames).toBeGreaterThan(60); // floaty: over a second up there
    expect(bounces).toBe(1);
    expect(b.state).toBe("down");
    expect(b.z).toBe(0);
  });

  it("a jab after the launcher recovers lands in the air and pops the dummy back up", () => {
    const w = launched();
    const b = w.fighters[1];
    recover(w);
    expect(b.state).toBe("air");
    const before = b.juggle;
    let vz = 0;
    tap(w, 0, BTN.HIGH);
    for (let i = 0; i < 20 && b.juggle === before; i++) {
      w.step(idle(2));
      vz = b.vz;
    }
    expect(b.juggle).toBe(before + 1);
    expect(vz).toBeGreaterThan(0);
    expect(b.state).toBe("air");
  });
});

describe("gravity never grows", () => {
  it("the fall speeds up by the same AIR.g every frame, however many hits the juggle has taken", () => {
    for (const juggle of [1, 4, 12]) {
      const w = launched();
      const b = w.fighters[1];
      b.juggle = juggle;
      b.stop = 0;
      w.fighters[0].stop = 0;
      const v0 = b.vz;
      w.step(idle(2));
      expect(v0 - b.vz).toBeCloseTo(AIR.g, 9);
    }
  });

  it("after maxPops hits, a blow in the air still lands but no longer lifts", () => {
    const w = launched();
    const b = w.fighters[1];
    b.juggle = AIR.maxPops;
    recover(w);
    const vz = b.vz;
    const before = b.juggle;
    tap(w, 0, BTN.HIGH);
    for (let i = 0; i < 20 && b.juggle === before; i++) w.step(idle(2));
    expect(b.juggle).toBe(before + 1);
    expect(b.vz).toBeLessThan(vz);
  });
});

describe("air control", () => {
  /** sideways drift over 20 frames with the stick held, at a given juggle count */
  function drift(juggle: number): number {
    const w = launched();
    const b = w.fighters[1];
    b.juggle = juggle;
    b.vz = 0.06; // stay up for the whole measurement
    const y0 = b.y;
    run(w, 20, (inp) => (inp[1].y = 1));
    return b.y - y0;
  }

  it("the stick steers a juggled body, and harder the more hits it has taken", () => {
    const one = drift(1);
    const five = drift(5);
    expect(one).toBeGreaterThan(0);
    expect(five).toBeGreaterThan(one * 3);
    expect(drift(100)).toBeCloseTo(drift(AIR.steerMax / AIR.steer + 1), 6); // capped
  });

  it("holding away from the attacker as a blow lands flies the body further, more for every juggle hit", () => {
    const far = (hold: boolean, juggle: number) => {
      const w = launched();
      const [, b] = w.fighters;
      recover(w);
      b.juggle = juggle;
      const x0 = b.x;
      tap(w, 0, BTN.HIGH, (inp) => hold && (inp[1].x = 1));
      run(w, 30, (inp) => hold && (inp[1].x = 1));
      return b.x - x0;
    };
    expect(far(true, 2)).toBeGreaterThan(far(false, 2));
    expect(far(true, 6) - far(false, 6)).toBeGreaterThan(far(true, 2) - far(false, 2));
  });

  it("a body flown above AIR.high is out of reach of any strike", () => {
    const w = launched();
    const b = w.fighters[1];
    recover(w);
    b.z = AIR.high + 0.2;
    b.vz = 0.05;
    const hp = b.parts.torso.hp;
    tap(w, 0, BTN.HIGH);
    run(w, 20);
    expect(b.parts.torso.hp).toBe(hp);
  });
});

describe("the CPU in the air", () => {
  it("a juggled CPU steers away from whoever hit it", async () => {
    const { Bot } = await import("../src/sim/ai");
    const w = launched();
    const b = w.fighters[1];
    const bot = new Bot(1, 7, 0.8);
    const inp = bot.think(w);
    expect(b.state).toBe("air");
    expect(inp.x).toBeGreaterThan(0.5); // the attacker is on the left
  });
});
