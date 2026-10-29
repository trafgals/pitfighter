import { spawnSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const STAGE = path.join(ROOT, "tools", "props", "redo_stage.py");

/** The python on this machine, if there is one. */
function findPython(): string | null {
  for (const candidate of ["python3", "python", "py"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

const PYTHON = findPython();

/** What the stage reader reads a set of comment bodies as. */
function detect(bodies: string[]) {
  const result = spawnSync(PYTHON!, [STAGE, "--detect"], {
    input: JSON.stringify(bodies),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "the stage reader failed");
  return JSON.parse(result.stdout) as { stage: string | null; error: string | null; text: string }[];
}

/** What the stage reader reads a request in plain words as. */
function detectText(texts: string[]) {
  const result = spawnSync(PYTHON!, [STAGE, "--detect-text"], {
    input: JSON.stringify(texts),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "the stage reader failed");
  return JSON.parse(result.stdout) as { stage: string | null; reason: string }[];
}

describe.skipIf(!PYTHON)("the stage a rebuild starts from", () => {
  it("rebuilds the mesh for a plain /revision", () => {
    const [read] = detect(["/revision the grip is smooth"]);
    expect(read.stage).toBe("mesh");
    expect(read.error).toBeNull();
    expect(read.text).toContain("the grip is smooth");
  });

  it("rebuilds from the stage the command names", () => {
    const [art] = detect(["/revision --stage=art the hat is not round"]);
    const [cutout] = detect(["/revision --stage=cutout the cutout is ragged"]);
    const [sheet] = detect(["/revision --stage=sheet the sheet is wrong"]);
    expect([art.stage, cutout.stage, sheet.stage]).toEqual(["art", "cutout", "sheet"]);
  });

  it("refuses a stage it does not know rather than guessing", () => {
    const [read] = detect(["/revision --stage=teapot the hat is not round"]);
    expect(read.stage).toBeNull();
    expect(read.error).toContain("teapot");
  });

  it("does not read the pipeline's own comments as commands", () => {
    const [read] = detect(["### 🚀 Pixal3D Multi-View Reconstruction complete\n<!-- pixal3d-pipeline -->"]);
    expect(read.stage).toBeNull();
    expect(read.error).toBeNull();
  });

  it("reads the stage out of a reviewer's own words", () => {
    const read = detectText([
      "start again and completely regenerate from 2d stage, before BiRefNet Watertight Alpha Cutout",
      "complete redo, make the hat round",
      "redo from BiRefNet Watertight Alpha Cutout onwards\nensure the initial view captures the whole bat",
      "redo from 2. 2D Orthographic Turnaround & 360° Turntable (Gate 2) onwards",
    ]);
    expect(read.map((r) => r.stage)).toEqual(["art", "art", "cutout", "sheet"]);
    for (const hit of read) expect(hit.reason).not.toBe("");
  });

  it("says so when a request names no stage", () => {
    const [read] = detectText(["the hat is not round"]);
    expect(read.stage).toBeNull();
    expect(read.reason).toContain("no stage");
  });
});
