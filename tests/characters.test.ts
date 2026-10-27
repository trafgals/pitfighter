// The character design: one file, and it has to stay honest.
//
// src/data/characters.json is where a fighter is written down. The tests here
// are the guards that keep it true:
//
//   1. the roster is frozen - the order is load-bearing (Fighter.style is an
//      index into it), so moving a fighter has to be a deliberate change
//   2. the file meets the schema in src/data/types.ts
//   3. the texture half agrees with the texture pipeline's own spec
//   4. every texture on disk belongs to a fighter on the roster
//   5. the views the game reads (STYLES, KITS, FAMILY_OF, MOVES) are all
//      derived from that one file and agree with it
//
// The moveset half (every move inside its archetype's envelope, the rivals
// and partners, the crafts) is guarded in tests/roster.test.ts.
import { describe, expect, it } from "vitest";
import { CHARACTERS, CHARACTER_BY_ID, FAMILY_OF, KITS, SPECIAL_NAMES, SPECIALS, STYLES, STYLE_INDEX } from "../src/data/characters";
import { MOVES } from "../src/sim/moves";
import { AIR_GRABS } from "../src/sim/airgrabs";
import { lookOf } from "../src/render/anatomy";
import { FAMILIES } from "../src/render/motion";
import texSpec from "../public/tex/spec.json";

// The roster, in the order the game indexes it.
const ROSTER: [id: string, style: string][] = [
  ["constable-winch", "All-Round"],
  ["hezekiah-smelt", "Mighty"],
  ["nell-sluice", "Street"],
  ["matron-kilnworth", "Karate"],
  ["bartholomew-mule", "Wrestling"],
  ["bosun-rook", "Muay Thai"],
  ["lady-bulwark", "Boxing"],
  ["percival-crump", "Kung Fu"],
  ["tabitha-pegg", "Tae Kwon Do"],
  ["mortimer-crape", "Judo Based"],
  ["sir-peregrine", "Samurai Sword"],
  ["cuthbert-inkle", "Amateur"],
];

// The six special shapes keep the game's frame data; the names are the theme's.
const SPECIAL_SNAPSHOT: [string, string][] = [
  ["spSpin", "THE WHIRLIGIG"],
  ["spCharge", "FULL STEAM"],
  ["spFlurry", "A THOUSAND APOLOGIES"],
  ["spSlam", "SIX FEET UNDER"],
  ["spBlade", "THE GENTLEMAN'S ARC"],
  ["spFire", "GASLIGHT"],
];

const HORNS = ["none", "goat", "bull", "ram", "long", "swept", "nubs", "spikes", "broken", "crown"];
const TAILS = ["none", "spade", "long", "stub", "barbed"];
const GEAR = [
  "mohawk", "topknot", "beard", "headband", "gloves", "pauldrons", "spines", "wings",
  "beret", "kasa", "stetson", "lanyard", "obi", "tusks", "title",
  "custodian", "whiskers", "pistons", "flatcap", "nursecap", "tophat", "monocle",
  "stovepipe", "bowler", "goggles", "weepers", "moustache",
];
const FIGHTER_TEXTURES = ["skin.webp", "skin_h.webp", "cloth.webp", "cloth_h.webp", "face.webp"];
// every texture the pipeline shipped, so a folder for a fighter who is not on the roster is a bug
const TEX_FILES = import.meta.glob("../public/tex/fighters/*/*.webp");
const CONTACT_FILES = import.meta.glob("../public/tex/contact/*.png");

describe("the character design", () => {
  it("is the roster in its fixed order", () => {
    expect(CHARACTERS.map((c) => [c.id, c.style])).toEqual(ROSTER);
  });

  it("gives every fighter a name, a style and a slug of its own", () => {
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    expect(new Set(CHARACTERS.map((c) => c.name)).size).toBe(CHARACTERS.length);
    expect(new Set(CHARACTERS.map((c) => c.short)).size).toBe(CHARACTERS.length);
    expect(new Set(CHARACTERS.map((c) => c.style)).size).toBe(CHARACTERS.length);
    expect(new Set(CHARACTERS.map((c) => c.specialName)).size).toBe(CHARACTERS.length);
    for (const c of CHARACTERS) {
      expect(c.id, c.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.blurb.length, c.name).toBeGreaterThan(10);
      expect(c.body, c.name).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.accent, c.name).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.lineage, c.name).toContain(c.style);
      for (const r of Object.values(c.ratings)) {
        expect(r, c.name).toBeGreaterThanOrEqual(1);
        expect(r, c.name).toBeLessThanOrEqual(5);
      }
    }
  });

  it("keeps every fighter's parts inside the lists the renderer knows", () => {
    for (const c of CHARACTERS) {
      expect(HORNS, c.name).toContain(c.kit.horns);
      expect(TAILS, c.name).toContain(c.kit.tail);
      for (const g of c.kit.gear) expect(GEAR, c.name).toContain(g);
      expect(Object.keys(FAMILIES), c.name).toContain(c.family);
      expect(c.stats.string, c.name).toBeGreaterThanOrEqual(1);
      expect(c.stats.string, c.name).toBeLessThanOrEqual(3);
      expect(c.kit.size, c.name).toBeGreaterThan(0.5);
      expect(c.kit.size, c.name).toBeLessThan(2);
      expect(c.look.scar, c.name).toBeGreaterThanOrEqual(0);
      expect(c.look.scar, c.name).toBeLessThanOrEqual(3);
      expect(c.look.paint, c.name).toBeGreaterThanOrEqual(0);
      expect(c.look.paint, c.name).toBeLessThanOrEqual(3);
      expect(c.look.def, c.name).toBeGreaterThan(0);
    }
  });

  it("uses every animation family at least once", () => {
    const used = new Set(CHARACTERS.map((c) => c.family));
    expect([...used].sort()).toEqual(Object.keys(FAMILIES).sort());
  });

  it("gives every fighter a special, and every special a fighter", () => {
    for (const c of CHARACTERS) expect(SPECIALS[c.special], c.name).toBeDefined();
    const used = new Set(CHARACTERS.map((c) => c.special));
    expect([...used].sort()).toEqual(Object.keys(SPECIALS).sort());
    expect(Object.entries(SPECIALS).map(([id, s]) => [id, s.name])).toEqual(SPECIAL_SNAPSHOT);
  });

  it("carries the specials' frame data into the move table", () => {
    for (const [id, s] of Object.entries(SPECIALS)) {
      expect(MOVES[id], id).toBeDefined();
      expect(MOVES[id], id).toEqual(s.move);
      expect(MOVES[id].id, id).toBe(id);
      expect(MOVES[id].kind, id).toBe("special");
    }
    expect(Object.keys(MOVES)).toContain("jab1");
    expect(Object.keys(MOVES)).toContain("headbutt");
  });

  it("gives every fighter an air grab the sim can play", () => {
    for (const c of CHARACTERS) {
      const g = c.airGrab;
      expect(["down", "bounce", "throw", "limb"], c.name).toContain(g.end);
      expect(g.slam, c.name).toBeLessThan(g.dur);
      expect(g.lift, c.name).toBeGreaterThan(0);
      expect(g.dmg, c.name).toBeGreaterThan(0);
      if (g.end === "throw") expect(g.dist, c.name).toBeGreaterThan(0);
    }
    expect(new Set(CHARACTERS.map((c) => c.airGrab.name)).size).toBe(CHARACTERS.length);
  });

  it("agrees with the texture pipeline's own spec", () => {
    const byStyle = new Map(texSpec.fighters.map((f) => [f.style, f]));
    expect(byStyle.size).toBe(CHARACTERS.length);
    for (const c of CHARACTERS) {
      const t = byStyle.get(c.style);
      if (!t) throw new Error(`no texture spec for ${c.style}`);
      expect(t.slug, c.style).toBe(c.id);
      expect(t.name, c.style).toBe(c.name);
      expect(t.body, c.style).toBe(c.body);
      expect(t.accent, c.style).toBe(c.accent);
      expect(t.seed, c.style).toBe(c.texture.seed);
      expect(t.skin_idea, c.style).toBe(c.texture.skin.idea);
      expect(t.skin_colour, c.style).toBe(c.texture.skin.colour);
      expect(t.cloth_idea, c.style).toBe(c.texture.cloth.idea);
      expect(t.cloth_colour, c.style).toBe(c.texture.cloth.colour);
      expect(t.face_idea, c.style).toBe(c.texture.face.idea);
      expect(t.face_colour, c.style).toBe(c.texture.face.colour);
      expect(t.limb_idea, c.style).toBe(c.texture.limb.idea);
      expect(t.limb_colour, c.style).toBe(c.texture.limb.colour);
    }
  });

  it("keeps the texture pipeline's seed overrides pointing at real things", () => {
    // the overrides are the pipeline's own bookkeeping - they name the seed a
    // surface was re-rendered with - so there is nothing in characters.json to
    // compare them against. What can still go wrong is a typo: an override
    // for a fighter or a stage that does not exist, or for a surface that
    // fighter does not have.
    const fighterIds = new Set(CHARACTERS.map((c) => c.id));
    const stageIds = new Set(texSpec.stages.map((s) => s.stage));
    const stageSurfaces = new Map(texSpec.stages.map((s) => [s.stage, s.surface]));
    for (const [key, seed] of Object.entries(texSpec.seed_overrides)) {
      const [who, surface] = key.split("__");
      expect(seed, key).toBeGreaterThan(0);
      expect(Number.isInteger(seed), key).toBe(true);
      if (fighterIds.has(who)) {
        expect(["skin", "cloth", "face", "limb"], key).toContain(surface);
      } else {
        expect(stageIds.has(who), key).toBe(true);
        expect(stageSurfaces.get(who), key).toBe(surface);
      }
    }
  });

  it("keeps only textures for fighters on the roster, each set whole", () => {
    // the roster's textures are generated after the design (docs/texture-handoff.md),
    // so a fighter may have none yet; but a folder is a whole set, with its contact sheet
    const ids = new Set(CHARACTERS.map((c) => c.id));
    const folders = new Map<string, string[]>();
    for (const p of Object.keys(TEX_FILES)) {
      const [, slug, file] = p.match(/\/fighters\/([^/]+)\/([^/]+)$/)!;
      folders.set(slug, [...(folders.get(slug) ?? []), file]);
    }
    for (const [slug, files] of folders) {
      expect(ids.has(slug), slug).toBe(true);
      expect(files.sort(), slug).toEqual([...FIGHTER_TEXTURES].sort());
      expect(Object.keys(CONTACT_FILES).some((p) => p.endsWith(`/contact/${slug}.png`)), slug).toBe(true);
    }
    const stageIds = new Set(texSpec.stages.map((s) => s.stage));
    for (const p of Object.keys(CONTACT_FILES)) {
      const slug = p.match(/\/contact\/([^/]+)\.png$/)![1];
      expect(folders.has(slug) || stageIds.has(slug), p).toBe(true);
    }
  });

  it("is the only source the game reads a fighter from", () => {
    // the views the rest of the game uses, all derived from the one file
    expect(STYLES).toHaveLength(CHARACTERS.length);
    for (const [i, c] of CHARACTERS.entries()) {
      expect(STYLES[i].style).toBe(c.style);
      expect(STYLES[i].name).toBe(c.name);
      expect(STYLES[i].blurb).toBe(c.blurb);
      expect(STYLES[i].color).toBe(parseInt(c.body.slice(1), 16));
      expect(STYLES[i].accent).toBe(parseInt(c.accent.slice(1), 16));
      expect(STYLES[i].special).toBe(c.special);
      expect(STYLES[i].specialName).toBe(c.specialName);
      expect(STYLES[i].airGrab).toBe(c.airGrab);
      expect(STYLES[i].punch).toBe(c.stats.punch);
      expect(KITS[c.style]).toEqual(c.kit);
      expect(FAMILY_OF[c.style]).toBe(c.family);
      expect(STYLE_INDEX[c.style]).toBe(i);
      expect(CHARACTER_BY_ID[c.id]).toBe(c);
      expect(AIR_GRABS[c.style]).toBe(c.airGrab);
      expect(SPECIAL_NAMES[c.special]).toBe(SPECIALS[c.special].name);
      // and the painted face comes from the same file
      expect(lookOf(i)).toEqual(c.look);
    }
  });

  it("paints a fighter the same way every match, whatever its neighbours do", () => {
    // the look used to be a hash of the fighter's index in the roster, so
    // moving a fighter would silently repaint it
    const before = lookOf(10);
    expect(lookOf(10, STYLES[10])).toEqual(before);
    expect(lookOf(10, { style: "nonsense", punch: 99, torso: 99 })).toEqual(before);
    expect(lookOf(10).def).toBe(CHARACTER_BY_ID["sir-peregrine"].look.def);
  });

  it("hands out a copy of the face, so a caller cannot change the design", () => {
    const want = { ...CHARACTERS[3].look };
    const look = lookOf(3);
    look.def = 99;
    look.scar = 3;
    expect(lookOf(3)).toEqual(want);
    expect(CHARACTERS[3].look).toEqual(want);
  });
});
