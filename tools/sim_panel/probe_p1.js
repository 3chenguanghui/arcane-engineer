/* ============================================================================
 * P1 / P2 探针：首领死亡剩余血量分布 + 单层改动验证 + 正控
 * ----------------------------------------------------------------------------
 * 三种模式：
 *   --mode dist                          死亡时首领剩余血量分布（F2/F3，A/A′）
 *   --mode p1 --floor 2 --scale 0.85     只缩放指定层首领血量（P1）
 *   --mode p2 --floor 2 --heal 0.25      只给指定层首领房入场补给（P2）
 *
 * 楼层参数：
 *   --floor 2        单层
 *   --floor 2,3      多层（同一倍率/补给比例）
 *   --floor all      F1–F20 全部生效（正控用：新判据必须判失败）
 *   --scales 2:0.85,3:0.88   逐层不同倍率（合并总账用）
 *
 * 漏层判据（并列两条）：
 *   主判据：F4–F10 逐层 `avgBossSec` 偏差 ≤ 0.5s（variance 必须落在作用层内）
 *   副判据：逐层报 `bossDeaths` 具体人数 + 按进入人数算的死亡率
 *
 * 用法：
 *   node tools/sim_panel/probe_p1.js --mode dist --runs 10000
 *   node tools/sim_panel/probe_p1.js --mode p1 --floor 2 --scale 0.85 --runs 10000
 *   node tools/sim_panel/probe_p1.js --mode p1 --floor all --scale 0.85 --runs 10000   # 正控
 *   node tools/sim_panel/probe_p1.js --mode p1 --scales 2:0.85,3:0.88 --runs 10000     # 合并总账
 *   node tools/sim_panel/probe_p1.js --mode p2 --floor 2 --heal 0.25 --runs 10000
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
  const o = {
    runs: 10000, mode: 'dist', floor: '2', scale: 0.85, heal: 0.25, scales: null,
    difficulty: 'normal', seed: C.SIM_PARAMS.baseSeed
  };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (a[i] === '--mode') o.mode = a[++i];
    else if (a[i] === '--floor') o.floor = a[++i];
    else if (a[i] === '--scale') o.scale = parseFloat(a[++i]);
    else if (a[i] === '--heal') o.heal = parseFloat(a[++i]);
    else if (a[i] === '--scales') o.scales = a[++i];
    else if (a[i] === '--difficulty') o.difficulty = a[++i];
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
  }
  return o;
}

/**
 * 把 --floor 解析成楼层数组。
 * @param {string} spec 单个楼层 / 逗号列表 / 'all'
 * @returns {Array<number>}
 */
function floorList(spec) {
  if (!spec || spec === 'all') return Array.from({ length: 20 }, (_, i) => i + 1);
  return String(spec).split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n));
}

/**
 * 生成"层 → 值"映射：有 --scales 时按逐层值，否则所有 --floor 用同一个值。
 * @param {Object} opts 命令行
 * @param {string} key 'scale' | 'heal'，决定默认值来源
 * @returns {Object} { floor: value }
 */
function buildFloorMap(opts, key) {
  const map = {};
  if (opts.scales) {
    String(opts.scales).split(',').forEach((pair) => {
      const parts = pair.split(':');
      const f = parseInt(parts[0], 10);
      const v = parseFloat(parts[1]);
      if (Number.isInteger(f) && Number.isFinite(v)) map[f] = v;
    });
    return map;
  }
  const v = key === 'heal' ? opts.heal : opts.scale;
  floorList(opts.floor).forEach((f) => { map[f] = v; });
  return map;
}

/** 是否到达 F20。 */
function reached20(r) {
  return !r.died || r.deathFloor >= 20;
}

/**
 * 跑一个场景并聚合。
 * @param {Object} ov 覆盖参数
 * @param {Object} opts 命令行
 * @param {Array<number>} focusFloors 需要收集"首领死亡时剩余血量"的楼层
 */
function collect(ov, opts, focusFloors) {
  const ids = ['novice', 'veteran', 'bot'];
  const FL = 10;
  const floors = {};
  for (let f = 1; f <= FL; f += 1) {
    floors[f] = {
      entries: 0, deaths: 0, cleared: 0, bossDeaths: 0, bossFights: 0,
      sumBoss: 0, sumEntryHp: 0, nEntryHp: 0
    };
  }
  const dist = {};   // floor -> [剩余血量百分比]
  focusFloors.forEach((f) => { dist[f] = []; });
  let pass5 = 0; let pass10 = 0; let reach20n = 0;

  for (let i = 0; i < opts.runs; i += 1) {
    const pid = ids[i % 3];
    const r = sim.runOne(sim.runSeed(opts.seed, i), C.PROFILES[pid], opts.difficulty, ov);
    if (r.clearedFloors >= 5) pass5 += 1;
    if (r.clearedFloors >= 10) pass10 += 1;
    if (reached20(r)) reach20n += 1;
    for (let f = 1; f <= FL; f += 1) {
      const s = floors[f];
      if (r.clearedFloors >= f - 1) s.entries += 1;
      if (r.clearedFloors >= f) s.cleared += 1;
      if (r.died && r.deathFloor === f) s.deaths += 1;
      const t = r.floorTrace[f - 1];
      if (t && t.boss) {
        s.bossFights += 1;
        s.sumBoss += t.boss.seconds || 0;
        if (t.boss.entryHp != null) { s.sumEntryHp += t.boss.entryHp; s.nEntryHp += 1; }
      }
      if (t && t.boss && t.boss.died) s.bossDeaths += 1;
      if (focusFloors.includes(f) && r.died && r.deathFloor === f && r.deathRoom === 'boss') {
        const b = t && t.boss;
        if (b && typeof b.bossHpLeftPct === 'number') dist[f].push(b.bossHpLeftPct);
      }
    }
  }
  Object.keys(floors).forEach((f) => {
    const s = floors[f];
    s.avgBossSec = +(s.sumBoss / Math.max(1, s.bossFights)).toFixed(1);
    s.deathRatePct = +(s.deaths / Math.max(1, s.entries) * 100).toFixed(1);
    s.bossDeathRatePct = +(s.bossDeaths / Math.max(1, s.entries) * 100).toFixed(1);
    s.avgEntryHp = s.nEntryHp ? +(s.sumEntryHp / s.nEntryHp).toFixed(1) : null;
  });
  return {
    floors, dist,
    pass5Pct: +(pass5 / opts.runs * 100).toFixed(1),
    pass10Pct: +(pass10 / opts.runs * 100).toFixed(1),
    reach20Pct: +(reach20n / opts.runs * 100).toFixed(1)
  };
}

/** 打印剩余血量分布。 */
function printDist(name, dist) {
  const BINS = [[0, 2], [2, 5], [5, 10], [10, 20], [20, 30], [30, 50], [50, 101]];
  [2, 3].forEach((f) => {
    const xs = dist[f] || [];
    if (!xs.length) return;
    const n = xs.length;
    console.log('\n' + name + ' · F' + f + ' 首领死亡时剩余血量（n=' + n + '）');
    console.log('区间       人数    占比   累计');
    let cum = 0;
    BINS.forEach(([lo, hi]) => {
      const c = xs.filter((v) => v >= lo && v < hi).length;
      cum += c;
      console.log((lo + '–' + (hi === 101 ? '100' : hi) + '%').padEnd(11)
        + String(c).padEnd(7) + (c / n * 100).toFixed(1).padStart(5) + '%  '
        + (cum / n * 100).toFixed(1) + '%');
    });
    const mean = xs.reduce((s, v) => s + v, 0) / n;
    const med = xs.slice().sort((a, b) => a - b)[Math.floor(n / 2)];
    console.log('均值 ' + mean.toFixed(1) + '%  中位 ' + med.toFixed(1) + '%'
      + '  ≤5%: ' + (xs.filter((v) => v <= 5).length / n * 100).toFixed(1) + '%'
      + '  ≤10%: ' + (xs.filter((v) => v <= 10).length / n * 100).toFixed(1) + '%'
      + '  ≤12%: ' + (xs.filter((v) => v <= 12).length / n * 100).toFixed(1) + '%');
  });
}

/**
 * 漏层主判据：给定层段逐层比较 avgBossSec，偏差 > 0.5s 即判 FAIL。
 * 正控（全楼层生效）必须在 F4–F10 上判 FAIL，用来证明判据没有被架空。
 * @param {Object} b 基线聚合
 * @param {Object} p 改后聚合
 * @param {Array<number>} checkFloors 要检查的层（默认 F4–F10）
 * @returns {Object} { pass, worst, worstF }
 */
function leakVerdict(b, p, checkFloors) {
  const floors = checkFloors || [4, 5, 6, 7, 8, 9, 10];
  let worst = 0; let worstF = 0;
  floors.forEach((f) => {
    if (!b.floors[f] || !p.floors[f]) return;
    const delta = Math.abs((p.floors[f].avgBossSec || 0) - (b.floors[f].avgBossSec || 0));
    if (delta > worst) { worst = delta; worstF = f; }
  });
  return { pass: worst <= 0.5, worst: +worst.toFixed(2), worstF };
}

/**
 * 打印一组"基线 vs 改后"对照：三个通关数 + 逐层人数 + 漏层判定。
 * @param {string} label 场景名
 * @param {Object} b 基线标记
 * @param {Object} p 改后
 * @param {string} mode 探针模式（p2 时追加入场 HP 行）
 */
function printCompare(label, b, p, mode) {
  console.log('\n=== ' + label + ' ===');
  console.log('5 层参考 ' + b.pass5Pct + '% → ' + p.pass5Pct + '%'
    + ' | 10 层 ' + b.pass10Pct + '% → ' + p.pass10Pct + '%'
    + ' | F20 ' + b.reach20Pct + '% → ' + p.reach20Pct + '%');
  console.log('层   基线死 改后死 净减 | 首领死(基/改/净减) | 首领战s(基/改) | 死亡率%(基/改) | 首领死亡率%(基/改)');
  for (let f = 1; f <= 10; f += 1) {
    const x = b.floors[f];
    const y = p.floors[f];
    console.log(String('F' + f).padEnd(4)
      + String(x.deaths).padEnd(7) + String(y.deaths).padEnd(7)
      + String(x.deaths - y.deaths).padEnd(5) + '| '
      + (x.bossDeaths + '/' + y.bossDeaths + '/' + (x.bossDeaths - y.bossDeaths)).padEnd(18) + '| '
      + (x.avgBossSec + '/' + y.avgBossSec).padEnd(14) + '| '
      + (x.deathRatePct + '/' + y.deathRatePct).padEnd(12) + '| '
      + (x.bossDeathRatePct + '/' + y.bossDeathRatePct));
  }
  const v = leakVerdict(b, p);
  console.log('漏层主判据（F4–F10 avgBossSec 偏差 ≤0.5s）：' + (v.pass ? 'PASS' : 'FAIL')
    + '  最大偏差 ' + v.worst + 's @F' + v.worstF);
  if (mode === 'p2') {
    [2, 3].forEach((f) => {
      if (b.floors[f].avgEntryHp != null && p.floors[f].avgEntryHp != null) {
        console.log('F' + f + ' 入场 HP 均值（基/改）：' + b.floors[f].avgEntryHp + ' / '
          + p.floors[f].avgEntryHp + '（样本 ' + b.floors[f].nEntryHp + ' / ' + p.floors[f].nEntryHp + '）');
      }
    });
  }
}

/** 主流程。 */
function main() {
  const opts = parseArgs();
  const res = { meta: opts, scenarios: {} };

  if (opts.mode === 'dist') {
    const scen = [
      { name: 'A 基线', ov: {} },
      { name: 'A′ 基线', ov: { eliteMandatory: MANDATORY } }
    ];
    scen.forEach((sc) => {
      const r = collect(sc.ov, opts, [2, 3]);
      res.scenarios[sc.name] = r;
      printDist(sc.name, r.dist);
    });
  } else {
    const isP2 = opts.mode === 'p2';
    const map = buildFloorMap(opts, isP2 ? 'heal' : 'scale');
    const ov = isP2 ? { bossEntryHealFracByFloor: map } : { bossHpScaleByFloor: map };
    const applied = Object.keys(map).map((f) => 'F' + f + '=' + map[f]).join(' ');
    const label = (isP2 ? 'P2 首领房入场补给' : 'P1 首领血量缩放') + ' [' + applied + ']';
    const scen = [
      { name: 'A 基线', ov: {}, cal: 'A' },
      { name: 'A 改后', ov, cal: 'A' },
      { name: 'A′ 基线', ov: { eliteMandatory: MANDATORY }, cal: 'A′' },
      { name: 'A′ 改后', ov: Object.assign({ eliteMandatory: MANDATORY }, ov), cal: 'A′' }
    ];
    scen.forEach((sc) => { res.scenarios[sc.name] = collect(sc.ov, opts, []); });

    ['A', 'A′'].forEach((cal) => {
      printCompare(label + ' · 口径 ' + cal, res.scenarios[cal + ' 基线'], res.scenarios[cal + ' 改后'], opts.mode);
    });
  }

  const tag = (opts.scales ? 'combo' : String(opts.floor).replace(/,/g, '-'));
  const out = path.join(__dirname, 'probe_p1_' + opts.mode + '_' + tag + '.json');
  fs.writeFileSync(out, JSON.stringify(res, null, 2));
  console.log('\n产物: ' + out);
}

main();
