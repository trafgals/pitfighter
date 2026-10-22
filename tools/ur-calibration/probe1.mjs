// Stage 1: reach the first story fight on the retail engine, then record the
// player's actor struct frame by frame while pressing each face button once,
// well away from the enemies. Writes calib/cap1.json for analysis.
import fs from "fs";
const OUT_DIR = process.env.UR_CALIB_OUT || "C:/code/trafgals/urp-notes/calib";
import { runStory, snapshot, sleep, B } from "./story_lib.mjs";
import { INSTALL_SAMPLER, fetchCapture } from "./capture.mjs";

const watchdog = setTimeout(() => { console.error("TIMEOUT probe1"); process.exit(1); }, 420000);
const { h, state } = await runStory("calib", 8741, 9761, { hardTimeoutMs: 400000, budgetMs: 240000 });
try {
  console.log("fight at frame", state.frames, "actors", state.actors.filter((a) => a.active).map((a) => `${a.slot}:c${a.charid} hp${a.hp} (${a.x?.toFixed(1)},${a.z?.toFixed(1)})`).join(" "));
  await h.tryEvaluate(INSTALL_SAMPLER, 10000);
  const script = [];
  const buttons = [["SQUARE", B.SQUARE], ["CROSS", B.CROSS], ["TRIANGLE", B.TRIANGLE], ["CIRCLE", B.CIRCLE]];
  buttons.forEach(([, bit], i) => script.push({ slot: 0, at: 40 + i * 120, len: 4, b: bit }));
  const res = await h.tryEvaluate(`window.__capRun(${JSON.stringify({ actors: [0, 1, 2, 3], slots: [0], script, frames: 40 + 4 * 120, maxMs: 20000 })})`, 30000);
  console.log("capture", JSON.stringify(res));
  const cap = await fetchCapture(h);
  cap.script = script;
  cap.buttons = buttons.map((b) => b[0]);
  cap.before = state;
  cap.after = await snapshot(h);
  fs.writeFileSync(`${OUT_DIR}/cap1.json`, JSON.stringify(cap));
  await h.screenshot(`${OUT_DIR}/probe1.png`);
  console.log("wrote cap1.json", cap.frames.length, "frames");
} finally {
  clearTimeout(watchdog);
  h.teardown();
  process.exit(0);
}
