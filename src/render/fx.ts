// Impact effects: additive spark particles (hit sparks, embers of a KO, dust
// of a fall) and expanding flash rings. Everything is pooled, so a busy 8-way
// brawl allocates nothing per frame.
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
      const k = this.life[i] / this.max[i];
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

export class Fx {
  readonly group = new THREE.Group();
  private sparks = new Particles(900, 0.11, THREE.AdditiveBlending);
  private dust = new Particles(300, 0.32, THREE.NormalBlending);
  private rings: Ring[] = [];
  private nextRing = 0;
  private seed = 1;
  /** counters for the automated tests */
  readonly stats = { bursts: 0, rings: 0, live: 0 };

  constructor() {
    (this.dust.points.material as THREE.PointsMaterial).opacity = 0.55;
    this.group.add(this.sparks.points, this.dust.points);
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
    this.stats.live = this.sparks.update(dt) + this.dust.update(dt);
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
