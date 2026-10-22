// The movesets decoded from Urban Reign's executable
// (docs/calibration/urban-reign-movesets.json, tools/ur-calibration/movesets.cjs)
// against the timings measured frame by frame in its EE RAM
// (docs/calibration/urban-reign-frames.json). If the decoder reads the records
// wrong, these numbers stop lining up.
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import ur from "../docs/calibration/urban-reign-frames.json";
import data from "../docs/calibration/urban-reign-movesets.json";

type Action = { id: number; endFrame: number; state: number; hits: { first: number; raw: string }[]; branches: { to: number; from: number; until: number }[] };
const actions = data.actions as unknown as Record<string, Action>;
const act = (id: number | string) => {
  const a = actions[String(id)];
  if (!a) throw new Error(`action ${id} is not in the dump`);
  return a;
};
/** frames the action lasts: endFrame is its last frame */
const length = (id: number | string) => act(id).endFrame + 1;
const range = (v: number | number[]) => (Array.isArray(v) ? v : [v, v]);
/**
 * A hit connects once the swing reaches the target: from its first active frame
 * up to 2 frames later, or later still within the swing (hit field [2]) when the
 * target stands further away.
 */
const HIT_REACH = 2;

describe("Urban Reign movesets decoded from the executable", () => {
  it("Brad's moveset starts the neutral string the actor played in EE RAM", () => {
    const brad = data.movesets[0];
    expect(brad.roots[0]).toBe(ur.neutralString.motions[0]);
    const [a, b, c, d] = ur.neutralString.motions;
    for (const [from, to] of [[a, b], [b, c], [c, d]]) expect(act(from).branches.map((x) => x.to)).toContain(to);
    expect(act(d).branches).toEqual([]); // the finisher ends the string
    for (const id of ur.neutralString.motions) expect(brad.actions).toContain(id);
  });

  it("every measured hit lands inside the hit record's swing, mostly on its first frames", () => {
    const measured: [number | string, number | number[]][] = [
      ...ur.neutralString.motions.map((m, i) => [m, ur.neutralString.hitFrame[i]] as [number, number]),
      ...ur.lowStrikes.map((l) => [l.motion, l.hitFrame] as [number, number | number[]]),
      ...Object.entries(ur.enemyStrikeHitFrames),
    ];
    for (const [id, frames] of measured) {
      const a = act(id);
      expect(a.state, `action ${id}`).toBe(6);
      expect(a.hits.length, `action ${id}`).toBeGreaterThan(0);
      const first = a.hits[0].first;
      const swingEnd = Math.max(first + HIT_REACH, Number(a.hits[0].raw.split(" ")[2]));
      const [lo, hi] = range(frames);
      expect(lo - first, `action ${id} hit ${lo}, record ${first}`).toBeGreaterThanOrEqual(0);
      expect(lo - first, `action ${id} hit ${lo}, record ${first}`).toBeLessThanOrEqual(HIT_REACH);
      expect(hi, `action ${id} hit ${hi}, swing to ${swingEnd}`).toBeLessThanOrEqual(swingEnd);
    }
  });

  it("the actions that ran to their end last exactly as long as the record says", () => {
    expect(range(ur.neutralString.singleTotal)[0]).toBeLessThanOrEqual(length(1388));
    expect(range(ur.neutralString.singleTotal)[1]).toBeGreaterThanOrEqual(length(1388));
    expect(length(ur.dodge.motion)).toBe(ur.dodge.total);
    expect(length(19)).toBe(ur.hitReaction.light);
    expect(length(3571)).toBe(ur.grapple.hold);
    const inRange = (id: number, [lo, hi]: number[]) => {
      expect(length(id), `action ${id}`).toBeGreaterThanOrEqual(lo);
      expect(length(id), `action ${id}`).toBeLessThanOrEqual(hi);
    };
    for (const id of ur.deflection.defenderMotion.motions) inRange(id, ur.deflection.defenderMotion.total);
    for (const id of ur.deflection.attackerMotion.motions) inRange(id, ur.deflection.attackerMotion.total);
    expect(length(2214)).toBe(range(ur.lowStrikes[1].total as number[])[1]);
  });

  it("an action cut short never ran longer than its record", () => {
    // knockdowns, evades and grapple follow-ups end early when the next action takes over
    const cut: [number, number | number[]][] = [
      [ur.neutralString.motions[3], ur.neutralString.finisherTotal],
      [ur.lowStrikes[0].motion, ur.lowStrikes[0].total as number],
      ...ur.dodge.evadeMotion.motions.map((m) => [m, ur.dodge.evadeMotion.total] as [number, number[]]),
      [3568, ur.grapple.holdFollowUp],
      [168, ur.knockdown.getUp],
    ];
    for (const [id, total] of cut) expect(range(total)[1], `action ${id}`).toBeLessThanOrEqual(length(id));
  });

  it("the string's follow-ups open after each hit, which spaces the hits as measured", () => {
    const m = ur.neutralString.motions;
    const gaps = m.slice(1).map((next, i) => {
      const prev = act(m[i]);
      const branch = prev.branches.find((b) => b.to === next)!;
      expect(branch.from).toBeGreaterThan(prev.hits[0].first); // the window opens after the hit
      // earliest possible gap: take the branch on its first frame
      return branch.from - prev.hits[0].first + act(next).hits[0].first;
    });
    gaps.forEach((g, i) => {
      expect(ur.neutralString.hitGaps[i] - g).toBeGreaterThanOrEqual(-1);
      expect(ur.neutralString.hitGaps[i] - g).toBeLessThanOrEqual(3);
    });
  });

  it("covers every moveset, and only strike actions carry hits", () => {
    expect(data.movesets.length).toBe(128);
    for (const a of Object.values(actions)) if (a.hits.length) expect(a.state).toBe(6);
    const distinct = data.movesets.filter((s) => s.sameAs === null);
    expect(distinct.length).toBeGreaterThan(60);
    for (const s of distinct) for (const id of s.actions) expect(actions[String(id)]).toBeDefined();
  });

  const pitfighter = process.env.UR_PITFIGHTER || path.resolve(__dirname, "../../urban-reign-pitfighter");
  it.skipIf(!fs.existsSync(path.join(pitfighter, ".git")))("the committed dump is what the decoder reads from the executable", () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ur-movesets-")), "movesets.json");
    execFileSync(process.execPath, [path.resolve(__dirname, "../tools/ur-calibration/movesets.cjs"), "", out], {
      env: { ...process.env, UR_PITFIGHTER: pitfighter },
      timeout: 60000,
      stdio: "pipe",
    });
    // git may check the committed file out with CRLF line ends
    const text = (f: string) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    const fresh = text(out);
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
    expect(fresh).toBe(text(path.resolve(__dirname, "../docs/calibration/urban-reign-movesets.json")));
  }, 70000);
});
