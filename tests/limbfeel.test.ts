// A grafted limb moves like the limb it is (src/render/limbfeel.ts): a heavy one
// is slow to start and slow to settle, a whip is quick, and the tip it hits
// with bends the line of the strike. A fighter on its own limbs is untouched.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyPose, buildBody, copyPose, stance, type Body } from "../src/render/body";
import { feelOf, shapeStrike, springOf, strikeAmount } from "../src/render/limbfeel";
import { PLAIN, type LimbTrait } from "../src/sim/limbs";
import { World } from "../src/sim/world";

const DT = 1 / 60;
const trait = (o: Partial<LimbTrait>): LimbTrait => ({ ...PLAIN, ...o, arc: o.arc ?? 0.5 });

describe("the spring a limb swings on", () => {
  it("a heavy limb is softer and slower to settle than a light quick one, and a plain limb has no spring of its own", () => {
    const heavy = springOf(trait({ mass: 1.35, swing: 0.8 }));
    const light = springOf(trait({ mass: 0.75, swing: 1.25 }));
    expect(heavy.k).toBeLessThan(light.k);
    expect(heavy.k).toBeLessThan(1);
    expect(light.k).toBeGreaterThan(1);
    expect(heavy.damp).toBeLessThan(light.damp);
    const w = new World({ seed: 1, styles: [0, 0], humans: [true, true], limbs: false });
    expect(feelOf(w.fighters[0])).toBeUndefined();
    w.fighters[0].parts.armR.trait = trait({ mass: 1.3 });
    const feel = feelOf(w.fighters[0])!;
    expect(feel.armR).toBeDefined();
    expect(feel.armL).toBeUndefined();
  });

  /** How far the right arm has got toward a raised target after n frames, with a spring. */
  function reached(feel: ReturnType<typeof feelOf>, n: number) {
    const w = new World({ seed: 1, styles: [0, 0], humans: [true, true] });
    const b = buildBody(w.fighters[0]);
    const goal = copyPose(stance());
    goal.armR = [-1.6, 0, 0.3];
    for (let i = 0; i < n; i++) applyPose(b, goal, 30, false, DT, 0, null, feel);
    return { b, x: b.cur.armR[0] };
  }

  it("a heavy arm lags a light one toward the same pose, and both arrive", () => {
    const heavy = { armR: springOf(trait({ mass: 1.35, swing: 0.8 })) };
    const light = { armR: springOf(trait({ mass: 0.75, swing: 1.25 })) };
    const base = stance().armR[0];
    for (const n of [4, 6, 8]) {
      const h = Math.abs(reached(heavy, n).x - base);
      const l = Math.abs(reached(light, n).x - base);
      expect(h, `frame ${n}`).toBeLessThan(l);
    }
    for (const feel of [heavy, light]) expect(reached(feel, 240).x).toBeCloseTo(-1.6, 1);
  });

  it("a heavy arm overshoots less damped: it carries on past the pose before it settles", () => {
    const peak = (feel: ReturnType<typeof feelOf>) => {
      const w = new World({ seed: 1, styles: [0, 0], humans: [true, true] });
      const b = buildBody(w.fighters[0]);
      const goal = copyPose(stance());
      goal.armR = [-1.6, 0, 0.3];
      let most = 0;
      for (let i = 0; i < 120; i++) {
        applyPose(b, goal, 30, false, DT, 0, null, feel);
        most = Math.max(most, -1.6 - b.cur.armR[0] > 0 ? 0 : b.cur.armR[0] + 1.6);
      }
      return most;
    };
    const plain = peak(undefined);
    const heavy = peak({ armR: springOf(trait({ mass: 1.35, swing: 0.8 })) });
    expect(heavy).toBeGreaterThanOrEqual(plain);
  });

  it("the other limbs are untouched by an arm's spring", () => {
    const w = new World({ seed: 1, styles: [0, 0], humans: [true, true] });
    const goal = copyPose(stance());
    goal.legL = [-0.9, 0.2];
    goal.armR = [-1.6, 0, 0.3];
    const run = (feel: ReturnType<typeof feelOf>) => {
      const b: Body = buildBody(w.fighters[0]);
      for (let i = 0; i < 6; i++) applyPose(b, goal, 30, false, DT, 0, null, feel);
      return b.cur;
    };
    const a = run(undefined);
    const c = run({ armR: springOf(trait({ mass: 1.35, swing: 0.8 })) });
    expect(c.legL[0]).toBeCloseTo(a.legL[0], 9);
    expect(c.armL[0]).toBeCloseTo(a.armL[0], 9);
    expect(c.armR[0]).not.toBeCloseTo(a.armR[0], 3);
  });
});

describe("the line a grown limb strikes along", () => {
  const base = stance();
  const thrown = () => {
    const p = copyPose(base);
    p.armR = [base.armR[0] - 1.2, 0, base.armR[2]];
    return p;
  };

  it("a plain limb, or one that is not mid-strike, is left alone", () => {
    const p = thrown();
    const before = JSON.stringify(p);
    shapeStrike(p, base, "armR", PLAIN);
    shapeStrike(p, base, "armR", undefined);
    shapeStrike(p, base, "body", trait({ tip: "claw" }));
    expect(JSON.stringify(p)).toBe(before);
    const rest = copyPose(base);
    shapeStrike(rest, base, "armR", trait({ tip: "claw", arc: 0.35 }));
    expect(JSON.stringify(rest)).toBe(JSON.stringify(base));
    expect(strikeAmount(rest, base, "armR")).toBe(0);
  });

  it("a wide arc and a claw swing out from the side, a spike goes straight down the line", () => {
    const z = (t: LimbTrait) => {
      const p = thrown();
      shapeStrike(p, base, "armR", t);
      return p.armR[2] - base.armR[2];
    };
    // the right arm's z is out to the negative
    expect(z(trait({ tip: "fist", arc: 0.35 }))).toBeLessThan(z(trait({ tip: "fist", arc: 0.7 })));
    expect(z(trait({ tip: "claw", arc: 0.5 }))).toBeLessThan(z(trait({ tip: "fist", arc: 0.5 })));
    expect(z(trait({ tip: "spike", arc: 0.7 }))).toBeGreaterThan(z(trait({ tip: "fist", arc: 0.7 })) - 1e-9);
  });

  it("the left side mirrors the right, and a club leans the trunk into the blow", () => {
    const pr = thrown();
    shapeStrike(pr, base, "armR", trait({ tip: "claw", arc: 0.4 }));
    const pl = copyPose(base);
    pl.armL = [base.armL[0] - 1.2, 0, base.armL[2]];
    shapeStrike(pl, base, "armL", trait({ tip: "claw", arc: 0.4 }));
    expect(pl.armL[2] - base.armL[2]).toBeCloseTo(-(pr.armR[2] - base.armR[2]), 9);
    const club = thrown();
    shapeStrike(club, base, "armR", trait({ tip: "club" }));
    expect(club.spineX).toBeGreaterThan(base.spineX);
    const plainFist = thrown();
    shapeStrike(plainFist, base, "armR", trait({ tip: "fist" }));
    expect(plainFist.spineX).toBe(base.spineX);
  });

  it("legs take it too", () => {
    const p = copyPose(base);
    p.legR = [base.legR[0] - 0.9, base.legR[1]];
    const before = p.legR[1];
    shapeStrike(p, base, "legR", trait({ tip: "claw", arc: 0.35 }));
    expect(p.legR[1]).not.toBe(before);
    void THREE;
  });
});
