#!/usr/bin/env node
// Put the verification renders a capture produced into the repository.
//
//   node scripts/publish_prop_renders.mjs <asset_id>
//
// The capture script renders the prop it checked at 900x1100 and writes the
// images and the report to test-output/props/<asset_id>/. A reviewer opens
// the images straight from the issue, so what goes into the repository is the
// same picture at 720x880 - the size the prop docs promise.
//
// This step used to be done by hand, and it was done wrong: the Smelt's
// renders were committed at 900x1100 and had to be corrected in a follow-up
// PR (#51). Doing the resize here, with the repo's own codec, makes the
// published size a property of the pipeline rather than of whoever ran it.
//
// Options:
//   --from <dir>   where the capture wrote its output (default test-output/props)
//   --out <dir>    where the review renders go (default docs/props)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, resizePng } from "./lib/png.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The size the review renders are committed at. It is the size the prop docs
// promise, and the capture renders are the same aspect ratio, so the framing
// of the picture does not move when it is resized.
const PUBLISH_WIDTH = 720;
const PUBLISH_HEIGHT = 880;

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    console.log("usage: node scripts/publish_prop_renders.mjs <asset_id> [--from <dir>] [--out <dir>]");
    process.exit(0);
  }
  if (arg === "--from" || arg === "--out") {
    flags[arg.slice(2)] = args[++i];
    continue;
  }
  positional.push(arg);
}

const assetId = positional[0];
if (!assetId) {
  console.error("usage: node scripts/publish_prop_renders.mjs <asset_id> [--from <dir>] [--out <dir>]");
  process.exit(2);
}

const sourceRoot = path.resolve(ROOT, flags.from || "test-output/props");
const targetRoot = path.resolve(ROOT, flags.out || "docs/props");
const sourceDir = path.join(sourceRoot, assetId);
const targetDir = path.join(targetRoot, assetId);
// The renders are written here first and moved into place once every one of
// them has succeeded, so a run that fails half way through cannot leave the
// directory holding new images next to old ones.
const stagingDir = path.join(targetRoot, `.${assetId}.publishing`);
const reportPath = path.join(sourceDir, "report.json");

if (!fs.existsSync(reportPath)) {
  console.error(`no capture report at ${path.relative(ROOT, reportPath)}`);
  console.error("run the capture first: node scripts/capture_prop_renders.mjs " + assetId);
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

// A capture that failed a check does not get published. The images would look
// fine - a wrong frame is a wrong frame, not a broken one - so publishing them
// would put a rejected asset in front of a reviewer as if it had passed.
//
// A report that carries no checks at all is refused for the same reason: it
// is no proof of anything, and treating it as a pass would publish an asset
// nobody verified.
const checks = report.checks;
if (!Array.isArray(checks) || !checks.length) {
  console.error("the capture report carries no checks, so there is no proof that the asset passed");
  process.exit(1);
}
const failed = checks.filter((check) => check.ok !== true);
if (failed.length) {
  console.error(`the capture failed ${failed.length} check(s), so there is nothing to publish:`);
  for (const check of failed) console.error(`  - ${check.message}${check.detail ? ` (${check.detail})` : ""}`);
  process.exit(1);
}

const renders = report.renders || [];
if (!renders.length) {
  console.error("the capture report names no renders");
  process.exit(2);
}

/**
 * Where a render in the report actually is on disk.
 *
 * The capture's own directory comes first: the report's path says where the
 * capture wrote its output, which is not where it is when the capture has
 * been moved or copied somewhere else.
 */
function resolveRender(render) {
  const candidates = [path.join(sourceDir, `${render.view}.png`)];
  if (render.file) candidates.push(path.isAbsolute(render.file) ? render.file : path.join(ROOT, render.file));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** The mean of each colour channel, which is what says whether a resize kept the picture. */
function channelMeans(image) {
  const total = [0, 0, 0];
  const pixels = image.width * image.height;
  for (let i = 0; i < pixels; i++) {
    total[0] += image.data[i * 4];
    total[1] += image.data[i * 4 + 1];
    total[2] += image.data[i * 4 + 2];
  }
  return total.map((sum) => sum / pixels);
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
console.log(`asset        ${assetId}`);
console.log(`publishing   ${path.relative(ROOT, targetDir)}`);

try {
  for (const render of renders) {
    const source = resolveRender(render);
    if (!source) {
      throw new Error(`the report names ${render.view}.png but there is no such file`);
    }
    const sourceBytes = fs.readFileSync(source);
    const sourceImage = decodePng(sourceBytes);

    // The framing of the picture comes from the shape of the frame, so a
    // capture of another shape would be stretched rather than resized. It is
    // refused instead: a stretched render is a wrong render.
    if (sourceImage.width * PUBLISH_HEIGHT !== sourceImage.height * PUBLISH_WIDTH) {
      throw new Error(
        `the capture is ${sourceImage.width}x${sourceImage.height}, which is not the shape of ${PUBLISH_WIDTH}x${PUBLISH_HEIGHT}; resizing it would stretch the picture`,
      );
    }

    const published = resizePng(sourceBytes, PUBLISH_WIDTH, PUBLISH_HEIGHT);

    // Read the published bytes back rather than trusting the resize: a codec
    // that wrote the wrong header would otherwise publish an image nobody can
    // open, and the mistake would only show up in the issue thread.
    const check = decodePng(published);
    if (check.width !== PUBLISH_WIDTH || check.height !== PUBLISH_HEIGHT) {
      throw new Error(`the published ${render.view}.png is ${check.width}x${check.height}, not ${PUBLISH_WIDTH}x${PUBLISH_HEIGHT}`);
    }

    // The resize must not change the picture. A decoder that read the rows
    // wrong still produces an image of the right size, and this is what
    // catches it: the colours would come out rearranged rather than merely
    // resampled.
    const before = channelMeans(sourceImage);
    const after = channelMeans(check);
    for (let channel = 0; channel < 3; channel++) {
      if (Math.abs(before[channel] - after[channel]) > 1) {
        throw new Error(
          `the published ${render.view}.png does not match the capture (channel ${channel}: ${before[channel].toFixed(2)} vs ${after[channel].toFixed(2)})`,
        );
      }
    }

    fs.writeFileSync(path.join(stagingDir, `${render.view}.png`), published);
    console.log(
      `  ${render.view.padEnd(8)} ${path.relative(ROOT, path.join(targetDir, `${render.view}.png`))} (${(published.length / 1024).toFixed(0)} KB, ${PUBLISH_WIDTH}x${PUBLISH_HEIGHT})`,
    );
  }

  // The report is the capture's own record of what was checked, so it is
  // copied as it stands: the numbers in it are the ones the checks produced.
  fs.copyFileSync(reportPath, path.join(stagingDir, "report.json"));
} catch (error) {
  // Nothing is moved into place until every render and the report are ready,
  // and a run that fails leaves no half-written directory behind.
  fs.rmSync(stagingDir, { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
for (const file of fs.readdirSync(stagingDir)) {
  fs.copyFileSync(path.join(stagingDir, file), path.join(targetDir, file));
}
fs.rmSync(stagingDir, { recursive: true, force: true });

// The README describes what each render shows, which only someone who built
// the prop can say. A default is written when there is none, so a new asset
// arrives with a complete directory, and an existing one is never overwritten.
const readme = path.join(targetDir, "README.md");
if (!fs.existsSync(readme)) {
  const labels = renders.map((render) => `- \`${render.view}.png\` - ${render.label}.`);
  fs.writeFileSync(
    readme,
    [
      `# ${assetId}`,
      "",
      "The verification renders for this prop, produced by",
      "",
      "```",
      `node scripts/capture_prop_renders.mjs ${assetId} --publish`,
      "```",
      "",
      ...labels,
      "- `report.json` - the capture report: the budgets, the bounding box and the",
      "  checks the run passed.",
      "",
      `The renders are committed at ${PUBLISH_WIDTH}x${PUBLISH_HEIGHT} so a reviewer can open them straight from`,
      "the issue; the full-size versions are written to `test-output/props/` by the",
      "capture script and are not in the repository.",
      "",
      `The model itself is \`${report.model}\`, and the spec, the frame contract and`,
      "the measured figures are in `data/asset_manifest.json`.",
      "",
    ].join("\n"),
  );
  console.log(`  README.md written (describe what each render shows)`);
}

console.log("");
console.log(`published ${renders.length} render(s) at ${PUBLISH_WIDTH}x${PUBLISH_HEIGHT}`);
