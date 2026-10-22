// CPU fighters. A bot only ever produces a PlayerInput, exactly like a pad, so
// the simulation cannot tell bots and humans apart. Each bot owns its own
// seeded RNG, which keeps matches with bots deterministic.
import { BTN, RING_R, type Fighter, type PlayerInput } from "./types";
import { GEYSER, MOVES } from "./moves";
import { Rng } from "./rng";
import { actionable, alive, arms, dist, legs, type World } from "./world";

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

    if (me.state === "held") {
      if (me.t < 12 && this.rng.chance(this.skill * 0.12)) press(BTN.REV);
      return out;
    }
    if (me.state === "holding") {
      if (me.t > 8 && this.rng.chance(0.08)) {
        if (me.holdStrikes < 2 && this.rng.chance(0.5)) press(BTN.HIGH);
        else {
          // throw them toward the lava
          const a = Math.atan2(me.y, me.x);
          out.x = Math.cos(a);
          out.y = Math.sin(a);
          press(BTN.GRAB);
        }
      }
      return out;
    }
    if (me.state === "seated" || me.state === "sitting") return out;
    if (me.state === "attack") {
      // keep the string going
      if (this.plan === "string" && this.rng.chance(0.3)) press(BTN.HIGH);
      if (this.plan === "low" && this.rng.chance(0.3)) press(BTN.LOW);
      return out;
    }
    if (!actionable(me)) return out;

    const enemies = s.fighters.filter((o) => o.id !== me.id && alive(o));

    // 1. reactive defence: reversal / guard against a strike in its startup
    for (const e of enemies) {
      if (e.state !== "attack" || !e.move || dist(e, me) > 2.2) continue;
      const toMe = Math.atan2(me.y - e.y, me.x - e.x);
      if (Math.cos(toMe - e.facing) < 0.5) continue;
      const m = e.move === "grab" ? null : MOVES[e.move];
      const startup = m ? m.startup : 5;
      if (e.t >= startup) continue;
      if (this.rng.chance(this.skill * 0.18)) {
        const low = m ? m.height === "low" : false;
        if (low) out.buttons |= BTN.GUARD;
        press(BTN.REV);
        return out;
      }
      if (m && arms(me) > 0 && legs(me) === 2 && this.rng.chance(this.skill * 0.3)) {
        out.buttons |= BTN.GUARD;
        return out;
      }
    }

    let goal: { x: number; y: number } | null = null;
    let use = false;

    // 2. get out of the fire and away from erupting geysers
    const r = Math.hypot(me.x, me.y);
    for (const g of s.geysers) {
      if (g.t < GEYSER.warn && Math.hypot(me.x - g.x, me.y - g.y) < GEYSER.radius + 0.6) {
        const a = Math.atan2(me.y - g.y, me.x - g.x);
        return this.steer(out, me, { x: me.x + Math.cos(a) * 3, y: me.y + Math.sin(a) * 3 });
      }
    }
    if (r > RING_R - 0.4) return this.steer(out, me, { x: 0, y: 0 });

    // 3. pick our limbs back up
    const mine = s.pickups.filter((p) => p.owner === me.id && p.burning === 0 && Math.hypot(p.x, p.y) < RING_R);
    if (mine.length) {
      const p = mine.reduce((a, b) => (dist(me, a) < dist(me, b) ? a : b));
      const near = enemies.some((e) => dist(e, me) < 1.5);
      if (!near || dist(me, p) < 2) {
        goal = p;
        use = dist(me, p) < 0.8;
      }
    }

    // 4. the toilet
    const occ = s.fighters[s.toiletOccupant];
    if (!goal && !occ) {
      const closer = enemies.filter((e) => Math.hypot(e.x, e.y) < r).length;
      if (closer <= 1 || r < 3) {
        goal = { x: 0, y: 0 };
        use = r < 0.8;
      }
    }

    // 5. fight: whoever is on the throne, else the nearest enemy
    if (!goal) {
      const tgt: Fighter | undefined =
        occ && occ.id !== me.id ? occ : enemies.reduce<Fighter | undefined>((a, b) => (!a || dist(me, b) < dist(me, a) ? b : a), undefined);
      if (tgt) {
        const d = dist(me, tgt);
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
          else if (this.rng.chance(0.5)) out.buttons |= arms(me) > 0 && legs(me) === 2 ? BTN.GUARD : 0;
          return out;
        }
      }
    }

    if (goal) this.steer(out, me, goal);
    if (use) press(BTN.USE);
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
