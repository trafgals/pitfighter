// The strip page (strip.html, dev only): a fighter's motions laid out frame by
// frame, a row per motion, so timing, weight and contact can be read off a
// picture. Each row plays one motion through the game's own animation
// (render/animate.ts) at 60 Hz and draws every `every`-th frame, plus the hit
// frame. Under each frame: its number, where the move is (gather / fire /
// active / recovery), the feet carrying the weight, and the striking limb's
// speed as a bar. The hit frame is boxed red, the active frames orange.
//
//   strip.html?set=moves&family=boxing     the strings, the special, the headbutt
//   strip.html?set=reactions               3 heights x light / heavy x both sides
//   strip.html?set=down                    knockdowns, get-ups, the throw
//   strip.html?set=locomotion&family=muay  idle, guard, a walk and a run
//
// tools/strip.mjs drives it headless and saves the pictures to test-output/strips/.
import * as THREE from "three";
import { World } from "./sim/world";
import { DOWN, GRAB, HOLD, MOVES, REVERSAL } from "./sim/moves";
import { STYLES } from "./sim/styles";
import type { Fighter, PartId } from "./sim/types";
import { buildBody, type Body, type Target } from "./render/body";
import { animate, ankleOf, onHit } from "./render/animate";
import { FAMILIES, THROW_TIMING, familyOf, type Family } from "./render/motion";

const params = new URLSearchParams(location.search);
const EVERY = Number(params.get("every") ?? 2);
const CW = 96; // a frame's cell
const CH = 150;
const LEFT = 132; // the row's title
const TOP = 26;
const DT = 1 / 60;

/** One row: a motion set up on a fresh fighter, run for `frames`, with what to call it. */
interface Row {
  name: string;
  style: number;
  frames: number;
  /** set the fighter (and its body) up for frame 0; called once */
  start: (f: Fighter, b: Body, w: World) => void;
  /** before each frame (the fighter's t is set to it already) */
  each?: (f: Fighter, b: Body, w: World, t: number) => void;
  /** the frame the blow lands on, and the end of its active frames */
  hit?: number;
  act?: number;
}

const styleOf = (fam: Family) => Math.max(0, STYLES.findIndex((_, i) => familyOf(i) === fam));
const family = (params.get("family") ?? "karate") as Family;
const sStyle = params.get("style") ? Number(params.get("style")) : styleOf(family);

function rows(): Row[] {
  const set = params.get("set") ?? "moves";
  if (set === "moves") {
    const moves = ["jab1", "jab2", "jab3", "punchFin", "kick1", "kick2", "sweep", STYLES[sStyle].special, "headbutt"];
    const strikes: Row[] = moves.map((move) => {
      const w = new World({ seed: 1, styles: [sStyle, 0], humans: [true, true] });
      const m = w.eff(w.fighters[0], move);
      return {
        name: move,
        style: sStyle,
        frames: m.total,
        hit: m.startup,
        act: m.startup + m.active,
        start: (f) => Object.assign(f, { state: "attack", move, chargeHeld: false, charge: 0 }),
      };
    });
    const grab = GRAB.startup + GRAB.active + GRAB.whiff;
    return [
      ...strikes,
      { name: "grapple", style: sStyle, frames: grab, hit: GRAB.startup, act: GRAB.startup + GRAB.active, start: (f) => Object.assign(f, { state: "attack", move: "grab", chargeHeld: false, charge: 0 }) },
      {
        // the clinch, a knee every HOLD.kneeCool frames
        name: "clinch, knees",
        style: sStyle,
        frames: HOLD.kneeCool * 3,
        start: (f) => Object.assign(f, { state: "holding", dur: HOLD.dur, holdStrikes: 0, holdCool: 0 }),
        each: (f, _b, _w, t) => {
          if (t % HOLD.kneeCool === 0) Object.assign(f, { holdStrikes: t / HOLD.kneeCool + 1, holdCool: HOLD.kneeCool });
          else f.holdCool = Math.max(0, f.holdCool - 1);
        },
      },
      { name: "deflect", style: sStyle, frames: REVERSAL.dur, hit: REVERSAL.first, act: REVERSAL.window, start: (f) => Object.assign(f, { state: "reversal", dur: REVERSAL.dur, revHeight: "high" }) },
      { name: "deflect low", style: sStyle, frames: REVERSAL.dur, hit: REVERSAL.first, act: REVERSAL.window, start: (f) => Object.assign(f, { state: "reversal", dur: REVERSAL.dur, revHeight: "low" }) },
      { name: "blocked", style: sStyle, frames: MOVES.jab1.blockstun, start: (f) => Object.assign(f, { state: "blockstun", dur: MOVES.jab1.blockstun }) },
    ];
  }
  if (set === "reactions") {
    const out: Row[] = [];
    for (const part of ["head", "torso", "legR"] as PartId[])
      for (const heavy of [false, true])
        for (const side of [1, -1])
          out.push({
            name: `${part === "legR" ? "legs" : part === "torso" ? "body" : "head"} ${heavy ? "heavy" : "light"} ${side > 0 ? "R" : "L"}`,
            style: sStyle,
            frames: MOVES.jab1.hitstun,
            start: (f, b, w) => {
              const a = w.fighters[1];
              Object.assign(f, { x: 0, y: 0, facing: 0, state: "hitstun", dur: MOVES.jab1.hitstun });
              Object.assign(a, { x: 1, y: 0.45 * side, state: "idle" });
              onHit(b, f, a, part, heavy ? 9 : 4, heavy ? 10 : 6);
            },
          });
    return out;
  }
  if (set === "down") {
    const fall = (face: 1 | -1, name: string): Row => ({
      name,
      style: sStyle,
      frames: DOWN.dur,
      hit: 27,
      start: (f, b) => {
        b.cue.face = face;
        Object.assign(f, { state: "down", dur: DOWN.dur });
      },
    });
    const wake = (face: 1 | -1, name: string): Row => ({
      name,
      style: sStyle,
      frames: DOWN.wake,
      start: (f, b, w) => {
        // lie down first, off the strip
        b.cue.face = face;
        Object.assign(f, { state: "down", dur: DOWN.dur });
        for (let t = 0; t <= DOWN.dur; t++) {
          f.t = t;
          animate(b, f, w, t * DT, DT);
        }
        Object.assign(f, { state: "wakeup", dur: DOWN.wake, t: 0 });
      },
    });
    return [
      fall(1, "down, face up"),
      wake(1, "get up, face up"),
      fall(-1, "down, face down"),
      wake(-1, "get up, face down"),
      { name: "thrower", style: sStyle, frames: THROW_TIMING.end, start: (f, b) => ((b.cue.throwAge = 0), Object.assign(f, { state: "idle" })) },
      {
        name: "thrown",
        style: sStyle,
        frames: 24 + 20,
        start: (f) => Object.assign(f, { state: "thrown", dur: 24 }),
        each: (f, _b, _w, t) => {
          if (t >= 24) Object.assign(f, { state: "down", dur: DOWN.dur, t: t - 24 });
        },
      },
    ];
  }
  // locomotion
  const walk = (speed: number): Row => ({
    name: `${speed < 2 ? "walk" : "run"} ${speed} m/s`,
    style: sStyle,
    frames: 60,
    start: (f) => Object.assign(f, { state: "walk" }),
    each: (_f, b) => {
      b.root.position.z += speed * DT;
    },
  });
  return [
    { name: "idle", style: sStyle, frames: 90, start: (f) => Object.assign(f, { state: "idle" }) },
    { name: "guard", style: sStyle, frames: 30, start: (f) => Object.assign(f, { state: "guard" }) },
    walk(1.2),
    walk(3),
  ];
}

// ---------------------------------------------------------------- drawing
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(CW, CH - 30);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x221c1a);
scene.add(new THREE.HemisphereLight(0xfff0e0, 0x302020, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 4, 3);
scene.add(sun);
// a floor with a grid, so a sliding foot shows
const grid = new THREE.GridHelper(20, 80, 0x705040, 0x4a3a32);
scene.add(grid);
const camera = new THREE.PerspectiveCamera(34, CW / (CH - 30), 0.1, 50);
const VIEW = params.get("view") ?? "three";
/** The camera looks at the fighter from its front right (three), its right side (side) or the front. */
function aim(at: THREE.Vector3): void {
  const off = VIEW === "side" ? new THREE.Vector3(3.3, 0.3, 0.25) : VIEW === "front" ? new THREE.Vector3(0, 0.3, 3.3) : new THREE.Vector3(2.2, 0.35, 2.4);
  camera.position.copy(at).add(off);
  camera.lookAt(at.x, 0.85, at.z + (VIEW === "side" ? 0.25 : 0.1));
}

const PHASE = { gather: "g", fire: "F", active: "A", recovery: "r" } as const;

async function draw(): Promise<HTMLCanvasElement> {
  const rs = rows();
  const cols = Math.max(...rs.map((r) => Math.floor(r.frames / EVERY) + 2));
  const out = document.createElement("canvas");
  out.width = LEFT + cols * CW;
  out.height = TOP + rs.length * CH;
  const g = out.getContext("2d")!;
  g.fillStyle = "#151010";
  g.fillRect(0, 0, out.width, out.height);
  g.font = "bold 14px sans-serif";
  g.fillStyle = "#ffd7a0";
  g.fillText(`${params.get("set") ?? "moves"} - ${STYLES[sStyle].name} (${STYLES[sStyle].style}, ${familyOf(sStyle)}) - every ${EVERY} frames at 60 Hz`, 8, 18);

  for (let r = 0; r < rs.length; r++) {
    const row = rs[r];
    const w = new World({ seed: 1, styles: [row.style, 0], humans: [true, true] });
    const f = w.fighters[0];
    Object.assign(f, { x: 0, y: 0, facing: 0, state: "idle", t: 0, stop: 0 });
    const b = buildBody(f);
    scene.add(b.root);
    let time = 0;
    // settle in the stance
    for (let i = 0; i < 60; i++) animate(b, f, w, (time += DT), DT);
    row.start(f, b, w);
    const y0 = TOP + r * CH;
    g.font = "bold 12px sans-serif";
    g.fillStyle = "#ffe8c8";
    g.fillText(row.name, 6, y0 + 18);
    g.font = "11px sans-serif";
    g.fillStyle = "#b8a090";
    if (row.hit !== undefined) g.fillText(`hit ${row.hit}  act ${row.act ?? "-"}`, 6, y0 + 34);
    g.fillText(`${row.frames} frames`, 6, y0 + 48);
    let col = 0;
    let prevTip: THREE.Vector3 | null = null;
    for (let t = 0; t <= row.frames; t++) {
      f.t = t;
      row.each?.(f, b, w, t);
      const tp: Target = animate(b, f, w, (time += DT), DT);
      // the striking tip's speed
      let speed = 0;
      if (tp.drive && tp.drive !== "body" && tp.drive !== "head") {
        const s = tp.drive === "armR" || tp.drive === "legR" ? "R" : "L";
        const tip = tp.drive.startsWith("leg") ? ankleOf(b, s) : b.joints[s === "L" ? "elbowL" : "elbowR"].localToWorld(new THREE.Vector3(0, -0.3, 0));
        if (prevTip) speed = tip.distanceTo(prevTip) / DT;
        prevTip = tip;
      } else prevTip = null;
      if (t % EVERY !== 0 && t !== row.hit) continue;
      aim(b.root.position);
      renderer.render(scene, camera);
      const x = LEFT + col * CW;
      g.drawImage(renderer.domElement, x, y0);
      const T = row.hit !== undefined ? { hit: row.hit, act: row.act ?? row.hit, end: row.frames } : tp.phase ? tp.T : undefined;
      const active = T && t >= T.hit && t < T.act;
      if (T && t === T.hit) {
        g.strokeStyle = "#ff3030";
        g.lineWidth = 3;
        g.strokeRect(x + 1.5, y0 + 1.5, CW - 3, CH - 33);
      } else if (active) {
        g.strokeStyle = "#ff9a30";
        g.lineWidth = 2;
        g.strokeRect(x + 1, y0 + 1, CW - 2, CH - 32);
      }
      // the caption: frame, phase, the feet, the tip's speed
      g.font = "bold 11px monospace";
      g.fillStyle = t === T?.hit ? "#ff6060" : "#ffffff";
      g.fillText(String(t), x + 4, y0 + CH - 18);
      g.font = "10px monospace";
      g.fillStyle = "#c8b8a8";
      g.fillText(tp.phase ? PHASE[tp.phase] : "", x + 26, y0 + CH - 18);
      for (const [k, s] of (["L", "R"] as const).entries()) {
        const ft = b.feet[s];
        g.fillStyle = ft.down ? "#40ff60" : ft.swing ? "#ffd040" : "#505050";
        g.beginPath();
        g.arc(x + 44 + k * 10, y0 + CH - 22, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      if (speed > 0) {
        g.fillStyle = "#ff8040";
        g.fillRect(x + 4, y0 + CH - 10, Math.min(CW - 8, speed * 6), 5);
        g.fillStyle = "#c8b8a8";
        g.fillText(speed.toFixed(1), x + 66, y0 + CH - 18);
      }
      col++;
      // let the page breathe between frames
      if (col % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    scene.remove(b.root);
  }
  return out;
}

declare global {
  interface Window {
    __strip: { done: boolean; png?: string; error?: string; families: string[] };
  }
}
window.__strip = { done: false, families: Object.keys(FAMILIES) };
draw()
  .then((c) => {
    c.style.maxWidth = "100%";
    document.body.append(c);
    window.__strip.png = c.toDataURL("image/png");
    window.__strip.done = true;
  })
  .catch((e) => {
    window.__strip.error = String(e?.stack ?? e);
    window.__strip.done = true;
  });
