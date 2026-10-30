// The prop capture page.
//
// It loads one .glb, sets up a small studio around it and lets the capture
// script drive the camera. The scene is deliberately plain: a reviewer needs
// to judge the silhouette, the material and the badge, so the lighting is
// three fixed lamps and there is no scene dressing to distract from the
// asset.
//
// The page exposes window.__propCapture with:
//   ready    - true once the model is in the scene
//   stats    - triangle count, bounds and the per-mesh summary
//   setView(name) - "front" | "profile" | "badge" | "rear"
//   render() - draws one frame and resolves when the frame is on screen
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// Does the model still look like the approved art? The turnaround sheet's
// front tile is the prop seen from the front, so the model's silhouette is
// compared with it: a prop that has drifted away from its art - a bat that
// came back the wrong way up, a chair that lost its arms - scores badly, and
// the score is in the capture's report. The comparison is about the shape
// only: a model's material is lit and the art is painted, so their colours
// cannot be compared to a number, and a check that cried wolf over that
// would be turned off.
import { normalise, score } from "./fidelity.mjs";

const params = new URLSearchParams(window.location.search);
const modelUrl = params.get("model") || "";
const width = Number(params.get("width") || 900);
const height = Number(params.get("height") || 1100);
// How much of the asset each view has to contain, in metres, and where the
// close-up is framed. The capture script passes both in, because a prop's
// size and its detail vary: a helmet's badge and a hat's gold band are not
// the same distance from the camera.
const viewFit = Number(params.get("fit") || 0.17);
const closeupFit = Number(params.get("closeupFit") || 0.048);
// The close-up's target is either a point in the model's own space
// ("x,y,z") or the name of a mesh to centre on.
const closeupTarget = params.get("closeup") || "";
// The prop's frame, relative to the approved art.
//
// A reconstruction is turned over before it is conditioned on, so some meshes
// are stored the other way up from the art they were built from. The manifest
// says so, and the render has to say it back: a reviewer who opens the issue
// and sees the bat upside down concludes that the model has abandoned the
// concept art, when the model is in fact a faithful copy of it.
//
// The turn is undone here rather than in the mesh, because the mesh's own
// frame is the one the game places the prop by: the placement table rolls
// these props a half turn about x, so the model the game shows is already the
// art the right way up. It is only the review render that was showing the
// other one.
const flip = params.get("flip") === "1";
const roll = Number(params.get("roll") || 0);
// The turnaround sheet the prop was built from. Its front tile is the prop
// seen from the front, which is what the render is compared against.
const sheetUrl = params.get("sheet") || "";
// A comma-separated list of mesh names to leave out of the shot. It is how a
// single layer of a prop gets looked at on its own.
const hide = (params.get("hide") || "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const canvas = document.getElementById("view");
canvas.width = width;
canvas.height = height;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.setClearColor(0x10141b, 1);
// Shadows are what make the relief read: the crown's seams, the rolled welt,
// the badge's raised ring and the crest plate are all small steps, and
// without a shadow casting across them they vanish into the surface.
//
// The flag exists so a reviewer (or a diagnostic pass) can see the asset
// without the shadow map, which separates a modelling fault from a shadow
// artefact: a step that only breaks with the shadow map on is a shadow fault.
const shadows = params.get("shadows") !== "0";
renderer.shadowMap.enabled = shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(32, width / height, 0.01, 20);
const target = new THREE.Vector3();

// Three fixed lamps: a soft sky, a key from the front-left and a cold rim
// from behind-right, which is what makes the brass read as metal.
scene.add(new THREE.HemisphereLight(0x8a9bb4, 0x14161c, 1.7));
const key = new THREE.DirectionalLight(0xfff3dd, 2.6);
key.position.set(-0.45, 0.6, 0.75);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.05;
key.shadow.camera.far = 3;
key.shadow.bias = -0.0008;
key.shadow.normalBias = 0.004;
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fb4d0, 0.8);
fill.position.set(0.6, 0.15, 0.5);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xbcd4ff, 1.6);
rim.position.set(0.35, 0.45, -0.8);
scene.add(rim);

// The floor is a shadow catcher: it shows the helmet's shadow and nothing
// else, so the reviewer's eye stays on the asset.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShadowMaterial({ opacity: 0.45 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const loader = new GLTFLoader();
const state = {
  ready: false,
  model: null,
  bounds: new THREE.Box3(),
  modelBounds: new THREE.Box3(),
  badge: new THREE.Vector3(),
  stats: null,
  errors: [],
  fidelity: null,
};

// The prop is turned back into the approved art's frame.
//
// The turn is done with two nested groups so the order is explicit: the mesh
// is first unrolled about its own axis and then set the right way up. The
// prop's pivot is its origin, so the turn happens about the origin - which is
// where the game puts the prop in the hand.
const pivot = new THREE.Group();
const holder = new THREE.Group();
pivot.rotation.z = THREE.MathUtils.degToRad(-roll);
if (flip) holder.rotation.x = Math.PI;
holder.add(pivot);

const VIEWS = {
  // fit is the radius, in metres, the view has to contain; margin is how much
  // air to leave around it.
  front: { azimuth: 0, elevation: 0.05, fit: viewFit, margin: 1.22, target: "centre", fov: 30 },
  profile: { azimuth: Math.PI / 2, elevation: 0.04, fit: viewFit, margin: 1.22, target: "centre", fov: 30 },
  rear: { azimuth: Math.PI, elevation: 0.05, fit: viewFit, margin: 1.22, target: "centre", fov: 30 },
  badge: { azimuth: 0.12, elevation: 0.08, fit: closeupFit, margin: 1.35, target: "badge", fov: 26 },
};

function frame(view) {
  const focus = view.target === "badge" ? state.badge : state.bounds.getCenter(new THREE.Vector3());
  // The vertical field of view is what limits a portrait frame, so the
  // distance comes from it and the radius the view has to contain.
  const halfFov = (view.fov * Math.PI) / 360;
  const distance = (view.fit / Math.tan(halfFov)) * view.margin;
  const camera2 = new THREE.PerspectiveCamera(view.fov, width / height, 0.005, 20);
  camera2.position.set(
    focus.x + Math.sin(view.azimuth) * distance,
    focus.y + view.elevation * distance,
    focus.z + Math.cos(view.azimuth) * distance,
  );
  camera2.lookAt(focus);
  camera2.updateProjectionMatrix();
  return { camera: camera2, focus };
}

function renderView(name) {
  const view = VIEWS[name] || VIEWS.front;
  const { camera: next, focus } = frame(view);
  camera.position.copy(next.position);
  camera.fov = next.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(focus);
  target.copy(focus);

  // The floor sits just under the asset and the shadow camera is pulled in
  // around it, so the shadow is sharp whatever the view.
  const box = state.bounds;
  const size = new THREE.Vector3();
  box.getSize(size);
  floor.position.set((box.min.x + box.max.x) / 2, box.min.y - 0.001, (box.min.z + box.max.z) / 2);
  key.shadow.camera.left = -size.x * 1.2;
  key.shadow.camera.right = size.x * 1.2;
  key.shadow.camera.top = size.y * 1.2;
  key.shadow.camera.bottom = -size.y * 1.2;
  key.shadow.camera.updateProjectionMatrix();

  renderer.render(scene, camera);
}

function renderOnce() {
  return new Promise((resolve) => {
    renderer.render(scene, camera);
    requestAnimationFrame(() => resolve());
  });
}

// --- does the model still look like the approved art? ------------------------
//
// The silhouette is taken from a flat white render on a black background with
// the floor hidden: what is compared is the shape of the prop, not its
// material and not the shadow it casts.

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`the sheet ${url} could not be loaded`));
    image.src = url;
  });
}

// The object's outline in the rendered frame.
function silhouetteFromCanvas() {
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    mask[i] = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] > 90 ? 1 : 0;
  }
  return { mask, w: width, h: height };
}

// The object's outline in the sheet's front tile, whose background is white.
async function sheetSilhouette(url) {
  const image = await loadImage(url);
  const side = image.height; // the sheet is a strip of square tiles
  const scratch = document.createElement("canvas");
  scratch.width = side;
  scratch.height = side;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, side, side, 0, 0, side, side);
  const { data } = ctx.getImageData(0, 0, side, side);
  const mask = new Uint8Array(side * side);
  for (let i = 0; i < side * side; i++) {
    mask[i] = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 235 ? 1 : 0;
  }
  return { mask, w: side, h: side };
}

// A mask cropped to its object and stretched to a square, so two silhouettes
// can be compared whatever their size and aspect.
async function fidelity() {
  if (!sheetUrl) return;
  // The prop is rendered flat white on black, with the floor put away so the
  // shadow it casts is not part of the shape.
  const flat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const swapped = [];
  const clear = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const floorWas = floor.visible;
  let shot;
  try {
    state.model.traverse((child) => {
      if (!child.isMesh) return;
      swapped.push([child, child.material]);
      child.material = flat;
    });
    floor.visible = false;
    renderer.setClearColor(0x000000, 1);
    renderView("front");
    shot = silhouetteFromCanvas();
  } finally {
    for (const [child, material] of swapped) child.material = material;
    floor.visible = floorWas;
    renderer.setClearColor(clear, clearAlpha);
    renderView("front");
  }

  const tile = await sheetSilhouette(sheetUrl);
  const model = normalise(shot.mask, shot.w, shot.h);
  const art = normalise(tile.mask, tile.w, tile.h);
  // the render as it is published against the sheet's front view, and the
  // same render against the sheet turned over
  state.fidelity = score(model, art);
}

loader.load(
  modelUrl,
  (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    // The model's own bounds are the mesh as the file holds it, and they are
    // what the manifest's frame numbers describe. The bounds of the turned
    // prop are what the camera frames.
    state.modelBounds.setFromObject(model);
    pivot.add(model);
    scene.add(holder);
    holder.updateMatrixWorld(true);
    // Clay mode swaps every material for one matte grey. It is how the form
    // is judged on its own: a step that only shows up once the material is
    // taken away is a geometry fault, not a lighting one.
    const clay = params.get("clay") === "1";
    const clayMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d434b,
      roughness: 0.9,
      metalness: 0,
      flatShading: false,
    });
    model.traverse((child) => {
      if (!child.isMesh) return;
      if (hide.some((name) => child.name.includes(name))) {
        child.visible = false;
        return;
      }
      if (clay) child.material = clayMaterial;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    state.model = model;
    state.bounds.setFromObject(holder);

    // Where the close-up is framed. The target is either a point given in
    // the model's own space or the centre of a named mesh, so the shot does
    // not have to guess where the detail is.
    //
    // The point is parsed strictly: a coordinate that is empty or not a
    // number is a mistake in the manifest, and a lenient parser would either
    // drop the bad part (shifting the rest of the point) or read an empty
    // field as a zero - so the shot would be framed on the wrong spot and
    // nothing would say so.
    const parts = closeupTarget.split(",").map((part) => part.trim());
    const isPoint = parts.length === 3 && parts.every((part) => part !== "" && Number.isFinite(Number(part)));
    if (isPoint) {
      const point = parts.map(Number);
      // A focus point outside the model frames empty space, and the render
      // still looks like a render, so it has to be refused here.
      //
      // The point is in the model's own space, so it is measured against the
      // model's own bounds and then turned with the model.
      const inside = new THREE.Box3().copy(state.modelBounds).expandByScalar(0.0005);
      if (!inside.containsPoint(new THREE.Vector3(point[0], point[1], point[2]))) {
        state.errors.push(`the close-up focus ${closeupTarget} is outside the model`);
      } else {
        state.badge
          .set(point[0], point[1], point[2])
          .applyMatrix4(holder.matrixWorld);
      }
    } else if (closeupTarget) {
      // The mesh the close-up is framed on is found by name.
      //
      // A name that matches more than one mesh is ambiguous. The old rule
      // kept whichever match the scene happened to visit last, so a manifest
      // that named "Crown" silently framed the seam at the back of the crown
      // while the render showed something else entirely - and the run still
      // reported every check green. A detail render that frames the wrong
      // part is the one failure a reviewer cannot see, so it has to be
      // refused instead.
      //
      // An exact name always wins, which keeps the ordinary case - a
      // manifest naming one mesh - working exactly as before.
      const matches = [];
      model.traverse((child) => {
        if (child.isMesh && child.name.includes(closeupTarget)) matches.push(child);
      });
      const exact = matches.find((child) => child.name === closeupTarget);
      const badgeMesh = exact ?? (matches.length === 1 ? matches[0] : null);
      if (badgeMesh) {
        const box = new THREE.Box3().setFromObject(badgeMesh);
        state.badge.copy(box.getCenter(new THREE.Vector3()));
      } else if (matches.length > 1) {
        // Several meshes answer to the name and none of them is it, so
        // there is no way to tell which one the manifest meant. The names
        // are listed so the manifest can be fixed.
        state.errors.push(
          `the close-up mesh "${closeupTarget}" is ambiguous: ${matches.map((child) => child.name).join(", ")}`,
        );
        state.badge.copy(state.bounds.getCenter(new THREE.Vector3()));
      } else {
        // A named mesh that is not in the model is a typo in the manifest. It
        // must not fall back to a shot of the whole model, or the close-up
        // would pass validation without ever showing the detail it promised.
        state.errors.push(`the close-up mesh "${closeupTarget}" is not in the model`);
        state.badge.copy(state.bounds.getCenter(new THREE.Vector3()));
      }
    } else {
      state.badge.copy(state.bounds.getCenter(new THREE.Vector3()));
    }

    let triangles = 0;
    const meshes = [];
    model.traverse((child) => {
      if (!child.isMesh) return;
      const geometry = child.geometry;
      const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
      triangles += Math.floor(count / 3);
      meshes.push({
        name: child.name || "(unnamed)",
        triangles: Math.floor(count / 3),
        material: child.material?.name || null,
      });
    });
    state.stats = {
      triangles,
      meshes,
      // The mesh's own bounds, as the file holds it: these are the numbers
      // the manifest's frame is written against, and the turn the prop is
      // shown in does not change the file.
      bbox: {
        min: state.modelBounds.min.toArray(),
        max: state.modelBounds.max.toArray(),
        size: state.modelBounds.getSize(new THREE.Vector3()).toArray(),
      },
      badge: state.badge.toArray(),
    };
    renderView("front");
    // The fidelity pass runs before the page says it is ready, so the capture
    // script cannot take the renders and leave before the comparison is done.
    fidelity()
      .catch((error) => state.errors.push(`the fidelity check failed: ${error?.message || error}`))
      .finally(() => {
        state.ready = true;
      });
  },
  undefined,
  (error) => {
    state.errors.push(String(error?.message || error));
    state.ready = true;
  },
);

window.__propCapture = {
  get ready() {
    return state.ready;
  },
  get stats() {
    return state.stats;
  },
  get errors() {
    return state.errors;
  },
  get fidelity() {
    return state.fidelity;
  },
  setView(name) {
    renderView(name);
  },
  render: renderOnce,
};
