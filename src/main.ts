import "./style.css";
import { Bot } from "./sim/ai";
import { FPS, NO_INPUT, type PlayerInput } from "./sim/types";
import { World } from "./sim/world";
import { Input, type DeviceId } from "./input";
import { Scene } from "./render/scene";
import { Hud, winLine } from "./render/hud";
import { STAGES, type StageId } from "./sim/stages";
import { CueTracker } from "./render/cues";
import { Sfx } from "./render/sfx";
import { Select, type SelectResult } from "./select";

const params = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const input = new Input();
// ?lofi=1: no bloom and no shadows, for slow machines
const scene = new Scene(canvas, params.get("lofi") === "1");
const sfx = new Sfx();
const cues = new CueTracker();
const hud = new Hud(document.querySelector<HTMLElement>("#hud")!);
const overEl = document.querySelector<HTMLElement>("#over")!;

type Mode = "select" | "match" | "over";
let mode: Mode = "select";
let world: World | null = null;
let bots: (Bot | null)[] = [];
let devices: (DeviceId | null)[] = [];
let acc = 0;
let overT = 0;
let lastStart = false;

const OPENERS: Record<StageId, string> = {
  "hell-toilet": "FIGHT FOR THE THRONE!",
  "construction-site": "START YOUR ENGINES!",
  "collapsing-tower": "THE ROOF WON'T HOLD!",
  "hindenburg-blimp": "OH, THE HUMANITY!",
  "castle-under-siege": "HOLD THE WALLS!",
};

const select = new Select(document.querySelector<HTMLElement>("#select")!, input, (r) => startMatch(r));

window.addEventListener("keydown", (e) => {
  if (mode !== "select") return;
  if (e.code === "Minus" || e.code === "NumpadSubtract") select.setCount(select.fighters - 1);
  if (e.code === "Equal" || e.code === "NumpadAdd") select.setCount(select.fighters + 1);
  if (e.code === "BracketLeft") select.cycleStage(-1);
  if (e.code === "BracketRight") select.cycleStage(1);
});

function startMatch(r: SelectResult, seed = Number(params.get("seed") ?? Date.now() >>> 0)): void {
  world = new World({ seed, styles: r.styles, humans: r.humans, stage: r.stage });
  bots = r.humans.map((h, i) => (h ? null : new Bot(i, seed, 0.55 + 0.1 * ((i * 7) % 4))));
  devices = r.devices;
  scene.attach(world);
  hud.attach(world);
  cues.reset();
  sfx.unlock();
  sfx.startAmbient(r.stage);
  select.show(false);
  overEl.classList.remove("show");
  document.body.classList.add("playing");
  mode = "match";
  acc = 0;
  hud.say(OPENERS[r.stage], 120);
}

function stepOnce(): void {
  if (!world) return;
  const w = world;
  const inputs: PlayerInput[] = w.fighters.map((_, i) => {
    const d = devices[i];
    if (d) return input.read(d);
    return bots[i]?.think(w) ?? NO_INPUT;
  });
  w.step(inputs);
  const c = cues.collect(w);
  scene.cue(c, w);
  sfx.cue(c, w);
  hud.update(w);
  if (w.s.winner >= 0 && mode === "match") {
    mode = "over";
    overT = 0;
    const f = w.fighters[w.s.winner];
    overEl.innerHTML = `<h2>P${f.id + 1} WINS</h2><p>${winLine(w.s.stage, f.id)}</p><p class="small">Press Enter / Start for another round</p>`;
    overEl.classList.add("show");
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === "select") select.poll();
  else if (mode === "match") {
    acc += dt;
    let n = 0;
    while (acc >= 1 / FPS && n < 5) {
      stepOnce();
      acc -= 1 / FPS;
      n++;
    }
    if (n === 5) acc = 0;
  } else if (mode === "over") {
    overT += dt;
    const anyStart = input.devices().some((d) => input.read(d).start);
    if (overT > 1.5 && anyStart && !lastStart) {
      mode = "select";
      overEl.classList.remove("show");
      document.body.classList.remove("playing");
      select.show(true);
    }
    lastStart = anyStart;
  }
  scene.render(now / 1000, dt);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (params.get("auto")) {
  select.setCount(Number(params.get("fighters") ?? 8));
  // ?stage=<id>: start on that stage
  const st = params.get("stage");
  if (st && STAGES.some((x) => x.id === st)) select.setStage(st as StageId);
  select.start(Number(params.get("seed") ?? 1));
}

// test / debugging hook
declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  get mode() {
    return mode;
  },
  get world() {
    return world;
  },
  select,
  input,
  scene,
  sfx,
  /** advance the simulation synchronously (tests) */
  step(n: number) {
    for (let i = 0; i < n && mode === "match"; i++) stepOnce();
    return world?.s.frame;
  },
};
