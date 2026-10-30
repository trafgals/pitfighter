// The feel lab's dials: the numbers that decide how the fight feels, each with
// the range the lab's sliders cover. They are the live constant objects the
// sim and the renderer read every frame, so a change takes hold at once, and
// a preset is just a set of values for them.
//
// Changing a sim number changes what a recorded take does when it replays:
// that is the point of the lab, which replays one take under two presets.
import { AIR, CRUNCH, DASH, EVADE, HITSTOP, KNOCK, SPEED } from "../sim/moves";
import { CAMERA } from "../render/camera";
import { SLOW_FINAL, SLOW_KO } from "../render/impact";

export interface Tunable {
  /** "group.key": what a preset calls it */
  id: string;
  group: string;
  label: string;
  obj: Record<string, number>;
  key: string;
  min: number;
  max: number;
  step: number;
  /** "render" changes only the picture; "sim" changes what happens */
  layer: "render" | "sim";
}

type Spec = [key: string, label: string, min: number, max: number, step: number];

function group(id: string, name: string, layer: Tunable["layer"], obj: object, specs: Spec[]): Tunable[] {
  return specs.map(([key, label, min, max, step]) => ({ id: `${id}.${key}`, group: name, label, obj: obj as Record<string, number>, key, min, max, step, layer }));
}

export const TUNABLES: Tunable[] = [
  ...group("camera", "Camera", "render", CAMERA, [
    ["pitch", "looks down at (deg)", 10, 70, 1],
    ["near", "closest (m)", 3, 20, 0.5],
    ["spread", "back off per m of spread", 0, 3, 0.05],
    ["far", "furthest (m)", 8, 40, 1],
    ["fov", "lens (deg)", 20, 70, 1],
    ["engage", "CPU in shot within (m)", 0, 15, 0.5],
    ["pull", "pull to arena middle", 0, 1, 0.05],
    ["follow", "follow speed", 0.5, 10, 0.5],
    ["lookY", "look-at height (m)", 0, 2, 0.1],
    ["shake", "shake and lurch", 0, 3, 0.1],
    ["punch", "punch-in", 0, 3, 0.1],
  ]),
  ...group("hitstop", "Hitstop (frames)", "sim", HITSTOP, [
    ["base", "every hit", 0, 10, 1],
    ["perDmg", "per point of damage", 0, 2, 0.05],
    ["knock", "extra on a knockdown", 0, 12, 1],
    ["max", "cap", 0, 30, 1],
    ["reversal", "reversal", 0, 30, 1],
    ["throw", "throw", 0, 20, 1],
    ["ko", "KO", 0, 40, 1],
  ]),
  ...group("knock", "Knockback", "sim", KNOCK, [
    ["hitstun", "stagger push divisor", 2, 30, 0.5],
    ["down", "knockdown push divisor", 2, 30, 0.5],
    ["friction", "slide kept per frame", 0.5, 0.99, 0.01],
  ]),
  ...group("speed", "Movement (m/frame)", "sim", SPEED, [
    ["walk", "walk", 0.01, 0.15, 0.005],
    ["run", "run", 0.03, 0.25, 0.005],
  ]),
  ...group("dash", "Dash", "sim", DASH, [
    ["speed", "speed (m/frame)", 0.03, 0.3, 0.005],
    ["move", "moving frames", 2, 30, 1],
    ["dur", "total frames", 6, 40, 1],
  ]),
  ...group("evade", "Evade", "sim", EVADE, [
    ["speed", "speed (m/frame)", 0.02, 0.2, 0.005],
    ["move", "moving frames", 2, 30, 1],
    ["dur", "total frames", 10, 60, 1],
  ]),
  ...group("air", "Juggles", "sim", AIR, [
    ["launch", "launch (m/frame up)", 0.02, 0.12, 0.002],
    ["pop", "pop per air hit", 0, 0.08, 0.002],
    ["g", "gravity (m/frame²)", 0.0005, 0.005, 0.0001],
    ["drag", "air drift kept per frame", 0.8, 1, 0.005],
    ["bounce", "floor bounce", 0, 0.8, 0.02],
    ["steer", "victim steer per hit", 0, 0.004, 0.0001],
    ["flee", "flee per hit", 0, 0.04, 0.001],
  ]),
  ...group("crunch", "Crunch", "sim", CRUNCH, [
    ["speed", "crunches from (m/frame)", 0.01, 0.2, 0.005],
    ["rebound", "rebound", 0, 1, 0.05],
  ]),
  ...group("slowKo", "Slow motion on a KO", "render", SLOW_KO, [
    ["scale", "speed", 0.05, 1, 0.05],
    ["hold", "hold (s)", 0, 2, 0.05],
  ]),
  ...group("slowFinal", "Slow motion on the winning KO", "render", SLOW_FINAL, [
    ["scale", "speed", 0.05, 1, 0.05],
    ["hold", "hold (s)", 0, 3, 0.05],
  ]),
];

export type Preset = Record<string, number>;

/** Every dial's value now. */
export function snapshot(): Preset {
  return Object.fromEntries(TUNABLES.map((t) => [t.id, t.obj[t.key]]));
}

/** What the game shipped with, read before anything turned a dial. */
export const DEFAULTS: Readonly<Preset> = Object.freeze(snapshot());

/** Set the dials a preset names; any it doesn't name keep their value, and names it doesn't know are ignored. */
export function apply(p: Preset): void {
  for (const t of TUNABLES) {
    const v = p[t.id];
    if (typeof v === "number" && Number.isFinite(v)) t.obj[t.key] = v;
  }
}

/** Back to what the game shipped with. */
export function reset(): void {
  apply(DEFAULTS);
}

/** Only the dials a preset turned away from the defaults: what to paste into a report. */
export function changed(p: Preset = snapshot()): Preset {
  return Object.fromEntries(Object.entries(p).filter(([id, v]) => id in DEFAULTS && v !== DEFAULTS[id]));
}
