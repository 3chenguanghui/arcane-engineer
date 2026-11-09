/**
 * 技能池体检：每张牌实际被抽到什么程度
 * ----------------------------------------------------------------------------
 * 要回答四件事（2000 局/口径，四口径合计 8000 局）：
 *   1. 每张牌的获得率（一局内至少被抽进卡组一次）
 *   2. 前 3 层能抽到几张不同的牌
 *   3. 重复率（同一张抽到 ≥2 次的局数占比）
 *   4. 整局一张 S 批都没见到的比例
 * 判据：非起手牌的获得率不得低于均值的 40%（否则等于不存在）。
 *
 * 重要：模拟器的抽取逻辑有两个缺口，本脚本用"临时副本"补齐，不改原文件：
 *   A. `C.MAGIC` 只有基础 6 + A 批 6 共 12 张，缺 S 批 6 张与 P0 2 张 → 运行时补进 8 张。
 *   B. `optionPool` 不读 `minFloor`，F1 就能抽到 S 批 → 副本里按 `p.__auditFloor` 过滤。
 * 另外模拟器的升级池是"等权重 + 按数值评分"，没有主文件的稀有度权重；
 * 因此本表反映的是模型口径下的相对热度，不是实机绝对概率。
 *
 * 用法：node tools/draw_audit.js [--runs 2000]
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'sim_panel');
const C = require(path.join(DIR, 'config.js'));

/**
 * 算文件 MD5（大写），写进口径头。
 * @param {string} file 绝对路径
 * @returns {string} 32 位大写十六进制
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 读命令行 --runs（默认 2000）。
 * @returns {number} 每格局数
 */
function readRuns() {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 2000;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

/* 缺失的 8 张牌：数值照抄主文件卡表（L10286–L10338），minFloor 为奖励池闸门 */
const EXTRA_CARDS = [
  { id: 'pulseShock', name: '斥力脉冲', cost: 30, cooldown: 3.4, damage: 26, aoe: true,  tag: '范围', minFloor: 4 },
  { id: 'pierceLance', name: '贯流长枪', cost: 30, cooldown: 3.6, damage: 38, aoe: true,  tag: '贯穿', minFloor: 5 },
  { id: 'skyfall',     name: '天陨',     cost: 50, cooldown: 6.0, damage: 78, aoe: true,  tag: '范围', minFloor: 6 },
  { id: 'hammer',      name: '符文重锤', cost: 34, cooldown: 3.0, damage: 52, aoe: false, tag: '单体', minFloor: 4 },
  { id: 'brand',       name: '灼痕烙印', cost: 23, cooldown: 1.4, damage: 36, aoe: false, tag: '灼烧', minFloor: 4 },
  { id: 'ward',        name: '护身符阵', cost: 24, cooldown: 5.0, damage: 0, heal: 12, aoe: false, tag: '守护', minFloor: 4 },
  { id: 'riftStep',    name: '折跃步',   cost: 18, cooldown: 5.0, damage: 12, aoe: false, tag: '位移', minFloor: 5 },
  { id: 'frostSeal',   name: '霜封印',   cost: 26, cooldown: 4.0, damage: 20, aoe: true,  tag: '控制', minFloor: 5 }
];

/* 卡池分组：基础 6 + A 批 6 + S 批 6 = 18；P0 是第 4 批 2 张（单独列） */
const GROUPS = {
  fireball: '基础', frost: '基础', bolt: '基础', heal: '基础', blade: '基础', mine: '基础',
  lavaFissure: 'A', arcanePool: 'A', runeOrbit: 'A', collapseHole: 'A', flameCone: 'A', frostRing: 'A',
  pulseShock: 'S', pierceLance: 'S', skyfall: 'S', hammer: 'S', brand: 'S', ward: 'S',
  riftStep: 'P0', frostSeal: 'P0'
};
const S_IDS = Object.keys(GROUPS).filter((id) => GROUPS[id] === 'S');
/* 起手牌：profile 自带，永远不会出现在三选一里，判据豁免 */
const STARTERS = ['fireball', 'frost'];

/**
 * 单次字符串替换，命中数必须符合预期，否则立刻报错（防止 sim.js 改版后静默贴错）。
 * @param {string} src 源码
 * @param {string} from 原串
 * @param {string} to 新串
 * @param {number} expect 期望命中次数
 * @returns {string} 替换后的源码
 */
function replaceOnce(src, from, to, expect) {
  const hit = src.split(from).length - 1;
  if (hit !== (expect || 1)) {
    throw new Error('补丁锚点命中 ' + hit + ' 次（期望 ' + (expect || 1) + '）：' + from.slice(0, 60));
  }
  return src.replace(from, to);
}

/**
 * 生成"可审计抽牌"的模拟器副本。
 * @returns {object} 模块
 */
function buildAuditSim() {
  let src = fs.readFileSync(path.join(DIR, 'sim.js'), 'utf8');

  /* 1) 每局初始化抽牌日志与当前层 */
  src = replaceOnce(src,
    '  const p = createPlayer(profile, ov);',
    '  const p = createPlayer(profile, ov);\n  p.__drawLog = [];\n  p.__auditFloor = 1;');

  /* 2) 层循环里记录当前层（升级发生在房间结算时，层号在作用域内） */
  src = replaceOnce(src,
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {',
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {\n    p.__auditFloor = floor;');

  /* 3) 选项池加 minFloor 闸门 */
  src = replaceOnce(src,
    'function optionPool(p) {',
    'function optionPool(p) {\n  const __fl = (p && p.__auditFloor) || 1;');
  src = replaceOnce(src,
    '  C.MAGIC.forEach((m) => {\n    if (p.magics.includes(m.id)) return;',
    '  C.MAGIC.forEach((m) => {\n    if (p.magics.includes(m.id)) return;\n    if (m.minFloor && __fl < m.minFloor) return;');

  /* 4) 升级回调：记录本次三选一的候选与选择（带 p.xpNeed 的下一行做唯一锚） */
  src = replaceOnce(src,
    '    levelUp(p, rng);\n    p.xpNeed = Math.round(C.XP.baseNeed * Math.pow(C.XP.growth, p.level - 1));',
    '    levelUp(p, rng, (r) => {\n'
    + '      if (!p.__drawLog) return;\n'
    + '      p.__drawLog.push({\n'
    + '        floor: p.__auditFloor || 1,\n'
    + '        chosen: r.chosen && r.chosen.kind === \'magic\' ? r.chosen.id : null,\n'
    + '        choices: r.choices.map((o) => ({ kind: o.kind, id: o.id }))\n'
    + '      });\n'
    + '    });\n'
    + '    p.xpNeed = Math.round(C.XP.baseNeed * Math.pow(C.XP.growth, p.level - 1));');

  /* 5) 把日志挂到结果上 */
  src = replaceOnce(src,
    '  result.ashDeck = (p.deck || []).length;\n  return result;',
    '  result.ashDeck = (p.deck || []).length;\n  result.__drawLog = p.__drawLog || [];\n  return result;');

  src = src.replace("require('./config')", 'require(' + JSON.stringify(path.join(DIR, 'config.js')) + ')');

  const outDir = path.join(__dirname, '..', '.seedwork');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, '.sim_draw_audit.js');
  fs.writeFileSync(outFile, src, 'utf8');
  return require(outFile);
}

/* 补 8 张牌进内存里的卡表（只影响本进程，config.js 文件不动） */
EXTRA_CARDS.forEach((card) => {
  if (!C.MAGIC.some((m) => m.id === card.id)) C.MAGIC.push(card);
});

const SIM = buildAuditSim();

/* 四口径：与 p0_probe / stack_matrix 一致 */
const PROFILES = [
  { name: '中性', spec: { magics: ['fireball', 'frost'] } },
  { name: '守拙', spec: { hpPct: 0.04, magics: ['fireball', 'frost'] } },
  { name: '疾火', spec: { hpFlat: -5, damageMul: 1.08, magics: ['fireball', 'frost'] } },
  { name: '观星', spec: { regenBonus: 1.0, magics: ['fireball', 'frost'] } }
];

const runs = readRuns();
const ALL_IDS = Object.keys(GROUPS);
const stat = {};
ALL_IDS.forEach((id) => { stat[id] = { acq: 0, offer: 0 }; });

let totalRuns = 0;
let totalDraws = 0;
let totalDup = 0;
let f3DistinctSum = 0;
let repeatRuns = 0;
let zeroSRuns = 0;
let levelUps = 0;

PROFILES.forEach((prof) => {
  for (let i = 0; i < runs; i += 1) {
    const seed = C.SIM_PARAMS.baseSeed + i;
    const r = SIM.runOne(seed, C.PROFILES.bot, 'normal', { charSpec: Object.assign({}, prof.spec) });
    const log = r.__drawLog || [];
    const acq = {};
    const offered = {};
    let f3 = {};
    log.forEach((e) => {
      e.choices.forEach((c) => { if (c.kind === 'magic') offered[c.id] = true; });
      if (e.chosen) {
        acq[e.chosen] = (acq[e.chosen] || 0) + 1;
        if (e.floor <= 3) f3[e.chosen] = true;
      }
    });
    const acqIds = Object.keys(acq);
    const distinct = acqIds.length;
    const draws = acqIds.reduce((s, id) => s + acq[id], 0);
    const dup = draws - distinct;

    totalRuns += 1;
    totalDraws += draws;
    totalDup += dup;
    levelUps += log.length;
    f3DistinctSum += Object.keys(f3).length;
    if (dup > 0) repeatRuns += 1;
    if (!S_IDS.some((id) => acq[id])) zeroSRuns += 1;

    acqIds.forEach((id) => { if (stat[id]) stat[id].acq += 1; });
    Object.keys(offered).forEach((id) => { if (stat[id]) stat[id].offer += 1; });
  }
});

const pct = (n, d) => (n / d * 100);
const pad = (s, n) => String(s).padEnd(n, ' ');

console.log('【口径头】sim.js MD5 ' + md5Of(path.join(DIR, 'sim.js'))
  + ' | config.js MD5 ' + md5Of(path.join(DIR, 'config.js')));
console.log('【口径头】基线含熔炉房 ON（G1）｜真·全关 = G0');
console.log('【口径头】审计副本补丁：C.MAGIC +8 张（S 6 + P0 2）、optionPool 加 minFloor 闸门');
console.log('【口径头】样本 ' + runs + ' 局/口径 × 4 口径 = ' + totalRuns + ' 局 | 档案 bot / 普通');

console.log('\n【总览】');
console.log('  平均升级次数 ' + (levelUps / totalRuns).toFixed(2)
  + ' 次/局 | 平均获得 ' + (totalDraws / totalRuns).toFixed(2)
  + ' 张/局（其中重复 ' + (totalDup / totalRuns).toFixed(2) + ' 张）');
console.log('  前 3 层平均获得不同牌 ' + (f3DistinctSum / totalRuns).toFixed(2) + ' 张');
console.log('  重复率（有任意一张抽到 ≥2 次的局）' + pct(repeatRuns, totalRuns).toFixed(1) + '%');
console.log('  整局零 S 批牌 ' + pct(zeroSRuns, totalRuns).toFixed(1) + '%');

/* 判据：非起手牌获得率 ≥ 均值 40% */
const judged = ALL_IDS.filter((id) => STARTERS.indexOf(id) < 0);
const meanAcq = judged.reduce((s, id) => s + stat[id].acq / totalRuns, 0) / judged.length;
const floorLine = meanAcq * 0.4;

console.log('\n【每张牌】获得率 = 该局被抽进卡组；出现率 = 进过三选一候选');
console.log(pad('牌', 20) + pad('批', 6) + pad('minFloor', 10)
  + pad('获得率', 10) + pad('出现率', 10) + '判定（≥均值40%）');
ALL_IDS
  .slice()
  .sort((a, b) => (stat[b].acq - stat[a].acq))
  .forEach((id) => {
    const m = C.MAGIC.find((x) => x.id === id) || {};
    const starter = STARTERS.indexOf(id) >= 0;
    const rate = stat[id].acq / totalRuns;
    const judge = starter ? '起手豁免' : (rate >= floorLine ? 'OK' : '低于红线');
    console.log(pad((m.name || id), 20) + pad(GROUPS[id], 6)
      + pad(m.minFloor || 1, 10)
      + pad(pct(stat[id].acq, totalRuns).toFixed(1) + '%', 10)
      + pad(pct(stat[id].offer, totalRuns).toFixed(1) + '%', 10)
      + judge);
  });
console.log('\n  非起手牌获得率均值 ' + pct(meanAcq, 1).toFixed(1) + '% | 红线（40%）'
  + pct(floorLine, 1).toFixed(1) + '%');

/* 存档 */
const outJson = path.join(__dirname, '..', '.seedwork', 'draw_audit_' + runs + '.json');
fs.writeFileSync(outJson, JSON.stringify({
  runs,
  totalRuns,
  md5: { sim: md5Of(path.join(DIR, 'sim.js')), config: md5Of(path.join(DIR, 'config.js')) },
  overview: {
    avgLevelUps: levelUps / totalRuns,
    avgDraws: totalDraws / totalRuns,
    avgDup: totalDup / totalRuns,
    avgF3Distinct: f3DistinctSum / totalRuns,
    repeatRate: repeatRuns / totalRuns,
    zeroSRate: zeroSRuns / totalRuns
  },
  meanAcqRate: meanAcq,
  floorLine,
  cards: ALL_IDS.map((id) => ({
    id, group: GROUPS[id], starter: STARTERS.indexOf(id) >= 0,
    minFloor: (C.MAGIC.find((x) => x.id === id) || {}).minFloor || 1,
    acqRate: stat[id].acq / totalRuns,
    offerRate: stat[id].offer / totalRuns
  }))
}, null, 2), 'utf8');
console.log('已存档 ' + outJson);
