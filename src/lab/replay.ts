// The feel lab's takes. The sim is deterministic (a seed, the inputs, the
// constants), so a take is just the match's setup and the humans' inputs,
// frame by frame from the first. Played back on a fresh match, the same take
// under the same dials comes out the same, frame for frame; under other dials
// the same hands play out differently, which is what the lab compares.
import { Bot } from "../sim/ai";
import { NO_INPUT, type PlayerInput } from "../sim/types";
import { World } from "../sim/world";
import type { StageId } from "../sim/stages";

export interface Setup {
  seed: number;
  styles: number[];
  humans: boolean[];
  stage: StageId;
  practice: boolean;
  /** in practice, the CPUs fight back instead of standing as dummies */
  spar?: boolean;
}

export interface Match {
  world: World;
  /** one per fighter: a CPU's brain, or null for a human or a practice dummy */
  bots: (Bot | null)[];
}

/** A fresh match from its setup: the same setup always starts the same match. */
export function buildMatch(s: Setup): Match {
  const world = new World({ seed: s.seed, styles: s.styles, humans: s.humans, stage: s.stage, practice: s.practice });
  // in practice the CPUs are dummies that stand there and take it, unless they spar
  const bots = s.humans.map((h, i) => (h || (s.practice && !s.spar) ? null : new Bot(i, s.seed, 0.55 + 0.1 * ((i * 7) % 4))));
  return { world, bots };
}

/** One step's inputs: the humans' from `human` (none if missing), the CPUs' from their brains. */
export function inputsFor(m: Match, human: (i: number) => PlayerInput | undefined): PlayerInput[] {
  return m.world.fighters.map((f, i) => (f.human ? (human(i) ?? NO_INPUT) : (m.bots[i]?.think(m.world) ?? NO_INPUT)));
}

export interface Take {
  setup: Setup;
  /** per frame, per fighter: a human's input, or null for a CPU */
  frames: (PlayerInput | null)[][];
}

/** Records the humans' hands, from the first frame of a fresh match. */
export class Recorder {
  readonly take: Take;
  constructor(setup: Setup) {
    this.take = { setup: { ...setup, styles: [...setup.styles], humans: [...setup.humans] }, frames: [] };
  }
  push(inputs: PlayerInput[]): void {
    this.take.frames.push(inputs.map((p, i) => (this.take.setup.humans[i] ? { x: p.x, y: p.y, buttons: p.buttons } : null)));
  }
  get length(): number {
    return this.take.frames.length;
  }
}

/** Plays a take back on a fresh match, one step at a time; done once the take runs out. */
export class Player {
  readonly match: Match;
  private t = 0;
  constructor(readonly take: Take) {
    this.match = buildMatch(take.setup);
  }
  get done(): boolean {
    return this.t >= this.take.frames.length;
  }
  get frame(): number {
    return this.t;
  }
  /** The inputs for the next step (call once per step). */
  next(): PlayerInput[] {
    const row = this.take.frames[this.t++] ?? [];
    return inputsFor(this.match, (i) => row[i] ?? undefined);
  }
}
