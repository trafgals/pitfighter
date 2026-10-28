#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 5192;
const WIDTH = 720;
const HEIGHT = 880;

const MODELS = [
  { id: "8k", file: "/models/props/weapon_chair_baked_8k.glb", label: "8 Keyframes" },
  { id: "16k", file: "/models/props/weapon_chair_baked_16k.glb", label: "16 Keyframes" },
  { id: "32k", file: "/models/props/weapon_chair_baked_32k.glb", label: "32 Keyframes" },
];

const VIEWS = [
  { name: "front", label: "Front (0°)" },
  { name: "profile", label: "Right Profile (90°)" },
  { name: "rear", label: "Rear (180° Crest Badge)" },
  { name: "badge", label: "Tufted Velvet Close-up" },
];

let server = null;
let browser = null;

const teardown = (code) => {
  try {
    const child = browser?.process?.();
    if (child?.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
  try {
    if (server) server.kill();
  } catch {}
  process.exit(code);
};

process.on("SIGINT", () => teardown(130));
process.on("SIGTERM", () => teardown(143));

async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`);
      if (response.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Vite server did not come up on port ${PORT}`);
}

async function main() {
  console.log("=" * 70);
  console.log("Capturing Verification Renders for Baked Chair Models (8k, 16k, 32k)");
  console.log("=" * 70);
  
  await startServer();
  console.log(`Vite server up on http://127.0.0.1:${PORT}`);
  
  const profileDir = path.join(ROOT, "test-output", "chrome-eval-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profileDir,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", `--window-size=${WIDTH},${HEIGHT}`],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  
  for (const model of MODELS) {
    console.log(`\n--- Rendering Model: ${model.label} (${model.file}) ---`);
    const outDir = path.join(ROOT, "docs", "props", "weapon_chair_eval", model.id);
    fs.mkdirSync(outDir, { recursive: true });
    
    const url =
      `http://127.0.0.1:${PORT}/tools/prop-capture/capture.html?model=${model.file}` +
      `&width=${WIDTH}&height=${HEIGHT}&fit=0.55&closeupFit=0.18&closeup=0,0.26,-0.16`;
      
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__propCapture && window.__propCapture.ready, { timeout: 30_000, polling: "raf" });
    
    const canvas = await page.$("#view");
    for (const view of VIEWS) {
      await page.evaluate((name) => window.__propCapture.setView(name), view.name);
      await page.evaluate(() => window.__propCapture.render());
      
      const outFile = path.join(outDir, `${view.name}.png`);
      await canvas.screenshot({ path: outFile });
      const bytes = fs.statSync(outFile).size;
      console.log(`  Captured ${view.name.padEnd(8)} -> ${path.relative(ROOT, outFile)} (${(bytes / 1024).toFixed(1)} KB)`);
    }
  }
  
  console.log("\nAll evaluation renders captured successfully!");
  teardown(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  teardown(1);
});
