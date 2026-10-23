// End-to-end browser test. Builds nothing: it serves the repo with Vite (or,
// with a URL in BASE_URL or as the first argument, tests that deployed site instead, e.g. GitHub Pages), drives
// real headless Chrome through the character select with the keyboard into an
// 8-fighter match, plays it, and checks the canvas, the HUD and the sim state.
// Every step has a timeout and a global watchdog tears everything down.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const PORT = 5199;
const BASE_URL = (process.env.BASE_URL || process.argv[2] || "").replace(/\/+$/, "");
const SITE = BASE_URL || `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, "test-output");
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
fs.mkdirSync(OUT, { recursive: true });

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
  console.error("TIMEOUT: browser test exceeded 90 s");
  teardown(1);
}, 90_000);

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout (${ms} ms): ${what}`)), ms))]);

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await withTimeout(
    new Promise((res, rej) => {
      server.stdout.on("data", (d) => String(d).includes("Local") && res());
      server.on("exit", (c) => rej(new Error(`vite exited ${c}`)));
    }),
    20_000,
    "vite dev server",
  );
}

async function main() {
  if (!BASE_URL) await startServer();
  browser = await withTimeout(
    puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,800", "--autoplay-policy=no-user-gesture-required"] }),
    20_000,
    "launch chrome",
  );
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await withTimeout(page.goto(`${SITE}/?seed=5`, { waitUntil: "load" }), 20_000, "load page");
  await page.waitForFunction(() => window.__game && window.__game.mode === "select", { timeout: 10_000 });
  check(true, "page boots to the character select");
  const cards = await page.$$eval(".sc", (els) => els.length);
  check(cards === 21, `select shows one fighter per Urban Reign style (${cards})`);
  const title = await page.evaluate(() => ({ doc: document.title, h1: document.querySelector("#select h1")?.textContent }));
  check(title.doc === "Pitfighter" && title.h1 === "PITFIGHTER", `the game is called Pitfighter (${JSON.stringify(title)})`);
  const stages = await page.$$eval(".stage", (els) => els.map((e) => ({ id: e.dataset.stage, on: e.classList.contains("on"), soon: e.classList.contains("soon") })));
  check(
    JSON.stringify(stages) ===
      JSON.stringify([
        { id: "hell-toilet", on: true, soon: false },
        { id: "construction-site", on: false, soon: true },
        { id: "collapsing-tower", on: false, soon: true },
        { id: "hindenburg-blimp", on: false, soon: true },
        { id: "castle-under-siege", on: false, soon: true },
      ]),
    `stage list: Hell Toilet selected, the four planned stages coming soon (${JSON.stringify(stages)})`,
  );
  await page.screenshot({ path: path.join(OUT, "1_select.png") });

  // P1 joins on the keyboard, moves the cursor two styles right, confirms, starts
  const press = async (key) => {
    await page.keyboard.down(key);
    await new Promise((r) => setTimeout(r, 60));
    await page.keyboard.up(key);
    await new Promise((r) => setTimeout(r, 60));
  };
  await press("KeyJ");
  await press("KeyD");
  await press("KeyD");
  const chosen = await page.evaluate(() => window.__game.select.slots.map((s) => [s.device, s.style, s.ready]));
  check(JSON.stringify(chosen) === JSON.stringify([["kb1", 2, false]]), `kb1 joined and picked style 2 (${JSON.stringify(chosen)})`);
  await press("KeyJ");
  await press("BracketRight");
  const stageAfter = await page.evaluate(() => window.__game.select.stage);
  check(stageAfter === "hell-toilet", `] skips the planned stages (${stageAfter})`);
  await press("Enter");
  await page.waitForFunction(() => window.__game.mode === "match", { timeout: 10_000 });
  const setup = await page.evaluate(() => window.__game.world.fighters.map((f) => ({ style: f.style, human: f.human, x: f.spawnX, y: f.spawnY })));
  check(setup.length === 8, `match starts with 8 fighters (${setup.length})`);
  const worldStage = await page.evaluate(() => window.__game.world.s.stage);
  check(worldStage === "hell-toilet", `the match is played on Hell Toilet (${worldStage})`);
  check(setup[0].human && setup[0].style === 2 && setup.slice(1).every((f) => !f.human), "P1 is the human with the chosen style, 7 CPUs fill the rest");
  const radii = setup.map((f) => Math.hypot(f.x, f.y).toFixed(2));
  check(new Set(radii).size === 1, `everyone spawns on the edge circle (${radii[0]} m)`);

  // the human really controls P1: hold D (east) for half a second, then jab
  const x0 = await page.evaluate(() => window.__game.world.fighters[0].x);
  await page.keyboard.down("KeyD");
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.up("KeyD");
  const x1 = await page.evaluate(() => window.__game.world.fighters[0].x);
  check(x1 - x0 > 0.3, `keyboard moves P1 (dx = ${(x1 - x0).toFixed(2)} m)`);
  await page.keyboard.down("KeyJ");
  const st = await page.waitForFunction(() => window.__game.world.fighters[0].state === "attack" && window.__game.world.fighters[0].move, { timeout: 2000 }).then(
    (h) => h.jsonValue(),
    () => null,
  );
  await page.keyboard.up("KeyJ");
  check(st === "jab1", `J throws a jab (${st})`);

  // let real time run, then fast-forward the sim to see a lot of fighting
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(OUT, "2_match_start.png") });
  const f1 = await withTimeout(page.evaluate(() => window.__game.step(3600)), 30_000, "fast-forward 3600 frames");
  const stats = await page.evaluate(() => {
    const w = window.__game.world;
    return {
      frame: w.s.frame,
      winner: w.s.winner,
      kos: w.fighters.reduce((a, f) => a + f.kos, 0),
      throne: Math.max(...w.fighters.map((f) => f.toilet)),
      pickups: w.s.pickups.length,
      limbsLost: w.fighters.reduce((a, f) => a + ["armL", "armR", "legL", "legR"].filter((p) => !f.parts[p].attached).length, 0),
      nan: w.fighters.some((f) => !Number.isFinite(f.x + f.y + f.parts.torso.hp)),
      cards: document.querySelectorAll(".card").length,
    };
  });
  console.log("      after fast-forward:", JSON.stringify({ f1, ...stats }));
  check(stats.frame > 3600 || stats.winner >= 0, `simulation ran past frame 3600 or the match was won (frame ${stats.frame}, winner ${stats.winner})`);
  check(!stats.nan, "no NaN in fighter state");
  check(stats.kos > 0 || stats.throne > 0, `fighting happened (KOs ${stats.kos}, best throne time ${stats.throne}f)`);
  check(stats.cards === 8, `HUD shows 8 fighter cards (${stats.cards})`);

  // hit feel: hitstop in the sim, sparks and rings in the scene, sound from the synth
  const feel = await withTimeout(
    page.evaluate(() => {
      const g = window.__game;
      let frozen = 0;
      let specials = 0;
      let heavy = null;
      for (let i = 0; i < 1800 && g.mode === "match"; i++) {
        g.step(1);
        const w = g.world;
        if (w.fighters.some((f) => f.stop > 0)) frozen++;
        specials += w.s.events.filter((e) => e.kind === "special").length;
        // stop on a big hit, so the screenshot catches its sparks
        const big = w.s.events.find((e) => e.kind === "hit" && (e.dmg ?? 0) >= 8 && e.a >= 0);
        if (big && i > 600) {
          heavy = big;
          break;
        }
      }
      return {
        frozen,
        specials,
        heavy,
        fx: { ...g.scene.fx.stats },
        bloom: g.scene.bloomOn,
        audio: g.sfx.ctx ? g.sfx.ctx.state : "none",
        played: { ...g.sfx.played },
        fury: [...document.querySelectorAll(".ffill")].length,
        maxFury: Math.max(...g.world.fighters.map((f) => f.fury)),
      };
    }),
    30_000,
    "play for hit feel",
  );
  console.log("      hit feel:", JSON.stringify(feel));
  check(feel.frozen > 0, `hitstop froze fighters on ${feel.frozen} frames`);
  check(feel.fx.bursts > 20 && feel.fx.rings > 10, `impact sparks and rings were spawned (${feel.fx.bursts} bursts, ${feel.fx.rings} rings)`);
  check(feel.bloom, "bloom post-processing is on");
  check(feel.audio === "running", `the audio context is running (${feel.audio})`);
  check((feel.played.hit ?? 0) > 0 && (feel.played.swing ?? 0) > 0, `hits and swings made sounds (${feel.played.hit ?? 0} hits, ${feel.played.swing ?? 0} swings)`);
  check(feel.fury === 8, `HUD shows 8 fury bars (${feel.fury})`);
  check(!!feel.heavy, `a heavy hit landed (${JSON.stringify(feel.heavy)})`);
  await new Promise((r) => setTimeout(r, 60));
  await page.screenshot({ path: path.join(OUT, "4_heavy_hit.png") });
  const sp = await withTimeout(
    page.evaluate(() => {
      const g = window.__game;
      let n = 0;
      for (let i = 0; i < 5400 && g.mode === "match" && n === 0; i++) {
        g.step(1);
        n += g.world.s.events.filter((e) => e.kind === "special").length;
      }
      return { n, played: g.sfx.played.special ?? 0, frame: g.world.s.frame };
    }),
    40_000,
    "wait for a special",
  );
  check(sp.n + feel.specials > 0 && sp.played > 0, `the CPUs used their specials, with sound (${sp.n + feel.specials} seen, ${sp.played} played, frame ${sp.frame})`);
  if (sp.n) {
    await withTimeout(page.evaluate(() => window.__game.step(14)), 5000, "special active frames");
    await new Promise((r) => setTimeout(r, 60));
    await page.screenshot({ path: path.join(OUT, "5_special.png") });
  }

  // the canvas actually renders a lit 3D scene (not a black frame)
  await new Promise((r) => setTimeout(r, 500));
  const px = await page.evaluate(() => {
    const c = document.querySelector("#view");
    const g = document.createElement("canvas");
    g.width = 64;
    g.height = 40;
    const ctx = g.getContext("2d");
    ctx.drawImage(c, 0, 0, 64, 40);
    const d = ctx.getImageData(0, 0, 64, 40).data;
    let lit = 0;
    const colours = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
      colours.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    }
    return { lit, colours: colours.size };
  });
  check(px.lit > 200 && px.colours > 40, `canvas renders the arena (${px.lit} lit px, ${px.colours} colours)`);
  await page.screenshot({ path: path.join(OUT, "3_match_fight.png") });

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
}

main()
  .then(() => {
    clearTimeout(watchdog);
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nall browser checks passed");
    teardown(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error("ERROR", e);
    teardown(1);
  });
