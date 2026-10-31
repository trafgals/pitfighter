// How a limb's own traits (src/sim/limbs.ts) show in the way it moves: a heavy
// limb is slow to get going and carries on past the blow, a quick one snaps,
// and what it hits with changes the line the strike takes (a claw rakes in from
// wide, a spike goes straight down the line, a club comes over the top).
//
// The sim already gives every grafted limb its own timing, reach and damage;
// this is the part you can see. A fighter on the limbs it was born with has no
// traits, and nothing here touches it.
import type { Fighter } from "../sim/types";
import { PLAIN, type LimbTrait } from "../sim/limbs";
import type { Limb } from "./motion";
import type { Pose } from "./body";

export type LimbName = "armL" | "armR" | "legL" | "legR";
/** A limb's spring: how much stiffer (k) and how much more damped it is than the joints' own. */
export interface Spring {
  k: number;
  damp: number;
}
export type LimbFeel = Partial<Record<LimbName, Spring>>;

const LIMBS: LimbName[] = ["armL", "armR", "legL", "legR"];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The spring a limb with these traits swings on: heavy is slow and slow to settle, a whip is quick. */
export function springOf(t: LimbTrait): Spring {
  return { k: clamp(t.swing / Math.sqrt(t.mass), 0.6, 1.5), damp: clamp(Math.pow(t.mass, -0.35), 0.8, 1.15) };
}

/** The springs of the limbs a fighter has grown, or undefined when every limb is its own. */
export function feelOf(f: Fighter): LimbFeel | undefined {
  let out: LimbFeel | undefined;
  for (const l of LIMBS) {
    const t = f.parts[l].trait;
    if (!t || t === PLAIN) continue;
    (out ??= {})[l] = springOf(t);
  }
  return out;
}

/** +1 for the side a limb's own z turns outward on: an arm's left is +z, a leg's right is. */
const outward = (limb: LimbName) => (limb === "armL" || limb === "legR" ? 1 : -1);

/** How far into its strike a limb is: its swing forward past the stance's, 0..1. */
export function strikeAmount(p: Pose, base: Pose, limb: LimbName): number {
  const now = limb === "armL" ? p.armL[0] : limb === "armR" ? p.armR[0] : limb === "legL" ? p.legL[0] : p.legR[0];
  const was = limb === "armL" ? base.armL[0] : limb === "armR" ? base.armR[0] : limb === "legL" ? base.legL[0] : base.legR[0];
  return clamp((was - now) / (limb.startsWith("arm") ? 1.4 : 1.0), 0, 1);
}

/**
 * Bend a strike's pose to the limb that throws it, in proportion to how far
 * into the strike the limb is: a wide arc swings out from the side, a claw
 * rakes in from further out, a spike goes straight down the line and a club
 * leans the trunk into the blow. `p` is the pose the clip gave, `base` the one
 * it started from.
 */
export function shapeStrike(p: Pose, base: Pose, limb: Limb, t: LimbTrait | undefined): void {
  if (!t || t === PLAIN) return;
  if (limb !== "armL" && limb !== "armR" && limb !== "legL" && limb !== "legR") return;
  const s = strikeAmount(p, base, limb);
  if (s <= 0) return;
  const arm = limb === "armL" || limb === "armR";
  const wide = clamp((0.7 - t.arc) / 0.35, 0, 1);
  let out = (arm ? 0.35 : 0.25) * wide;
  if (t.tip === "claw") out += 0.2;
  else if (t.tip === "spike") out -= 0.15;
  else if (t.tip === "club") {
    p.spineX += 0.12 * s;
    if (arm) (limb === "armL" ? p.armL : p.armR)[0] -= 0.2 * s; // over the top
  }
  const swing = out * s * outward(limb);
  if (limb === "armL") p.armL[2] += swing;
  else if (limb === "armR") p.armR[2] += swing;
  else if (limb === "legL") p.legL[1] += swing;
  else p.legR[1] += swing;
}
