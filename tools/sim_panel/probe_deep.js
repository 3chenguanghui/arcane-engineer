/* ============================================================================
 * 深层回血探针（只读主文件，只改模拟器）
 * ----------------------------------------------------------------------------
 * 用途：在离线模拟器上补一层"逐层血线 + 回血来源 + 承伤分布"记账，
 * 用于回答"血是在哪一层被抽干的"。
 *
 * 用法：
 *   node tools/sim_panel/probe_deep.js --runs 10000
 *   node tools/sim_panel/probe_deep.js --runs 10000 --parity          # 实机口径
 *   node tools/sim_panel/probe_deep.js --runs 10000 --parity --plan A # 方案 A
 *
 * 产物：tools/sim_panel/probe_<label>.json（同时打印表格）
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

/* 方案表：只描述"在 parity 实机口径之上额外增加的回复"。
 * 数值先按设计稿填，跑完看结果再调。 */
const PLANS = {
  baseline: null,
  /* 现状对照：主文件 DEEP_HEAL_CONFIG.bossPulse 已在实机生效（F12/15/18/20，每掉 10% 回 19.8%）。
     模拟器旧版没建模，这里单独补上，用来量化「现有机制被模拟器漏算」的影响。 */
  CUR: { bossPulse: { enabled: true, fromFloor: 12, rhythmOnly: true, everyPct: 0.10, ratio: 0.198 } },
  A: { entry: { fromFloor: 13, ratio: 0.12 }, clear: { fromFloor: 13, ratio: 0.02 } },
  /* 上限探针：层间回加到 25% / 清房 +5%，看「再加血」能否救 F19/F20 房内暴毙。 */
  A2: { entry: { fromFloor: 13, ratio: 0.25 }, clear: { fromFloor: 13, ratio: 0.05 } },
  B: { killHeal: { fromFloor: 13, ratio: 0.012 } },
  /* 上限探针：每杀 4% / 精英房整体回 32% 最大生命。 */
  B2: { killHeal: { fromFloor: 13, ratio: 0.04 } },
  C: { bossPulse: { enabled: true, fromFloor: 13, everyPct: 0.15, ratio: 0.12 } },
  /* 方案 E：保留现有单口数值（每 10% 回 19.8%），只把触发层从「F12/15/18/20」放开到 F13 起每层。 */
  E: { bossPulse: { enabled: true, fromFloor: 13, everyPct: 0.10, ratio: 0.198, rhythmOnly: false } },
  D: {
    entry: { fromFloor: 13, ratio: 0.08 },
    clear: { fromFloor: 13, ratio: 0.015 },
    killHeal: { fromFloor: 13, ratio: 0.008 },
    bossPulse: { enabled: true, fromFloor: 13, everyPct: 0.15, ratio: 0.08 }
  }
};

/**
 * 解析命令行参数。
 * @returns {Object} 参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { runs: 10000, difficulty: 'normal', seed: C.SIM_PARAMS.baseSeed, parity: false, plan: 'baseline', workers: 1 };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--runs') out.runs = Math.max(100, parseInt(args[++i], 10));
    else if (a === '--difficulty') out.difficulty = args[++i];
    else if (a === '--seed') out.seed = parseInt(args[++i], 10);
    else if (a === '--plan') out.plan = args[++i];
    else if (a === '--parity') out.parity = true;
    else if (a === '--out') out.out = args[++i];
  }
  return out;
}

/**
 * 创建逐层记账器。
 * @returns {Object} 记账器
 */
function createTraceAgg() {
  const floors = {};
  for (let f = 1; f <= 20; f += 1) {
    floors[f] = {
      reach: 0, death: 0, deathBoss: 0, deathElite: 0, deathBattle: 0,
      hpIn: 0, hpAfterEntry: 0, hpOut: 0, hpOutN: 0, hpMin: 0,
      dmg: 0, dmgBoss: 0,
      healEntry: 0, healCombatRoom: 0, healCombatBoss: 0,
      healKill: 0, healPulse: 0, healClear: 0, healElite: 0,
      healRest: 0, healEvent: 0,
      hpMinHist: new Array(24).fill(0)       // 0-240 生命，10 一档
    };
  }
  return { floors };
}

/**
 * 把一局的逐层记录并入记账器。
 * @param {Object} t 记账器
 * @param {Object} r 单局结果
 * @returns {void}
 */
function addTrace(t, r) {
  if (!r.floorTrace) return;
  r.floorTrace.forEach((x) => {
    const f = t.floors[x.floor];
    if (!f) return;
    f.reach += 1;
    f.hpIn += x.hpIn;
    f.hpAfterEntry += x.hpAfterEntry;
    f.hpMin += x.hpMin;
    f.dmg += x.dmg;
    f.dmgBoss += x.dmgBoss;
    f.healEntry += x.healEntry;
    f.healCombatRoom += x.healCombatRoom;
    f.healCombatBoss += x.healCombatBoss;
    f.healKill += x.healKill;
    f.healPulse += x.healPulse;
    f.healClear += x.healClear;
    f.healElite += x.healElite;
    f.healRest += x.healRest;
    f.healEvent += x.healEvent;
    if (x.died) {
      f.death += 1;
      if (x.deathRoom === 'boss') f.deathBoss += 1;
      else if (x.deathRoom === 'elite') f.deathElite += 1;
      else f.deathBattle += 1;
    } else { f.hpOut += x.hpOut; f.hpOutN += 1; }
    f.hpMinHist[Math.min(23, Math.floor(x.hpMin / 10))] += 1;
  });
}

/**
 * 直方图分位。
 * @param {Array<number>} hist 分箱
 * @param {number} bin 箱宽
 * @param {number} q 分位 0~1
 * @returns {number} 近似分位值
 */
function pct(hist, bin, q) {
  const total = hist.reduce((s, v) => s + v, 0);
  if (!total) return 0;
  const target = total * q;
  let acc = 0;
  for (let i = 0; i < hist.length; i += 1) {
    acc += hist[i];
    if (acc >= target) return i * bin + bin / 2;
  }
  return hist.length * bin;
}

/**
 * 把记账器压成可读报告。
 * @param {Object} t 记账器
 * @returns {Object} 报告
 */
function summarizeTrace(t) {
  const out = {};
  const sources = ['healEntry', 'healCombatRoom', 'healCombatBoss', 'healKill', 'healPulse', 'healClear', 'healElite', 'healRest', 'healEvent'];
  const global = {};
  sources.forEach((k) => { global[k] = 0; });
  for (let f = 1; f <= 20; f += 1) {
    const x = t.floors[f];
    if (!x.reach) continue;
    const healTotal = sources.reduce((s, k) => s + x[k], 0);
    const row = {
      floor: f, reach: x.reach, death: x.death, deathBoss: x.deathBoss, deathElite: x.deathElite, deathBattle: x.deathBattle,
      hpIn: x.hpIn / x.reach,
      hpAfterEntry: x.hpAfterEntry / x.reach,
      hpOut: x.hpOutN ? x.hpOut / x.hpOutN : 0,
      hpMin: x.hpMin / x.reach,
      hpMinP10: pct(x.hpMinHist, 10, 0.10),
      dmg: x.dmg / x.reach,
      dmgBoss: x.dmgBoss / x.reach,
      healTotal: healTotal / x.reach,
      healShare: {}
    };
    sources.forEach((k) => {
      row.healShare[k] = healTotal ? x[k] / healTotal : 0;
      global[k] += x[k];
    });
    out[f] = row;
  }
  const gTotal = sources.reduce((s, k) => s + global[k], 0);
  out.globalShare = {};
  sources.forEach((k) => { out.globalShare[k] = gTotal ? global[k] / gTotal : 0; });
  out.globalTotal = gTotal;
  return out;
}

/**
 * 主流程。
 * @returns {void}
 */
function main() {
  const opts = parseArgs();
  const plan = PLANS[opts.plan];
  if (plan === undefined) {
    console.error('未知方案：' + opts.plan + '，可选 ' + Object.keys(PLANS).join('/'));
    process.exit(1);
  }
  const ov = {};
  if (opts.parity) ov.healParity = true;
  if (plan) ov.healPlan = plan;
  const profileIds = ['novice', 'veteran', 'bot'];
  const aggs = {};
  profileIds.forEach((id) => { aggs[id] = sim.createAgg(); });
  const overall = sim.createAgg();
  const traceAgg = createTraceAgg();

  const t0 = Date.now();
  for (let i = 0; i < opts.runs; i += 1) {
    const profileId = profileIds[i % 3];
    const seed = sim.runSeed(opts.seed, i);
    const r = sim.runOne(seed, C.PROFILES[profileId], opts.difficulty, ov);
    sim.addRun(aggs[profileId], r);
    sim.addRun(overall, r);
    addTrace(traceAgg, r);
  }
  const ms = Date.now() - t0;
  const trace = summarizeTrace(traceAgg);

  /* 关键指标 */
  const runs = overall.runs;
  const rate = (f) => overall.cleared[f] / runs;
  const deathRoom = overall.deathRoom;
  const drTotal = deathRoom.battle + deathRoom.elite + deathRoom.boss || 1;
  const report = {
    meta: {
      label: opts.plan + (opts.parity ? '_parity' : '_raw'),
      runs: opts.runs, difficulty: opts.difficulty, seed: opts.seed,
      parity: opts.parity, plan, elapsedMs: ms
    },
    key: {
      pass5: rate(5),
      reach13: overall.reached[13] / runs,
      reach15: overall.reached[15] / runs,
      reach18: overall.reached[18] / runs,
      reach20: overall.reached[20] / runs,
      clear15: rate(15),
      clear18: rate(18),
      clear20: rate(20),
      avgFloor: overall.clearedFloors ? 0 : 0,
      deathBossShare: deathRoom.boss / drTotal,
      deathEliteShare: deathRoom.elite / drTotal,
      deathBattleShare: deathRoom.battle / drTotal
    },
    deathFloor: overall.deathFloor.slice(1, 21),
    profiles: {},
    trace
  };
  let avgFloor = 0;
  for (let f = 1; f <= 20; f += 1) avgFloor += overall.cleared[f] / runs;
  report.key.avgFloor = avgFloor;
  profileIds.forEach((id) => {
    const a = aggs[id];
    report.profiles[id] = {
      pass5: a.cleared[5] / a.runs,
      reach15: a.reached[15] / a.runs,
      reach20: a.reached[20] / a.runs,
      avgFloor: Array.from({ length: 20 }, (_, k) => a.cleared[k + 1] / a.runs).reduce((s, v) => s + v, 0),
      deathBoss: a.deathRoom.boss / (a.deathRoom.battle + a.deathRoom.elite + a.deathRoom.boss || 1)
    };
  });

  const outName = opts.out || ('probe_' + report.meta.label + '.json');
  fs.writeFileSync(path.join(__dirname, outName), JSON.stringify(report, null, 2), 'utf8');

  /* 控制台表格 */
  console.log('=== ' + report.meta.label + ' | ' + opts.runs + ' 局 | 普通难度 | ' + ms + 'ms ===');
  console.log('5层通关 ' + (report.key.pass5 * 100).toFixed(1) + '% | F15到达 ' + (report.key.reach15 * 100).toFixed(1)
    + '% | F18到达 ' + (report.key.reach18 * 100).toFixed(1) + '% | F20到达 ' + (report.key.reach20 * 100).toFixed(1)
    + '% | 平均层 ' + report.key.avgFloor.toFixed(2));
  console.log('死亡房型：首领 ' + (report.key.deathBossShare * 100).toFixed(1) + '% | 精英 ' + (report.key.deathEliteShare * 100).toFixed(1)
    + '% | 普通 ' + (report.key.deathBattleShare * 100).toFixed(1) + '%');
  console.log('\n层 | 到达 | 死亡 | 血入 | 进层后 | 血出 | 最低血 | p10最低 | 承伤 | 回血 | 回血/承伤');
  for (let f = 13; f <= 20; f += 1) {
    const r = trace[f];
    if (!r) continue;
    console.log([
      String(f).padStart(2),
      String(r.reach).padStart(5),
      String(r.death).padStart(4),
      r.hpIn.toFixed(1).padStart(5),
      r.hpAfterEntry.toFixed(1).padStart(6),
      r.hpOut.toFixed(1).padStart(5),
      r.hpMin.toFixed(1).padStart(6),
      r.hpMinP10.toFixed(0).padStart(6),
      r.dmg.toFixed(0).padStart(5),
      r.healTotal.toFixed(0).padStart(5),
      (r.dmg ? (r.healTotal / r.dmg).toFixed(2) : '0.00').padStart(6)
    ].join(' | '));
  }
  console.log('\n全局回血来源占比：');
  Object.keys(trace.globalShare).forEach((k) => {
    if (trace.globalShare[k] > 0.005) console.log('  ' + k + ' ' + (trace.globalShare[k] * 100).toFixed(1) + '%');
  });
  console.log('\nJSON：' + path.join(__dirname, outName));
}

main();
