// The keyframed moves: every style throws its strings with its own family of
// strikes, every strike lands its contact pose on the hit frame the sim uses
// (Urban Reign's measured timing), and the reactions play out over the frames
// the sim gives them.
import { describe, expect, it } from "vitest";
import { applyPose, buildBody, targetPose, type Body, type Pose } from "../src/render/body";
import { BTN, type PlayerInput } from "../src/sim/types";
import { FAMILIES, FAMILY_OF, REACTIONS, clipFor, familyOf, loadFrame, sampleClip, stateTiming, type Clip, type Timing } from "../src/render/motion";
import { DOWN } from "../src/sim/moves";
import { STYLES } from "../src/sim/styles";
import { World } from "../src/sim/world";
import type { Fighter } from "../src/sim/types";

const STRING = ["jab1", "jab2", "jab3", "punchFin", "kick1", "kick2", "sweep"] as const;

/** How far the striking limb of a pose is from where it is in another, in radians summed over its joints. */
function limbGap(limb: Clip["limb"], a: Pose, b: Pose): number {
  const d = (x: number, y: number) => Math.abs(x - y);
  const arm = (s: "L" | "R") => d(a[`arm${s}`][0], b[`arm${s}`][0]) + d(a[`arm${s}`][2], b[`arm${s}`][2]) + d(a[`elbow${s}`], b[`elbow${s}`]);
  const leg = (s: "L" | "R") => d(a[`leg${s}`][0], b[`leg${s}`][0]) + d(a[`leg${s}`][1], b[`leg${s}`][1]) + d(a[`knee${s}`], b[`knee${s}`]);
  switch (limb) {
    case "armL":
      return arm("L");
    case "armR":
      return arm("R");
    case "legL":
      return leg("L");
    case "legR":
      return leg("R");
    case "both":
      return Math.max(arm("L"), arm("R"));
    case "head":
      return d(a.headX, b.headX) + d(a.spineX, b.spineX);
    case "body":
      return d(a.spineX, b.spineX) + 3 * d(a.z, b.z);
  }
}

/** Run a fighter through `frames` sim frames on the joint springs, from a settled stance. */
function drive(b: Body, f: Fighter, w: World, from: number, to: number): void {
  for (let t = from; t <= to; t++) {
    f.t = t;
    const { p, rate, snap } = targetPose(f, w, t / 60, b.hurt);
    applyPose(b, p, rate, snap, 1 / 60, 0);
  }
}
function settled(style: number): { w: World; f: Fighter; b: Body } {
  const w = new World({ seed: 3, styles: [style, 0], humans: [true, true] });
  const f = w.fighters[0];
  const b = buildBody(f);
  f.state = "idle";
  for (let i = 0; i < 90; i++) {
    const { p, rate } = targetPose(f, w, 0, b.hurt);
    applyPose(b, p, rate, false, 1 / 60, 0);
  }
  return { w, f, b };
}

describe("the move set", () => {
  it("every Urban Reign style fights in a family, and every family throws every move of the strings", () => {
    for (const st of STYLES) expect(FAMILY_OF[st.style], st.style).toBeDefined();
    for (const [name, fam] of Object.entries(FAMILIES)) for (const m of [...STRING, "headbutt"]) expect((fam as Record<string, Clip>)[m], `${name} ${m}`).toBeDefined();
    // the families are really different: each differs from every other in most of its strikes
    const names = Object.keys(FAMILIES) as (keyof typeof FAMILIES)[];
    const T: Timing = { hit: 12, act: 15, end: 43 };
    const base = targetPose(settled(0).f, settled(0).w, 0, settled(0).b.hurt).p;
    const contact = (n: keyof typeof FAMILIES, m: string) => JSON.stringify(sampleClip((FAMILIES[n] as Record<string, Clip>)[m], 12, T, base));
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const differ = STRING.filter((m) => contact(names[i], m) !== contact(names[j], m)).length;
        expect(differ, `${names[i]} vs ${names[j]}`).toBeGreaterThanOrEqual(3);
      }
  });

  it("every style's strikes land their contact pose on the move's hit frame, not before", () => {
    for (let style = 0; style < STYLES.length; style++)
      for (const move of [...STRING, STYLES[style].special]) {
        const { w, f, b } = settled(style);
        const clip = clipFor(style, move)!;
        const m = w.eff(f, move);
        Object.assign(f, { state: "attack", move, chargeHeld: false, charge: 0 });
        drive(b, f, w, 0, m.startup - 4);
        const target = (t: number) => {
          f.t = t;
          return targetPose(f, w, 0, b.hurt).p;
        };
        const contact = target(m.startup);
        const early = limbGap(clip.limb, b.cur, contact);
        drive(b, f, w, m.startup - 3, m.startup);
        const atHit = limbGap(clip.limb, b.cur, contact);
        const why = `${STYLES[style].style} (${familyOf(style)}) ${move}: ${early.toFixed(2)} -> ${atHit.toFixed(2)}`;
        expect(atHit, why).toBeLessThan(0.45); // out on the hit frame
        // and still on its way 4 frames before (a dash is already running at its target and the sword arm stays out while
        // the trunk swings it: their own tests check the strides and the swing)
        if (!m.dash && move !== "spBlade") expect(early, why).toBeGreaterThan(atHit + 0.4);
      }
  });

  it("a slower style's strike lands later: the clip follows the style's frame data", () => {
    const { w, f } = settled(1); // Power: +4 frames on every strike
    const fast = settled(3); // Karate: -2
    const T = (x: { w: World; f: Fighter }) => x.w.eff(x.f, "jab2").startup;
    expect(T({ w, f })).toBeGreaterThan(T(fast));
    const clip = clipFor(1, "jab2")!;
    const base = targetPose(f, w, 0, settled(1).b.hurt).p;
    const e = w.eff(f, "jab2");
    const Tm: Timing = { hit: e.startup, act: e.startup + e.active, end: e.total };
    const at = (t: number) => limbGap(clip.limb, sampleClip(clip, t, Tm, base), sampleClip(clip, e.startup, Tm, base));
    expect(at(T(fast))).toBeGreaterThan(0.3); // on Karate's hit frame Power's fist is still coming
    expect(at(e.startup)).toBe(0);
  });

  it("a charged opener waits in its gathered pose until it is let go", () => {
    const { w, f, b } = settled(6); // Boxing: jab1 is the lead jab
    const m = w.eff(f, "jab1");
    const clip = clipFor(6, "jab1")!;
    Object.assign(f, { state: "attack", move: "jab1", chargeHeld: true, charge: 30, t: m.startup - 1 });
    const held = targetPose(f, w, 0, b.hurt).p;
    const Tm: Timing = { hit: m.startup, act: m.startup + m.active, end: m.total };
    const load = sampleClip(clip, loadFrame(clip, Tm, held), Tm, held);
    expect(held.armL[0]).toBeCloseTo(load.armL[0], 5);
    expect(held.elbowL).toBeLessThan(-2); // the fist drawn in, not out
    expect(held.kneeL).toBeGreaterThan(load.kneeL); // and sinking with the charge
    f.chargeHeld = false;
    f.t = m.startup;
    expect(targetPose(f, w, 0, b.hurt).p.elbowL).toBeGreaterThan(-0.3); // released: it snaps out
  });

  it("a fighter without the arm a strike is thrown with throws it with the other arm", () => {
    const { w, f, b } = settled(6);
    Object.assign(f, { state: "attack", move: "jab1", chargeHeld: false, t: w.eff(f, "jab1").startup });
    expect(targetPose(f, w, 0, b.hurt).p.armL[0]).toBeLessThan(-1.4);
    f.parts.armL.attached = false;
    f.t = w.eff(f, "jab1").startup; // one-armed punches are slower
    const p = targetPose(f, w, 0, b.hurt).p;
    expect(p.armR[0]).toBeLessThan(-1.4);
    expect(p.elbowR).toBeGreaterThan(-0.3);
  });

  it("the reactions: a head shot snaps the head back, a knockdown hits the floor and bounces, the get-up stands", () => {
    const { w, f, b } = settled(0);
    b.hurt = { part: "head", age: 0 };
    Object.assign(f, { state: "hitstun", dur: 41 });
    drive(b, f, w, 0, 4);
    expect(b.cur.headX).toBeLessThan(-0.4);
    // the knockdown
    const T = stateTiming(DOWN.dur);
    const base = targetPose(settled(0).f, w, 0, b.hurt).p;
    const down = (t: number) => sampleClip(REACTIONS.down, t, T, base);
    expect(down(14).rx).toBeCloseTo(-Math.PI / 2, 5); // on the floor
    expect(down(18).rx).toBeGreaterThan(-1.45); // bounced up off it
    expect(down(18).y).toBeGreaterThan(down(14).y);
    expect(down(DOWN.dur).rx).toBeCloseTo(-Math.PI / 2, 5); // and lies there
    const up = (t: number) => sampleClip(REACTIONS.wakeup, t, stateTiming(DOWN.wake), base);
    expect(up(0).rx).toBeCloseTo(-Math.PI / 2, 5);
    expect(up(36).y).toBeLessThan(-0.3); // crouched, feet under the body
    expect(up(DOWN.wake).rx).toBe(0); // and standing
    // a fighter knocked out stays down
    Object.assign(f, { state: "ko", t: 400 });
    expect(targetPose(f, w, 0, b.hurt).p.rx).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("the deflection is out over the reversal window, frames 2..14", () => {
    const { w, f, b } = settled(0);
    Object.assign(f, { state: "reversal", dur: 78, revHeight: "high" });
    const at = (t: number) => {
      f.t = t;
      return targetPose(f, w, 0, b.hurt).p;
    };
    expect(at(2).armL[2]).toBeGreaterThan(0.5); // the lead forearm sweeping out
    expect(at(14).armL[2]).toBeGreaterThan(0.5);
    expect(at(78).armL[2]).toBeLessThan(0.3); // back in the stance
  });
});

describe("the specials", () => {
  /** The target pose of a fighter of `style` on frame t of `move`. */
  const poseAt = (style: number, move: string) => {
    const { w, f, b } = settled(style);
    Object.assign(f, { state: "attack", move, chargeHeld: false });
    const m = w.eff(f, move);
    return {
      m,
      at: (t: number) => {
        f.t = t;
        return targetPose(f, w, 0, b.hurt).p;
      },
    };
  };
  const style = (sp: string) => STYLES.findIndex((s) => s.special === sp);

  it("every special has a clip, and every style throws its own", () => {
    for (const sp of ["spSpin", "spCharge", "spFlurry", "spSlam", "spBlade", "spFire"]) {
      expect(style(sp)).toBeGreaterThanOrEqual(0);
      expect(clipFor(style(sp), sp), sp).not.toBeNull();
    }
  });

  it("HELLSPIN turns a whole circle over its active frames with the leg out", () => {
    const { m, at } = poseAt(style("spSpin"), "spSpin");
    let turned = 0;
    let prev = at(m.startup - 1).ry;
    for (let t = m.startup; t <= m.startup + m.active; t++) {
      const ry = at(t).ry;
      turned += Math.atan2(Math.sin(ry - prev), Math.cos(ry - prev));
      prev = ry;
    }
    expect(turned).toBeGreaterThan(Math.PI * 1.2); // most of a turn on the active frames, the rest on the way in and out
    expect(at(m.startup).legR[1]).toBeGreaterThan(1.2);
  });

  it("BRIMSTONE CHARGE runs: the legs swap over and over through the dash", () => {
    const { m, at } = poseAt(style("spCharge"), "spCharge");
    let swaps = 0;
    let lead = Math.sign(at(m.startup).legL[0] - at(m.startup).legR[0]);
    for (let t = m.startup; t < m.startup + m.active; t++) {
      const s = Math.sign(at(t).legL[0] - at(t).legR[0]);
      if (s !== lead && s !== 0) swaps++;
      lead = s;
    }
    expect(swaps).toBeGreaterThanOrEqual(4);
    expect(at(m.startup + 5).spineX).toBeGreaterThan(0.5); // behind the shoulder
  });

  it("INFERNAL FLURRY lands a fist on every rehit frame, the hands alternating", () => {
    const { m, at } = poseAt(style("spFlurry"), "spFlurry");
    const hands: string[] = [];
    for (let t = m.startup; t < m.startup + m.active; t += m.rehit!) {
      const p = at(t);
      hands.push(p.elbowL > -0.3 ? "L" : p.elbowR > -0.3 ? "R" : "-");
    }
    expect(hands).toEqual(["L", "R", "L", "R", "L", "R"]);
  });

  it("PIT SLAM is in the air before its hit frame and down on the floor on it", () => {
    const { m, at } = poseAt(style("spSlam"), "spSlam");
    const air = Math.max(...Array.from({ length: m.startup }, (_, t) => at(t).y));
    expect(air).toBeGreaterThan(0.5);
    expect(at(m.startup).y).toBeLessThan(-0.3);
    expect(at(Math.round(m.startup * 0.65)).armL[0]).toBeLessThan(-2.5); // both fists over the head
  });

  it("PITCHFORK ARC sweeps from the far side across the front; HELLFIRE FLICK is cocked back, then flicked out", () => {
    const b = poseAt(style("spBlade"), "spBlade");
    expect(b.at(b.m.startup - 6).spineY).toBeGreaterThan(0.8);
    expect(b.at(b.m.startup + b.m.active).spineY).toBeLessThan(-1.0);
    const f = poseAt(style("spFire"), "spFire");
    expect(f.at(f.m.startup - 6).elbowR).toBeLessThan(-2);
    expect(f.at(f.m.startup).elbowR).toBeGreaterThan(-0.3);
    expect(f.at(f.m.startup).armR[0]).toBeLessThan(-1.4);
  });
});

describe("the grapple", () => {
  /** Step the sim and pose every body the way the scene does: hits, throws, state changes, hitstop. */
  function rig(w: World) {
    const bodies = w.fighters.map((f) => buildBody(f));
    const frame = (inp: PlayerInput[]) => {
      w.step(inp);
      for (const e of w.s.events) {
        if (e.kind === "hit" && e.b !== undefined) bodies[e.b].hurt = { part: e.part ?? "torso", age: 0 };
        if (e.kind === "throw") bodies[e.a].cue.throwAge = 0;
      }
      w.fighters.forEach((f, i) => {
        const v = bodies[i];
        v.hurt.age += 1 / 60;
        v.cue.throwAge += 1 / 60;
        if (v.cue.last !== f.state) {
          v.cue.from = v.cue.last;
          v.cue.last = f.state;
        }
        const { p, rate, snap, impact } = targetPose(f, w, w.s.frame / 60, v.hurt, v.cue);
        applyPose(v, p, f.stop > 0 ? 0 : rate, (snap && f.stop === 0) || impact, 1 / 60, 0);
      });
    };
    const none = () => w.fighters.map(() => ({ x: 0, y: 0, buttons: 0 }));
    const tap = (b: number) => {
      const inp = none();
      inp[0].buttons = b;
      frame(inp);
    };
    const run = (n: number, watch: () => void = () => {}) => {
      for (let i = 0; i < n; i++) {
        frame(none());
        watch();
      }
    };
    return { bodies, tap, run };
  }

  it("the clinch, knees that are up on the frame they land, alternating legs, and a throw over onto the back", () => {
    const w = new World({ seed: 9, styles: [5, 0] });
    w.s.nextGeyser = 1e9;
    const [a, b] = w.fighters;
    Object.assign(a, { x: 0, y: 3, facing: 0 });
    Object.assign(b, { x: 0.8, y: 3, facing: Math.PI });
    const { bodies, tap, run } = rig(w);
    const [A, B] = bodies;
    run(30);
    tap(BTN.GRAB);
    run(20);
    expect(a.state).toBe("holding");
    expect(b.state).toBe("held");
    // locked up: the holder's hands round the neck, the victim bent over with the head down
    expect(A.cur.armL[0]).toBeLessThan(-1.1);
    expect(A.cur.armR[0]).toBeLessThan(-1.1);
    expect(B.cur.spineX).toBeGreaterThan(0.45);
    // the first knee is up on its press frame, and the freeze holds it up there
    tap(BTN.HIGH);
    expect(a.stop).toBeGreaterThan(0);
    expect(A.cur.kneeR).toBeGreaterThan(1.8);
    expect(A.cur.legR[0]).toBeLessThan(-1.3);
    run(a.stop - 1);
    expect(A.cur.kneeR).toBeGreaterThan(1.8);
    // after the freeze it comes down again, and the knee jolts the victim
    let jolt = 0;
    run(20, () => (jolt = Math.max(jolt, B.cur.spineX)));
    expect(jolt).toBeGreaterThan(0.75);
    expect(A.cur.kneeR).toBeLessThan(1.0);
    // the second knee comes off the other leg
    tap(BTN.HIGH);
    expect(A.cur.kneeL).toBeGreaterThan(1.8);
    run(a.stop + 20);
    // the throw: the thrower bent over the hip through the freeze, the body thrown up and over
    tap(BTN.GRAB);
    expect(b.state).toBe("thrown");
    expect(a.state).toBe("idle");
    expect(A.cur.spineX).toBeGreaterThan(0.4);
    let top = 0;
    let rxAtTop = 0;
    run(b.stop + 24, () => {
      if (b.state === "thrown" && B.cur.y > top) {
        top = B.cur.y;
        rxAtTop = B.cur.rx;
      }
    });
    expect(top).toBeGreaterThan(0.7); // up off the floor
    expect(rxAtTop).toBeLessThan(-0.7); // turning over onto the back on the way
    expect(b.state).toBe("down");
    // it lands flat and stays flat: the knockdown after a throw only bounces, it does not stand up to fall again
    let highest = -Infinity;
    run(30, () => (highest = Math.max(highest, B.cur.rx)));
    expect(highest).toBeLessThan(-1.1);
    expect(A.cur.spineX).toBeLessThan(0.3); // and the thrower is back up
  });
});
