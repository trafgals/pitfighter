// Every fighter on the lobby cards has a concept painting, and it is really on disk.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/data/characters";

describe("the lobby concept art", () => {
  it("gives every fighter an art.concept that exists under public/", () => {
    for (const c of CHARACTERS) {
      expect(c.art.concept, c.id).toMatch(/^tex\/characters\/[a-z_]+\.(png|jpg)$/);
      expect(existsSync(`public/${c.art.concept}`), `${c.id}: ${c.art.concept}`).toBe(true);
    }
  });

  it("uses a different painting for each fighter", () => {
    expect(new Set(CHARACTERS.map((c) => c.art.concept)).size).toBe(CHARACTERS.length);
  });
});
