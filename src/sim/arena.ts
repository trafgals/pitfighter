// The rules of each stage: where fighters spawn, what keeps them in (walls) or
// lets them fall out (edges), what the arena throws at them, the stage's
// objective and how a match is won. The World runs the fight itself and asks
// the stage's Arena at fixed points of every step, so a stage never changes
// how strikes, grapples or reversals work.
//
// Like the World, an Arena is deterministic: all randomness goes through
// `w.rng`, in a fixed order.
import { BTN, LAVA_R, RING_R, SPAWN_R, TOILET_FRAMES, TOILET_R, type ArenaState, type Fighter, type HazardKind, type Pickup, type PlayerInput, type Vehicle, type VehicleKind } from "./types";
import { GEYSER, HITSTOP, LAVA, SIT_FRAMES, type Move, hitstopFor } from "./moves";
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

/** Construction Site and Castle Under Siege are won by KOs and by the banner; this many KOs win the yard. */
export const KO_TARGET = 4;

export const YARD = { hx: 10, hy: 7 };
export const VEHICLE_KINDS: VehicleKind[] = ["bulldozer", "excavator", "dumptruck", "forklift", "roller", "mixer", "loader", "crane"];
/** speed m/frame, accel m/frame², turn rad/frame, hp, ram damage at full speed, collision radius m */
export const VEHICLES: Record<VehicleKind, { name: string; speed: number; accel: number; turn: number; hp: number; ram: number; r: number }> = {
  bulldozer: { name: "Bulldozer", speed: 0.11, accel: 0.004, turn: 0.035, hp: 130, ram: 16, r: 1.15 },
  excavator: { name: "Excavator", speed: 0.09, accel: 0.0035, turn: 0.03, hp: 150, ram: 15, r: 1.2 },
  dumptruck: { name: "Dump Truck", speed: 0.15, accel: 0.005, turn: 0.034, hp: 100, ram: 14, r: 1.15 },
  forklift: { name: "Forklift", speed: 0.16, accel: 0.007, turn: 0.06, hp: 80, ram: 9, r: 0.8 },
  roller: { name: "Steamroller", speed: 0.08, accel: 0.003, turn: 0.03, hp: 160, ram: 22, r: 1.1 },
  mixer: { name: "Cement Mixer", speed: 0.13, accel: 0.0045, turn: 0.034, hp: 115, ram: 14, r: 1.15 },
  loader: { name: "Loader", speed: 0.12, accel: 0.005, turn: 0.045, hp: 100, ram: 12, r: 1.0 },
  crane: { name: "Crane Truck", speed: 0.1, accel: 0.0038, turn: 0.03, hp: 140, ram: 15, r: 1.2 },
};
export const BOOST = { dur: 30, cool: 150, mult: 1.6 };
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
  return { vehicles: [], tiles: [], nextCrack: 0, fireX: BLIMP.half + 1, wind: 0, windDir: 1, nextWind: 0 };
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
}

/** The line over the scoreboard: who holds the objective and how far along they are. */
export interface Headline {
  text: string;
  frac: number;
  who: number; // the fighter it is about (bar colour), -1 none
}

export abstract class Arena {
  abstract readonly id: StageId;
  /** KO'd fighters come back; false: KO and falls eliminate, and the last one standing wins */
  abstract readonly respawn: boolean;
  abstract spawns(n: number): Spawn[];
  init(_w: World): void {}
  /** Walls, solid props, burning ground and edges for one fighter, after it moved. */
  abstract bound(w: World, f: Fighter): void;
  /** Whether a fighter may walk to (x, y). Walking never takes you over an edge; knockback does. */
  canWalk(_w: World, _f: Fighter, _x: number, _y: number): boolean {
    return true;
  }
  abstract boundPickup(w: World, p: Pickup): void;
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

/** Burning ground: the fighter takes LAVA.dmg every LAVA.tick frames. */
function burn(w: World, f: Fighter): void {
  if (alive(f) && w.s.frame % LAVA.tick === 0 && f.invuln === 0) {
    w.damage(f, "torso", LAVA.dmg, -1);
    w.ev({ kind: "hit", a: -1, b: f.id, part: "torso", dmg: LAVA.dmg });
  }
}

/** A limb on the floor of an edge stage that slides off the edge (or into fire) is gone; it grows back. */
function losePickup(w: World, p: Pickup): void {
  if (p.burning > 0) return;
  p.burning = 40;
  w.ev({ kind: "burn", a: p.owner, part: p.part });
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

  boundPickup(w: World, p: Pickup): void {
    const r = Math.hypot(p.x, p.y);
    if (r > LAVA_R) {
      p.x *= LAVA_R / r;
      p.y *= LAVA_R / r;
      p.vx = p.vy = 0;
    }
    if (p.z === 0 && Math.hypot(p.x, p.y) > RING_R) losePickup(w, p);
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

  /** Everyone starts in a different construction vehicle. */
  init(w: World): void {
    const vs = w.s.arena.vehicles;
    for (const f of w.s.fighters) {
      const kind = VEHICLE_KINDS[f.id % VEHICLE_KINDS.length];
      const st = VEHICLES[kind];
      vs.push({ id: f.id, kind, x: f.x, y: f.y, facing: f.facing, speed: 0, hp: st.hp, max: st.hp, driver: f.id, boost: 0, cool: 0, wrecked: false, lastBy: -1 });
      f.vehicle = f.id;
      w.setState(f, "driving");
    }
  }

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
    if (w.buffered(f, BTN.HIGH)) {
      w.consume(f, BTN.HIGH);
      if (v.cool === 0) {
        v.boost = BOOST.dur;
        v.cool = BOOST.cool;
      }
    }
    for (const b of [BTN.LOW, BTN.GRAB, BTN.REV, BTN.SPECIAL, BTN.TARGET, BTN.TAUNT, BTN.DASH]) w.consume(f, b);
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
    if (v.boost > 0) want = st.speed * BOOST.mult;
    v.speed += clamp(want - v.speed, -st.accel * 2, st.accel * (v.boost > 0 ? 3 : 1));
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
    let best: Vehicle | null = null;
    let bd = 1e9;
    for (const v of w.s.arena.vehicles) {
      if (v.wrecked || v.driver >= 0) continue;
      const d = dist(f, v) - VEHICLES[v.kind].r;
      if (d < 0.9 && d < bd) {
        bd = d;
        best = v;
      }
    }
    if (!best) return false;
    best.driver = f.id;
    best.speed = 0;
    f.vehicle = best.id;
    w.setState(f, "driving");
    f.x = best.x;
    f.y = best.y;
    w.ev({ kind: "enter", a: f.id, x: best.x, y: best.y });
    return true;
  }

  onKo(w: World, d: Fighter): void {
    const v = w.s.arena.vehicles[d.vehicle];
    if (v && v.driver === d.id) v.driver = -1;
    d.vehicle = -1;
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
      v.hp -= m.dmg;
      v.lastBy = f.id;
      f.moveLanded = true;
      w.freeze(f, undefined, HITSTOP.block);
      w.ev({ kind: "crash", a: f.id, what: "strike", x: v.x, y: v.y, dmg: m.dmg });
    }
  }

  bound(w: World, f: Fighter): void {
    if (f.state === "driving") return;
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

  boundPickup(_w: World, p: Pickup): void {
    if (Math.abs(p.x) > YARD.hx || Math.abs(p.y) > YARD.hy) {
      p.x = clamp(p.x, -YARD.hx, YARD.hx);
      p.y = clamp(p.y, -YARD.hy, YARD.hy);
      p.vx = p.vy = 0;
    }
  }

  update(w: World): void {
    const s = w.s;
    const vs = s.arena.vehicles;
    // drive
    for (const v of vs) {
      if (v.boost > 0) v.boost--;
      if (v.cool > 0) v.cool--;
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
        if (Math.abs(v.speed) > 0.06) {
          v.hp -= Math.abs(v.speed) * 60;
          w.ev({ kind: "crash", a: v.driver, what: "wall", x: v.x, y: v.y });
        }
        v.speed *= -0.3;
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
    // run people over
    for (const v of vs) {
      if (v.wrecked || Math.abs(v.speed) < RAM_MIN) continue;
      const st = VEHICLES[v.kind];
      for (const f of s.fighters) {
        if (f.id === v.driver || !alive(f) || f.invuln > 0 || ["driving", "down", "wakeup", "thrown"].includes(f.state)) continue;
        const dx = f.x - v.x;
        const dy = f.y - v.y;
        const d = Math.hypot(dx, dy);
        if (d > st.r + BODY_R + 0.05) continue;
        const dmg = st.ram * Math.min(1.5, Math.abs(v.speed) / st.speed);
        w.ev({ kind: "hit", a: v.driver, b: f.id, part: "torso", dmg, what: "ram" });
        w.damage(f, "torso", dmg, v.driver);
        if (alive(f)) {
          const hx = Math.cos(v.facing) * Math.sign(v.speed) + (d > 0.01 ? dx / d : 0);
          const hy = Math.sin(v.facing) * Math.sign(v.speed) + (d > 0.01 ? dy / d : 0);
          const k = Math.hypot(hx, hy) || 1;
          w.knockDown(f, hx / k, hy / k, 1.8);
          w.freeze(f, undefined, hitstopFor(dmg, true));
        }
        v.speed *= 0.8;
      }
    }
    // wrecks
    for (const v of vs) {
      if (v.wrecked || v.hp > 0) continue;
      v.wrecked = true;
      v.hp = 0;
      v.speed = 0;
      w.ev({ kind: "wreck", a: v.driver, b: v.lastBy, x: v.x, y: v.y, what: v.kind });
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
    // the crane drops steel
    runHazards(w, () => ({ kind: "beam", x: w.rng.range(-YARD.hx + 1.5, YARD.hx - 1.5), y: w.rng.range(-YARD.hy + 1.5, YARD.hy - 1.5) }), [300, 480]);
    for (const f of s.fighters) {
      if (f.kos >= KO_TARGET) {
        w.win(f.id);
        break;
      }
    }
  }

  danger(w: World, me: Fighter, x: number, y: number): boolean {
    // the barriers only stop you; the danger is being in front of a moving vehicle
    for (const v of w.s.arena.vehicles) {
      if (v.wrecked || v.driver === me.id || Math.abs(v.speed) < RAM_MIN) continue;
      const dx = x - v.x;
      const dy = y - v.y;
      const d = Math.hypot(dx, dy);
      if (d < 3.5 && (dx * Math.cos(v.facing) + dy * Math.sin(v.facing)) * Math.sign(v.speed) > d * 0.7) return true;
    }
    return false;
  }

  safe(w: World, me: Fighter): { x: number; y: number } {
    // step sideways out of the path of the nearest moving vehicle
    let best: Vehicle | null = null;
    for (const v of w.s.arena.vehicles) if (!v.wrecked && v.driver !== me.id && Math.abs(v.speed) >= RAM_MIN && (!best || dist(me, v) < dist(me, best))) best = v;
    if (!best) return { x: 0, y: 0 };
    const side = best.facing + Math.PI / 2;
    const s = (me.x - best.x) * Math.cos(side) + (me.y - best.y) * Math.sin(side) >= 0 ? 1 : -1;
    return this.clampGoal(me.x + Math.cos(side) * 3 * s, me.y + Math.sin(side) * 3 * s);
  }

  botGoal(w: World, me: Fighter, enemies: Fighter[]): Goal | null {
    if (enemies.some((e) => e.state !== "driving" && dist(e, me) < 1.6)) return null;
    let best: Vehicle | null = null;
    for (const v of w.s.arena.vehicles) {
      if (v.wrecked || v.driver >= 0 || v.hp < v.max * 0.25 || dist(me, v) > 7) continue;
      if (!best || dist(me, v) < dist(me, best)) best = v;
    }
    if (!best) return null;
    return { x: best.x, y: best.y, use: dist(me, best) < VEHICLES[best.kind].r + 0.75 };
  }

  clampGoal(x: number, y: number): { x: number; y: number } {
    return { x: clamp(x, -YARD.hx + 0.8, YARD.hx - 0.8), y: clamp(y, -YARD.hy + 0.8, YARD.hy - 0.8) };
  }

  progress(f: Fighter): number {
    return Math.min(1, f.kos / KO_TARGET);
  }

  headline(w: World): Headline | null {
    const lead = w.s.fighters.reduce((a, b) => (b.kos > a.kos ? b : a));
    if (lead.kos === 0) return { text: `First to ${KO_TARGET} KOs owns the yard`, frac: 0, who: -1 };
    return { text: `${nm(lead)} leads with ${lead.kos} of ${KO_TARGET} KOs`, frac: lead.kos / KO_TARGET, who: lead.id };
  }

  hash(mix: (v: number) => void, a: ArenaState): void {
    for (const v of a.vehicles) {
      mix(v.x);
      mix(v.y);
      mix(v.facing);
      mix(v.speed);
      mix(v.hp);
      mix(v.driver);
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

  bound(w: World, f: Fighter): void {
    if (!this.onFloor(w, f.x, f.y)) w.fall(f);
  }

  canWalk(w: World, _f: Fighter, x: number, y: number): boolean {
    return this.onFloor(w, x, y);
  }

  boundPickup(w: World, p: Pickup): void {
    if (p.z === 0 && !this.onFloor(w, p.x, p.y)) losePickup(w, p);
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

  boundPickup(w: World, p: Pickup): void {
    if (p.z === 0 && (!onDeck(p.x, p.y) || p.x > w.s.arena.fireX)) losePickup(w, p);
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
    return { text: `${left} ${left === 1 ? "survivor" : "survivors"} in the burning wreck`, frac: 1, who: -1 };
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

  boundPickup(w: World, p: Pickup): void {
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
