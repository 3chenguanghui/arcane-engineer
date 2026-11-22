/* ---------------------------------------------------------------------------
 * D6 焚稿灼身 · 归因报表
 * ---------------------------------------------------------------------------
 * 输入：.seedwork/s_band_test_<n>_ash.json（由 s_visibility.js --tag=ash 产出，含原始计数）
 * 输出：
 *   1) 四口径 10 层 / F20 通关率、与基线的 Δ、95% CI（两样本未配对，保守口径）
 *   2) 最差口径与合并口径的显著性判定
 *   3) S 批 / A 批获得率（池位稀释）
 *   4) 焚稿触发统计（焚卡次数、灰烬层数、卡组剩余）
 * 用法：node tools/_d6_ash_report.js [json 路径]
 * ------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

const FILE = process.argv[2]
  || path.join(__dirname, '..', '.seedwork', 's_band_test_20000_ash.json');

const S_IDS = ['pulseShock', 'pierceLance', 'skyfall', 'hammer', 'brand', 'ward'];
const A_IDS = ['lavaFissure', 'arcanePool', 'runeOrbit', 'collapseHole', 'flameCone', 'frostRing'];

/** 百分数 */
const pct = (n, d) => (d ? (n / d) * 100 : 0);

/**
 * 两样本比例差的 95% 置信区间（未配对、正态近似，偏保守）。
 * @param {number} k1 变体1 成功数
 * @param {number} k2 变体2 成功数
 * @param {number} n 每组样本量
 * @returns {{d:number, se:number, lo:number, hi:number}} 单位：pp
 */
function diffCI(k1, k2, n) {
  const p1 = k1 / n;
  const p2 = k2 / n;
  const se = Math.sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / n) * 100;
  const d = (p2 - p1) * 100;
  return { d, se, lo: d - 1.96 * se, hi: d + 1.96 * se };
}

/**
 * 计数率（如 S 卡获得张数/局）的 95% CI，按泊松近似：SE = √count / n。
 * @param {number} c1 变体1 计数
 * @param {number} c2 变体2 计数
 * @param {number} n 每组局数
 * @returns {{d:number, se:number, lo:number, hi:number}} 单位：pp（每局张数 ×100）
 */
function countCI(c1, c2, n) {
  const se = (Math.sqrt(c1) + Math.sqrt(c2)) / n * 100;
  const d = (c2 - c1) / n * 100;
  return { d, se, lo: d - 1.96 * se, hi: d + 1.96 * se };
}

/** 格式化 Δ 与 CI */
const fmt = (r) => (r.d >= 0 ? '+' : '') + r.d.toFixed(1)
  + ' [' + r.lo.toFixed(1) + ', ' + r.hi.toFixed(1) + ']'
  + (r.lo > 0 || r.hi < 0 ? ' *' : '');

const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const RUNS = raw.runs;
const V = raw.variants;
const profiles = Object.keys(V.s1r.prof);

console.log('【D6 焚稿灼身】数据：' + FILE);
console.log('【口径】sim ' + raw.md5.sim + ' | config ' + raw.md5.config
  + ' | n=' + RUNS + '/口径 × ' + profiles.length + ' 口径 | 基线 G1（熔炉 ON）');
console.log('【样本】每组 ' + (RUNS * profiles.length) + ' 局；95% CI 为两样本未配对正态近似（保守）\n');

/* ---------- 1. 四口径 ---------- */
/* 变体名映射：以 s1r 为基线，其余全部当实验组，新增档位不用改代码 */
const NAMES = {
  s1r_ash0: '焚稿(0代价)', s1r_ash: '焚稿(0.08)',
  s1r_ash04: '焚稿(0.04)', s1r_ash06: '焚稿(0.06)', s1r_ash05: '焚稿(0.05)'
};
const variants = Object.keys(V).filter((id) => id !== 's1r').map((id) => [id, NAMES[id] || id]);
profiles.forEach((pf) => {
  console.log('== 口径：' + pf + '（n=' + RUNS + '）');
  console.log('  变体              10层%     Δ(95%CI)               F20%     Δ(95%CI)');
  const b = V.s1r.prof[pf];
  console.log('  基线              ' + pct(b.f10, RUNS).toFixed(1) + '    —                      '
    + pct(b.f20, RUNS).toFixed(1) + '    —');
  variants.forEach(([id, name]) => {
    if (!V[id]) return;
    const x = V[id].prof[pf];
    console.log('  ' + name.padEnd(16)
      + pct(x.f10, RUNS).toFixed(1).padEnd(9)
      + fmt(diffCI(b.f10, x.f10, RUNS)).padEnd(23)
      + pct(x.f20, RUNS).toFixed(1).padEnd(9)
      + fmt(diffCI(b.f20, x.f20, RUNS)));
  });
  console.log('');
});

/* ---------- 2. 最差口径 + 合并口径 ---------- */
console.log('== 最差口径（红线口径）与合并口径');
console.log('  变体             最差10层  最差F20   最差口径Δ10(95%CI)        最差口径Δ20(95%CI)');
variants.forEach(([id, name]) => {
  if (!V[id]) return;
  const worst = profiles.reduce((acc, pf) => {
    const f10 = pct(V[id].prof[pf].f10, RUNS);
    return (f10 > acc.f10) ? { pf, f10 } : acc;
  }, { pf: '', f10: -1 });
  const wb = V.s1r.prof[worst.pf];
  const wx = V[id].prof[worst.pf];
  console.log('  ' + name.padEnd(16)
    + worst.f10.toFixed(1).padEnd(10)
    + pct(wx.f20, RUNS).toFixed(1).padEnd(10)
    + fmt(diffCI(wb.f10, wx.f10, RUNS)).padEnd(26)
    + fmt(diffCI(wb.f20, wx.f20, RUNS)) + '  ← 口径 ' + worst.pf);
});
console.log('');
console.log('  合并口径（四口径池化，n=' + (RUNS * profiles.length) + '/组）');
variants.forEach(([id, name]) => {
  if (!V[id]) return;
  const sum = (vid, k) => profiles.reduce((s, pf) => s + V[vid].prof[pf][k], 0);
  const nAll = RUNS * profiles.length;
  console.log('  ' + name.padEnd(16)
    + '10层 Δ ' + fmt(diffCI(sum('s1r', 'f10'), sum(id, 'f10'), nAll)).padEnd(26)
    + 'F20 Δ ' + fmt(diffCI(sum('s1r', 'f20'), sum(id, 'f20'), nAll)));
});
console.log('\n  （* = 95% CI 不含 0，显著；否则写“不显著”）\n');

/* ---------- 3. S / A 获得率 ---------- */
console.log('== 池位稀释（分母 n=' + (RUNS * profiles.length) + ' 合计；单位：张/局）');
const table = [['s1r', '基线']].concat(variants);
table.forEach(([id, name]) => {
  if (!V[id]) return;
  const s = S_IDS.reduce((a, c) => a + V[id].cardAcq[c], 0);
  const a = A_IDS.reduce((x, c) => x + V[id].cardAcq[c], 0);
  const nAll = RUNS * profiles.length;
  console.log('  ' + name.padEnd(16)
    + 'S ' + (s / nAll * 100).toFixed(1) + 'pp/局'
    + '    A ' + (a / nAll * 100).toFixed(1) + 'pp/局'
    + '    升级 ' + (V[id].levelUps / nAll).toFixed(2) + ' 次/局'
    + '    零S ' + pct(V[id].zeroSAcq, nAll).toFixed(1) + '%');
});
const nAll = RUNS * profiles.length;
const sBase = S_IDS.reduce((a, c) => a + V.s1r.cardAcq[c], 0);
const aBase = A_IDS.reduce((x, c) => x + V.s1r.cardAcq[c], 0);
variants.forEach(([id, name]) => {
  if (!V[id]) return;
  const s = S_IDS.reduce((a, c) => a + V[id].cardAcq[c], 0);
  const a = A_IDS.reduce((x, c) => x + V[id].cardAcq[c], 0);
  console.log('  ' + name.padEnd(16)
    + 'S Δ ' + fmt(countCI(sBase, s, nAll)).padEnd(26)
    + 'A Δ ' + fmt(countCI(aBase, a, nAll)));
});
console.log('');

/* ---------- 4. 焚稿触发 ---------- */
console.log('== 焚稿触发（仅焚稿变体）');
variants.forEach(([id, name]) => {
  if (!V[id] || !V[id].ashBurns) return;
  const x = V[id];
  console.log('  ' + name.padEnd(16)
    + '触发局 ' + pct(x.ashRuns, x.runs).toFixed(1) + '%'
    + '｜焚 ' + (x.ashBurns / x.runs).toFixed(2) + ' 张/局'
    + '｜末态灰烬 ' + (x.ashStacks / x.runs).toFixed(2) + ' 层'
    + '｜触发局卡组 ' + (x.ashDeck / x.ashRuns).toFixed(2) + ' 张');
});
console.log('\n判据：CI 含 0 → “不显著”；CI 全负 → “有害”。');
