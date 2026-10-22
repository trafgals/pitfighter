// Lean per-frame sampler driven by an in-page policy. Each frame it reads the
// fields found in cap1 for every actor (motion id +0x8d40, state +0x8d44,
// HP +0x8e28, motion-changed latch +0x88f0, hits-taken +0x8ed0) and lets the
// policy pick player 1's pad state. Rows: [rel, pad, ...per actor m,s,hp,chg,hc].
export const INSTALL_SAMPLER2 = `(() => {
  window.__cap2 = async (cfg, policySrc) => {
    const R = window.__ur, M = Module;
    const policy = eval(policySrc);
    const ptrs = cfg.actors.map((i) => R.u32(0x59d168 + i * 4));
    const rows = [], mem = { trials: [] };
    const f0 = M._ps2web_frames();
    let last = f0, padKey = "";
    const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
    const t0 = performance.now();
    while (performance.now() - t0 < cfg.maxMs) {
      const f = M._ps2web_frames();
      if (f !== last) {
        last = f;
        const rel = f - f0;
        const A = ptrs.map((p) => ({ m: R.u16(p + 0x8d40), s: R.u16(p + 0x8d44), hp: R.u16(p + 0x8e28), chg: R.u16(p + 0x88f0), hc: R.u16(p + 0x8ed0) }));
        let out = policy(rel, A, mem); if (typeof out === "number") out = { b: out };
        const b = out.b | 0, x = out.x ?? 128, y = out.y ?? 128;
        const key = b + ":" + x + ":" + y;
        if (key !== padKey) { padKey = key; window.setVirtualPad(0, b, x, y); }
        const row = [rel, b + (x !== 128 || y !== 128 ? 65536 * (1 + (x >> 6) * 4 + (y >> 6)) : 0)];
        for (const a of A) row.push(a.m, a.s, a.hp, a.chg, a.hc);
        rows.push(row);
        if (rel >= cfg.frames) break;
      }
      await yieldNow();
    }
    window.setVirtualPad(0, 0, 128, 128);
    window.__rows = rows; window.__trials = mem.trials;
    return { n: rows.length, last: rows.length ? rows[rows.length - 1][0] : -1, trials: mem.trials.length };
  };
  return true;
})()`;

export async function fetchRows(h) {
  const n = await h.tryEvaluate(`window.__rows.length`, 10000);
  const rows = [];
  for (let i = 0; i < n; i += 500) rows.push(...(await h.tryEvaluate(`window.__rows.slice(${i}, ${i + 500})`, 30000)));
  const trials = await h.tryEvaluate(`window.__trials`, 10000);
  return { rows, trials };
}
