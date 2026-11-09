/* ============================================================================
 * 终局走廊探针（只量不改）
 * ----------------------------------------------------------------------------
 * 输出两件事：
 *   1) F10–F20 逐层「死亡/进入」+ 死因拆分（battle / elite / boss / other）；
 *   2) 对 F18/F19/F20 首领伤害 ×1.15 / ×1.3 的对照：
 *      每层死亡、首领战时长（看加伤会不会让时长反而下降）、10 层、F20 到达/通关。
 *
 * 用法：
 *   node tools/sim_panel/probe_endgame.js --dmg 1.0  --runs 10000   # 基线
 *   node tools/sim_panel/probe_endgame.js --dmg 1.15 --runs 10000
 *   node tools/sim_panel/probe_endgame.js --dmg 1.3  --runs 10000
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

const MANDATORY = { 2: 0.44, 3: 0.10, 4: 0.52, 5: 0.47 };
for (let f = 6; f <= 20; f += 1) MANDATORY[f] = 0.465;

/** 解析命令行。 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { runs: 10000, dmg: 1.0, seed: C.SIM_PARAMS.baseSeed };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (a[i] === '--dmg') o.dmg = parseFloat(a[++i]);
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
  }
  return o;
}

/**
 * 跑一个口径并聚合到 F20。
 * @param {Object} ov 覆盖参数
 * @param {number} runs 局数
 * @param {number} seed 种子
 */
function collect(ov, runs, seed) {
  const ids = ['novice', 'veteran', 'bot'];
  const floors = {};
  for (let f = 1; f <= 20; f += 1) {
    floors[f] = { entries: 0, deaths: 0, cleared: 0, bossDeaths: 0, bossFights: 0, sumBoss: 0, causes: {} };
  }
  let pass10 = 0; let reach20 = 0; let clear20 = 0;
  const bossSecEnd = { 18: [], 19: [], 20: [] };

  for (let i = 0; i < runs; i += 1) {
    const r = sim.runOne(sim.runSeed(seed, i), C.PROFILES[ids[i % 3]], 'normal', ov);
    if (r.clearedFloors >= 10) pass10 += 1;
    if (!r.died || r.deathFloor >= 20) reach20 += 1;     // 进入过 F20
    if (r.clearedFloors >= 20) clear20 += 1;             // 打完 F20
    for (let f = 1; f <= 20; f += 1) {
      const s = floors[f];
      if (r.clearedFloors >= f - 1) s.entries += 1;
      if (r.clearedFloors >= f) s.cleared += 1;
      if (r.died && r.deathFloor === f) {
        s.deaths += 1;
        const cause = r.deathRoom || 'other';
        s.causes[cause] = (s.causes[cause] || 0) + 1;
      }
      const t = r.floorTrace[f - 1];
      if (t && t.boss) {
        s.bossFights += 1;
        s.sumBoss += t.boss.seconds || 0;
        if (t.boss.died) s.bossDeaths += 1;
        if (f >= 18) bossSecEnd[f].push(t.boss.seconds || 0);
      }
    }
  }
  Object.keys(floors).forEach((f) => {
    const s = floors[f];
    s.avgBossSec = +(s.sumBoss / Math.max(1, s.bossFights)).toFixed(1);
    s.deathRatePct = +(s.deaths / Math.max(1, s.entries) * 100).toFixed(2);
  });
  const p50 = (arr) => (arr.length ? arr.slice().sort((x, y) => x - y)[Math.floor(arr.length * 0.5)] : null);
  return {
    floors,
    pass10Pct: +(pass10 / runs * 100).toFixed(1),
    reach20Pct: +(reach20 / runs * 100).toFixed(1),
    clear20Pct: +(clear20 / runs * 100).toFixed(1),
    reach20N: reach20, clear20N: clear20,
    bossSec18: { n: bossSecEnd[18].length, avg: +(bossSecEnd[18].reduce((s, v) => s + v, 0) / Math.max(1, bossSecEnd[18].length)).toFixed(1), p50: p50(bossSecEnd[18]) },
    bossSec19: { n: bossSecEnd[19].length, avg: +(bossSecEnd[19].reduce((s, v) => s + v, 0) / Math.max(1, bossSecEnd[19].length)).toFixed(1), p50: p50(bossSecEnd[19]) },
    bossSec20: { n: bossSecEnd[20].length, avg: +(bossSecEnd[20].reduce((s, v) => s + v, 0) / Math.max(1, bossSecEnd[20].length)).toFixed(1), p50: p50(bossSecEnd[20]) }
  };
}

/** 打印 F10–F20 致死率全表 + 死因。 */
function printCorridor(cal, s) {
  console.log('\n=== F10–F20 致死率（口径 ' + cal + '） ===');
  console.log('层   进入   死亡   死亡率    死因（battle/elite/boss/other）      首领死/进入   首领战均值(s)');
  for (let f = 10; f <= 20; f += 1) {
    const x = s.floors[f];
    const c = x.causes;
    const cause = 'battle ' + (c.battle || 0) + ' / elite ' + (c.elite || 0)
      + ' / boss ' + (c.boss || 0) + ' / other ' + (c.other || 0);
    console.log(String('F' + f).padEnd(4) + String(x.entries).padEnd(7) + String(x.deaths).padEnd(7)
      + String(x.deathRatePct + '%').padEnd(10) + cause.padEnd(38)
      + (x.bossDeaths + '/' + x.entries).padEnd(14) + x.avgBossSec);
  }
}

/** 主流程。 */
function main() {
  const opts = parseArgs();
  const ovEnd = (opts.dmg === 1.0)
    ? {}
    : { bossDamageMulByFloor: { 18: opts.dmg, 19: opts.dmg, 20: opts.dmg } };
  const out = { meta: opts, scenarios: {} };
  const scen = [
    { name: 'A', ov: ovEnd },
    { name: 'A′', ov: Object.assign({ eliteMandatory: MANDATORY }, ovEnd) }
  ];
  scen.forEach((sc) => { out.scenarios[sc.name] = collect(sc.ov, opts.runs, opts.seed); });

  ['A', 'A′'].forEach((cal) => {
    const s = out.scenarios[cal];
    printCorridor(cal, s);
    console.log('\n【' + cal + '】首领伤害 ×' + opts.dmg
      + ' ｜ 10 层 ' + s.pass10Pct + '%'
      + ' ｜ F20 到达 ' + s.reach20Pct + '%（' + s.reach20N + '/10000）'
      + ' ｜ F20 通关 ' + s.clear20Pct + '%（' + s.clear20N + '/10000）'
      + ' ｜ 到达−通关 = ' + (s.reach20N - s.clear20N) + ' 人（F20 死亡）');
    [18, 19, 20].forEach((f) => {
      const sec = s['bossSec' + f];
      const x = s.floors[f];
      console.log('  F' + f + ' 死亡 ' + x.deaths + '（首领 ' + (x.causes.boss || 0) + '）'
        + ' 首领死 ' + x.bossDeaths + ' 首领战 ' + sec.avg + 's / P50 ' + sec.p50 + 's');
    });
  });

  const outPath = path.join(__dirname, 'probe_endgame_dmg' + String(opts.dmg).replace('.', '') + '.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\n产物: ' + outPath);
}

main();
