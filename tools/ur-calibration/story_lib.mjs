/**
 * Automated Functional Test: Urban Reign story mode regression.
 *
 * The 8 player patch set changes the per player record index computation at
 * 0x002187E4.  Story missions share the same per player record table with
 * the multiplayer modes, so this test boots the PATCHED engine and the
 * UNPATCHED reference engine, drives BOTH of them through the same story
 * mode sequence and compares the game state straight out of EE RAM.
 *
 * If the record index selection differs between the two builds, the actor
 * table (character id, team, controller binding, position) and the per
 * player record table differ - which is exactly the regression this test
 * has to catch.
 *
 * The unpatched reference engine is not committed to the repository: it is
 * either taken from the build directory next to the repository
 * (<repo>/../ur-analysis/reference-engine, built with
 * "PS2_PATCHES=none bash scripts/build_engine.sh") or extracted from the
 * git history (the commit before the 8 player work) into a temporary
 * directory, so the branch does not carry a second copy of the 22 MB
 * engine artefacts.
 *
 * ---------------------------------------------------------------------------
 * HOW THE STORY IS DRIVEN (measured, see urp-notes/findings_H_navigate.md)
 * ---------------------------------------------------------------------------
 * The game plays the Sofdec/ADX boot logos first and swallows every button
 * until START is pressed, so the input has to start at frame 0.  The recipe
 * that walks the retail game out of the boot logos and into the MAIN MENU is
 *
 *     frame < 1000   START          (skip the boot logos)
 *     frame < 1600   CROSS          (the profile slot screen)
 *     frame < 2200   CROSS + START  (the name entry)
 *     frame >= 2200  LEFT, CROSS, CIRCLE   (the memory card prompts)
 *
 * and the main menu comes up with NEW GAME highlighted.  The menu highlight
 * is the only reliable "which entry is selected" signal - the word the old
 * navigator used (0x00652868) is a free running counter and NOT the
 * visible highlight.  The highlight is therefore read out of a CDP
 * screenshot: the red selection bar behind the menu entry.
 *
 * The vertical position of that bar (measured in the 478 px tall game
 * canvas) identifies the entry:
 *
 *     NEW GAME 0.211   CONTINUE 0.282   FREE 0.356   CHALLENGE 0.425
 *     MULTIPLAYER 0.498 EXTRAS 0.569     OPTIONS 0.640
 *
 * NEW GAME is the first entry and is what the recipe leaves highlighted.
 * After NEW GAME the game answers START: the mission card, the mission and
 * the fight come up one START press at a time.
 *
 * The game state itself is only ever READ out of EE RAM (AGENTS.md 4.1) -
 * this test never writes a single byte into the emulated game's memory.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";
// UR_PITFIGHTER: a checkout of urban-reign-pitfighter (for its CDP harness);
// UR_CALIB_ROOT: a served copy of its page with the unpatched reference engine.
const PITFIGHTER = process.env.UR_PITFIGHTER || "C:/code/trafgals/urban-reign-pitfighter";
const { launch, INSTALL_RAM, installRamAt, FIND_RAM_BASE, PS2_BUTTON } = await import(pathToFileURL(path.join(PITFIGHTER, "test_lib/harness.mjs")).href);

const ROOT = process.env.UR_CALIB_ROOT || "C:/code/trafgals/urp-notes/calib/root";
/*  The reference build is the engine as it was before the 8 player work. */
const PRISTINE_REF = "1303e9f";
const B = PS2_BUTTON;

/*  ------------------------------------------------------------------  */
/*  EE RAM map (read only)                                             */
/*  ------------------------------------------------------------------  */
const RAM = {
    /*  the per player record table, stride 0x1e                          */
    PER_PLAYER: 0x5338d8,
    PER_PLAYER_STRIDE: 0x1e,
    /*  EIGHT ACTOR STRUCT POINTERS, stride 4 - the retail layout.  The
     *  actor structs themselves are heap allocated, so the addresses they
     *  move to differ from run to run; only the content is compared.     */
    ACTOR_PTRS: 0x59d168,
    ACTOR_COUNT: 8,
    /*  actor record fields (offsets from the actor struct pointer)       */
    A_CHARID: 0x04,
    A_ACTIVE: 0x88e4,
    A_PARTICIPATES: 0x88e8,
    A_PLAYER_INDEX: 0x89a4,
    A_POS_X: 0x8b10,
    A_POS_Y: 0x8b14,
    A_POS_Z: 0x8b18,
    A_TEAM: 0x8c6c,
    A_HP: 0x8c50,
    A_PAD_A: 0x8d48,
    /*  the battle cap / rules of the running match                      */
    BATTLE_CAP: 0x9449f8,
    BATTLE_RULES: 0x9449fc
};

/*  The live game state, read out of EE RAM.  Nothing is written. */
const STORY_EXPR = `(() => {
  if (!window.__ur) return null;
  const R = window.__ur;
  const F = (a) => { const v = R.f32(a); return (typeof v === "number" && isFinite(v)) ? v : null; };
  const records = [];
  for (let i = 0; i < 12; i++) {
    const a = ${RAM.PER_PLAYER} + i * ${RAM.PER_PLAYER_STRIDE};
    records.push({ index: i, charid: R.s16(a), aux: R.u16(a + 2), ctrl: R.s16(a + 4) });
  }
  const actors = [];
  for (let i = 0; i < ${RAM.ACTOR_COUNT}; i++) {
    const p = R.u32(${RAM.ACTOR_PTRS} + i * 4);
    actors.push({
      slot: i,
      charid: R.u16(p + ${RAM.A_CHARID}),
      active: R.u32(p + ${RAM.A_ACTIVE}),
      participates: R.u32(p + ${RAM.A_PARTICIPATES}),
      playerIndex: R.u16(p + ${RAM.A_PLAYER_INDEX}),
      team: R.u16(p + ${RAM.A_TEAM}),
      hp: R.u32(p + ${RAM.A_HP}),
      padA: R.u16(p + ${RAM.A_PAD_A}),
      x: F(p + ${RAM.A_POS_X}), y: F(p + ${RAM.A_POS_Y}), z: F(p + ${RAM.A_POS_Z})
    });
  }
  return {
    frames: (typeof Module !== 'undefined' && Module._ps2web_frames) ? Module._ps2web_frames() : 0,
    prims: (typeof Module !== 'undefined' && Module._ps2web_primitives) ? Module._ps2web_primitives() : 0,
    battleCap: R.u32(${RAM.BATTLE_CAP}),
    battleRules: R.u32(${RAM.BATTLE_RULES}),
    records, actors
  };
})()`;

/*  ------------------------------------------------------------------  */
/*  The menu highlight, read out of a CDP screenshot                   */
/*  ------------------------------------------------------------------  */
/*  The game renders into a WebGPU canvas, so a 2D read back of the canvas
 *  is always black.  The screenshot of the whole page is decoded by the
 *  browser itself (Image + 2D canvas) and the red selection bar behind the
 *  highlighted menu entry is located in it.  The clip keeps the PNG small:
 *  a narrow vertical strip through the middle of the menu plate.        */
const STRIP_ANALYSE = `(async () => {
  const b64 = window.__shotB64;
  if (!b64) return null;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("screenshot decode failed"));
    img.src = "data:image/png;base64," + b64;
  });
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const bands = [];
  let start = -1;
  for (let y = 0; y < c.height; y++) {
    let n = 0;
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const r = d[i], gg = d[i + 1], bb = d[i + 2];
      if (r > 110 && r > gg + 45 && r > bb + 45) n++;
    }
    if (n >= 3) { if (start < 0) start = y; }
    else if (start >= 0) { bands.push([start, y - 1]); start = -1; }
  }
  if (start >= 0) bands.push([start, c.height - 1]);
  return { h: c.height, bands };
})()`;

/*  The game's own HUD - the portrait of the player and the blue health bar
 *  in the top left corner of the game image.  It is only drawn while the
 *  mission is actually playable, so it is the proof that the fight (and
 *  not the mission cutscene) is on screen. */
const HUD_ANALYSE = `(async () => {
  const b64 = window.__shotB64;
  if (!b64) return -1;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("screenshot decode failed"));
    img.src = "data:image/png;base64," + b64;
  });
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let blue = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    if (b > 90 && b > r + 40 && b > gg + 20) blue++;
  }
  return blue;
})()`;

/*  the vertical position of the red selection bar of the main menu
 *  entries, as a fraction of the game canvas height (measured)           */
const MENU_ROWS = [
    { id: 0x2a, name: "NEW GAME", row: 0.2113 },
    { id: 0x2b, name: "CONTINUE", row: 0.2824 },
    { id: 0x2c, name: "FREE", row: 0.3556 },
    { id: 0x2d, name: "CHALLENGE", row: 0.4247 },
    { id: 0x2e, name: "MULTIPLAYER", row: 0.4979 },
    { id: 0x2f, name: "EXTRAS", row: 0.5690 },
    { id: 0x30, name: "OPTIONS", row: 0.6402 }
];
/*  the tolerance is far below the 0.07 distance of two menu rows and far
 *  above the one pixel rounding of the measurement                     */
const MENU_ROW_TOL = 0.013;

let failures = 0;
function check(ok, label, detail = "") {
    console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
    if (!ok) failures++;
    return ok;
}

/*  ------------------------------------------------------------------  */
/*  the mandatory hard safety timeout (AGENTS.md 2.1.1)                */
/*  ------------------------------------------------------------------  */
/*  The test boots TWO complete games (each one has to play the boot
 *  logos, the profile, the name entry, the memory card prompts, the main
 *  menu and the whole mission load), so it needs more than the 90 s of a
 *  unit test.  Every single step is bounded on its own and both engine
 *  runs carry their own hard timeout inside the harness.               */
const HARD_TIMEOUT_MS = Number(process.env.UR_STORY_TIMEOUT_MS || 600000);
const hardTimeout = setTimeout(() => {
    console.error(`\n[FAIL] the story regression test exceeded its ${HARD_TIMEOUT_MS / 1000}s hard safety timeout`);
    process.exit(1);
}, HARD_TIMEOUT_MS);
hardTimeout.unref?.();

/*  ------------------------------------------------------------------  */
/*  helpers                                                             */
/*  ------------------------------------------------------------------  */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Extract the pristine (unpatched) engine out of the git history into a
 * temporary directory.  Every git call is bounded by a timeout and the
 * temporary directory is removed again when the test ends.
 */
function extractPristineEngine() {
    const dir = path.join(os.tmpdir(), `ur-pristine-${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ["ps2web.js", "ps2web.wasm", "ps2web.data"]) {
        const res = spawnSync("git", ["show", `${PRISTINE_REF}:${name}`], {
            cwd: ROOT,
            encoding: "buffer",
            maxBuffer: 256 * 1024 * 1024,
            timeout: 120000,
            windowsHide: true
        });
        if (res.error) throw new Error(`git show ${PRISTINE_REF}:${name} failed: ${res.error.message}`);
        if (res.status !== 0) throw new Error(`git show ${PRISTINE_REF}:${name} exited ${res.status}`);
        if (!res.stdout || res.stdout.length === 0) throw new Error(`git show ${PRISTINE_REF}:${name} produced no data`);
        fs.writeFileSync(path.join(dir, name), res.stdout);
    }
    console.log(`   pristine engine extracted from ${PRISTINE_REF} into ${dir}`);
    return dir;
}

/**
 * A reference engine is an engine that was built from the same recompiler
 * but WITHOUT the 8 player patch set, so that the differential comparison
 * isolates exactly the patch set.  It is never committed to the repository:
 *
 *   1. $UR_REFERENCE_ENGINE              - an explicitly configured directory
 *   2. <repo>/../ur-analysis/reference-engine - the usual build output of
 *                                        "PS2_PATCHES=none bash scripts/build_engine.sh"
 *   3. the engine from the git history    - always available, but it is an
 *                                        older recompiler without the
 *                                        ps2web_ram_base() export, so its
 *                                        EE RAM block has to be located at
 *                                        runtime and may not be locatable
 */
function resolveReferenceEngine() {
    const candidates = [];
    if (process.env.UR_REFERENCE_ENGINE) candidates.push(process.env.UR_REFERENCE_ENGINE);
    candidates.push(path.join(path.dirname(ROOT), "ur-analysis", "reference-engine"));
    for (const dir of candidates) {
        try {
            if (!dir) continue;
            const ok = ["ps2web.js", "ps2web.wasm", "ps2web.data"].every((n) => fs.existsSync(path.join(dir, n)));
            if (ok) {
                console.log(`   reference engine found in ${dir}`);
                return { dir, fromHistory: false };
            }
        } catch (_) { }
    }
    console.log(`   no reference build found - falling back to the engine from the git history (${PRISTINE_REF})`);
    return { dir: extractPristineEngine(), fromHistory: true };
}

/** Swap the engine artifacts in the served directory. */
const BACKUP = path.join(os.tmpdir(), "ur-patched-engine-backup");
function installArtifacts(dir) {
    if (path.resolve(dir) === path.resolve(ROOT)) return;   // nothing to swap
    for (const name of ["ps2web.js", "ps2web.wasm", "ps2web.data"]) {
        fs.copyFileSync(path.join(dir, name), path.join(ROOT, name));
    }
}
/** Keep a copy of the patched engine so it can be restored afterwards. */
function backupPatched() {
    fs.mkdirSync(BACKUP, { recursive: true });
    for (const name of ["ps2web.js", "ps2web.wasm", "ps2web.data"]) {
        fs.copyFileSync(path.join(ROOT, name), path.join(BACKUP, name));
    }
}

/*  ------------------------------------------------------------------  */
/*  the driver                                                          */
/*  ------------------------------------------------------------------  */

/** Press a button on controller slot 0 and let the game react. */
async function press(h, bit, holdMs = 150, gapMs = 320) {
    await h.tryEvaluate(`window.setVirtualPad(0, ${bit}, 128, 128)`);
    await sleep(holdMs);
    await h.tryEvaluate(`window.setVirtualPad(0, 0, 128, 128)`);
    await sleep(gapMs);
}

/** The live game state out of EE RAM.  Never writes. */
async function snapshot(h) {
    return await h.tryEvaluate(STORY_EXPR, 20000);
}

/** The actors that the game has switched on. */
function activeActors(s) {
    return (s?.actors ?? []).filter((a) => a.active !== 0);
}

/**
 * Capture a narrow vertical strip of the game canvas and locate the red
 * selection bar of the menu in it.  Returns the index of the highlighted
 * main menu entry, or -1 when the game is not on the main menu.
 *
 * The boot logos carry a red band of their own (the Namco logo), so the
 * detection is only allowed once the game is past the boot movies - the
 * main menu cannot come up before the name entry is finished.
 */
async function menuHighlight(h, minFrame = 1500) {
    const s = await snapshot(h);
    if ((s?.frames ?? 0) < minFrame) return -1;
    const rect = await h.tryEvaluate(`(() => {
        const c = document.getElementById("canvas");
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`, 8000);
    if (!rect || !rect.w || !rect.h) return -1;
    const clip = {
        x: Math.round(rect.x + rect.w * 0.44),
        y: Math.round(rect.y),
        width: Math.round(rect.w * 0.12),
        height: Math.round(rect.h),
        scale: 1
    };
    const shot = await h.sendCmd("Page.captureScreenshot", { format: "png", clip }, 15000);
    if (!shot?.data) return -1;
    await h.tryEvaluate(`window.__shotB64 = ${JSON.stringify(shot.data)}`, 30000);
    const res = await h.tryEvaluate(STRIP_ANALYSE, 30000);
    if (!res || !res.bands) return -1;
    for (const b of res.bands) {
        const f = b[0] / res.h;
        for (let i = 0; i < MENU_ROWS.length; i++) {
            if (Math.abs(f - MENU_ROWS[i].row) <= MENU_ROW_TOL) return i;
        }
    }
    return -1;
}

/**
 * The blue health bar of the game's own HUD in the top left corner of the
 * game image.  It is only drawn while the mission is playable, so it tells
 * the playable fight apart from the mission cutscene and from the pause
 * menu (which dims the screen and hides the HUD).
 */
async function hudHealthBar(h) {
    const rect = await h.tryEvaluate(`(() => {
        const c = document.getElementById("canvas");
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`, 8000);
    if (!rect || !rect.w || !rect.h) return -1;
    /*  the game image is 16:9 and letterboxed inside the canvas */
    const imgW = rect.h * 16 / 9;
    const clip = {
        x: Math.round(rect.x + (rect.w - imgW) / 2 + imgW * 0.02),
        y: Math.round(rect.y + rect.h * 0.03),
        width: Math.round(imgW * 0.40),
        height: Math.round(rect.h * 0.10),
        scale: 1
    };
    const shot = await h.sendCmd("Page.captureScreenshot", { format: "png", clip }, 15000);
    if (!shot?.data) return -1;
    await h.tryEvaluate(`window.__shotB64 = ${JSON.stringify(shot.data)}`, 30000);
    const n = await h.tryEvaluate(HUD_ANALYSE, 30000);
    return typeof n === "number" ? n : -1;
}

/**
 * Drive the game out of the boot logos and into the main menu and return
 * the index of the highlighted entry (-1 when the menu was not reached).
 */
async function reachMainMenu(h, label, deadline) {
    let phase = -1;
    while (Date.now() < deadline) {
        const s = await snapshot(h);
        const f = s?.frames ?? 0;
        const ph = f < 1000 ? 0 : f < 1600 ? 1 : f < 2200 ? 2 : 3;
        if (ph !== phase) {
            phase = ph;
            console.log(`   ${label}: boot phase ${ph} at frame ${f}`);
        }
        const buttons = ph === 0 ? [B.START]
            : ph === 1 ? [B.CROSS]
                : ph === 2 ? [B.CROSS, B.START]
                    : [B.LEFT, B.CROSS, B.CIRCLE];
        for (const bit of buttons) {
            await press(h, bit, ph === 0 ? 160 : 150, 260);
            const row = await menuHighlight(h);
            if (row >= 0) {
                console.log(`   ${label}: main menu reached at frame ${(await snapshot(h))?.frames}, ` +
                    `highlight = ${MENU_ROWS[row].name}`);
                return row;
            }
        }
    }
    return -1;
}

/**
 * Walk the menu highlight onto NEW GAME (the first entry) with the d-pad.
 * The highlight is only ever READ - the game is driven with the d-pad.
 */
async function selectNewGame(h, row, deadline) {
    for (let i = 0; i < 10 && Date.now() < deadline; i++) {
        if (row === 0) break;
        await press(h, B.UP, 110, 260);
        const now = await menuHighlight(h);
        /*  a failed read means the bar is not visible right now - keep the
         *  previous row and walk on, the highlight is still moving  */
        if (now >= 0) row = now;
    }
    return row;
}

/**
 * Boot one build, drive it through NEW GAME into the first story mission
 * and return the EE RAM state of the running fight.
 */
async function runStory(label, port, cdpPort, opts = {}) {
    console.log(`\n--- ${label} ---`);
    const h = await launch({ root: ROOT, port, cdpPort, hardTimeoutMs: opts.hardTimeoutMs ?? 240000 });
    try {
        await h.navigate(`http://127.0.0.1:${port}/index.html`);
        for (let i = 0; i < 60; i++) {
            await sleep(400);
            if (await h.tryEvaluate("window.engineReady === true")) break;
        }
        await h.tryEvaluate(`(function(){ try { window.connectVirtualPad(0, "P1"); return "ok"; } catch(e){ return "ERR "+e; } })()`);
        await h.tryEvaluate(`(function(){ try { window.startPitCombat(); return "ok"; } catch(e){ return "ERR "+e; } })()`);
        await sleep(1500);

        /*  The reference build from the git history predates the
         *  ps2web_ram_base() export, so its EE RAM block is located by
         *  searching the wasm heap for the retail .text signature - but
         *  the ELF image is also in the heap, so every candidate is
         *  validated against the game's own state before it is used. */
        let ram = false;
        if (opts.findBase) {
            const candidates = (await h.tryEvaluate(FIND_RAM_BASE, 60000)) || [];
            console.log(`   ${label}: EE RAM candidates at heap offsets [${candidates.join(", ")}]`);
            for (const base of candidates) {
                try {
                    await h.evaluate(`window.__ur = undefined;`, 10000);
                    await h.evaluate(installRamAt(base), 20000);
                    const probe = await h.tryEvaluate(STORY_EXPR, 20000);
                    const chars = (probe?.records || []).map((r) => r.charid);
                    const plausible = probe && probe.battleRules < 0x100 && probe.battleCap < 0x100 &&
                        chars.every((c) => c >= -1 && c <= 64);
                    console.log(`   ${label}: candidate ${base} -> rules=${probe?.battleRules} cap=${probe?.battleCap} ` +
                        `records=[${chars.join(",")}] ${plausible ? "VALID" : "rejected"}`);
                    if (plausible) { ram = true; break; }
                } catch (e) {
                    console.log(`   ${label}: candidate ${base} failed: ${e.message}`);
                }
            }
            if (!ram) throw new Error("the reference engine's EE RAM block could not be located");
        } else {
            ram = await h.tryEvaluate(INSTALL_RAM);
        }
        if (!ram) throw new Error("no EE RAM accessor");

        const deadline = Date.now() + (opts.budgetMs ?? 200000);

        /*  1. the main menu  */
        let row = await reachMainMenu(h, label, deadline);
        if (row < 0) throw new Error(`${label}: the main menu was not reached`);
        await h.screenshot(path.join(ROOT, `.story_${label}_menu.png`));

        /*  2. NEW GAME  */
        row = await selectNewGame(h, row, deadline);
        if (row !== 0) throw new Error(`${label}: the menu highlight is not on NEW GAME (row ${row})`);
        console.log(`   ${label}: NEW GAME selected`);
        await press(h, B.CROSS, 200, 700);
        await h.screenshot(path.join(ROOT, `.story_${label}_newgame.png`));

        /*  3. the mission card, the mission cutscene and the fight - the
         *     game answers START until the mission is playable.  The
         *     actors are already switched on while the cutscene plays, so
         *     the game's own HUD (the blue health bar) is what tells the
         *     playable fight apart from the cutscene.  */
        let state = null;
        let pressed = 0;
        let fight = false;
        let hud = -1;
        while (pressed < 60 && Date.now() < deadline) {
            await press(h, B.START, 140, 240);
            pressed++;
            state = await snapshot(h);
            const act = activeActors(state).length;
            if (act < 2) continue;
            hud = await hudHealthBar(h);
            if (hud > 300) {
                fight = true;
                console.log(`   ${label}: the fight is running after ${pressed} presses, ` +
                    `frame=${state.frames} prims=${state.prims} actors=${act} hud=${hud}`);
                break;
            }
        }
        await h.screenshot(path.join(ROOT, `.story_${label}_fight.png`));
        if (!fight) throw new Error(`${label}: the story fight was not reached`);

        return { h, state, hud };
    } catch (e) {
        h.teardown();
        throw e;
    }
}


export { runStory, snapshot, press, sleep, STORY_EXPR, B };
