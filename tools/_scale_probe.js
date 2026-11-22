/**
 * 「秤」四步验证：改前基线 → 只修秤不加卡 → 加一张新卡 → 再加一张
 * ----------------------------------------------------------------------------
 * 目的：证明升级三选一里"伤害卡的分数"从"全部相等"变成"按机制分化"，
 *       且加卡不会反向污染已有卡的分数（burstRef 是固定锚点）。
 *
 * 做法：
 *   1. 从 _backup/sim.js.bak_20261109_prescale.js 生成一份临时基线副本，
 *      只把 require('./config') 改成绝对路径，并补一个 optionPool 导出；
 *   2. 修后版本直接用 tools/sim_panel/sim.js（已导出 optionPool）；
 *   3. 用同一个假玩家（火球+冰环起手）调 optionPool，读每张伤害卡的 value / survival，
 *      按 levelUp 的默认权重算分：score = value×0.7 + survival×0.3。
 *
 * 用法：node tools/_scale_probe.js
 * 产物：tools/sim_panel/.seedwork/scale_probe.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'tools', 'sim_panel');
const SEEDWORK = path.join(ROOT, '.seedwork');
const BASELINE_SRC = path.join(ROOT, '_backup', 'sim.js.bak_20261109_prescale.js');
const FIXED_SRC = path.join(DIR, 'sim.js');

/**
 * 生成基线临时副本（原 sim.js + 只补导出），返回模块。
 * @returns {object} 基线模拟器模块
 */
function loadBaseline() {
  let src = fs.readFileSync(BASELINE_SRC, 'utf8');
  src = src.replace("require('./config')", 'require(' + JSON.stringify(path.join(DIR, 'config.js')) + ')');
  src += '\nmodule.exports.optionPool = optionPool;\nmodule.exports.CARD_VALUE = null;\n';
  fs.mkdirSync(SEEDWORK, { recursive: true });
  const out = path.join(SEEDWORK, '.sim_scale_baseline.js');
  fs.writeFileSync(out, src, 'utf8');
  delete require.cache[out];
  return require(out);
}

/**
 * 用同一个假玩家枚举卡池，返回伤害卡评分表。
 * @param {object} SIM 模拟器模块（需导出 optionPool）
 * @param {object} C 配置
 * @returns {Array<object>} 每张伤害卡的评分
 */
function scoreDamageCards(SIM, C) {
  const p = { fusions: {}, magics: [], hasHeal: false, techs: {}, relics: {}, deck: [] };
  const pool = SIM.optionPool(p);
  return pool
    .filter((o) => o.kind === 'magic' && o.data && o.data.damage > 0)
    .map((o) => ({
      id: o.id,
      name: o.name,
      damage: o.data.damage,
      aoe: !!o.data.aoe,
      value: o.value,
      survival: o.survival,
      score: o.value * 0.7 + o.survival * 0.3
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 统计一组分数的分化程度。
 * @param {Array<object>} rows 评分表
 * @returns {object} {distinct, max, min, spread}
 */
function spreadOf(rows) {
  const scores = rows.map((r) => r.score);
  const distinct = new Set(scores.map((s) => s.toFixed(6))).size;
  return {
    distinct,
    max: Math.max.apply(null, scores),
    min: Math.min.apply(null, scores),
    spread: Math.max.apply(null, scores) - Math.min.apply(null, scores)
  };
}

/**
 * 打印一张评分表。
 * @param {string} title 步骤标题
 * @param {Array<object>} rows 评分表
 * @returns {void}
 */
function printTable(title, rows) {
  const s = spreadOf(rows);
  console.log('\n=== ' + title + ' ===');
  console.log('卡 id'.padEnd(14) + '伤害'.padStart(6) + '范围'.padStart(5)
    + 'value'.padStart(9) + 'score'.padStart(10));
  rows.forEach((r) => {
    console.log(String(r.id).padEnd(14)
      + String(r.damage).padStart(6)
      + (r.aoe ? 'Y' : '-').padStart(5)
      + r.value.toFixed(4).padStart(9)
      + r.score.toFixed(4).padStart(10));
  });
  const vals = rows.map((r) => r.value);
  const meanVal = vals.reduce((a, b) => a + b, 0) / vals.length;
  console.log('→ 不同分数个数 = ' + s.distinct + ' ／ ' + rows.length
    + '；最高 ' + s.max.toFixed(4) + '，最低 ' + s.min.toFixed(4)
    + '，极差 ' + s.spread.toFixed(4));
  console.log('→ value 均值 ' + meanVal.toFixed(12) + '（对 0.10 差 ' + (meanVal - 0.1).toExponential(2)
    + '）；value 区间 [' + Math.min.apply(null, vals).toFixed(6) + ', '
    + Math.max.apply(null, vals).toFixed(6) + ']');
}

/* ---------------------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------------------- */
const C = require(path.join(DIR, 'config.js'));
const baseSim = loadBaseline();
const fixSim = require(FIXED_SRC);

const report = { steps: [] };

/* 步骤 1：改前基线（原 0.10 常数） */
const step1 = scoreDamageCards(baseSim, C);
printTable('步骤 1 · 改前基线（统一 0.10）', step1);
report.steps.push({ step: 1, name: 'before', rows: step1, spread: spreadOf(step1) });

/* 步骤 2：只修秤，不加卡 */
const step2 = scoreDamageCards(fixSim, C);
printTable('步骤 2 · 只修秤（方案A：均值锚定 0.10）', step2);
report.steps.push({ step: 2, name: 'fixed', rows: step2, spread: spreadOf(step2) });

/* 步骤 3：固定池 + 虚空针（64 单体 / 3.2s / 28） */
const VOID = { id: 'voidNeedle', name: '虚空针', cost: 28, cooldown: 3.2, damage: 64, aoe: false, tag: '单体', minFloor: 4 };
C.MAGIC.push(VOID);
const step3 = scoreDamageCards(fixSim, C);
printTable('步骤 3 · 修秤 + 虚空针', step3);
report.steps.push({ step: 3, name: 'fixed+voidNeedle', rows: step3, spread: spreadOf(step3) });

/* 步骤 4：再加雷印（30 单体 / 2.0s / 24） */
const SIGIL = { id: 'thunderSigil', name: '雷印', cost: 24, cooldown: 2.0, damage: 30, aoe: false, tag: '单体', minFloor: 4 };
C.MAGIC.push(SIGIL);
const step4 = scoreDamageCards(fixSim, C);
printTable('步骤 4 · 修秤 + 虚空针 + 雷印', step4);
report.steps.push({ step: 4, name: 'fixed+voidNeedle+thunderSigil', rows: step4, spread: spreadOf(step4) });

/* 加卡锚点校验：已有卡的分数必须逐位不变 */
const beforeMap = {};
step2.forEach((r) => { beforeMap[r.id] = r.score; });
const moved = step4.filter((r) => beforeMap[r.id] !== undefined
  && Math.abs(beforeMap[r.id] - r.score) > 1e-12);
console.log('\n=== 锚点校验 ===');
console.log(moved.length === 0
  ? 'PASS：加两张卡后，原有 11 张伤害卡分数逐位不变（burstRef 固定锚点生效）'
  : 'FAIL：以下已有卡分数被加卡改写 → ' + moved.map((m) => m.id).join(','));

report.anchorStable = moved.length === 0;
report.generatedAt = new Date().toISOString();
fs.mkdirSync(SEEDWORK, { recursive: true });
fs.writeFileSync(path.join(SEEDWORK, 'scale_probe.json'), JSON.stringify(report, null, 2));
console.log('\n产物：.seedwork/scale_probe.json');
