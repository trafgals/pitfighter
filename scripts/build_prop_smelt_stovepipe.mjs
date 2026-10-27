#!/usr/bin/env node
// Build Mr. Hezekiah Smelt's stovepipe hat as a binary .glb.
//
//   node scripts/build_prop_smelt_stovepipe.mjs
//
// The asset is authored, not reconstructed: the approved Gate 1 alpha cutout
// and the approved Gate 2 four-view turnaround are the design, and every
// surface here is generated from measurements taken off them.
//
// FRAME (the whole point of the file)
//   Head-Socket Normalized: the origin sits on the base opening plane - the
//   crown's head-entry rim, which is where the fighter's head goes into the
//   hat - centred on the hat's axis; +Y is up and +Z is forward, so the brim's
//   front droop faces the fighter's front. Units are metres, so the
//   manifest's centimetres read as 0.277 / 0.446 / 0.277.
//
//   The brim hangs 2.6 cm below the origin, the way a stovepipe's does, and
//   that is the asset's lowest point and therefore its socket contact plane.
//   The chimney's crown reaches 42 cm above it, so the whole prop is 44.6 cm
//   tall: the "~45 cm with chimney stack" the issue's pivot spec asks for.
//
// WHAT THE REFERENCES GAVE US
//   Measurements were taken off the Gate 1 alpha cutout (1024 x 1024) and the
//   Gate 2 four-view sheet (3072 x 768, 768 x 768 per view), and the two
//   agree with each other:
//     - the crown is a trumpet: it flares towards the top, its rim radius
//       being about 1.29 times its base radius
//     - the crown is about 1.23 times as tall as its top diameter
//     - the brim's outer radius is about 1.25 times the crown's rim radius
//     - the gold band is a shade under a fifth of the crown's height and sits
//       on the base of the crown
//   - the crown is open at the top, which is where the chimney comes through
//   - the brim is wide, sweeps down and out, and ends in a rolled edge
//   - the band carries a repeating acanthus scroll with beaded trim
//
//   Colours are sampled from the references: a neutral near-black silk
//   (28, 27, 27) and a rich gold (146, 117, 82) with dark patina in the
//   hollows of the scrollwork.
//
// THE CHIMNEY
//   The issue's lore says the chimney "rises through the crown of his
//   stovepipe hat" and its pivot spec asks for "~45 cm total height with
//   chimney stack", so the stack is part of this asset. It is modelled on the
//   character art: a riveted cast-iron flue with collar bands and a flared,
//   ember-lit mouth.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { installCanvasShim, encodePng } from "./lib/canvas_shim.mjs";
import { inspectGlb } from "./lib/glb_inspect.mjs";
import { makeFbm, heightToNormal, heightToNormalSized, buildGrid, makeDataTexture } from "./lib/prop_geometry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_ID = "prop_smelt_stovepipe";
const OUT = path.join(ROOT, "public/models/props", `${ASSET_ID}.glb`);

// ---------------------------------------------------------------------------
// The spec, straight out of issue #37 and data/asset_manifest.json.
// ---------------------------------------------------------------------------
const SPEC = {
  width: 0.277, // X, brim edge to brim edge
  height: 0.446, // Y, the brim's lowest point to the chimney's mouth
  depth: 0.277, // Z, brim front to brim back
  triangles: 35000, // hard ceiling
  bytes: 1.5 * 1024 * 1024, // hard ceiling
};

// The crown: a trumpet that flares towards its open top.
//
// The head-entry rim is the base opening the spec names and it sits on
// y = 0, which is where the origin is. The brim hangs below it, so the
// asset's lowest point is the brim's rolled lip at y = -0.026.
const CROWN = {
  baseR: 0.0818, // the head-entry rim's radius
  topR: 0.1105, // the open top's rim radius
  topY: 0.2718, // the top rim's height
  shell: 0.0085, // the silk's thickness
  flare: 2.2, // how late the crown flares: r(t) = baseR + (topR-baseR) t^flare
};

const BRIM = {
  bead: 0.0045, // the radius of the rolled edge along the lip
  attachR: 0.0818, // where the brim leaves the crown
  attachY: 0.0, // and at what height
  lipR: 0.134, // the lip's own radius; the roll adds the bead to it
  lipYFront: -0.0215, // the lip's height at the front
  drop: 0.006, // how much higher the lip sits at the back than at the front
  // The lip's height at a given azimuth: the front edge hangs lowest, the
  // sides are a little higher and the back is highest of all, so the brim
  // sweeps the way a worn stovepipe does and the front of the hat reads.
  lipY: (phi) => BRIM.lipYFront + BRIM.drop * (1 - Math.pow((1 + Math.cos(phi)) / 2, 1.5)),
};

const BAND = {
  bottom: 0.0035, // the gold band's lower edge
  top: 0.0476, // its upper edge
  offset: 0.0013, // how far the band stands proud of the silk
  beadR: 0.0018, // the beaded trim's radius
  repeats: 6, // how many scroll tiles go round the band
};

const CHIMNEY = {
  baseY: 0.2, // where the flue starts, inside the crown
  rBottom: 0.026,
  rTop: 0.0242,
  collarY: [0.312, 0.356], // the two riveted collar bands
  collarR: 0.0292,
  collarH: 0.014,
  mouthTop: 0.42, // the mouth's rim: the asset's highest point
  mouthR: 0.03,
  emberY: 0.406,
  emberR: 0.0244,
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Write a generated texture out as a PNG so it can be looked at.
 *
 * A texture that reads as a flat sheet on the model is very often a texture
 * that was generated wrong, and the fastest way to tell is to see it.
 */
function dumpTexture(name, data, width, height) {
  if (!process.env.PROP_DEBUG) return;
  const dir = path.join(ROOT, "test-output/textures");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.png`), encodePng(width, height, data));
  console.log(`  dumped ${name}.png (${width} x ${height})`);
}

// ---------------------------------------------------------------------------
// The crown's maths
// ---------------------------------------------------------------------------

/** The crown's radius at height parameter t (0 at the head-entry rim). */
function crownR(t) {
  const x = clamp(t, 0, 1);
  return CROWN.baseR + (CROWN.topR - CROWN.baseR) * Math.pow(x, CROWN.flare);
}

function crownY(t) {
  return clamp(t, 0, 1) * CROWN.topY;
}

/** A point on the crown's outer surface. */
function crownPoint(t, phi) {
  const r = crownR(t);
  return V(r * Math.sin(phi), crownY(t), r * Math.cos(phi));
}

/** The same point on the inside of the silk. */
function crownInner(t, phi) {
  const r = Math.max(crownR(t) - CROWN.shell, 0.0005);
  return V(r * Math.sin(phi), crownY(t), r * Math.cos(phi));
}

/** The outward normal of the crown, by finite differences. */
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
  // Pointing outward? Step along the normal and see whether that moves away
  // from the crown's axis.
  const axis = V(0, p.y, 0);
  const before = p.clone().sub(axis).length();
  const after = p.clone().addScaledVector(n, 0.001).sub(axis).length();
  if (after < before) n.negate();
  return n;
}

// ---------------------------------------------------------------------------
// The brim's maths
// ---------------------------------------------------------------------------

/** The lip: the circle the brim's rolled edge runs along. */
function brimLip(phi) {
  return {
    x: BRIM.lipR * Math.sin(phi),
    y: BRIM.lipY(phi),
    z: BRIM.lipR * Math.cos(phi),
  };
}

/** A point on the brim's top surface, s = 0 at the crown and 1 at the lip. */
function brimPoint(phi, s) {
  const lip = brimLip(phi);
  // Out fast, down slow: the brim runs nearly level out of the crown and
  // turns down sharply at the edge.
  const g = 1 - Math.pow(1 - s, 2.2);
  const h = Math.pow(s, 2.6);
  const r = BRIM.attachR + (BRIM.lipR - BRIM.attachR) * g;
  const y = BRIM.attachY + (lip.y - BRIM.attachY) * h;
  return V(r * Math.sin(phi), y, r * Math.cos(phi));
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

// The asset has a hard file-size budget and the normal maps are where the
// bytes go: a fine-grained normal map is nearly random noise and barely
// compresses. So the colour maps are made at the resolution the eye needs
// and the normal maps at half that, which still carries the grain because the
// grain is finer than a texel at either size.
const TEX_SIZE = { silk: 256, goldWidth: 512, goldHeight: 256, iron: 256 };

/** The crown's silk: a fine grain over soft vertical creases. */
function buildSilkTextures(size = TEX_SIZE.silk) {
  const grain = makeFbm(0x5a11, [32, 64, 128]);
  // The creases are anisotropic: the grid is coarse in v and fine in u, so
  // the silk wrinkles in long soft vertical folds. A square grid stretched
  // by scaling its coordinates would break the wrap and leave a seam
  // wherever the texture repeats.
  const crease = makeFbm(0x2c7f, [[72, 6], [144, 12]]);
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const g = grain(u, v);
      const c = crease(u, v);
      const fold = smoothstep(0.4, 0.82, c);
      const h = g * 0.72 + fold * 0.28;
      height[y * size + x] = h;

      // A neutral near-black, sampled off the references: the silk reads as
      // (28, 27, 27) in the light and (9, 8, 7) in the shadow.
      const shade = 1 + (g - 0.5) * 0.26 + fold * 0.16;
      const i = (y * size + x) * 4;
      colour[i] = clamp(Math.round(28 * shade), 0, 255);
      colour[i + 1] = clamp(Math.round(28 * shade), 0, 255);
      colour[i + 2] = clamp(Math.round(30 * shade), 0, 255);
      colour[i + 3] = 255;
    }
  }
  return { colour, normal: heightToNormal(height, size, 1.5) };
}

/** The brim: the same silk, worn smoother and a shade deeper. */
function buildBrimTextures(size = TEX_SIZE.silk) {
  const grain = makeFbm(0x71b3, [32, 64]);
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const g = grain(u, v);
      height[y * size + x] = g * 0.8;
      const shade = 1 + (g - 0.5) * 0.22;
      const i = (y * size + x) * 4;
      colour[i] = clamp(Math.round(23 * shade), 0, 255);
      colour[i + 1] = clamp(Math.round(22 * shade), 0, 255);
      colour[i + 2] = clamp(Math.round(24 * shade), 0, 255);
      colour[i + 3] = 255;
    }
  }
  return { colour, normal: heightToNormal(height, size, 1.8) };
}

/** The chimney's cast iron: dark, pitted, with a soot-black grain. */
function buildIronTextures(size = TEX_SIZE.iron) {
  const mottle = makeFbm(0x3f81, [16, 32, 64]);
  const pit = makeFbm(0x9d02, [64, 128]);
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const m = mottle(u, v);
      const p = pit(u, v);
      // The pits are the deep ones: a ridged noise turns the soft fbm into
      // little craters in the casting.
      const crater = Math.pow(1 - Math.abs(p * 2 - 1), 7);
      const h = m * 0.7 - crater * 0.6;
      height[y * size + x] = h;

      const shade = 1 + (m - 0.5) * 0.45 - crater * 0.25;
      const i = (y * size + x) * 4;
      colour[i] = clamp(Math.round(48 * shade), 0, 255);
      colour[i + 1] = clamp(Math.round(50 * shade), 0, 255);
      colour[i + 2] = clamp(Math.round(56 * shade), 0, 255);
      colour[i + 3] = 255;
    }
  }
  return { colour, normal: heightToNormal(height, size, 2.6) };
}

/**
 * The band's filigree.
 *
 * The reference shows a repeating acanthus scroll: a big central scroll with
 * a spiral eye, smaller scrolls either side of it, and a beaded trim along
 * the band's edges. The scrollwork is drawn here as a height field - each
 * scroll is a logarithmic spiral, and a pixel stands proud where it lies
 * close to one - so the same field drives the colour map (patina down in the
 * hollows, polished metal along the ridges) and the normal map (the relief).
 *
 * The tile is drawn in an aspect-corrected space: the band is about 8.6 cm
 * round to a tile and 4.4 cm tall, so the motif is nearly twice as wide as
 * it is high and the texture is stored at that shape rather than squared up.
 */
function buildGoldTextures(width = TEX_SIZE.goldWidth, height = TEX_SIZE.goldHeight) {
  const ASPECT = 1.95;
  const mottle = makeFbm(0x6d21, [16, 32, 64]);
  const grain = makeFbm(0x4a90, [64, 128]);
  const grainAt = (px, py) => grain((px + 0.5) / width, (py + 0.5) / height);

  // The scrolls: a centre, where the spiral starts, where it ends and how
  // many turns it makes. The growth rate is derived from those rather than
  // given directly: a logarithmic spiral's rate compounds every turn, and a
  // rate that looks reasonable per radian sends the curve off the tile
  // after a single turn - which is how the scrollwork ends up as a flat
  // sheet with one stray dot on it.
  const scrolls = [
    { cx: 0.98, cy: 0.5, r0: 0.05, rEnd: 0.3, turns: 1.15, dir: 1 },
    { cx: 0.3, cy: 0.4, r0: 0.04, rEnd: 0.22, turns: 1.0, dir: 1 },
    { cx: 1.66, cy: 0.6, r0: 0.04, rEnd: 0.22, turns: 1.0, dir: -1 },
    { cx: 0.62, cy: 0.64, r0: 0.03, rEnd: 0.15, turns: 0.85, dir: -1 },
    { cx: 1.34, cy: 0.32, r0: 0.03, rEnd: 0.15, turns: 0.85, dir: 1 },
  ];

  // Sample each spiral once and keep the polyline.
  const lines = scrolls.map((scroll) => {
    const k = Math.log(scroll.rEnd / scroll.r0) / (Math.PI * 2 * scroll.turns);
    const points = [];
    const steps = 260;
    for (let i = 0; i <= steps; i++) {
      // The angle has to advance by a fraction of a turn per step. Stepping
      // by a whole turn samples the spiral at a handful of radii and leaves
      // the curve as a row of dots.
      const theta = scroll.dir * (i / steps) * Math.PI * 2 * scroll.turns;
      const r = scroll.r0 * Math.exp(k * Math.abs(theta));
      points.push([scroll.cx + r * Math.cos(theta), scroll.cy + r * Math.sin(theta)]);
    }
    return points;
  });

  const heights = new Float32Array(width * height);
  const colour = new Uint8Array(width * height * 4);
  const CORE = 0.035; // the scroll's full-depth core
  const EDGE = 0.048; // where the relief falls away into the ground

  for (let py = 0; py < height; py++) {
    const y = (py + 0.5) / height;
    for (let px = 0; px < width; px++) {
      const x = ((px + 0.5) / width) * ASPECT;

      // The nearest point on any of the scrolls.
      let best = Infinity;
      for (const line of lines) {
        for (const [lx, ly] of line) {
          const dx = x - lx;
          const dy = y - ly;
          const d = dx * dx + dy * dy;
          if (d < best) best = d;
        }
      }
      const dist = Math.sqrt(best);
      const relief = smoothstep(EDGE, CORE, dist);

      // The ground: the recessed field the scrollwork stands on.
      const grain = grainAt(px, py);
      let h = 0.12 + relief * 0.88 + (grain - 0.5) * 0.02;

      // A shallow groove runs the band just inside each edge, the way a
      // chased band is framed.
      const edge = Math.min(y, 1 - y);
      h -= smoothstep(0.075, 0.045, edge) * 0.22;

      heights[py * width + px] = clamp(h, 0, 1);

      // The colour: patina in the hollows, gold along the ridges, and a
      // polished highlight on the very top of the relief.
      const t = clamp((h - 0.12) / 0.88, 0, 1);
      const m = mottle(x / ASPECT, y);
      const patina = [56, 40, 18];
      const gold = [198, 160, 90];
      const shine = [244, 220, 166];
      const mix = smoothstep(0.08, 0.58, t);
      const tint = 1 + (m - 0.5) * 0.12;
      const i = (py * width + px) * 4;
      for (let c = 0; c < 3; c++) {
        const base = patina[c] + (gold[c] - patina[c]) * mix;
        const high = Math.pow(t, 4) * (shine[c] - base) * 0.65;
        colour[i + c] = clamp(Math.round((base + high) * tint), 0, 255);
      }
      colour[i + 3] = 255;
    }
  }

  // The fine grain is sampled once, so the colour and the relief agree.
  return {
    colour,
    normal: heightToNormalSized(heights, width, height, 4.4),
  };
}

// ---------------------------------------------------------------------------
// The parts of the hat
// ---------------------------------------------------------------------------

/** The crown's outer shell: black silk over a frame. */
function buildCrownShell(uSegments = 72, vSegments = 26) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const t = j / (vSegments - 1);
    return {
      p: crownPoint(t, phi),
      n: crownNormal(t, phi),
      uv: [(i / uSegments) * 6, t * 2.2],
    };
  });
}

/** The inside of the crown, seen through the open top. */
function buildCrownLining(uSegments = 72, vSegments = 10) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const t = j / (vSegments - 1);
    return {
      p: crownInner(t, phi),
      n: crownNormal(t, phi).negate(),
      uv: [(i / uSegments) * 4, t * 1.5],
    };
  });
}

/** The rolled silk over the top rim. */
function buildCrownTopRoll(uSegments = 72, vSegments = 8) {
  const rc = CROWN.topR - CROWN.shell / 2;
  const roll = CROWN.shell / 2;
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const angle = (j / (vSegments - 1)) * Math.PI;
    const r = rc + roll * Math.cos(angle);
    const p = V(r * Math.sin(phi), CROWN.topY + roll * Math.sin(angle), r * Math.cos(phi));
    const n = V(Math.cos(angle) * Math.sin(phi), Math.sin(angle), Math.cos(angle) * Math.cos(phi)).normalize();
    return { p, n, uv: [(i / uSegments) * 6, j / (vSegments - 1)] };
  });
}

/**
 * The annulus that closes the silk's thickness at the head-entry opening.
 * It lies on the origin's plane: this is the base opening, and it is where
 * the fighter's head goes into the hat.
 */
function buildCrownOpeningRim(uSegments = 72) {
  return buildGrid(uSegments, 2, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const r = j === 0 ? CROWN.baseR : CROWN.baseR - CROWN.shell;
    const p = V(r * Math.sin(phi), 0, r * Math.cos(phi));
    return { p, n: V(0, -1, 0), uv: [(i / uSegments) * 6, j] };
  });
}

/** The brim: it leaves the crown nearly level, then turns down to the edge. */
function buildBrim(uSegments = 96, vSegments = 12) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const s = j / (vSegments - 1);
    const p = brimPoint(phi, s);
    const before = brimPoint(phi, Math.max(0, s - 0.02));
    const after = brimPoint(phi, Math.min(1, s + 0.02));
    const along = after.sub(before);
    const across = brimPoint(phi + 0.02, s).sub(brimPoint(phi - 0.02, s));
    const n = new THREE.Vector3().crossVectors(along, across).normalize();
    // The brim's face points up and out; if the cross product came out
    // underneath, flip it.
    if (n.y < 0) n.negate();
    return { p, n, uv: [(i / uSegments) * 4, s * 1.2] };
  });
}

/** The rolled edge along the brim's lip. */
function buildBrimEdge(uSegments = 96, vSegments = 8) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const l = brimLip(phi);
    // The roll's axis runs along the lip; its cross-section is perpendicular
    // to that, in the plane of the brim's own surface, so the roll bulges out
    // and down rather than lying flat.
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

/** The gold band: a chased shell that hugs the crown's taper. */
function buildBand(uSegments = 72, vSegments = 6) {
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const v = j / (vSegments - 1);
    const y = BAND.bottom + (BAND.top - BAND.bottom) * v;
    const t = y / CROWN.topY;
    const r = crownR(t) + BAND.offset;
    const p = V(r * Math.sin(phi), y, r * Math.cos(phi));
    return {
      p,
      n: crownNormal(t, phi),
      uv: [(i / uSegments) * BAND.repeats, v],
    };
  });
}

/** A beaded trim running along one of the band's edges. */
function buildBandBead(atTop, uSegments = 72, vSegments = 8) {
  const y = atTop ? BAND.top : BAND.bottom;
  const t = y / CROWN.topY;
  const rc = crownR(t) + BAND.offset;
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const radial = V(Math.sin(phi), 0, Math.cos(phi));
    // The bead's cross-section is a half circle standing off the band's face.
    const angle = (j / (vSegments - 1)) * Math.PI;
    const p = V(radial.x * (rc + BAND.beadR * Math.cos(angle)), y + BAND.beadR * Math.sin(angle), radial.z * (rc + BAND.beadR * Math.cos(angle)));
    const n = V(radial.x * Math.cos(angle), Math.sin(angle), radial.z * Math.cos(angle)).normalize();
    return { p, n, uv: [(i / uSegments) * BAND.repeats * 3, j / (vSegments - 1)] };
  });
}

/**
 * The chimney: a riveted cast-iron flue with two collar bands and a flared
 * mouth. The profile is walked from the bottom up, and the mouth turns in and
 * down at the end so the ember inside it can be seen from above.
 */
function buildChimneyStack(uSegments = 48) {
  const profile = [
    [CHIMNEY.baseY, CHIMNEY.rBottom],
    [0.28, 0.0256],
    [CHIMNEY.collarY[0], 0.0253],
    [CHIMNEY.collarY[0] + 0.002, CHIMNEY.collarR],
    [CHIMNEY.collarY[0] + CHIMNEY.collarH - 0.002, CHIMNEY.collarR],
    [CHIMNEY.collarY[0] + CHIMNEY.collarH, 0.0251],
    [CHIMNEY.collarY[1], 0.0248],
    [CHIMNEY.collarY[1] + 0.002, CHIMNEY.collarR],
    [CHIMNEY.collarY[1] + CHIMNEY.collarH - 0.002, CHIMNEY.collarR],
    [CHIMNEY.collarY[1] + CHIMNEY.collarH, 0.0246],
    [0.392, 0.0244],
    [0.4, 0.0254],
    [0.41, 0.0264],
    [0.4165, 0.0262],
    [CHIMNEY.mouthTop, CHIMNEY.mouthR],
    [0.4185, 0.0246],
    [0.412, 0.0242],
    [0.406, 0.024],
  ];
  const vSegments = profile.length;
  return buildGrid(uSegments, vSegments, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const [y, r] = profile[j];
    const p = V(r * Math.sin(phi), y, r * Math.cos(phi));
    // The normal comes from the profile's own slope: the surface is walked
    // from the bottom up the outside, over the mouth's lip and back down the
    // inside, so the iron is on the same side of the curve all the way and
    // (dy * radial - dr * up) always points away from it. That is what makes
    // the collar bands catch the light on their edges and keeps the inside
    // of the mouth facing the axis instead of away from it.
    const [yPrev, rPrev] = profile[Math.max(0, j - 1)];
    const [yNext, rNext] = profile[Math.min(vSegments - 1, j + 1)];
    const dr = rNext - rPrev;
    const dy = yNext - yPrev;
    const length = Math.hypot(dr, dy) || 1;
    const n = V(
      (dy / length) * Math.sin(phi),
      -dr / length,
      (dy / length) * Math.cos(phi),
    ).normalize();
    return { p, n, uv: [(i / uSegments) * 3, (y - CHIMNEY.baseY) * 4] };
  });
}

/** The rivets around a collar band. */
function buildRivet(phi, y, radius) {
  const radial = V(Math.sin(phi), 0, Math.cos(phi));
  const p = radial.clone().multiplyScalar(CHIMNEY.collarR + radius * 0.55);
  p.y = y;
  const geometry = new THREE.SphereGeometry(radius, 8, 6);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), radial);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  m.setPosition(p);
  geometry.applyMatrix4(m);
  return geometry;
}

/** The fire in the chimney's belly, seen through the mouth. */
function buildEmber(uSegments = 24) {
  return buildGrid(uSegments, 2, (i, j) => {
    const phi = (i / uSegments) * Math.PI * 2;
    const r = j === 0 ? CHIMNEY.emberR : 0.0;
    const p = V(r * Math.sin(phi), CHIMNEY.emberY, r * Math.cos(phi));
    return { p, n: V(0, 1, 0), uv: [(i / uSegments) * 2, j] };
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function buildMaterials() {
  const silk = buildSilkTextures(TEX_SIZE.silk);
  const brim = buildBrimTextures(TEX_SIZE.silk);
  const iron = buildIronTextures(TEX_SIZE.iron);
  const gold = buildGoldTextures(TEX_SIZE.goldWidth, TEX_SIZE.goldHeight);
  dumpTexture("gold-colour", gold.colour, TEX_SIZE.goldWidth, TEX_SIZE.goldHeight);
  dumpTexture("gold-normal", gold.normal, TEX_SIZE.goldWidth, TEX_SIZE.goldHeight);

  const silkMap = makeDataTexture(silk.colour, TEX_SIZE.silk, TEX_SIZE.silk, true);
  const silkNormalMap = makeDataTexture(silk.normal, TEX_SIZE.silk, TEX_SIZE.silk, false);
  const brimMap = makeDataTexture(brim.colour, TEX_SIZE.silk, TEX_SIZE.silk, true);
  const brimNormalMap = makeDataTexture(brim.normal, TEX_SIZE.silk, TEX_SIZE.silk, false);
  const goldMap = makeDataTexture(gold.colour, TEX_SIZE.goldWidth, TEX_SIZE.goldHeight, true);
  const goldNormalMap = makeDataTexture(gold.normal, TEX_SIZE.goldWidth, TEX_SIZE.goldHeight, false);
  const ironMap = makeDataTexture(iron.colour, TEX_SIZE.iron, TEX_SIZE.iron, true);
  const ironNormalMap = makeDataTexture(iron.normal, TEX_SIZE.iron, TEX_SIZE.iron, false);

  const silkMaterial = new THREE.MeshStandardMaterial({
    name: "Silk_Black_Crown",
    map: silkMap,
    normalMap: silkNormalMap,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughness: 0.58,
    metalness: 0.02,
  });
  const lining = new THREE.MeshStandardMaterial({
    name: "Silk_Inner_Lining",
    color: 0x0c0c0e,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const brimMaterial = new THREE.MeshStandardMaterial({
    name: "Silk_Black_Brim",
    map: brimMap,
    normalMap: brimNormalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.62,
    metalness: 0.02,
    // The brim is a single sheet of silk with no separate underside, so it is
    // drawn from both sides: from below - the camera's own elevation is above
    // the brim's, but a fighter looking up sees this surface - a one-sided
    // material would leave a hole in the hat.
    side: THREE.DoubleSide,
  });
  const goldMaterial = new THREE.MeshStandardMaterial({
    name: "Gold_Filigree_Band",
    map: goldMap,
    normalMap: goldNormalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    // The capture studio has no environment map, so a fully metallic surface
    // has nothing to reflect and renders black. Gilt - gold over a base
    // metal - keeps enough diffuse in it to read as gold under the lamps.
    roughness: 0.3,
    metalness: 0.5,
  });
  const goldTrim = new THREE.MeshStandardMaterial({
    name: "Gold_Bead_Trim",
    color: 0xc9a659,
    roughness: 0.28,
    metalness: 0.5,
  });
  const ironMaterial = new THREE.MeshStandardMaterial({
    name: "Iron_Cast_Chimney",
    map: ironMap,
    normalMap: ironNormalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.52,
    metalness: 0.55,
  });
  const ironPlain = new THREE.MeshStandardMaterial({
    name: "Iron_Rivet",
    color: 0x3d4046,
    roughness: 0.42,
    metalness: 0.9,
  });
  const ember = new THREE.MeshStandardMaterial({
    name: "Ember_Glow",
    color: 0x2a1206,
    emissive: 0xff6a1e,
    emissiveIntensity: 2.4,
    roughness: 0.9,
    metalness: 0,
  });

  return { silkMaterial, lining, brimMaterial, goldMaterial, goldTrim, ironMaterial, ironPlain, ember };
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
  add("Crown_Shell_Black_Silk", buildCrownShell(), materials.silkMaterial);
  add("Crown_Inner_Lining", buildCrownLining(), materials.lining);
  add("Crown_Top_Rolled_Rim", buildCrownTopRoll(), materials.silkMaterial);
  add("Crown_Opening_Rim", buildCrownOpeningRim(), materials.lining);

  // -- the brim -------------------------------------------------------------
  add("Brim_Swept_Silk", buildBrim(), materials.brimMaterial);
  add("Brim_Rolled_Edge", buildBrimEdge(), materials.brimMaterial);

  // -- the gold band --------------------------------------------------------
  add("Band_Gold_Filigree", buildBand(), materials.goldMaterial);
  add("Band_Bead_Trim_Top", buildBandBead(true), materials.goldTrim);
  add("Band_Bead_Trim_Bottom", buildBandBead(false), materials.goldTrim);

  // -- the chimney ----------------------------------------------------------
  add("Chimney_Stack", buildChimneyStack(), materials.ironMaterial);
  for (const collarY of CHIMNEY.collarY) {
    for (let i = 0; i < 10; i++) {
      const phi = (i / 10) * Math.PI * 2 + 0.31;
      add(`Chimney_Rivet_${collarY.toFixed(3)}_${i}`, buildRivet(phi, collarY + CHIMNEY.collarH / 2, 0.0022), materials.ironPlain);
    }
  }
  add("Chimney_Ember_Glow", buildEmber(), materials.ember);

  // -- final framing -------------------------------------------------------
  // The base opening stays on y = 0 and the brim's lip is the lowest point,
  // so the asset's height is set by the chimney's mouth.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const min = box.min;
  const max = box.max;
  console.log(`  raw bbox cm      ${size.x * 100} x ${size.y * 100} x ${size.z * 100}`);
  console.log(`  raw bbox min cm  ${min.x * 100}, ${min.y * 100}, ${min.z * 100}`);
  console.log(`  raw bbox max cm  ${max.x * 100}, ${max.y * 100}, ${max.z * 100}`);

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
        resolve({ badNormals });
      },
      (error) => reject(error),
      { binary: true, onlyVisible: false },
    );
  });
}

main()
  .then(({ badNormals }) => {
    const report = inspectGlb(OUT);
    console.log(`wrote ${path.relative(ROOT, OUT)}`);
    console.log(`  triangles      ${report.triangles} (budget ${SPEC.triangles})`);
    console.log(`  bytes          ${report.bytes} (${(report.bytes / 1048576).toFixed(3)} MB, budget 1.5 MB)`);
    console.log(`  bbox cm        ${report.bbox.size.map((v) => (v * 100).toFixed(2)).join(" x ")}`);
    console.log(`  bbox min cm    ${report.bbox.min.map((v) => (v * 100).toFixed(2)).join(", ")}`);
    console.log(`  bbox max cm    ${report.bbox.max.map((v) => (v * 100).toFixed(2)).join(", ")}`);
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
