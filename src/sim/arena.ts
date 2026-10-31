// The rules of each stage: where fighters spawn, what keeps them in (walls) or
// lets them fall out (edges), what the arena throws at them, the stage's
// objective and how a match is won. The World runs the fight itself and asks
// the stage's Arena at fixed points of every step, so a stage never changes
// how strikes, grapples or reversals work.
//
// Like the World, an Arena is deterministic: all randomness goes through
// `w.rng`, in a fixed order.
import { BTN, LAVA_R, LIMBS, RING_R, SPAWN_R, TOILET_FRAMES, TOILET_R, type ArenaState, type Fighter, type HazardKind, type OnFloor, type PlayerInput, type Sack, type Vehicle, type VehicleKind } from "./types";
import { WEAPONS } from "./weapons";
import { GEYSER, HITSTOP, LAVA, SIT_FRAMES, VIOLENCE, type Move, hitstopFor } from "./moves";
import type { StageId } from "./stages";
import { BODY_R, alive, dist, type World } from "./world";

export interface Spawn {
  x: number;
  y: number;
  facing: number;
}

/** What each hazard does when it strikes, `warn` frames after it appears. */
export const HAZARDS: Record<HazardKind, { warn: number; erupt: number; radius: number; dmg: number; knock: boolean }> = {
  geyser: { warn: GEYSER.warn, erupt: GEYSER.erupt, radius: GEYSER.radius, dmg: GEYSER.dmg, knock: true },
  beam: { warn: 80, erupt: 45, radius: 1.1, dmg: 14, knock: true }, // Construction Site: a crane drops a steel beam
  boulder: { warn: 75, erupt: 50, radius: 1.4, dmg: 16, knock: true }, // Castle Under Siege: a catapult stone
  arrows: { warn: 55, erupt: 16, radius: 2.0, dmg: 5, knock: false }, // Castle Under Siege: an arrow volley
};


export const YARD = { hx: 10, hy: 7 };
export const VEHICLE_KINDS: VehicleKind[] = ["bulldozer", "excavator", "dumptruck", "forklift", "roller", "mixer", "loader", "crane"];
/** speed m/frame, accel m/frame², turn rad/frame, hp, ram damage at full speed, collision radius m */
export const VEHICLES: Record<VehicleKind, { name: string; speed: number; accel: number; turn: number; hp: number; ram: number; r: number }> = {
  bulldozer: { name: "Bulldozer", speed: 0.11, accel: 0.004, turn: 0.035, hp: 130, ram: 28, r: 1.15 },
  excavator: { name: "Excavator", speed: 0.09, accel: 0.0035, turn: 0.03, hp: 150, ram: 26, r: 1.2 },
  dumptruck: { name: "Dump Truck", speed: 0.15, accel: 0.005, turn: 0.034, hp: 100, ram: 26, r: 1.15 },
  forklift: { name: "Forklift", speed: 0.16, accel: 0.007, turn: 0.06, hp: 80, ram: 17, r: 0.8 },
  roller: { name: "Steamroller", speed: 0.08, accel: 0.003, turn: 0.03, hp: 160, ram: 40, r: 1.1 },
  mixer: { name: "Cement Mixer", speed: 0.13, accel: 0.0045, turn: 0.034, hp: 115, ram: 26, r: 1.15 },
  loader: { name: "Loader", speed: 0.12, accel: 0.005, turn: 0.045, hp: 100, ram: 22, r: 1.0 },
  crane: { name: "Crane Truck", speed: 0.1, accel: 0.0038, turn: 0.03, hp: 140, ram: 27, r: 1.2 },
};
export const BOOST = { dur: 30, cool: 150, mult: 1.6 };
export const PIT = { x: 0, y: 0, r: 1.7, need: 14 }; // the foundation pit: fill it first
export const SACKS = { start: 5, first: 120, gap: [100, 190] as const, cap: 5, pick: 0.95 }; // cap: sacks in the yard, plus one per fighter
/** how much (in sacks' worth) each machine hauls */
export const HAUL: Partial<Record<VehicleKind, number>> = { dumptruck: 6, loader: 4, forklift: 2 };
/** how far past its own radius each machine can grab someone (the strike button's partner) */
const GRAB: Partial<Record<VehicleKind, number>> = { excavator: 2.6, forklift: 1.4, loader: 2.0 };
/** the implement attack on the strike button: length, cooldown after it, the frame it lands, the surge it drives the machine forward at */
export const ACTS: Record<VehicleKind, { name: string; dur: number; cool: number; hit: number; surge?: number; surgeFor?: number }> = {
  bulldozer: { name: "Blade pin", dur: 44, cool: 120, hit: 0, surge: 1.3 },
  excavator: { name: "Bucket slam", dur: 44, cool: 100, hit: 24 },
  dumptruck: { name: "Tip the load", dur: 70, cool: 200, hit: 36 },
  forklift: { name: "Skewer", dur: 28, cool: 60, hit: 8, surge: 1.6, surgeFor: 14 },
  roller: { name: "Roll out", dur: 48, cool: 140, hit: 0, surge: 1.9 },
  mixer: { name: "Pour cement", dur: 56, cool: 160, hit: 0 },
  loader: { name: "Scoop", dur: 26, cool: 70, hit: 8 },
  crane: { name: "Wrecking ball", dur: 80, cool: 200, hit: 16 },
};
export const BALL_R = 3.4; // the wrecking ball's swing
export const SLICK = { r: 1.15, set: 200, gone: 720, max: 14 }; // poured cement: wet for `set` frames, hard till `gone`
export const REPAIR = { frames: 300, hpFrac: 0.5, range: 1.1, tow: 900 }; // hold USE at a wreck for 5 s; the tow truck brings one back after 15 s if too few run
const BURIED = 170; // frames down under a tipped load
const STUCK = 140; // frames down in set cement
const FLAT = 130; // frames down under a steamroller
const CARRY_MAX = 220; // a machine drops whoever it holds after this long
const CARRYING = new Set(["idle", "walk", "dash", "evade", "attack", "taunt", "reversal"]); // states a fighter keeps a sack in
const RAM_MIN = 0.045; // slower than this, a vehicle only shoves
const CRASH_MIN = 0.085; // closing speed (m/frame) at which two machines crash

export const TOWER = { tile: 2, n: 8, crack: 90, first: 480, gapStart: 140, gapEnd: 45, rampFrames: 60 * 120 };
export const BLIMP = {
  half: 10, // the deck runs from x = -10 (the nose) to x = 10 (the tail)
  width: 3.2, // half width
  fireStart: 900,
  fireSpeed: 0.0035,
  fireStop: -3.5,
  crashAt: 1800, // the frame the burning blimp hits the ground (30 s)
  brace: 300, // the last frames before the impact: "BRACE FOR IMPACT"
  impactDmg: 18, // the impact knocks everyone down and hurts
  // in the wreck everyone burns, every tick frames, a little more every second:
  // burnBase + burnRamp per second since the impact
  burnTick: 10,
  burnBase: 0.4,
  burnRamp: 0.06,
  wreckFor: 1800, // the wreck burns out this long after the impact: whoever has the most limbs on then wins
  wreckFire: 0.004, // how fast the fire creeps over the rest of the wreck (m/frame): the nose goes last
  windFirst: 900, // the first gust: give everyone a moment on deck
  windMin: 540,
  windMax: 720,
  windWarn: 60,
  windDur: 110,
  windPush: 0.018,
};
export const CASTLE = {
  hx: 9,
  hy: 5.5,
  bannerR: 1.6,
  bannerFrames: 600, // frames at the pole to raise the banner (10 s alone)
  contested: 0.5, // how fast it rises while someone else stands in the circle too
  // gaps the siege has knocked in the parapet: knock someone through and they fall off the wall
  breaches: [
    { x0: -5.5, x1: -3, side: -1 },
    { x0: 3, x1: 5.5, side: 1 },
  ],
  hazardGap: [200, 340] as const,
  arrows: 0.35, // share of the hazards that are arrow volleys
};

export function freshArenaState(): ArenaState {
  return { vehicles: [], tiles: [], nextCrack: 0, fireX: BLIMP.half + 1, wind: 0, windDir: 1, nextWind: 0, sacks: [], nextSack: 0, nextSackId: 0, slicks: [], piles: [] };
}

/** The Hell Toilet spawns: a ring around the edge of the floor, everyone facing the toilet. */
export function spawnPoints(n: number): Spawn[] {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = Math.cos(a) * SPAWN_R;
    const y = Math.sin(a) * SPAWN_R;
    out.push({ x, y, facing: Math.atan2(-y, -x) });
  }
  return out;
}

function ellipseSpawns(n: number, rx: number, ry: number): Spawn[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    return { x, y, facing: Math.atan2(-y, -x) };
  });
}

/** A bot's goal: where to go, and whether to press USE when it gets there. */
export interface Goal {
  x: number;
  y: number;
  use: boolean;
  /** hold USE rather than tapping it (repairing a wreck) */
  hold?: boolean;
}

/** The line over the scoreboard: who holds the objective and how far along they are. */
export interface Headline {
  text: string;
  frac: number;
  who: number; // the fighter it is about (bar colour), -1 none
}

export abstract class Arena {
  abstract readonly id: StageId;
  /** Fighters who fall come back; false: a fall eliminates, and the last one standing wins */
  abstract readonly respawn: boolean;
  abstract spawns(n: number): Spawn[];
  /** Where a KO'd fighter comes back: their own spawn point, unless the stage has taken it away. */
  respawnAt(_w: World, f: Fighter): { x: number; y: number } {
    return { x: f.spawnX, y: f.spawnY };
  }
  init(_w: World): void {}
  /** Walls, solid props, burning ground and edges for one fighter, after it moved. */
  abstract bound(w: World, f: Fighter): void;
  /** Whether a fighter may walk to (x, y). Walking never takes you over an edge; knockback does. */
  canWalk(_w: World, _f: Fighter, _x: number, _y: number): boolean {
    return true;
  }
  abstract boundPickup(w: World, p: OnFloor): void;
  /** The nearest spot to (x, y) where a thing on the floor stays put: where a limb that went over the edge or into the fire washes back up. */
  floorNear(_w: World, x: number, y: number): { x: number; y: number } {
    return { x, y };
  }
  /**
   * Whether a thing that falls to the floor at (x, y) stays there.
   *
   * This is the question the Gallery's gift asks before it drops one: a gift
   * that lands in the fire round the pit, or on a deck that has gone, is a
   * gift nobody can pick up.
   */
  canLand(_w: World, _x: number, _y: number): boolean {
    return true;
  }
  /** Hazards, the objective and the win, once per step after physics. */
  abstract update(w: World): void;
  /** The stage's USE action (sit down, get in or out of a vehicle). */
  use(_w: World, _f: Fighter): boolean {
    return false;
  }
  /** A strike or grab landed on `d`. */
  onHit(_w: World, _d: Fighter): void {}
  onKo(_w: World, _d: Fighter): void {}
  /** A driving fighter's step (Construction Site). */
  drive(_w: World, _f: Fighter, _inp: PlayerInput): void {}
  /** Strikes against the stage's objects (vehicles). */
  strikeObjects(_w: World, _f: Fighter, _m: Move & { total: number }): void {}
  /** For bots: is (x, y) a bad place for `me` to stand? */
  abstract danger(w: World, me: Fighter, x: number, y: number): boolean;
  /** For bots: somewhere safe to retreat to. */
  abstract safe(w: World, me: Fighter): { x: number; y: number };
  /** For bots: the stage's objective, if it is worth going for now. */
  botGoal(_w: World, _me: Fighter, _enemies: Fighter[]): Goal | null {
    return null;
  }
  /** For bots: which way to throw someone (into the hazard, over the edge). */
  throwAngle(_w: World, me: Fighter): number {
    return Math.atan2(me.y, me.x);
  }
  /** For bots: keep a wandering goal on the floor. */
  abstract clampGoal(x: number, y: number): { x: number; y: number };
  /** The fighter's score toward a win, 0..1; null when the stage keeps none (last one standing). */
  progress(_f: Fighter): number | null {
    return null;
  }
  abstract headline(w: World): Headline | null;
  hash(_mix: (v: number) => void, _a: ArenaState): void {}
}

const standing = (f: Fighter) => alive(f) && !["down", "wakeup", "thrown", "driving"].includes(f.state);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const nm = (f: Fighter) => `P${f.id + 1}`;

/**
 * The shared hazard loop: `spawn` picks the next hazard (rng calls in a fixed
 * order), then every hazard warns and strikes the fighters (and vehicles) in
 * its radius.
 */
function runHazards(w: World, spawn: () => { kind: HazardKind; x: number; y: number }, gap: readonly [number, number]): void {
  const s = w.s;
  if (s.frame >= s.nextGeyser) {
    s.geysers.push({ ...spawn(), t: 0 });
    s.nextGeyser = s.frame + Math.round(w.rng.range(gap[0], gap[1]));
  }
  for (const g of s.geysers) {
    g.t++;
    const H = HAZARDS[g.kind];
    if (g.t !== H.warn) continue;
    w.ev({ kind: "geyser", a: -1, what: g.kind, x: g.x, y: g.y });
    leaveDebris(w, g);
    for (const f of s.fighters) {
      if (!alive(f) || f.invuln > 0 || f.state === "down" || f.state === "seated" || f.state === "driving") continue;
      const dx = f.x - g.x;
      const dy = f.y - g.y;
      const d = Math.hypot(dx, dy);
      if (d > H.radius) continue;
      w.ev({ kind: "hit", a: -1, b: f.id, part: "torso", dmg: H.dmg, what: g.kind });
      w.damage(f, "torso", H.dmg, -1);
      if (alive(f) && H.knock) w.knockDown(f, d > 0.01 ? dx / d : 1, d > 0.01 ? dy / d : 0, 1.0);
      else if (alive(f)) w.freeze(f, undefined, HITSTOP.base);
    }
    for (const v of s.arena.vehicles) {
      if (!v.wrecked && Math.hypot(v.x - g.x, v.y - g.y) < H.radius + VEHICLES[v.kind].r) {
        v.hp -= H.dmg * 2;
        v.lastBy = -1;
      }
    }
  }
  s.geysers = s.geysers.filter((g) => g.t < HAZARDS[g.kind].warn + HAZARDS[g.kind].erupt);
}

/** What a hazard leaves on the floor when it has struck: a weapon for whoever gets to it. */
export const DEBRIS: Partial<Record<HazardKind, string>> = { beam: "debris_beam", boulder: "debris_stone", arrows: "debris_arrow" };
/** No more than this much debris lies about at once (older pieces stay; the arena stops adding). */
export const DEBRIS_MAX = 24;

function leaveDebris(w: World, g: { kind: HazardKind; x: number; y: number }): void {
  const prop = DEBRIS[g.kind];
  if (!prop) return;
  const s = w.s;
  const spin = w.rng.range(-0.05, 0.05);
  if (s.gifts.filter((x) => x.prop.startsWith("debris_")).length >= DEBRIS_MAX) return;
  const at = w.arena.canLand(w, g.x, g.y) ? g : w.arena.floorNear(w, g.x, g.y);
  s.gifts.push({
    id: s.nextGiftId++,
    prop,
    throw: "",
    owner: -1,
    x: at.x,
    y: at.y,
    z: 2.5, // it comes down with the hazard
    vx: 0,
    vy: 0,
    vz: 0,
    burning: 0,
    spin,
    dur: WEAPONS[prop].dur,
    hot: 0,
  });
}

/** Burning ground: the fighter takes LAVA.dmg every LAVA.tick frames. */
function burn(w: World, f: Fighter): void {
  if (alive(f) && w.s.frame % LAVA.tick === 0 && f.invuln === 0) {
    w.damage(f, "torso", LAVA.dmg, -1);
    w.ev({ kind: "hit", a: -1, b: f.id, part: "torso", dmg: LAVA.dmg });
  }
}

/**
 * A thing on the floor of an edge stage that slides off the edge (or into
 * fire) washes back: nothing leaves the map. A limb, a gift or a piece of
 * debris is put back on the nearest floor, where it can be picked up again.
 */
function losePickup(w: World, p: OnFloor): void {
  if (p.burning > 0) return;
  if ("part" in p || "prop" in p) {
    const at = w.arena.floorNear(w, p.x, p.y);
    p.x = at.x;
    p.y = at.y;
    p.vx = p.vy = 0;
    return;
  }
  p.burning = 40;
  w.ev({ kind: "burn", a: p.owner });
}

// ===================================================================== Hell Toilet
class HellToilet extends Arena {
  readonly id = "hell-toilet" as const;
  readonly respawn = true;

  spawns(n: number): Spawn[] {
    return spawnPoints(n);
  }

  bound(w: World, f: Fighter): void {
    if (f.state === "seated" || f.state === "sitting") return;
    const r = Math.hypot(f.x, f.y);
    // the toilet is solid
    if (r < 0.55 && w.s.toiletOccupant !== f.id) {
      const k = r > 1e-6 ? 0.55 / r : 0;
      f.x = r > 1e-6 ? f.x * k : 0.55;
      f.y = r > 1e-6 ? f.y * k : 0;
    }
    const wall = LAVA_R - BODY_R;
    if (r > wall) {
      f.x *= wall / r;
      f.y *= wall / r;
      f.slideX = f.slideY = 0;
    }
    if (r > RING_R) burn(w, f);
  }

  boundPickup(w: World, p: OnFloor): void {
    const r = Math.hypot(p.x, p.y);
    if (r > LAVA_R) {
      p.x *= LAVA_R / r;
      p.y *= LAVA_R / r;
      p.vx = p.vy = 0;
    }
    if (p.z === 0 && Math.hypot(p.x, p.y) > RING_R) losePickup(w, p);
  }

  floorNear(_w: World, x: number, y: number): { x: number; y: number } {
    const r = Math.hypot(x, y);
    const max = RING_R - 0.4;
    return r > max ? { x: (x * max) / r, y: (y * max) / r } : { x, y };
  }

  canLand(_w: World, x: number, y: number): boolean {
    // the floor of the pit ends at the ring; past it is the fire
    return Math.hypot(x, y) <= RING_R;
  }

  update(w: World): void {
    runHazards(
      w,
      () => {
        const a = w.rng.range(0, Math.PI * 2);
        const r = w.rng.range(2.5, RING_R - 0.8);
        return { kind: "geyser", x: Math.cos(a) * r, y: Math.sin(a) * r };
      },
      [GEYSER.minGap, GEYSER.maxGap],
    );
    const s = w.s;
    const occ = s.fighters[s.toiletOccupant];
    if (!occ) return;
    if (occ.state !== "seated" && occ.state !== "sitting") {
      s.toiletOccupant = -1;
      return;
    }
    if (occ.state === "seated") {
      occ.toilet++;
      if (occ.toilet >= TOILET_FRAMES) w.win(occ.id);
    }
  }

  use(w: World, f: Fighter): boolean {
    const s = w.s;
    if (s.toiletOccupant >= 0 || Math.hypot(f.x, f.y) >= TOILET_R) return false;
    s.toiletOccupant = f.id;
    w.setState(f, "sitting", SIT_FRAMES);
    f.facing = Math.atan2(-f.spawnY, -f.spawnX) + Math.PI; // face back out at the crowd
    w.ev({ kind: "sit", a: f.id });
    return true;
  }

  danger(_w: World, _me: Fighter, x: number, y: number): boolean {
    return Math.hypot(x, y) > RING_R - 0.4;
  }

  safe(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }

  botGoal(w: World, me: Fighter, enemies: Fighter[]): Goal | null {
    if (w.s.fighters[w.s.toiletOccupant]) return null;
    const r = Math.hypot(me.x, me.y);
    const closer = enemies.filter((e) => Math.hypot(e.x, e.y) < r).length;
    if (closer <= 1 || r < 3) return { x: 0, y: 0, use: r < 0.8 };
    return null;
  }

  clampGoal(x: number, y: number): { x: number; y: number } {
    const r = Math.hypot(x, y);
    const max = RING_R - 0.8;
    return r > max ? { x: (x * max) / r, y: (y * max) / r } : { x, y };
  }

  progress(f: Fighter): number {
    return f.toilet / TOILET_FRAMES;
  }

  headline(w: World): Headline | null {
    const occ = w.s.fighters[w.s.toiletOccupant];
    return occ ? { text: `${nm(occ)} is on the throne!`, frac: occ.toilet / TOILET_FRAMES, who: occ.id } : null;
  }
}

// ===================================================================== Construction Site
class ConstructionSite extends Arena {
  readonly id = "construction-site" as const;
  readonly respawn = true;

  spawns(n: number): Spawn[] {
    return ellipseSpawns(n, 7.4, 4.4);
  }

  /** Everyone starts in a different construction vehicle, and the first sacks are already in the yard. */
  init(w: World): void {
    const vs = w.s.arena.vehicles;
    for (const f of w.s.fighters) {
      const kind = VEHICLE_KINDS[f.id % VEHICLE_KINDS.length];
      const st = VEHICLES[kind];
      vs.push({
        id: f.id,
        kind,
        x: f.x,
        y: f.y,
        facing: f.facing,
        speed: 0,
        hp: st.hp,
        max: st.hp,
        driver: f.id,
        boost: 0,
        cool: 0,
        wrecked: false,
        lastBy: -1,
        act: 0,
        actCool: 0,
        actHit: [],
        carry: -1,
        carryT: 0,
        load: 0,
        wreckT: 0,
        repair: 0,
        repairer: -1,
      });
      f.vehicle = f.id;
      w.setState(f, "driving");
    }
    const n = SACKS.start;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + 0.4;
      this.addSack(w, Math.cos(a) * 4.6, Math.sin(a) * 3.2, i % 3 === 0 ? "cement" : "rubble");
    }
    w.s.arena.nextSack = SACKS.first;
  }

  // ------------------------------------------------------------ sacks and the pit
  private addSack(w: World, x: number, y: number, kind: Sack["kind"]): Sack {
    const a = w.s.arena;
    const sack: Sack = { id: a.nextSackId++, kind, value: kind === "cement" ? 2 : 1, x, y, carrier: -1 };
    a.sacks.push(sack);
    return sack;
  }

  private carried(w: World, f: Fighter): Sack | undefined {
    return w.s.arena.sacks.find((s) => s.carrier === f.id);
  }

  private fill(w: World, f: Fighter, value: number, what: string, x: number, y: number): void {
    f.toilet += value;
    w.ev({ kind: "deliver", a: f.id, dmg: value, what, x, y });
    if (f.toilet >= PIT.need) w.win(f.id);
  }

  private dropSack(w: World, f: Fighter): void {
    const sack = this.carried(w, f);
    if (!sack) return;
    sack.carrier = -1;
    const a = w.rng.range(0, Math.PI * 2);
    sack.x = clamp(f.x + Math.cos(a) * 0.6, -YARD.hx + 0.5, YARD.hx - 0.5);
    sack.y = clamp(f.y + Math.sin(a) * 0.6, -YARD.hy + 0.5, YARD.hy - 0.5);
    w.ev({ kind: "crash", a: f.id, what: "sack", x: sack.x, y: sack.y });
  }

  /** What the machine hauls, and how much (sacks' worth). */
  private capacity(v: Vehicle): number {
    return HAUL[v.kind] ?? 0;
  }

  // ------------------------------------------------------------ driving
  drive(w: World, f: Fighter, inp: PlayerInput): void {
    const v = w.s.arena.vehicles[f.vehicle];
    if (!v || v.wrecked) {
      this.eject(w, f);
      return;
    }
    if (w.buffered(f, BTN.USE)) {
      w.consume(f, BTN.USE);
      this.leave(w, f, v);
      return;
    }
    if (w.buffered(f, BTN.DASH)) {
      w.consume(f, BTN.DASH);
      if (v.cool === 0) {
        v.boost = BOOST.dur;
        v.cool = BOOST.cool;
      }
    }
    if (w.buffered(f, BTN.HIGH)) {
      w.consume(f, BTN.HIGH);
      this.primary(w, f, v);
    }
    if (w.buffered(f, BTN.GRAB)) {
      w.consume(f, BTN.GRAB);
      this.secondary(w, f, v);
    }
    for (const b of [BTN.LOW, BTN.REV, BTN.SPECIAL, BTN.TARGET, BTN.TAUNT]) w.consume(f, b);
    const st = VEHICLES[v.kind];
    const mag = Math.min(1, Math.hypot(inp.x, inp.y));
    let want = 0;
    if (mag > 0.2) {
      // the vehicle turns toward the stick and drives that way, slowing down to turn round
      const ang = Math.atan2(inp.y, inp.x);
      let d = ang - v.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      v.facing += clamp(d, -st.turn, st.turn);
      want = st.speed * mag * Math.max(0, Math.cos(d));
    }
    const surge = this.surge(v);
    if (surge > 0) want = st.speed * surge;
    if (v.boost > 0) want = st.speed * BOOST.mult;
    v.speed += clamp(want - v.speed, -st.accel * 2, st.accel * (v.boost > 0 || surge > 0 ? 3 : 1));
  }

  /** How hard the implement attack drives the machine forward right now (0: it does not). */
  private surge(v: Vehicle): number {
    const A = ACTS[v.kind];
    if (!A.surge || v.act <= 0 || v.act > (A.surgeFor ?? A.dur)) return 0;
    return A.surge;
  }

  /** Strike button: the implement's attack, or what the machine is holding. */
  private primary(w: World, f: Fighter, v: Vehicle): void {
    if (v.carry >= 0) {
      this.release(w, v, v.kind === "excavator" ? "slam" : "throw");
      return;
    }
    if (v.act > 0 || v.actCool > 0) return;
    const A = ACTS[v.kind];
    v.act = 1;
    v.actHit = [];
    v.actCool = A.dur + A.cool;
    w.ev({ kind: "crash", a: f.id, what: `${v.kind}-wind`, x: v.x, y: v.y });
  }

  /** Grab button: take hold of someone (or sacks), or let go of them. */
  private secondary(w: World, _f: Fighter, v: Vehicle): void {
    if (v.carry >= 0) {
      this.release(w, v, v.kind === "excavator" ? "drop" : "set");
      return;
    }
    const reach = GRAB[v.kind];
    if (!reach) return;
    const st = VEHICLES[v.kind];
    let best: Fighter | null = null;
    let bd = 1e9;
    for (const o of w.s.fighters) {
      if (!this.prey(w, o, v)) continue;
      const dx = o.x - v.x;
      const dy = o.y - v.y;
      const d = Math.hypot(dx, dy);
      if (d > st.r + reach || (dx * Math.cos(v.facing) + dy * Math.sin(v.facing)) / (d || 1) < 0.35) continue;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (best) {
      this.seize(w, v, best, v.driver);
      this.maul(w, best, 6, 0.1, v.driver, "grab");
      return;
    }
    if (v.kind === "loader") this.scoopSacks(w, v, st.r + reach);
  }

  /** The loader's bucket takes every sack in front of it. */
  private scoopSacks(w: World, v: Vehicle, reach: number): void {
    const room = this.capacity(v) - v.load;
    let got = 0;
    for (const s of w.s.arena.sacks) {
      if (s.carrier >= 0 || got + s.value > room) continue;
      const dx = s.x - v.x;
      const dy = s.y - v.y;
      const d = Math.hypot(dx, dy);
      if (d > reach || (dx * Math.cos(v.facing) + dy * Math.sin(v.facing)) / (d || 1) < 0.2) continue;
      got += s.value;
      s.carrier = -2; // gone into the bucket
    }
    if (got > 0) {
      v.load += got;
      w.s.arena.sacks = w.s.arena.sacks.filter((s) => s.carrier !== -2);
      w.ev({ kind: "crash", a: v.driver, what: "scoop", x: v.x, y: v.y });
    }
  }

  /** Someone worth hitting: on their feet, not in a machine, not already caught. */
  private prey(w: World, f: Fighter, v: Vehicle): boolean {
    return f.id !== v.driver && alive(f) && f.invuln === 0 && !["driving", "down", "wakeup", "thrown", "air"].includes(f.state) && !this.held(w, f);
  }

  /** Carried in a bucket or on forks, or being shoved along by a blade: the machine decides where they are. */
  private held(w: World, f: Fighter): boolean {
    return w.s.arena.vehicles.some((v) => v.carry === f.id || (v.act > 0 && v.kind === "bulldozer" && v.actHit.includes(f.id)));
  }

  private seize(w: World, v: Vehicle, f: Fighter, by: number): void {
    if (f.state === "holding" || f.state === "held") w.knockDown(f, 0, 0, 0.1);
    this.dropSack(w, f);
    w.knockDown(f, Math.cos(v.facing), Math.sin(v.facing), 0.1);
    f.dur = 100000;
    v.carry = f.id;
    v.carryT = 0;
    v.lastBy = by;
    w.ev({ kind: "crash", a: by, b: f.id, what: "seize", x: v.x, y: v.y });
  }

  /** Where a carried fighter is held, and how high. */
  private carryPoint(v: Vehicle): { x: number; y: number; z: number } {
    const r = VEHICLES[v.kind].r;
    const off = v.kind === "excavator" ? r + 1.5 : v.kind === "forklift" ? r + 0.7 : r + 0.8;
    const z = v.kind === "excavator" ? 2.2 : v.kind === "forklift" ? 0.9 : 1.0;
    return { x: v.x + Math.cos(v.facing) * off, y: v.y + Math.sin(v.facing) * off, z };
  }

  /** Let go of whoever the machine is holding. */
  private release(w: World, v: Vehicle, how: "drop" | "slam" | "throw" | "set"): void {
    const f = w.s.fighters[v.carry];
    v.carry = -1;
    v.carryT = 0;
    if (!f || !alive(f)) return;
    const c = this.carryPoint(v);
    f.x = c.x;
    f.y = c.y;
    f.z = 0;
    f.vz = 0;
    const by = v.driver >= 0 ? v.driver : v.lastBy;
    if (how === "throw") {
      this.maul(w, f, 14, 0.3, by, "throw");
      if (!alive(f)) return;
      w.setState(f, "air");
      f.juggle = 1;
      f.bounced = false;
      f.z = 0.4;
      f.vz = 0.1;
      f.slideX = Math.cos(v.facing) * 0.26;
      f.slideY = Math.sin(v.facing) * 0.26;
      w.ev({ kind: "launch", a: by, b: f.id });
      return;
    }
    if (how === "set") {
      w.knockDown(f, Math.cos(v.facing), Math.sin(v.facing), 0.6);
      return;
    }
    w.knockDown(f, Math.cos(v.facing), Math.sin(v.facing), 0.8);
    this.maul(w, f, how === "slam" ? 30 : 20, how === "slam" ? 0.7 : 0.45, by, how);
    this.smash(w, c.x, c.y, 1.4, 12, by, v);
    w.ev({ kind: "crash", a: by, what: "slam", x: c.x, y: c.y, dmg: 24 });
  }

  /** A hit by a machine: the damage, and often a limb comes off with it. */
  private maul(w: World, f: Fighter, dmg: number, sever: number, by: number, what: string): void {
    if (!alive(f)) return;
    w.ev({ kind: "hit", a: by, b: f.id, part: "torso", dmg, what });
    w.damage(f, "torso", dmg, by);
    if (alive(f)) this.sever(w, f, sever, by);
  }

  private sever(w: World, f: Fighter, chance: number, by: number): void {
    const have = LIMBS.filter((p) => f.parts[p].attached);
    if (!have.length || !w.rng.chance(chance)) return;
    const p = have[w.rng.int(have.length)];
    w.damage(f, p, f.parts[p].hp, by);
  }

  /** Damage every machine within `rad` of a point, except `skip`. */
  private smash(w: World, x: number, y: number, rad: number, dmg: number, by: number, skip: Vehicle): void {
    for (const o of w.s.arena.vehicles) {
      if (o === skip || o.wrecked || Math.hypot(o.x - x, o.y - y) > rad + VEHICLES[o.kind].r) continue;
      o.hp -= dmg;
      o.lastBy = by;
    }
  }

  /** Get out of the cab, beside it. */
  private leave(w: World, f: Fighter, v: Vehicle): void {
    const st = VEHICLES[v.kind];
    v.driver = -1;
    f.vehicle = -1;
    const side = v.facing + Math.PI / 2;
    f.x = clamp(v.x + Math.cos(side) * (st.r + 0.45), -YARD.hx + 0.5, YARD.hx - 0.5);
    f.y = clamp(v.y + Math.sin(side) * (st.r + 0.45), -YARD.hy + 0.5, YARD.hy - 0.5);
    f.facing = v.facing;
    w.setState(f, "idle");
    w.ev({ kind: "exit", a: f.id, x: v.x, y: v.y });
  }

  /** Thrown out of a wreck. */
  private eject(w: World, f: Fighter): void {
    const v = w.s.arena.vehicles[f.vehicle];
    if (v) v.driver = -1;
    f.vehicle = -1;
    w.setState(f, "idle");
    const a = w.rng.range(0, Math.PI * 2);
    w.knockDown(f, Math.cos(a), Math.sin(a), 1.4);
    w.damage(f, "torso", 10, v ? v.lastBy : -1);
  }

  use(w: World, f: Fighter): boolean {
    const a = w.s.arena;
    let best: Vehicle | null = null;
    let bd = 1e9;
    for (const v of a.vehicles) {
      if (v.wrecked || v.driver >= 0) continue;
      const d = dist(f, v) - VEHICLES[v.kind].r;
      if (d < 0.9 && d < bd) {
        bd = d;
        best = v;
      }
    }
    const mine = this.carried(w, f);
    // a sack on the ground, or one in someone's arms, is there for the taking
    let sack: Sack | null = null;
    let sd = 1e9;
    if (!mine) {
      for (const s of a.sacks) {
        const d = s.carrier >= 0 ? dist(f, w.s.fighters[s.carrier]) - 0.2 : dist(f, s);
        if (s.carrier === f.id || d > SACKS.pick || d >= sd) continue;
        sd = d;
        sack = s;
      }
    }
    if (sack && sd <= bd) {
      if (sack.carrier >= 0) w.ev({ kind: "crash", a: f.id, b: sack.carrier, what: "steal", x: f.x, y: f.y });
      sack.carrier = f.id;
      w.ev({ kind: "crash", a: f.id, what: "lift", x: sack.x, y: sack.y });
      return true;
    }
    if (!best) {
      if (mine) {
        this.dropSack(w, f);
        return true;
      }
      return false;
    }
    // into the cab: a sack in the arms goes on the machine if it can haul, and on the floor if not
    if (mine) {
      if (best.load + mine.value <= this.capacity(best)) {
        best.load += mine.value;
        a.sacks = a.sacks.filter((s) => s !== mine);
      } else this.dropSack(w, f);
    }
    best.driver = f.id;
    best.speed = 0;
    f.vehicle = best.id;
    w.setState(f, "driving");
    f.x = best.x;
    f.y = best.y;
    w.ev({ kind: "enter", a: f.id, x: best.x, y: best.y });
    return true;
  }

  onHit(w: World, d: Fighter): void {
    this.dropSack(w, d);
  }

  onKo(w: World, d: Fighter): void {
    const v = w.s.arena.vehicles[d.vehicle];
    if (v && v.driver === d.id) v.driver = -1;
    d.vehicle = -1;
    this.dropSack(w, d);
  }

  strikeObjects(w: World, f: Fighter, m: Move & { total: number }): void {
    for (const v of w.s.arena.vehicles) {
      const key = 100 + v.id;
      if (v.wrecked || v.driver === f.id || f.moveHits.includes(key)) continue;
      const dx = v.x - f.x;
      const dy = v.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d > m.reach + VEHICLES[v.kind].r) continue;
      if (d > 0.35 && (dx * Math.cos(f.facing) + dy * Math.sin(f.facing)) / d < m.arc) continue;
      f.moveHits.push(key);
      const mult = m.knockdown || m.launch || m.bound || m.kind === "special" || f.charge >= 20 ? 1.8 : 1;
      const dmg = Math.round(m.dmg * mult);
      v.hp -= dmg;
      v.lastBy = f.id;
      f.moveLanded = true;
      w.freeze(f, undefined, HITSTOP.block);
      w.ev({ kind: "crash", a: f.id, what: "strike", x: v.x, y: v.y, dmg });
    }
  }

  bound(w: World, f: Fighter): void {
    if (f.state === "driving") return;
    if (this.held(w, f)) return;
    // vehicles are solid; a wreck is rubble you climb over (or people get pinned behind it for good)
    for (const v of w.s.arena.vehicles) {
      if (v.wrecked) continue;
      const min = VEHICLES[v.kind].r + BODY_R;
      const dx = f.x - v.x;
      const dy = f.y - v.y;
      const d = Math.hypot(dx, dy);
      if (d >= min) continue;
      const k = d > 1e-6 ? min / d : 0;
      f.x = d > 1e-6 ? v.x + dx * k : v.x + min;
      f.y = d > 1e-6 ? v.y + dy * k : v.y;
    }
    const hx = YARD.hx - BODY_R;
    const hy = YARD.hy - BODY_R;
    if (Math.abs(f.x) > hx || Math.abs(f.y) > hy) {
      f.x = clamp(f.x, -hx, hx);
      f.y = clamp(f.y, -hy, hy);
      f.slideX = f.slideY = 0;
    }
  }

  boundPickup(_w: World, p: OnFloor): void {
    if (Math.abs(p.x) > YARD.hx || Math.abs(p.y) > YARD.hy) {
      p.x = clamp(p.x, -YARD.hx, YARD.hx);
      p.y = clamp(p.y, -YARD.hy, YARD.hy);
      p.vx = p.vy = 0;
    }
  }

  canLand(_w: World, x: number, y: number): boolean {
    return Math.abs(x) <= YARD.hx && Math.abs(y) <= YARD.hy;
  }

  // ------------------------------------------------------------ the step
  update(w: World): void {
    const s = w.s;
    const vs = s.arena.vehicles;
    // drive
    for (const v of vs) {
      if (v.boost > 0) v.boost--;
      if (v.cool > 0) v.cool--;
      if (v.actCool > 0) v.actCool--;
      if (v.wrecked) continue;
      const drv = s.fighters[v.driver];
      if (!drv || drv.state !== "driving") v.speed *= 0.9; // parked: rolls to a stop
      if (drv && drv.stop > 0) continue; // the driver is in hitstop: so is the machine
      v.x += Math.cos(v.facing) * v.speed;
      v.y += Math.sin(v.facing) * v.speed;
      const st = VEHICLES[v.kind];
      const hx = YARD.hx - st.r;
      const hy = YARD.hy - st.r;
      if (Math.abs(v.x) > hx || Math.abs(v.y) > hy) {
        v.x = clamp(v.x, -hx, hx);
        v.y = clamp(v.y, -hy, hy);
        const plowing = v.kind === "bulldozer" && v.act > 0;
        if (Math.abs(v.speed) > 0.06 && !plowing) {
          v.hp -= Math.abs(v.speed) * 60;
          w.ev({ kind: "crash", a: v.driver, what: "wall", x: v.x, y: v.y });
        }
        v.speed *= plowing ? 0 : -0.3;
      }
    }
    // vehicles collide with each other
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i];
        const b = vs[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = VEHICLES[a.kind].r + VEHICLES[b.kind].r;
        if (d >= min || d < 1e-6) continue;
        const ux = dx / d;
        const uy = dy / d;
        // closing speed along the line between them
        const closing = Math.cos(a.facing) * a.speed * ux + Math.sin(a.facing) * a.speed * uy - (Math.cos(b.facing) * b.speed * ux + Math.sin(b.facing) * b.speed * uy);
        const push = (min - d) / 2;
        const aFixed = a.wrecked;
        const bFixed = b.wrecked;
        if (!aFixed) {
          a.x -= ux * push * (bFixed ? 2 : 1);
          a.y -= uy * push * (bFixed ? 2 : 1);
        }
        if (!bFixed) {
          b.x += ux * push * (aFixed ? 2 : 1);
          b.y += uy * push * (aFixed ? 2 : 1);
        }
        // a real run-up hurts; two machines shoving each other do not
        if (closing > CRASH_MIN) {
          const dmg = closing * 90;
          // the one that rammed takes less
          const aRams = Math.abs(a.speed) >= Math.abs(b.speed);
          a.hp -= dmg * (aRams ? 0.4 : 1);
          b.hp -= dmg * (aRams ? 1 : 0.4);
          a.lastBy = b.driver;
          b.lastBy = a.driver;
          // they bounce off each other: whichever was driving into the other backs off, so a crash is one crash
          const pa = (Math.cos(a.facing) * ux + Math.sin(a.facing) * uy) * a.speed;
          const pb = (Math.cos(b.facing) * ux + Math.sin(b.facing) * uy) * b.speed;
          a.speed *= pa > 0 ? -0.35 : 0.5;
          b.speed *= pb < 0 ? -0.35 : 0.5;
          a.boost = b.boost = 0; // a crash ends a boost, or it would ram the same machine again and again
          w.ev({ kind: "crash", a: aRams ? a.driver : b.driver, b: aRams ? b.driver : a.driver, what: "vehicle", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dmg });
        }
      }
    }
    // keep the drivers in their cabs
    for (const v of vs) {
      const drv = s.fighters[v.driver];
      if (drv && drv.state === "driving") {
        drv.x = v.x;
        drv.y = v.y;
        drv.facing = v.facing;
        drv.slideX = drv.slideY = 0;
      }
    }
    for (const v of vs) this.implement(w, v);
    this.hold(w);
    this.runOver(w);
    this.slicks(w);
    // wrecks
    for (const v of vs) {
      if (v.wrecked || v.hp > 0) continue;
      v.wrecked = true;
      v.hp = 0;
      v.speed = 0;
      v.wreckT = 0;
      v.repair = 0;
      v.repairer = -1;
      v.act = 0;
      w.ev({ kind: "wreck", a: v.driver, b: v.lastBy, x: v.x, y: v.y, what: v.kind });
      if (v.lastBy >= 0 && v.lastBy !== v.driver) w.addViolence(s.fighters[v.lastBy], VIOLENCE.wreck);
      if (v.carry >= 0) this.release(w, v, "set");
      this.spill(w, v, v.x, v.y);
      const drv = s.fighters[v.driver];
      if (drv && drv.state === "driving") this.eject(w, drv);
      v.driver = -1;
      // the blast
      for (const f of s.fighters) {
        if (!alive(f) || f.invuln > 0 || f.state === "driving" || dist(f, v) > 2.4) continue;
        w.damage(f, "torso", 8, v.lastBy);
        if (alive(f) && f.state !== "down") w.knockDown(f, (f.x - v.x) / (dist(f, v) || 1), (f.y - v.y) / (dist(f, v) || 1), 1.2);
      }
    }
    this.repairs(w);
    // the crane drops steel
    runHazards(w, () => ({ kind: "beam", x: w.rng.range(-YARD.hx + 1.5, YARD.hx - 1.5), y: w.rng.range(-YARD.hy + 1.5, YARD.hy - 1.5) }), [300, 480]);
    this.foundation(w);
  }

  /** What a machine hauled goes back on the ground when it is wrecked or tips its load. */
  private spill(w: World, v: Vehicle, x: number, y: number): void {
    let left = v.load;
    v.load = 0;
    for (let i = 0; left > 0 && i < 8; i++) {
      const a = i * 2.4;
      const kind: Sack["kind"] = left >= 2 && i % 3 === 0 ? "cement" : "rubble";
      const sack = this.addSack(w, clamp(x + Math.cos(a) * (0.8 + i * 0.12), -YARD.hx + 0.5, YARD.hx - 0.5), clamp(y + Math.sin(a) * (0.8 + i * 0.12), -YARD.hy + 0.5, YARD.hy - 0.5), kind);
      left -= sack.value;
    }
  }

  /** The implement attacks: each machine does something different on the strike button. */
  private implement(w: World, v: Vehicle): void {
    if (v.wrecked || v.act <= 0) return;
    const drv = w.s.fighters[v.driver];
    if (drv && drv.stop > 0) return;
    const st = VEHICLES[v.kind];
    const A = ACTS[v.kind];
    const by = v.driver >= 0 ? v.driver : v.lastBy;
    const cx = Math.cos(v.facing);
    const cy = Math.sin(v.facing);
    const t = v.act;
    switch (v.kind) {
      case "bulldozer": {
        // the blade shoves everyone in front of it along; against a wall they are pinned and crushed
        const front = st.r + BODY_R + 0.05;
        for (const f of w.s.fighters) {
          const mine = v.actHit.includes(f.id);
          if (!mine && !this.prey(w, f, v)) continue;
          if (mine && !alive(f)) continue;
          const dx = f.x - v.x;
          const dy = f.y - v.y;
          const ahead = dx * cx + dy * cy;
          const side = -dx * cy + dy * cx;
          if (!mine && (ahead < 0 || ahead > front + 0.8 || Math.abs(side) > st.r + 0.4)) continue;
          if (!mine) v.actHit.push(f.id);
          let nx = v.x + cx * front + -cy * clamp(side, -st.r, st.r);
          let ny = v.y + cy * front + cx * clamp(side, -st.r, st.r);
          const hx = YARD.hx - BODY_R;
          const hy = YARD.hy - BODY_R;
          const pinned = Math.abs(nx) > hx || Math.abs(ny) > hy;
          nx = clamp(nx, -hx, hx);
          ny = clamp(ny, -hy, hy);
          f.x = nx;
          f.y = ny;
          w.setState(f, "hitstun", 5);
          f.slideX = f.slideY = 0;
          if (pinned && t % 10 === 0) {
            this.maul(w, f, 11, 0.55, by, "pin");
            w.ev({ kind: "crash", a: by, b: f.id, what: "pin", x: f.x, y: f.y, dmg: 14 });
          }
        }
        if (t >= A.dur) {
          for (const id of v.actHit) {
            const f = w.s.fighters[id];
            if (f && alive(f) && f.state === "hitstun") w.knockDown(f, cx, cy, 1.6);
          }
        }
        break;
      }
      case "excavator":
        if (t === A.hit) {
          const px = v.x + cx * (st.r + 1.5);
          const py = v.y + cy * (st.r + 1.5);
          for (const f of w.s.fighters) {
            if (f.id === v.driver || !alive(f) || f.invuln > 0 || f.state === "driving" || this.held(w, f) || Math.hypot(f.x - px, f.y - py) > 2.0) continue;
            const d = dist(f, { x: px, y: py });
            w.knockDown(f, d > 0.05 ? (f.x - px) / d : cx, d > 0.05 ? (f.y - py) / d : cy, 1.5);
            this.maul(w, f, 30, 0.5, by, "slam");
          }
          this.smash(w, px, py, 2.0, 30, by, v);
          w.ev({ kind: "crash", a: by, what: "slam", x: px, y: py, dmg: 30 });
        }
        break;
      case "dumptruck":
        if (t === A.hit) {
          const px = v.x - cx * (st.r + 1.5);
          const py = v.y - cy * (st.r + 1.5);
          if (v.load > 0 && Math.hypot(v.x - PIT.x, v.y - PIT.y) < PIT.r + 1.4 && v.driver >= 0) {
            this.fill(w, w.s.fighters[v.driver], v.load, "tip", px, py);
            v.load = 0;
          } else {
            this.spill(w, v, px, py);
            w.s.arena.piles.push({ x: px, y: py, t: 0 });
            if (w.s.arena.piles.length > 6) w.s.arena.piles.shift();
            for (const f of w.s.fighters) {
              if (f.id === v.driver || !alive(f) || f.invuln > 0 || f.state === "driving" || this.held(w, f) || Math.hypot(f.x - px, f.y - py) > 2.1) continue;
              this.bury(w, f, v, by);
            }
            w.ev({ kind: "crash", a: by, what: "tip", x: px, y: py, dmg: 20 });
          }
        }
        break;
      case "forklift":
        if (t === A.hit && v.carry < 0) {
          const px = v.x + cx * (st.r + 0.9);
          const py = v.y + cy * (st.r + 0.9);
          let best: Fighter | null = null;
          let bd = 1.1;
          for (const f of w.s.fighters) {
            if (!this.prey(w, f, v)) continue;
            const d = Math.hypot(f.x - px, f.y - py);
            if (d < bd) {
              bd = d;
              best = f;
            }
          }
          if (best) {
            this.seize(w, v, best, by);
            this.maul(w, best, 18, 0.6, by, "skewer");
            w.ev({ kind: "crash", a: by, b: best.id, what: "skewer", x: px, y: py, dmg: 18 });
          }
        }
        break;
      case "mixer":
        if (t >= 4 && t % 8 === 4) {
          const a = w.s.arena;
          a.slicks.push({ x: v.x - cx * (st.r + 0.3), y: v.y - cy * (st.r + 0.3), t: 0, by });
          if (a.slicks.length > SLICK.max) a.slicks.shift();
          if (t === 4) w.ev({ kind: "crash", a: by, what: "pour", x: v.x, y: v.y });
        }
        break;
      case "loader":
        if (t === A.hit) {
          const px = v.x + cx * (st.r + 0.9);
          const py = v.y + cy * (st.r + 0.9);
          for (const f of w.s.fighters) {
            if (!this.prey(w, f, v) || Math.hypot(f.x - px, f.y - py) > 1.5) continue;
            this.maul(w, f, 18, 0.4, by, "scoop");
            if (!alive(f)) continue;
            w.setState(f, "air");
            f.juggle = 1;
            f.bounced = false;
            f.z = 0;
            f.vz = 0.09;
            f.slideX = cx * 0.12;
            f.slideY = cy * 0.12;
            w.ev({ kind: "launch", a: by, b: f.id });
          }
          w.ev({ kind: "crash", a: by, what: "scoop", x: px, y: py, dmg: 14 });
        }
        break;
      case "roller":
        break; // the roller's attack is the surge: everything it touches is flattened (runOver)
      case "crane":
        if (t >= A.hit && t <= A.dur) {
          // the wrecking ball swings once round the cab
          const ang = v.facing + ((t - A.hit) / (A.dur - A.hit)) * Math.PI * 2;
          const bx = v.x + Math.cos(ang) * BALL_R;
          const by2 = v.y + Math.sin(ang) * BALL_R;
          for (const f of w.s.fighters) {
            if (f.id === v.driver || !alive(f) || f.invuln > 0 || f.state === "driving" || v.actHit.includes(f.id) || this.held(w, f)) continue;
            if (Math.hypot(f.x - bx, f.y - by2) > 1.0) continue;
            v.actHit.push(f.id);
            const d = dist(f, v) || 1;
            w.knockDown(f, (f.x - v.x) / d, (f.y - v.y) / d, 1.8);
            this.maul(w, f, 28, 0.55, by, "wrecking-ball");
            w.ev({ kind: "crash", a: by, b: f.id, what: "ball", x: bx, y: by2, dmg: 28 });
          }
          for (const o of w.s.arena.vehicles) {
            if (o === v || o.wrecked || v.actHit.includes(-1 - o.id) || Math.hypot(o.x - bx, o.y - by2) > 1.0 + VEHICLES[o.kind].r) continue;
            v.actHit.push(-1 - o.id);
            o.hp -= 35;
            o.lastBy = by;
            w.ev({ kind: "crash", a: by, what: "ball", x: bx, y: by2, dmg: 35 });
          }
        }
        break;
    }
    v.act++;
    if (v.act > A.dur) {
      v.act = 0;
      v.actHit = [];
    }
  }

  /** Under a tipped load: knocked flat, and stuck there a good while. */
  private bury(w: World, f: Fighter, v: Vehicle, by: number): void {
    w.knockDown(f, -Math.cos(v.facing), -Math.sin(v.facing), 0.5);
    f.dur = BURIED;
    this.maul(w, f, 16, 0.3, by, "buried");
  }

  /** Carried fighters ride the bucket or the forks. */
  private hold(w: World): void {
    for (const v of w.s.arena.vehicles) {
      if (v.carry < 0) continue;
      const f = w.s.fighters[v.carry];
      if (!f || !alive(f) || v.wrecked || f.state !== "down" || v.carryT > CARRY_MAX) {
        this.release(w, v, "set");
        continue;
      }
      const c = this.carryPoint(v);
      f.x = c.x;
      f.y = c.y;
      f.z = c.z;
      f.vz = 0;
      f.slideX = f.slideY = 0;
      f.t = 0; // they stay down while they are held
      v.carryT++;
    }
  }

  /** Machines run people over: harder than before, and often a limb goes. */
  private runOver(w: World): void {
    const s = w.s;
    for (const v of s.arena.vehicles) {
      if (v.wrecked || Math.abs(v.speed) < RAM_MIN) continue;
      const st = VEHICLES[v.kind];
      const power = v.act > 0 && (v.kind === "roller" || v.kind === "forklift") ? 1.4 : 1;
      for (const f of s.fighters) {
        if (f.id === v.driver || !alive(f) || f.invuln > 0 || ["driving", "down", "wakeup", "thrown"].includes(f.state) || this.held(w, f)) continue;
        const dx = f.x - v.x;
        const dy = f.y - v.y;
        const d = Math.hypot(dx, dy);
        if (d > st.r + BODY_R + 0.05) continue;
        const k0 = Math.min(1.5, Math.abs(v.speed) / st.speed);
        const dmg = st.ram * k0 * power;
        w.ev({ kind: "hit", a: v.driver, b: f.id, part: "torso", dmg, what: "ram" });
        w.damage(f, "torso", dmg, v.driver);
        if (alive(f)) {
          const hx = Math.cos(v.facing) * Math.sign(v.speed) + (d > 0.01 ? dx / d : 0);
          const hy = Math.sin(v.facing) * Math.sign(v.speed) + (d > 0.01 ? dy / d : 0);
          const k = Math.hypot(hx, hy) || 1;
          const front = d > 0.01 && (dx * Math.cos(v.facing) + dy * Math.sin(v.facing)) / d > 0.35 && v.speed > RAM_MIN;
          if (v.kind === "roller") {
            // flattened: down for a long time, and limbs come off under the drum
            w.knockDown(f, hx / k, hy / k, 0.6);
            f.dur = v.act > 0 ? FLAT * 1.5 : FLAT;
            this.sever(w, f, 1, v.driver);
            if (v.act > 0) this.sever(w, f, 1, v.driver);
            w.ev({ kind: "crash", a: v.driver, b: f.id, what: "flatten", x: f.x, y: f.y, dmg });
          } else if (front && (v.kind === "bulldozer" || v.kind === "loader" || v.kind === "forklift")) {
            w.setState(f, "air");
            f.juggle = 1;
            f.bounced = false;
            f.z = 0;
            f.vz = 0.068;
            f.slideX = (hx / k) * 0.12;
            f.slideY = (hy / k) * 0.12;
            w.ev({ kind: "launch", a: v.driver, b: f.id });
            this.sever(w, f, 0.3 + 0.3 * Math.min(1, k0), v.driver);
          } else {
            w.knockDown(f, hx / k, hy / k, 1.8);
            this.sever(w, f, 0.3 + 0.3 * Math.min(1, k0), v.driver);
          }
          w.freeze(f, undefined, hitstopFor(dmg, true));
        }
        v.speed *= v.kind === "roller" ? 0.95 : 0.8;
      }
    }
  }

  /** Wet cement slows whoever is in it, then sets with them stuck in it. */
  private slicks(w: World): void {
    const a = w.s.arena;
    for (const sl of a.slicks) {
      sl.t++;
      if (sl.t < SLICK.set) {
        for (const f of w.s.fighters) {
          if (!alive(f) || f.state === "driving" || f.z > 0.3 || Math.hypot(f.x - sl.x, f.y - sl.y) > SLICK.r) continue;
          f.velX *= 0.55;
          f.velY *= 0.55;
        }
        for (const v of a.vehicles) {
          if (!v.wrecked && Math.hypot(v.x - sl.x, v.y - sl.y) < SLICK.r + VEHICLES[v.kind].r * 0.5) v.speed *= 0.95;
        }
      } else if (sl.t === SLICK.set) {
        for (const f of w.s.fighters) {
          if (!alive(f) || f.state === "driving" || f.state === "down" || f.z > 0.3 || this.held(w, f) || Math.hypot(f.x - sl.x, f.y - sl.y) > SLICK.r) continue;
          w.knockDown(f, 0, 0, 0.1);
          f.dur = STUCK;
          w.damage(f, "torso", 6, sl.by);
          w.ev({ kind: "crash", a: sl.by, b: f.id, what: "set", x: f.x, y: f.y, dmg: 6 });
        }
      }
    }
    a.slicks = a.slicks.filter((sl) => sl.t < SLICK.gone);
    for (const p of a.piles) p.t++;
    a.piles = a.piles.filter((p) => p.t < 420);
  }

  /** Repairs, and the yard's supply of machines. */
  private repairs(w: World): void {
    const s = w.s;
    const vs = s.arena.vehicles;
    for (const v of vs) {
      if (!v.wrecked) continue;
      v.wreckT++;
      const st = VEHICLES[v.kind];
      const rep = s.fighters.find((f) => alive(f) && (f.state === "idle" || f.state === "walk") && (f.prevButtons & BTN.USE) !== 0 && dist(f, v) < st.r + REPAIR.range);
      if (rep) {
        if (v.repairer !== rep.id) v.repairer = rep.id;
        v.repair++;
        if (v.repair % 40 === 1) w.ev({ kind: "repair", a: rep.id, what: "work", x: v.x, y: v.y });
        if (v.repair >= REPAIR.frames) this.fix(w, v, rep.id, "done");
      } else if (v.repairer >= 0) {
        // whoever was at it stopped: a hit loses the work, putting the spanner down only pauses it
        const was = s.fighters[v.repairer];
        if (!was || s.frame - was.hurtAt <= 3 || !alive(was)) v.repair = 0;
        v.repairer = -1;
      }
    }
    // the yard is never left without machines: if too few run, the tow truck brings the longest-wrecked one back
    const working = vs.filter((v) => !v.wrecked).length;
    const need = Math.max(1, Math.ceil(s.fighters.length / 2));
    if (working < need) {
      let pick: Vehicle | null = null;
      for (const v of vs) if (v.wrecked && v.wreckT >= REPAIR.tow && (!pick || v.wreckT > pick.wreckT)) pick = v;
      if (pick) this.fix(w, pick, -1, "tow");
    }
  }

  private fix(w: World, v: Vehicle, by: number, what: string): void {
    v.wrecked = false;
    v.hp = Math.round(v.max * REPAIR.hpFrac);
    v.repair = 0;
    v.repairer = -1;
    v.wreckT = 0;
    v.speed = 0;
    v.act = 0;
    v.actCool = 0;
    v.load = 0;
    w.ev({ kind: "repair", a: by, what, x: v.x, y: v.y });
  }

  /** The foundation: sacks arrive, are carried, and filled in. */
  private foundation(w: World): void {
    const s = w.s;
    const a = s.arena;
    // deliveries to the yard
    if (s.frame >= a.nextSack) {
      const room = SACKS.cap + s.fighters.length - a.sacks.length;
      if (room > 0) {
        const x = w.rng.range(-YARD.hx + 1.5, YARD.hx - 1.5);
        const y = w.rng.range(-YARD.hy + 1.5, YARD.hy - 1.5);
        const kind: Sack["kind"] = w.rng.chance(0.3) ? "cement" : "rubble";
        if (Math.hypot(x - PIT.x, y - PIT.y) > PIT.r + 1.2) {
          const sack = this.addSack(w, x, y, kind);
          w.ev({ kind: "supply", a: -1, what: kind, x: sack.x, y: sack.y });
        }
      }
      a.nextSack = s.frame + Math.round(w.rng.range(SACKS.gap[0], SACKS.gap[1]));
    }
    for (const sk of a.sacks) {
      if (sk.carrier < 0) continue;
      const f = s.fighters[sk.carrier];
      if (!f || !alive(f) || !CARRYING.has(f.state)) {
        // hit, knocked down, ... whatever they were carrying drops
        if (f) this.dropSack(w, f);
        else sk.carrier = -1;
        continue;
      }
      sk.x = f.x;
      sk.y = f.y;
      f.velX *= 0.93; // heavy
      f.velY *= 0.93;
      if (Math.hypot(f.x - PIT.x, f.y - PIT.y) < PIT.r + 0.3) {
        sk.carrier = -2;
        this.fill(w, f, sk.value, "foot", f.x, f.y);
      }
    }
    a.sacks = a.sacks.filter((sk) => sk.carrier !== -2);
    // machines
    for (const v of a.vehicles) {
      if (v.wrecked) continue;
      const cap = this.capacity(v);
      const drv = s.fighters[v.driver];
      if (cap > 0 && drv && drv.state === "driving") {
        // haulers scoop up what they drive over
        for (const sk of a.sacks) {
          if (sk.carrier >= 0 || v.load + sk.value > cap) continue;
          if (v.kind === "loader") continue; // the loader scoops with the grab button
          if (Math.hypot(sk.x - v.x, sk.y - v.y) > VEHICLES[v.kind].r + 0.5) continue;
          v.load += sk.value;
          sk.carrier = -2;
          w.ev({ kind: "crash", a: drv.id, what: "load", x: sk.x, y: sk.y });
        }
        if (v.load > 0 && Math.hypot(v.x - PIT.x, v.y - PIT.y) < PIT.r + VEHICLES[v.kind].r * 0.6) {
          this.fill(w, drv, v.load, "haul", v.x, v.y);
          v.load = 0;
        }
      }
    }
    a.sacks = a.sacks.filter((sk) => sk.carrier !== -2);
  }

  // ------------------------------------------------------------ bots
  danger(w: World, me: Fighter, x: number, y: number): boolean {
    // the barriers only stop you; the danger is being in front of a moving vehicle
    for (const v of w.s.arena.vehicles) {
      if (v.wrecked || v.driver === me.id || (Math.abs(v.speed) < RAM_MIN && v.act === 0)) continue;
      const dx = x - v.x;
      const dy = y - v.y;
      const d = Math.hypot(dx, dy);
      if (v.kind === "crane" && v.act > 0 && d < BALL_R + 1.2) return true;
      if (d < 3.5 && (dx * Math.cos(v.facing) + dy * Math.sin(v.facing)) * Math.sign(v.speed || 1) > d * 0.7) return true;
    }
    return false;
  }

  safe(w: World, me: Fighter): { x: number; y: number } {
    // step sideways out of the path of the nearest moving vehicle
    let best: Vehicle | null = null;
    for (const v of w.s.arena.vehicles) if (!v.wrecked && v.driver !== me.id && (Math.abs(v.speed) >= RAM_MIN || v.act > 0) && (!best || dist(me, v) < dist(me, best))) best = v;
    if (!best) return { x: 0, y: 0 };
    const side = best.facing + Math.PI / 2;
    const s = (me.x - best.x) * Math.cos(side) + (me.y - best.y) * Math.sin(side) >= 0 ? 1 : -1;
    return this.clampGoal(me.x + Math.cos(side) * 3 * s, me.y + Math.sin(side) * 3 * s);
  }

  botGoal(w: World, me: Fighter, enemies: Fighter[]): Goal | null {
    if (enemies.some((e) => e.state !== "driving" && dist(e, me) < 1.6)) return null;
    const a = w.s.arena;
    // carrying: to the pit
    if (this.carried(w, me)) return { x: PIT.x, y: PIT.y, use: false };
    // a free machine close by (odd bots like driving now and then), else the nearest sack
    let car: Vehicle | null = null;
    for (const v of a.vehicles) {
      if (v.wrecked || v.driver >= 0 || v.hp < v.max * 0.25 || dist(me, v) > 7) continue;
      if (!car || dist(me, v) < dist(me, car)) car = v;
    }
    let sack: Sack | null = null;
    for (const sk of a.sacks) if (sk.carrier < 0 && (!sack || dist(me, sk) < dist(me, sack))) sack = sk;
    const wantCar = car && (!sack || dist(me, sack) > 6 || (me.id % 2 === 1 && (w.s.frame >> 9) % 3 === 0));
    if (car && wantCar) return { x: car.x, y: car.y, use: dist(me, car) < VEHICLES[car.kind].r + 0.75 };
    if (sack) return { x: sack.x, y: sack.y, use: dist(me, sack) < 0.8 };
    // nothing to ride or carry: repair the nearest wreck (hold USE at it)
    let wreck: Vehicle | null = null;
    for (const v of a.vehicles) if (v.wrecked && (!wreck || dist(me, v) < dist(me, wreck))) wreck = v;
    if (wreck) return { x: wreck.x, y: wreck.y, use: false, hold: dist(me, wreck) < VEHICLES[wreck.kind].r + REPAIR.range - 0.15 };
    return null;
  }

  clampGoal(x: number, y: number): { x: number; y: number } {
    return { x: clamp(x, -YARD.hx + 0.8, YARD.hx - 0.8), y: clamp(y, -YARD.hy + 0.8, YARD.hy - 0.8) };
  }

  progress(f: Fighter): number {
    return Math.min(1, f.toilet / PIT.need);
  }

  headline(w: World): Headline | null {
    const lead = w.s.fighters.reduce((a, b) => (b.toilet > a.toilet ? b : a));
    const sack = this.carried(w, lead);
    if (lead.toilet === 0) return { text: `Pour the Foundation: first to fill ${PIT.need}`, frac: 0, who: -1 };
    return { text: `${nm(lead)} has poured ${lead.toilet} of ${PIT.need}${sack ? " (and is carrying more)" : ""}`, frac: lead.toilet / PIT.need, who: lead.id };
  }

  hash(mix: (v: number) => void, a: ArenaState): void {
    for (const v of a.vehicles) {
      mix(v.x);
      mix(v.y);
      mix(v.facing);
      mix(v.speed);
      mix(v.hp);
      mix(v.driver);
      mix(v.act);
      mix(v.actCool);
      mix(v.carry);
      mix(v.carryT);
      mix(v.load);
      mix(v.wrecked ? v.wreckT + 1 : 0);
      mix(v.repair);
      mix(v.repairer);
      for (const id of v.actHit) mix(id);
    }
    mix(a.nextSack);
    mix(a.nextSackId);
    for (const sk of a.sacks) {
      mix(sk.id);
      mix(sk.x);
      mix(sk.y);
      mix(sk.carrier);
      mix(sk.value);
    }
    for (const sl of a.slicks) {
      mix(sl.x);
      mix(sl.y);
      mix(sl.t);
    }
    for (const p of a.piles) {
      mix(p.x);
      mix(p.y);
      mix(p.t);
    }
  }
}

// ===================================================================== Collapsing Tower
const HALF_T = (TOWER.tile * TOWER.n) / 2;

export function tileAt(x: number, y: number): number {
  const i = Math.floor((x + HALF_T) / TOWER.tile);
  const j = Math.floor((y + HALF_T) / TOWER.tile);
  if (i < 0 || j < 0 || i >= TOWER.n || j >= TOWER.n) return -1;
  return j * TOWER.n + i;
}

/** 0 for the centre 2x2 tiles (they never fall), up to 3 for the outer ring */
export function tileRing(k: number): number {
  const c = (TOWER.n - 1) / 2;
  return Math.max(Math.abs((k % TOWER.n) - c), Math.abs(Math.floor(k / TOWER.n) - c)) - 0.5;
}

export function tileCentre(k: number): { x: number; y: number } {
  return { x: -HALF_T + ((k % TOWER.n) + 0.5) * TOWER.tile, y: -HALF_T + (Math.floor(k / TOWER.n) + 0.5) * TOWER.tile };
}

class CollapsingTower extends Arena {
  readonly id = "collapsing-tower" as const;
  readonly respawn = false;

  spawns(n: number): Spawn[] {
    return ellipseSpawns(n, 5.2, 5.2);
  }

  init(w: World): void {
    w.s.arena.tiles = Array(TOWER.n * TOWER.n).fill(0);
    w.s.arena.nextCrack = TOWER.first;
  }

  private onFloor(w: World, x: number, y: number): boolean {
    const k = tileAt(x, y);
    return k >= 0 && w.s.arena.tiles[k] !== -1;
  }

  /** (Practice only: nobody comes back for real.) The spawn tile if it is still sound, else the nearest sound tile toward the middle. */
  respawnAt(w: World, f: Fighter): { x: number; y: number } {
    return this.danger(w, f, f.spawnX, f.spawnY) ? this.safe(w, f) : { x: f.spawnX, y: f.spawnY };
  }

  bound(w: World, f: Fighter): void {
    if (!this.onFloor(w, f.x, f.y)) w.fall(f);
  }

  canWalk(w: World, _f: Fighter, x: number, y: number): boolean {
    return this.onFloor(w, x, y);
  }

  boundPickup(w: World, p: OnFloor): void {
    if (p.z === 0 && !this.onFloor(w, p.x, p.y)) losePickup(w, p);
  }

  floorNear(w: World, x: number, y: number): { x: number; y: number } {
    if (this.onFloor(w, x, y)) return { x, y };
    // the middle of the nearest tile still standing (the middle ones never go)
    let best = { x: 0, y: 0 };
    let bd = Infinity;
    w.s.arena.tiles.forEach((t, k) => {
      if (t === -1) return;
      const c = tileCentre(k);
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    });
    return best;
  }

  canLand(w: World, x: number, y: number): boolean {
    return this.onFloor(w, x, y);
  }

  update(w: World): void {
    const s = w.s;
    const tiles = s.arena.tiles;
    for (let k = 0; k < tiles.length; k++) {
      if (tiles[k] <= 0) continue;
      if (++tiles[k] >= TOWER.crack) {
        tiles[k] = -1;
        w.ev({ kind: "collapse", a: -1, ...tileCentre(k) });
      }
    }
    if (s.frame >= s.arena.nextCrack) {
      const intact = tiles.map((t, k) => (t === 0 && tileRing(k) > 0 ? k : -1)).filter((k) => k >= 0);
      if (intact.length) {
        // mostly from the outside in, but not only
        const outer = Math.max(...intact.map(tileRing));
        const pool = w.rng.chance(0.75) ? intact.filter((k) => tileRing(k) === outer) : intact;
        const k = pool[w.rng.int(pool.length)];
        tiles[k] = 1;
        w.ev({ kind: "crack", a: -1, ...tileCentre(k) });
      }
      const ramp = Math.min(1, s.frame / TOWER.rampFrames);
      s.arena.nextCrack = s.frame + Math.round(TOWER.gapStart + (TOWER.gapEnd - TOWER.gapStart) * ramp);
    }
  }

  danger(w: World, _me: Fighter, x: number, y: number): boolean {
    const k = tileAt(x, y);
    if (k < 0 || w.s.arena.tiles[k] !== 0) return true;
    for (const [dx, dy] of [
      [0.7, 0],
      [-0.7, 0],
      [0, 0.7],
      [0, -0.7],
    ])
      if (!this.onFloor(w, x + dx, y + dy)) return true;
    return false;
  }

  safe(w: World, me: Fighter): { x: number; y: number } {
    let best = { x: 0, y: 0 };
    let bs = 1e9;
    w.s.arena.tiles.forEach((t, k) => {
      if (t !== 0) return;
      const c = tileCentre(k);
      const sc = dist(me, c) + tileRing(k) * 0.8;
      if (sc < bs) {
        bs = sc;
        best = c;
      }
    });
    return best;
  }

  clampGoal(x: number, y: number): { x: number; y: number } {
    return { x: clamp(x, -HALF_T + 1, HALF_T - 1), y: clamp(y, -HALF_T + 1, HALF_T - 1) };
  }

  headline(w: World): Headline | null {
    const left = w.s.fighters.filter((f) => !f.out).length;
    const tiles = w.s.arena.tiles;
    return { text: `${left} fighters left on the roof`, frac: tiles.filter((t) => t !== -1).length / tiles.length, who: -1 };
  }

  hash(mix: (v: number) => void, a: ArenaState): void {
    for (const t of a.tiles) mix(t);
  }
}

// ===================================================================== Hindenburg Blimp
const SEG = BLIMP.half - BLIMP.width; // the deck is a capsule round the segment x in [-SEG, SEG]

export function onDeck(x: number, y: number, margin = 0): boolean {
  return Math.hypot(Math.max(0, Math.abs(x) - SEG), y) <= BLIMP.width - margin;
}

/** Has the blimp hit the ground yet? */
export function crashed(w: World): boolean {
  return w.s.frame >= BLIMP.crashAt;
}

/** The nearest point on the deck, margin inside its edge. */
function toDeck(x: number, y: number, margin: number): { x: number; y: number } {
  const cx = clamp(x, -SEG, SEG);
  const d = Math.hypot(x - cx, y) || 1;
  const r = BLIMP.width - margin;
  return d <= r ? { x, y } : { x: cx + ((x - cx) / d) * r, y: (y / d) * r };
}

class HindenburgBlimp extends Arena {
  readonly id = "hindenburg-blimp" as const;
  readonly respawn = false;

  spawns(n: number): Spawn[] {
    const cols = Math.ceil(n / 2);
    return Array.from({ length: n }, (_, i) => {
      const c = Math.floor(i / 2);
      const x = cols > 1 ? -5.5 + (11 * c) / (cols - 1) : 0;
      const y = i % 2 === 0 ? -1.6 : 1.6;
      return { x, y, facing: y < 0 ? Math.PI / 2 : -Math.PI / 2 };
    });
  }

  init(w: World): void {
    const a = w.s.arena;
    a.fireX = BLIMP.half + 1;
    a.nextWind = BLIMP.windFirst;
  }

  bound(w: World, f: Fighter): void {
    const a = w.s.arena;
    if (!onDeck(f.x, f.y)) {
      if (!crashed(w)) {
        w.fall(f); // a long way down
        return;
      }
      // on the ground the wreck is all there is: its edge is a wall of fire and twisted frame
      const p = toDeck(f.x, f.y, 0.02);
      f.x = p.x;
      f.y = p.y;
    }
    if (f.x > a.fireX) burn(w, f);
  }

  canWalk(_w: World, _f: Fighter, x: number, y: number): boolean {
    return onDeck(x, y); // nobody walks off a deck: only a knockdown or a throw sends you over
  }

  /** (Practice only.) The spawn point unless the fire has reached it, else the deck's middle ahead of the fire. */
  respawnAt(w: World, f: Fighter): { x: number; y: number } {
    return this.danger(w, f, f.spawnX, f.spawnY) ? this.safe(w, f) : { x: f.spawnX, y: f.spawnY };
  }

  boundPickup(w: World, p: OnFloor): void {
    if (p.z === 0 && (!onDeck(p.x, p.y) || (p.x > w.s.arena.fireX && !crashed(w)))) losePickup(w, p);
  }

  floorNear(w: World, x: number, y: number): { x: number; y: number } {
    // ahead of the fire while there is a deck ahead of it; in the wreck the fire is everywhere
    const fx = crashed(w) ? x : Math.min(x, w.s.arena.fireX - 0.5);
    return toDeck(fx, y, 0.4);
  }

  canLand(w: World, x: number, y: number): boolean {
    return onDeck(x, y) && x <= w.s.arena.fireX;
  }

  update(w: World): void {
    const s = w.s;
    const a = s.arena;
    if (s.frame === BLIMP.crashAt) this.impact(w);
    if (crashed(w)) {
      // the wreck: the fire runs over the whole deck, and everyone in it burns a little more every second
      a.fireX = Math.max(-BLIMP.half - 1, Math.min(a.fireX, BLIMP.fireStop) - BLIMP.wreckFire);
      a.wind = 0;
      const since = s.frame - BLIMP.crashAt;
      if (since >= BLIMP.wreckFor) {
        // nobody burns to death: the fire burns out, and whoever has the most limbs still on wins (then the most KOs)
        const left = s.fighters.filter((f) => !f.out);
        const limbs = (f: Fighter) => LIMBS.filter((p) => f.parts[p].attached).length;
        if (left.length) w.win(left.reduce((a, b) => (limbs(b) > limbs(a) || (limbs(b) === limbs(a) && b.kos > a.kos) ? b : a)).id);
        return;
      }
      if (since > 0 && since % BLIMP.burnTick === 0) {
        const dmg = BLIMP.burnBase + (BLIMP.burnRamp * since) / 60;
        for (const f of s.fighters) {
          if (!alive(f)) continue;
          w.damage(f, "torso", dmg, -1);
          // one event every half second, not every tick: eight fighters burn at once
          if (since % (BLIMP.burnTick * 3) === 0) w.ev({ kind: "hit", a: -1, b: f.id, part: "torso", dmg: dmg * 3, what: "burn" });
        }
      }
      return;
    }
    // the fire spreads from the tail toward the nose
    if (s.frame >= BLIMP.fireStart) a.fireX = Math.max(BLIMP.fireStop, a.fireX - BLIMP.fireSpeed);
    // gusts
    if (a.wind === 0 && s.frame >= a.nextWind) {
      a.wind = -BLIMP.windWarn;
      a.windDir = w.rng.chance(0.5) ? 1 : -1;
      w.ev({ kind: "wind", a: -1, what: "warn", y: a.windDir });
    } else if (a.wind < 0) {
      if (++a.wind === 0) {
        a.wind = BLIMP.windDur;
        w.ev({ kind: "wind", a: -1, what: "gust", y: a.windDir });
      }
    } else if (a.wind > 0) {
      for (const f of s.fighters) {
        if (!alive(f) || f.stop > 0 || f.state === "seated") continue;
        f.y += a.windDir * BLIMP.windPush * (f.state === "down" ? 1.4 : f.state === "reversal" ? 0.5 : 1);
      }
      if (--a.wind === 0) a.nextWind = s.frame + Math.round(w.rng.range(BLIMP.windMin, BLIMP.windMax));
    }
  }

  /** The blimp hits the ground: everyone still aboard is thrown flat and hurt. */
  private impact(w: World): void {
    w.ev({ kind: "impact", a: -1, x: 0, y: 0 });
    for (const f of w.s.fighters) {
      if (!alive(f)) continue;
      w.damage(f, "torso", BLIMP.impactDmg, -1);
      if (!alive(f)) continue;
      const p = toDeck(f.x, f.y, 0.3);
      f.x = p.x;
      f.y = p.y;
      w.knockDown(f, 0, 0, 0);
      w.ev({ kind: "hit", a: -1, b: f.id, part: "torso", dmg: BLIMP.impactDmg, what: "impact" });
    }
  }

  danger(w: World, _me: Fighter, x: number, y: number): boolean {
    if (x > w.s.arena.fireX - 1) return true;
    return !crashed(w) && !onDeck(x, y, 0.9);
  }

  safe(w: World, me: Fighter): { x: number; y: number } {
    return { x: clamp(me.x, -SEG, Math.min(SEG, w.s.arena.fireX - 2.5)), y: 0 };
  }

  throwAngle(_w: World, me: Fighter): number {
    return me.y >= 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  clampGoal(x: number, y: number): { x: number; y: number } {
    return toDeck(x, y, 1);
  }

  headline(w: World): Headline | null {
    const left = w.s.fighters.filter((f) => !f.out).length;
    const to = BLIMP.crashAt - w.s.frame;
    if (to > BLIMP.brace) return { text: `${left} aboard · going down in ${Math.ceil(to / 60)} s`, frac: w.s.frame / BLIMP.crashAt, who: -1 };
    if (to > 0) return { text: `BRACE FOR IMPACT! ${Math.ceil(to / 60)}`, frac: w.s.frame / BLIMP.crashAt, who: -1 };
    const out = Math.max(0, Math.ceil((BLIMP.crashAt + BLIMP.wreckFor - w.s.frame) / 60));
    return { text: `${left} ${left === 1 ? "survivor" : "survivors"} in the burning wreck · burns out in ${out} s`, frac: 1, who: -1 };
  }

  hash(mix: (v: number) => void, a: ArenaState): void {
    mix(a.fireX);
    mix(a.wind);
  }
}

// ===================================================================== Castle Under Siege
function breachAt(x: number, side: number): boolean {
  return CASTLE.breaches.some((b) => b.side === side && x >= b.x0 && x <= b.x1);
}

class CastleUnderSiege extends Arena {
  readonly id = "castle-under-siege" as const;
  readonly respawn = true;

  spawns(n: number): Spawn[] {
    return ellipseSpawns(n, 7, 3.8);
  }

  bound(w: World, f: Fighter): void {
    const hx = CASTLE.hx - BODY_R;
    const hy = CASTLE.hy - BODY_R;
    if (Math.abs(f.x) > hx) {
      f.x = clamp(f.x, -hx, hx);
      f.slideX = 0;
    }
    if (Math.abs(f.y) > hy) {
      const side = Math.sign(f.y);
      if (!breachAt(f.x, side)) {
        f.y = clamp(f.y, -hy, hy);
        f.slideY = 0;
      } else if (Math.abs(f.y) > CASTLE.hy) w.fall(f); // through the breach, off the wall
    }
  }

  canWalk(_w: World, _f: Fighter, _x: number, y: number): boolean {
    return Math.abs(y) <= CASTLE.hy - BODY_R;
  }

  boundPickup(w: World, p: OnFloor): void {
    if (Math.abs(p.x) > CASTLE.hx) {
      p.x = clamp(p.x, -CASTLE.hx, CASTLE.hx);
      p.vx = 0;
    }
    if (Math.abs(p.y) > CASTLE.hy) {
      if (breachAt(p.x, Math.sign(p.y))) losePickup(w, p);
      else {
        p.y = clamp(p.y, -CASTLE.hy, CASTLE.hy);
        p.vy = 0;
      }
    }
  }

  floorNear(_w: World, x: number, y: number): { x: number; y: number } {
    return { x: clamp(x, -CASTLE.hx + 0.4, CASTLE.hx - 0.4), y: clamp(y, -CASTLE.hy + 0.4, CASTLE.hy - 0.4) };
  }

  canLand(_w: World, x: number, y: number): boolean {
    if (Math.abs(x) > CASTLE.hx || Math.abs(y) > CASTLE.hy) return false;
    // a gift that lands in a breach in the wall falls through it
    return !breachAt(x, Math.sign(y));
  }

  update(w: World): void {
    const s = w.s;
    runHazards(
      w,
      () => {
        const kind: HazardKind = w.rng.chance(CASTLE.arrows) ? "arrows" : "boulder";
        return { kind, x: w.rng.range(-CASTLE.hx + 1.2, CASTLE.hx - 1.2), y: w.rng.range(-CASTLE.hy + 1.2, CASTLE.hy - 1.2) };
      },
      CASTLE.hazardGap,
    );
    // the banner rises for the fighter standing nearest the pole: at full speed alone, at half while contested
    const inZone = s.fighters.filter((f) => standing(f) && Math.hypot(f.x, f.y) < CASTLE.bannerR).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.id - b.id);
    const c = inZone[0];
    if (c) {
      if (s.toiletOccupant !== c.id) {
        s.toiletOccupant = c.id;
        w.ev({ kind: "capture", a: c.id });
      }
      c.toilet += inZone.length === 1 ? 1 : CASTLE.contested;
      if (c.toilet >= CASTLE.bannerFrames) w.win(c.id);
    } else s.toiletOccupant = -1;
  }

  danger(_w: World, _me: Fighter, x: number, y: number): boolean {
    return Math.abs(y) > CASTLE.hy - 1 && CASTLE.breaches.some((b) => Math.sign(y) === b.side && x > b.x0 - 0.6 && x < b.x1 + 0.6);
  }

  safe(_w: World, me: Fighter): { x: number; y: number } {
    return { x: me.x, y: me.y * 0.4 };
  }

  botGoal(w: World, me: Fighter, enemies: Fighter[]): Goal | null {
    if (w.s.toiletOccupant >= 0 && w.s.toiletOccupant !== me.id) return null; // go and knock them off it instead
    const r = Math.hypot(me.x, me.y);
    const closer = enemies.filter((e) => Math.hypot(e.x, e.y) < r).length;
    if (closer <= 1 || r < 2.5) return { x: 0, y: 0, use: false };
    return null;
  }

  throwAngle(_w: World, me: Fighter): number {
    let best = CASTLE.breaches[0];
    let bd = 1e9;
    for (const b of CASTLE.breaches) {
      const d = Math.hypot((b.x0 + b.x1) / 2 - me.x, b.side * CASTLE.hy - me.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return bd < 4 ? Math.atan2(best.side * CASTLE.hy - me.y, (best.x0 + best.x1) / 2 - me.x) : Math.atan2(me.y, me.x);
  }

  clampGoal(x: number, y: number): { x: number; y: number } {
    return { x: clamp(x, -CASTLE.hx + 0.8, CASTLE.hx - 0.8), y: clamp(y, -CASTLE.hy + 1.2, CASTLE.hy - 1.2) };
  }

  progress(f: Fighter): number {
    return f.toilet / CASTLE.bannerFrames;
  }

  headline(w: World): Headline | null {
    const c = w.s.fighters[w.s.toiletOccupant];
    if (!c) return null;
    const contested = w.s.fighters.filter((f) => standing(f) && Math.hypot(f.x, f.y) < CASTLE.bannerR).length > 1;
    return { text: contested ? `${nm(c)} is raising their banner, but it's contested!` : `${nm(c)} is raising their banner!`, frac: c.toilet / CASTLE.bannerFrames, who: c.id };
  }
}

export function makeArena(id: StageId): Arena {
  switch (id) {
    case "hell-toilet":
      return new HellToilet();
    case "construction-site":
      return new ConstructionSite();
    case "collapsing-tower":
      return new CollapsingTower();
    case "hindenburg-blimp":
      return new HindenburgBlimp();
    case "castle-under-siege":
      return new CastleUnderSiege();
  }
}
