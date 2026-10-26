// Cluster every strike Urban Reign's attack tables hold into a short list of
// move archetypes, each with the timing envelope its members share.
//
// Input: docs/calibration/urban-reign-movesets.json (movesets.cjs decodes it
// from the executable). Output: docs/calibration/urban-reign-move-clusters.json
// and .md. The roster design (src/data/characters.json) names these clusters as the
// source of each move archetype, and tests/roster.test.ts holds every move it
// writes inside its archetype's envelope.
//
// What a strike record says, as far as it is decoded:
//
//   hit [0]      the first active frame
//   hit [3]      0, 1 or 2: the height class. 2 is the shared ground stomp
//                (actions 1180/1181) and Brad's stick-down strike 2937; 0 and 1
//                split the standing strikes (1390, the third jab, is 1).
//   hit [4..8]   the bones the hit is carried by, -1 terminated, in (from, to)
//                capsules: 13,12 the lead arm (Brad's jab 1388), 9,8 the rear
//                arm (his cross 1389), 17,15 and 21,19 the two legs (the kicks
//                1393, 1903); 17,0 runs a foot to the root. Two limbs' capsules:
//                a two-limb hit (1180: both legs).
//   branch [3]   the input: 57 Circle (strike), 59 Triangle (grapple)
//   branch [9..11]  a stick condition: 4 and an arc in degrees, 270..90 the
//                stick forward or neutral, 90..270 the stick back
//
// And the moveset roots, from the game's own command list (message table
// 1101-1146) set against what each slot holds:
//
//   [0]      the neutral strike: the Circle string
//   [1] [2]  the regional strikes, stick right / left + Circle (the upper body):
//            [1] is carried by the rear arm in 37 of 56 movesets, [2] by the
//            lead arm in 36, and their motions come in mirrored pairs (255/253,
//            251/250)
//   [3]      a strike of its own per moveset, often a two-hit kick (1903 ->
//            1904): the dash strike or the head strike; not settled
//   [6..9]   two mirrored pairs, 27-33 f to the hit, carried by the legs, whose
//            Circle branches go to -41/-31 and Triangle to a grapple attack
//            (1460 / 1126): the diving strike off a wall or a person, and its
//            diving combo / diving grapple follow-ups (message 1122)
//   [10] [11] shared by every moveset, both legs, height class 2, active 20-60:
//            the down strike on a fallen body
//
// Usage: node tools/ur-calibration/clusters.cjs
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "docs", "calibration", "urban-reign-movesets.json");
const OUT_JSON = path.join(ROOT, "docs", "calibration", "urban-reign-move-clusters.json");
const OUT_MD = path.join(ROOT, "docs", "calibration", "urban-reign-move-clusters.md");

const data = JSON.parse(fs.readFileSync(SRC, "utf8"));
const A = data.actions;
const STRIKE = 6, GRAPPLE = 8;
const SLOT_NAMES = ["neutral", "regional R", "regional L", "slot 3", "slot 4", "slot 5", "diving", "diving", "diving", "diving", "down", "down"];

// ---- features -------------------------------------------------------------

const hitFields = (h) => h.raw.split(" ").map(Number);
// a hit's bones come in (from, to) capsules: 13,12 the lead forearm, 17,0 a
// foot to the root, so a whole leg. Each bone belongs to one limb; 0 is the root.
const LIMB_OF_BONE = { 8: "rear arm", 9: "rear arm", 12: "lead arm", 13: "lead arm", 15: "leg", 16: "leg", 17: "leg", 19: "leg", 20: "leg", 21: "leg" };
const SIDE_OF_BONE = { 15: "a", 16: "a", 17: "a", 19: "b", 20: "b", 21: "b" };
/** what carries a hit: one arm, a leg, both arms, both legs, or the trunk (bones 4-7, 10, 11, 100 ...) */
function limbOf(h) {
  const bones = [];
  for (const b of hitFields(h).slice(4)) {
    if (b < 0) break;
    if (b > 0) bones.push(b);
  }
  const limbs = new Set(bones.map((b) => LIMB_OF_BONE[b] ?? "trunk"));
  const legs = new Set(bones.filter((b) => SIDE_OF_BONE[b]).map((b) => SIDE_OF_BONE[b]));
  if (limbs.size === 1) {
    const [l] = limbs;
    return l === "leg" && legs.size === 2 ? "both legs" : l;
  }
  if ([...limbs].every((l) => l.endsWith("arm"))) return "both arms";
  return "body";
}
const LIMB_CLASS = { "lead arm": "arm", "rear arm": "arm", "both arms": "arm", leg: "leg", "both legs": "leg", trunk: "body", body: "body" };
const HEIGHT = ["high", "mid", "low"];

// the strike graph: who branches into whom
const indeg = {}, outdeg = {};
for (const a of Object.values(A))
  for (const b of a.branches)
    if (b.to > 0 && A[b.to] && A[b.to].state === STRIKE) {
      indeg[b.to] = (indeg[b.to] || 0) + 1;
      if (a.state === STRIKE) outdeg[a.id] = (outdeg[a.id] || 0) + 1;
    }
const fromGrapple = new Set();
for (const a of Object.values(A))
  if (a.state === GRAPPLE) for (const b of a.branches) if (b.to > 0 && A[b.to] && A[b.to].state === STRIKE) fromGrapple.add(b.to);
const roleOf = (a) => {
  const i = indeg[a.id] || 0, o = outdeg[a.id] || 0;
  if (i === 0 && o === 0) return "lone";
  if (i === 0) return "opener";
  return o === 0 ? "ender" : "link";
};

// which distinct movesets reach an action from their roots, and from which slot
const distinct = data.movesets.filter((m) => m.sameAs == null);
const reachedBy = {}, slotOf = {};
for (const ms of distinct) {
  ms.roots.forEach((r, slot) => {
    if (r <= 0 || !A[r]) return;
    const seen = new Set([r]), todo = [r];
    while (todo.length) {
      const id = todo.pop();
      (reachedBy[id] = reachedBy[id] || new Set()).add(ms.index);
      (slotOf[id] = slotOf[id] || new Set()).add(slot);
      for (const b of A[id].branches) if (b.to > 0 && A[b.to] && A[b.to].state === STRIKE && !seen.has(b.to)) seen.add(b.to), todo.push(b.to);
    }
  });
}

const strikes = [];
const left = { noHit: 0, sentinel: 0, frameZero: 0, cinematic: 0 };
for (const a of Object.values(A)) {
  if (a.state !== STRIKE) continue;
  if (!a.hits.length) { left.noHit++; continue; }
  const firsts = a.hits.map((h) => h.first);
  const length = a.endFrame + 1;
  if (firsts.some((f) => f >= 900)) { left.sentinel++; continue; } // 996: a hit that never comes
  if (firsts[0] === 0) { left.frameZero++; continue; } // a scripted hit on the first frame
  if (length > 200) { left.cinematic++; continue; }
  const last = Math.max(...firsts);
  const f0 = hitFields(a.hits[0]);
  strikes.push({
    id: a.id,
    motion: a.motion,
    startup: firsts[0],
    length,
    recovery: length - last,
    hits: a.hits.length,
    active: Math.max(1, f0[1] - f0[0] + 1),
    limb: limbOf(a.hits[0]),
    height: HEIGHT[f0[3]] ?? "high",
    role: roleOf(a),
    fromGrapple: fromGrapple.has(a.id),
    movesets: reachedBy[a.id] ? reachedBy[a.id].size : 0,
    slots: slotOf[a.id] ? [...slotOf[a.id]].sort((x, y) => x - y) : [],
  });
}

// ---- k-means --------------------------------------------------------------

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) || 1;
// timing is what an archetype keeps, so the clusters are cut on it: the first
// active frame and the whole action weigh most, the recovery less
const FEATS = [["startup", 1], ["length", 1], ["recovery", 0.6]];
const SCALE = FEATS.map(([f]) => sd(strikes.map((s) => s[f])));
const vec = (s) => FEATS.map(([f, w], i) => (s[f] / SCALE[i]) * w);
const d2 = (p, q) => p.reduce((t, x, i) => t + (x - q[i]) ** 2, 0);

/** deterministic k-means: seeds at the k quantiles of the startup, then Lloyd */
function kmeans(items, k) {
  const pts = items.map(vec);
  const order = pts.map((p, i) => i).sort((i, j) => pts[i][0] - pts[j][0] || pts[i][1] - pts[j][1]);
  let cents = Array.from({ length: k }, (_, c) => pts[order[Math.floor(((c + 0.5) / k) * pts.length)]].slice());
  let assign = new Array(pts.length).fill(0);
  for (let it = 0; it < 100; it++) {
    let moved = false;
    pts.forEach((p, i) => {
      let best = 0;
      for (let c = 1; c < k; c++) if (d2(p, cents[c]) < d2(p, cents[best])) best = c;
      if (best !== assign[i]) (assign[i] = best), (moved = true);
    });
    cents = cents.map((c, ci) => {
      const mine = pts.filter((_, i) => assign[i] === ci);
      return mine.length ? c.map((_, f) => mean(mine.map((p) => p[f]))) : c;
    });
    if (!moved && it > 0) break;
  }
  const sse = pts.reduce((t, p, i) => t + d2(p, cents[assign[i]]), 0);
  return { assign, sse };
}

/** the fewest clusters past which another one explains under 35% of what is left */
function cluster(items) {
  if (items.length < 12) return { k: 1, assign: items.map(() => 0) };
  let prev = kmeans(items, 1), k = 1;
  for (let next = 2; next <= 4; next++) {
    const run = kmeans(items, next);
    const sizes = Array.from({ length: next }, (_, c) => run.assign.filter((x) => x === c).length);
    if (run.sse > prev.sse * 0.65 || Math.min(...sizes) < Math.max(6, items.length * 0.04)) break;
    (prev = run), (k = next);
  }
  return { k, assign: prev.assign };
}

// ---- groups ---------------------------------------------------------------

// the string role and the limb class split the strikes before the timing does;
// two-hit strikes are their own family whatever carries them
const groups = {};
for (const s of strikes) {
  const key = s.hits > 1 ? "multi" : `${LIMB_CLASS[s.limb]} ${s.role}`;
  (groups[key] = groups[key] || []).push(s);
}

const pct = (xs, p) => {
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.round((p / 100) * (v.length - 1))))];
};
const tally = (xs) => Object.fromEntries(Object.entries(xs.reduce((h, x) => ((h[x] = (h[x] || 0) + 1), h), {})).sort((a, b) => b[1] - a[1]));
const TEMPO = (startup) => (startup <= 13 ? "quick" : startup <= 20 ? "measured" : startup <= 30 ? "heavy" : "committed");

const clusters = [];
for (const key of Object.keys(groups).sort()) {
  const items = groups[key];
  const { k, assign } = cluster(items);
  const parts = Array.from({ length: k }, (_, c) => items.filter((_, i) => assign[i] === c));
  parts.sort((p, q) => mean(p.map((s) => s.startup)) - mean(q.map((s) => s.startup)));
  for (const members of parts) {
    const startups = members.map((s) => s.startup), lengths = members.map((s) => s.length);
    const id = `${key.replace(/ /g, "-")}-${TEMPO(pct(startups, 50))}`;
    let uid = id, n = 2;
    while (clusters.some((c) => c.id === uid)) uid = `${id}-${n++}`;
    const inMovesets = members.filter((s) => s.movesets > 0);
    clusters.push({
      id: uid,
      group: key,
      count: members.length,
      inMovesets: inMovesets.length,
      movesets: new Set(members.flatMap((s) => [...(reachedBy[s.id] || [])])).size,
      startup: { p10: pct(startups, 10), p50: pct(startups, 50), p90: pct(startups, 90), min: Math.min(...startups), max: Math.max(...startups) },
      length: { p10: pct(lengths, 10), p50: pct(lengths, 50), p90: pct(lengths, 90), min: Math.min(...lengths), max: Math.max(...lengths) },
      recovery: { p50: pct(members.map((s) => s.recovery), 50) },
      active: { p50: pct(members.map((s) => s.active), 50) },
      limb: tally(members.map((s) => s.limb)),
      height: tally(members.map((s) => s.height)),
      fromGrapple: members.filter((s) => s.fromGrapple).length,
      slots: tally(members.flatMap((s) => s.slots.map((x) => SLOT_NAMES[x]))),
      // the most widely shared members first: the clearest examples
      examples: [...members].sort((p, q) => q.movesets - p.movesets || p.id - q.id).slice(0, 6).map((s) => s.id),
    });
  }
}

// ---- grapple-class actions: one dimension, the length ---------------------

// state 8 is the dodge, the deflect and the grapple family (docs/calibration.md);
// it has no hit list, so only its length can be clustered
const grapples = Object.values(A).filter((a) => a.state === GRAPPLE).map((a) => a.endFrame + 1).filter((l) => l <= 400);
function bands1d(xs, k) {
  const v = [...xs].sort((a, b) => a - b);
  let cents = Array.from({ length: k }, (_, c) => v[Math.floor(((c + 0.5) / k) * v.length)]);
  let assign = [];
  for (let it = 0; it < 100; it++) {
    assign = v.map((x) => cents.reduce((b, c, i) => (Math.abs(x - c) < Math.abs(x - cents[b]) ? i : b), 0));
    const next = cents.map((c, i) => {
      const m = v.filter((_, j) => assign[j] === i);
      return m.length ? mean(m) : c;
    });
    if (next.every((c, i) => c === cents[i])) break;
    cents = next;
  }
  return cents.map((_, i) => v.filter((_, j) => assign[j] === i)).filter((m) => m.length);
}
const GRAPPLE_BANDS = ["dodge / deflect", "short grapple", "grapple hold", "throw", "long throw", "cinematic throw"];
const grappleBands = bands1d(grapples, 6).map((m, i) => ({
  id: `grapple-${GRAPPLE_BANDS[i].replace(/[ /]+/g, "-")}`,
  label: GRAPPLE_BANDS[i],
  count: m.length,
  length: { p10: pct(m, 10), p50: pct(m, 50), p90: pct(m, 90), min: Math.min(...m), max: Math.max(...m) },
}));

// ---- write ----------------------------------------------------------------

const out = {
  source: "docs/calibration/urban-reign-movesets.json, clustered by tools/ur-calibration/clusters.cjs",
  frames: "60 Hz; startup is the first active frame counted from 0, length the whole action",
  method:
    "every strike action (state 6) with a hit list, split by what carries the first hit (arm, leg, or body) and by its place in the strike graph (opener, link, ender, lone; two-hit strikes on their own), then k-means on the startup, the length and the recovery within each group, adding a cluster only while it explains 35% of what is left",
  strikes: strikes.length,
  setAside: left,
  distinctMovesets: distinct.length,
  clusters,
  grappleBands,
};
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 1) + "\n");

const md = [];
md.push("# Urban Reign's strikes, clustered");
md.push("");
md.push("Generated by `tools/ur-calibration/clusters.cjs` from `urban-reign-movesets.json`;");
md.push("the data is in `urban-reign-move-clusters.json`. `src/data/characters.json` builds its");
md.push("move archetypes on these clusters, and `tests/roster.test.ts` holds every move the");
md.push("roster writes inside the envelope of the clusters its archetype names.");
md.push("");
md.push(`${strikes.length} strikes clustered (${distinct.length} distinct movesets). Set aside: ${left.noHit} with no hit list, ${left.sentinel} with a hit on frame 996 (one that never comes), ${left.frameZero} scripted on frame 0, ${left.cinematic} longer than 200 frames.`);
md.push("");
md.push("Frames at 60 Hz from the action's first frame; p10–p90 across the cluster's members.");
md.push("");
md.push("| cluster | n | in movesets | startup p10–p50–p90 | length p10–p50–p90 | recovery | carried by | height | examples |");
md.push("|---|---:|---:|---|---|---:|---|---|---|");
const top = (o, n = 2) => Object.entries(o).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ");
for (const c of clusters)
  md.push(`| ${c.id} | ${c.count} | ${c.inMovesets} (${c.movesets}) | ${c.startup.p10}–${c.startup.p50}–${c.startup.p90} | ${c.length.p10}–${c.length.p50}–${c.length.p90} | ${c.recovery.p50} | ${top(c.limb)} | ${top(c.height, 3)} | ${c.examples.join(", ")} |`);
md.push("");
md.push("*in movesets*: members reached from a moveset's roots, and in brackets how many");
md.push("movesets reach the cluster. The rest are reached from elsewhere: grapple attacks,");
md.push("Special Arts, weapon sets and the double-team attacks.");
md.push("");
md.push("## Grapple-class actions");
md.push("");
md.push("State 8 holds the dodge, the deflect and the grapple family. It has no hit list, so only");
md.push("the length is clustered (1-D k-means, 6 bands). The 36 f dodge and the 101 f grapple hold");
md.push("measured in EE RAM fall in the first and third bands.");
md.push("");
md.push("| band | n | length p10–p50–p90 | min–max |");
md.push("|---|---:|---|---|");
for (const b of grappleBands) md.push(`| ${b.label} | ${b.count} | ${b.length.p10}–${b.length.p50}–${b.length.p90} | ${b.length.min}–${b.length.max} |`);
md.push("");
fs.writeFileSync(OUT_MD, md.join("\n"));
console.log(`${strikes.length} strikes -> ${clusters.length} clusters; ${grapples.length} grapple-class actions -> ${grappleBands.length} bands`);
