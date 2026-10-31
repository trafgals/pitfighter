import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { VEHICLE_KINDS } from "../src/sim/arena";
import { CHARGE, HOLD, MOVES } from "../src/sim/moves";
import { BTN, NO_INPUT } from "../src/sim/types";
import { World } from "../src/sim/world";
import { FAMILIES } from "../src/render/motion";
import { buildVehicle, deformVehicle, makeStageView } from "../src/render/stageviews";
import { duel, idle, run, tap } from "./helpers";

describe("Phase 1: Clear Skyward-Rising Launcher Animations", () => {
  it("every fighting family's punchFin has a deep knee-gather crouch followed by a skyward rising extension", () => {
    for (const [name, fam] of Object.entries(FAMILIES)) {
      const clip = fam.punchFin;
      let minHipsY = Infinity;
      let maxHipsY = -Infinity;
      let minSpineX = Infinity;
      for (const k of clip.keys) {
        const pose = k.p;
        if (pose.y !== undefined && pose.y < minHipsY) minHipsY = pose.y;
        if (pose.y !== undefined && pose.y > maxHipsY) maxHipsY = pose.y;
        if (pose.spineX !== undefined && pose.spineX < minSpineX) minSpineX = pose.spineX;
      }
      expect(minHipsY, `${name} crouch gather`).toBeLessThanOrEqual(-0.18);
      expect(maxHipsY, `${name} skyward rise`).toBeGreaterThanOrEqual(0.04);
      expect(minSpineX, `${name} upward spine extension`).toBeLessThanOrEqual(-0.15);
    }
  });
});

describe("Phase 2: Deep Combat Mechanics & 5 Mastery Extensions", () => {
  it("branches high-string finishers 3 ways: Neutral -> punchFin (launch), Forward -> wallFin (wall carry), Down -> boundFin (bound)", () => {
    const runStringWithDir = (dx: number, dy: number) => {
      const w = duel(0.95);
      for (let step = 0; step < 4; step++) {
        const inp = idle(2);
        inp[0] = { x: step >= 2 ? dx : 0, y: step >= 2 ? dy : 0, buttons: BTN.HIGH };
        w.step(inp);
        run(w, 12, (frameInp) => {
          frameInp[0].x = step >= 2 ? dx : 0;
          frameInp[0].y = step >= 2 ? dy : 0;
        });
      }
      return w.fighters[0].move;
    };
    expect(runStringWithDir(0, 0)).toBe("punchFin");
    expect(runStringWithDir(1, 0)).toBe("wallFin");
    expect(runStringWithDir(0, 1)).toBe("boundFin");
  });

  it("throws a direct Command Launcher (cmdLaunch) on Forward + Low from neutral", () => {
    const w = duel(1.0);
    const inp = idle(2);
    inp[0] = { x: 1, y: 0, buttons: BTN.LOW };
    w.step(inp);
    expect(w.fighters[0].move).toBe("cmdLaunch");
    run(w, 24);
    expect(w.fighters[1].state).toBe("air");
  });

  it("slams airborne foes into a Ground-Bounce (boundFin) once per juggle", () => {
    const w = duel(1.0);
    const [a, b] = w.fighters;
    w.setState(b, "air");
    b.z = 0.6;
    b.vz = 0.01;
    b.juggle = 1;
    w.setState(a, "attack");
    a.move = "boundFin";
    a.t = 0;
    let bounced = false;
    run(w, 30, () => {
      if (w.s.events.some((e) => e.kind === "bounce" && e.a === b.id)) bounced = true;
    });
    expect(bounced).toBe(true);
    expect(b.bounced).toBe(true);
    expect(b.state).toBe("air");
  });

  it("grants 1.25x Flash Charge sweet-spot damage at 42..52 charge frames", () => {
    const holdStrike = (chargeFrames: number) => {
      const w = duel(1.0);
      const totalHold = MOVES.jab1.startup - 1 + chargeFrames;
      for (let i = 0; i < 150; i++) {
        const inp = idle(2);
        if (i < totalHold) inp[0].buttons = BTN.HIGH;
        w.step(inp);
        const hit = w.s.events.find((e) => e.kind === "hit" && e.a === 0 && e.b === 1);
        if (hit) return hit.dmg!;
      }
      return 0;
    };
    const baseDmg = holdStrike(0);
    const sweetDmg = holdStrike(45);
    const expectedNormal = baseDmg * (1 + CHARGE.dmg * (45 / CHARGE.max));
    expect(sweetDmg).toBeCloseTo(expectedNormal * 1.25, 4);
  });

  it("cancels hit recovery into a dash on Hit-Confirm Dash-Cancel for 15 Fury", () => {
    const w = duel(0.95);
    const a = w.fighters[0];
    a.fury = 50;
    tap(w, 0, BTN.HIGH);
    run(w, MOVES.jab1.startup);
    expect(a.moveLanded).toBe(true);
    // Step past hitstop then press DASH during active/early recovery window
    while (a.stop > 0) w.step(idle(2));
    tap(w, 0, BTN.DASH);
    expect(a.state).toBe("dash");
    expect(a.fury).toBeLessThan(50);
  });

  it("snaps and detaches a fractured limb (<28% HP) when parried, and allows a Just-Frame Riposte cmdLaunch", () => {
    const w = duel(1.0);
    const [a, b] = w.fighters;
    a.parts.armR.hp = Math.floor(a.parts.armR.max * 0.2); // jab1 strikes with armR
    tap(w, 0, BTN.HIGH);
    run(w, MOVES.jab1.startup - 8);
    tap(w, 1, BTN.REV);
    let snapped = false;
    run(w, 15, () => {
      if (w.s.events.some((e) => e.kind === "detach" && e.a === a.id && e.part === "armR")) snapped = true;
    });
    expect(snapped).toBe(true);
    expect(a.parts.armR.attached).toBe(false);
    expect(a.state).toBe("reversed");
    // Now b presses BTN.HIGH while invuln > 4 to trigger Just-Frame Riposte cmdLaunch
    while (b.stop > 0) w.step(idle(2));
    b.invuln = 8;
    tap(w, 1, BTN.HIGH);
    expect(b.move).toBe("cmdLaunch");
  });

  it("punts severed enemy limbs as ballistic projectiles that damage and stagger foes", () => {
    const w = duel(2.0);
    const [a, b] = w.fighters;
    w.s.pickups.push({
      id: 99,
      owner: b.id,
      part: "armL",
      style: b.style,
      trait: b.parts.armL.trait,
      hp: 40,
      x: a.x + 0.35,
      y: a.y,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      spin: 0,
      burning: 0,
    });
    const hpBefore = b.parts.torso.hp;
    tap(w, 0, BTN.USE);
    let limbHit = false;
    let stateOnHit = "";
    run(w, 20, () => {
      if (w.s.events.some((e) => e.kind === "hit" && e.what === "limb" && e.b === b.id)) {
        limbHit = true;
        stateOnHit = b.state;
      }
    });
    expect(limbHit).toBe(true);
    expect(b.parts.torso.hp).toBeLessThan(hpBefore);
    expect(stateOnHit).toBe("hitstun");
  });

  it("wrenches the victim's weakest limb on BTN.LOW during a grapple hold", () => {
    const w = duel(0.8);
    const [a, b] = w.fighters;
    w.setState(a, "holding", HOLD.dur);
    w.setState(b, "held", HOLD.dur);
    a.partner = b.id;
    b.partner = a.id;
    b.parts.legR.hp = 10; // weakest attached limb
    const legBefore = b.parts.legR.hp;
    a.t = HOLD.kneeCool;
    tap(w, 0, BTN.LOW);
    expect(b.parts.legR.hp).toBeLessThan(legBefore);
  });

  it("performs an Ukemi Tech-Roll into evade when pressing REV during early knockdown frames", () => {
    const w = duel(1.2);
    const a = w.fighters[0];
    w.setState(a, "down", 45);
    a.invuln = 0;
    a.t = 4;
    tap(w, 0, BTN.REV);
    expect(a.state).toBe("evade");
    expect(a.invuln).toBeGreaterThanOrEqual(15);
  });
});

describe("Phase 3: High-Detail Articulated & Deformable Construction Vehicles", () => {
  it("builds every vehicle kind with subdivided deformable meshes, breakaway doors, hood, exhaust, headlights, and implement", () => {
    for (const kind of VEHICLE_KINDS) {
      const view = buildVehicle(kind);
      expect(view.deformables.length, `${kind} deformables`).toBeGreaterThan(0);
      expect(view.doorL, `${kind} doorL`).not.toBeNull();
      expect(view.doorR, `${kind} doorR`).not.toBeNull();
      expect(view.hood, `${kind} hood`).not.toBeNull();
      expect(view.exhaust, `${kind} exhaust`).not.toBeNull();
      expect(view.headlights.length, `${kind} headlights`).toBe(2);
      expect(view.implement, `${kind} implement`).not.toBeNull();
      expect(view.wheels.length, `${kind} wheels/tracks`).toBeGreaterThanOrEqual(2);
    }
  });

  it("deforms vehicle mesh vertices inward around an impact point without producing NaNs", () => {
    const view = buildVehicle("bulldozer");
    const target = view.deformables[0];
    const pos = target.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const before = new Float32Array(pos.array);
    deformVehicle(view, new THREE.Vector3(0.5, 0.5, 0.5), 1.8, 0.25);
    let moved = 0;
    for (let i = 0; i < pos.array.length; i++) {
      expect(Number.isFinite(pos.array[i])).toBe(true);
      if (Math.abs(pos.array[i] - before[i]) > 1e-4) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("progresses through 4 damage stages in ConstructionView and scoop-launches fighters on front loader/bulldozer rams", () => {
    const w = new World({ seed: 1, styles: [0, 1], humans: [true, true], stage: "construction-site" });
    const stageView = makeStageView("construction-site");
    stageView.update(w, 0, 1 / 60, 0);

    const v0 = w.s.arena.vehicles[0]; // bulldozer
    v0.hp = Math.floor(v0.max * 0.7);
    stageView.update(w, 0.1, 1 / 60, 0);
    v0.hp = Math.floor(v0.max * 0.45);
    stageView.update(w, 0.2, 1 / 60, 0);
    v0.hp = Math.floor(v0.max * 0.2);
    stageView.update(w, 0.3, 1 / 60, 0);
    v0.hp = 0;
    v0.wrecked = true;
    stageView.update(w, 0.4, 1 / 60, 0);

    // Verify front scoop-launch on Construction Site
    const w2 = new World({ seed: 1, styles: [0, 1], humans: [true, true], stage: "construction-site" });
    const [, b] = w2.fighters;
    // B exits vehicle
    w2.step([NO_INPUT, { x: 0, y: 0, buttons: BTN.USE }]);
    w2.step([NO_INPUT, NO_INPUT]);
    const dozer = w2.s.arena.vehicles[0];
    Object.assign(b, { x: dozer.x + Math.cos(dozer.facing) * 3.5, y: dozer.y + Math.sin(dozer.facing) * 3.5 });
    let launched = false;
    for (let i = 0; i < 90; i++) {
      w2.step([{ x: Math.cos(dozer.facing), y: Math.sin(dozer.facing), buttons: 0 }, NO_INPUT]);
      if (w2.s.events.some((e) => e.kind === "launch" && e.b === b.id)) launched = true;
    }
    expect(launched).toBe(true);
    stageView.dispose();
  });
});
