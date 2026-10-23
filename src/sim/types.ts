// Shared simulation types and constants. Everything here is plain data so a
// world can be hashed, cloned and replayed.

import type { StageId } from "./stages";

export const FPS = 60;

// Sim space is a 2D plane: x to the right, y "north" (away from the camera).
export const RING_R = 9; // fighting floor radius
export const LAVA_R = 10.6; // outer wall; between RING_R and LAVA_R is hellfire (Hell Toilet stage)
export const SPAWN_R = 8;
export const TOILET_R = 0.95; // how close you must be to sit down
export const TOILET_FRAMES = 900; // seated frames needed to win (15 s in total; progress is kept between sittings)

// Buttons (bitmask). Pad mapping lives in src/input.ts.
export const BTN = {
  HIGH: 1, // Square: high strike string
  LOW: 2, // Cross: low strike string
  GRAB: 4, // Circle: grapple; in a hold, throw
  REV: 8, // Triangle: high reversal (R1+Triangle: low reversal)
  GUARD: 16, // R1
  TARGET: 32, // L1: switch soft-lock target
  USE: 64, // R2: pick up limb / sit on the toilet
} as const;

export interface PlayerInput {
  x: number; // stick, -1..1
  y: number; // stick, -1..1 (up = +1 = north)
  buttons: number;
}

export const NO_INPUT: PlayerInput = { x: 0, y: 0, buttons: 0 };

export type PartId = "head" | "torso" | "armL" | "armR" | "legL" | "legR";
export const PARTS: PartId[] = ["head", "torso", "armL", "armR", "legL", "legR"];
export const LIMBS: PartId[] = ["armL", "armR", "legL", "legR"];

export interface Part {
  hp: number;
  max: number;
  attached: boolean;
  regrow: number; // frames until a limb burnt in the lava grows back (0 = not regrowing)
}

export type Height = "high" | "low";

export type FighterState =
  | "idle"
  | "walk"
  | "guard"
  | "attack"
  | "hitstun"
  | "blockstun"
  | "reversal"
  | "reversed"
  | "holding"
  | "held"
  | "thrown"
  | "down"
  | "wakeup"
  | "dizzy"
  | "reattach"
  | "sitting"
  | "seated"
  | "ko";

export interface Fighter {
  id: number;
  style: number;
  human: boolean;
  spawnX: number;
  spawnY: number;
  x: number;
  y: number;
  facing: number; // radians, 0 = +x
  slideX: number; // knockback velocity (m/frame), decays
  slideY: number;
  state: FighterState;
  t: number; // frames spent in the current state
  dur: number; // planned length of the current state (0 = open ended)
  move: string | null;
  moveHits: number[]; // fighter ids this move instance already hit
  moveLanded: boolean;
  chain: boolean; // a follow-up of the current string is buffered
  chargeHeld: boolean; // the string opener's button has stayed down since the press, so it can still charge
  charge: number; // frames the current strike was charged (0..CHARGE.max)
  revHeight: Height;
  target: number;
  parts: Record<PartId, Part>;
  invuln: number;
  combo: number;
  recentHits: { by: number; f: number }[];
  partner: number; // holding / held partner
  holdStrikes: number;
  holdCool: number;
  hopPhase: number;
  reattachPart: PartId | null;
  reattachPickup: number;
  prevButtons: number;
  pressed: number[]; // frame each button was last pressed (input buffer)
  toilet: number; // seated progress in frames, kept between sittings
  kos: number;
  deaths: number;
}

export interface Pickup {
  id: number;
  owner: number;
  part: PartId;
  hp: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  burning: number; // >0: sinking into the lava, frames left
}

export interface Geyser {
  x: number;
  y: number;
  t: number; // frames since it appeared; erupts at GEYSER_WARN
}

export interface GameEvent {
  f: number;
  kind:
    | "hit"
    | "block"
    | "reversal"
    | "grab"
    | "throw"
    | "detach"
    | "reattach"
    | "burn"
    | "regrow"
    | "ko"
    | "respawn"
    | "sit"
    | "unseat"
    | "geyser"
    | "win"
    | "crowd"
    | "punt"
    | "dizzy";
  a: number; // actor
  b?: number; // other party
  part?: PartId;
  dmg?: number;
}

export interface WorldState {
  frame: number;
  seed: number;
  stage: StageId;
  fighters: Fighter[];
  pickups: Pickup[];
  nextPickupId: number;
  geysers: Geyser[];
  nextGeyser: number;
  toiletOccupant: number;
  winner: number;
  events: GameEvent[]; // events of the most recent step only
}
