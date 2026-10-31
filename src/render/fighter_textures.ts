// In-game binding of the photorealistic and steampunk materials generated for
// the twelve Victorian fighters in public/tex/fighters/<slug>/.
import * as THREE from "three";
import type { Body } from "./body";

const textureCache = new Map<string, THREE.Texture>();

function loadRepeatedTexture(
  url: string,
  isColor: boolean,
  rx: number,
  ry: number,
  clamp = false,
  onReady?: (tex: THREE.Texture) => void,
): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const key = `${url}:${rx}x${ry}:${clamp ? "c" : "r"}`;
  const existing = textureCache.get(key);
  if (existing) {
    if (existing.image && onReady) onReady(existing);
    return existing;
  }
  const tex = new THREE.TextureLoader().load(url, (loaded) => {
    loaded.wrapS = loaded.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    loaded.repeat.set(rx, ry);
    if (isColor) {
      loaded.colorSpace = THREE.SRGBColorSpace;
    }
    loaded.needsUpdate = true;
    if (onReady) onReady(loaded);
  });
  tex.wrapS = tex.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  textureCache.set(key, tex);
  return tex;
}

const CRAFT_SPECS: Record<string, { metalness: number; roughness: number }> = {
  "constable-winch": { metalness: 0.75, roughness: 0.35 }, // polished brass
  "hezekiah-smelt": { metalness: 0.65, roughness: 0.5 },  // sand-cast iron
  "nell-sluice": { metalness: 0.5, roughness: 0.6 },     // dull lead drainpipe
  "matron-kilnworth": { metalness: 0.05, roughness: 0.15 }, // glazed bone porcelain
  "bartholomew-mule": { metalness: 0.0, roughness: 0.95 },  // matted bear fur
  "bosun-rook": { metalness: 0.0, roughness: 0.85 },       // weathered oak
  "lady-bulwark": { metalness: 0.85, roughness: 0.25 },     // mirror blued steel
  "percival-crump": { metalness: 0.45, roughness: 0.4 },    // amber bamboo & brass
  "tabitha-pegg": { metalness: 0.65, roughness: 0.5 },     // serrated pig iron
  "martha-crape": { metalness: 0.15, roughness: 0.2 },     // polished black jet
  "lady-eleanor": { metalness: 0.8, roughness: 0.2 },      // obsidian & silver
  "tilly-tongs": { metalness: 0.55, roughness: 0.5 },      // forged iron tongs
};

/**
 * Apply the fighter's authentic FLUX-generated cloth, craft limb, and facial
 * textures onto the 3D body skinned meshes and head decals.
 */
export function applyFighterTextures(slug: string, body: Body): void {
  if (typeof document === "undefined") return;

  const clothUrl = `/tex/fighters/${slug}/cloth.webp`;
  const clothHUrl = `/tex/fighters/${slug}/cloth_h.webp`;
  const skinUrl = `/tex/fighters/${slug}/skin.webp`;
  const skinHUrl = `/tex/fighters/${slug}/skin_h.webp`;
  const limbUrl = `/tex/fighters/${slug}/limb.webp`;
  const limbHUrl = `/tex/fighters/${slug}/limb_h.webp`;
  const faceUrl = `/tex/fighters/${slug}/face.webp`;

  // 1. Torso & chest attachments (pecs, shoulder blades, belt, pelvis): authentic cloth material
  const torsoMat = body.skins.torso.material as THREE.MeshStandardMaterial;
  const clothTorsoH = loadRepeatedTexture(clothHUrl, false, 2, 2);
  loadRepeatedTexture(clothUrl, true, 2, 2, false, (clothTex) => {
    torsoMat.map = clothTex;
    if (clothTorsoH) torsoMat.bumpMap = clothTorsoH;
    torsoMat.bumpScale = 0.04;
    torsoMat.color.setHex(0xffffff);
    torsoMat.roughness = 0.78;
    torsoMat.needsUpdate = true;

    for (const group of [body.spine, body.hips]) {
      for (const child of group.children) {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material = child.material.clone();
          child.material.map = clothTex;
          if (clothTorsoH) child.material.bumpMap = clothTorsoH;
          child.material.bumpScale = 0.03;
          child.material.color.setHex(0xffffff);
          child.material.needsUpdate = true;
        }
      }
    }
  });

  // 2. Legs: authentic trousers/skirt/wool cloth
  const clothLegH = loadRepeatedTexture(clothHUrl, false, 1, 2);
  loadRepeatedTexture(clothUrl, true, 1, 2, false, (clothLeg) => {
    for (const leg of [body.skins.legL, body.skins.legR]) {
      const legMat = leg.material as THREE.MeshStandardMaterial;
      legMat.map = clothLeg;
      if (clothLegH) legMat.bumpMap = clothLegH;
      legMat.bumpScale = 0.04;
      legMat.color.setHex(0xffffff);
      legMat.roughness = 0.8;
      legMat.needsUpdate = true;
    }
  });

  // 3. Arms & shoulder/elbow caps: the fighter's bespoke craft limbs (brass, porcelain, oak, steel, etc.)
  const spec = CRAFT_SPECS[slug] ?? { metalness: 0.3, roughness: 0.5 };
  const limbArmH = loadRepeatedTexture(limbHUrl, false, 1, 2);
  loadRepeatedTexture(limbUrl, true, 1, 2, false, (limbArm) => {
    for (const arm of [body.skins.armL, body.skins.armR]) {
      const armMat = arm.material as THREE.MeshStandardMaterial;
      armMat.map = limbArm;
      if (limbArmH) armMat.bumpMap = limbArmH;
      armMat.bumpScale = 0.05;
      armMat.metalness = spec.metalness;
      armMat.roughness = spec.roughness;
      armMat.color.setHex(0xffffff);
      armMat.needsUpdate = true;
    }
    for (const bone of [body.limbs.armL, body.limbs.armR, body.joints.elbowL, body.joints.elbowR]) {
      for (const child of bone.children) {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material = child.material.clone();
          child.material.map = limbArm;
          if (limbArmH) child.material.bumpMap = limbArmH;
          child.material.bumpScale = 0.04;
          child.material.metalness = spec.metalness;
          child.material.roughness = spec.roughness;
          child.material.color.setHex(0xffffff);
          child.material.needsUpdate = true;
        }
      }
    }
  });

  // 4. Head skull, jaw, and ears: authentic skin material
  const skinHeadH = loadRepeatedTexture(skinHUrl, false, 2, 1);
  loadRepeatedTexture(skinUrl, true, 2, 1, false, (skinHead) => {
    for (const child of body.head.children) {
      if (
        child instanceof THREE.Mesh &&
        child.name !== "faceDecal" &&
        child.geometry instanceof THREE.SphereGeometry &&
        child.scale.x >= 0.9 &&
        child.material instanceof THREE.MeshStandardMaterial
      ) {
        child.material.map = skinHead;
        if (skinHeadH) child.material.bumpMap = skinHeadH;
        child.material.bumpScale = 0.025;
        child.material.color.setHex(0xffffff);
        child.material.needsUpdate = true;
      }
    }
  });

  // 5. Face decal on front of skull
  if (!body.head.getObjectByName("faceDecal")) {
    const faceGeo = new THREE.PlaneGeometry(0.24, 0.24);
    const faceMat = new THREE.MeshStandardMaterial({
      transparent: true,
      alphaTest: 0.05,
      roughness: 0.6,
      depthWrite: false,
    });
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.name = "faceDecal";
    faceMesh.position.set(0, 0.16, 0.158);
    faceMesh.visible = false;
    body.head.add(faceMesh);

    loadRepeatedTexture(faceUrl, true, 1, 1, true, (faceTex) => {
      faceMat.map = faceTex;
      faceMat.needsUpdate = true;
      faceMesh.visible = true;
    });
  }
}
