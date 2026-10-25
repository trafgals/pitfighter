// Air grabs: Triangle on a juggled fighter in reach catches them out of the air
// and finishes the juggle, each style its own way. They are Pitfighter's own
// (Urban Reign's juggles end on the floor): the cash-out for a juggle, and the
// reason to read where the victim is steering - the longer the juggle runs, the
// further they can push themselves out of reach, so a late grab pays more but
// misses more. The grab belongs to the torso, so it stays the fighter's own
// whatever limbs they wear; the arms it is done with set its strength.
//
// Frames from the catch: the victim is carried along an arc `lift` metres high
// and comes down on `slam`, where the damage lands; then
//   down:   they lie there (a knockdown)
//   bounce: they bounce back up off the floor into a fresh juggle
//   throw:  they are flung `dist` metres on along the attacker's facing
//   limb:   as down, and the slam rips at an arm as well
import { CHARACTERS } from "../data/characters";
import type { AirGrab } from "../data/types";

export type { AirGrab, AirGrabEnd } from "../data/types";

/** Reach and height of the catch: a little longer than a standing grapple, up to an outstretched arm above the head. */
export const AIR_GRAB = { reach: 1.45, height: 2.1 };

/** Each style's air grab, by style label. They are part of the character design (src/data/characters.json). */
export const AIR_GRABS: Record<string, AirGrab> = Object.fromEntries(CHARACTERS.map((c) => [c.style, c.airGrab]));
