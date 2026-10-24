// Analyse the reaction captures (cap2-4): every run of a reaction action the
// victims played, with its length when it ran to its end or into the next
// action of its chain, grouped as light / heavy / knockdown / grapple. The
// record lengths come from the action table (urban-reign-movesets.json).
//
// Usage: node tools/ur-calibration/an7.cjs cap2.json cap3.json cap4.json [out.json]
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const out = args.find((a) => a.endsWith("reactions.json")) || path.resolve(__dirname, "../../docs/calibration/urban-reign-reactions.json");
const caps = args.filter((a) => a !== out);
const A = require("../../docs/calibration/urban-reign-movesets.json").actions;

// action -> the frames of every run of it; a run is cut off where the motion changes
const runs = {};
for (const f of caps) {
  const { rows } = JSON.parse(fs.readFileSync(f, "utf8"));
  const NA = (rows[0].length - 2) / 5;
  const g = (i, k, x) => rows[i][2 + 5 * k + x];
  for (let k = 0; k < NA; k++) {
    let st = 0;
    for (let i = 1; i <= rows.length; i++) {
      if (i < rows.length && g(i, k, 0) === g(st, k, 0) && g(i, k, 3) !== 1) continue;
      const id = g(st, k, 0);
      const next = i < rows.length ? g(i, k, 0) : -1;
      if (i < rows.length) (runs[id] = runs[id] || []).push({ len: rows[i - 1][0] - rows[st][0] + 1, next });
      st = i;
    }
  }
}
/** the lengths of an action's runs that ended by going on to `next` (any if omitted) */
const lens = (id, ...next) => (runs[id] || []).filter((r) => !next.length || next.includes(r.next)).map((r) => r.len).sort((a, b) => a - b);
const rec = (id) => A[id].endFrame + 1;
const median = (xs) => xs[Math.floor(xs.length / 2)];
const entry = (id, ...next) => ({ action: id, record: rec(id), measured: lens(id, ...next) });

const fall = lens(154, 170, 177).filter((n) => n > 10); // the short runs are a knockdown landing on a body already falling
const data = {
  source: "Urban Reign (SLUS_212.09) EE RAM, first story fight; tools/ur-calibration/probe2-4 + an7. Frame numbers only.",
  frames: "60 Hz; a run is counted from the action's first frame to the frame before the next action",
  light: {
    note: "every light hit plays a 41-frame reaction; which one follows the striking limb (hit field [3]: 0, 1 the hands, 2 a leg), i.e. the side the blow comes from",
    len: 41,
    byLimb: { 0: entry(19), 1: entry(20), 2: entry(21) },
    other: entry(65),
  },
  heavy: {
    note: "the enemies' heavier strikes and Brad's stick strikes play longer reactions",
    actions: [entry(24), entry(90), entry(179), entry(256), entry(27)],
  },
  knockdown: {
    note: "the finisher knocks down: a fall to the floor, a spell on it (face up or face down), and a get-up",
    fall: { action: 154, record: rec(154), toFloor: fall, median: median(fall) },
    faceUp: { floor: entry(170, 168), getup: entry(168, 757, 1081) },
    faceDown: { floor: entry(177, 175), getup: entry(175, 757, 1081, 699) },
  },
  grapple: {
    note: "a hold taken straight into a throw: the thrower's throw motion, and the victim thrown onto the floor before the get-up",
    hold: entry(3571, 3567),
    throw: entry(3567),
    held: entry(699, 723),
    thrown: { ...entry(723), next: [...new Set((runs[723] || []).map((r) => r.next))] },
  },
};
// the number lists on one line each keep the file short and diffable
fs.writeFileSync(out, JSON.stringify(data, null, 1).replace(/\[[\d,\s]*\]/g, (m) => m.replace(/\s+/g, "")) + "\n");
console.log("wrote", out);
