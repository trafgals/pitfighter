// The issue page is the review surface, so it has to show the art the model
// was built from.
//
// The models did not drift away from the concept art - the pages did. A prop
// whose art was redone has two sets of references, and the issue kept
// showing the old one: the crimson velvet chair on the page while the model
// was the black leather wingback the new art shows. A reviewer looking at
// that concludes that the model has abandoned the art, when the model is a
// faithful copy of the art one click away.
//
// These tests hold that down. The body an issue is given is rewritten from
// the manifest - the one place that knows which art a prop came from - and
// the rewritten body has to point at that art, at the branch the files are
// on, and at the numbers the manifest carries.
import * as path from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TOOL = path.join(ROOT, "tools", "props", "update_issue.py");

/** The python on this machine, if there is one. */
function findPython(): string | null {
  for (const candidate of ["python3", "python", "py"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

const PYTHON = findPython();

/** The body the tool writes for a given issue body. */
function rewrite(assetId: string, body: string): string {
  const result = spawnSync(PYTHON!, [TOOL, "--rewrite", assetId], {
    input: body,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || "the rewrite failed");
  return result.stdout;
}

const manifest = JSON.parse(
  spawnSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('data/asset_manifest.json','utf8'))"], {
    encoding: "utf8",
  }).stdout,
);

/** The entry the manifest carries for an asset. */
function entryOf(assetId: string) {
  return manifest.assets.find((asset: { id: string }) => asset.id === assetId);
}

/** An issue body of the shape the issues are written in. */
function issueBody(assetId: string): string {
  const entry = entryOf(assetId);
  return [
    "### Asset Tracking & Specification",
    "",
    `* **Asset ID:** \`${assetId}\``,
    "* **Physical Dimensions:** `10 × 10 × 10 cm`",
    `* **Active Status:** \`${entry.status}\``,
    "",
    "---",
    "",
    "### 1. 2D Still References (Gate 1: North Star Concept)",
    "",
    "| FLUX 3 Concept Art | BiRefNet Watertight Alpha Cutout |",
    "| :---: | :---: |",
    "| ![Concept](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/public/tex/props/old_art.png) | ![Cutout](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/public/tex/props/old_alpha.png) |",
    "| [`public/tex/props/old_art.png`](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/public/tex/props/old_art.png) | [`public/tex/props/old_alpha.png`](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/public/tex/props/old_alpha.png) |",
    "",
    "---",
    "",
    "### 2. 2D Orthographic Turnaround & 360° Turntable (Gate 2)",
    "",
    "#### MiniMax H3 4-View Orthographic Turnaround Sheet (0° Front, 90° Right Profile, 180° Rear, 270° Left Profile)",
    "![4-View Turnaround](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/public/tex/props/old_sheet.png)",
    "* **Turnaround Sheet:** [`public/tex/props/old_sheet.png`](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/public/tex/props/old_sheet.png)",
    "",
    "---",
    "",
    "### 3. Production 3D Model Verification Renders (Gate 3)",
    "",
    "| Front View (0°) | Right Profile (90°) | Detail Close-up |",
    "| :---: | :---: | :---: |",
    "| ![Front Render](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/docs/props/x/front.png) | ![Profile Render](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/docs/props/x/profile.png) | ![Detail Close-up](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/docs/props/x/badge.png) |",
    "",
    "* **Production GLB:** [`x.glb`](https://raw.githubusercontent.com/trafgals/pitfighter/feat/3d-assets-batch-wave-1/public/models/props/x.glb) (999 triangles | 9.99 MB)",
    "* **Validation:** 1 / 1 automated quality checks passing.",
    "",
    "---",
    "",
    "### Human-in-the-Loop Review Controls",
    "",
    "* To approve the final 3D asset for in-game production: comment `/approve-3d`.",
    "",
    "---",
    "",
    "### 3. 3D Model Status (Gate 3: Pixal3D Rebuild Queue)",
    "",
    "* **Checks:** **0 / 0** automated quality checks pass.",
    "",
    "---",
    "",
    "### 3. 3D Model Status (Gate 3: Pixal3D Rebuild Queue)",
    "",
    "* **Checks:** **0 / 0** automated quality checks pass.",
    "",
  ].join("\n");
}

describe.skipIf(!PYTHON)("the issue body is written from the manifest", () => {
  it("points at the art the model was built from, not the art it replaced", () => {
    const entry = entryOf("weapon_chair");
    const body = rewrite("weapon_chair", issueBody("weapon_chair"));
    expect(entry.reference_concept).toContain("redo_art");
    expect(body).toContain(entry.reference_concept);
    expect(body).toContain(entry.alpha_cutout);
    expect(body).toContain(entry.turnaround_sheet);
    expect(body).not.toContain("flux3_chair_alpha.png");
    expect(body).not.toContain("h3_chair_turnaround.png");
  });

  it("points at the branch the files are on", () => {
    const body = rewrite("weapon_chair", issueBody("weapon_chair"));
    expect(body).not.toContain("feat/3d-assets-batch-wave-1");
    expect(body).toContain("feat/pixal3d-props-rebuild");
    // a link is not doubled up by the rewrite
    expect(body).not.toContain("pixal3d-props-rebuild/pixal3d-props-rebuild");
  });

  it("carries the dimensions the manifest carries", () => {
    const entry = entryOf("weapon_chair");
    const spec = entry.scale_dimensions_cm;
    const body = rewrite("weapon_chair", issueBody("weapon_chair"));
    expect(body).toContain(`${spec.width} × ${spec.height} × ${spec.depth} cm`);
    expect(body).not.toContain("`10 × 10 × 10 cm`");
  });

  it("carries the status section once, not once per update", () => {
    const body = rewrite("weapon_chair", issueBody("weapon_chair"));
    const headings = body.match(/### 3\. 3D Model Status/g) ?? [];
    expect(headings.length).toBe(1);
  });

  it("says what the capture found, from the capture's own report", () => {
    const body = rewrite("weapon_chair", issueBody("weapon_chair"));
    // the report is the capture's record, so the issue repeats its numbers
    expect(body).toMatch(/\* \*\*Checks:\*\* \*\*\d+ \/ \d+\*\* automated quality checks pass\./);
    expect(body).toMatch(/\* \*\*Validation:\*\* \d+ \/ \d+ automated quality checks passing\./);
  });
});
