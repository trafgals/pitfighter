// The presentation cues the sim has no event for: a body hitting the floor.
import { describe, expect, it } from "vitest";
import { CueTracker } from "../src/render/cues";
import { FALL_LAND } from "../src/render/motion";
import { DOWN, THROW } from "../src/sim/moves";
import { World } from "../src/sim/world";

const none = { buttons: 0, x: 0, y: 0 };

/** Step until fighter 0 lands, returning the frame of the land cue and the state and frame it fired on. */
function landing(setup: (w: World) => void): { state: string; t: number } | null {
  const w = new World({ seed: 3, styles: [0, 0], humans: [true, true] });
  w.fighters[1].x = 5; // out of the way
  setup(w);
  const cues = new CueTracker();
  for (let i = 0; i < 120; i++) {
    w.step([none, none]);
    const f = w.fighters[0];
    if (cues.collect(w).some((q) => q.kind === "land" && q.a === 0)) return { state: f.state, t: f.t };
  }
  return null;
}

describe("land cues", () => {
  it("a knocked-down body lands when its fall reaches the floor", () => {
    const at = landing((w) => w.setState(w.fighters[0], "down", DOWN.dur));
    expect(at).toEqual({ state: "down", t: FALL_LAND });
  });

  it("a thrown body lands as its throw ends, not a fall later", () => {
    const at = landing((w) => w.setState(w.fighters[0], "thrown", THROW.dur));
    expect(at).toEqual({ state: "down", t: 0 });
  });
});
