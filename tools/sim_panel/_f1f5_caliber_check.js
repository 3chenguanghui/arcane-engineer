/* ============================================================================
 * 前 5 层口径核查（2026-11-08）
 * ----------------------------------------------------------------------------
 * 背景：另一条线报"前 5 层通关率 44.90% → 36.07%（−8.83pp）"。
 * 但 tools/sim_panel/sim.js 的前五层走的是旧教学口径：
 *   count = ramp × 0.8（教学 −20%），精英额外 ×1.4，F1 再封顶 3 只。
 * 主文件 ENEMY_BUDGET_CONFIG 已改为 minFloor = 1，前五层实际是：
 *   战斗 4 / 4 / 5 / 5 / 5-6，精英 3 / 3 / 4 / 4 / 4-5，没有 −20%、没有 F1 封顶。
 * 也就是说：**旧模拟器在前五层比真机少 1–2 只怪**，用它测"前五层通关率"
 * 会系统性偏乐观。本脚本把两套口径并排跑，量化这部分偏差到底有多大。
 *
 * 用法：node _f1f5_caliber_check.js [--runs 2000]
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config.js');

const SIM_PATH = path.join(__dirname, 'sim.js');
const TMP = path.join(__dirname, '_sim_f1f5_aligned.js');

/**
 * 单次替换，命中次数必须为 1（锚点漂移就停）
 * @param {string} src 源码
 * @param {string} from 原片段
 * @param {string} to 新片段
 * @param {string} tag 标签
 * @returns {string} 结果
 */
function replaceOnce(src, from, to, tag) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`锚点[${tag}]命中 ${n} 次`);
  return src.replace(from, to);
}

/**
 * 生成"对齐主文件 minFloor=1"的副本
 * @returns {string} 临时文件路径
 */
function buildAligned() {
  let src = fs.readFileSync(SIM_PATH, 'utf8');
  src = replaceOnce(src,
    `  if (isElite && !budgetOn) count = Math.round(count * (tune && tune.countMul !== undefined ? tune.countMul : C.ELITE_ROOM.countMul));
  if (floor <= C.ONBOARD.maxFloors) count = Math.round(count * C.ONBOARD.enemyCountMul);
  if (floor === 1) count = Math.min(C.ONBOARD.floor1CountCap, count);`,
    `  if (isElite && !budgetOn) count = Math.round(count * (tune && tune.countMul !== undefined ? tune.countMul : C.ELITE_ROOM.countMul));`,
    'onboard');
  src = replaceOnce(src, `  const budgetOn = floor >= C.FLOOR_GEN.budgetFrom;`, `  const budgetOn = true;`, 'budgetFrom');
  fs.writeFileSync(TMP, src, 'utf8');
  return TMP;
}

 /**
  * 用指定模拟器跑 N 局，返回前五层指标
  * @param {Object} S 模拟器模块
  * @param {number} runs 局数
  * @param {Object} charSpec 角色规格
  * @returns {Object} 指标
  */
function runSet(S, runs, charSpec) {
  let clear5 = 0; let diedIn5 = 0; let reach6 = 0; let clear10 = 0;
  const deathFloor = {};
  for (let i = 0; i < runs; i += 1) {
    const r = S.runOne(S.runSeed(C.SIM_PARAMS.baseSeed, i), C.PROFILES.bot, 'normal',
      { charSpec, talentSpec: null });
    if (r.clearedFloors >= 5) clear5 += 1;
    if (r.clearedFloors >= 6) reach6 += 1;
    if (r.clearedFloors >= 10) clear10 += 1;
    if (r.died) {
      deathFloor[r.deathFloor] = (deathFloor[r.deathFloor] || 0) + 1;
      if (r.deathFloor >= 2 && r.deathFloor <= 5) diedIn5 += 1;
    }
  }
  return {
    runs,
    clear5: +(clear5 / runs * 100).toFixed(2),
    reach6: +(reach6 / runs * 100).toFixed(2),
    clear10: +(clear10 / runs * 100).toFixed(2),
    diedIn5Pct: +(diedIn5 / runs * 100).toFixed(2),
    deathFloor
  };
}

(async () => {
  const runs = Number((process.argv.find((a) => a.startsWith('--runs=') || false) || '').split('=')[1]) || 2000;
  const oldSim = require('./sim.js');
  const aligned = require(buildAligned());

  // 中性口径：不选角色（base）。重点看"同一角色、两把尺子"的差，避免把角色差异混进来。
  const charSpec = { id: 'base', hpPct: 0, magics: ['fireball', 'frost'], techs: [] };

  const oldR = runSet(oldSim, runs, charSpec);
  const aliR = runSet(aligned, runs, charSpec);

  console.log(`前 5 层口径核查（bot 档案，中性角色，各 ${runs} 局）\n`);
  console.log('  指标            旧模拟器(F1-5 教学-20%)   对齐主文件(minFloor=1)   差值');
  const row = (label, a, b) => console.log('  ' + label.padEnd(16) + String(a).padStart(22) + String(b).padStart(24) + String(+(b - a).toFixed(2)).padStart(9));
  row('通过第5层 %', oldR.clear5, aliR.clear5);
  row('到达第6层 %', oldR.reach6, aliR.reach6);
  row('通过第10层 %', oldR.clear10, aliR.clear10);
  row('F2-F5 死亡率 %', oldR.diedIn5Pct, aliR.diedIn5Pct);
  console.log('\n  旧模拟器死亡楼层分布：' + JSON.stringify(oldR.deathFloor));
  console.log('  对齐后死亡楼层分布：' + JSON.stringify(aliR.deathFloor));

  try { fs.unlinkSync(TMP); } catch (e) { /* 忽略 */ }
})();
