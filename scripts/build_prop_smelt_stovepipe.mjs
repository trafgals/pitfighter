#!/usr/bin/env node
// Build Mr. Hezekiah Smelt's stovepipe hat as a binary .glb.
//
//   node scripts/build_prop_smelt_stovepipe.mjs
//
// Matches Option A (1:1 with MiniMax H3 4-view turnaround and turntable):
// - Pure monolithic elongated Victorian silk stovepipe top hat
// - Solid closed silk crown summit cap (no protruding iron chimney)
// - Full 44.6 cm elongated crown height
// - Authentic Victorian dandy lateral brim welt roll
// - Rich, wide, ornate embossed gold filigree band with beaded trim
//
// FRAME (Head-Socket Normalized)
//   Origin (0,0,0) sits on the base opening plane (crown head-entry rim, y=0)
//   centred on the hat's axis; +Y is up, +Z is forward.
//   The brim hangs 2.6 cm below the origin (y = -0.026), and the crown summit
//   reaches 42.0 cm above it, giving total height 44.6 cm.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { installCanvasShim, encodePng } from "./lib/canvas_shim.mjs";
import { inspectGlb } from "./lib/glb_inspect.mjs";
import { makeFbm, heightToNormalSized, buildGrid, makeDataTexture } from "./lib/prop_geometry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_ID = "prop_smelt_stovepipe";
const OUT = path.join(ROOT, "public/models/props", `${ASSET_ID}.glb`);

const SPEC = {
  width: 0.277, // X, brim edge to brim edge
  height: 0.446, // Y, lowest brim point to crown summit
  depth: 0.277, // Z, brim front to brim back
  triangles: 35000,
  bytes: 1.5 * 1024 * 1024,
};

// Crown proportions from H3 4-view turnaround
const CROWN = {
  baseR: 0.0818, // head-entry rim radius (~16.4 cm diameter)
  topR: 0.1105, // flared summit rim radius (~22.1 cm diameter)
  topY: 0.4166, // summit cap height (0.4201 - (-0.0259) = 0.4460 m total height)
  shell: 0.006, // silk felt wall thickness
  flare: 2.1, // gradual trumpet flare towards summit
};

// Brim with authentic 19th-century dandy curvature
const BRIM = {
  bead: 0.0045, // rolled pencil welt radius along lip
  attachR: 0.0818,
  attachY: 0.0,
  lipR: 0.134, // (0.134 + 0.0045) * 2 = 0.277 m total width/depth
  // Height profile along azimuth phi:
  // Front (phi = 0) sweeps down to -0.0214 m (-0.0259 m at bottom of bead)
  // Sides (phi = +/- pi/2) curl UP to +0.0011 m (curls up 2.2 cm relative to front)
  // Back (phi = pi) dips down to -0.0124 m
  lipY: (phi) => {
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    return -0.0169 + 0.018 * (sin * sin) - 0.0045 * cos;
  },
};

// Wide, prominent gold filigree band matching H3
const BAND = {
  bottom: 0.0035, // just above brim root
  top: 0.0855, // 8.2 cm tall (~20% of crown height)
  offset: 0.0012, // flush relief ribbon
  repeats: 6, // 6 symmetrical motif tiles around perimeter
};

const TEX_SIZE = {
  silk: 256,
  goldWidth: 512,
  goldHeight: 512,
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Crown geometry maths
// ---------------------------------------------------------------------------

function crownR(t) {
  const x = clamp(t, 0, 1);
  return CROWN.baseR + (CROWN.topR - CROWN.baseR) * Math.pow(x, CROWN.flare);
}

function crownY(t) {
  return clamp(t, 0, 1) * CROWN.topY;
}

function crownPoint(t, phi) {
  const r = crownR(t);
  return V(r * Math.sin(phi), crownY(t), r * Math.cos(phi));
}

function crownInner(t, phi) {
  const r = Math.max(crownR(t) - CROWN.shell, 0.001);
  return V(r * Math.sin(phi), crownY(t), r * Math.cos(phi));
}

function crownNormal(t, phi) {
  const dt = 1e-4;
  const dp = 1e-4;
  const p = crownPoint(t, phi);
  const du = crownPoint(Math.min(1, t + dt), phi).sub(p);
  if (du.lengthSq() < 1e-18) du.copy(p).sub(crownPoint(Math.max(0, t - dt), phi));
  const dv = crownPoint(t, phi + dp).sub(p);
  const n = new THREE.Vector3().crossVectors(dv, du);
  if (!Number.isFinite(n.x) || n.lengthSq() < 1e-20) return V(0, 1, 0);
  n.normalize();
  const axis = V(0, p.y, 0);
  const before = p.clone().sub(axis).length();
  const after = p.clone().addScaledVector(n, 0.001).sub(axis).length();
  if (after < before) n.negate();
  return n;
}

// ---------------------------------------------------------------------------
// Brim geometry maths
// ---------------------------------------------------------------------------

function brimLip(phi) {
  return {
    x: BRIM.lipR * Math.sin(phi),
    y: BRIM.lipY(phi),
    z: BRIM.lipR * Math.cos(phi),
  };
}

function brimPoint(phi, s) {
  const lip = brimLip(phi);
  const rootR = CROWN.baseR;
  const rootY = BRIM.attachY;
  const t = Math.pow(clamp(s, 0, 1), 0.85);
  const r = rootR + (BRIM.lipR - rootR) * t;
  const y = rootY + (lip.y - rootY) * Math.pow(clamp(s, 0, 1), 1.25);
  return V(r * Math.sin(phi), y, r * Math.cos(phi));
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function buildSilkTextures(size = TEX_SIZE.silk) {
  const heights = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);
  const fbm = makeFbm(0x5e17, [32, 64, 128]);
  const fine = makeFbm(0x2b8c, [128, 256]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const weave = Math.sin(u * Math.PI * 128) * Math.sin(v * Math.PI * 128);
      const m = fbm(u, v);
      const f = fine(u, v);
      const h = clamp(0.5 + weave * 0.12 + (m - 0.5) * 0.1 + (f - 0.5) * 0.05, 0, 1);
      heights[y * size + x] = h;

      const idx = (y * size + x) * 4;
      // Authentic Victorian black silk: deep neutral charcoal-black with soft sheen
      const c = Math.round(24 + (h - 0.5) * 8 + (m - 0.5) * 4);
      colour[idx] = clamp(c, 0, 255);
      colour[idx + 1] = clamp(c, 0, 255);
      colour[idx + 2] = clamp(c, 0, 255);
      colour[idx + 3] = 255;
    }
  }

  return {
    colour,
    normal: heightToNormalSized(heights, size, size, 2.5),
  };
}

/**
 * Rich Victorian embossed gold filigree band.
 * Generates an ornate rinceaux pattern with curling acanthus scrolls,
 * central palmette rosette, and beaded border fillets that tiles seamlessly.
 */
function buildGoldTextures(width = TEX_SIZE.goldWidth, height = TEX_SIZE.goldHeight) {
  const heights = new Float32Array(width * height);
  const colour = new Uint8Array(width * height * 4);

  const mottle = makeFbm(0x6d21, [16, 32, 64]);
  const grain = makeFbm(0x4a90, [64, 128, 256]);

  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height; // 0 (bottom) to 1 (top)

    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width; // 0 to 1 horizontal repeat

      let h = 0.28; // recessed field height

      // 1. Top and bottom beaded borders
      const beadFreq = 24;
      const beadPhase = (u * beadFreq) % 1;
      const beadDistX = (beadPhase - 0.5) * 2;
      const beadDistY1 = (v - 0.07) / 0.035;
      const beadDistY2 = (v - 0.93) / 0.035;
      const d1 = beadDistX * beadDistX + beadDistY1 * beadDistY1;
      const d2 = beadDistX * beadDistX + beadDistY2 * beadDistY2;
      if (d1 < 1.0) h += Math.cos(Math.sqrt(d1) * Math.PI * 0.5) * 0.45;
      if (d2 < 1.0) h += Math.cos(Math.sqrt(d2) * Math.PI * 0.5) * 0.45;

      // Outer framing fillets
      if (Math.abs(v - 0.025) < 0.012) h += 0.28;
      if (Math.abs(v - 0.975) < 0.012) h += 0.28;
      if (Math.abs(v - 0.115) < 0.008) h += 0.22;
      if (Math.abs(v - 0.885) < 0.008) h += 0.22;

      // 2. Central Victorian acanthus & rinceaux scrollwork
      if (v > 0.12 && v < 0.88) {
        const cv = (v - 0.5) / 0.36; // -1 to 1

        // Undulating main vine stem
        const stemY = Math.sin(u * Math.PI * 4) * 0.32;
        const stemDist = Math.abs(cv - stemY);
        if (stemDist < 0.10) {
          h += (1 - stemDist / 0.10) * 0.42;
        }

        // Rosettes & spiral flourishes at u = 0.25 and 0.75
        for (const cu of [0.25, 0.75]) {
          let du = u - cu;
          if (du > 0.5) du -= 1;
          if (du < -0.5) du += 1;
          const r = Math.sqrt((du * 3.2) * (du * 3.2) + cv * cv);
          const angle = Math.atan2(cv, du * 3.2);
          const spiralDist = Math.abs((angle + r * 5.5) % Math.PI - Math.PI * 0.5);
          if (r < 0.78 && spiralDist < 0.38) {
            h += Math.max(0, (1 - r / 0.78) * 0.38);
          }
          if (r < 0.22) {
            h += Math.cos((r / 0.22) * Math.PI * 0.5) * 0.45;
          }
        }

        // Acanthus leaf fronds
        const leafWave = Math.sin(u * Math.PI * 8 + cv * 2.2);
        if (leafWave > 0.35 && Math.abs(cv) > 0.25) {
          h += (leafWave - 0.35) * 0.32 * (1 - Math.abs(cv));
        }
      }

      // Micro-surface grain
      const g = grain(u * 8, v * 4);
      h += (g - 0.5) * 0.035;
      h = clamp(h, 0, 1);
      heights[py * width + px] = h;

      // Color mapping: warm antique gold with rich specular luster
      // Recess: [136, 100, 36] (antique brass/gold)
      // Body:   [226, 184, 62] (rich 18k polished gold)
      // Ridge:  [255, 238, 172] (gleaming specular highlight)
      const m = mottle(u * 4, v * 2);
      const tint = 1 + (m - 0.5) * 0.08;

      const t = h;
      const rBase = 136 + (226 - 136) * t;
      const gBase = 100 + (184 - 100) * t;
      const bBase = 36 + (62 - 36) * t;

      const high = Math.pow(Math.max(0, t - 0.55) / 0.45, 2);
      const rOut = clamp(Math.round((rBase + (255 - rBase) * high * 0.75) * tint), 0, 255);
      const gOut = clamp(Math.round((gBase + (238 - gBase) * high * 0.75) * tint), 0, 255);
      const bOut = clamp(Math.round((bBase + (172 - bBase) * high * 0.75) * tint), 0, 255);

      const idx = (py * width + px) * 4;
      colour[idx] = rOut;
      colour[idx + 1] = gOut;
      colour[idx + 2] = bOut;
      colour[idx + 3] = 255;
    }
  }

  return {
    colour,
    normal: heightToNormalSized(heights, width, height, 4.5),
  };
}

// ---------------------------------------------------------------------------
// Mesh builders
// ---------------------------------------------------------------------------

/** The crown outer shell: tall elongated black silk trumpet. */
function buildCrownShell(uSegments = 72, vSegments = 36) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const t = j / (vSegments - 1);
    return {
      p: crownPoint(t, phi),
      n: crownNormal(t, phi),
      uv: [(i / uSegments) * 6, t * 3.5],
    };
  });
}

/** The crown summit top cap: solid closed silk lid. */
function buildCrownTopCap(rings = 16, segments = 72) {
  const rc = CROWN.topR;
  return buildGrid(segments, rings, (i, j) => {
    const phi = (i / segments) * Math.PI * 2;
    const rFrac = j / (rings - 1);
    const r = rc * rFrac;
    const dish = (1 - rFrac * rFrac) * -0.0025; // subtle 2.5mm dished depression
    const p = V(r * Math.sin(phi), CROWN.topY + dish, r * Math.cos(phi));
    const n = V(-rFrac * 0.02 * Math.sin(phi), 1, -rFrac * 0.02 * Math.cos(phi)).normalize();
    return { p, n, uv: [Math.sin(phi) * rFrac * 2, Math.cos(phi) * rFrac * 2] };
  });
}

/** Smooth rolled welt around the top summit rim. */
function buildCrownTopRoll(uSegments = 72, vSegments = 8) {
  const rc = CROWN.topR;
  const roll = 0.0035;
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const angle = (j / (vSegments - 1)) * Math.PI * 0.5;
    const r = rc + roll * Math.cos(angle);
    const p = V(r * Math.sin(phi), CROWN.topY + roll * Math.sin(angle), r * Math.cos(phi));
    const n = V(Math.cos(angle) * Math.sin(phi), Math.sin(angle), Math.cos(angle) * Math.cos(phi)).normalize();
    return { p, n, uv: [(i / uSegments) * 6, j / (vSegments - 1)] };
  });
}

/** Head-entry opening rim on y = 0. */
function buildCrownOpeningRim(uSegments = 72) {
  return buildGrid(uSegments, 2, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const r = j === 0 ? CROWN.baseR : CROWN.baseR - CROWN.shell;
    const p = V(r * Math.sin(phi), 0, r * Math.cos(phi));
    return { p, n: V(0, -1, 0), uv: [(i / uSegments) * 6, j] };
  });
}

/** Inside lining of the head cavity. */
function buildCrownInnerLining(uSegments = 72, vSegments = 16) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const t = j / (vSegments - 1);
    return {
      p: crownInner(t * 0.35, phi), // lines lower cavity
      n: crownNormal(t * 0.35, phi).negate(),
      uv: [(i / uSegments) * 4, t],
    };
  });
}

/** The swept brim with lateral dandy curls. */
function buildBrim(uSegments = 96, vSegments = 14) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const s = j / (vSegments - 1);
    const p = brimPoint(phi, s);
    const before = brimPoint(phi, Math.max(0, s - 0.02));
    const after = brimPoint(phi, Math.min(1, s + 0.02));
    const along = after.sub(before);
    const across = brimPoint(phi + 0.02, s).sub(brimPoint(phi - 0.02, s));
    const n = new THREE.Vector3().crossVectors(along, across).normalize();
    if (n.y < 0) n.negate();
    return { p, n, uv: [(i / uSegments) * 4, s * 1.5] };
  });
}

/** Rolled pencil welt edge along the brim lip. */
function buildBrimEdge(uSegments = 96, vSegments = 8) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const l = brimLip(phi);
    const ahead = brimLip(phi + 0.01);
    const behind = brimLip(phi - 0.01);
    const axis = V(ahead.x - behind.x, ahead.y - behind.y, ahead.z - behind.z).normalize();
    const radial = V(Math.sin(phi), 0, Math.cos(phi)).normalize();
    const up = new THREE.Vector3().crossVectors(radial, axis).normalize();
    if (up.y < 0) up.negate();
    const angle = (j / (vSegments - 1)) * Math.PI * 2;
    const p = V(l.x, l.y, l.z)
      .addScaledVector(radial, BRIM.bead * Math.cos(angle))
      .addScaledVector(up, BRIM.bead * Math.sin(angle));
    const n = radial.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle)).normalize();
    return { p, n, uv: [(i / uSegments) * 8, j / (vSegments - 1)] };
  });
}

/** Wide ornate gold filigree band hugging the crown. */
function buildBand(uSegments = 72, vSegments = 8) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const v = j / (vSegments - 1);
    const y = BAND.bottom + (BAND.top - BAND.bottom) * v;
    const t = y / CROWN.topY;
    const r = crownR(t) + BAND.offset;
    const p = V(r * Math.sin(phi), y, r * Math.cos(phi));
    const n = crownNormal(t, phi);
    return { p, n, uv: [(i / uSegments) * BAND.repeats, v] };
  });
}

// ---------------------------------------------------------------------------
// Main assembly
// ---------------------------------------------------------------------------

function makeMaterials() {
  const silk = buildSilkTextures();
  const silkMap = makeDataTexture(silk.colour, TEX_SIZE.silk, TEX_SIZE.silk, true);
  const silkNormalMap = makeDataTexture(silk.normal, TEX_SIZE.silk, TEX_SIZE.silk, false);

  const gold = buildGoldTextures();
  const goldMap = makeDataTexture(gold.colour, TEX_SIZE.goldWidth, TEX_SIZE.goldHeight, true);
  const goldNormalMap = makeDataTexture(gold.normal, TEX_SIZE.goldWidth, TEX_SIZE.goldHeight, false);

  const silkMaterial = new THREE.MeshStandardMaterial({
    name: "Silk_Black_Crown",
    map: silkMap,
    normalMap: silkNormalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.58,
    metalness: 0.02,
  });

  const lining = new THREE.MeshStandardMaterial({
    name: "Silk_Inner_Lining",
    color: 0x18181a,
    roughness: 0.85,
    metalness: 0.0,
  });

  const brimMaterial = new THREE.MeshStandardMaterial({
    name: "Silk_Black_Brim",
    map: silkMap,
    normalMap: silkNormalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.60,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  const goldMaterial = new THREE.MeshStandardMaterial({
    name: "Gold_Filigree_Band",
    map: goldMap,
    normalMap: goldNormalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.28,
    metalness: 0.82,
  });

  return { silkMaterial, lining, brimMaterial, goldMaterial };
}

function buildModel() {
  const root = new THREE.Group();
  root.name = "Root";

  const materials = makeMaterials();
  const add = (name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  };

  add("Crown_Shell_Black_Silk", buildCrownShell(), materials.silkMaterial);
  add("Crown_Top_Cap", buildCrownTopCap(), materials.silkMaterial);
  add("Crown_Top_Rolled_Rim", buildCrownTopRoll(), materials.silkMaterial);
  add("Crown_Opening_Rim", buildCrownOpeningRim(), materials.lining);
  add("Crown_Inner_Lining", buildCrownInnerLining(), materials.lining);
  add("Brim_Swept_Silk", buildBrim(), materials.brimMaterial);
  add("Brim_Rolled_Edge", buildBrimEdge(), materials.brimMaterial);
  add("Band_Gold_Filigree", buildBand(), materials.goldMaterial);

  return root;
}

async function exportGlb(scene) {
  installCanvasShim();
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (gltf) => resolve(Buffer.from(gltf)),
      (error) => reject(error),
      { binary: true, embedImages: true },
    );
  });
}

async function main() {
  console.log(`Building ${ASSET_ID} (Option A: 1:1 with H3 turnaround)...`);
  const scene = buildModel();
  const buffer = await exportGlb(scene);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buffer);
  console.log(`Wrote ${OUT} (${buffer.length} bytes)`);

  const report = inspectGlb(OUT);
  console.log(`  triangles: ${report.triangles}`);
  console.log(`  bytes:     ${report.bytes}`);
  console.log(`  bounds:    ${report.bbox.size.map((v) => (v * 100).toFixed(2)).join(" x ")} cm`);
  console.log(`  y range:   ${(report.bbox.min[1] * 100).toFixed(2)} to ${(report.bbox.max[1] * 100).toFixed(2)} cm`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
