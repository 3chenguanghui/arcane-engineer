/* ============================================================================
 * 两道墙探针：F19/F20 精英墙 + F2/F3 早期首领
 * ----------------------------------------------------------------------------
 * 用法：node tools/sim_panel/probe_wall.js --runs 10000
 * 产物：tools/sim_panel/probe_wall.json
 *
 * 只读主文件；全部通过 sim.runOne 的 overrides 做对照，不改正式数值路径。
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

/* 方案 C（上一轮已定） */
const C_PLAN = { bossPulse: { enabled: true, fromFloor: 13, everyPct: 0.15, ratio: 0.12 } };

/* 精英墙候选：全部从 F13 起，避免影响前期 */
const ELITE_SCENARIOS = {
  C_base: { healPlan: C_PLAN },
  EC6: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, countCap: 6 } },
  EC7: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, countCap: 7 } },
  EH115: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, hpMul: 1.15 } },
  EX6: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, clearKills: 6 } },
  EF50: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, weightMul: 0.5 } },
  EC5: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, countCap: 5 } },
  EHP10: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, hpMul: 1.0 } },
  ENO: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, weightMul: 0 } },
  EX5: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, clearKills: 5 } },
  EMIX_EXIT: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, hpMul: 1.15, clearKills: 5 } },
  EC6_EXIT: { healPlan: C_PLAN, eliteTune: { fromFloor: 13, countCap: 6, clearKills: 6 } },
  EC6_EH115: {
    healPlan: C_PLAN,
    eliteTune: { fromFloor: 13, countCap: 6, hpMul: 1.15 }
  }
};

/* 早期首领候选：不改伤害倍率，只测"强度/位置/起手手牌" */
const EARLY_SCENARIOS = {
  base: {},
  skipF2Boss: { bossSkipFloors: [2] },
  skipF2F3: { bossSkipFloors: [2, 3] },
  f2Hp75: { bossHpMulByFloor: { 2: 0.75 } },
  f2Hp50: { bossHpMulByFloor: { 2: 0.50 } },
  f2f3Hp: { bossHpMulByFloor: { 2: 0.75, 3: 0.85 } },
  f2Damage90: { bossDamageMulByFloor: { 2: 0.90 } },
  f2Damage80: { bossDamageMulByFloor: { 2: 0.80 } },
  startLv2: { startLevels: 1 },
  startLv3: { startLevels: 2 },
  f1bonus_f2d90: { startLevels: 1, bossDamageMulByFloor: { 2: 0.90 } },
  f1bonus_skipF2: { startLevels: 1, bossSkipFloors: [2] }
};

/**
 * 解析命令行。
 * @returns {Object} 参数
 */
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
 * 跑一组场景并返回聚合指标。
 * @param {Object} ov overrides
 * @param {Object} opts 运行参数
 * @param {boolean} collectBoss 是否收集 F1-F5 首领入场样本
 * @returns {Object} 指标
 */
function runScenario(ov, opts, collectBoss) {
  const profileIds = ['novice', 'veteran', 'bot'];
  const agg = sim.createAgg();
  const bossEntries = [];
  const eliteDeaths = [];
  for (let i = 0; i < opts.runs; i += 1) {
    const pid = profileIds[i % 3];
    const r = sim.runOne(sim.runSeed(opts.seed, i), C.PROFILES[pid], opts.difficulty, ov);
    sim.addRun(agg, r);
    if (collectBoss && r.bossEntries) bossEntries.push.apply(bossEntries, r.bossEntries);
    if (r.eliteDeaths && r.eliteDeaths.length) eliteDeaths.push.apply(eliteDeaths, r.eliteDeaths);
  }
  const n = opts.runs;
  const rate = (f) => agg.cleared[f] / n;
  const reach = (f) => agg.reached[f] / n;
  let avgFloor = 0;
  for (let f = 1; f <= 20; f += 1) avgFloor += rate(f);
  const floorDeaths = {};
  const floorEliteDeaths = {};
  bossEntries.forEach((b) => {
    if (b.died) floorDeaths[b.floor] = (floorDeaths[b.floor] || 0) + 1;
  });
  eliteDeaths.forEach((d) => {
    floorEliteDeaths[d.floor] = (floorEliteDeaths[d.floor] || 0) + 1;
  });
  const br = {
    pass5: rate(5),
    reach2: reach(2), reach3: reach(3), reach5: reach(5),
    reach15: reach(15), reach18: reach(18), reach20: reach(20),
    avgFloor,
    deathsF2: agg.deathFloor[2] || 0,
    deathsF3: agg.deathFloor[3] || 0,
    deathsF19: agg.deathFloor[19] || 0,
    deathsF20: agg.deathFloor[20] || 0,
    eliteDeathsF19: floorEliteDeaths[19] || 0,
    eliteDeathsF20: floorEliteDeaths[20] || 0,
    eliteDeathsAll: eliteDeaths.length,
    deathBossShare: agg.deathRoom.boss / (agg.deathRoom.battle + agg.deathRoom.elite + agg.deathRoom.boss || 1)
  };
  if (collectBoss) {
    br.bossBuild = {};
    [1, 2, 3].forEach((f) => {
      const list = bossEntries.filter((b) => b.floor === f);
      const died = list.filter((b) => b.died).length;
      const mag = list.reduce((s, b) => s + b.magics.length, 0) / Math.max(1, list.length);
      const tech = list.reduce((s, b) => s + b.techs.length, 0) / Math.max(1, list.length);
      const relic = list.reduce((s, b) => s + b.relics.length, 0) / Math.max(1, list.length);
      const lv = list.reduce((s, b) => s + b.level, 0) / Math.max(1, list.length);
      const hpR = list.reduce((s, b) => s + b.hp / b.hpMax, 0) / Math.max(1, list.length);
      const left = list.filter((b) => !b.died).reduce((s, b) => s + (b.hpLeft || 0), 0) / Math.max(1, list.length - died);
      const sec = list.reduce((s, b) => s + b.seconds, 0) / Math.max(1, list.length);
      br.bossBuild['F' + f] = {
        entries: list.length, died,
        deathRate: died / Math.max(1, list.length),
        avgLevel: lv, avgMagics: mag, avgTechs: tech, avgRelics: relic,
        avgHpRatio: hpR, avgHpLeftWin: left, avgSeconds: sec
      };
    });
  }
  return br;
}

/**
 * 主流程。
 * @returns {void}
 */
function main() {
  const opts = parseArgs();
  const report = { meta: { runs: opts.runs, difficulty: opts.difficulty }, elite: {}, early: {} };

  Object.keys(ELITE_SCENARIOS).forEach((name) => {
    report.elite[name] = runScenario(ELITE_SCENARIOS[name], opts, false);
  });
  Object.keys(EARLY_SCENARIOS).forEach((name) => {
    report.early[name] = runScenario(EARLY_SCENARIOS[name], opts, true);
  });

  fs.writeFileSync(path.join(__dirname, 'probe_wall.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('=== 一、F19/F20 精英墙（方案 C 之上，' + opts.runs + ' 局）===');
  console.log('场景 | F20到达 | 平均层 | F19死亡(精英) | F20死亡(精英) | 精英总死亡 | 5层通关');
  Object.keys(report.elite).forEach((k) => {
    const r = report.elite[k];
    console.log([
      k.padEnd(10),
      (r.reach20 * 100).toFixed(1) + '%',
      r.avgFloor.toFixed(2),
      r.deathsF19 + '(' + r.eliteDeathsF19 + ')',
      r.deathsF20 + '(' + r.eliteDeathsF20 + ')',
      r.eliteDeathsAll,
      (r.pass5 * 100).toFixed(1) + '%'
    ].join(' | '));
  });

  console.log('\n=== 二、F2/F3 早期首领（' + opts.runs + ' 局）===');
  console.log('场景 | 5层通关 | F2到达 | F3到达 | F2死 | F3死 | 平均层 | F2首领胜率 | F3首领胜率');
  Object.keys(report.early).forEach((k) => {
    const r = report.early[k];
    console.log([
      k.padEnd(12),
      (r.pass5 * 100).toFixed(1) + '%',
      (r.reach2 * 100).toFixed(1) + '%',
      (r.reach3 * 100).toFixed(1) + '%',
      r.deathsF2,
      r.deathsF3,
      r.avgFloor.toFixed(2),
      ((1 - r.bossBuild.F2.deathRate) * 100).toFixed(1) + '%',
      ((1 - r.bossBuild.F3.deathRate) * 100).toFixed(1) + '%'
    ].join(' | '));
  });

  console.log('\n=== 三、玩家到 F2/F3 时的 build（基线）===');
  const b = report.early.base.bossBuild;
  [1, 2, 3].forEach((f) => {
    const x = b['F' + f];
    console.log('F' + f + '：等级 ' + x.avgLevel.toFixed(1) + ' | 魔法 ' + x.avgMagics.toFixed(1)
      + ' 张 | 科技 ' + x.avgTechs.toFixed(2) + ' | 遗物 ' + x.avgRelics.toFixed(2)
      + ' | 入场血量 ' + (x.avgHpRatio * 100).toFixed(0) + '% | 首领胜率 ' + ((1 - x.deathRate) * 100).toFixed(1)
      + '% | 平均战斗 ' + x.avgSeconds.toFixed(0) + 's');
  });
  console.log('\nJSON：' + path.join(__dirname, 'probe_wall.json'));
}

main();
