// Character select: any device joins with its high-strike button, moves a
// cursor over the 21 styles, confirms with high strike, backs out with grab.
// Empty slots are filled with CPU fighters up to the chosen fighter count.
import { BTN } from "./sim/types";
import { STYLES } from "./sim/styles";
import { CONTROLS_HELP, type DeviceId, type DeviceRead, type Input } from "./input";
import { PLAYER_COLORS } from "./render/scene";
import { DEFAULT_STAGE, PLAYABLE_STAGES, STAGES, stageById, type StageId } from "./sim/stages";

const COLS = 7;
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
}

export class Select {
  slots: Slot[] = [];
  fighters = 8;
  stage: StageId = DEFAULT_STAGE;
  private prev = new Map<DeviceId, DeviceRead>();
  private el: HTMLElement;

  constructor(
    root: HTMLElement,
    private input: Input,
    private onStart: (r: SelectResult) => void,
  ) {
    this.el = root;
    root.innerHTML = `
      <h1>PITFIGHTER</h1>
      <p class="sub">Up to eight fighters, one pit. Pick a fighter and a stage.</p>
      <div class="stages">${STAGES.map(
        (st) => `<div class="stage${st.playable ? "" : " soon"}" data-stage="${st.id}"><b>${st.name}</b>${st.playable ? "" : " <small>coming soon</small>"}<br><small>${st.blurb}</small></div>`,
      ).join("")}</div>
      <div class="grid">${STYLES.map(
        (s, i) => `<div class="sc" data-i="${i}"><div class="sw" style="background:${hex(s.color)};border-color:${hex(s.accent)}"></div>
          <div class="sn">${s.name}</div><div class="ss">${s.style}</div><div class="cur"></div></div>`,
      ).join("")}</div>
      <div class="info"></div>
      <div class="slots"></div>
      <div class="count"></div>
      <div class="help">${CONTROLS_HELP.map((l) => `<div>${l}</div>`).join("")}
        <div>Join: J / Num4 / □ · Move: stick · Confirm: J / □ · Back: L / ○ · Fighters: - / + (L1 / R1) · Stage: [ / ] · Start: Enter / Start</div></div>`;
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
      const was = this.prev.get(dev) ?? now;
      this.prev.set(dev, now);
      const edge = (k: keyof DeviceRead) => !!now[k] && !was[k];
      const bedge = (b: number) => (now.buttons & b) !== 0 && (was.buttons & b) === 0;
      const slot = this.slots.find((s) => s.device === dev);
      if (edge("start")) start = true;
      if (!slot) {
        if (bedge(BTN.HIGH) && this.slots.length < 8) {
          this.slots.push({ device: dev, style: (this.slots.length * 3) % STYLES.length, ready: false });
          this.fighters = Math.max(this.fighters, this.slots.length);
          changed = true;
        }
        continue;
      }
      if (bedge(BTN.TARGET)) this.setCount(this.fighters - 1);
      if (bedge(BTN.GUARD)) this.setCount(this.fighters + 1);
      if (!slot.ready) {
        const n = STYLES.length;
        if (edge("left")) slot.style = (slot.style + n - 1) % n;
        if (edge("right")) slot.style = (slot.style + 1) % n;
        if (edge("up")) slot.style = (slot.style + n - COLS) % n;
        if (edge("down")) slot.style = (slot.style + COLS) % n;
        if (bedge(BTN.HIGH)) slot.ready = true;
        else if (bedge(BTN.GRAB)) this.slots = this.slots.filter((s) => s !== slot);
      } else if (bedge(BTN.GRAB)) slot.ready = false;
      changed = true;
    }
    if (changed) this.render();
    if (start && this.slots.every((s) => s.ready)) this.start();
  }

  setCount(n: number): void {
    this.fighters = Math.max(Math.max(2, this.slots.length), Math.min(8, n));
    this.render();
  }

  /** Step through the playable stages; planned stages cannot be picked. */
  cycleStage(dir: number): void {
    const n = PLAYABLE_STAGES.length;
    const i = PLAYABLE_STAGES.findIndex((s) => s.id === this.stage);
    this.stage = PLAYABLE_STAGES[(i + dir + n) % n].id;
    this.render();
  }

  setStage(id: StageId): void {
    if (!stageById(id).playable) throw new Error(`stage ${id} is not playable yet`);
    this.stage = id;
    this.render();
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
    this.onStart({ styles, humans, devices, stage: this.stage });
  }

  private render(): void {
    const el = this.el;
    el.querySelectorAll<HTMLElement>(".stage").forEach((c) => c.classList.toggle("on", c.dataset.stage === this.stage));
    el.querySelectorAll<HTMLElement>(".sc").forEach((c) => {
      const i = Number(c.dataset.i);
      const here = this.slots.map((s, p) => ({ s, p })).filter(({ s }) => s.style === i);
      c.querySelector(".cur")!.innerHTML = here
        .map(({ s, p }) => `<span style="background:${hex(PLAYER_COLORS[p])}">${s.ready ? "✔" : ""}P${p + 1}</span>`)
        .join("");
      c.classList.toggle("on", here.length > 0);
    });
    const focus = this.slots[this.slots.length - 1];
    const st = STYLES[focus ? focus.style : 0];
    el.querySelector(".info")!.innerHTML = `<b>${st.name}</b> - ${st.style}<br><i>${st.blurb}</i>`;
    el.querySelector(".slots")!.innerHTML = Array.from({ length: 8 }, (_, p) => {
      const s = this.slots[p];
      const c = hex(PLAYER_COLORS[p]);
      if (s) return `<div class="slot" style="border-color:${c}"><b style="color:${c}">P${p + 1}</b> ${STYLES[s.style].name}<br><small>${s.device} · ${s.ready ? "READY" : "choosing"}</small></div>`;
      if (p < this.fighters) return `<div class="slot cpu" style="border-color:${c}"><b style="color:${c}">P${p + 1}</b> CPU<br><small>press □ / J to join</small></div>`;
      return `<div class="slot off"><b>P${p + 1}</b> -</div>`;
    }).join("");
    el.querySelector(".count")!.textContent = `${this.fighters} fighters · press Enter / Start when everyone is ready`;
  }
}
