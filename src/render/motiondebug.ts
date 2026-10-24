// ?debug=motion: what the animation is doing, live. A line per fighter (its
// state and frame in it, the clip playing and where the move is in it, which
// feet carry the weight, the striking limb's speed) and a marker under each
// foot: green planted, yellow stepping, none when the clip has it free.
import * as THREE from "three";
import type { Fighter } from "../sim/types";
import { ankleOf } from "./animate";
import type { Body, Target } from "./body";

const COLORS = { down: 0x40ff60, swing: 0xffd040 };

export class MotionDebug {
  readonly group = new THREE.Group();
  private marks: THREE.Mesh[][] = [];
  private tips: (THREE.Vector3 | null)[] = [];
  private lines: string[] = [];

  constructor(private el: HTMLElement) {}

  /** Read one fighter after its animation step. */
  track(i: number, b: Body, f: Fighter, tp: Target | undefined, dt: number): void {
    if (!this.marks[i]) {
      this.marks[i] = (["L", "R"] as const).map(() => {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.1, 16), new THREE.MeshBasicMaterial({ color: COLORS.down, depthTest: false }));
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 10;
        this.group.add(m);
        return m;
      });
    }
    (["L", "R"] as const).forEach((s, k) => {
      const ft = b.feet[s];
      const m = this.marks[i][k];
      m.visible = ft.w > 0 && (ft.down || !!ft.swing);
      if (!m.visible) return;
      ankleOf(b, s, m.position);
      m.position.y = b.root.position.y + 0.02;
      (m.material as THREE.MeshBasicMaterial).color.setHex(ft.down ? COLORS.down : COLORS.swing);
    });
    // the striking limb's speed: the fist or the foot it drives
    let speed = 0;
    if (tp?.drive && tp.drive !== "body" && tp.drive !== "head") {
      const s = tp.drive === "armR" || tp.drive === "legR" ? "R" : "L";
      const tip = tp.drive.startsWith("leg") ? ankleOf(b, s) : b.joints[s === "L" ? "elbowL" : "elbowR"].localToWorld(new THREE.Vector3(0, -0.3, 0));
      const prev = this.tips[i];
      if (prev && dt > 0) speed = tip.distanceTo(prev) / dt;
      this.tips[i] = tip;
    } else this.tips[i] = null;
    const T = tp?.T;
    const feet = (["L", "R"] as const).map((s) => `${s}${b.feet[s].down ? "●" : b.feet[s].swing ? "◐" : "○"}`).join(" ");
    this.lines[i] =
      `P${i + 1} ${f.state.padEnd(9)} t${String(f.t).padStart(3)}${T ? `/${T.end}` : "   "}  ${(tp?.label ?? "").padEnd(14)} ${(tp?.phase ?? "").padEnd(8)} ` +
      `plant ${String(tp?.plant ?? "").padEnd(4)} ${feet}${tp?.drive ? `  ${tp.drive} ${speed.toFixed(1)} m/s` : ""}`;
  }

  /** Write the lines out (once per render frame). */
  flush(n: number): void {
    this.lines.length = n;
    this.el.textContent = this.lines.join("\n");
  }
}
