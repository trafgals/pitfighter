// Find fields in actor 0 that react to each scripted press.
const c = require(process.argv[3] || './cap1.json');
const k = +(process.argv[2] || 0);
const d = c.data[k].map(s => Buffer.from(s, 'base64'));
const F = c.frames;
const idx = rel => F.findIndex(f => f >= rel);
const presses = c.script.map(s => s.at);
const rle = arr => { const o = []; let p = null, n = 0, st = 0; arr.forEach((v, i) => { if (v !== p) { if (p !== null) o.push(`${F[st]}:${p}x${n}`); p = v; n = 1; st = i; } else n++; }); o.push(`${F[st]}:${p}x${n}`); return o; };
const res = [];
for (let off = 0; off + 4 <= d[0].length; off += 2) {
  const u16 = d.map(b => b.readUInt16LE(off));
  let hits = 0;
  for (const p of presses) {
    const pre = u16.slice(idx(p - 10), idx(p)); const post = u16.slice(idx(p), idx(p + 8));
    const idle = new Set(pre);
    if (idle.size === 1 && post.some(v => !idle.has(v))) hits++;
  }
  if (hits >= 3) { const r = rle(u16); if (r.length < 60) res.push([(0x8800 + off).toString(16), hits, r.join(' ')]); }
}
res.forEach(r => console.log(r[0], r[1], r[2].slice(0, 600)));
