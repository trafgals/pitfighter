// What each stage looks like. A StageView builds its arena (floor, walls,
// props, surroundings, lights) into one group and animates the stage's own
// state every render frame: the hellfire and the crowd, the machines of the
// construction site, the tiles of the collapsing tower, the blimp's fire,
// wind, the airfield coming up to meet it, the castle's banner. Like the rest of the renderer it
// only reads the World. The hazards, fighters and pickups are the Scene's.
import * as THREE from "three";
import { LAVA_R, RING_R, type Vehicle, type VehicleKind } from "../sim/types";
import { ACTS, BALL_R, BLIMP, CASTLE, PIT, REPAIR, SLICK, TOWER, YARD, onDeck, tileCentre } from "../sim/arena";
import type { StageId } from "../sim/stages";
import type { World } from "../sim/world";
import { PLAYER_COLORS } from "./body";
import { dotTexture } from "./fx";
import { surface } from "./textures";

export const toV = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);
export const yaw = (facing: number) => Math.atan2(Math.cos(facing), -Math.sin(facing));

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  if (typeof document === "undefined") {
    const dt = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    dt.wrapS = dt.wrapT = THREE.RepeatWrapping;
    return dt as unknown as THREE.CanvasTexture;
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });
  return o;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 16): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
}

export abstract class StageView {
  abstract readonly id: StageId;
  readonly group = new THREE.Group();
  abstract readonly background: number;
  abstract readonly fog: [number, number, number];
  /** Animate the stage's own state. `w` is null on the select screen. */
  abstract update(w: World | null, time: number, dt: number, hype: number): void;
  /** Where a fighter in vehicle `v` sits (render units), and which way it faces. */
  seat(v: Vehicle): { pos: THREE.Vector3; facing: number } {
    return { pos: toV(v.x, v.y), facing: v.facing };
  }
  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const x of mats) {
        for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
        x.dispose();
      }
    });
  }

  /** A hemisphere fill, a shadow-casting key light covering `half` metres, and a cold rim light. */
  protected lights(sky: number, ground: number, hemi: number, key: number, keyI: number, half: number, rimC = 0x6080ff, rimI = 0.7): THREE.DirectionalLight {
    this.group.add(new THREE.HemisphereLight(sky, ground, hemi));
    const k = new THREE.DirectionalLight(key, keyI);
    k.position.set(-6, 18, 10);
    k.castShadow = true;
    k.shadow.mapSize.set(2048, 2048);
    const sh = k.shadow.camera as THREE.OrthographicCamera;
    sh.left = sh.bottom = -half;
    sh.right = sh.top = half;
    sh.far = 60;
    this.group.add(k);
    const rim = new THREE.DirectionalLight(rimC, rimI);
    rim.position.set(4, 8, -14);
    this.group.add(rim);
    return k;
  }
}

// ===================================================================== Hell Toilet (The Sump)
class HellToiletView extends StageView {
  readonly id = "hell-toilet" as const;
  readonly background = 0x120504;
  readonly fog: [number, number, number] = [0x240806, 26, 62];
  private lavaTex: THREE.CanvasTexture;
  private lavaLight: THREE.PointLight;
  private embers: THREE.Points;
  private toiletGlow: THREE.PointLight;
  private halo: THREE.Mesh;
  private crowd: THREE.InstancedMesh;
  private crowdBase: { x: number; y: number; z: number; ph: number; sp: number }[] = [];
  private nearRocks: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }[] = [];
  private dummy = new THREE.Object3D();

  constructor() {
    super();
    const sc = this.group;
    this.lights(0xff9872, 0x240604, 0.65, 0xffcfa8, 1.45, 13, 0x6888c8, 0.85);

    // Cracked wet Victorian Sump basalt & iron grate floor, molten furnace glow in the seams
    const basalt = surface("basalt", 2);
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(RING_R, RING_R + 0.25, 0.6, 72),
      new THREE.MeshStandardMaterial({
        ...basalt,
        roughness: 0.55,
        metalness: 0.14,
        emissive: 0xffffff,
        emissiveIntensity: 1.15,
        bumpScale: 2.4,
      }),
    );
    floor.position.y = -0.3;
    floor.receiveShadow = true;
    sc.add(floor);

    // Cast-iron riveted coping curb around the pit edge
    const castIron = new THREE.MeshStandardMaterial({ color: 0x262220, roughness: 0.42, metalness: 0.78 });
    const curb = new THREE.Mesh(new THREE.TorusGeometry(RING_R - 0.08, 0.14, 12, 72), castIron);
    curb.rotation.x = Math.PI / 2;
    curb.position.y = -0.02;
    curb.receiveShadow = true;
    sc.add(curb);

    // Ring of molten Sump slag & hellfire around the floor
    this.lavaTex = canvasTexture(512, 512, (g) => {
      const grd = g.createLinearGradient(0, 0, 512, 512);
      grd.addColorStop(0, "#d92b00");
      grd.addColorStop(0.5, "#ff9a00");
      grd.addColorStop(1, "#c81800");
      g.fillStyle = grd;
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(${110 + Math.random() * 80},${Math.random() * 28},0,0.62)`;
        g.beginPath();
        g.arc(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 30, 0, Math.PI * 2);
        g.fill();
      }
    });
    this.lavaTex.repeat.set(6, 1);
    const lava = new THREE.Mesh(new THREE.RingGeometry(RING_R - 0.05, LAVA_R + 3, 96, 1), new THREE.MeshBasicMaterial({ map: this.lavaTex, side: THREE.DoubleSide }));
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = -0.45;
    sc.add(lava);
    this.lavaLight = new THREE.PointLight(0xff5418, 48, 30, 1.6);
    this.lavaLight.position.set(0, 0.6, 0);
    sc.add(this.lavaLight);

    // Victorian brick & cast-iron sewer pillars around the outer wall (near-edge pillars fade when occluding the low camera)
    const brickSurf = surface("stone", 2, 2);
    const pillarMat = new THREE.MeshStandardMaterial({ ...brickSurf, color: 0x3b231e, roughness: 0.85, bumpScale: 1.8 });
    const brazierFireMat = new THREE.MeshBasicMaterial({ color: 0xffaa38 });
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const isArchPier = i % 2 === 0;
      const h = isArchPier ? 3.2 : 1.9 + (i % 3) * 0.45;
      const rad = LAVA_R + 1.35 + (isArchPier ? 0.15 : 0);
      const rx = Math.cos(a) * rad;
      const rz = Math.sin(a) * rad;
      const isNear = rz > 3.2;
      const mat = isNear
        ? new THREE.MeshStandardMaterial({ ...brickSurf, color: 0x3b231e, roughness: 0.85, bumpScale: 1.8, transparent: true, opacity: 1 })
        : pillarMat;
      const w = isArchPier ? 0.82 : 0.62;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.78, w, h, 8), mat);
      pillar.position.set(rx, h / 2 - 0.5, rz);
      pillar.rotation.y = -a;
      if (isArchPier && !isNear) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.96, w * 0.86, 0.22, 8), castIron);
        cap.position.y = h / 2 + 0.08;
        pillar.add(cap);
        if (i % 4 === 0) {
          const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.2, 0.24, 10), castIron);
          bowl.position.y = h / 2 + 0.28;
          const flame = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), brazierFireMat);
          flame.scale.set(1, 1.35, 1);
          flame.position.y = h / 2 + 0.45;
          pillar.add(bowl, flame);
        }
      }
      if (isNear) this.nearRocks.push({ mesh: pillar, mat });
      sc.add(pillar);
    }

    // THE THRONE OF THE SUMP (Ornate Victorian porcelain & polished brass cistern)
    const porcelain = new THREE.MeshStandardMaterial({ color: 0xd8d0c2, roughness: 0.34, metalness: 0.08 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd49b38, roughness: 0.26, metalness: 0.88, emissive: 0x281200 });
    const toilet = new THREE.Group();
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(0.18, 0), new THREE.Vector2(0.22, 0.2), new THREE.Vector2(0.3, 0.35), new THREE.Vector2(0.34, 0.45), new THREE.Vector2(0.3, 0.46)], 24),
      porcelain,
    );
    const seat = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 10, 24), brass);
    seat.rotation.x = Math.PI / 2;
    seat.position.y = 0.48;
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.46, 0.24), porcelain);
    tank.position.set(0, 0.82, -0.32);
    const tankLid = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.28), brass);
    tankLid.position.set(0, 1.07, -0.32);
    const flushPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 10), brass);
    flushPipe.position.set(0, 0.55, -0.26);
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.64, 0.74, 0.2, 24),
      new THREE.MeshStandardMaterial({ ...basalt, color: 0x381814, roughness: 0.5, metalness: 0.25 }),
    );
    const plinthTrim = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.03, 8, 32), brass);
    plinthTrim.rotation.x = Math.PI / 2;
    plinthTrim.position.y = 0.08;
    toilet.add(bowl, seat, tank, tankLid, flushPipe, plinth, plinthTrim);
    shadowed(toilet);
    // the throne faces south, toward the camera
    toilet.position.set(0, 0.08, 0);
    sc.add(toilet);
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffdfa0 }));
    this.halo.rotation.x = Math.PI / 2;
    this.halo.position.set(0, 1.55, -0.3);
    sc.add(this.halo);
    this.toiletGlow = new THREE.PointLight(0xffd890, 11, 6.5, 2);
    this.toiletGlow.position.set(0, 2.2, 0);
    sc.add(this.toiletGlow);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.95, 14, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe4a0, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = 7;
    sc.add(beam);

    // Rising soft round embers
    const n = 400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = RING_R + Math.random() * 4;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 10;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(
      eg,
      new THREE.PointsMaterial({
        color: 0xffa848,
        map: dotTexture(),
        alphaTest: 0.02,
        size: 0.14,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sc.add(this.embers);

    // Tiered Victorian brickwork gallery behind the Sump, packed with the Shambles crowd
    const galleryBrick = surface("stone", 16, 2);
    const tierMat = new THREE.MeshStandardMaterial({ ...galleryBrick, color: 0x281410, roughness: 0.88, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const r0 = LAVA_R + 3.2 + i * 1.4;
      const h = 0.6 + i * 0.9;
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(r0 + 1.4, r0 + 1.4, h, 64, 1, true), tierMat);
      tier.position.y = h / 2 - 0.4;
      sc.add(tier);
      const top = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 1.4, 64), tierMat);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.2 + i * 0.9 - 0.4 + 0.2;
      sc.add(top);
      const rail = new THREE.Mesh(new THREE.TorusGeometry(r0 + 0.08, 0.05, 8, 64), castIron);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = 0.2 + i * 0.9 + 0.18;
      sc.add(rail);
    }
    const cn = 220;
    this.crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 8), new THREE.MeshStandardMaterial({ roughness: 0.72, emissive: 0x1c0604 }), cn);
    const col = new THREE.Color();
    for (let i = 0; i < cn; i++) {
      const tierI = i % 3;
      const a = (i / cn) * Math.PI * 2 * 3 + tierI * 0.37;
      const r = LAVA_R + 3.9 + tierI * 1.4;
      this.crowdBase.push({ x: Math.cos(a) * r, y: 0.55 + tierI * 0.9, z: Math.sin(a) * r, ph: (i * 2.39) % (Math.PI * 2), sp: 5 + (i % 5) });
      col.setHSL(0.03 + ((i * 37) % 10) / 140, 0.45, 0.16 + ((i * 13) % 7) / 55);
      this.crowd.setColorAt(i, col);
    }
    sc.add(this.crowd);
  }

  update(w: World | null, time: number, dt: number, hype: number): void {
    this.lavaTex.offset.x = time * 0.02;
    this.lavaTex.offset.y = time * 0.05;
    this.lavaLight.intensity = 46 + Math.sin(time * 7.3) * 4 + Math.sin(time * 3.1) * 3;
    const pos = this.embers.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.6 + (i % 7) * 0.15);
      if (y > 10) y = 0;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    this.halo.position.y = 1.55 + Math.sin(time * 2) * 0.06;
    this.halo.rotation.z = time;
    this.toiletGlow.intensity = 11 + Math.sin(time * 3) * 2.5;
    const amp = 0.04 + 0.3 * hype;
    this.crowdBase.forEach((c, i) => {
      this.dummy.position.set(c.x, c.y + Math.abs(Math.sin(time * c.sp + c.ph)) * amp, c.z);
      this.dummy.rotation.set(0, -Math.atan2(c.z, c.x), Math.sin(time * 2 + c.ph) * 0.1);
      this.dummy.updateMatrix();
      this.crowd.setMatrixAt(i, this.dummy.matrix);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
    const rate = dt > 0 && dt < 0.5 ? Math.min(1, dt * 10) : 1;
    for (const { mesh, mat } of this.nearRocks) {
      const rx = mesh.position.x;
      const rz = mesh.position.z;
      const occluded =
        !!w &&
        w.fighters.some((f) => {
          if (f.state === "ko" || f.state === "falling" || f.out) return false;
          const fz = -f.y;
          return fz > 1.5 && rz > fz - 1.5 && Math.abs(f.x - rx) < 5.5;
        });
      const target = occluded ? 0.15 : 1;
      mat.opacity += (target - mat.opacity) * rate;
      mat.depthWrite = mat.opacity > 0.95;
    }
  }
}

// ===================================================================== Construction Site
const CAT_YELLOW = 0xf2b705;
/** where the driver sits in each machine: metres forward of its centre, seat height */
const SEATS: Record<VehicleKind, [number, number]> = {
  bulldozer: [-0.15, 0.95],
  excavator: [0.1, 1.0],
  dumptruck: [0.75, 1.05],
  forklift: [-0.1, 0.6],
  roller: [-0.35, 1.0],
  mixer: [0.8, 1.0],
  loader: [-0.1, 1.0],
  crane: [0.85, 1.05],
};

export interface VehicleView {
  root: THREE.Group;
  body: THREE.Group;
  paint: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshStandardMaterial;
  flag: THREE.MeshBasicMaterial;
  spin: THREE.Object3D | null; // the mixer drum, the roller drum, the excavator's cab
  implement: THREE.Object3D | null; // articulated blade, bucket, forks, boom, bed
  hood: THREE.Object3D | null;
  doorL: THREE.Object3D | null;
  doorR: THREE.Object3D | null;
  exhaust: THREE.Object3D | null;
  headlights: THREE.Mesh[];
  wheels: THREE.Object3D[];
  deformables: { mesh: THREE.Mesh; base: Float32Array }[];
  smoke: number; // render-time smoke spawn accumulator
  kind: VehicleKind;
  wrecked: boolean;
  lastHp: number;
  stage: number;
}

/** Deform subdivided vehicle body/implement meshes inward around `localPt` (in `view.root` local space). */
export function deformVehicle(view: VehicleView, localPt: THREE.Vector3, radius: number, depth: number): void {
  const r2 = radius * radius;
  for (const { mesh, base } of view.deformables) {
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const mx = mesh.position.x;
    const my = mesh.position.y;
    const mz = mesh.position.z;
    let changed = false;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const wx = mx + vx;
      const wy = my + vy;
      const wz = mz + vz;
      const dx = wx - localPt.x;
      const dy = wy - localPt.y;
      const dz = wz - localPt.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      const falloff = (1 - Math.sqrt(d2) / radius) ** 2;
      const crease = 0.82 + 0.36 * Math.sin( base[i * 3] * 9.7 + base[i * 3 + 2] * 11.3 );
      const push = depth * falloff * crease;
      // Crumple inward toward chassis core and downward on heavy blows
      const nx = vx - Math.sign(wx || 1) * push * 0.85;
      const ny = vy - push * 0.35 + Math.sin(base[i * 3] * 14) * push * 0.25;
      const nz = vz - Math.sign(wz || 1) * push * 0.85;
      // Clamp maximum displacement relative to base vertex so geometry stays coherent
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const bz = base[i * 3 + 2];
      pos.setXYZ(
        i,
         THREE.MathUtils.clamp(nx, bx - 0.42, bx + 0.42),
        THREE.MathUtils.clamp(ny, by - 0.35, by + 0.35),
        THREE.MathUtils.clamp(nz, bz - 0.42, bz + 0.42),
      );
      changed = true;
    }
    if (changed) {
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }
  }
}

/** A high-detail construction machine built from articulated & deformable parts, facing +x in its own space (sim facing 0). */
export function buildVehicle(kind: VehicleKind): VehicleView {
  const root = new THREE.Group();
  const body = new THREE.Group(); // faces +x
  root.add(body);
  const paint = new THREE.MeshStandardMaterial({
    color: kind === "mixer" ? 0xe8e4dc : kind === "forklift" ? 0xff7a10 : CAT_YELLOW,
    roughness: 0.48,
    metalness: 0.28,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22201e, roughness: 0.85, metalness: 0.35 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 0.82 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8e0e8, roughness: 0.16, metalness: 0.94 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd49b38, roughness: 0.28, metalness: 0.86 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x74accf, roughness: 0.12, metalness: 0.3, transparent: true, opacity: 0.46 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0b8 });

  const deformables: { mesh: THREE.Mesh; base: Float32Array }[] = [];
  const wheels: THREE.Object3D[] = [];
  const headlights: THREE.Mesh[] = [];
  let doorL: THREE.Object3D | null = null;
  let doorR: THREE.Object3D | null = null;
  let hood: THREE.Object3D | null = null;
  let exhaust: THREE.Object3D | null = null;
  let implement: THREE.Object3D | null = null;
  let spin: THREE.Object3D | null = null;

  const dBox = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = body) => {
    const geo = new THREE.BoxGeometry(w, h, d, 6, 4, 6);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    deformables.push({ mesh: m, base: new Float32Array(pos.array) });
    return m;
  };

  const wheel = (x: number, z: number, r = 0.42, w = 0.32) => {
    const wg = new THREE.Group();
    const tire = cyl(r, r, w, dark, 20);
    tire.rotation.x = Math.PI / 2;
    const rim = cyl(r * 0.56, r * 0.56, w + 0.02, paint, 14);
    rim.rotation.x = Math.PI / 2;
    const hub = cyl(r * 0.22, r * 0.22, w + 0.05, brass, 10);
    hub.rotation.x = Math.PI / 2;
    wg.add(tire, rim, hub);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const lug = box(0.06, 0.05, w * 0.92, dark, Math.cos(a) * (r - 0.01), Math.sin(a) * (r - 0.01), 0);
      lug.rotation.z = a;
      wg.add(lug);
    }
    wg.position.set(x, r, z);
    body.add(wg);
    wheels.push(wg);
  };

  const tracks = (len: number, z: number) => {
    const tg = new THREE.Group();
    tg.add(dBox(len, 0.52, 0.44, dark, 0, 0.28, 0, tg));
    // Drive sprocket, front idler, and bogie rollers
    const spF = cyl(0.24, 0.24, 0.48, steel, 14);
    spF.rotation.x = Math.PI / 2;
    spF.position.set(len * 0.42, 0.28, 0);
    const spR = cyl(0.24, 0.24, 0.48, brass, 14);
    spR.rotation.x = Math.PI / 2;
    spR.position.set(-len * 0.42, 0.28, 0);
    tg.add(spF, spR);
    for (let k = -2; k <= 2; k++) {
      const grouser = box(0.08, 0.05, 0.46, steel, k * (len * 0.18), 0.55, 0);
      tg.add(grouser);
    }
    tg.position.set(0, 0, z);
    body.add(tg);
    wheels.push(tg);
  };

  const buildEngineHood = (x: number, y: number, w: number, h: number, d: number, mat: THREE.Material = paint) => {
    const hg = new THREE.Group();
    dBox(w, h, d, mat, 0, h / 2, 0, hg);
    // Radiator grille & brass trim
    hg.add(box(0.04, h * 0.72, d * 0.74, dark, w / 2 + 0.01, h * 0.5, 0));
    hg.add(box(0.05, h * 0.78, 0.04, brass, w / 2 + 0.015, h * 0.5, d * 0.38));
    hg.add(box(0.05, h * 0.78, 0.04, brass, w / 2 + 0.015, h * 0.5, -d * 0.38));
    for (let i = 0; i < 4; i++) {
      hg.add(box(0.05, 0.025, d * 0.68, steel, w / 2 + 0.02, h * (0.22 + i * 0.17), 0));
    }
    hg.position.set(x, y, 0);
    body.add(hg);
    hood = hg;
    // Vertical exhaust stack with rain-cap
    const ex = new THREE.Group();
    const pipe = cyl(0.045, 0.055, 0.75, dark, 10);
    pipe.position.y = 0.375;
    const muffler = cyl(0.085, 0.085, 0.32, steel, 10);
    muffler.position.y = 0.22;
    const cap = box(0.13, 0.025, 0.13, brass, 0.02, 0.76, 0);
    cap.rotation.z = -0.25;
    ex.add(pipe, muffler, cap);
    ex.position.set(x + w * 0.15, y + h, -d * 0.38);
    body.add(ex);
    exhaust = ex;
    // Twin brass headlamps
    for (const sz of [-1, 1]) {
      const lamp = new THREE.Group();
      const housing = cyl(0.075, 0.06, 0.1, brass, 12);
      housing.rotation.z = Math.PI / 2;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.068, 12), bulbMat);
      lens.rotation.y = Math.PI / 2;
      lens.position.x = 0.055;
      lamp.add(housing, lens);
      lamp.position.set(x + w / 2 + 0.02, y + h * 0.68, sz * (d * 0.42));
      body.add(lamp);
      headlights.push(lens);
    }
  };

  const cab = (x: number, y: number, w = 0.9, h = 0.9, d = 1.1) => {
    const frame = new THREE.Group();
    dBox(w + 0.06, 0.08, d + 0.06, paint, 0, h, 0, frame);
    for (const [px, pz] of [
      [w / 2, d / 2],
      [-w / 2, d / 2],
      [w / 2, -d / 2],
      [-w / 2, -d / 2],
    ]) {
      frame.add(box(0.06, h, 0.06, dark, px, h / 2, pz));
    }
    // Front & rear glass
    frame.add(box(0.02, h * 0.68, d * 0.92, glassMat, w / 2, h * 0.56, 0));
    frame.add(box(0.02, h * 0.55, d * 0.88, glassMat, -w / 2, h * 0.6, 0));
    // Hinged Left & Right breakaway cab doors
    const mkDoor = (side: 1 | -1) => {
      const dg = new THREE.Group();
      dBox(w * 0.86, h * 0.44, 0.04, paint, -w * 0.43, h * 0.24, 0, dg);
      dg.add(box(w * 0.78, h * 0.38, 0.02, glassMat, -w * 0.43, h * 0.64, 0));
      dg.add(box(0.14, 0.03, 0.05, brass, -w * 0.72, h * 0.42, side * 0.03));
      dg.position.set(w * 0.43, 0.04, side * (d / 2 + 0.01));
      frame.add(dg);
      return dg;
    };
    doorL = mkDoor(1);
    doorR = mkDoor(-1);
    frame.position.set(x, y, 0);
    body.add(frame);
  };

  switch (kind) {
    case "bulldozer": {
      tracks(2.05, 0.68);
      tracks(2.05, -0.68);
      buildEngineHood(0.05, 0.52, 1.55, 0.62, 1.02);
      cab(-0.42, 1.1, 0.88, 0.92, 1.06);
      const bladeG = new THREE.Group();
      const mainBlade = dBox(0.22, 0.88, 2.38, steel, 1.28, 0.52, 0, bladeG);
      mainBlade.rotation.z = -0.14;
      // Curved top spill guard & side cheek plates
      const topGuard = box(0.18, 0.22, 2.34, steel, 1.22, 1.0, 0);
      topGuard.rotation.z = 0.28;
      bladeG.add(
        topGuard,
        box(0.36, 0.82, 0.06, steel, 1.18, 0.5, 1.16),
        box(0.36, 0.82, 0.06, steel, 1.18, 0.5, -1.16),
        box(0.65, 0.12, 0.12, paint, 0.95, 0.36, 0.62),
        box(0.65, 0.12, 0.12, paint, 0.95, 0.36, -0.62),
      );
      // Twin hydraulic lift cylinders
      for (const sz of [-0.46, 0.46]) {
        const cylB = cyl(0.06, 0.06, 0.72, dark, 10);
        cylB.position.set(0.88, 0.88, sz);
        cylB.rotation.z = -0.45;
        const rod = cyl(0.035, 0.035, 0.5, chrome, 8);
        rod.position.set(1.06, 0.66, sz);
        rod.rotation.z = -0.45;
        bladeG.add(cylB, rod);
      }
      // Rear 3-shank ripper
      for (const sz of [-0.35, 0, 0.35]) {
        const shank = box(0.12, 0.45, 0.06, steel, -1.12, 0.38, sz);
        shank.rotation.z = 0.35;
        body.add(shank);
      }
      body.add(bladeG);
      implement = bladeG;
      break;
    }
    case "excavator": {
      tracks(2.2, 0.72);
      tracks(2.2, -0.72);
      const top = new THREE.Group();
      dBox(1.65, 0.58, 1.44, paint, -0.22, 0.0, 0, top);
      // Counterweight & engine louvres at rear
      dBox(0.38, 0.62, 1.48, dark, -0.95, 0.04, 0, top);
      const armG = new THREE.Group();
      const boom = dBox(1.75, 0.24, 0.26, paint, 0.85, 0.58, 0.32, armG);
      boom.rotation.z = 0.52;
      const boomCyl = cyl(0.05, 0.05, 1.1, chrome, 10);
      boomCyl.rotation.z = -0.95;
      boomCyl.position.set(0.68, 0.38, 0.32);
      const stick = dBox(1.22, 0.19, 0.2, paint, 1.92, 0.72, 0.32, armG);
      stick.rotation.z = -0.98;
      dBox(0.48, 0.42, 0.58, steel, 2.28, 0.15, 0.32, armG);
      for (let t = -2; t <= 2; t++) {
        armG.add(box(0.18, 0.04, 0.05, brass, 2.52, 0.02, 0.32 + t * 0.11));
      }
      armG.add(boomCyl);
      top.add(armG);
      top.position.y = 0.85;
      body.add(top);
      buildEngineHood(-0.35, 0.85, 0.9, 0.52, 0.85);
      cab(0.12, 1.1, 0.82, 0.9, 0.72);
      spin = top;
      implement = armG;
      break;
    }
    case "dumptruck": {
      wheel(1.0, 0.76, 0.5);
      wheel(1.0, -0.76, 0.5);
      wheel(-0.8, 0.76, 0.5);
      wheel(-0.8, -0.76, 0.5);
      dBox(2.65, 0.32, 1.32, dark, 0, 0.6, 0);
      buildEngineHood(1.02, 0.74, 0.62, 0.55, 1.14);
      cab(0.62, 0.75, 0.78, 0.86, 1.2);
      const bed = new THREE.Group();
      dBox(1.58, 0.1, 1.54, paint, 0, 0, 0, bed);
      dBox(1.58, 0.64, 0.09, paint, 0, 0.32, 0.73, bed);
      dBox(1.58, 0.64, 0.09, paint, 0, 0.32, -0.73, bed);
      dBox(0.09, 0.76, 1.54, paint, 0.75, 0.38, 0, bed);
      // Canopy spill shield over cab & structural side ribs
      bed.add(box(0.48, 0.07, 1.54, paint, 0.95, 0.76, 0));
      for (let r = -2; r <= 2; r++) {
        bed.add(box(0.06, 0.62, 0.05, steel, r * 0.3, 0.32, 0.78));
        bed.add(box(0.06, 0.62, 0.05, steel, r * 0.3, 0.32, -0.78));
      }
      // Tailgate
      dBox(0.07, 0.6, 1.48, steel, -0.76, 0.32, 0, bed);
      bed.position.set(-0.56, 0.82, 0);
      bed.rotation.z = 0.05;
      body.add(bed);
      implement = bed;
      break;
    }
    case "forklift": {
      wheel(0.45, 0.46, 0.28, 0.22);
      wheel(0.45, -0.46, 0.28, 0.22);
      wheel(-0.45, 0.46, 0.24, 0.2);
      wheel(-0.45, -0.46, 0.24, 0.2);
      buildEngineHood(-0.12, 0.26, 1.18, 0.5, 0.94);
      dBox(0.42, 0.56, 0.92, dark, -0.58, 0.68, 0);
      cab(-0.05, 0.6, 0.72, 1.1, 0.86);
      // Dual mast rails & hydraulic lift cylinder
      body.add(
        box(0.08, 2.05, 0.08, steel, 0.65, 1.02, 0.32),
        box(0.08, 2.05, 0.08, steel, 0.65, 1.02, -0.32),
        box(0.06, 0.08, 0.68, dark, 0.65, 1.95, 0),
        box(0.06, 0.08, 0.68, dark, 0.65, 1.1, 0),
      );
      const liftCyl = cyl(0.045, 0.045, 1.6, chrome, 10);
      liftCyl.position.set(0.62, 0.95, 0);
      body.add(liftCyl);
      const forkG = new THREE.Group();
      forkG.add(
        box(0.06, 0.55, 0.74, dark, 0.72, 0.48, 0),
        dBox(0.95, 0.05, 0.13, steel, 1.14, 0.22, 0.25, forkG),
        dBox(0.95, 0.05, 0.13, steel, 1.14, 0.22, -0.25, forkG),
      );
      body.add(forkG);
      implement = forkG;
      break;
    }
    case "roller": {
      const drum = cyl(0.56, 0.56, 1.74, steel, 28);
      drum.rotation.x = Math.PI / 2;
      drum.position.set(0.85, 0.56, 0);
      // Yoke frame & scraper bar around compactor drum
      const yoke = new THREE.Group();
      dBox(0.45, 0.32, 1.84, paint, 0.85, 1.12, 0, yoke);
      yoke.add(
        box(0.55, 0.12, 0.08, paint, 0.65, 0.65, 0.92),
        box(0.55, 0.12, 0.08, paint, 0.65, 0.65, -0.92),
        box(0.05, 0.08, 1.76, brass, 1.44, 0.58, 0),
      );
      body.add(drum, yoke);
      wheel(-0.7, 0.76, 0.5, 0.36);
      wheel(-0.7, -0.76, 0.5, 0.36);
      buildEngineHood(-0.52, 0.52, 1.38, 0.56, 1.18);
      cab(-0.4, 1.05, 0.85, 0.85, 1.0);
      spin = drum;
      implement = yoke;
      break;
    }
    case "mixer": {
      wheel(1.0, 0.72, 0.45);
      wheel(1.0, -0.72, 0.45);
      wheel(-0.6, 0.72, 0.45);
      wheel(-0.6, -0.72, 0.45);
      wheel(-1.1, 0.72, 0.45);
      wheel(-1.1, -0.72, 0.45);
      dBox(2.85, 0.32, 1.22, dark, 0, 0.55, 0);
      const cabPaint = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.45, metalness: 0.25 });
      buildEngineHood(0.98, 0.7, 0.78, 0.58, 1.18, cabPaint);
      cab(0.84, 0.75, 0.8, 0.85, 1.2);
      const drumG = new THREE.Group();
      const drumGeo = new THREE.SphereGeometry(0.72, 20, 14);
      const drum = new THREE.Mesh(drumGeo, paint);
      drum.scale.set(1.52, 1, 1);
      deformables.push({ mesh: drum, base: new Float32Array((drumGeo.getAttribute("position") as THREE.BufferAttribute).array) });
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.4 });
      for (const sx of [-0.35, 0, 0.35]) {
        const st = new THREE.Mesh(new THREE.TorusGeometry(0.66 - Math.abs(sx) * 0.2, 0.045, 6, 24), stripeMat);
        st.rotation.y = Math.PI / 2 + 0.28;
        st.position.x = sx;
        drumG.add(st);
      }
      drumG.add(drum);
      drumG.position.set(-0.48, 1.42, 0);
      drumG.rotation.z = 0.24;
      // Rear charging hopper & swiveling discharge chute
      const chuteG = new THREE.Group();
      chuteG.add(
        box(0.35, 0.45, 0.5, steel, -1.35, 1.65, 0),
        box(0.75, 0.1, 0.26, steel, -1.58, 1.12, 0.18),
      );
      body.add(drumG, chuteG);
      spin = drumG;
      implement = chuteG;
      break;
    }
    case "loader": {
      wheel(0.6, 0.72, 0.5, 0.36);
      wheel(0.6, -0.72, 0.5, 0.36);
      wheel(-0.7, 0.72, 0.5, 0.36);
      wheel(-0.7, -0.72, 0.5, 0.36);
      buildEngineHood(-0.18, 0.52, 1.85, 0.56, 1.1);
      cab(-0.2, 1.05, 0.85, 0.9, 1.0);
      const scoopG = new THREE.Group();
      scoopG.add(
        box(0.88, 0.13, 0.14, paint, 1.12, 0.76, 0.46),
        box(0.88, 0.13, 0.14, paint, 1.12, 0.76, -0.46),
      );
      const bucket = dBox(0.62, 0.58, 2.04, steel, 1.62, 0.5, 0, scoopG);
      bucket.rotation.z = 0.28;
      for (let t = -3; t <= 3; t++) {
        scoopG.add(box(0.2, 0.04, 0.06, brass, 1.95, 0.24, t * 0.26));
      }
      body.add(scoopG);
      implement = scoopG;
      break;
    }
    case "crane": {
      wheel(1.0, 0.76, 0.48);
      wheel(1.0, -0.76, 0.48);
      wheel(-0.4, 0.76, 0.48);
      wheel(-0.4, -0.76, 0.48);
      wheel(-1.0, 0.76, 0.48);
      wheel(-1.0, -0.76, 0.48);
      dBox(2.85, 0.36, 1.36, paint, 0, 0.65, 0);
      // Outrigger stabilizer beams
      for (const [ox, oz] of [[0.6, 0.82], [0.6, -0.82], [-0.9, 0.82], [-0.9, -0.82]]) {
        body.add(box(0.18, 0.14, 0.35, dark, ox, 0.42, oz), cyl(0.16, 0.2, 0.08, steel, 10));
      }
      buildEngineHood(-0.88, 0.82, 0.85, 0.52, 1.04);
      cab(0.85, 0.82, 0.8, 0.85, 1.3);
      const boomG = new THREE.Group();
      const boom = dBox(3.65, 0.32, 0.36, paint, -0.1, 1.95, 0, boomG);
      boom.rotation.z = 0.5;
      const innerBoom = box(1.4, 0.22, 0.24, steel, 1.25, 2.68, 0);
      innerBoom.rotation.z = 0.5;
      const cable = box(0.03, 1.15, 0.03, dark, 1.65, 2.22, 0);
      const hookBlock = box(0.16, 0.26, 0.16, brass, 1.65, 1.62, 0);
      boomG.add(innerBoom, cable, hookBlock);
      body.add(boomG);
      implement = boomG;
      break;
    }
  }
  // a player-coloured flag on a whip antenna says who is at the wheel
  const flag = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide });
  const ant = box(0.03, 1.2, 0.03, dark, -0.9, 2.0, 0.5);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.28), flag);
  fl.position.set(-0.68, 2.45, 0.5);
  body.add(ant, fl);
  shadowed(root);
  return {
    root,
    body,
    paint,
    glassMat,
    flag,
    spin,
    implement,
    hood,
    doorL,
    doorR,
    exhaust,
    headlights,
    wheels,
    deformables,
    smoke: 0,
    kind,
    wrecked: false,
    lastHp: -1,
    stage: 0,
  };
}

class ConstructionView extends StageView {
  readonly id = "construction-site" as const;
  readonly background = 0x9fb4c8;
  readonly fog: [number, number, number] = [0xa8b8c8, 34, 95];
  private views: VehicleView[] = [];
  private smoke: THREE.Points;
  private smokeAge: Float32Array;
  private smokeN = 0;
  private beacons: THREE.PointLight[] = [];
  private bars: { root: THREE.Group; fill: THREE.Mesh }[] = [];
  private slices: THREE.Mesh[] = [];
  private sackMeshes = new Map<number, THREE.Object3D>();
  private slickMeshes: THREE.Mesh[] = [];
  private pileMeshes: THREE.Mesh[] = [];
  private ball: THREE.Group;
  private debris: { mesh: THREE.Object3D; vx: number; vy: number; vz: number; rx: number; rz: number; age: number }[] = [];

  constructor() {
    super();
    const g = this.group;
    this.lights(0xdde8ff, 0x6a5a40, 0.75, 0xfff2d8, 1.9, 16, 0xa0c0ff, 0.4);

    // the yard: packed dirt and gravel inside, mud outside
    const dirt = surface("dirt", 3, 2);
    const yard = new THREE.Mesh(new THREE.BoxGeometry(YARD.hx * 2, 0.4, YARD.hy * 2), new THREE.MeshStandardMaterial({ ...dirt, roughness: 1, bumpScale: 2 }));
    yard.position.y = -0.2;
    yard.receiveShadow = true;
    g.add(yard);
    const mud = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x5e5040, roughness: 1 }));
    mud.rotation.x = -Math.PI / 2;
    mud.position.y = -0.05;
    mud.receiveShadow = true;
    g.add(mud);

    // jersey barriers all round: the yard's walls
    const conc = new THREE.MeshStandardMaterial({ ...surface("concrete", 2, 1), roughness: 0.95 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.6 });
    const barrier = (x: number, z: number, along: boolean, len: number) => {
      const b = new THREE.Group();
      const shape = new THREE.Shape();
      shape.moveTo(-0.35, 0);
      shape.lineTo(0.35, 0);
      shape.lineTo(0.18, 0.3);
      shape.lineTo(0.12, 0.85);
      shape.lineTo(-0.12, 0.85);
      shape.lineTo(-0.18, 0.3);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: len - 0.08, bevelEnabled: false });
      geo.translate(0, 0, -(len - 0.08) / 2);
      b.add(new THREE.Mesh(geo, conc));
      const st = box(0.26, 0.1, len - 0.1, stripe, 0, 0.7, 0);
      b.add(st);
      b.position.set(x, 0, z);
      if (along) b.rotation.y = Math.PI / 2;
      g.add(shadowed(b));
    };
    const seg = 2;
    for (let x = -YARD.hx + seg / 2; x < YARD.hx; x += seg) {
      barrier(x, -(YARD.hy + 0.35), true, seg);
      barrier(x, YARD.hy + 0.35, true, seg);
    }
    for (let y = -YARD.hy + seg / 2; y < YARD.hy; y += seg) {
      barrier(-(YARD.hx + 0.35), y, false, seg);
      barrier(YARD.hx + 0.35, y, false, seg);
    }

    // chain-link fence and floodlights behind the barriers
    const fenceTex = canvasTexture(64, 64, (c) => {
      c.strokeStyle = "rgba(200,200,200,0.9)";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(64, 64);
      c.moveTo(64, 0);
      c.lineTo(0, 64);
      c.stroke();
    });
    fenceTex.repeat.set(30, 3);
    const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 });
    const fence = (w: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.4), fenceMat);
      m.position.set(x, 1.2, z);
      m.rotation.y = ry;
      g.add(m);
    };
    fence(YARD.hx * 2 + 6, 0, -(YARD.hy + 3), 0);
    fence(YARD.hy * 2 + 6, -(YARD.hx + 3), 0, Math.PI / 2);
    fence(YARD.hy * 2 + 6, YARD.hx + 3, 0, Math.PI / 2);

    // a half-built steel frame, Victorian gasometer guide-frame, and a tower crane at the back of the site
    const girder = new THREE.MeshStandardMaterial({ color: 0xb0381c, roughness: 0.6, metalness: 0.5 });
    const frame = new THREE.Group();
    for (let i = 0; i < 5; i++)
      for (let k = 0; k < 3; k++) {
        const h = 3.5 * (k + 1);
        if (i > 3 && k > 1) continue;
        frame.add(box(0.25, 3.5, 0.25, girder, i * 3.5, h - 1.75, 0), box(0.25, 3.5, 0.25, girder, i * 3.5, h - 1.75, 3.5));
        frame.add(box(3.5, 0.25, 0.25, girder, i * 3.5 + 1.75, h, 0), box(0.25, 0.25, 3.5, girder, i * 3.5, h, 1.75));
      }
    frame.position.set(-7, 0, -(YARD.hy + 8));
    g.add(shadowed(frame, true, false));
    // Victorian Limehouse telescopic Gasometer & brick railway viaduct arches
    const ironFrameMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.5, metalness: 0.78 });
    const gasometer = new THREE.Group();
    const gasDrum = cyl(5.2, 5.2, 7.5, new THREE.MeshStandardMaterial({ color: 0x483830, roughness: 0.7, metalness: 0.5 }), 24);
    gasDrum.position.y = 3.75;
    gasometer.add(gasDrum);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      gasometer.add(box(0.28, 14, 0.28, ironFrameMat, Math.cos(a) * 5.6, 7, Math.sin(a) * 5.6));
    }
    for (const h of [5, 9.5, 13.8]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.14, 8, 24), ironFrameMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = h;
      gasometer.add(ring);
    }
    gasometer.position.set(-18, 0, -(YARD.hy + 12));
    g.add(gasometer);

    const tc = new THREE.Group();
    const mast = box(1, 24, 1, new THREE.MeshStandardMaterial({ color: CAT_YELLOW, wireframe: true }), 0, 12, 0);
    const jib = box(22, 0.8, 0.8, new THREE.MeshStandardMaterial({ color: CAT_YELLOW, wireframe: true }), 5, 24, 0);
    const cw = box(2, 1.2, 1.2, new THREE.MeshStandardMaterial({ color: 0x777777 }), -5, 23.4, 0);
    const cable = box(0.04, 10, 0.04, new THREE.MeshStandardMaterial({ color: 0x222222 }), 10, 19, 0);
    tc.add(mast, jib, cw, cable);
    tc.position.set(10, 0, -(YARD.hy + 10));
    tc.rotation.y = 0.5;
    g.add(tc);

    // props outside the barriers: pipe stacks, a portable toilet (of course), cones, sand piles
    const pipe = new THREE.MeshStandardMaterial({ color: 0x6a7076, metalness: 0.7, roughness: 0.4 });
    for (let i = 0; i < 6; i++) {
      const p = cyl(0.3, 0.3, 4, pipe, 14);
      p.rotation.z = Math.PI / 2;
      p.position.set(YARD.hx + 5, 0.3 + Math.floor(i / 3) * 0.55, -3 + (i % 3) * 0.62 + (i > 2 ? 0.3 : 0));
      g.add(shadowed(p));
    }
    const loo = new THREE.Group();
    loo.add(box(1.1, 2.3, 1.1, new THREE.MeshStandardMaterial({ color: 0x2060d0, roughness: 0.6 }), 0, 1.15, 0), box(1.2, 0.12, 1.2, new THREE.MeshStandardMaterial({ color: 0xeeeeee }), 0, 2.36, 0));
    loo.position.set(-(YARD.hx + 4.5), 0, 4);
    g.add(shadowed(loo));
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 12), coneMat);
      c.position.set(Math.cos(a) * (YARD.hx + 1.6) * (1 + (i % 2) * 0.1), 0.27, Math.sin(a) * (YARD.hy + 1.6));
      g.add(c);
    }
    const sand = new THREE.MeshStandardMaterial({ color: 0xc8a870, roughness: 1 });
    for (const [x, z, r] of [
      [-(YARD.hx + 6), -6, 3],
      [YARD.hx + 7, 6, 2.5],
      [-3, YARD.hy + 9, 4],
    ]) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, r * 0.8, 20), sand);
      m.position.set(x, r * 0.4 - 0.05, z);
      g.add(m);
    }
    // the city skyline beyond the site
    const city = new THREE.MeshStandardMaterial({ color: 0x8090a8, roughness: 0.9 });
    for (let i = 0; i < 40; i++) {
      const a = Math.PI * (0.05 + (0.9 * i) / 40);
      const r = 55 + (i % 5) * 4;
      const h = 8 + ((i * 7919) % 23);
      const b = box(4 + (i % 3) * 2, h, 4 + (i % 4), city, Math.cos(a) * r, h / 2, -Math.sin(a) * r);
      g.add(b);
    }

    // volumetric smoke from damaged and wrecked machines (using soft radial dotTexture)
    const sn = 180;
    const sp = new Float32Array(sn * 3).fill(-999);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    this.smoke = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: 0x302a26,
        map: dotTexture(),
        alphaTest: 0.02,
        size: 1.15,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
    );
    this.smokeAge = new Float32Array(sn).fill(99);
    g.add(this.smoke);

    // the foundation pit: a dark hole with a timber kerb, filled slice by slice with each fighter's share
    const kerb = new THREE.Mesh(new THREE.CylinderGeometry(PIT.r + 0.3, PIT.r + 0.3, 0.08, 28), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 }));
    kerb.position.y = 0.04;
    kerb.receiveShadow = true;
    g.add(kerb);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(PIT.r, PIT.r, 0.1, 28), new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 }));
    hole.position.y = 0.06;
    g.add(hole);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xff7a10, roughness: 0.6 }));
      post.position.set(Math.cos(a) * (PIT.r + 0.45), 0.45, Math.sin(a) * (PIT.r + 0.45));
      g.add(post);
    }
    // the wrecking ball
    this.ball = new THREE.Group();
    const bm = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 14), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.35, metalness: 0.85 }));
    bm.castShadow = true;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.8, roughness: 0.4 }));
    chain.position.y = 1.2;
    this.ball.add(bm, chain);
    this.ball.visible = false;
    g.add(this.ball);
  }

  seat(v: Vehicle): { pos: THREE.Vector3; facing: number } {
    const [fwd, h] = SEATS[v.kind];
    // the seat pose's hips sit 0.52 m above the root
    return { pos: toV(v.x + Math.cos(v.facing) * fwd, v.y + Math.sin(v.facing) * fwd, h - 0.52), facing: v.facing };
  }

  private detachPart(part: THREE.Object3D | null, vx: number, vy: number, vz: number): void {
    if (!part || !part.parent) return;
    const worldPos = part.getWorldPosition(new THREE.Vector3());
    const worldQuat = part.getWorldQuaternion(new THREE.Quaternion());
    part.parent.remove(part);
    part.position.copy(worldPos);
    part.quaternion.copy(worldQuat);
    this.group.add(part);
    this.debris.push({ mesh: part, vx, vy, vz, rx: (Math.random() - 0.5) * 9, rz: (Math.random() - 0.5) * 9, age: 0 });
  }

  /** The foundation, the sacks, the poured cement, tipped loads and the wrecking ball. */
  private updateYard(w: World | null, time: number): void {
    const a = w?.s.arena;
    const fs = w?.s.fighters ?? [];
    while (this.slices.length < fs.length) {
      const i = this.slices.length;
      const n = fs.length;
      const slice = new THREE.Mesh(
        new THREE.CylinderGeometry(PIT.r * 0.96, PIT.r * 0.96, 1, 18, 1, false, (i / n) * Math.PI * 2, (1 / n) * Math.PI * 2 - 0.04),
        new THREE.MeshStandardMaterial({ color: PLAYER_COLORS[i], roughness: 0.8 }),
      );
      this.group.add(slice);
      this.slices.push(slice);
    }
    this.slices.forEach((sl, i) => {
      const share = Math.min(1, (fs[i]?.toilet ?? 0) / PIT.need);
      const h = 0.02 + share * 0.9;
      sl.scale.y = h;
      sl.position.y = 0.1 + h / 2;
    });
    // sacks: one mesh each, on the ground or on a carrier's shoulder
    const seen = new Set<number>();
    for (const sk of a?.sacks ?? []) {
      seen.add(sk.id);
      let m = this.sackMeshes.get(sk.id);
      if (!m) {
        m = new THREE.Group();
        if (sk.kind === "cement") {
          const bag = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.4), new THREE.MeshStandardMaterial({ color: 0xcfc6a8, roughness: 0.95 }));
          const band = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.225, 0.12), new THREE.MeshStandardMaterial({ color: 0xc03020, roughness: 0.9 }));
          bag.position.y = 0.11;
          band.position.y = 0.11;
          m.add(bag, band);
        } else {
          const mat = new THREE.MeshStandardMaterial({ color: 0x7c7468, roughness: 1, flatShading: true });
          for (let k = 0; k < 3; k++) {
            const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17 + 0.04 * k, 0), mat);
            rock.position.set((k - 1) * 0.2, 0.15, (((k * 7) % 3) - 1) * 0.1);
            rock.rotation.set(k, k * 2, 0);
            m.add(rock);
          }
        }
        m.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
        });
        this.group.add(m);
        this.sackMeshes.set(sk.id, m);
      }
      m.position.set(sk.x, sk.carrier >= 0 ? 1.45 + Math.sin(time * 9) * 0.02 : 0, -sk.y);
      m.rotation.y = sk.carrier >= 0 ? -(fs[sk.carrier]?.facing ?? 0) + Math.PI / 2 : sk.id * 1.7;
    }
    for (const [id, m] of this.sackMeshes) {
      if (seen.has(id)) continue;
      this.group.remove(m);
      this.sackMeshes.delete(id);
    }
    // poured cement
    const slicks = a?.slicks ?? [];
    while (this.slickMeshes.length < slicks.length) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(SLICK.r, SLICK.r, 0.04, 22), new THREE.MeshStandardMaterial({ color: 0x8c887c, roughness: 0.15, metalness: 0.1 }));
      m.receiveShadow = true;
      this.group.add(m);
      this.slickMeshes.push(m);
    }
    this.slickMeshes.forEach((m, i) => {
      const sl = slicks[i];
      m.visible = !!sl;
      if (!sl) return;
      m.position.set(sl.x, 0.03, -sl.y);
      const set = sl.t >= SLICK.set;
      const grow = Math.min(1, sl.t / 12);
      m.scale.set(grow, 1, grow);
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.setHex(set ? 0xaaa69c : 0x7a766c);
      mat.roughness = set ? 0.95 : 0.12;
    });
    // tipped loads
    const piles = a?.piles ?? [];
    while (this.pileMeshes.length < piles.length) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.0, 9), new THREE.MeshStandardMaterial({ color: 0x8a7e6a, roughness: 1, flatShading: true }));
      m.castShadow = true;
      this.group.add(m);
      this.pileMeshes.push(m);
    }
    this.pileMeshes.forEach((m, i) => {
      const p = piles[i];
      m.visible = !!p;
      if (!p) return;
      const k = Math.min(1, p.t / 10) * (p.t > 320 ? Math.max(0, 1 - (p.t - 320) / 100) : 1);
      m.position.set(p.x, 0.5 * k, -p.y);
      m.scale.set(1, Math.max(0.01, k), 1);
    });
    // the wrecking ball
    this.ball.visible = false;
    for (const v of a?.vehicles ?? []) {
      if (v.kind !== "crane" || v.wrecked || v.act < ACTS.crane.hit) continue;
      const ang = v.facing + ((v.act - ACTS.crane.hit) / (ACTS.crane.dur - ACTS.crane.hit)) * Math.PI * 2;
      this.ball.visible = true;
      this.ball.position.set(v.x + Math.cos(ang) * BALL_R, 0.7, -(v.y + Math.sin(ang) * BALL_R));
    }
  }

  update(w: World | null, time: number, dt: number): void {
    const vs = w?.s.arena.vehicles ?? [];
    while (this.views.length < vs.length) {
      const v = buildVehicle(vs[this.views.length].kind);
      v.lastHp = vs[this.views.length].hp;
      this.views.push(v);
      this.group.add(v.root);
      const b = new THREE.PointLight(0xffa000, 0, 6, 2);
      b.position.set(-0.2, 2.0, 0);
      v.root.add(b);
      this.beacons.push(b);
      const bar = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.2), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
      const fill = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 0.22), new THREE.MeshBasicMaterial({ color: 0x7ee05a }));
      fill.geometry.translate(1.0, 0, 0);
      fill.position.x = -1.0;
      bar.add(back, fill);
      bar.visible = false;
      this.group.add(bar);
      this.bars.push({ root: bar, fill });
    }
    const sp = this.smoke.geometry.getAttribute("position") as THREE.BufferAttribute;
    vs.forEach((v, i) => {
      const view = this.views[i];
      view.root.position.copy(toV(v.x, v.y));
      view.root.rotation.y = v.facing;
      // bounce over the ruts while moving, and shake under boost
      const mv = Math.abs(v.speed);
      view.root.position.y = Math.abs(Math.sin(time * 13 + i)) * Math.min(0.06, mv * 0.6) + (v.boost > 0 ? Math.sin(time * 60) * 0.025 : 0);
      if (view.spin) {
        if (view.kind === "roller") view.spin.rotation.y -= v.speed * 2;
        else if (view.kind === "mixer") view.spin.rotation.x += dt * 2.2;
        else view.spin.rotation.y = Math.sin(time * 0.7 + i) * 0.4;
      }
      // Animate articulated implement (blade, bucket, forks, boom, dump bed)
      if (view.implement && !v.wrecked) {
        const boostLift = v.boost > 0 ? 0.16 : 0;
        if (view.kind === "bulldozer" || view.kind === "loader") {
          view.implement.rotation.z = boostLift + Math.sin(time * 9 + i) * Math.min(0.08, mv * 0.5);
        } else if (view.kind === "forklift") {
          view.implement.position.y = boostLift * 1.4 + Math.abs(Math.sin(time * 6 + i)) * Math.min(0.12, mv * 0.8);
        } else if (view.kind === "dumptruck") {
          view.implement.rotation.z = 0.05 + boostLift * 0.8 + Math.abs(Math.sin(time * 11 + i)) * Math.min(0.07, mv * 0.5);
        } else if (view.kind === "excavator") {
          view.implement.rotation.z = Math.sin(time * 1.8 + i) * 0.18;
        }
      }
      // the machine's own attack: the implement does its thing
      if (view.implement && !v.wrecked) {
        const A = ACTS[v.kind];
        const t = v.act;
        const p = t > 0 ? Math.min(1, t / A.dur) : 0;
        const pk = Math.sin(Math.PI * p);
        const imp = view.implement;
        if (v.kind === "bulldozer" && t > 0) imp.rotation.z = -0.14 + Math.sin(time * 40) * 0.02;
        else if (v.kind === "excavator") {
          if (v.carry >= 0) imp.rotation.z = -0.5;
          else if (t > 0) imp.rotation.z = t < A.hit ? -0.7 * (t / A.hit) : -0.7 + 1.5 * Math.min(1, (t - A.hit) / 6) - 0.6 * Math.min(1, Math.max(0, (t - A.hit - 14) / 16));
        } else if (v.kind === "dumptruck" && t > 0) imp.rotation.z = 0.05 + 0.8 * Math.min(1, t / A.hit) * (t > A.hit + 14 ? Math.max(0, 1 - (t - A.hit - 14) / 18) : 1);
        else if (v.kind === "forklift") {
          imp.position.x = t > 0 && t < 18 ? 0.35 * Math.sin((Math.PI * t) / 18) : 0;
          if (v.carry >= 0) imp.position.y = 0.55;
        } else if (v.kind === "loader" && t > 0) imp.rotation.z = -1.0 * pk;
        else if (v.kind === "crane") imp.rotation.y = t >= A.hit ? ((t - A.hit) / (A.dur - A.hit)) * Math.PI * 2 : 0;
      }
      if (view.spin && view.kind === "mixer" && v.act > 0) view.spin.rotation.x += dt * 6;
      // Exhaust rain-cap chatter
      if (view.exhaust && !v.wrecked) {
        view.exhaust.rotation.z = Math.sin(time * (v.driver >= 0 ? 36 : 10) + i) * (v.driver >= 0 ? 0.04 : 0.01);
      }
      view.flag.color.set(v.driver >= 0 ? PLAYER_COLORS[v.driver] : 0x888888);
      this.beacons[i].intensity = v.driver >= 0 && !v.wrecked ? 3 + 3 * Math.sign(Math.sin(time * 8 + i)) : 0;

      // Real-time vertex deformation whenever vehicle takes structural HP damage
      if (view.lastHp < 0) view.lastHp = v.hp;
      if (v.hp < view.lastHp) {
        const drop = view.lastHp - v.hp;
        const ang = (v.hp * 2.39996 + i * 1.7) % (Math.PI * 2);
        const localImpact = new THREE.Vector3(Math.cos(ang) * 1.15, 0.75 + (i % 3) * 0.2, Math.sin(ang) * 0.75);
        deformVehicle(view, localImpact, 1.4, Math.min(0.32, 0.05 + drop * 0.006));
        view.lastHp = v.hp;
      }

      // 4-Stage Progressive Breakaway & Deformation
      const hpFrac = Math.max(0, v.hp / v.max);
      const dmg = 1 - hpFrac;
      if (hpFrac <= 0.75 && view.stage < 1) {
        view.stage = 1;
        view.glassMat.opacity = 0.68;
        view.glassMat.roughness = 0.55;
        view.glassMat.color.setHex(0xc8dce8); // spiderweb-frosted glass
        if (view.doorL) view.doorL.rotation.y = 0.38; // left door unlatched & ajar
      }
      if (hpFrac <= 0.5 && view.stage < 2) {
        view.stage = 2;
        if (view.doorR) view.doorR.rotation.y = -0.45;
        if (view.hood) view.hood.rotation.z = 0.24; // crumpled hood popped open
        if (view.headlights[0]) view.headlights[0].visible = false; // broken headlamp
      }
      if (hpFrac <= 0.25 && view.stage < 3) {
        view.stage = 3;
        this.detachPart(view.doorL, (Math.random() - 0.5) * 4, 3.2, 2.5);
        this.detachPart(view.doorR, (Math.random() - 0.5) * 4, 3.4, -2.5);
        view.doorL = null;
        view.doorR = null;
      }
      if (view.stage >= 2 && !v.wrecked) {
        if (view.hood) view.hood.rotation.z = 0.24 + Math.sin(time * 24 + i) * 0.05;
        view.wheels.forEach((wh, wi) => {
          wh.rotation.z = Math.sin(time * 14 + wi) * 0.08 * dmg;
        });
      }
      if (v.wrecked && !view.wrecked) {
        view.stage = 4;
        view.paint.color.set(0x3a2c22); // charred soot
        view.paint.roughness = 0.92;
        view.body.position.y = -0.16; // collapsed suspension
        view.root.rotation.z = 0.11;
        this.detachPart(view.exhaust, (Math.random() - 0.5) * 3.5, 4.2, (Math.random() - 0.5) * 3.5);
        view.exhaust = null;
        view.wheels.forEach((wh, wi) => {
          wh.rotation.z = (wi % 2 === 0 ? 1 : -1) * 0.32; // splayed broken axles
        });
        deformVehicle(view, new THREE.Vector3(0, 1.1, 0), 2.2, 0.26);
      }
      if (!v.wrecked && view.wrecked) {
        // repaired: patched up, back on its wheels (the dents and the doors stay gone)
        view.stage = 1;
        view.paint.color.set(v.kind === "mixer" ? 0xe8e4dc : v.kind === "forklift" ? 0xff7a10 : CAT_YELLOW);
        view.paint.roughness = 0.48;
        view.body.position.y = 0;
        view.root.rotation.z = 0;
        view.wheels.forEach((wh) => (wh.rotation.z = 0));
        view.lastHp = v.hp;
      }
      view.wrecked = v.wrecked;
      const bar = this.bars[i];
      bar.root.visible = v.wrecked && v.repair > 0;
      if (bar.root.visible) {
        bar.root.position.set(v.x - 1.0, 2.6, -v.y);
        bar.fill.scale.x = Math.max(0.01, v.repair / REPAIR.frames);
      }
      if (!v.wrecked) view.paint.emissive.setRGB(dmg > 0.6 ? 0.28 * (0.5 + 0.5 * Math.sin(time * 10)) : 0, 0, 0);
      // smoke: black from a wreck, a grey wisp from a badly damaged machine
      view.smoke += dt * (v.wrecked ? 16 : dmg > 0.45 ? 6 : 0);
      while (view.smoke > 1) {
        view.smoke--;
        const k = this.smokeN++ % this.smokeAge.length;
        this.smokeAge[k] = 0;
        sp.setXYZ(k, v.x + (Math.random() - 0.5) * 0.65, 1.35, -v.y + (Math.random() - 0.5) * 0.65);
      }
    });
    this.updateYard(w, time);
    // Step flying breakaway vehicle debris
    for (let d = this.debris.length - 1; d >= 0; d--) {
      const item = this.debris[d];
      item.age += dt;
      if (item.age > 3.5) {
        this.group.remove(item.mesh);
        this.debris.splice(d, 1);
        continue;
      }
      item.vy -= 9.8 * dt;
      item.mesh.position.x += item.vx * dt;
      item.mesh.position.y += item.vy * dt;
      item.mesh.position.z += item.vz * dt;
      item.mesh.rotation.x += item.rx * dt;
      item.mesh.rotation.z += item.rz * dt;
      if (item.mesh.position.y < 0.08) {
        item.mesh.position.y = 0.08;
        item.vy = Math.abs(item.vy) * 0.35;
        item.vx *= 0.65;
        item.vz *= 0.65;
        item.rx *= 0.6;
        item.rz *= 0.6;
      }
    }
    for (let k = 0; k < this.smokeAge.length; k++) {
      this.smokeAge[k] += dt;
      if (this.smokeAge[k] > 3) sp.setY(k, -999);
      else sp.setXYZ(k, sp.getX(k) + dt * 0.3, sp.getY(k) + dt * 1.4, sp.getZ(k));
    }
    sp.needsUpdate = true;
  }
}
// ===================================================================== Collapsing Tower
class TowerView extends StageView {
  readonly id = "collapsing-tower" as const;
  readonly background = 0x0b1020;
  readonly fog: [number, number, number] = [0x101830, 30, 110];
  private tiles: { m: THREE.Mesh; mat: THREE.MeshStandardMaterial; home: THREE.Vector3; vy: number; spin: THREE.Vector3; gone: boolean }[] = [];
  private searchlights: THREE.SpotLight[] = [];
  private gears: THREE.Object3D[] = [];

  constructor() {
    super();
    const g = this.group;
    this.lights(0x8090c0, 0x201810, 0.5, 0xc0d0ff, 1.3, 11, 0xff9050, 0.8);

    const roof = surface("roof");
    const half = (TOWER.tile * TOWER.n) / 2;
    for (let k = 0; k < TOWER.n * TOWER.n; k++) {
      const c = tileCentre(k);
      const mat = new THREE.MeshStandardMaterial({ ...roof, roughness: 0.9, emissive: 0x000000, bumpScale: 1.5 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(TOWER.tile - 0.04, 1.2, TOWER.tile - 0.04), mat);
      const home = toV(c.x, c.y, -0.6);
      m.position.copy(home);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      this.tiles.push({ m, mat, home, vy: 0, spin: new THREE.Vector3(), gone: false });
    }
    // the skyscraper below the roof: a steel frame with lit floors, so it reads as a long way down
    const shaft = new THREE.Group();
    const winTex = canvasTexture(256, 512, (c) => {
      c.fillStyle = "#141820";
      c.fillRect(0, 0, 256, 512);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 16; x++) {
          if (Math.random() < 0.45) continue;
          c.fillStyle = Math.random() < 0.7 ? "#ffd890" : "#a0c8ff";
          c.fillRect(x * 16 + 3, y * 16 + 4, 10, 8);
        }
    });
    winTex.repeat.set(2, 4);
    const winMat = new THREE.MeshStandardMaterial({ map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.7, roughness: 0.4 });
    for (const [x, z, ry] of [
      [0, half, 0],
      [0, -half, Math.PI],
      [half, 0, Math.PI / 2],
      [-half, 0, -Math.PI / 2],
    ]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 120), winMat);
      f.position.set(x, -61.2, z);
      f.rotation.y = ry;
      shaft.add(f);
    }
    g.add(shaft);
    // Victorian Clockwork Spire mechanism beneath the central tiles & 4 corner Gothic pinnacles
    const brassGearMat = new THREE.MeshStandardMaterial({ color: 0xc89232, metalness: 0.86, roughness: 0.3, emissive: 0x221000 });
    for (let gi = 0; gi < 2; gi++) {
      const gear = new THREE.Group();
      const r = gi === 0 ? 3.4 : 2.1;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.16, 8, 32), brassGearMat);
      ring.rotation.x = Math.PI / 2;
      gear.add(ring, box(r * 2, 0.12, 0.22, brassGearMat), box(0.22, 0.12, r * 2, brassGearMat));
      for (let t = 0; t < 16; t++) {
        const a = (t / 16) * Math.PI * 2;
        const tooth = box(0.26, 0.16, 0.24, brassGearMat, Math.cos(a) * (r + 0.18), 0, Math.sin(a) * (r + 0.18));
        tooth.rotation.y = -a;
        gear.add(tooth);
      }
      gear.position.y = -1.45 - gi * 0.35;
      g.add(gear);
      this.gears.push(gear);
    }
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x2e3440, metalness: 0.75, roughness: 0.45 });
    for (const [sx, sz] of [[-half - 0.35, -half - 0.35], [half + 0.35, -half - 0.35], [-half - 0.35, half + 0.35], [half + 0.35, half + 0.35]]) {
      const sp = new THREE.Group();
      sp.add(box(0.65, 2.2, 0.65, spireMat, 0, 0.4, 0));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.8, 8), brassGearMat);
      cone.position.y = 2.4;
      sp.add(cone);
      sp.position.set(sx, -0.6, sz);
      g.add(sp);
    }
    // a parapet rim of steel under the roof edge
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3e46, metalness: 0.8, roughness: 0.4 });
    g.add(box(half * 2 + 0.3, 0.4, 0.3, steel, 0, -1.35, half), box(half * 2 + 0.3, 0.4, 0.3, steel, 0, -1.35, -half), box(0.3, 0.4, half * 2, steel, half, -1.35, 0), box(0.3, 0.4, half * 2, steel, -half, -1.35, 0));

    // the city far below, and the neighbouring towers
    const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.5 }), 120);
    const d = new THREE.Object3D();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2 * 3.1;
      const r = 22 + ((i * 37) % 60);
      const h = 30 + ((i * 7919) % 75);
      d.position.set(Math.cos(a) * r, -122 + h / 2, Math.sin(a) * r); // every roof well below ours
      d.scale.set(6 + (i % 5), h, 6 + (i % 3) * 2);
      d.updateMatrix();
      city.setMatrixAt(i, d.matrix);
    }
    g.add(city);
    const street = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x1a1410 }));
    street.rotation.x = -Math.PI / 2;
    street.position.y = -122;
    g.add(street);
    // a searchlight or two sweeping the sky
    for (const x of [-30, 34]) {
      const s = new THREE.SpotLight(0xbfd8ff, 0, 160, 0.12, 0.6);
      s.position.set(x, -60, -40);
      s.target.position.set(0, 40, 0);
      g.add(s, s.target);
      this.searchlights.push(s);
      const cone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 9, 120, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      cone.position.set(0, 60, 0);
      const pivot = new THREE.Group();
      pivot.position.copy(s.position);
      pivot.add(cone);
      pivot.userData.cone = true;
      g.add(pivot);
    }
    // stars
    const sn = 300;
    const pos = new Float32Array(sn * 3);
    for (let i = 0; i < sn; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 1.2 + 0.1;
      pos.set([Math.cos(a) * Math.cos(e) * 150, Math.sin(e) * 150, Math.sin(a) * Math.cos(e) * 150], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: false })));
  }

  update(w: World | null, time: number, dt: number): void {
    const tiles = w?.s.arena.tiles ?? [];
    this.tiles.forEach((t, k) => {
      const st = tiles[k] ?? 0;
      if (st === -1) {
        if (!t.gone) {
          t.gone = true;
          t.vy = 0;
          t.spin.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
        }
        t.vy -= 18 * dt;
        t.m.position.y += t.vy * dt;
        t.m.rotation.x += t.spin.x * dt;
        t.m.rotation.z += t.spin.z * dt;
        t.m.visible = t.m.position.y > -120;
        return;
      }
      t.gone = false;
      t.m.visible = true;
      t.m.rotation.set(0, 0, 0);
      t.m.position.copy(t.home);
      if (st > 0) {
        // cracking: it shakes harder and glows hotter until it gives way
        const k2 = st / TOWER.crack;
        t.m.position.x += (Math.random() - 0.5) * 0.06 * k2;
        t.m.position.z += (Math.random() - 0.5) * 0.06 * k2;
        t.m.position.y -= 0.12 * k2 * k2;
        t.mat.emissive.setRGB(0.5 * k2 * (0.6 + 0.4 * Math.sin(time * 30)), 0.08 * k2, 0);
      } else t.mat.emissive.setRGB(0, 0, 0);
    });
    this.gears.forEach((gr, gi) => (gr.rotation.y = time * (gi === 0 ? 0.35 : -0.55)));
    this.group.children.forEach((c) => {
      if (c.userData.cone) c.rotation.z = Math.sin(time * 0.3 + c.position.x) * 0.4;
    });
  }
}

// ===================================================================== Hindenburg Blimp
const SEG = BLIMP.half - BLIMP.width;

class BlimpView extends StageView {
  readonly id = "hindenburg-blimp" as const;
  readonly background = 0x6a7aa8;
  readonly fog: [number, number, number] = [0xc09080, 40, 140];
  private flames: THREE.Points;
  private flameBase: Float32Array;
  private fireLight: THREE.PointLight;
  private scorch: THREE.Mesh;
  private wind: THREE.LineSegments;
  private windMat: THREE.LineBasicMaterial;
  private ground: THREE.Group;
  private hull: THREE.Group; // everything under the deck, crushed on impact
  private smoke: THREE.Points;
  private smokeBase: Float32Array;
  private clouds: THREE.InstancedMesh;
  private cloudBase: { x: number; y: number; z: number; s: number }[] = [];
  private props: THREE.Object3D[] = [];
  private d = new THREE.Object3D();

  constructor() {
    super();
    const g = this.group;
    this.lights(0xffd8b0, 0x404060, 0.7, 0xffc890, 1.7, 12, 0x8090ff, 0.5);

    // the envelope: a silver hull with ribs, the deck walkway along its spine
    const hullTex = canvasTexture(1024, 256, (c) => {
      const grd = c.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, "#d8d4cc");
      grd.addColorStop(1, "#a8a49c");
      c.fillStyle = grd;
      c.fillRect(0, 0, 1024, 256);
      c.strokeStyle = "rgba(80,80,80,0.35)";
      c.lineWidth = 3;
      for (let x = 0; x < 1024; x += 32) {
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, 256);
        c.stroke();
      }
      for (let y = 0; y < 256; y += 64) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(1024, y);
        c.stroke();
      }
    });
    const hullMat = new THREE.MeshStandardMaterial({ map: hullTex, roughness: 0.6, metalness: 0.35 });
    const len = BLIMP.half + 9;
    this.hull = new THREE.Group();
    g.add(this.hull);
    const hg = this.hull;
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), hullMat);
    hull.scale.set(len, 6, 6);
    hull.position.set(1.5, -6.1, 0); // just under the deck
    hull.receiveShadow = true;
    hg.add(hull);
    // tail fins, at the +x end (the tail) - painted with the era's red band
    const finMat = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.6 });
    const band = new THREE.MeshStandardMaterial({ color: 0xa01818, roughness: 0.6 });
    for (const [ry, rx] of [
      [0, 0],
      [0, Math.PI],
      [0, Math.PI / 2],
      [0, -Math.PI / 2],
    ]) {
      const fin = new THREE.Group();
      fin.add(box(5, 4, 0.2, finMat, 0, 2, 0), box(1.2, 4, 0.22, band, 2, 2, 0));
      fin.position.set(len - 4, -6, 0);
      fin.rotation.set(rx, ry, 0);
      hg.add(fin);
    }
    // the gondola hanging under the nose
    hg.add(box(5, 1.6, 2, new THREE.MeshStandardMaterial({ color: 0x55504a }), -9, -12.6, 0));
    // engine pods with spinning propellers
    for (const [x, z] of [
      [-2, 6.5],
      [-2, -6.5],
      [6, 6.2],
      [6, -6.2],
    ]) {
      const pod = new THREE.Group();
      pod.add(box(2.2, 0.8, 0.8, finMat, 0, 0, 0));
      const prop = box(0.06, 2.4, 0.2, new THREE.MeshStandardMaterial({ color: 0x302820 }), 1.2, 0, 0);
      pod.add(prop);
      this.props.push(prop);
      pod.position.set(x, -7, z);
      hg.add(pod);
    }
    // the deck: a capsule walkway on top of the hull
    const deckShape = new THREE.Shape();
    deckShape.moveTo(-SEG, -BLIMP.width);
    deckShape.lineTo(SEG, -BLIMP.width);
    deckShape.absarc(SEG, 0, BLIMP.width, -Math.PI / 2, Math.PI / 2, false);
    deckShape.lineTo(-SEG, BLIMP.width);
    deckShape.absarc(-SEG, 0, BLIMP.width, Math.PI / 2, (3 * Math.PI) / 2, false);
    const deckTex = surface("planks", 0.32, 0.25);
    const deck = new THREE.Mesh(new THREE.ExtrudeGeometry(deckShape, { depth: 0.15, bevelEnabled: false }), new THREE.MeshStandardMaterial({ ...deckTex, roughness: 0.6, bumpScale: 1.5 }));
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -0.15;
    deck.receiveShadow = true;
    g.add(deck);
    // guide-rope stanchions along the edge (no rail: the edge is open)
    const post = new THREE.MeshStandardMaterial({ color: 0x404040, metalness: 0.7 });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = BLIMP.width - 0.05;
      const x = Math.cos(a) * r + (Math.cos(a) > 0 ? SEG : -SEG);
      const y = Math.sin(a) * r;
      if (!onDeck(x, y, -0.1)) continue;
      const m = box(0.06, 0.35, 0.06, post, x, 0.17, -y);
      g.add(m);
    }
    // a scorched overlay that grows from the tail with the fire
    this.scorch = new THREE.Mesh(new THREE.PlaneGeometry(1, BLIMP.width * 2 + 0.3), new THREE.MeshBasicMaterial({ color: 0x140806, transparent: true, opacity: 0.85, depthWrite: false }));
    this.scorch.rotation.x = -Math.PI / 2;
    this.scorch.position.y = 0.01;
    g.add(this.scorch);
    // flames: a field of additive points over the whole deck, lit behind the fire line
    const fn = 900;
    this.flameBase = new Float32Array(fn * 3);
    const fp = new Float32Array(fn * 3);
    for (let i = 0; i < fn; i++) {
      let x = 0;
      let y = 0;
      do {
        x = (Math.random() * 2 - 1) * (BLIMP.half + 1);
        y = (Math.random() * 2 - 1) * BLIMP.width;
      } while (!onDeck(x, y));
      this.flameBase.set([x, Math.random(), y], i * 3);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
    this.flames = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xff7824, map: dotTexture(), alphaTest: 0.02, size: 0.78, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(this.flames);
    this.fireLight = new THREE.PointLight(0xff6010, 0, 22, 1.6);
    g.add(this.fireLight);

    // wind streaks
    const wn = 90;
    const wp = new Float32Array(wn * 6);
    for (let i = 0; i < wn; i++) {
      const x = (Math.random() * 2 - 1) * 16;
      const y = 0.3 + Math.random() * 3;
      const z = (Math.random() * 2 - 1) * 10;
      wp.set([x, y, z, x, y, z + 1.6], i * 6);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.BufferAttribute(wp, 3));
    this.windMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    this.wind = new THREE.LineSegments(wg, this.windMat);
    g.add(this.wind);

    // smoke from the wreck, after the impact
    const sn = 260;
    this.smokeBase = new Float32Array(sn * 3);
    for (let k = 0; k < sn; k++) this.smokeBase.set([(Math.random() * 2 - 1) * BLIMP.half, Math.random(), (Math.random() * 2 - 1) * BLIMP.width], k * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sn * 3), 3));
    // a soft round puff, not the square a bare point draws
    const puff = canvasTexture(64, 64, (c) => {
      const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.5, "rgba(255,255,255,0.45)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = grd;
      c.fillRect(0, 0, 64, 64);
    });
    this.smoke = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x2a2624, map: puff, size: 3, transparent: true, opacity: 0.45, depthWrite: false }));
    this.smoke.visible = false;
    g.add(this.smoke);

    // the airfield the blimp is coming down on: it rises out of the haze during the match
    this.ground = new THREE.Group();
    const fieldTex = canvasTexture(512, 512, (c) => {
      c.fillStyle = "#4a5a30";
      c.fillRect(0, 0, 512, 512);
      for (let k = 0; k < 1400; k++) {
        c.fillStyle = `rgba(${Math.random() < 0.5 ? "30,40,20" : "110,120,70"},${0.15 + Math.random() * 0.2})`;
        c.fillRect(Math.random() * 512, Math.random() * 512, 3 + Math.random() * 10, 3 + Math.random() * 10);
      }
      // the landing circle and a runway
      c.strokeStyle = "rgba(220,210,190,0.7)";
      c.lineWidth = 6;
      c.beginPath();
      c.arc(256, 256, 120, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#6a665c";
      c.fillRect(0, 400, 512, 60);
    });
    const field = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 1 }));
    field.rotation.x = -Math.PI / 2;
    field.receiveShadow = true;
    this.ground.add(field);
    // the mooring mast it was meant to tie up at, and the hangar
    const steel = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, metalness: 0.6, roughness: 0.5 });
    const mast = new THREE.Group();
    for (const [mx, mz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      mast.add(box(0.3, 22, 0.3, steel, mx, 11, mz));
    mast.add(box(3, 1, 3, steel, 0, 22.5, 0));
    mast.position.set(-34, 0, 14);
    this.ground.add(mast);
    this.ground.add(box(60, 18, 26, new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.9 }), 40, 9, -60));
    this.ground.position.y = -160;
    g.add(this.ground);

    // clouds below and around the ship
    const cn = 70;
    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({ color: 0xffeee0, roughness: 1, transparent: true, opacity: 0.85 }), cn);
    for (let i = 0; i < cn; i++) this.cloudBase.push({ x: (Math.random() * 2 - 1) * 120, y: -30 - Math.random() * 30, z: (Math.random() * 2 - 1) * 80, s: 4 + Math.random() * 9 });
    g.add(this.clouds);
    // the sunset
    const sun = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0xffb060, fog: false }));
    sun.position.set(-40, 10, -120);
    g.add(sun);
  }

  update(w: World | null, time: number, dt: number): void {
    const a = w?.s.arena;
    const fireX = a?.fireX ?? BLIMP.half + 1;
    // the descent: 0 at the start, 1 when it hits the ground
    const t = w ? Math.min(1, w.s.frame / BLIMP.crashAt) : 0;
    const down = t >= 1;
    // the gondola hangs to about -13.4; the crushed hull is half as deep
    this.ground.position.y = down ? -6.8 : -160 + 146 * t * t;
    this.hull.scale.y = down ? 0.55 : 1;
    this.smoke.visible = down;
    if (down) {
      const sp = this.smoke.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let k = 0; k < sp.count; k++) {
        const ph = (this.smokeBase[k * 3 + 1] + time * 0.12) % 1;
        sp.setXYZ(k, this.smokeBase[k * 3] + ph * 6, 1 + ph * 18, -this.smokeBase[k * 3 + 2] + Math.sin(k + time * 0.5) * ph * 3);
      }
      sp.needsUpdate = true;
    }
    // flames: only behind the fire line, flickering upward
    const fp = this.flames.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) {
      const x = this.flameBase[i * 3];
      const ph = (this.flameBase[i * 3 + 1] + time * (0.8 + (i % 5) * 0.15)) % 1;
      if (x < fireX) fp.setXYZ(i, 0, -999, 0);
      else fp.setXYZ(i, x + Math.sin(time * 3 + i) * 0.1, ph * (1.2 + (i % 3) * 0.6), -this.flameBase[i * 3 + 2]);
    }
    fp.needsUpdate = true;
    const burning = fireX < BLIMP.half + 0.5;
    this.fireLight.intensity = burning ? 50 + Math.sin(time * 9) * 12 : 0;
    this.fireLight.position.set(Math.max(fireX, -BLIMP.half) + 1.5, 1.5, 0);
    this.scorch.visible = burning;
    const sx = Math.max(0.01, BLIMP.half + 0.2 - fireX);
    this.scorch.scale.x = sx;
    this.scorch.position.x = BLIMP.half + 0.2 - sx / 2;

    // wind: streaks rush across the deck during a gust, flicker as a warning
    const gust = a ? a.wind > 0 : false;
    const warn = a ? a.wind < 0 : false;
    this.windMat.opacity = gust ? 0.55 : warn ? 0.15 + 0.15 * Math.sin(time * 20) : 0;
    if (gust || warn) {
      const wp = this.wind.geometry.getAttribute("position") as THREE.BufferAttribute;
      const dir = -(a?.windDir ?? 1); // sim +y is render -z
      for (let i = 0; i < wp.count; i += 2) {
        let z = wp.getZ(i) + dir * dt * (gust ? 22 : 6);
        if (z > 10) z -= 20;
        if (z < -10) z += 20;
        wp.setZ(i, z);
        wp.setZ(i + 1, z + dir * 1.6);
      }
      wp.needsUpdate = true;
    }

    if (!down) this.props.forEach((p, i) => (p.rotation.x = time * (30 + i)));
    this.cloudBase.forEach((c, i) => {
      const x = ((c.x + time * 4 + 120) % 240) - 120; // the ship drifts nose first (-x)
      // the clouds drift up past the ship as it sinks, and are gone once it is down
      this.d.position.set(x, down ? -999 : c.y + t * 80, c.z);
      this.d.scale.set(c.s * 1.6, c.s * 0.5, c.s);
      this.d.updateMatrix();
      this.clouds.setMatrixAt(i, this.d.matrix);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
  }
}

// ===================================================================== Castle Under Siege
class CastleView extends StageView {
  readonly id = "castle-under-siege" as const;
  readonly background = 0x788aa0;
  readonly fog: [number, number, number] = [0x8a96a8, 30, 110];
  private banner: THREE.Mesh;
  private bannerMat: THREE.MeshStandardMaterial;
  private zone: THREE.Mesh;
  private catapults: THREE.Object3D[] = [];
  private fires: THREE.PointLight[] = [];

  constructor() {
    super();
    const g = this.group;
    this.lights(0xd0dcf0, 0x404830, 0.7, 0xffe8c8, 1.6, 12, 0xffa060, 0.5);

    const stone = new THREE.MeshStandardMaterial({ ...surface("stone"), roughness: 0.95, bumpScale: 2 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(CASTLE.hx * 2, 0.4, CASTLE.hy * 2), new THREE.MeshStandardMaterial({ ...surface("stone", CASTLE.hx / 2, CASTLE.hy / 2), roughness: 0.95, bumpScale: 2 }));
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    g.add(floor);
    // the curtain wall below the walkway, a long way down
    const wallMat = new THREE.MeshStandardMaterial({ ...surface("stone", CASTLE.hx, 8), roughness: 1, bumpScale: 2 });
    const wall = box(CASTLE.hx * 2 + 0.6, 18, CASTLE.hy * 2 + 0.6, wallMat, 0, -9.4, 0);
    g.add(wall);

    // the parapet: merlons along both long sides, broken at the breaches; solid at the ends
    const merlon = (x: number, z: number, w: number, d: number) => g.add(shadowed(box(w, 1.1, d, stone, x, 0.55, z)));
    for (const side of [-1, 1]) {
      for (let x = -CASTLE.hx + 0.4; x < CASTLE.hx; x += 1.0) {
        const br = CASTLE.breaches.find((b) => b.side === side && x + 0.4 >= b.x0 && x - 0.4 <= b.x1);
        if (br) continue;
        merlon(x, -side * (CASTLE.hy + 0.25), 0.6, 0.5);
        g.add(box(0.4, 0.35, 0.5, stone, x + 0.5, 0.17, -side * (CASTLE.hy + 0.25)));
      }
      for (const b of CASTLE.breaches.filter((q) => q.side === side)) {
        // rubble at the lip of the breach, and a scar down the wall
        for (let i = 0; i < 7; i++) {
          const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + Math.random() * 0.25), stone);
          r.position.set(b.x0 + Math.random() * (b.x1 - b.x0), 0.1, -side * (CASTLE.hy + 0.3 + Math.random() * 0.4));
          g.add(shadowed(r));
        }
        const scar = box(b.x1 - b.x0, 2.5, 0.2, new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1 }), (b.x0 + b.x1) / 2, -1.25, -side * (CASTLE.hy + 0.32));
        g.add(scar);
      }
    }
    for (const side of [-1, 1]) {
      // round towers at both ends of the wall walk
      const t = cyl(2.6, 2.9, 24, stone, 24);
      t.position.set(side * (CASTLE.hx + 2.2), -6, 0);
      g.add(shadowed(t));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.add(shadowed(box(0.6, 1.0, 0.6, stone, side * (CASTLE.hx + 2.2) + Math.cos(a) * 2.5, 6.5, Math.sin(a) * 2.5)));
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 4, 24), new THREE.MeshStandardMaterial({ color: 0x3a3060, roughness: 0.8 }));
      roof.position.set(side * (CASTLE.hx + 2.2), 8.5, 0);
      g.add(shadowed(roof));
    }

    // Wrought-iron cresset fire-baskets burning along the battlements
    const cressetIron = new THREE.MeshStandardMaterial({ color: 0x24201e, metalness: 0.82, roughness: 0.45 });
    const cressetFlame = new THREE.MeshBasicMaterial({ color: 0xff9830 });
    for (const [cx, cz] of [[-CASTLE.hx * 0.55, -CASTLE.hy - 0.25], [CASTLE.hx * 0.55, -CASTLE.hy - 0.25], [-CASTLE.hx * 0.55, CASTLE.hy + 0.25], [CASTLE.hx * 0.55, CASTLE.hy + 0.25]]) {
      const cr = new THREE.Group();
      cr.add(cyl(0.05, 0.06, 1.3, cressetIron, 8), cyl(0.26, 0.14, 0.28, cressetIron, 10));
      cr.children[1].position.y = 0.72;
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), cressetFlame);
      fl.scale.set(1, 1.4, 1);
      fl.position.y = 0.9;
      cr.add(fl);
      cr.position.set(cx, 0.65, cz);
      g.add(cr);
    }
    // the flagpole and the circle the banner rises in
    const pole = cyl(0.06, 0.08, 4.6, new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.7 }), 10);
    pole.position.y = 2.3;
    g.add(shadowed(pole), shadowed(cyl(0.35, 0.45, 0.3, stone, 16)));
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffc23a, metalness: 0.9, roughness: 0.3 }));
    finial.position.y = 4.65;
    g.add(finial);
    this.bannerMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide, roughness: 0.8 });
    this.banner = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85, 12, 1), this.bannerMat);
    this.banner.castShadow = true;
    g.add(this.banner);
    this.zone = new THREE.Mesh(new THREE.RingGeometry(CASTLE.bannerR - 0.08, CASTLE.bannerR, 48), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.5 }));
    this.zone.rotation.x = -Math.PI / 2;
    this.zone.position.y = 0.02;
    g.add(this.zone);

    // the land below: fields, the besiegers' camp, catapults and their fires
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x4a6a34, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -18.4;
    g.add(grass);
    const tent = new THREE.MeshStandardMaterial({ color: 0xc8b890, roughness: 1 });
    const red = new THREE.MeshStandardMaterial({ color: 0x902020, roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const tt = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.2, 6), i % 3 ? tent : red);
      tt.position.set(-40 + (i % 9) * 10 + (i % 2) * 3, -17.3, 30 + Math.floor(i / 9) * 8);
      g.add(tt);
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 1 });
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Group();
      c.add(box(3, 0.4, 2, wood, 0, 0.6, 0), box(0.3, 2.4, 0.3, wood, 0, 1.8, 0.8), box(0.3, 2.4, 0.3, wood, 0, 1.8, -0.8));
      const arm = new THREE.Group();
      arm.add(box(4.5, 0.25, 0.25, wood, 1.8, 0, 0));
      arm.position.set(0, 2.8, 0);
      c.add(arm);
      c.userData.arm = arm;
      c.position.set(-24 + i * 16, -18.4, 22 + (i % 2) * 6);
      c.rotation.y = Math.PI / 2;
      g.add(c);
      this.catapults.push(c);
      const fl = new THREE.PointLight(0xff7020, 30, 14, 2);
      fl.position.set(c.position.x + 3, -17, c.position.z - 2);
      g.add(fl);
      this.fires.push(fl);
    }
    // smoke columns rising from the siege
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 3, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x302a28, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
      s.position.set(-30 + i * 15, -4, 40 + (i % 2) * 10);
      g.add(s);
    }
    // distant hills
    const hill = new THREE.MeshStandardMaterial({ color: 0x5a7048, roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 8), hill);
      const a = Math.PI * (1.1 + (i / 8) * 0.8);
      h.scale.set(1, 0.35, 1);
      h.position.set(Math.cos(a) * 140, -18.4, Math.sin(a) * 140);
      g.add(h);
    }
  }

  update(w: World | null, time: number): void {
    const s = w?.s;
    const holder = s ? s.fighters[s.toiletOccupant] : undefined;
    const frac = holder ? Math.min(1, holder.toilet / CASTLE.bannerFrames) : 0;
    // the holder's colours climb the pole as they raise them
    this.bannerMat.color.set(holder ? PLAYER_COLORS[holder.id] : 0xdddddd);
    this.banner.position.set(0.66, 0.8 + frac * 3.4, 0);
    const pos = this.banner.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + 0.65;
      pos.setZ(i, Math.sin(x * 4 - time * 6) * 0.12 * x);
    }
    pos.needsUpdate = true;
    const contested = s ? s.fighters.filter((f) => f.state !== "ko" && Math.hypot(f.x, f.y) < CASTLE.bannerR).length > 1 : false;
    (this.zone.material as THREE.MeshBasicMaterial).color.set(contested ? 0xff4020 : holder ? PLAYER_COLORS[holder.id] : 0xffe0a0);
    (this.zone.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(time * 4);
    this.catapults.forEach((c, i) => {
      const arm = c.userData.arm as THREE.Object3D;
      const ph = (time * 0.25 + i * 0.37) % 1;
      arm.rotation.z = ph < 0.1 ? -0.9 + ph * 15 : 0.6 - Math.min(1, (ph - 0.1) * 2) * 1.5;
    });
    this.fires.forEach((f, i) => (f.intensity = 25 + Math.sin(time * 9 + i * 2) * 8));
  }
}

export function makeStageView(id: StageId): StageView {
  switch (id) {
    case "hell-toilet":
      return new HellToiletView();
    case "construction-site":
      return new ConstructionView();
    case "collapsing-tower":
      return new TowerView();
    case "hindenburg-blimp":
      return new BlimpView();
    case "castle-under-siege":
      return new CastleView();
  }
}
