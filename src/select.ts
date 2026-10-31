// Character select & Playbill title screen:
//
// Beat 1 (The Playbill): before anyone joins (or opens the lobby), the menu
// frames the live 6-CPU attract brawl like a Victorian playbill — top gaslit
// marquee with the bout bill and match types, open middle viewport so the pit
// breathes, a live ticker naming the fighters currently in the Sump, and a
// broadsheet dock at the bottom.
//
// Beat 2 (The Lobby): any device pressing its high-strike button or Start (or
// clicking ENTER THE SUMP / a fighter card) unfolds the roster lobby (a grid of concept-art portrait cards and a featured panel per player), moves a
// cursor over the 12 fighters, confirms with high strike or Start, and backs
// out with grab. Start on a device that is in and ready starts the match once
// everyone who joined is ready. Empty slots are filled with CPU fighters up to
// the chosen fighter count: 4 by default, so the first four humans each take a
// CPU's place and every human after that adds a fighter (up to 8).
import { BTN } from "./sim/types";

export const DEFAULT_FIGHTERS = 4;
import { CHARACTERS, CRAFT_BY_ID, STAGE_REDRESS } from "./data/characters";
import type { Character } from "./data/types";
import { STYLES } from "./sim/styles";
import { CONTROLS_HELP, type DeviceId, type DeviceRead, type Input } from "./input";
import { PLAYER_COLORS } from "./render/scene";
import { DEFAULT_STAGE, MATCH_TYPES, arenasOf, matchTypeById, stageById, typeOf, type MatchTypeId, type StageId } from "./sim/stages";

const COLS = 6;
const RELEASED: DeviceRead = { x: 0, y: 0, buttons: 0, start: false, moves: false, left: false, right: false, up: false, down: false };
const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/** The concept painting of a fighter, as a URL the page can load. */
const conceptUrl = (ch: Character | undefined): string => (ch ? `/${ch.art.concept}` : "");

const pips = (n: number) => `<span class="pips">${Array.from({ length: 5 }, (_, k) => `<i class="pip${k < n ? " on" : ""}"></i>`).join("")}</span>`;

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
  /** whether the roster lobby has been opened explicitly from the Playbill */
  lobbyOpen = false;
  /** whether the controls & rules sheet is open */
  helpOpen = false;
  /** the fighters currently brawling in the live attract match behind the menu */
  attractStyles: number[] = [];
  /** the fighter under the mouse (or the first card) while nobody has joined */
  private hover = 0;
  private panelsHtml = "";
  private prev = new Map<DeviceId, DeviceRead>();
  private el: HTMLElement;

  constructor(
    root: HTMLElement,
    private input: Input,
    private onStart: (r: SelectResult) => void,
  ) {
    this.el = root;
    root.innerHTML = `
      <div class="playbill-top">
        <header>
          <div class="society">THE BENEVOLENT SOCIETY FOR THE ELEVATION OF THE LOWER ORDERS BY PUGILISM PRESENTS</div>
          <h1>PITFIGHTER</h1>
          <div class="sorrow-tag">OLD SORROW · NINETY-FIRST YEAR OF RAIN</div>
          <p class="sub">Up to eight ladies and gentlemen. One drowned pit. Do mind the blood.</p>
        </header>
        <section class="stagepick">
          <button class="arrow prev" aria-label="Previous match type">&#9664;</button>
          <div class="stagecard"><div class="kicker"></div><h2 class="stname"></h2><p class="stblurb"></p><p class="starenas"></p></div>
          <button class="arrow next" aria-label="Next match type">&#9654;</button>
        </section>
        <div class="stages">${MATCH_TYPES.map((t) => `<button class="stage" data-type="${t.id}">${t.name}</button>`).join("")}</div>
        <div class="stagehint">Change match type: click &#9664; &#9654; · [ / ] or H / Y · L2 / R2</div>
      </div>
      <div class="lobby">
        <div class="grid-wrap"><div class="grid">${STYLES.map((s, i) => {
          const ch = CHARACTERS[i];
          const craft = ch ? CRAFT_BY_ID[ch.limbs.craft]?.name ?? ch.limbs.craft : "";
          const bHex = hex(s.color);
          const aHex = hex(s.accent);
          const art = conceptUrl(ch);
          return `<button class="sc" data-i="${i}" style="--body:${bHex};--acc:${aHex}">
            <span class="sc-art">${art ? `<img src="${art}" alt="" loading="lazy" draggable="false">` : ""}</span>
            <span class="cur"></span>
            <span class="sc-plate"><span class="sn">${ch?.short ?? s.name}</span><span class="ss">${s.style}${craft ? ` · ${craft}` : ""}</span></span></button>`;
        }).join("")}</div></div>
        <aside class="stage-side">
          <div class="panels"></div>
          <div class="slots"></div>
        </aside>
      </div>
      <div class="playbill-dock">
        <div class="bout-ticker"></div>
        <div class="playbill-cta">
          <button class="enter-sump">
            <span class="cta-main">PRESS START / &#9675; / J — OR CLICK TO ENTER THE SUMP</span>
            <span class="cta-sub">Join the bout bill · Choose your champion · Up to 8 combatants</span>
          </button>
        </div>
        <div class="bar">
          <button class="count-btn count-dec" aria-label="Fewer fighters">&#8722;</button>
          <div class="count"></div>
          <button class="count-btn count-inc" aria-label="More fighters">+</button>
          <button class="back-playbill">&#8592; PLAYBILL</button>
          <button class="practice">PRACTICE: OFF</button>
          <button class="help-toggle">CONTROLS &amp; RULES</button>
          <button class="fight">FIGHT!</button>
        </div>
        <div class="help">${CONTROLS_HELP.map((l) => `<div>${l}</div>`).join("")}
          <div>Join: J / Num6 / &#9675; / Start · Move: stick · Confirm: J / &#9675; / Start · Back: K / &#9651; · Fighters: - / + (L1 / R1) · Stage: [ / ] (L2 / R2) · Practice: P (R3) · Blood: G · Start: Enter / Start · In a fight, the move list: Tab / Num. / Select</div></div>
      </div>`;
    root.querySelector(".prev")!.addEventListener("click", () => this.cycleType(-1));
    root.querySelector(".next")!.addEventListener("click", () => this.cycleType(1));
    root.querySelectorAll<HTMLElement>(".stage").forEach((b) => b.addEventListener("click", () => this.setType(b.dataset.type as MatchTypeId)));
    root.querySelectorAll<HTMLElement>(".sc").forEach((b) => {
      b.addEventListener("click", () => this.pick(Number(b.dataset.i)));
      b.addEventListener("mouseenter", () => this.describe(Number(b.dataset.i)));
    });
    root.querySelector(".count-dec")!.addEventListener("click", () => this.setCount(this.fighters - 1));
    root.querySelector(".count-inc")!.addEventListener("click", () => this.setCount(this.fighters + 1));
    root.querySelector(".enter-sump")!.addEventListener("click", () => this.openLobby());
    root.querySelector(".back-playbill")!.addEventListener("click", () => this.closeLobby());
    root.querySelector(".help-toggle")!.addEventListener("click", () => this.toggleHelp());
    root.querySelector(".fight")!.addEventListener("click", () => this.fight());
    root.querySelector(".practice")!.addEventListener("click", () => this.setPractice(!this.practice));
    // buttons are for the mouse: keys and pads drive the menu through poll(), and a focused button must not eat Enter or Space
    root.querySelectorAll("button").forEach((b) => b.addEventListener("keydown", (e) => e.preventDefault()));
    this.render();
  }

  /** True while the title Playbill is up (nobody has joined or opened the fighter lobby yet). */
  get inPlaybill(): boolean {
    return !this.lobbyOpen && this.slots.length === 0;
  }

  openLobby(): void {
    this.lobbyOpen = true;
    this.render();
  }

  closeLobby(): void {
    this.lobbyOpen = false;
    this.slots = [];
    this.render();
  }

  toggleHelp(on = !this.helpOpen): void {
    this.helpOpen = on;
    this.render();
  }

  /** Record who is fighting in the live attract match behind the Playbill. */
  setAttract(styles: number[]): void {
    this.attractStyles = styles;
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
        else if (bedge(BTN.GRAB)) {
          this.slots = this.slots.filter((s) => s !== slot);
          if (this.slots.length === 0) this.lobbyOpen = false;
        }
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
    this.lobbyOpen = true;
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

  /** Mouse over a card: with nobody in yet, the featured panel shows that fighter. */
  private describe(style: number): void {
    this.hover = style;
    if (this.slots.length === 0) this.renderPanels();
  }

  /** The big featured panel: one per joined player (or one for the fighter under the mouse), led by the concept art. */
  private panelHtml(style: number, p: number | null): string {
    const st = STYLES[style];
    const ch = CHARACTERS[style];
    const craft = ch ? CRAFT_BY_ID[ch.limbs.craft]?.name ?? ch.limbs.craft : "";
    const slot = p === null ? undefined : this.slots[p];
    const c = hex(PLAYER_COLORS[p ?? 0]);
    const art = conceptUrl(ch);
    const rate = (k: string, n: number) => `<span class="rate">${k} ${pips(n)}</span>`;
    const ratings = ch
      ? `<div class="info-ratings">${rate("PWR", ch.ratings.power)}${rate("SPD", ch.ratings.speed)}${rate("RCH", ch.ratings.reach)}${rate("GRP", ch.ratings.grapple)}${rate("TEC", ch.ratings.technique)}</div>`
      : "";
    const meta = ch
      ? `<div class="info-meta">` +
        `<span class="meta-chip"><b>Craft:</b> ${craft} (${ch.limbs.tip})</span>` +
        `<span class="meta-chip"><b>Special:</b> ${ch.specialName}</span>` +
        `<span class="meta-chip"><b>Air Grab:</b> ${ch.airGrab.name}</span>` +
        `<span class="meta-chip"><b>Tincture:</b> ${ch.moves.status.name}</span></div>`
      : "";
    const tag =
      p === null
        ? `<div class="pn-tag" style="--pc:${c}">THE BILL</div>`
        : `<div class="pn-tag" style="--pc:${c}">P${p + 1} · ${slot?.ready ? "READY" : "CHOOSING"}<small>${slot?.device ?? ""}</small></div>`;
    return `<article class="panel${slot?.ready ? " ready" : ""}" style="--pc:${c}">
      <div class="pn-art">${art ? `<img src="${art}" alt="${ch?.name ?? st.name}" draggable="false">` : ""}</div>
      <div class="pn-body">${tag}
        <h3 class="pn-name">${ch?.name ?? st.name}</h3>
        ${ch?.title ? `<div class="info-title">${ch.title}</div>` : ""}
        <div class="pn-style">${st.style}${craft ? ` · ${craft}` : ""}</div>
        ${ratings}
        <p class="info-blurb">${st.blurb}</p>${meta}
      </div></article>`;
  }

  private renderPanels(): void {
    const box = this.el.querySelector<HTMLElement>(".panels")!;
    box.dataset.n = String(Math.max(1, this.slots.length));
    const html = this.slots.length ? this.slots.map((s, p) => this.panelHtml(s.style, p)).join("") : this.panelHtml(this.hover, null);
    // poll() renders every frame once someone is in: only touch the DOM when the panels changed, so the paintings do not flicker
    if (html === this.panelsHtml) return;
    this.panelsHtml = html;
    box.innerHTML = html;
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
    el.classList.toggle("playbill", this.inPlaybill);
    el.classList.toggle("help-open", this.helpOpen);
    el.querySelectorAll<HTMLElement>(".stage").forEach((c) => c.classList.toggle("on", c.dataset.type === this.type));
    const type = matchTypeById(this.type);
    el.querySelector(".kicker")!.textContent = `MATCH TYPE ${MATCH_TYPES.indexOf(type) + 1} / ${MATCH_TYPES.length}`;
    el.querySelector(".stname")!.textContent = type.name;
    el.querySelector(".stblurb")!.textContent = type.blurb;
    const arenas = arenasOf(type);
    const fmtArena = (id: StageId) => {
      const classic = stageById(id).name;
      const redress = STAGE_REDRESS[id]?.name;
      const label = redress ? `${redress} (${classic})` : classic;
      return id === this.stage ? `<b>${label}</b>` : label;
    };
    el.querySelector(".starenas")!.innerHTML =
      (arenas.length > 1 ? "Arenas, in turn: " : "Arena: ") + arenas.map(fmtArena).join(" · ");

    const stageRedress = STAGE_REDRESS[this.stage]?.name ?? stageById(this.stage).name;
    const names = this.attractStyles.length
      ? this.attractStyles.map((i) => CHARACTERS[i]?.short ?? STYLES[i]?.name ?? "").filter(Boolean).join(" · ")
      : CHARACTERS.slice(0, 6).map((c) => c.short).join(" · ");
    el.querySelector(".bout-ticker")!.innerHTML =
      `<span class="ticker-kicker">NOW IN ${stageRedress.toUpperCase()}</span> <span class="ticker-names">${names}</span>`;

    el.querySelectorAll<HTMLElement>(".sc").forEach((c) => {
      const i = Number(c.dataset.i);
      const here = this.slots.map((s, p) => ({ s, p })).filter(({ s }) => s.style === i);
      c.querySelector(".cur")!.innerHTML = here
        .map(({ s, p }) => `<span style="background:${hex(PLAYER_COLORS[p])}">${s.ready ? "✔ " : ""}P${p + 1}</span>`)
        .join("");
      c.classList.toggle("on", here.length > 0);
      c.style.setProperty("--pc", here.length ? hex(PLAYER_COLORS[here[0].p]) : "");
      c.style.boxShadow = here.map(({ p }, k) => `0 0 0 ${3 + k * 3}px ${hex(PLAYER_COLORS[p])}`).join(", ");
    });
    this.renderPanels();
    el.querySelector(".slots")!.innerHTML = Array.from({ length: 8 }, (_, p) => {
      const s = this.slots[p];
      const c = hex(PLAYER_COLORS[p]);
      if (s) return `<div class="slot" style="border-color:${c}"><b style="color:${c}">P${p + 1}</b> ${CHARACTERS[s.style]?.short ?? STYLES[s.style].name}<br><small>${s.device} · ${s.ready ? "READY" : "choosing"}</small></div>`;
      if (p < this.fighters) return `<div class="slot cpu" style="border-color:${c}"><b style="color:${c}">P${p + 1}</b> CPU<br><small>&#9675; / Start / J</small></div>`;
      return `<div class="slot off"><b>P${p + 1}</b> —</div>`;
    }).join("");
    el.querySelector(".count")!.textContent = `${this.fighters} fighters · blood ${this.gore ? "ON" : "OFF"} (G) · Enter / Start when everyone is ready`;
    const pr = el.querySelector<HTMLElement>(".practice")!;
    pr.textContent = `PRACTICE: ${this.practice ? "ON" : "OFF"}`;
    pr.classList.toggle("on", this.practice);
    const ht = el.querySelector<HTMLElement>(".help-toggle")!;
    ht.classList.toggle("on", this.helpOpen);
  }
}
