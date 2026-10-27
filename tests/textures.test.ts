// The procedural surfaces: baked from noise at load time, seamless when tiled,
// the same every time, and no image files to download.
import * as fs from "fs";
import * as path from "path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RECIPES, bake, surface, type SurfaceId } from "../src/render/textures";
import { buildBody } from "../src/render/body";
import { World } from "../src/sim/world";

const ids = Object.keys(RECIPES) as SurfaceId[];
const SIZE = 128;
const lum = (px: Uint8Array, x: number, y: number) => {
  const i = (y * SIZE + x) * 4;
  return 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
};

describe("procedural textures", () => {
  for (const id of ids) {
    it(`${id} tiles without a seam, has detail, and bakes the same every time`, () => {
      const a = bake(SIZE, RECIPES[id]);
      for (const px of [a.color, a.height]) {
        // the step across the wrap-around edge is no bigger than the steps between neighbouring
        // columns (rows) inside the tile, the board gaps and mortar joints included
        const step = (x: number, vertical: boolean) => {
          let s = 0;
          for (let k = 0; k < SIZE; k++) s += vertical ? Math.abs(lum(px, k, x) - lum(px, k, (x + 1) % SIZE)) : Math.abs(lum(px, x, k) - lum(px, (x + 1) % SIZE, k));
          return s / SIZE;
        };
        for (const vertical of [false, true]) {
          const inner = Array.from({ length: SIZE - 1 }, (_, x) => step(x, vertical));
          expect(step(SIZE - 1, vertical)).toBeLessThanOrEqual(Math.max(...inner) * 1.1 + 1);
        }
        // and it is not a flat colour
        const all = Array.from({ length: SIZE * SIZE }, (_, i) => lum(px, i % SIZE, Math.floor(i / SIZE)));
        const mean = all.reduce((s, x) => s + x, 0) / all.length;
        const sd = Math.sqrt(all.reduce((s, x) => s + (x - mean) ** 2, 0) / all.length);
        expect(sd).toBeGreaterThan(4);
      }
      const b = bake(SIZE, RECIPES[id]);
      expect(Buffer.from(b.color).equals(Buffer.from(a.color))).toBe(true);
      // only the hell floor glows
      expect(a.glow !== null).toBe(id === "basalt");
    });
  }

  it("bakes every surface at full size quickly", () => {
    const t0 = performance.now();
    for (const id of ids) bake(256, RECIPES[id]);
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it("bakes a surface once and hands out textures with their own repeat", () => {
    const a = surface("stone", 4, 2);
    const b = surface("stone", 1);
    expect(a.map).toBeInstanceOf(THREE.DataTexture);
    expect(a.map.image.data).toBe(b.map.image.data); // the pixels are shared
    expect(a.map.repeat.toArray()).toEqual([4, 2]);
    expect(b.map.repeat.toArray()).toEqual([1, 1]);
    expect(a.map.wrapS).toBe(THREE.RepeatWrapping);
    expect(a.map.generateMipmaps).toBe(true);
    expect(a.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(a.bumpMap.colorSpace).not.toBe(THREE.SRGBColorSpace);
    expect(surface("basalt").emissiveMap).toBeInstanceOf(THREE.DataTexture);
  });

  it("dresses the fighters: skin and cloth with bump", () => {
    const w = new World({ seed: 1, styles: [0, 1], humans: [true, true] });
    const b = buildBody(w.fighters[0]);
    for (const m of [b.skins.torso.material, b.skins.legL.material] as THREE.MeshStandardMaterial[]) {
      expect(m.map).toBeInstanceOf(THREE.DataTexture);
      expect(m.bumpMap).toBeInstanceOf(THREE.DataTexture);
    }
  });

  it("ships no texture image without its provenance: only the generated set in public/tex, each in its manifest", () => {
    const exts = /\.(png|jpe?g|webp|avif|ktx2|basis)$/i;
    const walk = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
    const rel = (f: string) => path.relative("public/tex", f).split(path.sep).join("/");
    const images = [...walk("src"), ...walk("public")].filter((f) => exts.test(f));
    // nothing outside the generated set (docs/texture-handoff.md): the procedural surfaces stay code
    expect(images.filter((f) => rel(f).startsWith(".."))).toEqual([]);
    // every texture the game can load says what made it, from what, under which licence
    const manifest = JSON.parse(fs.readFileSync("public/tex/manifest.json", "utf8")) as { files: { file: string; model: string; licence: string; seed: number }[] };
    const entry = new Map(manifest.files.map((e) => [e.file, e]));
    // the 3D stage's reference art is not a tile: it is an approved picture the asset is
    // drawn from, so the tile manifest has nothing to say about how it was reproduced.
    // It carries no tile entry on purpose (public/tex/README.md), and the asset it
    // belongs to is recorded in data/asset_manifest.json instead - so that is where
    // it has to be found.
    const isReference = (f: string) => f.startsWith("props/") || f.startsWith("characters/");
    for (const f of images.map(rel).filter((f) => !f.startsWith("contact/") && !isReference(f))) {
      const e = entry.get(f);
      expect(e, f).toBeDefined();
      expect(["Apache-2.0", "CC0-1.0"], f).toContain(e!.licence);
      expect(e!.model, f).not.toMatch(/dev/i);
    }
    // and every reference image registered against a 3D asset exists on disk
    const assets = JSON.parse(fs.readFileSync("data/asset_manifest.json", "utf8")) as { assets: Record<string, unknown>[] };
    for (const a of assets.assets) {
      for (const v of Object.values(a)) {
        if (typeof v === "string" && v.startsWith("public/tex/")) {
          expect(fs.existsSync(v), v).toBe(true);
        }
      }
    }
  });
});
