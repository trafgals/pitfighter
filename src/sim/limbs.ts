// Free-form limbs. Every limb that grows is rolled its own traits: how heavy
// it is, how long, how fast it whips, how wide it swings and what it hits
// with. The strikes a fighter throws are generated from the limb that throws
// them, so a body put together from torn-off parts fights like nothing else,
// and no two limbs (even two grown on the same style) are quite alike.
//
// The style still leans the roll: a Power arm is heavy, a Speed arm fast, a
// Kung Fu leg long. And every generated strike stays inside Urban Reign's own
// timing (`UR_STRIKE`, from the decoded movesets: first hits on frames 9..38,
// whole actions 36..90 frames long), so the feel stays the game's.
import type { Move } from "./moves";
import type { PartId } from "./types";
import { STYLES } from "./styles";

export type Tip = "fist" | "claw" | "hoof" | "club" | "spike";

export interface LimbTrait {
  mass: number; // 0.75..1.35: hits harder and pushes further, swings slower
  length: number; // 0.85..1.2: reach
  swing: number; // 0.8..1.25: how fast it whips
  arc: number; // the strike's cone (cosine): 0.35 a wide hook .. 0.7 straight down the line
  tip: Tip;
}

/** What a limb hits with: damage, hitstun and push multipliers, and frames added to the startup. */
export const TIPS: Record<Tip, { dmg: number; stun: number; push: number; startup: number }> = {
  fist: { dmg: 1, stun: 1, push: 1, startup: 0 },
  claw: { dmg: 1.12, stun: 1, push: 0.8, startup: 0 },
  hoof: { dmg: 0.95, stun: 1, push: 1.35, startup: 1 },
  club: { dmg: 1.2, stun: 1.1, push: 1.15, startup: 2 },
  spike: { dmg: 1.25, stun: 1, push: 0.7, startup: 1 },
};
const TIP_ORDER: Tip[] = ["fist", "fist", "claw", "hoof", "club", "spike"];

/** Urban Reign's strike timing (frames): first active frame, and the whole action. */
export const UR_STRIKE = { startup: [9, 38] as const, total: [36, 90] as const };

/** The plain limb every trait is measured from: what the frame data is written for. */
export const PLAIN: LimbTrait = { mass: 1, length: 1, swing: 1, arc: 0, tip: "fist" };

// a small integer hash, so a limb's roll depends only on who grew it, where and when
function mix(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= x | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}
const PART_N: Record<PartId, number> = { head: 1, torso: 2, armL: 3, armR: 4, legL: 5, legR: 6 };

/**
 * Roll a limb: `seed` is the match's, `id` the fighter's, `n` how many limbs
 * that fighter has grown in that place (respawns and regrowth roll new ones).
 */
export function rollLimb(seed: number, id: number, part: PartId, n: number, style: number): LimbTrait {
  let h = mix(seed, id, PART_N[part], n);
  const r = () => {
    h = mix(h, 0x9e3779b9);
    return h / 4294967296;
  };
  const st = STYLES[style];
  const leg = part === "legL" || part === "legR";
  const power = leg ? st.kick : st.punch; // a hard-hitting style grows heavy limbs
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  return {
    mass: clamp(lerp(0.75, 1.35, r()) * Math.sqrt(power), 0.75, 1.35),
    length: clamp(lerp(0.85, 1.2, r()) * Math.sqrt(st.reach), 0.85, 1.2),
    swing: clamp(lerp(0.8, 1.25, r()) * (1 - st.startup / 40), 0.8, 1.25),
    arc: lerp(0.35, 0.7, r()),
    tip: TIP_ORDER[Math.floor(r() * TIP_ORDER.length)],
  };
}

/** The most a rolled limb can add to a startup (mass, swing and tip at their worst), and so to every hitstun. */
export const STUN_SLACK = Math.ceil(7 * 0.35 + 12 * 0.2 + 2);
const clampF = (v: number, [a, b]: readonly [number, number]) => Math.max(a, Math.min(b, Math.round(v)));

/**
 * A strike as this limb throws it: heavier is slower and harder, a fast whip
 * comes out sooner and recovers sooner, longer reaches further, and the tip
 * sets the damage, stun and push. The timing stays inside UR_STRIKE.
 */
export function shape<M extends Move & { total: number }>(m: M, t: LimbTrait): M {
  if (t === PLAIN) return m;
  const tip = TIPS[t.tip];
  const startup = clampF(m.startup + 7 * (t.mass - 1) - 12 * (t.swing - 1) + tip.startup, UR_STRIKE.startup);
  const tail = (m.recovery * Math.sqrt(t.mass)) / t.swing;
  const total = clampF(startup + m.active + tail, [Math.max(UR_STRIKE.total[0], startup + m.active + 8), UR_STRIKE.total[1]]);
  return {
    ...m,
    startup,
    recovery: total - startup - m.active,
    total,
    reach: m.reach * t.length,
    arc: t.arc || m.arc,
    dmg: m.dmg * t.mass * tip.dmg,
    push: m.push * t.mass * tip.push,
    // a string stays a true combo whatever limbs throw it: the stun covers the slowest follow-up a limb can roll
    hitstun: m.hitstun ? Math.round(m.hitstun * tip.stun) + STUN_SLACK : 0,
  };
}

/** The limb that throws a strike: a string trades hands (and feet), lead side first. */
export function striker(id: string, kind: Move["kind"]): PartId | null {
  if (kind === "punch") return id === "jab2" ? "armL" : "armR";
  if (kind === "kick") return id === "kick2" ? "legL" : "legR";
  return null;
}
