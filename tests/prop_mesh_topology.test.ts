// The mesh as one surface.
//
// A reconstruction can come back fragmented: every piece of the surface
// carrying its own copy of the vertices it touches. It is geometrically the
// same object, so the triangle count, the bounding box and the dimensions
// are all exactly right - which is how a prop covered in dark seams passed
// twenty-one of twenty-one checks and reached a reviewer.
//
// The reader is what notices: it counts the vertices that are duplicates of
// another vertex's position, and the edges that only one triangle uses.
//
// These tests hold that down with a mesh built here, so the reader is proved
// on a case whose answer is known rather than on the props themselves.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MESH_LIMITS, readTopology } from "../scripts/lib/glb_inspect.mjs";

/**
 * A .glb with the triangles given, so a test can say what it means.
 *
 * The geometry is written by hand rather than through a library because the
 * point of the fixture is a mesh whose vertices are *not* shared, and that
 * is exactly the thing a helper would quietly tidy up.
 */
function writeGlb(positions: number[][], triangles: number[][]): string {
  const vertexCount = positions.length;
  const positionBytes = Buffer.alloc(vertexCount * 12);
  positions.forEach((p, i) => {
    positionBytes.writeFloatLE(p[0], i * 12);
    positionBytes.writeFloatLE(p[1], i * 12 + 4);
    positionBytes.writeFloatLE(p[2], i * 12 + 8);
  });
  const indexBytes = Buffer.alloc(triangles.length * 3 * 4);
  triangles.forEach((t, i) => t.forEach((v, c) => indexBytes.writeUInt32LE(v, (i * 3 + c) * 4)));

  const positionView = 0;
  const indexView = 1;
  const buffer = Buffer.concat([positionBytes, indexBytes]);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "mesh_0" }],
    meshes: [{
      name: "mesh_0",
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        mode: 4,
      }],
    }],
    accessors: [
      { bufferView: positionView, componentType: 5126, count: vertexCount, type: "VEC3", min: [0, 0, 0], max: [1, 1, 1] },
      { bufferView: indexView, componentType: 5125, count: triangles.length * 3, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: buffer.length }],
  };

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (buffer.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + buffer.length + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBytes.length + jsonPad, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(out, 20);
  // The chunk's padding is spaces: the JSON chunk is read as a whole, and a
  // null byte after the closing brace is not whitespace to a JSON parser.
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  const binHeader = 20 + jsonBytes.length + jsonPad;
  out.writeUInt32LE(buffer.length + binPad, binHeader);
  out.writeUInt32LE(0x004e4942, binHeader + 4);
  buffer.copy(out, binHeader + 8);

  const file = path.join(os.tmpdir(), `topology-${Math.random().toString(36).slice(2)}.glb`);
  fs.writeFileSync(file, out);
  return file;
}

describe("the mesh as one surface", () => {
  it("sees a surface whose vertices are shared", () => {
    // Two triangles sharing an edge: a square made of one sheet.
    const file = writeGlb(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      [[0, 1, 2], [0, 2, 3]],
    );
    const topology = readTopology(file);
    expect(topology.vertices).toBe(4);
    expect(topology.faces).toBe(2);
    expect(topology.duplicateVertices).toBe(0);
    // The four edges of the square are used by one triangle each; the
    // diagonal is used by both.
    expect(topology.boundaryEdges).toBe(4);
    expect(topology.edges).toBe(5);
    fs.unlinkSync(file);
  });

  it("sees the same square written out face by face", () => {
    // The same shape, but every triangle carries its own three vertices.
    const file = writeGlb(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]],
      [[0, 1, 2], [3, 4, 5]],
    );
    const topology = readTopology(file);
    expect(topology.vertices).toBe(6);
    expect(topology.faces).toBe(2);
    // Two of the six vertices are the same point as another vertex.
    expect(topology.duplicateVertices).toBe(2);
    // And not one edge is shared, because no triangle knows about another.
    expect(topology.boundaryEdges).toBe(6);
    expect(topology.edges).toBe(6);
    fs.unlinkSync(file);
  });

  it("holds the props that are whole surfaces to the limits", () => {
    // The two props that were modelled rather than reconstructed are whole
    // surfaces, and they stay that way: nothing in the pipeline rebuilds
    // them. They are the calibration for the limits.
    const whole = ["prop_winch_custodian_helmet", "prop_smelt_stovepipe"];
    for (const id of whole) {
      const topology = readTopology(`public/models/props/${id}.glb`);
      const duplicatePct = (100 * topology.duplicateVertices) / topology.vertices;
      const seamPct = (100 * topology.boundaryEdges) / topology.edges;
      expect(duplicatePct).toBeLessThanOrEqual(MESH_LIMITS.duplicateVertexPct);
      expect(seamPct).toBeLessThanOrEqual(MESH_LIMITS.boundaryEdgePct);
    }
  });

  it("does not let a fragmented prop through", () => {
    // The reconstruction the pipeline makes is fragmented, and that is the
    // defect this reader exists to catch: every one of these props would
    // fail the capture's two checks, and none of them would have failed any
    // of the checks that were there before.
    const fragmented = ["prop_kilnworth_nursecap", "prop_rook_souwester", "prop_sluice_flatcap"];
    for (const id of fragmented) {
      const topology = readTopology(`public/models/props/${id}.glb`);
      const duplicatePct = (100 * topology.duplicateVertices) / topology.vertices;
      expect(duplicatePct).toBeGreaterThan(MESH_LIMITS.duplicateVertexPct);
    }
  });
});
