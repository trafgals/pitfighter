// The move list: what each fighter's own body throws. The frame data is
// generated from the limbs they wear (sim/limbs.ts), so it is read off the sim
// (World.eff) rather than written down: tear an arm off, put someone else's
// on, and the list changes with it. Reading it never changes the world.
import type { AirGrabEnd } from "./sim/airgrabs";
import type { LimbTrait } from "./sim/limbs";
import { FLOW, MOVES, STRING_STARTS } from "./sim/moves";
import { CHARACTERS } from "./data/characters";
import { STYLES } from "./sim/styles";
import { LIMBS, type Fighter, type PartId } from "./sim/types";
import { World } from "./sim/world";

export interface MoveRow {
  id: string;
  name: string;
  input: string;
  limb: PartId | null; // what throws it (null: the body's own move)
  startup: number; // frames to the first active frame
  active: number;
  recovery: number;
  total: number;
  dmg: number;
  reach: number; // metres
  note: string;
}

export interface LimbRow {
  part: PartId;
  attached: boolean;
  trait: LimbTrait;
}

export interface MoveSheet {
  id: number;
  name: string;
  style: string;
  limbs: LimbRow[];
  punches: MoveRow[]; // the punch string, opener to launcher
  kicks: MoveRow[]; // the kick string, opener to sweep
  extras: MoveRow[]; // the dash strike and the special
  airGrab: { name: string; dmg: number; end: string };
  flow: string;
}

const NAMES: Record<string, string> = { jab1: "Jab", jab2: "Jab", jab3: "Jab", punchFin: "Launcher", kick1: "Kick", kick2: "Kick", sweep: "Sweep", dashStrike: "Dash strike", headbutt: "Headbutt" };
const ENDS: Record<AirGrabEnd, string> = {
  down: "slams them down",
  bounce: "bounces them back up into a fresh juggle",
  throw: "flings them on across the pit",
  limb: "slams them down and rips at an arm",
};
export const LIMB_NAMES: Record<PartId, string> = { head: "Head", torso: "Torso", armL: "Left arm", armR: "Right arm", legL: "Left leg", legR: "Right leg" };

/** A string from its opener: every move the next press carries it on to. */
function chain(w: World, f: Fighter, from: string): string[] {
  const out: string[] = [];
  for (let id: string | undefined = from; id && out.length < 8; id = w.nextOf(f, id)) out.push(id);
  return out;
}

function row(w: World, f: Fighter, id: string, input: string): MoveRow {
  const e = w.eff(f, id);
  const m = MOVES[id];
  const note = m.launch ? "launches into a juggle" : m.knockdown ? "knocks down" : m.rehit ? `hits every ${m.rehit} frames` : "";
  return {
    id,
    name: m.kind === "special" ? STYLES[f.style].specialName : NAMES[id] ?? id,
    input,
    limb: w.strikerOf(f, id),
    startup: e.startup,
    active: e.active,
    recovery: e.recovery,
    total: e.total,
    dmg: Math.round(e.dmg * 10) / 10,
    reach: Math.round(e.reach * 100) / 100,
    note,
  };
}

export function moveSheet(w: World, f: Fighter): MoveSheet {
  const st = STYLES[f.style];
  const grab = World.airGrab(f);
  return {
    id: f.id,
    name: st.name,
    style: st.style,
    limbs: LIMBS.map((part) => ({ part, attached: f.parts[part].attached, trait: f.parts[part].trait })),
    punches: chain(w, f, STRING_STARTS.high).map((id) => row(w, f, id, "○")),
    kicks: chain(w, f, STRING_STARTS.low).map((id) => row(w, f, id, "back ○")),
    extras: [row(w, f, "dashStrike", "✕ then ○"), row(w, f, st.special, "○ + △")],
    airGrab: { name: grab.name, dmg: grab.dmg, end: ENDS[grab.end] },
    flow: `Mid-string, a landed punch flows into the kicks (back ○) and a landed kick into the punches (○), ${FLOW.max} times a combo. Hold R1 + ↑/•/↓ + ○ to aim at Head, Torso, or Legs. △ on a downed or wall-splatted foe triggers ${CHARACTERS[f.style]?.moves.ground.name ?? "Ground Grapple"} / ${CHARACTERS[f.style]?.moves.wall.name ?? "Wall Grapple"}; L2 after a big blow appeals for ${CHARACTERS[f.style]?.moves.appeal.gift ?? "a Gallery Gift"}.`,
  };
}
