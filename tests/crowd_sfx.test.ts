// The crowd's reactions: which events it answers, and how it picks a take.
import { describe, expect, it } from "vitest";
import { CROWD_TAKES, crowdMix, crowdReactions, pickTake } from "../src/render/sfx";

describe("the crowd's reactions", () => {
  it("answers each moment the way a crowd would", () => {
    expect(crowdReactions("detach")).toEqual(["gasp"]);
    for (const k of ["strip", "ko", "wallsplat", "special"]) expect(crowdReactions(k), k).toEqual(["roar"]);
    expect(crowdReactions("win")).toEqual(["cheer"]);
    expect(crowdReactions("taunt-whiff")).toEqual(["boo"]);
  });

  it("stays quiet for the ordinary cues", () => {
    for (const k of ["swing", "hit", "block", "land", "grab", "burn"]) expect(crowdReactions(k), k).toEqual([]);
  });

  it("has more than one take of every reaction, and never repeats one back to back", () => {
    for (const takes of Object.values(CROWD_TAKES)) {
      expect(takes.length).toBeGreaterThan(1);
      let last: string | undefined;
      for (let i = 0; i < 40; i++) {
        const next = pickTake(takes, last, () => (i % 7) / 7);
        expect(next).not.toBe(last);
        last = next;
      }
    }
    expect(pickTake(["only"], "only")).toBe("only");
  });

  it("builds the chant and speeds it up as the hype rises", () => {
    const calm = crowdMix(0);
    const wild = crowdMix(1);
    expect(calm.chant).toBe(0);
    expect(crowdMix(0.3).chant).toBe(0);
    expect(wild.chant).toBeGreaterThan(crowdMix(0.6).chant);
    expect(wild.chantRate).toBeGreaterThan(calm.chantRate);
    expect(wild.murmur).toBeGreaterThan(calm.murmur);
    expect(calm.murmur).toBeGreaterThan(0);
  });
});
