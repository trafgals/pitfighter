// CPU fighters. A bot only ever produces a PlayerInput, exactly like a pad, so
// the simulation cannot tell bots and humans apart. Each bot owns its own
// seeded RNG, which keeps matches with bots deterministic.
//
// Like Urban Reign's crowds, bots take turns: only the few fighters nearest a
// target close in on it (its "attack tokens"); the rest circle at a distance
// and wait for an opening instead of all piling in at once.
//
// What is dangerous and what is worth going for comes from the stage's Arena
// (arena.ts): the hellfire, an edge, a cracking tile, the blimp's fire, a
// vehicle bearing down; the toilet, the banner, a free vehicle.
import { BTN, type Fighter, type PlayerInput } from "./types";
import { FURY, MOVES } from "./moves";
import { STYLES } from "./styles";
import { Rng } from "./rng";
import { HAZARDS } from "./arena";
import { AIR_GRAB } from "./airgrabs";
import { actionable, alive, arms, dist, legs, type World } from "./world";

/** how many fighters may close in on one target at once */
export const TOKENS = { normal: 2, throne: 3 };
export const CIRCLE_R = 2.6;

/** Whether `me` is one of the fighters nearest `tgt`, so it may attack it now. */
export function hasToken(w: World, me: Fighter, tgt: Fighter): boolean {
  const k = w.s.toiletOccupant === tgt.id ? TOKENS.throne : TOKENS.normal;
  const mine = dist(me, tgt);
  let closer = 0;
  for (const o of w.s.fighters) {
    if (o.id === me.id || o.id === tgt.id || !alive(o) || o.state === "down" || o.state === "ko") continue;
    const d = dist(o, tgt);
    if (d < mine || (d === mine && o.id < me.id)) closer++;
  }
  return closer < k;
}

export class Bot {
  private rng: Rng;
  private plan: "string" | "low" | "grab" | "wait" = "wait";
  private planT = 0;
  private lastPress = 0;

  constructor(
    readonly id: number,
    seed: number,
    readonly skill = 0.6,
  ) {
    this.rng = new Rng(seed ^ (0x9e3779b9 * (id + 1)));
  }

  think(w: World): PlayerInput {
    const s = w.s;
    const me = s.fighters[this.id];
    const out: PlayerInput = { x: 0, y: 0, buttons: 0 };
    const press = (b: number) => {
      // a fresh edge every time: never hold an action button two frames running
      if (s.frame - this.lastPress < 2) return;
      out.buttons |= b;
      this.lastPress = s.frame;
    };
    if (!alive(me) || s.winner >= 0) return out;

    if (me.state === "air") {
      // juggled: steer out of reach of whoever hit last (a better CPU pushes harder)
      const a = s.fighters[me.lastHitBy];
      if (a) {
        const away = Math.atan2(me.y - a.y, me.x - a.x);
        out.x = Math.cos(away) * this.skill;
        out.y = Math.sin(away) * this.skill;
      }
      return out;
    }

    if (me.state === "held") {
      if (me.t < 12 && this.rng.chance(this.skill * 0.12)) press(BTN.REV);
      return out;
    }
    if (me.state === "holding") {
      if (me.t > 8 && this.rng.chance(0.08)) {
        if (me.holdStrikes < 2 && this.rng.chance(0.5)) press(BTN.HIGH);
        else {
          // throw them into the hazard, or over the edge
          const a = w.arena.throwAngle(w, me);
          out.x = Math.cos(a);
          out.y = Math.sin(a);
          press(BTN.GRAB);
        }
      }
      return out;
    }
    if (me.state === "seated" || me.state === "sitting") return out;
    if (me.state === "driving") return this.drive(w, me, out, press);
    if (me.state === "attack") {
      // keep the string going
      if (this.plan === "string" && this.rng.chance(0.3)) press(BTN.HIGH);
      if (this.plan === "low" && this.rng.chance(0.3)) press(BTN.LOW);
      // a landed kick flows into the punch string now and then
      if (this.plan === "low" && me.moveLanded && this.rng.chance(0.08)) {
        this.plan = "string";
        press(BTN.HIGH);
      }
      return out;
    }
    if (!actionable(me)) return out;

    const enemies = s.fighters.filter((o) => o.id !== me.id && alive(o));

    // 0. a juggled foe in reach: cash it out with the air grab, or keep it up with a jab
    for (const e of enemies) {
      if (e.state !== "air" || e.z > AIR_GRAB.height || dist(e, me) > AIR_GRAB.reach) continue;
      out.x = (e.x - me.x) * 0.3; // turn to it
      out.y = (e.y - me.y) * 0.3;
      if (arms(me) > 0 && (e.juggle >= 3 || this.rng.chance(this.skill * 0.25))) press(BTN.GRAB);
      else if (this.rng.chance(0.5)) press(BTN.HIGH);
      if (out.buttons) return out;
    }

    // 1. reactive defence against a strike in its startup: deflect it (Square), or evade it (Square + a direction)
    for (const e of enemies) {
      if (e.state !== "attack" || !e.move || dist(e, me) > 2.2) continue;
      const toMe = Math.atan2(me.y - e.y, me.x - e.x);
      if (Math.cos(toMe - e.facing) < 0.5) continue;
      const m = e.move === "grab" ? null : MOVES[e.move];
      const startup = m ? m.startup : 5;
      if (e.t >= startup) continue;
      if (this.rng.chance(this.skill * 0.18)) {
        press(BTN.REV);
        return out;
      }
      if (m && legs(me) > 0 && this.rng.chance(this.skill * 0.12)) {
        // sidestep off the line of the blow
        const side = toMe + (me.id % 2 === 0 ? 1 : -1) * Math.PI * 0.5;
        out.x = Math.cos(side);
        out.y = Math.sin(side);
        press(BTN.REV);
        return out;
      }
    }

    let goal: { x: number; y: number } | null = null;
    let use = false;

    // 2. get away from a hazard about to strike, and out of danger (fire, an edge, a vehicle)
    for (const g of s.geysers) {
      const H = HAZARDS[g.kind];
      if (g.t < H.warn && Math.hypot(me.x - g.x, me.y - g.y) < H.radius + 0.6) {
        const a = Math.atan2(me.y - g.y, me.x - g.x);
        return this.steer(out, me, w.arena.clampGoal(me.x + Math.cos(a) * 3, me.y + Math.sin(a) * 3));
      }
    }
    if (w.arena.danger(w, me, me.x, me.y)) return this.steer(out, me, w.arena.safe(w, me));

    // 3. pick our limbs back up
    const mine = s.pickups.filter((p) => p.owner === me.id && p.burning === 0 && !w.arena.danger(w, me, p.x, p.y));
    if (mine.length) {
      const p = mine.reduce((a, b) => (dist(me, a) < dist(me, b) ? a : b));
      const near = enemies.some((e) => dist(e, me) < 1.5);
      if (!near || dist(me, p) < 2) {
        goal = p;
        use = dist(me, p) < 0.8;
      }
    }

    // 4. the stage's objective (the toilet, the banner, a free vehicle)
    if (!goal) {
      const g = w.arena.botGoal(w, me, enemies);
      if (g) {
        goal = g;
        use = g.use;
      }
    }

    // 5. fight: whoever holds the objective, else the nearest enemy (on foot, if there is one)
    const occ = s.fighters[s.toiletOccupant];
    if (!goal) {
      const onFoot = enemies.filter((e) => e.state !== "driving");
      const pool = onFoot.length ? onFoot : enemies;
      const tgt: Fighter | undefined =
        occ && occ.id !== me.id && alive(occ) ? occ : pool.reduce<Fighter | undefined>((a, b) => (!a || dist(me, b) < dist(me, a) ? b : a), undefined);
      if (tgt) {
        const d = dist(me, tgt);
        // a special when it can reach
        const sp = MOVES[STYLES[me.style].special];
        if (me.fury >= FURY.cost && d < sp.reach * 0.9 + 0.3 && this.rng.chance(0.05 + 0.1 * this.skill)) {
          press(BTN.SPECIAL);
          return out;
        }
        if (!hasToken(w, me, tgt)) return this.circle(w, out, me, tgt);
        if (d > 1.15) goal = tgt;
        else {
          if (--this.planT <= 0) {
            const k = this.rng.next();
            this.plan = k < 0.45 ? "string" : k < 0.7 ? "low" : k < 0.9 ? "grab" : "wait";
            if (this.plan === "low" && legs(me) < 2) this.plan = "string";
            if (this.plan === "grab" && arms(me) === 0) this.plan = "string";
            this.planT = 10 + this.rng.int(25);
          }
          if (this.plan === "string") press(BTN.HIGH);
          else if (this.plan === "low") press(BTN.LOW);
          else if (this.plan === "grab") press(BTN.GRAB);
          return out;
        }
      }
    }

    if (goal) {
      this.steer(out, me, goal);
      // a long way to go: run (Cross held)
      if (dist(me, goal) > 4 && legs(me) === 2) out.buttons |= BTN.DASH;
    }
    if (use) press(BTN.USE);
    return out;
  }

  /** Wait for a turn: orbit the target at CIRCLE_R, locked on to it, taunting now and then. */
  private circle(w: World, out: PlayerInput, me: Fighter, tgt: Fighter): PlayerInput {
    const dir = me.id % 2 === 0 ? 1 : -1;
    const a = Math.atan2(me.y - tgt.y, me.x - tgt.x) + dir * 0.45;
    // stay on the floor
    this.steer(out, me, w.arena.clampGoal(tgt.x + Math.cos(a) * CIRCLE_R, tgt.y + Math.sin(a) * CIRCLE_R));
    out.buttons |= BTN.LOCK;
    if (dist(me, tgt) > 2.2 && me.fury < FURY.cost && this.rng.chance(0.004)) {
      out.x = out.y = 0;
      out.buttons &= ~BTN.LOCK;
      if (w.s.frame - this.lastPress >= 2) {
        out.buttons |= BTN.TAUNT;
        this.lastPress = w.s.frame;
      }
    }
    return out;
  }

  /** At the wheel: run down the nearest fighter on foot (else ram the nearest machine), boost when lined up. */
  private drive(w: World, me: Fighter, out: PlayerInput, press: (b: number) => void): PlayerInput {
    const v = w.s.arena.vehicles[me.vehicle];
    if (!v) return out;
    // bail out of a machine about to go up, and now and then to fight on foot
    if ((v.hp < v.max * 0.2 && this.rng.chance(0.06)) || this.rng.chance(0.0012)) {
      press(BTN.USE);
      return out;
    }
    const prey = w.s.fighters.filter((o) => o.id !== me.id && alive(o) && o.state !== "driving" && o.invuln === 0);
    let tgt: { x: number; y: number } | undefined = prey.reduce<Fighter | undefined>((a, b) => (!a || dist(v, b) < dist(v, a) ? b : a), undefined);
    if (!tgt) tgt = w.s.arena.vehicles.filter((o) => o.id !== v.id && !o.wrecked).reduce<typeof v | undefined>((a, b) => (!a || dist(v, b) < dist(v, a) ? b : a), undefined);
    if (!tgt) return out;
    const a = Math.atan2(tgt.y - v.y, tgt.x - v.x);
    out.x = Math.cos(a);
    out.y = Math.sin(a);
    if (Math.cos(a - v.facing) > 0.92 && dist(v, tgt) < 7 && v.cool === 0 && this.rng.chance(0.04 + 0.05 * this.skill)) press(BTN.HIGH);
    return out;
  }

  private steer(out: PlayerInput, me: Fighter, g: { x: number; y: number }): PlayerInput {
    const dx = g.x - me.x;
    const dy = g.y - me.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.15) {
      out.x = dx / d;
      out.y = dy / d;
    }
    return out;
  }
}
