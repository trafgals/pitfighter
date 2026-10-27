#!/usr/bin/env node
// ============================================================================
// Constable Obadiah Winch — Victorian Police Custodian Bobby Helmet
// Authored by Antigravity (Advanced Agentic Coding) for Pitfighter Issue #36
//
// Generates a production-grade binary .glb adhering to:
//   - Head-Socket Normalized pivot spec (Origin at base opening, +Z forward, +Y up)
//   - Budget: <= 35,000 triangles, <= 1.5 MB binary GLB
//   - Dimensions: Width 22 cm, Height 32 cm, Depth 26 cm (+/- 2mm tolerance)
//   - Authentic Victorian Metropolitan Police Custodian Helmet design:
//       * Tall backward-leaning navy felt dome with longitudinal panel seams
//       * Swept visor brim dipping steeply at front peak with rolled leather bead
//       * Raised rolled leather brow welt and chinstrap with brass buckle
//       * Two brass fluted ear bosses at the temples
//       * Multi-layered 16-point Radiant Brunswick Star badge with Victorian Crown
//       * Raised circular garter ring and faceted star medallion
//       * 8-lobed summit rosette vent disc with domed brass button and studs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { installCanvasShim } from "./lib/canvas_shim.mjs";
import { inspectGlb } from "./lib/glb_inspect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_ID = "prop_winch_custodian_helmet";
const OUT = path.join(ROOT, "public/models/props", "prop_winch_custodian_helmet_antigravity.glb");

// ---------------------------------------------------------------------------
// Specification Constraints (data/asset_manifest.json & issue #36)
// ---------------------------------------------------------------------------
const SPEC = {
  width: 0.22,      // X: 22.0 cm brim edge to brim edge
  height: 0.32,     // Y: 32.0 cm lowest point of brim to summit button
  depth: 0.26,      // Z: 26.0 cm rear of brim to front of visor peak
  triangles: 35000, // Hard poly budget
  bytes: 1.5 * 1024 * 1024, // 1.5 MB hard file budget
};

// Crown dimensions (metres)
const CROWN = {
  a: 0.088,         // Base ellipse X half-width (17.6 cm base width)
  b: 0.098,         // Base ellipse Z half-depth (19.6 cm base depth)
  rimY: 0.0,        // Head-entry rim lies on the origin plane y = 0
  summitY: 0.262,   // Summit of felt dome
  lean: 0.022,      // Rearward bell lean (2.2 cm)
  shell: 0.0055,    // Wool felt thickness (5.5 mm)
};

// Brim dimensions (metres)
const BRIM = {
  bead: 0.0035,     // Rolled edge bead radius (3.5 mm)
  attachF: 1.015,   // Crown attachment radius multiplier
  attachY: 0.008,   // Crown attachment height (8 mm above rim)
  drop: 0.0215,     // Front visor downward drop
  lipY: (phi) => -0.0415 + BRIM.drop * (1 - Math.pow((1 + Math.cos(phi)) / 2, 1.5)),
};

// ---------------------------------------------------------------------------
// Deterministic Noise & Procedural Texture Generation
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
      amp *= 0.52;
    }
    return sum / total;
  };
}

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

const TEX_SIZE = { crownColour: 512, crownNormal: 256, brim: 256, brass: 256 };

/** Navy Wool Felt: fine twill/felt cloth texture with subtle sheen */
function buildCrownTextures(size = TEX_SIZE.crownColour) {
  const woolWeave = makeFbm(0x3841, [128, 256]);
  const feltFuzz = makeFbm(0x82f4, [64, 128]);
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const w = woolWeave(u, v);
      const f = feltFuzz(u, v);
      // Micro diagonal weave pattern of Victorian police felt
      const twill = Math.sin((u + v) * Math.PI * 64) * 0.15;
      const h = w * 0.5 + f * 0.35 + twill * 0.15;
      height[y * size + x] = h;

      // Authentic Victorian police midnight navy blue (#1c212c)
      const shade = 1 + (w - 0.5) * 0.18 + (f - 0.5) * 0.1;
      const i = (y * size + x) * 4;
      colour[i] = Math.min(255, Math.max(0, Math.round(26 * shade)));
      colour[i + 1] = Math.min(255, Math.max(0, Math.round(31 * shade)));
      colour[i + 2] = Math.min(255, Math.max(0, Math.round(44 * shade)));
      colour[i + 3] = 255;
    }
  }
  return { colour, normal: heightToNormal(height, size, 2.2) };
}

/** Burnished black bridle leather for brim, welt, and strap */
function buildBrimTextures(size = TEX_SIZE.brim) {
  const grain = makeFbm(0x19a7, [32, 64, 128]);
  const crackle = makeFbm(0x6e2b, [64, 128]);
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const g = grain(u, v);
      const c = crackle(u, v);
      const crease = Math.pow(1 - Math.abs(c * 2 - 1), 6);
      height[y * size + x] = g * 0.65 + crease * 0.35;

      const shade = 1 + (g - 0.5) * 0.18 - crease * 0.15;
      const i = (y * size + x) * 4;
      colour[i] = Math.min(255, Math.max(0, Math.round(20 * shade)));
      colour[i + 1] = Math.min(255, Math.max(0, Math.round(22 * shade)));
      colour[i + 2] = Math.min(255, Math.max(0, Math.round(26 * shade)));
      colour[i + 3] = 255;
    }
  }
  return { colour, normal: heightToNormal(height, size, 2.5) };
}

/** Radiant Antique Victorian Brass for badge plate, medallion, and crest */
function buildBrassTextures(badgeOuterRadius, rayInnerFraction, size = TEX_SIZE.brass, tone = 1.0) {
  const mottle = makeFbm(0x43b7, [16, 32, 64]);
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const radius = Math.hypot(dx, dy) * 2.0; // 1.0 at outer tips
      const angle = Math.atan2(dy, dx);

      // 16-sector fluting (8 primary diamond rays + 8 intermediate ray valleys)
      const sector = Math.PI / 8;
      const local = ((((angle - Math.PI / 2) % sector) + sector * 1.5) % sector) - sector / 2;
      const within = local / (sector / 2);
      const flute = Math.cos(within * Math.PI * 3.0) * 0.5 + 0.5;
      const rayFade = Math.min(1.0, Math.max(0.0, (radius - rayInnerFraction) / 0.12));

      const mot = mottle(u, v);
      const h = rayFade * flute * 0.7 + mot * 0.3;
      height[y * size + x] = h;

      // Rich antique Victorian gilded brass (#d2aa4b) with darker patina in recesses
      const patina = (1.0 - h * 0.6) * (0.8 + mot * 0.4);
      const baseR = 212 * tone;
      const baseG = 172 * tone;
      const baseB = 78 * tone;

      const i = (y * size + x) * 4;
      colour[i] = Math.min(255, Math.max(0, Math.round(baseR * (0.65 + h * 0.35) - patina * 35)));
      colour[i + 1] = Math.min(255, Math.max(0, Math.round(baseG * (0.65 + h * 0.35) - patina * 40)));
      colour[i + 2] = Math.min(255, Math.max(0, Math.round(baseB * (0.60 + h * 0.40) - patina * 30)));
      colour[i + 3] = 255;
    }
  }
  return { colour, normal: heightToNormal(height, size, 2.6) };
}

// ---------------------------------------------------------------------------
// Crown Profile & Surface Functions
// ---------------------------------------------------------------------------
function profileR(t) {
  // Bell-dome custodian curve: stays near cylindrical near base,
  // gracefully curves inward in mid-dome, and finishes with a rounded cap
  if (t < 0.42) {
    return 1.0 - 0.11 * Math.pow(t / 0.42, 1.4);
  }
  const u = (t - 0.42) / 0.58;
  return 0.89 * Math.sqrt(Math.max(0.0001, 1.0 - Math.pow(u, 1.85)));
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function axisShift(t) {
  return -CROWN.lean * Math.pow(t, 1.8);
}

function surface(t, phi) {
  const r = profileR(t);
  const y = CROWN.rimY + t * (CROWN.summitY - CROWN.rimY);
  return V(CROWN.a * r * Math.sin(phi), y, axisShift(t) + CROWN.b * r * Math.cos(phi));
}

function innerSurface(t, phi) {
  const r = profileR(t);
  const y = CROWN.rimY + t * (CROWN.summitY - CROWN.rimY);
  const a = Math.max(CROWN.a * r - CROWN.shell, 0.001);
  const b = Math.max(CROWN.b * r - CROWN.shell, 0.001);
  return V(a * Math.sin(phi), y, axisShift(t) + b * Math.cos(phi));
}

function surfaceNormal(t, phi) {
  const dt = 1e-4;
  const dp = 1e-4;
  const p = surface(t, phi);
  const tUp = Math.min(1.0, t + dt);
  let du = surface(tUp, phi).sub(p);
  if (du.lengthSq() < 1e-18) du = p.clone().sub(surface(Math.max(0.0, t - dt), phi));
  const dv = surface(t, phi + dp).sub(p);
  const n = new THREE.Vector3().crossVectors(dv, du);
  if (!Number.isFinite(n.x) || n.lengthSq() < 1e-20) return V(0, 1, 0);
  n.normalize();
  const axis = V(0, p.y, axisShift(t));
  const before = p.clone().sub(axis).length();
  const after = p.clone().addScaledVector(n, 0.001).sub(axis).length();
  if (after < before) n.negate();
  return n;
}

// Arc length parameterization along the front meridian (down from apex)
const MERIDIAN = (() => {
  const N = 600;
  const ts = new Float64Array(N + 1);
  const lens = new Float64Array(N + 1);
  let prev = null;
  let acc = 0;
  for (let i = 0; i <= N; i++) {
    const t = 1.0 - i / N;
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
  const f = (1.0 - Math.min(1.0, Math.max(0.0, t))) * (ts.length - 1);
  const i = Math.min(ts.length - 2, Math.floor(f));
  return lens[i] + (lens[i + 1] - lens[i]) * (f - i);
}

function tFromArc(s) {
  const { ts, lens } = MERIDIAN;
  if (s <= 0) return 1.0;
  if (s >= lens[lens.length - 1]) return 0.0;
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

function domeFromLocal(tA, phiA, u, v) {
  const s = arcFromT(tA) - v;
  const t = tFromArc(Math.max(0.0, s));
  const phi = phiA + phiFromArc(t, u);
  return { p: surface(t, phi), n: surfaceNormal(t, phi), t, phi };
}

// ---------------------------------------------------------------------------
// Mesh Construction Utilities
// ---------------------------------------------------------------------------
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
  // Enforce consistent outward winding
  const ax = positions[0], ay = positions[1], az = positions[2];
  const bx = positions[3], by = positions[4], bz = positions[5];
  const cx = positions[cols * 3], cy = positions[cols * 3 + 1], cz = positions[cols * 3 + 2];
  const gx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  const gy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  const gz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
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

function conformedSolid(shape, mapper, { thickness, lift = 0.0006, uvScale = [1, 1] } = {}) {
  const flat = new THREE.ShapeGeometry(shape, 1);
  const pos = flat.attributes.position.array;
  const idx = flat.index.array;
  const count = pos.length / 3;

  const corners = [];
  for (let i = 0; i < count; i++) {
    const u = pos[i * 3];
    const v = pos[i * 3 + 1];
    corners.push({ u, v, ...mapper(u, v) });
  }

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  // Front face (lifted proud)
  for (const corner of corners) {
    const offset = lift + thickness;
    positions.push(corner.p.x + corner.n.x * offset, corner.p.y + corner.n.y * offset, corner.p.z + corner.n.z * offset);
    normals.push(corner.n.x, corner.n.y, corner.n.z);
    uvs.push(corner.u * uvScale[0] + 0.5, corner.v * uvScale[1] + 0.5);
  }
  const frontCount = count;
  // Back face (seated near felt)
  for (const corner of corners) {
    positions.push(corner.p.x + corner.n.x * lift, corner.p.y + corner.n.y * lift, corner.p.z + corner.n.z * lift);
    normals.push(-corner.n.x, -corner.n.y, -corner.n.z);
    uvs.push(corner.u * uvScale[0] + 0.5, corner.v * uvScale[1] + 0.5);
  }
  for (let k = 0; k < idx.length; k += 3) {
    indices.push(idx[k], idx[k + 1], idx[k + 2]);
    indices.push(frontCount + idx[k + 2], frontCount + idx[k + 1], frontCount + idx[k]);
  }

  // Side rim edges
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

  // Winding safety verification
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

function loopPoints(path) {
  const raw = path.getPoints(1);
  const points = raw.filter((point, i, all) => i === 0 || point.distanceTo(all[i - 1]) > 1e-9);
  if (points.length > 1 && points[points.length - 1].distanceTo(points[0]) < 1e-9) points.pop();
  return points;
}

// ---------------------------------------------------------------------------
// 16-Point Radiant Brunswick Star & Victorian Badge Shape
// ---------------------------------------------------------------------------
function brunswickStarShape(rOuter, rMid, rInner) {
  const shape = new THREE.Shape();
  const totalPoints = 16; // 8 primary rays + 8 intermediate ray clusters
  for (let i = 0; i < totalPoints * 2; i++) {
    const angle = Math.PI / 2 + (i * Math.PI) / totalPoints;
    let r;
    if (i % 4 === 0) {
      r = rOuter;       // Primary 8 major ray tips
    } else if (i % 2 === 0) {
      r = rMid;         // Intermediate 8 secondary ray tips
    } else {
      r = rInner;       // Ray valleys between the tips
    }
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

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
// Component Construction
// ---------------------------------------------------------------------------

/** Outer shell of dark navy felt dome */
function buildCrownShell(uSegments = 96, vSegments = 44) {
  const tAt = (j) => 1.0 - Math.pow(1.0 - j / (vSegments - 1), 1.4);
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

/** Inner felt head lining */
function buildCrownLining(uSegments = 96, vSegments = 12) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const t = (j / (vSegments - 1)) * 0.94;
    const p = innerSurface(t, phi);
    const n = surfaceNormal(t, phi).negate();
    return { p, n, uv: [(i / uSegments) * 4, t * 2] };
  });
}

/** Bottom rim closure annulus */
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

/** Rolled leather brow welt band circling crown base */
function buildWelt(uSegments = 96, vSegments = 10) {
  const bandRadius = 0.0062;
  const bandBottom = 0.001;
  const bandHeight = 0.015;
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const across = j / (vSegments - 1);
    const angle = across * Math.PI;
    const bulge = bandRadius * Math.sin(angle);
    const r = profileR(0);
    const p = V(
      (CROWN.a * r + bulge) * Math.sin(phi),
      bandBottom + bandHeight * (1.0 - Math.cos(angle)) * 0.5 + bandHeight * across * 0.5,
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

/** Flared brim sweeping down to the forward visor peak */
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
    const g = 1.0 - Math.pow(1.0 - s, 2.2);
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
    n.lerp(slope.clone().negate(), 0.25).normalize();
    return { p, n, uv: [(i / uSegments) * 5, s * 2] };
  });
}

/** Rolled leather edge bead along the brim perimeter */
function buildBrimEdge(uSegments = 96, vSegments = 10) {
  const lip = (phi) => ({
    x: (SPEC.width / 2 - BRIM.bead) * Math.sin(phi),
    z: 0.1265 * Math.cos(phi) + 0.005 * Math.cos(2 * phi),
    y: BRIM.lipY(phi),
  });
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const l = lip(phi);
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

/** Raised felt panel seams running down crown flanks */
function buildSeam(phiCentre, segments = 40, around = 8, radius = 0.0022) {
  return buildGrid(segments, around, (i, j) => {
    const t = 0.02 + (i / (segments - 1)) * 0.93;
    const p = surface(t, phiCentre);
    const n = surfaceNormal(t, phiCentre);
    const aroundDir = V(Math.cos(phiCentre), 0, -Math.sin(phiCentre)).normalize();
    const angle = (j / around) * Math.PI * 2;
    const offset = n.clone().multiplyScalar(0.0008 + radius * Math.cos(angle));
    offset.addScaledVector(aroundDir, radius * Math.sin(angle));
    const pos = p.clone().add(offset);
    const dir = n.clone().multiplyScalar(Math.cos(angle)).addScaledVector(aroundDir, Math.sin(angle)).normalize();
    return { p: pos, n: dir, uv: [(i / (segments - 1)) * 6, j / around] };
  });
}

/** Brass Victorian chinstrap rosette / ear boss at temples */
function buildBrassRosetteBoss(phiCentre) {
  const t = 0.085;
  const p = surface(t, phiCentre);
  const n = surfaceNormal(t, phiCentre);
  const radius = 0.011;
  const group = new THREE.Group();

  // Multi-lobed rosette plate
  const baseGeom = new THREE.CylinderGeometry(radius, radius * 1.1, 0.0025, 20);
  const bossGeom = new THREE.SphereGeometry(radius * 0.65, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  m.setPosition(p.clone().addScaledVector(n, 0.001));

  baseGeom.applyMatrix4(m);
  m.setPosition(p.clone().addScaledVector(n, 0.0025));
  bossGeom.applyMatrix4(m);

  return { baseGeom, bossGeom };
}

/** Chinstrap resting along front brow welt */
function buildChinstrap(segments = 48) {
  const phiStart = -Math.PI / 2 + 0.15;
  const phiEnd = Math.PI / 2 - 0.15;
  const strapRadius = 0.0028;
  const strapHeight = 0.0065;

  return buildGrid(segments, 6, (i, j) => {
    const fraction = i / (segments - 1);
    const phi = phiStart + fraction * (phiEnd - phiStart);
    const t = 0.038 - Math.cos(phi) * 0.012;
    const p = surface(t, phi);
    const n = surfaceNormal(t, phi);
    const side = (j / 5 - 0.5) * strapHeight;
    const lift = 0.0035;

    const pos = p.clone().addScaledVector(n, lift);
    pos.y += side;

    return {
      p: pos,
      n: n,
      uv: [fraction * 4, j / 5],
    };
  });
}

/** Miniature brass chinstrap buckle in front center */
function buildChinstrapBuckle() {
  const t = 0.026;
  const p = surface(t, 0);
  const n = surfaceNormal(t, 0);
  const buckleGeom = new THREE.BoxGeometry(0.010, 0.008, 0.003);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  m.setPosition(p.clone().addScaledVector(n, 0.0055));
  buckleGeom.applyMatrix4(m);
  return buckleGeom;
}

/** Raised Victorian circular garter surround ring */
function buildBadgeGarterRing(mapper, { radius, halfWidth, halfHeight, lift, uvScale, uSegments = 96, vSegments = 20 }) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const theta = (i / uSegments) * Math.PI * 2;
    const phi = (j / (vSegments - 1)) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const here = mapper(radius * c, radius * s);
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

/** Fluted Victorian summit rosette vent disc */
function buildSummitRosetteVent(crestMapper, outerR = 0.019, lobes = 8) {
  const shape = new THREE.Shape();
  const segments = lobes * 8;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const flute = Math.cos(a * lobes) * 0.0028;
    const r = outerR + flute;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return conformedSolid(shape, crestMapper, {
    thickness: 0.0028,
    lift: 0.0006,
    uvScale: [6, 6],
  });
}

// ---------------------------------------------------------------------------
// Material Factory & GLB Assembly
// ---------------------------------------------------------------------------
function buildMaterials() {
  const crownColour = buildCrownTextures(TEX_SIZE.crownColour).colour;
  const crownNormal = buildCrownTextures(TEX_SIZE.crownNormal).normal;
  const brim = buildBrimTextures(TEX_SIZE.brim);

  const badgeOuter = 0.043;
  const badgeInner = 0.021;
  const medallionOuter = badgeInner * 0.85;

  const brassTexture = buildBrassTextures(badgeOuter, medallionOuter / badgeOuter, TEX_SIZE.brass, 1.0);
  const brassMedallionTexture = buildBrassTextures(badgeOuter, medallionOuter / badgeOuter, TEX_SIZE.brass, 1.25);

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
    name: "M_NavyFeltCloth",
    map: crownMap,
    normalMap: crownNormalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.88,
    metalness: 0.0,
  });

  const lining = new THREE.MeshStandardMaterial({
    name: "M_FeltLiningInner",
    color: new THREE.Color(0x111318),
    roughness: 0.94,
    metalness: 0.0,
  });

  const leather = new THREE.MeshStandardMaterial({
    name: "M_BurnishedBlackLeather",
    map: brimMap,
    normalMap: brimNormalMap,
    normalScale: new THREE.Vector2(1.3, 1.3),
    roughness: 0.46,
    metalness: 0.04,
  });

  const welt = new THREE.MeshStandardMaterial({
    name: "M_BrowWeltLeather",
    map: brimMap,
    normalMap: brimNormalMap,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughness: 0.52,
    metalness: 0.03,
  });

  const brass = new THREE.MeshStandardMaterial({
    name: "M_AntiqueBrunswickBrass",
    map: brassMap,
    normalMap: brassNormalMap,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughness: 0.32,
    metalness: 0.90,
  });

  const brassMedallion = new THREE.MeshStandardMaterial({
    name: "M_GildedBrassMedallion",
    map: brassMedallionMap,
    normalMap: brassNormalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.26,
    metalness: 0.92,
  });

  const brassPlain = new THREE.MeshStandardMaterial({
    name: "M_PolishedBrassHardware",
    color: new THREE.Color(0xdcc06d),
    roughness: 0.24,
    metalness: 0.92,
  });

  return { felt, lining, leather, welt, brass, brassMedallion, brassPlain };
}

function main() {
  console.log("===============================================================");
  console.log("Antigravity 3D Synthesis: Constable Winch Victorian Bobby Helmet");
  console.log("===============================================================");

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

  // 1. Crown felt shell & interior
  add("Crown_Shell_Navy_Felt", buildCrownShell(), materials.felt);
  add("Crown_Inner_Lining", buildCrownLining(), materials.lining);
  add("Crown_Opening_Rim", buildCrownRim(), materials.lining);

  // 2. Rolled leather welt & flared brim
  add("Rolled_Leather_Welt_Band", buildWelt(), materials.welt);
  add("Brim_Flared_Leather", buildBrim(), materials.leather);
  add("Brim_Rolled_Edge", buildBrimEdge(), materials.leather);

  // 3. Chinstrap & brass buckle
  add("Chinstrap_Leather_Band", buildChinstrap(), materials.leather);
  add("Chinstrap_Brass_Buckle", buildChinstrapBuckle(), materials.brassPlain);

  // 4. Longitudinal crown seams
  const seamAngle = (75 * Math.PI) / 180;
  add("Crown_Seam_Left", buildSeam(seamAngle), materials.felt);
  add("Crown_Seam_Right", buildSeam(-seamAngle), materials.felt);

  // 5. Brass ear boss rosettes at temples
  for (const [name, phi] of [["Ear_Rosette_Left", Math.PI / 2], ["Ear_Rosette_Right", -Math.PI / 2]]) {
    const { baseGeom, bossGeom } = buildBrassRosetteBoss(phi);
    add(`${name}_Base`, baseGeom, materials.brass);
    add(`${name}_Stud`, bossGeom, materials.brassPlain);
  }

  // 6. Multi-layer 16-point Radiant Brunswick Star Badge
  const badgeOuter = 0.043;
  const badgeMid = 0.033;
  const badgeInner = 0.021;
  const badgeT = 0.521;
  const badgeMapper = (u, v) => domeFromLocal(badgeT, 0, u, v);

  // Radiant 16-point Brunswick star plate
  add(
    "Brunswick_Star_Badge_Plate",
    conformedSolid(brunswickStarShape(badgeOuter, badgeMid, badgeInner), badgeMapper, {
      thickness: 0.0024,
      lift: 0.0004,
      uvScale: [0.5 / badgeOuter, 0.5 / badgeOuter],
    }),
    materials.brass,
  );

  // Raised circular garter belt / ring
  add(
    "Brunswick_Star_Garter_Ring",
    buildBadgeGarterRing(badgeMapper, {
      radius: badgeInner * 0.72,
      halfWidth: badgeInner * 0.18,
      halfHeight: 0.0014,
      lift: 0.0022,
      uvScale: 0.5 / badgeOuter,
    }),
    materials.brassMedallion,
  );

  // Inner faceted 5-point star medallion
  add(
    "Brunswick_Star_Faceted_Medallion",
    conformedSolid(starShape(5, badgeInner * 0.50, badgeInner * 0.22), badgeMapper, {
      thickness: 0.0042,
      lift: 0.0029,
      uvScale: [0.5 / badgeOuter, 0.5 / badgeOuter],
    }),
    materials.brassMedallion,
  );

  // 7. Fluted summit rosette vent disc & crest fitting
  const crestAnchor = 0.028;
  const crestT = tFromArc(crestAnchor);
  const crestMapper = (u, v) => domeFromLocal(crestT, 0, u, v);

  add("Summit_Rosette_Vent_Disc", buildSummitRosetteVent(crestMapper, 0.018, 8), materials.brass);

  // 8. Summit brass finial button and retaining studs
  const apex = surface(1.0, 0);
  const apexNormal = surfaceNormal(1.0, 0);
  const buttonRadius = 0.0085;
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
  add("Summit_Brass_Finial_Button", button, materials.brassPlain);

  for (const [name, side] of [["Summit_Brass_Stud_Front", 1], ["Summit_Brass_Stud_Back", -1]]) {
    const spot = domeFromLocal(crestT, 0, 0, side * 0.011);
    const stud = new THREE.SphereGeometry(0.0036, 12, 7);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), spot.n);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    m.setPosition(spot.p.clone().addScaledVector(spot.n, 0.0024));
    stud.applyMatrix4(m);
    add(name, stud, materials.brassPlain);
  }

  // -------------------------------------------------------------------------
  // Precise Framing Calibration
  // -------------------------------------------------------------------------
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const currentHeight = box.max.y - box.min.y;
  const correction = SPEC.height / currentHeight;

  root.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, pos.getY(i) * correction);
    }
    child.geometry.computeVertexNormals();
    child.geometry.computeBoundingBox();
    child.geometry.computeBoundingSphere();
  });

  root.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(root);
  let triCount = 0;
  root.traverse((child) => {
    if (child.isMesh && child.geometry?.index) {
      triCount += child.geometry.index.count / 3;
    }
  });

  console.log(`Measured Geometry:`);
  console.log(`  Triangles: ${triCount.toLocaleString()} / ${SPEC.triangles.toLocaleString()}`);
  console.log(`  Width:     ${((finalBox.max.x - finalBox.min.x) * 100).toFixed(2)} cm (spec: ${(SPEC.width * 100).toFixed(1)} cm)`);
  console.log(`  Height:    ${((finalBox.max.y - finalBox.min.y) * 100).toFixed(2)} cm (spec: ${(SPEC.height * 100).toFixed(1)} cm)`);
  console.log(`  Depth:     ${((finalBox.max.z - finalBox.min.z) * 100).toFixed(2)} cm (spec: ${(SPEC.depth * 100).toFixed(1)} cm)`);
  console.log(`  BBox Min:  [${(finalBox.min.x * 100).toFixed(1)}, ${(finalBox.min.y * 100).toFixed(1)}, ${(finalBox.min.z * 100).toFixed(1)}] cm`);
  console.log(`  BBox Max:  [${(finalBox.max.x * 100).toFixed(1)}, ${(finalBox.max.y * 100).toFixed(1)}, ${(finalBox.max.z * 100).toFixed(1)}] cm`);

  // -------------------------------------------------------------------------
  // Export binary .glb
  // -------------------------------------------------------------------------
  console.log(`\nExporting binary GLB to ${OUT}...`);
  const exporter = new GLTFExporter();
  exporter.parse(
    root,
    (buffer) => {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, Buffer.from(buffer));
      const bytes = fs.statSync(OUT).size;
      const mb = (bytes / (1024 * 1024)).toFixed(3);
      console.log(`Successfully written ${bytes.toLocaleString()} bytes (${mb} MB)`);
      if (bytes > SPEC.bytes) {
        console.error(`ERROR: File size exceeds budget: ${bytes} > ${SPEC.bytes}`);
        process.exit(1);
      }
      console.log("Antigravity 3D synthesis complete!");
    },
    (err) => {
      console.error("Export failed:", err);
      process.exit(1);
    },
    { binary: true, embedImages: true },
  );
}

main();
