// DOM HUD: one card per fighter with a body silhouette (each part coloured by
// its health, greyed out when it is lying on the floor), the stage's score
// (throne time, KOs, banner) per fighter, the stage's headline (who holds the
// objective) and a banner for big moments.
import { PARTS, type Fighter, type PartId } from "../sim/types";
import { FURY, VIOLENCE } from "../sim/moves";
import { STYLES } from "../sim/styles";
import { VEHICLES } from "../sim/arena";
import { PROP_BY_ID } from "../data/props";
import { World } from "../sim/world";
import { PLAYER_COLORS } from "./scene";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

function hpColor(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const r = f > 0.5 ? Math.round(255 * (1 - f) * 2) : 255;
  const g = f > 0.5 ? 220 : Math.round(220 * f * 2);
  return `rgb(${r},${g},40)`;
}

export class Hud {
  private cards: { el: HTMLElement; parts: Record<PartId, HTMLElement>; bar: HTMLElement; fury: HTMLElement; violence: HTMLElement; vbar: HTMLElement; kos: HTMLElement; state: HTMLElement }[] = [];
  private banner: HTMLElement;
  private bannerT = 0;
  private count: HTMLElement;
  private throne: HTMLElement;
  private throneFill: HTMLElement;
  private throneName: HTMLElement;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div class="throne"><div class="throne-name"></div><div class="throne-bar"><div class="throne-fill"></div></div></div>
      <div class="banner"></div>
      <div class="countdown"></div>
      <div class="cards"></div>`;
    this.banner = root.querySelector(".banner")!;
    this.count = root.querySelector(".countdown")!;
    this.throne = root.querySelector(".throne")!;
    this.throneFill = root.querySelector(".throne-fill")!;
    this.throneName = root.querySelector(".throne-name")!;
  }

  attach(world: World): void {
    this.root.dataset.stage = world.s.stage;
    const wrap = this.root.querySelector(".cards")!;
    wrap.innerHTML = "";
    this.cards = world.fighters.map((f) => {
      const st = STYLES[f.style];
      const el = document.createElement("div");
      el.className = "card";
      el.style.borderColor = hex(PLAYER_COLORS[f.id]);
      el.innerHTML = `
        <div class="card-top"><b style="color:${hex(PLAYER_COLORS[f.id])}">P${f.id + 1}</b> <span class="nm">${st.name}</span></div>
        <div class="card-mid">
          <div class="body">
            <i class="p head"></i><i class="p armL"></i><i class="p torso"></i><i class="p armR"></i><i class="p legL"></i><i class="p legR"></i>
          </div>
          <div class="side"><div class="sty">${st.style}</div><div class="kos"></div><div class="state"></div></div>
        </div>
        <div class="tbar"><div class="tfill"></div></div>
        <div class="vbar" title="violence: full, and a taunt appeals to the Gallery"><div class="vfill"></div><span class="vtag">VIOLENCE</span></div>
        <div class="fbar" title="fury"><div class="ffill"></div></div>`;
      wrap.appendChild(el);
      const parts = {} as Record<PartId, HTMLElement>;
      for (const p of PARTS) parts[p] = el.querySelector(`.${p}`)!;
      return { el, parts, bar: el.querySelector(".tfill")!, fury: el.querySelector(".ffill")!, violence: el.querySelector(".vfill")!, vbar: el.querySelector(".vbar")!, kos: el.querySelector(".kos")!, state: el.querySelector(".state")! };
    });
  }

  /** The countdown's big call in the middle of the screen ("3", "2", "1", "START!"), or nothing. */
  countdown(text: string | null): void {
    if (text === null) {
      this.count.classList.remove("show");
      return;
    }
    if (this.count.textContent === text && this.count.classList.contains("show")) return;
    this.count.textContent = text;
    this.count.classList.toggle("go", !/^\d$/.test(text));
    // restart the pop for each number
    this.count.classList.remove("show");
    void this.count.offsetWidth;
    this.count.classList.add("show");
  }

  /** The height (px) of the fighter cards along the bottom: what the camera must keep the fight above. */
  get inset(): number {
    const c = this.root.querySelector(".cards")!.getBoundingClientRect();
    return c.height > 0 ? window.innerHeight - c.top : 0;
  }

  say(text: string, frames = 90): void {
    this.banner.textContent = text;
    this.banner.classList.add("show");
    this.bannerT = frames;
  }

  update(world: World): void {
    const s = world.s;
    s.fighters.forEach((f, i) => this.updateCard(world, f, this.cards[i]));
    const h = world.arena.headline(world);
    if (h) {
      this.throne.classList.add("show");
      this.throneName.textContent = h.text;
      this.throneFill.style.width = `${100 * Math.max(0, Math.min(1, h.frac))}%`;
      this.throneFill.style.background = h.who >= 0 ? hex(PLAYER_COLORS[h.who]) : "#c8a040";
    } else this.throne.classList.remove("show");

    for (const e of s.events) {
      const nm = (id: number) => `P${id + 1}`;
      if (e.kind === "ko") this.say(koLine(s.stage, e.what, e.a, e.b), 70);
      else if (e.kind === "strip") this.say(e.b !== undefined && e.b >= 0 && e.b !== e.a ? `${nm(e.b)} TORE ${nm(e.a)} APART` : `${nm(e.a)} IS IN PIECES`, 70);
      else if (e.kind === "fall") this.say(e.b !== undefined && e.b >= 0 ? `${nm(e.b)} SENT ${nm(e.a)} OVER THE EDGE` : `${nm(e.a)} WENT OVER THE EDGE`, 70);
      else if (e.kind === "wreck") this.say(e.b !== undefined && e.b >= 0 ? `${nm(e.b)} WRECKED THE ${(VEHICLES[e.what as keyof typeof VEHICLES]?.name ?? "MACHINE").toUpperCase()}` : "WRECKED!", 60);
      else if (e.kind === "collapse") this.say("THE ROOF IS GIVING WAY!", 40);
      else if (e.kind === "wind" && e.what === "warn") this.say("GUST INCOMING!", 45);
      else if (e.kind === "impact") this.say("THE BLIMP HITS THE GROUND!", 110);
      else if (e.kind === "capture") this.say(`${nm(e.a)} TAKES THE FLAGPOLE`, 45);
      else if (e.kind === "reversal") this.say(e.what ? `${nm(e.a)} ${e.what.toUpperCase()}!` : `${nm(e.a)} REVERSAL!`, 45);
      else if (e.kind === "counter") this.say(`${nm(e.a)} COUNTER!`, 40);
      else if (e.kind === "wallsplat") this.say(`${nm(e.a)} WALL SPLAT!`, 45);
      else if (e.kind === "appeal") this.say(`THE GALLERY ANSWERS ${nm(e.a)} — ${(e.what ?? "A GIFT").toUpperCase()}!`, 110);
      else if (e.kind === "break") this.say(`${nm(e.a)}'S ${(PROP_BY_ID[e.what ?? ""]?.name ?? "WEAPON").toUpperCase()} BREAKS`, 45);
      else if (e.kind === "throw" && e.what) this.say(`${nm(e.a)} ${e.what.toUpperCase()}!`, 45);
      else if (e.kind === "grab" && e.what) this.say(`${nm(e.a)} ${e.what.toUpperCase()}!`, 45);
      else if (e.kind === "detach" && e.part) this.say(`${nm(e.a)} LOST ${e.part.startsWith("arm") ? "AN ARM" : "A LEG"}!`, 50);
      else if (e.kind === "crowd") this.say(`${nm(e.a)} ESCAPES THE DOGPILE`, 50);
      else if (e.kind === "airgrab") this.say(`${nm(e.a)} ${e.what}!`, 55);
      else if (e.kind === "special") this.say(`${nm(e.a)} ${World.specialName(s.fighters[e.a])}!`, 50);
      else if (e.kind === "win") this.say(winLine(s.stage, e.a), 100000);
    }
    if (this.bannerT > 0 && --this.bannerT === 0) this.banner.classList.remove("show");
  }

  private updateCard(world: World, f: Fighter, c: (typeof this.cards)[number]): void {
    for (const p of PARTS) {
      const part = f.parts[p];
      const el = c.parts[p];
      if (!part.attached) {
        el.style.background = part.regrow > 0 ? "#552200" : "#333";
        el.classList.add("gone");
      } else {
        el.style.background = hpColor(part.hp / part.max);
        el.classList.remove("gone");
      }
    }
    const prog = world.arena.progress(f);
    c.bar.parentElement!.style.display = prog === null ? "none" : "";
    if (prog !== null) c.bar.style.width = `${100 * Math.min(1, prog)}%`;
    c.fury.style.width = `${(100 * f.fury) / FURY.max}%`;
    c.fury.classList.toggle("ready", f.fury >= FURY.cost);
    c.violence.style.width = `${(100 * f.violence) / VIOLENCE.max}%`;
    c.vbar.classList.toggle("full", f.violence >= VIOLENCE.max);
    c.kos.textContent = `☠ ${f.kos}`;
    c.state.textContent = cardState(world, f);
    c.el.classList.toggle("dead", f.state === "ko" || f.out);
  }
}

const P = (id: number) => `P${id + 1}`;

function koLine(stage: string, what: string | undefined, a: number, b: number | undefined): string {
  if (what === "fall") return `${P(a)} FELL TO THEIR DOOM`;
  if (b !== undefined && b >= 0) return `${P(b)} TORE ${P(a)} APART`;
  if (stage === "hell-toilet") return `${P(a)} WAS CONSUMED BY HELL`;
  if (stage === "hindenburg-blimp") return `${P(a)} WENT UP IN FLAMES`;
  return `${P(a)} IS DOWN FOR GOOD`;
}

export function winLine(stage: string, a: number): string {
  switch (stage) {
    case "construction-site":
      return `${P(a)} OWNS THE YARD`;
    case "collapsing-tower":
      return `${P(a)} IS THE LAST ONE ON THE ROOF`;
    case "hindenburg-blimp":
      return `${P(a)} SURVIVES THE CRASH`;
    case "castle-under-siege":
      return `${P(a)} HOLDS THE CASTLE`;
    default:
      return `${P(a)} FINALLY GETS TO GO`;
  }
}

function cardState(w: World, f: Fighter): string {
  if (f.out) return "OUT";
  if (f.state === "falling") return "FALLING";
  if (f.state === "ko") return "DEAD";
  if (f.state === "seated") return "ON THE THRONE";
  if (f.state === "driving") return VEHICLES[w.s.arena.vehicles[f.vehicle]?.kind ?? "bulldozer"].name.toUpperCase();
  if (f.state === "dizzy") return "DIZZY";
  if (w.s.stage === "castle-under-siege" && w.s.toiletOccupant === f.id) return "AT THE POLE";
  return "";
}
