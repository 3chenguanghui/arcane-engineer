/**
 * 伤害卡边际价值实验（方案 A 秤）
 * ----------------------------------------------------------------------------
 * 目的：在「采纳版 s1r + 修模型 + 焚稿 hpCostPct=0.06」的口径下，逐张伤害卡测：
 *   1) 拿掉它（从奖励池摘掉，起手卡不受影响）对 10 层 / F20 的影响；
 *   2) 加强它一档（面板伤害 +15%，四舍五入）对 10 层 / F20 的影响。
 *
 * 口径：
 *   · 四口径（中性 / 守拙 / 疾火 / 观星），报最差；配对比较另报守拙单口径；
 *   · 每口径 n 局，seed = C.SIM_PARAMS.baseSeed + i（同 seed 配对）；
 *   · 焚稿 hpCostPct 从主文件 ASH_CONFIG 现场读，不抄常量；
 *   · 模拟器补丁与 tools/s_visibility.js 完全一致（s1r + fix），保证能复现基线。
 *
 * 用法：
 *   node tools/_card_marginal.js --runs 400 [--cards=base|all] [--tag=smoke]
 *
 * 说明：
 *   · 本脚本只写 .seedwork 下的临时副本，sim.js / config.js / 主文件零改动；
 *   · “加强一档 = +15% 面板伤害”是本实验的操作定义，不是游戏内规则；
 *     表里同时给出每 +1% 的斜率（Δ/15），换档位可按比例换算。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'sim_panel');
const C = require(path.join(DIR, 'config.js'));

require('./_ash_drift_check').assertAshDrift();

const SIM_PATH = path.join(DIR, 'sim.js');
const LIVE_HTML = path.join(__dirname, '..', 'index_arcane_v2.html');

/**
 * 算文件 MD5（大写）
 * @param {string} file 绝对路径
 * @returns {string} 32 位大写十六进制
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 读主文件 ASH_CONFIG.hpCostPct（焚稿灼身代价）
 * @returns {number} 例如 0.06；缺字段直接抛错
 */
function readAshHpCost() {
  const html = fs.readFileSync(LIVE_HTML, 'utf8');
  const m = html.match(/var ASH_CONFIG = \{[\s\S]{0,800}?hpCostPct:\s*([0-9.]+)/);
  if (!m) throw new Error('主文件 ASH_CONFIG 里没有 hpCostPct');
  return Number(m[1]);
}

/**
 * 读命令行参数 --runs（默认 400）
 * @returns {number} 每口径局数
 */
function readRuns() {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 400;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 400;
}

/** 命令行 --cards=base|all（默认 base：11 张基础伤害卡） */
function readScope() {
  const a = process.argv.find((s) => s.startsWith('--cards='));
  return a ? a.slice('--cards='.length) : 'base';
}

/* ---------------------------------------------------------------------------
 * 1. 卡表补齐（与 s_visibility 完全一致，只补内存）
 * ------------------------------------------------------------------------- */
const EXTRA_CARDS = [
  { id: 'pulseShock', name: '斥力脉冲', cost: 30, cooldown: 3.4, damage: 26, aoe: true,  tag: '范围', minFloor: 4, rarity: 'rare' },
  { id: 'pierceLance', name: '贯流长枪', cost: 30, cooldown: 3.6, damage: 38, aoe: true,  tag: '贯穿', minFloor: 5, rarity: 'rare' },
  { id: 'skyfall',     name: '天陨',     cost: 50, cooldown: 6.0, damage: 78, aoe: true,  tag: '范围', minFloor: 6, rarity: 'epic' },
  { id: 'hammer',      name: '符文重锤', cost: 34, cooldown: 3.0, damage: 52, aoe: false, tag: '单体', minFloor: 4, rarity: 'rare' },
  { id: 'brand',       name: '灼痕烙印', cost: 23, cooldown: 1.4, damage: 36, aoe: false, tag: '灼烧', minFloor: 4, rarity: 'common', segments: 3 },
  { id: 'ward',        name: '护身符阵', cost: 24, cooldown: 5.0, damage: 0, heal: 12, aoe: false, tag: '守护', minFloor: 4, rarity: 'common', shield: 5.0 },
  { id: 'riftStep',    name: '折跃步',   cost: 18, cooldown: 5.0, damage: 12, aoe: false, tag: '位移', minFloor: 5, rarity: 'rare' },
  { id: 'frostSeal',   name: '霜封印',   cost: 26, cooldown: 4.0, damage: 20, aoe: true,  tag: '控制', minFloor: 5, rarity: 'rare' }
];
EXTRA_CARDS.forEach((card) => {
  if (!C.MAGIC.some((m) => m.id === card.id)) C.MAGIC.push(card);
});

const GROUPS = {
  fireball: '基础', frost: '基础', bolt: '基础', heal: '基础', blade: '基础', mine: '基础',
  lavaFissure: 'A', arcanePool: 'A', runeOrbit: 'A', collapseHole: 'A', flameCone: 'A', frostRing: 'A',
  pulseShock: 'S', pierceLance: 'S', skyfall: 'S', hammer: 'S', brand: 'S', ward: 'S',
  riftStep: 'P0', frostSeal: 'P0'
};
const S_IDS = Object.keys(GROUPS).filter((id) => GROUPS[id] === 'S');

const PROFILES = [
  { name: '中性', spec: { magics: ['fireball', 'frost'] } },
  { name: '守拙', spec: { hpPct: 0.04, magics: ['fireball', 'frost'] } },
  { name: '疾火', spec: { hpFlat: -5, damageMul: 1.08, magics: ['fireball', 'frost'] } },
  { name: '观星', spec: { regenBonus: 1.0, magics: ['fireball', 'frost'] } }
];

/* 原值备份：config 是共享对象，改完必须还原 */
const CFG_BACKUP = {};
C.MAGIC.forEach((m) => { CFG_BACKUP[m.id] = { minFloor: m.minFloor, damage: m.damage, shield: m.shield }; });

/**
 * 单次字符串替换，命中数必须为 1，否则立刻抛错（防止静默贴错）
 * @param {string} src 源码
 * @param {string} from 原串
 * @param {string} to 新串
 * @returns {string} 替换后的源码
 */
function replaceOnce(src, from, to) {
  const hit = src.split(from).length - 1;
  if (hit !== 1) throw new Error('补丁锚点命中 ' + hit + ' 次（期望 1）：' + from.slice(0, 60));
  return src.replace(from, to);
}

/**
 * 生成带补丁的模拟器副本（s_visibility 的 s1r + fix 子集，去掉抽牌日志）
 * @param {object} v 变体 {id, banId}
 * @returns {object} 模拟器模块
 */
function buildSim(v) {
  let src = fs.readFileSync(SIM_PATH, 'utf8');

  /* B1：每局记录当前层 + 抽牌日志容器 */
  src = replaceOnce(src,
    '  const p = createPlayer(profile, ov);',
    '  const p = createPlayer(profile, ov);\n  p.__auditFloor = 1;\n  p.__drawLog = [];');

  /* B2：层循环里更新当前层 */
  src = replaceOnce(src,
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {',
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {\n    p.__auditFloor = floor;');

  /* B3：技能段候选池增加 minFloor 闸门（两段池拆分后魔法只在 skillPool） */
  src = replaceOnce(src,
    'function skillPool(p) {',
    'function skillPool(p) {\n  const __fl = (p && p.__auditFloor) || 1;');
  src = replaceOnce(src,
    '  C.MAGIC.forEach((m) => {\n    if (p.magics.includes(m.id)) return;',
    '  C.MAGIC.forEach((m) => {\n    if (p.magics.includes(m.id)) return;\n'
    + '    if (m.minFloor && __fl < m.minFloor) return;');

  /* B3b：把指定卡从奖励池摘掉（起手卡不受影响） */
  if (v.banId) {
    src = replaceOnce(src,
      '    if (m.minFloor && __fl < m.minFloor) return;',
      '    if (m.id === ' + JSON.stringify(v.banId) + ') return;\n'
      + '    if (m.minFloor && __fl < m.minFloor) return;');
  }

  /* F1：护盾卡单独成类 */
  src = replaceOnce(src,
    '    const isHeal = m.damage <= 0;',
    '    if (m.shield > 0) {\n'
    + '      if (p.hasWard) return;\n'
    + '      options.push({ kind: \'magic\', id: m.id, name: m.name, value: 0.02, survival: 0.16, data: m });\n'
    + '      return;\n'
    + '    }\n'
    + '    const isHeal = m.damage <= 0;');

  /* F1b：伤害卡走 damageCardValue；位移卡固定 0.05 / 0.12 */
  src = replaceOnce(src,
    '    options.push({ kind: \'magic\', id: m.id, name: m.name, value: damageCardValue(m), survival: 0.01, data: m });',
    '    options.push({ kind: \'magic\', id: m.id, name: m.name,\n'
    + '      value: (m.tag === \'位移\' ? 0.05 : damageCardValue(m)),\n'
    + '      survival: (m.tag === \'位移\' ? 0.12 : 0.01), data: m });');

  /* F2：效果判定 */
  src = replaceOnce(src,
    '  if (m.damage <= 0) return !p.hasHeal;          // 治疗卡：还没有治疗时才生效',
    '  if (m.shield > 0) return !p.hasWard;            // 护盾卡：还没有护盾时才生效\n'
    + '  if (m.tag === \'位移\') return true;              // 位移卡：功能型，永远有用\n'
    + '  if (m.damage <= 0) return !p.hasHeal;          // 治疗卡：还没有治疗时才生效');

  /* F3：应用选项 */
  src = replaceOnce(src,
    '    if (m.damage <= 0) {\n      p.hasHeal = true;',
    '    if (m.shield > 0) {\n'
    + '      p.hasWard = true;\n'
    + '      p.wardTakenMul = 0.85;\n'
    + '      p.wardHeal = m.heal || 12;\n'
    + '      p.wardCd = m.cooldown || 5;\n'
    + '      return;\n'
    + '    }\n'
    + '    if (m.tag === \'位移\') { p.riftStep = true; return; }\n'
    + '    if (m.damage <= 0) {\n      p.hasHeal = true;');

  /* F4：静态乘区 */
  src = replaceOnce(src,
    '  // 敏感度：回血比例（治疗卡 + 纳米机器人 + 嗜血一起乘）',
    '  // 护身符阵：5 秒减伤阵（30% 覆盖 × 减半 = 承伤 ×0.85）\n'
    + '  if (p.hasWard) {\n'
    + '    takenMul *= (p.wardTakenMul || 0.85);\n'
    + '    healPerSec += (p.wardHeal || 12) / (p.wardCd || 5) * 0.50 * p.profile.healDiscipline;\n'
    + '  }\n'
    + '  // 折跃步：瞬移躲伤折算成承伤 ×0.93\n'
    + '  if (p.riftStep) takenMul *= (p.__riftTakenMul || 0.93);\n'
    + '  // 敏感度：回血比例（治疗卡 + 纳米机器人 + 嗜血一起乘）');

  /* F5：护盾卡吃回能 */
  src = replaceOnce(src,
    '  const healUseCost = p.hasHeal ? (p.healAmount > 0 ? 28 / p.healCd * 0.50 * profile.healDiscipline : 0) : 0;',
    '  const healUseCost = (p.hasHeal ? (p.healAmount > 0 ? 28 / p.healCd * 0.50 * profile.healDiscipline : 0) : 0)\n'
    + '    + (p.hasWard ? 24 / (p.wardCd || 5) * 0.50 * profile.healDiscipline : 0);');

  src = replaceOnce(src,
    '  if (stage !== \'passive\') p.level += 1;\n  if (rec) rec(',
    '  if (stage !== \'passive\') p.level += 1;\n'
    + '  if (p.__drawLog) {\n'
    + '    p.__drawLog.push({\n'
    + '      chosen: chosen && chosen.kind === \'magic\' ? chosen.id : null,\n'
    + '      chosenKind: chosen ? chosen.kind : \'other\',\n'
    + '      stage: stage || \'skill\',\n'
    + '      choices: choices.map((o) => ({ kind: o.kind, id: o.id }))\n'
    + '    });\n'
    + '  }\n'
    + '  if (rec) rec(');

  /* B5：结果带上抽牌日志 */
  src = replaceOnce(src,
    '  result.ashDeck = (p.deck || []).length;\n  return result;',
    '  result.ashDeck = (p.deck || []).length;\n  result.__drawLog = p.__drawLog || [];\n  return result;');

  src = src.replace("require('./config')", 'require(' + JSON.stringify(path.join(DIR, 'config.js')) + ')');

  const outDir = path.join(__dirname, '..', '.seedwork');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, '.sim_cm_' + v.id + '.js');
  fs.writeFileSync(outFile, src, 'utf8');
  delete require.cache[outFile];
  return require(outFile);
}

/**
 * 按采纳版 s1r 调整卡表（与 s_visibility 一致）
 * @returns {void}
 */
function applyConfig() {
  const brand = C.MAGIC.find((m) => m.id === 'brand');
  if (brand) brand.damage = 36 * 3;
  const ward = C.MAGIC.find((m) => m.id === 'ward');
  if (ward) ward.shield = 5.0;
  S_IDS.forEach((id) => {
    const m = C.MAGIC.find((x) => x.id === id);
    if (m) m.minFloor = 3;
  });
  const rif = C.MAGIC.find((x) => x.id === 'riftStep');
  if (rif) rif.minFloor = 3;
}

/**
 * 还原卡表原值
 * @returns {void}
 */
function restoreConfig() {
  C.MAGIC.forEach((m) => {
    const b = CFG_BACKUP[m.id];
    if (!b) return;
    if (b.minFloor === undefined) delete m.minFloor; else m.minFloor = b.minFloor;
    m.damage = b.damage;
    if (b.shield === undefined) delete m.shield; else m.shield = b.shield;
  });
}

/**
 * 跑一个变体：四口径 × runs 局
 * @param {object} v 变体
 * @param {object} SIM 模拟器模块
 * @param {number} runs 每口径局数
 * @param {number} ashHp 焚稿代价
 * @returns {object} { per: {口径: {f10:number[], f20:number[], f10Rate, f20Rate}} }
 */
function runVariant(v, SIM, runs, ashHp) {
  const per = {};
  PROFILES.forEach((prof) => {
    const f10 = new Array(runs);
    const f20 = new Array(runs);
    const fl = new Array(runs);
    const acq = {};      // 卡 id → 被选中次数（合计）
    const offered = {};  // 卡 id → 被摆上三选一的局数
    const kinds = { magic: 0, tech: 0, relic: 0, fusion: 0, other: 0 };
    for (let i = 0; i < runs; i += 1) {
      const seed = C.SIM_PARAMS.baseSeed + i;
      const ov = {
        charSpec: Object.assign({}, prof.spec),
        ash: { enabled: true, hpCostPct: ashHp }
      };
      const r = SIM.runOne(seed, C.PROFILES.bot, 'normal', ov);
      f10[i] = r.clearedFloors >= 10 ? 1 : 0;
      f20[i] = r.clearedFloors >= C.SIM_PARAMS.maxFloor ? 1 : 0;
      /* 连续量：每局到达层数（辅助口径，配对差比二值通关率灵敏得多） */
      fl[i] = r.clearedFloors;
      /* 抽牌归因：只看技能段（被动段只出遗物，会把遗物计数虚高、破坏与旧表可比性） */
      const seenOffer = {};
      (r.__drawLog || []).forEach((e) => {
        if ((e.stage || 'skill') === 'passive') return;
        if (e.chosen) acq[e.chosen] = (acq[e.chosen] || 0) + 1;
        const k = e.chosenKind || 'other';
        kinds[k] = (kinds[k] || 0) + 1;
        e.choices.forEach((c) => { if (c.kind === 'magic') seenOffer[c.id] = true; });
      });
      Object.keys(seenOffer).forEach((id) => { offered[id] = (offered[id] || 0) + 1; });
    }
    per[prof.name] = { f10, f20, fl, acq, offered, kinds };
  });
  return { per };
}

/**
 * 比例与标准误（百分点）
 * @param {number[]} arr 0/1 数组
 * @returns {{rate:number, se:number}} rate/se 均为百分比
 */
function rateSe(arr) {
  const n = arr.length;
  const p = arr.reduce((s, x) => s + x, 0) / n;
  return { rate: p * 100, se: Math.sqrt(p * (1 - p) / n) * 100 };
}

/**
 * 均值与标准误（层）
 * @param {number[]} arr 每局到达层数
 * @returns {{rate:number, se:number}} rate=均值（层），se=标准误（层）
 */
function meanSe(arr) {
  const n = arr.length;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) { s += arr[i]; s2 += arr[i] * arr[i]; }
  const mean = s / n;
  const v = Math.max(0, s2 / n - mean * mean);
  return { rate: mean, se: Math.sqrt(v / n) };
}

/**
 * 配对差（变体 − 基线，同一 seed）的均值与标准误
 * @param {number[]} a 变体
 * @param {number[]} b 基线
 * @param {number} [scale=100] 输出倍率：通关率用 100（换算成 pp），层数用 1
 * @returns {{d:number, se:number}} 已乘 scale
 */
function pairedDiff(a, b, scale) {
  const k = scale == null ? 100 : scale;
  const n = a.length;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i += 1) {
    const d = a[i] - b[i];
    sum += d;
    sum2 += d * d;
  }
  const mean = sum / n;
  const varD = Math.max(0, sum2 / n - mean * mean);
  return { d: mean * k, se: Math.sqrt(varD / n) * k };
}

/* ---------------------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------------------- */
/**
 * 10 层闸门（v1 两段池重定标）：默认 = 新基线最差 10 层 + 0.7pp 安全余量。
 * 旧口径（混池 v0）基线 35.9 + 0.7 = 36.6，即默认值会随基线自动平移。
 * 可用 --gate=<数值> 强制指定（例如想复用旧闸门做对照）。
 * @type {number}
 */
let GATE10 = 36.6;
const gateArg = process.argv.find((s) => s.startsWith('--gate='));
const gateForced = gateArg ? Number(gateArg.slice('--gate='.length)) : null;

const runs = readRuns();
const scope = readScope();
const ashHp = readAshHpCost();
const baseIds = C.MAGIC.filter((m) => m.damage > 0 && !m.minFloor).map((m) => m.id);
const allDamage = C.MAGIC.filter((m) => m.damage > 0).map((m) => m.id);
const cardIds = scope === 'all' ? allDamage : baseIds;

console.log('【口径头】变体 = 焚稿 0.06 线上（hpCostPct=' + ashHp + '，读主文件）｜sim.js MD5 ' + md5Of(SIM_PATH) + ' | config.js MD5 ' + md5Of(path.join(DIR, 'config.js')));
console.log('【口径头】采纳版 s1r + 修模型（两段池：技能段 4 选 1 + 每 3 级被动段 3 选 1）｜四口径，报最差；配对比较按守拙');
console.log('【口径头】n=' + runs + ' 局/口径 × 4 = ' + (runs * 4) + ' 局/变体｜分母：每个通关率 = ' + runs + ' 局｜档案 bot / 普通｜seed=baseSeed+i');
console.log('【口径头】拿掉 = 从奖励池摘掉（起手火球/冰环仍在起手）｜加强一档 = 面板伤害 ×1.15（四舍五入）');
console.log('【口径头】卡表范围：' + scope + '（' + cardIds.length + ' 张伤害卡）');

applyConfig();
const SIM_BASE = buildSim({ id: 'base' });
const baseline = runVariant({ id: 'base' }, SIM_BASE, runs, ashHp);

/**
 * 生成一个变体的结果摘要
 * @param {object} v 变体
 * @returns {object} 摘要
 */
function summarize(v) {
  const SIM = v.banId ? buildSim(v) : SIM_BASE;
  const t0 = Date.now();
  const res = runVariant(v, SIM, runs, ashHp);
  const out = { id: v.id, card: v.cardId || null, op: v.op, ms: Date.now() - t0, per: {} };
  PROFILES.forEach((p) => {
    const x = res.per[p.name];
    out.per[p.name] = {
      f10: rateSe(x.f10),
      f20: rateSe(x.f20),
      meanFloor: meanSe(x.fl),
      d10: pairedDiff(x.f10, baseline.per[p.name].f10),
      d20: pairedDiff(x.f20, baseline.per[p.name].f20),
      dfl: pairedDiff(x.fl, baseline.per[p.name].fl, 1)
    };
  });
  out.worst10 = Math.max(...PROFILES.map((p) => out.per[p.name].f10.rate));
  out.worst20 = Math.max(...PROFILES.map((p) => out.per[p.name].f20.rate));
  /* 最差口径的名字与标准误（闸门比较必须带 SE，否则 0.2pp 的「余量」会被当成真空间） */
  out.worst10Profile = PROFILES.map((p) => p.name).find((n) => out.per[n].f10.rate === out.worst10);
  out.worst10Se = out.per[out.worst10Profile].f10.se;
  out.worst20Profile = PROFILES.map((p) => p.name).find((n) => out.per[n].f20.rate === out.worst20);
  out.worst20Se = out.per[out.worst20Profile].f20.se;
  /* 升级三选一各类被选次数（magic/tech/relic/fusion），仅用于机制归因 */
  out.kinds = Object.fromEntries(PROFILES.map((p) => [p.name, res.per[p.name].kinds]));
  return out;
}

const results = [];
const plan = [];
/* 控制组：ban 一个不存在的 id。补丁照打，但没有任何卡被摘掉。
   它必须给出 Δ=0.00±0.00 —— 用来证明「拿掉」的差异来自卡本身，不是补丁改了轨迹。 */
plan.push({ id: 'ctl_none', cardId: null, op: 'ctl', banId: '__no_such_card__' });
cardIds.forEach((id) => {
  plan.push({ id: 'ban_' + id, cardId: id, op: 'ban', banId: id });
  plan.push({ id: 'buff_' + id, cardId: id, op: 'buff' });
});

plan.forEach((v, idx) => {
  /* 加强一档：临时改面板伤害 */
  let saved = null;
  if (v.op === 'buff') {
    const m = C.MAGIC.find((x) => x.id === v.cardId);
    saved = m.damage;
    m.damage = Math.round(m.damage * 1.15);
  }
  const r = summarize(v);
  if (v.op === 'buff') {
    const m = C.MAGIC.find((x) => x.id === v.cardId);
    m.damage = saved;
  }
  results.push(r);
  process.stdout.write('  [' + (idx + 1) + '/' + plan.length + '] ' + v.id + ' 完成 ' + (r.ms / 1000).toFixed(1) + 's\n');
});

restoreConfig();

/* ---------- 输出 ---------- */
/* 基线四种口径的「点估计 + 标准误」，用于报最差口径与守拙单口径 */
const basePer = Object.fromEntries(PROFILES.map((p) => [p.name, {
  f10: rateSe(baseline.per[p.name].f10),
  f20: rateSe(baseline.per[p.name].f20),
  meanFloor: meanSe(baseline.per[p.name].fl)
}]));
const baseWorst10 = Math.max(...PROFILES.map((p) => basePer[p.name].f10.rate));
const baseWorst20 = Math.max(...PROFILES.map((p) => basePer[p.name].f20.rate));
/* 最差口径名字（报告中要写明是哪一档，不能只写数字） */
const baseWorst10Name = PROFILES.map((p) => p.name).find((n) => basePer[n].f10.rate === baseWorst10);
const baseWorst20Name = PROFILES.map((p) => p.name).find((n) => basePer[n].f20.rate === baseWorst20);
const baseShou = { f10: basePer['守拙'].f10, f20: basePer['守拙'].f20 };
/* 闸门重定标：默认继承旧的 0.7pp 安全余量，随新基线一起平移（可用 --gate 覆盖） */
GATE10 = gateForced != null && Number.isFinite(gateForced)
  ? gateForced
  : +(baseWorst10 + 0.7).toFixed(2);

/**
 * 格式化 Δ±SE（带符号，单位 pp）
 * @param {{d:number,se:number}} x 配对差
 * @returns {string} 例如 "+0.35±0.21"
 */
function fmtD(x) {
  return (x.d >= 0 ? '+' : '') + x.d.toFixed(2) + '±' + x.se.toFixed(2);
}

/**
 * 格式化 Δ±SE（带符号，单位层，3 位小数）
 * @param {{d:number,se:number}} x 配对差
 * @returns {string} 例如 "+0.124±0.031"
 */
function fmtD3(x) {
  return (x.d >= 0 ? '+' : '') + x.d.toFixed(3) + '±' + x.se.toFixed(3);
}

/**
 * 判断一档加强是否还能放进当前 10 层闸门
 * 余量小于 1 个标准误时不算「有空间」——那只是抽样抖动，不能当真的余量用
 * @param {number} rate 变体最差 10 层（%）
 * @param {number} se 该口径的标准误（pp）
 * @returns {string} 结论
 */
function gateVerdict(rate, se) {
  if (rate > GATE10) return '越线';
  if (GATE10 - rate <= (Number(se) || 0)) return '余量<1SE';
  return '有余量';
}

const out = {
  ts: new Date().toISOString(),
  runs,
  scope,
  gate10: GATE10,
  ashHp,
  fingerprints: {
    sim: md5Of(SIM_PATH),
    config: md5Of(path.join(DIR, 'config.js')),
    html: md5Of(LIVE_HTML)
  },
  baseline: {
    worst10: baseWorst10,
    worst10Profile: baseWorst10Name,
    worst20: baseWorst20,
    worst20Profile: baseWorst20Name,
    shou10: baseShou.f10,
    shou20: baseShou.f20,
    per: basePer,
    /* 守拙口径下：每局升级三选一里各卡被选次数（acq）与出现率（offered），用于归因 */
    acqShou: baseline.per['守拙'].acq,
    offeredShou: baseline.per['守拙'].offered
  },
  cards: cardIds.map((id) => {
    const c = C.MAGIC.find((m) => m.id === id);
    const ban = results.find((r) => r.id === 'ban_' + id);
    const buff = results.find((r) => r.id === 'buff_' + id);
    /* 「一点都动不了」判据：四口径 × 10层/F20 共 8 个配对差全为 0（逐局完全同轨迹） */
    const silentBan = PROFILES.every((p) => ban.per[p.name].d10.d === 0 && ban.per[p.name].d20.d === 0);
    const silentBuff = PROFILES.every((p) => buff.per[p.name].d10.d === 0 && buff.per[p.name].d20.d === 0);
    return {
      id,
      name: c.name,
      value: +(0.10 * ((c.damage * (c.segments || 1) * (c.aoe ? 2.26 : 1.18)) / 65.32)).toFixed(4),
      group: GROUPS[id] || '?',
      silentBan,
      silentBuff,
      ban: { per: ban.per, shou: ban.per['守拙'], worst10: ban.worst10, worst20: ban.worst20 },
      buff: { per: buff.per, shou: buff.per['守拙'], worst10: buff.worst10, worst20: buff.worst20,
        worst10Profile: buff.worst10Profile, worst10Se: buff.worst10Se,
        /* 加强后最差 10 层相对当前闸门的余量（正 = 还剩空间） */
        margin: GATE10 - buff.worst10 }
    };
  })
};

const tagArg = process.argv.find((s) => s.startsWith('--tag='));
const tag = tagArg ? tagArg.slice('--tag='.length) : '';
/* 控制组结果入档，便于事后复核「补丁本身零扰动」 */
out.control = results.find((r) => r.id === 'ctl_none').per;
/* 每个变体的升级三选一各类被选次数（守拙），归因用 */
out.kindsShou = Object.fromEntries(results.map((r) => [r.id, r.kinds['守拙']]));
const outFile = path.join(__dirname, '..', '.seedwork', 'card_marginal_' + scope + '_' + runs + (tag ? '_' + tag : '') + '.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

/* Markdown 输出：三张表（主表 = 通关率；闸门表 = 重定标后的 GATE10；副表 = 均层连续口径） */
console.log('\n【基线】最差 10 层 ' + baseWorst10.toFixed(1) + '%（' + baseWorst10Name + '）/ F20 '
  + baseWorst20.toFixed(1) + '%（' + baseWorst20Name + '）｜守拙 10 层 '
  + baseShou.f10.rate.toFixed(1) + '±' + baseShou.f10.se.toFixed(1)
  + '% / F20 ' + baseShou.f20.rate.toFixed(1) + '±' + baseShou.f20.se.toFixed(1) + '%');
console.log('【基线】四口径 10 层/F20：' + PROFILES.map((p) => p.name + ' '
  + basePer[p.name].f10.rate.toFixed(1) + '/' + basePer[p.name].f20.rate.toFixed(1)).join('｜'));
console.log('【基线】均到达层数（守拙 n=' + runs + '）' + basePer['守拙'].meanFloor.rate.toFixed(3)
  + '±' + basePer['守拙'].meanFloor.se.toFixed(3));

const sorted = out.cards.slice().sort((a, b) => b.buff.shou.d10.d - a.buff.shou.d10.d);

/* 控制组自检：必须逐位为 0，否则说明「拿掉」补丁本身扰动了轨迹 */
const ctl = results.find((r) => r.id === 'ctl_none');
console.log('\n【控制组】ban 一张不存在的卡（补丁照打、无人被摘）：守拙 Δ10 '
  + fmtD(ctl.per['守拙'].d10) + ' / Δ20 ' + fmtD(ctl.per['守拙'].d20)
  + ' / Δ层 ' + fmtD3(ctl.per['守拙'].dfl));

/* 归因表：基线守拙口径下这些卡有多常被选进卡组（解释 Δ 的方向） */
console.log('\n【归因·基线守拙】升级三选一里各卡被选次数/局 与 出现率');
console.log('| 卡 | 被选次/局 | 出现率(局) |');
console.log('|---|---|---|');
cardIds.forEach((id) => {
  const c = C.MAGIC.find((m) => m.id === id);
  const a = (baseline.per['守拙'].acq[id] || 0) / runs;
  const o = (baseline.per['守拙'].offered[id] || 0) / runs;
  console.log('| ' + c.name + '(' + id + ') | ' + a.toFixed(3) + ' | ' + (o * 100).toFixed(1) + '% |');
});

console.log('\n【归因·升级三选一各类被选次数/局（守拙）】解释「拿掉」为什么整体为正');
console.log('| 变体 | 魔法 | 科技 | 遗物 | 融合 |');
console.log('|---|---|---|---|---|');
[['基线', { kinds: { 守拙: baseline.per['守拙'].kinds } }]]
  .concat([
    ['拿掉熔岩地裂', results.find((r) => r.id === 'ban_lavaFissure')],
    ['加强符文轨道', results.find((r) => r.id === 'buff_runeOrbit')]
  ])
  .forEach(([label, obj]) => {
    const k = obj.kinds['守拙'] || {};
    console.log('| ' + label + ' | ' + ((k.magic || 0) / runs).toFixed(2) + ' | '
      + ((k.tech || 0) / runs).toFixed(2) + ' | ' + ((k.relic || 0) / runs).toFixed(2) + ' | '
      + ((k.fusion || 0) / runs).toFixed(2) + ' |');
  });

console.log('\n【表1·主表】守拙单口径，配对差 Δ±SE（pp，同 seed 逐局作差）');
console.log('| 卡 | 价值 | 拿掉Δ10 | 拿掉Δ20 | 加强Δ10 | 加强Δ20 |');
console.log('|---|---|---|---|---|---|');
sorted.forEach((c) => {
  console.log('| ' + c.name + '(' + c.id + ') | ' + c.value.toFixed(4)
    + ' | ' + fmtD(c.ban.shou.d10) + ' | ' + fmtD(c.ban.shou.d20)
    + ' | ' + fmtD(c.buff.shou.d10) + ' | ' + fmtD(c.buff.shou.d20) + ' |');
});

console.log('\n【表2·' + GATE10.toFixed(1) + ' 闸门（v1 重定标）】加强一档后四口径最差 10 层（基线最差 ' + baseWorst10.toFixed(1) + '%±'
  + basePer[baseWorst10Name].f10.se.toFixed(1) + '，余量 ' + (GATE10 - baseWorst10).toFixed(1) + 'pp）');
console.log('| 卡 | 加强后最差10层 | 余量(pp) | 结论 | 静默 |');
console.log('|---|---|---|---|---|');
sorted.forEach((c) => {
  const silent = (c.silentBan ? '拿掉无感' : '') + (c.silentBuff ? (c.silentBan ? ' / ' : '') + '加强无感' : '');
  console.log('| ' + c.name + '(' + c.id + ') | ' + c.buff.worst10.toFixed(1) + '%±'
    + c.buff.worst10Se.toFixed(1) + ' | '
    + (c.buff.margin >= 0 ? '+' : '') + c.buff.margin.toFixed(1)
    + ' | ' + gateVerdict(c.buff.worst10, c.buff.worst10Se) + ' | ' + (silent || '—') + ' |');
});

console.log('\n【表3·辅助】守拙单口径每局到达层数配对差 Δ±SE（层，连续量，比二值通关率灵敏）');
console.log('| 卡 | 拿掉Δ层 | 加强Δ层 |');
console.log('|---|---|---|');
sorted.slice().sort((a, b) => b.buff.shou.dfl.d - a.buff.shou.dfl.d).forEach((c) => {
  console.log('| ' + c.name + '(' + c.id + ') | ' + fmtD3(c.ban.shou.dfl) + ' | ' + fmtD3(c.buff.shou.dfl) + ' |');
});

console.log('\n【存档】' + outFile);
