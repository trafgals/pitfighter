// A dependency-free reader for binary .glb files.
//
// The pipeline needs to answer hard questions about a prop before a human
// reviewer ever sees it: how many triangles is it, how big is the file, does
// the mesh actually sit in the head-socket frame, is any coordinate NaN, and
// does the badge really face +Z. Answering those by loading the file into a
// browser would be slow and would need a WebGL context; reading the container
// directly is exact and needs nothing but node.
//
// The reader is deliberately strict: it walks the chunk table, decodes accessors
// from the binary chunk and reports anything that would make the asset
// unreviewable (a non-finite vertex, a primitive with no positions, a node
// scale of zero).
import fs from "node:fs";

const COMPONENT = {
  5120: { Ctor: Int8Array, size: 1 },
  5121: { Ctor: Uint8Array, size: 1 },
  5122: { Ctor: Int16Array, size: 2 },
  5123: { Ctor: Uint16Array, size: 2 },
  5125: { Ctor: Uint32Array, size: 4 },
  5126: { Ctor: Float32Array, size: 4 },
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const MODE_TRIANGLES = 4;

export const GLB_MAGIC = 0x46546c67;
export const CHUNK_JSON = 0x4e4f534a;
export const CHUNK_BIN = 0x004e4942;

/** Split a .glb into its JSON and binary chunks. */
export function parseGlb(buffer) {
  // The chunk walk below reads little-endian words, which is Buffer's job, so
  // accept a plain Uint8Array by copying it into one first.
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 12) throw new Error("too short to be a GLB");
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error("bad GLB magic (not a binary glTF)");
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);
  const declared = buf.readUInt32LE(8);
  const total = Math.min(declared, buf.length);
  let offset = 12;
  let json = null;
  let bin = null;
  const chunks = [];
  while (offset + 8 <= total) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, length });
    if (type === CHUNK_JSON) json = JSON.parse(body.toString("utf8"));
    else if (type === CHUNK_BIN) bin = body;
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error("no JSON chunk in the GLB");
  return { json, bin, chunks };
}

/** Decode one accessor into a flat Float64Array plus its shape. */
export function readAccessor(json, bin, index) {
  const accessor = json.accessors?.[index];
  if (!accessor) throw new Error(`accessor ${index} does not exist`);
  if (accessor.bufferView === undefined) throw new Error(`accessor ${index} has no bufferView`);
  const view = json.bufferViews[accessor.bufferView];
  const component = COMPONENT[accessor.componentType];
  if (!component) throw new Error(`accessor ${index} has unknown componentType ${accessor.componentType}`);
  const components = TYPE_COMPONENTS[accessor.type];
  if (!components) throw new Error(`accessor ${index} has unknown type ${accessor.type}`);
  const Ctor = component.Ctor;
  const stride = view.byteStride ?? components * component.size;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float64Array(accessor.count * components);
  for (let i = 0; i < accessor.count; i++) {
    const start = base + i * stride;
    for (let c = 0; c < components; c++) {
      const at = start + c * component.size;
      out[i * components + c] = new Ctor(bin.buffer, bin.byteOffset + at, 1)[0];
    }
  }
  return { values: out, count: accessor.count, components, type: accessor.type };
}

/** Read an accessor as vec3 positions. */
function readPositions(json, bin, index) {
  const { values, count, components } = readAccessor(json, bin, index);
  if (components !== 3) throw new Error(`POSITION accessor ${index} is not VEC3`);
  return { values, count };
}

const IDENTITY = [0, 0, 0, 1];
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const AXIS = ["x", "y", "z"];

/** True for an array of exactly `length` finite numbers. */
function isFiniteList(value, length) {
  return Array.isArray(value) && value.length === length && value.every((n) => Number.isFinite(n));
}

/**
 * A node's local transform as a column-major 4x4.
 *
 * The glTF spec gives a node EITHER a `matrix` OR a translation/rotation/scale
 * triple, never both, and the two are mutually exclusive. A node that carries
 * a `matrix` therefore has no TRS to read: reading the TRS of such a node
 * yields the identity, which silently drops the transform the file actually
 * declares and puts the mesh in the wrong place.
 *
 * The matrix wins, exactly as three.js's own GLTFLoader does it - it applies
 * `node.matrix` when the node has one and falls back to the TRS otherwise.
 * Without this, a model exported with a matrix node measures against the
 * wrong frame: the reader reported the pegg last 10 cm shorter than it is,
 * and put its grip on the origin plane when the file puts it 6.2 cm below.
 *
 * A transform that is not usable - a matrix that is not 16 finite numbers, or
 * a TRS with a non-finite component - is reported as a problem rather than
 * multiplied into the world transform. Multiplying it in would poison every
 * world point with NaN, and NaN compares false against everything, so the
 * bounds would quietly measure short instead of reporting a broken file.
 */
function nodeMatrix(node, problems, label) {
  if (node.matrix != null) {
    if (!isFiniteList(node.matrix, 16)) {
      problems.push(`node "${label}" declares a malformed matrix (expected 16 finite numbers)`);
      return IDENTITY_MATRIX;
    }
    // A zero-length basis column is a zero scale on that axis: the geometry
    // is flattened along it, which makes the model unreviewable.
    const columns = [
      [node.matrix[0], node.matrix[1], node.matrix[2]],
      [node.matrix[4], node.matrix[5], node.matrix[6]],
      [node.matrix[8], node.matrix[9], node.matrix[10]],
    ];
    const zeroAxis = columns.findIndex((c) => Math.hypot(...c) === 0);
    if (zeroAxis >= 0) {
      problems.push(`node "${label}" has a zero scale on the ${AXIS[zeroAxis]} axis, which collapses the geometry along it`);
    }
    return node.matrix;
  }
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? IDENTITY;
  const s = node.scale ?? [1, 1, 1];
  if (!isFiniteList(t, 3) || !isFiniteList(r, 4) || !isFiniteList(s, 3)) {
    problems.push(
      `node "${label}" declares a malformed transform (translation, rotation and scale must be finite numbers)`,
    );
    return IDENTITY_MATRIX;
  }
  const zeroAxis = s.findIndex((n) => n === 0);
  if (zeroAxis >= 0) {
    problems.push(`node "${label}" has a zero scale on the ${AXIS[zeroAxis]} axis, which collapses the geometry along it`);
  }
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
  return m;
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** World transform per node: walk the scene graph from the roots. */
function worldMatrices(json, problems = []) {
  const world = new Array((json.nodes ?? []).length).fill(null);
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  const visit = (nodeIndex, parent) => {
    const m = multiply(parent ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], nodeMatrix(json.nodes[nodeIndex], problems, json.nodes[nodeIndex].name ?? `node ${nodeIndex}`));
    world[nodeIndex] = m;
    for (const child of json.nodes[nodeIndex].children ?? []) visit(child, m);
  };
  for (const root of roots) visit(root, null);
  return world;
}

/**
 * Every triangle of a .glb in world space, as a flat array of 9 numbers per
 * triangle. Triangles with a non-finite corner are left out; inspectGlb
 * already reports those.
 */
export function readWorldTriangles(file) {
  const { json, bin } = parseGlb(fs.readFileSync(file));
  const world = worldMatrices(json);
  const out = [];
  (json.nodes ?? []).forEach((node, nodeIndex) => {
    const mesh = node.mesh === undefined ? null : json.meshes?.[node.mesh];
    if (!mesh || !world[nodeIndex]) return;
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.attributes?.POSITION === undefined) continue;
      if (primitive.mode !== undefined && primitive.mode !== MODE_TRIANGLES) continue;
      const { values, count } = readPositions(json, bin, primitive.attributes.POSITION);
      const indices = primitive.indices !== undefined ? readAccessor(json, bin, primitive.indices).values : null;
      const corners = indices ? indices.length : count;
      for (let i = 0; i + 2 < corners; i += 3) {
        const tri = [];
        for (let c = 0; c < 3; c++) {
          const v = indices ? indices[i + c] : i + c;
          tri.push(...transformPoint(world[nodeIndex], values[v * 3], values[v * 3 + 1], values[v * 3 + 2]));
        }
        if (tri.every(Number.isFinite)) out.push(...tri);
      }
    }
  });
  return Float64Array.from(out);
}

/**
 * How much surface (m^2) lies inside an axis-aligned box. Each triangle is
 * sampled on a barycentric grid fine enough to resolve about 5 mm, so a
 * large procedural face that only crosses the box counts for the part inside
 * it, not all or nothing on its centroid.
 */
export function surfaceAreaInBox(triangles, box) {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  let area = 0;
  for (let t = 0; t < triangles.length; t += 9) {
    const a = triangles.subarray(t, t + 3);
    const b = triangles.subarray(t + 3, t + 6);
    const c = triangles.subarray(t + 6, t + 9);
    const tMin = [0, 1, 2].map((k) => Math.min(a[k], b[k], c[k]));
    const tMax = [0, 1, 2].map((k) => Math.max(a[k], b[k], c[k]));
    if (tMax[0] < x0 || tMin[0] > x1 || tMax[1] < y0 || tMin[1] > y1 || tMax[2] < z0 || tMin[2] > z1) continue;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const triArea = Math.hypot(...cross) / 2;
    if (!triArea) continue;
    const longest = Math.max(Math.hypot(...u), Math.hypot(...v), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
    const n = Math.min(64, Math.max(1, Math.ceil(longest / 0.005)));
    // n^2 equal sub-triangles; each is represented by its centroid.
    let inside = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; i + j < n; j++) {
        for (const [s, r] of i + j < n - 1 ? [[i + 1 / 3, j + 1 / 3], [i + 2 / 3, j + 2 / 3]] : [[i + 1 / 3, j + 1 / 3]]) {
          const p0 = a[0] + (u[0] * s + v[0] * r) / n;
          const p1 = a[1] + (u[1] * s + v[1] * r) / n;
          const p2 = a[2] + (u[2] * s + v[2] * r) / n;
          if (p0 >= x0 && p0 <= x1 && p1 >= y0 && p1 <= y1 && p2 >= z0 && p2 <= z1) inside++;
        }
      }
    }
    area += (triArea * inside) / (n * n);
  }
  return area;
}

/**
 * Inspect a .glb file on disk.
 * Returns triangle counts, a world-space bounding box, per-mesh detail and the
 * list of problems that would make the asset unreviewable.
 */
export function inspectGlb(file) {
  const buffer = fs.readFileSync(file);
  const { json, bin } = parseGlb(buffer);
  const problems = [];

  const meshes = [];
  const nodeIndexByName = new Map();
  (json.nodes ?? []).forEach((node, i) => {
    if (node.name) nodeIndexByName.set(node.name, i);
  });

  // World transform per node: walk the scene graph from the roots.
  const world = new Array((json.nodes ?? []).length).fill(null);
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  const visit = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex];
    const label = node.name ?? `node ${nodeIndex}`;
    const m = multiply(parent ?? IDENTITY_MATRIX, nodeMatrix(node, problems, label));
    world[nodeIndex] = m;
    for (const child of node.children ?? []) visit(child, m);
  };
  for (const root of roots) visit(root, null);

  let triangles = 0;
  let vertices = 0;
  let nonFinite = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  (json.meshes ?? []).forEach((mesh, meshIndex) => {
    let meshTriangles = 0;
    let meshVertices = 0;
    const primitives = [];
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.mode !== undefined && primitive.mode !== MODE_TRIANGLES) {
        problems.push(`mesh "${mesh.name ?? meshIndex}" primitive uses mode ${primitive.mode}; only triangles are supported`);
      }
      if (primitive.attributes?.POSITION === undefined) {
        problems.push(`mesh "${mesh.name ?? meshIndex}" has a primitive with no POSITION attribute`);
        continue;
      }
      const { values, count } = readPositions(json, bin, primitive.attributes.POSITION);
      let primitiveTriangles = 0;
      if (primitive.indices !== undefined) {
        const { values: indices, count: indexCount } = readAccessor(json, bin, primitive.indices);
        primitiveTriangles = indexCount / 3;
        for (let i = 0; i < indexCount; i++) {
          if (!Number.isInteger(indices[i]) || indices[i] < 0 || indices[i] >= count) {
            problems.push(`mesh "${mesh.name ?? meshIndex}" has an out-of-range index`);
            break;
          }
        }
      } else {
        primitiveTriangles = count / 3;
      }
      if (!Number.isInteger(primitiveTriangles)) {
        problems.push(`mesh "${mesh.name ?? meshIndex}" has a primitive whose triangle count is not a whole number`);
      }
      primitives.push({
        material: primitive.material ?? null,
        triangles: primitiveTriangles,
        vertices: count,
        indexed: primitive.indices !== undefined,
        hasNormals: primitive.attributes.NORMAL !== undefined,
        hasUv: primitive.attributes.TEXCOORD_0 !== undefined,
      });
      meshTriangles += primitiveTriangles;
      meshVertices += count;
      triangles += primitiveTriangles;
      vertices += count;
    }
    meshes.push({
      // glTF names the mesh "mesh_0"; the readable name lives on the node
      // that carries it, so that is the name worth reporting.
      name: (json.nodes ?? [])
        .map((node, i) => (node.mesh === meshIndex ? node.name : null))
        .find((name) => !!name) ?? mesh.name ?? `mesh_${meshIndex}`,
      gltfName: mesh.name ?? null,
      triangles: meshTriangles,
      vertices: meshVertices,
      primitives,
      nodeIndexes: (json.nodes ?? [])
        .map((node, i) => (node.mesh === meshIndex ? i : -1))
        .filter((i) => i >= 0),
    });
  });

  // World-space bounds: every primitive's positions, through its node transform.
  (json.meshes ?? []).forEach((mesh, meshIndex) => {
    const nodeIndexes = (json.nodes ?? [])
      .map((node, i) => (node.mesh === meshIndex ? i : -1))
      .filter((i) => i >= 0);
    const matrices = nodeIndexes.map((i) => world[i] ?? IDENTITY_MATRIX);
    const meshMin = [Infinity, Infinity, Infinity];
    const meshMax = [-Infinity, -Infinity, -Infinity];
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.attributes?.POSITION === undefined) continue;
      const { values, count } = readPositions(json, bin, primitive.attributes.POSITION);
      for (let i = 0; i < count; i++) {
        const x = values[i * 3], y = values[i * 3 + 1], z = values[i * 3 + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          nonFinite++;
          continue;
        }
        for (const m of matrices) {
          const p = transformPoint(m, x, y, z);
          if (p[0] < min[0]) min[0] = p[0];
          if (p[1] < min[1]) min[1] = p[1];
          if (p[2] < min[2]) min[2] = p[2];
          if (p[0] > max[0]) max[0] = p[0];
          if (p[1] > max[1]) max[1] = p[1];
          if (p[2] > max[2]) max[2] = p[2];
          if (p[0] < meshMin[0]) meshMin[0] = p[0];
          if (p[1] < meshMin[1]) meshMin[1] = p[1];
          if (p[2] < meshMin[2]) meshMin[2] = p[2];
          if (p[0] > meshMax[0]) meshMax[0] = p[0];
          if (p[1] > meshMax[1]) meshMax[1] = p[1];
          if (p[2] > meshMax[2]) meshMax[2] = p[2];
        }
      }
    }
    const empty = meshMin[0] === Infinity;
    const summary = meshes[meshIndex];
    summary.bbox = {
      min: empty ? [0, 0, 0] : meshMin,
      max: empty ? [0, 0, 0] : meshMax,
      size: empty ? [0, 0, 0] : [meshMax[0] - meshMin[0], meshMax[1] - meshMin[1], meshMax[2] - meshMin[2]],
      centre: empty ? [0, 0, 0] : [(meshMax[0] + meshMin[0]) / 2, (meshMax[1] + meshMin[1]) / 2, (meshMax[2] + meshMin[2]) / 2],
    };
  });

  if (nonFinite) problems.push(`${nonFinite} vertex position(s) are not finite`);
  if (triangles === 0) problems.push("the model has no triangles");

  const images = (json.images ?? []).length;
  const textures = (json.textures ?? []).length;
  const materials = (json.materials ?? []).map((m) => m.name ?? "(unnamed)");

  return {
    file,
    bytes: buffer.length,
    generator: json.asset?.generator ?? null,
    triangles,
    vertices,
    meshes,
    materials,
    textures,
    images,
    nonFinite,
    problems,
    nodeNames: (json.nodes ?? []).map((n) => n.name ?? null),
    bbox: {
      min: min[0] === Infinity ? [0, 0, 0] : min,
      max: max[0] === -Infinity ? [0, 0, 0] : max,
      size: min[0] === Infinity ? [0, 0, 0] : [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    },
  };
}

/** Format a metre value as centimetres, for readable budget reports. */
export const cm = (metres) => (metres * 100).toFixed(2);

/**
 * How fragmented a mesh is allowed to be.
 *
 * A mesh assembled out of pieces - a voxel remesh, or anything that carries
 * per-face vertices - writes the same point down once for every face that
 * touches it. The two hand-built props in the game are whole surfaces and
 * sit under 5% duplicate vertices and 7% open edges. Every reconstruction
 * the Pixal3D pipeline made sat between 17% and 48% duplicate vertices and
 * between 13% and 41% open edges, and rendered as a pile of shards with dark
 * seams across it.
 *
 * These are the numbers a mesh has to be under to count as one surface.
 */
export const MESH_LIMITS = {
  duplicateVertexPct: 10,
  boundaryEdgePct: 10,
};

/**
 * The mesh's topology, in the terms a reviewer would recognise.
 *
 * A reconstruction that comes back fragmented - every piece of the surface
 * carrying its own copy of the vertices it touches - is geometrically the
 * same object but topologically a pile of shards. Two things go wrong with
 * it, and both are invisible in a triangle count:
 *
 *   - the vertices along a seam carry normals averaged over one side only,
 *     so the seam renders as a hard, often black, edge; and
 *   - an unwrap over a fragmented mesh lays out hundreds of overlapping
 *     charts, so the baked texture is a patchwork and the normal map is
 *     garbage - which is what puts dark shards across the surface.
 *
 * So the mesh is measured three ways: how many vertices are duplicates of
 * another vertex's position, how many edges only one triangle uses (a seam
 * that should be shared by two), and how many faces whose own normal points
 * the opposite way to the face they belong to.
 *
 * Returns { vertices, faces, duplicateVertices, boundaryEdges, edges,
 * invertedFaces, shell }.
 */
export function readTopology(file) {
  const { json, bin } = parseGlb(fs.readFileSync(file));

  // Positions are quantised to a grid a thousandth of the mesh's own size,
  // so two vertices that are the same point land in the same cell however
  // they were written down.
  let scale = 1;
  {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const mesh of json.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        if (primitive.attributes?.POSITION === undefined) continue;
        const { values } = readAccessor(json, bin, primitive.attributes.POSITION);
        for (let i = 0; i < values.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            if (values[i + k] < min[k]) min[k] = values[i + k];
            if (values[i + k] > max[k]) max[k] = values[i + k];
          }
        }
      }
    }
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    scale = diagonal > 0 ? diagonal / 1000 : 1;
  }

  let vertices = 0;
  let faces = 0;
  let duplicateVertices = 0;
  let boundaryEdges = 0;
  let edges = 0;
  let invertedFaces = 0;

  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.attributes?.POSITION === undefined) continue;
      const pos = readAccessor(json, bin, primitive.attributes.POSITION);
      const nor = primitive.attributes.NORMAL !== undefined
        ? readAccessor(json, bin, primitive.attributes.NORMAL)
        : null;
      const idx = primitive.indices !== undefined
        ? readAccessor(json, bin, primitive.indices).values
        : null;
      const count = idx ? idx.length : pos.count;
      vertices += pos.count;

      // Duplicate positions: the same point written down twice.
      const cells = new Map();
      for (let i = 0; i < pos.count; i++) {
        const key = `${Math.round(pos.values[i * 3] / scale)},${Math.round(pos.values[i * 3 + 1] / scale)},${Math.round(pos.values[i * 3 + 2] / scale)}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
      }
      for (const n of cells.values()) duplicateVertices += n - 1;

      // Edge use counts. An edge two triangles share is a seam that is
      // closed; an edge only one triangle uses is a crack.
      const uses = new Map();
      const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
      for (let i = 0; i + 2 < count; i += 3) {
        const v = idx ? [idx[i], idx[i + 1], idx[i + 2]] : [i, i + 1, i + 2];
        faces++;
        for (let e = 0; e < 3; e++) {
          const k = key(v[e], v[(e + 1) % 3]);
          uses.set(k, (uses.get(k) ?? 0) + 1);
        }
        // A face whose normal points the other way from the face's own
        // winding is lit from behind and renders as a dark shard.
        if (nor) {
          const p = v.map((k) => [pos.values[k * 3], pos.values[k * 3 + 1], pos.values[k * 3 + 2]]);
          const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
          const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
          const cross = [
            u[1] * w[2] - u[2] * w[1],
            u[2] * w[0] - u[0] * w[2],
            u[0] * w[1] - u[1] * w[0],
          ];
          const length = Math.hypot(...cross);
          if (length > 0) {
            let nx = 0, ny = 0, nz = 0;
            for (let c = 0; c < 3; c++) {
              nx += nor.values[v[c] * 3];
              ny += nor.values[v[c] * 3 + 1];
              nz += nor.values[v[c] * 3 + 2];
            }
            if ((cross[0] * nx + cross[1] * ny + cross[2] * nz) / length < 0) invertedFaces++;
          }
        }
      }
      for (const n of uses.values()) {
        edges++;
        if (n === 1) boundaryEdges++;
      }
    }
  }

  return {
    vertices,
    faces,
    duplicateVertices,
    boundaryEdges,
    edges,
    invertedFaces,
    shell: edges ? boundaryEdges / edges : 0,
  };
}
