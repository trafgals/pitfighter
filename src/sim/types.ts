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

// Buttons (bitmask), laid out as Urban Reign's: Circle strikes, Triangle
// grapples, Square dodges / deflects, Cross runs. Pad mapping lives in src/input.ts.
export const BTN = {
  HIGH: 1, // Circle: the strike string (with the stick pulled back: the low string)
  LOW: 2, // the low string straight away (CPUs and tests; a pad gets it with back + Circle)
  GRAB: 4, // Triangle: grapple, or pick up a limb; in a hold, throw
  REV: 8, // Square: deflect (stick neutral) or evade (with a direction); held, break free
  LOCK: 16, // R1, held: lock on to the target and strafe round it
  TARGET: 32, // R3: switch target
  USE: 64, // L1: pick up a limb / sit on the toilet / get in or out of a vehicle
  SPECIAL: 128, // R2 (or Circle + Triangle together): the style's special, costs fury
  TAUNT: 256, // L2: taunt; a whole one fills fury
  DASH: 512, // Cross: a burst of speed; held, run
} as const;
/** Urban Reign's names for the two face buttons that changed meaning */
export const STRIKE = BTN.HIGH;
export const DODGE = BTN.REV;

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
  /** the style the limb came from: its own fighter's, or whoever it was torn off (a transplant fights like its first owner) */
  style: number;
}

export type Height = "high" | "low";

export type FighterState =
  | "idle"
  | "walk"
  | "dash" // Cross: a burst along the stick
  | "evade" // Square with a direction: a sidestep that nothing touches
  | "taunt" // L2
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
  | "driving" // in a construction vehicle (Construction Site)
  | "falling" // off the edge: eliminated, or dead and respawning, when it ends
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
  dirX: number; // the direction of a dash or an evade (unit)
  dirY: number;
  running: boolean; // Cross held while moving
  state: FighterState;
  t: number; // frames spent in the current state
  dur: number; // planned length of the current state (0 = open ended)
  move: string | null;
  moveHits: number[]; // fighter ids this move instance already hit
  moveLanded: boolean;
  chain: boolean; // a follow-up of the current string is buffered
  chargeHeld: boolean; // the string opener's button has stayed down since the press, so it can still charge
  charge: number; // frames the current strike was charged (0..CHARGE.max)
  stop: number; // hitstop: frames this fighter stays frozen after a hit it gave or took
  fury: number; // special meter, 0..FURY.max; filled by landing and taking hits
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
  toilet: number; // objective progress in frames (seated on the toilet, holding the banner), kept between turns
  kos: number;
  deaths: number;
  vehicle: number; // the vehicle this fighter drives, -1 on foot
  out: boolean; // eliminated (stages without respawns)
  lastHitBy: number; // who hit this fighter last (-1: nobody or the arena), credited with a fall
}

export interface Pickup {
  id: number;
  owner: number;
  part: PartId;
  /** the style of the fighter the limb grew on, which it keeps wherever it is attached */
  style: number;
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

/** what the arena throws at the fighters: it warns, then strikes (see HAZARDS) */
export type HazardKind = "geyser" | "beam" | "boulder" | "arrows";

export interface Geyser {
  kind: HazardKind;
  x: number;
  y: number;
  t: number; // frames since it appeared; strikes at HAZARDS[kind].warn
}

export type VehicleKind = "bulldozer" | "excavator" | "dumptruck" | "forklift" | "roller" | "mixer" | "loader" | "crane";

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  facing: number;
  speed: number; // m/frame along facing (negative: reversing)
  hp: number;
  max: number;
  driver: number; // fighter id, -1 parked
  boost: number; // frames of boost left
  cool: number; // frames until the next boost
  wrecked: boolean;
  lastBy: number; // who damaged it last
}

/** Stage-specific state. Every stage has every field; the ones it does not use stay at their defaults. */
export interface ArenaState {
  vehicles: Vehicle[]; // Construction Site
  tiles: number[]; // Collapsing Tower: 0 intact, >0 frames cracking, -1 fallen
  nextCrack: number;
  fireX: number; // Hindenburg Blimp: the deck burns beyond this x
  wind: number; // Hindenburg Blimp: <0 a gust is coming (frames to go, counting up), >0 gust frames left
  windDir: number; // +1 / -1: the gust blows toward +y / -y
  nextWind: number;
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
    | "dizzy"
    | "special"
    | "fall" // went over the edge
    | "crash" // a vehicle hit a wall, another vehicle or a strike
    | "wreck"
    | "enter"
    | "exit"
    | "crack" // a floor tile starts to give way
    | "collapse"
    | "wind"
    | "impact" // the blimp hits the ground
    | "capture";
  a: number; // actor
  b?: number; // other party
  part?: PartId;
  dmg?: number;
  stop?: number; // the hitstop the event froze both parties for
  what?: string; // detail: the hazard kind, "fall" on a KO by falling, "warn" / "gust" on wind
  x?: number; // where, for events without a fighter at the spot
  y?: number;
}

export interface WorldState {
  frame: number;
  seed: number;
  stage: StageId;
  fighters: Fighter[];
  pickups: Pickup[];
  nextPickupId: number;
  geysers: Geyser[]; // the arena's hazards (geysers, falling beams, boulders, arrow volleys)
  nextGeyser: number; // frame of the next hazard
  toiletOccupant: number; // the fighter holding the objective (toilet, banner), -1 none
  arena: ArenaState;
  winner: number;
  events: GameEvent[]; // events of the most recent step only
}
