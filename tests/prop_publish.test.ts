// The publish step: the verification renders a capture produced go into the
// repository at the size a reviewer opens them at.
//
// This step was done by hand until the Smelt's renders turned up committed at
// the wrong size and had to be corrected in a follow-up PR (#51). The tests
// below are what keeps the hand out of it.
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { afterAll, describe, expect, it } from "vitest";
import { decodePng, encodePng, resizePng } from "../scripts/lib/png.mjs";

const ROOT = process.cwd();
const SCRATCH = path.join(ROOT, "test-output", "prop-publish-test");
const PUBLISHED = path.join(SCRATCH, "published");
const ASSET = "prop_test_publish";

// The capture renders at this size and the repository keeps them at this one.
// The two are the same shape, so the framing of the picture does not move.
const CAPTURE_WIDTH = 90;
const CAPTURE_HEIGHT = 110;
const PUBLISH_WIDTH = 720;
const PUBLISH_HEIGHT = 880;

interface Check {
  ok: boolean;
  message: string;
  detail?: string;
}

/** A capture output the publish step can read: three renders and a report. */
function writeFixture(id: string, checks: Check[] = [{ ok: true, message: "the model has triangles" }]) {
  const dir = path.join(SCRATCH, id);
  fs.mkdirSync(dir, { recursive: true });
  // A gradient, so a decoder that read the rows wrong produces a picture of
  // the right size but the wrong colours.
  const pixels = new Uint8Array(CAPTURE_WIDTH * CAPTURE_HEIGHT * 4);
  for (let y = 0; y < CAPTURE_HEIGHT; y++) {
    for (let x = 0; x < CAPTURE_WIDTH; x++) {
      const o = (y * CAPTURE_WIDTH + x) * 4;
      pixels[o] = Math.round((255 * x) / (CAPTURE_WIDTH - 1));
      pixels[o + 1] = Math.round((255 * y) / (CAPTURE_HEIGHT - 1));
      pixels[o + 2] = 40;
      pixels[o + 3] = 255;
    }
  }
  const views = [
    { view: "front", label: "Front (0deg, badge to camera)" },
    { view: "profile", label: "Profile (90deg, right side)" },
    { view: "badge", label: "Badge close-up" },
  ];
  const renders = views.map(({ view, label }) => {
    const file = path.join(dir, `${view}.png`);
    fs.writeFileSync(file, encodePng(CAPTURE_WIDTH, CAPTURE_HEIGHT, pixels));
    return {
      view,
      label,
      file: path.relative(ROOT, file).split(path.sep).join("/"),
      bytes: fs.statSync(file).size,
    };
  });
  const report = {
    asset: id,
    model: `public/models/props/${id}.glb`,
    capturedAt: "2026-01-01T00:00:00.000Z",
    budget: { triangles: 35000, bytes: 1572864 },
    renders,
    checks,
  };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  return dir;
}

function publish(args: string[]) {
  return execFileSync(
    process.execPath,
    [path.join("scripts", "publish_prop_renders.mjs"), ...args],
    // stderr is piped rather than inherited, so a refusal can be read instead
    // of only being printed.
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** The width, height and colour type out of a PNG's header. */
function header(file: string) {
  const bytes = fs.readFileSync(file);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colourType: bytes[25],
  };
}

afterAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

describe("the publish step", () => {
  it("writes the review renders at 720x880", () => {
    writeFixture(ASSET);
    publish([ASSET, "--from", SCRATCH, "--out", PUBLISHED]);

    for (const view of ["front", "profile", "badge"]) {
      const file = path.join(PUBLISHED, ASSET, `${view}.png`);
      expect(fs.existsSync(file), file).toBe(true);
      const image = decodePng(fs.readFileSync(file));
      expect([image.width, image.height]).toEqual([PUBLISH_WIDTH, PUBLISH_HEIGHT]);
    }
  });

  it("keeps the picture: the published render is the capture, resized", () => {
    writeFixture(ASSET);
    publish([ASSET, "--from", SCRATCH, "--out", PUBLISHED]);

    const published = decodePng(fs.readFileSync(path.join(PUBLISHED, ASSET, "front.png")));
    const at = (image: typeof published, x: number, y: number) => {
      const o = (y * image.width + x) * 4;
      return [image.data[o], image.data[o + 1], image.data[o + 2]];
    };
    // the gradient still runs from dark to light
    expect(at(published, 2, 2)[0]).toBeLessThan(60);
    expect(at(published, PUBLISH_WIDTH - 3, PUBLISH_HEIGHT - 3)[0]).toBeGreaterThan(195);
    expect(at(published, PUBLISH_WIDTH - 3, PUBLISH_HEIGHT - 3)[1]).toBeGreaterThan(195);
    // and the blue channel, which is flat, is still flat
    expect(at(published, 2, 2)[2]).toBeGreaterThan(30);
    expect(at(published, 2, 2)[2]).toBeLessThan(50);
  });

  it("copies the capture's own report, and writes a README for a new asset", () => {
    const source = writeFixture(ASSET);
    publish([ASSET, "--from", SCRATCH, "--out", PUBLISHED]);

    const copied = fs.readFileSync(path.join(PUBLISHED, ASSET, "report.json"));
    const original = fs.readFileSync(path.join(source, "report.json"));
    expect(copied.equals(original)).toBe(true);

    const readme = fs.readFileSync(path.join(PUBLISHED, ASSET, "README.md"), "utf8");
    expect(readme).toContain(ASSET);
    expect(readme).toContain(`${PUBLISH_WIDTH}x${PUBLISH_HEIGHT}`);
  });

  it("refuses to publish a capture that failed a check", () => {
    writeFixture(ASSET, [
      { ok: true, message: "the model has triangles" },
      { ok: false, message: "the badge is on the front face (+Z)", detail: "badge centre z -1 cm" },
    ]);
    // its own output directory, so what is checked is what this run wrote
    // and not what an earlier run left behind
    const refused = path.join(SCRATCH, "refused");
    let failed = false;
    let stderr = "";
    try {
      publish([ASSET, "--from", SCRATCH, "--out", refused]);
    } catch (error) {
      failed = true;
      stderr = String((error as { stderr?: string }).stderr || "");
    }
    expect(failed).toBe(true);
    expect(stderr).toContain("the badge is on the front face");
    // and nothing was published
    expect(fs.existsSync(path.join(refused, ASSET, "front.png"))).toBe(false);
  });

  it("writes an opaque render as RGB, the format the repository already uses", () => {
    writeFixture(ASSET);
    publish([ASSET, "--from", SCRATCH, "--out", PUBLISHED]);
    const info = header(path.join(PUBLISHED, ASSET, "front.png"));
    expect(info.colourType).toBe(2);
    expect(info.bitDepth).toBe(8);
  });
});

describe("the png codec", () => {
  it("reads back what it writes", () => {
    const pixels = new Uint8Array(4 * 3 * 4);
    for (let i = 0; i < 4 * 3; i++) {
      pixels[i * 4] = i * 20;
      pixels[i * 4 + 1] = 255 - i * 20;
      pixels[i * 4 + 2] = 90;
      pixels[i * 4 + 3] = 255;
    }
    const decoded = decodePng(encodePng(4, 3, pixels));
    expect([decoded.width, decoded.height]).toEqual([4, 3]);
    expect(decoded.opaque).toBe(true);
    for (let i = 0; i < 4 * 3; i++) {
      expect(Array.from(decoded.data.slice(i * 4, i * 4 + 4))).toEqual(Array.from(pixels.slice(i * 4, i * 4 + 4)));
    }
  });

  it("keeps a flat image flat, and keeps its size", () => {
    const width = 900;
    const height = 1100;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = 30;
      pixels[i * 4 + 1] = 90;
      pixels[i * 4 + 2] = 160;
      pixels[i * 4 + 3] = 255;
    }
    const resized = decodePng(resizePng(encodePng(width, height, pixels), PUBLISH_WIDTH, PUBLISH_HEIGHT));
    expect([resized.width, resized.height]).toEqual([PUBLISH_WIDTH, PUBLISH_HEIGHT]);
    let wrong = 0;
    for (let i = 0; i < PUBLISH_WIDTH * PUBLISH_HEIGHT; i++) {
      if (resized.data[i * 4] !== 30 || resized.data[i * 4 + 1] !== 90 || resized.data[i * 4 + 2] !== 160) wrong++;
    }
    expect(wrong).toBe(0);
  });
});
