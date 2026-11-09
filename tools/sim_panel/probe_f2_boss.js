/* ============================================================================
 * F2 首领线 · 分布表 + 死因拆解
 * ----------------------------------------------------------------------------
 * 用法：node tools/sim_panel/probe_f2_boss.js --runs 10000
 * 产物：tools/sim_panel/probe_f2_boss.json
 *
 * 回答三件事（不先给方案，先给分布）：
 *   1) F1–F6 逐层：进入次数、死亡数、清层率、平均停留时长、首领战时长；
 *   2) F2 首领画像：F2 死亡里"死在首领战"占多少、"首领战超时"占多少、"开战 3 秒内死亡"占多少；
 *   3) E1 的 +6.3pp（10 层）/ +5.0pp（F20）拆开：主要救的是哪一层、哪种死因。
 *
 * 拆解方法（配对法）：同一 runIndex 的基线局与 E1 局用同一条主随机流前缀，
 * E1 选卡只消耗独立 e1rng（见 sim.js），所以"基线死在这里、E1 活过去"可以直接配对，
 * 把被救的人按基线死亡楼层/房间归因。归因是"原本死在哪"，不是"改了什么数值"。
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

/* A′：浏览器实测 970 层得到的"精英房绕不开"比例（见 E1_PATCH.md §1） */
const MANDATORY = { 2: 0.44, 3: 0.10, 4: 0.52, 5: 0.47 };
for (let f = 6; f <= 20; f += 1) MANDATORY[f] = 0.465;

const SCENARIOS = [
  { name: 'A 基线', ov: {}, caliber: 'A' },
  { name: 'A′ 基线', ov: { eliteMandatory: MANDATORY }, caliber: 'A′' },
  { name: 'A + E1', ov: { e1CardAtFloor: 1 }, caliber: 'A' },
  { name: 'A′ + E1', ov: { eliteMandatory: MANDATORY, e1CardAtFloor: 1 }, caliber: 'A′' }
];
const FL = 10;  // 分布表覆盖 F1–F10（前 6 层是主线，7–10 用于 E1 净变化）

/** 解析命令行。 */
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

/** 是否到达 F20（活着清过 19 层，或死在第 20 层/更深处）。 */
function reached20(r) {
  return !r.died || r.deathFloor >= 20;
}

/** 跑一个场景：返回逐层聚合 + 每局精简档案（供配对拆解）。 */
function collect(ov, opts) {
  const ids = ['novice', 'veteran', 'bot'];
  const floors = {};
  for (let f = 1; f <= FL; f += 1) {
    floors[f] = {
      entries: 0, deaths: 0, cleared: 0, sumStay: 0,
      bossFights: 0, sumBoss: 0, bossDeaths: 0, bossTimeouts: 0, boss3s: 0,
      bossDeathAtSum: 0,
      roomDeaths: { battle: 0, elite: 0, boss: 0, other: 0 }
    };
  }
  const f2 = { deaths: 0, bossDeaths: 0, bossTimeouts: 0, bossHpDeaths: 0, bossWithin3s: 0 };
  const roomDeaths = { battle: 0, elite: 0, boss: 0 };
  const runs = [];

  for (let i = 0; i < opts.runs; i += 1) {
    const pid = ids[i % 3];
    const r = sim.runOne(sim.runSeed(opts.seed, i), C.PROFILES[pid], opts.difficulty, ov);
    runs.push({
      cleared: r.clearedFloors,
      died: r.died,
      deathFloor: r.deathFloor,
      deathRoom: r.deathRoom,
      trace: r.floorTrace
    });

    for (let f = 1; f <= FL; f += 1) {
      const s = floors[f];
      if (r.clearedFloors >= f - 1) s.entries += 1;      // 进入本层（死在本层也算进入）
      if (r.clearedFloors >= f) s.cleared += 1;          // 清过本层
      if (r.died && r.deathFloor === f) s.deaths += 1;   // 死在本层
      if (r.died && r.deathFloor === f) {
        const room = (r.deathRoom === 'battle' || r.deathRoom === 'elite' || r.deathRoom === 'boss')
          ? r.deathRoom : 'other';
        s.roomDeaths[room] += 1;
      }
      const t = r.floorTrace[f - 1];                     // 楼层按顺序推进，下标即层号-1
      if (t) {
        s.sumStay += t.clearSeconds || 0;
        if (t.boss) {
          s.bossFights += 1;
          s.sumBoss += t.boss.seconds || 0;
          if (t.boss.died) {
            s.bossDeaths += 1;
            s.bossDeathAtSum += t.boss.deathAt || 0;
            if (t.boss.timedOut) s.bossTimeouts += 1;
            if (t.boss.deathAt <= 3) s.boss3s += 1;
          }
        }
      }
    }

    if (r.died) roomDeaths[r.deathRoom] = (roomDeaths[r.deathRoom] || 0) + 1;
    if (r.died && r.deathFloor === 2) {
      f2.deaths += 1;
      if (r.deathRoom === 'boss') {
        f2.bossDeaths += 1;
        const t = r.floorTrace[1] && r.floorTrace[1].boss;
        if (t && t.timedOut) f2.bossTimeouts += 1;
        else f2.bossHpDeaths += 1;
        if (t && t.deathAt <= 3) f2.bossWithin3s += 1;
      }
    }
  }

  const out = {};
  for (let f = 1; f <= FL; f += 1) {
    const s = floors[f];
    out[f] = {
      entries: s.entries,
      deaths: s.deaths,
      cleared: s.cleared,
      clearRatePct: +(s.cleared / Math.max(1, s.entries) * 100).toFixed(1),
      avgStaySec: +(s.sumStay / Math.max(1, s.entries)).toFixed(1),
      bossFights: s.bossFights,
      avgBossSec: +(s.sumBoss / Math.max(1, s.bossFights)).toFixed(1),
      bossDeaths: s.bossDeaths,
      bossTimeouts: s.bossTimeouts,
      bossWithin3s: s.boss3s,
      avgBossDeathSec: +(s.bossDeathAtSum / Math.max(1, s.bossDeaths)).toFixed(1),
      roomDeaths: s.roomDeaths
    };
  }

  return { floors: out, f2, roomDeaths, runs };
}

/** 配对拆解：基线死掉、E1 活过某个关卡的人，按基线死亡楼层/房间归因。 */
function decompose(base, e1) {
  const d = {
    saved10: 0, lost10: 0, saved20: 0, lost20: 0,
    saved10ByRoom: { battle: 0, elite: 0, boss: 0 },
    saved10ByFloor: {},
    saved10BossCause: { timeout: 0, hp: 0, within3s: 0 },
    saved20ByRoom: { battle: 0, elite: 0, boss: 0 },
    saved20ByFloor: {},
    netDeathByFloor: {}
  };
  const n = Math.min(base.runs.length, e1.runs.length);
  for (let i = 0; i < n; i += 1) {
    const b = base.runs[i];
    const e = e1.runs[i];
    const bPass10 = b.cleared >= 10;
    const ePass10 = e.cleared >= 10;
    const bReach20 = reached20(b);
    const eReach20 = reached20(e);

    if (!bPass10 && ePass10) {
      d.saved10 += 1;
      const room = b.deathRoom || 'none';
      d.saved10ByRoom[room] = (d.saved10ByRoom[room] || 0) + 1;
      const f = b.deathFloor || 0;
      d.saved10ByFloor[f] = (d.saved10ByFloor[f] || 0) + 1;
      if (room === 'boss') {
        const t = b.trace[f - 1] && b.trace[f - 1].boss;
        if (t && t.timedOut) d.saved10BossCause.timeout += 1;
        else d.saved10BossCause.hp += 1;
        if (t && t.deathAt <= 3) d.saved10BossCause.within3s += 1;
      }
    }
    if (bPass10 && !ePass10) d.lost10 += 1;
    if (!bReach20 && eReach20) {
      d.saved20 += 1;
      const room = b.deathRoom || 'none';
      d.saved20ByRoom[room] = (d.saved20ByRoom[room] || 0) + 1;
      const f = b.deathFloor || 0;
      d.saved20ByFloor[f] = (d.saved20ByFloor[f] || 0) + 1;
    }
    if (bReach20 && !eReach20) d.lost20 += 1;

    const bf = b.died ? b.deathFloor : 0;
    const ef = e.died ? e.deathFloor : 0;
    d.netDeathByFloor[bf] = (d.netDeathByFloor[bf] || 0) + 1;
    d.netDeathByFloor[ef] = (d.netDeathByFloor[ef] || 0) - 1;
  }
  return d;
}

/** 把对象按值降序排成 "键 N" 字符串。 */
function topStr(obj, limit) {
  return Object.keys(obj)
    .sort((a, b) => obj[b] - obj[a])
    .slice(0, limit)
    .map((k) => k + ':' + obj[k])
    .join('  ');
}

/** 主流程。 */
function main() {
  const opts = parseArgs();
  const res = { meta: opts, floors: {}, f2: {}, decompose: {}, roomDeaths: {} };
  const built = {};
  SCENARIOS.forEach((sc) => {
    const r = collect(sc.ov, opts);
    built[sc.name] = r;
    res.floors[sc.name] = r.floors;
    res.f2[sc.name] = r.f2;
    res.roomDeaths[sc.name] = r.roomDeaths;
  });
  res.decompose.A = decompose(built['A 基线'], built['A + E1']);
  res.decompose['A′'] = decompose(built['A′ 基线'], built['A′ + E1']);

  const outPath = path.join(__dirname, 'probe_f2_boss.json');
  fs.writeFileSync(outPath, JSON.stringify(res, null, 2));

  // ---- 打印 1：F1–F6 分布表（A 与 A′ 基线）----
  ['A 基线', 'A′ 基线'].forEach((name) => {
    console.log('\n=== F1–F10 分布 · ' + name + '（' + opts.runs + ' 局）===');
    console.log('层  进入     死亡    清层率   平均停留s  首领战s  首领战死  平均死亡s  超时  3s内死');
    for (let f = 1; f <= FL; f += 1) {
      const s = res.floors[name][f];
      console.log(String('F' + f).padEnd(4)
        + String(s.entries).padEnd(8) + String(s.deaths).padEnd(8)
        + (s.clearRatePct + '%').padEnd(9) + String(s.avgStaySec).padEnd(11)
        + String(s.avgBossSec).padEnd(10) + String(s.bossDeaths).padEnd(10)
        + String(s.avgBossDeathSec).padEnd(11)
        + String(s.bossTimeouts).padEnd(6) + String(s.bossWithin3s));
    }
  });

  // ---- 打印 2：F2 首领画像 ----
  console.log('\n=== F2 首领画像（F2 死亡内的构成）===');
  console.log('场景         F2死亡  F2首领死  占F2死%  超时  占首领死%  开战3s内  占首领死%  平均死亡s');
  Object.keys(res.f2).forEach((name) => {
    const x = res.f2[name];
    const bossShare = x.deaths ? (x.bossDeaths / x.deaths * 100).toFixed(1) : '0.0';
    const toShare = x.bossDeaths ? (x.bossTimeouts / x.bossDeaths * 100).toFixed(1) : '0.0';
    const s3Share = x.bossDeaths ? (x.bossWithin3s / x.bossDeaths * 100).toFixed(1) : '0.0';
    const avgAt = res.floors[name][2].avgBossDeathSec;
    console.log(name.padEnd(11)
      + String(x.deaths).padEnd(8) + String(x.bossDeaths).padEnd(9)
      + (bossShare + '%').padEnd(9) + String(x.bossTimeouts).padEnd(6)
      + (toShare + '%').padEnd(11) + String(x.bossWithin3s).padEnd(10)
      + (s3Share + '%').padEnd(11) + String(avgAt));
  });

  // ---- 打印 3：E1 的净变化按层/死因（总体口径，不做同人配对）----
  ['A', 'A′'].forEach((cal) => {
    const base = res.floors[cal + ' 基线'];
    const e1 = res.floors[cal + ' + E1'];
    console.log('\n=== E1 作用层段 · 死因拆解（口径 ' + cal + '，总体净变化）===');
    console.log('层  基线死  E1死   净减   E1首领 净减  E1精英 净减  E1普通 净减');
    let total = 0;
    for (let f = 1; f <= 10; f += 1) {
      const b = base[f];
      const e = e1[f];
      const db = b.deaths - e.deaths;
      total += db;
      const rb = b.roomDeaths || { boss: 0, elite: 0, battle: 0 };
      const re = e.roomDeaths || { boss: 0, elite: 0, battle: 0 };
      console.log(String('F' + f).padEnd(4)
        + String(b.deaths).padEnd(9) + String(e.deaths).padEnd(7)
        + String(db).padEnd(7)
        + String(re.boss).padEnd(8) + String(rb.boss - re.boss).padEnd(4)
        + String(re.elite).padEnd(8) + String(rb.elite - re.elite).padEnd(4)
        + String(re.battle).padEnd(8) + String(rb.battle - re.battle));
    }
    console.log('F1–F10 死亡净减合计: ' + total + '（对应 10 层通关净增 ' + Math.round(total / opts.runs * 10000) + ' 人量级）');
    console.log('注：同人配对（谁被救）在本模拟器不成立 —— 选卡与楼层共用随机流，E1 多一个等级会改变后续随机消耗。');
    console.log('    上面是"总体死亡净变化"，有效；"某个人原本死在哪"不可拆，需实机 Math.random 卡面才能配对。');
  });

  console.log('\n产物: ' + outPath);
}

main();
