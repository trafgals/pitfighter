// The move list overlay (Tab / Num. / a pad's Select): a card per human
// fighter (every fighter when nobody is human) with their limbs' rolls, the
// frame data those limbs give their strings, the special and the air grab.
// main.ts holds the fight while it is open.
import { LIMB_NAMES, moveSheet, type MoveRow } from "../movelist";
import { World } from "../sim/world";
import { PLAYER_COLORS } from "./scene";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
const short = (p: string | null) => (p ? LIMB_NAMES[p as keyof typeof LIMB_NAMES].toLowerCase() : "body");

function rows(title: string, rs: MoveRow[]): string {
  return `<tr class="sec"><th colspan="7">${title}</th></tr>${rs
    .map((r) => `<tr><td>${r.name}</td><td class="in">${r.input}</td><td>${short(r.limb)}</td><td>${r.startup}</td><td>${r.total}</td><td>${r.dmg}</td><td>${r.reach} m</td></tr>${r.note ? `<tr class="note"><td colspan="7">${r.note}</td></tr>` : ""}`)
    .join("")}`;
}

export class MoveList {
  open = false;

  constructor(private el: HTMLElement) {}

  show(world: World): void {
    const who = world.fighters.some((f) => f.human) ? world.fighters.filter((f) => f.human) : world.fighters;
    this.el.innerHTML = `<h2>MOVE LIST</h2><p class="small">Your limbs set your frame data: tear one off, wear another, and it changes. Tab / Num. / Select to fight on.</p>
      <div class="sheets">${who
        .map((f) => {
          const s = moveSheet(world, f);
          const c = hex(PLAYER_COLORS[f.id]);
          const limbs = s.limbs
            .map((l) => `<li${l.attached ? "" : ' class="gone"'}><b>${LIMB_NAMES[l.part]}</b> ${l.attached ? `${l.trait.tip} · mass ${l.trait.mass.toFixed(2)} · length ${l.trait.length.toFixed(2)} · swing ${l.trait.swing.toFixed(2)}` : "gone"}</li>`)
            .join("");
          return `<section class="sheet" style="border-color:${c}">
            <h3><span style="color:${c}">P${f.id + 1}</span> ${s.name} <small>${s.style}</small></h3>
            <ul class="limbs">${limbs}</ul>
            <table><tr><th>Move</th><th>Input</th><th>Limb</th><th>Startup</th><th>Total</th><th>Dmg</th><th>Reach</th></tr>
              ${rows("Punch string", s.punches)}${rows("Kick string", s.kicks)}${rows("Specials", s.extras)}</table>
            <p class="airgrab"><b>Air grab: ${s.airGrab.name}</b> (△ on a juggled foe): ${s.airGrab.end}.</p>
            <p class="flow">${s.flow}</p>
          </section>`;
        })
        .join("")}</div>`;
    this.el.classList.add("show");
    this.open = true;
  }

  hide(): void {
    this.el.classList.remove("show");
    this.open = false;
  }
}
