// The Pixal3D prop pipeline: the workflow the chair was made with, the
// reconstructions it ships, and the review files it keeps out of the game.
//
// The chair was first made by hand in ComfyUI, and how it was made lived only
// in ComfyUI's history and the GLB's metadata. scripts/run_pixal3d_mesh.py
// does it now; these tests hold what it produces to what the game expects.
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WORKFLOW = "public/tex/workflows/pixal3d_multiview.json";
const VIEWS = ["front", "left", "back", "right"] as const;

interface Node {
  class_type: string;
  inputs: Record<string, unknown>;
}

const workflow: Record<string, Node> = JSON.parse(fs.readFileSync(path.join(ROOT, WORKFLOW), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data/asset_manifest.json"), "utf8"));
const reconstructed = (manifest.assets as any[]).filter((a) => String(a.build ?? "").includes("run_pixal3d_mesh.py"));
// A prop that is being rebuilt from a stage is between meshes: the mesh that
// was reviewed is on disk, but the manifest no longer says it is the one that
// ships, and the sheet it is being rebuilt from is not there yet.
const redoing = (manifest.assets as any[]).filter((a) => a.redo).map((a) => a.id);

/** The JSON chunk and binary chunk of a .glb. */
function readGlb(file: string) {
  const b = fs.readFileSync(path.join(ROOT, file));
  const jsonLength = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLength).toString("utf8"));
  const binLength = b.readUInt32LE(20 + jsonLength);
  const bin = b.subarray(28 + jsonLength, 28 + jsonLength + binLength);
  return { json, bin, bytes: b.length };
}

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(data: Buffer): [number, number] {
  let i = 2;
  while (i < data.length) {
    const marker = data[i + 1];
    const length = data.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [data.readUInt16BE(i + 7), data.readUInt16BE(i + 5)];
    }
    i += 2 + length;
  }
  throw new Error("no start-of-frame marker");
}

/** A node's input that points at another node. */
const from = (node: Node, input: string) => workflow[(node.inputs[input] as [string, number])[0]];

describe("the Pixal3D workflow", () => {
  const conditioning = Object.values(workflow).find((n) => n.class_type === "Pixal3DMultiViewConditioning")!;

  it("conditions on four views, each loaded from its own placeholder", () => {
    expect(conditioning).toBeDefined();
    for (const view of VIEWS) {
      // view -> crop to mask -> load image
      const loaded = from(from(conditioning, view), "images");
      expect(loaded.class_type).toBe("LoadImage");
      expect(loaded.inputs.image).toBe(`{${view}}`);
    }
  });

  it("names every file it saves after the asset", () => {
    const saves = Object.values(workflow).filter((n) => n.class_type.startsWith("Save"));
    expect(saves.length).toBeGreaterThan(0);
    for (const save of saves) expect(String(save.inputs.filename_prefix)).toMatch(/^\{prefix\}/);
  });

  it("keeps the settings the chair was approved with", () => {
    const decimate = Object.values(workflow).find((n) => n.class_type === "DecimateMesh")!;
    expect(decimate.inputs.target_face_count).toBe(20000);
    expect(conditioning.inputs.fov).toBe(20);
  });
});

describe("the reconstructed props", () => {
  it("include the chair", () => {
    // the chair is rebuilt from its turnaround sheet while a review asks for
    // it, so it is either among the meshes that ship or in the queue for one
    expect([...reconstructed.map((a) => a.id), ...redoing]).toContain("weapon_chair");
  });

  for (const asset of reconstructed) {
    describe(asset.id, () => {
      const glb = readGlb(asset.glb_output);

      it("has a four-view sheet to rebuild from", () => {
        const sheet = fs.readFileSync(path.join(ROOT, asset.turnaround_sheet));
        // PNG header: width and height are the first two fields of IHDR
        expect(sheet.readUInt32BE(16)).toBe(4 * sheet.readUInt32BE(20));
      });

      it("stands on its pivot at the spec's height", () => {
        const frame = asset.validation.frame;
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const prim of glb.json.meshes.flatMap((m: any) => m.primitives)) {
          const acc = glb.json.accessors[prim.attributes.POSITION];
          acc.min.forEach((v: number, i: number) => (min[i] = Math.min(min[i], v)));
          acc.max.forEach((v: number, i: number) => (max[i] = Math.max(max[i], v)));
        }
        const cm = (m: number) => m * 100;
        expect(cm(min[1])).toBeCloseTo(frame.y_min_cm, 0);
        expect(cm(max[1])).toBeCloseTo(frame.y_max_cm, 0);
        expect(cm(max[1] - min[1])).toBeCloseTo(asset.scale_dimensions_cm.height, 0);
        expect(cm((min[0] + max[0]) / 2)).toBeCloseTo(frame.centre_x_cm ?? 0, 0);
        expect(cm((min[2] + max[2]) / 2)).toBeCloseTo(frame.centre_z_cm ?? 0, 0);
      });

      it("ships within its byte and triangle budgets", () => {
        // the same bounds as the capture's checks: bytes within, triangles under
        const triangles = glb.json.meshes
          .flatMap((m: any) => m.primitives)
          .reduce((n: number, p: any) => n + glb.json.accessors[p.indices].count / 3, 0);
        expect(glb.bytes).toBeLessThanOrEqual(asset.file_budget_bytes);
        expect(triangles).toBeLessThan(asset.poly_budget);
        expect(glb.bytes).toBe(asset.measured.bytes);
        expect(triangles).toBe(asset.measured.triangles);
      });

      it("has JPEG textures no bigger than the game draws them", () => {
        const { json, bin } = glb;
        const normals = new Set(json.materials.map((m: any) => m.normalTexture?.index).filter((i: unknown) => i !== undefined));
        for (const [t, tex] of (json.textures as any[]).entries()) {
          const image = json.images[tex.source];
          expect(image.mimeType).toBe("image/jpeg");
          const view = json.bufferViews[image.bufferView];
          const [w, h] = jpegSize(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
          expect(Math.max(w, h)).toBeLessThanOrEqual(normals.has(t) ? 512 : 1024);
        }
      });

      it("has 16-bit indices and no tangents", () => {
        for (const prim of glb.json.meshes.flatMap((m: any) => m.primitives)) {
          expect(prim.attributes.TANGENT).toBeUndefined();
          expect(glb.json.accessors[prim.indices].componentType).toBe(5123);
        }
      });
    });
  }
});

describe("the review files", () => {
  it("are not in public/, which ships with the game", () => {
    const shipped = fs.readdirSync(path.join(ROOT, "public"), { recursive: true }).map(String);
    expect(shipped.filter((f) => /turntable\.(webp|gif|mp4)$/.test(f))).toEqual([]);
  });

  it("are where the manifest says", () => {
    for (const asset of manifest.assets as any[]) {
      if (!asset.turntable) continue;
      expect(asset.turntable).toMatch(/^docs\/props\//);
      expect(fs.existsSync(path.join(ROOT, asset.turntable))).toBe(true);
    }
  });
});
