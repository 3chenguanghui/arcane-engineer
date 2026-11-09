/**
 * 敌潮三档 · 叠在线上状态（G4）上的四口径实测
 * ----------------------------------------------------------------------------
 * 背景：批次叠加矩阵里，敌潮（e1 口径）把线上 G4 的 10 层通关率压掉约 3.9pp，
 * 而 G4 距 38.5% 门禁还有 2.2pp 余量。用户要求把它做成**可选难度开关**
 * （默认关，玩家自己开），并给出三档的 Δ 大概怎么走。
 *
 * 本脚本只做测量，**不改主文件、不改默认值、不改 config.js**：
 *   · 线上状态 G4 = 熔炉房开 + 两张卡（takenMul 0.97）+ 焚稿灼身 hpCostPct 0.08
 *   · 敌潮 = 复制 sim.js，在敌人数结算后插入密度块（三个临时副本，各自参数不同）
 *
 * 三档定义（只调"战斗房加几只"，精英房统一 ≤5 只时 +1，单房上限 12）：
 *   T1 温和：F1–5 +1、F6+ +1
 *   T2 标准：F1–5 +1、F6+ +2   ← 与叠加矩阵里的 e1 完全一致
 *   T3 严苛：F1–5 +2、F6+ +2
 *
 * 用法：node tools/tide_tiers.js [--runs 2000]
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'sim_panel');
const C = require(path.join(DIR, 'config.js'));
const SIM = require(path.join(DIR, 'sim.js'));

/**
 * 算文件 MD5（大写），写进口径头。
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

/* 三档敌潮参数；精英房规则三档相同。
   T1 首测用 (1,+1)，和 T2 只差 0.3pp，梯度不够，改成"只在 F6 后 +1"，
   让三档在 10 层分别落在约 -3pp / -3.8pp / -5.2pp。 */
const TIERS = [
  { id: 't1', name: 'T1 轻', earlyAdd: 0, lateAdd: 1 },
  { id: 't2', name: 'T2 标准', earlyAdd: 1, lateAdd: 2 },
  { id: 't3', name: 'T3 严苛', earlyAdd: 2, lateAdd: 2 }
];

/**
 * 生成带指定敌潮密度的模拟器副本。
 * 只写 .seedwork 下的临时文件，不改 tools/sim_panel/sim.js。
 * @param {object} tier 档位参数
 * @returns {{mod: object, file: string}} 模块与临时文件路径
 */
function buildTideSim(tier) {
  let src = fs.readFileSync(path.join(DIR, 'sim.js'), 'utf8');
  const anchor = '  count = Math.max(1, Math.min(cap, count));';
  const hit = src.split(anchor).length - 1;
  if (hit !== 1) throw new Error('敌潮注入锚点命中 ' + hit + ' 次（应为 1）');

  const dd = {
    earlyAdd: tier.earlyAdd,
    lateAdd: tier.lateAdd,
    eliteAdd: 1,
    eliteMaxBase: 5,
    earlyUntil: 5,
    roomCap: 12
  };
  const block = anchor + '\n\n'
    + '  /* 敌潮（可选难度档 ' + tier.id + '） */\n'
    + '  {\n'
    + '    const DD = ' + JSON.stringify(dd) + ';\n'
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
  src = src.replace("require('./config')", 'require(' + JSON.stringify(path.join(DIR, 'config.js')) + ')');

  const outDir = path.join(__dirname, '..', '.seedwork');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, '.sim_tide_' + tier.id + '.js');
  fs.writeFileSync(outFile, src, 'utf8');
  return { mod: require(outFile), file: outFile };
}

/* 四口径：与 tools/p0_probe.js / stack_matrix.js 完全一致 */
const PROFILES = [
  { id: 'neutral', name: '中性', spec: { magics: ['fireball', 'frost'] } },
  { id: 'warden', name: '守拙', spec: { hpPct: 0.04, magics: ['fireball', 'frost'] } },
  { id: 'ember', name: '疾火', spec: { hpFlat: -5, damageMul: 1.08, magics: ['fireball', 'frost'] } },
  { id: 'gazer', name: '观星', spec: { regenBonus: 1.0, magics: ['fireball', 'frost'] } }
];

const CARDS_TAKEN_MUL = 0.97;
const ASH_HP_COST = 0.08;
const runs = readRuns();

/**
 * 跑一个引擎 × 四口径 × runs 局（线上状态：熔炉开 + 两张卡 + 焚稿灼身 0.08）。
 * @param {object} engine 模拟器模块
 * @returns {object} { 中性: {f10,f20}, ... }
 */
function runOnline(engine) {
  const out = {};
  PROFILES.forEach((prof) => {
    let c10 = 0;
    let c20 = 0;
    for (let i = 0; i < runs; i += 1) {
      const seed = C.SIM_PARAMS.baseSeed + i;
      const spec = Object.assign({}, prof.spec, { takenMul: CARDS_TAKEN_MUL });
      const r = engine.runOne(seed, C.PROFILES.bot, 'normal', {
        charSpec: spec,
        ash: { enabled: true, hpCostPct: ASH_HP_COST }
      });
      if (r.clearedFloors >= 10) c10 += 1;
      if (r.clearedFloors >= C.SIM_PARAMS.maxFloor) c20 += 1;
    }
    out[prof.name] = { f10: c10 / runs, f20: c20 / runs };
  });
  return out;
}

const pad = (s, n) => String(s).padEnd(n, ' ');

/* ---------- 口径头 ---------- */
console.log('【口径头】sim.js MD5 ' + md5Of(path.join(DIR, 'sim.js'))
  + ' | config.js MD5 ' + md5Of(path.join(DIR, 'config.js')));
console.log('【口径头】线上状态 = G4（熔炉 ON + 两张卡 takenMul 0.97 + 焚稿灼身 hpCostPct 0.08）');
console.log('【口径头】样本 ' + runs + ' 局/格 | 口径顺序 中性/守拙/疾火/观星');

/* ---------- 跑：无敌潮（G4 复测）+ 三档 ---------- */
const baseline = runOnline(SIM);
const tierResults = TIERS.map((t) => {
  const built = buildTideSim(t);
  return { tier: t, md5: md5Of(built.file), data: runOnline(built.mod) };
});

/* ---------- 表 ---------- */
console.log('\n【敌潮三档】10 层通关率 / F20 到达率（%）');
console.log(pad('配置', 26) + pad('中性', 18) + pad('守拙', 18) + pad('疾火', 18) + pad('观星', 18));
console.log(pad('', 26) + '10层 / F20'.padEnd(72));
const printRow = (label, data) => {
  const cells = PROFILES.map((p) => (data[p.name].f10 * 100).toFixed(1) + ' / '
    + (data[p.name].f20 * 100).toFixed(1));
  console.log(pad(label, 26) + cells.map((s) => pad(s, 18)).join(''));
};
printRow('G4 线上（敌潮关）', baseline);
tierResults.forEach((r) => printRow(r.tier.name + '（' + r.tier.id + '）', r.data));

console.log('\n【Δ vs G4】pp（负 = 更难；括号内为最差口径）');
tierResults.forEach((r) => {
  const cells = PROFILES.map((p) => {
    const d10 = (r.data[p.name].f10 - baseline[p.name].f10) * 100;
    const d20 = (r.data[p.name].f20 - baseline[p.name].f20) * 100;
    return d10.toFixed(1) + ' / ' + d20.toFixed(1);
  });
  const worst10 = (Math.max.apply(null, PROFILES.map((p) => r.data[p.name].f10)) * 100).toFixed(1);
  const worst20 = (Math.max.apply(null, PROFILES.map((p) => r.data[p.name].f20)) * 100).toFixed(1);
  console.log(pad(r.tier.name, 12) + cells.map((s) => pad(s, 18)).join('')
    + ' | 最差 ' + worst10 + '% / ' + worst20 + '%'
    + ' | 门禁 ' + ((Number(worst10) <= 38.5 && Number(worst20) <= 35) ? 'PASS' : 'FAIL'));
});

console.log('\n【指纹】' + tierResults.map((r) => r.tier.id + ' ' + r.md5).join(' | '));

/* 存档，便于以后复核 */
const outJson = path.join(__dirname, '..', '.seedwork', 'tide_tiers_' + runs + '.json');
fs.writeFileSync(outJson, JSON.stringify({
  runs,
  md5: { sim: md5Of(path.join(DIR, 'sim.js')), config: md5Of(path.join(DIR, 'config.js')) },
  online: { cardsTakenMul: CARDS_TAKEN_MUL, ashHpCostPct: ASH_HP_COST },
  baseline,
  tiers: tierResults.map((r) => ({ id: r.tier.id, earlyAdd: r.tier.earlyAdd, lateAdd: r.tier.lateAdd, md5: r.md5, data: r.data }))
}, null, 2), 'utf8');
console.log('已存档 ' + outJson);
