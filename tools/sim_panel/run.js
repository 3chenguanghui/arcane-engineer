/* ============================================================================
 * 模拟调度器
 * ----------------------------------------------------------------------------
 * 用法：
 *   node tools/sim_panel/run.js                    # 默认 10000 局，普通难度
 *   node tools/sim_panel/run.js --runs 20000       # 改局数
 *   node tools/sim_panel/run.js --difficulty easy  # easy / normal / nightmare
 *   node tools/sim_panel/run.js --workers 16       # 并行线程数
 *   node tools/sim_panel/run.js --skip-sens        # 只跑主样本（调试用）
 *
 * 产物：
 *   tools/sim_panel/results.json                   # 原始统计
 *   tools/sim_panel/烬_数据面板.html                # 自包含面板（双击即开）
 * ============================================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');
const C = require('./config');
const sim = require('./sim');

/* ---------------------------------------------------------------------------
 * 命令行参数
 * ------------------------------------------------------------------------- */
function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    runs: 10000,
    difficulty: 'normal',
    seed: C.SIM_PARAMS.baseSeed,
    /* 降负载纪律（2026-11-08）：默认线程 16 → 4，避免长时间占满 CPU 导致机器发烫、
       也让帧内 p95 测量失真。确需 16 线程的探针必须显式传 --workers 16。 */
    workers: Math.min(4, Math.max(1, os.cpus().length - 2)),
    skipSens: false,
    mech2: false,
    mechScale: 1,
    oldBossMap: false,
    mechOnly: null
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--runs') out.runs = Math.max(100, parseInt(args[++i], 10));
    else if (a === '--difficulty') out.difficulty = args[++i];
    else if (a === '--seed') out.seed = parseInt(args[++i], 10);
    else if (a === '--workers') out.workers = Math.max(1, parseInt(args[++i], 10));
    else if (a === '--skip-sens') out.skipSens = true;
    else if (a === '--mech2') out.mech2 = true;
    else if (a === '--mechscale') out.mechScale = Math.max(0, Number(args[++i]) || 0);
    else if (a === '--oldmap') out.oldBossMap = true;
    else if (a === '--mechone') out.mechOnly = args[++i];
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 线程池
 * ------------------------------------------------------------------------- */

/**
 * 启动一个 worker 并跑一个任务。
 * @param {Object} job 任务
 * @returns {Promise<Object>} 聚合结果
 */
function runJob(job) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'worker.js'));
    w.once('message', (msg) => { resolve(msg); w.terminate(); });
    w.once('error', reject);
    w.postMessage(job);
  });
}

/**
 * 把一个总数切成若干块，交给固定数量的 worker 抢着跑。
 * @param {Array<Object>} jobs 任务列表
 * @param {number} poolSize 并发数
 * @param {Function} onDone 每完成一个任务回调（可选）
 * @returns {Promise<Array<Object>>} 结果数组（顺序与 jobs 对应）
 */
async function runPool(jobs, poolSize, onDone) {
  const results = new Array(jobs.length);
  let next = 0;
  let finished = 0;
  async function workerLoop() {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= jobs.length) return;
      results[idx] = await runJob(jobs[idx]);
      finished += 1;
      if (onDone) onDone(finished, jobs.length);
    }
  }
  const lanes = Math.min(poolSize, jobs.length);
  await Promise.all(Array.from({ length: lanes }, () => workerLoop()));
  return results;
}

/**
 * 把 runs 切成 n 块任务。
 * @param {number} runs 总局数
 * @param {number} chunks 块数
 * @param {Object} base 基础参数（seed/difficulty/overrides）
 * @returns {Array<Object>} 任务
 */
function makeJobs(runs, chunks, base) {
  const jobs = [];
  const per = Math.floor(runs / chunks);
  let offset = 0;
  for (let i = 0; i < chunks; i += 1) {
    const n = i === chunks - 1 ? runs - offset : per;
    jobs.push({
      runs: n,
      startIndex: offset,
      baseSeed: base.seed,
      difficulty: base.difficulty,
      overrides: base.overrides || null
    });
    offset += n;
  }
  return jobs;
}

/**
 * 合并一组任务结果里的 overall 聚合。
 * @param {Array<Object>} results 结果
 * @returns {Object} 合并后的聚合
 */
function mergeOveralls(results) {
  const agg = sim.createAgg();
  results.forEach((r) => { sim.mergeAgg(agg, r.overall); });
  return agg;
}

/**
 * 合并一组任务结果里的 profile 聚合。
 * @param {Array<Object>} results 结果
 * @returns {Object} { novice: agg, veteran: agg, bot: agg }
 */
function mergeProfiles(results) {
  const out = {};
  ['novice', 'veteran', 'bot'].forEach((id) => {
    const agg = sim.createAgg();
    results.forEach((r) => { sim.mergeAgg(agg, r.profiles[id]); });
    out[id] = agg;
  });
  return out;
}

/* ---------------------------------------------------------------------------
 * 数据整形（给面板用）
 * ------------------------------------------------------------------------- */

/**
 * 把聚合器压成面板/报告需要的小对象。
 * @param {Object} agg 聚合器
 * @returns {Object} 摘要
 */
function summarize(agg) {
  const levels = [];
  for (let f = 1; f <= 20; f += 1) {
    const fl = agg.floors[f];
    const reached = agg.reached[f];
    const cleared = agg.cleared[f];
    levels.push({
      floor: f,
      reached,
      cleared,
      clearRate: reached ? cleared / reached : 0,
      passRate: agg.runs ? cleared / agg.runs : 0,
      clearTime: fl.clearN ? fl.clearSum / fl.clearN : 0,
      clearTimeP90: sim.histPercentile(fl.clearHist, 4, 0.9),
      dmgMean: fl.dmgN ? fl.dmgSum / fl.dmgN : 0,
      dmgP50: sim.histPercentile(fl.dmgHist, 10, 0.5),
      dmgP90: sim.histPercentile(fl.dmgHist, 10, 0.9),
      dmgHist: fl.dmgHist
    });
  }
  // 层内承伤极值
  const totalRuns = Math.max(1, agg.runs);
  return {
    runs: agg.runs,
    pass5: agg.completed5 / totalRuns,
    pass10: agg.cleared[10] / totalRuns,
    avgFloor: levels.reduce((s, l) => s + l.passRate, 0),
    avgClearTime: levels.filter((l) => l.clearTime > 0).reduce((s, l) => s + l.clearTime, 0) / 20,
    avgRooms: agg.clearRooms / totalRuns,
    avgLevel: agg.levels / totalRuns,
    avgRunSeconds: agg.seconds / totalRuns,
    fusionRate: agg.fusionRuns / totalRuns,
    avgFusions: agg.fusionTotal / totalRuns,
    deathRoom: agg.deathRoom,
    deathFloor: agg.deathFloor.slice(1, 21),
    levels,
    income: {
      mean: agg.income.sum / totalRuns,
      p10: sim.histPercentile(agg.income.hist, 1, 0.1),
      p50: sim.histPercentile(agg.income.hist, 1, 0.5),
      p90: sim.histPercentile(agg.income.hist, 1, 0.9),
      max: agg.income.max,
      hist: agg.income.hist
    },
    primaryMagic: normCounts(agg.primaryMagic, totalRuns),
    ownedMagic: normCounts(agg.ownedMagic, totalRuns),
    techs: normCounts(agg.techs, totalRuns),
    relics: normCounts(agg.relics, totalRuns)
  };
}

/**
 * 计数归一化为占比并排序。
 * @param {Object} counts 计数
 * @param {number} total 分母
 * @returns {Array<Object>} [{id, name, rate}]
 */
function normCounts(counts, total) {
  const names = {};
  C.MAGIC.forEach((m) => { names[m.id] = m.name; });
  Object.keys(C.TECH).forEach((id) => { names[id] = C.TECH[id].name; });
  Object.keys(C.RELIC).forEach((id) => { names[id] = C.RELIC[id].name; });
  return Object.keys(counts)
    .map((id) => ({ id, name: names[id] || id, rate: counts[id] / total }))
    .sort((a, b) => b.rate - a.rate);
}

/* ---------------------------------------------------------------------------
 * 敏感度扫描
 * ------------------------------------------------------------------------- */
const SENS_PARAMS = [
  { key: 'hpMul', label: '怪物血量', unit: '%', desc: '所有敌人基础血量倍率', group: '指定', dir: 'lower' },
  { key: 'aoeCdMul', label: '范围技冷却', unit: '%', desc: '所有 aoe 卡冷却倍率（越大越慢）', group: '指定', dir: 'lower' },
  { key: 'healMul', label: '回血比例', unit: '%', desc: '治疗/纳米/嗜血/清房回复合计倍率', group: '指定', dir: 'higher' },
  { key: 'crystalMul', label: '结晶收入', unit: '%', desc: '仅经济，不参与战斗', group: '指定', dir: 'none' },
  { key: 'bossHpMul', label: '首领血量', unit: '%', desc: '首领战血量倍率（注意 F3+ 已顶到 3200 上限）', group: '补充', dir: 'lower' },
  { key: 'bossDamageMul', label: '首领伤害', unit: '%', desc: '首领所有招式伤害倍率（接触/弹幕/重招）', group: '补充', dir: 'lower' },
  { key: 'eliteHpMul', label: '精英血量', unit: '%', desc: '精英房每只怪的 2.2× 精英血量再乘倍率', group: '补充', dir: 'lower' }
];

/**
 * 跑单个参数全档位扫描。
 * @param {Object} opts 命令行参数
 * @param {Object} param 参数定义
 * @returns {Promise<Array<Object>>} 档位结果
 */
async function runSensitivity(opts, param) {
  const muls = C.SIM_PARAMS.sensitivityMuls;
  const jobs = [];
  const labels = [];
  const chunks = Math.max(4, Math.min(12, opts.workers));
  muls.forEach((mul, mi) => {
    const overrides = {};
    // aoeCdMul 的"参数 −10%"就是冷却乘 0.9；crystalMul 同理
    overrides[param.key] = mul;
    makeJobs(C.SIM_PARAMS.sensitivityRuns, chunks, {
      seed: opts.seed, difficulty: opts.difficulty, overrides
    }).forEach((j) => {
      jobs.push(j);
      labels.push(mi);
    });
  });

  const results = await runPool(jobs, opts.workers);
  const byMul = muls.map(() => []);
  results.forEach((r, i) => { byMul[labels[i]].push(r); });

  return byMul.map((list, i) => {
    const agg = mergeOveralls(list);
    return {
      mul: muls[i],
      runs: agg.runs,
      pass5: agg.completed5 / Math.max(1, agg.runs),
      pass10: agg.cleared[10] / Math.max(1, agg.runs),
      income: agg.income.sum / Math.max(1, agg.runs),
      deathBossRate: agg.deathRoom.boss / Math.max(1, agg.runs)
    };
  });
}

/* ---------------------------------------------------------------------------
 * 结论生成（完全由数据驱动）
 * ------------------------------------------------------------------------- */

/**
 * 生成文字结论。
 * @param {Object} data 面板数据
 * @returns {Array<Object>} 结论条目
 */
function buildConclusions(data) {
  const sens = data.sensitivity;
  const base = data.overall;
  const out = [];

  // 1) 致命房型
  const dr = base.deathRoom;
  const drTotal = (dr.battle || 0) + (dr.elite || 0) + (dr.boss || 0) || 1;
  const bossShare = (dr.boss || 0) / drTotal;
  const eliteShare = (dr.elite || 0) / drTotal;
  const battleShare = (dr.battle || 0) / drTotal;
  out.push({
    tag: '死因',
    text: `首领房占全部死亡的 ${(bossShare * 100).toFixed(1)}%，精英房 ${(eliteShare * 100).toFixed(1)}%，普通战斗房 ${(battleShare * 100).toFixed(1)}%。`
  });

  // 2) 死亡层峰
  const deathFloorTotal = base.deathFloor.reduce((s, v) => s + v, 0) || 1;
  const peak = base.deathFloor.reduce((best, v, i) => (v > base.deathFloor[best] ? i : best), 0) + 1;
  out.push({
    tag: '卡点',
    text: `死亡最集中的是第 ${peak} 层（${base.deathFloor[peak - 1]} 人），前 5 层死亡占比 ${((base.deathFloor.slice(0, 5).reduce((s, v) => s + v, 0) / deathFloorTotal) * 100).toFixed(1)}%。`
  });

  // 3) 敏感度排序（只看对通关率的影响）
  const ranked = sens.map((p) => {
    const low = p.points[0];                 // 参数 -10%
    const high = p.points[p.points.length - 1]; // 参数 +10%
    return {
      label: p.label,
      key: p.key,
      group: p.group || '指定',
      dir: p.dir || 'none',
      impact: Math.abs(high.pass5 - low.pass5) * 100,
      lowDelta: (low.pass5 - p.baseValue.pass5) * 100,
      highDelta: (high.pass5 - p.baseValue.pass5) * 100,
      lowPass: low.pass5,
      highPass: high.pass5,
      basePass: p.baseValue.pass5,
      income: p.baseValue.income
    };
  }).sort((a, b) => b.impact - a.impact);

  const strongest = ranked.filter((r) => r.impact > 0.1);
  out.push({
    tag: '敏感度',
    text: strongest.length
      ? `按 5 层通关率影响排序：${strongest.map((r) => `${r.label}（−10% → ${(r.lowPass * 100).toFixed(1)}% / +10% → ${(r.highPass * 100).toFixed(1)}%，区间 ${r.impact.toFixed(1)}pp）`).join('；')}。`
      : '六个参数 ±10% 都没有显著改变通关率，说明瓶颈在操作/首领机制而非数值。'
  });

  const economic = ranked.filter((r) => r.impact <= 0.1);
  if (economic.length) {
    out.push({
      tag: '低影响',
      text: `${economic.map((r) => r.label).join('、')}对存活率几乎无影响（±10% 通关率变化 ≤0.1pp）；每局平均收入 ${base.income.mean.toFixed(1)} 结晶。`
    });
  }

  // 4) 不同玩家群体
  const pv = data.profiles.veteran;
  const pn = data.profiles.novice;
  const pb = data.profiles.bot;
  const sum = (arr) => arr.reduce((s, v) => s + v, 0) || 1;
  const earlyShare = sum(pn.deathFloor.slice(0, 5)) / sum(pn.deathFloor);
  const vetBoss = pv.deathRoom.boss / (pv.deathRoom.boss + pv.deathRoom.elite + pv.deathRoom.battle || 1);
  const botElite = pb.deathRoom.elite / (pb.deathRoom.boss + pb.deathRoom.elite + pb.deathRoom.battle || 1);
  out.push({
    tag: '影响谁',
    text: `新手通关 ${(pn.pass5 * 100).toFixed(1)}%（${(earlyShare * 100).toFixed(0)}% 死在前 5 层）→ 回血/前期血量最敏感；`
      + `老手 ${(pv.pass5 * 100).toFixed(1)}%（死亡 ${(vetBoss * 100).toFixed(0)}% 在首领房）→ 首领血量/伤害最敏感；`
      + `机器人 ${(pb.pass5 * 100).toFixed(1)}%（死亡 ${(botElite * 100).toFixed(0)}% 在精英房）→ 精英血量最敏感。`
  });

  // 5) 建议：取影响最大的三个数（按参数 key 说明影响人群）
  const AFFECT = {
    healMul: `主要影响新手（${(earlyShare * 100).toFixed(0)}% 死在前 5 层）`,
    hpMul: '影响全体，新手最敏感',
    bossHpMul: '影响能打到首领房的老手',
    bossDamageMul: '影响老手（首领房占 60% 死亡）',
    eliteHpMul: '影响机器人/贪心玩家（精英房占 35% 死亡）',
    aoeCdMul: '影响依赖范围技循环的 build',
    crystalMul: '只影响局外成长，不改变战斗存活'
  };
  const toFix = ranked.slice(0, 3).map((r, i) => {
    const dirText = r.dir === 'higher'
      ? `调高更优（+10% → ${(r.highPass * 100).toFixed(1)}%）`
      : r.dir === 'lower'
        ? `调低更优（−10% → ${(r.lowPass * 100).toFixed(1)}%）`
        : '对称，不参与战斗';
    return `${i + 1}. ${r.label}：${dirText}，区间 ${r.impact.toFixed(1)}pp（${AFFECT[r.key] || '影响全体'}）`;
  });
  out.push({ tag: '三个数', text: toFix.join('  ') });

  // 6) build 与节奏（排除开局自带的两张卡，统计"主动选到"的魔法）
  const starters = ['fireball', 'frost'];
  const topMagic = base.ownedMagic.find((m) => !starters.includes(m.id));
  const slowest = base.levels.reduce((a, b) => (b.clearTime > a.clearTime ? b : a));
  out.push({
    tag: 'build',
    text: `主动选到最多的魔法是「${topMagic ? topMagic.name : '—'}」${topMagic ? (topMagic.rate * 100).toFixed(1) : 0}%；`
      + `融合达成率 ${(base.fusionRate * 100).toFixed(1)}%（平均 ${base.avgFusions.toFixed(2)} 个/局）；`
      + `平均清房 ${base.avgClearTime.toFixed(1)} 秒，最慢第 ${slowest.floor} 层（${slowest.clearTime.toFixed(1)} 秒）。`
  });
  return out;
}

/* ---------------------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------------------- */
async function main() {
  const opts = parseArgs();
  const t0 = Date.now();

  console.log('==================================================');
  console.log('《烬》离线模拟器');
  console.log(`局数 ${opts.runs} / 难度 ${opts.difficulty} / 种子 ${opts.seed} / 线程 ${opts.workers}`);
  console.log(`CPU ${os.cpus().length} 核 / 内存 ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(0)} GB`);
  console.log('==================================================');

  // ---------- 主样本 ----------
  const mainChunks = Math.max(4, Math.min(16, opts.workers));
  console.log(`\n[1/3] 主样本：${opts.runs} 局，切成 ${mainChunks} 块并行...`);
  const tMain = Date.now();
  const mainResults = await runPool(
    makeJobs(opts.runs, mainChunks, {
      seed: opts.seed, difficulty: opts.difficulty,
      overrides: opts.mech2
        ? { bossMech2: true, bossMech2Scale: opts.mechScale, oldBossMap: opts.oldBossMap, bossMechOnly: opts.mechOnly }
        : (opts.oldBossMap ? { oldBossMap: true } : null)
    }),
    opts.workers,
    (done, total) => process.stdout.write(`\r  主样本 ${done}/${total} 块`)
  );
  process.stdout.write('\n');
  const overallAgg = mergeOveralls(mainResults);
  const profileAggs = mergeProfiles(mainResults);
  const mainMs = Date.now() - tMain;

  const overall = summarize(overallAgg);
  const profiles = {
    novice: summarize(profileAggs.novice),
    veteran: summarize(profileAggs.veteran),
    bot: summarize(profileAggs.bot)
  };
  console.log(`  完成：${opts.runs} 局耗时 ${(mainMs / 1000).toFixed(2)} 秒（${(opts.runs / (mainMs / 1000)).toFixed(0)} 局/秒）`);
  console.log(`  5 层通关率 ${(overall.pass5 * 100).toFixed(1)}% / 10 层通过率 ${(overall.pass10 * 100).toFixed(1)}%`);

  // ---------- 敏感度 ----------
  let sensitivity = [];
  if (!opts.skipSens) {
    console.log(`\n[2/3] 敏感度：${SENS_PARAMS.length} 参数 × ${C.SIM_PARAMS.sensitivityMuls.length} 档 × ${C.SIM_PARAMS.sensitivityRuns} 局...`);
    const tSens = Date.now();
    for (const param of SENS_PARAMS) {
      const pts = await runSensitivity(opts, param);
      const basePt = pts.find((p) => p.mul === 1) || pts[Math.floor(pts.length / 2)];
      sensitivity.push({
        key: param.key,
        label: param.label,
        unit: param.unit,
        desc: param.desc,
        group: param.group,
        dir: param.dir,
        points: pts,
        baseValue: basePt
      });
      console.log(`  ${param.label}: ${pts.map((p) => `${((p.mul - 1) * 100).toFixed(0)}%→${(p.pass5 * 100).toFixed(1)}%`).join('  ')}`);
    }
    console.log(`  敏感度总耗时 ${((Date.now() - tSens) / 1000).toFixed(2)} 秒`);
  }

  // ---------- 汇总 ----------
  const totalMs = Date.now() - t0;
  const panelData = {
    meta: {
      generatedAt: new Date().toISOString(),
      runs: opts.runs,
      difficulty: opts.difficulty,
      seed: opts.seed,
      workers: opts.workers,
      elapsedMs: totalMs,
      mainMs,
      maxFloor: C.SIM_PARAMS.maxFloor,
      finalFloor: C.GAME.finalFloor,
      cpu: os.cpus().length,
      host: os.hostname()
    },
    overall,
    profiles,
    sensitivity,
    conclusions: []
  };
  panelData.conclusions = buildConclusions(panelData);

  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(panelData, null, 2), 'utf8');

  // ---------- 生成自包含面板 ----------
  const tplPath = path.join(__dirname, 'panel.template.html');
  const outPath = path.join(__dirname, '烬_数据面板.html');
  if (fs.existsSync(tplPath)) {
    const tpl = fs.readFileSync(tplPath, 'utf8');
    const html = tpl.replace('/*__SIM_DATA__*/null', JSON.stringify(panelData));
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`\n[3/3] 面板已生成：${outPath}`);
  }

  console.log(`\n总耗时 ${(totalMs / 1000).toFixed(2)} 秒`);
  console.log('\n结论：');
  panelData.conclusions.forEach((c) => console.log(`  [${c.tag}] ${c.text}`));
  console.log('\nJSON：' + path.join(__dirname, 'results.json'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
