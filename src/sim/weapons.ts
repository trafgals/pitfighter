// What a weapon does in a fighter's hand.
//
// A weapon changes the fighter's punches (the arms' strikes): how far they
// reach, how hard they hit, how long they take to start, and how the blow is
// shaped. It wears out: every blow that lands costs durability, and at zero it
// breaks. A fighter's own signature weapon never breaks. It can also be thrown,
// and a thrown weapon hurts whoever it hits.
//
// A strike has one of three shapes, by the move that throws it:
//   thrust    the straight high strikes (a jab)
//   swing     the low, sweeping strikes
//   overhead  the finishers: the ones that knock down, launch or bound
import type { Move } from "../data/types";

export type WeaponShape = "swing" | "thrust" | "overhead";

export interface WeaponStats {
  /** the Gallery's class of weapon: a fighter's affinity is matched against it */
  class: string;
  /** metres added to the reach of a punch */
  reach: number;
  /** damage multiplier of a punch */
  dmg: number;
  /** frames added to a punch's start-up (a heavy weapon is slow, a light one negative) */
  startup: number;
  /** blows it takes before it breaks; 0 never breaks */
  dur: number;
  /** damage of a throw; 0 cannot be thrown (too heavy) */
  throwDmg: number;
  /** damage multiplier by the shape of the blow */
  shapes: Record<WeaponShape, number>;
}

const S = (swing: number, thrust: number, overhead: number): Record<WeaponShape, number> => ({ swing, thrust, overhead });

export const WEAPONS: Record<string, WeaponStats> = {
  weapon_knuckleduster: { class: "fist", reach: 0.05, dmg: 1.25, startup: 0, dur: 14, throwDmg: 4, shapes: S(1, 1.1, 1) },
  weapon_piston_gauntlet: { class: "fist", reach: 0.1, dmg: 1.5, startup: 2, dur: 12, throwDmg: 6, shapes: S(1, 1.15, 1.1) },
  weapon_nail_bat: { class: "blunt", reach: 0.45, dmg: 1.55, startup: 4, dur: 8, throwDmg: 8, shapes: S(1.1, 0.8, 1.4) },
  weapon_coal_shovel: { class: "blunt", reach: 0.55, dmg: 1.5, startup: 5, dur: 9, throwDmg: 7, shapes: S(1.2, 0.8, 1.4) },
  weapon_chair: { class: "blunt", reach: 0.35, dmg: 1.6, startup: 3, dur: 3, throwDmg: 9, shapes: S(1, 0.9, 1.3) },
  weapon_cleaver: { class: "blade", reach: 0.3, dmg: 1.5, startup: 1, dur: 10, throwDmg: 7, shapes: S(1, 0.9, 1.35) },
  weapon_bone_saw: { class: "blade", reach: 0.25, dmg: 1.35, startup: -1, dur: 12, throwDmg: 5, shapes: S(1, 1.2, 0.9) },
  // a fighter's own weapon: never breaks
  prop_eleanor_weeping_rapier: { class: "blade", reach: 0.7, dmg: 1.2, startup: -2, dur: 0, throwDmg: 5, shapes: S(0.8, 1.4, 0.9) },
  prop_pegg_cast_iron_last: { class: "blunt", reach: 0.2, dmg: 1.4, startup: 3, dur: 0, throwDmg: 6, shapes: S(1, 0.9, 1.3) },
  prop_tilly_clinker_tongs: { class: "polearm", reach: 0.5, dmg: 1.3, startup: 2, dur: 0, throwDmg: 5, shapes: S(1.1, 1.2, 1) },
  prop_winch_gold_nightstick: { class: "blunt", reach: 0.3, dmg: 1.2, startup: -1, dur: 0, throwDmg: 4, shapes: S(1, 1, 1.2) },
  // what the arena leaves on the floor
  debris_beam: { class: "blunt", reach: 0.8, dmg: 2.4, startup: 10, dur: 4, throwDmg: 0, shapes: S(1.2, 0.6, 1.5) },
  debris_stone: { class: "blunt", reach: 0.1, dmg: 1.3, startup: 3, dur: 3, throwDmg: 10, shapes: S(1, 1, 1.2) },
  debris_arrow: { class: "polearm", reach: 0.5, dmg: 1.1, startup: -1, dur: 3, throwDmg: 4, shapes: S(0.8, 1.3, 0.9) },
  // a severed limb, swung by the stump
  limb: { class: "blunt", reach: 0.3, dmg: 1.2, startup: 0, dur: 6, throwDmg: 3, shapes: S(1, 0.9, 1.2) },
};

/** The weapons the arena may put on the floor at the start of a match. */
export const FLOOR_WEAPONS = Object.keys(WEAPONS).filter((id) => id.startsWith("weapon_"));

/** The shape of a blow, from the move that throws it. */
export function shapeOf(m: Move): WeaponShape {
  if (m.knockdown || m.launch || m.bound) return "overhead";
  return m.height === "low" ? "swing" : "thrust";
}

/** How much a fighter's affinity for a weapon's class helps their hand with it. */
export const AFFINITY_BONUS = 1.1;
