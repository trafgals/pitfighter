// Surfaces made at load time from a few lines of noise instead of image files:
// the fighters' skin and cloth, and the floor of every arena. Each recipe bakes
// a tiling colour map, a height map for bump lighting and, for the hell floor,
// a glow map. Nothing is downloaded, the same seed always bakes the same
// pixels, and a stage only bakes the surfaces it uses.
import * as THREE from "three";

const hash = (x: number, y: number, s: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t: number) => t * t * (3 - 2 * t);
const wrap = (k: number, p: number) => ((k % p) + p) % p;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number) => fade(clamp01((x - a) / (b - a)));

/** Value noise over the tile [0,1)², px by py lattice cells, wrapping at the tile's edges. */
export function vnoise(u: number, v: number, px: number, py: number, s: number): number {
  const x = u * px;
  const y = v * py;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const xa = wrap(x0, px);
  const xb = wrap(x0 + 1, px);
  const ya = wrap(y0, py);
  const yb = wrap(y0 + 1, py);
  const a = hash(xa, ya, s);
  const b = hash(xb, ya, s);
  const c = hash(xa, yb, s);
  const d = hash(xb, yb, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise: octaves of value noise, each twice as fine and half as strong. Still tiles. */
export function fbm(u: number, v: number, px: number, py: number, s: number, oct = 5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let k = 0; k < oct; k++) {
    sum += amp * vnoise(u, v, px << k, py << k, s + k * 101);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * Cellular noise: one jittered point in each of n×n cells, wrapping. Returns the
 * distance to the nearest point (f1) and the next nearest (f2), in cells, and an
 * id in [0,1) for the nearest point's cell. f2 - f1 is ~0 along the cracks between cells.
 */
export function worley(u: number, v: number, n: number, s: number): { f1: number; f2: number; id: number } {
  const x = u * n;
  const y = v * n;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const ix = wrap(cx + dx, n);
      const iy = wrap(cy + dy, n);
      const d = Math.hypot(cx + dx + hash(ix, iy, s) - x, cy + dy + hash(ix, iy, s + 7) - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash(ix, iy, s + 13);
      } else if (d < f2) f2 = d;
    }
  return { f1, f2, id };
}

/** What a recipe says about one texel: colour (0..1), height (0..1) and glow (0..1). */
export interface Texel {
  r: number;
  g: number;
  b: number;
  h: number;
  er: number;
  eg: number;
  eb: number;
}
export type Recipe = (u: number, v: number, o: Texel) => void;

export interface Baked {
  size: number;
  color: Uint8Array; // RGBA
  height: Uint8Array; // RGBA, grey
  glow: Uint8Array | null; // RGBA, only when the recipe glows
}

export function bake(size: number, recipe: Recipe): Baked {
  const n = size * size * 4;
  const color = new Uint8Array(n);
  const height = new Uint8Array(n);
  const glow = new Uint8Array(n);
  let glows = false;
  const o: Texel = { r: 0, g: 0, b: 0, h: 0, er: 0, eg: 0, eb: 0 };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      o.r = o.g = o.b = o.h = o.er = o.eg = o.eb = 0;
      recipe(x / size, y / size, o);
      const i = (y * size + x) * 4;
      color[i] = clamp01(o.r) * 255;
      color[i + 1] = clamp01(o.g) * 255;
      color[i + 2] = clamp01(o.b) * 255;
      color[i + 3] = 255;
      height[i] = height[i + 1] = height[i + 2] = clamp01(o.h) * 255;
      height[i + 3] = 255;
      if (o.er + o.eg + o.eb > 0) glows = true;
      glow[i] = clamp01(o.er) * 255;
      glow[i + 1] = clamp01(o.eg) * 255;
      glow[i + 2] = clamp01(o.eb) * 255;
      glow[i + 3] = 255;
    }
  return { size, color, height, glow: glows ? glow : null };
}

// ---- the recipes. Fighter surfaces are near white: the material's colour tints them.

const set = (o: Texel, r: number, g: number, b: number, h: number) => {
  o.r = r;
  o.g = g;
  o.b = b;
  o.h = h;
};

export const RECIPES = {
  /** skin: soft mottling, pores, a faint sheen of veins */
  skin: (u, v, o) => {
    const mottle = fbm(u, v, 6, 3, 1, 4);
    const pore = 1 - smoothstep(0.05, 0.22, worley(u, v, 40, 2).f1);
    const vein = smoothstep(0.03, 0, Math.abs(fbm(u, v, 4, 2, 3, 3) - 0.5)) * 0.06;
    const k = 0.84 + 0.16 * mottle - 0.1 * pore - vein;
    set(o, k, k * 0.98, k * 0.96, 0.6 + 0.25 * mottle - 0.45 * pore);
  },
  /** cloth: a tight plain weave of threads going over and under each other */
  cloth: (u, v, o) => {
    const T = 48;
    const tx = u * T;
    const ty = v * T;
    const over = (Math.floor(tx) + Math.floor(ty)) % 2 === 0;
    const across = Math.sin(Math.PI * (over ? ty % 1 : tx % 1));
    const fuzz = fbm(u, v, 32, 32, 5, 3);
    const wear = fbm(u, v, 3, 3, 6, 4);
    const k = 0.66 + 0.24 * across + 0.08 * fuzz + 0.1 * smoothstep(0.55, 0.8, wear);
    set(o, k, k, k, 0.25 + 0.6 * across + 0.15 * fuzz);
  },
  /** hell: plates of basalt, the cracks between them full of molten glow */
  basalt: (u, v, o) => {
    const w = worley(u, v, 7, 10);
    const edge = w.f2 - w.f1;
    const n = fbm(u, v, 8, 8, 11, 5);
    const crack = smoothstep(0.09, 0.0, edge);
    const tone = 0.55 + 0.6 * n + 0.25 * w.id;
    set(o, 0.17 * tone, 0.11 * tone, 0.1 * tone, 0.2 + 0.6 * smoothstep(0, 0.25, edge) + 0.2 * n - 0.3 * crack);
    const heat = crack * (0.55 + 0.6 * fbm(u, v, 5, 5, 12, 3));
    o.r += 0.6 * crack;
    o.g += 0.12 * crack;
    o.er = heat;
    o.eg = heat * 0.32;
    o.eb = heat * 0.04;
  },
  /** the building site: packed dirt, gravel and two tyre ruts */
  dirt: (u, v, o) => {
    const n = fbm(u, v, 6, 6, 20, 5);
    const w = worley(u, v, 28, 21);
    // gravel in about one cell in three, the rest is packed earth
    const pebble = w.id < 0.35 ? smoothstep(0.24, 0.14, w.f1) * smoothstep(0, 0.1, 0.35 - w.id) : 0;
    const rut = (c: number) => smoothstep(0.05, 0.015, Math.abs(v - c - 0.02 * Math.sin(Math.PI * 2 * u)));
    const tracks = Math.max(rut(0.3), rut(0.7));
    const tread = tracks * (0.5 + 0.5 * Math.sign(Math.sin(Math.PI * 2 * u * 48)));
    const k = 0.75 + 0.5 * n - 0.25 * tracks - 0.08 * tread;
    set(o, 0.47 * k, 0.38 * k, 0.28 * k, 0.45 + 0.3 * n - 0.3 * tracks + 0.1 * tread);
    if (pebble > 0) {
      const p = 0.4 + 0.6 * w.id;
      o.r += (p * 0.85 - o.r) * pebble;
      o.g += (p * 0.82 - o.g) * pebble;
      o.b += (p * 0.76 - o.b) * pebble;
      o.h += 0.4 * pebble * (1 - w.f1);
    }
  },
  /** poured concrete: low cloudy stains and small air holes */
  concrete: (u, v, o) => {
    const n = fbm(u, v, 4, 4, 30, 6);
    const pit = smoothstep(0.08, 0.02, worley(u, v, 36, 31).f1);
    const stain = smoothstep(0.55, 0.75, fbm(u, v, 2, 2, 32, 3));
    const k = 0.62 + 0.18 * n - 0.12 * stain - 0.25 * pit;
    set(o, k * 1.02, k, k * 0.95, 0.6 + 0.3 * n - 0.6 * pit);
  },
  /** one roof tile of the tower: weathered slab, gravel ballast, a tar seam round the edge */
  roof: (u, v, o) => {
    const n = fbm(u, v, 4, 4, 40, 5);
    const w = worley(u, v, 26, 41);
    const stone = smoothstep(0.42, 0.3, w.f1);
    const edge = Math.min(u, v, 1 - u, 1 - v);
    const seam = smoothstep(0.025, 0.01, edge);
    const tar = smoothstep(0.62, 0.72, fbm(u, v, 3, 3, 42, 3));
    let k = 0.48 + 0.2 * n - 0.15 * tar;
    k += (0.4 + 0.35 * w.id - k) * stone * 0.8;
    k *= 1 - 0.75 * seam;
    set(o, k, k * 0.99, k * 1.02, 0.5 + 0.2 * n + 0.35 * stone * (1 - w.f1) - 0.5 * seam);
  },
  /** the blimp's promenade deck: eight varnished boards, grain running along them */
  planks: (u, v, o) => {
    const N = 8;
    const i = Math.floor(u * N);
    const x = u * N - i;
    const joint = hash(i, 0, 50); // where this board butts against the next one
    const dv = Math.abs(((v - joint + 1.5) % 1) - 0.5) * 2; // 1 at the joint, 0 opposite it
    const grain = fbm(u, v, N * 16, 2, 51 + i, 4);
    const ring = 0.5 + 0.5 * Math.sin(grain * 40 + i);
    const tone = 0.75 + 0.35 * hash(i, 1, 52);
    const gap = Math.max(smoothstep(0.06, 0.0, Math.min(x, 1 - x)), smoothstep(0.985, 1.0, dv));
    const k = tone * (0.78 + 0.16 * ring + 0.12 * grain) * (1 - 0.7 * gap);
    set(o, 0.5 * k, 0.37 * k, 0.24 * k, 0.6 + 0.15 * ring - 0.6 * gap);
  },
  /** dressed castle stone in a running bond: eight courses of four blocks, mortar sunk between */
  stone: (u, v, o) => {
    const rows = 8;
    const cols = 4;
    const r = Math.floor(v * rows);
    const y = v * rows - r;
    const xs = u * cols + (r % 2) * 0.5;
    const c = Math.floor(xs);
    const x = xs - c;
    const ragged = 0.03 * (fbm(u, v, 16, 16, 60, 3) - 0.5);
    const edge = Math.min(x * 2, (1 - x) * 2, y, 1 - y) / 2 + ragged; // distance to the joint, about a block
    const mortar = smoothstep(0.035, 0.015, edge);
    const n = fbm(u, v, 8, 8, 61, 5);
    const tone = 0.8 + 0.3 * hash(wrap(c, cols), r, 62);
    const chip = smoothstep(0.1, 0.03, worley(u, v, 24, 63).f1) * 0.2;
    const k = tone * (0.72 + 0.35 * n - chip);
    const m = 0.36 + 0.1 * n;
    set(o, (k + (m - k) * mortar) * 0.98, k + (m - k) * mortar, (k + (m - k) * mortar) * 0.92, 0.35 + 0.45 * smoothstep(0.015, 0.1, edge) + 0.2 * n - 0.2 * chip);
  },
} satisfies Record<string, Recipe>;

export type SurfaceId = keyof typeof RECIPES;

/** The size each surface is baked at: big enough to stay sharp at its repeat. */
const SIZE: Record<SurfaceId, number> = { skin: 256, cloth: 256, basalt: 512, dirt: 512, concrete: 256, roof: 256, planks: 512, stone: 512 };

const baked = new Map<SurfaceId, { map: THREE.DataTexture; bump: THREE.DataTexture; glow: THREE.DataTexture | null }>();

function dataTexture(px: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface Surface {
  map: THREE.Texture;
  bumpMap: THREE.Texture;
  emissiveMap?: THREE.Texture;
}

/**
 * The maps of a surface, repeated rx × ry times. The pixels are baked once and
 * shared; every call gets its own textures, so callers can set their own repeat.
 */
export function surface(id: SurfaceId, rx = 1, ry = rx): Surface {
  let b = baked.get(id);
  if (!b) {
    const px = bake(SIZE[id], RECIPES[id]);
    b = { map: dataTexture(px.color, px.size, true), bump: dataTexture(px.height, px.size, false), glow: px.glow ? dataTexture(px.glow, px.size, true) : null };
    baked.set(id, b);
  }
  const rep = (t: THREE.Texture) => {
    const c = t.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  };
  return { map: rep(b.map), bumpMap: rep(b.bump), ...(b.glow ? { emissiveMap: rep(b.glow) } : {}) };
}
