// The validation boxes a prop carries are boxes the mesh agrees with.
//
// A box that the mesh disagrees with cannot pass. The capture measures the
// surface inside the box, and a box that has to be filled comes out empty and
// a box that has to be clear comes out full of the prop: the finding is about
// the box, not about the mesh.
//
// Three props were held on exactly that. The shovel's and the cleaver's box
// that asks for the prop's surface came out with no surface in it at all,
// because the shovel's art is drawn on the diagonal and stretching its crop
// over the mesh puts the cell that holds the blade where the handle is. The
// chair's box that asks for clear space came out full of the chair, because
// the space that is empty in the drawing is not empty in three dimensions.
//
// The tool that cuts the boxes now falls back to the turnaround sheet - the
// same art, upright and centred, the very thing the mesh was built from -
// and the mesh's own surface chooses which of the sheet's cells the box is.
// These tests hold that down: the boxes every prop carries have to be boxes
// the mesh agrees with, and a box the art cannot place has to be placed from
// the sheet.
import * as path from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CHECK = path.join(ROOT, "tools", "props", "check_regions.py");

/** The python on this machine, if there is one. */
function findPython(): string | null {
  for (const candidate of ["python3", "python", "py"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

const PYTHON = findPython();

type Region = {
  asset: string;
  source: "manifest" | "art";
  label: string;
  expect: string;
  limit: number;
  area: number;
  ok: boolean;
  min_cm: number[];
  max_cm: number[];
};

/** What the tool reads a prop's boxes as. */
function regionsOf(assetId: string): Region[] {
  const result = spawnSync(PYTHON!, [CHECK, assetId, "--json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 && !result.stdout.trim()) {
    throw new Error(result.stderr || "the region checker failed");
  }
  const lines = result.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]) as Region[];
}

describe.skipIf(!PYTHON)("the validation boxes of every rebuilt prop", () => {
  it("are boxes the mesh agrees with", () => {
    // the whole manifest, every region of every prop that has a mesh: a box
    // that cannot pass is a prop that will be held on a finding that is about
    // the box, and this is the check that catches it before the capture does
    const result = spawnSync(PYTHON!, [CHECK], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    expect(result.stdout).toContain("every region's box is a box the mesh agrees with");
    expect(result.status).toBe(0);
  }, 180_000);

  it("cuts a box the art cannot place from the sheet instead", () => {
    // the shovel's art is drawn on the diagonal, so the box its upper half
    // gives lands where the handle is and asks for surface that is not there
    const regions = regionsOf("weapon_coal_shovel");
    const upper = regions.filter((r) => r.label.startsWith("the upper half"));
    const fromArt = upper.find((r) => r.source === "art")!;
    const fromSheet = upper.find((r) => r.source === "manifest")!;

    expect(fromArt.area).toBeLessThan(fromArt.limit);
    expect(fromSheet.area).toBeGreaterThanOrEqual(fromSheet.limit);
  }, 120_000);

  it("leaves a box the art places well alone", () => {
    // the shovel's lower half is placed by the art correctly, so the box the
    // manifest carries is the art's own box - the fallback is a fallback, and
    // a box that fits is not touched
    const regions = regionsOf("weapon_coal_shovel");
    const lower = regions.filter((r) => r.label.startsWith("the lower half"));
    const fromArt = lower.find((r) => r.source === "art")!;
    const fromSheet = lower.find((r) => r.source === "manifest")!;

    expect(fromSheet.min_cm).toEqual(fromArt.min_cm);
    expect(fromSheet.max_cm).toEqual(fromArt.max_cm);
    expect(fromSheet.area).toBeGreaterThanOrEqual(fromSheet.limit);
  }, 120_000);
});
