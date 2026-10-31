// In-game binding of the photorealistic and steampunk materials generated for
// the twelve Victorian fighters in public/tex/fighters/<slug>/.
import * as THREE from "three";
import type { Body } from "./body";

const textureCache = new Map<string, THREE.Texture>();

function getTexture(url: string, isColor: boolean): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  let tex = textureCache.get(url);
  if (!tex) {
    tex = new THREE.TextureLoader().load(url);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (isColor) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    textureCache.set(url, tex);
  }
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

  const cloth = getTexture(`/tex/fighters/${slug}/cloth.webp`, true);
  const clothH = getTexture(`/tex/fighters/${slug}/cloth_h.webp`, false);
  const skin = getTexture(`/tex/fighters/${slug}/skin.webp`, true);
  const skinH = getTexture(`/tex/fighters/${slug}/skin_h.webp`, false);
  const limb = getTexture(`/tex/fighters/${slug}/limb.webp`, true);
  const limbH = getTexture(`/tex/fighters/${slug}/limb_h.webp`, false);
  const face = getTexture(`/tex/fighters/${slug}/face.webp`, true);

  if (!cloth || !limb || !skin || !face) return;

  const rep = (t: THREE.Texture, rx: number, ry: number) => {
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  };

  // 1. Torso: authentic cloth material
  const torsoMat = body.skins.torso.material as THREE.MeshStandardMaterial;
  torsoMat.map = rep(cloth, 2, 2);
  if (clothH) torsoMat.bumpMap = rep(clothH, 2, 2);
  torsoMat.bumpScale = 1.5;
  torsoMat.color.setHex(0xffffff);
  torsoMat.needsUpdate = true;

  // 2. Legs: authentic trousers/skirt/wool cloth
  for (const leg of [body.skins.legL, body.skins.legR]) {
    const legMat = leg.material as THREE.MeshStandardMaterial;
    legMat.map = rep(cloth, 1, 2);
    if (clothH) legMat.bumpMap = rep(clothH, 1, 2);
    legMat.bumpScale = 1.5;
    legMat.color.setHex(0xffffff);
    legMat.needsUpdate = true;
  }

  // 3. Arms: the fighter's bespoke craft limbs (brass, porcelain, oak, steel, etc.)
  const spec = CRAFT_SPECS[slug] ?? { metalness: 0.3, roughness: 0.5 };
  for (const arm of [body.skins.armL, body.skins.armR]) {
    const armMat = arm.material as THREE.MeshStandardMaterial;
    armMat.map = rep(limb, 1, 2);
    if (limbH) armMat.bumpMap = rep(limbH, 1, 2);
    armMat.bumpScale = 2.0;
    armMat.metalness = spec.metalness;
    armMat.roughness = spec.roughness;
    armMat.color.setHex(0xffffff);
    armMat.needsUpdate = true;
  }

  // 4. Head skull and neck: authentic skin material
  const headSkinMesh = body.head.children.find(
    (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry && c.scale.y > 1.05
  ) as THREE.Mesh | undefined;
  if (headSkinMesh && headSkinMesh.material instanceof THREE.MeshStandardMaterial) {
    headSkinMesh.material.map = rep(skin, 2, 1);
    if (skinH) headSkinMesh.material.bumpMap = rep(skinH, 2, 1);
    headSkinMesh.material.bumpScale = 1.0;
    headSkinMesh.material.color.setHex(0xffffff);
    headSkinMesh.material.needsUpdate = true;
  }

  // 5. Face decal on front of skull
  if (!body.head.getObjectByName("faceDecal")) {
    const faceTex = face.clone();
    faceTex.wrapS = faceTex.wrapT = THREE.ClampToEdgeWrapping;
    faceTex.needsUpdate = true;

    const faceGeo = new THREE.PlaneGeometry(0.24, 0.24);
    const faceMat = new THREE.MeshStandardMaterial({
      map: faceTex,
      transparent: true,
      alphaTest: 0.05,
      roughness: 0.6,
      depthWrite: false,
    });
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.name = "faceDecal";
    faceMesh.position.set(0, 0.16, 0.158);
    body.head.add(faceMesh);
  }
}
