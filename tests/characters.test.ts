// The character design: one file, and it has to stay honest.
//
// src/data/characters.json is where a fighter is written down. The tests here
// are the guards that keep it true:
//
//   1. the design is frozen - the snapshot below is what the hand-written tables
//      said on the day they were lifted into the JSON, so any accidental change
//      to a fighter has to be a deliberate one
//   2. the file meets the schema in src/data/types.ts
//   3. the texture half agrees with the texture pipeline's own spec
//   4. every fighter has its textures on disk
//   5. the views the game reads (STYLES, KITS, FAMILY_OF, MOVES) are all
//      derived from that one file and agree with it
import { describe, expect, it } from "vitest";
import { CHARACTERS, CHARACTER_BY_ID, FAMILY_OF, KITS, SPECIAL_NAMES, SPECIALS, STYLES, STYLE_INDEX } from "../src/data/characters";
import { MOVES } from "../src/sim/moves";
import { lookOf } from "../src/render/anatomy";
import { FAMILIES } from "../src/render/motion";
import texSpec from "../public/tex/spec.json";

interface Snapshot {
  id: string;
  style: string;
  name: string;
  special: string;
  family: string;
  size: number;
  horns: string;
  tail: string;
  gear: string[];
  stats: number[]; // speed, startup, punch, kick, grab, reach, string, torso, grabReach
  look: (number | boolean)[]; // def, scar, paint, wrinkles, stubble, veins
  seed: number;
}

// What the hand-written tables said before the design moved into one JSON file.
const SNAPSHOT: Snapshot[] = [
  { id: "dale-damnation", style: "All-Round", name: "Dale Damnation", special: "spFlurry", family: "karate", size: 1, horns: "goat", tail: "spade", gear: [], stats: [1, 0, 1, 1, 1, 1, 2, 1, 1], look: [0.8195906923618168, 1, 1, false, false, true], seed: 4101 },
  { id: "brimstone-bruno", style: "Power", name: "Brimstone Bruno", special: "spCharge", family: "power", size: 1.2, horns: "bull", tail: "stub", gear: ["pauldrons", "tusks"], stats: [0.85, 4, 1.35, 1.2, 1.2, 1, 2, 1.25, 1], look: [0.9142237462336197, 1, 3, false, true, true], seed: 4238 },
  { id: "gutter-gus", style: "Street", name: "Gutter Gus", special: "spFlurry", family: "brawler", size: 1, horns: "broken", tail: "spade", gear: ["mohawk"], stats: [1, 0, 1.1, 0.95, 1.1, 1, 2, 1, 1], look: [1.2486192781943828, 0, 1, false, true, true], seed: 4375 },
  { id: "sensei-smoulder", style: "Karate", name: "Sensei Smoulder", special: "spSpin", family: "karate", size: 1, horns: "spikes", tail: "spade", gear: ["headband"], stats: [1, -2, 1.1, 1.05, 1, 1, 2, 1, 1], look: [1.23128529752139, 0, 2, false, true, true], seed: 4512 },
  { id: "big-lou-cipher", style: "Wrestling", name: "Big Lou Cipher", special: "spSlam", family: "power", size: 1.17, horns: "ram", tail: "stub", gear: ["title"], stats: [0.9, 0, 0.9, 1, 1.5, 1, 2, 1.15, 1.25], look: [0.8159548001363873, 1, 3, true, true, false], seed: 4649 },
  { id: "eight-limbed-ash", style: "Muay Thai", name: "Eight-Limbed Ash", special: "spFlurry", family: "muay", size: 0.98, horns: "nubs", tail: "long", gear: ["headband"], stats: [1, 0, 0.95, 1.3, 1.2, 1, 2, 1, 1], look: [0.7825271429494023, 0, 2, false, true, false], seed: 4786 },
  { id: "knuckles-inferno", style: "Boxing", name: "Knuckles Inferno", special: "spFlurry", family: "boxing", size: 1.02, horns: "spikes", tail: "spade", gear: ["gloves"], stats: [1, -2, 1.3, 0.6, 1, 1, 3, 1, 1], look: [1.1241097009857184, 2, 1, true, true, true], seed: 4923 },
  { id: "rage-reaper", style: "Rush", name: "Rage Reaper", special: "spCharge", family: "brawler", size: 1.02, horns: "swept", tail: "barbed", gear: ["spines"], stats: [1.15, -2, 1.05, 1, 1, 1, 2, 0.9, 1], look: [0.7876666715601459, 2, 1, false, false, false], seed: 5060 },
  { id: "quickfire-imp", style: "Speed", name: "Quickfire Imp", special: "spSpin", family: "kungfu", size: 0.8, horns: "long", tail: "long", gear: ["wings"], stats: [1.3, -4, 0.75, 0.75, 1, 1, 2, 0.8, 1], look: [0.7913860698579811, 1, 0, false, true, true], seed: 5197 },
  { id: "crimson-crane", style: "Kung Fu", name: "Crimson Crane", special: "spSpin", family: "kungfu", size: 0.97, horns: "nubs", tail: "long", gear: ["topknot"], stats: [1, -2, 0.9, 1.05, 1, 1, 3, 1, 1], look: [1.0079326279577798, 2, 2, false, false, true], seed: 5334 },
  { id: "hellmountain", style: "Mighty", name: "Hellmountain", special: "spSlam", family: "power", size: 1.28, horns: "crown", tail: "stub", gear: ["pauldrons", "spines"], stats: [0.75, 6, 1.5, 1.3, 1.3, 1, 1, 1.4, 1], look: [0.9714958808850497, 2, 1, true, false, true], seed: 5471 },
  { id: "choke-chimera", style: "Submission", name: "Choke Chimera", special: "spSlam", family: "grappler", size: 1.05, horns: "ram", tail: "barbed", gear: ["spines"], stats: [1, 0, 0.85, 0.9, 1.4, 1, 2, 1, 1.15], look: [0.7782112198299729, 3, 2, false, true, true], seed: 5608 },
  { id: "sergeant-sulphur", style: "Military", name: "Sergeant Sulphur", special: "spCharge", family: "karate", size: 1.05, horns: "nubs", tail: "stub", gear: ["beret", "pauldrons"], stats: [1, 0, 1.05, 1.05, 1.15, 1, 2, 1.1, 1], look: [1.0290683080791496, 0, 2, true, false, false], seed: 5745 },
  { id: "cinder-ginga", style: "Capoeira", name: "Cinder Ginga", special: "spSpin", family: "kicker", size: 0.95, horns: "long", tail: "long", gear: [], stats: [1.1, 0, 0.8, 1.25, 1, 1.12, 2, 1, 1], look: [0.9332816228969023, 1, 2, false, false, false], seed: 5882 },
  { id: "hellkick-hana", style: "Tae Kwon Do", name: "Hellkick Hana", special: "spSpin", family: "kicker", size: 0.93, horns: "swept", tail: "spade", gear: ["headband", "topknot"], stats: [1, -2, 0.85, 1.35, 1, 1.1, 2, 1, 1], look: [0.765867772733327, 3, 0, false, false, true], seed: 6019 },
  { id: "ronin-of-gehenna", style: "Samurai Sword", name: "Ronin of Gehenna", special: "spBlade", family: "brawler", size: 1, horns: "long", tail: "spade", gear: ["kasa"], stats: [1, 2, 1.1, 1, 1, 1.3, 2, 1, 1], look: [0.9561826826189644, 0, 2, false, true, true], seed: 6156 },
  { id: "the-old-devil", style: "Master", name: "The Old Devil", special: "spBlade", family: "kungfu", size: 0.94, horns: "ram", tail: "long", gear: ["beard"], stats: [0.95, -2, 1.1, 1.1, 1.1, 1, 2, 1, 1], look: [0.9493154739495367, 1, 2, true, false, true], seed: 6293 },
  { id: "hellfire-flick", style: "Gun", name: "Hellfire Flick", special: "spFire", family: "brawler", size: 1, horns: "goat", tail: "spade", gear: ["stetson"], stats: [1, 2, 0.85, 1, 1, 1.4, 2, 1, 1], look: [1.0546730211470277, 0, 3, true, true, true], seed: 6430 },
  { id: "brother-blaze", style: "Martial Arts", name: "Brother Blaze", special: "spFlurry", family: "karate", size: 0.97, horns: "nubs", tail: "spade", gear: ["headband"], stats: [1, -4, 1, 1.1, 1, 1, 3, 0.95, 1], look: [0.8766365985735319, 2, 2, true, false, true], seed: 6567 },
  { id: "ashen-judoka", style: "Judo Based", name: "Ashen Judoka", special: "spSlam", family: "grappler", size: 1.06, horns: "bull", tail: "stub", gear: ["obi"], stats: [1, 0, 1.05, 1, 1.35, 1, 2, 1, 1.1], look: [0.9226426658802666, 0, 0, true, false, false], seed: 6704 },
  { id: "fresh-soul-kevin", style: "Amateur", name: "Fresh Soul Kevin", special: "spCharge", family: "boxing", size: 0.95, horns: "nubs", tail: "stub", gear: ["lanyard"], stats: [1, 2, 0.85, 0.85, 0.85, 1, 2, 0.9, 1], look: [0.9451732343994081, 0, 0, false, false, true], seed: 6841 },
];

const SPECIAL_SNAPSHOT: [string, string][] = [
  ["spSpin", "HELLSPIN"],
  ["spCharge", "BRIMSTONE CHARGE"],
  ["spFlurry", "INFERNAL FLURRY"],
  ["spSlam", "PIT SLAM"],
  ["spBlade", "PITCHFORK ARC"],
  ["spFire", "HELLFIRE FLICK"],
];

const HORNS = ["goat", "bull", "ram", "long", "swept", "nubs", "spikes", "broken", "crown"];
const TAILS = ["spade", "long", "stub", "barbed"];
const GEAR = [
  "mohawk", "topknot", "beard", "headband", "gloves", "pauldrons", "spines", "wings",
  "beret", "kasa", "stetson", "lanyard", "obi", "tusks", "title",
];
// every texture the pipeline shipped, so a fighter that has no folder is a bug
const TEX_FILES = import.meta.glob("../public/tex/fighters/*/*.webp");
const CONTACT_FILES = import.meta.glob("../public/tex/contact/*.png");

describe("the character design", () => {
  it("is the roster the game has always had, in the same order", () => {
    expect(CHARACTERS).toHaveLength(21);
    expect(CHARACTERS.map((c) => c.id)).toEqual(SNAPSHOT.map((s) => s.id));
    expect(CHARACTERS.map((c) => c.style)).toEqual(SNAPSHOT.map((s) => s.style));
    expect(CHARACTERS.map((c) => c.name)).toEqual(SNAPSHOT.map((s) => s.name));
  });

  it("still says exactly what the tables said before the design moved into one file", () => {
    for (const [i, s] of SNAPSHOT.entries()) {
      const c = CHARACTERS[i];
      const where = `${c.id} (${c.style})`;
      expect(c.special, where).toBe(s.special);
      expect(c.family, where).toBe(s.family);
      expect(c.kit.size, where).toBe(s.size);
      expect(c.kit.horns, where).toBe(s.horns);
      expect(c.kit.tail, where).toBe(s.tail);
      expect(c.kit.gear, where).toEqual(s.gear);
      expect(
        [c.stats.speed, c.stats.startup, c.stats.punch, c.stats.kick, c.stats.grab, c.stats.reach, c.stats.string, c.stats.torso, c.stats.grabReach],
        where,
      ).toEqual(s.stats);
      expect(
        [c.look.def, c.look.scar, c.look.paint, c.look.wrinkles, c.look.stubble, c.look.veins],
        where,
      ).toEqual(s.look);
      expect(c.texture.seed, where).toBe(s.seed);
    }
  });

  it("gives every fighter a name, a style and a slug of its own", () => {
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    expect(new Set(CHARACTERS.map((c) => c.name)).size).toBe(CHARACTERS.length);
    expect(new Set(CHARACTERS.map((c) => c.style)).size).toBe(CHARACTERS.length);
    for (const c of CHARACTERS) {
      expect(c.id, c.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.blurb.length, c.name).toBeGreaterThan(10);
      expect(c.body, c.name).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.accent, c.name).toMatch(/^#[0-9a-f]{6}$/);
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
    }
  });

  it("has a fighter's textures and a contact sheet on disk", () => {
    for (const c of CHARACTERS) {
      const files = Object.keys(TEX_FILES).filter((p) => p.includes(`/fighters/${c.id}/`));
      expect(files.length, c.id).toBeGreaterThan(0);
      expect(Object.keys(CONTACT_FILES).some((p) => p.endsWith(`/contact/${c.id}.png`)), c.id).toBe(true);
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
      expect(STYLES[i].punch).toBe(c.stats.punch);
      expect(KITS[c.style]).toEqual(c.kit);
      expect(FAMILY_OF[c.style]).toBe(c.family);
      expect(STYLE_INDEX[c.style]).toBe(i);
      expect(CHARACTER_BY_ID[c.id]).toBe(c);
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
    expect(lookOf(10).def).toBe(SNAPSHOT[10].look[0]);
  });
});
