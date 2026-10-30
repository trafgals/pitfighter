import "./style.css";
import { Bot } from "./sim/ai";
import { FPS, NO_INPUT, type PlayerInput } from "./sim/types";
import { World } from "./sim/world";
import { Input, type DeviceId } from "./input";
import { Scene } from "./render/scene";
import { Hud, winLine } from "./render/hud";
import { STAGES, type StageId } from "./sim/stages";
import { STYLES } from "./sim/styles";
import { CueTracker } from "./render/cues";
import { Sfx } from "./render/sfx";
import { DEFAULT_FIGHTERS, Select, type SelectResult } from "./select";
import { MoveList } from "./render/movelist";
import { buildMatch, Player, Recorder, type Setup, type Take } from "./lab/replay";
import { LabPanel } from "./lab/panel";

const params = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const input = new Input();
// ?lofi=1: no bloom and no shadows, for slow machines
const scene = new Scene(canvas, params.get("lofi") === "1");
const GORE_KEY = "pitfighter.gore";
/** Blood on or off: ?gore=0 or 1 for this visit, else what G on the menu last chose. */
function goreOn(): boolean {
  const q = params.get("gore");
  if (q !== null) return q !== "0";
  try {
    return localStorage.getItem(GORE_KEY) !== "0";
  } catch {
    return true;
  }
}
scene.gore = goreOn();
// ?debug=motion: the animation's state, per fighter, over the game
if (params.get("debug") === "motion") {
  const el = document.createElement("pre");
  el.id = "motion-debug";
  document.body.append(el);
  scene.debugMotion(el);
}
const sfx = new Sfx();
const cues = new CueTracker();
const hud = new Hud(document.querySelector<HTMLElement>("#hud")!);
const overEl = document.querySelector<HTMLElement>("#over")!;
const moves = new MoveList(document.querySelector<HTMLElement>("#moves")!);
let lastMoves = false;

type Mode = "select" | "countdown" | "match" | "over";
let mode: Mode = "select";
let world: World | null = null;
let bots: (Bot | null)[] = [];
let devices: (DeviceId | null)[] = [];
let acc = 0;
let overT = 0;
let countT = 0;
/** The countdown before each round: 3, 2, 1, each this long (s); then START! and the fight. The sim waits. */
const BEAT = 0.75;
// ?auto=1 (the tests, the demo) starts at once unless ?countdown=1
const COUNTDOWN = params.get("countdown") === "1" || (params.get("countdown") !== "0" && !params.get("auto"));
let opener = "";
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
  if (e.code === "BracketLeft") select.cycleType(-1);
  if (e.code === "BracketRight") select.cycleType(1);
  if (e.code === "KeyP") select.setPractice(!select.practice);
  if (e.code === "Slash") select.toggleHelp();
  if (e.code === "KeyG") {
    scene.gore = !scene.gore;
    select.setGore(scene.gore);
    try {
      localStorage.setItem(GORE_KEY, scene.gore ? "1" : "0");
    } catch {
      /* not remembered */
    }
  }
});
select.setGore(scene.gore);
select.onStage = () => attract();

/** Behind the menu, a CPU brawl on the chosen stage: what the stage looks like, and the pit alive. Silent, and nobody's score. */
let demoSeed = 1;
function attract(): void {
  const stage = select.stage;
  demoSeed = (Math.imul(demoSeed, 1103515245) + 12345) >>> 0;
  const styles = Array.from({ length: 6 }, (_, i) => ((demoSeed >>> 8) + i * 5) % STYLES.length);
  world = new World({ seed: demoSeed, styles, humans: styles.map(() => false), stage });
  bots = styles.map((_, i) => new Bot(i, demoSeed, 0.6 + 0.08 * (i % 3)));
  devices = styles.map(() => null);
  scene.attach(world);
  scene.setInset(0);
  cues.reset();
  acc = 0;
  select.setAttract(styles);
}

// ?lab=1: the feel lab (src/lab/): dials over the numbers that make the feel, and takes to replay under them
const lab = params.get("lab") === "1" ? new LabPanel({ record, stop, replay, spar }) : null;
/** the match being played, as it began: a take replays it from here */
let setup: Setup | null = null;
let recorder: Recorder | null = null;
let take: Take | null = null;
let player: Player | null = null;

function startMatch(r: SelectResult, seed = Number(params.get("seed") ?? Date.now() >>> 0)): void {
  setup = { seed, styles: r.styles, humans: r.humans, stage: r.stage, practice: r.practice, spar: lab?.spar };
  ({ world, bots } = buildMatch(setup));
  devices = r.devices;
  scene.attach(world);
  hud.attach(world);
  cues.reset();
  sfx.unlock();
  sfx.startAmbient(r.stage);
  select.show(false);
  overEl.classList.remove("show");
  document.body.classList.add("playing");
  acc = 0;
  opener = r.practice ? "PRACTICE! TAB FOR THE MOVE LIST" : OPENERS[r.stage];
  moves.hide();
  scene.setInset(hud.inset);
  if (COUNTDOWN) {
    mode = "countdown";
    countT = 0;
    scene.countdown(true);
  } else go();
}

/** The round starts: START!, the stage's opener, and the sim runs. */
function go(): void {
  mode = "match";
  acc = 0;
  scene.countdown(false);
  hud.countdown("START!");
  hud.say(opener, 120);
}

// the camera keeps the fight above the fighter cards, however tall they wrap
const fitHud = () => scene.setInset(mode === "select" ? 0 : hud.inset);
window.addEventListener("resize", fitHud);
new ResizeObserver(fitHud).observe(document.querySelector("#hud .cards")!);

/** Begin the match again from its first frame, the same as it began, on the dials as they are now. */
function restart(m = setup && buildMatch(setup)): void {
  if (!m || !setup || !world) return;
  ({ world, bots } = m);
  scene.attach(world);
  hud.attach(world);
  cues.reset();
  moves.hide();
  acc = 0;
  if (mode !== "match") go();
}

/** Lab: start a take, from a fresh start of this match. */
function record(): void {
  if (!setup || mode === "select") return;
  player = null;
  restart();
  recorder = new Recorder(setup);
  lab?.setRecording(true);
}
/** Lab: end the take; it is what REPLAY plays from now on. */
function stop(): void {
  if (recorder && recorder.length) take = recorder.take;
  recorder = null;
  lab?.setRecording(false);
}
/** Lab: play the last take back from its start on the dials as they are now; at its end the hands are yours again. */
function replay(): void {
  if (recorder) stop();
  if (!take || mode === "select") {
    lab?.status("record a take first (1)");
    return;
  }
  player = new Player(take);
  restart(player.match);
}
/** Lab: the dummies fight back, or stand still again, from a fresh start. */
function spar(on: boolean): void {
  if (!setup) return;
  setup = { ...setup, spar: on };
  take = null;
  player = null;
  recorder = null;
  lab?.setRecording(false);
  if (mode !== "select") restart();
}

function stepOnce(): void {
  if (!world) return;
  const w = world;
  const inputs: PlayerInput[] = player
    ? player.next()
    : w.fighters.map((_, i) => {
        const d = devices[i];
        if (d) return input.read(d);
        return bots[i]?.think(w) ?? NO_INPUT;
      });
  if (player?.done) player = null; // the take has run out: the hands are the players' again
  recorder?.push(inputs);
  w.step(inputs);
  const c = cues.collect(w);
  scene.cue(c, w);
  if (mode === "select") {
    // the brawl behind the menu: once it is won, another starts
    if (w.s.winner >= 0) attract();
    return;
  }
  if (moves.open) moves.show(w); // a limb torn off while it is open changes the list
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

/** Step the sim at FPS on real time, catching up at most five steps a frame. */
function run(dt: number): void {
  acc += dt;
  let n = 0;
  while (acc >= 1 / FPS && n < 5) {
    stepOnce();
    acc -= 1 / FPS;
    n++;
  }
  if (n === 5) acc = 0;
}

let last = performance.now();
function frame(now: number): void {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  // a KO slows the fight: the sim is stepped less often, and the animation runs at the same pace
  const dt = mode === "countdown" ? real : real * scene.timeScale;
  if (mode === "select") {
    select.poll();
    if (mode === "select") run(dt);
  } else if (mode === "countdown") {
    countT += real;
    const n = 3 - Math.floor(countT / BEAT);
    if (n >= 1) hud.countdown(String(n));
    else go();
  } else if (mode === "match") {
    // the move list holds the fight while it is open
    const press = input.devices().some((d) => input.read(d).moves);
    if (press && !lastMoves && world) {
      if (moves.open) moves.hide();
      else moves.show(world);
      acc = 0;
    }
    lastMoves = press;
    if (!moves.open) run(dt);
    if (lab && world) {
      const sec = (n: number) => (n / FPS).toFixed(1);
      lab.status(
        recorder ? `recording ${sec(recorder.length)} s`
        : player ? `replaying ${sec(player.frame)} / ${sec(player.take.frames.length)} s`
        : take ? `take ready: ${sec(take.frames.length)} s` : "press 1 to record a take",
      );
    }
  }
  else if (mode === "over") {
    overT += real;
    const anyStart = input.devices().some((d) => input.read(d).start);
    if (overT > 1.5 && anyStart && !lastStart) {
      mode = "select";
      overEl.classList.remove("show");
      document.body.classList.remove("playing");
      hud.countdown(null);
      scene.setInset(0);
      select.show(true);
      attract();
    }
    lastStart = anyStart;
  }
  scene.render(now / 1000, dt, real);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (params.get("auto")) {
  select.setCount(Number(params.get("fighters") ?? DEFAULT_FIGHTERS));
  select.setPractice(params.get("practice") === "1");
  // ?stage=<id>: start on that stage
  const st = params.get("stage");
  if (st && STAGES.some((x) => x.id === st)) select.setStage(st as StageId);
  select.start(Number(params.get("seed") ?? 1));
} else {
  // the lab opens on a practice match against one dummy
  if (lab) {
    select.setPractice(true);
    select.setCount(2);
  }
  attract();
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
  moves,
  scene,
  sfx,
  /** advance the simulation synchronously (tests) */
  step(n: number) {
    for (let i = 0; i < n && mode === "match"; i++) stepOnce();
    return world?.s.frame;
  },
};
