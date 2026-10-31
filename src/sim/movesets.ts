// Per-fighter movesets: every strike a fighter throws, built at load time from
// the moveset designed for it in src/data/characters.json (`moves.high`, `low`,
// `branches`, `regional`, `dash`, `arts`) and the family it fights in.
//
// The sim still names a strike by a slot (jab1 .. punchFin, kick1 .. sweep,
// dashStrike, ...) because the animation, the cues and the AI know the slots;
// what changed is that a slot means a different move for every fighter. A
// move that comes out of here carries `own`: its frame data and damage are the
// fighter's own design, so the style multipliers are not laid on top again.
//
// Frames stay inside Urban Reign's envelope (`UR_STRIKE`, src/sim/limbs.ts),
// which limbs.ts keeps them in when a rolled limb shapes the move.
//
// The families' own mechanics live in `FAMILY` (the numbers) and in the
// functions marked "family" in world.ts (the behaviour); the flags a single
// move carries (`armor`, `cmdGrab`, `bleed`, ...) are here.
import { CHARACTERS } from "../data/characters";
import type { Character, Family, StrikeDesign } from "../data/types";
import { UR_STRIKE } from "./limbs";
import { MOVES, type Move } from "./moves";
import type { PartId } from "./types";

/** What a single move can do beyond its frame data. */
export interface Fx {
  /** the move is this fighter's own design: no style multipliers on top */
  own?: true;
  name?: string;
  input?: string;
  /** the limb that throws it (null: the body's or the head's own); undefined: the shared rule in limbs.ts */
  limb?: PartId | null;
  /** which string it belongs to (a landed move flows into the other string) */
  str?: "high" | "low";
  /** super armour: blows do not interrupt it while it is starting or active (power) */
  armor?: boolean;
  /** a command grab: where it hits it seizes the victim in a hold (power, grappler) */
  cmdGrab?: boolean;
  /** frames of bleeding put on the limb it hits (muay's elbows) */
  bleed?: number;
  /** frames the victim cannot see (dirt in the eyes) */
  blind?: number;
  /** extra torso damage and a long stagger (the low blow) */
  lowBlow?: number;
  /** the button can be held on its last startup frame to charge it (karate's finishers) */
  chargeable?: boolean;
  /** how high this move still reaches a body in the air (the kicker's air kicks) */
  airReach?: number;
}
export type Mv = Move & Fx;

/** One fighter's strikes by slot, the strings in order, and where each string branches. */
export interface Moveset {
  moves: Record<string, Mv>;
  high: string[];
  low: string[];
  /** from a slot: the strike that a back + press (`back`) or a grab press (`grab`) turns it into */
  branch: Record<string, { back?: string; grab?: string }>;
  /** branches, regional strikes, dash and arts, in the order the move list shows them */
  extras: string[];
  /** the stance switch: a second moveset (kung fu) */
  alt?: Moveset;
}

/** The numbers each family plays by. The behaviour is in world.ts. */
export interface FamilyRules {
  /** the one-line mechanic only this family has (the move list prints it) */
  mechanic: string;
  /** clinch knees: how many, frames between, damage multiplier */
  knees: { max: number; cool: number; dmg: number };
  /** holds the held cannot break out of */
  unbreakable?: boolean;
}
const BASE_KNEES = { max: 3, cool: 18, dmg: 1 };
export const FAMILY: Record<Family, FamilyRules> = {
  boxing: { mechanic: "No kicks. Evade (Square + a direction), then press Circle to weave out of it into a fast counter hook. The fastest, shortest strings.", knees: BASE_KNEES },
  power: { mechanic: "Heavy moves carry super armour. Command grabs come out of strikes. Holds cannot be broken. Slow.", knees: BASE_KNEES, unbreakable: true },
  grappler: { mechanic: "A deflect is a judo throw: the attacker is flung with the force of its own blow. Command grab out of the string.", knees: BASE_KNEES },
  kungfu: { mechanic: "L1 (with nothing to pick up) switches stance: Crane for long precise strings, Drunk for lurching heavy ones that sway clear of low strikes.", knees: BASE_KNEES },
  kicker: { mechanic: "Every string starts with a kick. Long reach, and kicks that still reach a body high in a juggle. Weak punches.", knees: BASE_KNEES },
  muay: { mechanic: "Clinch knees come out fast and often. Elbows open a cut that bleeds the limb over time.", knees: { max: 5, cool: 10, dmg: 1.35 } },
  karate: { mechanic: "Square parries in place instead of evading, and a parry staggers longer. Hold Circle on a finisher to charge it into one big hit.", knees: BASE_KNEES },
  brawler: { mechanic: "Dirty tricks: R1 + up throws dirt in the eyes (blind), R1 + down is a low blow. Eleanor fights with the reach of her rapier.", knees: BASE_KNEES },
};
export const familyRules = (f: Family): FamilyRules => FAMILY[f] ?? FAMILY.karate;

/** What a drink of a fighter's tincture does while it lasts (the numbers behind `moves.status`). */
export interface Tonic {
  punch?: number;
  kick?: number;
  grab?: number;
  grabReach?: number;
  speed?: number;
  startup?: number;
  reach?: number;
  /** every move has super armour */
  armor?: boolean;
  /** damage taken multiplier */
  taken?: number;
  /** fraction of the damage dealt that heals the torso */
  heal?: number;
  /** a hit sets the limb bleeding / burning for this many frames */
  bleed?: number;
  /** every strike gets a second hit */
  double?: boolean;
  /** this fighter's strikes cannot be deflected */
  noDeflect?: boolean;
  /** holds cannot be broken */
  unbreakable?: boolean;
  /** knockback multiplier */
  push?: number;
  /** clinch knees come out this many frames sooner */
  kneeCool?: number;
  /** a dash strike cannot be stopped */
  rush?: boolean;
}
const TONICS: Record<string, Tonic> = {
  "constable-winch": { startup: -3, speed: 1.15, double: true },
  "hezekiah-smelt": { punch: 1.15, armor: true, bleed: 60, taken: 0.7 },
  "nell-sluice": { punch: 1.2, speed: 1.1, rush: true },
  "matron-kilnworth": { punch: 1.1, kick: 1.1, bleed: 120 },
  "bartholomew-mule": { grab: 1.25, grabReach: 1.15, unbreakable: true },
  "bosun-rook": { armor: true, kneeCool: 6 },
  "lady-bulwark": { punch: 1.2, startup: -1, push: 2 },
  "percival-crump": { speed: 1.2, startup: -2, heal: 0.25 },
  "tabitha-pegg": { kick: 1.2, reach: 1.1, bleed: 120 },
  "martha-crape": { grab: 1.2, unbreakable: true },
  "lady-eleanor": { punch: 1.15, reach: 1.1, bleed: 120 },
  "tilly-tongs": { punch: 1.25, kick: 1.15, bleed: 120, noDeflect: true },
};
export const NO_TONIC: Tonic = {};
export const tonicOf = (style: number): Tonic => TONICS[CHARACTERS[style]?.id] ?? NO_TONIC;

// ------------------------------------------------------------------ building

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A design's limb: which part throws it and what sort of strike it is. */
function limbOf(l: string, slot: string): { limb: PartId | null; kind: Move["kind"] } {
  if (/leg/.test(l)) return { limb: slot === "kick2" ? "legL" : "legR", kind: "kick" };
  if (/rear/.test(l)) return { limb: "armL", kind: "punch" };
  if (/arm/.test(l)) return { limb: "armR", kind: "punch" };
  return { limb: null, kind: "head" };
}

/** Pull a move's frames inside Urban Reign's envelope. */
function envelope(m: Move): void {
  m.startup = clamp(m.startup, UR_STRIKE.startup[0], UR_STRIKE.startup[1]);
  const total = clamp(m.startup + m.active + m.recovery, Math.max(UR_STRIKE.total[0], m.startup + m.active + 8), UR_STRIKE.total[1]);
  m.recovery = total - m.startup - m.active;
}

interface Opts {
  str?: "high" | "low";
  fin?: boolean;
  /** make the move a punch from the arm (a boxer's body shot) or a kick from the leg (a kicker's lead) */
  as?: "punch" | "kick";
}

function conv(ch: Character, d: StrikeDesign, slot: string, o: Opts = {}): Mv {
  let { limb, kind } = limbOf(d.limb, slot);
  if (o.as === "punch" && kind === "kick") ({ limb, kind } = { limb: slot === "kick2" ? "armL" : "armR", kind: "punch" });
  if (o.as === "kick" && kind === "punch") ({ limb, kind } = { limb: slot === "jab2" ? "legL" : "legR", kind: "kick" });
  const kd = !!d.knockdown || !!d.launch;
  const height = d.height === "low" ? "low" : "high";
  const base = kind === "kick" ? 1.5 : kind === "punch" ? 1.3 : 1.0;
  const dmg = d.hits ? d.dmg / d.hits : d.dmg;
  const push = (kd ? (d.launch ? 1.4 : height === "low" ? 0.8 : 1.4) : o.fin ? 0.3 : 0.2) * clamp(Math.sqrt(dmg / 5), 0.8, 1.4);
  const m: Mv = {
    id: slot,
    startup: d.startup,
    active: d.active,
    recovery: d.recovery,
    dmg,
    hitstun: kd ? 0 : 41,
    blockstun: 24,
    height,
    reach: (base + (o.fin ? 0.1 : 0)) * ch.stats.reach,
    arc: kind === "kick" ? 0.5 : kind === "punch" ? 0.55 : 0.6,
    push,
    knockdown: kd,
    kind,
    own: true,
    name: d.name,
    input: d.input,
    limb,
    str: o.str,
  };
  if (d.launch) m.launch = true;
  if (d.hits && d.hits > 1) m.rehit = Math.max(2, Math.floor(d.active / d.hits));
  envelope(m);
  return m;
}

/** The slot a branch occupies from where its input says it leaves the string: "○ ○ ← ○" leaves the high string after two presses. */
function branchTrigger(input: string): { low: boolean; trigger: "back" | "grab" } {
  const low = input.trim().startsWith("←");
  const grab = input.trim().endsWith("△");
  return { low, trigger: grab ? "grab" : "back" };
}

const EXTRA_SLOTS = {
  regional: ["rgHead", "rgBody", "rgLegs"],
  arts: ["art1", "art2", null, "art3"], // R2 + up, right, (down is the special), left
} as const;

/** Mid-string rate of hitstun: long enough that the next strike of the string, and any branch from it, still lands as a combo. */
function settleStun(ms: Moveset): void {
  for (const m of Object.values(ms.moves)) {
    if (!m.next) continue;
    const follow = [m.next, ms.branch[m.id]?.back, ms.branch[m.id]?.grab].filter(Boolean).map((id) => ms.moves[id!].startup);
    m.hitstun = Math.max(41, Math.max(...follow) + m.active + 6);
  }
}

function build(ci: number): Moveset {
  const ch = CHARACTERS[ci];
  const fam = ch.family;
  const mv = ch.moves;
  const moves: Record<string, Mv> = {};
  const branch: Moveset["branch"] = {};
  const extras: string[] = [];

  // the strings
  const high = mv.high.map((_, i) => (i < mv.high.length - 1 ? `jab${i + 1}` : "punchFin"));
  const low = ["kick1", "kick2", "sweep"];
  const lowAs = fam === "boxing" ? "punch" : undefined; // a boxer has no kicks: the low string is body shots
  const highAs = fam === "kicker" ? "kick" : undefined; // a kicker's high string is kicks
  mv.high.forEach((d, i) => {
    const m = conv(ch, d, high[i], { str: "high", fin: i === high.length - 1, as: highAs });
    if (i < high.length - 1) m.next = high[i + 1];
    moves[high[i]] = m;
  });
  mv.low.forEach((d, i) => {
    const m = conv(ch, d, low[i], { str: "low", fin: i === 2, as: lowAs });
    if (i < 2) m.next = low[i + 1];
    moves[low[i]] = m;
  });
  // a string trades limbs: the same one twice running has to come back first, which slows the string
  for (const ids of [high, low]) {
    for (let i = 1; i < ids.length; i++) {
      const a = moves[ids[i - 1]];
      const b = moves[ids[i]];
      if (a.limb && a.limb === b.limb) b.limb = ({ armL: "armR", armR: "armL", legL: "legR", legR: "legL" } as const)[a.limb as "armL"];
    }
  }
  if (fam === "boxing") {
    // the opener of a boxer's low string is the one the design gives a leg
    const names: Record<string, string[]> = { "lady-bulwark": ["Liver Shot", "Body Shot", "A Low Blow, Forgive Me"], "tilly-tongs": ["Stoker's Hook", "Cinder Rip", "Slag Uppercut"] };
    (names[ch.id] ?? []).forEach((n, i) => (moves[low[i]].name = n));
  }

  // branches leave the string at its last jab / second kick
  mv.branches.forEach((d, i) => {
    const slot = `br${i + 1}`;
    const { low: isLow, trigger } = branchTrigger(d.input);
    const from = isLow ? low[1] : high[high.length - 2];
    const m = conv(ch, d, slot, { str: isLow ? "low" : "high", as: fam === "kicker" && !isLow ? "kick" : undefined });
    moves[slot] = m;
    (branch[from] ??= {})[trigger] = slot;
    extras.push(slot);
  });
  // regional strikes: R1 + up / R1 / R1 + down
  mv.regional.forEach((d, i) => {
    const slot = EXTRA_SLOTS.regional[i];
    moves[slot] = conv(ch, d, slot, { as: fam === "boxing" ? "punch" : undefined });
    extras.push(slot);
  });
  moves.dashStrike = conv(ch, mv.dash[0], "dashStrike");
  Object.assign(moves.dashStrike, { dash: Math.min(0.14, (1.1 * (fam === "kicker" || ch.id === "lady-eleanor" ? 1.45 : 1)) / mv.dash[0].active), hitstun: 0, knockdown: true, push: Math.max(1.2, moves.dashStrike.push) });
  extras.push("dashStrike");
  // directional arts (R2 + up / right / left); down is the fighter's special
  mv.arts.forEach((d, i) => {
    const slot = EXTRA_SLOTS.arts[i];
    if (!slot || !("startup" in d)) return;
    const a = conv(ch, d as StrikeDesign, slot);
    a.kind = "special"; // an art cannot be deflected, like a special; the shaping of limbs does not apply
    a.limb = null;
    a.hitstun = a.knockdown ? 0 : 30;
    a.blockstun = 28;
    a.reach = Math.max(a.reach, 1.4);
    moves[slot] = a;
    extras.push(slot);
  });

  // finisher variants: forward + Circle carries to the wall, down + Circle bounds
  const fin = moves.punchFin;
  const plain: Mv = { ...fin };
  delete plain.launch;
  moves.wallFin = { ...plain, id: "wallFin", push: 2.3, knockdown: true, hitstun: 0, dmg: fin.dmg * 1.05 };
  moves.boundFin = { ...plain, id: "boundFin", startup: fin.startup + 2, push: 0.45, bound: true, knockdown: true, hitstun: 0 };
  moves.cmdLaunch = { ...fin, id: "cmdLaunch", launch: true, knockdown: true, hitstun: 0, name: `${fin.name} (riposte)` };

  const ms: Moveset = { moves, high, low, branch, extras };
  familyBuild(ch, ms);
  settleStun(ms);
  for (const m of Object.values(ms.moves)) envelope(m);
  return ms;
}

// -------------------------------------------------------------- family rules

function familyBuild(ch: Character, ms: Moveset): void {
  const m = ms.moves;
  const all = Object.values(m);
  const strikes = all.filter((x) => x.kind !== "special");
  switch (ch.family) {
    case "boxing": {
      // very fast, short strings: a short reach, little recovery between the jabs, and the weave counter
      for (const x of strikes) {
        x.reach *= 0.92;
        if (x.next) x.recovery = Math.max(18, Math.round(x.recovery * 0.8));
      }
      const jab = m[ms.high[Math.min(1, ms.high.length - 2)]];
      m.weave = {
        ...jab,
        id: "weave",
        name: "Weave Counter",
        input: "Square + dir, ○",
        startup: 8,
        active: 3,
        recovery: 22,
        dmg: jab.dmg * 1.6,
        reach: jab.reach,
        push: 0.5,
        next: undefined,
        limb: "armL",
        kind: "punch",
        str: undefined,
        hitstun: 52,
      };
      ms.extras.push("weave");
      break;
    }
    case "power": {
      // heavy moves carry super armour; the command grabs seize
      for (const x of strikes) {
        if (x.startup >= 22 || x.launch || x.id === "dashStrike") x.armor = true;
        x.reach *= 1.04;
      }
      for (const x of all) if (x.id === "br1" && (ch.id === "hezekiah-smelt" || ch.id === "bartholomew-mule")) x.cmdGrab = true;
      break;
    }
    case "grappler": {
      for (const x of all) if (x.id === "br1") x.cmdGrab = true;
      break;
    }
    case "kicker": {
      // long reach, kicks that reach into a juggle, punches that barely hurt
      for (const x of strikes) {
        if (x.kind === "kick") {
          x.reach *= 1.2;
          x.airReach = 2.7;
        } else if (x.kind === "punch") x.dmg *= 0.9;
      }
      for (const id of ms.high) if (m[id].kind === "kick") m[id].dmg *= 1.5; // the kicks that took a jab's place pay like kicks
      m.dashStrike.kind = "kick";
      m.dashStrike.limb = "legR";
      m.dashStrike.airReach = 2.7;
      break;
    }
    case "muay": {
      // the elbows (the rear arm's strikes) open a cut
      for (const x of strikes) if (x.kind === "punch" && x.limb === "armL") x.bleed = 150;
      break;
    }
    case "karate": {
      // one-hit charged finishers: the finisher can be held and loosed as one big blow
      m.punchFin.chargeable = true;
      m.wallFin.chargeable = true;
      m.boundFin.chargeable = true;
      break;
    }
    case "brawler": {
      const eyes = m.rgHead;
      const low = m.rgLegs;
      if (eyes) {
        eyes.blind = 150;
        eyes.name = ch.id === "nell-sluice" ? "Dirt in the Eyes" : "A Handful of Snuff";
        eyes.dmg *= 0.8;
      }
      if (low) {
        low.lowBlow = 7;
        low.name = ch.id === "nell-sluice" ? "Low Blow" : "A Most Ungentlemanly Kick";
        low.height = "high"; // it is aimed at the groin, so it reaches a standing body whole
        low.startup = Math.max(UR_STRIKE.startup[0], low.startup - 1);
      }
      if (ch.id === "lady-eleanor") {
        // the rapier: every thrust is long and narrow, the lunge travels
        for (const x of strikes) {
          x.reach *= 1.28;
          x.arc = Math.max(x.arc, 0.78);
        }
        m.dashStrike.dash = (m.dashStrike.dash ?? 0.09) * 1.15;
      }
      break;
    }
    case "kungfu":
      ms.alt = drunk(ms);
      break;
  }
}

/** Percival's second stance: the same moves, lurching: slower, harder, wide, and a sway that low strikes miss. */
function drunk(crane: Moveset): Moveset {
  const moves: Record<string, Mv> = {};
  for (const [id, x] of Object.entries(crane.moves)) {
    const y: Mv = { ...x };
    if (x.kind !== "special") {
      y.startup = x.startup + (x.next ? 2 : 4);
      y.recovery = Math.round(x.recovery * 1.12);
      y.dmg = x.dmg * 1.35;
      y.reach = x.reach * 1.12;
      y.arc = Math.min(x.arc, 0.3);
      y.push = x.push * 1.25;
      y.name = x.name ? `${x.name} (drunk)` : x.name;
    }
    envelope(y);
    moves[id] = y;
  }
  const ms: Moveset = { moves, high: crane.high, low: crane.low, branch: crane.branch, extras: crane.extras };
  settleStun(ms);
  return ms;
}

// ------------------------------------------------------------------- access

const CACHE: (Moveset | undefined)[] = [];
/** A fighter's moveset, by its index in the roster. */
export function movesetOf(style: number): Moveset {
  const c = (CACHE[style] ??= buildAll(style));
  return c;
}

function buildAll(style: number): Moveset {
  const ms = build(style);
  // Constable Winch is the reference fighter: his strings are the ones measured in Urban Reign
  // (docs/calibration.md), so the calibration tests and the shared MOVES table describe him
  if (CHARACTERS[style].id === "constable-winch") {
    const own = (slot: string, next?: string): void => {
      ms.moves[slot] = { ...MOVES[slot], next, own: true, str: ms.moves[slot].str, name: ms.moves[slot].name, input: ms.moves[slot].input };
    };
    own("jab1", "jab2");
    own("jab2", "punchFin");
    own("punchFin");
    own("kick1", "kick2");
    own("kick2", "sweep");
    own("sweep");
    for (const slot of ["wallFin", "boundFin", "cmdLaunch"] as const) ms.moves[slot] = { ...MOVES[slot], own: true, name: ms.moves[slot].name, chargeable: slot !== "cmdLaunch" };
    ms.moves.punchFin.chargeable = true;
    settleStun(ms);
  }
  return ms;
}

/** The slot a back + press of the string at `from` turns into, if the fighter has a branch there. */
export const branchOf = (style: number, from: string, trigger: "back" | "grab"): string | undefined => movesetOf(style).branch[from]?.[trigger];
