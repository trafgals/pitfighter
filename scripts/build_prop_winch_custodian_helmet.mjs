#!/usr/bin/env node
// Build the Constable Obadiah Winch custodian helmet as a binary .glb.
//
//   node scripts/build_prop_winch_custodian_helmet.mjs
//
// The asset is authored, not reconstructed: the approved Gate 1 alpha cutout
// and the approved Gate 2 four-view turnaround are the design, and every
// surface here is generated from the measurements taken off them.
//
// FRAME (the whole point of the file)
//   Head-Socket Normalized: the origin sits on the base opening plane, the
//   socket contact plane, centred on the helmet's axis; +Y is up and +Z is
//   forward, so the badge and the front peak both face the fighter's front.
//   Units are metres, so the manifest's centimetres read as 0.22 / 0.32 / 0.26.
//
//   "Base opening" is the plane where the prop meets the socket, i.e. the
//   lowest geometry of the asset (the brim's rolled lip and the welt's lower
//   edge). The crown's head-entry rim sits 2.0 cm above it, under the welt.
//   Everything the helmet is made of is at or above y = 0, so a socket can
//   place it without a per-asset fudge factor.
//
// WHAT THE REFERENCES GAVE US
//   - a tall backward-leaning bell crown, near-cylindrical at the base
//   - a rolled leather welt band around the base of the crown
//   - a flared brim that sweeps down and out, ending in a rolled edge
//   - an eight-point Brunswick star on the front, fluted rays, a raised ring
//     and a five-pointed star inside the ring
//   - a lozenge crest plate over the summit with a brass button and two studs
//   - two longitudinal panel seams, slightly forward of the side meridians
//
//   Colours are sampled from the cutout: near-black navy crown, black brim,
//   dark brown welt, aged brass badge.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { installCanvasShim } from "./lib/canvas_shim.mjs";
import { inspectGlb } from "./lib/glb_inspect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_ID = "prop_winch_custodian_helmet";
const OUT = path.join(ROOT, "public/models/props", `${ASSET_ID}.glb`);

// ---------------------------------------------------------------------------
// The spec, straight out of data/asset_manifest.json and issue #36.
// ---------------------------------------------------------------------------
const SPEC = {
  width: 0.22, // X, brim edge to brim edge
  height: 0.32, // Y, base opening plane to the top of the brass button
  depth: 0.26, // Z, back of the brim to the front of the peak
  triangles: 35000, // hard ceiling
  bytes: 1.5 * 1024 * 1024, // hard ceiling
};

// The crown's own measurements, in metres.
//
// The rim is the head-entry opening and it sits on y = 0: that is the base
// opening the spec names, and the origin is on it. A real custodian helmet's
// brim hangs below the rim, so the brim reaches down to y = -0.045, which is
// where the asset's lowest point - and therefore its socket contact plane -
// sits. The summit is at y = 0.275, so the whole prop is 0.320 tall.
const CROWN = {
  a: 0.088, // base ellipse, X half-width
  b: 0.098, // base ellipse, Z half-depth
  rimY: 0.0, // head-entry rim: the base opening, on the origin's plane
  summitY: 0.262, // top of the dome shell
  lean: 0.022, // how far the summit sits behind the base axis
  shell: 0.006, // felt thickness
};

const BRIM = {
  bead: 0.0035, // radius of the rolled edge along the lip
  attachF: 1.015, // where the brim leaves the crown, as a radius factor
  attachY: 0.008, // and at what height
  drop: 0.0215, // how much the lip hangs lower at the front than at the back
  // The lip's height at a given azimuth: the front peak hangs lowest, the
  // sides are a little higher and the back is highest of all, so the brim
  // sweeps the way the reference shows it.
  lipY: (phi) => -0.0415 + BRIM.drop * (1 - Math.pow((1 + Math.cos(phi)) / 2, 1.5)),
};

// ---------------------------------------------------------------------------
// Deterministic noise, so every rebuild of the asset is byte-comparable.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseGrid(n, rnd) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = rnd();
  return g;
}

/** Tileable value noise: the grid wraps at n, so the texture tiles cleanly. */
function sampleGrid(grid, n, u, v) {
  const x = u * n;
  const y = v * n;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const j0 = ((x0 % n) + n) % n;
  const j1 = ((x0 + 1) % n + n) % n;
  const i0 = ((y0 % n) + n) % n;
  const i1 = ((y0 + 1) % n + n) % n;
  const a = grid[i0 * n + j0];
  const b = grid[i0 * n + j1];
  const c = grid[i1 * n + j0];
  const d = grid[i1 * n + j1];
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

function makeFbm(seed, sizes) {
  const rnd = mulberry32(seed);
  const grids = sizes.map((n) => noiseGrid(n, rnd));
  return (u, v) => {
    let sum = 0;
    let amp = 1;
    let total = 0;
    for (let i = 0; i < grids.length; i++) {
      sum += sampleGrid(grids[i], sizes[i], u, v) * amp;
      total += amp;
      amp *= 0.55;
    }
    return sum / total;
  };
}

/** Height field -> tangent-space normal map, wrapping at the edges. */
function heightToNormal(height, size, strength) {
  const rgba = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      rgba[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      rgba[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// Textures. Leather for the crown, the brim and the welt; aged brass for the
// badge, the button and the studs.
// ---------------------------------------------------------------------------
// Texture resolutions. The asset has a hard file-size budget and the normal
// maps are where the bytes go: a fine-grained normal map is nearly random
// noise and barely compresses. So the colour maps are made at the resolution
// the eye needs and the normal maps at half that, which still carries the
// grain because the grain is finer than a texel at either size.
const TEX_SIZE = { crownColour: 512, crownNormal: 256, brim: 256, brass: 256 };

/** The crown's leather: fine grain over a crackled, tooled surface. */
function buildCrownTextures(size = TEX_SIZE.crownColour) {
  const grain = makeFbm(0x51a7, [64, 128, 256]);
  const crackle = makeFbm(0x9c31, [96, 192]);
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const g = grain(u, v);
      // Ridged noise turns the soft fbm into the thin bright creases of a
      // cracked leather hide.
      const ridge = 1 - Math.abs(crackle(u, v) * 2 - 1);
      const crease = Math.pow(ridge, 9);
      const h = g * 0.55 + crease * 0.45;
      height[y * size + x] = h;

      // Near-black navy, faintly warm where the leather has been rubbed.
      const shade = 1 + (g - 0.5) * 0.20 - crease * 0.22;
      const i = (y * size + x) * 4;
      colour[i] = Math.min(255, Math.round(32 * shade + crease * 10));
      colour[i + 1] = Math.min(255, Math.round(36 * shade + crease * 9));
      colour[i + 2] = Math.min(255, Math.round(50 * shade + crease * 8));
      colour[i + 3] = 255;
    }
  }
  return { colour, normal: heightToNormal(height, size, 2.4) };
}

/** The brim and welt: the same hide, but worn smoother and darker. */
function buildBrimTextures(size = TEX_SIZE.brim) {
  const grain = makeFbm(0x2f10, [32, 64, 128]);
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const g = grain(u, v);
      height[y * size + x] = g * 0.8;
      const shade = 1 + (g - 0.5) * 0.16;
      const i = (y * size + x) * 4;
      colour[i] = Math.round(20 * shade);
      colour[i + 1] = Math.round(22 * shade);
      colour[i + 2] = Math.round(27 * shade);
      colour[i + 3] = 255;
    }
  }
  return { colour, normal: heightToNormal(height, size, 2.4) };
}

/**
 * The brass badge. The texture is polar around its centre: the eight rays
 * each carry a bundle of flutes that fade out at the ray's edges, and the
 * metal is mottled with a darker patina in the hollows.
 */
function buildBrassTextures(badgeOuterRadius, rayInnerFraction, size = TEX_SIZE.brass, tone = 1) {
  const mottle = makeFbm(0x77b2, [16, 32, 64]);
  const pit = makeFbm(0x1d44, [64, 128]);
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const radius = Math.hypot(dx, dy) * 2; // 1 at the star's tips
      const angle = Math.atan2(dy, dx);

      // Position within the 45-degree ray sector; rays start at the top.
      const sector = Math.PI / 4;
      const local = ((((angle - Math.PI / 2) % sector) + sector * 1.5) % sector) - sector / 2;
      const within = local / (sector / 2); // -1 .. 1 across the ray
      const edge = Math.max(0, 1 - Math.pow(Math.abs(within), 3));
      const flute = Math.cos(within * Math.PI * 5);
      const rayFade = Math.min(1, Math.max(0, (radius - rayInnerFraction) / 0.09));

      const flutes = flute * 0.5 * edge * rayFade;
      const grain = (mottle(u, v) - 0.5) * 0.10 + (pit(u, v) - 0.5) * 0.03;
      const h = flutes + grain * 0.5;
      height[y * size + x] = h;

      // Aged brass: warm in the light, olive-dark in the patina. The reference
      // badge is tarnished bronze, not polished gold, so the base tone is dark
      // and the patina takes a large bite out of it.
      const patina = Math.max(0, mottle(u * 1.7 + 0.3, v * 1.7) - 0.52) * 1.5;
      const lit = 1 + flutes * 0.15 + grain * 0.4 - patina * 0.3;
      const i = (y * size + x) * 4;
      colour[i] = Math.min(255, Math.round(138 * tone * lit - patina * 66));
      colour[i + 1] = Math.min(255, Math.round(116 * tone * lit - patina * 44));
      colour[i + 2] = Math.min(255, Math.round(72 * tone * lit - patina * 10));
      colour[i + 3] = 255;
    }
  }
  return { colour, normal: heightToNormal(height, size, 4.2) };
}

// ---------------------------------------------------------------------------
// The crown's maths: a bullet-shaped surface of revolution over an ellipse,
// leaning back, with arc-length tables so that decals can be laid on it.
// ---------------------------------------------------------------------------
const PROFILE = [
  [0.0, 1.0], [0.1, 1.0], [0.22, 0.998], [0.35, 0.992], [0.5, 0.978],
  [0.62, 0.955], [0.72, 0.918], [0.8, 0.862], [0.86, 0.786], [0.91, 0.684],
  [0.95, 0.56], [0.98, 0.39], [1.0, 0.16],
];

/** The crown's radius factor at height parameter t (0 at the rim, 1 at the top). */
function profileR(t) {
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < PROFILE.length - 2 && PROFILE[i + 1][0] < x) i++;
  const [t0, r0] = PROFILE[i];
  const [t1, r1] = PROFILE[i + 1];
  const span = t1 - t0 || 1;
  const f = (x - t0) / span;
  // Catmull-Rom on the radius so the silhouette has no visible creases.
  const p0 = PROFILE[Math.max(0, i - 1)][1];
  const r3 = PROFILE[Math.min(PROFILE.length - 1, i + 2)][1];
  const f2 = f * f;
  const f3 = f2 * f;
  return (
    0.5 *
    (2 * r0 + (r1 - p0) * f + (2 * p0 - 5 * r0 + 4 * r1 - r3) * f2 + (-p0 + 3 * r0 - 3 * r1 + r3) * f3)
  );
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** A point on the crown's outer surface. */
function surface(t, phi) {
  const r = profileR(t);
  const y = CROWN.rimY + t * (CROWN.summitY - CROWN.rimY);
  return V(CROWN.a * r * Math.sin(phi), y, axisShift(t) + CROWN.b * r * Math.cos(phi));
}

/** The same point on the inside of the felt. */
function innerSurface(t, phi) {
  const r = profileR(t);
  const y = CROWN.rimY + t * (CROWN.summitY - CROWN.rimY);
  const a = Math.max(CROWN.a * r - CROWN.shell, 0.0005);
  const b = Math.max(CROWN.b * r - CROWN.shell, 0.0005);
  return V(a * Math.sin(phi), y, axisShift(t) + b * Math.cos(phi));
}

/** How far the crown's axis has drifted back at height parameter t. */
function axisShift(t) {
  return -CROWN.lean * Math.pow(t, 1.8);
}

/** The outward normal, by finite differences of the surface function. */
function surfaceNormal(t, phi) {
  const dt = 1e-4;
  const dp = 1e-4;
  const p = surface(t, phi);
  // At the apex there is no room to step forward, so the difference runs
  // backwards instead.
  const tUp = Math.min(1, t + dt);
  const du = surface(tUp, phi).sub(p);
  if (du.lengthSq() < 1e-18) du.copy(p).sub(surface(Math.max(0, t - dt), phi));
  const dv = surface(t, phi + dp).sub(p);
  const n = new THREE.Vector3().crossVectors(dv, du);
  if (!Number.isFinite(n.x) || n.lengthSq() < 1e-20) return V(0, 1, 0);
  n.normalize();
  // Pointing outward? Step along the normal and see whether that moves away
  // from the crown's axis.
  const axis = V(0, p.y, axisShift(t));
  const before = p.clone().sub(axis).length();
  const after = p.clone().addScaledVector(n, 0.001).sub(axis).length();
  if (after < before) n.negate();
  return n;
}

// Arc length along the front meridian, measured down from the apex.
const MERIDIAN = (() => {
  const N = 600;
  const ts = new Float64Array(N + 1);
  const lens = new Float64Array(N + 1);
  let prev = null;
  let acc = 0;
  for (let i = 0; i <= N; i++) {
    const t = 1 - i / N;
    const p = surface(t, 0);
    if (prev) acc += p.distanceTo(prev);
    ts[i] = t;
    lens[i] = acc;
    prev = p;
  }
  return { ts, lens };
})();

function arcFromT(t) {
  const { ts, lens } = MERIDIAN;
  const f = (1 - Math.min(1, Math.max(0, t))) * (ts.length - 1);
  const i = Math.min(ts.length - 2, Math.floor(f));
  return lens[i] + (lens[i + 1] - lens[i]) * (f - i);
}

function tFromArc(s) {
  const { ts, lens } = MERIDIAN;
  if (s <= 0) return 1;
  if (s >= lens[lens.length - 1]) return 0;
  let lo = 0;
  let hi = lens.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lens[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = lens[hi] - lens[lo] || 1;
  return ts[lo] + (ts[hi] - ts[lo]) * ((s - lens[lo]) / span);
}

const azimuthCache = new Map();

/** Arc length around the crown's azimuth at height t. */
function azimuthArc(t) {
  const key = t.toFixed(6);
  const cached = azimuthCache.get(key);
  if (cached) return cached;
  const r = profileR(t);
  const a = CROWN.a * r;
  const b = CROWN.b * r;
  const N = 512;
  const phis = new Float64Array(N + 1);
  const lens = new Float64Array(N + 1);
  let acc = 0;
  for (let i = 1; i <= N; i++) {
    const phi = (i / N) * Math.PI;
    const x0 = a * Math.sin(phis[i - 1]);
    const z0 = b * Math.cos(phis[i - 1]);
    const x1 = a * Math.sin(phi);
    const z1 = b * Math.cos(phi);
    acc += Math.hypot(x1 - x0, z1 - z0);
    phis[i] = phi;
    lens[i] = acc;
  }
  const table = { phis, lens };
  azimuthCache.set(key, table);
  return table;
}

function phiFromArc(t, s) {
  const { phis, lens } = azimuthArc(t);
  const sign = s < 0 ? -1 : 1;
  const target = Math.abs(s);
  if (target >= lens[lens.length - 1]) return sign * Math.PI;
  let lo = 0;
  let hi = lens.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lens[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = lens[hi] - lens[lo] || 1;
  const phi = phis[lo] + (phis[hi] - phis[lo]) * ((target - lens[lo]) / span);
  return sign * phi;
}

/**
 * A point on the crown, addressed in metres along the crown's own surface:
 * u is across the crown (azimuthal), v is up the meridian.
 */
function domeFromLocal(tA, phiA, u, v) {
  const s = arcFromT(tA) - v;
  const t = tFromArc(Math.max(0, s));
  const phi = phiA + phiFromArc(t, u);
  return { p: surface(t, phi), n: surfaceNormal(t, phi), t, phi };
}

// ---------------------------------------------------------------------------
// Mesh helpers
// ---------------------------------------------------------------------------

/**
 * A grid of quads. sample(i, j) returns the point, the normal and the uv.
 *
 * The grid always carries nU + 1 columns, even where the surface closes on
 * itself: the last column repeats the first one's position but keeps its own
 * texture coordinate. Sharing the vertex instead would make the texture jump
 * back from 6 to 0 across the seam and draw a hard line down the prop.
 *
 * The winding is checked against the supplied normals, so a surface that
 * happens to be built inside-out gets fixed rather than silently inverted.
 */
function buildGrid(nU, nV, sample) {
  const cols = nU + 1;
  const positions = new Float32Array(cols * nV * 3);
  const normals = new Float32Array(cols * nV * 3);
  const uvs = new Float32Array(cols * nV * 2);
  for (let j = 0; j < nV; j++) {
    for (let i = 0; i < cols; i++) {
      const s = sample(i, j);
      const k = (j * cols + i) * 3;
      positions[k] = s.p.x;
      positions[k + 1] = s.p.y;
      positions[k + 2] = s.p.z;
      normals[k] = s.n.x;
      normals[k + 1] = s.n.y;
      normals[k + 2] = s.n.z;
      const u = (j * cols + i) * 2;
      uvs[u] = s.uv[0];
      uvs[u + 1] = s.uv[1];
    }
  }
  const indices = [];
  for (let j = 0; j < nV - 1; j++) {
    for (let i = 0; i < nU; i++) {
      const a = j * cols + i;
      const b = j * cols + i + 1;
      const c = (j + 1) * cols + i;
      const d = (j + 1) * cols + i + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Make sure the winding agrees with the normals.
  const ax = positions[0], ay = positions[1], az = positions[2];
  const bx = positions[3], by = positions[4], bz = positions[5];
  const cx = positions[cols * 3], cy = positions[cols * 3 + 1], cz = positions[cols * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const gx = uy * vz - uz * vy;
  const gy = uz * vx - ux * vz;
  const gz = ux * vy - uy * vx;
  if (gx * normals[0] + gy * normals[1] + gz * normals[2] < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * A flat shape laid onto the crown's surface: the front face, the back face
 * and the rim between them. Used for the badge and the crest plate, both of
 * which hug a curved dome rather than standing off it.
 *
 * The normals are computed from the surface rather than averaged from the
 * triangles: a shape that lies on a curved dome should take the dome's
 * normal, and averaging also produces zero-length normals wherever the
 * triangulation runs a sliver.
 */
function conformedSolid(shape, mapper, { thickness, lift = 0.0006, uvScale = [1, 1] } = {}) {
  // One division per segment: ShapeGeometry otherwise subdivides every line
  // into collinear points, and the triangulation of those produces slivers.
  const flat = new THREE.ShapeGeometry(shape, 1);
  const pos = flat.attributes.position.array;
  const idx = flat.index.array;
  const count = pos.length / 3;

  const corners = [];
  // ShapeGeometry stores each corner as (x, y, 0), so the outline point is
  // read at a stride of three, not two.
  for (let i = 0; i < count; i++) {
    const u = pos[i * 3];
    const v = pos[i * 3 + 1];
    corners.push({ u, v, ...mapper(u, v) });
  }
  if (process.env.PROP_DEBUG) {
    console.log(
      `  conformed: corners=${count} triangles=${idx.length / 3} outline=${shape.getPoints(1).length}` +
        ` lift=${lift} thickness=${thickness}` +
        ` p0=(${corners[0].p.x.toFixed(4)},${corners[0].p.y.toFixed(4)},${corners[0].p.z.toFixed(4)})` +
        ` n0=(${corners[0].n.x.toFixed(3)},${corners[0].n.y.toFixed(3)},${corners[0].n.z.toFixed(3)})`,
    );
  }

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  // The front face, then the back face under it.
  for (const corner of corners) {
    const offset = lift + thickness;
    positions.push(corner.p.x + corner.n.x * offset, corner.p.y + corner.n.y * offset, corner.p.z + corner.n.z * offset);
    normals.push(corner.n.x, corner.n.y, corner.n.z);
    uvs.push(corner.u * uvScale[0] + 0.5, corner.v * uvScale[1] + 0.5);
  }
  const frontCount = count;
  for (const corner of corners) {
    positions.push(corner.p.x + corner.n.x * lift, corner.p.y + corner.n.y * lift, corner.p.z + corner.n.z * lift);
    normals.push(-corner.n.x, -corner.n.y, -corner.n.z);
    uvs.push(corner.u * uvScale[0] + 0.5, corner.v * uvScale[1] + 0.5);
  }
  for (let k = 0; k < idx.length; k += 3) {
    indices.push(idx[k], idx[k + 1], idx[k + 2]);
    indices.push(frontCount + idx[k + 2], frontCount + idx[k + 1], frontCount + idx[k]);
  }

  // The rim: the shape's outline, plus the outline of every hole. A hole's
  // rim faces into the hole, so it is wound the other way round.
  const loops = [{ points: loopPoints(shape), direction: 1 }];
  for (const hole of shape.holes ?? []) loops.push({ points: loopPoints(hole), direction: -1 });
  const epsilon = 1e-4;
  for (const loop of loops) {
    const points = loop.points;
    const rimStart = positions.length / 3;
    for (const point of points) {
      const { p, n } = mapper(point.x, point.y);
      positions.push(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift);
      normals.push(0, 0, 0);
      uvs.push(point.x * uvScale[0] + 0.5, point.y * uvScale[1] + 0.5);
    }
    for (const point of points) {
      const { p, n } = mapper(point.x, point.y);
      const offset = lift + thickness;
      positions.push(p.x + n.x * offset, p.y + n.y * offset, p.z + n.z * offset);
      normals.push(0, 0, 0);
      uvs.push(point.x * uvScale[0] + 0.5, point.y * uvScale[1] + 0.5);
    }
    const rimCount = points.length;
    for (let i = 0; i < rimCount; i++) {
      const i1 = (i + 1) % rimCount;
      const lo = rimStart + i;
      const lo1 = rimStart + i1;
      const hi = rimStart + rimCount + i;
      const hi1 = rimStart + rimCount + i1;
      if (loop.direction > 0) {
        indices.push(lo, lo1, hi, lo1, hi1, hi);
      } else {
        indices.push(lo, hi, lo1, lo1, hi, hi1);
      }
      // The rim faces outward from the shape's edge, which is the outline's
      // edge direction turned a quarter turn in the surface's own tangent plane.
      const a = points[i];
      const b = points[i1];
      const du = b.x - a.x;
      const dv = b.y - a.y;
      const here = mapper(a.x, a.y);
      const alongU = mapper(a.x + epsilon, a.y).p.clone().sub(here.p);
      const alongV = mapper(a.x, a.y + epsilon).p.clone().sub(here.p);
      const outward = alongU.multiplyScalar(dv).addScaledVector(alongV, -du);
      const direction = outward.lengthSq() > 1e-20 ? outward.normalize() : here.n.clone();
      direction.multiplyScalar(loop.direction);
      for (const vertex of [lo, hi]) {
        normals[vertex * 3] = direction.x;
        normals[vertex * 3 + 1] = direction.y;
        normals[vertex * 3 + 2] = direction.z;
      }
    }
  }

  // Every triangle has to agree with the normals its own vertices carry, or
  // it is back-facing and gets culled.
  //
  // The faces and the rim are each wound by hand, and a star's rim in
  // particular comes out the wrong way round on the concave notches: a culled
  // rim leaves the piece looking like a flat patch painted on the surface
  // instead of a raised solid, which is exactly how a badge's centre star
  // disappears into the star plate it sits on.
  //
  // The check sums the geometric normal of each triangle and compares it with
  // the normals the triangle's vertices carry. Testing one triangle is not
  // enough: the first triangle of a star's triangulation can be a sliver, and
  // a sliver's normal is either zero or noise, so a one-triangle test happily
  // passes an inside-out face.
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];
    const ux = positions[ib * 3] - positions[ia * 3];
    const uy = positions[ib * 3 + 1] - positions[ia * 3 + 1];
    const uz = positions[ib * 3 + 2] - positions[ia * 3 + 2];
    const vx = positions[ic * 3] - positions[ia * 3];
    const vy = positions[ic * 3 + 1] - positions[ia * 3 + 1];
    const vz = positions[ic * 3 + 2] - positions[ia * 3 + 2];
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    const nx = normals[ia * 3] + normals[ib * 3] + normals[ic * 3];
    const ny = normals[ia * 3 + 1] + normals[ib * 3 + 1] + normals[ic * 3 + 1];
    const nz = normals[ia * 3 + 2] + normals[ib * 3 + 2] + normals[ic * 3 + 2];
    if (gx * nx + gy * ny + gz * nz < 0) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** The outline of a path, without the duplicate that closes it. */
function loopPoints(path) {
  const raw = path.getPoints(1);
  const points = raw.filter((point, i, all) => i === 0 || point.distanceTo(all[i - 1]) > 1e-9);
  if (points.length > 1 && points[points.length - 1].distanceTo(points[0]) < 1e-9) points.pop();
  return points;
}

/**
 * The badge's raised centre ring: a band with a rounded section, swept round
 * the medallion and laid onto the plate.
 *
 * A flat annulus reads as a painted circle. The reference's ring is a cast
 * ridge with a rounded section, so the light runs along its whole length and
 * the eye reads the medallion as standing proud of the star plate.
 */
function buildBadgeRing(
  mapper,
  { radius, halfWidth, halfHeight, lift, uvScale, uSegments = 96, vSegments = 20 },
) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const theta = (i / uSegments) * Math.PI * 2;
    const phi = (j / (vSegments - 1)) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const here = mapper(radius * c, radius * s);
    // The radial direction, taken in the surface's own tangent plane.
    const eps = 5e-4;
    const outward = mapper((radius + eps) * c, (radius + eps) * s).p
      .clone()
      .sub(mapper((radius - eps) * c, (radius - eps) * s).p);
    const radial = outward.lengthSq() > 1e-18 ? outward.normalize() : V(c, 0, s);
    const p = here.p
      .clone()
      .addScaledVector(here.n, lift)
      .addScaledVector(radial, halfWidth * Math.cos(phi))
      .addScaledVector(here.n, halfHeight * Math.sin(phi));
    const n = radial
      .clone()
      .multiplyScalar(Math.cos(phi))
      .addScaledVector(here.n, Math.sin(phi))
      .normalize();
    return {
      p,
      n,
      uv: [radius * c * uvScale + 0.5, radius * s * uvScale + 0.5],
    };
  });
}

/** A star polygon: alternating outer and inner radii. */
function starShape(points, rOuter, rInner, rotation = Math.PI / 2) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const angle = rotation + (i * Math.PI) / points;
    const r = i % 2 === 0 ? rOuter : rInner;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** An ellipse polygon, for the crest plate. */
function ellipseShape(rx, ry, segments = 48) {
  const shape = new THREE.Shape();
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

// ---------------------------------------------------------------------------
// The parts of the helmet
// ---------------------------------------------------------------------------
const RIM_TILT = 0; // the crown sits square on its axis

/** The crown's outer shell: a bell of navy felt, leaning back. */
function buildCrownShell(uSegments = 96, vSegments = 44) {
  const tAt = (j) => 1 - Math.pow(1 - j / (vSegments - 1), 1.4);
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const t = tAt(j);
    return {
      p: surface(t, phi),
      n: surfaceNormal(t, phi),
      uv: [(i / uSegments) * 6, t * 3],
    };
  });
}

/** The inside of the crown, seen through the opening. */
function buildCrownLining(uSegments = 96, vSegments = 12) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const t = (j / (vSegments - 1)) * 0.94;
    const p = innerSurface(t, phi);
    const n = surfaceNormal(t, phi).negate();
    return { p, n, uv: [(i / uSegments) * 4, t * 2] };
  });
}

/** The annulus that closes the felt's thickness at the opening. */
function buildCrownRim(uSegments = 96) {
  return buildGrid(uSegments, 2, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const outer = surface(0, phi);
    const inner = innerSurface(0, phi);
    const p = j === 0 ? outer : inner;
    const n = V(0, -1, 0);
    return { p, n, uv: [(i / uSegments) * 8, j] };
  });
}

/** The rolled leather welt band that circles the base of the crown. */
function buildWelt(uSegments = 96, vSegments = 10) {
  const bandRadius = 0.0062;
  const bandBottom = 0.001;
  const bandHeight = 0.015;
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const across = j / (vSegments - 1); // 0 at the top of the band, 1 at the bottom
    const angle = across * Math.PI;
    const bulge = bandRadius * Math.sin(angle);
    const r = profileR(0);
    const p = V(
      (CROWN.a * r + bulge) * Math.sin(phi),
      bandBottom + bandHeight * (1 - Math.cos(angle)) * 0.5 + bandHeight * across * 0.5,
      (CROWN.b * r + bulge) * Math.cos(phi),
    );
    const n = V(
      Math.sin(phi) * Math.cos(angle),
      Math.sin(angle),
      Math.cos(phi) * Math.cos(angle),
    ).normalize();
    return { p, n, uv: [(i / uSegments) * 10, across] };
  });
}

/**
 * The brim: it leaves the welt almost level, then turns down to the rolled
 * edge. The lip reaches furthest forward, so the helmet is deeper than it is
 * wide, exactly as the profile view of the turnaround shows.
 */
function buildBrim(uSegments = 96, vSegments = 14) {
  const lip = (phi) => ({
    x: (SPEC.width / 2 - BRIM.bead) * Math.sin(phi),
    z: 0.1265 * Math.cos(phi) + 0.005 * Math.cos(2 * phi),
    y: BRIM.lipY(phi),
  });
  const attach = (phi) => ({
    x: CROWN.a * BRIM.attachF * Math.sin(phi),
    z: CROWN.b * BRIM.attachF * Math.cos(phi),
    y: BRIM.attachY,
  });
  const at = (phi, s) => {
    const l = lip(phi);
    const a = attach(phi);
    // Out fast, down slow: the brim runs nearly level out of the welt and
    // turns down sharply at the edge.
    const g = 1 - Math.pow(1 - s, 2.2);
    const h = Math.pow(s, 2.6);
    return {
      p: V(a.x + (l.x - a.x) * g, a.y + (l.y - a.y) * h, a.z + (l.z - a.z) * g),
    };
  };
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const s = j / (vSegments - 1);
    const { p } = at(phi, s);
    const before = at(phi, Math.max(0, s - 0.02)).p;
    const after = at(phi, Math.min(1, s + 0.02)).p;
    const slope = after.clone().sub(before).normalize();
    const n = V(Math.sin(phi), 0.75, Math.cos(phi)).normalize();
    // Tilt the normal to agree with the slope of the brim's surface.
    n.lerp(slope.clone().negate(), 0.25).normalize();
    return { p, n, uv: [(i / uSegments) * 5, s * 2] };
  });
}

/** The rolled edge along the brim's lip. */
function buildBrimEdge(uSegments = 96, vSegments = 10) {
  const lip = (phi) => ({
    x: (SPEC.width / 2 - BRIM.bead) * Math.sin(phi),
    z: 0.1265 * Math.cos(phi) + 0.005 * Math.cos(2 * phi),
    y: BRIM.lipY(phi),
  });
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const l = lip(phi);
    // The roll's axis runs along the lip; its cross-section is perpendicular
    // to that, in the plane of the brim's own surface, so the roll bulges
    // out and down rather than lying flat.
    const ahead = lip(phi + 0.01);
    const behind = lip(phi - 0.01);
    const axis = V(ahead.x - behind.x, ahead.y - behind.y, ahead.z - behind.z).normalize();
    const radial = V(Math.sin(phi), 0, Math.cos(phi)).normalize();
    const up = new THREE.Vector3().crossVectors(radial, axis).normalize();
    const angle = (j / (vSegments - 1)) * Math.PI * 2;
    const p = V(l.x, l.y, l.z)
      .addScaledVector(radial, BRIM.bead * Math.cos(angle))
      .addScaledVector(up, BRIM.bead * Math.sin(angle));
    const n = radial.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle)).normalize();
    return { p, n, uv: [(i / uSegments) * 10, j / (vSegments - 1)] };
  });
}

/** A raised panel seam running over the crown. */
function buildSeam(phiCentre, segments = 40, around = 8, radius = 0.0022) {
  return buildGrid(segments, around, (i, j) => {
    const t = 0.02 + (i / (segments - 1)) * 0.93;
    const p = surface(t, phiCentre);
    const n = surfaceNormal(t, phiCentre);
    const up = surface(Math.min(1, t + 0.01), phiCentre).sub(p).normalize();
    const aroundDir = V(Math.cos(phiCentre), 0, -Math.sin(phiCentre)).normalize();
    const angle = (j / around) * Math.PI * 2;
    const offset = n.clone().multiplyScalar(0.0008 + radius * Math.cos(angle));
    offset.addScaledVector(aroundDir, radius * Math.sin(angle));
    const pos = p.clone().add(offset);
    const dir = n.clone().multiplyScalar(Math.cos(angle)).addScaledVector(aroundDir, Math.sin(angle)).normalize();
    return { p: pos, n: dir, uv: [(i / (segments - 1)) * 6, j / around] };
  });
}

/** The small leather-covered boss over each ear. */
function buildEarBoss(phiCentre) {
  const t = 0.1;
  const p = surface(t, phiCentre);
  const n = surfaceNormal(t, phiCentre);
  // A shallow cap whose equator is buried in the felt, so only a low dome
  // shows - the same trick a real hat uses to keep a boss sitting flush.
  const radius = 0.014;
  const sink = 0.009;
  const geometry = new THREE.SphereGeometry(radius, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  m.setPosition(p.clone().addScaledVector(n, -sink));
  geometry.applyMatrix4(m);
  return geometry;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------
function buildMaterials() {
  const crownColour = buildCrownTextures(TEX_SIZE.crownColour).colour;
  const crownNormal = buildCrownTextures(TEX_SIZE.crownNormal).normal;
  const brim = buildBrimTextures(TEX_SIZE.brim);
  const badgeOuter = 0.042;
  const badgeInner = 0.022;
  // The flutes fade in just outside the medallion ring, so the ring and the
  // centre star sit on smooth metal the way the reference shows them.
  const medallionOuter = badgeInner * 0.8;
  const brassTexture = buildBrassTextures(badgeOuter, medallionOuter / badgeOuter, TEX_SIZE.brass, 1);
  // The medallion is the part of a real badge that gets rubbed by a uniform
  // and by a cap brim, so it is brighter than the fluted rays, which hold
  // their patina down in the grooves. The reference shows exactly that: worn
  // metal in the middle, dark bronze out on the rays.
  const brassMedallionTexture = buildBrassTextures(
    badgeOuter,
    medallionOuter / badgeOuter,
    TEX_SIZE.brass,
    1.25,
  );

  const makeTexture = (data, size, srgb) => {
    const texture = new THREE.DataTexture(new Uint8Array(data.buffer ?? data), size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };

  const crownMap = makeTexture(crownColour, TEX_SIZE.crownColour, true);
  const crownNormalMap = makeTexture(crownNormal, TEX_SIZE.crownNormal, false);
  const brimMap = makeTexture(brim.colour, TEX_SIZE.brim, true);
  const brimNormalMap = makeTexture(brim.normal, TEX_SIZE.brim, false);
  const brassMap = makeTexture(brassTexture.colour, TEX_SIZE.brass, true);
  const brassNormalMap = makeTexture(brassTexture.normal, TEX_SIZE.brass, false);
  const brassMedallionMap = makeTexture(brassMedallionTexture.colour, TEX_SIZE.brass, true);

  const felt = new THREE.MeshStandardMaterial({
    name: "Crown_Navy_Felt",
    map: crownMap,
    normalMap: crownNormalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.78,
    metalness: 0.02,
  });
  const lining = new THREE.MeshStandardMaterial({
    name: "Crown_Inner_Lining",
    color: 0x0d0f14,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const leather = new THREE.MeshStandardMaterial({
    name: "Brim_Black_Leather",
    map: brimMap,
    normalMap: brimNormalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.62,
    metalness: 0.03,
  });
  const welt = new THREE.MeshStandardMaterial({
    name: "Welt_Dark_Leather",
    map: brimMap,
    normalMap: brimNormalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    color: 0xe0d6c4,
    roughness: 0.5,
    metalness: 0.04,
  });
  const brass = new THREE.MeshStandardMaterial({
    name: "Brass_Aged",
    map: brassMap,
    normalMap: brassNormalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.62,
    metalness: 0.92,
  });
  // The medallion's own brass: brighter and smoother than the rays.
  const brassMedallion = new THREE.MeshStandardMaterial({
    name: "Brass_Worn_Medallion",
    map: brassMedallionMap,
    normalMap: brassNormalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.42,
    metalness: 0.95,
  });
  // The button and the studs are too small for the badge's fluted normal map,
  // which would read as a swirl on a dome that size.
  const brassPlain = new THREE.MeshStandardMaterial({
    name: "Brass_Aged_Plain",
    color: 0x8a7048,
    roughness: 0.45,
    metalness: 0.92,
  });

  return { felt, lining, leather, welt, brass, brassMedallion, brassPlain };
}

function main() {
  installCanvasShim();
  const materials = buildMaterials();
  const root = new THREE.Group();
  root.name = ASSET_ID;

  const add = (name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    root.add(mesh);
    return mesh;
  };

  // -- the crown ------------------------------------------------------------
  add("Crown_Shell_Navy_Felt", buildCrownShell(), materials.felt);
  add("Crown_Inner_Lining", buildCrownLining(), materials.lining);
  add("Crown_Opening_Rim", buildCrownRim(), materials.lining);
  add("Rolled_Leather_Welt_Band", buildWelt(), materials.welt);
  add("Brim_Flared_Leather", buildBrim(), materials.leather);
  add("Brim_Rolled_Edge", buildBrimEdge(), materials.leather);

  // -- the panel seams ------------------------------------------------------
  const seamAngle = (75 * Math.PI) / 180;
  add("Crown_Seam_Left", buildSeam(seamAngle), materials.felt);
  add("Crown_Seam_Right", buildSeam(-seamAngle), materials.felt);

  // -- the ear bosses -------------------------------------------------------
  add("Ear_Boss_Left", buildEarBoss(Math.PI / 2), materials.felt);
  add("Ear_Boss_Right", buildEarBoss(-Math.PI / 2), materials.felt);

  // -- the Brunswick star badge --------------------------------------------
  const badgeOuter = 0.042;
  const badgeInner = 0.022;
  const badgeT = 0.521;
  const badgeMapper = (u, v) => domeFromLocal(badgeT, 0, u, v);
  // The badge is three stacked pieces, each standing clear of the one below:
  // the eight-point plate, a raised ring around the medallion, and a
  // five-pointed star inside the ring. Every layer has to clear the last by
  // enough to be seen, and by more than enough not to fight with it.
  //
  // The brass texture is polar: its radius 1 is the star's tips and its eight
  // sectors are the eight rays, so the UV scale has to put the badge's outer
  // radius exactly on the texture's radius 1. That is a scale of 0.5 over the
  // badge's radius, not 1. At 1 the badge spans the texture twice over: the
  // flutes come out twice as dense, they no longer line up with the rays, and
  // the ring and the centre star fall inside the fluted band instead of the
  // smooth medallion the reference shows.
  add(
    "Brunswick_Star_Badge_Plate",
    conformedSolid(starShape(8, badgeOuter, badgeInner), badgeMapper, {
      thickness: 0.0022,
      lift: 0.0004,
      uvScale: [0.5 / badgeOuter, 0.5 / badgeOuter],
    }),
    materials.brass,
  );
  // The ring is a swept band with a rounded section, not a flat annulus: the
  // reference's ring is a cast ridge, and it is what tells the eye that the
  // medallion stands proud of the star plate.
  add(
    "Brunswick_Star_Centre_Ring",
    buildBadgeRing(badgeMapper, {
      radius: badgeInner * 0.7,
      halfWidth: badgeInner * 0.19,
      halfHeight: 0.0013,
      lift: 0.0021,
      uvScale: 0.5 / badgeOuter,
    }),
    materials.brassMedallion,
  );
  // The centre star stands on the plate rather than floating over it, and it
  // is chunky: the reference's is a cast star with real depth.
  add(
    "Brunswick_Star_Inner_Five_Point",
    conformedSolid(starShape(5, badgeInner * 0.48, badgeInner * 0.21), badgeMapper, {
      thickness: 0.004,
      lift: 0.0028,
      uvScale: [0.5 / badgeOuter, 0.5 / badgeOuter],
    }),
    materials.brassMedallion,
  );

  // -- the crest plate over the summit --------------------------------------
  const crestAnchor = 0.028; // metres down the meridian from the apex
  const crestT = tFromArc(crestAnchor);
  const crestMapper = (u, v) => domeFromLocal(crestT, 0, u, v);
  add(
    "Summit_Crest_Plate",
    conformedSolid(ellipseShape(0.016, 0.017, 44), crestMapper, {
      thickness: 0.0022,
      lift: 0.0004,
      uvScale: [6, 6],
    }),
    materials.leather,
  );

  // -- the brass button and studs on the crest ------------------------------
  const apex = surface(1, 0);
  const apexNormal = surfaceNormal(1, 0);
  const buttonRadius = 0.0085;
  // The top of the asset, measured up from the brim's lowest point, which is
  // what makes the whole prop exactly SPEC.height tall.
  const topY = SPEC.height + (BRIM.lipY(0) - BRIM.bead);
  const buttonLift = (topY - apex.y) / apexNormal.y - buttonRadius;
  const buttonCentre = apex.clone().addScaledVector(apexNormal, buttonLift);
  const button = new THREE.SphereGeometry(buttonRadius, 20, 11);
  {
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), apexNormal);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    m.setPosition(buttonCentre);
    button.applyMatrix4(m);
  }
  add("Summit_Brass_Button", button, materials.brassPlain);

  for (const [name, side] of [["Summit_Brass_Stud_Front", 1], ["Summit_Brass_Stud_Back", -1]]) {
    const spot = domeFromLocal(crestT, 0, 0, side * 0.0105);
    const stud = new THREE.SphereGeometry(0.0038, 12, 7);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), spot.n);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    m.setPosition(spot.p.clone().addScaledVector(spot.n, 0.0022));
    stud.applyMatrix4(m);
    add(name, stud, materials.brassPlain);
  }

  // -- final framing -------------------------------------------------------
  // The base opening stays on y = 0; only the height is trimmed onto the
  // spec, so the asset is exactly SPEC.height tall with the rim on the
  // origin's plane.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const height = box.max.y - box.min.y;
  const correction = SPEC.height / height;
  root.traverse((child) => {
    if (!child.isMesh) return;
    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      position.setY(i, position.getY(i) * correction);
    }
    position.needsUpdate = true;
    child.geometry.computeBoundingBox();
  });

  // Any normal that is not a unit vector shades as a black smear, so the
  // build refuses to ship one.
  const badNormals = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    const normal = child.geometry.attributes.normal;
    if (!normal) return;
    for (let i = 0; i < normal.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      if (!(length > 0.99)) {
        badNormals.push(`${child.name} vertex ${i} (length ${length.toFixed(3)})`);
        break;
      }
    }
  });

  // -- export ---------------------------------------------------------------
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, Buffer.from(result));
        resolve({ correction, height, badNormals });
      },
      (error) => reject(error),
      { binary: true, onlyVisible: false },
    );
  });
}

main()
  .then(({ correction, height, badNormals }) => {
    const report = inspectGlb(OUT);
    console.log(`wrote ${path.relative(ROOT, OUT)}`);
    console.log(`  triangles      ${report.triangles} (budget ${SPEC.triangles})`);
    console.log(`  bytes          ${report.bytes} (${(report.bytes / 1048576).toFixed(3)} MB, budget 1.5 MB)`);
    console.log(`  bbox cm        ${report.bbox.size.map((v) => (v * 100).toFixed(2)).join(" x ")}`);
    console.log(`  bbox min       ${report.bbox.min.map((v) => (v * 100).toFixed(2)).join(", ")} cm`);
    console.log(`  bbox max       ${report.bbox.max.map((v) => (v * 100).toFixed(2)).join(", ")} cm`);
    console.log(`  height before  ${(height * 100).toFixed(3)} cm (correction ${correction.toFixed(5)})`);
    console.log(`  meshes         ${report.meshes.length}, materials ${report.materials.length}, images ${report.images}`);
    if (badNormals.length) {
      console.log(`  BAD NORMALS    ${badNormals.length}: ${badNormals.join(", ")}`);
    }
    if (report.problems.length) {
      console.log("  PROBLEMS:");
      for (const problem of report.problems) console.log(`    - ${problem}`);
    }
    const overTriangles = report.triangles >= SPEC.triangles;
    const overBytes = report.bytes > SPEC.bytes;
    if (overTriangles || overBytes || badNormals.length || report.problems.length) {
      console.error("BUILD NOT CLEAN");
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
