// Regenerate src/data/characters.json from the tables it replaces.
//
// This is a one-way migration script: it was run once, against the hand-written
// tables in src/sim/styles.ts, src/render/kit.ts, src/render/motion.ts and
// src/render/anatomy.ts, to lift every fighter's design into one JSON file.
// Those tables now read from the JSON instead, so running this again would be
// circular.
//
// It is kept in the repo because it is the record of how the JSON was made:
// the `look` numbers are the hash of the fighter's old array index, and the
// texture seeds and ideas come from public/tex/spec.json. See
// docs/characters.md.
//
//   npx vite-node tools/character-json/derive.ts
//
// It writes src/data/characters.json and prints what it wrote.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { STYLES } from "../../src/sim/styles";
import { KITS } from "../../src/render/kit";
import { FAMILY_OF } from "../../src/render/motion";
import { lookOf } from "../../src/render/anatomy";
import { MOVES, SPECIAL_NAMES } from "../../src/sim/moves";
import type { SpecialId } from "../../src/data/types";
import texSpec from "../../public/tex/spec.json";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

const SPECIAL_IDS: SpecialId[] = ["spSpin", "spCharge", "spFlurry", "spSlam", "spBlade", "spFire"];

const texByStyle = new Map(texSpec.fighters.map((f) => [f.style, f]));

// ---- the specials, lifted out of src/sim/moves.ts ----
const specials: Record<string, { name: string; move: unknown }> = {};
for (const id of SPECIAL_IDS) {
  const m = MOVES[id];
  if (!m) throw new Error(`no move for special ${id}`);
  specials[id] = { name: SPECIAL_NAMES[id], move: m };
}

// ---- the roster, in the order the game has always used it ----
const characters = STYLES.map((st, i) => {
  const kit = KITS[st.style];
  if (!kit) throw new Error(`no kit for style ${st.style}`);
  const family = FAMILY_OF[st.style];
  if (!family) throw new Error(`no family for style ${st.style}`);
  const tex = texByStyle.get(st.style);
  if (!tex) throw new Error(`no texture spec for style ${st.style}`);

  // the texture spec and the fighter table must already agree on the colours
  if (tex.body !== hex(st.color)) throw new Error(`${st.style}: body ${tex.body} != ${hex(st.color)}`);
  if (tex.accent !== hex(st.accent)) throw new Error(`${st.style}: accent ${tex.accent} != ${hex(st.accent)}`);
  if (tex.name !== st.name) throw new Error(`${st.style}: name ${tex.name} != ${st.name}`);

  return {
    id: tex.slug,
    name: st.name,
    style: st.style,
    blurb: st.blurb,
    body: hex(st.color),
    accent: hex(st.accent),
    family,
    special: st.special,
    stats: {
      speed: st.speed,
      startup: st.startup,
      punch: st.punch,
      kick: st.kick,
      grab: st.grab,
      reach: st.reach,
      string: st.string,
      torso: st.torso,
      grabReach: st.grabReach,
    },
    kit: { size: kit.size, horns: kit.horns, tail: kit.tail, gear: [...kit.gear] },
    // the hash of the fighter's old index, frozen: this is what the roster looks like today
    look: lookOf(i, st),
    texture: {
      seed: tex.seed,
      skin: { idea: tex.skin_idea, colour: tex.skin_colour },
      cloth: { idea: tex.cloth_idea, colour: tex.cloth_colour },
      face: { idea: tex.face_idea, colour: tex.face_colour },
    },
  };
});

const out = { schema: "pitfighter-characters/1", specials, characters };
const path = resolve(__dirname, "../../src/data/characters.json");
writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");

console.log(`wrote ${path}`);
console.log(`  ${characters.length} characters, ${Object.keys(specials).length} specials`);
for (const c of characters) {
  console.log(`  ${c.id.padEnd(22)} ${c.style.padEnd(14)} ${c.family.padEnd(9)} ${c.special.padEnd(9)} kit ${c.kit.horns}/${c.kit.tail}/${c.kit.gear.join("+") || "-"}`);
}
