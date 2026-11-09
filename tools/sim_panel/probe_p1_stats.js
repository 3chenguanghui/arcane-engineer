/* ============================================================================
 * P1a/P1b 合并统计（只读模拟器口径，不碰主文件）
 * ----------------------------------------------------------------------------
 * 目的：按今晚出包的两条改动（F2 首领血量 ×0.85、F3 ×0.88）重算
 *       10 层通过率与通关率，确认都在红线内（10 层 ≤40%、通关 ≤36%）。
 *
 * 口径：与 sim_panel/run.js 主样本一致——新手/老手/机器人轮转、每局同种子、
 *       normal 难度；基线 10000 局 + 合并 10000 局，同一批种子逐局对照。
 *
 * 用法：node tools/sim_panel/probe_p1_stats.js
 * 产物：tools/sim_panel/probe_p1_stats.json
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

const RUNS = 10000;
const BASE_SEED = C.SIM_PARAMS.baseSeed;
const IDS = ['novice', 'veteran', 'bot'];

/**
 * 跑一批样本，返回 10 层通过率 / 通关率 / 平均层数等摘要。
 * @param {Object} overrides 敏感度覆盖参数（P1a/P1b 走 bossHpMulByFloor）
 * @param {string} tag 批次名（用于日志）
 * @returns {{tag:string, runs:number, pass10:number, clear20:number, pass5:number, avgFloor:number, deathBoss:number}}
 */
function runBatch(overrides, tag) {
  let pass10 = 0;
  let clear20 = 0;
  let pass5 = 0;
  let floorSum = 0;
  let deathBoss = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const prof = C.PROFILES[IDS[i % IDS.length]];
    const r = sim.runOne(sim.runSeed(BASE_SEED, i), prof, 'normal', overrides);
    if (r.clearedFloors >= 10) pass10 += 1;
    if (r.clearedFloors >= 20) clear20 += 1;
    if (r.clearedFloors >= 5) pass5 += 1;
    floorSum += r.clearedFloors;
    if (r.died && r.deathRoom === 'boss') deathBoss += 1;
  }
  const out = {
    tag,
    runs: RUNS,
    pass5: +(pass5 / RUNS * 100).toFixed(1),
    pass10: +(pass10 / RUNS * 100).toFixed(1),
    clear20: +(clear20 / RUNS * 100).toFixed(1),
    avgFloor: +(floorSum / RUNS).toFixed(2),
    deathBossPct: +(deathBoss / RUNS * 100).toFixed(1)
  };
  console.log('[统计] ' + tag + '：10 层 ' + out.pass10 + '% / 通关 ' + out.clear20
    + '% / 5 层 ' + out.pass5 + '% / 平均层 ' + out.avgFloor);
  return out;
}

/** 主流程 */
function main() {
  const base = runBatch({}, '基线（未装 P1a/P1b）');
  const merged = runBatch({ bossHpMulByFloor: { 2: 0.85, 3: 0.88 } }, 'P1 合并（F2 ×0.85 / F3 ×0.88）');
  const out = {
    meta: { at: new Date().toISOString(), runs: RUNS, seed: BASE_SEED, profile: 'novice/veteran/bot 轮转' },
    base,
    merged,
    redLines: { pass10Max: 40, clear20Max: 36 },
    withinRedLines: merged.pass10 <= 40 && merged.clear20 <= 36
  };
  fs.writeFileSync(path.join(__dirname, 'probe_p1_stats.json'), JSON.stringify(out, null, 2));
  console.log('\n红线：10 层 ≤40% / 通关 ≤36% → '
    + (out.withinRedLines ? 'PASS（都在红线内）' : 'FAIL（越线）'));
  console.log('产物: tools/sim_panel/probe_p1_stats.json');
}

main();
