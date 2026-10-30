// The feel lab's panel (?lab=1): a slider per dial, two presets to compare,
// and the take controls. ` shows and hides it; 1 records or stops a take,
// 2 replays it on the dials as they are, 3 and 4 replay it on preset A or B.
// The dials and both presets are kept in this browser between visits.
import { DEFAULTS, TUNABLES, apply, changed, snapshot, type Preset, type Tunable } from "./tunables";

const STORE = "pitfighter.lab";

export interface LabActions {
  record(): void;
  stop(): void;
  replay(): void;
  spar(on: boolean): void;
}

interface Saved {
  now?: Preset;
  A?: Preset | null;
  B?: Preset | null;
  spar?: boolean;
}

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

const decimals = (step: number) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));

export class LabPanel {
  readonly el: HTMLElement;
  A: Preset | null = null;
  B: Preset | null = null;
  spar = false;
  recording = false;
  private rows = new Map<string, { t: Tunable; input: HTMLInputElement; out: HTMLElement; row: HTMLElement }>();
  private statusEl: HTMLElement;
  private recBtn: HTMLButtonElement;
  private abEl: HTMLElement;
  private lastStatus = "";

  constructor(private readonly act: LabActions) {
    const saved = load();
    if (saved.now) apply(saved.now);
    this.A = saved.A ?? null;
    this.B = saved.B ?? null;
    this.spar = saved.spar ?? false;

    const el = (this.el = document.createElement("aside"));
    el.id = "lab";
    el.innerHTML = `
      <header><b>FEEL LAB</b> <span class="keys">\` hide · 1 rec · 2 replay · 3 A · 4 B</span></header>
      <div class="take">
        <button data-a="rec">● REC</button><button data-a="replay">▶ REPLAY</button>
        <label><input type="checkbox" data-a="spar"> dummies fight</label>
      </div>
      <div class="ab">
        <button data-a="saveA">save A</button><button data-a="playA">▶ A</button>
        <button data-a="saveB">save B</button><button data-a="playB">▶ B</button>
      </div>
      <div class="abinfo"></div>
      <div class="status"></div>
      <div class="tools"><button data-a="copy">copy changes</button><button data-a="reset">reset all</button></div>
      <div class="dials"></div>`;
    this.statusEl = el.querySelector(".status")!;
    this.recBtn = el.querySelector('[data-a="rec"]')!;
    this.abEl = el.querySelector(".abinfo")!;
    const sparBox = el.querySelector<HTMLInputElement>('[data-a="spar"]')!;
    sparBox.checked = this.spar;
    sparBox.addEventListener("change", () => {
      this.spar = sparBox.checked;
      sparBox.blur();
      this.save();
      this.act.spar(this.spar);
    });
    el.querySelectorAll<HTMLButtonElement>("button[data-a]").forEach((b) =>
      b.addEventListener("click", () => {
        b.blur(); // a focused button would eat the fighter's keys
        this.command(b.dataset.a!);
      }),
    );

    const dials = el.querySelector(".dials")!;
    let current: HTMLElement | null = null;
    let groupName = "";
    for (const t of TUNABLES) {
      if (t.group !== groupName) {
        groupName = t.group;
        const d = document.createElement("details");
        d.open = t.id.startsWith("camera.");
        d.innerHTML = `<summary>${t.group}${t.layer === "render" ? "" : " <i>sim</i>"}</summary>`;
        dials.append(d);
        current = d;
      }
      const row = document.createElement("label");
      row.className = "dial";
      row.title = `${t.id} (default ${DEFAULTS[t.id]}); double-click to reset`;
      row.innerHTML = `<span class="name">${t.label}</span><input type="range" min="${t.min}" max="${t.max}" step="${t.step}"><output></output>`;
      const input = row.querySelector("input")!;
      const out = row.querySelector("output")!;
      input.addEventListener("input", () => {
        t.obj[t.key] = Number(input.value);
        this.paint(t.id);
        this.save();
      });
      input.addEventListener("change", () => input.blur());
      row.addEventListener("dblclick", () => {
        t.obj[t.key] = DEFAULTS[t.id];
        this.sync();
        this.save();
      });
      current!.append(row);
      this.rows.set(t.id, { t, input, out, row });
    }
    document.body.append(el);
    this.sync();

    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT" && (e.target as HTMLInputElement).type !== "range") return;
      // by the key's place, or by what it types where the browser gives no place
      const k = e.code || (e.key === "`" || e.key === "~" ? "Backquote" : /^[1-4]$/.test(e.key) ? `Digit${e.key}` : "");
      if (k === "Backquote") el.classList.toggle("hidden");
      else if (k === "Digit1") this.command("rec");
      else if (k === "Digit2") this.command("replay");
      else if (k === "Digit3") this.command("playA");
      else if (k === "Digit4") this.command("playB");
      else return;
      e.preventDefault();
    });
  }

  private command(a: string): void {
    switch (a) {
      case "rec":
        if (this.recording) this.act.stop();
        else this.act.record();
        break;
      case "replay":
        this.act.replay();
        break;
      case "saveA":
      case "saveB":
        this[a === "saveA" ? "A" : "B"] = snapshot();
        this.save();
        this.sync();
        break;
      case "playA":
      case "playB": {
        const p = a === "playA" ? this.A : this.B;
        if (!p) {
          this.status(`no preset ${a.slice(-1)} saved yet`);
          return;
        }
        apply(p);
        this.sync();
        this.save();
        this.act.replay();
        break;
      }
      case "reset":
        apply(DEFAULTS);
        this.sync();
        this.save();
        break;
      case "copy": {
        const text = JSON.stringify({ now: changed(), A: this.A && changed(this.A), B: this.B && changed(this.B) }, null, 1);
        navigator.clipboard?.writeText(text).then(
          () => this.status("copied the changed dials"),
          () => this.status("couldn't copy: the browser said no"),
        );
        console.info("feel lab:", text);
        break;
      }
    }
  }

  setRecording(on: boolean): void {
    this.recording = on;
    this.recBtn.textContent = on ? "■ STOP" : "● REC";
    this.recBtn.classList.toggle("on", on);
  }

  /** One line on what the lab is doing; only touches the page when it changes. */
  status(text: string): void {
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this.statusEl.textContent = text;
  }

  /** Put every slider back on its dial's value. */
  sync(): void {
    for (const id of this.rows.keys()) this.paint(id);
    const now = snapshot();
    const same = (p: Preset | null) => !!p && TUNABLES.every((t) => p[t.id] === undefined || p[t.id] === now[t.id]);
    const tag = (n: string, p: Preset | null) => (p ? `${n}: ${Object.keys(changed(p)).length} changed${same(p) ? " (on)" : ""}` : `${n}: empty`);
    this.abEl.textContent = `${tag("A", this.A)} · ${tag("B", this.B)}`;
  }

  private paint(id: string): void {
    const r = this.rows.get(id)!;
    const v = r.t.obj[r.t.key];
    r.input.value = String(v);
    r.out.textContent = v.toFixed(decimals(r.t.step));
    r.row.classList.toggle("changed", v !== DEFAULTS[id]);
  }

  private save(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify({ now: changed(), A: this.A, B: this.B, spar: this.spar } satisfies Saved));
    } catch {
      /* not kept */
    }
  }
}
