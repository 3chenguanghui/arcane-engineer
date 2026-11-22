/**
 * 批次叠加矩阵：熔炉房 × P0 两张卡（5s·4s）× 焚稿灼身（0.08） × 敌潮
 * ----------------------------------------------------------------------------
 * 为什么要这张表：
 *   熔炉房、折跃步/霜封印、焚稿灼身三件今天分别通过了各自的门禁，
 *   但**没有任何一组是"全部同时开"的**。三件叠加可能不是简单相加
 *   （例如熔炉多给等级 → 焚稿烧的冗余卡变多 → 灼身更狠），所以必须实测，
 *   且要和"各自单独 Δ 相加"对比，差值超过 1.5pp 就说明有交互作用，要单独查。
 *
 * 三件在模拟器里怎么开（都不改原文件）：
 *   1. 熔炉房：`C.ROOM.plan` 控制 F4 / F13 的固定房型；置空 = 关熔炉（F4/F13 回随机房型）。
 *      这也是 tools/_forge_probe.js、敌人数量-四口径验收.js 用的同一开关。
 *   2. 两张卡：与 tools/p0_probe.js 同一口径 —— 假设第 4 层后必定拿到，
 *      拆成承伤系数 charSpec.takenMul = 0.97（5s·4s 落地版）。
 *   3. 焚稿灼身：ov.ash = { enabled:true, hpCostPct:0.08 }（主文件 ASH_CONFIG 其余默认）。
 *   4. 敌潮：把 sim.js 复制一份，在敌人数结算后插入密度块（e1 口径：
 *      F1–5 战斗房 +1、F6+ +2、精英房 ≤5 只时 +1，单房上限 12），
 *      原文件零改动；密度块默认不存在，所以不影响 G0–G4。
 *
 * 口径约定（与 patches/P0_折跃步_霜封印.md §0 一致）：
 *   · 种子 = C.SIM_PARAMS.baseSeed + 局序号（与 p0_probe 相同，保证可复现）
 *   · 档案 = bot / 难度 normal；样本 2000 局/格
 *   · 口径顺序 = 中性 / 守拙 / 疾火 / 观星
 *
 * 用法：node tools/stack_matrix.js [--runs 2000]
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'sim_panel');
const C = require(path.join(DIR, 'config.js'));
const SIM = require(path.join(DIR, 'sim.js'));

/* 跑分前置闸：sim.ASH 与主文件 ASH_CONFIG 有任何字段/数值漂移就不许跑。 */
require('./_ash_drift_check').assertAshDrift();

/**
 * 算文件 MD5（大写），用于口径头指纹。
 * @param {string} file 绝对路径
 * @returns {string} 32 位大写十六进制
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 读命令行 --runs（默认 2000）。
 * @returns {number} 每个格子的局数
 */
function readRuns() {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 2000;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

/* ---------------------------------------------------------------------------
 * 敌潮引擎：复制 sim.js，插入密度块，不改原文件
 * ------------------------------------------------------------------------- */

/* 敌潮 e1 参数（与 敌人数量-四口径验收.js 的 e1 变体一致）：
   F1–5 战斗房 +1、F6+ 战斗房 +2、精英房在 ≤5 只时 +1，单房最多 12 只。 */
const TIDE = {
  earlyAdd: 1,
  lateAdd: 2,
  eliteAdd: 1,
  eliteMaxBase: 5,
  earlyUntil: 5,
  roomCap: 12
};

/**
 * 生成"带敌潮"的模拟器副本，返回其模块。
 * 只在内存/临时文件里改，不动 tools/sim_panel/sim.js。
 * @returns {{mod: object, file: string}} 模块与临时文件路径
 */
function buildTideSim() {
  const simFile = path.join(DIR, 'sim.js');
  let src = fs.readFileSync(simFile, 'utf8');

  /* 锚点必须唯一命中，否则说明 sim.js 改过，先停下来核对，别硬贴 */
  const anchor = '  count = Math.max(1, Math.min(cap, count));';
  const hit = src.split(anchor).length - 1;
  if (hit !== 1) throw new Error('敌潮注入锚点命中 ' + hit + ' 次（应为 1），先核对 sim.js');

  const block = anchor + '\n\n'
    + '  /* 敌潮（P2 进阶 L1，模型口径：只加总量，不建模 wave） */\n'
    + '  {\n'
    + '    const DD = ' + JSON.stringify(TIDE) + ';\n'
    + '    if (isElite) {\n'
    + '      const ea = (floor <= DD.earlyUntil && DD.eliteEarlyAdd !== undefined) ? DD.eliteEarlyAdd : DD.eliteAdd;\n'
    + '      if (count <= DD.eliteMaxBase) count += ea;\n'
    + '    } else {\n'
    + '      const slow = DD.noAddUntil || 0;\n'
    + '      const ca = floor <= slow ? 0 : (floor <= DD.earlyUntil ? DD.earlyAdd : DD.lateAdd);\n'
    + '      count += ca;\n'
    + '    }\n'
    + '    count = Math.max(1, Math.min(DD.roomCap, count));\n'
    + '  }';
  src = src.replace(anchor, block);

  /* 临时副本在 .seedwork 下，相对 require 解析不到 config，改成绝对路径 */
  src = src.replace("require('./config')", 'require(' + JSON.stringify(path.join(DIR, 'config.js')) + ')');

  const outDir = path.join(__dirname, '..', '.seedwork');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, '.sim_stack_tide.js');
  fs.writeFileSync(outFile, src, 'utf8');
  return { mod: require(outFile), file: outFile };
}

/* ---------------------------------------------------------------------------
 * 四口径角色参数：照抄 tools/p0_probe.js（口径头里 34.1/36.4/35.9/36.4 那套）
 * ------------------------------------------------------------------------- */
const PROFILES = [
  { id: 'neutral', name: '中性', spec: { magics: ['fireball', 'frost'] } },
  { id: 'warden', name: '守拙', spec: { hpPct: 0.04, magics: ['fireball', 'frost'] } },
  { id: 'ember', name: '疾火', spec: { hpFlat: -5, damageMul: 1.08, magics: ['fireball', 'frost'] } },
  { id: 'gazer', name: '观星', spec: { regenBonus: 1.0, magics: ['fireball', 'frost'] } }
];

/* 两张卡（5s·4s 落地版）折算的承伤系数，与 p0_probe 的 bothW 同值 */
const CARDS_TAKEN_MUL = 0.97;
/* 焚稿灼身：每层灰烬 -8% 有效生命 */
const ASH_HP_COST = 0.08;

/* 六组：G0 全关 → G4 线上状态；G5 只报告不判定 */
const GROUPS = [
  { id: 'g0', name: '全关（基线）', forge: false, cards: false, ash: false, tide: false },
  { id: 'g1', name: '只开熔炉', forge: true, cards: false, ash: false, tide: false },
  { id: 'g2', name: '只开两张卡', forge: false, cards: true, ash: false, tide: false },
  { id: 'g3', name: '只开焚稿 0.08', forge: false, cards: false, ash: true, tide: false },
  { id: 'g4', name: '三件全开（线上）', forge: true, cards: true, ash: true, tide: false },
  { id: 'g5', name: '三件全开 + 敌潮', forge: true, cards: true, ash: true, tide: true },
  /* 以下两组不在验收矩阵里，只用于定位 F20 的交互来自哪两件 */
  { id: 'g13', name: '熔炉 + 灼身（诊断）', forge: true, cards: false, ash: true, tide: false },
  { id: 'g23', name: '卡 + 灼身（诊断）', forge: false, cards: true, ash: true, tide: false }
];

const runs = readRuns();
const PLAN_BACKUP = C.ROOM.plan;       // 备份原始层计划，跑完恢复
const TIDE_SIM = buildTideSim();

/**
 * 跑一组：一个叠加组合 × 四口径 × runs 局。
 * @param {object} group 组合定义
 * @returns {object} { 中性: {f10,f20}, ... }
 */
function runGroup(group) {
  /* 熔炉开关：置空 plan = F4/F13 回退随机房型（关熔炉） */
  C.ROOM.plan = group.forge ? PLAN_BACKUP : {};
  const engine = group.tide ? TIDE_SIM.mod : SIM;
  const out = {};
  PROFILES.forEach((prof) => {
    let c10 = 0;
    let c20 = 0;
    let burns = 0;
    let stacks = 0;
    let deck = 0;
    for (let i = 0; i < runs; i += 1) {
      const seed = C.SIM_PARAMS.baseSeed + i;                 // 与 p0_probe 相同的种子序列
      const spec = Object.assign({}, prof.spec);
      if (group.cards) spec.takenMul = CARDS_TAKEN_MUL;       // 两张卡 = 承伤 0.97
      const ov = { charSpec: spec };
      if (group.ash) ov.ash = { enabled: true, hpCostPct: ASH_HP_COST };
      const r = engine.runOne(seed, C.PROFILES.bot, 'normal', ov);
      if (r.clearedFloors >= 10) c10 += 1;
      if (r.clearedFloors >= C.SIM_PARAMS.maxFloor) c20 += 1;
      burns += r.ashBurns || 0;
      stacks += r.ashStacks || 0;
      deck += r.ashDeck || 0;
    }
    out[prof.name] = {
      f10: c10 / runs,
      f20: c20 / runs,
      burns: burns / runs,
      stacks: stacks / runs,
      deck: deck / runs
    };
  });
  return out;
}

const pad = (s, n) => String(s).padEnd(n, ' ');

/* ---------- 口径头（与 P0 文档 §0 同一模板，多一行敌潮引擎指纹） ---------- */
console.log('【口径头】sim.js MD5 ' + md5Of(path.join(DIR, 'sim.js'))
  + ' | config.js MD5 ' + md5Of(path.join(DIR, 'config.js')));
console.log('【口径头】敌潮引擎（临时副本）MD5 ' + md5Of(TIDE_SIM.file) + ' | 注入参数 ' + JSON.stringify(TIDE));
console.log('【口径头】样本 ' + runs + ' 局/格 | 口径顺序 中性/守拙/疾火/观星');

/* ---------- 跑六组 ---------- */
const results = {};
GROUPS.forEach((g) => { results[g.id] = runGroup(g); });
C.ROOM.plan = PLAN_BACKUP;             // 恢复，避免影响同进程后续脚本

/* ---------- 矩阵表 ---------- */
console.log('\n【叠加矩阵】10 层通关率 / F20 到达率（%）');
console.log(pad('组别', 22)
  + pad('中性', 16) + pad('守拙', 16) + pad('疾火', 16) + pad('观星', 16));
console.log(pad('', 22) + '10层 / F20（同格）'.padEnd(64));
GROUPS.forEach((g) => {
  const r = results[g.id];
  const cells = PROFILES.map((p) => (r[p.name].f10 * 100).toFixed(1) + ' / ' + (r[p.name].f20 * 100).toFixed(1));
  console.log(pad(g.name, 22) + cells.map((s) => pad(s, 16)).join(''));
});

/* ---------- Δ 表（相对 G0，单位 pp） ---------- */
console.log('\n【Δ 表】相对 G0 全关（pp，正 = 更容易通关）');
console.log(pad('组别', 22) + pad('中性10 / F20', 20) + pad('守拙10 / F20', 20)
  + pad('疾火10 / F20', 20) + pad('观星10 / F20', 20));
GROUPS.slice(1).forEach((g) => {
  const r = results[g.id];
  const b = results.g0;
  const cells = PROFILES.map((p) => {
    const d10 = (r[p.name].f10 - b[p.name].f10) * 100;
    const d20 = (r[p.name].f20 - b[p.name].f20) * 100;
    return (d10 >= 0 ? '+' : '') + d10.toFixed(1) + ' / ' + (d20 >= 0 ? '+' : '') + d20.toFixed(1);
  });
  console.log(pad(g.name, 22) + cells.map((s) => pad(s, 20)).join(''));
});

/* ---------- 焚稿诊断：焚了几张 / 灰烬几层 / 卡组多大 ---------- */
console.log('\n【灼身诊断】焚稿相关均值（用于判断叠加是否改变焚稿行为）');
console.log(pad('组别', 22) + pad('中性 焚/层/卡', 20) + pad('守拙 焚/层/卡', 20)
  + pad('疾火 焚/层/卡', 20) + pad('观星 焚/层/卡', 20));
GROUPS.filter((g) => g.ash).forEach((g) => {
  const r = results[g.id];
  const cells = PROFILES.map((p) => r[p.name].burns.toFixed(2) + ' / '
    + r[p.name].stacks.toFixed(2) + ' / ' + r[p.name].deck.toFixed(2));
  console.log(pad(g.name, 22) + cells.map((s) => pad(s, 20)).join(''));
});

/* ---------- 交互作用校验：单独 Δ 相加 vs 三件全开的实际 Δ ---------- */
console.log('\n【交互校验】G4 实际 Δ 与"G1+G2+G3 单独 Δ 相加"的差（pp，≤1.5 视为可加）');
console.log(pad('口径', 8) + pad('10层 实际', 14) + pad('10层 相加', 14) + pad('10层 差', 10)
  + pad('F20 实际', 13) + pad('F20 相加', 13) + 'F20 差');
let worstDiff = 0;
PROFILES.forEach((p) => {
  const b = results.g0[p.name];
  const act10 = (results.g4[p.name].f10 - b.f10) * 100;
  const sum10 = ((results.g1[p.name].f10 - b.f10) + (results.g2[p.name].f10 - b.f10)
    + (results.g3[p.name].f10 - b.f10)) * 100;
  const act20 = (results.g4[p.name].f20 - b.f20) * 100;
  const sum20 = ((results.g1[p.name].f20 - b.f20) + (results.g2[p.name].f20 - b.f20)
    + (results.g3[p.name].f20 - b.f20)) * 100;
  const d10 = act10 - sum10;
  const d20 = act20 - sum20;
  worstDiff = Math.max(worstDiff, Math.abs(d10), Math.abs(d20));
  console.log(pad(p.name, 8)
    + pad(act10.toFixed(1), 14) + pad(sum10.toFixed(1), 14) + pad(d10.toFixed(1), 10)
    + pad(act20.toFixed(1), 13) + pad(sum20.toFixed(1), 13) + d20.toFixed(1));
});
console.log('  最大偏差 ' + worstDiff.toFixed(1) + 'pp → '
  + (worstDiff <= 1.5 ? '可加（无显著交互）' : '存在交互，需单独查'));

/* ---------- 判定 ---------- */
const worst = (key) => ({
  f10: Math.max.apply(null, PROFILES.map((p) => results[key][p.name].f10)),
  f20: Math.max.apply(null, PROFILES.map((p) => results[key][p.name].f20))
});
const w4 = worst('g4');
const w5 = worst('g5');
console.log('\n【判定】门禁 10 层 ≤38.5% 且 F20 ≤35%（取最差口径）');
console.log('  G4 线上状态：最差 10 层 ' + (w4.f10 * 100).toFixed(1) + '% / 最差 F20 ' + (w4.f20 * 100).toFixed(1) + '% → '
  + ((w4.f10 <= 0.385 && w4.f20 <= 0.35) ? 'PASS' : 'FAIL'));
console.log('  G5 三件+敌潮（只报告）：最差 10 层 ' + (w5.f10 * 100).toFixed(1) + '% / 最差 F20 ' + (w5.f20 * 100).toFixed(1) + '%');

/* 存档：与 .seedwork 里 fourcal_*.json 同一风格，便于以后复核 */
const outJson = path.join(__dirname, '..', '.seedwork', 'stack_matrix_' + runs + '.json');
fs.writeFileSync(outJson, JSON.stringify({
  runs,
  md5: { sim: md5Of(path.join(DIR, 'sim.js')), config: md5Of(path.join(DIR, 'config.js')), tide: md5Of(TIDE_SIM.file) },
  tide: TIDE,
  cardsTakenMul: CARDS_TAKEN_MUL,
  ashHpCostPct: ASH_HP_COST,
  groups: results
}, null, 2), 'utf8');
console.log('\n已存档 ' + outJson);
