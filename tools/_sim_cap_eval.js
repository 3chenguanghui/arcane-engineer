/* ============================================================================
 * 首领血量上限方案评估（C1-11 · 2026-11-08）
 * ----------------------------------------------------------------------------
 * 目的：当前 BOSS_CONFIG.hpCap = 3200，但 F1 的自然血量已是 1250×2.6 = 3250，
 *       所以从第 1 层起就被压平在 3200（区末 3680），深层难度曲线被削平。
 *       这里用同一套 10000 局模型（4000 局 × 4 方案，固定种子）对比：
 *         base  当前 3200 硬上限
 *         A     把硬上限抬到 4800（F3 起全部 4800）
 *         B1    按层分段：cap(f) = 3200 × (1 + 0.04 × (f-1))，F20 = 5632
 *         B2    按层分段：cap(f) = 3200 × (1 + 0.06 × (f-1))，F20 = 6848
 * 用法：node tools/_sim_cap_eval.js
 * ============================================================================ */
'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const C = require('./sim_panel/config');
const sim = require('./sim_panel/sim');

const RUNS = 4000;
const WORKERS = 4;   // 降负载纪律：16 → 4
const SEED = C.SIM_PARAMS.baseSeed;

/**
 * 按层生成上限表
 * @param {Function} fn (floor) => cap
 * @returns {Object} {1: cap, ...20: cap}
 */
function capTable(fn) {
  const t = {};
  for (let f = 1; f <= 20; f += 1) t[f] = Math.round(fn(f));
  return t;
}

const SCENARIOS = [
  { id: 'base', label: '当前 3200 硬上限', overrides: {} },
  { id: 'A', label: '硬上限抬到 4800', overrides: { bossCapByFloor: capTable(() => 4800) } },
  { id: 'B1', label: '分段 +4%/层（F20 5632）', overrides: { bossCapByFloor: capTable((f) => 3200 * (1 + 0.04 * (f - 1))) } },
  { id: 'B2', label: '分段 +6%/层（F20 6848）', overrides: { bossCapByFloor: capTable((f) => 3200 * (1 + 0.06 * (f - 1))) } }
];

/**
 * 跑一个方案（切成 WORKERS 块并行）
 * @param {Object} scenario 方案
 * @returns {Promise<Object>} 聚合摘要
 */
function runScenario(scenario) {
  const per = Math.floor(RUNS / WORKERS);
  const jobs = [];
  for (let i = 0; i < WORKERS; i += 1) {
    jobs.push({
      runs: i === WORKERS - 1 ? RUNS - per * i : per,
      startIndex: per * i,
      baseSeed: SEED,
      difficulty: 'normal',
      overrides: scenario.overrides
    });
  }
  return Promise.all(jobs.map((job) => new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'sim_panel', 'worker.js'));
    w.once('message', (msg) => { resolve(msg); w.terminate(); });
    w.once('error', reject);
    w.postMessage(job);
  }))).then((results) => {
    const agg = sim.createAgg();
    results.forEach((r) => sim.mergeAgg(agg, r.overall));
    const vet = sim.createAgg();
    results.forEach((r) => sim.mergeAgg(vet, r.profiles.veteran));
    const nov = sim.createAgg();
    results.forEach((r) => sim.mergeAgg(nov, r.profiles.novice));
    return {
      id: scenario.id,
      label: scenario.label,
      pass5: agg.completed5 / agg.runs,
      pass10: agg.cleared[10] / agg.runs,
      avgFloor: agg.reached.reduce((s, v, i) => s + (i ? agg.cleared[i] / agg.runs : 0), 0),
      bossDeathShare: agg.deathRoom.boss / (agg.deathRoom.battle + agg.deathRoom.elite + agg.deathRoom.boss),
      veteranPass5: vet.completed5 / vet.runs,
      novicePass5: nov.completed5 / nov.runs,
      avgRunSeconds: agg.seconds / agg.runs
    };
  });
}

/**
 * 打印某方案逐层首领血量
 * @param {Object} overrides 方案覆盖
 * @returns {string} 一行血量
 */
function hpRow(overrides) {
  const out = [];
  for (let f = 1; f <= 20; f += 1) out.push(sim.bossStats(f, C.DIFFICULTY.normal, overrides).hp);
  return out.join('/');
}

(async () => {
  console.log('方案\t5层通关\t10层通过\t平均层\t首领死因\t老手\t新手\t平均局时长(s)');
  for (const s of SCENARIOS) {
    const r = await runScenario(s);
    console.log([
      r.label,
      (r.pass5 * 100).toFixed(1) + '%',
      (r.pass10 * 100).toFixed(1) + '%',
      r.avgFloor.toFixed(2),
      (r.bossDeathShare * 100).toFixed(1) + '%',
      (r.veteranPass5 * 100).toFixed(1) + '%',
      (r.novicePass5 * 100).toFixed(1) + '%',
      r.avgRunSeconds.toFixed(0)
    ].join('\t'));
    console.log('  F1–F20 首领血量：' + hpRow(s.overrides));
  }
})();
