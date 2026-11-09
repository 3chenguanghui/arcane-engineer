/**
 * 角色口径消融：定位 37.50% → 43.30% 的 5.8pp 来自哪一项
 * ------------------------------------------------------------
 * 背景：两套"四口径"脚本的角色定义不同，导致观星 37.50 vs 43.30、疾火 37.40 vs 21.40。
 * 本脚本以"简版口径"（_room_density_probe.js 的 CHARS）为基线，
 * 每次只把一项换成"真实定义"（敌人数量-四口径验收.js 的 CHARS），量出单独 Δpp。
 * 用法：node tools/_ablate_chars.js [--runs=2000]
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'sim_panel');
const C = require(path.join(DIR, 'config.js'));
C.ROOM.plan = {};      // 关掉熔炉层计划，纯角色对照

/**
 * 单次替换，命中必须为 1
 */
function once(src, from, to, tag) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`锚点[${tag}]命中 ${n} 次`);
  return src.replace(from, to);
}

/**
 * 构造对齐 minFloor=1 的 sim 副本（与 _room_density_probe.js 完全一致）
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
  const f = path.join(__dirname, '.seedwork', '.sim_ablate.js');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, src, 'utf8');
  return f;
}

/* 简版基线（产出 37.50 / 32.45 的那一套） */
const BASE = {
  守拙: { id: 'warden3', hpPct: 0.04, magics: ['fireball', 'frost'], techs: [] },
  疾火: { id: 'ember4', hpPct: -0.05, magics: ['fireball', 'frost'], techs: ['amp'] },
  观星: { id: 'gazer2', hpPct: 0, magics: ['fireball', 'frost'], techs: [], regenBonus: 2 }
};

/* 真实定义（产出 43.30 / 37.90 的那一套），逐项切 */
const REAL = {
  守拙: { id: 'warden', hpFlat: 4, magics: ['flameCone', 'fireball'], regenBonus: 2, growthBias: { value: 0.45, survival: 0.55 } },
  疾火: { id: 'ember', hpFlat: -5, magics: ['fireball', 'blade'], regenBonus: 4, growthBias: { value: 0.85, survival: 0.15 } },
  观星: { id: 'gazer', hpFlat: 0, magics: ['fireball', 'frost'], regenBonus: 2, growthBias: { value: 0.55, survival: 0.45 } }
};

/**
 * 生成"基线 + 若干项被替换为真实值"的角色规格
 * @param {string} who 角色名
 * @param {string[]} keys 要替换的键
 * @returns {Object} charSpec
 */
function spec(who, keys) {
  const s = Object.assign({}, BASE[who]);
  keys.forEach((k) => { s[k] = REAL[who][k]; });
  return s;
}

/**
 * 跑 N 局，返回 10 层 / F20 百分比
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

const CASES = [
  ['基线（简版）', '观星', []],
  ['观星 + growthBias', '观星', ['growthBias']],
  ['守拙 + regenBonus', '守拙', ['regenBonus']],
  ['守拙 + magics', '守拙', ['magics']],
  ['守拙 + growthBias', '守拙', ['growthBias']],
  ['疾火 - amp(techs)', '疾火', ['techs']],
  ['疾火 + magics', '疾火', ['magics']],
  ['疾火 + regenBonus', '疾火', ['regenBonus']],
  ['疾火 + growthBias', '疾火', ['growthBias']],
  ['全量（真实定义）', '全部', []]
];

(async () => {
  const arg = (k, d) => Number((process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1]) || d;
  const runs = arg('runs', 2000);
  const S = require(buildAligned());
  const base = {};
  Object.keys(BASE).forEach((who) => { base[who] = run(S, spec(who, []), runs); });
  console.log(`样本 ${runs} 局/口径 ｜ 基线：守拙 ${base.守拙.c10}/${base.守拙.f20} `
    + `疾火 ${base.疾火.c10}/${base.疾火.f20} 观星 ${base.观星.c10}/${base.观星.f20}`);

  const rows = [];
  CASES.forEach(([label, who, keys]) => {
    if (who === '全部') {
      Object.keys(REAL).forEach((w) => {
        const r = run(S, REAL[w], runs);
        rows.push({ label: w + ' 全量', c10: r.c10, f20: r.f20,
          d10: +(r.c10 - base[w].c10).toFixed(2), d20: +(r.f20 - base[w].f20).toFixed(2) });
      });
      return;
    }
    const r = run(S, spec(who, keys), runs);
    rows.push({ label, c10: r.c10, f20: r.f20,
      d10: +(r.c10 - base[who].c10).toFixed(2), d20: +(r.f20 - base[who].f20).toFixed(2) });
  });

  console.log('\n项 | 10层% | Δ10 | F20% | Δ20');
  rows.forEach((r) => {
    console.log(`${r.label} | ${r.c10} | ${r.d10 >= 0 ? '+' : ''}${r.d10} | ${r.f20} | ${r.d20 >= 0 ? '+' : ''}${r.d20}`);
  });
  fs.writeFileSync(path.join(__dirname, '.seedwork', 'char_ablation.json'),
    JSON.stringify({ runs, base, rows }, null, 2));
  try { fs.unlinkSync(path.join(__dirname, '.seedwork', '.sim_ablate.js')); } catch (e) { /* ignore */ }
})().catch((e) => { console.error(e); process.exit(1); });
