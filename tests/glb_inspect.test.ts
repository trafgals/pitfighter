// The .glb reader has to measure a model in the frame the file actually
// declares, not the frame the reader would guess.
//
// The glTF spec gives a node EITHER a `matrix` OR a translation/rotation/scale
// triple, never both. three.js's GLTFExporter writes the matrix form whenever
// it is not the identity, so a model exported by this repo's own builders
// carries matrix nodes - and a reader that only understands the TRS form
// measures such a model against the wrong frame.
//
// That is not a theoretical difference: the reader put the pegg last's grip on
// the origin plane when the file puts it 6.2 cm below, and reported the model
// 10.2 cm shorter than it is. The tests below hold the reader to the frame the
// file declares.
import * as fs from "fs";
import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { inspectGlb, parseGlb } from "../scripts/lib/glb_inspect.mjs";

const ROOT = process.cwd();
const SCRATCH = path.join(ROOT, "test-output", "glb-inspect-test");

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** A column-major 4x4 that translates by (x, y, z) and scales by (sx, sy, sz). */
function matrix({ x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  return [
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    x, y, z, 1,
  ];
}

/**
 * Build a .glb holding one triangle and one node.
 *
 * The node carries either a `matrix` or a TRS triple, so a test can ask what
 * the reader does with each form the spec allows.
 */
function buildGlb(
  node: Record<string, unknown>,
  positions: number[][],
  nodeName = "Fixture",
) {
  const bin = Buffer.alloc(positions.length * 12);
  positions.forEach((p, i) => {
    bin.writeFloatLE(p[0], i * 12);
    bin.writeFloatLE(p[1], i * 12 + 4);
    bin.writeFloatLE(p[2], i * 12 + 8);
  });

  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: nodeName, mesh: 0, ...node }],
    meshes: [
      {
        name: "Triangle",
        primitives: [{ attributes: { POSITION: 0 } }],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length,
        type: "VEC3",
        // A POSITION accessor's bounds have to be the real bounds of its
        // data, or the fixture is not a valid glTF file.
        min: [0, 1, 2].map((axis) => Math.min(...positions.map((p) => p[axis]))),
        max: [0, 1, 2].map((axis) => Math.max(...positions.map((p) => p[axis]))),
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}

/** Write a .glb to the scratch directory and return its path. */
function writeGlb(
  name: string,
  node: Record<string, unknown>,
  positions: number[][],
  nodeName = "Fixture",
) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const file = path.join(SCRATCH, `${name}.glb`);
  fs.writeFileSync(file, buildGlb(node, positions, nodeName));
  return file;
}

// A triangle spanning -1..1 in x and y, so a node transform moves it away
// from the origin and the measurement shows whether the transform was read.
const TRIANGLE = [
  [-1, -1, 0],
  [1, -1, 0],
  [0, 1, 0],
];

afterAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

describe("the glb reader measures the frame the file declares", () => {
  it("applies a node's matrix, which is the form the spec allows instead of TRS", () => {
    const file = writeGlb("matrix_node", { matrix: matrix({ y: 5 }) }, TRIANGLE);
    const report = inspectGlb(file);

    // The triangle sits at y = -1..1, so a node that lifts it by 5 puts it at
    // y = 4..6. A reader that ignored the matrix would report -1..1.
    expect(report.bbox.min[1]).toBeCloseTo(4, 6);
    expect(report.bbox.max[1]).toBeCloseTo(6, 6);
    expect(report.bbox.size[1]).toBeCloseTo(2, 6);
  });

  it("applies a node's matrix scale, not only its translation", () => {
    const file = writeGlb("matrix_scaled", { matrix: matrix({ sx: 3, sy: 2 }) }, TRIANGLE);
    const report = inspectGlb(file);

    // The triangle is 2 wide and 2 tall; scaled by 3 and 2 it is 6 by 4.
    expect(report.bbox.size[0]).toBeCloseTo(6, 6);
    expect(report.bbox.size[1]).toBeCloseTo(4, 6);
  });

  it("still applies a node's translation, rotation and scale", () => {
    const file = writeGlb(
      "trs_node",
      { translation: [0, 5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      TRIANGLE,
    );
    const report = inspectGlb(file);

    expect(report.bbox.min[1]).toBeCloseTo(4, 6);
    expect(report.bbox.max[1]).toBeCloseTo(6, 6);
  });

  it("places a node's mesh where the matrix says, and reports no problems", () => {
    const file = writeGlb("matrix_mesh", { matrix: matrix({ y: 5 }) }, TRIANGLE, "Grip");
    const report = inspectGlb(file);

    // The reader names a mesh after the node that carries it, which is where
    // the manifest's validation blocks point.
    const mesh = report.meshes.find((m) => m.name === "Grip");
    expect(mesh).toBeTruthy();
    expect(mesh?.bbox.min[1]).toBeCloseTo(4, 6);
    expect(report.problems).toEqual([]);
    expect(report.triangles).toBe(1);
  });

  it("reads a matrix node's translation the way three.js does", () => {
    const file = writeGlb("matrix_translation", { matrix: matrix({ x: 1, y: 2, z: 3 }) }, TRIANGLE);
    const report = inspectGlb(file);

    // three.js's GLTFLoader applies nodeDef.matrix with Matrix4.fromArray,
    // which is column-major, and so does the reader.
    expect(report.bbox.min[0]).toBeCloseTo(0, 6);
    expect(report.bbox.max[0]).toBeCloseTo(2, 6);
    expect(report.bbox.min[1]).toBeCloseTo(1, 6);
    expect(report.bbox.max[1]).toBeCloseTo(3, 6);
    expect(report.bbox.min[2]).toBeCloseTo(3, 6);
    expect(report.bbox.max[2]).toBeCloseTo(3, 6);
  });

  it("writes the matrix into the file the fixture claims it has", () => {
    const file = writeGlb("matrix_shape", { matrix: matrix({ y: 5 }) }, TRIANGLE);
    const { json } = parseGlb(fs.readFileSync(file));

    // Guards the fixture itself: if the builder stopped writing a matrix the
    // test above would pass for the wrong reason.
    expect(json.nodes[0].matrix).toEqual(matrix({ y: 5 }));
    expect(json.nodes[0].translation).toBeUndefined();
  });

  it("parses a .glb handed over as a plain Uint8Array", () => {
    const file = writeGlb("uint8_input", { matrix: matrix({ y: 5 }) }, TRIANGLE);
    const { json } = parseGlb(new Uint8Array(fs.readFileSync(file)));

    // The reader's chunk walk uses Buffer's little-endian readers, so a plain
    // Uint8Array has to be accepted rather than crashing on the first word.
    expect(json.nodes[0].matrix).toEqual(matrix({ y: 5 }));
  });
});

describe("the glb reader reports a transform it cannot use", () => {
  it("reports a malformed matrix instead of measuring against NaN", () => {
    const file = writeGlb("bad_matrix", { matrix: [1, 0, 0, 0] }, TRIANGLE);
    const report = inspectGlb(file);

    expect(report.problems.join(" ")).toMatch(/malformed matrix/);
    // The bounds must stay finite and keep the model's real extent: a NaN
    // transform compares false against everything, so the model would quietly
    // measure as nothing at all instead of being reported.
    expect(report.bbox.size.every((n) => Number.isFinite(n))).toBe(true);
    expect(report.bbox.size[0]).toBeCloseTo(2, 6);
  });

  it("reports a matrix holding a non-finite number", () => {
    const broken = matrix({ y: 5 }).map((n, i) => (i === 13 ? Number.NaN : n));
    const file = writeGlb("nan_matrix", { matrix: broken }, TRIANGLE);
    const report = inspectGlb(file);

    expect(report.problems.join(" ")).toMatch(/malformed matrix/);
    expect(report.bbox.size.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("reports a translation, rotation or scale that is not finite", () => {
    const file = writeGlb("nan_trs", { scale: [1, Number.NaN, 1] }, TRIANGLE);
    const report = inspectGlb(file);

    expect(report.problems.join(" ")).toMatch(/malformed transform/);
    expect(report.bbox.size.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("reports a node whose scale is zero, naming the axis it collapses", () => {
    const file = writeGlb("zero_scale", { scale: [0, 1, 1] }, TRIANGLE);
    const report = inspectGlb(file);

    // A zero scale flattens the geometry along that one axis - it does not
    // collapse the whole model - so the diagnostic has to say which axis.
    expect(report.problems.join(" ")).toMatch(/zero scale on the x axis/);
  });

  it("reports a matrix whose basis column is zero length, naming the axis", () => {
    const file = writeGlb("zero_matrix_scale", { matrix: matrix({ sx: 0 }) }, TRIANGLE);
    const report = inspectGlb(file);

    expect(report.problems.join(" ")).toMatch(/zero scale on the x axis/);
  });
});
