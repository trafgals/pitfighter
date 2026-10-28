#!/usr/bin/env node
// Capture verification renders of a 3D prop and check it against its spec.
//
//   node scripts/capture_prop_renders.mjs <asset_id>
//   node scripts/capture_prop_renders.mjs <asset_id> --publish
//
// The asset is looked up in data/asset_manifest.json, rendered from three
// fixed angles in headless Chrome, and measured against the budgets the
// manifest records: triangle count, file size, dimensions and the frame the
// manifest's pivot convention describes - a head-socket prop's base opening,
// or a grip-normalized prop's handle. The renders and the report are written
// to test-output/props/<asset_id>/.
//
// With --publish the renders are then put into the repository at the size a
// reviewer opens them at, which is the whole publish step: docs/props/ is
// never written by hand.
//
// This is the gate a human reviewer looks at before the prop is allowed into
// the game, so it fails loudly: a missing budget check, an out-of-spec
// dimension or a mesh that will not load all end in a non-zero exit.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { inspectGlb, readWorldTriangles, surfaceAreaInBox } from "./lib/glb_inspect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PROP_CAPTURE_PORT || 5200);
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WIDTH = 900;
const HEIGHT = 1100;

const assetId = process.argv[2];
if (!assetId) {
  console.error("usage: node scripts/capture_prop_renders.mjs <asset_id> [--publish]");
  process.exit(2);
}

// Whether the run also publishes the renders into the repository.
const publish = process.argv.includes("--publish");

const manifestPath = path.join(ROOT, "data/asset_manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { assets: [] };
const entry = (manifest.assets || []).find((asset) => asset.id === assetId);

const budget = {
  triangles: entry?.poly_budget ?? 35000,
  bytes: 1.5 * 1024 * 1024,
  dimensionsCm: entry?.scale_dimensions_cm ?? { width: 22, height: 32, depth: 26 },
};
const toleranceCm = 0.2; // 2mm

// What to check, and how to frame the close-up.
//
// The checks are declared per asset in the manifest, because a prop is not
// always a badge on a helmet: a stovepipe hat has no badge, but it does have
// a flue that has to run up the middle of the crown. The defaults are the
// helmet's, so an asset with no validation block still gets checked the way
// it was before.
const validation = entry?.validation ?? {};
// An asset that declares its own validation block says what it has: a block
// with no front_mesh means the asset has no front feature at all, and the +Z
// check does not apply to it. An asset with no block keeps the helmet's
// defaults, so a missing badge there is still a failure and not a check that
// quietly goes away.
const hasValidation = !!entry?.validation;
// A head-socket prop is placed by its base opening: the rim lies on the
// origin's plane and the hat's axis runs up through it. A grip-normalized
// prop is placed by its handle instead - there is no rim to measure, and
// asking one of those props for a crown opening is a check no build of it
// could ever pass. The manifest's pivot convention is what tells the two
// apart, and a head-socket prop keeps the helmet's defaults either way.
const pivotConvention = entry?.pivot?.convention ?? "head_socket_normalized";
const isHeadSocket = pivotConvention === "head_socket_normalized";
const rimMeshName = validation.rim_mesh ?? (isHeadSocket ? "Crown_Opening_Rim" : null);
const frontMeshName = validation.front_mesh ?? (hasValidation || !isHeadSocket ? null : "Brunswick_Star_Badge_Plate");
// A prop that is placed by its handle says what sits at the origin and what
// sits in front of it, so the frame can be checked instead of trusted.
const originMeshName = validation.origin_mesh ?? null;
const forwardMeshName = validation.forward_mesh ?? null;
const axisMeshName = validation.axis_mesh ?? null;
// A generated mesh (an image-to-3D reconstruction) is one welded surface
// with no parts to name, so its frame is declared as geometry instead: where
// its bounding box has to sit, and boxes in model space that must hold
// surface or must be clear. A clear box in front of a filled one is what
// tells forward from back, so a model turned the wrong way fails it.
const frame = validation.frame ?? null;
const regions = validation.regions ?? [];
// A reconstruction's proportions come out of the model, not a builder's
// numbers, so its width and depth are held to a percentage of the spec.
const dimensionTolerancePct = validation.dimension_tolerance_pct ?? 0;
const viewFit = validation.view_fit ?? 0.17;
const closeupFit = validation.closeup_fit ?? 0.048;
const closeupLabel = validation.closeup_label ?? "Badge close-up";
// The close-up is framed on a point in the model's own space when the
// manifest gives one, and on a mesh's centre otherwise.
//
// It has to be framed on something. With no target at all the capture page
// centres the close-up on the whole model, so the "detail" render shows the
// entire prop and the run still reports success - a badge close-up that never
// showed the badge. An asset that names no close-up of its own falls back to
// the front feature it declares, and an asset that declares no validation
// block at all falls back to the helmet's badge, which is what the capture
// page used to find by itself before the target became the manifest's job.
const closeupMeshName = validation.closeup_mesh ?? frontMeshName;
const closeupFocus = validation.closeup_focus
  ? validation.closeup_focus.join(",")
  : (closeupMeshName ?? "");

const VIEWS = [
  { name: "front", label: "Front (0deg, +Z to camera)" },
  { name: "profile", label: "Profile (90deg, right side)" },
  { name: "badge", label: closeupLabel },
];

/** Where the .glb for this asset actually is. */
function resolveModel() {
  const candidates = [];
  if (entry?.glb_output) candidates.push(path.join(ROOT, entry.glb_output));
  candidates.push(path.join(ROOT, "public/models/props", `${assetId}.glb`));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const modelPath = resolveModel();
if (!modelPath) {
  console.error(`no .glb found for "${assetId}"`);
  process.exit(2);
}
const modelFile = path.relative(ROOT, modelPath).split(path.sep).join("/");

let server = null;
let browser = null;
const teardown = (code) => {
  try {
    // Chrome and its helpers go down as a tree, and taskkill is loud about
    // the ones that have already gone: it writes an ERROR line for each of
    // them to stderr, so a run that passed every check used to end in a
    // block of red noise that reads like a failure. A caller that only
    // wants the checks cannot tell the two apart.
    //
    // The kill is synchronous and its output is piped, which keeps it off the
    // console: spawnSync collects what taskkill said and gives it back as
    // buffers nobody reads, and the tree is gone before the process exits.
    const child = browser?.process?.();
    if (child?.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "pipe" });
  } catch {}
  try {
    if (server) server.kill();
  } catch {}
  process.exit(code);
};

const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout (${ms} ms): ${what}`)), ms)),
  ]);

async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  server.stderr.on("data", (data) => {
    stderr += String(data);
  });
  server.on("exit", (code) => {
    if (code) console.error(`vite exited with ${code}\n${stderr}`);
  });
  // Poll the server rather than watch its banner: the banner's wording and
  // colour codes are Vite's business, not ours, and the first run also has to
  // pre-bundle three.js.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`);
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the vite dev server did not come up on port ${PORT}\n${stderr}`);
}

const checks = [];
const check = (ok, message, detail) => {
  checks.push({ ok: !!ok, message, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}${detail ? ` - ${detail}` : ""}`);
};

async function main() {
  const outDir = path.join(ROOT, "test-output/props", assetId);
  fs.mkdirSync(outDir, { recursive: true });

  // ---- the mesh itself ----------------------------------------------------
  const report = inspectGlb(modelPath);
  const cm = (metres) => Math.round(metres * 1000) / 10;
  const expected = budget.dimensionsCm;

  console.log(`asset        ${assetId}`);
  console.log(`model        ${modelFile}`);
  console.log(`triangles    ${report.triangles} / ${budget.triangles}`);
  console.log(`bytes        ${report.bytes} / ${budget.bytes} (${(report.bytes / 1048576).toFixed(3)} MB)`);
  console.log(`dimensions   ${report.bbox.size.map(cm).join(" x ")} cm  (spec ${expected.width} x ${expected.height} x ${expected.depth})`);
  console.log(`frame        min ${report.bbox.min.map(cm).join(", ")}  max ${report.bbox.max.map(cm).join(", ")}`);
  console.log("");

  check(report.triangles > 0, "the model has triangles", `${report.triangles}`);
  check(report.triangles < budget.triangles, "triangle count is under budget", `${report.triangles} < ${budget.triangles}`);
  check(report.bytes <= budget.bytes, "file size is within budget", `${(report.bytes / 1048576).toFixed(3)} MB <= 1.5 MB`);
  check(report.problems.length === 0, "the mesh has no structural problems", report.problems.join("; "));
  check(report.nonFinite === 0, "no vertex position is NaN or infinite", `${report.nonFinite}`);

  const dims = report.bbox.size.map(cm);
  const within = (actual, spec) => Math.abs(actual - spec) <= Math.max(toleranceCm, (spec * dimensionTolerancePct) / 100);
  const toleranceLabel = dimensionTolerancePct ? ` +/- ${dimensionTolerancePct}%` : "";
  check(within(dims[0], expected.width), `width matches the spec (${expected.width} cm${toleranceLabel})`, `${dims[0]} cm`);
  check(within(dims[1], expected.height), `height matches the spec (${expected.height} cm${toleranceLabel})`, `${dims[1]} cm`);
  check(within(dims[2], expected.depth), `depth matches the spec (${expected.depth} cm${toleranceLabel})`, `${dims[2]} cm`);

  // The base opening: the crown's head-entry rim must sit on the origin's
  // plane, and the asset's axis must be centred on X. A prop that is placed
  // by its handle has no base opening, so there is nothing to measure there.
  if (rimMeshName) {
    const rim = report.meshes.find((mesh) => mesh.name === rimMeshName);
    if (rim) {
      check(
        Math.abs(rim.bbox.max[1]) <= 0.002 && Math.abs(rim.bbox.min[1]) <= 0.002,
        "the base opening sits on the origin's plane (y = 0)",
        `rim y ${cm(rim.bbox.min[1])}..${cm(rim.bbox.max[1])} cm`,
      );
      check(
        Math.abs(rim.bbox.centre[0]) <= 0.002,
        "the asset's axis is centred on X",
        `rim centre x ${cm(rim.bbox.centre[0])} cm`,
      );
    } else {
      check(false, "the model has a crown opening rim to measure", `${rimMeshName} not found`);
    }
  } else {
    console.log("  (no base opening declared for this asset: the y = 0 rim check does not apply)");
  }

  // +Z is forward: a badge has to be on the front face. Not every prop has
  // one, so this only runs for an asset that declares it - and a declared
  // badge that is not in the model is a failure, not a skipped check.
  if (frontMeshName) {
    const front = report.meshes.find((mesh) => mesh.name === frontMeshName);
    if (front) {
      check(front.bbox.centre[2] > 0.02, "the badge is on the front face (+Z)", `badge centre z ${cm(front.bbox.centre[2])} cm`);
      check(Math.abs(front.bbox.centre[0]) <= 0.003, "the badge is centred left to right", `badge centre x ${cm(front.bbox.centre[0])} cm`);
    } else {
      check(false, "the model has a badge to check", `${frontMeshName} not found`);
    }
  } else {
    console.log("  (no front feature declared for this asset: the +Z badge check does not apply)");
  }

  // The close-up is one of the three renders a reviewer looks at, so it has
  // to be framed on the detail it promises. This fails only for an asset that
  // declares a validation block with no close-up target and no front feature
  // to fall back on: the one case where the capture page would quietly
  // centre the close-up on the whole model and call it a pass.
  if (!closeupFocus) {
    check(
      false,
      "the close-up is framed on a declared target",
      "the manifest names no closeup_mesh, no closeup_focus and no front feature",
    );
  }

  // An asset that carries a part up its middle - a chimney through a crown -
  // has to be centred on both axes, or the socket cannot place it.
  if (axisMeshName) {
    const axis = report.meshes.find((mesh) => mesh.name === axisMeshName);
    if (axis) {
      check(
        Math.abs(axis.bbox.centre[0]) <= 0.002,
        "the stack runs up the asset's axis (centred on X)",
        `centre x ${cm(axis.bbox.centre[0])} cm`,
      );
      check(
        Math.abs(axis.bbox.centre[2]) <= 0.002,
        "the stack runs up the asset's axis (centred on Z)",
        `centre z ${cm(axis.bbox.centre[2])} cm`,
      );
    } else {
      check(false, "the model has the axis mesh to check", `${axisMeshName} not found`);
    }
  }

  // The origin: a prop that is placed by its handle has to have that handle
  // where the socket expects it - centred on the origin, not wherever the
  // builder thought the handle belonged.
  if (originMeshName) {
    const origin = report.meshes.find((mesh) => mesh.name === originMeshName);
    if (origin) {
      check(
        Math.abs(origin.bbox.centre[0]) <= 0.003 &&
        Math.abs(origin.bbox.centre[1]) <= 0.003 &&
        Math.abs(origin.bbox.centre[2]) <= 0.003,
        "the origin feature is centred on the origin",
        `centre ${origin.bbox.centre.map(cm).join(", ")} cm`,
      );
    } else {
      check(false, "the model has the origin feature to check", `${originMeshName} not found`);
    }
  }

  // The forward direction: the feature the pivot names as forward has to sit
  // in front of the origin, on +Z.
  if (forwardMeshName) {
    const forward = report.meshes.find((mesh) => mesh.name === forwardMeshName);
    if (forward) {
      check(
        forward.bbox.centre[2] > 0.02,
        "the forward feature is on the front face (+Z)",
        `centre z ${cm(forward.bbox.centre[2])} cm`,
      );
    } else {
      check(false, "the model has the forward feature to check", `${forwardMeshName} not found`);
    }
  }

  // The frame of a prop with no named parts: its bounding box against the
  // numbers the manifest gives, within half a centimetre.
  if (frame) {
    const frameToleranceCm = frame.tolerance_cm ?? 0.5;
    const centre = report.bbox.min.map((v, i) => (v + report.bbox.max[i]) / 2);
    const framed = [
      ["y_min_cm", "the base sits where the pivot puts it", report.bbox.min[1]],
      ["y_max_cm", "the top sits where the pivot puts it", report.bbox.max[1]],
      ["centre_x_cm", "the asset is centred on X", centre[0]],
      ["centre_z_cm", "the asset is centred on Z", centre[2]],
    ];
    for (const [key, message, actual] of framed) {
      if (frame[key] === undefined) continue;
      check(
        Math.abs(cm(actual) - frame[key]) <= frameToleranceCm,
        `${message} (${frame[key]} cm)`,
        `${cm(actual)} cm`,
      );
    }
  }

  // Surface that has to be there, and space that has to be clear.
  if (regions.length) {
    const triangles = readWorldTriangles(modelPath);
    for (const region of regions) {
      const box = { min: region.min_cm.map((v) => v / 100), max: region.max_cm.map((v) => v / 100) };
      const areaCm2 = Math.round(surfaceAreaInBox(triangles, box) * 1e4);
      if (region.expect === "empty") {
        const limit = region.max_area_cm2 ?? 5;
        check(areaCm2 <= limit, `${region.label} is clear`, `${areaCm2} cm2 of surface <= ${limit}`);
      } else {
        const limit = region.min_area_cm2 ?? 50;
        check(areaCm2 >= limit, `${region.label} is there`, `${areaCm2} cm2 of surface >= ${limit}`);
      }
    }
  }

  // A grip-normalized prop has no crown rim, so the rim check does not run
  // for it - which means the frame it is placed by is only checked at all if
  // the manifest names the features that carry it. Without them the run
  // would go green on a prop whose handle was never measured, and the socket
  // would be handed an asset that can sit anywhere in the hand.
  //
  // The check is failure-only on purpose: a head-socket prop is already
  // checked against its rim, and a grip prop that names its origin and
  // forward features is checked against those. Only the prop that declares
  // neither is missing a check, and only that one gets this line.
  // A frame or a clear region stands in for the named features: either one
  // is a check that the prop sits and points where the socket expects.
  if (!isHeadSocket) {
    if (!originMeshName && !frame) {
      check(
        false,
        "the manifest names the feature the prop is placed by",
        "a grip_normalized asset must declare validation.origin_mesh or validation.frame",
      );
    }
    if (!forwardMeshName && !regions.some((region) => region.expect === "empty")) {
      check(
        false,
        "the manifest names the feature that points forward",
        "a grip_normalized asset must declare validation.forward_mesh, or a clear region in validation.regions",
      );
    }
  }

  // ---- the renders --------------------------------------------------------
  await startServer();
  const launchedAt = Date.now();
  // Chrome gets its own profile under the repo rather than a temporary
  // directory: a cleaner that sweeps the system temp folder mid-launch
  // otherwise takes the browser's profile with it and the launch hangs.
  const profile = path.join(ROOT, "test-output/chrome-profile");
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  try {
    browser = await withTimeout(
      puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        userDataDir: profile,
        dumpio: !!process.env.PROP_CAPTURE_DUMPIO,
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", `--window-size=${WIDTH},${HEIGHT}`],
      }),
      120_000,
      "launch chrome",
    );
  } catch (error) {
    throw new Error(`${error.message} (chrome at ${CHROME})`);
  }
  console.log(`  chrome up in ${Date.now() - launchedAt} ms`);
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  const pageErrors = [];
  const missing = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && pageErrors.push(message.text()));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    // The browser asks for a favicon the capture page does not have; that is
    // not the model's problem.
    if (response.url().endsWith("/favicon.ico")) return;
    missing.push(`${response.status()} ${response.url()}`);
  });

  const url =
    `http://127.0.0.1:${PORT}/tools/prop-capture/capture.html?model=/${modelFile.replace(/^public\//, "")}` +
    `&width=${WIDTH}&height=${HEIGHT}&fit=${viewFit}&closeupFit=${closeupFit}` +
    `&closeup=${encodeURIComponent(closeupFocus)}`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__propCapture && window.__propCapture.ready, { timeout: 60_000, polling: "raf" });

  const pageStats = await page.evaluate(() => ({
    stats: window.__propCapture.stats,
    errors: window.__propCapture.errors,
  }));
  check(missing.length === 0, "every asset the page asked for was served", missing.join("; "));
  // "Failed to load resource" lines are covered by the response check above;
  // what matters here is that the page itself raised nothing.
  check(
    pageErrors.filter((message) => !message.includes("Failed to load resource")).length === 0,
    "the model loads in a WebGL renderer without errors",
    pageErrors.filter((message) => !message.includes("Failed to load resource")).join("; "),
  );
  check(pageStats.errors.length === 0, "the renderer reported no load errors", pageStats.errors.join("; "));
  check(
    pageStats.stats && pageStats.stats.triangles === report.triangles,
    "the renderer sees the same triangle count as the file",
    `${pageStats.stats?.triangles} vs ${report.triangles}`,
  );

  const rendered = [];
  const canvas = await page.$("#view");
  for (const view of VIEWS) {
    await page.evaluate((name) => {
      window.__propCapture.setView(name);
    }, view.name);
    await page.evaluate(() => window.__propCapture.render());
    const file = path.join(outDir, `${view.name}.png`);
    await canvas.screenshot({ path: file });
    const bytes = fs.statSync(file).size;
    rendered.push({ view: view.name, label: view.label, file: path.relative(ROOT, file).split(path.sep).join("/"), bytes });
    console.log(`  rendered ${view.name.padEnd(8)} ${path.relative(ROOT, file).split(path.sep).join("/")} (${(bytes / 1024).toFixed(0)} KB)`);
  }
  check(rendered.every((shot) => shot.bytes > 5000), "every verification render has real content");

  // A render that is a flat colour means the camera is looking at nothing.
  const canvasPng = fs.readFileSync(path.join(outDir, "front.png"));
  check(canvasPng.length > 5000, "the front render is a real image", `${canvasPng.length} bytes`);

  const summary = {
    asset: assetId,
    model: modelFile,
    capturedAt: new Date().toISOString(),
    budget,
    triangles: report.triangles,
    bytes: report.bytes,
    dimensionsCm: { width: dims[0], height: dims[1], depth: dims[2] },
    bbox: { min: report.bbox.min, max: report.bbox.max },
    meshes: report.meshes.map((mesh) => ({ name: mesh.name, triangles: mesh.triangles, material: mesh.primitives[0]?.material ?? null })),
    materials: report.materials,
    renders: rendered,
    checks,
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(summary, null, 2));

  const failed = checks.filter((item) => !item.ok);
  console.log("");
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.error("FAILED:");
    for (const item of failed) console.error(`  - ${item.message}${item.detail ? ` (${item.detail})` : ""}`);
  }

  // The publish step puts the review renders into the repository, resized to
  // the size they are committed at. It runs only on a green capture: a
  // rejected asset must not end up in front of a reviewer as if it had
  // passed, and a failed capture's images look perfectly fine.
  //
  // PROP_PUBLISH_OUT sends the published renders somewhere else, which is
  // how the step is exercised without writing to docs/props/.
  let published = true;
  if (publish && !failed.length) {
    const out = process.env.PROP_PUBLISH_OUT ? ["--out", process.env.PROP_PUBLISH_OUT] : [];
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/publish_prop_renders.mjs"), assetId, ...out], {
      cwd: ROOT,
      stdio: "inherit",
    });
    published = result.status === 0;
    if (!published) console.error("the publish step failed");
  }
  teardown(failed.length || !published ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  teardown(1);
});
