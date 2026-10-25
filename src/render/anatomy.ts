// The fighters' anatomy, painted in code onto their skin: muscle definition on
// the trunk and the arms, and a face on the head. Each recipe knows how its
// part's UVs wrap the body (the skin tubes go round from the front centre and
// up along the rings, the skull and the jaw are spheres facing +z), works out
// where on the body a texel lands, and shades grooves between the muscles dark
// and sunk and the muscle bellies light and raised. Every style gets its own
// look: how cut it is, scars, war paint, wrinkles, stubble, veins.
import { RECIPES, smoothstep, worley, type Recipe, type Texel } from "./textures";
import { CHARACTERS } from "../data/characters";
import type { Look } from "../data/types";

export type { Look };

/** The look of a style: read from the character design, so it is the same every
 *  match and travels with the fighter instead of with its position in the
 *  roster. The second argument is no longer read and is kept only so that
 *  existing callers do not have to change. */
export function lookOf(style: number, _st?: { style: string; punch: number; torso: number }): Look {
  const c = CHARACTERS[style];
  if (!c) throw new Error(`no character for style ${style}`);
  return c.look;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 1 on the line d = 0, fading to 0 at |d| = w */
const groove = (d: number, w: number) => smoothstep(w, 0, Math.abs(d));
/** 1 inside [a, b], fading out over `soft` either side */
const band = (x: number, a: number, b: number, soft: number) => smoothstep(a - soft, a, x) * smoothstep(b + soft, b, x);
/** a value along the rings, v = 0 at the first ring and 1 at the last */
const at = (xs: number[], v: number) => {
  const f = clamp01(v) * (xs.length - 1);
  const i = Math.min(xs.length - 2, Math.floor(f));
  return xs[i] + (xs[i + 1] - xs[i]) * (f - i);
};

/** Shade the skin underneath: grooves dark and sunk, bellies light and raised, scars pale and raised. */
function shade(o: Texel, g: number, b: number, scar = 0, paint = 0, depth = 1) {
  const k = (1 - 0.34 * depth * g + 0.08 * depth * b) * (1 - 0.75 * paint);
  o.r = o.r * k + 0.12 * scar;
  o.g = o.g * k + 0.04 * scar;
  o.b = o.b * k + 0.04 * scar;
  o.h = 0.5 + 0.25 * (o.h - 0.6) + 0.3 * b - 0.45 * g + 0.3 * scar;
}

/**
 * The trunk. ys and rxs are the rings' heights and half widths, bottom to top;
 * u = 0 is the front centre.
 */
export function torsoRecipe(ys: number[], rxs: number[], look: Look): Recipe {
  return (u, v, o) => {
    RECIPES.skin((u * 2) % 1, v, o);
    const y = at(ys, v);
    const a = 2 * Math.PI * u;
    const x = Math.abs(Math.sin(a) * at(rxs, v)); // how far out from the midline
    const front = Math.cos(a) > 0;
    let g = 0;
    let b = 0;
    let scar = 0;
    if (front) {
      // the line down the middle of the belly and between the pecs
      g = Math.max(g, groove(x, 0.012) * band(y, 0.97, 1.36, 0.03));
      // the six-pack: three rows of pads, each side of the midline
      if (x < 0.095 && y < 1.24) {
        const t = (y - 0.985) / 0.06;
        const row = t - Math.floor(t);
        const inside = band(y, 0.985, 1.225, 0.01) * smoothstep(0.09, 0.07, x);
        b = Math.max(b, Math.sin(Math.PI * row) * Math.sin(Math.PI * clamp01(x / 0.085)) * inside);
        g = Math.max(g, groove(row < 0.5 ? row : row - 1, 0.16) * inside * smoothstep(0.0, 0.015, x));
      }
      g = Math.max(g, groove(x - 0.09, 0.012) * band(y, 0.97, 1.2, 0.03)); // the edges of the abs
      // the lower edge of the pecs, curving up into the armpits, and the pecs above it
      const yp = 1.22 + 2 * x * x;
      g = Math.max(g, groove(y - yp, 0.014) * smoothstep(0.23, 0.17, x) * smoothstep(0.005, 0.02, x));
      b = Math.max(b, 0.8 * band(y, yp + 0.01, 1.37, 0.02) * smoothstep(0.24, 0.15, x) * smoothstep(0, 0.03, x));
      // the V of the obliques down into the groin
      if (x > 0.085 && x < 0.2) g = Math.max(g, groove(y - (0.93 + 1.1 * (x - 0.085)), 0.011) * band(y, 0.93, 1.08, 0.02));
      // the serratus: fingers of muscle down the side of the ribs
      if (x > 0.15)
        for (let k = 0; k < 3; k++) g = Math.max(g, 0.7 * groove(y - (1.13 + 0.035 * k + 0.35 * (x - 0.15)), 0.007) * band(y, 1.1, 1.26, 0.01));
      // claw marks raked across the chest
      if (look.scar === 3) {
        const sx = Math.sin(a) * at(rxs, v); // signed, so the rake goes one way
        for (let k = 0; k < 3; k++) scar = Math.max(scar, groove(y - 1.16 - 0.04 * k - 0.6 * (sx + 0.04), 0.0045) * band(sx, -0.12, 0.1, 0.02));
      }
    } else {
      // the spine, the long muscles either side of it, and the edge of the lats
      g = Math.max(g, groove(x, 0.014) * band(y, 0.96, 1.42, 0.03));
      b = Math.max(b, 0.6 * smoothstep(0.06, 0.015, Math.abs(x - 0.045)) * band(y, 0.96, 1.15, 0.03));
      g = Math.max(g, 0.8 * groove(x - (0.06 + 0.16 * clamp01((y - 0.98) / 0.32)), 0.013) * band(y, 0.98, 1.32, 0.03));
    }
    shade(o, g * look.def, b * look.def, scar);
  };
}

/**
 * An arm. ds and rs are the rings' distances down from the shoulder and radii,
 * wrist to shoulder; u = 0 faces forward; side is -1 for the left arm, 1 for the right.
 */
export function armRecipe(ds: number[], rs: number[], upper: number, len: number, side: number, look: Look): Recipe {
  return (u, v, o) => {
    RECIPES.skin(u, v, o);
    const d = at(ds, v);
    const r = at(rs, v);
    const a = Math.atan2(Math.sin(2 * Math.PI * u), Math.cos(2 * Math.PI * u)); // 0 = the front
    const fa = Math.abs(a);
    let g = 0;
    let b = 0;
    if (d > 0.04 && d < upper - 0.015) {
      const t = (d - 0.04) / (upper - 0.055);
      const swell = Math.sin(Math.PI * t);
      // the biceps up the front, outlined
      const w = 0.25 + 0.7 * Math.sqrt(swell);
      b = Math.max(b, smoothstep(w, w * 0.4, fa) * swell);
      g = Math.max(g, groove(fa - w - 0.08, 0.16) * swell);
      // the triceps' horseshoe at the back
      const back = Math.PI - fa;
      const tw = 0.3 + 0.6 * Math.sqrt(Math.sin(Math.PI * Math.min(1, t * 1.3)));
      b = Math.max(b, 0.8 * smoothstep(tw, tw * 0.4, back) * Math.sin(Math.PI * Math.min(1, t * 1.3)));
      g = Math.max(g, 0.8 * groove(back - tw - 0.06, 0.14) * smoothstep(0.75, 0.5, t));
    }
    // the crease inside the elbow
    g = Math.max(g, groove(d - upper - 0.01, 0.012) * smoothstep(1.3, 0.5, fa));
    if (d > upper + 0.015 && d < len - 0.03) {
      const t = (d - upper - 0.015) / (len - upper - 0.045);
      // the forearm's big muscle on the outside, thick at the elbow and tapering away
      b = Math.max(b, smoothstep(0.8, 0.2, Math.abs(a - side * 0.9)) * smoothstep(0.75, 0.05, t));
      g = Math.max(g, 0.7 * groove((a + side * 0.25) * r, 0.006) * smoothstep(0.85, 0.3, t));
    }
    let vein = 0;
    if (look.veins) {
      const path = side * 0.15 + 0.28 * Math.sin(d * 26 + side);
      vein = groove((a - path) * r, 0.0035) * band(d, 0.1, len - 0.05, 0.03) * (d > upper - 0.02 && d < upper + 0.03 ? 0.3 : 1);
      const branch = side * -0.45 + 0.2 * Math.sin(d * 31);
      vein = Math.max(vein, 0.8 * groove((a - branch) * r, 0.003) * band(d, upper + 0.04, len - 0.06, 0.03));
    }
    shade(o, g * look.def, b * look.def);
    o.r *= 1 - 0.12 * vein;
    o.g *= 1 - 0.06 * vein;
    o.h += 0.25 * vein;
  };
}

/** A point on a unit sphere from its UVs, as three's SphereGeometry lays them out: +z is the face. */
const onSphere = (u: number, v: number) => {
  const phi = 2 * Math.PI * u;
  const theta = Math.PI * (1 - v);
  return { x: -Math.cos(phi) * Math.sin(theta), y: Math.cos(theta), z: Math.sin(phi) * Math.sin(theta) };
};
const dist3 = (p: { x: number; y: number; z: number }, x: number, y: number, z: number) => Math.hypot(p.x - x, p.y - y, p.z - z);

/** The skull: eye sockets, brow ridge, nose and cheekbones, plus the style's scars, paint and wrinkles. */
export function faceRecipe(look: Look): Recipe {
  return (u, v, o) => {
    RECIPES.skin((u * 2) % 1, v, o);
    const p = onSphere(u, v);
    const front = smoothstep(0.35, 0.65, p.z);
    const ax = Math.abs(p.x);
    let g = 0;
    let b = 0;
    let scar = 0;
    let paint = 0;
    // the eyes sit at (±0.355, 0.13, 0.87) on the skull
    const sock = Math.min(dist3(p, -0.355, 0.13, 0.87), dist3(p, 0.355, 0.13, 0.87));
    g = Math.max(g, smoothstep(0.3, 0.08, sock));
    // a heavy brow ridge over them, two frown lines between them
    b = Math.max(b, groove(p.y - (0.33 - 0.12 * ax), 0.09) * smoothstep(0.7, 0.45, ax) * front);
    g = Math.max(g, 0.8 * groove(ax - 0.05, 0.018) * band(p.y, 0.2, 0.36, 0.03) * front);
    // the nose: a ridge down the middle, shadow along its sides, nostrils at the bottom
    b = Math.max(b, groove(p.x, 0.075) * band(p.y, -0.3, 0.2, 0.05) * front);
    g = Math.max(g, 0.5 * groove(ax - 0.11, 0.04) * band(p.y, -0.28, 0.12, 0.05) * front);
    g = Math.max(g, smoothstep(0.07, 0.02, Math.min(dist3(p, -0.055, -0.31, 0.95), dist3(p, 0.055, -0.31, 0.95))));
    // cheekbones, and the hollow under them
    b = Math.max(b, 0.7 * smoothstep(0.25, 0.05, Math.min(dist3(p, -0.52, -0.1, 0.84), dist3(p, 0.52, -0.1, 0.84))));
    g = Math.max(g, 0.6 * smoothstep(0.22, 0.05, Math.min(dist3(p, -0.5, -0.38, 0.78), dist3(p, 0.5, -0.38, 0.78))));
    if (look.wrinkles)
      for (let k = 0; k < 3; k++) g = Math.max(g, 0.7 * groove(p.y - 0.45 - 0.07 * k - 0.03 * Math.sin(p.x * 9 + k), 0.012) * smoothstep(0.5, 0.3, ax) * front);
    if (look.paint === 1) paint = smoothstep(0.17, 0.11, Math.min(dist3(p, -0.36, -0.07, 0.93), dist3(p, 0.36, -0.07, 0.93))); // eye black
    if (look.paint === 2) paint = Math.max(groove(ax - 0.355, 0.035), groove(p.x, 0.025)) * band(p.y, -0.45, 0.75, 0.05) * front * (ax > 0.2 || p.y > 0.25 ? 1 : 0);
    if (look.paint === 3) paint = Math.max(smoothstep(0.34, 0.26, sock), smoothstep(0.1, 0.06, dist3(p, 0, -0.27, 0.96))); // a skull mask
    if (look.scar === 1) {
      // straight down through the left eye, brow to cheek
      const t = (p.y - 0.13) / 0.5;
      scar = groove(p.x + 0.355 + 0.25 * t, 0.018) * band(p.y, -0.15, 0.45, 0.02) * front;
    }
    if (look.scar === 2) scar = groove(p.y + 0.22 - 0.5 * (p.x - 0.4), 0.016) * band(p.x, 0.2, 0.68, 0.03) * front;
    shade(o, Math.min(1, g), Math.min(1, b), scar, paint, 1.5); // a face is read from a distance: cut it deeper
  };
}

/** The jaw: a mouth set in a scowl, the lower lip, the chin and, on some, stubble. */
export function jawRecipe(look: Look): Recipe {
  return (u, v, o) => {
    RECIPES.skin((u * 2) % 1, v, o);
    const p = onSphere(u, v);
    const front = smoothstep(0.55, 0.8, p.z);
    const ax = Math.abs(p.x);
    let g = 0;
    let b = 0;
    const mouth = p.y + 0.08 + 0.35 * p.x * p.x; // the corners turned down
    g = Math.max(g, groove(mouth, 0.05) * smoothstep(0.42, 0.3, ax) * front);
    b = Math.max(b, 0.7 * groove(mouth + 0.13, 0.07) * smoothstep(0.3, 0.18, ax) * front); // the lower lip
    g = Math.max(g, 0.6 * groove(p.x, 0.05) * band(p.y, -0.7, -0.4, 0.05) * front); // the cleft chin
    b = Math.max(b, 0.5 * smoothstep(0.35, 0.1, dist3(p, 0, -0.55, 0.82)));
    let paint = 0;
    if (look.stubble) {
      const w = worley(u, v, 64, 77);
      paint = 0.4 * smoothstep(0.22, 0.08, w.f1) * band(p.y, -1, -0.05, 0.08) * (1 - groove(mouth + 0.13, 0.09) * front);
    }
    shade(o, g, b, 0, paint, 1.5);
  };
}
