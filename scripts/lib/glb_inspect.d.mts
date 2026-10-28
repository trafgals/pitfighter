// The repo's dependency-free .glb reader, as the TypeScript side sees it.
//
// The reader itself is JavaScript, because the build scripts are; this file
// exists so the test can import it with types instead of reaching into it
// blind.

/** A world-space box, in metres. */
export interface GlbBox {
  min: number[];
  max: number[];
  size: number[];
  centre?: number[];
}

/** One primitive inside a mesh. */
export interface GlbPrimitive {
  material: number | null;
  triangles: number;
  vertices: number;
  indexed: boolean;
  hasNormals: boolean;
  hasUv: boolean;
}

/** One mesh in the model, named after the node that carries it. */
export interface GlbMesh {
  name: string;
  /** The mesh's own glTF name, which is null when the file gives it none. */
  gltfName: string | null;
  triangles: number;
  vertices: number;
  primitives: GlbPrimitive[];
  /** The nodes that carry this mesh, by index into the file's node list. */
  nodeIndexes: number[];
  bbox: GlbBox;
}

/** What the reader found in a .glb. */
export interface GlbReport {
  file: string;
  bytes: number;
  generator: string | null;
  triangles: number;
  vertices: number;
  meshes: GlbMesh[];
  materials: string[];
  textures: number;
  images: number;
  nonFinite: number;
  /** Anything that would make the asset unreviewable. */
  problems: string[];
  nodeNames: (string | null)[];
  bbox: GlbBox;
}

/** Read a .glb from disk and measure it. */
export declare function inspectGlb(file: string): GlbReport;

/** Split a .glb into its JSON and binary chunks. */
export declare function parseGlb(buffer: Buffer | Uint8Array): {
  json: Record<string, any>;
  bin: Uint8Array | null;
  chunks: { type: number; length: number }[];
};

/** Decode one accessor into a flat array plus its shape. */
export declare function readAccessor(
  json: Record<string, any>,
  bin: Uint8Array,
  index: number,
): { values: Float64Array; count: number; components: number; type: string };

/** Format a metre value as centimetres, for readable budget reports. */
export declare function cm(metres: number): string;
