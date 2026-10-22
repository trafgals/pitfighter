const c = require(process.argv[2] || './cap1.json');
const F = c.frames;
const rle = arr => { const o = []; let p = null, n = 0, st = 0; arr.forEach((v, i) => { if (v !== p) { if (p !== null) o.push(`${F[st]}:${p}x${n}`); p = v; n = 1; st = i; } else n++; }); o.push(`${F[st]}:${p}x${n}`); return o; };
const fields = [[0x8d40,'u16','motion'],[0x8d44,'u16','state'],[0x8d64,'u16','idle?'],[0x8e28,'u16','hp'],[0x8ed0,'u16','hitcount'],[0x89a4,'u32','pidx'],[0x88f0,'u16','88f0']];
c.data.forEach((dd, k) => {
  const d = dd.map(s => Buffer.from(s, 'base64'));
  console.log('== actor', k, 'ptr', c.ptrs ? c.ptrs[k] : '');
  for (const [o, t, n] of fields) { const v = d.map(b => t === 'u16' ? b.readUInt16LE(o - 0x8800) : b.readUInt32LE(o - 0x8800)); console.log(' ', n, rle(v).join(' ').slice(0, 500)); }
});
