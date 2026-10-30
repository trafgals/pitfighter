// The capture compares the model's silhouette with the approved art, and the
// comparison is what catches a prop that was published the wrong way up.
//
// The bat is the case that matters. Its mesh is stored turned over, and the
// render used to show it that way: a reviewer opened issue #96, saw a bat
// that had nothing to do with the concept art, and was right to say so - the
// page showed a bat that was not the bat in the art. Twenty-one checks passed
// and none of them noticed, because every one of them was about the mesh and
// not about what the reviewer was looking at.
//
// These tests hold the comparison down: a silhouette and the same silhouette
// turned over have to score differently, and the score has to say which way
// round the render is.
import { describe, expect, it } from "vitest";
import { flipVertically, normalise, overlap, score } from "../tools/prop-capture/fidelity.mjs";

/** A mask with a shape in it: a wide top, a narrow bottom. */
function mask(width: number, height: number) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inTop = y < height / 2 && x > width / 4 && x < (width * 3) / 4;
      const inStem = y >= height / 2 && x > width / 3 && x < width / 2;
      out[y * width + x] = inTop || inStem ? 1 : 0;
    }
  }
  return out;
}

describe("the model's silhouette against the approved art", () => {
  it("scores a match higher than a mismatch", () => {
    const art = normalise(mask(64, 64), 64, 64);
    expect(overlap(art, art)).toBe(1);
    expect(overlap(art, flipVertically(art))).toBeLessThan(0.5);
  });

  it("says which way round the render is", () => {
    const art = normalise(mask(64, 64), 64, 64);
    // the render as it is published: the art the right way up
    const upright = score(art, art);
    expect(upright.straight).toBe(1);
    expect(upright.flipped).toBeLessThan(upright.straight);

    // the same render published the wrong way up
    const inverted = score(flipVertically(art), art);
    expect(inverted.flipped).toBeGreaterThan(inverted.straight);
  });

  it("compares shapes whatever their size", () => {
    const small = normalise(mask(32, 32), 32, 32);
    const large = normalise(mask(256, 256), 256, 256);
    // the same shape at two sizes: the resampling costs a little at the edge
    expect(overlap(small, large)).toBeGreaterThan(0.95);
  });

  it("has nothing to say about an empty mask", () => {
    const empty = new Uint8Array(64 * 64);
    const art = normalise(mask(64, 64), 64, 64);
    expect(overlap(normalise(empty, 64, 64), art)).toBe(0);
  });
});
