/* ============================================================================
 * W1/W2 作用层段探针（口径 A′：真实保底）
 * ----------------------------------------------------------------------------
 * 用法：node tools/sim_panel/probe_w_scope.js --runs 10000
 * 产物：tools/sim_panel/probe_w_scope.json
 *
 * 背景：浏览器实测显示，精英房保底在 F2–F5 就已经有 10%–52% 的楼层是"绕不开"的，
 * 上一轮 W1/W2 只从 F13 起生效，会漏掉早期的必经精英。这里对比 fromFloor=13/6/2。
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./config');
const sim = require('./sim');

const MANDATORY = { 2: 0.44, 3: 0.10, 4: 0.52, 5: 0.47 };
for (let f = 6; f <= 20; f += 1) MANDATORY[f] = 0.465;

const W1W2 = (from) => ({ mixNormal: 2, clearKills: 5, fromFloor: from });

const SCENARIOS = [
  { name: 'A 基线（按权重）', ov: {} },
  { name: 'A + W12 F2 起', ov: { eliteTune: W1W2(2) } },
  { name: "A′ 基线", ov: { eliteMandatory: MANDATORY } },
  { name: "A′ + W12 F13 起", ov: { eliteMandatory: MANDATORY, eliteTune: W1W2(13) } },
  { name: "A′ + W12 F6 起", ov: { eliteMandatory: MANDATORY, eliteTune: W1W2(6) } },
  { name: "A′ + W12 F2 起", ov: { eliteMandatory: MANDATORY, eliteTune: W1W2(2) } },
  { name: 'A + E1 + W12 F2', ov: { e1CardAtFloor: 1, eliteTune: W1W2(2) } },
  { name: "A′ + E1 + W12 F2", ov: { eliteMandatory: MANDATORY, e1CardAtFloor: 1, eliteTune: W1W2(2) } }
];

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

/**
 * 跑一个场景：通关率 + 精英房死亡按层段分布。
 * @param {Object} ov overrides
 * @param {Object} opts 运行参数
 * @returns {Object} 指标
 */
function runScenario(ov, opts) {
  const ids = ['novice', 'veteran', 'bot'];
  let pass5 = 0;
  let floorSum = 0;
  const eliteDeaths = { f2_5: 0, f6_12: 0, f13_20: 0, total: 0 };
  for (let i = 0; i < opts.runs; i += 1) {
    const r = sim.runOne(sim.runSeed(opts.seed, i), C.PROFILES[ids[i % 3]], opts.difficulty, ov);
    if (r.clearedFloors >= 5) pass5 += 1;
    floorSum += r.clearedFloors;
    (r.eliteDeaths || []).forEach((d) => {
      eliteDeaths.total += 1;
      if (d.floor <= 5) eliteDeaths.f2_5 += 1;
      else if (d.floor <= 12) eliteDeaths.f6_12 += 1;
      else eliteDeaths.f13_20 += 1;
    });
  }
  return {
    pass5Pct: +(pass5 / opts.runs * 100).toFixed(1),
    avgFloor: +(floorSum / opts.runs).toFixed(2),
    eliteDeaths
  };
}

/** 主流程。 */
function main() {
  const opts = parseArgs();
  const out = { meta: opts, scenarios: [] };
  SCENARIOS.forEach((sc) => {
    out.scenarios.push({ name: sc.name, ...runScenario(sc.ov, opts) });
  });
  const p = path.join(__dirname, 'probe_w_scope.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 2));

  console.log('\n=== W1/W2 作用层段（口径 A′ / ' + opts.runs + ' 局）===');
  console.log('场景'.padEnd(18) + '5层通关  平均层  F2-5死  F6-12死  F13-20死  合计');
  out.scenarios.forEach((s) => {
    console.log(s.name.padEnd(18)
      + String(s.pass5Pct).padEnd(9) + String(s.avgFloor).padEnd(8)
      + String(s.eliteDeaths.f2_5).padEnd(8) + String(s.eliteDeaths.f6_12).padEnd(9)
      + String(s.eliteDeaths.f13_20).padEnd(10) + s.eliteDeaths.total);
  });
  console.log('\n产物: ' + p);
}

main();
