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
// How much of the asset each view has to contain, in metres, and where the
// close-up is framed. The capture script passes both in, because a prop's
// size and its detail vary: a helmet's badge and a hat's gold band are not
// the same distance from the camera.
const viewFit = Number(params.get("fit") || 0.17);
const closeupFit = Number(params.get("closeupFit") || 0.048);
// The close-up's target is either a point in the model's own space
// ("x,y,z") or the name of a mesh to centre on.
const closeupTarget = params.get("closeup") || "";
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
      const inside = new THREE.Box3().copy(state.bounds).expandByScalar(0.0005);
      if (!inside.containsPoint(new THREE.Vector3(point[0], point[1], point[2]))) {
        state.errors.push(`the close-up focus ${closeupTarget} is outside the model`);
      } else {
        state.badge.set(point[0], point[1], point[2]);
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
