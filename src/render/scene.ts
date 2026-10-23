// Three.js view of a World. Reads the simulation state each frame and never
// writes to it. The fighters' bodies and poses live in body.ts; this file
// builds the arena (hellfire, rocks, the last toilet, a crowd of the damned),
// places everything each frame, runs the camera, and turns each step's cues
// into impact effects: hit sparks, flash rings, dust, white hit flashes, a
// shaking and punching-in camera, and hitstop jitter on the victim.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { LAVA_R, RING_R, type Fighter, type PartId, type Pickup } from "../sim/types";
import { FURY, GEYSER } from "../sim/moves";
import { STYLES } from "../sim/styles";
import { alive, type World } from "../sim/world";
import { PLAYER_COLORS, applyPose, buildBody, syncLimbs, targetPose, type Body } from "./body";
import type { Cue } from "./cues";
import { Fx } from "./fx";

export { PLAYER_COLORS };

const toV = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);
const yaw = (facing: number) => Math.atan2(Math.cos(facing), -Math.sin(facing));

// where on the body a hit on each part lands (metres above the floor)
const PART_H: Record<PartId, number> = { head: 1.62, torso: 1.2, armL: 1.3, armR: 1.3, legL: 0.5, legR: 0.5 };
const SPECIAL_COLOR: Record<string, number> = { spSpin: 0xffd040, spCharge: 0xff5020, spFlurry: 0xffa030, spSlam: 0xff3010, spBlade: 0xfff0a0, spFire: 0xff6000 };

interface FighterView extends Body {
  ring: THREE.Mesh;
  fury: THREE.Mesh;
  label: THREE.Sprite;
  stars: THREE.Group;
  aura: THREE.Mesh;
  marker: THREE.Mesh | null; // a human's lock-on chevron, floating over their target
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
  readonly fx = new Fx();
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private fighters: FighterView[] = [];
  private pickups = new Map<number, THREE.Group>();
  private geysers: THREE.Group[] = [];
  private lavaTex!: THREE.CanvasTexture;
  private lavaLight!: THREE.PointLight;
  private embers!: THREE.Points;
  private toiletGlow!: THREE.PointLight;
  private halo!: THREE.Mesh;
  private crowd!: THREE.InstancedMesh;
  private crowdBase: { x: number; y: number; z: number; ph: number; sp: number }[] = [];
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camDist = 22;
  private world: World | null = null;
  private shake = 0; // trauma, 0..1: the offset is trauma squared
  private punch = 0; // camera punch-in toward `punchAt`, 0..1
  private punchAt = new THREE.Vector3();
  private hype = 0; // how loud the crowd is, 0..1
  private dummy = new THREE.Object3D();

  constructor(
    readonly canvas: HTMLCanvasElement,
    lofi = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = !lofi;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(0x140303);
    this.scene.fog = new THREE.Fog(0x2a0505, 26, 60);
    this.buildArena();
    this.buildCrowd();
    this.scene.add(this.fx.group);
    if (!lofi) {
      // bloom makes the hellfire, the sparks and the halo glow
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  get bloomOn(): boolean {
    return !!this.bloom;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
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
    // a cold rim light from behind picks the fighters out of the red
    const rim = new THREE.DirectionalLight(0x6080ff, 0.7);
    rim.position.set(4, 8, -14);
    sc.add(rim);

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

  /** Tiers of rock behind the hellfire, packed with the damned. They bounce harder the louder it gets. */
  private buildCrowd(): void {
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x140806, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const r0 = LAVA_R + 3.2 + i * 1.4;
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(r0 + 1.4, r0 + 1.4, 0.6 + i * 0.9, 64, 1, true), tierMat);
      tier.position.y = (0.6 + i * 0.9) / 2 - 0.4;
      tier.material.side = THREE.DoubleSide;
      this.scene.add(tier);
      const top = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 1.4, 64), tierMat);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.2 + i * 0.9 - 0.4 + 0.2;
      this.scene.add(top);
    }
    const geo = new THREE.CapsuleGeometry(0.2, 0.55, 3, 8);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, emissive: 0x300000 });
    const n = 220;
    this.crowd = new THREE.InstancedMesh(geo, mat, n);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const tierI = i % 3;
      const a = (i / n) * Math.PI * 2 * 3 + tierI * 0.37;
      const r = LAVA_R + 3.9 + tierI * 1.4;
      this.crowdBase.push({ x: Math.cos(a) * r, y: 0.55 + tierI * 0.9, z: Math.sin(a) * r, ph: (i * 2.39) % (Math.PI * 2), sp: 5 + (i % 5) });
      col.setHSL(0.0 + ((i * 37) % 10) / 120, 0.6, 0.12 + ((i * 13) % 7) / 60);
      this.crowd.setColorAt(i, col);
    }
    this.scene.add(this.crowd);
  }

  // ---------------------------------------------------------------- fighters
  private buildFighter(f: Fighter): FighterView {
    const b = buildBody(f);
    const pc = PLAYER_COLORS[f.id % PLAYER_COLORS.length];
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.48, 32), new THREE.MeshBasicMaterial({ color: pc, transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    b.root.add(ring);
    // a ring of fire under a fighter whose special is ready
    const fury = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 32),
      new THREE.MeshBasicMaterial({ color: 0xff7a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    fury.rotation.x = -Math.PI / 2;
    fury.position.y = 0.03;
    b.root.add(fury);
    const label = labelSprite(`P${f.id + 1}${f.human ? "" : "·cpu"}`, pc);
    label.position.y = 2.15;
    b.root.add(label);

    const stars = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0xffff60 }));
      s.position.set(Math.cos((i * Math.PI * 2) / 3) * 0.25, 0, Math.sin((i * Math.PI * 2) / 3) * 0.25);
      stars.add(s);
    }
    stars.position.y = 1.95;
    b.root.add(stars);
    // the charge / reversal / special glow around the body
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x80e0ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    aura.position.y = 1.1;
    b.root.add(aura);

    let marker: THREE.Mesh | null = null;
    if (f.human) {
      marker = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 4), new THREE.MeshBasicMaterial({ color: pc, transparent: true, opacity: 0.9, depthTest: false }));
      marker.rotation.x = Math.PI; // point down
      marker.renderOrder = 11;
      this.scene.add(marker);
    }
    this.scene.add(b.root);
    return { ...b, ring, fury, label, stars, aura, marker };
  }

  attach(world: World): void {
    for (const v of this.fighters) {
      this.scene.remove(v.root);
      if (v.marker) this.scene.remove(v.marker);
    }
    for (const p of this.pickups.values()) this.scene.remove(p);
    for (const g of this.geysers) this.scene.remove(g);
    this.fighters = world.fighters.map((f) => this.buildFighter(f));
    this.pickups.clear();
    this.geysers = [];
    this.world = world;
    this.camTarget.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- cues
  /** Turn one simulation step's cues into effects. Called once per step, before the next. */
  cue(cues: Cue[], w: World): void {
    const fs = w.s.fighters;
    const at = (f: Fighter, h: number) => toV(f.x, f.y, h);
    for (const q of cues) {
      switch (q.kind) {
        case "hit": {
          const d = fs[q.b ?? -1];
          if (!d) break;
          const a = fs[q.a];
          const dmg = q.dmg ?? 4;
          const heavy = dmg >= 8 || (q.stop ?? 0) >= 9;
          const p = at(d, PART_H[q.part ?? "torso"]);
          if (a) {
            // the contact point: on the victim's side facing the attacker
            const dx = a.x - d.x;
            const dy = a.y - d.y;
            const dd = Math.hypot(dx, dy) || 1;
            p.add(toV((dx / dd) * 0.3, (dy / dd) * 0.3));
          }
          this.fx.burst(p, { count: Math.round(8 + dmg * 2.5), speed: 3 + dmg * 0.4, color: heavy ? 0xffe0a0 : 0xffa040, life: 0.3, gravity: 6 });
          this.fx.ring(p, heavy ? 0xfff0c0 : 0xff9a40, heavy ? 1.1 : 0.6, heavy ? 0.25 : 0.16);
          if (!a) this.fx.burst(at(d, 0.4), { count: 10, speed: 2.5, color: 0xff5010, life: 0.5, up: 2 }); // burnt by the arena
          const v = this.fighters[d.id];
          if (v) {
            v.flash = Math.max(v.flash, heavy ? 1 : 0.7);
            v.hurt = { part: q.part ?? "torso", age: 0 };
          }
          this.shake = Math.min(1, this.shake + (heavy ? 0.45 : 0.15));
          if (heavy) this.punchIn(p, 0.6);
          this.hype = Math.min(1, this.hype + dmg * 0.01);
          break;
        }
        case "block": {
          const d = fs[q.b ?? -1];
          const a = fs[q.a];
          if (!d || !a) break;
          const p = at(d, 1.2).lerp(at(a, 1.2), 0.3);
          this.fx.burst(p, { count: 8, speed: 2.5, color: 0x70b0ff, life: 0.2, gravity: 3 });
          this.fx.ring(p, 0x80c0ff, 0.5, 0.14);
          this.shake = Math.min(1, this.shake + 0.08);
          break;
        }
        case "reversal": {
          const d = fs[q.a];
          const a = fs[q.b ?? -1];
          if (!d) break;
          const p = a ? at(d, 1.2).lerp(at(a, 1.2), 0.5) : at(d, 1.2);
          this.fx.ring(p, 0x80f0ff, 1.6, 0.3);
          this.fx.ring(at(d, 0.05), 0x60d0ff, 2.6, 0.35, true);
          this.fx.burst(p, { count: 30, speed: 5, color: 0xa0f0ff, life: 0.35, gravity: 2 });
          this.shake = Math.min(1, this.shake + 0.4);
          this.punchIn(p, 0.7);
          this.hype = Math.min(1, this.hype + 0.35);
          break;
        }
        case "grab": {
          const a = fs[q.a];
          if (a) this.fx.ring(at(a, 1.1), 0xffffff, 0.5, 0.12);
          break;
        }
        case "throw":
          this.shake = Math.min(1, this.shake + 0.3);
          this.hype = Math.min(1, this.hype + 0.2);
          break;
        case "land": {
          const f = fs[q.a];
          if (!f) break;
          this.fx.burst(at(f, 0.1), { count: 14, speed: 1.6, color: 0x3a2a24, life: 0.6, gravity: 0.5, up: 0.6, dust: true });
          this.fx.ring(at(f, 0.04), 0xff7040, 1.2, 0.25, true);
          this.shake = Math.min(1, this.shake + 0.2);
          break;
        }
        case "detach": {
          const f = fs[q.a];
          if (!f) break;
          this.fx.burst(at(f, q.part?.startsWith("arm") ? 1.3 : 0.6), { count: 26, speed: 3.5, color: 0xc01000, life: 0.6, gravity: 9, up: 1.5 });
          this.shake = Math.min(1, this.shake + 0.3);
          break;
        }
        case "ko": {
          const f = fs[q.a];
          if (!f) break;
          this.fx.burst(at(f, 1.1), { count: 70, speed: 7, color: 0xff4010, life: 0.8, gravity: 5, up: 1 });
          this.fx.ring(at(f, 1.1), 0xff6020, 2.4, 0.4);
          this.fx.ring(at(f, 0.05), 0xff3000, 3.5, 0.5, true);
          this.shake = 1;
          this.punchIn(at(f, 1), 1);
          this.hype = 1;
          break;
        }
        case "special": {
          const f = fs[q.a];
          if (!f) break;
          const c = SPECIAL_COLOR[STYLES[f.style].special] ?? 0xffa030;
          this.fx.ring(at(f, 0.05), c, 2.2, 0.35, true);
          this.fx.burst(at(f, 1), { count: 30, speed: 3, color: c, life: 0.5, gravity: -2 });
          this.punchIn(at(f, 1), 0.5);
          this.hype = Math.min(1, this.hype + 0.3);
          break;
        }
        case "geyser":
          this.shake = Math.min(1, this.shake + 0.35);
          break;
        case "burn": {
          const p = w.s.pickups.find((x) => x.owner === q.a && x.part === q.part);
          if (p) this.fx.burst(toV(p.x, p.y, 0.1), { count: 16, speed: 1.5, color: 0xff6010, life: 0.7, gravity: -2 });
          break;
        }
        case "crowd":
        case "win":
          this.hype = 1;
          break;
        default:
          break;
      }
    }
    // the specials' own effects, on their active frames
    for (const f of fs) {
      if (f.state !== "attack" || !f.move?.startsWith("sp") || f.stop > 0) continue;
      const m = w.eff(f, f.move);
      const at0 = f.t - 1 === m.startup;
      const active = f.t - 1 >= m.startup && f.t - 1 < m.startup + m.active;
      const c = SPECIAL_COLOR[f.move] ?? 0xffa030;
      if (f.move === "spFire" && at0) {
        // a jet of hellfire along the strike's reach
        for (let i = 1; i <= 8; i++) {
          const r = (m.reach * i) / 8;
          this.fx.burst(toV(f.x + Math.cos(f.facing) * r, f.y + Math.sin(f.facing) * r, 1.3), { count: 6, speed: 1.2, color: c, life: 0.4, gravity: -3 });
        }
      } else if (f.move === "spSlam" && at0) {
        this.fx.ring(at(f, 0.05), c, m.reach * 2.2, 0.35, true);
        this.fx.burst(at(f, 0.1), { count: 30, speed: 2.5, color: 0x3a2a24, life: 0.7, gravity: 0.5, up: 1, dust: true });
        this.shake = Math.min(1, this.shake + 0.5);
      } else if (f.move === "spSpin" && at0) {
        this.fx.ring(at(f, 0.9), c, m.reach * 2, 0.3, true);
      } else if (f.move === "spBlade" && at0) {
        this.fx.ring(at(f, 1.2), c, m.reach * 2, 0.25, true);
      } else if (f.move === "spCharge" && active && f.t % 3 === 0) {
        this.fx.burst(at(f, 0.1), { count: 4, speed: 1, color: 0x3a2a24, life: 0.5, gravity: 0, up: 0.5, dust: true });
      }
    }
  }

  private punchIn(p: THREE.Vector3, k: number): void {
    if (k >= this.punch) this.punchAt.copy(p);
    this.punch = Math.max(this.punch, k);
  }

  // ---------------------------------------------------------------- per frame
  render(time: number, dt: number): void {
    const w = this.world;
    if (w) this.sync(w, time, dt);
    // lava flow and embers
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
    // the crowd bounces with the hype
    this.hype *= Math.exp(-dt * 0.6);
    const amp = 0.04 + 0.3 * this.hype;
    this.crowdBase.forEach((c, i) => {
      this.dummy.position.set(c.x, c.y + Math.abs(Math.sin(time * c.sp + c.ph)) * amp, c.z);
      this.dummy.rotation.set(0, -Math.atan2(c.z, c.x), Math.sin(time * 2 + c.ph) * 0.1);
      this.dummy.updateMatrix();
      this.crowd.setMatrixAt(i, this.dummy.matrix);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
    this.fx.update(dt, this.camera);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private sync(w: World, time: number, dt: number): void {
    const s = w.s;
    const centre = new THREE.Vector3();
    let n = 0;
    s.fighters.forEach((f, i) => {
      const v = this.fighters[i];
      v.root.position.copy(toV(f.x, f.y));
      v.root.rotation.y = yaw(f.facing);
      syncLimbs(v, f);
      v.hurt.age += dt;
      v.flash = Math.max(0, v.flash - dt * 9);
      const { p, rate, snap } = targetPose(f, w, time, v.hurt);
      if (f.state === "ko") p.y -= Math.min(1.2, f.t / 120);
      // the victim of a hit shudders while the hitstop holds it
      const jitter = f.stop > 0 && v.hurt.age < 0.3 ? 0.07 : 0;
      // nothing moves during a hitstop: the pose holds too
      applyPose(v, p, f.stop > 0 ? 0 : rate, snap && f.stop === 0, dt, jitter);

      const aura = v.aura.material as THREE.MeshBasicMaterial;
      aura.opacity = 0;
      if (f.state === "attack" && f.chargeHeld && f.charge > 0) {
        aura.color.set(0x80e0ff);
        aura.opacity = 0.08 + (0.3 * f.charge) / 60;
      } else if (f.state === "reversal" && f.t < 8) {
        aura.color.set(0x80e0ff);
        aura.opacity = 0.2;
      } else if (f.state === "attack" && f.move?.startsWith("sp")) {
        aura.color.set(SPECIAL_COLOR[f.move] ?? 0xffa030);
        aura.opacity = 0.25;
      }
      v.stars.visible = f.state === "dizzy";
      v.stars.rotation.y = time * 5;
      const ready = f.fury >= FURY.cost && f.state !== "ko";
      const fm = v.fury.material as THREE.MeshBasicMaterial;
      fm.opacity = ready ? 0.45 + 0.35 * Math.sin(time * 8) : 0;
      v.fury.scale.setScalar(f.fury >= FURY.max ? 1.15 : 1);

      const flicker = f.invuln > 0 && f.state !== "down" && f.state !== "wakeup" && Math.floor(s.frame / 4) % 2 === 0;
      v.body.visible = !flicker;
      v.label.visible = f.state !== "ko";
      v.ring.visible = f.state !== "ko";
      if (v.marker) {
        const tg = s.fighters[f.target];
        v.marker.visible = !!tg && tg.id !== f.id && alive(tg) && alive(f);
        if (tg) v.marker.position.copy(toV(tg.x, tg.y, 2.5 + Math.sin(time * 6) * 0.06));
      }
      if (f.state !== "ko") {
        centre.add(v.root.position);
        n++;
      }
    });

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

    // camera: frames everyone still standing, punches in on big hits, shakes with trauma
    if (n) centre.divideScalar(n);
    let spread = 4;
    for (const f of s.fighters) if (f.state !== "ko") spread = Math.max(spread, Math.hypot(f.x - centre.x, -f.y - centre.z));
    centre.lerp(new THREE.Vector3(0, 0, 0), 0.35);
    const k = 1 - Math.exp(-dt * 3);
    this.camTarget.lerp(centre, k);
    this.camDist += (Math.min(26, 9 + spread * 1.5) - this.camDist) * k;
    this.punch *= Math.exp(-dt * 4);
    const pk = this.punch * this.punch;
    const tx = this.camTarget.x + (this.punchAt.x - this.camTarget.x) * pk * 0.35;
    const tz = this.camTarget.z + (this.punchAt.z - this.camTarget.z) * pk * 0.35;
    const dist = this.camDist * (1 - pk * 0.12);
    const sh = this.shake * this.shake * 0.5;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const jx = (Math.random() - 0.5) * sh;
    const jy = (Math.random() - 0.5) * sh;
    this.camera.position.set(tx + jx, dist * 0.78 + jy, tz + dist * 0.72);
    this.camera.lookAt(tx + jx * 0.5, 0.8 + jy * 0.5, tz);
    const fov = 42 - pk * 3;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private buildPickup(p: Pickup, w: World): THREE.Group {
    const f = w.fighters[p.owner];
    const st = STYLES[f.style];
    const isLeg = p.part.startsWith("leg");
    const g = new THREE.Group();
    const m = new THREE.Mesh(
      new THREE.CapsuleGeometry(isLeg ? 0.08 : 0.065, isLeg ? 0.66 : 0.46, 4, 10),
      new THREE.MeshStandardMaterial({ color: isLeg ? st.accent : st.color, roughness: 0.7 }),
    );
    m.castShadow = true;
    const stump = new THREE.Mesh(new THREE.SphereGeometry(isLeg ? 0.095 : 0.08, 10, 8), new THREE.MeshStandardMaterial({ color: 0x8a0000, emissive: 0x300000 }));
    stump.position.y = (isLeg ? 0.66 : 0.46) / 2 + 0.06;
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
