// Contact sheets of the fighters' motions: serves the repo with Vite, opens
// strip.html in headless Chrome for every family's moves and locomotion and
// for the reactions and knockdowns, and saves each picture to
// test-output/strips/<set>[-<family>].png.
//
// Usage: node tools/strip.mjs [set[:family] ...]   e.g. moves:boxing reactions
//        (no arguments: everything)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const PORT = 5198;
const OUT = path.join(ROOT, "test-output", "strips");
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FAMILIES = ["boxing", "karate", "muay", "kungfu", "brawler", "power", "grappler", "kicker"];
fs.mkdirSync(OUT, { recursive: true });

const jobs = process.argv.length > 2 ? process.argv.slice(2) : [...FAMILIES.map((f) => `moves:${f}`), "reactions", "down", ...FAMILIES.map((f) => `locomotion:${f}`)];

let server = null;
let browser = null;
const teardown = async (code) => {
  try {
    if (browser) await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
  } catch {}
  try {
    if (server) server.kill();
  } catch {}
  process.exit(code);
};
const watchdog = setTimeout(() => {
  console.error("TIMEOUT: strips exceeded 420 s");
  teardown(1);
}, 420_000);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout (${ms} ms): ${what}`)), ms))]);

async function main() {
  server = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  await withTimeout(
    new Promise((res, rej) => {
      server.stdout.on("data", (d) => String(d).includes("Local") && res());
      server.on("exit", (c) => rej(new Error(`vite exited ${c}`)));
    }),
    20_000,
    "vite dev server",
  );
  browser = await withTimeout(puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }), 20_000, "launch chrome");
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const job of jobs) {
    const [set, family] = job.split(":");
    const q = new URLSearchParams({ set, ...(family ? { family } : {}), ...(process.env.STRIP_VIEW ? { view: process.env.STRIP_VIEW } : {}) });
    const t0 = Date.now();
    await withTimeout(page.goto(`http://127.0.0.1:${PORT}/strip.html?${q}`, { waitUntil: "load" }), 30_000, `load ${job}`);
    await page.waitForFunction(() => window.__strip && window.__strip.done, { timeout: 120_000 });
    const r = await page.evaluate(() => ({ png: window.__strip.png, error: window.__strip.error }));
    if (r.error || !r.png) {
      console.error(`FAIL ${job}: ${r.error}`);
      errors.push(r.error);
      continue;
    }
    const file = path.join(OUT, `${set}${family ? `-${family}` : ""}.png`);
    fs.writeFileSync(file, Buffer.from(r.png.split(",")[1], "base64"));
    console.log(`wrote ${path.relative(ROOT, file)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  if (errors.length) console.error(errors.join("\n"));
  clearTimeout(watchdog);
  await teardown(errors.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  teardown(1);
});
