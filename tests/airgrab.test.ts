// Air grabs: Triangle on a juggled body in reach catches it out of the air with
// the style's own grab (the torso's, whatever limbs it wears), whose strength
// is the arms'. Out of reach, it whiffs like any grapple.
import { describe, expect, it } from "vitest";
import { AIR_GRAB, AIR_GRABS } from "../src/sim/airgrabs";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";
import { BTN, chop, duel, idle, run, tap } from "./helpers";
import type { Fighter } from "../src/sim/types";

const styleOf = (label: string) => STYLES.findIndex((s) => s.style === label);

/** fighter 1 up in a juggle, `gap` metres in front of fighter 0 */
function juggled(style = 0, gap = 1.0, z = 1.0): World {
  const w = duel(gap, [style, 0]);
  const b = w.fighters[1];
  w.fighters[0].y = b.y = 4; // clear of the toilet
  Object.assign(b, { state: "air", t: 0, dur: 0, z, vz: 0.03, juggle: 3, moveHits: [0], lastHitBy: 0 });
  return w;
}

/** step until the air grab is over; returns the victim's torso damage and the events seen */
function finish(w: World): { dmg: number; kinds: string[]; name?: string } {
  const b = w.fighters[1];
  const hp = b.parts.torso.hp;
  const kinds: string[] = [];
  let name: string | undefined;
  for (let i = 0; i < 200; i++) {
    w.step(idle(2));
    for (const e of w.s.events) {
      kinds.push(e.kind);
      if (e.kind === "airgrab") name = e.what;
    }
    if (i > 2 && w.fighters[0].state !== "airslam" && b.state !== "airslammed") break;
  }
  return { dmg: hp - b.parts.torso.hp, kinds, name };
}

describe("air grabs", () => {
  it("every style has its own, with its own name", () => {
    const names = new Set<string>();
    for (const s of STYLES) {
      const g = AIR_GRABS[s.style];
      expect(g, s.style).toBeTruthy();
      expect(g.slam).toBeLessThan(g.dur);
      names.add(g.name);
    }
    expect(names.size).toBe(STYLES.length);
  });

  it("Triangle on a juggled body in reach catches it, carries it and slams it down", () => {
    const w = juggled();
    const [a, b] = w.fighters;
    tap(w, 0, BTN.GRAB);
    let name: string | undefined;
    run(w, 3, () => (name ??= w.s.events.find((e) => e.kind === "airgrab")?.what));
    expect(a.state).toBe("airslam");
    expect(b.state).toBe("airslammed");
    expect(b.z).toBeGreaterThan(0.3); // carried, not dropped
    const r = finish(w);
    expect(name).toBe(AIR_GRABS[STYLES[0].style].name);
    expect(r.dmg).toBeGreaterThan(5);
    expect(["down", "wakeup"]).toContain(b.state);
    expect(b.z).toBe(0);
    expect(a.state).toBe("idle");
  });

  it("out of reach, or flown above an outstretched arm, it whiffs", () => {
    for (const w of [juggled(0, AIR_GRAB.reach + 0.6), juggled(0, 1.0, AIR_GRAB.height + 0.3)]) {
      const [a, b] = w.fighters;
      if (b.z > AIR_GRAB.height) b.vz = 0.05; // stay up there
      tap(w, 0, BTN.GRAB);
      run(w, 5);
      expect(a.state).toBe("attack");
      expect(a.move).toBe("grab");
      expect(b.state).toBe("air");
    }
  });

  it("the ending is the style's: a bounce sends them back up, a throw flings them on", () => {
    const bounce = juggled(styleOf("Karate"));
    tap(bounce, 0, BTN.GRAB);
    const rb = finish(bounce);
    expect(AIR_GRABS.Karate.end).toBe("bounce");
    expect(rb.kinds).toContain("bounce");
    expect(bounce.fighters[1].state).toBe("air");

    const thrown = juggled(styleOf("Samurai Sword"));
    const x0 = thrown.fighters[1].x;
    tap(thrown, 0, BTN.GRAB);
    finish(thrown);
    run(thrown, 30);
    expect(thrown.fighters[1].x - x0).toBeGreaterThan(2.5);
  });

  it("it belongs to the torso: a transplanted arm keeps the grab, but the arms set its strength", () => {
    const both = juggled();
    tap(both, 0, BTN.GRAB);
    const full = finish(both);
    const w = juggled();
    chop(w, w.fighters[0], "armL", 1);
    w.fighters[1].parts.torso.hp = w.fighters[1].parts.torso.max;
    tap(w, 0, BTN.GRAB);
    const one = finish(w);
    expect(one.name).toBe(full.name);
    expect(one.dmg).toBeCloseTo(full.dmg * 0.7, 0);
  });

  it("nobody can hit either of them mid-grab", () => {
    const w = new World({ seed: 2, styles: [0, 0, 0], humans: [true, true, true] });
    w.s.nextGeyser = 1e9;
    const [a, b, c] = w.fighters as Fighter[];
    Object.assign(a, { x: 0, y: 4, facing: 0 });
    Object.assign(b, { x: 1, y: 4, state: "air", z: 1, vz: 0.03, juggle: 2, moveHits: [0] });
    Object.assign(c, { x: -1, y: 4, facing: 0 });
    tap(w, 0, BTN.GRAB);
    run(w, 4);
    expect(a.state).toBe("airslam");
    const hp = a.parts.torso.hp;
    tap(w, 2, BTN.HIGH);
    run(w, 20);
    expect(a.parts.torso.hp).toBe(hp);
  });
});
