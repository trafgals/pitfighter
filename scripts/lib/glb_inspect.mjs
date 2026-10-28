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
