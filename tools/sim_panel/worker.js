/* ============================================================================
 * 模拟 worker：在独立线程里跑一段局数，返回聚合结果。
 * 任务结构：
 *   { runs, startIndex, baseSeed, difficulty, overrides }
 * 每一局按 startIndex 的奇偶轮流分配 profile（新手/老手/机器人），
 * 保证三个档案拿到的局数与种子分布一致。
 * ============================================================================ */
'use strict';

const { parentPort } = require('worker_threads');
const sim = require('./sim');
const C = require('./config');

const PROFILE_IDS = ['novice', 'veteran', 'bot'];

parentPort.on('message', (job) => {
  const profiles = {};
  PROFILE_IDS.forEach((id) => { profiles[id] = sim.createAgg(); });
  const overall = sim.createAgg();
  const runs = job.runs;
  const start = job.startIndex;

  for (let i = 0; i < runs; i += 1) {
    const index = start + i;
    const profileId = PROFILE_IDS[index % 3];
    const seed = sim.runSeed(job.baseSeed, index);
    const r = sim.runOne(seed, C.PROFILES[profileId], job.difficulty, job.overrides);
    sim.addRun(profiles[profileId], r);
    sim.addRun(overall, r);
  }

  parentPort.postMessage({ profiles, overall });
});
