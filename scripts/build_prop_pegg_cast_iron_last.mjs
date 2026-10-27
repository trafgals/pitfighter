#!/usr/bin/env node
// Build Mistress Tabitha Pegg's Calibrated Cast-Iron Shoe Last as a binary .glb.
//
//   node scripts/build_prop_pegg_cast_iron_last.mjs
//
// Matches the approved FLUX 3 alpha cutout and MiniMax H3 4-view turnaround:
// - Heavy cast pig-iron cobbler's last with square-toed anvil and heel horn
// - Polished brass bootmaker's sizing rule plate with engraved calibrations
// - Knurled brass thumbscrew adjustment dial on instep and rear seam
// - Articulated blued steel leaf-spring suspension along the arch cavity
// - Cordovan leather-wrapped grip handle with brass collar and pommel
//
// FRAME (Grip-Normalized)
//   Origin (0,0,0) sits at the center of the handle grip.
//   +Y is up along the handle towards the heel horn.
//   +Z is forward along the foot axis towards the square toe anvil.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { installCanvasShim, encodePng } from "./lib/canvas_shim.mjs";
import { inspectGlb } from "./lib/glb_inspect.mjs";
import { makeFbm, heightToNormalSized, buildGrid, makeDataTexture } from "./lib/prop_geometry.mjs";

installCanvasShim();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_ID = "prop_pegg_cast_iron_last";
const OUT = path.join(ROOT, "public/models/props", `${ASSET_ID}.glb`);

// Target scale specifications: Width=14cm (X), Height=34cm (Y), Depth=12cm (Z)
const SPEC = {
  width: 0.14,  // X, cross-width of foot anvil / ball
  height: 0.34, // Y, handle pommel to top of heel horn
  depth: 0.12,  // Z, front-to-back profile thickness
  triangles: 30000,
  bytes: 1.5 * 1024 * 1024,
};

// ---------------------------------------------------------------------------
// Textures: Cast Iron Pitting & Engraved Brass Calibration Plate
// ---------------------------------------------------------------------------

function makeCastIronTextures() {
  const S = 512;
  const fbm = makeFbm(4406, [4, 8, 16, 32]);
  const diffuseBuf = new Uint8Array(S * S * 4);
  const bumpBuf = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const n = fbm(u, v);
      const i = y * S + x;
      bumpBuf[i] = n;

      // Dark charcoal pitted cold cast iron (base ~35, with variations)
      const c = Math.floor(30 + n * 25);
      const idx = i * 4;
      diffuseBuf[idx] = c;
      diffuseBuf[idx + 1] = c;
      diffuseBuf[idx + 2] = c + 2; // subtle cool cast-iron tint
      diffuseBuf[idx + 3] = 255;
    }
  }

  const normalBuf = heightToNormalSized(bumpBuf, S, S, 1.8);
  return {
    map: makeDataTexture(diffuseBuf, S, S, THREE.RGBAFormat, true),
    normalMap: makeDataTexture(normalBuf, S, S, THREE.RGBAFormat, false),
  };
}

function makeBrassRuleTextures() {
  const S = 512;
  const diffuseBuf = new Uint8Array(S * S * 4);
  const bumpBuf = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = y * S + x;
      const idx = i * 4;

      // Imperial rule calibration tick marks along U (every 1/16th, 1/8th, 1/4th)
      const tickCycle = (u * 32) % 1.0;
      const isTick = tickCycle < 0.12;
      const isMajor = ((u * 8) % 1.0) < 0.12;
      const inTickHeight = v < (isMajor ? 0.45 : 0.25);

      // Sizing dial circle in middle (u around 0.5, v around 0.7)
      const dx = (u - 0.5) * 2.0;
      const dy = (v - 0.7) * 2.0;
      const rDial = Math.sqrt(dx * dx + dy * dy);
      const isDialRing = Math.abs(rDial - 0.4) < 0.04 || Math.abs(rDial - 0.2) < 0.03;

      let relief = 0.5;
      let engraved = false;
      if ((isTick && inTickHeight) || isDialRing) {
        relief = 0.15; // recessed engraving
        engraved = true;
      }

      bumpBuf[i] = relief;

      if (engraved) {
        // Dark aged bronze patina in engraved grooves
        diffuseBuf[idx] = 75;
        diffuseBuf[idx + 1] = 55;
        diffuseBuf[idx + 2] = 25;
        diffuseBuf[idx + 3] = 255;
      } else {
        // Polished golden Victorian brass
        diffuseBuf[idx] = 220;
        diffuseBuf[idx + 1] = 185;
        diffuseBuf[idx + 2] = 95;
        diffuseBuf[idx + 3] = 255;
      }
    }
  }

  const normalBuf = heightToNormalSized(bumpBuf, S, S, 2.5);
  return {
    map: makeDataTexture(diffuseBuf, S, S, THREE.RGBAFormat, true),
    normalMap: makeDataTexture(normalBuf, S, S, THREE.RGBAFormat, false),
  };
}

function makeCordovanLeatherTextures() {
  const S = 256;
  const fbm = makeFbm(7712, [4, 8, 16]);
  const diffuseBuf = new Uint8Array(S * S * 4);
  const bumpBuf = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = y * S + x;
      const idx = i * 4;
      const n = fbm(u, v);
      bumpBuf[i] = n;

      // Cordovan deep oxblood / oiled bootmaker leather
      diffuseBuf[idx] = Math.floor(75 + n * 20);
      diffuseBuf[idx + 1] = Math.floor(28 + n * 12);
      diffuseBuf[idx + 2] = Math.floor(22 + n * 10);
      diffuseBuf[idx + 3] = 255;
    }
  }

  const normalBuf = heightToNormalSized(bumpBuf, S, S, 1.4);
  return {
    map: makeDataTexture(diffuseBuf, S, S, THREE.RGBAFormat, true),
    normalMap: makeDataTexture(normalBuf, S, S, THREE.RGBAFormat, false),
  };
}

// ---------------------------------------------------------------------------
// Build Model Geometry
// ---------------------------------------------------------------------------

export function buildPeggShoeLast() {
  const ironTex = makeCastIronTextures();
  const brassTex = makeBrassRuleTextures();
  const leatherTex = makeCordovanLeatherTextures();

  // Materials
  const matCastIron = new THREE.MeshStandardMaterial({
    color: 0x36383a,
    metalness: 0.82,
    roughness: 0.52,
    map: ironTex.map,
    normalMap: ironTex.normalMap,
  });

  const matPolishedBrass = new THREE.MeshStandardMaterial({
    color: 0xe0bc60,
    metalness: 0.88,
    roughness: 0.24,
    map: brassTex.map,
    normalMap: brassTex.normalMap,
  });

  const matBluedSteel = new THREE.MeshStandardMaterial({
    color: 0x222a38,
    metalness: 0.78,
    roughness: 0.32,
  });

  const matLeather = new THREE.MeshStandardMaterial({
    color: 0x5a241e,
    metalness: 0.08,
    roughness: 0.68,
    map: leatherTex.map,
    normalMap: leatherTex.normalMap,
  });

  const root = new THREE.Group();
  root.name = "Pegg_Calibrated_Cast_Iron_Last";

  // ---- 1. Handle Grip (centered at origin y=0)
  // Height from -0.14 to +0.015 m
  const gripRadius = 0.016;
  const gripLength = 0.13;
  const gripMesh = new THREE.Mesh(new THREE.CylinderGeometry(gripRadius, gripRadius * 1.05, gripLength, 24), matLeather);
  gripMesh.name = "Handle_Grip_Leather";
  gripMesh.position.set(0, -0.062, 0);
  root.add(gripMesh);

  // Pommel Cap (bottom at y = -0.149 m)
  const pommelGeo = new THREE.SphereGeometry(0.024, 24, 16);
  pommelGeo.scale(1, 0.70, 1);
  const pommelMesh = new THREE.Mesh(pommelGeo, matPolishedBrass);
  pommelMesh.name = "Handle_Pommel_Brass";
  pommelMesh.position.set(0, -0.132, 0);
  root.add(pommelMesh);

  // Handle Guard Collar (y = +0.012 m)
  const collarMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.018, 0.018, 24), matPolishedBrass);
  collarMesh.name = "Handle_Collar_Brass";
  collarMesh.position.set(0, 0.012, 0);
  root.add(collarMesh);

  // ---- 2. Heel Socket & Upright Horn
  // Connects handle to shoe last heel cup and rises up to summit at y = +0.17 m
  // Total height: 0.170 - (-0.145) = 0.340 m (34.0 cm)
  const hornCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.018, 0),
    new THREE.Vector3(0, 0.065, -0.012),
    new THREE.Vector3(0, 0.12, -0.028),
    new THREE.Vector3(0, 0.170, -0.035),
  ]);
  const hornGeo = new THREE.TubeGeometry(hornCurve, 24, 0.022, 16, false);
  const hornMesh = new THREE.Mesh(hornGeo, matCastIron);
  hornMesh.name = "Heel_Horn_Stalk";
  root.add(hornMesh);

  // Heel Horn Finial Knob at top (summit max Y = 0.191 m)
  const hornKnobGeo = new THREE.SphereGeometry(0.021, 20, 16);
  const hornKnobMesh = new THREE.Mesh(hornKnobGeo, matCastIron);
  hornKnobMesh.name = "Heel_Horn_Finial";
  hornKnobMesh.position.set(0, 0.170, -0.035);
  root.add(hornKnobMesh);

  // ---- 3. Shoe Last Foot Body
  // Extends from heel (-Z) forward to anvil toe (+Z)
  // Cross-width: X from -0.07 to +0.07 = 0.14 m (14.0 cm)
  // Depth: Z from -0.061 to +0.059 = 0.12 m (12.0 cm)
  const uSegments = 36;
  const vSegments = 24;
  const footGrid = buildGrid(uSegments, vSegments, (i, j) => {
    const u = j / (vSegments - 1); // 0 (heel cup) to 1 (toe anvil)
    const phi = (i / uSegments) * Math.PI * 2;
    const z = -0.047 + u * 0.100; // Z length
    const yCenter = 0.065 + Math.sin(u * Math.PI * 0.8) * 0.022; // instep arch curve

    // Width (rx) varies anatomically: narrow at heel, wider at ball, square at toe
    let rx = 0.032;
    if (u > 0.4 && u < 0.85) {
      rx = 0.0688; // ball width (~14cm total width: rx * 2 + plate offset)
    } else if (u >= 0.85) {
      rx = 0.057; // chisel toe
    } else {
      rx = 0.035 + u * 0.04;
    }

    // Height profile (ry)
    let ry = 0.032;
    if (u < 0.3) ry = 0.044; // tall heel
    else if (u > 0.7) ry = 0.020; // tapered toe

    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const power = u > 0.8 ? 0.75 : 0.95; // squarer at toe
    const x = Math.sign(cosP) * Math.pow(Math.abs(cosP), power) * rx;
    const y = yCenter + Math.sign(sinP) * Math.pow(Math.abs(sinP), power) * ry;

    const p = new THREE.Vector3(x, y, z);
    const n = new THREE.Vector3(cosP, sinP, (u - 0.5) * 0.2).normalize();
    return { p, n, uv: [i / uSegments, u] };
  });

  const footMesh = new THREE.Mesh(footGrid, matCastIron);
  footMesh.name = "Cast_Iron_Foot_Body";
  root.add(footMesh);

  // Square Toe Anvil Plate (capped front at +Z)
  const toePlateGeo = new THREE.BoxGeometry(0.102, 0.030, 0.010);
  const toePlateMesh = new THREE.Mesh(toePlateGeo, matCastIron);
  toePlateMesh.name = "Toe_Anvil_Plate";
  toePlateMesh.position.set(0, 0.076, 0.053);
  root.add(toePlateMesh);

  // ---- 4. Calibrated Brass Rule Inlay Plate
  // Mounted flush along lateral side (+X face)
  const ruleGeo = new THREE.BoxGeometry(0.005, 0.026, 0.082);
  const ruleMesh = new THREE.Mesh(ruleGeo, matPolishedBrass);
  ruleMesh.name = "Brass_Rule_Plate";
  ruleMesh.position.set(0.065, 0.080, 0.005);
  ruleMesh.rotation.z = -0.05;
  root.add(ruleMesh);

  // Sizing Dial Bezel (circular brass dial mounted on the rule plate)
  const dialGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.006, 20);
  const dialMesh = new THREE.Mesh(dialGeo, matPolishedBrass);
  dialMesh.name = "Brass_Sizing_Dial_Bezel";
  dialMesh.position.set(0.068, 0.082, 0.020);
  dialMesh.rotation.z = Math.PI / 2;
  root.add(dialMesh);

  // ---- 5. Knurled Thumbscrews (Instep & Heel)
  function makeThumbscrew(name, px, py, pz, rx, ry, rz) {
    const knobGroup = new THREE.Group();
    knobGroup.name = name;

    const knobGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.010, 18);
    const knobMesh = new THREE.Mesh(knobGeo, matPolishedBrass);
    knobGroup.add(knobMesh);

    const pinGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.016, 12);
    const pinMesh = new THREE.Mesh(pinGeo, matBluedSteel);
    pinMesh.position.y = -0.008;
    knobGroup.add(pinMesh);

    knobGroup.position.set(px, py, pz);
    knobGroup.rotation.set(rx, ry, rz);
    return knobGroup;
  }

  // Instep adjustment thumbscrew (top of foot arch)
  root.add(makeThumbscrew("Knurled_Thumbscrew_Instep", 0, 0.120, 0.005, 0, 0, 0));

  // Rear heel seam adjustment thumbscrew
  root.add(makeThumbscrew("Knurled_Thumbscrew_Heel", 0, 0.076, -0.046, Math.PI / 2, 0, 0));

  // ---- 6. Clockwork Leaf Springs (in arch cavity)
  const springGroup = new THREE.Group();
  springGroup.name = "Clockwork_Leaf_Springs";
  for (let s = 0; s < 3; s++) {
    const leafGeo = new THREE.BoxGeometry(0.022 - s * 0.004, 0.004, 0.045 - s * 0.008);
    const leafMesh = new THREE.Mesh(leafGeo, matBluedSteel);
    leafMesh.position.set(0, 0.048 - s * 0.005, -0.005 + s * 0.004);
    springGroup.add(leafMesh);
  }
  root.add(springGroup);

  return root;
}

// ---------------------------------------------------------------------------
// Build & Export
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Building ${ASSET_ID}...`);
  const root = buildPeggShoeLast();

  // Compute bounding box
  const bbox = new THREE.Box3().setFromObject(root);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());

  console.log(`Measured bounds (m):`);
  console.log(`  X: ${size.x.toFixed(4)} (target: ${SPEC.width} m)`);
  console.log(`  Y: ${size.y.toFixed(4)} (target: ${SPEC.height} m)`);
  console.log(`  Z: ${size.z.toFixed(4)} (target: ${SPEC.depth} m)`);
  console.log(`  BBox min: [${bbox.min.x.toFixed(3)}, ${bbox.min.y.toFixed(3)}, ${bbox.min.z.toFixed(3)}]`);
  console.log(`  BBox max: [${bbox.max.x.toFixed(3)}, ${bbox.max.y.toFixed(3)}, ${bbox.max.z.toFixed(3)}]`);

  // Count triangles
  let triangles = 0;
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry) {
      triangles += obj.geometry.index
        ? obj.geometry.index.count / 3
        : obj.geometry.attributes.position.count / 3;
    }
  });
  console.log(`Triangles: ${triangles} (budget: ${SPEC.triangles})`);

  // Export to GLB
  const exporter = new GLTFExporter();
  const glbBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (gltf) => resolve(Buffer.from(gltf)),
      reject,
      { binary: true }
    );
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, glbBuffer);
  console.log(`Wrote ${OUT} (${glbBuffer.length.toLocaleString()} bytes)`);

  const info = inspectGlb(OUT);
  console.log(`GLB verification: meshes=${info.meshCount}, materials=${info.materialCount}, images=${info.imageCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
