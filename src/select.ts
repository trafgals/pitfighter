// Character select: any device joins with its high-strike button or Start,
// moves a cursor over the 21 styles, confirms with high strike or Start, backs
// out with grab. Start on a device that is in and ready starts the match once
// everyone who joined is ready. Empty slots are filled with CPU fighters up to
// the chosen fighter count: 4 by default, so the first four humans each take a
// CPU's place and every human after that adds a fighter (up to 8).
//
// The kind of match (king of the hill, last one standing, KO race) is picked
// with the arrows or pills on the banner (mouse), [ / ] or H / O (keyboard), or
// L2 / R2 (pad); its arenas take turns, one match each, and main.ts plays a CPU
// brawl on the next one behind the menu. A fighter card clicked joins the keyboard player on it, and FIGHT!
// readies everyone and starts.
import { BTN } from "./sim/types";

export const DEFAULT_FIGHTERS = 4;
import { STYLES } from "./sim/styles";
import { CONTROLS_HELP, type DeviceId, type DeviceRead, type Input } from "./input";
import { PLAYER_COLORS } from "./render/scene";
import { DEFAULT_STAGE, MATCH_TYPES, arenasOf, matchTypeById, stageById, typeOf, type MatchTypeId, type StageId } from "./sim/stages";

const COLS = 7;
const RELEASED: DeviceRead = { x: 0, y: 0, buttons: 0, start: false, moves: false, left: false, right: false, up: false, down: false };
const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

export interface Slot {
  device: DeviceId;
  style: number;
  ready: boolean;
}

export interface SelectResult {
  styles: number[];
  humans: boolean[];
  devices: (DeviceId | null)[];
  stage: StageId;
  practice: boolean;
}

export class Select {
  slots: Slot[] = [];
  fighters = DEFAULT_FIGHTERS;
  /** blood on or off (main.ts keeps it; the menu shows it) */
  gore = true;
  /** a practice match: the CPUs stand still as dummies, nobody wins, everyone heals (P / R3) */
  practice = false;
  /** the kind of match, and the arena the next one is played on */
  type: MatchTypeId = typeOf(DEFAULT_STAGE).id;
  stage: StageId = DEFAULT_STAGE;
  /** told when the arena changes (main.ts shows it behind the menu) */
  onStage: ((id: StageId) => void) | null = null;
  private prev = new Map<DeviceId, DeviceRead>();
  private el: HTMLElement;

  constructor(
    root: HTMLElement,
    private input: Input,
    private onStart: (r: SelectResult) => void,
  ) {
    this.el = root;
    root.innerHTML = `
      <header><h1>PITFIGHTER</h1><p class="sub">Up to eight devils. One pit. No rules.</p></header>
      <section class="stagepick">
        <button class="arrow prev" aria-label="Previous match type">&#9664;</button>
        <div class="stagecard"><div class="kicker"></div><h2 class="stname"></h2><p class="stblurb"></p><p class="starenas"></p></div>
        <button class="arrow next" aria-label="Next match type">&#9654;</button>
      </section>
      <div class="stages">${MATCH_TYPES.map((t) => `<button class="stage" data-type="${t.id}">${t.name}</button>`).join("")}</div>
      <div class="stagehint">Change match type: click &#9664; &#9654; · [ / ] or H / O · L2 / R2</div>
      <div class="grid">${STYLES.map(
        (s, i) => `<button class="sc" data-i="${i}" style="--body:${hex(s.color)};--acc:${hex(s.accent)}"><div class="sw"></div>
          <div class="sn">${s.name}</div><div class="ss">${s.style}</div><div class="cur"></div></button>`,
      ).join("")}</div>
      <div class="info"></div>
      <div class="slots"></div>
      <div class="bar"><div class="count"></div><button class="practice">PRACTICE: OFF</button><button class="fight">FIGHT!</button></div>
      <div class="help">${CONTROLS_HELP.map((l) => `<div>${l}</div>`).join("")}
        <div>Join: J / Num4 / □ / Start · Move: stick · Confirm: J / □ / Start · Back: L / ○ · Fighters: - / + (L1 / R1) · Stage: [ / ] (L2 / R2) · Practice: P (R3) · Blood: G · Start: Enter / Start · In a fight, the move list: Tab / Num. / Select</div></div>`;
    root.querySelector(".prev")!.addEventListener("click", () => this.cycleType(-1));
    root.querySelector(".next")!.addEventListener("click", () => this.cycleType(1));
    root.querySelectorAll<HTMLElement>(".stage").forEach((b) => b.addEventListener("click", () => this.setType(b.dataset.type as MatchTypeId)));
    root.querySelectorAll<HTMLElement>(".sc").forEach((b) => {
      b.addEventListener("click", () => this.pick(Number(b.dataset.i)));
      b.addEventListener("mouseenter", () => this.describe(Number(b.dataset.i)));
    });
    root.querySelector(".fight")!.addEventListener("click", () => this.fight());
    root.querySelector(".practice")!.addEventListener("click", () => this.setPractice(!this.practice));
    // buttons are for the mouse: keys and pads drive the menu through poll(), and a focused button must not eat Enter or Space
    root.querySelectorAll("button").forEach((b) => b.addEventListener("keydown", (e) => e.preventDefault()));
    this.render();
  }

  show(on: boolean): void {
    this.el.style.display = on ? "" : "none";
  }

  /** Called every animation frame while the select screen is up. */
  poll(): void {
    let start = false;
    let changed = false;
    for (const dev of this.input.devices()) {
      const now = this.input.read(dev);
      // a device seen for the first time counts as released: a gamepad only shows
      // up once a button is pressed, and that press must not be lost
      const was = this.prev.get(dev) ?? RELEASED;
      this.prev.set(dev, now);
      const edge = (k: keyof DeviceRead) => !!now[k] && !was[k];
      const bedge = (b: number) => (now.buttons & b) !== 0 && (was.buttons & b) === 0;
      const slot = this.slots.find((s) => s.device === dev);
      // anyone can flip through the match types, joined or not
      if (bedge(BTN.TAUNT)) this.cycleType(-1);
      if (bedge(BTN.SPECIAL)) this.cycleType(1);
      if (bedge(BTN.TARGET)) this.setPractice(!this.practice);
      // Start never starts the match from a device that is not in it: it joins
      // that device (and readies it, a second time) instead of filling the pit with CPUs
      if (edge("start") && slot?.ready) start = true;
      if (!slot) {
        if ((bedge(BTN.HIGH) || edge("start")) && this.join(dev, (this.slots.length * 3) % STYLES.length)) changed = true;
        continue;
      }
      if (bedge(BTN.USE)) this.setCount(this.fighters - 1);
      if (bedge(BTN.LOCK)) this.setCount(this.fighters + 1);
      if (!slot.ready) {
        const n = STYLES.length;
        if (edge("left")) slot.style = (slot.style + n - 1) % n;
        if (edge("right")) slot.style = (slot.style + 1) % n;
        if (edge("up")) slot.style = (slot.style + n - COLS) % n;
        if (edge("down")) slot.style = (slot.style + COLS) % n;
        if (bedge(BTN.HIGH) || edge("start")) slot.ready = true;
        else if (bedge(BTN.GRAB)) this.slots = this.slots.filter((s) => s !== slot);
      } else if (bedge(BTN.GRAB)) slot.ready = false;
      changed = true;
    }
    if (changed) this.render();
    if (start && this.slots.every((s) => s.ready)) this.start();
  }

  setPractice(on: boolean): void {
    this.practice = on;
    this.render();
  }

  setGore(on: boolean): void {
    this.gore = on;
    this.render();
  }

  setCount(n: number): void {
    this.fighters = Math.max(Math.max(2, this.slots.length), Math.min(8, n));
    this.render();
  }

  /** Step through the match types that have an arena to play on. */
  cycleType(dir: number): void {
    const types = MATCH_TYPES.filter((t) => arenasOf(t).length);
    const n = types.length;
    const i = types.findIndex((t) => t.id === this.type);
    this.setType(types[(i + dir + n) % n].id);
  }

  /** Pick a kind of match: its first arena is up next. */
  setType(id: MatchTypeId): void {
    const arenas = arenasOf(matchTypeById(id));
    if (!arenas.length) throw new Error(`match type ${id} has no arena yet`);
    this.setStage(arenas.includes(this.stage) ? this.stage : arenas[0]);
  }

  /** Play the next match on this arena, and its kind of match: ?stage=, and the tests. */
  setStage(id: StageId): void {
    if (!stageById(id).playable) throw new Error(`stage ${id} is not playable yet`);
    const changed = id !== this.stage;
    this.type = typeOf(id).id;
    this.stage = id;
    this.render();
    if (changed) this.onStage?.(id);
  }

  /** A fighter card clicked: the keyboard player (P1's keys) joins on it, or switches to it. */
  pick(style: number): void {
    const s = this.slots.find((x) => x.device === "kb1");
    if (s) {
      s.style = style;
      s.ready = false;
    } else this.join("kb1", style);
    this.render();
  }

  /** A new human joins: up to the fighter count they take a CPU's place, past it they add a fighter. */
  join(device: string, style: number): boolean {
    if (this.slots.length >= 8) return false;
    this.slots.push({ device, style, ready: false });
    this.fighters = Math.max(this.fighters, this.slots.length);
    return true;
  }

  /** FIGHT!: everyone who joined is ready, and the match starts (all CPUs if nobody joined). */
  fight(): void {
    for (const s of this.slots) s.ready = true;
    this.start();
  }

  private describe(style: number): void {
    const st = STYLES[style];
    this.el.querySelector(".info")!.innerHTML = `<b>${st.name}</b> - ${st.style}<br><i>${st.blurb}</i>`;
  }

  start(seed = Date.now() >>> 0): void {
    const styles: number[] = [];
    const humans: boolean[] = [];
    const devices: (DeviceId | null)[] = [];
    for (const s of this.slots) {
      styles.push(s.style);
      humans.push(true);
      devices.push(s.device);
    }
    let k = seed;
    while (styles.length < this.fighters) {
      k = (Math.imul(k, 1103515245) + 12345) >>> 0;
      styles.push((k >>> 8) % STYLES.length);
      humans.push(false);
      devices.push(null);
    }
    const stage = this.stage;
    // the kind's arenas take turns: the next match is on the next one
    const arenas = arenasOf(matchTypeById(this.type));
    this.stage = arenas[(arenas.indexOf(stage) + 1) % arenas.length];
    this.render();
    this.onStart({ styles, humans, devices, stage, practice: this.practice });
  }

  private render(): void {
    const el = this.el;
    el.querySelectorAll<HTMLElement>(".stage").forEach((c) => c.classList.toggle("on", c.dataset.type === this.type));
    const type = matchTypeById(this.type);
    el.querySelector(".kicker")!.textContent = `MATCH TYPE ${MATCH_TYPES.indexOf(type) + 1} / ${MATCH_TYPES.length}`;
    el.querySelector(".stname")!.textContent = type.name;
    el.querySelector(".stblurb")!.textContent = type.blurb;
    const arenas = arenasOf(type);
    el.querySelector(".starenas")!.innerHTML =
      (arenas.length > 1 ? "Arenas, in turn: " : "Arena: ") + arenas.map((id) => (id === this.stage ? `<b>${stageById(id).name}</b>` : stageById(id).name)).join(" · ");
    el.querySelectorAll<HTMLElement>(".sc").forEach((c) => {
      const i = Number(c.dataset.i);
      const here = this.slots.map((s, p) => ({ s, p })).filter(({ s }) => s.style === i);
      c.querySelector(".cur")!.innerHTML = here
        .map(({ s, p }) => `<span style="background:${hex(PLAYER_COLORS[p])}">${s.ready ? "✔" : ""}P${p + 1}</span>`)
        .join("");
      c.classList.toggle("on", here.length > 0);
    });
    const focus = this.slots[this.slots.length - 1];
    this.describe(focus ? focus.style : 0);
    el.querySelector(".slots")!.innerHTML = Array.from({ length: 8 }, (_, p) => {
      const s = this.slots[p];
      const c = hex(PLAYER_COLORS[p]);
      if (s) return `<div class="slot" style="border-color:${c}"><b style="color:${c}">P${p + 1}</b> ${STYLES[s.style].name}<br><small>${s.device} · ${s.ready ? "READY" : "choosing"}</small></div>`;
      if (p < this.fighters) return `<div class="slot cpu" style="border-color:${c}"><b style="color:${c}">P${p + 1}</b> CPU<br><small>press □ / Start / J, or click a fighter</small></div>`;
      return `<div class="slot off"><b>P${p + 1}</b> -</div>`;
    }).join("");
    el.querySelector(".count")!.textContent = `${this.fighters} fighters · blood ${this.gore ? "ON" : "OFF"} (G) · Enter / Start when everyone is ready`;
    const pr = el.querySelector<HTMLElement>(".practice")!;
    pr.textContent = `PRACTICE: ${this.practice ? "ON" : "OFF"}`;
    pr.classList.toggle("on", this.practice);
  }
}
