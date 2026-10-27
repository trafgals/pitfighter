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

const params = new URLSearchParams(window.location.search);
const modelUrl = params.get("model") || "";
const width = Number(params.get("width") || 900);
const height = Number(params.get("height") || 1100);
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
  badge: new THREE.Vector3(),
  stats: null,
  errors: [],
};

const VIEWS = {
  // fit is the radius, in metres, the view has to contain; margin is how much
  // air to leave around it.
  front: { azimuth: 0, elevation: 0.05, fit: 0.17, margin: 1.22, target: "centre", fov: 30 },
  profile: { azimuth: Math.PI / 2, elevation: 0.04, fit: 0.17, margin: 1.22, target: "centre", fov: 30 },
  rear: { azimuth: Math.PI, elevation: 0.05, fit: 0.17, margin: 1.22, target: "centre", fov: 30 },
  badge: { azimuth: 0.12, elevation: 0.08, fit: 0.048, margin: 1.35, target: "badge", fov: 26 },
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

loader.load(
  modelUrl,
  (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    scene.add(model);
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
    state.bounds.setFromObject(model);

    // Where the badge is, so the close-up can find it without guessing.
    let badgeMesh = null;
    model.traverse((child) => {
      if (child.isMesh && /Brunswick_Star_Badge_Plate/.test(child.name)) badgeMesh = child;
    });
    if (badgeMesh) {
      const box = new THREE.Box3().setFromObject(badgeMesh);
      state.badge.copy(box.getCenter(new THREE.Vector3()));
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
      bbox: {
        min: state.bounds.min.toArray(),
        max: state.bounds.max.toArray(),
        size: state.bounds.getSize(new THREE.Vector3()).toArray(),
      },
      badge: state.badge.toArray(),
    };
    state.ready = true;
    renderView("front");
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
  setView(name) {
    renderView(name);
  },
  render: renderOnce,
};
