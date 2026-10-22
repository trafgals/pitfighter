// Frame data. Numbers are 60 Hz frames and metres. They are first estimates of
// Urban Reign's feel (snappy 6f jab, strings that combo on hit because hitstun
// outlasts the next startup, heavy enders that knock down, punishable whiffs)
// and are meant to be calibrated against the real game later.
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
  kind: "punch" | "kick" | "head";
}

export const MOVES: Record<string, Move> = {
  jab1: { id: "jab1", startup: 6, active: 3, recovery: 12, dmg: 4, hitstun: 18, blockstun: 10, height: "high", reach: 1.25, arc: 0.55, push: 0.15, knockdown: false, next: "jab2", kind: "punch" },
  jab2: { id: "jab2", startup: 7, active: 3, recovery: 14, dmg: 5, hitstun: 20, blockstun: 10, height: "high", reach: 1.25, arc: 0.55, push: 0.2, knockdown: false, next: "jab3", kind: "punch" },
  jab3: { id: "jab3", startup: 7, active: 3, recovery: 14, dmg: 5, hitstun: 20, blockstun: 10, height: "high", reach: 1.3, arc: 0.55, push: 0.2, knockdown: false, next: "punchFin", kind: "punch" },
  punchFin: { id: "punchFin", startup: 10, active: 4, recovery: 22, dmg: 9, hitstun: 0, blockstun: 14, height: "high", reach: 1.4, arc: 0.5, push: 1.4, knockdown: true, kind: "punch" },
  kick1: { id: "kick1", startup: 8, active: 3, recovery: 16, dmg: 5, hitstun: 20, blockstun: 12, height: "low", reach: 1.45, arc: 0.5, push: 0.2, knockdown: false, next: "kick2", kind: "kick" },
  kick2: { id: "kick2", startup: 9, active: 3, recovery: 16, dmg: 6, hitstun: 22, blockstun: 12, height: "low", reach: 1.45, arc: 0.5, push: 0.25, knockdown: false, next: "sweep", kind: "kick" },
  sweep: { id: "sweep", startup: 11, active: 4, recovery: 24, dmg: 7, hitstun: 0, blockstun: 14, height: "low", reach: 1.6, arc: 0.35, push: 0.8, knockdown: true, kind: "kick" },
  // No arms: Square becomes a slow headbutt.
  headbutt: { id: "headbutt", startup: 12, active: 3, recovery: 20, dmg: 6, hitstun: 22, blockstun: 12, height: "high", reach: 0.95, arc: 0.6, push: 0.5, knockdown: false, kind: "head" },
};

export const STRING_STARTS = { high: "jab1", low: "kick1" } as const;

export const GRAB = { startup: 5, active: 3, whiff: 24, reach: 1.05, arc: 0.6 };
export const HOLD = { dur: 90, escape: 12, knee: 6, kneeCool: 18, kneeMax: 3 };
export const THROW = { dur: 24, dist: 4, dmg: 12, splash: 6 };
export const REVERSAL = { window: 8, dur: 22, stun: 30, dmg: 8, pushR: 2.5, push: 1.6, pushStun: 14 };
export const DOWN = { dur: 50, wake: 20, wakeInvuln: 30, otgScale: 0.5 };
export const CROWD = { attackers: 3, window: 60, invuln: 40 };
export const COMBO_SCALE = 0.85;
export const COMBO_FLOOR = 0.4;
export const DIZZY = { dur: 90, headReset: 20 };
export const KO_FRAMES = 180;
export const RESPAWN_INVULN = 90;
export const REATTACH = { dur: 30, range: 1.1, hpFrac: 0.5 };
export const REGROW_FRAMES = 720;
export const SIT_FRAMES = 20;
export const GEYSER = { warn: 60, erupt: 20, radius: 1.3, dmg: 10, minGap: 240, maxGap: 420 };
export const LAVA = { tick: 10, dmg: 2 };
export const SPEED = { walk: 0.05, guard: 0.02, hop: 0.045, crawl: 0.0133 };
export const HOP_CYCLE = 24;
export const HOP_AIR = 14;
export const BUFFER = 8; // input buffer for presses, frames
