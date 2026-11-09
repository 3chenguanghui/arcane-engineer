/* ============================================================================
 * 难度分层诊断探针（只读主文件，不改模拟器默认参数）
 * ----------------------------------------------------------------------------
 * 目的：
 *   1. 量出「普通 / 困难」两档的通关率、逐层死亡率差、逐层耗时差、死亡归因；
 *   2. 判断困难的"难"是否只来自 hpMul（血厚）还是真的改变了决策压力；
 *   3. 给三档设计提供可测数值，测不了的机制明确输出"未测"。
 *
 * 口径：
 *   - A = 历史口径（无真实保底精英房），与 v1.6.1 判据同源；
 *   - A′ = 主口径（eliteMandatory 保底必经率）；
 *   - 每档单独 10,000 局、同一 seed 20261108、bot。
 *   - 前 5 层教学固定 normal（sim.diffAt 已实现），故两档差异从 F6 起才生效。
 *
 * 进阶用法（原型档，不写主文件；只在本进程内注入）：
 *   --tier hard2:2.70/1.05/1.08/0.54/0.85/1.20/1.12/1.0
 *     依次为 hpMul/countMul/speedMul/damageMul/dropMul/eliteHpMul/pressure/regenMul
 *   regenMul = 玩家回能倍率（<1 表示回蓝更慢，对应"资源更少"）。默认 1。
 *     ⚠ 模拟器的回能只有一个全局值，无法按层门控，所以 regenMul 会同时影响 F1–F5。
 *   --onboard 0  把教学层豁免从 5 层降为 0 层（= "困难档取消前 5 层保护"）。
 *     对 normal 档无影响（F1–F5 本来就返回 normal 表）；只改变其他档在 F1–F5 生效。
 *     ⚠ 该开关也会同时去掉前 5 层的"数量 −20%"（同一常量被两处引用），普通基线会从
 *     35.1% 掉到 ~31%，所以只能在"无教学减免"口径内做横向比较，不能与产品基线比。
 *   --tier 第 9 个字段 countAdd：F6+ 每间战斗/精英房 +N 只（模拟"困难档数量轴"）。
 *     ⚠ 主文件的 countMul 在预算层被 cap=max(7,区间上界) + 取整吞掉（F6/7 的 7×1.05→7，
 *     F9+ 的 8×1.05→8），所以困难档现在的数量轴实际为 0；这里用 +N 才能测出数量杠杆。
 *
 * 产物：tools/sim_panel/probe_difficulty_<profile>.json / .log
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

const MANDATORY = { 2: 0.44, 3: 0.10, 4: 0.52, 5: 0.47 };
for (let f = 6; f <= 20; f += 1) MANDATORY[f] = 0.465;

/**
 * 解析命令行
 * @returns {Object} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { runs: 10000, profile: 'bot', seed: C.SIM_PARAMS.baseSeed, tiers: [], onboard: 5 };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (a[i] === '--profile') o.profile = a[++i];
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
    else if (a[i] === '--tier') o.tiers.push(a[++i]);
    else if (a[i] === '--onboard') o.onboard = Math.max(0, parseInt(a[++i], 10));
  }
  return o;
}

/**
 * 升序数组按分位取数（最近秩法）
 * @param {number[]} s 升序数组
 * @param {number} p 0–1
 * @returns {number|null} 分位值
 */
function q(s, p) {
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * p)))];
}

/**
 * 秒数摘要（P50/P90/P95/max/均值/标准差/中位数标准误）
 * @param {number[]} arr 秒数
 * @returns {Object} 摘要
 */
function stat(arr) {
  if (!arr.length) return { n: 0 };
  const s = arr.slice().sort((x, y) => x - y);
  const n = s.length;
  const mean = s.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(s.reduce((x, y) => x + (y - mean) * (y - mean), 0) / Math.max(1, n - 1));
  return {
    n,
    avg: +mean.toFixed(1),
    sd: +sd.toFixed(1),
    p50: q(s, 0.50),
    p90: q(s, 0.90),
    p95: q(s, 0.95),
    max: s[n - 1],
    over90: s.filter((v) => v > 90).length,
    over90Pct: +(s.filter((v) => v > 90).length / n * 100).toFixed(2),
    se: +(1.253 * sd / Math.sqrt(n)).toFixed(2)
  };
}

/**
 * 注册一个原型难度档（仅在当前进程生效，不写 config.js）
 * @param {string} spec "硬2:hp/count/speed/damage/drop/eliteHp/pressure/regen"
 */
function registerTier(spec) {
  const [name, nums] = spec.split(':');
  const v = nums.split('/').map(Number);
  C.DIFFICULTY[name] = {
    id: name, label: name,
    hpMul: v[0], countMul: v[1], speedMul: v[2], damageMul: v[3],
    dropMul: v[4], eliteHpMul: v[5], pressure: v[6], regenMul: v[7] === undefined ? 1 : v[7],
    countAdd: v[8] === undefined ? 0 : v[8],
    xpMul: v[9] === undefined ? 1 : v[9]
  };
}

/**
 * 临时把 F6+ 的敌人数区间整体 +N（仅当前进程生效，跑完立刻还原）
 * @param {number} add 每间战斗/精英房增加只数（0 = 不改）
 * @returns {Function} 还原函数
 */
function applyCountAdd(add) {
  if (!add) return () => {};
  const backup = {};
  for (let f = 6; f <= 20; f += 1) {
    const row = C.RAMP_BY_FLOOR[f];
    backup[f] = { battle: row.battle.slice(), elite: row.elite.slice() };
    row.battle = [row.battle[0] + add, row.battle[1] + add];
    row.elite = [row.elite[0] + add, row.elite[1] + add];
  }
  return () => {
    Object.keys(backup).forEach((k) => {
      C.RAMP_BY_FLOOR[k].battle = backup[k].battle;
      C.RAMP_BY_FLOOR[k].elite = backup[k].elite;
    });
  };
}

/**
 * 单档采集：逐层时长/死亡/归因 + 全局通关
 * @param {string} diffId 难度 id
 * @param {number} runs 局数
 * @param {number} seed 种子
 * @param {string[]} ids profile 列表
 * @param {Object} ov 覆盖参数
 * @returns {Object} 结果
 */
function collect(diffId, runs, seed, ids, ov) {
  const floors = {};
  for (let f = 1; f <= 20; f += 1) {
    floors[f] = { entries: 0, cleared: 0, deaths: 0, causes: {}, sec: [], bossSec: [], bossDeaths: 0 };
  }
  let pass10 = 0; let clear20 = 0; let deathFloorSum = 0; let died = 0; let totalSec = 0;
  const causeAll = {};

  for (let i = 0; i < runs; i += 1) {
    const r = sim.runOne(sim.runSeed(seed, i), C.PROFILES[ids[i % ids.length]], diffId, ov);
    totalSec += r.seconds;
    if (r.clearedFloors >= 10) pass10 += 1;
    if (r.clearedFloors >= 20) clear20 += 1;
    if (r.died) { died += 1; deathFloorSum += r.deathFloor; causeAll[r.deathRoom || 'other'] = (causeAll[r.deathRoom || 'other'] || 0) + 1; }
    r.floorTrace.forEach((t) => {
      const x = floors[t.floor];
      x.entries += 1;
      if (t.died) {
        x.deaths += 1;
        x.causes[t.deathRoom || 'other'] = (x.causes[t.deathRoom || 'other'] || 0) + 1;
      } else {
        x.cleared += 1;
        x.sec.push(t.clearSeconds);
      }
      if (t.boss) {
        if (t.boss.died) x.bossDeaths += 1;
        else if (!t.boss.timedOut) x.bossSec.push(t.boss.seconds);
      }
    });
  }

  const rows = {};
  for (let f = 1; f <= 20; f += 1) {
    const x = floors[f];
    rows[f] = {
      entries: x.entries, cleared: x.cleared, deaths: x.deaths,
      deathRatePct: +(x.deaths / Math.max(1, x.entries) * 100).toFixed(2),
      survivalPct: +(x.cleared / Math.max(1, runs) * 100).toFixed(1),
      causes: x.causes, bossDeaths: x.bossDeaths,
      time: stat(x.sec), boss: stat(x.bossSec)
    };
  }
  return {
    floors: rows,
    pass10Pct: +(pass10 / runs * 100).toFixed(1),
    clear20Pct: +(clear20 / runs * 100).toFixed(1),
    deathPct: +(died / runs * 100).toFixed(1),
    avgDeathFloor: died ? +(deathFloorSum / died).toFixed(2) : 0,
    avgRunSec: +(totalSec / runs).toFixed(1),
    causes: causeAll
  };
}

/**
 * 相邻层"超分辨力下降"扫描（与 probe_f1011 同一判定：diff < −2×合并SE）
 * @param {Object} res 单档结果
 * @returns {Object[]} 凹点
 */
function concavity(res) {
  const hits = [];
  for (let f = 2; f <= 20; f += 1) {
    const a = res.floors[f - 1].time;
    const b = res.floors[f].time;
    if (!a.n || !b.n) continue;
    const diff = +(b.p50 - a.p50).toFixed(1);
    const se = +Math.sqrt(a.se * a.se + b.se * b.se).toFixed(2);
    if (diff < -(2 * se)) hits.push({ from: f - 1, to: f, diff, se });
  }
  return hits;
}

/**
 * 打印单档全表
 * @param {string} name 档名
 * @param {Object} res 结果
 */
function printOne(name, res, fromFloor) {
  const start = fromFloor || 6;
  console.log('\n=== ' + name + ' · 逐层 ===');
  console.log('层  进入   存活率  死亡   死亡率  均时   P50    P95    max  >90%  首领P50/P95/>90%  死因battle/elite/boss');
  for (let f = start; f <= 20; f += 1) {
    const r = res.floors[f];
    const c = r.causes;
    console.log(
      String('F' + f).padEnd(4)
      + String(r.entries).padEnd(7) + String(r.survivalPct + '%').padEnd(8)
      + String(r.deaths).padEnd(6) + String(r.deathRatePct + '%').padEnd(7)
      + String(r.time.avg == null ? '-' : r.time.avg).padEnd(6)
      + String(r.time.p50 == null ? '-' : r.time.p50).padEnd(7)
      + String(r.time.p95 == null ? '-' : r.time.p95).padEnd(7)
      + String(r.time.max == null ? '-' : r.time.max).padEnd(6)
      + String(r.time.over90Pct == null ? '-' : r.time.over90Pct + '%').padEnd(7)
      + (String(r.boss.p50 == null ? '-' : r.boss.p50) + '/' + String(r.boss.p95 == null ? '-' : r.boss.p95)
        + '/' + String(r.boss.over90Pct == null ? '-' : r.boss.over90Pct + '%')).padEnd(20)
      + String('b' + (c.battle || 0) + '/e' + (c.elite || 0) + '/boss' + (c.boss || 0))
    );
  }
  console.log('【' + name + '】10 层 ' + res.pass10Pct + '% ｜ 通关 ' + res.clear20Pct + '% ｜ 死亡率 '
    + res.deathPct + '% ｜ 平均死亡层 F' + res.avgDeathFloor + ' ｜ 平均战斗时长 ' + res.avgRunSec + 's');
  console.log('死亡归因（全局）：' + JSON.stringify(res.causes));
  const h = concavity(res);
  console.log('凹点 ' + h.length + ' 处：' + (h.length ? h.map((x) => 'F' + x.from + '→F' + x.to + ' ' + x.diff + 's').join(' · ') : '无'));
}

/**
 * 打印两档对比（硬 − 普通）
 * @param {Object} base 普通
 * @param {Object} hard 困难
 */
function printDelta(base, hard, fromFloor) {
  const start = fromFloor || 6;
  console.log('\n=== 逐层差值（困难 − 普通）===');
  console.log('层   存活率差(pp)  死亡率差(pp)  耗时P50差(s)  耗时比值  首领P50差(s)  首领P95差(s)');
  for (let f = start; f <= 20; f += 1) {
    const a = base.floors[f];
    const b = hard.floors[f];
    const tr = a.time.p50 ? +(b.time.p50 / a.time.p50).toFixed(2) : null;
    console.log(
      String('F' + f).padEnd(5)
      + String(+(b.survivalPct - a.survivalPct).toFixed(1)).padEnd(14)
      + String(+(b.deathRatePct - a.deathRatePct).toFixed(2)).padEnd(13)
      + String(+(b.time.p50 - a.time.p50).toFixed(1)).padEnd(13)
      + String(tr == null ? '-' : tr + 'x').padEnd(9)
      + String(+(b.boss.p50 - a.boss.p50).toFixed(1)).padEnd(13)
      + String(+(b.boss.p95 - a.boss.p95).toFixed(1))
    );
  }
  // 差距从第几层开始拉开：存活率差首次 ≥2pp 且此后持续
  let openAt = null;
  for (let f = start; f <= 19; f += 1) {
    if (hard.floors[f].survivalPct - base.floors[f].survivalPct <= -2) { openAt = f; break; }
  }
  console.log('两档差距首次拉开于：' + (openAt ? 'F' + openAt : '未拉开（全程 <2pp）'));
}

/**
 * 主流程
 */
function main() {
  const o = parseArgs();
  const ids = o.profile === 'mix' ? ['novice', 'veteran', 'bot'] : [o.profile];
  o.tiers.forEach(registerTier);
  // 教学层豁免：默认 5 层。设为 0 时，非 normal 档从第 1 层就生效。
  C.ONBOARD.maxFloors = o.onboard;
  console.log('教学层豁免 maxFloors = ' + C.ONBOARD.maxFloors
    + (o.onboard === 5 ? '（默认）' : '（困难档取消前 5 层保护）'));

  const cutCaps = {};
  for (let f = 12; f <= 17; f += 1) cutCaps[f] = Math.round(C.BOSS.hpCap * (1 + C.BOSS.hpCapRampPerFloor * (f - 1)) * 0.65);
  cutCaps[18] = Math.round(C.BOSS.hpCap * (1 + C.BOSS.hpCapRampPerFloor * 17) * 0.60);
  cutCaps[19] = Math.round(C.BOSS.hpCap * (1 + C.BOSS.hpCapRampPerFloor * 18) * 0.62);

  const out = { meta: { at: new Date().toISOString(), runs: o.runs, profile: o.profile, seed: o.seed, onboard: o.onboard, mainFile: 'B56D9975' }, diffs: {} };
  const plan = [
    { key: 'normal', id: 'normal', ov: {} },
    { key: 'hard', id: 'nightmare', ov: {} },
    { key: 'normalA2', id: 'normal', ov: { eliteMandatory: MANDATORY } },
    { key: 'hardA2', id: 'nightmare', ov: { eliteMandatory: MANDATORY } }
  ];
  o.tiers.forEach((t) => {
    const id = t.split(':')[0];
    plan.push({ key: id, id, ov: {} });
    plan.push({ key: id + 'A2', id, ov: { eliteMandatory: MANDATORY } });
  });

  plan.forEach((p) => {
    // regenMul：仅本进程临时改基础回能，跑完立刻还原
    const tier = C.DIFFICULTY[p.id];
    const regenBackup = C.GAME.baseRegen;
    let regenApplied = null;
    if (tier && tier.regenMul && tier.regenMul !== 1) {
      C.GAME.baseRegen = regenBackup * tier.regenMul;
      regenApplied = C.GAME.baseRegen;
    }
    const countRestore = applyCountAdd(tier && tier.countAdd ? tier.countAdd : 0);
    // xpMul：击杀经验整体缩放（模拟"困难档成长更慢"），跑完立刻还原
    const xpBackup = { normal: C.XP.killXp.normal, elite: C.XP.killXp.elite, boss: C.XP.killXp.boss };
    if (tier && tier.xpMul && tier.xpMul !== 1) {
      Object.keys(xpBackup).forEach((k) => { C.XP.killXp[k] = xpBackup[k] * tier.xpMul; });
    }
    out.diffs[p.key] = collect(p.id, o.runs, o.seed, ids, Object.assign({ bossCapByFloor: cutCaps }, p.ov));
    countRestore();
    Object.keys(xpBackup).forEach((k) => { C.XP.killXp[k] = xpBackup[k]; });
    out.diffs[p.key].difficultyId = p.id;
    out.diffs[p.key].countAdd = (tier && tier.countAdd) || 0;
    out.diffs[p.key].xpMul = (tier && tier.xpMul) || 1;
    out.diffs[p.key].regenBase = regenApplied == null ? regenBackup : +regenApplied.toFixed(2);
    if (regenApplied != null) C.GAME.baseRegen = regenBackup;
  });

  const from = o.onboard === 5 ? 6 : 1;
  ['normal', 'hard', 'normalA2', 'hardA2'].forEach((k) => printOne(k, out.diffs[k], from));
  printDelta(out.diffs.normal, out.diffs.hard, from);
  printDelta(out.diffs.normalA2, out.diffs.hardA2, from);
  o.tiers.forEach((t) => {
    const id = t.split(':')[0];
    printOne(id, out.diffs[id], from);
    printDelta(out.diffs.normal, out.diffs[id], from);
  });

  const outPath = path.join(__dirname, 'probe_difficulty_' + o.profile + (o.onboard === 5 ? '' : '_ob' + o.onboard) + '.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\n产物: ' + outPath);
}

main();
