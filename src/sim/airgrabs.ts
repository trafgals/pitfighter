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
import type { Style } from "./styles";

export type AirGrabEnd = "down" | "bounce" | "throw" | "limb";

export interface AirGrab {
  name: string;
  dur: number; // the attacker's frames, catch to recovered
  slam: number; // the frame the victim hits the floor
  lift: number; // metres the victim is carried up before the slam
  dmg: number;
  end: AirGrabEnd;
  dist?: number; // throw: how far
}

/** Reach and height of the catch: a little longer than a standing grapple, up to an outstretched arm above the head. */
export const AIR_GRAB = { reach: 1.45, height: 2.1 };

const g = (name: string, end: AirGrabEnd, dmg: number, slam: number, lift: number, extra: Partial<AirGrab> = {}): AirGrab => ({ name, end, dmg, slam, lift, dur: slam + 22, ...extra });

export const AIR_GRABS: Record<Style["style"], AirGrab> = {
  "All-Round": g("HELLBOUND SUPLEX", "down", 14, 26, 0.9),
  Power: g("FURNACE POWERBOMB", "down", 19, 34, 1.4, { dur: 62 }),
  Street: g("GUTTER CURB-STOMP", "down", 15, 22, 0.5),
  Karate: g("TILE-BREAKER DROP", "bounce", 12, 20, 0.6),
  Wrestling: g("PILEDRIVER TO PERDITION", "down", 22, 38, 1.6, { dur: 64 }),
  "Muay Thai": g("EIGHT-LIMB PLUM KNEE", "bounce", 13, 18, 0.4),
  Boxing: g("UPPERCUT CATCH", "bounce", 12, 16, 0.3),
  Rush: g("REAPER RUNAWAY SLAM", "throw", 14, 24, 0.7, { dist: 4.5 }),
  Speed: g("IMP SLINGSHOT", "throw", 9, 14, 0.4, { dist: 3, dur: 32 }),
  "Kung Fu": g("CRANE SPIRAL", "throw", 13, 28, 1.1, { dist: 3.5 }),
  Mighty: g("MOUNTAIN CRUSH", "down", 24, 40, 1.8, { dur: 70 }),
  Submission: g("CHIMERA ARMBAR DROP", "limb", 12, 30, 0.8),
  Military: g("DRILL-SERGEANT SLAM", "down", 16, 26, 1.0),
  Capoeira: g("GINGA SCISSORS", "down", 14, 24, 0.6),
  "Tae Kwon Do": g("AXE-KICK SPIKE", "bounce", 14, 20, 0.9),
  "Samurai Sword": g("GEHENNA WHEEL", "throw", 15, 30, 1.2, { dist: 4 }),
  Master: g("OLD DEVIL'S BARGAIN", "throw", 16, 26, 0.9, { dist: 5 }),
  Gun: g("POINT-BLANK POP", "bounce", 13, 18, 0.5),
  "Martial Arts": g("BLAZE BACKFLIP DRIVER", "down", 16, 30, 1.3),
  "Judo Based": g("ASHEN IPPON", "down", 17, 18, 0.6, { dur: 38 }),
  Amateur: g("PANICKED BEAR HUG", "down", 9, 30, 0.3),
};
