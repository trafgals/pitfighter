// DOM HUD: one card per fighter with a body silhouette (each part coloured by
// its health, greyed out when it is lying on the floor), throne progress, and
// a banner for big moments.
import { PARTS, TOILET_FRAMES, type Fighter, type PartId } from "../sim/types";
import { STYLES } from "../sim/styles";
import type { World } from "../sim/world";
import { PLAYER_COLORS } from "./scene";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

function hpColor(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const r = f > 0.5 ? Math.round(255 * (1 - f) * 2) : 255;
  const g = f > 0.5 ? 220 : Math.round(220 * f * 2);
  return `rgb(${r},${g},40)`;
}

export class Hud {
  private cards: { el: HTMLElement; parts: Record<PartId, HTMLElement>; bar: HTMLElement; kos: HTMLElement; state: HTMLElement }[] = [];
  private banner: HTMLElement;
  private bannerT = 0;
  private throne: HTMLElement;
  private throneFill: HTMLElement;
  private throneName: HTMLElement;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div class="throne"><div class="throne-name"></div><div class="throne-bar"><div class="throne-fill"></div></div></div>
      <div class="banner"></div>
      <div class="cards"></div>`;
    this.banner = root.querySelector(".banner")!;
    this.throne = root.querySelector(".throne")!;
    this.throneFill = root.querySelector(".throne-fill")!;
    this.throneName = root.querySelector(".throne-name")!;
  }

  attach(world: World): void {
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
        <div class="tbar"><div class="tfill"></div></div>`;
      wrap.appendChild(el);
      const parts = {} as Record<PartId, HTMLElement>;
      for (const p of PARTS) parts[p] = el.querySelector(`.${p}`)!;
      return { el, parts, bar: el.querySelector(".tfill")!, kos: el.querySelector(".kos")!, state: el.querySelector(".state")! };
    });
  }

  say(text: string, frames = 90): void {
    this.banner.textContent = text;
    this.banner.classList.add("show");
    this.bannerT = frames;
  }

  update(world: World): void {
    const s = world.s;
    s.fighters.forEach((f, i) => this.updateCard(f, this.cards[i]));
    const occ = s.fighters[s.toiletOccupant];
    if (occ) {
      this.throne.classList.add("show");
      this.throneName.textContent = `P${occ.id + 1} ${STYLES[occ.style].name} is on the throne!`;
      this.throneFill.style.width = `${(100 * occ.toilet) / TOILET_FRAMES}%`;
      this.throneFill.style.background = hex(PLAYER_COLORS[occ.id]);
    } else this.throne.classList.remove("show");

    for (const e of s.events) {
      const nm = (id: number) => `P${id + 1}`;
      if (e.kind === "ko") this.say(e.b !== undefined && e.b >= 0 ? `${nm(e.b)} TORE ${nm(e.a)} APART` : `${nm(e.a)} WAS CONSUMED BY HELL`);
      else if (e.kind === "reversal") this.say(`${nm(e.a)} REVERSAL!`, 45);
      else if (e.kind === "detach" && e.part) this.say(`${nm(e.a)} LOST ${e.part.startsWith("arm") ? "AN ARM" : "A LEG"}!`, 50);
      else if (e.kind === "crowd") this.say(`${nm(e.a)} ESCAPES THE DOGPILE`, 50);
      else if (e.kind === "win") this.say(`${nm(e.a)} FINALLY GETS TO GO`, 100000);
    }
    if (this.bannerT > 0 && --this.bannerT === 0) this.banner.classList.remove("show");
  }

  private updateCard(f: Fighter, c: (typeof this.cards)[number]): void {
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
    c.bar.style.width = `${(100 * f.toilet) / TOILET_FRAMES}%`;
    c.kos.textContent = `☠ ${f.kos}`;
    c.state.textContent = f.state === "ko" ? "DEAD" : f.state === "seated" ? "ON THE THRONE" : f.state === "dizzy" ? "DIZZY" : "";
    c.el.classList.toggle("dead", f.state === "ko");
  }
}
