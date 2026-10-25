import { World } from "../src/sim/world";
import { BTN, type PartId, type PlayerInput } from "../src/sim/types";
import type { Fighter } from "../src/sim/types";

export { BTN };

/**
 * A two-fighter world with both fighters placed face to face `gap` metres apart.
 * Their limbs are the plain ones the frame data is written for (`limbs` rolls them).
 */
export function duel(gap = 1.0, styles = [0, 0], hitstop = true, limbs = false): World {
  const w = new World({ seed: 1, styles, humans: styles.map(() => true), hitstop, limbs });
  const [a, b] = w.fighters;
  a.x = -gap / 2;
  a.y = 0;
  a.facing = 0;
  b.x = gap / 2;
  b.y = 0;
  b.facing = Math.PI;
  w.s.nextGeyser = 1e9;
  return w;
}

export function idle(n: number): PlayerInput[] {
  return Array.from({ length: n }, () => ({ x: 0, y: 0, buttons: 0 }));
}

/** Step with `buttons` pressed by fighter `who` on this frame only. */
export function tap(w: World, who: number, buttons: number, extra: (inp: PlayerInput[]) => void = () => {}): void {
  const inp = idle(w.fighters.length);
  inp[who].buttons = buttons;
  extra(inp);
  w.step(inp);
}

export function run(w: World, frames: number, f: (inp: PlayerInput[], frame: number) => void = () => {}): void {
  for (let i = 0; i < frames; i++) {
    const inp = idle(w.fighters.length);
    f(inp, i);
    w.step(inp);
  }
}

/** Knock exactly one limb off (its remaining HP, so the torso share does not KO the dummy). */
export function chop(w: World, f: Fighter, part: PartId, by: number): void {
  f.parts.torso.hp = f.parts.torso.max;
  w.damage(f, part, f.parts[part].hp, by);
}
