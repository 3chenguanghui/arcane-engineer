/**
 * 观星收缩扫描：growthBias.value 从 0.55 调到多少才能回到红线内
 * ------------------------------------------------------------
 * 观星真实定义 = growthBias {value: 0.55, survival: 0.45} → 10 层 43.30% / F20 37.90%
 * 红线 = 10 层 ≤40% / F20 ≤36%
 * 本脚本只动 value（survival = 1 - value），其余全部保持真实定义，量出每档 Δpp。
 * 用法：node tools/_scan_gazer.js [--runs=2000]
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'sim_panel');
const C = require(path.join(DIR, 'config.js'));
C.ROOM.plan = {};

/**
 * 单次替换，命中必须为 1
 */
function once(src, from, to, tag) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`锚点[${tag}]命中 ${n} 次`);
  return src.replace(from, to);
}

/**
 * 构造对齐 minFloor=1 的 sim 副本
 * @returns {string} 临时模块路径
 */
function buildAligned() {
  let src = fs.readFileSync(path.join(DIR, 'sim.js'), 'utf8');
  src = once(src,
    `  if (isElite && !budgetOn) count = Math.round(count * (tune && tune.countMul !== undefined ? tune.countMul : C.ELITE_ROOM.countMul));
  if (floor <= C.ONBOARD.maxFloors) count = Math.round(count * C.ONBOARD.enemyCountMul);
  if (floor === 1) count = Math.min(C.ONBOARD.floor1CountCap, count);`,
    `  if (isElite && !budgetOn) count = Math.round(count * (tune && tune.countMul !== undefined ? tune.countMul : C.ELITE_ROOM.countMul));`,
    'onboard');
  src = once(src, '  const budgetOn = floor >= C.FLOOR_GEN.budgetFrom;', '  const budgetOn = true;', 'budget');
  src = src.replace("require('./config')", `require(${JSON.stringify(path.join(DIR, 'config.js'))})`);
  const f = path.join(__dirname, '.seedwork', '.sim_scan.js');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, src, 'utf8');
  return f;
}

/** 观星真实定义（其余项不变，只调 growthBias 与 regenBonus） */
function gazer(value, regen) {
  return {
    id: 'gazer', hpFlat: 0, magics: ['fireball', 'frost'], regenBonus: regen,
    growthBias: { value, survival: +(1 - value).toFixed(2) }
  };
}

/**
 * 跑 N 局
 */
function run(S, charSpec, runs) {
  let c10 = 0; let f20 = 0;
  for (let i = 0; i < runs; i += 1) {
    const r = S.runOne(S.runSeed(C.SIM_PARAMS.baseSeed, i), C.PROFILES.bot, 'normal',
      { charSpec, talentSpec: null });
    if (r.clearedFloors >= 10) c10 += 1;
    if (r.clearedFloors >= 20 || (!r.died && r.clearedFloors >= C.SIM_PARAMS.maxFloor)) f20 += 1;
  }
  return { c10: +(c10 / runs * 100).toFixed(2), f20: +(f20 / runs * 100).toFixed(2) };
}

(async () => {
  const arg = (k, d) => Number((process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1]) || d;
  const runs = arg('runs', 2000);
  const S = require(buildAligned());
  const rows = [];
  /* 主文件观星 regenFlat 已是 1；sim 仍用 2。这里量"尺子对齐后"回线需要多少，
     以及主文件若再砍一刀回能（regenFlat 1→0）能降到哪。 */
  [[0.55, 1], [0.60, 1], [0.62, 1], [0.65, 1], [0.55, 0], [0.65, 0]].forEach(([v, regen]) => {
    const r = run(S, gazer(v, regen), runs);
    rows.push({ value: v, regen, survival: +(1 - v).toFixed(2), c10: r.c10, f20: r.f20,
      pass10: r.c10 <= 40, pass20: r.f20 <= 36 });
  });
  console.log('growthBias.value | regen | 10层% | 红线40 | F20% | 红线36');
  rows.forEach((r) => {
    console.log(`${r.value} | ${r.regen} | ${r.c10} | ${r.pass10 ? 'OK' : 'X'} | ${r.f20} | ${r.pass20 ? 'OK' : 'X'}`);
  });
  fs.writeFileSync(path.join(__dirname, '.seedwork', 'gazer_scan.json'),
    JSON.stringify({ runs, rows }, null, 2));
  try { fs.unlinkSync(path.join(__dirname, '.seedwork', '.sim_scan.js')); } catch (e) { /* ignore */ }
})().catch((e) => { console.error(e); process.exit(1); });
