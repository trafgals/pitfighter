// How the camera and the clock answer the fight, kept as plain numbers so it
// can be tested without WebGL: each blow kicks the camera along its line and
// a heavy one rolls it, a big hit flashes the picture white-hot for a few
// frames, and a KO slows time (briefly for one fighter out, long for the blow
// that ends the match) while the camera pushes in on the fallen and tilts.
// None of it reaches the sim: slow motion only steps it less often.
import * as THREE from "three";

/** the camera's lurch: a damped spring (per second squared, per second) */
const KICK_K = 260;
const KICK_C = 22;
/** time's pace on a KO: how slow, how long it holds (s, real time), how long it takes to come back */
export const SLOW_KO = { scale: 0.45, hold: 0.22, ease: 0.25 };
export const SLOW_FINAL = { scale: 0.22, hold: 0.9, ease: 0.7 };

export class Impact {
  /** the camera's offset (m) and roll (rad) */
  readonly kick = new THREE.Vector3();
  roll = 0;
  /** 0..1: how white-hot the picture is */
  flash = 0;
  /** the fallen fighter the match ended on, which the camera holds on, and for how long it has */
  finale: THREE.Vector3 | null = null;
  finaleT = 0;
  private vel = new THREE.Vector3();
  private rollV = 0;
  private slow = { scale: 1, hold: 0, ease: 1, t: Infinity };

  reset(): void {
    this.kick.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.roll = this.rollV = this.flash = 0;
    this.finale = null;
    this.finaleT = 0;
    this.slow.t = Infinity;
  }

  /** A blow of `dmg` landed along `dir` (attacker to victim, on the floor). */
  hit(dir: THREE.Vector3, dmg: number, heavy: boolean): void {
    const d = dir.clone().setY(0);
    if (d.lengthSq() < 1e-8) return;
    d.normalize();
    // the picture lurches with the blow, a heavy one twice as hard
    this.vel.addScaledVector(d, (0.9 + dmg * 0.18) * (heavy ? 1.8 : 1));
    this.vel.y -= heavy ? 0.9 : 0.3;
    if (heavy) {
      // and rolls the way it was struck: a blow to screen right tips the horizon right
      this.rollV += (d.x >= 0 ? -1 : 1) * (0.5 + dmg * 0.03);
      this.flash = Math.max(this.flash, Math.min(1, 0.45 + dmg * 0.04));
    }
  }

  /** A fighter is knocked out at `at`; `final` if that blow won the match. */
  ko(at: THREE.Vector3, final: boolean): void {
    const s = final ? SLOW_FINAL : SLOW_KO;
    // a long slow motion is never cut short by a short one
    if (!final && this.slow.t < this.slow.hold && this.slow.scale < s.scale) return;
    this.slow = { ...s, t: 0 };
    this.flash = 1;
    if (final) {
      this.finale = at.clone();
      this.finaleT = 0;
    }
  }

  /** How fast the fight runs now: 1 is real time. */
  get timeScale(): number {
    const s = this.slow;
    if (s.t < s.hold) return s.scale;
    const k = Math.min(1, (s.t - s.hold) / s.ease);
    // eases back in, not snapping
    return s.scale + (1 - s.scale) * k * k * (3 - 2 * k);
  }

  /** Advance by `dt` of real time. */
  update(dt: number): void {
    // the spring is stepped finely, so a long frame cannot blow it up
    for (let left = dt; left > 0; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      this.vel.addScaledVector(this.kick, -KICK_K * h).multiplyScalar(1 - KICK_C * h);
      this.kick.addScaledVector(this.vel, h);
      this.rollV += (-KICK_K * this.roll - KICK_C * this.rollV) * h;
      this.roll += this.rollV * h;
    }
    this.flash *= Math.exp(-dt * 14);
    this.slow.t += dt;
    if (this.finale) this.finaleT += dt;
  }
}
