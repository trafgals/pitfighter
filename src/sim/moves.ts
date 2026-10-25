// Frame data. Numbers are 60 Hz frames and metres.
//
// The timings are calibrated against Namco's Urban Reign (SLUS_212.09), read
// frame by frame out of the retail game's EE RAM in its first story fight
// (actor struct: motion id +0x8d40, state +0x8d44, HP +0x8e28; see
// docs/calibration.md). Values are engine frames from the first frame of the
// attacker's motion, which is what a press here maps to; Urban Reign adds about
// 4 frames of pad latency on top that is not reproduced.
//
//   neutral string (Circle x4)  hits on frame 12 / 9 / 11 / 17, each follow-up
//                               starts 3 frames after the previous hit, so
//                               startup + active(3) is the cancel point here
//   single strike               42-44 frames in total
//   light hit reaction          41 frames, so a lone jab is +10 on hit
//   low strikes (down+Circle)   hit on frame 18 (48 total) and 26 (53-66 total)
//   dodge / deflection (Square) a 36 frame motion; a strike that lands on its
//                               frames 2..14 is deflected, later or earlier
//                               ones hit
//   deflection                  defender locked 41 frames, attacker staggered
//                               54-66, so the defender ends about +15
//   grapple (Triangle)          catches on its first frame, 42-62 frame whiff,
//                               holds for 101 frames
//   knockdown                   about 50 frames falling and on the floor, then
//                               a 50 frame get-up
//
// Damage, reach and the knockdown pushes are this game's own and were not
// calibrated. There is no guard in Urban Reign; blockstun keeps every move
// 4 frames minus on block.
import type { Height } from "./types";

export interface Move {
  id: string;
  startup: number; // first active frame (t counts from 0 on the press frame)
  active: number;
  recovery: number;
  dmg: number;
  hitstun: number; // 0 with knockdown = the hit knocks down
  blockstun: number;
  height: Height;
  reach: number;
  arc: number; // cos of the half angle of the hit cone
  push: number; // knockback distance on hit
  knockdown: boolean;
  next?: string; // string follow-up, cancellable once this move has connected
  kind: "punch" | "kick" | "head" | "special";
  dash?: number; // metres per frame the attacker travels during the active frames
  launch?: boolean; // a launcher: the victim goes up into a juggle instead of down
  rehit?: number; // the move can hit the same fighter again every `rehit` active frames
}

export const MOVES: Record<string, Move> = {
  jab1: { id: "jab1", startup: 12, active: 3, recovery: 28, dmg: 4, hitstun: 41, blockstun: 26, height: "high", reach: 1.25, arc: 0.55, push: 0.15, knockdown: false, next: "jab2", kind: "punch" },
  jab2: { id: "jab2", startup: 9, active: 3, recovery: 24, dmg: 5, hitstun: 41, blockstun: 22, height: "high", reach: 1.25, arc: 0.55, push: 0.2, knockdown: false, next: "jab3", kind: "punch" },
  jab3: { id: "jab3", startup: 11, active: 3, recovery: 24, dmg: 5, hitstun: 41, blockstun: 22, height: "high", reach: 1.3, arc: 0.55, push: 0.2, knockdown: false, next: "punchFin", kind: "punch" },
  // the string's finisher launches, as Urban Reign's neutral string does
  punchFin: { id: "punchFin", startup: 17, active: 4, recovery: 26, dmg: 9, hitstun: 0, blockstun: 25, height: "high", reach: 1.4, arc: 0.5, push: 1.4, knockdown: true, kind: "punch", launch: true },
  kick1: { id: "kick1", startup: 18, active: 3, recovery: 27, dmg: 5, hitstun: 41, blockstun: 25, height: "low", reach: 1.45, arc: 0.5, push: 0.2, knockdown: false, next: "kick2", kind: "kick" },
  kick2: { id: "kick2", startup: 20, active: 3, recovery: 28, dmg: 6, hitstun: 41, blockstun: 26, height: "low", reach: 1.45, arc: 0.5, push: 0.25, knockdown: false, next: "sweep", kind: "kick" },
  sweep: { id: "sweep", startup: 26, active: 4, recovery: 30, dmg: 7, hitstun: 0, blockstun: 29, height: "low", reach: 1.6, arc: 0.35, push: 0.8, knockdown: true, kind: "kick" },
  // Circle out of a run or a dash: a shoulder charge that knocks down.
  dashStrike: { id: "dashStrike", startup: 10, active: 8, recovery: 26, dmg: 8, hitstun: 0, blockstun: 26, height: "high", reach: 1.05, arc: 0.4, push: 1.5, knockdown: true, kind: "head", dash: 0.09 },
  // No arms: Circle becomes a slow headbutt.
  headbutt: { id: "headbutt", startup: 18, active: 3, recovery: 26, dmg: 6, hitstun: 41, blockstun: 24, height: "high", reach: 0.95, arc: 0.6, push: 0.5, knockdown: false, kind: "head" },
  // The style specials (L2, or Square + Cross together), paid for with fury.
  // They are Pitfighter's own: a reversal cannot catch them, so they are the
  // answer to a fighter who sits in reversal.
  spSpin: { id: "spSpin", startup: 10, active: 10, recovery: 26, dmg: 10, hitstun: 0, blockstun: 28, height: "high", reach: 1.7, arc: -1, push: 1.6, knockdown: true, kind: "special" },
  spCharge: { id: "spCharge", startup: 12, active: 18, recovery: 28, dmg: 9, hitstun: 0, blockstun: 26, height: "high", reach: 1.0, arc: 0.3, push: 1.8, knockdown: true, kind: "special", dash: 0.16 },
  spFlurry: { id: "spFlurry", startup: 8, active: 24, recovery: 24, dmg: 2.5, hitstun: 30, blockstun: 12, height: "high", reach: 1.3, arc: 0.5, push: 0.08, knockdown: false, kind: "special", rehit: 4 },
  spSlam: { id: "spSlam", startup: 22, active: 3, recovery: 30, dmg: 11, hitstun: 0, blockstun: 30, height: "low", reach: 2.0, arc: -1, push: 1.4, knockdown: true, kind: "special" },
  spBlade: { id: "spBlade", startup: 14, active: 5, recovery: 28, dmg: 12, hitstun: 0, blockstun: 28, height: "high", reach: 2.3, arc: 0, push: 1.4, knockdown: true, kind: "special" },
  spFire: { id: "spFire", startup: 16, active: 6, recovery: 30, dmg: 10, hitstun: 0, blockstun: 26, height: "high", reach: 4.5, arc: 0.93, push: 1.2, knockdown: true, kind: "special" },
};

export type SpecialId = "spSpin" | "spCharge" | "spFlurry" | "spSlam" | "spBlade" | "spFire";
export const SPECIAL_NAMES: Record<SpecialId, string> = {
  spSpin: "HELLSPIN",
  spCharge: "BRIMSTONE CHARGE",
  spFlurry: "INFERNAL FLURRY",
  spSlam: "PIT SLAM",
  spBlade: "PITCHFORK ARC",
  spFire: "HELLFIRE FLICK",
};

// Fury: the special meter. Landing a hit, taking one, reversing and throwing
// fill it; a special costs `cost`, so a full bar holds two. A KO empties it.
export const FURY = { max: 100, cost: 50, hit: 6, taken: 3, reversal: 20, throw: 12 };
// Square + Cross count as one special press when they arrive this close
// together; a string opener started by the first of the two is cancelled.
export const SPECIAL_CHORD = 3;

// Hitstop: a landed hit freezes the attacker and the victim for a few frames
// (both by the same amount, so frame advantage is unchanged). Pitfighter's
// own feel layer: the calibration tests switch it off to compare raw timings.
export const HITSTOP = { base: 3, perDmg: 0.5, knock: 3, max: 12, block: 3, reversal: 10, grab: 3, throw: 6, ko: 16 };
export function hitstopFor(dmg: number, knockdown: boolean): number {
  return Math.min(HITSTOP.max, Math.round(HITSTOP.base + dmg * HITSTOP.perDmg) + (knockdown ? HITSTOP.knock : 0));
}

export const STRING_STARTS = { high: "jab1", low: "kick1" } as const;

export const GRAB = { startup: 1, active: 3, whiff: 41, reach: 1.05, arc: 0.6 };
export const HOLD = { dur: 100, escape: 12, knee: 6, kneeCool: 18, kneeMax: 3 };
export const THROW = { dur: 24, dist: 4, dmg: 12, splash: 6 };
export const REVERSAL = { first: 2, window: 14, dur: 36, stun: 15, dmg: 8, pushR: 2.5, push: 1.6, pushStun: 14 };
// Pitfighter's tweak to Urban Reign: a reversal that counters nothing takes
// 3x as long to recover from (its frames after the window, 21 -> 63), so
// sitting there spamming reversal is punishable. A reversal that lands ends
// at once, so only a whiff plays the full length.
export const REVERSAL_WHIFF_RECOVERY = 3;
export const REVERSAL_WHIFF_TOTAL = REVERSAL.window + 1 + REVERSAL_WHIFF_RECOVERY * (REVERSAL.dur - REVERSAL.window - 1);
// Pitfighter's other tweak: hold the button of a string's first strike (jab1 /
// kick1) to charge it. The strike stops on its last startup frame while the
// button stays down, for up to `max` frames; on release it fires with up to
// `dmg` and `push` extra (x2 at full charge), and a full charge knocks down.
// A tap releases before that frame, so an uncharged strike is unchanged.
export const CHARGE = { max: 60, dmg: 1, push: 1 };
export const DOWN = { dur: 50, wake: 50, wakeInvuln: 30, otgScale: 0.5 };
export const CROWD = { attackers: 3, window: 60, invuln: 40 };
export const COMBO_SCALE = 0.85;
export const COMBO_FLOOR = 0.4;
export const DIZZY = { dur: 90, headReset: 20 };
export const KO_FRAMES = 180;
export const FALL_FRAMES = 50; // over the edge to gone
export const RESPAWN_INVULN = 90;
export const REATTACH = { dur: 30, range: 1.1, hpFrac: 0.5 };
export const REGROW_FRAMES = 720;
export const SIT_FRAMES = 20;
export const GEYSER = { warn: 60, erupt: 20, radius: 1.3, dmg: 10, minGap: 240, maxGap: 420 };
export const LAVA = { tick: 10, dmg: 2 };
export const SPEED = { walk: 0.05, run: 0.1, hop: 0.045, bounce: 0.03 };
// Cross: a dash covers about 1.6 m in its first `move` frames, then eases into
// a run if the button is still held. Square with a direction: Urban Reign's
// evade, a 34 frame sidestep (its decoded record) that nothing touches over the
// deflect window's frames. L2: a taunt; one played to the end fills fury.
export const DASH = { dur: 20, move: 12, speed: 0.13, strikeFrom: 4 };
export const EVADE = { dur: 34, move: 14, speed: 0.075, invuln: 15 };
export const TAUNT = { dur: 70, fury: 25 };
// one leg: hop, moving only in the air; no legs: bounce along on the torso, the same way but slower
export const HOP_CYCLE = 24;
export const HOP_AIR = 14;
export const BUFFER = 8; // input buffer for presses, frames

// Juggles. Urban Reign's neutral string launches; here the body then floats on
// a soft, floaty gravity so more blows can follow, and every blow in the air
// pops it up again. The juggled fighter steers with the stick (Soul Calibur's
// air control), harder for every hit taken in the air, and pushing away from
// the attacker as a hit lands flies them further off: the longer a juggle
// runs, the likelier it slips out of reach. Gravity never grows with the hits;
// a juggle ends when it is steered out of reach, grabbed, or lands.
//   launch / pop    m/frame up on the launcher / on each air hit (pops stop after maxPops)
//   g               m/frame^2 (0.0018: 6.5 m/s^2, about two thirds of Earth's)
//   steer, steerMax stick drift per frame per air hit, and its cap
//   flee            m/frame pushed away per air hit, for a stick held away from the blow
//   drag            the drift kept each frame in the air
//   high / low      how high a high / low strike still reaches a body in the air
//   bounce          the first landing bounces back up this hard (once), if falling faster than bounceMin
export const AIR = { launch: 0.062, pop: 0.034, maxPops: 8, g: 0.0018, steer: 0.0011, steerMax: 0.0066, flee: 0.012, drag: 0.96, high: 1.9, low: 0.75, bounce: 0.32, bounceMin: 0.035 };
// A body flying fast into a wall, a prop or a fighter: `speed` m/frame or more crunches,
// for `dmg` per m/frame on a limb (and the usual share on the torso); it rebounds at `rebound`.
export const CRUNCH = { speed: 0.05, dmg: 90, rebound: 0.45, knock: 0.06 };
