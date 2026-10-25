// End-to-end browser test. Builds nothing: it serves the repo with Vite (or,
// with a URL in BASE_URL or as the first argument, tests that deployed site instead, e.g. GitHub Pages), drives
// real headless Chrome through the character select with the keyboard into an
// 8-fighter match, plays it, and checks the canvas, the HUD and the sim state;
// then starts an 8-fighter match on each of the other stages and plays it.
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
// The watchdog is a safety net against a hang, not a deadline. It is generous
// because the test draws with whatever the machine has: a software renderer
// takes a quarter of a second a frame, and the whole run is mostly real time.
const WATCHDOG_MS = Number(process.env.BROWSER_TEST_TIMEOUT_MS || 420_000);
const watchdog = setTimeout(() => {
  console.error(`TIMEOUT: browser test exceeded ${WATCHDOG_MS / 1000} s`);
  teardown(1);
}, WATCHDOG_MS);

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
  const types = await page.$$eval(".stage", (els) => els.map((e) => ({ id: e.dataset.type, on: e.classList.contains("on") })));
  check(
    JSON.stringify(types) ===
      JSON.stringify([
        { id: "king", on: true },
        { id: "last", on: false },
        { id: "kos", on: false },
      ]),
    `match types: king of the hill, last one standing, KO race; king of the hill selected (${JSON.stringify(types)})`,
  );
  await page.screenshot({ path: path.join(OUT, "1_select.png") });
  // the menu's count line is shown, and G turns the blood off and on
  const line = () => page.evaluate(() => {
    const el = document.querySelector("#select .count");
    return { text: el.textContent, opacity: getComputedStyle(el).opacity, gore: window.__game.scene.gore };
  });
  const before = await line();
  await page.keyboard.press("KeyG");
  const off = await line();
  await page.keyboard.press("KeyG");
  const on = await line();
  check(before.opacity === "1" && /blood ON/.test(before.text) && before.gore, `the menu shows the fighter count and blood ON (${JSON.stringify(before)})`);
  check(/blood OFF/.test(off.text) && !off.gore && /blood ON/.test(on.text) && on.gore, `G turns the blood off and on again (${off.text} / ${on.text})`);
  // match types are picked by clicking, and the CPU brawl behind the menu moves to the type's next arena
  const behind = () =>
    page.evaluate(() => ({
      type: window.__game.select.type,
      pick: window.__game.select.stage,
      world: window.__game.world?.s.stage,
      frame: window.__game.world?.s.frame,
      name: document.querySelector(".stname").textContent,
      arenas: document.querySelector(".starenas").textContent,
    }));
  const b0 = await behind();
  await new Promise((r) => setTimeout(r, 400));
  const b1 = await behind();
  check(b0.world === "hell-toilet" && b1.frame > b0.frame, `a CPU brawl plays on the next arena behind the menu (${JSON.stringify(b0)} -> frame ${b1.frame})`);
  check(b0.type === "king" && b0.name === "King of the Hill" && /Hell Toilet/.test(b0.arenas) && /Castle Under Siege/.test(b0.arenas), `the menu picks a match type, not a stage, and lists its arenas (${JSON.stringify(b0)})`);
  await page.click(".stagepick .next");
  const b2 = await behind();
  check(b2.type === "last" && b2.pick === "collapsing-tower" && b2.world === "collapsing-tower" && b2.name === "Last One Standing", `the banner's arrow picks the next match type, and the pit behind follows to its arena (${JSON.stringify(b2)})`);
  await page.click('.stage[data-type="kos"]');
  const b3 = await behind();
  check(b3.type === "kos" && b3.pick === "construction-site" && b3.world === "construction-site", `clicking a match type picks it (${JSON.stringify(b3)})`);
  await page.click('.stage[data-type="king"]');
  await page.screenshot({ path: path.join(OUT, "1b_select_live.png") });
  // 4 fighters by default: the first four humans each replace a CPU, the fifth and later add a fighter
  const grow = await page.evaluate(() => {
    const sel = window.__game.select;
    const seen = [sel.fighters];
    for (let i = 0; i < 6; i++) {
      sel.join(`probe${i}`, i);
      seen.push(sel.fighters);
    }
    sel.slots = [];
    sel.setCount(4);
    return seen;
  });
  check(JSON.stringify(grow) === JSON.stringify([4, 4, 4, 4, 4, 5, 6]), `4 fighters by default; humans 1-4 replace CPUs, each one after adds a fighter (${JSON.stringify(grow)})`);

  // P1 joins on the keyboard, moves the cursor two styles right, confirms, starts
  // the game reads the keyboard once per animation frame, and a slow software
  // renderer can go longer than a fixed delay between frames: hold every key
  // down, and then up, across two rendered frames so the poll always sees both
  const frames = () => withTimeout(page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))), 5_000, "two frames");
  const press = async (key) => {
    await page.keyboard.down(key);
    await frames();
    await page.keyboard.up(key);
    await frames();
  };
  await press("KeyJ");
  await press("KeyD");
  await press("KeyD");
  const chosen = await page.evaluate(() => window.__game.select.slots.map((s) => [s.device, s.style, s.ready]));
  check(JSON.stringify(chosen) === JSON.stringify([["kb1", 2, false]]), `kb1 joined and picked style 2 (${JSON.stringify(chosen)})`);
  const joinedCount = await page.evaluate(() => window.__game.select.fighters);
  check(joinedCount === 4, `one human in a 4-fighter pit: they took a CPU's place (${joinedCount} fighters)`);
  // the brawl checks below want a full pit
  await page.evaluate(() => window.__game.select.setCount(8));
  await press("KeyJ");
  await press("BracketRight");
  const stageNext = await page.evaluate(() => window.__game.select.stage);
  check(stageNext === "collapsing-tower", `] picks the next match type, on its first arena (${stageNext})`);
  await press("BracketLeft");
  const stageAfter = await page.evaluate(() => window.__game.select.stage);
  check(stageAfter === "hell-toilet", `[ goes back to Hell Toilet (${stageAfter})`);
  await press("Enter");
  // the countdown: the sim waits, a big number counts down, the human stands in a column of light under a bouncing tag
  await page.waitForFunction(() => window.__game.mode === "countdown", { timeout: 5_000 });
  await page.waitForFunction(() => document.querySelector(".countdown.show")?.textContent === "2", { timeout: 5_000 });
  const count = await page.evaluate(() => {
    const g = window.__game;
    const cards = document.querySelector("#hud .cards").getBoundingClientRect();
    return { frame: g.world.s.frame, inset: g.scene.inset, cards: Math.round(innerHeight - cards.top), counting: g.scene.counting };
  });
  check(count.frame === 0 && count.counting, `the countdown holds the sim at frame 0 with the beacons up (${JSON.stringify(count)})`);
  check(count.inset > 40 && Math.abs(count.inset - count.cards) <= 2, `the camera frames the fight above the HUD cards (inset ${count.inset} px, cards ${count.cards} px)`);
  await page.screenshot({ path: path.join(OUT, "2_countdown.png") });
  await page.waitForFunction(() => window.__game.mode === "match", { timeout: 10_000 });
  const went = await page.evaluate(() => [document.querySelector(".countdown").textContent, window.__game.scene.counting]);
  check(went[0] === "START!" && !went[1], `then START! and the fight (${JSON.stringify(went)})`);
  const setup = await page.evaluate(() => window.__game.world.fighters.map((f) => ({ style: f.style, human: f.human, x: f.spawnX, y: f.spawnY })));
  check(setup.length === 8, `match starts with 8 fighters (${setup.length})`);
  const worldStage = await page.evaluate(() => window.__game.world.s.stage);
  const upNext = await page.evaluate(() => window.__game.select.stage);
  check(upNext === "castle-under-siege", `the next King of the Hill match is on the other arena (${upNext})`);
  check(worldStage === "hell-toilet", `the match is played on Hell Toilet (${worldStage})`);
  check(setup[0].human && setup[0].style === 2 && setup.slice(1).every((f) => !f.human), "P1 is the human with the chosen style, 7 CPUs fill the rest");
  const radii = setup.map((f) => Math.hypot(f.x, f.y).toFixed(2));
  check(new Set(radii).size === 1, `everyone spawns on the edge circle (${radii[0]} m)`);

  // the human really controls P1: hold D (east) until the sim has run half a
  // second of frames, then jab. Counting frames rather than wall time keeps
  // the check the same on a fast GPU and on a software renderer, where a whole
  // frame can take a quarter of a second.
  const x0 = await page.evaluate(() => window.__game.world.fighters[0].x);
  const moveFrame0 = await page.evaluate(() => window.__game.world.s.frame);
  await page.keyboard.down("KeyD");
  await withTimeout(
    page.waitForFunction((f) => window.__game.world.s.frame - f >= 30, { timeout: 60_000 }, moveFrame0),
    65_000,
    "hold D for 30 frames",
  );
  await page.keyboard.up("KeyD");
  const x1 = await page.evaluate(() => window.__game.world.fighters[0].x);
  const moveFrame1 = await page.evaluate(() => window.__game.world.s.frame);
  check(x1 - x0 > 0.3, `keyboard moves P1 (dx = ${(x1 - x0).toFixed(2)} m over ${moveFrame1 - moveFrame0} frames)`);
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
  const f1 = await withTimeout(page.evaluate(() => {
      // the throne could end the match early: hold every sitter just short of it until the checks are done
      const g = window.__game;
      for (let i = 0; i < 3600 && g.mode === "match"; i++) {
        g.step(1);
        g.world.fighters.forEach((f) => (f.toilet = Math.min(f.toilet, 600)));
      }
      return g.world.s.frame;
    }), 30_000, "fast-forward 3600 frames");
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

  // free-form limbs: every fighter's arms rolled their own traits, and a heavy one ends in a bigger fist on screen
  const limbs = await page.evaluate(() => {
    const g = window.__game;
    const fs = g.world.fighters;
    const masses = fs.map((f) => f.parts.armR.trait.mass);
    const on = fs.findIndex((f) => f.parts.armR.attached);
    // only the arms on a body: a torn-off arm keeps its roll, so its owner's empty socket and whoever wears it now show the same one
    const worn = fs.filter((f) => f.parts.armR.attached).map((f) => f.parts.armR.trait.mass);
    return { distinct: new Set(worn.map((m) => m.toFixed(4))).size, n: worn.length, mass: masses[on], scale: g.scene.fighters[on].limbs.armR.scale.x };
  });
  check(limbs.n >= 4 && limbs.distinct === limbs.n, `every right arm on a body rolled its own traits (${limbs.distinct} distinct of ${limbs.n} worn)`);
  check(Math.abs(limbs.scale - Math.pow(limbs.mass, 0.8)) < 1e-6, `the fist on screen is sized by the arm's mass (${limbs.mass.toFixed(3)} -> ${limbs.scale.toFixed(3)})`);

  // hit feel: hitstop in the sim, sparks and rings in the scene, sound from the synth
  const feel = await withTimeout(
    page.evaluate(() => {
      const g = window.__game;
      let frozen = 0;
      let specials = 0;
      let heavy = null;
      for (let i = 0; i < 1800 && g.mode === "match"; i++) {
        g.step(1);
        g.world.fighters.forEach((f) => (f.toilet = Math.min(f.toilet, 600))); // keep the match going: no throne win while we look
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
        flash: g.scene.impact.flash,
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
  check(feel.flash > 0.3, `the heavy hit flashed the picture white-hot (${feel.flash.toFixed(2)})`);
  await new Promise((r) => setTimeout(r, 60));
  await page.screenshot({ path: path.join(OUT, "4_heavy_hit.png") });
  // the blood those hits drew: drops thrown, and splats where they landed
  await new Promise((r) => setTimeout(r, 1200));
  const gore = await page.evaluate(() => ({ ...window.__game.scene.fx.stats, wounded: window.__game.scene.fighters.filter((v) => v.wounds.torso.n + v.wounds.head.n > 0).length }));
  check(gore.wounded > 0, `the hurt are bloodied: ${gore.wounded} fighters' skins carry wounds`);
  check(gore.drops > 50 && gore.splats > 20, `hits draw blood that splats on the floor (${gore.drops} drops, ${gore.splats} splats)`);
  await page.screenshot({ path: path.join(OUT, "4b_blood.png") });
  const sp = await withTimeout(
    page.evaluate(() => {
      const g = window.__game;
      let n = 0;
      for (let i = 0; i < 5400 && g.mode === "match" && n === 0; i++) {
        g.step(1);
        g.world.fighters.forEach((f) => (f.toilet = Math.min(f.toilet, 600))); // keep the match going: no throne win while we look
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

  // a juggle: the CPUs' strings launch, and the launched body is drawn up in the air
  const launch = await withTimeout(
    page.evaluate(() => {
      const g = window.__game;
      let who = -1;
      for (let i = 0; i < 5400 && g.mode === "match" && who < 0; i++) {
        g.step(1);
        g.world.fighters.forEach((f) => (f.toilet = Math.min(f.toilet, 600))); // keep the match going: no throne win while we look
        const e = g.world.s.events.find((q) => q.kind === "launch");
        if (e) who = e.b;
      }
      if (who >= 0) for (let i = 0; i < 30 && g.world.fighters[who].state === "air" && g.world.fighters[who].z < 0.6; i++) g.step(1);
      return { who, frame: g.world.s.frame, played: g.sfx.played.launch ?? 0 };
    }),
    40_000,
    "wait for a launch",
  );
  if (launch.who >= 0) {
    // read it straight after a drawn frame, so the body and the sim are on the same step
    const up = await page.evaluate(
      (who) =>
        new Promise((done) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const g = window.__game;
              const f = g.world.fighters[who];
              done({ state: f.state, z: f.z, y: g.scene.fighters[who].root.position.y });
            }),
          ),
        ),
      launch.who,
    );
    check(up.state !== "air" || (up.z > 0.3 && Math.abs(up.y - up.z) < 0.05), `a launched fighter is drawn up in the air (${JSON.stringify(up)})`);
    if (up.state === "air") await page.screenshot({ path: path.join(OUT, "6_juggle.png") });
  }
  // and the CPUs cash juggles out with their style's air grab, named on the banner
  const ag = await withTimeout(
    page.evaluate(() => {
      const g = window.__game;
      let e = null;
      for (let i = 0; i < 5400 && g.mode === "match" && !e; i++) {
        g.step(1);
        g.world.fighters.forEach((f) => (f.toilet = Math.min(f.toilet, 600))); // keep the match going: no throne win while we look
        e = g.world.s.events.find((q) => q.kind === "airgrab") ?? null;
      }
      return { what: e?.what ?? null, played: g.sfx.played.airgrab ?? 0, frame: g.world.s.frame };
    }),
    40_000,
    "wait for an air grab",
  );
  await new Promise((r) => setTimeout(r, 120));
  const agBanner = await page.evaluate(() => document.querySelector(".banner")?.textContent ?? "");
  if (ag.what) await page.screenshot({ path: path.join(OUT, "7_airgrab.png") });
  check(!!ag.what && agBanner.includes(ag.what), `a CPU cashed a juggle out with an air grab, named on the banner (${ag.what} at frame ${ag.frame}; banner "${agBanner}")`);
  check(launch.who >= 0 && launch.played > 0, `the CPUs' strings launched someone, with sound (fighter ${launch.who} at frame ${launch.frame})`);

  // the end of the match: the winning KO slows time nearly to a stop, and the camera closes in on the body
  const end = await withTimeout(
    page.evaluate(() => {
      const g = window.__game;
      let ko = false;
      for (let i = 0; i < 40000 && g.mode === "match"; i++) {
        g.step(1);
        ko = g.world.s.events.some((e) => e.kind === "ko");
      }
      return { mode: g.mode, ko, slow: g.scene.timeScale, finale: !!g.scene.impact.finale, frame: g.world.s.frame };
    }),
    60_000,
    "play the match out",
  );
  console.log("      match end:", JSON.stringify(end));
  check(end.mode === "over" && end.finale, `the match ended on a closing shot (${end.mode}, finale ${end.finale})`);
  if (end.ko) check(end.slow < 0.3, `the winning KO slowed time to ${end.slow.toFixed(2)}`);
  await new Promise((r) => setTimeout(r, 450));
  const still = await page.evaluate(() => window.__game.scene.timeScale);
  if (end.ko) check(still < 1, `the slow motion holds a moment in real time (${still.toFixed(2)})`);
  await page.screenshot({ path: path.join(OUT, "6_finale.png") });
  await new Promise((r) => setTimeout(r, 2500));
  const back = await page.evaluate(() => window.__game.scene.timeScale);
  check(back === 1, `then time runs at full speed again (${back})`);

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);

  // a gamepad joins with Start, readies with Start and starts with Start: Start on a
  // pad that has not joined must never start an all-CPU match. The pad is a fake
  // standard-mapping controller (an Xbox pad's Menu button is button 9) behind
  // navigator.getGamepads, installed before the page's scripts run
  await page.evaluateOnNewDocument(() => {
    const pad = { id: "Xbox Wireless Controller (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  await withTimeout(page.goto(`${SITE}/?seed=5`, { waitUntil: "load" }), 20_000, "reload with a gamepad");
  await page.waitForFunction(() => window.__game && window.__game.mode === "select", { timeout: 10_000 });
  const padPress = async (i) => {
    await page.evaluate((i) => (window.__pad.buttons[i] = { pressed: true, value: 1 }), i);
    await frames();
    await page.evaluate((i) => (window.__pad.buttons[i] = { pressed: false, value: 0 }), i);
    await frames();
  };
  const padState = () => page.evaluate(() => ({ mode: window.__game.mode, slots: window.__game.select.slots.map((s) => [s.device, s.ready]) }));
  await padPress(9);
  const joined = await padState();
  check(joined.mode === "select" && JSON.stringify(joined.slots) === JSON.stringify([["pad0", false]]), `Start on a new pad joins it instead of starting the match (${JSON.stringify(joined)})`);
  await padPress(15); // d-pad right: the next style
  await padPress(9);
  const readied = await padState();
  check(readied.mode === "select" && JSON.stringify(readied.slots) === JSON.stringify([["pad0", true]]), `a second Start readies the pad (${JSON.stringify(readied)})`);
  await padPress(9);
  await page.waitForFunction(() => window.__game.mode === "match", { timeout: 10_000 });
  const padMatch = await page.evaluate(() => window.__game.world.fighters.map((f) => f.human));
  check(padMatch.length === 4 && padMatch[0] && padMatch.slice(1).every((h) => !h), `a third Start starts the match with the pad as P1 and 3 CPUs (${JSON.stringify(padMatch)})`);

  // every other stage: start an 8-CPU match with ?stage=, play it, look at it
  const litCanvas = () =>
    page.evaluate(() => {
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
  const STAGE_RUNS = [
    { id: "construction-site", frames: 1500 },
    { id: "collapsing-tower", frames: 1800 },
    // the blimp starts 5 s before the crash, so every run sees the impact and the wreck
    { id: "hindenburg-blimp", frames: 1200, from: 1500 },
    { id: "castle-under-siege", frames: 1500 },
  ];
  // note who drives on the match's first frame. The ticker is queued before the game's own loop,
  // so it runs first in every animation frame and sees frame 0 before any step: a later evaluate on
  // the slow software renderer sees the match many frames on, when a bot may have hopped out
  await page.evaluateOnNewDocument(() => {
    const tick = () => {
      const g = window.__game;
      if (g && g.mode === "match") {
        window.__start = { frame: g.world.s.frame, driving: g.world.fighters.filter((f) => f.state === "driving").length };
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (const [i, run] of STAGE_RUNS.entries()) {
    errors.length = 0;
    await withTimeout(page.goto(`${SITE}/?auto=1&fighters=8&seed=${11 + i}&stage=${run.id}`, { waitUntil: "load" }), 20_000, `load ${run.id}`);
    await page.waitForFunction(() => window.__start, { timeout: 10_000 });
    const start = await page.evaluate(() => {
      const w = window.__game.world;
      return {
        stage: w.s.stage,
        view: window.__game.scene.stage,
        n: w.fighters.length,
        driving: window.__start.driving,
        frame: window.__start.frame,
        vehicles: w.s.arena.vehicles.length,
        banner: document.querySelector(".banner")?.textContent,
      };
    });
    check(start.stage === run.id && start.view === run.id && start.n === 8, `${run.id}: an 8-fighter match starts on the stage and its view (${JSON.stringify(start)})`);
    if (run.id === "construction-site") check(start.driving === 8 && start.vehicles === 8, `construction-site: everyone starts in their own vehicle (${start.driving} driving, ${start.vehicles} vehicles, at frame ${start.frame})`);
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(OUT, `6_${run.id}_start.png`) });
    const after = await withTimeout(
      page.evaluate((n, from) => {
        const g = window.__game;
        if (from) g.world.s.frame = from;
        const seen = {};
        for (let k = 0; k < n && g.mode === "match"; k++) {
          g.step(1);
          for (const e of g.world.s.events) seen[e.kind] = (seen[e.kind] ?? 0) + 1;
        }
        const w = g.world;
        return {
          frame: w.s.frame,
          winner: w.s.winner,
          seen,
          nan: w.fighters.some((f) => !Number.isFinite(f.x + f.y + f.parts.torso.hp)),
          tilesGone: w.s.arena.tiles.filter((t) => t === -1).length,
          fireX: w.s.arena.fireX,
          down: w.s.frame >= 1800,
          headline: document.querySelector(".throne-name")?.textContent ?? "",
          cards: document.querySelectorAll(".card").length,
          played: Object.keys(g.sfx.played).length,
        };
      }, run.frames, run.from ?? 0),
      60_000,
      `play ${run.id}`,
    );
    console.log(`      ${run.id}:`, JSON.stringify(after));
    check(!after.nan, `${run.id}: no NaN in fighter state`);
    check(after.frame >= (run.from ?? 0) + run.frames || after.winner >= 0, `${run.id}: ran to frame ${(run.from ?? 0) + run.frames} or was won (frame ${after.frame}, winner ${after.winner})`);
    check((after.seen.hit ?? 0) > 0, `${run.id}: fighting happened (${after.seen.hit ?? 0} hits)`);
    check(after.cards === 8 && after.headline.length > 0, `${run.id}: HUD shows 8 cards and the stage headline ("${after.headline}")`);
    if (run.id === "construction-site") check((after.seen.crash ?? 0) > 0, `construction-site: machines crashed (${after.seen.crash ?? 0})`);
    if (run.id === "collapsing-tower") check(after.tilesGone > 0 && (after.seen.collapse ?? 0) > 0, `collapsing-tower: the roof is falling apart (${after.tilesGone} tiles gone)`);
    if (run.id === "hindenburg-blimp") check(after.fireX < 10 && after.down && (after.seen.impact ?? 0) === 1, `hindenburg-blimp: the fire spreads (x = ${after.fireX.toFixed(2)}) and the blimp hit the ground (${after.seen.impact ?? 0} impact)`);
    if (run.id === "castle-under-siege") check((after.seen.geyser ?? 0) > 0, `castle-under-siege: the siege engines fire (${after.seen.geyser ?? 0} strikes)`);
    await new Promise((r) => setTimeout(r, 600));
    const px = await litCanvas();
    check(px.lit > 200 && px.colours > 40, `${run.id}: canvas renders the arena (${px.lit} lit px, ${px.colours} colours)`);
    await page.screenshot({ path: path.join(OUT, `7_${run.id}_fight.png`) });
    check(errors.length === 0, `${run.id}: no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  }

  // ?debug=motion: a line per fighter and foot markers that follow the plants
  await withTimeout(page.goto(`${SITE}/?auto=1&fighters=8&seed=3&debug=motion&gore=0`, { waitUntil: "load" }), 20_000, "load debug=motion");
  await withTimeout(page.waitForFunction(() => (document.getElementById("motion-debug")?.textContent ?? "").split("\n").length === 8, { timeout: 15_000 }), 16_000, "motion overlay");
  await withTimeout(page.evaluate(() => window.__game.step(240)), 15_000, "debug=motion 240 frames");
  await frames();
  const dbg = await page.evaluate(() => document.getElementById("motion-debug").textContent);
  const lines = dbg.split("\n");
  check(lines.length === 8 && lines.every((l, i) => l.startsWith(`P${i + 1} `)), `?debug=motion: one line per fighter (${lines.length})`);
  check(/●/.test(dbg) && /plant/.test(dbg), `?debug=motion: shows the planted feet ("${lines[0].trim()}")`);
  await page.screenshot({ path: path.join(OUT, "8_debug_motion.png") });
  const clean = await page.evaluate(() => ({ ...window.__game.scene.fx.stats }));
  check(clean.drops === 0 && clean.splats === 0, `?gore=0: no blood (${clean.drops} drops, ${clean.splats} splats)`);
  check(errors.length === 0, `?debug=motion: no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);

  // practice: the CPU is a dummy, nobody wins, and Tab opens the move list, which holds the fight
  await withTimeout(page.goto(`${SITE}/?auto=1&fighters=2&seed=5&practice=1`, { waitUntil: "load" }), 20_000, "load practice");
  await withTimeout(page.waitForFunction(() => window.__game.mode === "match", { timeout: 15_000 }), 16_000, "practice match starts");
  const pr0 = await page.evaluate(() => {
    const w = window.__game.world;
    return { practice: w.practice, x: w.fighters[1].x, y: w.fighters[1].y };
  });
  await withTimeout(page.evaluate(() => window.__game.step(240)), 15_000, "practice 240 frames");
  const pr1 = await page.evaluate(() => {
    const w = window.__game.world;
    return { x: w.fighters[1].x, y: w.fighters[1].y, state: w.fighters[1].state, fury: w.fighters[0].fury };
  });
  check(pr0.practice && Math.hypot(pr1.x - pr0.x, pr1.y - pr0.y) < 0.05 && pr1.fury === 100, `practice: the CPU stands still as a dummy and fury stays full (${JSON.stringify({ ...pr0, ...pr1 })})`);
  await page.keyboard.press("Tab");
  await frames();
  const ml = await page.evaluate(() => ({
    open: document.querySelector("#moves").classList.contains("show"),
    text: document.querySelector("#moves").textContent,
    sheets: document.querySelectorAll("#moves .sheet").length,
    frame: window.__game.world.s.frame,
  }));
  await new Promise((r) => setTimeout(r, 400));
  const held = await page.evaluate(() => window.__game.world.s.frame);
  check(ml.open && ml.sheets === 2 && /Air grab: [A-Z]/.test(ml.text) && /Launcher/.test(ml.text) && /Sweep/.test(ml.text), `Tab opens the move list: a sheet per fighter when nobody is human, strings and the air grab (${ml.sheets} sheets)`);
  check(held === ml.frame, `the move list holds the fight (frame ${ml.frame} -> ${held})`);
  await page.keyboard.press("Tab");
  await new Promise((r) => setTimeout(r, 400));
  const gone = await page.evaluate(() => ({ open: document.querySelector("#moves").classList.contains("show"), frame: window.__game.world.s.frame }));
  check(!gone.open && gone.frame > held, `Tab again closes it and the fight goes on (frame ${held} -> ${gone.frame})`);
  await page.screenshot({ path: path.join(OUT, "9_practice.png") });
  check(errors.length === 0, `practice: no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);

  // frame time: 8 fighters' animation (springs, IK, ragdoll: the scene's sync) must fit easily in a 60 fps frame.
  // Headless Chrome draws on the CPU (SwiftShader), so the whole frame is reported, but only the animation is held to a budget.
  await withTimeout(page.goto(`${SITE}/?auto=1&fighters=8&seed=7`, { waitUntil: "load" }), 20_000, "load frame-time match");
  await withTimeout(page.waitForFunction(() => window.__game.mode === "match", { timeout: 15_000 }), 16_000, "frame-time match starts");
  const ft = await withTimeout(
    page.evaluate(
      () =>
        new Promise((done) => {
          const sc = window.__game.scene;
          const sync = sc.sync.bind(sc);
          const anim = [];
          const frame = [];
          sc.sync = (...a) => {
            const t0 = performance.now();
            sync(...a);
            anim.push(performance.now() - t0);
          };
          let last = performance.now();
          const tick = (now) => {
            frame.push(now - last);
            last = now;
            if (frame.length < 120) requestAnimationFrame(tick);
            else {
              sc.sync = sync;
              const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
              const p95 = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];
              done({ anim: med(anim), anim95: p95(anim), frame: med(frame), n: anim.length, fighters: window.__game.world.fighters.length });
            }
          };
          requestAnimationFrame(tick);
        }),
    ),
    60_000,
    "measure frame time",
  );
  console.log(`      frame time: ${JSON.stringify(ft)}`);
  check(ft.fighters === 8 && ft.n > 30, `frame time: measured ${ft.n} frames of an 8-fighter match`);
  check(ft.anim < 4 && ft.anim95 < 8, `frame time: animating 8 fighters takes ${ft.anim.toFixed(2)} ms a frame (95th percentile ${ft.anim95.toFixed(2)} ms), under a quarter of a 60 fps frame (whole frame ${ft.frame.toFixed(1)} ms on the software renderer)`);
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
