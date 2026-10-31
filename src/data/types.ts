// The shapes the character design must have.
//
// The design itself lives in `src/data/characters.json`: the world, the limb
// crafts, the move vocabulary, the systems, the frame data of the six specials,
// and one entry per fighter. This file is the contract that JSON has to meet,
// and it holds no imports at all, so anything may read it.
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

/** The shape of a fighter's horns: the twelve fighters of Old Sorrow wear none. */
export type Horns = "none";
/** The shape of a fighter's tail: the twelve fighters of Old Sorrow wear none. */
export type Tail = "none";
/** A piece of gear a fighter wears in Old Sorrow. */
export type Gear =
  | "topknot"
  | "beard"
  | "headband"
  | "gloves"
  | "pauldrons"
  | "obi"
  | "title"
  | "custodian"
  | "whiskers"
  | "pistons"
  | "flatcap"
  | "nursecap"
  | "tophat"
  | "monocle"
  | "stovepipe"
  | "bowler"
  | "goggles"
  | "weepers"
  | "moustache";

/** What makes a fighter read as itself from across the pit, before any colour. */
export interface Kit {
  /** the body's scale (1: an ordinary fighter) */
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

/** A fighter's textures: the hide, the cloth, the face, and the craft of its limbs. */
export interface Texture {
  seed: number;
  skin: TextureIdea;
  cloth: TextureIdea;
  face: TextureIdea;
  limb: TextureIdea;
}

/** How an air grab ends (src/sim/airgrabs.ts). */
export type AirGrabEnd = "down" | "bounce" | "throw" | "limb";

/** A fighter's air grab: frames from the catch. */
export interface AirGrab {
  name: string;
  dur: number; // the attacker's frames, catch to recovered
  slam: number; // the frame the victim hits the floor
  lift: number; // metres the victim is carried up before the slam
  dmg: number;
  end: AirGrabEnd;
  dist?: number; // throw: how far
}

// ---------------------------------------------------------------- the moveset
//
// Every move a fighter has, written as design: what it is, where it sits in the
// vocabulary (its archetype, whose frame envelope it must keep to), and how it
// looks and sounds. Most of it is not in the game yet: `systems` says which
// verbs are, and `sim` on a move names the sim move that stands in for it today.

/** A strike: frames are 60 Hz, `startup` the first active frame counted from 0. */
export interface StrikeDesign {
  id: string;
  name: string;
  input: string;
  archetype: string; // a key of vocabulary.strikes
  limb: string;
  height: "high" | "mid" | "low";
  startup: number;
  active: number;
  recovery: number;
  dmg: number;
  hits?: number;
  knockdown?: boolean;
  launch?: boolean;
  target?: "head" | "body" | "legs"; // the regional strikes
  sim?: string; // the sim move (src/sim/moves.ts) that plays it today
  anim: string;
  sfx: string;
  vfx: string;
}

/** A grapple-class action: one duration, catch to recovered. */
export interface GrappleDesign {
  id: string;
  name: string;
  input: string;
  archetype: string; // a key of vocabulary.grapples
  duration: number;
  dmg: number;
  end?: "throw"; // the throw flings them away rather than dropping them
  sim?: string;
  anim: string;
  sfx: string;
  vfx?: string;
}

/** Everything a fighter can do: the full Urban Reign verb set, in Pitfighter's buttons. */
export interface Moveset {
  high: StrikeDesign[]; // the high string, opener to finisher: stats.string + 1 strikes
  low: StrikeDesign[]; // the low string: three strikes
  branches: StrikeDesign[];
  regional: StrikeDesign[];
  dash: StrikeDesign[];
  dive: StrikeDesign[];
  down: StrikeDesign[];
  headbutt: StrikeDesign[];
  double: StrikeDesign[];
  hold: GrappleDesign;
  clinch: GrappleDesign[];
  throws: GrappleDesign[]; // △, ← △, ↓ △, → △ in the hold
  back: GrappleDesign;
  wall: GrappleDesign;
  grappleDash: GrappleDesign;
  diveGrab: GrappleDesign;
  ground: GrappleDesign;
  deflects: GrappleDesign[];
  special: { name: string; sim: SpecialId; anim: string; sfx: string; vfx: string };
  arts: (StrikeDesign | GrappleDesign)[]; // R2 + ↑, →, ↓, ←
  status: { name: string; drink: number; lasts: number; anim: string; effects: { note: string } & Record<string, number | string>; look: string; voice: string };
  duo: { partner: string; name: string; archetype: "cinematic"; duration: number; dmg: number; anim: string };
  weapons: { affinity: string[]; signature: string; style: string };
  appeal: { anim: string; line: string; gift: string };
}

/** One of the Gallery's throws: a weapon it can toss into the pit. */
export interface GalleryThrow {
  id: string;
  name: string;
  /** the kind of weapon it is: what a fighter's affinity is matched against */
  class: string;
  hands: number;
  look: string;
  sound: string;
  /** how much the Gallery favours throwing it; -1 is never thrown */
  favour: number;
}

/** A colour, named. */
export interface Swatch {
  hex: string;
  name: string;
}

/** A sound to generate, in tools/sfx/prompts.json's shape. */
export interface SoundCue {
  id: string;
  category: string;
  note: string;
  prompt: string;
  seed: number;
}

/** Who a fighter is: everything the writers, the artists and the voice need. */
export interface Profile {
  age: number;
  from: string;
  trade: string;
  height: string;
  bio: string;
  personality: string;
  manners: string;
  violence: string;
  otherSelf: string;
  rivals: { id: string; why: string }[];
  partner: { id: string; why: string };
  quotes: { intro: string; appeal: string; victory: string; defeat: string };
}

/** The craft a fighter's limbs are made in (`crafts`), and how it sits on this body. */
export interface Limbs {
  craft: string;
  arms: string;
  legs: string;
  tip: string;
  lean: { mass: number; length: number; swing: number };
  wear: string;
}

/** The brief for the artists. */
export interface Art {
  silhouette: string;
  build: string;
  palette: { primary: Swatch; secondary: Swatch; metal: Swatch; light: Swatch };
  costume: string;
  alternates: { name: string; note: string }[];
  limbs: string;
  face: string;
  hair: string;
  gore: string;
  vfx: string[];
  idle: string;
  intro: string;
  victory: string;
  defeat: string;
  portrait: string;
}

/** The brief for the voice, the sound and the music. */
export interface Sound {
  voice: { casting: string; accent: string; texture: string };
  lines: { intro: string[]; appeal: string[]; hit: string[]; hurt: string[]; special: string; tincture: string; victory: string[]; defeat: string };
  efforts: string;
  footsteps: string;
  foley: string;
  impact: { craft: string; nuance: string };
  music: { title: string; brief: string; tempo: number; instruments: string[] };
  cues: SoundCue[];
}

/** One fighter, whole. */
export interface Character {
  id: string; // the slug: stable, and the key for public/tex and public/sfx
  name: string;
  style: string; // the Urban Reign style label
  blurb: string;
  body: string; // the body colour, as "#rrggbb"
  accent: string; // the trim
  family: Family;
  special: SpecialId;
  specialName: string; // what the HUD shouts when this fighter does its special
  stats: Stats;
  kit: Kit;
  look: Look;
  airGrab: AirGrab;
  short: string; // the name on the HUD
  title: string;
  lineage: string[]; // the Urban Reign styles it stands for
  ratings: { power: number; speed: number; reach: number; grapple: number; defence: number; technique: number; difficulty: number }; // 1..5
  profile: Profile;
  limbs: Limbs;
  moves: Moveset;
  art: Art;
  sound: Sound;
  texture: Texture;
}

/** A fighter as the sim has always seen it: the colours as numbers, the stats flat. */
export interface Style {
  style: string;
  name: string;
  blurb: string;
  color: number; // body colour
  accent: number; // trim
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
  specialName: string;
  airGrab: AirGrab;
}
