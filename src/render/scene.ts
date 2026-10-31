// Three.js view of a World. Reads the simulation state each frame and never
// writes to it. The fighters' bodies and poses live in body.ts and each
// stage's arena in stageviews.ts; this file places the fighters, limbs and
// hazards each frame, runs the camera, and turns each step's cues
// into impact effects: hit sparks, flash rings, dust, white hit flashes, a
// shaking and punching-in camera, and hitstop jitter on the victim; impact.ts
// adds the lurch and roll along each blow, the white-hot flash, and the slow
// motion and closing shot of a KO.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { type Fighter, type Geyser, type HazardKind, type PartId, type Pickup } from "../sim/types";
import { FALL_FRAMES, FURY } from "../sim/moves";
import { HAZARDS } from "../sim/arena";
import type { StageId } from "../sim/stages";
import { STYLES } from "../sim/styles";
import { alive, type World } from "../sim/world";
import { CHARACTERS } from "../data/characters";
import { PROP_BY_ID, gearPropsFor } from "../data/props";
import { loadProp, layProp, placeProp, splitByX } from "./props";
import { applyFighterTextures } from "./fighter_textures";
import { PLAYER_COLORS, buildBody, limbGeometry, paintWounds, syncLimbs, type Body, type Target } from "./body";
import { animate, onHit } from "./animate";
import type { Cue } from "./cues";
import { Fx } from "./fx";
import { Impact } from "./impact";
import { CAMERA, cameraOffset, frameShot, type Framee } from "./camera";
import { MotionDebug } from "./motiondebug";
import { canvasTexture, makeStageView, toV, yaw, type StageView } from "./stageviews";

export { PLAYER_COLORS };

// where on the body a hit on each part lands (metres above the floor)
const PART_H: Record<PartId, number> = { head: 1.62, torso: 1.2, armL: 1.3, armR: 1.3, legL: 0.5, legR: 0.5 };
const SPECIAL_COLOR: Record<string, number> = { spSpin: 0xffd040, spCharge: 0xff5020, spFlurry: 0xffa030, spSlam: 0xff3010, spBlade: 0xfff0a0, spFire: 0xff6000 };

interface FighterView extends Body {
  last?: Target; // what the animation decided last frame (the motion debug overlay reads it)
  ring: THREE.Mesh;
  shadowDisc: THREE.Mesh;
  fury: THREE.Mesh;
  label: THREE.Sprite;
  /** a column of light over a human through the countdown, so each player finds their fighter */
  beacon: THREE.Mesh | null;
  stars: THREE.Group;
  aura: THREE.Mesh;
  marker: THREE.Mesh | null; // a human's lock-on chevron, floating over their target
  fell: boolean; // went over the edge: stays out of sight until it respawns
  /** torn-off limbs' stumps still pumping blood, and for how long (s) */
  spurts: { part: "armL" | "armR" | "legL" | "legR"; t: number }[];
  /** seconds until the pool spreads under a knocked-out body, or -1 */
  pool: number;
  /** the 3D prop they are holding, and the prop's id */
  held: THREE.Group | null;
  heldProp: string;
}

/** How long (s) a stump pumps blood after the limb comes off, and its heartbeat (beats/s). */
const SPURT = 2.6;
const PULSE = 1.7;

/** Soft radial contact shadow texture for grounding fighters to the arena floor. */
let contactShadowTex: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture {
  if (contactShadowTex) return contactShadowTex;
  contactShadowTex = canvasTexture(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grd.addColorStop(0, "rgba(0, 0, 0, 0.72)");
    grd.addColorStop(0.55, "rgba(0, 0, 0, 0.36)");
    grd.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
  contactShadowTex.wrapS = contactShadowTex.wrapT = THREE.ClampToEdgeWrapping;
  return contactShadowTex;
}

/** Build a procedural Victorian gaslight & furnace studio environment map for PBR metal/porcelain reflections. */
function buildStudioEnv(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x18141c);
    const hemi = new THREE.HemisphereLight(0x8fa8c8, 0x7a3414, 2.2);
    envScene.add(hemi);
    // Warm gaslight and furnace cards around the horizon + cool skylight overhead
    const cardGeo = new THREE.PlaneGeometry(8, 4);
    const warmMat = new THREE.MeshBasicMaterial({ color: 0xffb86c, side: THREE.DoubleSide });
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, side: THREE.DoubleSide });
    const coolMat = new THREE.MeshBasicMaterial({ color: 0x90b4e8, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + 0.4;
      const card = new THREE.Mesh(cardGeo, i % 2 === 0 ? warmMat : fireMat);
      card.position.set(Math.cos(a) * 10, i % 2 === 0 ? 3.5 : -2.5, Math.sin(a) * 10);
      card.lookAt(0, 0, 0);
      envScene.add(card);
    }
    const skyCard = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), coolMat);
    skyCard.position.set(0, 12, 0);
    skyCard.lookAt(0, 0, 0);
    envScene.add(skyCard);
    const target = pmrem.fromScene(envScene, 0.04);
    pmrem.dispose();
    cardGeo.dispose();
    warmMat.dispose();
    fireMat.dispose();
    coolMat.dispose();
    skyCard.geometry.dispose();
    return target.texture;
  } catch {
    return null;
  }
}

/** The tag over a fighter's head: Victorian brass-framed playbill badge with player colour and pointer chevron. */
function labelSprite(text: string, color: number, human: boolean): THREE.Sprite {
  const w = 160;
  const h = human ? 128 : 64;
  const tex = canvasTexture(w, h, (g) => {
    const css = "#" + color.toString(16).padStart(6, "0");
    const pillY = 6;
    const pillH = human ? 54 : 46;
    const pillW = human ? 124 : 138;
    const pillX = (w - pillW) / 2;
    // Dark Victorian iron plaque with brass trim
    g.fillStyle = "rgba(16, 11, 9, 0.86)";
    g.strokeStyle = css;
    g.lineWidth = human ? 4 : 2.5;
    g.beginPath();
    if (typeof g.roundRect === "function") {
      g.roundRect(pillX, pillY, pillW, pillH, 8);
    } else {
      g.rect(pillX, pillY, pillW, pillH);
    }
    g.fill();
    g.stroke();

    g.font = `900 ${human ? 38 : 30}px Georgia, "Times New Roman", serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 5;
    g.lineJoin = "round";
    g.strokeStyle = "#080504";
    g.strokeText(text, w / 2, pillY + pillH / 2 + 1);
    g.fillStyle = css;
    g.fillText(text, w / 2, pillY + pillH / 2 + 1);
    if (human) {
      g.beginPath();
      g.moveTo(w / 2 - 18, 68);
      g.lineTo(w / 2 + 18, 68);
      g.lineTo(w / 2, 102);
      g.closePath();
      g.strokeStyle = "#080504";
      g.lineWidth = 6;
      g.stroke();
      g.fillStyle = css;
      g.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(human ? 1.25 : 0.95, human ? 1.0 : 0.38, 1);
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
  private gifts = new Map<number, THREE.Group>();
  private hazards: { kind: HazardKind; g: THREE.Group }[] = [];
  private view!: StageView;
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camDist = 22;
  private world: World | null = null;
  private shake = 0; // trauma, 0..1: the offset is trauma squared
  private punch = 0; // camera punch-in toward `punchAt`, 0..1
  private punchAt = new THREE.Vector3();
  private hype = 0; // how loud the crowd is, 0..1
  readonly impact = new Impact();
  private motion: MotionDebug | null = null; // ?debug=motion
  /** blood, splats and pumping stumps (?gore=0 turns them off; a torn-off limb still leaves its stump) */
  gore = true;
  /** pixels at the bottom of the canvas the HUD covers: the camera frames the fight above them */
  private inset = 0;
  /** the countdown before a round: the humans' beacons are up */
  private counting = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    lofi = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = !lofi;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (!lofi) {
      const env = buildStudioEnv(this.renderer);
      if (env) this.scene.environment = env;
    }
    // the select screen shows the first stage behind it
    this.setStage("hell-toilet");
    this.scene.add(this.fx.group);
    if (!lofi) {
      // selective HDR bloom: makes hellfire, sparks and the halo glow without blowing out characters
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.36, 0.38, 0.88);
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
    // the picture's centre is the middle of what the HUD leaves uncovered
    const inset = Math.min(this.inset, h * 0.4);
    if (inset > 0) this.camera.setViewOffset(w, h + inset, 0, inset, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** How many pixels at the bottom of the canvas the HUD covers. */
  setInset(px: number): void {
    const v = Math.max(0, Math.round(px));
    if (v === this.inset) return;
    this.inset = v;
    this.resize();
  }

  /** The countdown before a round: up, every human's fighter stands in a column of their colour. */
  countdown(on: boolean): void {
    this.counting = on;
  }

  // ---------------------------------------------------------------- arena
  /** Swap in the view of another stage. */
  setStage(id: StageId): void {
    if (this.view?.id === id) return;
    if (this.view) {
      this.scene.remove(this.view.group);
      this.view.dispose();
    }
    this.view = makeStageView(id);
    this.scene.add(this.view.group);
    this.scene.background = new THREE.Color(this.view.background);
    const [c, near, far] = this.view.fog;
    this.scene.fog = new THREE.Fog(c, near, far);
  }

  get stage(): StageId {
    return this.view.id;
  }

  // ---------------------------------------------------------------- fighters
  private buildFighter(f: Fighter): FighterView {
    const fighterId = CHARACTERS[f.style].id;
    // the approved props this fighter wears: they stand in for the game's own
    // drawing of that piece of kit
    const gear = gearPropsFor(fighterId);
    const b = buildBody(f, new Set(gear.map((p) => p.gear)));
    applyFighterTextures(fighterId, b);
    const pc = PLAYER_COLORS[f.id % PLAYER_COLORS.length];

    // Soft dark ground contact shadow disc underneath the fighter so boots stay visually anchored
    const shadowDisc = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15),
      new THREE.MeshBasicMaterial({
        map: getContactShadowTexture(),
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      }),
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.012;
    b.root.add(shadowDisc);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.48, 40),
      new THREE.MeshBasicMaterial({ color: pc, transparent: true, opacity: 0.82, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    b.root.add(ring);
    // a ring of fire under a fighter whose special is ready
    const fury = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 36),
      new THREE.MeshBasicMaterial({ color: 0xff7a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    fury.rotation.x = -Math.PI / 2;
    fury.position.y = 0.03;
    b.root.add(fury);
    const label = labelSprite(`P${f.id + 1}${f.human ? "" : "·cpu"}`, pc, f.human);
    label.position.y = f.human ? 2.45 : 2.15;
    b.root.add(label);
    let beacon: THREE.Mesh | null = null;
    if (f.human) {
      // bright at the floor, fading out above the head
      const fade = canvasTexture(4, 64, (g) => {
        const grad = g.createLinearGradient(0, 0, 0, 64);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(1, "rgba(255,255,255,1)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 4, 64);
      });
      beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.6, 3.4, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: pc, alphaMap: fade, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beacon.position.y = 1.7;
      beacon.visible = false;
      b.root.add(beacon);
    }

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
    // the 3D props go on as their models arrive; until then the fighter wears
    // the game's own drawing of that piece of kit
    for (const spec of gear) {
      loadProp(spec, (model) => {
        if (spec.bone === "forearms") {
          // a matched pair in one mesh: one half on each arm
          const [left, right] = splitByX(model);
          placeProp(spec, b.joints.elbowL, left);
          placeProp(spec, b.joints.elbowR, right);
        } else if (spec.bone === "spine") {
          placeProp(spec, b.spine, model);
        } else {
          placeProp(spec, b.head, model);
        }
      });
    }
    const view: FighterView = { ...b, ring, shadowDisc, fury, label, beacon, stars, aura, marker, fell: false, spurts: [], pool: -1, held: null, heldProp: "" };
    this.holdWeapon(view, f);
    return view;
  }

  /**
   * Put the prop the fighter is holding in their hand, and take away the one
   * they are not.
   *
   * The hand is the end of the forearm bone, so the prop rides on that bone
   * and follows the arm as it moves. The hand closes a little around what it
   * holds, so a weapon is not swallowed by a fist-sized ball.
   */
  private holdWeapon(v: FighterView, f: Fighter): void {
    if (v.heldProp === f.weapon) return;
    if (v.held) {
      v.held.parent?.remove(v.held);
      v.held = null;
    }
    v.heldProp = f.weapon;
    v.hands.R.scale.setScalar(f.weapon ? 0.75 : 1);
    if (!f.weapon) return;
    const spec = PROP_BY_ID[f.weapon];
    if (!spec) return;
    loadProp(spec, (model) => {
      // they may have dropped it, or taken another, while it was loading
      if (v.heldProp !== f.weapon) return;
      v.held = placeProp(spec, v.joints.elbowR, model);
    });
  }

  attach(world: World): void {
    for (const v of this.fighters) {
      this.scene.remove(v.root);
      if (v.marker) this.scene.remove(v.marker);
    }
    for (const p of this.pickups.values()) this.scene.remove(p);
    for (const g of this.gifts.values()) this.scene.remove(g);
    for (const h of this.hazards) this.scene.remove(h.g);
    this.setStage(world.s.stage);
    this.fighters = world.fighters.map((f) => this.buildFighter(f));
    this.pickups.clear();
    this.gifts.clear();
    this.hazards = [];
    this.fx.clear();
    this.impact.reset();
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
          if (heavy) this.fx.steam(p, 10);
          if (a) {
            // the force of it carries on through: sparks out the far side, and the camera lurches with it
            const line = toV(d.x - a.x, d.y - a.y);
            this.fx.streak(p, line.clone().normalize().setY(0.25), { count: Math.round(4 + dmg * 1.5), speed: 5 + dmg * 0.6, color: heavy ? 0xfff4d0 : 0xffc070 });
            this.impact.hit(line, dmg, heavy);
          }
          if (this.gore && dmg >= 3) {
            // blood sprays out of the far side of the blow, the head bleeding most
            const away = a ? toV(d.x - a.x, d.y - a.y).normalize() : new THREE.Vector3();
            const k = (q.part === "head" ? 1.6 : 1) * dmg;
            this.fx.bleed(p, away.setY(0.7), { count: Math.round(3 + k * 1.3), speed: 1.6 + dmg * 0.22, spread: 1.4, size: 0.5 + Math.min(1, dmg / 14) });
          }
          this.fx.ring(p, heavy ? 0xfff0c0 : 0xff9a40, heavy ? 1.1 : 0.6, heavy ? 0.25 : 0.16);
          if (!a) this.fx.burst(at(d, 0.4), { count: 10, speed: 2.5, color: 0xff5010, life: 0.5, up: 2 }); // burnt by the arena
          const v = this.fighters[d.id];
          if (v) {
            v.flash = Math.max(v.flash, heavy ? 0.65 : 0.45);
            // the reaction starts on the pose the blow found; the blow whips the body
            onHit(v, d, a, q.part ?? "torso", dmg, q.stop ?? 0);
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
          if (this.fighters[q.a]) this.fighters[q.a].cue.throwAge = 0;
          this.shake = Math.min(1, this.shake + 0.3);
          this.hype = Math.min(1, this.hype + 0.2);
          break;
        case "launch": {
          // up it goes: a ring at the feet, and the crowd likes it
          const d = fs[q.b ?? -1];
          if (d) this.fx.ring(at(d, 0.05), 0xffd060, 1.4, 0.3, true);
          this.hype = Math.min(1, this.hype + 0.15);
          break;
        }
        case "airgrab": {
          const d = fs[q.b ?? -1];
          if (d) this.fx.ring(at(d, d.z + 0.8), 0xffd060, 0.8, 0.2);
          this.shake = Math.min(1, this.shake + 0.2);
          this.hype = Math.min(1, this.hype + 0.3);
          break;
        }
        case "crunch": {
          // a flying body into a wall, a prop or a fighter: debris, and the camera takes the blow with it
          const f = fs[q.a];
          if (!f) break;
          const dmg = q.dmg ?? 6;
          this.fx.burst(at(f, Math.max(0.5, f.z + 0.6)), { count: 18, speed: 2.4, color: 0x8a8070, life: 0.6, gravity: 3, up: 0.8, dust: true });
          this.fx.ring(at(f, Math.max(0.5, f.z + 0.6)), 0xffffff, 0.9, 0.18);
          this.impact.hit(toV(-f.slideX, -f.slideY).normalize(), dmg, dmg >= 8);
          this.shake = Math.min(1, this.shake + 0.35);
          this.hype = Math.min(1, this.hype + 0.2);
          break;
        }
        case "bounce":
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
          const v = this.fighters[f.id];
          const part = q.part as FighterView["spurts"][number]["part"] | undefined;
          if (this.gore && v && part && part in v.stumps) {
            // the limb tears away in a gush, and the stump keeps pumping
            v.root.updateMatrixWorld(true);
            const from = v.stumps[part].getWorldPosition(new THREE.Vector3());
            this.fx.bleed(from, stumpDir(v, part), { count: 40, speed: 3.2, spread: 2, size: 1.4 });
            this.fx.splat(from.x, from.z, 0.55);
            v.spurts.push({ part, t: 0 });
          } else this.fx.burst(at(f, q.part?.startsWith("arm") ? 1.3 : 0.6), { count: 26, speed: 3.5, color: 0xc01000, life: 0.6, gravity: 9, up: 1.5 });
          this.shake = Math.min(1, this.shake + 0.3);
          break;
        }
        case "ko": {
          const f = fs[q.a];
          if (!f) break;
          this.fx.burst(at(f, 1.1), { count: 70, speed: 7, color: 0xff4010, life: 0.8, gravity: 5, up: 1 });
          if (this.gore && this.fighters[f.id]) {
            this.fx.bleed(at(f, 1.3), new THREE.Vector3(0, 1, 0), { count: 30, speed: 2.5, spread: 2.2, size: 1 });
            // once the body is down, a pool spreads under it
            this.fighters[f.id].pool = 0.9;
          }
          this.fx.ring(at(f, 1.1), 0xff6020, 2.4, 0.4);
          this.fx.ring(at(f, 0.05), 0xff3000, 3.5, 0.5, true);
          this.shake = 1;
          this.punchIn(at(f, 1), 1);
          this.hype = 1;
          // time slows on a KO; on the one that wins the match it nearly stops, and the camera stays on the body
          this.impact.ko(at(f, 0.6), w.s.winner >= 0);
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
        case "geyser": {
          // a hazard strikes: the hellfire geyser, a steel beam, a catapult stone, an arrow volley
          const p = toV(q.x ?? 0, q.y ?? 0, 0.1);
          if (q.what === "beam" || q.what === "boulder") {
            this.fx.burst(p, { count: 30, speed: 3, color: 0x6a5a48, life: 0.8, gravity: 1, up: 1.4, dust: true });
            this.fx.ring(p, q.what === "beam" ? 0xffd080 : 0xc0a080, 2.6, 0.35, true);
            this.shake = Math.min(1, this.shake + 0.5);
          } else if (q.what === "arrows") this.fx.burst(p, { count: 14, speed: 1.5, color: 0x8a7050, life: 0.4, gravity: 3, dust: true });
          else this.shake = Math.min(1, this.shake + 0.35);
          break;
        }
        case "crash":
        case "wreck": {
          const p = toV(q.x ?? 0, q.y ?? 0, 0.9);
          const big = q.kind === "wreck";
          this.fx.burst(p, { count: big ? 60 : 16, speed: big ? 6 : 3, color: big ? 0xff8020 : 0xffe090, life: big ? 0.9 : 0.3, gravity: 5, up: big ? 2 : 0.5 });
          if (big) {
            this.fx.ring(toV(q.x ?? 0, q.y ?? 0, 0.05), 0xff5010, 4, 0.5, true);
            this.punchIn(p, 0.8);
            this.hype = 1;
          }
          this.shake = Math.min(1, this.shake + (big ? 0.8 : q.what === "vehicle" ? 0.35 : 0.12));
          break;
        }
        case "crack":
          this.fx.burst(toV(q.x ?? 0, q.y ?? 0, 0.05), { count: 10, speed: 1.2, color: 0x6a6660, life: 0.5, gravity: 2, up: 0.4, dust: true });
          break;
        case "collapse":
          this.fx.burst(toV(q.x ?? 0, q.y ?? 0, 0), { count: 30, speed: 2.5, color: 0x8a8680, life: 0.9, gravity: 3, up: 1, dust: true });
          this.shake = Math.min(1, this.shake + 0.25);
          break;
        case "fall":
          this.hype = 1;
          break;
        case "impact":
          // the blimp hits the ground: dust and fire all along the hull
          for (let x = -9; x <= 9; x += 3) {
            this.fx.burst(toV(x, 0, 0.1), { count: 30, speed: 5, color: 0x8a7a60, life: 1.2, gravity: 2, up: 1.5, dust: true });
            this.fx.burst(toV(x, 0, 0.3), { count: 24, speed: 6, color: 0xff8030, life: 0.7, gravity: 3, up: 2 });
          }
          this.shake = 1;
          this.hype = 1;
          break;
        case "capture": {
          const f = fs[q.a];
          if (f) this.fx.ring(at(f, 0.05), PLAYER_COLORS[f.id], 3, 0.4, true);
          break;
        }
        case "burn": {
          const p = w.s.pickups.find((x) => x.owner === q.a && x.part === q.part);
          if (p) this.fx.burst(toV(p.x, p.y, 0.1), { count: 16, speed: 1.5, color: 0xff6010, life: 0.7, gravity: -2 });
          break;
        }
        case "win": {
          // a match won without a KO (the throne): the closing shot is on the winner
          const f = fs[q.a];
          if (f && !this.impact.finale) this.impact.finale = at(f, 0.9);
          this.hype = 1;
          break;
        }
        case "crowd":
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
        this.fx.steam(at(f, 0.9), 12);
      } else if (f.move === "spBlade" && at0) {
        this.fx.ring(at(f, 1.2), c, m.reach * 2, 0.25, true);
        this.fx.steam(at(f, 1.1), 10);
      } else if (f.move === "spCharge" && active && f.t % 3 === 0) {
        this.fx.burst(at(f, 0.1), { count: 4, speed: 1, color: 0x3a2a24, life: 0.5, gravity: 0, up: 0.5, dust: true });
        this.fx.steam(at(f, 0.6), 5);
      }
      if (f.style === 7 && f.state === "attack" && f.t % 8 === 0) {
        this.fx.steam(at(f, 1.0), 4, 0.8);
      }
    }
  }

  /** The stumps pump blood in heartbeats, weaker each beat; a knocked-out body bleeds a pool under it. */
  private bleedOut(v: FighterView, f: Fighter, dt: number): void {
    if (v.spurts.length) v.root.updateMatrixWorld(true);
    for (const sp of v.spurts) {
      const beat = Math.floor(sp.t * PULSE);
      sp.t += dt;
      if (Math.floor(sp.t * PULSE) === beat || sp.t > SPURT || !v.root.visible) continue;
      const k = 1 - sp.t / SPURT;
      this.fx.bleed(v.stumps[sp.part].getWorldPosition(new THREE.Vector3()), stumpDir(v, sp.part), { count: Math.round(4 + 10 * k), speed: 0.8 + 2.6 * k, spread: 0.45, size: 0.8 });
    }
    v.spurts = v.spurts.filter((sp) => sp.t <= SPURT && !f.parts[sp.part].attached);
    if (v.pool >= 0) {
      v.pool -= dt;
      if (v.pool < 0 && v.root.visible) {
        const at = v.hips.getWorldPosition(new THREE.Vector3());
        this.fx.splat(at.x, at.z, 1.1 + Math.random() * 0.4);
      }
    }
  }

  private punchIn(p: THREE.Vector3, k: number): void {
    if (k >= this.punch) this.punchAt.copy(p);
    this.punch = Math.max(this.punch, k);
  }

  // ---------------------------------------------------------------- per frame
  /** ?debug=motion: show what the animation of every fighter is doing in `el`, and mark the planted feet. */
  debugMotion(el: HTMLElement): void {
    this.motion = new MotionDebug(el);
    this.scene.add(this.motion.group);
  }

  /** How fast the fight runs now (slow motion on a KO): main.ts steps the sim and passes dt at this pace. */
  get timeScale(): number {
    return this.impact.timeScale;
  }

  /** Draw a frame; `dt` is game time (slowed in slow motion), `real` the wall-clock time since the last. */
  render(time: number, dt: number, real = dt): void {
    this.impact.update(real);
    this.renderer.toneMappingExposure = 1 + 0.42 * this.impact.flash;
    if (this.bloom) this.bloom.strength = 0.36 + 0.55 * this.impact.flash;
    const w = this.world;
    if (w) this.sync(w, time, dt);
    if (w && this.motion) this.motion.flush(w.s.fighters.length);
    this.hype *= Math.exp(-dt * 0.6);
    this.view.update(w, time, dt, this.hype);
    this.fx.update(dt, this.camera);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private sync(w: World, time: number, dt: number): void {
    const s = w.s;
    const framees: Framee[] = [];
    s.fighters.forEach((f, i) => {
      const v = this.fighters[i];
      v.root.position.copy(toV(f.x, f.y, f.z)); // up in a juggle
      v.root.rotation.y = yaw(f.facing);
      // the prop in their hand: they may have picked one up or let one go
      this.holdWeapon(v, f);
      const car = f.state === "driving" ? s.arena.vehicles[f.vehicle] : undefined;
      if (car) {
        const st = this.view.seat(car);
        v.root.position.copy(st.pos);
        v.root.rotation.y = yaw(st.facing);
      }
      if (f.state === "falling") {
        // over the edge: a long drop
        v.root.position.y -= 0.5 * 0.006 * f.t * f.t; // floaty, like the juggles
      }
      syncLimbs(v, f);
      if (this.gore) {
        this.bleedOut(v, f, dt);
        paintWounds(v, f);
      }
      v.flash = Math.max(0, v.flash - dt * 9);
      // the victim of a hit shudders while the hitstop holds it
      const jitter = f.stop > 0 && v.hurt.age < 0.3 ? 0.07 : 0;
      v.last = animate(v, f, w, time, dt, jitter);
      this.motion?.track(i, v, f, v.last, dt);

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
      const gone = f.state === "ko" || f.out || (f.state === "falling" && f.t > FALL_FRAMES * 0.8 && s.winner !== f.id);
      if (f.state === "falling") v.fell = true;
      else if (alive(f)) v.fell = false;
      v.root.visible = !(v.fell && f.state !== "falling") && v.root.position.y > -60;
      v.label.visible = !gone;
      if (v.beacon) {
        v.beacon.visible = this.counting;
        (v.beacon.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.15 * Math.sin(time * 7);
        // through the countdown the human's tag bounces
        v.label.position.y = 2.45 + (this.counting ? Math.abs(Math.sin(time * 5)) * 0.35 : 0);
      }
      const groundedRing = !gone && f.state !== "driving" && f.state !== "falling";
      v.ring.visible = groundedRing;
      v.shadowDisc.visible = groundedRing;
      v.shadowDisc.position.y = Math.max(0.012, -f.z + 0.012);
      const airScale = Math.max(0.35, 1 - f.z * 0.35);
      v.shadowDisc.scale.setScalar(airScale);
      (v.shadowDisc.material as THREE.MeshBasicMaterial).opacity = 0.78 * airScale;
      if (v.marker) {
        const tg = s.fighters[f.target];
        v.marker.visible = !!tg && tg.id !== f.id && alive(tg) && alive(f);
        if (tg) v.marker.position.copy(toV(tg.x, tg.y, 2.5 + Math.sin(time * 6) * 0.06));
      }
      framees.push({ x: v.root.position.x, z: v.root.position.z, human: f.human, alive: alive(f), target: f.target });
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

    // the gifts the Gallery has thrown into the pit, lying where they landed
    const seenGifts = new Set<number>();
    for (const g of s.gifts) {
      seenGifts.add(g.id);
      let gm = this.gifts.get(g.id);
      if (!gm) {
        gm = new THREE.Group();
        this.gifts.set(g.id, gm);
        this.scene.add(gm);
        const spec = PROP_BY_ID[g.prop];
        if (spec) {
          loadProp(spec, (model) => {
            // it may have been picked up while the model was loading
            if (!this.gifts.has(g.id)) return;
            gm!.add(layProp(model));
          });
        }
      }
      gm.position.copy(toV(g.x, g.y, g.z + 0.09));
      gm.rotation.y += g.spin;
    }
    for (const [id, gm] of this.gifts) {
      if (!seenGifts.has(id)) {
        this.scene.remove(gm);
        this.gifts.delete(id);
      }
    }

    // hazards: a warning ring, then the strike
    s.geysers.forEach((gs, i) => {
      let h = this.hazards[i];
      if (!h || h.kind !== gs.kind) {
        if (h) this.scene.remove(h.g);
        h = { kind: gs.kind, g: buildHazard(gs.kind) };
        this.hazards[i] = h;
        this.scene.add(h.g);
      }
      h.g.visible = true;
      animateHazard(h.g, gs, time);
    });
    for (let i = s.geysers.length; i < this.hazards.length; i++) this.hazards[i].g.visible = false;

    // camera: frames the action (camera.ts), punches in on big hits, shakes with trauma
    const shot = frameShot(framees);
    const k = 1 - Math.exp(-dt * CAMERA.follow);
    this.camTarget.lerp(new THREE.Vector3(shot.x, 0, shot.z), k);
    // stand back by as much more as the HUD covers, so the action stays in the picture above it
    const h = this.canvas.clientHeight || window.innerHeight;
    // (the view offset narrows the lens to h of h + inset, and the fight has h - inset of that)
    const hud = Math.min(this.inset, h * 0.4);
    const cover = h > 0 ? (h + hud) / (h - hud) : 1;
    this.camDist += (shot.dist * cover - this.camDist) * k;
    this.punch *= Math.exp(-dt * 4);
    const pk = Math.min(1, this.punch * this.punch * CAMERA.punch);
    let tx = this.camTarget.x + (this.punchAt.x - this.camTarget.x) * pk * 0.35;
    let tz = this.camTarget.z + (this.punchAt.z - this.camTarget.z) * pk * 0.35;
    let dist = this.camDist * (1 - pk * 0.12);
    const im = this.impact;
    let tilt = im.roll;
    let side = 0;
    if (im.finale) {
      // the closing shot: in on the fallen (or the winner), low, tilted, drifting round
      const t = Math.min(1, im.finaleT / 0.9);
      const e = t * t * (3 - 2 * t);
      tx += (im.finale.x - tx) * e;
      tz += (im.finale.z - tz) * e;
      dist += (Math.max(6, dist * 0.45) - dist) * e;
      tilt += 0.07 * e;
      side = Math.sin(im.finaleT * 0.35) * dist * 0.35 * e;
    }
    const ks = CAMERA.shake;
    tx += im.kick.x * ks;
    tz += im.kick.z * ks;
    const sh = this.shake * this.shake * 0.5 * ks;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const jx = (Math.random() - 0.5) * sh;
    const jy = (Math.random() - 0.5) * sh;
    const off = cameraOffset(dist);
    this.camera.position.set(tx + jx + side, CAMERA.lookY + off.y + jy + im.kick.y * ks, tz + off.z);
    this.camera.lookAt(tx + jx * 0.5 - im.kick.x * ks * 0.4, CAMERA.lookY + jy * 0.5, tz - im.kick.z * ks * 0.4);
    if (tilt) this.camera.rotateZ(tilt * ks);
    const fov = CAMERA.fov - pk * 3;
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
    // the same turned limb the body wears, whole: shoulder (or hip) to wrist (or ankle)
    const len = isLeg ? 0.82 : 0.59;
    const m = new THREE.Mesh(
      isLeg ? limbGeometry(len, 0.09, 0.05, 0.014, 0.25) : limbGeometry(len, 0.068, 0.046, 0.012, 0.25),
      new THREE.MeshStandardMaterial({ color: isLeg ? st.accent : st.color, roughness: 0.7 }),
    );
    m.position.y = len / 2;
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

/** Which way a stump points, in the world: out of the shoulder and down, or straight down out of the hip. */
function stumpDir(v: Body, part: "armL" | "armR" | "legL" | "legR"): THREE.Vector3 {
  const side = part.endsWith("L") ? -1 : 1;
  const leg = part.startsWith("leg");
  return new THREE.Vector3(side * (leg ? 0.3 : 1), leg ? -1 : 0.2, 0).transformDirection((leg ? v.hips : v.spine).matrixWorld);
}

const HAZARD_COLOR: Record<HazardKind, number> = { geyser: 0xffa000, beam: 0xffd040, boulder: 0xff6040, arrows: 0xff3030 };

/** A hazard's warning ring (child 0) and the thing that strikes (child 1). */
function buildHazard(kind: HazardKind): THREE.Group {
  const H = HAZARDS[kind];
  const g = new THREE.Group();
  const warn = new THREE.Mesh(new THREE.RingGeometry(H.radius - 0.15, H.radius, 40), new THREE.MeshBasicMaterial({ color: HAZARD_COLOR[kind], transparent: true, depthWrite: false }));
  warn.rotation.x = -Math.PI / 2;
  warn.position.y = 0.04;
  let obj: THREE.Object3D;
  switch (kind) {
    case "geyser": {
      obj = new THREE.Mesh(
        new THREE.CylinderGeometry(H.radius * 0.7, H.radius, 6, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff6010, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
      );
      obj.position.y = 3;
      break;
    }
    case "beam": {
      // a steel I-beam on a crane cable
      const steel = new THREE.MeshStandardMaterial({ color: 0xb0381c, roughness: 0.5, metalness: 0.6 });
      const b = new THREE.Group();
      b.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.3), steel));
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.3), steel);
      top.position.y = 0.3;
      const web = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 0.05), steel);
      web.position.y = 0.15;
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 30, 4), new THREE.MeshBasicMaterial({ color: 0x222222 }));
      cable.position.y = 15.3;
      cable.name = "cable";
      b.add(top, web, cable);
      b.traverse((o) => (o.castShadow = true));
      obj = b;
      break;
    }
    case "boulder": {
      obj = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 1), new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 1, flatShading: true }));
      obj.castShadow = true;
      break;
    }
    case "arrows": {
      const a = new THREE.Group();
      const shaft = new THREE.MeshBasicMaterial({ color: 0x5a4028 });
      const fletch = new THREE.MeshBasicMaterial({ color: 0xe8e0d0 });
      for (let i = 0; i < 26; i++) {
        const r = Math.sqrt(((i * 0.618) % 1)) * H.radius;
        const t = i * 2.39996;
        const arrow = new THREE.Group();
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4), shaft);
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.01), fletch);
        f.position.y = 0.3;
        arrow.add(m, f);
        arrow.position.set(Math.cos(t) * r, 0, Math.sin(t) * r);
        arrow.rotation.set(0.25, 0, 0.15);
        a.add(arrow);
      }
      obj = a;
      break;
    }
  }
  g.add(warn, obj);
  return g;
}

function animateHazard(g: THREE.Group, gs: Geyser, time: number): void {
  const H = HAZARDS[gs.kind];
  g.position.copy(toV(gs.x, gs.y));
  const [warn, obj] = g.children as [THREE.Mesh, THREE.Object3D];
  const wm = warn.material as THREE.MeshBasicMaterial;
  const struck = gs.t >= H.warn;
  wm.opacity = struck ? Math.max(0, 0.6 - (gs.t - H.warn) / H.erupt) : 0.4 + 0.5 * Math.abs(Math.sin(gs.t * (0.2 + (0.4 * gs.t) / H.warn)));
  const k = Math.min(1, gs.t / H.warn); // 0 → 1 over the warning
  const fade = struck ? 1 - (gs.t - H.warn) / H.erupt : 1;
  switch (gs.kind) {
    case "geyser":
      obj.visible = struck;
      obj.scale.y = struck ? 0.3 + Math.min(1, (gs.t - H.warn) / 5) : 1;
      break;
    case "beam": {
      // it hangs high and swings, then drops in the last third of the warning
      const drop = Math.max(0, (k - 0.65) / 0.35);
      obj.position.y = struck ? 0 : 14 * (1 - drop * drop);
      obj.rotation.y = gs.x * 1.3 + (struck ? 0 : Math.sin(time * 1.5) * 0.15);
      obj.rotation.z = struck ? 0.04 : Math.sin(time * 2) * 0.05;
      obj.getObjectByName("cable")!.visible = !struck && drop < 0.05;
      obj.visible = fade > 0.15;
      break;
    }
    case "boulder": {
      // lobbed from beyond the wall (the -y side), landing as the warning ends
      const arc = 1 - k;
      obj.position.set(0, struck ? 0.4 : 0.4 + Math.sin(k * Math.PI) * 9 + arc * 6, struck ? 0 : arc * 26);
      obj.rotation.set(time * 4, time * 3, 0);
      obj.visible = k > 0.15 && fade > 0.1;
      break;
    }
    case "arrows": {
      const fall = Math.max(0, (k - 0.7) / 0.3);
      obj.position.y = struck ? -0.2 : 10 * (1 - fall);
      obj.visible = fall > 0 || struck;
      break;
    }
  }
}
