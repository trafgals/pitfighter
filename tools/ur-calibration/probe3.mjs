// Stage 3: deflection windows (SQUARE + stick, message 1112), the low strike
// string (DOWN + CIRCLE), and the grapple (TRIANGLE) in the first story fight.
import fs from "fs";
const OUT_DIR = process.env.UR_CALIB_OUT || "C:/code/trafgals/urp-notes/calib";
import { runStory, B } from "./story_lib.mjs";
import { INSTALL_SAMPLER2, fetchRows } from "./capture2.mjs";

const watchdog = setTimeout(() => { console.error("TIMEOUT probe3"); process.exit(1); }, 620000);
const policy = `((rel, A, mem) => {
  const SQ = ${B.SQUARE}, CI = ${B.CIRCLE}, TR = ${B.TRIANGLE};
  // engine hit frame of each enemy attack motion, measured in probe2
  const HIT = { 2030: 20, 2031: 24, 2032: 26, 2037: 17, 2072: 24, 2272: 23, 2757: 15 };
  const LEAD = [18, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2];
  const DIRS = [{ x: 128, y: 0 }, { x: 0, y: 128 }, { x: 128, y: 255 }];
  const me = A[0];
  if (mem.press && rel < mem.press.at + mem.press.len) return rel >= mem.press.at ? mem.press : 0;
  mem.press = null;
  if (me.s === 0 && me.chg === 0) mem.idle = (mem.idle || 0) + 1; else if (me.s !== 0) mem.idle = 0;
  if (rel < 2600) {
    for (let k = 1; k < A.length; k++) {
      const e = A[k];
      if (e.s === 6 && e.chg === 1 && HIT[e.m] && me.s !== 7) {
        const n = mem.trials.length, lead = LEAD[n % LEAD.length], dir = DIRS[Math.floor(n / LEAD.length) % DIRS.length];
        const o = Math.max(0, HIT[e.m] - lead);
        mem.press = { at: rel + o, len: 3, b: SQ, x: dir.x, y: dir.y };
        mem.trials.push({ kind: "deflect", rel, k, motion: e.m, o, lead, dir, myState: me.s, myMotion: me.m });
        return 0;
      }
    }
    return 0;
  }
  if ((mem.idle || 0) >= 20) {
    mem.idle = 0;
    const n = mem.trials.filter((t) => t.kind !== "deflect").length;
    const kind = ["low1", "lowmash", "grab"][n % 3];
    mem.trials.push({ kind, rel });
    if (kind === "low1") mem.press = { at: rel, len: 3, b: CI, x: 128, y: 255 };
    else if (kind === "grab") mem.press = { at: rel, len: 3, b: TR };
    else mem.mash = { from: rel, until: rel + 90 };
  }
  if (mem.mash && rel < mem.mash.until) return ((rel - mem.mash.from) % 8) < 3 ? { b: CI, x: 128, y: 255 } : { b: 0, x: 128, y: 255 };
  return 0;
})`;
const { h, state } = await runStory("calib3", 8745, 9765, { hardTimeoutMs: 600000, budgetMs: 240000 });
try {
  console.log("fight at frame", state.frames);
  await h.tryEvaluate(INSTALL_SAMPLER2, 10000);
  const res = await h.tryEvaluate(`window.__cap2(${JSON.stringify({ actors: [0, 1, 2, 3], frames: 4600, maxMs: 300000 })}, ${JSON.stringify(policy)})`, 320000);
  console.log("capture", JSON.stringify(res));
  const out = await fetchRows(h);
  fs.writeFileSync(`${OUT_DIR}/cap3.json`, JSON.stringify(out));
  await h.screenshot(`${OUT_DIR}/probe3.png`);
  console.log("wrote", out.rows.length, "rows", out.trials.length, "trials");
} finally {
  clearTimeout(watchdog);
  h.teardown();
  process.exit(0);
}
