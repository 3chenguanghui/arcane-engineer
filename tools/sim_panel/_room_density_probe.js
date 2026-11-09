/* ============================================================================
 * 逐房密度 / 清房时长探针（2026-11-08）
 * ----------------------------------------------------------------------------
 * 为什么需要它：现有 sim.js 只统计"每层平均清房时间"（clearTimes = 本层总秒 / 房间数），
 * 拿不到"每间战斗房到底刷几只、清一间要多少秒"的分布，也就无法回答
 * "玩家觉得怪少，是数量少、还是怪挤在中间"。
 *
 * 本探针做两件事：
 *   1) 对齐主文件：主文件 ENEMY_BUDGET_CONFIG.minFloor 已改为 1（F1 起就走 ramp 硬区间），
 *      而 sim.js 仍用 budgetFrom=6 + 前五层 ×0.8 + F1 上限 3。这里只改这份**副本**，
 *      不动 sim.js 本体（其它工作线还在用它）。
 *   2) 给 runOne 加一条 roomTrace，逐房记录 [层, 房型, 怪数, 清房秒数, 死亡, 总血]。
 *
 * 用法：
 *   node _room_density_probe.js --runs 2000 --chars base,warden3,ember4,gazer2 --out _room_density.json
 *   node _room_density_probe.js --runs 200 --chars base --out _room_density_smoke.json
 *
 * 输出：每层 × 房型 的怪数（均值/最小/最大）、清房秒数 P50/P95、本层总战斗秒数 P50/P95、
 *       房型占比、四口径的 10 层通关率 / F20 到达率。
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config.js');

const SIM_PATH = path.join(__dirname, 'sim.js');
const TMP_PATH = path.join(__dirname, '_sim_aligned.js');

/* ---------------------------------------------------------------------------
 * 1. 生成"对齐主文件"的 sim 副本（三处字符串替换，全部要求命中次数 = 1）
 * ------------------------------------------------------------------------- */

/**
 * 单次字符串替换，命中次数不等于 1 直接抛错（避免锚点漂移后静默生成错副本）
 * @param {string} src 源码
 * @param {string} from 原片段
 * @param {string} to 新片段
 * @param {string} tag 用于报错的标签
 * @returns {string} 替换后的源码
 */
function replaceOnce(src, from, to, tag) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`锚点[${tag}]命中 ${n} 次（应为 1 次）：${from.slice(0, 60)}`);
  return src.replace(from, to);
}

/**
 * 构造对齐副本并落盘
 * @returns {string} 临时文件路径
 */
function buildAlignedSim() {
  let src = fs.readFileSync(SIM_PATH, 'utf8');

  // 1) 前五层不再走"教学 −20% / F1 上限 3"，与主文件 minFloor=1 一致
  src = replaceOnce(
    src,
    `  if (isElite && !budgetOn) count = Math.round(count * (tune && tune.countMul !== undefined ? tune.countMul : C.ELITE_ROOM.countMul));
  if (floor <= C.ONBOARD.maxFloors) count = Math.round(count * C.ONBOARD.enemyCountMul);
  if (floor === 1) count = Math.min(C.ONBOARD.floor1CountCap, count);`,
    `  /* 对齐主文件：ENEMY_BUDGET_CONFIG.minFloor = 1，F1 起全部走 ramp 硬区间，
     不再叠精英 ×1.4 / 教学 ×0.8 / F1 上限 3。 */
  if (isElite && !budgetOn) count = Math.round(count * (tune && tune.countMul !== undefined ? tune.countMul : C.ELITE_ROOM.countMul));`,
    'onboard'
  );
  src = replaceOnce(
    src,
    `  const budgetOn = floor >= C.FLOOR_GEN.budgetFrom;`,
    `  const budgetOn = true;   /* 对齐主文件 minFloor = 1 */`,
    'budgetFrom'
  );

  // 2) runOne 结果里加 roomTrace
  src = replaceOnce(
    src,
    `    , composition: []         // 探针：楼层/出怪组成（compositionTrace，用于种子一致性验证）`,
    `    , composition: []         // 探针：楼层/出怪组成（compositionTrace，用于种子一致性验证）
    , roomTrace: []            // 探针：逐房 [floor, type, count, seconds, died, totalHp]`,
    'roomTrace-init'
  );

  // 3) 战斗/精英房：清房后记一条
  src = replaceOnce(
    src,
    `      result.seconds += fight.seconds;
      healCombatRoom += fight.healed;`,
    `      result.seconds += fight.seconds;
      result.roomTrace.push({
        floor, type: room.type, count: enc.enemyIds.length,
        seconds: fight.seconds, died: !!fight.died,
        damage: fight.damage, totalHp: enc.totalHp
      });
      healCombatRoom += fight.healed;`,
    'roomTrace-battle'
  );

  // 4) 首领房：清房后记一条
  src = replaceOnce(
    src,
    `        result.seconds += fight.seconds;
        healCombatBoss += fight.healed + healBossEntry;`,
    `        result.seconds += fight.seconds;
        result.roomTrace.push({
          floor, type: 'boss', count: 1,
          seconds: fight.seconds, died: !!fight.died,
          damage: fight.damage, totalHp: stats.hp * bossHpScale
        });
        healCombatBoss += fight.healed + healBossEntry;`,
    'roomTrace-boss'
  );

  fs.writeFileSync(TMP_PATH, src, 'utf8');
  return TMP_PATH;
}

/* ---------------------------------------------------------------------------
 * 2. 角色表（与 probe_chars.js 同源，只取本探针要用的四个口径）
 * ------------------------------------------------------------------------- */
const CHARS = {
  base:    { id: 'base',    label: '中性(基准)',   hpPct: 0, magics: ['fireball', 'frost'], techs: [] },
  warden3: { id: 'warden3', label: '守拙(104)',    hpPct: 0.04, magics: ['fireball', 'frost'], techs: [] },
  ember4:  { id: 'ember4',  label: '疾火(95+增幅)', hpPct: -0.05, magics: ['fireball', 'frost'], techs: ['amp'] },
  gazer2:  { id: 'gazer2',  label: '观星(100+回能)', hpPct: 0, magics: ['fireball', 'frost'], techs: [], regenBonus: 2 }
};

/* ---------------------------------------------------------------------------
 * 3. 统计工具
 * ------------------------------------------------------------------------- */

/**
 * 分位数（线性插值）
 * @param {Array<number>} arr 数值数组（会被排序）
 * @param {number} q 0~1
 * @returns {number} 分位值
 */
function pct(arr, q) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/**
 * 平均值
 * @param {Array<number>} arr 数值
 * @returns {number} 均值
 */
function mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

/**
 * 定宽右对齐
 * @param {*} v 值
 * @param {number} n 宽度
 * @returns {string}
 */
function pad(v, n) {
  const s = String(v);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

/* ---------------------------------------------------------------------------
 * 4. 主流程
 * ------------------------------------------------------------------------- */

/**
 * 解析命令行参数
 * @returns {Object} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { runs: 2000, chars: Object.keys(CHARS), out: '_room_density.json', profile: 'bot' };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Number(a[i + 1]);
    if (a[i] === '--chars') o.chars = a[i + 1].split(',').map((s) => s.trim()).filter((k) => CHARS[k]);
    if (a[i] === '--out') o.out = a[i + 1];
    if (a[i] === '--profile') o.profile = a[i + 1];
  }
  return o;
}

(async () => {
  const args = parseArgs();
  /* B2 漂移核查：关掉熔炉层计划，让本探针回到"纯房型"口径，便于与 2026-11-08 的历史数字对比 */
  if (process.env.ARCANE_NO_PLAN) C.ROOM.plan = {};
  const tmp = buildAlignedSim();
  const S = require(tmp);

  const profile = (args.profile === 'mix')
    ? C.PROFILES.bot   // 简化：mix 口径下也先用 bot，避免默认轮换干扰单角色对比
    : C.PROFILES[args.profile];
  const seed = C.SIM_PARAMS.baseSeed;

  // 每层 × 房型 的桶
  const buckets = {};
  for (let f = 1; f <= C.SIM_PARAMS.maxFloor; f += 1) {
    buckets[f] = {
      counts: { battle: [], elite: [] },
      secs: { battle: [], elite: [], boss: [] },
      types: { battle: 0, elite: 0, chest: 0, event: 0, rest: 0, shop: 0, survival: 0, boss: 0, start: 0 },
      floorTotalSec: [],
      deaths: { battle: 0, elite: 0, boss: 0 }
    };
  }

  const perChar = {};
  const N = args.runs;
  const t0 = Date.now();

  for (const key of args.chars) {
    const ch = CHARS[key];
    let clear10 = 0;
    let reach20 = 0;
    let clear20 = 0;
    let runs = 0;

    for (let i = 0; i < N; i += 1) {
      const r = S.runOne(S.runSeed(seed, i), profile, 'normal', {
        charSpec: ch, talentSpec: null, compositionTrace: true
      });
      runs += 1;
      if (r.clearedFloors >= 10) clear10 += 1;
      if (r.clearedFloors >= 20) clear20 += 1;
      if (!r.died || r.deathFloor >= 20) reach20 += 1;

      // 房型分布（composition 里每层一条）
      (r.composition || []).forEach((rec) => {
        const b = buckets[rec.floor];
        if (!b) return;
        rec.types.forEach((t) => { b.types[t] = (b.types[t] || 0) + 1; });
      });

      // 逐房时长 / 怪数
      let floorSec = 0;
      let floorNo = 0;
      const flushed = new Set();
      r.roomTrace.forEach((rt) => {
        const b = buckets[rt.floor];
        if (!b) return;
        if (rt.type === 'battle' || rt.type === 'elite') {
          b.counts[rt.type].push(rt.count);
          b.secs[rt.type].push(rt.seconds);
        } else if (rt.type === 'boss') {
          b.secs.boss.push(rt.seconds);
        }
        if (rt.died) b.deaths[rt.type] = (b.deaths[rt.type] || 0) + 1;
        if (!flushed.has(rt.floor)) { flushed.add(rt.floor); }
        floorSec += rt.seconds;
        floorNo += 1;
      });
      // 每层总战斗秒数（含首领）
      flushed.forEach(() => {});
      const byFloor = {};
      r.roomTrace.forEach((rt) => { byFloor[rt.floor] = (byFloor[rt.floor] || 0) + rt.seconds; });
      Object.keys(byFloor).forEach((f) => {
        if (buckets[f]) buckets[f].floorTotalSec.push(byFloor[f]);
      });
    }

    perChar[key] = {
      label: ch.label,
      runs,
      clear10: clear10 / runs,
      reach20: reach20 / runs,
      clear20: clear20 / runs
    };
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  /* ---------------- 打印 ---------------- */
  console.log(`样本：每角色 ${args.runs} 局，档案 ${profile.id}，耗时 ${elapsed}s\n`);
  console.log('【角色通道】');
  console.log('  角色        10层通关   F20到达   20层通关');
  args.chars.forEach((k) => {
    const m = perChar[k];
    console.log('  ' + pad(m.label, 14) + pad((m.clear10 * 100).toFixed(2) + '%', 10)
      + pad((m.reach20 * 100).toFixed(2) + '%', 10) + pad((m.clear20 * 100).toFixed(2) + '%', 10));
  });

  console.log('\n【每层每房实际怪数（战斗房 / 精英房，单位：只）】');
  console.log('  层  战斗均值  战斗[min~max]  精英均值  精英[min~max]  本层内容房(战/精/宝/事/休/商/生)');
  for (let f = 1; f <= C.SIM_PARAMS.maxFloor; f += 1) {
    const b = buckets[f];
    const cb = b.counts.battle;
    const ce = b.counts.elite;
    const t = b.types;
    const types = [t.battle, t.elite, t.chest, t.event, t.rest, t.shop, t.survival].map((v) => (v || 0)).join('/');
    console.log('  ' + pad(f, 3)
      + pad(cb.length ? mean(cb).toFixed(1) : '-', 10)
      + pad(cb.length ? `[${Math.min(...cb)}~${Math.max(...cb)}]` : '-', 15)
      + pad(ce.length ? mean(ce).toFixed(1) : '-', 10)
      + pad(ce.length ? `[${Math.min(...ce)}~${Math.max(...ce)}]` : '-', 15)
      + '  ' + types);
  }

  console.log('\n【清一间房的实测时长（秒）：战斗房 / 精英房 / 首领房】');
  console.log('  层  战斗P50  战斗P95  战斗样本  精英P50  精英P95  精英样本  首领P50  首领P95  本层总战斗P50  本层总战斗P95');
  for (let f = 1; f <= C.SIM_PARAMS.maxFloor; f += 1) {
    const b = buckets[f];
    console.log('  ' + pad(f, 3)
      + pad(pct(b.secs.battle, 0.5).toFixed(1), 10)
      + pad(pct(b.secs.battle, 0.95).toFixed(1), 10)
      + pad(b.secs.battle.length, 10)
      + pad(pct(b.secs.elite, 0.5).toFixed(1), 9)
      + pad(pct(b.secs.elite, 0.95).toFixed(1), 9)
      + pad(b.secs.elite.length, 10)
      + pad(pct(b.secs.boss, 0.5).toFixed(1), 9)
      + pad(pct(b.secs.boss, 0.95).toFixed(1), 9)
      + pad(pct(b.floorTotalSec, 0.5).toFixed(1), 16)
      + pad(pct(b.floorTotalSec, 0.95).toFixed(1), 16));
  }

  console.log('\n【房型占比（20 层合计）】');
  const sumTypes = {};
  Object.keys(buckets).forEach((f) => {
    Object.keys(buckets[f].types).forEach((k) => {
      sumTypes[k] = (sumTypes[k] || 0) + buckets[f].types[k];
    });
  });
  const totalRooms = Object.values(sumTypes).reduce((s, v) => s + v, 0);
  Object.keys(sumTypes).sort((a, b) => sumTypes[b] - sumTypes[a]).forEach((k) => {
    console.log(`  ${k}: ${sumTypes[k]} 间 (${(sumTypes[k] / totalRooms * 100).toFixed(2)}%)`);
  });

  /* ---------------- 落盘 ---------------- */
  const out = {
    generatedAt: new Date().toISOString(),
    runsPerChar: args.runs,
    profile: profile.id,
    chars: perChar,
    buckets: Object.keys(buckets).reduce((o, f) => {
      const b = buckets[f];
      o[f] = {
        battle: {
          n: b.counts.battle.length,
          countMean: +mean(b.counts.battle).toFixed(2),
          countMin: b.counts.battle.length ? Math.min(...b.counts.battle) : 0,
          countMax: b.counts.battle.length ? Math.max(...b.counts.battle) : 0,
          secP50: +pct(b.secs.battle, 0.5).toFixed(2),
          secP95: +pct(b.secs.battle, 0.95).toFixed(2)
        },
        elite: {
          n: b.counts.elite.length,
          countMean: +mean(b.counts.elite).toFixed(2),
          countMin: b.counts.elite.length ? Math.min(...b.counts.elite) : 0,
          countMax: b.counts.elite.length ? Math.max(...b.counts.elite) : 0,
          secP50: +pct(b.secs.elite, 0.5).toFixed(2),
          secP95: +pct(b.secs.elite, 0.95).toFixed(2)
        },
        boss: { n: b.secs.boss.length, secP50: +pct(b.secs.boss, 0.5).toFixed(2), secP95: +pct(b.secs.boss, 0.95).toFixed(2) },
        floorTotal: { n: b.floorTotalSec.length, p50: +pct(b.floorTotalSec, 0.5).toFixed(2), p95: +pct(b.floorTotalSec, 0.95).toFixed(2) },
        types: b.types,
        deaths: b.deaths
      };
      return o;
    }, {})
  };
  fs.writeFileSync(path.join(__dirname, args.out), JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n已落盘：${args.out}`);

  // 临时副本用完即删（避免被其它线误 require）
  try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }
})();
