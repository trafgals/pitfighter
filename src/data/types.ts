// The shapes the character design must have.
//
// The design itself lives in `src/data/characters.json`: one entry per fighter,
// and the frame data of the six specials. This file is the contract that
// JSON has to meet, and it holds no imports at all, so anything may read it.
//
// Nothing here is behaviour. The game reads the design through
// `src/data/characters.ts`; the tools that generate assets from it read the
// same file. One source, so a fighter's stats, silhouette, face and textures
// can never describe two different fighters.

/** Which way a strike comes in. */
export type Height = "high" | "low";

/** A move's frame data: 60 Hz frames and metres. */
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

/** The six specials a fighter can have. */
export type SpecialId = "spSpin" | "spCharge" | "spFlurry" | "spSlam" | "spBlade" | "spFire";

/** A special: its frame data and the name the HUD shouts. */
export interface Special {
  name: string;
  move: Move;
}

/** The shape of a fighter's horns. */
export type Horns = "goat" | "bull" | "ram" | "long" | "swept" | "nubs" | "spikes" | "broken" | "crown";
/** The shape of a fighter's tail. */
export type Tail = "spade" | "long" | "stub" | "barbed";
/** A piece of gear a fighter wears. */
export type Gear =
  | "mohawk"
  | "topknot"
  | "beard"
  | "headband"
  | "gloves"
  | "pauldrons"
  | "spines"
  | "wings"
  | "beret"
  | "kasa"
  | "stetson"
  | "lanyard"
  | "obi"
  | "tusks"
  | "title";

/** What makes a fighter read as itself from across the pit, before any colour. */
export interface Kit {
  /** the body's scale (1: an ordinary devil) */
  size: number;
  horns: Horns;
  tail: Tail;
  gear: Gear[];
}

/** How a fighter's face and skin are painted. */
export interface Look {
  def: number; // how cut the muscles are, about 0.7..1.3
  scar: 0 | 1 | 2 | 3; // none, through the left eye, across the right cheek, claw marks on the chest
  paint: 0 | 1 | 2 | 3; // none, eye black, stripes, a skull mask
  wrinkles: boolean;
  stubble: boolean;
  veins: boolean;
}

/** The animation family a fighter fights in. */
export type Family = "boxing" | "karate" | "muay" | "kungfu" | "brawler" | "power" | "grappler" | "kicker";

/** A fighter's numbers: what it is like in a fight. */
export interface Stats {
  speed: number; // walk speed multiplier
  startup: number; // frames added to every strike's startup (negative = faster); sized for the 12f jab
  punch: number; // punch damage multiplier
  kick: number; // kick damage multiplier
  grab: number; // throw / knee damage multiplier
  reach: number; // strike reach multiplier
  string: number; // high-string length before the finisher (1..3 jabs)
  torso: number; // torso HP multiplier
  grabReach: number;
}

/** One surface of a fighter: what it looks like and what it is made of. */
export interface TextureIdea {
  idea: string;
  colour: string;
}

/** A fighter's textures: the hide, the cloth and the face. */
export interface Texture {
  seed: number;
  skin: TextureIdea;
  cloth: TextureIdea;
  face: TextureIdea;
}

/** One fighter, whole. */
export interface Character {
  id: string; // the slug: stable, and the key for public/tex and public/sfx
  name: string;
  style: string; // the Urban Reign style label
  blurb: string;
  body: string; // the body colour, as "#rrggbb"
  accent: string; // the horns and trim
  family: Family;
  special: SpecialId;
  stats: Stats;
  kit: Kit;
  look: Look;
  texture: Texture;
}

/** A fighter as the sim has always seen it: the colours as numbers, the stats flat. */
export interface Style {
  style: string;
  name: string;
  blurb: string;
  color: number; // body colour
  accent: number; // horns / trim
  speed: number;
  startup: number;
  punch: number;
  kick: number;
  grab: number;
  reach: number;
  string: number;
  torso: number;
  grabReach: number;
  special: SpecialId;
}
