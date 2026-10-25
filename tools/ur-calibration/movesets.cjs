// Dump every Urban Reign moveset's frame data straight from the game executable.
//
// The attack data is static: the action, reaction, hit and branch tables and
// the moveset records are byte-identical in the ELF and in a live EE RAM dump
// taken mid-fight. So this reads the ELF and needs no emulator run.
//
// Record layout from Urban Reign Redux (github.com/Jasonafex/urban-reign-redux,
// runtime/combat-trial13/ur_actions.py), checked here against the timings
// measured in EE RAM (docs/calibration/urban-reign-frames.json):
//
//   ACTION   0x4616f0, 64 bytes, indexed by action id (actor + 0x8d40 holds it)
//            +0 motion (animation) id, +2 state class, +4 end action,
//            +6 start frame, +8 end frame (the last frame of the action),
//            +0x32 branch index, +0x34 branch count, +0x38 reaction index
//            (0 = none: exactly the strike actions, state 6, have one)
//   REACTION 0x4ab768, 236 bytes, +0xc0 hit index, +0xc2 hit count
//   HIT      0x51e5a0, 9 x s16: [0] first active frame; the rest is kept raw. [3]
//            looks like the limb (0/1 punches, 2 kicks), [1]/[2] are usually later
//            frames of the swing but not always ordered (2031: 24, ?, 20).
//   BRANCH   0x5338d8, 15 x s16: [0] target action (-3 back to neutral), [3] input,
//            [4]..[5] the frames of this action in which that input takes the branch
//   MOVESET  pointer table at 0x59b560 (128 entries), record + 0x1c2 holds 12
//            root actions (-1 none). [0] is the neutral strike (Brad: 1388, the
//            string measured in EE RAM); [10]/[11] are shared by every moveset.
//            The other slots are not identified yet: Brad's [3] is not the
//            stick-down strike measured in EE RAM, and [6..9] are strikes.
//
// Usage: node tools/ur-calibration/movesets.cjs [path/to/ps2web.data|core.elf] [out.json]
// Without a path it takes the pristine engine data from urban-reign-pitfighter's
// history (`git show 1303e9f:ps2web.data`, UR_PITFIGHTER points at the checkout).
//
// clusters.cjs reads the JSON this writes and groups its strikes into the move
// archetypes the roster design is written against (src/data/characters.json).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ACTION = 0x4616f0, REACTION = 0x4ab768, HIT = 0x51e5a0, BRANCH = 0x5338d8, MOVESETS = 0x59b560;
// The action table has room for 4738 records, but past 3950 it holds leftovers
// (state classes in the hundreds); Redux bounds its walk the same way.
const N_MOVESETS = 128, N_ACTIONS = 3950;
const N_REACTIONS = Math.floor((HIT - REACTION) / 236), N_HITS = Math.floor((BRANCH - HIT) / 18);
const BRANCH_END = 0x579408; // the moveset records follow the branch table
const N_BRANCHES = Math.floor((BRANCH_END - BRANCH) / 30);

function loadElf(file) {
  let buf;
  if (file) buf = fs.readFileSync(file);
  else {
    const repo = process.env.UR_PITFIGHTER || path.resolve(__dirname, "../../../urban-reign-pitfighter");
    buf = execFileSync("git", ["-C", repo, "show", "1303e9f:ps2web.data"], { maxBuffer: 64 << 20, timeout: 60000 });
  }
  // ps2web.data starts with a "cdrom0:\SLUS_212.09;1\n" boot header in front of the ELF
  const at = buf.indexOf(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  if (at < 0 || at > 64) throw new Error("no ELF header in " + (file || "ps2web.data"));
  const elf = buf.subarray(at);
  const phoff = elf.readUInt32LE(0x1c), phsize = elf.readUInt16LE(0x2a), phnum = elf.readUInt16LE(0x2c);
  const segs = [];
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phsize;
    if (elf.readUInt32LE(p) !== 1) continue; // PT_LOAD
    segs.push({ off: elf.readUInt32LE(p + 4), vaddr: elf.readUInt32LE(p + 8), filesz: elf.readUInt32LE(p + 16) });
  }
  const off = (va) => {
    const s = segs.find((s) => va >= s.vaddr && va < s.vaddr + s.filesz);
    if (!s) throw new Error("address 0x" + va.toString(16) + " is not in the ELF image");
    return s.off + va - s.vaddr;
  };
  return { h: (va) => elf.readInt16LE(off(va)), H: (va) => elf.readUInt16LE(off(va)), U: (va) => elf.readUInt32LE(off(va)) };
}

function decoder(m) {
  const seq = (va, n) => Array.from({ length: n }, (_, i) => m.h(va + 2 * i));
  /** null for a record whose indices run past the tables (unused slots hold leftovers). */
  function action(i) {
    const p = ACTION + 64 * i;
    const ri = m.H(p + 0x38);
    if (ri >= N_REACTIONS) return null;
    const r = REACTION + ri * 236;
    const hi = m.H(r + 0xc0), hn = ri ? m.H(r + 0xc2) : 0, bi = m.H(p + 0x32), bn = m.H(p + 0x34);
    if (hi + hn > N_HITS || bi + bn > N_BRANCHES || m.h(p) < 0) return null;
    return {
      id: i, motion: m.h(p), state: m.h(p + 2), endAction: m.h(p + 4), startFrame: m.h(p + 6), endFrame: m.h(p + 8),
      reaction: ri,
      hits: Array.from({ length: hn }, (_, j) => {
        const v = seq(HIT + 18 * (hi + j), 9);
        return { first: v[0], raw: v };
      }),
      branches: Array.from({ length: bn }, (_, j) => {
        const v = seq(BRANCH + 30 * (bi + j), 15);
        return { to: v[0], input: v[3], from: v[4], until: v[5], raw: v };
      }),
    };
  }
  function moveset(s) {
    const p = m.U(MOVESETS + s * 4);
    return { index: s, roots: seq(p + 0x1c2, 12) };
  }
  return { action, moveset };
}

/**
 * Every valid action record, plus each moveset's roots and the actions reachable
 * from them through the branch table. Some actions are picked outside the branch
 * table (the enemy AI's attacks, context attacks), so they belong to no moveset.
 */
function dump(m) {
  const d = decoder(m);
  const actions = new Map();
  for (let i = 0; i < N_ACTIONS; i++) {
    const a = d.action(i);
    if (a) actions.set(i, a);
  }
  const movesets = [];
  for (let s = 0; s < N_MOVESETS; s++) {
    const ms = d.moveset(s);
    const reach = new Set();
    const pending = ms.roots.filter((r) => r > 0 && r < N_ACTIONS);
    while (pending.length) {
      const i = pending.pop();
      if (reach.has(i) || !actions.has(i)) continue;
      reach.add(i);
      for (const b of actions.get(i).branches) if (b.to > 0 && b.to < N_ACTIONS && !reach.has(b.to)) pending.push(b.to);
    }
    movesets.push({ ...ms, actions: [...reach].sort((a, b) => a - b) });
  }
  // movesets with the same roots and reachable actions share their data; keep the first index
  const seen = new Map();
  for (const ms of movesets) {
    const key = ms.roots.join(",") + "|" + ms.actions.join(",");
    ms.sameAs = seen.has(key) ? seen.get(key) : null;
    if (!seen.has(key)) seen.set(key, ms.index);
  }
  return {
    source: "Urban Reign (SLUS_212.09) executable, static attack tables (layout: Urban Reign Redux ur_actions.py)",
    tables: { ACTION, REACTION, HIT, BRANCH, MOVESETS },
    frames: "all frame numbers count from 0, the first frame of the action, at 60 Hz",
    movesets,
    actions: Object.fromEntries([...actions.values()].sort((a, b) => a.id - b.id).map((a) => [a.id, a])),
  };
}

const ROOT_NAMES = ["neutral", ...Array.from({ length: 9 }, (_, k) => `[${k + 1}]`), "[10] shared", "[11] shared"];

/** The strike frame data of every distinct moveset as Markdown tables. */
function summary(data) {
  const out = [
    "# Urban Reign moveset frame data",
    "",
    "Generated by `tools/ur-calibration/movesets.cjs` from the game executable; the full",
    "records are in `urban-reign-movesets.json`. Frames count from 0, the action's first",
    "frame, at 60 Hz. *hit* is the first active frame of each hit, *len* the action's",
    "length, *follow-ups* the actions its input windows lead to (`-3` back to neutral)",
    "with the frames in which the input is taken.",
    "",
  ];
  const A = data.actions;
  for (const ms of data.movesets) {
    if (ms.sameAs !== null) continue;
    const twins = data.movesets.filter((m) => m.sameAs === ms.index).map((m) => m.index);
    const strikes = ms.actions.filter((i) => A[i].hits.length);
    if (!strikes.length) continue;
    out.push(`## Moveset ${ms.index}` + (twins.length ? ` (also ${twins.join(", ")})` : ""), "");
    out.push(
      "Roots: " +
        ms.roots.map((r, k) => (r > 0 ? `${ROOT_NAMES[k]} ${r}` : null)).filter(Boolean).join(", "),
      "",
      "| action | motion | hit | len | follow-ups |",
      "|---|---|---|---|---|",
    );
    for (const i of strikes) {
      const a = A[i];
      const next = a.branches.map((b) => `${b.to} @${b.from}–${b.until}`).join(", ");
      out.push(`| ${i} | ${a.motion} | ${a.hits.map((h) => h.first).join(", ")} | ${a.endFrame + 1} | ${next} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

module.exports = { loadElf, decoder, dump, summary, ACTION, REACTION, HIT, BRANCH, MOVESETS };

if (require.main === module) {
  const watchdog = setTimeout(() => { console.error("TIMEOUT movesets"); process.exit(1); }, 90000);
  const [file, out] = process.argv.slice(2);
  const data = dump(loadElf(file));
  // one moveset or action per line keeps the file diffable
  const line = (v) => JSON.stringify(v, (k, x) => (k === "raw" ? x.join(" ") : x));
  const json = [
    "{",
    ...["source", "tables", "frames"].map((k) => ` ${JSON.stringify(k)}: ${JSON.stringify(data[k])},`),
    ' "movesets": [',
    data.movesets.map((x) => "  " + line(x)).join(",\n"),
    " ],",
    ' "actions": {',
    Object.entries(data.actions).map(([k, x]) => `  ${JSON.stringify(k)}: ${line(x)}`).join(",\n"),
    " }",
    "}",
  ].join("\n");
  const dest = out || path.resolve(__dirname, "../../docs/calibration/urban-reign-movesets.json");
  fs.writeFileSync(dest, json + "\n");
  fs.writeFileSync(dest.replace(/\.json$/, ".md"), summary(data) + "\n");
  const unique = data.movesets.filter((m) => m.sameAs === null).length;
  console.log(`${data.movesets.length} movesets (${unique} distinct), ${Object.keys(data.actions).length} actions -> ${dest}`);
  clearTimeout(watchdog);
}
