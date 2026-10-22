const c = require(process.argv[3] || './cap1.json');
const k = +(process.argv[2] || 0);
const d = c.data[k].map(s => Buffer.from(s, 'base64'));
const F = c.frames;
const rle = arr => { const o = []; let p = null, n = 0, st = 0; arr.forEach((v, i) => { if (v !== p) { if (p !== null) o.push(`${F[st]}:${p}x${n}`); p = v; n = 1; st = i; } else n++; }); o.push(`${F[st]}:${p}x${n}`); return o; };
for (let off = 0; off + 4 <= d[0].length; off += 4) {
  const u = d.map(b => b.readUInt32LE(off));
  const r = rle(u);
  if (r.length > 1 && r.length < 40) console.log((0x8800 + off).toString(16), r.join(' ').slice(0, 400));
}
