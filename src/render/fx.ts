// Impact effects: additive spark particles (hit sparks, embers of a KO, dust
// of a fall), expanding flash rings, and blood: dark drops that spray from a
// hit or a stump, fall, and leave a splat where they land, which stays on the
// floor for most of a minute. Everything is pooled, so a busy 8-way brawl
// allocates nothing per frame.
import * as THREE from "three";

export interface BurstOpts {
  count: number;
  speed: number; // m/s
  color: number;
  life?: number; // seconds
  gravity?: number; // m/s^2
  up?: number; // extra upward bias, m/s
  dust?: boolean; // the soft, dark dust layer instead of additive sparks
}

/** A spray of blood: `count` drops thrown along `dir` (a unit vector) at about `speed`, scattered by `spread` (m/s). */
export interface BleedOpts {
  count: number;
  speed: number;
  spread: number;
  /** how big the splats they leave are (1: a drop's worth) */
  size?: number;
}

/** How long (s) a splat stays on the floor, and how long of that it takes to soak away at the end. */
export const SPLAT_LIFE = 45;
const SPLAT_FADE = 6;

class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private base: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grav: Float32Array;
  private next = 0;
  /** a drop that reaches the floor dies there and calls this (blood), instead of skidding along it */
  land: ((x: number, z: number, i: number) => void) | null = null;
  /** what each particle leaves when it lands (a splat's size) */
  readonly mark: Float32Array;

  constructor(
    readonly n: number,
    size: number,
    blending: THREE.Blending,
  ) {
    this.pos = new Float32Array(n * 3).fill(-999);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.grav = new Float32Array(n);
    this.mark = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, blending, depthWrite: false, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
  }

  burst(at: THREE.Vector3, o: BurstOpts, rnd: () => number): void {
    const c = new THREE.Color(o.color);
    for (let k = 0; k < o.count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      // a random direction on the sphere
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = o.speed * (0.35 + rnd() * 0.65);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([r * Math.cos(th) * sp, u * sp + (o.up ?? 0), r * Math.sin(th) * sp], i * 3);
      const v = 0.75 + rnd() * 0.25;
      this.base.set([c.r * v, c.g * v, c.b * v], i * 3);
      this.max[i] = (o.life ?? 0.35) * (0.6 + rnd() * 0.4);
      this.life[i] = this.max[i];
      this.grav[i] = o.gravity ?? 9;
    }
  }

  /** Throw `count` particles along dir, scattered; they last until they land (or three seconds run out). */
  spray(at: THREE.Vector3, dir: THREE.Vector3, o: BleedOpts, color: number, rnd: () => number): void {
    const c = new THREE.Color(color);
    for (let k = 0; k < o.count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = o.speed * (0.4 + rnd() * 0.6);
      const sc = o.spread * rnd();
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([dir.x * sp + r * Math.cos(th) * sc, dir.y * sp + u * sc, dir.z * sp + r * Math.sin(th) * sc], i * 3);
      const v = 0.6 + rnd() * 0.4;
      this.base.set([c.r * v, c.g * v, c.b * v], i * 3);
      this.max[i] = 3;
      this.life[i] = 3;
      this.grav[i] = 9.8;
      this.mark[i] = (o.size ?? 1) * (0.5 + rnd());
    }
  }

  update(dt: number): number {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -999;
        this.col.fill(0, j, j + 3);
        continue;
      }
      alive++;
      this.vel[j + 1] -= this.grav[i] * dt;
      this.vel[j] *= 1 - dt * 2;
      this.vel[j + 2] *= 1 - dt * 2;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] = Math.max(0.02, this.pos[j + 1] + this.vel[j + 1] * dt);
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.land && this.pos[j + 1] <= 0.02 && this.vel[j + 1] < 0) {
        this.land(this.pos[j], this.pos[j + 2], i);
        this.life[i] = 0;
        this.pos[j + 1] = -999;
        this.col.fill(0, j, j + 3);
        alive--;
        continue;
      }
      // blood stays its colour as it flies; sparks and dust fade
      const k = this.land ? 1 : this.life[i] / this.max[i];
      this.col[j] = this.base[j] * k;
      this.col[j + 1] = this.base[j + 1] * k;
      this.col[j + 2] = this.base[j + 2] * k;
    }
    this.points.geometry.getAttribute("position").needsUpdate = true;
    this.points.geometry.getAttribute("color").needsUpdate = true;
    return alive;
  }
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  size: number;
  flat: boolean;
}

/** A splat of blood, drawn once: a round pool with a few drops thrown off it, white on clear (the material colours it). */
function splatTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return new THREE.Texture();
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  g.fillStyle = "#fff";
  const blob = (x: number, y: number, r: number) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  // the pool, lumpy at its edge
  for (let k = 0; k < 9; k++) blob(32 + (rnd() - 0.5) * 14, 32 + (rnd() - 0.5) * 14, 9 + rnd() * 6);
  // the drops it threw
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2;
    const d = 18 + rnd() * 12;
    blob(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 1 + rnd() * 2.6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Splats on the floor: one instanced quad each, in a ring buffer, soaking away at the end of their life. */
class Splats {
  readonly mesh: THREE.InstancedMesh;
  private age: Float32Array;
  private size: Float32Array;
  private spin: Float32Array;
  private at: Float32Array;
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(readonly n: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x9a0a0a,
        map: splatTexture(),
        transparent: true,
        alphaTest: 0.4,
        roughness: 0.12,
        metalness: 0.1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      n,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.age = new Float32Array(n).fill(SPLAT_LIFE);
    this.size = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.at = new Float32Array(n * 2);
  }

  add(x: number, z: number, size: number, spin: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    this.age[i] = 0;
    this.size[i] = size;
    this.spin[i] = spin;
    this.at[i * 2] = x;
    this.at[i * 2 + 1] = z;
    this.put(i, size * 0.5);
  }

  /** How many splats are on the floor. */
  get live(): number {
    let n = 0;
    for (let i = 0; i < this.mesh.count; i++) if (this.age[i] < SPLAT_LIFE) n++;
    return n;
  }

  clear(): void {
    this.age.fill(SPLAT_LIFE);
    this.mesh.count = 0;
    this.next = 0;
  }

  private put(i: number, size: number): void {
    // each a little higher than the last, so overlapping splats never fight over the floor
    this.p.set(this.at[i * 2], 0.006 + (i % 16) * 0.0004, this.at[i * 2 + 1]);
    this.q.setFromEuler(this.e.set(0, this.spin[i], 0));
    this.s.setScalar(Math.max(1e-4, size));
    this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.mesh.count; i++) {
      if (this.age[i] >= SPLAT_LIFE) continue;
      // a fresh splat spreads out over its first fifth of a second, and soaks away at the end
      const was = this.age[i];
      this.age[i] += dt;
      const a = this.age[i];
      if (was < 0.2) this.put(i, this.size[i] * (0.5 + 0.5 * Math.min(1, a / 0.2)));
      else if (a > SPLAT_LIFE - SPLAT_FADE) this.put(i, a >= SPLAT_LIFE ? 0 : this.size[i] * ((SPLAT_LIFE - a) / SPLAT_FADE));
    }
  }
}

export class Fx {
  readonly group = new THREE.Group();
  private sparks = new Particles(900, 0.11, THREE.AdditiveBlending);
  private dust = new Particles(300, 0.32, THREE.NormalBlending);
  private blood = new Particles(800, 0.07, THREE.NormalBlending);
  private splats = new Splats(1200);
  private rings: Ring[] = [];
  private nextRing = 0;
  private seed = 1;
  /** counters for the automated tests */
  readonly stats = { bursts: 0, rings: 0, live: 0, drops: 0, splats: 0 };

  constructor() {
    (this.dust.points.material as THREE.PointsMaterial).opacity = 0.55;
    // a drop of blood is opaque and dark, not a glowing ember
    (this.blood.points.material as THREE.PointsMaterial).opacity = 0.95;
    this.blood.land = (x, z, i) => this.splats.add(x, z, 0.08 + 0.16 * this.blood.mark[i] * (0.5 + this.rnd()), this.rnd() * Math.PI * 2);
    this.group.add(this.sparks.points, this.dust.points, this.blood.points, this.splats.mesh);
    const geo = new THREE.RingGeometry(0.7, 1, 40);
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 1, size: 1, flat: false });
    }
  }

  /** render-side randomness only; the simulation never sees it */
  private rnd = (): number => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  burst(at: THREE.Vector3, o: BurstOpts): void {
    (o.dust ? this.dust : this.sparks).burst(at, o, this.rnd);
    this.stats.bursts++;
  }

  /** Blood thrown from `at` along `dir` (it need not be unit length); where it lands, it splats. */
  bleed(at: THREE.Vector3, dir: THREE.Vector3, o: BleedOpts): void {
    const d = dir.lengthSq() > 1e-8 ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0);
    this.blood.spray(at, d, o, 0x8a0404, this.rnd);
    this.stats.drops += o.count;
  }

  /** A splat right on the floor (a pool under a body), `size` metres across. */
  splat(x: number, z: number, size: number): void {
    this.splats.add(x, z, size, this.rnd() * Math.PI * 2);
  }

  /** A new match: the floor is clean. */
  clear(): void {
    this.splats.clear();
  }

  /** An expanding flash ring; `flat` lies it on the floor, otherwise it faces the camera. */
  ring(at: THREE.Vector3, color: number, size: number, dur = 0.22, flat = false): void {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    r.mesh.position.copy(at);
    (r.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    r.t = 0;
    r.dur = dur;
    r.size = size;
    r.flat = flat;
    r.mesh.visible = true;
    this.stats.rings++;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.stats.live = this.sparks.update(dt) + this.dust.update(dt) + this.blood.update(dt);
    this.splats.update(dt);
    this.stats.splats = this.splats.live;
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const s = r.size * (0.25 + 0.75 * Math.sqrt(k));
      r.mesh.scale.setScalar(s);
      if (r.flat) r.mesh.rotation.set(-Math.PI / 2, 0, 0);
      else r.mesh.quaternion.copy(camera.quaternion);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }
  }
}
