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
import type { Move, SpecialId } from "../data/types";
import { SPECIALS } from "../data/characters";

export type { Move, SpecialId };

/** The six specials are part of the character design, so their frame data comes
 *  from src/data/characters.json alongside the fighter that throws them. */
const SPECIAL_MOVES: Record<SpecialId, Move> = Object.fromEntries(
  (Object.keys(SPECIALS) as SpecialId[]).map((id) => [id, SPECIALS[id].move]),
) as Record<SpecialId, Move>;

export const MOVES: Record<string, Move> = {
  jab1: { id: "jab1", startup: 12, active: 3, recovery: 28, dmg: 4, hitstun: 41, blockstun: 26, height: "high", reach: 1.25, arc: 0.55, push: 0.15, knockdown: false, next: "jab2", kind: "punch" },
  jab2: { id: "jab2", startup: 9, active: 3, recovery: 24, dmg: 5, hitstun: 41, blockstun: 22, height: "high", reach: 1.25, arc: 0.55, push: 0.2, knockdown: false, next: "jab3", kind: "punch" },
  jab3: { id: "jab3", startup: 11, active: 3, recovery: 24, dmg: 5, hitstun: 41, blockstun: 22, height: "high", reach: 1.3, arc: 0.55, push: 0.2, knockdown: false, next: "punchFin", kind: "punch" },
  // the string's finisher launches, as Urban Reign's neutral string does
  punchFin: { id: "punchFin", startup: 17, active: 4, recovery: 26, dmg: 9, hitstun: 0, blockstun: 25, height: "high", reach: 1.4, arc: 0.5, push: 1.4, knockdown: true, kind: "punch", launch: true },
  // directional string finishers: forward+Circle for wall-carry, down+Circle for overhead ground-bounce, f+Low for command launcher
  wallFin: { id: "wallFin", startup: 16, active: 4, recovery: 26, dmg: 10, hitstun: 0, blockstun: 25, height: "high", reach: 1.5, arc: 0.5, push: 2.3, knockdown: true, kind: "punch" },
  boundFin: { id: "boundFin", startup: 18, active: 4, recovery: 26, dmg: 9, hitstun: 0, blockstun: 26, height: "high", reach: 1.45, arc: 0.5, push: 0.45, knockdown: true, kind: "punch", bound: true },
  cmdLaunch: { id: "cmdLaunch", startup: 16, active: 4, recovery: 26, dmg: 8, hitstun: 0, blockstun: 25, height: "high", reach: 1.4, arc: 0.5, push: 1.2, knockdown: true, kind: "punch", launch: true },
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
  ...SPECIAL_MOVES,
};

export { SPECIAL_NAMES } from "../data/characters";

// Fury: the special meter. Landing a hit, taking one, reversing and throwing
// fill it; a special costs `cost`, so a full bar holds two. A KO empties it.
export const FURY = { max: 100, cost: 50, hit: 6, taken: 3, reversal: 20, throw: 12 };
// Square + Cross count as one special press when they arrive this close
// together; a string opener started by the first of the two is cancelled.
export const SPECIAL_CHORD = 3;

// Hitstop: a landed hit freezes the attacker and the victim for a few frames
// (both by the same amount, so frame advantage is unchanged). Pitfighter's
// own feel layer: the calibration tests switch it off to compare raw timings.
export const HITSTOP = { base: 3, perDmg: 0.5, knock: 3, counter: 4, max: 12, block: 3, reversal: 10, grab: 3, throw: 6, ko: 16 };
export const COUNTER = { dmg: 1.2, stun: 1.25, backStun: 1.2 };
export function hitstopFor(dmg: number, knockdown: boolean): number {
  return Math.min(HITSTOP.max, Math.round(HITSTOP.base + dmg * HITSTOP.perDmg) + (knockdown ? HITSTOP.knock : 0));
}

export const STRING_STARTS = { high: "jab1", low: "kick1" } as const;
// Combos from the flow of the body: a strike that lands leaves the body set up
// for the next. A string trades limbs, and the other side's strike comes out
// of the last one's follow-through at once; the same limb twice running has
// to come back first (`same` frames more). Mid-string, a landed punch flows
// into the kick string (Circle with the stick back) and a landed kick into
// the punch string (plain Circle), up to `max` crossings in a combo.
export const FLOW = { max: 2, same: 4 };

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
// Practice: nobody wins, the KO'd come back on any arena, fury never runs out,
// and a body left alone for `refill` frames is whole again.
export const PRACTICE = { refill: 90 };
export const REATTACH = { dur: 30, range: 1.1, hpFrac: 0.5 };
export const REGROW_FRAMES = 720;
export const SIT_FRAMES = 20;
export const GEYSER = { warn: 60, erupt: 20, radius: 1.3, dmg: 10, minGap: 240, maxGap: 420 };
export const LAVA = { tick: 10, dmg: 2 };
export const SPEED = { walk: 0.05, run: 0.1, hop: 0.045, bounce: 0.02, accel: 0.35, skid: 0.72, runTurn: 0.22, track: 0.12 };
// Cross: a dash covers about 1.6 m in its first `move` frames, then eases into
// a run if the button is still held. Square with a direction: Urban Reign's
// evade, a 34 frame sidestep (its decoded record) that nothing touches over the
// deflect window's frames. L2: a taunt; one played to the end fills fury.
export const DASH = { dur: 20, move: 12, speed: 0.13, strikeFrom: 4 };
export const EVADE = { dur: 34, move: 14, speed: 0.075, invuln: 15 };
export const TAUNT = { dur: 70, fury: 25 };
// The Gallery's gift: thrown from the boxes into the pit, and picked up with
// L1 (BTN.USE) by anyone standing near it.
export const GIFT = { range: 1.2, gravity: 0.008, bounce: 0.3, drop: 0.4 };
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
// Knockback on the floor: a blow sets the victim sliding at its push over
// `hitstun` (a staggered body) or `down` (a knocked-down one) metres a frame,
// and a sliding body keeps `friction` of its speed every frame, so it travels
// about push / (divisor * (1 - friction)) in all.
export const KNOCK = { hitstun: 8, down: 12, friction: 0.85, lift: 0.024, bounce: 0.25 };
export const CRUNCH = { speed: 0.05, dmg: 90, rebound: 0.45, knock: 0.06, wallSplat: 0.065, splatDur: 28 };
