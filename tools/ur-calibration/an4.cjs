// Analyse cap2.json: dodge windows, strike startup and hitstun.
const { rows, trials } = require(process.argv[2] || './cap2.json');
const NA = (rows[0].length - 2) / 5;
const at = new Map(rows.map((r, i) => [r[0], i]));
const g = (i, k, f) => rows[i][2 + 5 * k + f]; // f: 0 m,1 s,2 hp,3 chg,4 hc
const idxFrom = (rel) => { for (let i = 0; i < rows.length; i++) if (rows[i][0] >= rel) return i; return rows.length - 1; };
const seq = (k, i0, n) => { const o = []; let p = null; for (let i = i0; i < Math.min(rows.length, i0 + n); i++) { const v = `${g(i, k, 0)}/${g(i, k, 1)}`; if (v !== p) { o.push(`${rows[i][0] - rows[i0][0]}:${v}`); p = v; } } return o.join(' '); };
const gaps = rows.slice(1).filter((r, i) => r[0] !== rows[i][0] + 1).length;
console.log('rows', rows.length, 'frame gaps', gaps, 'actors', NA);
// --- dodge trials
const byMotion = {};
for (const t of trials.filter((t) => t.kind === 'dodge')) {
  const i0 = idxFrom(t.rel);
  let hit = null;
  for (let i = i0; i < Math.min(rows.length, i0 + 45); i++) if (g(i, 0, 4) > g(i0, 0, 4)) { hit = rows[i][0] - t.rel; break; }
  // player motion right after the press
  const ip = idxFrom(t.rel + t.o);
  const pm = seq(0, ip, 30);
  (byMotion[t.motion] = byMotion[t.motion] || []).push({ o: t.o, hit, my: `${t.myMotion}/${t.myState}`, pm, en: seq(t.k, i0, 40) });
}
for (const [m, ts] of Object.entries(byMotion)) {
  console.log(`\nenemy motion ${m}: ${ts.length} trials`);
  ts.sort((a, b) => a.o - b.o).forEach((t) => console.log(`  press@+${t.o} hit@${t.hit} me-before ${t.my} | me-after ${t.pm.slice(0, 90)} | enemy ${t.en.slice(0, 80)}`));
}
// --- strikes
for (const t of trials.filter((t) => t.kind !== 'dodge')) {
  const i0 = idxFrom(t.rel);
  let ms = null; for (let i = i0; i < Math.min(rows.length, i0 + 10); i++) if (g(i, 0, 3) === 1) { ms = rows[i][0]; break; }
  const drops = [];
  for (let i = i0 + 1; i < Math.min(rows.length, i0 + 150); i++) for (let k = 1; k < NA; k++) if (g(i, k, 2) < g(i - 1, k, 2)) drops.push(`a${k}@${rows[i][0] - t.rel}(-${g(i - 1, k, 2) - g(i, k, 2)})`);
  let victim = null; const d0 = drops[0]; if (d0) victim = +d0.slice(1, d0.indexOf('@'));
  console.log(`\n${t.kind} @${t.rel} motionStart +${ms === null ? '?' : ms - t.rel} drops ${drops.join(' ')}`);
  console.log('   me     ', seq(0, i0, 150).slice(0, 200));
  if (victim) console.log('   victim ', seq(victim, i0, 150).slice(0, 200));
}
