/* ============================================================================
 * F1–F20 首领有效血量 & 终局体验探针（只量不改）
 * ----------------------------------------------------------------------------
 * 输出三件事：
 *   1) 逐层首领有效血量表（A 口径 / 普通档），标出闸门层、区末层、深层倍率；
 *   2) F18/F19/F20 首领战平均时长、死亡时剩余血量分布；
 *   3) 把 F20 的 0.55 闸门抬到指定值后的总账（10 层 / F20 到达 / F20 首领战时长）。
 *
 * 用法：
 *   node tools/sim_panel/probe_f20.js --gate 0.55 --runs 10000   # 基线
 *   node tools/sim_panel/probe_f20.js --gate 0.7  --runs 10000
 *   node tools/sim_panel/probe_f20.js --gate 0.85 --runs 10000
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
  const o = { runs: 10000, gate: 0.55, difficulty: 'normal', seed: C.SIM_PARAMS.baseSeed };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (a[i] === '--gate') o.gate = parseFloat(a[++i]);
    else if (a[i] === '--difficulty') o.difficulty = a[++i];
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
  }
  return o;
}

/**
 * 用模拟器的 bossStats 复算 F1–F20 首领有效血量。
 * 基线 = 主文件同款公式；指定 gate 时把 F20 的 cap 改成 5632×gate。
 * @param {number} gate F20 闸门系数
 * @returns {Array<Object>} 逐层 { floor, hp }
 */
function hpTable(gate) {
  const rows = [];
  for (let f = 1; f <= 20; f += 1) {
    let ov = {};
    if (f === 20 && gate !== 0.55) {
      /* 5632 = hpCap 3200 × (1 + 0.04×19)；用 cap 覆盖等价于改闸门系数 */
      ov = { bossCapByFloor: { 20: C.BOSS.hpCap * (1 + C.BOSS.hpCapRampPerFloor * 19) * gate } };
    }
    const st = sim.bossStats(f, C.DIFFICULTY[optsDifficulty()], ov);
    rows.push({ floor: f, hp: st.hp });
  }
  return rows;
}

/** 难度 id（hpTable 需要对象）。 */
function optsDifficulty() {
  return 'normal';
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
    floors[f] = { entries: 0, deaths: 0, cleared: 0, bossFights: 0, bossDeaths: 0, sumBoss: 0, timeouts: 0 };
  }
  const hpLeft = { 18: [], 19: [], 20: [] };
  const bossSec = { 18: [], 19: [], 20: [] };
  let pass10 = 0; let reach20 = 0; let clear20 = 0;

  for (let i = 0; i < runs; i += 1) {
    const r = sim.runOne(sim.runSeed(seed, i), C.PROFILES[ids[i % 3]], 'normal', ov);
    if (r.clearedFloors >= 10) pass10 += 1;
    if (!r.died || r.deathFloor >= 20) reach20 += 1;
    if (r.clearedFloors >= 20) clear20 += 1;
    for (let f = 1; f <= 20; f += 1) {
      const s = floors[f];
      if (r.clearedFloors >= f - 1) s.entries += 1;
      if (r.clearedFloors >= f) s.cleared += 1;
      if (r.died && r.deathFloor === f) s.deaths += 1;
      const t = r.floorTrace[f - 1];
      if (t && t.boss) {
        s.bossFights += 1;
        s.sumBoss += t.boss.seconds || 0;
        if (t.boss.died) s.bossDeaths += 1;
        if (t.boss.timedOut) s.timeouts += 1;
        if (f >= 18) {
          bossSec[f].push(t.boss.seconds || 0);
          if (t.boss.died && typeof t.boss.bossHpLeftPct === 'number') hpLeft[f].push(t.boss.bossHpLeftPct);
        }
      }
    }
  }
  Object.keys(floors).forEach((f) => {
    const s = floors[f];
    s.avgBossSec = +(s.sumBoss / Math.max(1, s.bossFights)).toFixed(1);
    s.deathRatePct = +(s.deaths / Math.max(1, s.entries) * 100).toFixed(1);
  });
  const pct = (arr, p) => (arr.length ? arr.slice().sort((x, y) => x - y)[Math.floor(arr.length * p)] : null);
  const stat = (arr) => {
    if (!arr.length) return null;
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    return {
      n: arr.length, avg: +avg.toFixed(1),
      p50: +pct(arr, 0.5).toFixed(1), p95: +pct(arr, 0.95).toFixed(1),
      max: +Math.max.apply(null, arr).toFixed(1)
    };
  };
  const hpStat = (arr) => {
    if (!arr.length) return null;
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    const bins = [[0, 5], [5, 10], [10, 20], [20, 30], [30, 50], [50, 101]].map(([lo, hi]) => ({
      lo, hi: Math.min(hi, 100),
      pct: +(arr.filter((v) => v >= lo && v < hi).length / arr.length * 100).toFixed(1)
    }));
    return {
      n: arr.length, avg: +avg.toFixed(1), p50: +pct(arr, 0.5).toFixed(1), bins,
      le5: +(arr.filter((v) => v <= 5).length / arr.length * 100).toFixed(1),
      le10: +(arr.filter((v) => v <= 10).length / arr.length * 100).toFixed(1),
      le12: +(arr.filter((v) => v <= 12).length / arr.length * 100).toFixed(1)
    };
  };
  return {
    floors, pass10Pct: +(pass10 / runs * 100).toFixed(1),
    reach20Pct: +(reach20 / runs * 100).toFixed(1),
    clear20Pct: +(clear20 / runs * 100).toFixed(1),
    bossSec18: stat(bossSec[18]), bossSec19: stat(bossSec[19]), bossSec20: stat(bossSec[20]),
    hpLeft18: hpStat(hpLeft[18]), hpLeft19: hpStat(hpLeft[19]), hpLeft20: hpStat(hpLeft[20])
  };
}

/** 打印逐层有效血量表，标出闸门/区末/深层。 */
function printHpTable(gate) {
  const rows = hpTable(gate);
  console.log('\n=== 逐层首领有效血量（普通档 / A 口径） ===');
  console.log('层   有效血量   环比      标记');
  rows.forEach((r, idx) => {
    const prev = idx ? rows[idx - 1].hp : null;
    const delta = prev ? ((r.hp / prev - 1) * 100).toFixed(1) + '%' : '—';
    const marks = [];
    if (r.floor === 20) marks.push('75s 闸门 ×' + gate);
    if (r.floor % 6 === 0) marks.push('区末 ×1.15');
    if (r.floor >= 19) marks.push('深层 ×1.1');
    console.log(String('F' + r.floor).padEnd(4) + String(r.hp).padEnd(10)
      + delta.padEnd(9) + marks.join(' / '));
  });
}

/** 主流程。 */
function main() {
  const opts = parseArgs();
  printHpTable(opts.gate);

  /* 指定 gate 不是 0.55 时，用 cap 覆盖等价替换 F20 闸门 */
  const capBase = C.BOSS.hpCap * (1 + C.BOSS.hpCapRampPerFloor * 19);
  const ov = (opts.gate === 0.55) ? {} : { bossCapByFloor: { 20: capBase * opts.gate } };
  const out = { meta: opts, scenarios: {} };
  const scen = [
    { name: 'A', ov: ov },
    { name: 'A′', ov: Object.assign({ eliteMandatory: MANDATORY }, ov) }
  ];
  scen.forEach((sc) => {
    out.scenarios[sc.name] = collect(sc.ov, opts.runs, opts.seed);
  });

  ['A', 'A′'].forEach((cal) => {
    const s = out.scenarios[cal];
    console.log('\n=== F20 闸门 ' + opts.gate + ' · 口径 ' + cal + ' ===');
    console.log('10 层 ' + s.pass10Pct + '% | F20 到达 ' + s.reach20Pct + '% | F20 通关 ' + s.clear20Pct + '%');
    console.log('层 首领战(秒) 均值/P50/P95/最大 | 首领死/进入 | 死亡时剩血 均值/中位 | ≤5% ≤10% ≤12%');
    [18, 19, 20].forEach((f) => {
      const sec = s['bossSec' + f];
      const hp = s['hpLeft' + f];
      const fl = s.floors[f];
      if (!sec) { console.log('F' + f + ' 无样本'); return; }
      console.log('F' + f + ' ' + sec.avg + '/' + sec.p50 + '/' + sec.p95 + '/' + sec.max
        + ' | ' + fl.bossDeaths + '/' + fl.entries
        + ' | ' + (hp ? hp.avg + '/' + hp.p50 : '-')
        + ' | ' + (hp ? hp.le5 + ' ' + hp.le10 + ' ' + hp.le12 : '-'));
    });
  });

  const outPath = path.join(__dirname, 'probe_f20_gate' + String(opts.gate).replace('.', '') + '.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\n产物: ' + outPath);
}

main();
