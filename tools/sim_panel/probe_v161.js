/* ============================================================================
 * v1.6.1「终局与深层时长」探针（只读模拟器，不碰主文件）
 * ----------------------------------------------------------------------------
 * 目的：
 *   1. 逐层给出首领战时长分布（P50/P95/max、>75s、>90s），供「闸门判据」使用；
 *   2. 用 --floor 指定判定范围：F18 / F19 / 12-19 / all（all 即正控：应 FAIL）；
 *   3. 同时给出 10 层通过率与通关率（红线 40% / 36%）；
 *   4. 记录死亡房间分布，供「F18 伤害 ×1.15」的决策使用。
 *
 * 口径：
 *   - 直接调用 tools/sim_panel/sim.js（runOne），不走浏览器；
 *   - 默认 10000 局、种子 20261108，与 probe_boss_dist.js 同源；
 *   - 压血量走 bossCapByFloor：F18/F19 已被 cap 封顶，bossHpMulByFloor 在 min(cap, …)
 *     之前乘，会被 cap 吃掉（与主文件 F2/F3 教训同型），必须压 cap 才能生效；
 *   - 加伤害走 bossDamageMulByFloor（只影响该层首领招式基数）。
 *
 * 用法：
 *   node tools/sim_panel/probe_v161.js --runs 10000 --profile bot --floor all --tag baseline
 *   node tools/sim_panel/probe_v161.js --runs 10000 --profile bot --hp18 .65 --floor F18 --tag f18_065
 *   node tools/sim_panel/probe_v161.js --runs 6000  --profile bot --hp18 .65 --hp19 .70 --floor F19 --tag f19_070
 *   node tools/sim_panel/probe_v161.js --runs 10000 --profile bot --hp18 .65 --hp19 .70 --dmg18 1.15 --floor all --tag dmg
 *
 * 产物：
 *   tools/sim_panel/probe_v161_<tag>.json
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

/**
 * 解析命令行参数
 * @returns {Object} { runs, profile, seed, hp18, hp19, dmg18, floor, tag }
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    runs: 10000,
    profile: 'bot',
    seed: C.SIM_PARAMS.baseSeed,
    hpdeep: 1,
    hp18: 1,
    hp19: 1,
    dmg18: 1,
    floor: 'all',
    tag: 'run'
  };
  for (let i = 0; i < a.length; i += 1) {
    const k = a[i];
    if (k === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (k === '--profile') o.profile = a[++i];
    else if (k === '--seed') o.seed = parseInt(a[++i], 10);
    else if (k === '--hpdeep') o.hpdeep = parseFloat(a[++i]);
    else if (k === '--hp18') o.hp18 = parseFloat(a[++i]);
    else if (k === '--hp19') o.hp19 = parseFloat(a[++i]);
    else if (k === '--dmg18') o.dmg18 = parseFloat(a[++i]);
    else if (k === '--floor') o.floor = a[++i];
    else if (k === '--tag') o.tag = a[++i];
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
 * 把命令行里的血量/伤害系数翻成 sim.runOne 的覆盖表
 * @param {Object} o 参数
 * @returns {Object} overrides
 */
function buildOverrides(o) {
  const cap = {};
  if (o.hpdeep !== 1) {
    /* F12–F17 作为一组按同一系数压，F18/F19 再各自微调（三处都属"首领血量"这一个变量） */
    for (let f = 12; f <= 17; f += 1) cap[f] = Math.round(capAt(f) * o.hpdeep);
  }
  if (o.hp18 !== 1) cap[18] = Math.round(capAt(18) * o.hp18);
  if (o.hp19 !== 1) cap[19] = Math.round(capAt(19) * o.hp19);
  const dmg = {};
  if (o.dmg18 !== 1) dmg[18] = o.dmg18;
  const ov = {};
  if (Object.keys(cap).length) ov.bossCapByFloor = cap;
  if (Object.keys(dmg).length) ov.bossDamageMulByFloor = dmg;
  return ov;
}

/**
 * 把 --floor 参数翻成判定层列表
 * @param {string} s 如 all / F18 / 12-19
 * @returns {number[]} 层号数组
 */
function scopeFloors(s) {
  if (s === 'all') return Array.from({ length: 20 }, (_, i) => i + 1);
  const m = String(s).match(/^(\d+)-(\d+)$/);
  if (m) {
    const from = +m[1];
    const to = +m[2];
    const out = [];
    for (let f = from; f <= to; f += 1) out.push(f);
    return out;
  }
  const one = parseInt(String(s).replace(/^F/i, ''), 10);
  return one ? [one] : [18, 19];
}

/**
 * 升序数组取分位数（线性取整索引，与 probe_boss_dist.js 同风格）
 * @param {number[]} sorted 已升序
 * @param {number} p 0–1
 * @returns {number|null}
 */
function q(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

/**
 * 一组秒数的摘要（P50/P95/max/超 75/超 90）
 * @param {number[]} arr 秒数
 * @returns {Object}
 */
function stat(arr) {
  if (!arr.length) return { n: 0 };
  const s = arr.slice().sort((x, y) => x - y);
  const sum = s.reduce((a, b) => a + b, 0);
  const over = (v) => s.filter((x) => x > v).length;
  return {
    n: s.length,
    avg: +(sum / s.length).toFixed(1),
    p50: q(s, 0.50),
    p90: q(s, 0.90),
    p95: q(s, 0.95),
    max: s[s.length - 1],
    over75: over(75),
    over75Pct: +(over(75) / s.length * 100).toFixed(1),
    over90: over(90),
    over90Pct: +(over(90) / s.length * 100).toFixed(1)
  };
}

/**
 * 主流程：跑样本 → 汇总分布 → 判闸门与红线 → 落 JSON
 */
function main() {
  const o = parseArgs();
  const ids = o.profile === 'mix' ? ['novice', 'veteran', 'bot'] : [o.profile];
  const ov = buildOverrides(o);
  const scope = scopeFloors(o.floor);
  const floors = {};
  for (let f = 1; f <= 20; f += 1) floors[f] = { fights: 0, won: [], died: 0, timedOut: 0 };
  const deathByRoom = {};
  const deathByFloor = {};
  let pass10 = 0;
  let clear20 = 0;

  for (let i = 0; i < o.runs; i += 1) {
    const prof = C.PROFILES[ids[i % ids.length]];
    const r = sim.runOne(sim.runSeed(o.seed, i), prof, 'normal', ov);
    if (r.clearedFloors >= 10) pass10 += 1;
    if (r.clearedFloors >= 20) clear20 += 1;
    if (r.died) {
      deathByRoom[r.deathRoom] = (deathByRoom[r.deathRoom] || 0) + 1;
      deathByFloor[r.deathFloor] = (deathByFloor[r.deathFloor] || 0) + 1;
    }
    r.floorTrace.forEach((t) => {
      if (!t.boss) return;
      const x = floors[t.floor];
      x.fights += 1;
      if (t.boss.timedOut) x.timedOut += 1;
      else if (t.boss.died) x.died += 1;
      else x.won.push(t.boss.seconds);
    });
  }

  const rows = {};
  const gateFails = [];
  for (let f = 1; f <= 20; f += 1) {
    const x = floors[f];
    const s = stat(x.won);
    const inScope = scope.indexOf(f) >= 0;
    const gateOk = inScope ? (s.n > 0 && s.p95 <= 75 && s.over90Pct <= 5) : null;
    if (inScope && !gateOk) gateFails.push(f);
    rows[f] = { inScope, gateOk, fights: x.fights, died: x.died, timedOut: x.timedOut, won: s };
  }

  const pass10Pct = +(pass10 / o.runs * 100).toFixed(1);
  const clear20Pct = +(clear20 / o.runs * 100).toFixed(1);
  const redOk = pass10Pct <= 40 && clear20Pct <= 36;
  const gateOkAll = gateFails.length === 0;

  console.log('\n=== v1.6.1 探针 · ' + o.profile + ' · ' + o.runs + ' 局 · seed ' + o.seed + ' ===');
  console.log('系数：hpdeep(F12–F17)=' + o.hpdeep + ' hp18=' + o.hp18 + ' hp19=' + o.hp19
    + ' dmg18=' + o.dmg18 + ' ｜ 判定层：' + scope.join(','));
  console.log('层    场数   首领死亡  超时  P50     P95     max     >75s              >90s');
  for (let f = 10; f <= 20; f += 1) {
    const r = rows[f];
    if (!r.fights) continue;
    const s = r.won;
    console.log(
      String('F' + f).padEnd(5) + String(r.fights).padEnd(7) + String(r.died).padEnd(9)
      + String(r.timedOut).padEnd(5)
      + String(s.p50).padEnd(7) + String(s.p95).padEnd(7) + String(s.max).padEnd(7)
      + String((s.over75 || 0) + '/' + (s.n || 0) + ' ' + (s.over75Pct || 0) + '%').padEnd(18)
      + String((s.over90 || 0) + '/' + (s.n || 0) + ' ' + (s.over90Pct || 0) + '%')
      + (r.inScope ? (r.gateOk ? '  ✔' : '  ✘判据失败') : '')
    );
  }
  console.log('\n闸门（P95≤75s 且 >90s≤5%）：' + (gateOkAll ? 'PASS' : 'FAIL')
    + (gateFails.length ? ' ｜ 失败层：F' + gateFails.join(', F') : ''));
  console.log('红线（10 层 ≤40% 且 通关 ≤36%）：10 层 ' + pass10Pct + '% / 通关 ' + clear20Pct
    + '% → ' + (redOk ? 'PASS' : 'FAIL'));
  console.log('死亡分布（房间）：' + JSON.stringify(deathByRoom)
    + ' ｜ F18 死亡 ' + (deathByFloor[18] || 0));

  const out = {
    meta: {
      at: new Date().toISOString(), runs: o.runs, profile: o.profile, seed: o.seed,
      hpdeep: o.hpdeep, hp18: o.hp18, hp19: o.hp19, dmg18: o.dmg18, floor: o.floor, scope
    },
    floors: rows,
    gate: { ok: gateOkAll, fails: gateFails },
    redLines: { ok: redOk, pass10: pass10Pct, clear20: clear20Pct, pass10Max: 40, clear20Max: 36 },
    deaths: { byRoom: deathByRoom, byFloor: deathByFloor }
  };
  const outPath = path.join(__dirname, 'probe_v161_' + o.tag + '.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('产物: ' + outPath);
}

main();
