/**
 * 剪影 A/B 判据对比（读两份 sil-*-median.json）
 * ------------------------------------------------------------------
 * 输出 6 个跨族代表对 + 玩家 vs 任意敌人的剪影距离变化，
 * 并按"任一项 < 基线 × 0.90 即回退"给出 GATE 结论。
 * 用法：node _probe/sil_compare.js <基线json> <改动后json>
 */
const fs = require('fs');

const [basePath, afterPath] = process.argv.slice(2);
if (!basePath || !afterPath) { console.error('用法: node _probe/sil_compare.js base.json after.json'); process.exit(2); }
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));

/** 剪影距离（与 tools/arcane_identity.js 同一公式） */
function silDist(a, b) {
  return Math.abs(a.aspect - b.aspect) + Math.abs(a.complexity - b.complexity) / 3 + Math.abs(a.fill - b.fill);
}

/** 取数：player 用各自文件里的 5 次中位数 */
function metricsOf(doc) {
  const m = {};
  m.player = doc.player;
  Object.keys(doc.enemy).forEach((k) => { m[k] = doc.enemy[k]; });
  return m;
}
const B = metricsOf(base);
const A = metricsOf(after);
const REPS = ['assembler', 'runesprite', 'stalker'];

/** 收集所有判据项：[名称, 距离向量的两端] */
function build(m) {
  const rows = [];
  REPS.forEach((r) => rows.push({ pair: 'player-' + r, a: m.player, b: m[r] }));
  rows.push({ pair: 'assembler-runesprite', a: m.assembler, b: m.runesprite });
  rows.push({ pair: 'assembler-stalker', a: m.assembler, b: m.stalker });
  rows.push({ pair: 'runesprite-stalker', a: m.runesprite, b: m.stalker });
  /* 玩家 vs 任意敌人最小值 */
  let min = Infinity; let worst = null;
  Object.keys(m).forEach((k) => {
    if (k === 'player') return;
    const d = silDist(m.player, m[k]);
    if (d < min) { min = d; worst = k; }
  });
  rows.push({ pair: 'player-vs-any', d: min, worst });
  return rows.map((r) => ({ pair: r.pair, d: r.d != null ? r.d : silDist(r.a, r.b), worst: r.worst }));
}
const rb = build(B);
const ra = build(A);
console.log('pair'.padEnd(24) + 'baseline   after     ratio');
let allPass = true;
ra.forEach((row, i) => {
  const before = rb[i].d;
  const ratio = before ? row.d / before : NaN;
  const pass = ratio >= 0.9;
  if (!pass) allPass = false;
  console.log(row.pair.padEnd(24) + before.toFixed(3).padEnd(11) + row.d.toFixed(3).padEnd(10) + Math.round(ratio * 100) + '%' + (row.worst ? ' (' + row.worst + ')' : '') + (pass ? '' : '  <<< FAIL'));
});
console.log('\nGATE: ' + (allPass ? 'PASS（全部 ≥ 基线 90%）' : 'ROLLBACK（存在 < 基线 90% 的项）'));
process.exit(allPass ? 0 : 3);
