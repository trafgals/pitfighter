import { afterEach, describe, expect, it } from "vitest";
import { DEFAULTS, TUNABLES, apply, changed, reset, snapshot } from "../src/lab/tunables";
import { Player, Recorder, buildMatch, inputsFor, type Setup } from "../src/lab/replay";
import { KNOCK } from "../src/sim/moves";
import { BTN, type PlayerInput } from "../src/sim/types";
import type { World } from "../src/sim/world";

afterEach(() => reset());

describe("the lab's dials", () => {
  it("are live numbers, with their defaults inside the slider's range", () => {
    const ids = new Set<string>();
    for (const t of TUNABLES) {
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
      expect(typeof t.obj[t.key], t.id).toBe("number");
      expect(t.min, t.id).toBeLessThan(t.max);
      expect(DEFAULTS[t.id], t.id).toBeGreaterThanOrEqual(t.min);
      expect(DEFAULTS[t.id], t.id).toBeLessThanOrEqual(t.max);
    }
  });

  it("set the constants the sim reads, and come back to the defaults", () => {
    apply({ "knock.hitstun": 4, "camera.pitch": 50, "nonsense.key": 3 });
    expect(KNOCK.hitstun).toBe(4);
    expect(changed()).toEqual({ "knock.hitstun": 4, "camera.pitch": 50 });
    const p = snapshot();
    reset();
    expect(KNOCK.hitstun).toBe(DEFAULTS["knock.hitstun"]);
    expect(changed()).toEqual({});
    apply(p);
    expect(snapshot()).toEqual(p);
  });
});

const SETUP: Setup = { seed: 7, styles: [0, 3], humans: [true, false], stage: "collapsing-tower", practice: true };

/** A player's hands: walk up to the dummy and jab whenever it is in reach. */
function hands(w: World, frame: number): PlayerInput {
  const [me, it] = w.fighters;
  const dx = it.x - me.x;
  const dy = it.y - me.y;
  const d = Math.hypot(dx, dy);
  if (d > 1.1) return { x: dx / d, y: dy / d, buttons: 0 };
  return { x: 0, y: 0, buttons: frame % 14 === 0 ? BTN.HIGH : 0 };
}

/** Record a take of `frames` steps, counting the hits it lands. */
function recordTake(setup: Setup, frames: number) {
  const m = buildMatch(setup);
  const rec = new Recorder(setup);
  let hits = 0;
  for (let i = 0; i < frames; i++) {
    const inputs = inputsFor(m, (k) => (k === 0 ? hands(m.world, i) : undefined));
    rec.push(inputs);
    m.world.step(inputs);
    hits += m.world.s.events.filter((e) => e.kind === "hit" && e.a === 0).length;
  }
  return { take: rec.take, end: state(m.world), hits };
}

function play(take: ReturnType<typeof recordTake>["take"]) {
  const p = new Player(take);
  while (!p.done) p.match.world.step(p.next());
  return state(p.match.world);
}

const state = (w: World) => w.fighters.map((f) => ({ x: f.x, y: f.y, state: f.state, t: f.t, hp: Object.values(f.parts).map((p) => p.hp) }));

describe("a lab take", () => {
  it("replays frame for frame on the same dials", () => {
    const { take, end, hits } = recordTake(SETUP, 420);
    expect(hits).toBeGreaterThan(2);
    expect(take.frames).toHaveLength(420);
    expect(take.frames[0][1]).toBeNull(); // only the human's hands are kept
    expect(play(take)).toEqual(end);
    expect(play(take)).toEqual(end);
  });

  it("plays out differently when a sim dial is turned", () => {
    const { take, end } = recordTake(SETUP, 420);
    apply({ "knock.hitstun": 3 });
    expect(play(take)).not.toEqual(end);
  });

  it("replays a sparring CPU the same way too", () => {
    const spar = { ...SETUP, spar: true };
    expect(buildMatch(spar).bots[1]).not.toBeNull();
    expect(buildMatch(SETUP).bots[1]).toBeNull();
    const { take, end } = recordTake(spar, 300);
    expect(play(take)).toEqual(end);
  });
});
