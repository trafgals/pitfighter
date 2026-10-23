import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { DEFAULT_STAGE, PLAYABLE_STAGES, STAGES, stageById } from "../src/sim/stages";

describe("stages", () => {
  it("lists Hell Toilet as playable and the four planned stages after it", () => {
    expect(STAGES.map((s) => [s.name, s.playable])).toEqual([
      ["Hell Toilet", true],
      ["Construction Site", false],
      ["Collapsing Tower", false],
      ["Hindenburg Blimp", false],
      ["Castle Under Siege", false],
    ]);
    expect(stageById("construction-site").blurb).toMatch(/different construction vehicle/);
    expect(PLAYABLE_STAGES.map((s) => s.id)).toEqual(["hell-toilet"]);
  });

  it("starts a match on Hell Toilet by default", () => {
    expect(DEFAULT_STAGE).toBe("hell-toilet");
    expect(new World({ seed: 1, styles: [0, 1] }).s.stage).toBe("hell-toilet");
    expect(new World({ seed: 1, styles: [0, 1], stage: "hell-toilet" }).s.stage).toBe("hell-toilet");
  });

  it("refuses to start a match on a planned stage", () => {
    expect(() => new World({ seed: 1, styles: [0, 1], stage: "construction-site" })).toThrow(/not playable/);
    expect(() => new World({ seed: 1, styles: [0, 1], stage: "collapsing-tower" })).toThrow(/not playable/);
  });
});
