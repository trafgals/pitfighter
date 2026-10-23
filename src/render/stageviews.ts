// What each stage looks like. A StageView builds its arena (floor, walls,
// props, surroundings, lights) into one group and animates the stage's own
// state every render frame: the hellfire and the crowd, the machines of the
// construction site, the tiles of the collapsing tower, the blimp's fire,
// wind, the airfield coming up to meet it, the castle's banner. Like the rest of the renderer it
// only reads the World. The hazards, fighters and pickups are the Scene's.
import * as THREE from "three";
import { LAVA_R, RING_R, type Vehicle, type VehicleKind } from "../sim/types";
import { BLIMP, CASTLE, TOWER, YARD, onDeck, tileCentre } from "../sim/arena";
import type { StageId } from "../sim/stages";
import type { World } from "../sim/world";
import { PLAYER_COLORS } from "./body";

export const toV = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);
export const yaw = (facing: number) => Math.atan2(Math.cos(facing), -Math.sin(facing));

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Speckled noise on a base colour: concrete, gravel, stone. */
function speckle(base: string, n: number, lo: number, hi: number, size = 8, extra?: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  return canvasTexture(512, 512, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < n; i++) {
      const v = lo + Math.random() * (hi - lo);
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * size, 1 + Math.random() * size);
    }
    extra?.(g);
  });
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

// ===================================================================== Hell Toilet
class HellToiletView extends StageView {
  readonly id = "hell-toilet" as const;
  readonly background = 0x140303;
  readonly fog: [number, number, number] = [0x2a0505, 26, 60];
  private lavaTex: THREE.CanvasTexture;
  private lavaLight: THREE.PointLight;
  private embers: THREE.Points;
  private toiletGlow: THREE.PointLight;
  private halo: THREE.Mesh;
  private crowd: THREE.InstancedMesh;
  private crowdBase: { x: number; y: number; z: number; ph: number; sp: number }[] = [];
  private dummy = new THREE.Object3D();

  constructor() {
    super();
    const sc = this.group;
    this.lights(0xff8866, 0x220000, 0.55, 0xffc0a0, 1.4, 13);

    // cracked basalt floor with glowing veins
    const floorTex = canvasTexture(1024, 1024, (g) => {
      g.fillStyle = "#2b1d1a";
      g.fillRect(0, 0, 1024, 1024);
      for (let i = 0; i < 3500; i++) {
        const v = 20 + Math.random() * 30;
        g.fillStyle = `rgb(${v + 10},${v},${v - 5})`;
        g.fillRect(Math.random() * 1024, Math.random() * 1024, 3 + Math.random() * 10, 3 + Math.random() * 10);
      }
      g.strokeStyle = "rgba(255,90,20,0.55)";
      g.lineWidth = 3;
      for (let i = 0; i < 40; i++) {
        let x = Math.random() * 1024;
        let y = Math.random() * 1024;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 8; k++) {
          x += (Math.random() - 0.5) * 120;
          y += (Math.random() - 0.5) * 120;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    });
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(RING_R, RING_R + 0.2, 0.6, 72),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, emissive: 0x220500, emissiveMap: floorTex, emissiveIntensity: 0.6 }),
    );
    floor.position.y = -0.3;
    floor.receiveShadow = true;
    sc.add(floor);

    // a ring of hellfire around the floor
    this.lavaTex = canvasTexture(512, 512, (g) => {
      const grd = g.createLinearGradient(0, 0, 512, 512);
      grd.addColorStop(0, "#ff3a00");
      grd.addColorStop(0.5, "#ffb000");
      grd.addColorStop(1, "#ff2000");
      g.fillStyle = grd;
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(${120 + Math.random() * 80},${Math.random() * 30},0,0.6)`;
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
    this.lavaLight = new THREE.PointLight(0xff4a10, 60, 30, 1.6);
    this.lavaLight.position.set(0, 0.5, 0);
    sc.add(this.lavaLight);

    // jagged rocks at the outer wall
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x1a0d0b, roughness: 1 });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.random() * 0.05;
      const h = 1.5 + Math.random() * 3.5;
      const rock = new THREE.Mesh(new THREE.ConeGeometry(0.6 + Math.random() * 0.7, h, 5), rockMat);
      rock.position.set(Math.cos(a) * (LAVA_R + 1.0 + Math.random()), h / 2 - 0.5, Math.sin(a) * (LAVA_R + 1.0 + Math.random()));
      rock.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * 3, (Math.random() - 0.5) * 0.3);
      sc.add(rock);
    }

    // THE LAST TOILET
    const porcelain = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.25, metalness: 0.05 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc23a, roughness: 0.3, metalness: 0.9, emissive: 0x442200 });
    const toilet = new THREE.Group();
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(0.18, 0), new THREE.Vector2(0.22, 0.2), new THREE.Vector2(0.3, 0.35), new THREE.Vector2(0.34, 0.45), new THREE.Vector2(0.3, 0.46)], 24),
      porcelain,
    );
    const seat = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 10, 24), gold);
    seat.rotation.x = Math.PI / 2;
    seat.position.y = 0.48;
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.22), porcelain);
    tank.position.set(0, 0.75, -0.32);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.18, 24), new THREE.MeshStandardMaterial({ color: 0x3a0a0a, roughness: 0.6 }));
    toilet.add(bowl, seat, tank, plinth);
    shadowed(toilet);
    // the toilet faces south, toward the camera
    toilet.position.set(0, 0.08, 0);
    sc.add(toilet);
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
    this.halo.rotation.x = Math.PI / 2;
    this.halo.position.set(0, 1.55, -0.3);
    sc.add(this.halo);
    this.toiletGlow = new THREE.PointLight(0xffe2a0, 25, 6, 2);
    this.toiletGlow.position.set(0, 2.2, 0);
    sc.add(this.toiletGlow);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.9, 14, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = 7;
    sc.add(beam);

    // rising embers
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
    this.embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xffa040, size: 0.09, transparent: true, opacity: 0.85 }));
    sc.add(this.embers);

    // tiers of rock behind the hellfire, packed with the damned; they bounce harder the louder it gets
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x140806, roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const r0 = LAVA_R + 3.2 + i * 1.4;
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(r0 + 1.4, r0 + 1.4, 0.6 + i * 0.9, 64, 1, true), tierMat);
      tier.position.y = (0.6 + i * 0.9) / 2 - 0.4;
      sc.add(tier);
      const top = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 1.4, 64), tierMat);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.2 + i * 0.9 - 0.4 + 0.2;
      sc.add(top);
    }
    const cn = 220;
    this.crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.55, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.8, emissive: 0x300000 }), cn);
    const col = new THREE.Color();
    for (let i = 0; i < cn; i++) {
      const tierI = i % 3;
      const a = (i / cn) * Math.PI * 2 * 3 + tierI * 0.37;
      const r = LAVA_R + 3.9 + tierI * 1.4;
      this.crowdBase.push({ x: Math.cos(a) * r, y: 0.55 + tierI * 0.9, z: Math.sin(a) * r, ph: (i * 2.39) % (Math.PI * 2), sp: 5 + (i % 5) });
      col.setHSL(0.0 + ((i * 37) % 10) / 120, 0.6, 0.12 + ((i * 13) % 7) / 60);
      this.crowd.setColorAt(i, col);
    }
    sc.add(this.crowd);
  }

  update(_w: World | null, time: number, dt: number, hype: number): void {
    this.lavaTex.offset.x = time * 0.02;
    this.lavaTex.offset.y = time * 0.05;
    this.lavaLight.intensity = 55 + Math.sin(time * 7.3) * 5 + Math.sin(time * 3.1) * 4;
    const pos = this.embers.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.6 + (i % 7) * 0.15);
      if (y > 10) y = 0;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    this.halo.position.y = 1.55 + Math.sin(time * 2) * 0.06;
    this.halo.rotation.z = time;
    this.toiletGlow.intensity = 20 + Math.sin(time * 3) * 6;
    const amp = 0.04 + 0.3 * hype;
    this.crowdBase.forEach((c, i) => {
      this.dummy.position.set(c.x, c.y + Math.abs(Math.sin(time * c.sp + c.ph)) * amp, c.z);
      this.dummy.rotation.set(0, -Math.atan2(c.z, c.x), Math.sin(time * 2 + c.ph) * 0.1);
      this.dummy.updateMatrix();
      this.crowd.setMatrixAt(i, this.dummy.matrix);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
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

interface VehicleView {
  root: THREE.Group;
  paint: THREE.MeshStandardMaterial;
  flag: THREE.MeshBasicMaterial;
  spin: THREE.Object3D | null; // the mixer drum, the roller drum, the excavator's cab
  smoke: number; // render-time smoke spawn accumulator
  kind: VehicleKind;
  wrecked: boolean;
}

/** A construction machine built from primitives, facing +x in its own space (sim facing 0). */
function buildVehicle(kind: VehicleKind): VehicleView {
  const root = new THREE.Group();
  const body = new THREE.Group(); // faces +x
  root.add(body);
  const paint = new THREE.MeshStandardMaterial({ color: kind === "mixer" ? 0xe8e8e8 : kind === "forklift" ? 0xff7a10 : CAT_YELLOW, roughness: 0.55, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.4, metalness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x6aa0c8, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.45 });
  const wheel = (x: number, z: number, r = 0.42, w = 0.32) => {
    const m = cyl(r, r, w, dark, 18);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, r, z);
    body.add(m);
  };
  const tracks = (len: number, z: number) => body.add(box(len, 0.55, 0.45, dark, 0, 0.3, z));
  const cab = (x: number, y: number, w = 0.9, h = 0.9, d = 1.1) => {
    const frame = new THREE.Group();
    frame.add(box(w, 0.08, d, paint, 0, h, 0));
    for (const [px, pz] of [
      [w / 2, d / 2],
      [-w / 2, d / 2],
      [w / 2, -d / 2],
      [-w / 2, -d / 2],
    ])
      frame.add(box(0.06, h, 0.06, paint, px, h / 2, pz));
    frame.add(box(0.02, h * 0.7, d * 0.95, glass, w / 2, h * 0.55, 0));
    frame.position.set(x, y, 0);
    body.add(frame);
  };
  let spin: THREE.Object3D | null = null;
  switch (kind) {
    case "bulldozer": {
      tracks(2.0, 0.65);
      tracks(2.0, -0.65);
      body.add(box(1.7, 0.6, 1.0, paint, -0.1, 0.8, 0));
      cab(-0.4, 1.1);
      const blade = box(0.2, 0.85, 2.3, steel, 1.25, 0.5, 0);
      blade.rotation.z = -0.15;
      body.add(blade, box(0.5, 0.1, 0.1, paint, 1.0, 0.6, 0.6), box(0.5, 0.1, 0.1, paint, 1.0, 0.6, -0.6));
      break;
    }
    case "excavator": {
      tracks(2.2, 0.7);
      tracks(2.2, -0.7);
      const top = new THREE.Group();
      top.add(box(1.6, 0.55, 1.4, paint, -0.2, 0.0, 0));
      const boom = box(1.8, 0.22, 0.25, paint, 0.9, 0.6, 0.35);
      boom.rotation.z = 0.55;
      const stick = box(1.2, 0.18, 0.2, paint, 1.95, 0.75, 0.35);
      stick.rotation.z = -1.0;
      const bucket = box(0.45, 0.4, 0.55, steel, 2.3, 0.15, 0.35);
      top.add(boom, stick, bucket);
      top.position.y = 0.85;
      body.add(top);
      cab(0.1, 1.1, 0.8, 0.9, 0.7);
      spin = top;
      break;
    }
    case "dumptruck": {
      wheel(1.0, 0.75, 0.5);
      wheel(1.0, -0.75, 0.5);
      wheel(-0.8, 0.75, 0.5);
      wheel(-0.8, -0.75, 0.5);
      body.add(box(2.6, 0.3, 1.3, dark, 0, 0.6, 0));
      cab(0.75, 0.75, 0.8, 0.85, 1.2);
      const bed = new THREE.Group();
      bed.add(box(1.5, 0.08, 1.5, paint, 0, 0, 0), box(1.5, 0.6, 0.08, paint, 0, 0.3, 0.72), box(1.5, 0.6, 0.08, paint, 0, 0.3, -0.72), box(0.08, 0.7, 1.5, paint, 0.72, 0.35, 0));
      bed.position.set(-0.55, 0.82, 0);
      bed.rotation.z = 0.05;
      body.add(bed);
      break;
    }
    case "forklift": {
      wheel(0.45, 0.45, 0.28, 0.22);
      wheel(0.45, -0.45, 0.28, 0.22);
      wheel(-0.45, 0.45, 0.24, 0.2);
      wheel(-0.45, -0.45, 0.24, 0.2);
      body.add(box(1.2, 0.5, 0.95, paint, -0.1, 0.5, 0), box(0.4, 0.5, 0.9, dark, -0.55, 0.75, 0));
      cab(-0.05, 0.6, 0.7, 1.1, 0.85);
      body.add(box(0.08, 2.0, 0.08, steel, 0.65, 1.0, 0.3), box(0.08, 2.0, 0.08, steel, 0.65, 1.0, -0.3));
      body.add(box(0.9, 0.05, 0.12, steel, 1.1, 0.25, 0.25), box(0.9, 0.05, 0.12, steel, 1.1, 0.25, -0.25));
      break;
    }
    case "roller": {
      const drum = cyl(0.55, 0.55, 1.7, steel, 24);
      drum.rotation.x = Math.PI / 2;
      drum.position.set(0.85, 0.55, 0);
      body.add(drum, box(0.4, 0.3, 1.8, paint, 0.85, 1.1, 0));
      wheel(-0.7, 0.75, 0.5, 0.35);
      wheel(-0.7, -0.75, 0.5, 0.35);
      body.add(box(1.4, 0.55, 1.2, paint, -0.5, 0.8, 0));
      cab(-0.4, 1.05, 0.85, 0.85, 1.0);
      spin = drum;
      break;
    }
    case "mixer": {
      wheel(1.0, 0.7, 0.45);
      wheel(1.0, -0.7, 0.45);
      wheel(-0.6, 0.7, 0.45);
      wheel(-0.6, -0.7, 0.45);
      wheel(-1.1, 0.7, 0.45);
      wheel(-1.1, -0.7, 0.45);
      body.add(box(2.8, 0.3, 1.2, dark, 0, 0.55, 0));
      const cabPaint = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.5 });
      body.add(box(0.8, 0.6, 1.2, cabPaint, 0.95, 1.0, 0));
      cab(0.85, 0.75, 0.8, 0.85, 1.2);
      const drumG = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), paint);
      drum.scale.set(1.5, 1, 1);
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.05, 6, 24), new THREE.MeshStandardMaterial({ color: 0xc8202a }));
      stripe.rotation.y = Math.PI / 2;
      drumG.add(drum, stripe);
      drumG.position.set(-0.5, 1.4, 0);
      drumG.rotation.z = 0.25;
      body.add(drumG);
      spin = drumG;
      break;
    }
    case "loader": {
      wheel(0.6, 0.7, 0.5, 0.35);
      wheel(0.6, -0.7, 0.5, 0.35);
      wheel(-0.7, 0.7, 0.5, 0.35);
      wheel(-0.7, -0.7, 0.5, 0.35);
      body.add(box(1.9, 0.55, 1.1, paint, -0.1, 0.8, 0));
      cab(-0.2, 1.05, 0.85, 0.9, 1.0);
      body.add(box(0.8, 0.12, 0.15, paint, 1.15, 0.75, 0.45), box(0.8, 0.12, 0.15, paint, 1.15, 0.75, -0.45));
      const bucket = box(0.6, 0.55, 2.0, steel, 1.6, 0.5, 0);
      bucket.rotation.z = 0.3;
      body.add(bucket);
      break;
    }
    case "crane": {
      wheel(1.0, 0.75, 0.48);
      wheel(1.0, -0.75, 0.48);
      wheel(-0.4, 0.75, 0.48);
      wheel(-0.4, -0.75, 0.48);
      wheel(-1.0, 0.75, 0.48);
      wheel(-1.0, -0.75, 0.48);
      body.add(box(2.8, 0.35, 1.35, paint, 0, 0.65, 0));
      cab(0.85, 0.82, 0.8, 0.85, 1.3);
      const boom = box(3.6, 0.3, 0.35, paint, -0.1, 1.95, 0);
      boom.rotation.z = 0.5;
      const hook = box(0.08, 1.0, 0.08, steel, 1.45, 2.3, 0);
      body.add(boom, hook, box(0.8, 0.5, 1.0, paint, -0.9, 1.05, 0));
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
  return { root, paint, flag, spin, smoke: 0, kind, wrecked: false };
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

  constructor() {
    super();
    const g = this.group;
    this.lights(0xdde8ff, 0x6a5a40, 0.75, 0xfff2d8, 1.9, 16, 0xa0c0ff, 0.4);

    // the yard: packed dirt and gravel inside, mud outside
    const dirt = speckle("#7a6248", 9000, 40, 170, 6, (c) => {
      c.strokeStyle = "rgba(60,45,30,0.5)";
      c.lineWidth = 10;
      for (let i = 0; i < 12; i++) {
        c.beginPath();
        const y = Math.random() * 512;
        c.moveTo(0, y);
        c.bezierCurveTo(170, y + 60, 340, y - 60, 512, y + 20);
        c.stroke();
      }
    });
    dirt.repeat.set(3, 2);
    const yard = new THREE.Mesh(new THREE.BoxGeometry(YARD.hx * 2, 0.4, YARD.hy * 2), new THREE.MeshStandardMaterial({ map: dirt, roughness: 1 }));
    yard.position.y = -0.2;
    yard.receiveShadow = true;
    g.add(yard);
    const mud = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x5e5040, roughness: 1 }));
    mud.rotation.x = -Math.PI / 2;
    mud.position.y = -0.05;
    mud.receiveShadow = true;
    g.add(mud);

    // jersey barriers all round: the yard's walls
    const conc = new THREE.MeshStandardMaterial({ map: speckle("#b8b2a6", 5000, 120, 220, 3), roughness: 0.95 });
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

    // a half-built steel frame and a tower crane at the back of the site
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

    // smoke from wrecked machines
    const sn = 160;
    const sp = new Float32Array(sn * 3).fill(-999);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    this.smoke = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x302a26, size: 0.9, transparent: true, opacity: 0.55, depthWrite: false }));
    this.smokeAge = new Float32Array(sn).fill(99);
    g.add(this.smoke);
  }

  seat(v: Vehicle): { pos: THREE.Vector3; facing: number } {
    const [fwd, h] = SEATS[v.kind];
    // the seat pose's hips sit 0.52 m above the root
    return { pos: toV(v.x + Math.cos(v.facing) * fwd, v.y + Math.sin(v.facing) * fwd, h - 0.52), facing: v.facing };
  }

  update(w: World | null, time: number, dt: number): void {
    const vs = w?.s.arena.vehicles ?? [];
    while (this.views.length < vs.length) {
      const v = buildVehicle(vs[this.views.length].kind);
      this.views.push(v);
      this.group.add(v.root);
      const b = new THREE.PointLight(0xffa000, 0, 6, 2);
      b.position.set(-0.2, 2.0, 0);
      v.root.add(b);
      this.beacons.push(b);
    }
    const sp = this.smoke.geometry.getAttribute("position") as THREE.BufferAttribute;
    vs.forEach((v, i) => {
      const view = this.views[i];
      view.root.position.copy(toV(v.x, v.y));
      view.root.rotation.y = v.facing;
      // bounce over the ruts while moving, and shake under boost
      const mv = Math.abs(v.speed);
      view.root.position.y = Math.abs(Math.sin(time * 13 + i)) * Math.min(0.06, mv * 0.6) + (v.boost > 0 ? Math.sin(time * 60) * 0.02 : 0);
      if (view.spin) {
        if (view.kind === "roller") view.spin.rotation.y -= v.speed * 2;
        else if (view.kind === "mixer") view.spin.rotation.x += dt * 2;
        else view.spin.rotation.y = Math.sin(time * 0.7 + i) * 0.4;
      }
      view.flag.color.set(v.driver >= 0 ? PLAYER_COLORS[v.driver] : 0x888888);
      this.beacons[i].intensity = v.driver >= 0 && !v.wrecked ? 3 + 3 * Math.sign(Math.sin(time * 8 + i)) : 0;
      const dmg = 1 - v.hp / v.max;
      if (v.wrecked && !view.wrecked) {
        view.paint.color.set(0x4a3a2c); // burnt out
        view.root.rotation.z = 0.08;
      }
      view.wrecked = v.wrecked;
      if (!v.wrecked) view.paint.emissive.setRGB(dmg > 0.6 ? 0.25 * (0.5 + 0.5 * Math.sin(time * 10)) : 0, 0, 0);
      // smoke: black from a wreck, a grey wisp from a badly damaged machine
      view.smoke += dt * (v.wrecked ? 14 : dmg > 0.5 ? 5 : 0);
      while (view.smoke > 1) {
        view.smoke--;
        const k = this.smokeN++ % this.smokeAge.length;
        this.smokeAge[k] = 0;
        sp.setXYZ(k, v.x + (Math.random() - 0.5) * 0.6, 1.4, -v.y + (Math.random() - 0.5) * 0.6);
      }
    });
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

  constructor() {
    super();
    const g = this.group;
    this.lights(0x8090c0, 0x201810, 0.5, 0xc0d0ff, 1.3, 11, 0xff9050, 0.8);

    const tex = speckle("#8c8a86", 6000, 60, 200, 4, (c) => {
      c.strokeStyle = "rgba(40,40,40,0.8)";
      c.lineWidth = 6;
      c.strokeRect(3, 3, 506, 506);
    });
    const half = (TOWER.tile * TOWER.n) / 2;
    for (let k = 0; k < TOWER.n * TOWER.n; k++) {
      const c = tileCentre(k);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: 0x000000 });
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
    const deckTex = canvasTexture(512, 128, (c) => {
      c.fillStyle = "#6a5236";
      c.fillRect(0, 0, 512, 128);
      for (let x = 0; x < 512; x += 16) {
        c.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.15})`;
        c.fillRect(x, 0, 2, 128);
        c.fillStyle = `rgba(255,220,170,${Math.random() * 0.08})`;
        c.fillRect(x + 2, 0, 14, 128);
      }
    });
    deckTex.repeat.set(0.08, 0.15);
    const deck = new THREE.Mesh(new THREE.ExtrudeGeometry(deckShape, { depth: 0.15, bevelEnabled: false }), new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }));
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
    this.flames = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xff7020, size: 0.55, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
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

    const stoneTex = speckle("#7c766c", 7000, 60, 190, 5, (c) => {
      c.strokeStyle = "rgba(40,36,30,0.7)";
      c.lineWidth = 3;
      for (let y = 0; y < 512; y += 64) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(512, y);
        c.stroke();
        for (let x = (y / 64) % 2 ? 0 : 64; x < 512; x += 128) {
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x, y + 64);
          c.stroke();
        }
      }
    });
    const floorTex = stoneTex.clone();
    floorTex.repeat.set(CASTLE.hx / 2, CASTLE.hy / 2);
    floorTex.needsUpdate = true;
    const stone = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(CASTLE.hx * 2, 0.4, CASTLE.hy * 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    g.add(floor);
    // the curtain wall below the walkway, a long way down
    const wallTex = stoneTex.clone();
    wallTex.repeat.set(CASTLE.hx, 8);
    wallTex.needsUpdate = true;
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1 });
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
