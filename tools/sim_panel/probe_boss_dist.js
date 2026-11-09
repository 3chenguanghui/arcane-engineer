/* ============================================================================
 * 首领战时长分布探针（只读模拟器，不碰主文件）
 * ----------------------------------------------------------------------------
 * 目的：
 *   把「首领战时长」从单次全跑的噪声里拆出来，给统计口径的分布证据。
 *   逐层记录每次首领战的模拟秒数，输出 P50 / P95 / max、超 75s / 超 90s 的占比，
 *   以及超时（timedOut）与被打死（died）分别有多少。
 *
 * 口径：
 *   - 直接调用 tools/sim_panel/sim.js 的真实数值路径（runOne），不走浏览器；
 *   - 默认 10000 局、种子 20261108，与 results.json 基线同源；
 *   - profile=bot 时只跑机器人（与 E2E 全跑的可比性最好）；mix 时按 新手/老手/机器人 轮转，
 *     接近 probe_endgame.js 的统计口径。
 *
 * 用法：
 *   node tools/sim_panel/probe_boss_dist.js --runs 10000 --profile bot
 *   node tools/sim_panel/probe_boss_dist.js --runs 10000 --profile mix
 *
 * 产物：
 *   tools/sim_panel/probe_boss_dist_<profile>.json
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

/** 解析命令行参数 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { runs: 10000, profile: 'bot', seed: C.SIM_PARAMS.baseSeed, capMul: 0, capFrom: 12, capTo: 19 };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (a[i] === '--profile') o.profile = a[++i];
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
    else if (a[i] === '--capmul') o.capMul = parseFloat(a[++i]);
    else if (a[i] === '--capfrom') o.capFrom = parseInt(a[++i], 10);
    else if (a[i] === '--capto') o.capTo = parseInt(a[++i], 10);
  }
  return o;
}

/**
 * 构造按层首领血量上限覆盖（只用于"如果压 F12+ 首领血量"的离线估算）。
 * 基准 cap(f) 与 sim.js 的 bossStats 同式：hpCap × (1 + hpCapRampPerFloor × (f−1))。
 * @param {number} capFrom 从第几层开始压
 * @param {number} capTo 压到第几层为止（默认 19，避开 F20 的 0.55 硬闸门）
 * @param {number} mul 缩放倍数
 * @returns {Object} bossCapByFloor 覆盖表
 */
function makeCapOverride(capFrom, capTo, mul) {
  const out = {};
  if (!mul) return out;
  for (let f = capFrom; f <= capTo; f += 1) {
    out[f] = Math.round(C.BOSS.hpCap * (1 + (C.BOSS.hpCapRampPerFloor || 0) * (f - 1)) * mul);
  }
  return out;
}

/** 升序数组取分位数（线性取整索引，与 run.js 的 histPercentile 同风格） */
function q(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

/** 统计一组秒数的摘要 */
function stat(arr) {
  if (!arr.length) return { n: 0 };
  const s = arr.slice().sort((x, y) => x - y);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    avg: +(sum / s.length).toFixed(1),
    p50: q(s, 0.50),
    p90: q(s, 0.90),
    p95: q(s, 0.95),
    max: s[s.length - 1],
    over75: s.filter((v) => v > 75).length,
    over75Pct: +(s.filter((v) => v > 75).length / s.length * 100).toFixed(1),
    over90: s.filter((v) => v > 90).length,
    over90Pct: +(s.filter((v) => v > 90).length / s.length * 100).toFixed(1)
  };
}

/** 主流程 */
function main() {
  const opts = parseArgs();
  const ids = opts.profile === 'mix' ? ['novice', 'veteran', 'bot'] : [opts.profile];
  const capTable = makeCapOverride(opts.capFrom, opts.capTo, opts.capMul);
  const ov = capTable && Object.keys(capTable).length ? { bossCapByFloor: capTable } : {};
  const floors = {};
  for (let f = 1; f <= 20; f += 1) {
    floors[f] = {
      fights: 0,        // 首领战次数（含死亡/超时）
      won: [],          // 打赢（首领被击杀）的秒数
      died: 0,          // 首领战里玩家死亡
      timedOut: 0,      // 首领战超时（> maxRoomSeconds）
      timeoutHpLeft: [],// 超时时的首领剩余血量百分比
      entryHpPct: []    // 进场血量百分比（看是不是残血进首领）
    };
  }
  let reach20 = 0;
  let clear20 = 0;
  let f20ReachedButNotCleared = 0;

  for (let i = 0; i < opts.runs; i += 1) {
    const prof = C.PROFILES[ids[i % ids.length]];
    const r = sim.runOne(sim.runSeed(opts.seed, i), prof, 'normal', ov);
    if (r.clearedFloors >= 19) reach20 += 1;
    if (r.clearedFloors >= 20) clear20 += 1;
    if (r.clearedFloors >= 19 && r.clearedFloors < 20) f20ReachedButNotCleared += 1;

    r.floorTrace.forEach((t) => {
      const x = floors[t.floor];
      if (!t.boss) return;
      x.fights += 1;
      const b = t.boss;
      if (b.entryHp != null && b.entryHpMax) x.entryHpPct.push(+(b.entryHp / b.entryHpMax * 100).toFixed(1));
      if (b.timedOut) {
        x.timedOut += 1;
        if (b.bossHpLeftPct != null) x.timeoutHpLeft.push(b.bossHpLeftPct);
      } else if (b.died) {
        x.died += 1;
      } else {
        x.won.push(b.seconds);
      }
    });
  }

  const out = {
    meta: {
      runs: opts.runs, profile: opts.profile, seed: opts.seed,
      capMul: opts.capMul || null, capFrom: opts.capMul ? opts.capFrom : null,
      at: new Date().toISOString()
    },
    reach20Pct: +(reach20 / opts.runs * 100).toFixed(1),
    clear20Pct: +(clear20 / opts.runs * 100).toFixed(1),
    f20ReachedButNotCleared,
    floors: {}
  };

  console.log('\n=== 首领战时长分布（' + opts.profile + ' · ' + opts.runs + ' 局 · seed ' + opts.seed + '） ===');
  console.log('层   场数  胜场  P50    P95     max    >75s            >90s');
  for (let f = 1; f <= 20; f += 1) {
    const x = floors[f];
    const s = stat(x.won);
    out.floors[f] = {
      fights: x.fights,
      wonN: s.n || 0,
      won: s,
      died: x.died,
      timedOut: x.timedOut,
      timeoutHpLeftP50: x.timeoutHpLeft.length ? q(x.timeoutHpLeft.slice().sort((a, b) => a - b), 0.5) : null,
      timeoutHpLeftMax: x.timeoutHpLeft.length ? Math.max(...x.timeoutHpLeft) : null,
      entryHpPctP50: x.entryHpPct.length ? q(x.entryHpPct.slice().sort((a, b) => a - b), 0.5) : null
    };
    if (x.fights) {
      console.log(
        String('F' + f).padEnd(4) + String(x.fights).padEnd(6)
        + String(s.n || 0).padEnd(6)
        + String(s.p50).padEnd(6) + String(s.p95).padEnd(7) + String(s.max).padEnd(7)
        + String((s.over75 || 0) + '/' + (s.n || 0) + ' ' + (s.over75Pct || 0) + '%').padEnd(16)
        + String((s.over90 || 0) + '/' + (s.n || 0) + ' ' + (s.over90Pct || 0) + '%')
        + (x.timedOut ? '  timeout=' + x.timedOut : '')
      );
    }
  }
  console.log('\nF20 到达 ' + out.reach20Pct + '% ｜ 通关 ' + out.clear20Pct + '%'
    + ' ｜ 到达未通关 ' + f20ReachedButNotCleared + ' 人');

  const outPath = path.join(__dirname, 'probe_boss_dist_' + opts.profile
    + (opts.capMul ? '_cap' + String(opts.capMul).replace('.', '') : '') + '.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('产物: ' + outPath);
}

main();
