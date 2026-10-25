// The sound cue list and the samples generated from it. `tools/sfx/prompts.json`
// is the authoring surface for the sound work (docs/sfx.md) and the mp3 files
// next to it are the candidates it produced. These checks keep the two honest:
// every cue has a prompt, a seed and a sample, and every sample is an mp3 the
// browser can decode.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import prompts from "../tools/sfx/prompts.json";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = join(ROOT, "tools", "sfx", "samples");
const REFERENCE = join(ROOT, "tools", "sfx", "reference");

type Cue = { id: string; file: string; prompt: string; seed: number; category: string; note: string };
const CUES = prompts.cues as Cue[];

/** The header of the first mpeg audio frame: rate, channels and bitrate. */
function mp3Header(path: string): { rate: number; channels: number; kbps: number } | null {
  const buf = readFileSync(path);
  let at = 0;
  if (buf.toString("ascii", 0, 3) === "ID3") {
    // the tag size is synchsafe: four bytes of seven bits each
    at = 10 + ((buf[6] & 0x7f) << 21) + ((buf[7] & 0x7f) << 14) + ((buf[8] & 0x7f) << 7) + (buf[9] & 0x7f);
  }
  if (at + 4 > buf.length) return null;
  if (buf[at] !== 0xff || (buf[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (buf[at + 1] >> 3) & 0x03; // 3 is mpeg1
  const layer = (buf[at + 1] >> 1) & 0x03; // 1 is layer three
  const bitrateIndex = (buf[at + 2] >> 4) & 0x0f;
  const rateIndex = (buf[at + 2] >> 2) & 0x03;
  const mode = (buf[at + 3] >> 6) & 0x03; // 3 is mono, 0 and 1 are two channels
  if (version !== 3 || layer !== 1) return null;
  const rates = [44100, 48000, 32000];
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  if (rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) return null;
  return { rate: rates[rateIndex], channels: mode === 3 ? 1 : 2, kbps: bitrates[bitrateIndex] };
}

describe("the sound cues", () => {
  it("every cue has an id, a file, a prompt and a seed", () => {
    expect(CUES.length).toBeGreaterThan(0);
    for (const cue of CUES) {
      expect(cue.id, "cue id").toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(cue.file, `${cue.id} file`).toBe(`${cue.id}.mp3`);
      expect(cue.prompt.length, `${cue.id} prompt`).toBeGreaterThan(20);
      expect(Number.isInteger(cue.seed), `${cue.id} seed`).toBe(true);
      expect(cue.category.length, `${cue.id} category`).toBeGreaterThan(0);
    }
  });

  it("the ids and the file names are unique", () => {
    expect(new Set(CUES.map((c) => c.id)).size).toBe(CUES.length);
    expect(new Set(CUES.map((c) => c.file)).size).toBe(CUES.length);
  });

  it("the prompts ask for one sound in a dry room", () => {
    // Without these two the model writes a sequence and the game has to play
    // one hit eight times in a frame. See docs/sfx.md.
    for (const cue of CUES) {
      expect(cue.prompt, `${cue.id} prompt`).toMatch(/\b(single|one)\b/i);
      expect(cue.prompt, `${cue.id} prompt`).toMatch(/\bdry\b/i);
    }
  });

  it("every cue has a generated sample on disk", () => {
    for (const cue of CUES) {
      expect(existsSync(join(SAMPLES, cue.file)), `${cue.file} is missing`).toBe(true);
    }
  });

  it("every sample is a 44.1 kHz mono mp3 at 128 kbit/s", () => {
    for (const cue of CUES) {
      const path = join(SAMPLES, cue.file);
      const h = mp3Header(path);
      expect(h, `${cue.file} is not an mp3`).not.toBeNull();
      expect(h!.rate, `${cue.file} rate`).toBe(44100);
      expect(h!.channels, `${cue.file} channels`).toBe(1);
      expect(h!.kbps, `${cue.file} bitrate`).toBe(128);
    }
  });

  it("the samples are a fraction of the wav they replaced", () => {
    // a second of 44.1 kHz mono wav is 88,200 bytes; a cue is well under two
    // seconds, so anything near that size would mean the compression is off
    for (const cue of CUES) {
      const size = readFileSync(join(SAMPLES, cue.file)).length;
      expect(size, `${cue.file} size`).toBeLessThan(44100);
    }
  });

  it("the reference renders of the current synthesis are there", () => {
    for (const name of ["reference-hit-light", "reference-hit-heavy", "reference-swing-light", "reference-swing-heavy"]) {
      const path = join(REFERENCE, `${name}.mp3`);
      expect(existsSync(path), `${name}.mp3 is missing`).toBe(true);
      expect(mp3Header(path), `${name}.mp3 is not an mp3`).not.toBeNull();
    }
  });
});
