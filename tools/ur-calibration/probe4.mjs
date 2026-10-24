// Stage 4: hit reactions. Player 1 attacks the first story fight's enemies with
// every kind of blow it has - mashed neutral strings (light hits, then the
// finisher's knockdown and the get-up), mashed low strings (the sweep), stick
// strikes in each direction, and grapples with a throw - while the sampler
// records every actor's motion and state, so an4/react analysis can time each
// reaction the victims play: light, heavy, knockdown, floor, get-up.
import fs from "fs";
const OUT_DIR = process.env.UR_CALIB_OUT || "C:/code/trafgals/urp-notes/calib";
import { runStory, B } from "./story_lib.mjs";
import { INSTALL_SAMPLER2, fetchRows } from "./capture2.mjs";

const watchdog = setTimeout(() => { console.error("TIMEOUT probe4"); process.exit(1); }, 620000);
const policy = `((rel, A, mem) => {
  const CI = ${B.CIRCLE}, TR = ${B.TRIANGLE};
  const me = A[0];
  if (me.s === 0 && me.chg === 0) mem.idle = (mem.idle || 0) + 1; else if (me.s !== 0) mem.idle = 0;
  // a mash: the button pressed 3 frames out of every 8, with the stick held
  if (mem.mash && rel < mem.mash.until) return ((rel - mem.mash.from) % 8) < 3 ? { b: mem.mash.b, x: mem.mash.x, y: mem.mash.y } : { b: 0, x: mem.mash.x, y: mem.mash.y };
  mem.mash = null;
  if ((mem.idle || 0) < 24) return 0;
  mem.idle = 0;
  const KINDS = [
    ["string", CI, 128, 128, 80],
    ["low", CI, 128, 255, 90],
    ["fwd", CI, 128, 0, 40],
    ["grab-throw", TR, 128, 128, 60],
    ["string", CI, 128, 128, 80],
    ["side", CI, 0, 128, 40],
    ["grab-strike", TR, 128, 128, 0],
  ];
  const n = mem.trials.length, [kind, b, x, y, len] = KINDS[n % KINDS.length];
  mem.trials.push({ kind, rel });
  if (kind === "grab-strike") mem.mash = { from: rel, until: rel + 70, b: TR, x, y, then: CI };
  else mem.mash = { from: rel, until: rel + len, b, x, y };
  return 0;
})`;
const { h, state } = await runStory("calib4", 8745, 9765, { hardTimeoutMs: 600000, budgetMs: 240000 });
try {
  console.log("fight at frame", state.frames);
  await h.tryEvaluate(INSTALL_SAMPLER2, 10000);
  const res = await h.tryEvaluate(`window.__cap2(${JSON.stringify({ actors: [0, 1, 2, 3], frames: 5400, maxMs: 300000 })}, ${JSON.stringify(policy)})`, 320000);
  console.log("capture", JSON.stringify(res));
  const out = await fetchRows(h);
  fs.writeFileSync(`${OUT_DIR}/cap4.json`, JSON.stringify(out));
  await h.screenshot(`${OUT_DIR}/probe4.png`);
  console.log("wrote", out.rows.length, "rows", out.trials.length, "trials");
} finally {
  clearTimeout(watchdog);
  h.teardown();
  process.exit(0);
}
