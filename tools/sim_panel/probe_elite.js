/* ============================================================================
 * 精英墙探针：F19/F20 精英房死亡的时间结构
 * ----------------------------------------------------------------------------
 * 回答一个问题：这些死在精英房的人里，有多少是"进场 3 秒内就没机会动"。
 *
 * 用法：node tools/sim_panel/probe_elite.js --runs 10000
 * 产物：tools/sim_panel/probe_elite.json
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

/* 与 probe_deep.js 方案 C 保持一致 */
const PLAN_C = { bossPulse: { enabled: true, fromFloor: 13, everyPct: 0.15, ratio: 0.12 } };

/**
 * 解析参数。
 * @returns {Object} {runs, difficulty, seed}
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
 * 计算分位。
 * @param {Array<number>} arr 已排序数组
 * @param {number} q 0~1
 * @returns {number} 分位值
 */
function q(arr, p) {
  if (!arr.length) return 0;
  const i = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)));
  return arr[i];
}

/**
 * 按层汇总精英死亡样本。
 * @param {Array<Object>} samples 样本
 * @param {number} floor 层
 * @returns {Object} 汇总
 */
function summarize(samples, floor) {
  const list = samples.filter((s) => s.floor === floor);
  const combatTimes = list.map((s) => Math.max(0, s.deathTime - C.SIM_PARAMS.approachSeconds));
  const ttds = list.map((s) => (s.entryNetDps > 0 ? s.entryHp / s.entryNetDps : 999));
  combatTimes.sort((a, b) => a - b);
  ttds.sort((a, b) => a - b);
  const buckets = [1, 3, 5, 10, 20];
  const out = {
    floor, deaths: list.length,
    deathTimeMedian: q(combatTimes, 0.5),
    deathTimeP25: q(combatTimes, 0.25),
    deathTimeP75: q(combatTimes, 0.75),
    ttdMedian: q(ttds, 0.5),
    ttdP25: q(ttds, 0.25),
    zeroKill: list.filter((s) => (s.killed || 0) === 0).length,
    timeout: list.filter((s) => s.deathTime >= C.SIM_PARAMS.maxRoomSeconds - 0.2).length,
    killedMedian: q(list.map((s) => s.killed || 0).sort((a, b) => a - b), 0.5),
    zeroKillWithin3s: list.filter((s) => (s.killed || 0) === 0 && Math.max(0, s.deathTime - C.SIM_PARAMS.approachSeconds) <= 3).length,
    buckets: {},
    avgEntryHpRatio: 0,
    avgIncoming: 0,
    avgNetDps: 0,
    avgEnemyCount: 0,
    avgTotalHp: 0,
    rangedMix: 0,
    magics: {},
    techs: {},
    profiles: {},
    comps: {}
  };
  buckets.forEach((b) => {
    out.buckets['<=' + b + 's'] = {
      deathTime: list.filter((s) => Math.max(0, s.deathTime - C.SIM_PARAMS.approachSeconds) <= b).length,
      ttd: list.filter((s) => (s.entryNetDps > 0 ? s.entryHp / s.entryNetDps : 999) <= b).length
    };
  });
  list.forEach((s) => {
    out.avgEntryHpRatio += s.entryHp / Math.max(1, s.hpMax);
    out.avgIncoming += s.entryIncoming;
    out.avgNetDps += s.entryNetDps;
    out.avgEnemyCount += s.enemyCount;
    out.avgTotalHp += s.totalHp;
    out.rangedMix += s.mix.ranged;
    (s.magics || []).forEach((m) => { out.magics[m] = (out.magics[m] || 0) + 1; });
    (s.techs || []).forEach((k) => { out.techs[k] = (out.techs[k] || 0) + 1; });
    out.profiles[s.profile] = (out.profiles[s.profile] || 0) + 1;
    const key = 'melee' + Math.round(s.mix.melee * 100) + '/ranged' + Math.round(s.mix.ranged * 100);
    out.comps[key] = (out.comps[key] || 0) + 1;
  });
  const n = Math.max(1, list.length);
  out.avgEntryHpRatio /= n;
  out.avgIncoming /= n;
  out.avgNetDps /= n;
  out.avgEnemyCount /= n;
  out.avgTotalHp /= n;
  out.rangedMix /= n;
  out.shares = {
    deathWithin3s: list.length ? out.buckets['<=3s'].deathTime / list.length : 0,
    deathWithin5s: list.length ? out.buckets['<=5s'].deathTime / list.length : 0,
    ttdWithin3s: list.length ? out.buckets['<=3s'].ttd / list.length : 0,
    ttdWithin5s: list.length ? out.buckets['<=5s'].ttd / list.length : 0,
    zeroKill: list.length ? out.zeroKill / list.length : 0,
    timeout: list.length ? out.timeout / list.length : 0
  };
  return out;
}

/**
 * 主流程。
 * @returns {void}
 */
function main() {
  const opts = parseArgs();
  const profileIds = ['novice', 'veteran', 'bot'];
  const samples = [];
  for (let i = 0; i < opts.runs; i += 1) {
    const pid = profileIds[i % 3];
    const r = sim.runOne(sim.runSeed(opts.seed, i), C.PROFILES[pid], opts.difficulty, {
      healPlan: PLAN_C
    });
    if (r.eliteDeaths && r.eliteDeaths.length) {
      samples.push.apply(samples, r.eliteDeaths);
    }
  }
  const report = {
    meta: { runs: opts.runs, difficulty: opts.difficulty, plan: 'C', approachSeconds: C.SIM_PARAMS.approachSeconds },
    floors: {}
  };
  [18, 19, 20].forEach((f) => { report.floors[f] = summarize(samples, f); });
  /* 3 秒内死亡清单（只保留关键字段） */
  report.within3 = samples
    .filter((s) => s.floor >= 19 && Math.max(0, s.deathTime - C.SIM_PARAMS.approachSeconds) <= 3)
    .slice(0, 30);
  report.sampleCount = samples.length;
  fs.writeFileSync(path.join(__dirname, 'probe_elite.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('=== 精英房死亡时间结构（方案 C，' + opts.runs + ' 局）===');
  [18, 19, 20].forEach((f) => {
    const s = report.floors[f];
    if (!s.deaths) { console.log('F' + f + '：无精英死亡'); return; }
    console.log('\nF' + f + ' 精英死亡 ' + s.deaths + ' 人');
    console.log('  模型致死时间(扣4秒接敌)：中位 ' + s.deathTimeMedian.toFixed(1) + 's，P25 ' + s.deathTimeP25.toFixed(1) + 's，P75 ' + s.deathTimeP75.toFixed(1) + 's');
    console.log('  理论倒地时间(hp/净承伤)：中位 ' + s.ttdMedian.toFixed(1) + 's，P25 ' + s.ttdP25.toFixed(1) + 's');
    console.log('  3秒内死亡：模型 ' + (s.shares.deathWithin3s * 100).toFixed(1) + '% / 理论 ' + (s.shares.ttdWithin3s * 100).toFixed(1) + '%');
    console.log('  5秒内死亡：模型 ' + (s.shares.deathWithin5s * 100).toFixed(1) + '% / 理论 ' + (s.shares.ttdWithin5s * 100).toFixed(1) + '%');
    console.log('  零击杀死亡：' + (s.shares.zeroKill * 100).toFixed(1) + '%（其中3秒内 ' + s.zeroKillWithin3s + ' 人）');
    console.log('  超时(240s未清房)占比：' + (s.shares.timeout * 100).toFixed(1) + '% | 死亡时已击杀中位 ' + s.killedMedian + ' 只');
    console.log('  进场血量 ' + (s.avgEntryHpRatio * 100).toFixed(0) + '% | 入场承伤 ' + s.avgIncoming.toFixed(1) + '/s | 净承伤 ' + s.avgNetDps.toFixed(1) + '/s');
    console.log('  精英房敌人 ' + s.avgEnemyCount.toFixed(1) + ' 只 | 总血 ' + s.avgTotalHp.toFixed(0) + ' | 远程占比 ' + (s.rangedMix * 100).toFixed(0) + '%');
    console.log('  携带治疗卡占比 ' + (((s.magics.heal || 0) / s.deaths) * 100).toFixed(0) + '% | 相位甲 ' + (((s.techs.phase || 0) / s.deaths) * 100).toFixed(0) + '%');
    console.log('  人群：' + JSON.stringify(s.profiles));
  });
  console.log('\nJSON：' + path.join(__dirname, 'probe_elite.json'));
}

main();
