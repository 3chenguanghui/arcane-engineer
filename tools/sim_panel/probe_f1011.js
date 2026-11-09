/* ============================================================================
 * F10 / F11 时段倒挂量化探针（只读模拟器，不碰主文件）
 * ----------------------------------------------------------------------------
 * 目的：
 *   1. 逐层给出「本层战斗总时长」（floorTrace.clearSeconds，含首领战）的
 *      P50 / P90 / P95 / max、标准差与中位数标准误，用于判断倒挂是否超出分辨力；
 *   2. 同层给出首领战时长分布与死亡人数 / 死亡率 / 死因，用来区分
 *      "是首领拖长" 还是 "是战斗房/精英房拖长"；
 *   3. 口径 A′（真实保底，主口径）与 A（历史口径）并排，各 10000 局。
 *
 * 口径说明：
 *   - 模拟器不建模「换房走路 + 转场动画 + 奖励弹窗」（真机占比约 35.9%，见 CUT_REPORT.md）。
 *     所以这里量的是「房内战斗时长」，比较层间相对差是有效的，绝对分钟数不等于真机。
 *   - 统计母体为「清空本层」的人（clearSeconds 才完整）；死亡样本单独计人数与死因，
 *     不与清层样本混入分位数，避免截断样本把长层拉短（生存者偏差）。
 *   - 中位数标准误按 SE ≈ 1.253 × σ / √n 估算；两层差值 < 2×合并SE 记为「不可分辨」。
 *
 * 用法：
 *   node tools/sim_panel/probe_f1011.js --runs 10000 --profile bot
 *   node tools/sim_panel/probe_f1011.js --runs 10000 --profile mix
 *   node tools/sim_panel/probe_f1011.js --runs 10000 --precut   # 改前对照（不压深层血）
 *
 * 产物：
 *   tools/sim_panel/probe_f1011_<profile>[_precut].json
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

/* 保底精英房「必经」概率（浏览器 970 层实测，见 E1_PATCH.md §1） */
const MANDATORY = { 2: 0.44, 3: 0.10, 4: 0.52, 5: 0.47 };
for (let f = 6; f <= 20; f += 1) MANDATORY[f] = 0.465;

/**
 * 解析命令行参数
 * @returns {Object} { runs, profile, seed }
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { runs: 10000, profile: 'bot', seed: C.SIM_PARAMS.baseSeed, precut: false };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (a[i] === '--profile') o.profile = a[++i];
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
    else if (a[i] === '--precut') o.precut = true;
  }
  return o;
}

/**
 * 某层的基准 cap（与主文件 bossHpCapForFloor 同式，不含 F20 的 0.55 闸门）
 * @param {number} floor 层数
 * @returns {number} 该层 cap
 */
function capAt(floor) {
  return C.BOSS.hpCap * (1 + (C.BOSS.hpCapRampPerFloor || 0) * (floor - 1));
}

/**
 * v1.6.1 主文件已落地的深层压血覆盖表（F12–F17 ×0.65 / F18 ×0.60 / F19 ×0.62）
 * @param {boolean} precut true = 改前对照，返回空表
 * @returns {Object} bossCapByFloor 覆盖
 */
function deepCuts(precut) {
  if (precut) return {};
  const cap = {};
  for (let f = 12; f <= 17; f += 1) cap[f] = Math.round(capAt(f) * 0.65);
  cap[18] = Math.round(capAt(18) * 0.60);
  cap[19] = Math.round(capAt(19) * 0.62);
  return { bossCapByFloor: cap };
}

/**
 * 升序数组取分位数（最近秩法）
 * @param {number[]} s 已升序数组
 * @param {number} p 0–1
 * @returns {number|null} 分位值
 */
function q(s, p) {
  if (!s.length) return null;
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * p)));
  return s[idx];
}

/**
 * 一组秒数的摘要（P50/P90/P95/max/均值/标准差/中位数标准误）
 * @param {number[]} arr 秒数
 * @returns {Object} 摘要
 */
function stat(arr) {
  if (!arr.length) return { n: 0 };
  const s = arr.slice().sort((x, y) => x - y);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1));
  const seMedian = 1.253 * sd / Math.sqrt(n);
  const over90 = s.filter((v) => v > 90).length;
  return {
    n,
    avg: +mean.toFixed(1),
    sd: +sd.toFixed(1),
    p50: q(s, 0.50),
    p90: q(s, 0.90),
    p95: q(s, 0.95),
    max: s[n - 1],
    over90,
    over90Pct: +(over90 / n * 100).toFixed(2),
    se: +seMedian.toFixed(2)
  };
}

/**
 * 跑一个口径（A′ 或 A），聚合逐层时长/死亡/首领数据
 * @param {Object} ov 覆盖参数
 * @param {number} runs 局数
 * @param {number} seed 种子
 * @param {string[]} ids 混用的 profile id 列表
 * @returns {Object} 逐层结果
 */
function collect(ov, runs, seed, ids) {
  const floors = {};
  for (let f = 1; f <= 20; f += 1) {
    floors[f] = {
      entries: 0, cleared: 0, deaths: 0, causes: {},
      clearSec: [], bossSec: [], bossDeaths: 0, bossFights: 0
    };
  }
  let pass10 = 0; let clear20 = 0;

  for (let i = 0; i < runs; i += 1) {
    const prof = C.PROFILES[ids[i % ids.length]];
    const r = sim.runOne(sim.runSeed(seed, i), prof, 'normal', ov);
    if (r.clearedFloors >= 10) pass10 += 1;
    if (r.clearedFloors >= 20) clear20 += 1;
    r.floorTrace.forEach((t) => {
      const x = floors[t.floor];
      x.entries += 1;
      if (t.died) {
        x.deaths += 1;
        const c = t.deathRoom || 'other';
        x.causes[c] = (x.causes[c] || 0) + 1;
      } else {
        x.cleared += 1;
        x.clearSec.push(t.clearSeconds);
      }
      if (t.boss) {
        x.bossFights += 1;
        if (t.boss.died) x.bossDeaths += 1;
        else if (!t.boss.timedOut) x.bossSec.push(t.boss.seconds);
      }
    });
  }

  const rows = {};
  for (let f = 1; f <= 20; f += 1) {
    const x = floors[f];
    rows[f] = {
      entries: x.entries,
      cleared: x.cleared,
      deaths: x.deaths,
      deathRatePct: +(x.deaths / Math.max(1, x.entries) * 100).toFixed(2),
      causes: x.causes,
      bossDeaths: x.bossDeaths,
      time: stat(x.clearSec),
      boss: stat(x.bossSec)
    };
  }
  return {
    floors: rows,
    pass10Pct: +(pass10 / runs * 100).toFixed(1),
    clear20Pct: +(clear20 / runs * 100).toFixed(1)
  };
}

/**
 * 把两层的中位数差算成「可分辨/不可分辨」
 * @param {Object} a 前一层 stat
 * @param {Object} b 后一层 stat
 * @returns {Object} { diff, se, verdict }
 */
function diffVerdict(a, b) {
  if (!a || !b || !a.n || !b.n) return { diff: null, se: null, verdict: '无样本' };
  const diff = +(b.p50 - a.p50).toFixed(1);
  const se = +Math.sqrt(a.se * a.se + b.se * b.se).toFixed(2);
  const verdict = Math.abs(diff) < 2 * se ? '不可分辨' : (diff > 0 ? '后层更长' : '后层更短');
  return { diff, se, verdict };
}

/**
 * 打印逐层表（F8–F14 重点 + 全表）
 * @param {string} cal 口径名
 * @param {Object} res collect 结果
 */
function printTable(cal, res) {
  console.log('\n=== 口径 ' + cal + ' · 逐层战斗时长（清层样本） ===');
  console.log('层   进入   清层   死亡  死亡率   均时    P50     P90     P95     max     >90(占比)      ±SE    死因(battle/elite/boss)  首领战P50/P95/>90%');
  for (let f = 1; f <= 20; f += 1) {
    const r = res.floors[f];
    const t = r.time;
    const c = r.causes;
    console.log(
      String('F' + f).padEnd(4)
      + String(r.entries).padEnd(7)
      + String(r.cleared).padEnd(7)
      + String(r.deaths).padEnd(6)
      + String(r.deathRatePct + '%').padEnd(8)
      + String(t.avg == null ? '-' : t.avg).padEnd(7)
      + String(t.p50 == null ? '-' : t.p50).padEnd(8)
      + String(t.p90 == null ? '-' : t.p90).padEnd(8)
      + String(t.p95 == null ? '-' : t.p95).padEnd(8)
      + String(t.max == null ? '-' : t.max).padEnd(7)
      + String(t.over90 == null ? '-' : (t.over90 + '(' + t.over90Pct + '%)')).padEnd(14)
      + String(t.se == null ? '-' : t.se).padEnd(7)
      + String('b' + (c.battle || 0) + '/e' + (c.elite || 0) + '/boss' + (c.boss || 0)).padEnd(26)
      + String(r.boss.p50 == null ? '-' : r.boss.p50) + '/'
      + String(r.boss.p95 == null ? '-' : r.boss.p95) + '/'
      + String(r.boss.over90Pct == null ? '-' : r.boss.over90Pct + '%')
    );
  }
}

/**
 * 打印倒挂判定：F10 与 F11 分别对比 F9 / F12 / F13
 * @param {string} cal 口径名
 * @param {Object} res collect 结果
 */
function printInversion(cal, res) {
  console.log('\n=== 倒挂判定（' + cal + '）===');
  const pairs = [[9, 10], [10, 11], [10, 12], [11, 12], [10, 13], [11, 13], [12, 13], [13, 14]];
  console.log('[整层]');
  pairs.forEach(([a, b]) => {
    const v = diffVerdict(res.floors[a].time, res.floors[b].time);
    console.log('F' + b + ' − F' + a + ' = ' + (v.diff == null ? '-' : v.diff + 's')
      + '（合并 SE ' + (v.se == null ? '-' : v.se + 's') + '）→ ' + v.verdict);
  });
  console.log('[仅首领战]');
  const bp = [[9, 10], [10, 11], [10, 12], [11, 12], [11, 13], [12, 13], [13, 14]];
  bp.forEach(([a, b]) => {
    const v = diffVerdict(res.floors[a].boss, res.floors[b].boss);
    console.log('F' + b + ' − F' + a + ' = ' + (v.diff == null ? '-' : v.diff + 's')
      + '（合并 SE ' + (v.se == null ? '-' : v.se + 's') + '）→ ' + v.verdict);
  });
}

/**
 * 全曲线凹点扫描（闸门类改动的强制回归项）
 * ------------------------------------------------------------
 * 只报「已超分辨力」的下降：diff < −2×合并SE。差值小于分辨力的相邻层不报，
 * 避免拿噪声当凹陷。F1–F4 属教学区，单独标注但不参与闸门判定。
 * @param {string} cal 口径名
 * @param {Object} res collect 结果
 * @returns {Object[]} 凹点清单
 */
function printConcavityScan(cal, res) {
  console.log('\n=== 全曲线凹点清单（' + cal + ' · 只报超分辨力下降）===');
  const hits = [];
  for (let f = 2; f <= 20; f += 1) {
    const v = diffVerdict(res.floors[f - 1].time, res.floors[f].time);
    if (v.verdict === '后层更短') {
      hits.push({ from: f - 1, to: f, diff: v.diff, se: v.se });
      console.log('凹点 F' + (f - 1) + '→F' + f + ' = ' + v.diff + 's（合并 SE ' + v.se + 's）');
    }
  }
  if (!hits.length) console.log('无（全曲线上坡或差值不可分辨）');
  console.log('合计凹点 ' + hits.length + ' 处');
  return hits;
}

/**
 * 主流程
 */
function main() {
  const o = parseArgs();
  const ids = o.profile === 'mix' ? ['novice', 'veteran', 'bot'] : [o.profile];
  const cuts = deepCuts(o.precut);
  const out = {
    meta: { at: new Date().toISOString(), runs: o.runs, profile: o.profile, seed: o.seed, precut: o.precut },
    scenarios: {}
  };
  const scen = [
    { name: 'A′' + (o.precut ? '(改前)' : '(现行)'), ov: Object.assign({ eliteMandatory: MANDATORY }, cuts) },
    { name: 'A' + (o.precut ? '(改前)' : '(现行)'), ov: Object.assign({}, cuts) }
  ];
  scen.forEach((sc) => { out.scenarios[sc.name] = collect(sc.ov, o.runs, o.seed, ids); });

  scen.forEach((sc) => {
    const res = out.scenarios[sc.name];
    printTable(sc.name, res);
    printInversion(sc.name, res);
    out.scenarios[sc.name].concavity = printConcavityScan(sc.name, res);
    console.log('【' + sc.name + '】10 层 ' + res.pass10Pct + '% ｜ 通关 ' + res.clear20Pct + '%');
  });

  const outPath = path.join(__dirname, 'probe_f1011_' + o.profile + (o.precut ? '_precut' : '') + '.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\n产物: ' + outPath);
}

main();
