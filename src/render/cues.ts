// Presentation cues for one simulation step: the step's game events plus a
// few moments the sim has no event for (a swing starting, a body hitting the
// floor), found by comparing each fighter with the previous step. The scene
// and the sound both consume them, once per step, so nothing is missed when a
// render frame runs several steps.
import type { GameEvent } from "../sim/types";
import type { World } from "../sim/world";
import { FALL_LAND } from "./motion";

export type Cue =
  | GameEvent
  | { kind: "swing"; a: number; move: string; heavy: boolean }
  | { kind: "land"; a: number };

const HEAVY = new Set(["punchFin", "sweep", "spSpin", "spCharge", "spFlurry", "spSlam", "spBlade", "spFire"]);
// frames into "down" at which the body reaches the floor (the knockdown clips land on it)
const LAND_AT = FALL_LAND;

export class CueTracker {
  private moves: (string | null)[] = [];
  private starts: number[] = [];
  /** each fighter's state on the previous step, and whether its "down" started from a throw (already on the floor) */
  private states: string[] = [];
  private thrown: boolean[] = [];

  reset(): void {
    this.moves = [];
    this.starts = [];
    this.states = [];
    this.thrown = [];
  }

  collect(w: World): Cue[] {
    const out: Cue[] = [...w.s.events];
    for (const f of w.s.fighters) {
      const start = w.s.frame - f.t;
      const fresh = f.state === "attack" && f.move && f.move !== "grab" && (f.move !== this.moves[f.id] || start !== this.starts[f.id]);
      if (fresh && f.move) out.push({ kind: "swing", a: f.id, move: f.move, heavy: HEAVY.has(f.move) || f.charge > 20 });
      this.moves[f.id] = f.state === "attack" ? f.move : null;
      this.starts[f.id] = start;
      // a knockdown hits the floor partway into "down"; a thrown body hits it as "down" starts
      if (f.state === "down" && this.states[f.id] !== "down") this.thrown[f.id] = this.states[f.id] === "thrown" || this.states[f.id] === "air";
      if (f.state === "down" && f.stop === 0 && f.t === (this.thrown[f.id] ? 0 : LAND_AT)) out.push({ kind: "land", a: f.id });
      this.states[f.id] = f.state;
    }
    return out;
  }
}
