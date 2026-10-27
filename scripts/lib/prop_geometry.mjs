// Shared building blocks for the procedural prop builders.
//
// The props in this repo are authored, not reconstructed: every surface is
// generated from measurements taken off the approved reference images. That
// means the same handful of primitives keep coming up - deterministic noise
// for the textures, a grid builder for the surfaces of revolution, a data
// texture wrapper for the embedded PNGs - so they live here rather than being
// copied from one builder to the next.
//
// Everything in here is deterministic: the same seed gives the same bytes on
// every run, so a rebuild of an asset can be compared byte for byte.
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noiseGrid(nx, ny, rnd) {
  const g = new Float32Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) g[i] = rnd();
  return g;
}

/** Tileable value noise: the grid wraps at n, so the texture tiles cleanly. */
export function sampleGrid(grid, nx, ny, u, v) {
  const x = u * nx;
  const y = v * ny;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const j0 = ((x0 % nx) + nx) % nx;
  const j1 = ((x0 + 1) % nx + nx) % nx;
  const i0 = ((y0 % ny) + ny) % ny;
  const i1 = ((y0 + 1) % ny + ny) % ny;
  const a = grid[i0 * nx + j0];
  const b = grid[i0 * nx + j1];
  const c = grid[i1 * nx + j0];
  const d = grid[i1 * nx + j1];
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

/**
 * Fractal noise from one or more grids.
 *
 * A grid size is either a number, which makes a square grid, or a pair
 * [nx, ny]. An anisotropic grid is what gives a texture its direction: a
 * grid that is coarse in v and fine in u produces long vertical folds, and
 * because the grid still wraps at nx and ny the result tiles cleanly.
 *
 * Sampling an ordinary square noise at a scaled-up coordinate does NOT do
 * this: the scaling breaks the wrap and leaves a seam where the texture
 * repeats.
 */
export function makeFbm(seed, sizes) {
  const rnd = mulberry32(seed);
  const grids = sizes.map((size) => {
    const [nx, ny] = Array.isArray(size) ? size : [size, size];
    return { grid: noiseGrid(nx, ny, rnd), nx, ny };
  });
  return (u, v) => {
    let sum = 0;
    let amp = 1;
    let total = 0;
    for (let i = 0; i < grids.length; i++) {
      const { grid, nx, ny } = grids[i];
      sum += sampleGrid(grid, nx, ny, u, v) * amp;
      total += amp;
      amp *= 0.55;
    }
    return sum / total;
  };
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/**
 * A height field -> tangent-space normal map, wrapping at the edges.
 * The height field is width x height samples; the map is the same shape.
 */
export function heightToNormalSized(height, width, heightPx, strength) {
  const rgba = new Uint8Array(width * heightPx * 4);
  const at = (x, y) => height[((y + heightPx) % heightPx) * width + ((x + width) % width)];
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 4;
      rgba[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      rgba[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      rgba[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/** The square case of heightToNormalSized. */
export function heightToNormal(height, size, strength) {
  return heightToNormalSized(height, size, size, strength);
}

/**
 * Wrap raw pixels in a THREE.DataTexture that three's GLTFExporter can
 * embed. The texture is sRGB for colour maps and linear for normal maps.
 */
export function makeDataTexture(data, width, height, srgb) {
  // A typed-array view can start part-way into its buffer - a subarray of a
  // bigger one, say - and wrapping the whole buffer would upload the wrong
  // pixels, so the view's own offset and length are kept.
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data.buffer ?? data);
  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * A grid of quads. sample(i, j) returns the point, the normal and the uv.
 *
 * The grid always carries nU + 1 columns, even where the surface closes on
 * itself: the last column repeats the first one's position but keeps its own
 * texture coordinate. Sharing the vertex instead would make the texture jump
 * back from 6 to 0 across the seam and draw a hard line down the prop.
 *
 * The winding is checked against the supplied normals, and the check is done
 * over EVERY triangle rather than on the first one. Testing a single triangle
 * is not enough: the first triangle of a surface can be a sliver whose normal
 * is zero, and a one-triangle test happily passes an inside-out face. A
 * back-facing triangle is culled, and a culled rim makes a raised solid read
 * as a flat patch painted on the surface instead of a piece standing proud of
 * it.
 */
export function buildGrid(nU, nV, sample) {
  const cols = nU + 1;
  const positions = new Float32Array(cols * nV * 3);
  const normals = new Float32Array(cols * nV * 3);
  const uvs = new Float32Array(cols * nV * 2);
  for (let j = 0; j < nV; j++) {
    for (let i = 0; i < cols; i++) {
      const s = sample(i, j);
      const k = (j * cols + i) * 3;
      positions[k] = s.p.x;
      positions[k + 1] = s.p.y;
      positions[k + 2] = s.p.z;
      normals[k] = s.n.x;
      normals[k + 1] = s.n.y;
      normals[k + 2] = s.n.z;
      const u = (j * cols + i) * 2;
      uvs[u] = s.uv[0];
      uvs[u + 1] = s.uv[1];
    }
  }
  const indices = [];
  for (let j = 0; j < nV - 1; j++) {
    for (let i = 0; i < nU; i++) {
      const a = j * cols + i;
      const b = j * cols + i + 1;
      const c = (j + 1) * cols + i;
      const d = (j + 1) * cols + i + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  // Every triangle has to agree with the normals its own vertices carry.
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];
    const ux = positions[ib * 3] - positions[ia * 3];
    const uy = positions[ib * 3 + 1] - positions[ia * 3 + 1];
    const uz = positions[ib * 3 + 2] - positions[ia * 3 + 2];
    const vx = positions[ic * 3] - positions[ia * 3];
    const vy = positions[ic * 3 + 1] - positions[ia * 3 + 1];
    const vz = positions[ic * 3 + 2] - positions[ia * 3 + 2];
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    const nx = normals[ia * 3] + normals[ib * 3] + normals[ic * 3];
    const ny = normals[ia * 3 + 1] + normals[ib * 3 + 1] + normals[ic * 3 + 1];
    const nz = normals[ia * 3 + 2] + normals[ib * 3 + 2] + normals[ic * 3 + 2];
    if (gx * nx + gy * ny + gz * nz < 0) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * The outline of a path, without the duplicate that closes it.
 *
 * Each curve is sampled on its own rather than the whole path at a fixed
 * resolution. A straight line needs one step: subdividing it only adds
 * collinear points, and two collinear points make a sliver triangle. A curve
 * needs enough steps to keep its shape - one step turns a quadratic into its
 * two end points and flattens the curve it was meant to draw.
 */
export function loopPoints(path) {
  const points = [];
  for (const curve of path.curves) {
    const steps = curve.isLineCurve ? 1 : 12;
    for (const point of curve.getPoints(steps)) {
      if (!points.length || point.distanceTo(points[points.length - 1]) > 1e-9) points.push(point);
    }
  }
  if (points.length > 1 && points[points.length - 1].distanceTo(points[0]) < 1e-9) points.pop();
  return points;
}
