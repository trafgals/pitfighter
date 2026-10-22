const { rows, trials } = require(process.argv[2] || './cap3.json');
const g = (i, k, f) => rows[i][2 + 5 * k + f];
const idxFrom = (rel) => rows.findIndex((r) => r[0] >= rel);
const seq = (k, i0, n) => { const o = []; let p = null; for (let i = i0; i < Math.min(rows.length, i0 + n); i++) { const v = `${g(i, k, 0)}/${g(i, k, 1)}`; if (v !== p) { o.push(`${rows[i][0] - rows[i0][0]}:${v}`); p = v; } } return o.join(' '); };
for (const t of trials) {
  const i0 = idxFrom(t.rel); if (i0 < 0) continue;
  const ev = [];
  for (let i = i0 + 1; i < Math.min(rows.length, i0 + 90); i++) for (let k = 0; k < 4; k++) if (g(i, k, 2) < g(i - 1, k, 2)) ev.push(`a${k}@${rows[i][0] - t.rel}(-${g(i - 1, k, 2) - g(i, k, 2)})`);
  if (t.kind === 'deflect') console.log(`deflect m${t.motion} lead${t.lead} dir${t.dir.x},${t.dir.y} press+${t.o} me-before ${t.myMotion}/${t.myState} | dmg ${ev.join(' ')}\n   me ${seq(0, i0, 70)}\n   en ${seq(t.k, i0, 70)}`);
  else { console.log(`${t.kind} @${t.rel} dmg ${ev.join(' ')}\n   me ${seq(0, i0, 120)}`); for (let k = 1; k < 4; k++) if (ev.some((e) => e.startsWith('a' + k))) console.log(`   a${k} ${seq(k, i0, 120)}`); }
}
