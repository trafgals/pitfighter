// The fight simulation. Deterministic: a World is fully defined by its seed,
// the match config and the per-frame inputs, and it never reads the clock or
// Math.random. Rendering only reads `world.s`.
import {
  BTN,
  FPS,
  LAVA_R,
  LIMBS,
  NO_INPUT,
  PARTS,
  RING_R,
  SPAWN_R,
  TOILET_FRAMES,
  TOILET_R,
  type Fighter,
  type FighterState,
  type GameEvent,
  type Height,
  type PartId,
  type PlayerInput,
  type WorldState,
} from "./types";
import {
  BUFFER,
  COMBO_FLOOR,
  COMBO_SCALE,
  CROWD,
  DIZZY,
  DOWN,
  GEYSER,
  GRAB,
  HOLD,
  HOP_AIR,
  HOP_CYCLE,
  KO_FRAMES,
  LAVA,
  MOVES,
  REATTACH,
  REGROW_FRAMES,
  RESPAWN_INVULN,
  REVERSAL,
  REVERSAL_WHIFF_TOTAL,
  CHARGE,
  SIT_FRAMES,
  SPEED,
  STRING_STARTS,
  THROW,
  type Move,
} from "./moves";
import { STYLES } from "./styles";
import { Rng } from "./rng";
import { DEFAULT_STAGE, stageById, type StageId } from "./stages";

export interface MatchConfig {
  seed: number;
  styles: number[]; // one entry per fighter, 2..8 fighters
  humans?: boolean[];
  stage?: StageId; // default: Hell Toilet
}

export const BASE_HP: Record<PartId, number> = { head: 40, torso: 100, armL: 30, armR: 30, legL: 35, legR: 35 };
const BUTTONS = [BTN.HIGH, BTN.LOW, BTN.GRAB, BTN.REV, BTN.GUARD, BTN.TARGET, BTN.USE];
const BIT_INDEX: Record<number, number> = Object.fromEntries(BUTTONS.map((b, i) => [b, i]));
const LIMB_TORSO_SHARE = 0.35; // part of every limb/head hit that also lands on the torso
const GUARD_ARC = Math.cos((75 * Math.PI) / 180);
const BODY_R = 0.33;

export function spawnPoints(n: number): { x: number; y: number; facing: number }[] {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = Math.cos(a) * SPAWN_R;
    const y = Math.sin(a) * SPAWN_R;
    out.push({ x, y, facing: Math.atan2(-y, -x) });
  }
  return out;
}

export function arms(f: Fighter): number {
  return (f.parts.armL.attached ? 1 : 0) + (f.parts.armR.attached ? 1 : 0);
}
export function legs(f: Fighter): number {
  return (f.parts.legL.attached ? 1 : 0) + (f.parts.legR.attached ? 1 : 0);
}
export function alive(f: Fighter): boolean {
  return f.state !== "ko";
}
export function actionable(f: Fighter): boolean {
  return f.state === "idle" || f.state === "walk" || f.state === "guard";
}

function freshParts(style: number): Fighter["parts"] {
  const parts = {} as Fighter["parts"];
  for (const p of PARTS) {
    const max = Math.round(BASE_HP[p] * (p === "torso" ? STYLES[style].torso : 1));
    parts[p] = { hp: max, max, attached: true, regrow: 0 };
  }
  return parts;
}

export class World {
  s: WorldState;
  rng: Rng;

  constructor(cfg: MatchConfig) {
    const n = cfg.styles.length;
    if (n < 2 || n > 8) throw new Error(`2..8 fighters, got ${n}`);
    const stage = cfg.stage ?? DEFAULT_STAGE;
    if (!stageById(stage).playable) throw new Error(`stage ${stage} is not playable yet`);
    this.rng = new Rng(cfg.seed);
    const sp = spawnPoints(n);
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
        state: "idle",
        t: 0,
        dur: 0,
        move: null,
        moveHits: [],
        moveLanded: false,
        chain: false,
        chargeHeld: false,
        charge: 0,
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
      })),
      pickups: [],
      nextPickupId: 1,
      geysers: [],
      nextGeyser: 300,
      toiletOccupant: -1,
      winner: -1,
      events: [],
    };
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
    for (const f of fs) this.updateFighter(f, inputs[f.id] ?? NO_INPUT);
    for (const f of fs) this.resolveStrikes(f);
    for (const f of fs) this.resolveGrab(f);
    for (const f of fs) this.resolveThrown(f);
    this.physics();
    this.updatePickups();
    this.updateGeysers();
    this.updateToilet();
  }

  private ev(e: Omit<GameEvent, "f">): void {
    this.s.events.push({ f: this.s.frame, ...e });
  }

  // ---------------------------------------------------------------- input
  private latchInput(f: Fighter, inp: PlayerInput): void {
    const edges = inp.buttons & ~f.prevButtons;
    for (const b of BUTTONS) if (edges & b) f.pressed[BIT_INDEX[b]] = this.s.frame;
    f.prevButtons = inp.buttons;
  }

  private buffered(f: Fighter, b: number, since = this.s.frame - BUFFER): boolean {
    return f.pressed[BIT_INDEX[b]] >= Math.max(since, this.s.frame - BUFFER);
  }

  private consume(f: Fighter, b: number): void {
    f.pressed[BIT_INDEX[b]] = -1000;
  }

  // ---------------------------------------------------------------- states
  private setState(f: Fighter, st: FighterState, dur = 0): void {
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
    if (st === "idle" || st === "walk" || st === "guard") f.combo = 0;
  }

  /** Effective numbers of a strike for this fighter's style and body. */
  eff(f: Fighter, id: string): Move & { total: number } {
    const m = MOVES[id];
    const st = STYLES[f.style];
    let startup = m.startup + st.startup;
    if (m.kind === "punch" && arms(f) === 1) startup += 2;
    startup = Math.max(3, startup);
    const mult = m.kind === "punch" ? st.punch : m.kind === "kick" ? st.kick : 1;
    let dmg = m.dmg * mult * (m.kind === "punch" && arms(f) === 1 ? 0.8 : 1);
    let push = m.push;
    let knockdown = m.knockdown;
    if (id === f.move && f.charge > 0) {
      const k = f.charge / CHARGE.max;
      dmg *= 1 + CHARGE.dmg * k;
      push *= 1 + CHARGE.push * k;
      knockdown ||= k >= 1;
    }
    return { ...m, startup, dmg, push, knockdown, reach: m.reach * st.reach, total: startup + m.active + m.recovery };
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
        part.hp = Math.round(part.max * REATTACH.hpFrac);
        this.ev({ kind: "regrow", a: f.id, part: p });
      }
    }
    f.recentHits = f.recentHits.filter((h) => s.frame - h.f <= CROWD.window);

    switch (f.state) {
      case "idle":
      case "walk":
      case "guard":
        this.updateActionable(f, inp);
        break;
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
          this.ev({ kind: "reversal", a: f.id, b: h.id });
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
      case "ko":
        this.respawn(f);
        break;
      default:
        this.setState(f, "idle");
    }
  }

  private updateActionable(f: Fighter, inp: PlayerInput): void {
    const nArms = arms(f);
    const nLegs = legs(f);
    const guardHeld = (inp.buttons & BTN.GUARD) !== 0;

    if (this.buffered(f, BTN.TARGET)) {
      this.consume(f, BTN.TARGET);
      this.cycleTarget(f);
    }
    if (this.buffered(f, BTN.USE)) {
      this.consume(f, BTN.USE);
      if (this.doUse(f)) return;
    }
    if (this.buffered(f, BTN.REV)) {
      const height: Height = guardHeld || nArms === 0 ? "low" : "high";
      if (height === "high" || nLegs > 0) {
        this.consume(f, BTN.REV);
        this.setState(f, "reversal", REVERSAL_WHIFF_TOTAL); // a landed reversal ends early
        f.revHeight = height;
        const t = this.lockTarget(f);
        if (t && dist(f, t) < 3) f.facing = Math.atan2(t.y - f.y, t.x - f.x);
        return;
      }
    }
    if (this.buffered(f, BTN.GRAB) && nArms > 0) {
      this.consume(f, BTN.GRAB);
      this.startMove(f, "grab");
      return;
    }
    if (this.buffered(f, BTN.HIGH)) {
      this.consume(f, BTN.HIGH);
      this.startMove(f, nArms > 0 ? STRING_STARTS.high : "headbutt");
      return;
    }
    if (this.buffered(f, BTN.LOW) && nLegs === 2) {
      this.consume(f, BTN.LOW);
      this.startMove(f, STRING_STARTS.low);
      return;
    }

    const canGuard = guardHeld && nArms > 0 && nLegs === 2;
    if (canGuard && f.state !== "guard") this.setState(f, "guard");
    else if (!canGuard && f.state === "guard") this.setState(f, "idle");

    // movement
    const mag = Math.hypot(inp.x, inp.y);
    let moving = false;
    if (mag > 0.2) {
      const k = Math.min(1, mag) / mag;
      const dx = inp.x * k;
      const dy = inp.y * k;
      let sp: number;
      if (nLegs === 2) sp = (f.state === "guard" ? SPEED.guard : SPEED.walk) * STYLES[f.style].speed;
      else if (nLegs === 1) sp = f.hopPhase % HOP_CYCLE < HOP_AIR ? SPEED.hop * (HOP_CYCLE / HOP_AIR) : 0;
      else sp = SPEED.crawl;
      f.x += dx * sp;
      f.y += dy * sp;
      moving = true;
      if (f.state === "idle") this.setState(f, "walk");
      const t = this.lockTarget(f);
      if (!(t && dist(f, t) < 4.5)) turnToward(f, Math.atan2(dy, dx), 0.3);
    } else if (f.state === "walk") this.setState(f, "idle");
    if (nLegs === 1 && (moving || f.hopPhase % HOP_CYCLE !== 0)) f.hopPhase++;
    else if (nLegs !== 1) f.hopPhase = 0;

    const t = this.lockTarget(f);
    if (t && dist(f, t) < 4.5) turnToward(f, Math.atan2(t.y - f.y, t.x - f.x), 0.25);
  }

  private updateAttack(f: Fighter, inp: PlayerInput): void {
    if (!f.move) return;
    if (f.move === "grab") return;
    const m = this.eff(f, f.move);
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
      const dmg = HOLD.knee * STYLES[f.style].grab * this.comboScale(p);
      p.combo++;
      this.damage(p, "torso", dmg, f.id);
      this.ev({ kind: "hit", a: f.id, b: p.id, part: "torso", dmg });
      return;
    }
    if (f.t >= 6 && this.buffered(f, BTN.GRAB)) {
      this.consume(f, BTN.GRAB);
      const mag = Math.hypot(inp.x, inp.y);
      const dir = mag > 0.3 ? Math.atan2(inp.y, inp.x) : f.facing;
      const dmg = THROW.dmg * STYLES[f.style].grab * (arms(f) === 1 ? 0.6 : 1) * this.comboScale(p);
      this.release(f);
      this.setState(p, "thrown", THROW.dur);
      p.moveHits = [f.id];
      p.slideX = (Math.cos(dir) * THROW.dist) / THROW.dur;
      p.slideY = (Math.sin(dir) * THROW.dist) / THROW.dur;
      p.partner = f.id; // remembered as the thrower for splash damage credit
      this.damage(p, "torso", dmg, f.id);
      this.ev({ kind: "throw", a: f.id, b: p.id, dmg });
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
  private doUse(f: Fighter): boolean {
    const s = this.s;
    let best = -1;
    let bd = REATTACH.range;
    s.pickups.forEach((p, i) => {
      if (p.owner !== f.id || p.burning > 0 || p.z > 0.25) return;
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) {
      const p = s.pickups[best];
      s.pickups.splice(best, 1);
      const part = f.parts[p.part];
      part.hp = Math.max(1, Math.round(part.max * REATTACH.hpFrac));
      f.reattachPart = p.part;
      this.setState(f, "reattach", REATTACH.dur);
      return true;
    }
    if (s.toiletOccupant < 0 && Math.hypot(f.x, f.y) < TOILET_R) {
      s.toiletOccupant = f.id;
      this.setState(f, "sitting", SIT_FRAMES);
      f.facing = Math.atan2(-f.spawnY, -f.spawnX) + Math.PI; // face back out at the crowd
      this.ev({ kind: "sit", a: f.id });
      return true;
    }
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
    for (const d of this.s.fighters) {
      if (d.id === f.id || f.moveHits.includes(d.id) || !this.inCone(f, d, m.reach, m.arc)) continue;
      if (!this.hittable(d, m.height)) continue;
      f.moveHits.push(d.id);
      this.strike(f, d, m);
      if (f.state !== "attack") return; // reversed
    }
  }

  private inCone(f: Fighter, d: Fighter, reach: number, arc: number): boolean {
    const dx = d.x - f.x;
    const dy = d.y - f.y;
    const dd = Math.hypot(dx, dy);
    if (dd > reach + BODY_R) return false;
    if (dd < 0.35) return true;
    return (dx * Math.cos(f.facing) + dy * Math.sin(f.facing)) / dd >= arc;
  }

  private hittable(d: Fighter, height: Height): boolean {
    if (d.state === "ko" || d.state === "thrown" || d.invuln > 0) return false;
    if (d.state === "down") return height === "low"; // only low strikes reach a downed body
    if (d.state === "wakeup") return false;
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
    if (d.state === "reversal" && this.inReversalWindow(d) && d.revHeight === m.height && this.facingDot(d, a) > 0) {
      this.reverse(d, a);
      return;
    }
    const dx = Math.cos(a.facing);
    const dy = Math.sin(a.facing);
    if (d.state === "guard" && this.facingDot(d, a) > GUARD_ARC) {
      this.setState(d, "blockstun", m.blockstun);
      d.slideX = (dx * m.push * 0.5) / 8;
      d.slideY = (dy * m.push * 0.5) / 8;
      a.moveLanded = true; // strings stay cancellable on block, like UR's pressure strings
      this.ev({ kind: "block", a: a.id, b: d.id });
      return;
    }
    a.moveLanded = true;
    const otg = d.state === "down";
    const dmg = m.dmg * this.comboScale(d) * (otg ? DOWN.otgScale : 1) * (d.state === "reversal" ? 1.2 : 1);
    const part = this.pickPart(d, m.height);
    d.combo++;
    d.recentHits.push({ by: a.id, f: this.s.frame });
    this.ev({ kind: "hit", a: a.id, b: d.id, part, dmg });
    this.damage(d, part, dmg, a.id);
    if (d.state === "ko") return;
    if (otg) return;

    const crowd = new Set(d.recentHits.map((h) => h.by)).size >= CROWD.attackers;
    const knock = m.knockdown || crowd || d.state === "seated" || d.state === "sitting";
    if (d.state === "holding" || d.state === "held") this.release(d);
    if (d.state === "reattach") this.dropReattach(d);
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

  private knockDown(d: Fighter, dx: number, dy: number, push: number): void {
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
    this.ev({ kind: "reversal", a: d.id, b: a.id });
    // kinetic pushback: clear the crowd around the reverser
    for (const o of this.s.fighters) {
      if (o.id === d.id || o.id === a.id || !alive(o)) continue;
      if (o.state === "down" || o.state === "seated" || o.state === "thrown" || o.state === "wakeup") continue;
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
    if (d.state === "ko") return;
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

  private ko(d: Fighter, by: number): void {
    if (d.state === "holding" || d.state === "held") this.release(d);
    if (d.state === "reattach") this.dropReattach(d);
    d.parts.torso.hp = 0;
    this.setState(d, "ko", KO_FRAMES);
    d.deaths++;
    const killer = this.s.fighters[by];
    if (killer && killer.id !== d.id) killer.kos++;
    // the body comes apart
    for (const p of LIMBS) if (d.parts[p].attached) this.detach(d, p, by);
    this.ev({ kind: "ko", a: d.id, b: by });
  }

  private respawn(f: Fighter): void {
    this.s.pickups = this.s.pickups.filter((p) => p.owner !== f.id);
    f.parts = freshParts(f.style);
    f.x = f.spawnX;
    f.y = f.spawnY;
    f.facing = Math.atan2(-f.y, -f.x);
    f.slideX = f.slideY = 0;
    f.combo = 0;
    f.recentHits = [];
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
    const reach = GRAB.reach * STYLES[f.style].grabReach;
    let best: Fighter | null = null;
    let bd = 1e9;
    for (const d of this.s.fighters) {
      if (d.id === f.id || !this.inCone(f, d, reach, GRAB.arc)) continue;
      if (d.invuln > 0 || ["ko", "down", "wakeup", "thrown", "held", "holding"].includes(d.state)) continue;
      const dd = dist(f, d);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    if (!best) return;
    if (best.state === "reversal" && this.inReversalWindow(best) && best.revHeight === "high" && this.facingDot(best, f) > 0) {
      this.reverse(best, f);
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
    this.ev({ kind: "grab", a: f.id, b: best.id });
  }

  private resolveThrown(f: Fighter): void {
    if (f.state !== "thrown") return;
    for (const o of this.s.fighters) {
      if (o.id === f.id || f.moveHits.includes(o.id) || !this.hittable(o, "high") || o.state === "down") continue;
      if (dist(f, o) > 0.8) continue;
      f.moveHits.push(o.id);
      const dmg = THROW.splash;
      this.ev({ kind: "hit", a: f.partner, b: o.id, part: "torso", dmg });
      this.damage(o, "torso", dmg, f.partner);
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
      if (f.state === "seated") continue;
      f.x += f.slideX;
      f.y += f.slideY;
      const decay = f.state === "thrown" ? 1 : 0.85;
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
        if (!alive(a) || !alive(b) || a.state === "thrown" || b.state === "thrown") continue;
        if (a.partner === b.id && (a.state === "holding" || a.state === "held")) continue;
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
      if (f.state === "seated" || f.state === "sitting") continue;
      const r = Math.hypot(f.x, f.y);
      // the toilet is solid
      if (r < 0.55 && this.s.toiletOccupant !== f.id) {
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
      if (alive(f) && r > RING_R && this.s.frame % LAVA.tick === 0 && f.invuln === 0) {
        this.damage(f, "torso", LAVA.dmg, -1);
        this.ev({ kind: "hit", a: -1, b: f.id, part: "torso", dmg: LAVA.dmg });
      }
    }
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
      const r = Math.hypot(p.x, p.y);
      if (r > LAVA_R) {
        p.x *= LAVA_R / r;
        p.y *= LAVA_R / r;
        p.vx = p.vy = 0;
      }
      if (p.z === 0 && Math.hypot(p.x, p.y) > RING_R) {
        p.burning = 40;
        this.ev({ kind: "burn", a: p.owner, part: p.part });
      }
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

  private updateGeysers(): void {
    const s = this.s;
    if (s.frame >= s.nextGeyser) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(2.5, RING_R - 0.8);
      s.geysers.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, t: 0 });
      s.nextGeyser = s.frame + Math.round(this.rng.range(GEYSER.minGap, GEYSER.maxGap));
    }
    for (const g of s.geysers) {
      g.t++;
      if (g.t !== GEYSER.warn) continue;
      this.ev({ kind: "geyser", a: -1 });
      for (const f of s.fighters) {
        if (!alive(f) || f.invuln > 0 || f.state === "down" || f.state === "seated") continue;
        const dx = f.x - g.x;
        const dy = f.y - g.y;
        const d = Math.hypot(dx, dy);
        if (d > GEYSER.radius) continue;
        this.ev({ kind: "hit", a: -1, b: f.id, part: "torso", dmg: GEYSER.dmg });
        this.damage(f, "torso", GEYSER.dmg, -1);
        if (alive(f)) this.knockDown(f, d > 0.01 ? dx / d : 1, d > 0.01 ? dy / d : 0, 1.0);
      }
    }
    s.geysers = s.geysers.filter((g) => g.t < GEYSER.warn + GEYSER.erupt);
  }

  private updateToilet(): void {
    const s = this.s;
    const occ = s.fighters[s.toiletOccupant];
    if (!occ) return;
    if (occ.state !== "seated" && occ.state !== "sitting") {
      s.toiletOccupant = -1;
      return;
    }
    if (occ.state === "seated") {
      occ.toilet++;
      if (occ.toilet >= TOILET_FRAMES) {
        s.winner = occ.id;
        this.ev({ kind: "win", a: occ.id });
      }
    }
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
    for (const f of s.fighters) {
      mix(f.x);
      mix(f.y);
      mix(f.facing);
      mix(f.t);
      mix(f.state.length * 31 + f.state.charCodeAt(0));
      mix(f.invuln);
      mix(f.toilet);
      mix(f.charge);
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
