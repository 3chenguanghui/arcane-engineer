/* ============================================================================
 * C1-15 · 三项贡献隔离测量（只读探针，不改正式数值路径）
 * ----------------------------------------------------------------------------
 * 目的：把「首领伤害 −10% / 怪物血量 −10% / 回血 +10%」三项拆开单独测，
 *       验证回退回血后叠加值回到 42% 附近，并顺手看「卡牌数量」的相关性
 *       （E1：F1 清层 +1 次三选一，等价 startLevels+1）。
 *
 * 用法：
 *   node tools/_tri_factor.js                      # 7 场景 × 10000 局
 *   node tools/_tri_factor.js --runs 4000          # 改局数（快速摸底）
 *   node tools/_tri_factor.js --workers 16
 *
 * 产物：.screenshots/balance/tri-factor.json
 * ============================================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');
const C = require('./sim_panel/config');
const sim = require('./sim_panel/sim');

const ROOT = path.join(__dirname, '..');

/**
 * 解析命令行参数。
 * @returns {{runs:number, workers:number, seed:number, difficulty:string}} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    runs: 10000,
    /* 降负载纪律：默认线程 16 → 4（与 sim_panel/run.js 一致），需要 16 时显式传参 */
    workers: Math.min(4, Math.max(1, os.cpus().length - 2)),
    seed: C.SIM_PARAMS.baseSeed,
    difficulty: 'normal'
  };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (a[i] === '--workers') o.workers = Math.max(1, parseInt(a[++i], 10));
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
    else if (a[i] === '--difficulty') o.difficulty = a[++i];
  }
  return o;
}

/**
 * 启动一个 worker 跑一块任务。
 * @param {Object} job 任务
 * @returns {Promise<Object>} 聚合结果
 */
function runJob(job) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'sim_panel', 'worker.js'));
    w.once('message', (msg) => { resolve(msg); w.terminate(); });
    w.once('error', reject);
    w.postMessage(job);
  });
}

/**
 * 固定并发跑完一批任务。
 * @param {Array<Object>} jobs 任务
 * @param {number} poolSize 并发
 * @returns {Promise<Array<Object>>} 结果
 */
async function runPool(jobs, poolSize) {
  const out = new Array(jobs.length);
  let next = 0;
  async function lane() {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= jobs.length) return;
      out[idx] = await runJob(jobs[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(poolSize, jobs.length) }, lane));
  return out;
}

/**
 * 把总局数切成任务块。
 * @param {number} runs 总局数
 * @param {number} chunks 块数
 * @param {Object} base 基础参数
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
 * 合并普通聚合。
 * @param {Array<Object>} results worker 结果
 * @returns {Object} 聚合
 */
function mergeOveralls(results) {
  const agg = sim.createAgg();
  results.forEach((r) => sim.mergeAgg(agg, r.overall));
  return agg;
}

/**
 * 合并某个玩家画像的聚合。
 * @param {Array<Object>} results worker 结果
 * @param {string} id 画像 id
 * @returns {Object} 聚合
 */
function mergeProfile(results, id) {
  const agg = sim.createAgg();
  results.forEach((r) => sim.mergeAgg(agg, r.profiles[id]));
  return agg;
}

/**
 * 把聚合器压成报告需要的指标。
 * @param {Object} agg 聚合
 * @param {Object} aggVeteran 老手聚合
 * @param {Object} aggNovice 新手聚合
 * @returns {Object} 指标
 */
function metrics(agg, aggVeteran, aggNovice) {
  const runs = Math.max(1, agg.runs);
  const bossDeaths = agg.deathRoom.boss || 0;
  const roomDeaths = (agg.deathRoom.battle || 0) + (agg.deathRoom.elite || 0) + bossDeaths;
  return {
    runs: agg.runs,
    pass5: agg.completed5 / runs,
    pass10: agg.cleared[10] / runs,
    avgLevel: agg.levels / runs,
    avgRunSeconds: agg.seconds / runs,
    bossDeathShare: roomDeaths ? bossDeaths / roomDeaths : 0,
    veteranPass5: aggVeteran.completed5 / Math.max(1, aggVeteran.runs),
    novicePass5: aggNovice.completed5 / Math.max(1, aggNovice.runs)
  };
}

/* 场景定义：基线口径是"回血已回退"的 config（0.15/0.05/0.04/0.18）。
   伤害/血量两项在 config 里已默认开启（0.9），所以"关掉"要用倒数还原到 1.0。
   deepHealMul 只作用于深层回血四类比例，不会污染吸血/自然回复。 */
const SCENARIOS = [
  { id: 'S0', label: '原版三项全关', ov: { hpMul: 1 / 0.9, bossDamageMul: 1 / 0.9 } },
  { id: 'S1', label: '仅首领伤害 −10%', ov: { hpMul: 1 / 0.9 } },
  { id: 'S2', label: '仅怪物血量 −10%', ov: { bossDamageMul: 1 / 0.9 } },
  { id: 'S3', label: '仅回血 +10%', ov: { hpMul: 1 / 0.9, bossDamageMul: 1 / 0.9, deepHealMul: 1.1 } },
  { id: 'S4', label: '三项叠加（v1.5.9 口径）', ov: { deepHealMul: 1.1 } },
  { id: 'S5', label: '回退后（v1.6.0）', ov: {} },
  { id: 'S6', label: '回退后 + B1 上限', ov: {} },
  { id: 'S7', label: '回退后 + B1 + 多一次三选一（E1）', ov: { startLevels: 1 } }
];

/**
 * 跑一个场景。
 * @param {Object} sc 场景
 * @param {Object} opts 运行参数
 * @param {boolean} useB1 是否启用按层上限（S6/S7）
 * @returns {Promise<Object>} 指标
 */
async function runScenario(sc, opts, useB1) {
  // S0–S5 走旧平口上限（3200）且保持 v1.5.9 的 bossPulse 每 10% 一口；
  // S6/S7 走 B1 且用新的每 8% 一口。两类都显式钉死，避免默认值漂移干扰历史对照。
  const capMap = {};
  for (let f = 1; f <= 20; f += 1) {
    let cap = useB1 ? (3200 * (1 + 0.04 * (f - 1))) : 3200;
    if (useB1 && f >= 20) cap *= 0.55;   // C1-15 硬闸门：F20 压系数
    capMap[f] = cap;
  }
  const ov = Object.assign({}, sc.ov, {
    bossCapByFloor: capMap,
    bossPulseEveryPct: useB1 ? 0.08 : 0.10
  });
  const chunks = Math.max(4, Math.min(16, opts.workers));
  const results = await runPool(makeJobs(opts.runs, chunks, {
    seed: opts.seed, difficulty: opts.difficulty, overrides: ov
  }), opts.workers);
  const agg = mergeOveralls(results);
  return metrics(agg, mergeProfile(results, 'veteran'), mergeProfile(results, 'novice'));
}

/**
 * 主流程：顺序跑 8 个场景，打印并落盘。
 */
async function main() {
  const opts = parseArgs();
  const t0 = Date.now();
  console.log('==================================================');
  console.log('C1-15 三项隔离测量');
  console.log(`局数 ${opts.runs} / 难度 ${opts.difficulty} / 种子 ${opts.seed} / 线程 ${opts.workers}`);
  console.log('==================================================');

  const report = [];
  for (const sc of SCENARIOS) {
    const t = Date.now();
    const m = await runScenario(sc, opts, sc.id === 'S6' || sc.id === 'S7');
    m.id = sc.id;
    m.label = sc.label;
    m.ms = Date.now() - t;
    report.push(m);
    console.log(`[${sc.id}] ${sc.label}  pass5=${(m.pass5 * 100).toFixed(1)}%  pass10=${(m.pass10 * 100).toFixed(1)}%`
      + `  老手=${(m.veteranPass5 * 100).toFixed(1)}%  新手=${(m.novicePass5 * 100).toFixed(1)}%`
      + `  首领死因=${(m.bossDeathShare * 100).toFixed(1)}%  avgLevel=${m.avgLevel.toFixed(2)}`
      + `  (${(m.ms / 1000).toFixed(1)}s)`);
  }

  const base = report.find((r) => r.id === 'S0');
  const table = report.map((r) => ({
    id: r.id,
    label: r.label,
    pass5: Number((r.pass5 * 100).toFixed(1)),
    deltaPp: Number(((r.pass5 - base.pass5) * 100).toFixed(1)),
    pass10: Number((r.pass10 * 100).toFixed(1)),
    veteranPass5: Number((r.veteranPass5 * 100).toFixed(1)),
    novicePass5: Number((r.novicePass5 * 100).toFixed(1)),
    bossDeathShare: Number((r.bossDeathShare * 100).toFixed(1)),
    avgLevel: Number(r.avgLevel.toFixed(2)),
    avgRunSeconds: Number(r.avgRunSeconds.toFixed(1))
  }));

  /* 卡牌数量相关性：S7 比 S6 只多"F1 清层 +1 次三选一"，上限口径完全一致，是最干净的隔离 */
  const s5 = report.find((r) => r.id === 'S5');
  const s6 = report.find((r) => r.id === 'S6');
  const s7 = report.find((r) => r.id === 'S7');
  const cardDeltaPp = (s7.pass5 - s6.pass5) * 100;
  const cardDeltaLegacyPp = (s7.pass5 - s5.pass5) * 100;

  console.log('\n=== 三项贡献表（Δ 相对 S0 原版三项全关） ===');
  table.forEach((r) => console.log(`${r.id}  ${r.label.padEnd(26)}  ${r.pass5.toFixed(1)}%  (${r.deltaPp >= 0 ? '+' : ''}${r.deltaPp.toFixed(1)}pp)  老手 ${r.veteranPass5}%  新手 ${r.novicePass5}%  首领死因 ${r.bossDeathShare}%  Lv ${r.avgLevel}`));
  console.log(`\n卡牌相关性（S7−S6，同 B1 上限只多一次三选一）：${cardDeltaPp >= 0 ? '+' : ''}${cardDeltaPp.toFixed(1)}pp`
    + `（老手 ${((s7.veteranPass5 - s6.veteranPass5) * 100).toFixed(1)}pp / 新手 ${((s7.novicePass5 - s6.novicePass5) * 100).toFixed(1)}pp / 平均等级 ${s6.avgLevel.toFixed(2)}→${s7.avgLevel.toFixed(2)}）`);
  console.log(`对照（S7−S5，旧平口上限对比 B1）：${cardDeltaLegacyPp >= 0 ? '+' : ''}${cardDeltaLegacyPp.toFixed(1)}pp`);

  const outDir = path.join(ROOT, '.screenshots', 'balance');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tri-factor.json'), JSON.stringify({
    meta: {
      at: new Date().toISOString(), runs: opts.runs, difficulty: opts.difficulty,
      seed: opts.seed, workers: opts.workers, elapsedMs: Date.now() - t0
    },
    table,
    cardDeltaPp: Number(cardDeltaPp.toFixed(1))
  }, null, 2), 'utf8');
  console.log('\nJSON：' + path.join(outDir, 'tri-factor.json'));
}

main().catch((e) => { console.error(e); process.exit(1); });
