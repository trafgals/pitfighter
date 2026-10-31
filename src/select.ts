// Character select & Playbill title screen:
//
// Beat 1 (The Playbill): before anyone joins (or opens the lobby), the menu
// frames the live 6-CPU attract brawl like a Victorian playbill — top gaslit
// marquee with the bout bill and match types, open middle viewport so the pit
// breathes, a live ticker naming the fighters currently in the Sump, and a
// broadsheet dock at the bottom.
//
// Beat 2 (The Lobby): any device pressing its high-strike button or Start (or
// clicking ENTER THE SUMP / a fighter card) unfolds the roster lobby, moves a
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

/** Render an inline Victorian cameo SVG silhouette from the fighter's kit.gear and colours. */
export function cameoSvg(ch: Character | undefined, bodyHex: string, accHex: string): string {
  const gear = new Set(ch?.kit.gear ?? []);
  const parts: string[] = [];
  // Mourning weepers behind the head
  if (gear.has("weepers")) {
    parts.push(`<path d="M13 18 L10 38 L15 38 L16 18 Z M27 18 L25 38 L30 38 L27 18 Z" fill="#101216" opacity="0.9"/>`);
  }
  // Shoulders / coat bust
  parts.push(`<path d="M7 38 C7 29, 13 27, 20 27 C27 27, 33 29, 33 38 Z" fill="${bodyHex}" stroke="${accHex}" stroke-width="1.2"/>`);
  if (gear.has("pauldrons")) {
    parts.push(`<path d="M5 32 Q9 26 14 29 L12 34 Z M35 32 Q31 26 26 29 L28 34 Z" fill="${accHex}"/>`);
  }
  if (gear.has("obi") || gear.has("title")) {
    parts.push(`<circle cx="20" cy="33" r="2.6" fill="#e5be6b"/>`);
  }
  // Head
  parts.push(`<circle cx="20" cy="20" r="6.8" fill="${bodyHex}" stroke="#120d0a" stroke-width="1"/>`);
  // Facial hair / tusks / monocle / goggles
  if (gear.has("whiskers")) {
    parts.push(`<path d="M13 19 Q11 23 14 26 L16 22 Z M27 19 Q29 23 26 26 L24 22 Z" fill="#8c7a64"/>`);
  }
  if (gear.has("beard")) {
    parts.push(`<path d="M15 23 L20 31 L25 23 Z" fill="#d8d2c5"/>`);
  }
  if (gear.has("moustache")) {
    parts.push(`<path d="M13 22 Q17 20 20 22 Q23 20 27 22 Q24 24 20 23 Q16 24 13 22 Z" fill="#2a1a10"/>`);
  }
  if (gear.has("monocle")) {
    parts.push(`<circle cx="22.8" cy="19.5" r="2.2" fill="none" stroke="#e5be6b" stroke-width="1.1"/>`);
  }
  if (gear.has("goggles")) {
    parts.push(
      `<circle cx="17.2" cy="16.5" r="2.3" fill="#5aa082" stroke="#d8a84e" stroke-width="1.1"/>` +
        `<circle cx="22.8" cy="16.5" r="2.3" fill="#5aa082" stroke="#d8a84e" stroke-width="1.1"/>`,
    );
  }
  // Headgear
  if (gear.has("custodian")) {
    parts.push(
      `<path d="M12 16 C12 7, 28 7, 28 16 Z" fill="#1b243c" stroke="${accHex}" stroke-width="1"/>` +
        `<rect x="10" y="15" width="20" height="2" rx="1" fill="#1b243c"/>` +
        `<circle cx="20" cy="12.5" r="1.8" fill="#dfe4ec"/>`,
    );
  } else if (gear.has("stovepipe")) {
    parts.push(
      `<rect x="14" y="3.5" width="12" height="12" fill="#181512" stroke="${accHex}" stroke-width="0.9"/>` +
        `<rect x="10.5" y="14.5" width="19" height="2" rx="1" fill="#181512"/>` +
        `<rect x="14" y="12.5" width="12" height="2" fill="#d8a84e"/>`,
    );
  } else if (gear.has("tophat")) {
    parts.push(
      `<rect x="13.5" y="6.5" width="13" height="9" fill="${accHex}" stroke="#141010" stroke-width="0.9"/>` +
        `<rect x="10.5" y="14.5" width="19" height="2" rx="1" fill="${accHex}"/>` +
        `<rect x="13.5" y="13" width="13" height="1.8" fill="#141010"/>`,
    );
  } else if (gear.has("bowler")) {
    parts.push(
      `<path d="M13 15 C13 8.5, 27 8.5, 27 15 Z" fill="#1c1a18" stroke="${accHex}" stroke-width="0.9"/>` +
        `<rect x="10.5" y="14.5" width="19" height="2" rx="1" fill="#1c1a18"/>`,
    );
  } else if (gear.has("flatcap")) {
    parts.push(`<path d="M12 15 C12 10.5, 26 10, 29 14.5 L31 15.5 L12 16 Z" fill="#524232" stroke="${accHex}" stroke-width="0.9"/>`);
  } else if (gear.has("nursecap")) {
    parts.push(
      `<polygon points="13,15 15,8.5 25,8.5 27,15" fill="#f2efe8" stroke="#221a16" stroke-width="0.8"/>` +
        `<path d="M20 10 L20 14 M18 12 L22 12" stroke="#b81d18" stroke-width="1.4"/>`,
    );
  } else if (gear.has("topknot")) {
    parts.push(`<circle cx="20" cy="10.5" r="3.2" fill="#181412" stroke="${accHex}" stroke-width="0.9"/>`);
  }
  return `<svg class="cameo-svg" viewBox="0 0 40 40" aria-hidden="true">${parts.join("")}</svg>`;
}

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
        <div class="grid">${STYLES.map((s, i) => {
          const ch = CHARACTERS[i];
          const craft = ch ? CRAFT_BY_ID[ch.limbs.craft]?.name ?? ch.limbs.craft : "";
          const bHex = hex(s.color);
          const aHex = hex(s.accent);
          return `<button class="sc" data-i="${i}" style="--body:${bHex};--acc:${aHex}"><div class="sw">${cameoSvg(ch, bHex, aHex)}</div>
            <div class="sn">${s.name}</div><div class="ss">${s.style}${craft ? ` · ${craft}` : ""}</div><div class="cur"></div></button>`;
        }).join("")}</div>
        <div class="info"></div>
        <div class="slots"></div>
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

  private describe(style: number): void {
    const st = STYLES[style];
    const ch = CHARACTERS[style];
    const craft = ch ? CRAFT_BY_ID[ch.limbs.craft]?.name ?? ch.limbs.craft : "";
    const title = ch?.title ? ` · <span class="info-title">${ch.title}</span>` : "";
    const pips = (n: number) =>
      Array.from({ length: 5 }, (_, k) => `<i class="pip${k < n ? " on" : ""}"></i>`).join("");
    const meta = ch
      ? `<div class="info-meta">` +
        `<span class="meta-chip"><b>Craft:</b> ${craft} (${ch.limbs.tip})</span>` +
        `<span class="meta-chip"><b>Special:</b> ${ch.specialName}</span>` +
        `<span class="meta-chip"><b>Air Grab:</b> ${ch.airGrab.name}</span>` +
        `<span class="meta-chip"><b>Tincture:</b> ${ch.moves.status.name}</span>` +
        `</div>` +
        `<div class="info-ratings">` +
        `<span class="rate">PWR ${pips(ch.ratings.power)}</span>` +
        `<span class="rate">SPD ${pips(ch.ratings.speed)}</span>` +
        `<span class="rate">RCH ${pips(ch.ratings.reach)}</span>` +
        `<span class="rate">GRP ${pips(ch.ratings.grapple)}</span>` +
        `<span class="rate">TEC ${pips(ch.ratings.technique)}</span>` +
        `</div>`
      : "";
    this.el.querySelector(".info")!.innerHTML =
      `<div class="info-head"><b>${st.name}</b> — ${st.style}${craft ? ` (${craft})` : ""}${title}</div>` +
      `<div class="info-blurb"><i>${st.blurb}</i></div>${meta}`;
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
        .map(({ s, p }) => `<span style="background:${hex(PLAYER_COLORS[p])}">${s.ready ? "✔" : ""}P${p + 1}</span>`)
        .join("");
      c.classList.toggle("on", here.length > 0);
    });
    const focus = this.slots[this.slots.length - 1];
    this.describe(focus ? focus.style : 0);
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
