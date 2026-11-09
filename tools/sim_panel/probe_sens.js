/* ============================================================================
 * 灵敏度探针：精英房"出现频率"口径对基线的影响（第三处失真）
 * ----------------------------------------------------------------------------
 * 用法：node tools/sim_panel/probe_sens.js --runs 10000
 *
 * 口径 A：按权重随机出精英房（历史口径，默认）
 * 口径 B：对齐主文件 L17916"第 2 层起至少 1 间精英房"（eliteGuarantee）
 *
 * 目的：确认 E1 / W1+W2 在两个口径下是否都成立，避免方案只在某个口径下好看。
 * ============================================================================ */
'use strict';

const C = require('./config');
const sim = require('./sim');

const N = (() => {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) if (a[i] === '--runs') return Math.max(100, parseInt(a[i + 1], 10));
  return 10000;
})();

const W12 = { eliteTune: { fromFloor: 13, mixNormal: 2, clearKills: 5 } };

const SCENARIOS = [
  { name: 'A 基线（按权重）', ov: {} },
  { name: 'B 基线（保底精英）', ov: { eliteGuarantee: true } },
  { name: 'A + E1', ov: { startLevels: 1 } },
  { name: 'B + E1', ov: { eliteGuarantee: true, startLevels: 1 } },
  { name: 'A + W1+W2', ov: W12 },
  { name: 'B + W1+W2', ov: Object.assign({ eliteGuarantee: true }, W12) }
];

/**
 * 跑一个场景并汇总关键指标。
 * @param {Object} ov 覆盖参数
 * @returns {Object} 指标
 */
function run(ov) {
  const agg = sim.createAgg();
  const elite = {};
  const ids = ['novice', 'veteran', 'bot'];
  for (let i = 0; i < N; i += 1) {
    const r = sim.runOne(sim.runSeed(C.SIM_PARAMS.baseSeed, i), C.PROFILES[ids[i % 3]], 'normal', ov);
    sim.addRun(agg, r);
    (r.eliteDeaths || []).forEach((d) => { elite[d.floor] = (elite[d.floor] || 0) + 1; });
  }
  let avg = 0;
  for (let f = 1; f <= 20; f += 1) avg += agg.cleared[f] / N;
  return {
    pass5: agg.cleared[5] / N,
    avgFloor: avg,
    reach20: agg.reached[20] / N,
    deathsF2: agg.deathFloor[2] || 0,
    deathsF3: agg.deathFloor[3] || 0,
    eliteF19: elite[19] || 0,
    eliteF20: elite[20] || 0,
    eliteAll: Object.keys(elite).reduce((s, k) => s + elite[k], 0)
  };
}

console.log('=== 精英房频率口径灵敏度（' + N + ' 局 normal）===');
console.log('场景 | 5层通关 | 平均层 | F20到达 | F2死 | F3死 | F19精英死 | F20精英死 | 精英总死');
SCENARIOS.forEach((s) => {
  const r = run(s.ov);
  console.log([
    s.name.padEnd(16),
    (r.pass5 * 100).toFixed(1) + '%',
    r.avgFloor.toFixed(2),
    (r.reach20 * 100).toFixed(1) + '%',
    r.deathsF2,
    r.deathsF3,
    r.eliteF19,
    r.eliteF20,
    r.eliteAll
  ].join(' | '));
});
