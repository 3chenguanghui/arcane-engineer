/* ============================================================================
 * E1 落地前置探针
 * ----------------------------------------------------------------------------
 * 用法：node tools/sim_panel/probe_e1_f1.js --runs 10000
 * 产物：tools/sim_panel/probe_e1_f1.json
 *
 * 回答两件事：
 *   1) F1 清层那次额外三选一，"空卡率"到底是多少（用户要求 <5% 才可落地）；
 *   2) 口径 A′（真实保底：精英房按"必经比例"出现）下，E1 的收益还剩多少。
 *
 * 注意：种子一致性**不在本探针验证**。模拟器把"选卡"和"楼层生成"共用一条随机流，
 * 选卡会改变角色 build → 后续升级池大小变化 → 模拟器的随机流会位移，这是模拟器的
 * 简化，不是主文件的行为。主文件已在浏览器里实测：19 层布局在插入 1000 次随机调用
 * 前后逐字节一致（每层用 seed+floor 独立派生随机流，见报告 §3）。
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

/* A′：浏览器实测 5719 层生成得到的"精英房绕不开"比例（见报告 §1）。
   F2 44% / F3 10% / F4 52% / F5 47%（每层 100 样本）；F6–F20 46.5%（490 样本）。 */
const MANDATORY = { 2: 0.44, 3: 0.10, 4: 0.52, 5: 0.47 };
for (let f = 6; f <= 20; f += 1) MANDATORY[f] = 0.465;

const SCENARIOS = [
  { name: 'A 基线（按权重）', ov: {} },
  { name: 'A′ 真实保底', ov: { eliteMandatory: MANDATORY } },
  { name: 'A + E1', ov: { e1CardAtFloor: 1 } },
  { name: 'A′ + E1', ov: { eliteMandatory: MANDATORY, e1CardAtFloor: 1 } }
];

/** 解析命令行。 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { runs: 10000, difficulty: 'normal', seed: C.SIM_PARAMS.baseSeed };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (a[i] === '--difficulty') o.difficulty = a[++i];
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
  }
  return o;
}

/** 跑一个场景并聚合通关/到达率。 */
function runScenario(ov, opts) {
  const ids = ['novice', 'veteran', 'bot'];
  const s = { runs: opts.runs, pass5: 0, pass10: 0, sumFloor: 0, reach15: 0, reach18: 0, reach20: 0,
    deathF2: 0, deathF3: 0, clearF20: 0 };
  const cardStats = {
    n: 0, dud: 0, allDud: 0, magicChanged: 0,
    kinds: {}, levels: {}, slotsBefore: {}, optionEffective: { 0: 0, 1: 0, 2: 0, 3: 0 }
  };

  for (let i = 0; i < opts.runs; i += 1) {
    const pid = ids[i % 3];
    const r = sim.runOne(sim.runSeed(opts.seed, i), C.PROFILES[pid], opts.difficulty, ov);
    s.sumFloor += r.clearedFloors;
    if (r.clearedFloors >= 5) s.pass5 += 1;
    // 10 层通关率：真正的中段关卡（5 层只作参考，不判）
    if (r.clearedFloors >= 10) s.pass10 += 1;
    if (r.died) {
      if (r.deathFloor >= 15) s.reach15 += 1;
      if (r.deathFloor >= 18) s.reach18 += 1;
      if (r.deathFloor >= 20) s.reach20 += 1;
      if (r.deathFloor === 2) s.deathF2 += 1;
      if (r.deathFloor === 3) s.deathF3 += 1;
    } else {
      s.reach15 += 1; s.reach18 += 1; s.reach20 += 1;
      if (r.clearedFloors >= 20) s.clearF20 += 1;
    }

    const card = r.e1Cards && r.e1Cards[0];
    if (card) {
      cardStats.n += 1;
      cardStats.kinds[card.kind] = (cardStats.kinds[card.kind] || 0) + 1;
      cardStats.levels[card.level] = (cardStats.levels[card.level] || 0) + 1;
      const slotKey = card.magicsBefore.join('+');
      cardStats.slotsBefore[slotKey] = (cardStats.slotsBefore[slotKey] || 0) + 1;
      if (card.kind === 'magic' && !card.magicChanged) cardStats.dud += 1;
      if (card.kind === 'magic' && card.magicChanged) cardStats.magicChanged += 1;
      if (card.allDud) cardStats.allDud += 1;
      const eff = card.choices.filter((c) => c.effective).length;
      cardStats.optionEffective[eff] = (cardStats.optionEffective[eff] || 0) + 1;
    }
  }
  s.pass5Pct = +(s.pass5 / s.runs * 100).toFixed(1);
  s.pass10Pct = +(s.pass10 / s.runs * 100).toFixed(1);
  s.avgFloor = +(s.sumFloor / s.runs).toFixed(2);
  s.reach15Pct = +(s.reach15 / s.runs * 100).toFixed(1);
  s.reach18Pct = +(s.reach18 / s.runs * 100).toFixed(1);
  s.reach20Pct = +(s.reach20 / s.runs * 100).toFixed(1);
  s.clearF20Pct = +(s.clearF20 / s.runs * 100).toFixed(1);
  return { s, cardStats };
}

/* 种子一致性验证见报告 §3（浏览器实测），本探针不做，原因见文件头注释。 */

/** 主流程。 */
function main() {
  const opts = parseArgs();
  const res = { meta: opts, scenarios: [] };
  SCENARIOS.forEach((sc) => {
    const r = runScenario(sc.ov, opts);
    res.scenarios.push({ name: sc.name, ...r.s });
    if (sc.name.indexOf('E1') >= 0) res.cardStats = r.cardStats;
  });

  const outPath = path.join(__dirname, 'probe_e1_f1.json');
  fs.writeFileSync(outPath, JSON.stringify(res, null, 2));

  console.log('\n=== 口径对照（普通档 / ' + opts.runs + ' 局 / seed ' + opts.seed + '）===');
  console.log('场景'.padEnd(18) + '5层参考  10层通关  平均层  F15    F18    F20    F20清层  F2死   F3死');
  res.scenarios.forEach((s) => {
    console.log(s.name.padEnd(18)
      + String(s.pass5Pct).padEnd(9) + String(s.pass10Pct).padEnd(10) + String(s.avgFloor).padEnd(8)
      + String(s.reach15Pct).padEnd(7) + String(s.reach18Pct).padEnd(7)
      + String(s.reach20Pct).padEnd(7) + String(s.clearF20Pct).padEnd(9)
      + String(s.deathF2).padEnd(7) + String(s.deathF3));
  });

  const cs = res.cardStats;
  if (cs) {
    console.log('\n=== E1：F1 清层额外三选一（样本 ' + cs.n + '）===');
    console.log('选中即空卡（换不动槽的魔法）: ' + cs.dud + ' / ' + cs.n
      + ' = ' + (cs.dud / cs.n * 100).toFixed(1) + '%');
    console.log('三张全是空卡（"点三下都是废牌"）: ' + cs.allDud + ' / ' + cs.n
      + ' = ' + (cs.allDud / cs.n * 100).toFixed(1) + '%');
    console.log('魔法卡真的换了槽: ' + cs.magicChanged + ' / ' + cs.n
      + ' = ' + (cs.magicChanged / cs.n * 100).toFixed(1) + '%');
    console.log('选项有效性分布（0/1/2/3 张有效）: ' + JSON.stringify(cs.optionEffective));
    console.log('卡类型分布: ' + JSON.stringify(cs.kinds));
    console.log('发卡时等级分布: ' + JSON.stringify(cs.levels));
    console.log('发卡时主/副槽: ' + JSON.stringify(cs.slotsBefore));
  }

  console.log('\n产物: ' + outPath);
}

main();
