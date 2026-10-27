#!/usr/bin/env node
// Build Mistress Martha Crape's Spiked Mortuary Brolly as a binary .glb.
//
//   node scripts/build_prop_crape_spiked_brolly.mjs
//
// Matches the approved FLUX 3 alpha cutout and MiniMax H3 4-view turnaround:
// - Long-handled Victorian mourning umbrella / thrusting spear
// - Sharpened forged carbon steel mortuary lance ferrule
// - Tightly furled black mourning crape / bombazine silk canopy
// - Black bog-oak shaft with brass runner collars
// - Carved whalebone crook handle inlaid with faceted jet mourning beads
//
// FRAME (Grip / Socket Normalized)
//   Origin (0,0,0) sits at the center of the crook handle grip.
//   +Y is up along the handle crook.
//   +Z points forward along the shaft towards the steel ferrule spear spike.
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
const ASSET_ID = "prop_crape_spiked_brolly";
const OUT = path.join(ROOT, "public/models/props", `${ASSET_ID}.glb`);

// Target scale specifications: Width=12cm (X), Height=92cm (Y), Depth=12cm (Z)
const SPEC = {
  width: 0.12,  // X, cross-width of furled canopy
  height: 0.92, // Y, handle heel to ferrule tip
  depth: 0.12,  // Z, cross-depth of furled canopy
  triangles: 25000,
  bytes: 1.5 * 1024 * 1024,
};

// ---------------------------------------------------------------------------
// Procedural Textures
// ---------------------------------------------------------------------------

function makeSilkCrapeTextures() {
  const S = 512;
  const fbm = makeFbm(3002, [4, 16, 64]);
  const diffuseBuf = new Uint8Array(S * S * 4);
  const bumpBuf = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const n = fbm(u, v);
      const i = y * S + x;
      const idx = i * 4;

      // Fine fluted umbrella rib folds along U (8 flutes)
      const fold = Math.sin(u * Math.PI * 16);
      const bump = n * 0.3 + fold * 0.7;
      bumpBuf[i] = bump;

      // Dull pitch-black Victorian mourning crape silk
      const c = Math.floor(22 + n * 14);
      diffuseBuf[idx] = c;
      diffuseBuf[idx + 1] = c;
      diffuseBuf[idx + 2] = c + 1;
      diffuseBuf[idx + 3] = 255;
    }
  }

  const normalBuf = heightToNormalSized(bumpBuf, S, S, 2.0);
  return {
    map: makeDataTexture(diffuseBuf, S, S, THREE.RGBAFormat, true),
    normalMap: makeDataTexture(normalBuf, S, S, THREE.RGBAFormat, false),
  };
}

function makeWhaleboneTextures() {
  const S = 256;
  const fbm = makeFbm(1892, [4, 12, 32]);
  const diffuseBuf = new Uint8Array(S * S * 4);
  const bumpBuf = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const n = fbm(u, v);
      const i = y * S + x;
      const idx = i * 4;
      bumpBuf[i] = n;

      // Aged cream ivory / polished whalebone
      diffuseBuf[idx] = Math.floor(225 + n * 20);
      diffuseBuf[idx + 1] = Math.floor(215 + n * 18);
      diffuseBuf[idx + 2] = Math.floor(190 + n * 15);
      diffuseBuf[idx + 3] = 255;
    }
  }

  const normalBuf = heightToNormalSized(bumpBuf, S, S, 1.2);
  return {
    map: makeDataTexture(diffuseBuf, S, S, THREE.RGBAFormat, true),
    normalMap: makeDataTexture(normalBuf, S, S, THREE.RGBAFormat, false),
  };
}

// ---------------------------------------------------------------------------
// Build Model
// ---------------------------------------------------------------------------

export function buildCrapeBrolly() {
  const silkTex = makeSilkCrapeTextures();
  const boneTex = makeWhaleboneTextures();

  // Materials
  const matSilk = new THREE.MeshStandardMaterial({
    color: 0x181818,
    metalness: 0.15,
    roughness: 0.75,
    map: silkTex.map,
    normalMap: silkTex.normalMap,
  });

  const matWhalebone = new THREE.MeshStandardMaterial({
    color: 0xede4d0,
    metalness: 0.12,
    roughness: 0.38,
    map: boneTex.map,
    normalMap: boneTex.normalMap,
  });

  const matSteelSpike = new THREE.MeshStandardMaterial({
    color: 0x757a82,
    metalness: 0.88,
    roughness: 0.22,
  });

  const matPolishedJet = new THREE.MeshStandardMaterial({
    color: 0x0a0a0c,
    metalness: 0.20,
    roughness: 0.12,
  });

  const matBrass = new THREE.MeshStandardMaterial({
    color: 0xd8b250,
    metalness: 0.85,
    roughness: 0.28,
  });

  const root = new THREE.Group();
  root.name = "Crape_Spiked_Mortuary_Brolly";

  // Total height along Y: 0.92 m (92.0 cm)
  // Handle bottom at y = -0.12 m, Ferrule tip at y = +0.80 m -> total 0.92 m

  // ---- 1. Shaft (running along Y)
  const shaftGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.72, 20);
  const shaftMesh = new THREE.Mesh(shaftGeo, matWhalebone);
  shaftMesh.name = "Umbrella_Shaft_Oak";
  shaftMesh.position.set(0, 0.28, 0);
  root.add(shaftMesh);

  // ---- 2. Carved Whalebone Crook Handle (y = -0.12 to +0.06 m)
  const crookCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.06, 0),
    new THREE.Vector3(0, 0.00, 0),
    new THREE.Vector3(0, -0.06, 0.008),
    new THREE.Vector3(0, -0.111, 0.022),
    new THREE.Vector3(0, -0.08, 0.042),
    new THREE.Vector3(0, -0.03, 0.038),
  ]);
  const crookGeo = new THREE.TubeGeometry(crookCurve, 32, 0.012, 16, false);
  const crookMesh = new THREE.Mesh(crookGeo, matWhalebone);
  crookMesh.name = "Handle_Grip_Crook";
  root.add(crookMesh);

  // Jet beads inlaid along crook spine
  const jetGroup = new THREE.Group();
  jetGroup.name = "Jet_Mourning_Beads";
  for (let b = 0; b < 6; b++) {
    const t = 0.3 + b * 0.11;
    const pt = crookCurve.getPoint(t);
    const beadGeo = new THREE.SphereGeometry(0.006, 12, 10);
    const beadMesh = new THREE.Mesh(beadGeo, matPolishedJet);
    beadMesh.position.set(pt.x, pt.y, pt.z + 0.009);
    jetGroup.add(beadMesh);
  }
  root.add(jetGroup);

  // Silver / Jet Handle End Finial
  const finialGeo = new THREE.SphereGeometry(0.013, 16, 12);
  const finialMesh = new THREE.Mesh(finialGeo, matPolishedJet);
  finialMesh.name = "Handle_Finial_Jet";
  finialMesh.position.set(0, -0.03, 0.038);
  root.add(finialMesh);

  // Brass Collar between Handle and Canopy (y = 0.06 m)
  const collarGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.02, 24);
  const collarMesh = new THREE.Mesh(collarGeo, matBrass);
  collarMesh.name = "Handle_Collar_Brass";
  collarMesh.position.set(0, 0.06, 0);
  root.add(collarMesh);

  // ---- 3. Furled Silk Canopy Shell (y = 0.08 to 0.64 m)
  // Fluted conical sheath, max width = 12.0 cm (rx = 0.056 m + 0.004 m flute)
  const uSeg = 48;
  const vSeg = 28;
  const canopyGrid = buildGrid(uSeg, vSeg, (i, j) => {
    const v = j / (vSeg - 1); // 0 (runner base) to 1 (top collar)
    const phi = (i / uSeg) * Math.PI * 2;
    const y = 0.08 + v * 0.56;

    // Radius profile: tapered at bottom, widest at middle, tapered at top
    let r = 0.014;
    if (v < 0.25) r = 0.014 + v * 0.13;
    else if (v < 0.70) r = 0.0465 + Math.sin((v - 0.25) / 0.45 * Math.PI) * 0.0095; // max width 0.056m
    else r = 0.0465 - (v - 0.70) * 0.11;

    // 8 distinct umbrella rib flutes
    const flute = Math.sin(phi * 8) * 0.004;
    const rTot = r + flute;

    const x = rTot * Math.cos(phi);
    const z = rTot * Math.sin(phi);
    const p = new THREE.Vector3(x, y, z);
    const n = new THREE.Vector3(Math.cos(phi), 0.1, Math.sin(phi)).normalize();
    return { p, n, uv: [i / uSeg * 4, v * 3] };
  });

  const canopyMesh = new THREE.Mesh(canopyGrid, matSilk);
  canopyMesh.name = "Furled_Silk_Canopy";
  root.add(canopyMesh);

  // Canopy Leather Retention Strap with Brass Button (y = 0.38 m)
  const strapGeo = new THREE.TorusGeometry(0.056, 0.0035, 8, 36);
  const strapMesh = new THREE.Mesh(strapGeo, matPolishedJet);
  strapMesh.name = "Canopy_Retention_Strap";
  strapMesh.position.set(0, 0.38, 0);
  strapMesh.rotation.x = Math.PI / 2;
  root.add(strapMesh);

  const buttonGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.004, 16);
  const buttonMesh = new THREE.Mesh(buttonGeo, matBrass);
  buttonMesh.name = "Strap_Brass_Button";
  buttonMesh.position.set(0.056, 0.38, 0);
  buttonMesh.rotation.z = Math.PI / 2;
  root.add(buttonMesh);

  // ---- 4. Top Collar & Steel Mortuary Ferrule Spear Spike (y = 0.64 to 0.80 m)
  const topCollarGeo = new THREE.CylinderGeometry(0.014, 0.018, 0.025, 24);
  const topCollarMesh = new THREE.Mesh(topCollarGeo, matBrass);
  topCollarMesh.name = "Ferrule_Runner_Collar";
  topCollarMesh.position.set(0, 0.64, 0);
  root.add(topCollarMesh);

  // Ferrule Lance Spike (16 cm long tapered four-sided stiletto spear)
  const ferruleGeo = new THREE.ConeGeometry(0.011, 0.16, 4);
  const ferruleMesh = new THREE.Mesh(ferruleGeo, matSteelSpike);
  ferruleMesh.name = "Mortuary_Ferrule_Spear";
  ferruleMesh.position.set(0, 0.72, 0);
  root.add(ferruleMesh);

  return root;
}

// ---------------------------------------------------------------------------
// Build & Export
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Building ${ASSET_ID}...`);
  const root = buildCrapeBrolly();

  const bbox = new THREE.Box3().setFromObject(root);
  const size = bbox.getSize(new THREE.Vector3());

  console.log(`Measured bounds (m):`);
  console.log(`  X: ${size.x.toFixed(4)} (target: ${SPEC.width} m)`);
  console.log(`  Y: ${size.y.toFixed(4)} (target: ${SPEC.height} m)`);
  console.log(`  Z: ${size.z.toFixed(4)} (target: ${SPEC.depth} m)`);
  console.log(`  BBox min: [${bbox.min.x.toFixed(3)}, ${bbox.min.y.toFixed(3)}, ${bbox.min.z.toFixed(3)}]`);
  console.log(`  BBox max: [${bbox.max.x.toFixed(3)}, ${bbox.max.y.toFixed(3)}, ${bbox.max.z.toFixed(3)}]`);

  let triangles = 0;
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry) {
      triangles += obj.geometry.index
        ? obj.geometry.index.count / 3
        : obj.geometry.attributes.position.count / 3;
    }
  });
  console.log(`Triangles: ${triangles} (budget: ${SPEC.triangles})`);

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
