// Stage 2: timing experiments in the first story fight of the retail engine.
//  - dodge: when an enemy starts an attack motion (state 6), press SQUARE
//    (Urban Reign's Dodge/Deflection, message 1112) at a cycling offset;
//  - strike: from idle, single CIRCLE presses and mashed CIRCLE strings.
import fs from "fs";
const OUT_DIR = process.env.UR_CALIB_OUT || "C:/code/trafgals/urp-notes/calib";
import { runStory, B } from "./story_lib.mjs";
import { INSTALL_SAMPLER2, fetchRows } from "./capture2.mjs";

const watchdog = setTimeout(() => { console.error("TIMEOUT probe2"); process.exit(1); }, 620000);
const FRAMES = +(process.env.FRAMES || 4200);
const SPLIT = +(process.env.SPLIT || 2400);
const policy = `((rel, A, mem) => {
  const SQ = ${B.SQUARE}, CI = ${B.CIRCLE};
  const OFFS = [2, 6, 10, 13, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25];
  const me = A[0];
  if (mem.press && rel < mem.press.at + mem.press.len) return rel >= mem.press.at ? mem.press.b : 0;
  mem.press = null;
  if (me.s === 0 && me.chg === 0) mem.idle = (mem.idle || 0) + 1; else if (me.s !== 0) mem.idle = 0;
  if (rel < ${SPLIT}) {
    for (let k = 1; k < A.length; k++) {
      const e = A[k];
      if (e.s === 6 && e.chg === 1) {
        const n = mem.trials.length, o = OFFS[n % OFFS.length];
        mem.press = { at: rel + o, len: 3, b: SQ };
        mem.trials.push({ kind: "dodge", rel, k, motion: e.m, o, myState: me.s, myMotion: me.m });
        return 0;
      }
    }
    return 0;
  }
  if ((mem.idle || 0) >= 20) {
    mem.idle = 0;
    const n = mem.trials.filter((t) => t.kind !== "dodge").length;
    if (n % 2 === 0) { mem.press = { at: rel, len: 3, b: CI }; mem.trials.push({ kind: "strike1", rel }); }
    else { mem.mash = { from: rel, until: rel + 90 }; mem.trials.push({ kind: "mash", rel }); }
  }
  if (mem.mash && rel < mem.mash.until) return ((rel - mem.mash.from) % 8) < 3 ? CI : 0;
  return 0;
})`;
const { h, state } = await runStory("calib2", 8743, 9763, { hardTimeoutMs: 600000, budgetMs: 240000 });
try {
  console.log("fight at frame", state.frames);
  await h.tryEvaluate(INSTALL_SAMPLER2, 10000);
  const res = await h.tryEvaluate(`window.__cap2(${JSON.stringify({ actors: [0, 1, 2, 3], frames: FRAMES, maxMs: 300000 })}, ${JSON.stringify(policy)})`, 320000);
  console.log("capture", JSON.stringify(res));
  const out = await fetchRows(h);
  fs.writeFileSync(`${OUT_DIR}/cap2.json`, JSON.stringify(out));
  await h.screenshot(`${OUT_DIR}/probe2.png`);
  console.log("wrote", out.rows.length, "rows", out.trials.length, "trials");
} finally {
  clearTimeout(watchdog);
  h.teardown();
  process.exit(0);
}
