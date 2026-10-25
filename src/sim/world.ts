// The fight simulation. Deterministic: a World is fully defined by its seed,
// the match config and the per-frame inputs, and it never reads the clock or
// Math.random. Rendering only reads `world.s`. The stage's rules (walls,
// edges, hazards, the objective and the win) live in arena.ts.
import {
  BTN,
  FPS,
  LIMBS,
  NO_INPUT,
  PARTS,
  type Fighter,
  type FighterState,
  type GameEvent,
  type Height,
  type PartId,
  type PlayerInput,
  type WorldState,
} from "./types";
import {
  AIR,
  BUFFER,
  CRUNCH,
  COMBO_FLOOR,
  COMBO_SCALE,
  CROWD,
  DIZZY,
  DOWN,
  FALL_FRAMES,
  GRAB,
  HOLD,
  HOP_AIR,
  HOP_CYCLE,
  KO_FRAMES,
  MOVES,
  REATTACH,
  REGROW_FRAMES,
  RESPAWN_INVULN,
  REVERSAL,
  REVERSAL_WHIFF_TOTAL,
  CHARGE,
  DASH,
  EVADE,
  FURY,
  HITSTOP,
  hitstopFor,
  SPECIAL_CHORD,
  SPECIAL_NAMES,
  SPEED,
  STRING_STARTS,
  TAUNT,
  THROW,
  type Move,
} from "./moves";
import { AIR_GRAB, AIR_GRABS, type AirGrab } from "./airgrabs";
import { STYLES } from "./styles";
import { Rng } from "./rng";
import { DEFAULT_STAGE, type StageId } from "./stages";
import { freshArenaState, makeArena, type Arena } from "./arena";

export { spawnPoints } from "./arena";

export interface MatchConfig {
  seed: number;
  styles: number[]; // one entry per fighter, 2..8 fighters
  humans?: boolean[];
  stage?: StageId; // default: Hell Toilet
  hitstop?: boolean; // default true; the calibration tests switch it off to compare raw timings
}

export const BASE_HP: Record<PartId, number> = { head: 40, torso: 100, armL: 30, armR: 30, legL: 35, legR: 35 };
const BUTTONS = [BTN.HIGH, BTN.LOW, BTN.GRAB, BTN.REV, BTN.LOCK, BTN.TARGET, BTN.USE, BTN.SPECIAL, BTN.TAUNT, BTN.DASH];
const BIT_INDEX: Record<number, number> = Object.fromEntries(BUTTONS.map((b, i) => [b, i]));
const LIMB_TORSO_SHARE = 0.35; // part of every limb/head hit that also lands on the torso
export const BODY_R = 0.33;
// states a knock leaves you in: falling from one of them credits whoever hit you last
const KNOCKED = new Set(["down", "hitstun", "blockstun", "thrown", "reversed", "dizzy", "air"]);
/** Launched and still up: the juggle states. */
export const airborne = (f: Fighter): boolean => f.state === "air";

export function arms(f: Fighter): number {
  return (f.parts.armL.attached ? 1 : 0) + (f.parts.armR.attached ? 1 : 0);
}
export function legs(f: Fighter): number {
  return (f.parts.legL.attached ? 1 : 0) + (f.parts.legR.attached ? 1 : 0);
}
/** Still in the fight: not KO'd and not falling off the stage. */
export function alive(f: Fighter): boolean {
  return f.state !== "ko" && f.state !== "falling";
}
export function actionable(f: Fighter): boolean {
  return f.state === "idle" || f.state === "walk";
}

function freshParts(style: number): Fighter["parts"] {
  const parts = {} as Fighter["parts"];
  for (const p of PARTS) {
    const max = Math.round(BASE_HP[p] * (p === "torso" ? STYLES[style].torso : 1));
    parts[p] = { hp: max, max, attached: true, regrow: 0, style };
  }
  return parts;
}

type LimbMod = "punch" | "kick" | "grab" | "grabReach" | "reach" | "speed" | "startup";
/**
 * One of the style's numbers, as the limbs that throw it have it: the arms for
 * punches and grabs, the legs for kicks and walking. A transplanted limb
 * brings its first owner's numbers with it; with none left, the body's own.
 */
export function limbMod(f: Fighter, limbs: readonly PartId[], key: LimbMod): number {
  let sum = 0;
  let n = 0;
  for (const p of limbs) {
    if (!f.parts[p].attached) continue;
    sum += STYLES[f.parts[p].style][key];
    n++;
  }
  return n ? sum / n : STYLES[f.style][key];
}
const ARMS = ["armL", "armR"] as const;
const LEGS = ["legL", "legR"] as const;

export class World {
  s: WorldState;
  rng: Rng;
  readonly hitstop: boolean;
  readonly arena: Arena;
  /** fighters frozen by hitstop on the current step: they neither act nor slide nor hit */
  private frozen: boolean[] = [];

  constructor(cfg: MatchConfig) {
    const n = cfg.styles.length;
    if (n < 2 || n > 8) throw new Error(`2..8 fighters, got ${n}`);
    const stage = cfg.stage ?? DEFAULT_STAGE;
    this.arena = makeArena(stage);
    this.rng = new Rng(cfg.seed);
    this.hitstop = cfg.hitstop ?? true;
    const sp = this.arena.spawns(n);
    this.s = {
      frame: 0,
      seed: cfg.seed,
      stage,
      fighters: cfg.styles.map((style, id) => ({
        id,
        style,
        human: cfg.humans?.[id] ?? false,
        spawnX: sp[id].x,
        spawnY: sp[id].y,
        x: sp[id].x,
        y: sp[id].y,
        facing: sp[id].facing,
        slideX: 0,
        slideY: 0,
        dirX: 0,
        dirY: 0,
        running: false,
        z: 0,
        vz: 0,
        juggle: 0,
        bounced: false,
        carryZ: 0,
        stickX: 0,
        stickY: 0,
        state: "idle",
        t: 0,
        dur: 0,
        move: null,
        moveHits: [],
        moveLanded: false,
        chain: false,
        chargeHeld: false,
        charge: 0,
        stop: 0,
        fury: 0,
        revHeight: "high",
        target: -1,
        parts: freshParts(style),
        invuln: 0,
        combo: 0,
        recentHits: [],
        partner: -1,
        holdStrikes: 0,
        holdCool: 0,
        hopPhase: 0,
        reattachPart: null,
        reattachPickup: -1,
        prevButtons: 0,
        pressed: BUTTONS.map(() => -1000),
        toilet: 0,
        kos: 0,
        deaths: 0,
        vehicle: -1,
        out: false,
        lastHitBy: -1,
      })),
      pickups: [],
      nextPickupId: 1,
      geysers: [],
      nextGeyser: 300,
      toiletOccupant: -1,
      winner: -1,
      events: [],
      arena: freshArenaState(),
    };
    this.arena.init(this);
  }

  get fighters(): Fighter[] {
    return this.s.fighters;
  }

  // ---------------------------------------------------------------- frame
  step(inputs: PlayerInput[]): void {
    const s = this.s;
    s.frame++;
    s.events = [];
    if (s.winner >= 0) return;
    const fs = s.fighters;

    for (const f of fs) this.latchInput(f, inputs[f.id] ?? NO_INPUT);
    // a fighter in hitstop sits this step out entirely; its presses stay buffered
    this.frozen = fs.map((f) => f.stop > 0);
    // the input buffer is paused while frozen, so a press made in the freeze still comes out after it
    for (const f of fs) if (this.frozen[f.id]) for (let i = 0; i < f.pressed.length; i++) if (f.pressed[i] > -1000 && f.pressed[i] < s.frame) f.pressed[i]++;
    for (const f of fs) {
      if (f.stop > 0) f.stop--;
      else this.updateFighter(f, inputs[f.id] ?? NO_INPUT);
    }
    for (const f of fs) if (!this.frozen[f.id]) this.resolveStrikes(f);
    for (const f of fs) if (!this.frozen[f.id]) this.resolveGrab(f);
    for (const f of fs) if (!this.frozen[f.id]) this.resolveThrown(f);
    this.physics();
    this.updatePickups();
    this.arena.update(this);
    if (!this.arena.respawn && s.winner < 0) {
      // the last one standing wins
      const left = fs.filter((f) => !f.out);
      if (left.length <= 1) this.win(left.length ? left[0].id : [...fs].sort((a, b) => b.kos - a.kos || a.id - b.id)[0].id);
    }
  }

  win(id: number): void {
    if (this.s.winner >= 0) return;
    this.s.winner = id;
    this.ev({ kind: "win", a: id });
  }

  /** Over the edge: falls for FALL_FRAMES, then is KO'd (and out, on a stage without respawns). */
  fall(f: Fighter): void {
    if (!alive(f)) return;
    if (!KNOCKED.has(f.state)) f.lastHitBy = -1; // walked off, or the floor went: nobody's KO
    else if (f.state === "thrown" && f.partner >= 0) f.lastHitBy = f.partner;
    if (f.state === "holding" || f.state === "held") this.release(f);
    if (f.state === "reattach") this.dropReattach(f);
    if (f.state === "airslam" || f.state === "airslammed") f.partner = -1;
    this.setState(f, "falling", FALL_FRAMES);
    f.stop = 0;
    this.ev({ kind: "fall", a: f.id, b: f.lastHitBy });
  }

  ev(e: Omit<GameEvent, "f">): void {
    this.s.events.push({ f: this.s.frame, ...e });
  }

  /** Freeze both parties of a contact for `frames` (never shortening a freeze already running). */
  freeze(a: Fighter | undefined, b: Fighter | undefined, frames: number): number {
    if (!this.hitstop) return 0;
    for (const f of [a, b]) if (f) f.stop = Math.max(f.stop, frames);
    return frames;
  }

  private addFury(f: Fighter | undefined, n: number): void {
    if (f && f.state !== "ko") f.fury = Math.min(FURY.max, f.fury + n);
  }

  /**
   * R2, or Circle + Triangle pressed within SPECIAL_CHORD frames of each other
   * (Urban Reign's SPA). `opener` is the button whose move is already running (its press was consumed).
   */
  private specialPressed(f: Fighter, opener = 0): boolean {
    if (this.buffered(f, BTN.SPECIAL)) return true;
    if (opener) return this.buffered(f, opener === BTN.GRAB ? BTN.HIGH : BTN.GRAB, this.s.frame - SPECIAL_CHORD);
    const st = f.pressed[BIT_INDEX[BTN.HIGH]];
    const gr = f.pressed[BIT_INDEX[BTN.GRAB]];
    return this.buffered(f, BTN.HIGH) && this.buffered(f, BTN.GRAB) && Math.abs(st - gr) <= SPECIAL_CHORD;
  }

  /** Start the style's special if the fighter asked for it and has the fury and a limb to do it with. */
  private trySpecial(f: Fighter, opener = 0): boolean {
    if (f.fury < FURY.cost || !this.specialPressed(f, opener)) return false;
    if (arms(f) === 0 && legs(f) < 2) return false;
    for (const b of [BTN.SPECIAL, BTN.HIGH, BTN.LOW, BTN.GRAB]) this.consume(f, b);
    f.fury -= FURY.cost;
    this.startMove(f, STYLES[f.style].special);
    this.ev({ kind: "special", a: f.id });
    return true;
  }

  /** The name of a special, for banners. */
  static specialName(id: string): string {
    return SPECIAL_NAMES[id as keyof typeof SPECIAL_NAMES] ?? id;
  }

  // ---------------------------------------------------------------- input
  private latchInput(f: Fighter, inp: PlayerInput): void {
    const edges = inp.buttons & ~f.prevButtons;
    for (const b of BUTTONS) if (edges & b) f.pressed[BIT_INDEX[b]] = this.s.frame;
    f.prevButtons = inp.buttons;
    f.stickX = inp.x;
    f.stickY = inp.y;
  }

  buffered(f: Fighter, b: number, since = this.s.frame - BUFFER): boolean {
    return f.pressed[BIT_INDEX[b]] >= Math.max(since, this.s.frame - BUFFER);
  }

  consume(f: Fighter, b: number): void {
    f.pressed[BIT_INDEX[b]] = -1000;
  }

  // ---------------------------------------------------------------- states
  setState(f: Fighter, st: FighterState, dur = 0): void {
    if (f.state === "seated" || f.state === "sitting") {
      if (st !== "seated" && this.s.toiletOccupant === f.id) {
        this.s.toiletOccupant = -1;
        this.ev({ kind: "unseat", a: f.id });
      }
    }
    f.state = st;
    f.t = 0;
    f.dur = dur;
    if (st !== "attack") {
      f.move = null;
      f.chain = false;
    }
    if (st === "idle" || st === "walk") f.combo = 0;
    if (st !== "walk") f.running = false;
  }

  /** Effective numbers of a strike for this fighter's style and body. */
  eff(f: Fighter, id: string): Move & { total: number } {
    const m = MOVES[id];
    const st = STYLES[f.style];
    // punches are the arms' and kicks the legs' (a transplant strikes like its first owner); the rest is the body's
    const by = m.kind === "punch" ? ARMS : m.kind === "kick" ? LEGS : null;
    let startup = m.startup + (by ? Math.round(limbMod(f, by, "startup")) : st.startup);
    if (m.kind === "punch" && arms(f) === 1) startup += 2;
    startup = Math.max(3, startup);
    // a special scales with the style's best damage multiplier
    const mult = m.kind === "punch" ? limbMod(f, ARMS, "punch") : m.kind === "kick" ? limbMod(f, LEGS, "kick") : m.kind === "special" ? Math.max(st.punch, st.kick, st.grab) : 1;
    let dmg = m.dmg * mult * (m.kind === "punch" && arms(f) === 1 ? 0.8 : 1);
    let push = m.push;
    let knockdown = m.knockdown;
    if (id === f.move && f.charge > 0) {
      const k = f.charge / CHARGE.max;
      dmg *= 1 + CHARGE.dmg * k;
      push *= 1 + CHARGE.push * k;
      knockdown ||= k >= 1;
    }
    return { ...m, startup, dmg, push, knockdown, reach: m.reach * (by ? limbMod(f, by, "reach") : st.reach), total: startup + m.active + m.recovery };
  }

  /** The string follow-up allowed for this style (high strings have style.string jabs). */
  nextOf(f: Fighter, id: string): string | undefined {
    const m = MOVES[id];
    if (!m.next) return undefined;
    if (m.kind === "punch" && id.startsWith("jab")) {
      const n = Number(id.slice(3));
      return n >= STYLES[f.style].string ? "punchFin" : m.next;
    }
    return m.next;
  }

  private startMove(f: Fighter, id: string): void {
    this.setState(f, "attack");
    f.move = id;
    f.moveHits = [];
    f.moveLanded = false;
    f.chain = false;
    f.charge = 0;
    f.chargeHeld = id === STRING_STARTS.high || id === STRING_STARTS.low;
    if (id === "dashStrike") return; // a charge goes where it was running
    const t = this.lockTarget(f);
    if (t && dist(f, t) < 3) f.facing = Math.atan2(t.y - f.y, t.x - f.x);
  }

  private updateFighter(f: Fighter, inp: PlayerInput): void {
    const s = this.s;
    if (f.invuln > 0) f.invuln--;
    if (f.holdCool > 0) f.holdCool--;
    for (const p of LIMBS) {
      const part = f.parts[p];
      if (part.regrow > 0 && --part.regrow === 0 && !part.attached) {
        part.attached = true;
        part.style = f.style;
        part.hp = Math.round(part.max * REATTACH.hpFrac);
        this.ev({ kind: "regrow", a: f.id, part: p });
      }
    }
    f.recentHits = f.recentHits.filter((h) => s.frame - h.f <= CROWD.window);

    switch (f.state) {
      case "idle":
      case "walk":
        this.updateActionable(f, inp);
        break;
      case "dash":
        this.updateDash(f, inp);
        break;
      case "evade":
        if (f.t < EVADE.move) this.travel(f, f.dirX * EVADE.speed, f.dirY * EVADE.speed);
        break;
      case "airslammed": {
        // carried along the grab's arc: up off the catch, then down on the slam
        const a = s.fighters[f.partner];
        if (!a || a.state !== "airslam" || a.partner !== f.id) {
          // the grab broke: they drop out of it
          f.partner = -1;
          this.setState(f, "air");
          f.vz = 0;
          break;
        }
        const g = World.airGrab(a);
        const u = Math.min(1, (f.t + 1) / g.slam);
        f.x = a.x + Math.cos(a.facing) * 0.7;
        f.y = a.y + Math.sin(a.facing) * 0.7;
        f.z = Math.max(0, f.carryZ * (1 - u) + g.lift * Math.sin(Math.PI * u));
        f.slideX = f.slideY = 0;
        f.vz = 0;
        break;
      }
      case "air": {
        // Soul Calibur's air control: the stick drifts the body, harder for every hit taken up here
        const st = this.stick(inp);
        const k = Math.min(AIR.steerMax, AIR.steer * f.juggle) * st.mag;
        f.slideX += st.dx * k;
        f.slideY += st.dy * k;
        break;
      }
      case "attack":
        this.updateAttack(f, inp);
        break;
      case "holding":
        this.updateHolding(f, inp);
        break;
      case "held":
        if (f.t < HOLD.escape && this.buffered(f, BTN.REV)) {
          this.consume(f, BTN.REV);
          const h = s.fighters[f.partner];
          this.release(f);
          this.setState(h, "reversed", REVERSAL.stun);
          f.invuln = 12;
          const stop = this.freeze(f, h, HITSTOP.reversal);
          this.addFury(f, FURY.reversal);
          this.ev({ kind: "reversal", a: f.id, b: h.id, stop });
        }
        break;
      case "seated":
        f.x = 0;
        f.y = 0;
        if (this.buffered(f, BTN.USE)) {
          this.consume(f, BTN.USE);
          this.setState(f, "idle");
          f.x = Math.cos(f.facing) * 1.1;
          f.y = Math.sin(f.facing) * 1.1;
        }
        break;
      case "sitting":
        f.x *= 0.7;
        f.y *= 0.7;
        break;
      case "driving":
        this.arena.drive(this, f, inp);
        break;
      default:
        break;
    }

    f.t++;
    if (f.dur > 0 && f.t >= f.dur) this.endState(f);
    if (f.state === "attack" && f.move) {
      const total = f.move === "grab" ? GRAB.startup + GRAB.active + GRAB.whiff : this.eff(f, f.move).total;
      if (f.t >= total) this.setState(f, "idle");
    }
  }

  private endState(f: Fighter): void {
    switch (f.state) {
      case "down":
        this.setState(f, "wakeup", DOWN.wake);
        f.invuln = DOWN.wake + DOWN.wakeInvuln;
        break;
      case "thrown":
        this.setState(f, "down", DOWN.dur);
        break;
      case "dizzy":
        f.parts.head.hp = DIZZY.headReset;
        this.setState(f, "idle");
        break;
      case "holding":
      case "held":
        this.release(f);
        break;
      case "reattach":
        if (f.reattachPart) {
          const p = f.parts[f.reattachPart];
          p.attached = true;
          p.regrow = 0;
          this.ev({ kind: "reattach", a: f.id, part: f.reattachPart });
        }
        f.reattachPart = null;
        this.setState(f, "idle");
        break;
      case "sitting":
        this.setState(f, "seated");
        break;
      case "taunt":
        this.addFury(f, TAUNT.fury);
        this.setState(f, "idle");
        break;
      case "airslammed":
        this.slam(f);
        break;
      case "airslam":
        f.partner = -1;
        this.setState(f, "idle");
        break;
      case "ko":
        if (this.arena.respawn) this.respawn(f);
        else f.dur = 0; // out for good
        break;
      case "falling":
        this.ko(f, f.lastHitBy, true);
        break;
      default:
        this.setState(f, "idle");
    }
  }

  /** The stick, as a unit direction and how far it is pushed (0..1). */
  private stick(inp: PlayerInput): { dx: number; dy: number; mag: number } {
    const mag = Math.hypot(inp.x, inp.y);
    return mag > 0.2 ? { dx: inp.x / mag, dy: inp.y / mag, mag: Math.min(1, mag) } : { dx: 0, dy: 0, mag: 0 };
  }

  /** Move by (dx, dy), but never over an edge. */
  private travel(f: Fighter, dx: number, dy: number): void {
    f.x += dx;
    f.y += dy;
    if (!this.arena.canWalk(this, f, f.x, f.y)) {
      f.x -= dx;
      f.y -= dy;
    }
  }

  private updateActionable(f: Fighter, inp: PlayerInput): void {
    const nArms = arms(f);
    const nLegs = legs(f);
    const lockHeld = (inp.buttons & BTN.LOCK) !== 0;
    const st = this.stick(inp);
    const running = f.running;

    if (this.buffered(f, BTN.TARGET)) {
      this.consume(f, BTN.TARGET);
      this.cycleTarget(f);
    }
    if (this.buffered(f, BTN.USE)) {
      this.consume(f, BTN.USE);
      if (this.doUse(f)) return;
    }
    if (this.buffered(f, BTN.TAUNT)) {
      this.consume(f, BTN.TAUNT);
      this.setState(f, "taunt", TAUNT.dur);
      return;
    }
    if (this.buffered(f, BTN.REV)) {
      this.consume(f, BTN.REV);
      // Square with a direction: evade that way; on its own: deflect whatever comes
      if (st.mag > 0.5 && nLegs > 0) {
        this.setState(f, "evade", EVADE.dur);
        f.dirX = st.dx;
        f.dirY = st.dy;
        f.invuln = Math.max(f.invuln, EVADE.invuln);
      } else {
        this.setState(f, "reversal", REVERSAL_WHIFF_TOTAL); // a landed reversal ends early
        const t = this.lockTarget(f);
        if (t && dist(f, t) < 3) f.facing = Math.atan2(t.y - f.y, t.x - f.x);
      }
      return;
    }
    if (this.trySpecial(f)) return;
    if (this.buffered(f, BTN.GRAB)) {
      // standing over a limb that fits a gap: pick it up and put it on, whoever it came from
      if (this.takeLimb(f, true)) {
        this.consume(f, BTN.GRAB);
        return;
      }
      if (nArms > 0) {
        this.consume(f, BTN.GRAB);
        this.startMove(f, "grab");
        return;
      }
    }
    if (this.buffered(f, BTN.HIGH)) {
      this.consume(f, BTN.HIGH);
      // the stick pulled back, away from where the fighter faces: the low string
      const back = st.mag > 0.5 && st.dx * Math.cos(f.facing) + st.dy * Math.sin(f.facing) < -0.5;
      if (running) this.startMove(f, "dashStrike");
      else if (back && nLegs === 2) this.startMove(f, STRING_STARTS.low);
      else this.startMove(f, nArms > 0 ? STRING_STARTS.high : "headbutt");
      return;
    }
    if (this.buffered(f, BTN.LOW) && nLegs === 2) {
      this.consume(f, BTN.LOW);
      this.startMove(f, STRING_STARTS.low);
      return;
    }
    if (this.buffered(f, BTN.DASH) && nLegs > 0) {
      this.consume(f, BTN.DASH);
      this.setState(f, "dash", DASH.dur);
      f.dirX = st.mag ? st.dx : Math.cos(f.facing);
      f.dirY = st.mag ? st.dy : Math.sin(f.facing);
      f.facing = Math.atan2(f.dirY, f.dirX);
      return;
    }

    // movement
    let moving = false;
    if (st.mag) {
      // Cross held: run (two legs, and not while locked on)
      const run = (inp.buttons & BTN.DASH) !== 0 && nLegs === 2 && !lockHeld;
      let sp: number;
      if (nLegs === 2) sp = (run ? SPEED.run : SPEED.walk) * limbMod(f, LEGS, "speed");
      else sp = f.hopPhase % HOP_CYCLE < HOP_AIR ? (nLegs === 1 ? SPEED.hop : SPEED.bounce) * (HOP_CYCLE / HOP_AIR) : 0;
      this.travel(f, st.dx * st.mag * sp, st.dy * st.mag * sp);
      moving = true;
      if (f.state === "idle") this.setState(f, "walk");
      f.running = run;
      const t = this.lockTarget(f);
      if (run || !(t && (lockHeld || dist(f, t) < 4.5))) turnToward(f, Math.atan2(st.dy, st.dx), run ? 0.4 : 0.3);
    } else if (f.state === "walk") this.setState(f, "idle");
    if (nLegs < 2 && (moving || f.hopPhase % HOP_CYCLE !== 0)) f.hopPhase++;
    else if (nLegs === 2) f.hopPhase = 0;

    // the soft lock turns you to the nearest foe close by; R1 holds you on your target wherever it is
    const t = this.lockTarget(f);
    if (t && !f.running && (lockHeld || dist(f, t) < 4.5)) turnToward(f, Math.atan2(t.y - f.y, t.x - f.x), lockHeld ? 0.4 : 0.25);
  }

  /** Cross: the burst, then a run if the button is still held; Circle out of it is the shoulder charge. */
  private updateDash(f: Fighter, inp: PlayerInput): void {
    if (f.t >= DASH.strikeFrom && this.buffered(f, BTN.HIGH)) {
      this.consume(f, BTN.HIGH);
      this.startMove(f, "dashStrike");
      return;
    }
    if (f.t < DASH.move) {
      const k = legs(f) === 2 ? 1 : 0.6;
      this.travel(f, f.dirX * DASH.speed * k, f.dirY * DASH.speed * k);
    } else if ((inp.buttons & BTN.DASH) !== 0 && legs(f) === 2 && Math.hypot(inp.x, inp.y) > 0.2) {
      this.setState(f, "walk");
      f.running = true;
    }
  }

  private updateAttack(f: Fighter, inp: PlayerInput): void {
    if (!f.move) return;
    // the first button of a Circle + Triangle chord already started its move: the special replaces it
    const opener = f.move === STRING_STARTS.high || f.move === STRING_STARTS.low ? BTN.HIGH : f.move === "grab" ? BTN.GRAB : 0;
    if (f.move === "grab") {
      if (f.t <= SPECIAL_CHORD) this.trySpecial(f, opener);
      return;
    }
    if (opener && f.t <= SPECIAL_CHORD && this.trySpecial(f, opener)) return;
    const m = this.eff(f, f.move);
    if (m.dash && f.t >= m.startup && f.t < m.startup + m.active) {
      f.x += Math.cos(f.facing) * m.dash;
      f.y += Math.sin(f.facing) * m.dash;
    }
    // charge: the opener waits on its last startup frame while its button is held
    if (f.chargeHeld) {
      const held = (inp.buttons & (m.height === "high" ? BTN.HIGH : BTN.LOW)) !== 0;
      if (held && f.t === m.startup - 1 && f.charge < CHARGE.max) {
        f.charge++;
        f.t--; // updateFighter advances it again
        return;
      }
      if (!held || f.t >= m.startup - 1) f.chargeHeld = false;
    }
    if (f.t < m.startup) {
      f.x += Math.cos(f.facing) * 0.012;
      f.y += Math.sin(f.facing) * 0.012;
    }
    const next = this.nextOf(f, f.move);
    if (!next) return;
    const btn = m.height === "high" ? BTN.HIGH : BTN.LOW;
    // presses during this move (not the one that started it) queue the follow-up
    if (f.t > 0 && this.buffered(f, btn, this.s.frame - f.t + 1)) {
      this.consume(f, btn);
      f.chain = true;
    }
    if (f.chain && f.moveLanded && f.t >= m.startup + m.active) {
      if (m.kind === "kick" && legs(f) < 2) return;
      if (m.kind === "punch" && arms(f) === 0) return;
      this.startMove(f, next);
    }
  }

  private updateHolding(f: Fighter, inp: PlayerInput): void {
    const p = this.s.fighters[f.partner];
    if (!p || p.state !== "held") {
      this.release(f);
      return;
    }
    p.x = f.x + Math.cos(f.facing) * 0.7;
    p.y = f.y + Math.sin(f.facing) * 0.7;
    p.facing = f.facing + Math.PI;
    if (this.buffered(f, BTN.HIGH) && f.holdCool === 0 && f.holdStrikes < HOLD.kneeMax) {
      this.consume(f, BTN.HIGH);
      f.holdCool = HOLD.kneeCool;
      f.holdStrikes++;
      const dmg = HOLD.knee * limbMod(f, ARMS, "grab") * this.comboScale(p);
      p.combo++;
      this.damage(p, "torso", dmg, f.id);
      this.addFury(f, FURY.hit);
      const stop = this.freeze(f, p, !alive(p) ? HITSTOP.ko : hitstopFor(dmg, false));
      this.ev({ kind: "hit", a: f.id, b: p.id, part: "torso", dmg, stop });
      return;
    }
    if (f.t >= 6 && this.buffered(f, BTN.GRAB)) {
      this.consume(f, BTN.GRAB);
      const mag = Math.hypot(inp.x, inp.y);
      const dir = mag > 0.3 ? Math.atan2(inp.y, inp.x) : f.facing;
      const dmg = THROW.dmg * limbMod(f, ARMS, "grab") * (arms(f) === 1 ? 0.6 : 1) * this.comboScale(p);
      this.release(f);
      this.setState(p, "thrown", THROW.dur);
      p.moveHits = [f.id];
      p.slideX = (Math.cos(dir) * THROW.dist) / THROW.dur;
      p.slideY = (Math.sin(dir) * THROW.dist) / THROW.dur;
      p.partner = f.id; // remembered as the thrower for splash damage credit
      this.damage(p, "torso", dmg, f.id);
      this.addFury(f, FURY.throw);
      const stop = this.freeze(f, p, HITSTOP.throw);
      this.ev({ kind: "throw", a: f.id, b: p.id, dmg, stop });
      this.setState(f, "idle");
      f.invuln = 6;
    }
  }

  // ---------------------------------------------------------------- targeting
  private lockTarget(f: Fighter): Fighter | null {
    const fs = this.s.fighters;
    const cur = fs[f.target];
    if (cur && cur.id !== f.id && alive(cur) && dist(f, cur) < 8) return cur;
    let best: Fighter | null = null;
    let bd = 1e9;
    for (const o of fs) {
      if (o.id === f.id || !alive(o)) continue;
      const d = dist(f, o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    f.target = best ? best.id : -1;
    return best;
  }

  private cycleTarget(f: Fighter): void {
    const others = this.s.fighters
      .filter((o) => o.id !== f.id && alive(o))
      .map((o) => ({ o, a: normAngle(Math.atan2(o.y - f.y, o.x - f.x) - f.facing + Math.PI * 2) }))
      .sort((a, b) => a.a - b.a);
    if (!others.length) return;
    const i = others.findIndex((e) => e.o.id === f.target);
    f.target = others[(i + 1) % others.length].o.id;
  }

  // ---------------------------------------------------------------- use
  /**
   * Pick up the nearest limb on the floor that fits one of f's gaps (an arm in
   * either shoulder, a leg in either hip) and put it on; with `any`, other
   * fighters' limbs too, else only f's own. Its first owner starts growing a
   * new one.
   */
  private takeLimb(f: Fighter, any: boolean): boolean {
    const s = this.s;
    const gap = (part: PartId): PartId | null => {
      const pair: readonly PartId[] = part.startsWith("arm") ? ARMS : LEGS;
      // the same side first
      for (const q of [part, ...pair.filter((x) => x !== part)]) if (!f.parts[q].attached) return q;
      return null;
    };
    let best = -1;
    let bd = REATTACH.range;
    s.pickups.forEach((p, i) => {
      if ((!any && p.owner !== f.id) || p.burning > 0 || p.z > 0.25 || !gap(p.part)) return;
      // your own comes first
      const d = Math.hypot(p.x - f.x, p.y - f.y) - (p.owner === f.id ? 0.01 : 0);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) return false;
    const p = s.pickups[best];
    const slot = gap(p.part)!;
    s.pickups.splice(best, 1);
    const part = f.parts[slot];
    part.hp = Math.max(1, Math.round(part.max * REATTACH.hpFrac));
    part.style = p.style;
    part.regrow = 0;
    if (p.owner !== f.id) {
      const lost = s.fighters[p.owner].parts[p.part];
      if (!lost.attached && lost.regrow === 0) lost.regrow = REGROW_FRAMES;
    }
    f.reattachPart = slot;
    this.setState(f, "reattach", REATTACH.dur);
    return true;
  }

  private doUse(f: Fighter): boolean {
    const s = this.s;
    if (this.takeLimb(f, false)) return true;
    if (this.arena.use(this, f)) return true;
    for (const p of s.pickups) {
      if (p.owner === f.id || p.burning > 0 || p.z > 0.25) continue;
      if (Math.hypot(p.x - f.x, p.y - f.y) < REATTACH.range) {
        p.vx = Math.cos(f.facing) * 0.2;
        p.vy = Math.sin(f.facing) * 0.2;
        p.vz = 0.11;
        this.ev({ kind: "punt", a: f.id, b: p.owner, part: p.part });
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- combat
  private comboScale(d: Fighter): number {
    return Math.max(COMBO_FLOOR, Math.pow(COMBO_SCALE, d.combo));
  }

  private resolveStrikes(f: Fighter): void {
    if (f.state !== "attack" || !f.move || f.move === "grab") return;
    const m = this.eff(f, f.move);
    if (f.t - 1 < m.startup || f.t - 1 >= m.startup + m.active) return; // t was advanced this frame
    if (m.rehit && (f.t - 1 - m.startup) % m.rehit === 0) f.moveHits = [];
    this.arena.strikeObjects(this, f, m);
    for (const d of this.s.fighters) {
      if (d.id === f.id || f.moveHits.includes(d.id) || !this.inCone(f, d, m.reach, m.arc)) continue;
      if (!this.hittable(d, m.height)) continue;
      f.moveHits.push(d.id);
      this.strike(f, d, m);
      if (f.state !== "attack") return; // reversed
    }
  }

  inCone(f: Fighter, d: Fighter, reach: number, arc: number): boolean {
    const dx = d.x - f.x;
    const dy = d.y - f.y;
    const dd = Math.hypot(dx, dy);
    if (dd > reach + BODY_R) return false;
    if (dd < 0.35) return true;
    return (dx * Math.cos(f.facing) + dy * Math.sin(f.facing)) / dd >= arc;
  }

  private hittable(d: Fighter, height: Height): boolean {
    if (!alive(d) || d.state === "thrown" || d.state === "driving" || d.invuln > 0) return false;
    if (d.state === "down") return height === "low"; // only low strikes reach a downed body
    if (d.state === "air") return d.z < (height === "low" ? AIR.low : AIR.high); // a body flown too high is out of reach
    if (d.state === "wakeup" || d.state === "airslam" || d.state === "airslammed") return false;
    return true;
  }

  private facingDot(d: Fighter, a: Fighter): number {
    const dx = a.x - d.x;
    const dy = a.y - d.y;
    const dd = Math.hypot(dx, dy) || 1;
    return (dx * Math.cos(d.facing) + dy * Math.sin(d.facing)) / dd;
  }

  private strike(a: Fighter, d: Fighter, m: Move & { total: number }): void {
    // reversal: right height, inside the window, facing the attacker
    // (a special cannot be reversed)
    // (Urban Reign's Square deflects high and low alike; there is no guard)
    if (m.kind !== "special" && d.state === "reversal" && this.inReversalWindow(d) && this.facingDot(d, a) > 0) {
      d.revHeight = m.height;
      this.reverse(d, a);
      return;
    }
    const dx = Math.cos(a.facing);
    const dy = Math.sin(a.facing);
    a.moveLanded = true;
    const otg = d.state === "down";
    const dmg = m.dmg * this.comboScale(d) * (otg ? DOWN.otgScale : 1) * (d.state === "reversal" ? 1.2 : 1);
    const part = this.pickPart(d, m.height);
    d.combo++;
    d.recentHits.push({ by: a.id, f: this.s.frame });
    const crowd = new Set(d.recentHits.map((h) => h.by)).size >= CROWD.attackers;
    const knock = m.knockdown || crowd || d.state === "seated" || d.state === "sitting";
    const hit: GameEvent = { f: this.s.frame, kind: "hit", a: a.id, b: d.id, part, dmg };
    this.s.events.push(hit);
    this.addFury(a, FURY.hit);
    this.addFury(d, FURY.taken);
    this.damage(d, part, dmg, a.id);
    this.arena.onHit(this, d);
    hit.stop = this.freeze(a, d, d.state === "ko" ? HITSTOP.ko : hitstopFor(dmg, knock && !otg));
    if (d.state === "ko") return;
    if (otg) return;

    if (d.state === "holding" || d.state === "held") this.release(d);
    if (d.state === "reattach") this.dropReattach(d);
    if (d.state === "air" || (m.launch && !crowd)) {
      this.juggle(d, a, dx, dy, m);
      return;
    }
    if (knock) {
      this.knockDown(d, dx, dy, Math.max(m.push, 0.8));
      if (crowd) {
        d.invuln = DOWN.dur + DOWN.wake + CROWD.invuln;
        d.recentHits = [];
        this.ev({ kind: "crowd", a: d.id });
      }
    } else if (d.state !== "dizzy") {
      this.setState(d, "hitstun", m.hitstun);
      d.slideX = (dx * m.push) / 8;
      d.slideY = (dy * m.push) / 8;
    }
  }

  /**
   * A launcher sends the victim up; every later blow while they are up pops
   * them a little higher (up to AIR.maxPops) and pushes them on, and a stick
   * held away from the attacker as it lands flies them further for every hit
   * of the juggle so far. Gravity stays the same however long it runs.
   */
  private juggle(d: Fighter, a: Fighter, dx: number, dy: number, m: Move): void {
    const fresh = d.state !== "air";
    if (fresh) {
      if (d.state === "dizzy") d.parts.head.hp = DIZZY.headReset;
      this.setState(d, "air");
      d.moveHits = [a.id];
      d.juggle = 1;
      d.bounced = false;
      d.vz = Math.max(d.vz, AIR.launch);
      this.ev({ kind: "launch", a: a.id, b: d.id });
    } else {
      d.juggle++;
      if (d.juggle <= AIR.maxPops) d.vz = Math.max(d.vz, 0) + AIR.pop;
    }
    // a launch goes straight up, so the next blow can follow it
    const k = fresh ? 0 : 1 / 40;
    d.slideX = dx * m.push * k;
    d.slideY = dy * m.push * k;
    const st = this.stick({ x: d.stickX, y: d.stickY, buttons: 0 });
    const away = st.dx * dx + st.dy * dy;
    if (!fresh && away > 0.3) {
      d.slideX += dx * AIR.flee * d.juggle * away;
      d.slideY += dy * AIR.flee * d.juggle * away;
    }
  }

  knockDown(d: Fighter, dx: number, dy: number, push: number): void {
    if (d.state === "holding" || d.state === "held") this.release(d);
    this.setState(d, "down", DOWN.dur);
    d.slideX = (dx * push) / 12;
    d.slideY = (dy * push) / 12;
  }

  /** t has already advanced this frame, so t - 1 is the reversal's motion frame (0 on the press frame). */
  private inReversalWindow(d: Fighter): boolean {
    const frame = d.t - 1;
    return frame >= REVERSAL.first && frame <= REVERSAL.window;
  }

  private reverse(d: Fighter, a: Fighter): void {
    this.setState(a, "reversed", REVERSAL.stun);
    a.slideX = (Math.cos(d.facing) * 0.6) / 10;
    a.slideY = (Math.sin(d.facing) * 0.6) / 10;
    this.damage(a, "torso", REVERSAL.dmg, d.id);
    this.setState(d, "idle");
    d.invuln = 12;
    d.facing = Math.atan2(a.y - d.y, a.x - d.x);
    const stop = this.freeze(a, d, HITSTOP.reversal);
    this.addFury(d, FURY.reversal);
    this.ev({ kind: "reversal", a: d.id, b: a.id, stop });
    // kinetic pushback: clear the crowd around the reverser
    for (const o of this.s.fighters) {
      if (o.id === d.id || o.id === a.id || !alive(o)) continue;
      if (o.state === "down" || o.state === "seated" || o.state === "thrown" || o.state === "wakeup" || o.state === "driving") continue;
      const ox = o.x - d.x;
      const oy = o.y - d.y;
      const od = Math.hypot(ox, oy);
      if (od > REVERSAL.pushR) continue;
      if (o.state === "holding" || o.state === "held") this.release(o);
      if (o.state === "reattach") this.dropReattach(o);
      this.setState(o, "hitstun", REVERSAL.pushStun);
      const k = od > 0.01 ? 1 / od : 0;
      o.slideX = (ox * k * REVERSAL.push) / 10;
      o.slideY = (oy * k * REVERSAL.push) / 10;
    }
  }

  private pickPart(d: Fighter, h: Height): PartId {
    const pool: [PartId, number][] =
      h === "high"
        ? [
            ["head", 2],
            ["torso", 3],
            ["armL", 1.5],
            ["armR", 1.5],
          ]
        : [
            ["legL", 1],
            ["legR", 1],
          ];
    const avail = pool.filter(([p]) => d.parts[p].attached);
    if (!avail.length) return "torso";
    let r = this.rng.next() * avail.reduce((a, [, w]) => a + w, 0);
    for (const [p, w] of avail) if ((r -= w) <= 0) return p;
    return avail[avail.length - 1][0];
  }

  /** Apply damage to a body part; limbs at 0 HP fall off, torso at 0 is a KO. */
  damage(d: Fighter, part: PartId, dmg: number, by: number): void {
    if (!alive(d)) return;
    if (by >= 0) d.lastHitBy = by;
    const p = d.parts[part];
    p.hp -= dmg;
    if (part !== "torso") d.parts.torso.hp -= dmg * LIMB_TORSO_SHARE;
    if (part !== "torso" && part !== "head" && p.hp <= 0 && p.attached) this.detach(d, part, by);
    if (d.parts.torso.hp <= 0) {
      this.ko(d, by);
      return;
    }
    if (part === "head" && p.hp <= 0 && d.state !== "dizzy") {
      p.hp = 0;
      if (d.state === "holding" || d.state === "held") this.release(d);
      this.setState(d, "dizzy", DIZZY.dur);
      this.ev({ kind: "dizzy", a: d.id });
    }
  }

  private detach(d: Fighter, part: PartId, by: number): void {
    const p = d.parts[part];
    p.attached = false;
    p.hp = 0;
    const src = this.s.fighters[by];
    const base = src ? Math.atan2(d.y - src.y, d.x - src.x) : this.rng.range(0, Math.PI * 2);
    const ang = base + this.rng.range(-0.9, 0.9);
    const sp = this.rng.range(0.05, 0.09);
    this.s.pickups.push({
      id: this.s.nextPickupId++,
      owner: d.id,
      part,
      style: p.style,
      hp: p.max,
      x: d.x,
      y: d.y,
      z: part.startsWith("arm") ? 1.2 : 0.5,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      vz: this.rng.range(0.08, 0.14),
      spin: this.rng.range(-0.4, 0.4),
      burning: 0,
    });
    this.ev({ kind: "detach", a: d.id, b: by, part });
  }

  private dropReattach(d: Fighter): void {
    if (!d.reattachPart) return;
    const part = d.reattachPart;
    d.parts[part].hp = 0;
    d.reattachPart = null;
    this.s.pickups.push({
      id: this.s.nextPickupId++,
      owner: d.id,
      part,
      style: d.parts[part].style,
      hp: d.parts[part].max,
      x: d.x,
      y: d.y,
      z: 0.8,
      vx: this.rng.range(-0.04, 0.04),
      vy: this.rng.range(-0.04, 0.04),
      vz: 0.08,
      spin: 0.2,
      burning: 0,
    });
  }

  private ko(d: Fighter, by: number, fell = false): void {
    if (d.state === "holding" || d.state === "held") this.release(d);
    if (d.state === "reattach") this.dropReattach(d);
    this.arena.onKo(this, d);
    d.parts.torso.hp = 0;
    d.fury = 0;
    this.setState(d, "ko", KO_FRAMES);
    d.deaths++;
    if (!this.arena.respawn) d.out = true;
    const killer = this.s.fighters[by];
    if (killer && killer.id !== d.id) killer.kos++;
    // the body comes apart (one that fell is gone already)
    if (!fell) for (const p of LIMBS) if (d.parts[p].attached) this.detach(d, p, by);
    this.ev({ kind: "ko", a: d.id, b: by, what: fell ? "fall" : undefined });
  }

  private respawn(f: Fighter): void {
    this.s.pickups = this.s.pickups.filter((p) => p.owner !== f.id);
    f.parts = freshParts(f.style);
    f.x = f.spawnX;
    f.y = f.spawnY;
    f.facing = Math.atan2(-f.y, -f.x);
    f.slideX = f.slideY = 0;
    f.z = f.vz = 0;
    f.juggle = 0;
    f.combo = 0;
    f.recentHits = [];
    f.lastHitBy = -1;
    f.invuln = RESPAWN_INVULN;
    this.setState(f, "idle");
    this.ev({ kind: "respawn", a: f.id });
  }

  private release(f: Fighter): void {
    const p = this.s.fighters[f.partner];
    f.partner = -1;
    f.holdStrikes = 0;
    if (f.state === "holding" || f.state === "held") this.setState(f, "idle");
    if (p && p.partner === f.id) {
      p.partner = -1;
      p.holdStrikes = 0;
      if (p.state === "holding" || p.state === "held") this.setState(p, "idle");
    }
  }

  private resolveGrab(f: Fighter): void {
    if (f.state !== "attack" || f.move !== "grab") return;
    const t = f.t - 1;
    if (t < GRAB.startup || t >= GRAB.startup + GRAB.active) return;
    const reach = GRAB.reach * limbMod(f, ARMS, "grabReach");
    let best: Fighter | null = null;
    let bd = 1e9;
    for (const d of this.s.fighters) {
      if (d.id === f.id) continue;
      if (d.invuln > 0 || ["ko", "falling", "driving", "down", "wakeup", "thrown", "held", "holding", "airslam", "airslammed"].includes(d.state)) continue;
      // up in a juggle: the air grab reaches further, but only up to an outstretched arm
      if (d.state === "air" && (d.z > AIR_GRAB.height || !this.inCone(f, d, AIR_GRAB.reach * limbMod(f, ARMS, "grabReach"), GRAB.arc))) continue;
      if (d.state !== "air" && !this.inCone(f, d, reach, GRAB.arc)) continue;
      const dd = dist(f, d);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    if (!best) return;
    if (best.state === "reversal" && this.inReversalWindow(best) && this.facingDot(best, f) > 0) {
      this.reverse(best, f);
      return;
    }
    if (best.state === "air") {
      this.catchAir(f, best);
      return;
    }
    if (best.state === "reattach") this.dropReattach(best);
    this.setState(f, "holding", HOLD.dur);
    this.setState(best, "held", HOLD.dur);
    f.partner = best.id;
    best.partner = f.id;
    f.holdStrikes = 0;
    f.holdCool = 8;
    f.facing = Math.atan2(best.y - f.y, best.x - f.x);
    const stop = this.freeze(f, best, HITSTOP.grab);
    this.arena.onHit(this, best);
    this.ev({ kind: "grab", a: f.id, b: best.id, stop });
  }

  /** A thrown body, or a juggled one flying fast enough, is a missile: it knocks down whoever it hits. */
  /** The fighter's air grab: the torso's own, whatever limbs it wears. */
  static airGrab(f: Fighter): AirGrab {
    return AIR_GRABS[STYLES[f.style].style] ?? AIR_GRABS["All-Round"];
  }

  /** Triangle on a juggled body in reach: the style's air grab, which ends the juggle. */
  private catchAir(f: Fighter, d: Fighter): void {
    const g = World.airGrab(f);
    f.facing = Math.atan2(d.y - f.y, d.x - f.x);
    this.setState(f, "airslam", g.dur);
    this.setState(d, "airslammed", g.slam);
    f.partner = d.id;
    d.partner = f.id;
    d.carryZ = d.z;
    d.vz = 0;
    d.slideX = d.slideY = 0;
    const stop = this.freeze(f, d, HITSTOP.grab);
    this.arena.onHit(this, d);
    this.ev({ kind: "airgrab", a: f.id, b: d.id, what: g.name, stop });
  }

  /**
   * The slam of an air grab: the damage lands, scaled by the arms that did it
   * (their style's grapple strength; one arm does 70%, none half), then the
   * grab's own ending.
   */
  private slam(d: Fighter): void {
    const a = this.s.fighters[d.partner];
    d.partner = -1;
    d.z = 0;
    d.juggle = 0;
    if (!a) return this.setState(d, "down", DOWN.dur);
    const g = World.airGrab(a);
    const n = arms(a);
    const dmg = g.dmg * limbMod(a, ARMS, "grab") * (n === 2 ? 1 : n === 1 ? 0.7 : 0.5) * this.comboScale(d);
    d.combo++;
    const hit: GameEvent = { f: this.s.frame, kind: "hit", a: a.id, b: d.id, part: "torso", dmg };
    this.s.events.push(hit);
    this.addFury(a, FURY.hit);
    this.damage(d, "torso", dmg, a.id);
    if (g.end === "limb") {
      const arm = ARMS.find((p) => d.parts[p].attached);
      if (arm && alive(d)) this.damage(d, arm, dmg, a.id);
    }
    hit.stop = this.freeze(a, d, alive(d) && d.state !== "ko" ? hitstopFor(dmg, true) : HITSTOP.ko);
    if (!alive(d)) return;
    const dx = Math.cos(a.facing);
    const dy = Math.sin(a.facing);
    if (g.end === "bounce") {
      // back up off the floor: a fresh juggle to carry on
      this.setState(d, "air");
      d.moveHits = [a.id];
      d.juggle = 1;
      d.bounced = true;
      d.vz = AIR.launch * 0.8;
      this.ev({ kind: "bounce", a: d.id });
    } else if (g.end === "throw") {
      this.setState(d, "thrown", THROW.dur);
      d.partner = a.id;
      d.moveHits = [a.id];
      d.slideX = (dx * (g.dist ?? THROW.dist)) / THROW.dur;
      d.slideY = (dy * (g.dist ?? THROW.dist)) / THROW.dur;
    } else {
      this.setState(d, "down", DOWN.dur);
    }
  }

  private resolveThrown(f: Fighter): void {
    const speed = Math.hypot(f.slideX, f.slideY);
    const missile = f.state === "air" && speed >= CRUNCH.knock;
    if (f.state !== "thrown" && !missile) return;
    const by = f.state === "thrown" ? f.partner : f.lastHitBy;
    for (const o of this.s.fighters) {
      if (o.id === f.id || f.moveHits.includes(o.id) || !this.hittable(o, "high") || o.state === "down" || o.state === "air") continue;
      if (dist(f, o) > 0.8 || f.z > 1.6) continue; // over their head
      f.moveHits.push(o.id);
      const dmg = THROW.splash;
      this.ev({ kind: "hit", a: by, b: o.id, part: "torso", dmg });
      if (missile) {
        this.ev({ kind: "crunch", a: f.id, b: o.id, dmg });
        this.damage(f, this.pickPart(f, "high"), dmg, by);
      }
      this.damage(o, "torso", dmg, by);
      if (o.state !== "ko") {
        const k = Math.hypot(f.slideX, f.slideY) || 1;
        this.knockDown(o, f.slideX / k, f.slideY / k, 1.2);
      }
    }
  }

  // ---------------------------------------------------------------- physics
  private physics(): void {
    const fs = this.s.fighters;
    for (const f of fs) {
      if (f.state === "seated" || f.state === "driving" || this.frozen[f.id]) continue;
      f.x += f.slideX;
      f.y += f.slideY;
      if (f.state === "air" || (f.z > 0 && f.state !== "airslammed")) this.fly(f);
      const decay = f.state === "thrown" ? 1 : f.state === "air" ? AIR.drag : 0.85;
      f.slideX *= decay;
      f.slideY *= decay;
      if (Math.abs(f.slideX) < 1e-4) f.slideX = 0;
      if (Math.abs(f.slideY) < 1e-4) f.slideY = 0;
    }
    // body separation
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i];
        const b = fs[j];
        if (!alive(a) || !alive(b) || a.state === "thrown" || b.state === "thrown" || a.state === "driving" || b.state === "driving") continue;
        if (a.partner === b.id && (a.state === "holding" || a.state === "held" || a.state === "airslam" || a.state === "airslammed")) continue;
        if (Math.abs(a.z - b.z) > 1) continue; // one flies over the other
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = BODY_R * 2;
        if (d >= min || d < 1e-6) continue;
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        const aFixed = a.state === "seated";
        const bFixed = b.state === "seated";
        if (!aFixed) {
          a.x -= ux * push * (bFixed ? 2 : 1);
          a.y -= uy * push * (bFixed ? 2 : 1);
        }
        if (!bFixed) {
          b.x += ux * push * (aFixed ? 2 : 1);
          b.y += uy * push * (aFixed ? 2 : 1);
        }
      }
    }
    for (const f of fs) {
      if (f.state === "falling") continue;
      const x = f.x;
      const y = f.y;
      const vx = f.slideX;
      const vy = f.slideY;
      this.arena.bound(this, f);
      this.crunch(f, f.x - x, f.y - y, vx, vy);
    }
  }

  /**
   * A body flying into a wall or a prop: the arena pushed it back by (cx, cy)
   * while it was sliding at (vx, vy). Fast enough, it crunches: a limb takes
   * the blow (the torso its share), and it rebounds off the surface.
   */
  private crunch(f: Fighter, cx: number, cy: number, vx: number, vy: number): void {
    const c = Math.hypot(cx, cy);
    if (c < 1e-5 || !alive(f)) return;
    if (f.state !== "air" && f.state !== "thrown" && f.state !== "down") return;
    const nx = cx / c;
    const ny = cy / c;
    const into = -(vx * nx + vy * ny); // speed into the surface
    if (into < CRUNCH.speed) return;
    const dmg = Math.round(CRUNCH.dmg * into);
    const by = f.state === "thrown" ? f.partner : f.lastHitBy;
    const part = this.pickPart(f, f.z > 0.5 || f.state === "thrown" ? "high" : "low");
    // bounce off: the part of the move into the surface comes back, softened
    f.slideX = (vx + 2 * into * nx) * CRUNCH.rebound;
    f.slideY = (vy + 2 * into * ny) * CRUNCH.rebound;
    this.ev({ kind: "crunch", a: f.id, b: by, part, dmg });
    this.damage(f, part, dmg, by);
    if (!alive(f)) return;
    this.freeze(f, undefined, hitstopFor(dmg, true));
  }

  /** Height under the floaty gravity: one bounce off the floor, then down. */
  private fly(f: Fighter): void {
    f.z += f.vz;
    f.vz -= AIR.g;
    if (f.z > 0) return;
    f.z = 0;
    const fall = -f.vz;
    f.vz = 0;
    if (f.state !== "air") return;
    if (!f.bounced && fall > AIR.bounceMin) {
      f.bounced = true;
      f.vz = fall * AIR.bounce;
      this.ev({ kind: "bounce", a: f.id });
      return;
    }
    f.juggle = 0;
    this.setState(f, "down", DOWN.dur);
  }

  private updatePickups(): void {
    const s = this.s;
    for (const p of s.pickups) {
      if (p.burning > 0) {
        p.burning--;
        p.z -= 0.01;
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;
      p.vz -= 0.008;
      if (p.z <= 0) {
        p.z = 0;
        p.vz = Math.abs(p.vz) > 0.03 ? -p.vz * 0.3 : 0;
        p.vx *= 0.8;
        p.vy *= 0.8;
        p.spin *= 0.8;
      }
      this.arena.boundPickup(this, p);
    }
    for (const p of s.pickups) {
      if (p.burning === 1) {
        const owner = s.fighters[p.owner];
        const part = owner.parts[p.part];
        if (!part.attached && owner.reattachPart !== p.part) part.regrow = REGROW_FRAMES;
      }
    }
    s.pickups = s.pickups.filter((p) => p.burning !== 1);
  }

  // ---------------------------------------------------------------- misc
  /** Order-sensitive hash of the whole simulation state (determinism tests, desync checks). */
  hash(): number {
    let h = 2166136261 >>> 0;
    const mix = (v: number) => {
      const q = Math.round(v * 1e5) | 0;
      h = Math.imul(h ^ q, 16777619) >>> 0;
    };
    const s = this.s;
    mix(s.frame);
    mix(this.rng.s);
    mix(s.toiletOccupant);
    mix(s.winner);
    this.arena.hash(mix, s.arena);
    for (const f of s.fighters) {
      mix(f.x);
      mix(f.y);
      mix(f.facing);
      mix(f.t);
      mix(f.state.length * 31 + f.state.charCodeAt(0));
      mix(f.invuln);
      mix(f.toilet);
      mix(f.charge);
      mix(f.stop);
      mix(f.fury);
      mix(f.vehicle);
      mix(f.running ? 1 : 0);
      mix(f.z);
      mix(f.vz);
      mix(f.juggle);
      mix(f.partner);
      mix(f.out ? 1 : 0);
      for (const p of PARTS) mix(f.parts[p].hp + (f.parts[p].attached ? 1000 : 0));
    }
    for (const p of s.pickups) {
      mix(p.x);
      mix(p.y);
      mix(p.z);
    }
    return h;
  }

  /** Seconds-to-frames helper for tests and UI. */
  static frames(sec: number): number {
    return Math.round(sec * FPS);
  }
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normAngle(a: number): number {
  a %= Math.PI * 2;
  return a < 0 ? a + Math.PI * 2 : a;
}

function turnToward(f: Fighter, want: number, rate: number): void {
  let d = want - f.facing;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  f.facing += Math.max(-rate, Math.min(rate, d));
}
