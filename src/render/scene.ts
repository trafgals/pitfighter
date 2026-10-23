// Three.js view of a World. Reads the simulation state each frame and never
// writes to it. Fighters are built from primitives with every limb a separate
// mesh, so a limb that falls off simply hides on the body and appears as a
// pickup on the floor.
import * as THREE from "three";
import { LAVA_R, LIMBS, RING_R, type Fighter, type PartId, type Pickup } from "../sim/types";
import { CHARGE, DOWN, GEYSER, HOP_AIR, HOP_CYCLE, MOVES } from "../sim/moves";
import { STYLES } from "../sim/styles";
import { legs, type World } from "../sim/world";

export const PLAYER_COLORS = [0xff3b3b, 0x3b8bff, 0x4cff6a, 0xffd23b, 0xff6bf0, 0x3bf0ff, 0xff9a3b, 0xb07bff];

const toV = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);
const yaw = (facing: number) => Math.atan2(Math.cos(facing), -Math.sin(facing));

interface FighterView {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  limbs: Record<PartId, THREE.Object3D>;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  stars: THREE.Group;
  flash: THREE.Mesh;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function labelSprite(text: string, color: number): THREE.Sprite {
  const tex = canvasTexture(128, 64, (g) => {
    g.font = "bold 44px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8;
    g.strokeStyle = "#000";
    g.strokeText(text, 64, 34);
    g.fillStyle = "#" + color.toString(16).padStart(6, "0");
    g.fillText(text, 64, 34);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.8, 0.4, 1);
  s.renderOrder = 10;
  return s;
}

export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private fighters: FighterView[] = [];
  private pickups = new Map<number, THREE.Group>();
  private geysers: THREE.Group[] = [];
  private lavaTex!: THREE.CanvasTexture;
  private embers!: THREE.Points;
  private toiletGlow!: THREE.PointLight;
  private halo!: THREE.Mesh;
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camDist = 22;
  private world: World | null = null;
  private shake = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(0x140303);
    this.scene.fog = new THREE.Fog(0x2a0505, 26, 60);
    this.buildArena();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- arena
  private buildArena(): void {
    const sc = this.scene;
    sc.add(new THREE.HemisphereLight(0xff8866, 0x220000, 0.55));
    const key = new THREE.DirectionalLight(0xffc0a0, 1.4);
    key.position.set(-6, 18, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sh = key.shadow.camera as THREE.OrthographicCamera;
    sh.left = sh.bottom = -13;
    sh.right = sh.top = 13;
    sc.add(key);

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
    const lava = new THREE.Mesh(
      new THREE.RingGeometry(RING_R - 0.05, LAVA_R + 3, 96, 1),
      new THREE.MeshBasicMaterial({ map: this.lavaTex, side: THREE.DoubleSide }),
    );
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = -0.45;
    sc.add(lava);
    const lavaLight = new THREE.PointLight(0xff4a10, 60, 30, 1.6);
    lavaLight.position.set(0, 0.5, 0);
    sc.add(lavaLight);

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
    plinth.position.y = 0.0;
    for (const m of [bowl, seat, tank, plinth]) {
      m.castShadow = true;
      m.receiveShadow = true;
      toilet.add(m);
    }
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
  }

  // ---------------------------------------------------------------- fighters
  private buildFighter(f: Fighter): FighterView {
    const st = STYLES[f.style];
    const pc = PLAYER_COLORS[f.id % PLAYER_COLORS.length];
    const skin = new THREE.MeshStandardMaterial({ color: st.color, roughness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({ color: st.accent, roughness: 0.5 });
    const big = st.torso > 1.1 ? 1.15 : st.torso < 0.9 ? 0.88 : 1;
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.scale.setScalar(big);
    root.add(body);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const x = new THREE.Mesh(g, m);
      x.castShadow = true;
      return x;
    };
    const torso = mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), skin);
    torso.position.y = 1.08;
    const belt = mesh(new THREE.BoxGeometry(0.54, 0.1, 0.32), accent);
    belt.position.y = -0.26;
    torso.add(belt);
    body.add(torso);

    const head = new THREE.Group();
    head.position.y = 1.55;
    const skull = mesh(new THREE.SphereGeometry(0.17, 16, 12), skin);
    head.add(skull);
    for (const s of [-1, 1]) {
      const horn = mesh(new THREE.ConeGeometry(0.045, 0.2, 8), accent);
      horn.position.set(0.1 * s, 0.15, 0);
      horn.rotation.z = -0.5 * s;
      head.add(horn);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffee55 }));
      eye.position.set(0.06 * s, 0.03, 0.15);
      head.add(eye);
    }
    body.add(head);

    const limb = (len: number, r: number, mat: THREE.Material) => {
      const pivot = new THREE.Group();
      const m = mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
      m.position.y = -len / 2 - r;
      pivot.add(m);
      return pivot;
    };
    const limbs = {} as Record<PartId, THREE.Object3D>;
    limbs.armL = limb(0.48, 0.07, skin);
    limbs.armL.position.set(-0.33, 1.33, 0);
    limbs.armR = limb(0.48, 0.07, skin);
    limbs.armR.position.set(0.33, 1.33, 0);
    limbs.legL = limb(0.55, 0.085, accent);
    limbs.legL.position.set(-0.14, 0.77, 0);
    limbs.legR = limb(0.55, 0.085, accent);
    limbs.legR.position.set(0.14, 0.77, 0);
    limbs.head = head;
    limbs.torso = torso;
    for (const p of LIMBS) body.add(limbs[p]);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.48, 32), new THREE.MeshBasicMaterial({ color: pc, transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    root.add(ring);
    const label = labelSprite(`P${f.id + 1}${f.human ? "" : "·cpu"}`, pc);
    label.position.y = 2.1;
    root.add(label);

    const stars = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0xffff60 }));
      s.position.set(Math.cos((i * Math.PI * 2) / 3) * 0.25, 0, Math.sin((i * Math.PI * 2) / 3) * 0.25);
      stars.add(s);
    }
    stars.position.y = 1.85;
    root.add(stars);
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x80e0ff, transparent: true, opacity: 0, depthWrite: false }),
    );
    flash.position.y = 1.1;
    root.add(flash);

    this.scene.add(root);
    return { root, body, torso, head, limbs, ring, label, stars, flash };
  }

  attach(world: World): void {
    for (const v of this.fighters) this.scene.remove(v.root);
    for (const p of this.pickups.values()) this.scene.remove(p);
    for (const g of this.geysers) this.scene.remove(g);
    this.fighters = world.fighters.map((f) => this.buildFighter(f));
    this.pickups.clear();
    this.geysers = [];
    this.world = world;
    this.camTarget.set(0, 0, 0);
  }

  private pose(v: FighterView, f: Fighter, time: number): void {
    const L = v.limbs;
    // reset
    for (const p of LIMBS) L[p].rotation.set(0, 0, 0);
    v.body.rotation.set(0, 0, 0);
    v.body.position.set(0, 0, 0);
    v.head.rotation.set(0, 0, 0);
    v.torso.rotation.set(0, 0, 0);
    v.stars.visible = false;
    (v.flash.material as THREE.MeshBasicMaterial).opacity = 0;
    const t = f.t;
    const sw = Math.sin(time * 9);
    const nLegs = legs(f);
    const lift = nLegs === 0 ? -0.7 : 0;

    switch (f.state) {
      case "walk": {
        if (nLegs === 2) {
          L.legL.rotation.x = sw * 0.6;
          L.legR.rotation.x = -sw * 0.6;
          L.armL.rotation.x = -sw * 0.4;
          L.armR.rotation.x = sw * 0.4;
        }
        break;
      }
      case "guard":
        L.armL.rotation.set(-1.7, 0, 0.5);
        L.armR.rotation.set(-1.7, 0, -0.5);
        v.body.rotation.x = 0.1;
        break;
      case "attack": {
        if (!f.move) break;
        // a charging opener glows brighter the longer it is held
        if (f.chargeHeld && f.charge > 0) (v.flash.material as THREE.MeshBasicMaterial).opacity = 0.1 + (0.4 * f.charge) / CHARGE.max;
        if (f.move === "grab") {
          L.armL.rotation.x = L.armR.rotation.x = -1.5;
          v.body.rotation.x = 0.2;
          break;
        }
        const m = MOVES[f.move];
        const phase = Math.min(1, t / Math.max(1, m.startup));
        const out = t < m.startup ? phase : t < m.startup + m.active ? 1 : Math.max(0, 1 - (t - m.startup - m.active) / m.recovery);
        if (m.kind === "punch") {
          const right = f.move === "jab1" || f.move === "jab3" || f.move === "punchFin";
          const arm = right ? L.armR : L.armL;
          arm.rotation.x = -1.6 * out;
          if (f.move === "punchFin") {
            arm.rotation.z = (right ? 0.6 : -0.6) * out;
            v.body.rotation.y = (right ? -0.5 : 0.5) * out;
          }
          v.body.rotation.x = 0.12 * out;
        } else if (m.kind === "kick") {
          const leg = f.move === "kick2" ? L.legL : L.legR;
          if (f.move === "sweep") {
            leg.rotation.set(-0.4 * out, 0, 1.3 * out);
            v.body.position.y = -0.25 * out;
            v.body.rotation.y = out * 2;
          } else leg.rotation.x = -1.3 * out;
          v.body.rotation.x = -0.15 * out;
        } else {
          v.body.rotation.x = 0.5 * out;
        }
        break;
      }
      case "hitstun":
      case "blockstun":
        v.body.rotation.x = -0.25;
        if (f.state === "blockstun") {
          L.armL.rotation.set(-1.7, 0, 0.5);
          L.armR.rotation.set(-1.7, 0, -0.5);
        }
        break;
      case "reversal": {
        L.armL.rotation.set(-1.4, 0, -0.6);
        L.armR.rotation.set(-1.4, 0, 0.6);
        if (f.revHeight === "low") v.body.position.y = -0.2;
        if (t < 8) (v.flash.material as THREE.MeshBasicMaterial).opacity = 0.25;
        break;
      }
      case "reversed":
        v.body.rotation.x = -0.45;
        L.armL.rotation.z = -1.2;
        L.armR.rotation.z = 1.2;
        break;
      case "holding":
        L.armL.rotation.x = L.armR.rotation.x = -1.3;
        if (f.holdCool > 10) L.legR.rotation.x = -1.4;
        break;
      case "held":
        v.body.rotation.x = 0.4;
        v.body.position.y = 0.1;
        break;
      case "thrown":
        v.body.rotation.x = -Math.PI / 2 + Math.sin(t * 0.5) * 0.3;
        v.body.rotation.z = t * 0.5;
        v.body.position.y = 0.8 + Math.sin((t / 24) * Math.PI) * 1.2;
        break;
      case "down":
      case "ko":
        v.body.rotation.x = -Math.PI / 2;
        v.body.position.y = 0.2;
        v.body.position.z = -0.6;
        break;
      case "wakeup": {
        const k = 1 - t / DOWN.wake;
        v.body.rotation.x = (-Math.PI / 2) * k;
        v.body.position.y = 0.2 * k;
        break;
      }
      case "dizzy":
        v.stars.visible = true;
        v.stars.rotation.y = time * 5;
        v.head.rotation.z = Math.sin(time * 6) * 0.3;
        v.body.rotation.z = Math.sin(time * 3) * 0.1;
        break;
      case "reattach":
        v.body.position.y = -0.35;
        L.armL.rotation.x = L.armR.rotation.x = -0.9;
        break;
      case "sitting":
      case "seated":
        L.legL.rotation.x = L.legR.rotation.x = -1.5;
        v.body.position.y = -0.3;
        if (f.state === "seated") {
          L.armL.rotation.set(-0.3, 0, -0.3);
          L.armR.rotation.set(-0.3, 0, 0.3);
          v.head.rotation.x = -0.2 + Math.sin(time * 2) * 0.05;
        }
        break;
      default: {
        // idle breathing
        v.torso.position.y = 1.08 + Math.sin(time * 2.5) * 0.01;
        L.armL.rotation.set(-0.5, 0, 0.15);
        L.armR.rotation.set(-0.5, 0, -0.15);
      }
    }
    if (nLegs === 1 && (f.state === "walk" || f.state === "idle" || f.state === "guard")) {
      const ph = f.hopPhase % HOP_CYCLE;
      v.body.position.y += ph < HOP_AIR ? Math.sin((ph / HOP_AIR) * Math.PI) * 0.22 : 0;
      (f.parts.legL.attached ? L.legL : L.legR).rotation.x = -0.15;
      (f.parts.legL.attached ? L.legL : L.legR).position.x = 0;
    } else {
      L.legL.position.x = -0.14;
      L.legR.position.x = 0.14;
    }
    if (nLegs === 0 && !["down", "ko", "thrown", "held", "wakeup"].includes(f.state)) {
      v.body.position.y += lift;
      v.body.rotation.x += 0.6;
    }
  }

  // ---------------------------------------------------------------- per frame
  render(time: number, dt: number): void {
    const w = this.world;
    if (w) this.sync(w, time, dt);
    // lava flow and embers
    this.lavaTex.offset.x = time * 0.02;
    this.lavaTex.offset.y = time * 0.05;
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
    this.renderer.render(this.scene, this.camera);
  }

  private sync(w: World, time: number, dt: number): void {
    const s = w.s;
    // fighters
    const centre = new THREE.Vector3();
    let n = 0;
    s.fighters.forEach((f, i) => {
      const v = this.fighters[i];
      v.root.position.copy(toV(f.x, f.y));
      v.root.rotation.y = yaw(f.facing);
      for (const p of LIMBS) v.limbs[p].visible = f.parts[p].attached;
      this.pose(v, f, time);
      const flicker = f.invuln > 0 && f.state !== "down" && f.state !== "wakeup" && Math.floor(s.frame / 4) % 2 === 0;
      v.body.visible = !flicker;
      v.label.visible = f.state !== "ko";
      v.ring.visible = f.state !== "ko";
      if (f.state === "ko") v.body.position.y = -Math.min(1.2, f.t / 120);
      if (f.state !== "ko") {
        centre.add(v.root.position);
        n++;
      }
    });
    for (const e of s.events) {
      if (e.kind === "hit" && (e.dmg ?? 0) >= 8) this.shake = Math.max(this.shake, 0.18);
      if (e.kind === "reversal" || e.kind === "throw" || e.kind === "ko" || e.kind === "geyser") this.shake = Math.max(this.shake, 0.3);
    }

    // pickups
    const seen = new Set<number>();
    for (const p of s.pickups) {
      seen.add(p.id);
      let g = this.pickups.get(p.id);
      if (!g) {
        g = this.buildPickup(p, w);
        this.pickups.set(p.id, g);
        this.scene.add(g);
      }
      g.position.copy(toV(p.x, p.y, p.z + 0.09 - (p.burning > 0 ? (40 - p.burning) * 0.01 : 0)));
      const limb = g.children[0];
      limb.rotation.y += p.spin;
      if (p.z > 0) limb.rotation.x += 0.2;
      else limb.rotation.x = Math.PI / 2;
    }
    for (const [id, g] of this.pickups) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.pickups.delete(id);
      }
    }

    // geysers
    while (this.geysers.length < s.geysers.length) {
      const g = new THREE.Group();
      const warn = new THREE.Mesh(new THREE.RingGeometry(GEYSER.radius - 0.15, GEYSER.radius, 40), new THREE.MeshBasicMaterial({ color: 0xffa000, transparent: true }));
      warn.rotation.x = -Math.PI / 2;
      warn.position.y = 0.03;
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(GEYSER.radius * 0.7, GEYSER.radius, 6, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff6010, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
      );
      col.position.y = 3;
      g.add(warn, col);
      this.scene.add(g);
      this.geysers.push(g);
    }
    this.geysers.forEach((g, i) => {
      const gs = s.geysers[i];
      g.visible = !!gs;
      if (!gs) return;
      g.position.copy(toV(gs.x, gs.y));
      const [warn, col] = g.children as THREE.Mesh[];
      (warn.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.5 * Math.abs(Math.sin(gs.t * 0.3));
      col.visible = gs.t >= GEYSER.warn;
      col.scale.y = col.visible ? 0.3 + Math.min(1, (gs.t - GEYSER.warn) / 5) : 1;
    });

    // camera frames everyone still standing
    if (n) centre.divideScalar(n);
    let spread = 4;
    for (const f of s.fighters) if (f.state !== "ko") spread = Math.max(spread, Math.hypot(f.x - centre.x, -f.y - centre.z));
    centre.lerp(new THREE.Vector3(0, 0, 0), 0.35);
    const k = 1 - Math.exp(-dt * 3);
    this.camTarget.lerp(centre, k);
    this.camDist += (Math.min(26, 9 + spread * 1.5) - this.camDist) * k;
    const sh = this.shake;
    this.shake *= Math.exp(-dt * 8);
    this.camera.position.set(
      this.camTarget.x + (Math.random() - 0.5) * sh,
      this.camDist * 0.78 + (Math.random() - 0.5) * sh,
      this.camTarget.z + this.camDist * 0.72,
    );
    this.camera.lookAt(this.camTarget.x, 0.8, this.camTarget.z);
  }

  private buildPickup(p: Pickup, w: World): THREE.Group {
    const f = w.fighters[p.owner];
    const st = STYLES[f.style];
    const isLeg = p.part.startsWith("leg");
    const g = new THREE.Group();
    const m = new THREE.Mesh(
      new THREE.CapsuleGeometry(isLeg ? 0.085 : 0.07, isLeg ? 0.55 : 0.48, 4, 10),
      new THREE.MeshStandardMaterial({ color: isLeg ? st.accent : st.color, roughness: 0.7 }),
    );
    m.castShadow = true;
    const stump = new THREE.Mesh(new THREE.SphereGeometry(isLeg ? 0.095 : 0.08, 10, 8), new THREE.MeshStandardMaterial({ color: 0x8a0000, emissive: 0x300000 }));
    stump.position.y = (isLeg ? 0.55 : 0.48) / 2 + 0.05;
    const tag = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 24), new THREE.MeshBasicMaterial({ color: PLAYER_COLORS[p.owner], side: THREE.DoubleSide }));
    g.add(m, stump);
    const holder = new THREE.Group();
    holder.add(g);
    // the owner-coloured ring stays flat on the floor below the limb
    tag.rotation.x = -Math.PI / 2;
    tag.position.y = -0.07;
    holder.add(tag);
    return holder;
  }
}
