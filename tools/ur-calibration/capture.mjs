// Per-frame EE RAM capture for frame-data calibration.
//
// The engine runs the game in a pthread worker on shared memory, so the page's
// main thread can read EE RAM while the game runs. The sampler below spins on
// MessageChannel yields for a bounded time, and on every new game frame
// (Module._ps2web_frames) copies a window of each actor struct and applies the
// scripted pad input for that frame. Presses are therefore placed on exact
// game frames, and every sample says which frame it belongs to.

export const REGION = { lo: 0x8800, hi: 0x9800 };

/** Install the sampler in the page. */
export const INSTALL_SAMPLER = `(() => {
  window.__capRun = async (cfg) => {
    const R = window.__ur, M = Module;
    const lo = ${REGION.lo}, hi = ${REGION.hi}, n = hi - lo;
    const ptrs = cfg.actors.map((i) => R.u32(0x59d168 + i * 4));
    const out = { ptrs, frames: [], pads: [], hp: [], data: cfg.actors.map(() => []) };
    const f0 = M._ps2web_frames();
    let last = f0, padNow = null;
    const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
    const t0 = performance.now();
    while (performance.now() - t0 < cfg.maxMs) {
      const f = M._ps2web_frames();
      if (f !== last) {
        last = f;
        const rel = f - f0;
        // scripted input: the latest entry with at <= rel, per slot
        for (const s of cfg.slots) {
          let want = { b: 0, x: 128, y: 128 };
          for (const e of cfg.script) if (e.slot === s && e.at <= rel && rel < e.at + e.len) want = e;
          const key = s + ":" + want.b + ":" + want.x + ":" + want.y;
          if (!padNow || padNow[s] !== key) { (padNow = padNow || {})[s] = key; window.setVirtualPad(s, want.b, want.x ?? 128, want.y ?? 128); }
        }
        out.frames.push(rel);
        out.pads.push(Object.values(padNow || {}).join("|"));
        out.hp.push(ptrs.map((p) => R.u32(p + 0x8c50)));
        ptrs.forEach((p, k) => {
          const a = R.u8; const buf = new Array(n);
          for (let i = 0; i < n; i++) buf[i] = a(p + lo + i);
          out.data[k].push(buf);
        });
        if (rel >= cfg.frames) break;
      }
      await yieldNow();
    }
    for (const s of cfg.slots) window.setVirtualPad(s, 0, 128, 128);
    window.__cap = out;
    return { samples: out.frames.length, first: out.frames[0], last: out.frames[out.frames.length - 1], ptrs };
  };
  return true;
})()`;

/** Pull window.__cap out of the page in bounded chunks. */
export async function fetchCapture(h) {
  const meta = await h.tryEvaluate(`(() => { const c = window.__cap; return c ? { n: c.frames.length, k: c.data.length } : null; })()`, 10000);
  if (!meta) return null;
  const cap = { frames: [], pads: [], hp: [], data: Array.from({ length: meta.k }, () => []) };
  const step = 20;
  for (let i = 0; i < meta.n; i += step) {
    const part = await h.tryEvaluate(`(() => { const c = window.__cap; const s = ${i}, e = ${i + step};
      return { frames: c.frames.slice(s, e), pads: c.pads.slice(s, e), hp: c.hp.slice(s, e),
               data: c.data.map((d) => d.slice(s, e).map((b) => btoa(String.fromCharCode.apply(null, b)))) }; })()`, 30000);
    cap.frames.push(...part.frames);
    cap.pads.push(...part.pads);
    cap.hp.push(...part.hp);
    part.data.forEach((d, k) => cap.data[k].push(...d));
  }
  return cap;
}
