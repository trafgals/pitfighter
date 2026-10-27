#!/usr/bin/env node
// Unified Procedural 3D Prop & Weapon Generator for Pit Fighter: Old Sorrow
// Usage: node scripts/build_procedural_prop.mjs <asset_id>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { installCanvasShim } from "./lib/canvas_shim.mjs";
import { inspectGlb } from "./lib/glb_inspect.mjs";
import { makeFbm, heightToNormalSized, buildGrid, makeDataTexture } from "./lib/prop_geometry.mjs";

installCanvasShim();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetId = process.argv[2];
if (!assetId) {
  console.error("Usage: node scripts/build_procedural_prop.mjs <asset_id>");
  process.exit(2);
}

const OUT = path.join(ROOT, "public/models/props", `${assetId}.glb`);

// ---- Helper Material Builders ----
function mat(color, metal = 0.5, rough = 0.5) {
  return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
}

const MATS = {
  iron: () => mat(0x282a2e, 0.82, 0.55),
  brass: () => mat(0xdeb34a, 0.88, 0.24),
  silver: () => mat(0xdedede, 0.92, 0.18),
  steel: () => mat(0x68707a, 0.85, 0.28),
  gold: () => mat(0xe5b838, 0.85, 0.25),
  tweed: () => mat(0x42382c, 0.05, 0.92),
  linen: () => mat(0xf2efe8, 0.02, 0.85),
  redCross: () => mat(0xb01818, 0.05, 0.60),
  leather: () => mat(0x4a2418, 0.08, 0.70),
  oilskin: () => mat(0x3a382c, 0.25, 0.55),
  wood: () => mat(0x5a3e28, 0.05, 0.78),
  ivory: () => mat(0xede6d4, 0.10, 0.35),
  emeraldGlass: () => new THREE.MeshPhysicalMaterial({ color: 0x187040, metalness: 0.1, roughness: 0.15, transmission: 0.8, transparent: true, opacity: 0.85 }),
  crimsonVelvet: () => mat(0x751218, 0.10, 0.90),
};

// ---------------------------------------------------------------------------
// Prop Geometry Builders
// ---------------------------------------------------------------------------
const BUILDERS = {
  // ---- 1. Eleanor Weeping Rapier Swordstick ----
  prop_eleanor_weeping_rapier: () => {
    const root = new THREE.Group();
    root.name = "Eleanor_Weeping_Rapier_Swordstick";
    // Malacca Cane Shaft
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.008, 0.76, 20), MATS.wood());
    shaft.name = "Shaft_Wood";
    shaft.position.set(0, 0.32, 0);
    root.add(shaft);
    // Silver Maiden Head Pommel
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.022, 24, 16), MATS.silver());
    pommel.name = "Silver_Maiden_Pommel";
    pommel.position.set(0, -0.05, 0);
    root.add(pommel);
    // Handle Grip Collar at y = 0
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 20), MATS.silver());
    collar.name = "Handle_Grip_Collar";
    collar.position.set(0, 0.00, 0);
    root.add(collar);
    // Steel Rapier Blade
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.42, 4), MATS.steel());
    blade.name = "Rapier_Blade";
    blade.position.set(0, 0.68, 0);
    root.add(blade);
    return root;
  },

  // ---- 2. Tilly Clinker-Tongs ----
  prop_tilly_clinker_tongs: () => {
    const root = new THREE.Group();
    root.name = "Tilly_Furnace_Clinker_Tongs";
    // Handle grip center at y = 0
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 16), MATS.iron());
    grip.name = "Handle_Grip_Center";
    grip.position.set(0, 0, 0);
    root.add(grip);
    // Scissor handles
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.012, 0.68, 16), MATS.iron());
      arm.name = s < 0 ? "Handle_Arm_Left" : "Handle_Arm_Right";
      arm.position.set(0.038 * s, 0.08, 0);
      arm.rotation.z = -0.08 * s;
      root.add(arm);
      // Asbestos heat wraps
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 16), MATS.linen());
      wrap.position.set(0.052 * s, -0.12, 0);
      root.add(wrap);
    }
    // Pivot joint rivet
    const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.032, 18), MATS.iron());
    rivet.name = "Center_Pivot_Rivet";
    rivet.position.set(0, 0.22, 0);
    rivet.rotation.x = Math.PI / 2;
    root.add(rivet);
    // Clamping claw jaws
    for (const s of [-1, 1]) {
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.18, 0.016), MATS.iron());
      jaw.name = `Clamping_Jaw_${s < 0 ? "L" : "R"}`;
      jaw.position.set(0.032 * s, 0.42, 0);
      jaw.rotation.z = 0.14 * s;
      root.add(jaw);
    }
    return root;
  },

  // ---- 3. Nell Sluice Flatcap ----
  prop_sluice_flatcap: () => {
    const root = new THREE.Group();
    root.name = "Nell_Sluice_Flatcap";
    // Exact y=0 opening rim
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.11, 32), MATS.tweed());
    rim.name = "Crown_Opening_Rim";
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0, 0);
    root.add(rim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.11, 0.08, 28), MATS.tweed());
    crown.name = "Crown_Body";
    crown.scale.set(1.0, 0.75, 1.12);
    crown.position.set(0, 0.05, 0.01);
    root.add(crown);
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.012, 24, 1, false, 0, Math.PI), MATS.tweed());
    peak.name = "Cap_Peak_Brim";
    peak.position.set(0, 0.018, 0.07);
    peak.rotation.x = 0.18;
    root.add(peak);
    return root;
  },

  // ---- 4. Matron Kilnworth Nurse Cap ----
  prop_kilnworth_nursecap: () => {
    const root = new THREE.Group();
    root.name = "Kilnworth_Field_Nurse_Cap";
    // Exact y=0 opening rim
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.09, 32), MATS.linen());
    rim.name = "Crown_Opening_Rim";
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0, 0);
    root.add(rim);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.14), MATS.linen());
    cap.name = "Crown_Body";
    cap.position.set(0, 0.06, 0);
    root.add(cap);
    // Red Cross emblem
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.005), MATS.redCross());
    crossH.name = "Red_Cross_Emblem";
    crossH.position.set(0, 0.07, 0.072);
    root.add(crossH);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.05, 0.005), MATS.redCross());
    crossV.position.set(0, 0.07, 0.072);
    root.add(crossV);
    return root;
  },

  // ---- 5. Mule Championship Belt ----
  prop_mule_championship_belt: () => {
    const root = new THREE.Group();
    root.name = "Mule_Championship_Belt";
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 10, 36), MATS.leather());
    strap.name = "Handle_Grip_Leather";
    strap.scale.set(1.15, 0.45, 0.95);
    root.add(strap);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.018), MATS.gold());
    plate.name = "Gold_Championship_Plate";
    plate.position.set(0, 0, 0.15);
    root.add(plate);
    return root;
  },

  // ---- 6. Rook Sou'wester ----
  prop_rook_souwester: () => {
    const root = new THREE.Group();
    root.name = "Rook_Oilskin_Souwester";
    // Exact y=0 opening rim
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.13, 32), MATS.oilskin());
    rim.name = "Crown_Opening_Rim";
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0, 0);
    root.add(rim);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), MATS.oilskin());
    dome.name = "Crown_Dome";
    dome.scale.set(1.0, 0.95, 1.15);
    dome.position.set(0, 0.02, 0);
    root.add(dome);
    const flap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.11, 24, 1, true, Math.PI * 0.6, Math.PI * 0.8), MATS.oilskin());
    flap.name = "Neck_Flap";
    flap.position.set(0, -0.04, -0.05);
    root.add(flap);
    return root;
  },

  // ---- 7. Bulwark Pistons ----
  prop_bulwark_pistons: () => {
    const root = new THREE.Group();
    root.name = "Bulwark_Hydraulic_Pistons";
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.052, 0.28, 20), MATS.steel());
    sleeve.name = "Handle_Grip_Sleeve";
    root.add(sleeve);
    const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 16), MATS.steel());
    ram.position.set(0.035, 0.03, 0);
    root.add(ram);
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.015, 18), MATS.brass());
    gauge.name = "Brass_Pressure_Gauge";
    gauge.position.set(0, -0.08, 0.055);
    gauge.rotation.x = Math.PI / 2;
    root.add(gauge);
    return root;
  },

  // ---- 8. Crump Samovar Boiler ----
  prop_crump_samovar: () => {
    const root = new THREE.Group();
    root.name = "Crump_Tea_Samovar_Boiler";
    const urn = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.08, 0.32, 24), MATS.brass());
    urn.name = "Handle_Grip_Urn";
    root.add(urn);
    const lid = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.07, 24), MATS.brass());
    lid.name = "Samovar_Lid";
    lid.position.set(0, 0.19, 0);
    root.add(lid);
    const spigot = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 12), MATS.brass());
    spigot.position.set(0, -0.09, 0.11);
    spigot.rotation.x = Math.PI / 2;
    root.add(spigot);
    return root;
  },

  // ---- 9. Knuckleduster ----
  weapon_knuckleduster: () => {
    const root = new THREE.Group();
    root.name = "Brass_Knuckleduster";
    const palm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.085, 16), MATS.brass());
    palm.name = "Handle_Grip_Palm";
    palm.rotation.z = Math.PI / 2;
    root.add(palm);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.004, 8, 20), MATS.brass());
      ring.name = `Finger_Ring_${i}`;
      ring.position.set(-0.033 + i * 0.022, 0.025, 0);
      root.add(ring);
    }
    return root;
  },

  // ---- 10. Coal Shovel ----
  weapon_coal_shovel: () => {
    const root = new THREE.Group();
    root.name = "Stokers_Coal_Shovel";
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.72, 16), MATS.wood());
    handle.name = "Handle_Grip_Shaft";
    handle.position.set(0, 0.0, 0);
    root.add(handle);
    const dGrip = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.010, 8, 20), MATS.wood());
    dGrip.position.set(0, -0.36, 0);
    root.add(dGrip);
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.28, 0.045), MATS.iron());
    scoop.name = "Shovel_Scoop_Blade";
    scoop.position.set(0, 0.46, 0);
    root.add(scoop);
    return root;
  },

  // ---- 11. Bone Saw ----
  weapon_bone_saw: () => {
    const root = new THREE.Group();
    root.name = "Surgeons_Bone_Saw";
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.11, 16), MATS.ivory());
    handle.name = "Handle_Grip_Ivory";
    handle.position.set(0, 0.0, 0);
    root.add(handle);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.25, 0.022), MATS.steel());
    spine.name = "Saw_Frame_Spine";
    spine.position.set(0, 0.18, -0.015);
    root.add(spine);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.24, 0.028), MATS.steel());
    blade.name = "Serrated_Blade";
    blade.position.set(0, 0.18, 0.012);
    root.add(blade);
    return root;
  },

  // ---- 12. Nail Bat ----
  weapon_nail_bat: () => {
    const root = new THREE.Group();
    root.name = "Studded_Cricket_Bat";
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.26, 16), MATS.leather());
    handle.name = "Handle_Grip_Cord";
    handle.position.set(0, 0.0, 0);
    root.add(handle);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.58, 0.038), MATS.wood());
    blade.name = "Bat_Blade_Willow";
    blade.position.set(0, 0.42, 0);
    root.add(blade);
    // Spiked nails
    for (let n = 0; n < 12; n++) {
      const nail = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.030, 6), MATS.iron());
      nail.name = `Horseshoe_Nail_${n}`;
      nail.position.set(0.03 * ((n % 3) - 1), 0.25 + (n * 0.035), 0.025);
      nail.rotation.x = Math.PI / 2;
      root.add(nail);
    }
    return root;
  },

  // ---- 13. Butcher Cleaver ----
  weapon_cleaver: () => {
    const root = new THREE.Group();
    root.name = "Butchers_Meat_Cleaver";
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.016, 0.14, 16), MATS.wood());
    handle.name = "Handle_Grip_Scales";
    handle.position.set(0, 0.0, 0);
    root.add(handle);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.22, 0.11), MATS.steel());
    blade.name = "Cleaver_Blade_Steel";
    blade.position.set(0, 0.18, 0.045);
    root.add(blade);
    return root;
  },

  // ---- 14. Piston Gauntlet ----
  weapon_piston_gauntlet: () => {
    const root = new THREE.Group();
    root.name = "Piston_Steam_Gauntlet";
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.28, 20), MATS.steel());
    sleeve.name = "Handle_Grip_Sleeve";
    root.add(sleeve);
    const ram = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.08), MATS.steel());
    ram.name = "Knuckle_Ram_Plate";
    ram.position.set(0, 0.16, 0);
    root.add(ram);
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.18, 16), MATS.brass());
    boiler.name = "Mini_Steam_Boiler";
    boiler.position.set(0, -0.02, 0.075);
    root.add(boiler);
    return root;
  },

  // ---- 15. Lamplighter Pole ----
  weapon_lamplighter_pole: () => {
    const root = new THREE.Group();
    root.name = "Lamplighters_Gas_Pole";
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.65, 16), MATS.wood());
    shaft.name = "Handle_Grip_Shaft";
    shaft.position.set(0, 0.0, 0);
    root.add(shaft);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.015, 0.15, 16), MATS.brass());
    head.name = "Brass_Lamp_Head";
    head.position.set(0, 0.85, 0);
    root.add(head);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 8, 16, Math.PI), MATS.brass());
    hook.name = "Gas_Shutoff_Hook";
    hook.position.set(0.035, 0.88, 0);
    root.add(hook);
    return root;
  },

  // ---- 16. Box Chair ----
  weapon_chair: () => {
    const root = new THREE.Group();
    root.name = "Private_Box_Chair";
    // 4 legs
    for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.42, 12), MATS.gold());
      leg.position.set(x, -0.21, z);
      root.add(leg);
    }
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.08, 24), MATS.crimsonVelvet());
    seat.name = "Handle_Grip_Seat";
    seat.position.set(0, 0.04, 0);
    root.add(seat);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.38, 20), MATS.crimsonVelvet());
    back.name = "Tufted_Backrest";
    back.scale.set(1.0, 1.0, 0.25);
    back.position.set(0, 0.26, -0.18);
    root.add(back);
    return root;
  },

  // ---- 17. Bottle of Tincture ----
  pickup_tonic: () => {
    const root = new THREE.Group();
    root.name = "Apothecary_Tincture_Bottle";
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.13, 20), MATS.emeraldGlass());
    body.name = "Handle_Grip_Bottle";
    root.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.04, 16), MATS.emeraldGlass());
    neck.name = "Bottle_Neck";
    neck.position.set(0, 0.085, 0);
    root.add(neck);
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.010, 0.02, 14), MATS.wood());
    cork.name = "Wax_Sealed_Cork";
    cork.position.set(0, 0.11, 0);
    root.add(cork);
    return root;
  },
};

// ---------------------------------------------------------------------------
// Build Execution
// ---------------------------------------------------------------------------
async function main() {
  const builder = BUILDERS[assetId];
  if (!builder) {
    console.error(`Unknown assetId for procedural builder: ${assetId}`);
    process.exit(1);
  }

  console.log(`Building ${assetId} via procedural generator...`);
  const root = builder();

  const bbox = new THREE.Box3().setFromObject(root);
  const size = bbox.getSize(new THREE.Vector3());
  console.log(`Measured bounds: ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m`);

  let triangles = 0;
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry) {
      triangles += obj.geometry.index
        ? obj.geometry.index.count / 3
        : obj.geometry.attributes.position.count / 3;
    }
  });
  console.log(`Triangles: ${triangles}`);

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
  console.log(`GLB verified: meshes=${info.meshCount}, materials=${info.materialCount}, images=${info.imageCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
