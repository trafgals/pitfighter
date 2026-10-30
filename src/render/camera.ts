// How the camera frames the fight, kept as plain numbers so the feel lab can
// tune it live and the tests can check it without WebGL.
//
// The shot follows the action, not the whole arena: with humans playing, it
// frames them, the foe each is locked on to, and whoever is close enough to
// be fighting them, so a player stays big on screen while CPUs brawl
// elsewhere. With no human (the attract
// brawl, ?auto=1) it frames everyone left standing. It sits low and close,
// leaning out only as far as the action spreads.

export const CAMERA = {
  /** degrees the camera looks down at the floor */
  pitch: 32,
  /** m from the look point when the action is all in one spot */
  near: 7,
  /** m further back for every m the action spreads from its middle */
  spread: 1.35,
  /** m at the most */
  far: 22,
  /** degrees of vertical lens */
  fov: 40,
  /** m: a CPU this close to a human is in the human's shot */
  engage: 5,
  /** 0..1: how far the shot's middle is drawn toward the arena's middle (0: it stays on the fighters) */
  pull: 0,
  /** per s: how fast the shot follows the action */
  follow: 3,
  /** m: the height the camera looks at */
  lookY: 0.9,
  /** scale on every shake and lurch */
  shake: 1,
  /** scale on the punch-in toward a heavy hit */
  punch: 1,
};

export type CameraParams = typeof CAMERA;

/** A fighter as the camera sees it: where it stands on the floor (three-space x, z). */
export interface Framee {
  x: number;
  z: number;
  human: boolean;
  alive: boolean;
  /** the index of the fighter it is locked on to, if any */
  target?: number;
}

export interface Shot {
  /** the middle of the shot on the floor */
  x: number;
  z: number;
  /** how far the action spreads from it (m) */
  spread: number;
  /** how far back the camera stands (m), before the HUD's share */
  dist: number;
}

/** Who the shot is about: the humans, their foes and whoever is fighting them, or everyone standing when no human is. */
export function focusOf(fs: Framee[], c: CameraParams = CAMERA): Framee[] {
  const up = fs.filter((f) => f.alive);
  const humans = up.filter((f) => f.human);
  if (!humans.length) return up;
  const targets = new Set(humans.map((h) => h.target));
  return up.filter((f) => f.human || targets.has(fs.indexOf(f)) || humans.some((h) => Math.hypot(h.x - f.x, h.z - f.z) <= c.engage));
}

/** Where the shot wants to be this frame. */
export function frameShot(fs: Framee[], c: CameraParams = CAMERA): Shot {
  const focus = focusOf(fs, c);
  let x = 0;
  let z = 0;
  for (const f of focus) {
    x += f.x;
    z += f.z;
  }
  if (focus.length) {
    x /= focus.length;
    z /= focus.length;
  }
  let spread = 0;
  for (const f of focus) spread = Math.max(spread, Math.hypot(f.x - x, f.z - z));
  x *= 1 - c.pull;
  z *= 1 - c.pull;
  const dist = Math.min(c.far, c.near + spread * c.spread);
  return { x, z, spread, dist };
}

/** The camera's offset from the look point at a distance: up and back (toward +z) at the pitch. */
export function cameraOffset(dist: number, c: CameraParams = CAMERA): { y: number; z: number } {
  const p = (c.pitch * Math.PI) / 180;
  return { y: dist * Math.sin(p), z: dist * Math.cos(p) };
}
