// The 3D props: loading them, and putting them where they go.
//
// A prop is a GLB the asset pipeline built, with the pivot the manifest
// names: a helmet's rim on the y=0 plane, a weapon's grip at the origin. The
// body is in metres too, so a prop is the same size in the pit as it is on
// the capture render.
//
// The models are loaded once and kept. A prop that has not arrived yet is not
// shown, and the fighter keeps the game's own drawing of that piece of kit
// until it does - so a slow load is a late hat, not a bald head in a helmet
// that never arrives.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PropSpec } from "../data/props";

const loader = new GLTFLoader();

/** The loaded models, by the prop's id. */
const models = new Map<string, THREE.Group>();

/** Whoever is waiting for a model that has not arrived yet. */
const waiting = new Map<string, ((model: THREE.Group) => void)[]>();

/**
 * What the arena leaves on the floor has no modelled asset: a steel beam, a
 * boulder, an arrow, a severed limb. Each is drawn here, to the same pivot
 * rule as a weapon (the grip at the origin, the length along y).
 */
export const DEBRIS_SPECS: Record<string, PropSpec> = Object.fromEntries(
  ["debris_beam", "debris_stone", "debris_arrow", "limb"].map((id) => [
    id,
    { id, name: id, kind: "gift", fighter: "", gear: "", throw: "", url: "", bone: "hand", offset: [0, -0.3, 0], turn: [Math.PI, 0, 0], scale: 1 } as PropSpec,
  ]),
);

/** A prop's spec, whether it is an approved asset or something the arena dropped. */
export function specFor(id: string, approved: Record<string, PropSpec>): PropSpec | undefined {
  return approved[id] ?? DEBRIS_SPECS[id];
}

function debrisModel(id: string): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.55, metalness: 0.7 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.95, metalness: 0 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.8, metalness: 0 });
  const flesh = new THREE.MeshStandardMaterial({ color: 0xc4967a, roughness: 0.7, metalness: 0 });
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  if (id === "debris_beam") {
    // an I-beam, 2.2 m long
    part(new THREE.BoxGeometry(0.28, 2.2, 0.06), steel, 0, -0.7, 0);
    part(new THREE.BoxGeometry(0.28, 2.2, 0.06), steel, 0, -0.7, 0.2);
    part(new THREE.BoxGeometry(0.06, 2.2, 0.26), steel, 0, -0.7, 0.1);
  } else if (id === "debris_stone") {
    part(new THREE.DodecahedronGeometry(0.3), stone, 0, -0.25, 0);
  } else if (id === "debris_arrow") {
    part(new THREE.CylinderGeometry(0.015, 0.015, 0.9), wood, 0, -0.3, 0);
    part(new THREE.ConeGeometry(0.04, 0.12, 6), steel, 0, 0.2, 0);
  } else {
    // a limb: the stump end in the hand
    part(new THREE.CylinderGeometry(0.07, 0.06, 0.6), flesh, 0, -0.25, 0);
  }
  return g;
}

/** Start loading a prop. It arrives later; the callback is told when it does. */
export function loadProp(spec: PropSpec, onLoad?: (model: THREE.Group) => void): void {
  if (spec.id in DEBRIS_SPECS) {
    onLoad?.(debrisModel(spec.id));
    return;
  }
  if (models.has(spec.id)) {
    // each place a prop is shown gets its own copy of the model: one scene graph can have only one parent
    if (onLoad) onLoad(models.get(spec.id)!.clone(true));
    return;
  }
  if (onLoad) {
    const list = waiting.get(spec.id) ?? [];
    list.push(onLoad);
    waiting.set(spec.id, list);
  }
  if (waiting.has(spec.id) && models.has(spec.id)) return;
  loader.load(
    spec.url,
    (gltf) => {
      models.set(spec.id, gltf.scene);
      const list = waiting.get(spec.id) ?? [];
      waiting.delete(spec.id);
      for (const fn of list) fn(gltf.scene.clone(true));
    },
    undefined,
    () => {
      // a prop that will not load is left out: the game carries on without it
      waiting.delete(spec.id);
    },
  );
}

/** The model, if it has arrived. */
export function propModel(spec: PropSpec): THREE.Group | null {
  return models.get(spec.id) ?? null;
}

/**
 * Split a model into its two halves along x.
 *
 * Some props are a matched pair in one mesh - the pistons are two rams, one
 * for each forearm - and the kit they replace is one on each arm. The halves
 * share the model's vertices and differ only in which triangles they draw, so
 * nothing is copied but the index.
 */
export function splitByX(root: THREE.Object3D): [THREE.Group, THREE.Group] {
  const left = new THREE.Group();
  const right = new THREE.Group();
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const [a, b] = splitMesh(child);
    // the mesh's own place in the model, so the halves stay where they were
    local.multiplyMatrices(rootInverse, child.matrixWorld);
    local.decompose(position, quaternion, scale);
    for (const [half, target] of [
      [a, left],
      [b, right],
    ] as const) {
      half.position.copy(position);
      half.quaternion.copy(quaternion);
      half.scale.copy(scale);
      target.add(half);
    }
  });
  return [left, right];
}

/** One mesh, cut in two along x: the triangles on either side of the plane. */
function splitMesh(mesh: THREE.Mesh): [THREE.Mesh, THREE.Mesh] {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const left: number[] = [];
  const right: number[] = [];

  const push = (a: number, b: number, c: number) => {
    const centre = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    (centre < 0 ? left : right).push(a, b, c);
  };

  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  } else {
    for (let i = 0; i + 2 < position.count; i += 3) push(i, i + 1, i + 2);
  }

  const half = (triangles: number[]): THREE.Mesh => {
    const g = geometry.clone();
    g.setIndex(triangles);
    const m = new THREE.Mesh(g, mesh.material);
    m.castShadow = true;
    return m;
  };

  const pair: [THREE.Mesh, THREE.Mesh] = [half(left), half(right)];
  // each half is centred on its own axis, so it sits on the bone it is put on
  for (const m of pair) {
    m.geometry.computeBoundingBox();
    const box = m.geometry.boundingBox;
    if (box) m.position.x -= (box.min.x + box.max.x) / 2;
  }
  return pair;
}

/**
 * Put a prop on a bone, where the table says it goes.
 *
 * The holder is a group, so the prop's own place on the bone and its turn are
 * kept apart from the model's own origin and turn. The scale is on the holder
 * too: it grows the prop around the place it stands, not the place itself.
 */
export function placeProp(spec: PropSpec, bone: THREE.Object3D, model: THREE.Group): THREE.Group {
  const holder = new THREE.Group();
  holder.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
  holder.rotation.set(spec.turn[0], spec.turn[1], spec.turn[2]);
  holder.scale.setScalar(spec.scale ?? 1);
  holder.add(model);
  bone.add(holder);
  return holder;
}

/** A prop lying on the floor: flat, so it reads as lying there. */
export function layProp(model: THREE.Group): THREE.Group {
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2;
  holder.add(model);
  return holder;
}
