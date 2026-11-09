/**
 * 基线降压标定器（方案 A：先降基线，再上卡）
 * ----------------------------------------------------------------------------
 * 为什么需要这个脚本：
 *   P0 探针（tools/p0_probe.js）测出四口径线上基线 36.4% / 37.9% / 37.7% / 38.9%，
 *   距 38.5% 门禁只剩 0.6pp（守拙）甚至已经超线 0.4pp（观星）。
 *   新卡再弱也会把通关率往上顶，所以必须先把基线压到 ≤35.5%（10 层）/ ≤31.5%（F20），
 *   给 P0 留出约 3pp 的余量。
 *
 * 四个可调旋钮（全部能一对一映射回主文件常量，不是拍脑袋的数）：
 *   --global      全局承伤系数（等价于 DIFFICULTY_CONFIG.modes.normal.damageMul 等比放大）
 *   --wardenHp    守拙 hpPct（主文件 CHARACTER_CONFIG.list.warden.hpPct）
 *   --emberDmg    疾火 damageMul（主文件 CHARACTER_CONFIG.list.ember.damageMul）
 *   --gazerRegen  观星 regenBonus（主文件 CHARACTER_CONFIG.list.gazer.regenFlat）
 *
 * 用法：
 *   node tools\baseline_tune.js --runs 800
 *   node tools\baseline_tune.js --global 1.02 --wardenHp 0.02 --emberDmg 1.05 --gazerRegen 1.0 --runs 800
 *
 * 输出：四口径的 10 层通关率、F20 到达率（带样本数），以及相对线上基线的降幅。
 */
const path = require('path');
const SIM = require(path.join(__dirname, 'sim_panel', 'sim.js'));
const C = require(path.join(__dirname, 'sim_panel', 'config.js'));

/**
 * 读命令行数值参数
 * @param {string} flag 参数名（如 --runs）
 * @param {number} fallback 缺省值
 * @returns {number} 解析后的数值
 */
function argNum(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

/* 当前基线（config.js 已对齐 damageMul 0.49 之后，2026-11-09 实测 2000 局/口径）。
   只用于算降幅，不参与模拟；模型一变（查 sim.js MD5）这里必须同步更新，否则降幅是错的。 */
const ONLINE = {
  neutral: { f10: 34.1, f20: 30.0 },
  warden:  { f10: 36.4, f20: 32.1 },
  ember:   { f10: 35.9, f20: 31.7 },
  gazer:   { f10: 36.4, f20: 32.0 }
};

/* 目标线（用户拍板）：10 层 ≤35.5%、F20 ≤31.5% */
const TARGET = { f10: 35.5, f20: 31.5 };

const runs = Math.max(100, Math.floor(argNum('--runs', 800)));
const globalTaken = argNum('--global', 1);
const wardenHp = argNum('--wardenHp', 0.04);
const emberDmg = argNum('--emberDmg', 1.08);
const gazerRegen = argNum('--gazerRegen', 2);

/**
 * 四口径参数：角色项取自主文件 CHARACTER_CONFIG，全局项单独乘进 takenMul。
 * 模拟器不建模 aetherFlat / 逐层成长，这里照旧如实不参与。
 * @returns {Array<Object>} 口径列表
 */
function buildProfiles() {
  const base = { magics: ['fireball', 'frost'], takenMul: globalTaken };
  return [
    { id: 'neutral', name: '中性', spec: Object.assign({}, base) },
    { id: 'warden',  name: '守拙', spec: Object.assign({}, base, { hpPct: wardenHp }) },
    { id: 'ember',   name: '疾火', spec: Object.assign({}, base, { hpFlat: -5, damageMul: emberDmg }) },
    { id: 'gazer',   name: '观星', spec: Object.assign({}, base, { regenBonus: gazerRegen }) }
  ];
}

/**
 * 跑一个口径。
 * @param {Object} profile 口径
 * @returns {Object} { f10, f20, f10n, f20n }
 */
function runProfile(profile) {
  let r10 = 0;
  let r20 = 0;
  let r3 = 0;
  for (let i = 0; i < runs; i += 1) {
    const seed = C.SIM_PARAMS.baseSeed + i;
    const r = SIM.runOne(seed, C.PROFILES.bot, 'normal', { charSpec: profile.spec });
    if (r.clearedFloors >= 10) r10 += 1;
    if (r.clearedFloors >= C.SIM_PARAMS.maxFloor) r20 += 1;
    /* 前 3 层存活：死在 3 层及以前算没过；死在 4 层之后或活着算过。
       改难度会同时影响这条，角色差异门禁（两两 ≤8pp）必须在这里复核。 */
    if (!r.died || (r.deathFloor || 99) > 3) r3 += 1;
  }
  return { f10: r10 / runs, f20: r20 / runs, f3: r3 / runs, f10n: r10, f20n: r20, f3n: r3 };
}

const pad = (s, n) => String(s).padEnd(n, ' ');
console.log('全局承伤 ×' + globalTaken.toFixed(3)
  + ' | 守拙 hpPct ' + (wardenHp * 100).toFixed(1) + '%'
  + ' | 疾火 dmg ×' + emberDmg.toFixed(3)
  + ' | 观星 regen +' + gazerRegen.toFixed(2)
  + ' | ' + runs + ' 局/口径');
console.log(pad('口径', 10) + pad('10层', 16) + pad('目标', 10)
  + pad('F20', 16) + pad('目标', 10) + pad('前3层存活', 14) + '判定');

const results = [];
buildProfiles().forEach((p) => {
  const r = runProfile(p);
  const on = ONLINE[p.id];
  const d10 = r.f10 * 100 - on.f10;
  const d20 = r.f20 * 100 - on.f20;
  const ok = (r.f10 * 100) <= TARGET.f10 && (r.f20 * 100) <= TARGET.f20;
  results.push({ id: p.id, f10: r.f10 * 100, f20: r.f20 * 100, f3: r.f3 * 100, ok });
  console.log(
    pad(p.name, 10)
    + pad((r.f10 * 100).toFixed(1) + '% (' + r.f10n + ')', 16)
    + pad((d10 >= 0 ? '+' : '') + d10.toFixed(1) + 'pp', 10)
    + pad((r.f20 * 100).toFixed(1) + '% (' + r.f20n + ')', 16)
    + pad((d20 >= 0 ? '+' : '') + d20.toFixed(1) + 'pp', 10)
    + pad((r.f3 * 100).toFixed(1) + '% (' + r.f3n + ')', 14)
    + (ok ? 'PASS' : 'FAIL')
  );
});
console.log('JSON=' + JSON.stringify(results));
