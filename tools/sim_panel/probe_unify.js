/* ============================================================================
 * 统一基线探针：修掉两处失真后的共用口径表
 * ----------------------------------------------------------------------------
 * 用法：node tools/sim_panel/probe_unify.js --runs 10000
 * 产物：tools/sim_panel/probe_unify.json
 *
 * 修掉的两处失真：
 *   1) 精英房在预算楼层（F6+）不再叠 ELITE_ROUTE_CONFIG.countMul ×1.4；
 *   2) gainXp 不再和 levelUp 双重 +1 级（等级不再翻倍）。
 *
 * 场景顺序与用户定的推进顺序一致：
 *   B0_raw → B_C → E1 → W1 → W2 → W1+W2
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

const C_PLAN = { bossPulse: { enabled: true, fromFloor: 13, everyPct: 0.15, ratio: 0.12 } };

const SCENARIOS = {
  /* 共用基线：正式数值路径，不带任何方案 */
  B0_raw: {},
  /* 上一轮定的 C，仅用于对照（本轮不上） */
  B_C: { healPlan: C_PLAN },
  /* E1：F1 清层额外一次三选一（等价于开局 +1 卡） */
  E1: { startLevels: 1 },
  /* W1：精英房混编 4 精英 + 2 普通（F13 起） */
  W1: { eliteTune: { fromFloor: 13, mixNormal: 2 } },
  /* W2：精英房清 5 只开门可走（放弃本房奖励） */
  W2: { eliteTune: { fromFloor: 13, clearKills: 5 } },
  /* W1 + W2 */
  W12: { eliteTune: { fromFloor: 13, mixNormal: 2, clearKills: 5 } }
};

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

/**
 * 跑一个场景并聚合。
 * @param {Object} ov overrides
 * @param {Object} opts 运行参数
 * @returns {Object} 指标
 */
function runScenario(ov, opts) {
  const profileIds = ['novice', 'veteran', 'bot'];
  const agg = sim.createAgg();
  const bossEntries = [];
  const eliteDeaths = [];
  const cardStats = { total: 0, magicChanged: 0, kinds: {}, ids: {} };

  for (let i = 0; i < opts.runs; i += 1) {
    const pid = profileIds[i % 3];
    const r = sim.runOne(sim.runSeed(opts.seed, i), C.PROFILES[pid], opts.difficulty, ov);
    sim.addRun(agg, r);
    if (r.bossEntries && r.bossEntries.length) bossEntries.push.apply(bossEntries, r.bossEntries);
    if (r.eliteDeaths && r.eliteDeaths.length) eliteDeaths.push.apply(eliteDeaths, r.eliteDeaths);
    if (r.startCards && r.startCards.length) {
      r.startCards.forEach((card) => {
        cardStats.total += 1;
        if (card.magicChanged) cardStats.magicChanged += 1;
        cardStats.kinds[card.kind] = (cardStats.kinds[card.kind] || 0) + 1;
        cardStats.ids[card.id] = (cardStats.ids[card.id] || 0) + 1;
      });
    }
  }

  const n = opts.runs;
  const rate = (f) => agg.cleared[f] / n;
  const reach = (f) => agg.reached[f] / n;
  let avgFloor = 0;
  for (let f = 1; f <= 20; f += 1) avgFloor += rate(f);

  const floorEliteDeaths = {};
  eliteDeaths.forEach((d) => { floorEliteDeaths[d.floor] = (floorEliteDeaths[d.floor] || 0) + 1; });

  const out = {
    pass5: rate(5),
    reach2: reach(2),
    reach5: reach(5),
    reach15: reach(15),
    reach18: reach(18),
    reach20: reach(20),
    avgFloor,
    deathsF2: agg.deathFloor[2] || 0,
    deathsF3: agg.deathFloor[3] || 0,
    deathsF19: agg.deathFloor[19] || 0,
    deathsF20: agg.deathFloor[20] || 0,
    eliteF19: floorEliteDeaths[19] || 0,
    eliteF20: floorEliteDeaths[20] || 0,
    eliteAll: eliteDeaths.length,
    deathBossShare: agg.deathRoom.boss / (agg.deathRoom.battle + agg.deathRoom.elite + agg.deathRoom.boss || 1),
    cards: cardStats
  };

  out.bossBuild = {};
  [1, 2, 3].forEach((f) => {
    const list = bossEntries.filter((b) => b.floor === f);
    const died = list.filter((b) => b.died).length;
    const mean = (getter, arr) => arr.reduce((s, b) => s + getter(b), 0) / Math.max(1, arr.length);
    out.bossBuild['F' + f] = {
      entries: list.length,
      died,
      deathRate: died / Math.max(1, list.length),
      avgLevel: mean((b) => b.level, list),
      avgMagics: mean((b) => b.magics.length, list),
      avgTechs: mean((b) => b.techs.length, list),
      avgRelics: mean((b) => b.relics.length, list),
      avgHpRatio: mean((b) => b.hp / b.hpMax, list),
      avgSingleDps: mean((b) => b.singleDps || 0, list),
      avgHealPerSec: mean((b) => b.healPerSec || 0, list),
      avgSeconds: mean((b) => b.seconds, list),
      avgHpLeftWin: list.filter((b) => !b.died).reduce((s, b) => s + (b.hpLeft || 0), 0) / Math.max(1, list.length - died)
    };
  });

  return out;
}

/** 主流程。 */
function main() {
  const opts = parseArgs();
  const report = { meta: { runs: opts.runs, difficulty: opts.difficulty, seed: opts.seed }, scenarios: {} };

  Object.keys(SCENARIOS).forEach((name) => {
    report.scenarios[name] = runScenario(SCENARIOS[name], opts);
  });

  fs.writeFileSync(path.join(__dirname, 'probe_unify.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('=== 统一基线（' + opts.runs + ' 局，' + opts.difficulty + '）===');
  console.log('场景 | 5层通关 | 平均层 | F15到达 | F18到达 | F20到达 | F2死 | F3死 | F19精英死 | F20精英死 | 精英总死');
  Object.keys(report.scenarios).forEach((k) => {
    const r = report.scenarios[k];
    console.log([
      k.padEnd(8),
      (r.pass5 * 100).toFixed(1) + '%',
      r.avgFloor.toFixed(2),
      (r.reach15 * 100).toFixed(1) + '%',
      (r.reach18 * 100).toFixed(1) + '%',
      (r.reach20 * 100).toFixed(1) + '%',
      r.deathsF2,
      r.deathsF3,
      r.eliteF19,
      r.eliteF20,
      r.eliteAll
    ].join(' | '));
  });

  console.log('\n=== 首领入场 build（DPS/治疗/时长） ===');
  ['B0_raw', 'E1', 'W1', 'W2', 'W12'].forEach((k) => {
    const b = report.scenarios[k];
    if (!b) return;
    const f2 = b.bossBuild.F2;
    const f3 = b.bossBuild.F3;
    console.log(k + ' | F2: 等级 ' + f2.avgLevel.toFixed(1) + ' 卡(魔/科/遗) ' + f2.avgMagics.toFixed(1) + '/'
      + f2.avgTechs.toFixed(2) + '/' + f2.avgRelics.toFixed(2)
      + ' 血 ' + (f2.avgHpRatio * 100).toFixed(0) + '% DPS ' + f2.avgSingleDps.toFixed(1)
      + ' 治疗 ' + f2.avgHealPerSec.toFixed(2) + '/s 时长 ' + f2.avgSeconds.toFixed(0) + 's 胜率 ' + ((1 - f2.deathRate) * 100).toFixed(1) + '%'
      + ' || F3: DPS ' + f3.avgSingleDps.toFixed(1) + ' 时长 ' + f3.avgSeconds.toFixed(0) + 's 胜率 ' + ((1 - f3.deathRate) * 100).toFixed(1) + '%');
  });

  const cards = report.scenarios.E1.cards;
  console.log('\n=== E1 额外卡的实际内容（总 ' + cards.total + ' 张） ===');
  console.log('类型：' + Object.keys(cards.kinds).map((k) => k + ' ' + ((cards.kinds[k] / cards.total) * 100).toFixed(1) + '%').join(' | '));
  console.log('换掉魔法槽：' + ((cards.magicChanged / Math.max(1, cards.total)) * 100).toFixed(1) + '%');
  const ids = Object.keys(cards.ids).sort((a, b) => cards.ids[b] - cards.ids[a]);
  console.log('最常见：' + ids.slice(0, 8).map((id) => id + ' ' + ((cards.ids[id] / cards.total) * 100).toFixed(1) + '%').join(' | '));

  console.log('\nJSON：' + path.join(__dirname, 'probe_unify.json'));
}

main();
