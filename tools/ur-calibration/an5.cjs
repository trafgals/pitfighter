const { rows, trials } = require(process.argv[2] || './cap2.json');
const g = (i, k, f) => rows[i][2 + 5 * k + f];
const idxFrom = (rel) => rows.findIndex((r) => r[0] >= rel);
for (const t of trials.filter((t) => t.kind === 'dodge')) {
  const i0 = idxFrom(t.rel), lines = [];
  let p = '';
  for (let i = i0; i < Math.min(rows.length, i0 + 70); i++) {
    const v = [0, t.k].map((k) => `${g(i, k, 0)}/${g(i, k, 1)} hp${g(i, k, 2)} hc${g(i, k, 4)}`).join(' | ') + (rows[i][1] ? ' SQ' : '');
    if (v !== p) { lines.push(`${rows[i][0] - t.rel}: ${v}`); p = v; }
  }
  console.log(`\n# enemy a${t.k} motion ${t.motion} press +${t.o}\n  ` + lines.join('\n  '));
}
