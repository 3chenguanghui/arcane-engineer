/**
 * 三选一类型配额实验（两段池版：技能段 4 选 1 + 每 3 级被动段 3 选 1 只出遗物）
 * ----------------------------------------------------------------------------
 * 要回答三件事：
 *   1) 现状：每个技能段抽卡里，伤害卡 / 功能魔法 / 科技 / 融合 各占多少槽位、
 *      各被选多少次；遗物每局能拿几张（只来自被动段，带分母与跨局标准误）。
 *   2) 配额：给技能段 4 张牌加类型下限（≥1 非伤害 / ≥2 非伤害 / ≥1 遗物），
 *      在「焚稿 0.06 线上」与「无焚稿」两个变体下各跑四口径 n=4000，
 *      与基线做同 seed 配对差 Δ±SE。被动段不受配额影响（池里只有遗物）。
 *   3) 配额能不能消掉「拿掉熔岩地裂反而更好」的反向现象。
 *
 * 约束：
 *   · 主文件（index_arcane_v2.html）、sim.js、config.js 全部零改动；
 *     所有补丁只打在 .seedwork/ 下的临时副本上。
 *   · 配额只动「抽哪几张」，选项的 value / survival / 卡表数值一个字都不动。
 *
 * 用法：
 *   node tools/_draw_quota.js --runs 4000
 *   node tools/_draw_quota.js --runs 200 --only=q1     # 冒烟
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
 * 算文件 MD5（大写十六进制）
 * @param {string} file 绝对路径
 * @returns {string} 32 位大写十六进制
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 读主文件 ASH_CONFIG.hpCostPct（焚稿灼身代价），保证「线上」口径与主文件同源
 * @returns {number} 例如 0.06；缺字段直接抛错
 */
function readAshHpCost() {
  const html = fs.readFileSync(LIVE_HTML, 'utf8');
  const m = html.match(/var ASH_CONFIG = \{[\s\S]{0,800}?hpCostPct:\s*([0-9.]+)/);
  if (!m) throw new Error('主文件 ASH_CONFIG 里没有 hpCostPct');
  return Number(m[1]);
}

/**
 * 读命令行 --runs（默认 4000）
 * @returns {number} 每口径局数
 */
function readRuns() {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 4000;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4000;
}

/**
 * 读命令行 --only（按变体 id 前缀过滤，仅用于冒烟，不参与正式出表）
 * @returns {string|null} 过滤前缀
 */
function readOnly() {
  const a = process.argv.find((s) => s.startsWith('--only='));
  return a ? a.slice('--only='.length) : null;
}

/**
 * 读命令行 --iq（覆盖 bot 的 buildIQ，用于"聪明分支是否还选无效卡"的证伪实验）
 * @returns {number} 未指定时返回 null
 */
function readIq() {
  const i = process.argv.indexOf('--iq');
  if (i < 0) return null;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : null;
}

/* ---------------------------------------------------------------------------
 * 1. 卡表补齐（与 s_visibility / _card_marginal 完全一致，只补内存）
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

/* S 批 8 张在采纳版里统一降到 F3 解锁（与 _card_marginal 的 applyConfig 同口径） */
const S_IDS = ['pulseShock', 'pierceLance', 'skyfall', 'hammer', 'brand', 'ward'];

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
 * 配额判定（注入到模拟器副本里的函数源码）
 * 「伤害卡」= kind=magic 且 damage>0 且不是位移/护盾（后两者是功能卡）。
 * @returns {string} 两个顶层函数的源码
 */
function quotaHelperSrc() {
  return [
    '/** 是否伤害卡（只用于类型配额判定，不参与任何价值计算） */',
    'function __isDmgOpt(o) {',
    '  if (!o || o.kind !== \'magic\') return false;',
    '  const m = o.data || {};',
    '  if (m.shield > 0) return false;',
    '  if (m.tag === \'位移\') return false;',
    '  return (m.damage || 0) > 0;',
    '}',
    '/**',
    ' * 类型配额：把抽中的 3 张按配额下限修补，只换「抽到谁」，不改 value / survival。',
    ' * @param {Array} picks 已经抽出的 3 张',
    ' * @param {Array} pool 完整候选池',
    ' * @param {Function} rng 随机函数',
    ' * @param {string} mode nonDmg1 / nonDmg2 / relic1',
    ' * @returns {Array} 修补后的 3 张',
    ' */',
    'function __quotaFix(picks, pool, rng, mode) {',
    '  const need = mode === \'nonDmg2\' ? 2 : 1;',
    '  const isTarget = mode === \'relic1\'',
    '    ? function (o) { return o.kind === \'relic\'; }',
    '    : function (o) { return !__isDmgOpt(o); };',
    '  const out = picks.slice();',
    '  let got = out.filter(isTarget).length;',
    '  if (got >= need) return out;',
    '  const avail = pool.filter(function (o) { return out.indexOf(o) < 0 && isTarget(o); });',
    '  while (got < need && avail.length) {',
    '    const slots = [];',
    '    for (let i = 0; i < out.length; i += 1) if (!isTarget(out[i])) slots.push(i);',
    '    if (!slots.length) break;',
    '    const si = slots[Math.floor(rng() * slots.length)];',
    '    const ci = Math.floor(rng() * avail.length);',
    '    out[si] = avail.splice(ci, 1)[0];',
    '    got += 1;',
    '  }',
    '  return out;',
    '}'
  ].join('\n');
}

/**
 * 生成带补丁的模拟器临时副本
 * @param {object} v 变体 {id, quota, banId}
 * @returns {object} 模拟器模块
 */
function buildSim(v) {
  let src = fs.readFileSync(SIM_PATH, 'utf8');

  /* B1：每局记录当前层、抽牌日志容器、类型配额模式 */
  src = replaceOnce(src,
    '  const p = createPlayer(profile, ov);',
    '  const p = createPlayer(profile, ov);\n'
    + '  p.__auditFloor = 1;\n  p.__drawLog = [];\n  p.__slotLog = [];\n  p.__drawQuota = ov.drawQuota || null;');

  /* B2：层循环里更新当前层 */
  src = replaceOnce(src,
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {',
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {\n    p.__auditFloor = floor;');

  /* B3：技能段候选池增加 minFloor 闸门（两段池拆分后，魔法只存在于 skillPool） */
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

  /* B4：抽牌日志（记录每次三选一的候选与最终选中） */
  src = replaceOnce(src,
    '  if (stage !== \'passive\') p.level += 1;\n  if (rec) rec(',
    '  if (stage !== \'passive\') p.level += 1;\n'
    + '  if (p.__drawLog) {\n'
    + '    p.__drawLog.push({\n'
    + '      chosen: chosen && chosen.kind === \'magic\' ? chosen.id : null,\n'
    + '      chosenKind: chosen ? chosen.kind : \'other\',\n'
    + '      stage: stage || \'skill\',\n'
    + '      poolSize: pool.length,\n'
    + '      choices: choices.map((o) => ({ kind: o.kind, id: o.id }))\n'
    + '    });\n'
    + '  }\n'
    + '  if (rec) rec(');

  /* Q：类型配额（只在指定模式时打补丁，基线源码保持逐字不变）
     两段池之后：技能段 4 张、被动段 3 张且只出遗物，所以配额只作用在技能段。 */
  if (v.quota) {
    src = replaceOnce(src,
      'function levelUp(p, rng, rec, stage) {',
      quotaHelperSrc() + '\nfunction levelUp(p, rng, rec, stage) {');
    src = replaceOnce(src,
      '  const choices = shuffle(rng, pool).slice(0, count);',
      '  let choices = shuffle(rng, pool).slice(0, count);\n'
      + '  if (p.__drawQuota && stage !== \'passive\') choices = __quotaFix(choices, pool, rng, p.__drawQuota);');
  }

  /* S：把已经算好的 effective 接进评分（唯一改动：无效选项的 value 记 0）
     其余 value / survival / 抽取规则 / 卡表数值全部不动。 */
  if (v.scoreFix) {
    src = replaceOnce(src,
      '  const score = (o) => o.value * bias.value + o.survival * bias.survival;',
      '  const score = (o) => (optionEffective(p, o) ? o.value : 0) * bias.value + o.survival * bias.survival;');
  }

  /* P1：记录每次「伤害卡入队」是否真的改变了主/副槽（空转诊断，不影响任何数值） */
  src = replaceOnce(src,
    '    if (singleDps(m.id) > singleDps(p.magics[0])) {\n'
    + '      p.magics[1] = p.magics[0];\n'
    + '      p.magics[0] = m.id;\n'
    + '    } else if (groupEff(m.id) > groupEff(p.magics[1])) {\n'
    + '      p.magics[1] = m.id;\n'
    + '    }',
    '    const __b0 = p.magics[0];\n'
    + '    const __b1 = p.magics[1];\n'
    + '    if (singleDps(m.id) > singleDps(p.magics[0])) {\n'
    + '      p.magics[1] = p.magics[0];\n'
    + '      p.magics[0] = m.id;\n'
    + '    } else if (groupEff(m.id) > groupEff(p.magics[1])) {\n'
    + '      p.magics[1] = m.id;\n'
    + '    }\n'
    + '    if (p.__slotLog) p.__slotLog.push(__b0 !== p.magics[0] || __b1 !== p.magics[1]);');

  /* B5：结果带上抽牌日志 */
  src = replaceOnce(src,
    '  result.ashDeck = (p.deck || []).length;\n  return result;',
    '  result.ashDeck = (p.deck || []).length;\n'
    + '  result.__drawLog = p.__drawLog || [];\n'
    + '  result.__slotLog = p.__slotLog || [];\n'
    + '  return result;');

  src = src.replace("require('./config')", 'require(' + JSON.stringify(path.join(DIR, 'config.js')) + ')');

  const outDir = path.join(__dirname, '..', '.seedwork');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, '.sim_q_' + v.id + '.js');
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

/* ---------------------------------------------------------------------------
 * 2. 分类与统计
 * ------------------------------------------------------------------------- */
const MAGIC_BY_ID = {};
C.MAGIC.forEach((m) => { MAGIC_BY_ID[m.id] = m; });

/**
 * 把一个选项归到 5 类：伤害卡 / 功能魔法 / 科技 / 遗物 / 融合
 * @param {string} kind 选项 kind
 * @param {string|null} id 选项 id
 * @returns {'dmg'|'util'|'tech'|'relic'|'fusion'} 分类
 */
function kindOf(kind, id) {
  if (kind === 'magic') {
    const m = MAGIC_BY_ID[id] || {};
    if (m.shield > 0) return 'util';
    if (m.tag === '位移') return 'util';
    if ((m.damage || 0) > 0) return 'dmg';
    return 'util';
  }
  if (kind === 'tech') return 'tech';
  if (kind === 'relic') return 'relic';
  if (kind === 'fusion') return 'fusion';
  return 'util';
}

const KIND_LABEL = { dmg: '伤害卡', util: '功能魔法', tech: '科技', relic: '遗物', fusion: '融合' };

/**
 * 把一次三选一的构成压成一个可读 key（只写非零项，固定顺序）
 * @param {object} comp {dmg,util,tech,relic,fusion} 计数
 * @returns {string} 例如 "2伤害+1遗物"
 */
function shapeKey(comp) {
  return ['dmg', 'util', 'tech', 'relic', 'fusion']
    .filter((k) => comp[k] > 0)
    .map((k) => comp[k] + KIND_LABEL[k])
    .join('+') || '空';
}

/**
 * 跑一个变体：四口径 × runs 局，逐局记录抽牌明细
 * @param {object} SIM 模拟器模块
 * @param {number} runs 每口径局数
 * @param {object} ashMode {ash: 传给 runOne 的 ash 配置}
 * @param {string|null} quota 配额模式（null = 基线）
 * @returns {object} per[profile] = {f10,f20,fl,rows}
 */
function runVariant(SIM, runs, ashMode, quota) {
  const per = {};
  const botProfile = IQ_OVERRIDE == null
    ? C.PROFILES.bot
    : Object.assign({}, C.PROFILES.bot, { buildIQ: IQ_OVERRIDE });
  PROFILES.forEach((prof) => {
    const f10 = new Array(runs);
    const f20 = new Array(runs);
    const fl = new Array(runs);
    const rows = new Array(runs);
    for (let i = 0; i < runs; i += 1) {
      const seed = C.SIM_PARAMS.baseSeed + i;
      const ov = {
        charSpec: Object.assign({}, prof.spec),
        ash: Object.assign({}, ashMode.ash)
      };
      if (quota) ov.drawQuota = quota;
      const r = SIM.runOne(seed, botProfile, 'normal', ov);
      f10[i] = r.clearedFloors >= 10 ? 1 : 0;
      f20[i] = r.clearedFloors >= C.SIM_PARAMS.maxFloor ? 1 : 0;
      fl[i] = r.clearedFloors;

      const picks = { dmg: 0, util: 0, tech: 0, relic: 0, fusion: 0 };
      const slots = { dmg: 0, util: 0, tech: 0, relic: 0, fusion: 0 };
      const shapes = {};
      let skillDraws = 0;
      let passiveDraws = 0;
      let passiveRelicPicks = 0;
      let relicDraws = 0;
      let relicWithDmgDraws = 0;
      let relicPickWithDmg = 0;
      const log = r.__drawLog || [];
      log.forEach((e) => {
        const st = e.stage || 'skill';
        const comp = { dmg: 0, util: 0, tech: 0, relic: 0, fusion: 0 };
        e.choices.forEach((c) => {
          comp[kindOf(c.kind, c.id)] += 1;
        });
        /* 选中项：科技/遗物/融合的 chosen 字段是 null（只有魔法记 id），
           所以必须用 chosenKind 分类，不能靠 chosen 是否为真来判断「有没有选中」。 */
        if (e.chosenKind && e.chosenKind !== 'other') picks[kindOf(e.chosenKind, e.chosen)] += 1;
        if (st === 'passive') {
          passiveDraws += 1;
          if (e.chosenKind === 'relic') passiveRelicPicks += 1;
          return;
        }
        skillDraws += 1;
        ['dmg', 'util', 'tech', 'relic', 'fusion'].forEach((k) => { slots[k] += comp[k]; });
        const key = shapeKey(comp);
        shapes[key] = (shapes[key] || 0) + 1;
        if (comp.relic > 0) relicDraws += 1;
        if (comp.relic > 0 && comp.dmg > 0) {
          relicWithDmgDraws += 1;
          if (e.chosenKind === 'relic') relicPickWithDmg += 1;
        }
      });
      const picksTotal = picks.dmg + picks.util + picks.tech + picks.relic + picks.fusion;
      const slotLog = r.__slotLog || [];
      const swaps = slotLog.filter(Boolean).length;
      rows[i] = {
        draws: skillDraws,
        skillDraws,
        passiveDraws,
        passiveRelicPicks,
        picks,
        picksTotal,
        slots,
        shapes,
        emptyPicks: log.length ? (picks.dmg - swaps) : 0,
        swaps,
        relicDraws,
        relicWithDmgDraws,
        relicPickWithDmg,
        deck: r.ashDeck,
        ashStacks: r.ashStacks,
        ashBurns: r.ashBurns
      };
    }
    per[prof.name] = { f10, f20, fl, rows };
  });
  return per;
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
 * 均值与标准误（跨局）
 * @param {number[]} arr 每局一个数
 * @returns {{rate:number, se:number}} 均值与跨局标准误
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
 * @param {number} [scale=100] 输出倍率：通关率用 100（pp），层数/次数用 1
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

/**
 * 跨局均值±SE：每局取一个「比值」，再对局求均值（对局内聚类稳健）
 * @param {object[]} rows 每局记录
 * @param {Function} numFn 分子取值
 * @param {Function} denFn 分母取值
 * @returns {{rate:number, se:number}} 均值与 SE（原始单位，未乘 100）
 */
function ratioAcrossRuns(rows, numFn, denFn) {
  const vals = [];
  rows.forEach((r) => {
    const d = denFn(r);
    if (!d) return;
    vals.push(numFn(r) / d);
  });
  return meanSe(vals);
}

/**
 * 跨局均值±SE：每局取一个计数
 * @param {object[]} rows 每局记录
 * @param {Function} fn 取值
 * @returns {{rate:number, se:number}} 均值与 SE
 */
function countAcrossRuns(rows, fn) {
  return meanSe(rows.map(fn));
}

/**
 * 格式化「值±SE」
 * @param {number} v 值
 * @param {number} se 标准误
 * @param {number} [d=2] 小数位
 * @returns {string} 例如 "1.48±0.02"
 */
function fmtSE(v, se, d) {
  const k = d == null ? 2 : d;
  return v.toFixed(k) + '±' + se.toFixed(k);
}

/**
 * 格式化 Δ±SE（带符号）
 * @param {{d:number,se:number}} x 配对差
 * @param {number} [d=2] 小数位
 * @returns {string} 例如 "+2.93±1.03"
 */
function fmtD(x, d) {
  const k = d == null ? 2 : d;
  return (x.d >= 0 ? '+' : '') + x.d.toFixed(k) + '±' + x.se.toFixed(k);
}

/* ---------------------------------------------------------------------------
 * 3. 主流程
 * ------------------------------------------------------------------------- */
const runs = readRuns();
const only = readOnly();
const IQ_OVERRIDE = readIq();
const ashHp = readAshHpCost();

const MODES = [
  { key: 'ash006', label: '焚稿 0.06 线上', ash: { enabled: true, hpCostPct: ashHp } },
  { key: 'noash', label: '无焚稿', ash: { enabled: false } }
];

const VARIANTS = [
  { id: 'base', quota: null, banId: null, note: '基线（现行抽取规则）' },
  { id: 'q1_nonDmg1', quota: 'nonDmg1', banId: null, note: '每次至少 1 张非伤害卡' },
  { id: 'q2_nonDmg2', quota: 'nonDmg2', banId: null, note: '每次至少 2 张非伤害卡' },
  { id: 'q3_relic1', quota: 'relic1', banId: null, note: '每次至少 1 张遗物' },
  { id: 'base_banLava', quota: null, banId: 'lavaFissure', note: '基线 + 拿掉熔岩地裂（复示反向现象）', banPair: 'base' },
  { id: 'q1_banLava', quota: 'nonDmg1', banId: 'lavaFissure', note: '配额1 + 拿掉熔岩地裂', banPair: 'q1_nonDmg1' },
  { id: 'q2_banLava', quota: 'nonDmg2', banId: 'lavaFissure', note: '配额2 + 拿掉熔岩地裂', banPair: 'q2_nonDmg2' },
  { id: 'q3_banLava', quota: 'relic1', banId: 'lavaFissure', note: '配额3 + 拿掉熔岩地裂', banPair: 'q3_relic1' },
  { id: 'eff_only', quota: null, banId: null, scoreFix: true, note: '评分接入 effective（无效卡 value 记 0）' },
  { id: 'eff_banLava', quota: null, banId: 'lavaFissure', scoreFix: true, note: '评分接入 effective + 拿掉熔岩地裂', banPair: 'eff_only' },
  { id: 'q1_banCollapse', quota: 'nonDmg1', banId: 'collapseHole', note: '配额1 + 拿掉坍缩黑洞' },
  { id: 'q1_banMine', quota: 'nonDmg1', banId: 'mine', note: '配额1 + 拿掉符文雷' }
];

const plan = only ? VARIANTS.filter((v) => v.id.indexOf(only) >= 0 || v.id === 'base') : VARIANTS;

console.log('【口径头】sim.js MD5 ' + md5Of(SIM_PATH) + ' | config.js MD5 ' + md5Of(path.join(DIR, 'config.js'))
  + ' | 主文件 MD5 ' + md5Of(LIVE_HTML));
console.log('【口径头】变体 A = 焚稿 0.06 线上（hpCostPct 读主文件 ' + ashHp + '）；变体 B = 无焚稿');
console.log('【口径头】采纳版 s1r + 修模型｜四口径（中性/守拙/疾火/观星），报最差；配对比较按守拙同 seed');
console.log('【口径头】n=' + runs + ' 局/口径 × 4 = ' + (runs * 4) + ' 局/变体/变体口径｜档案 bot(buildIQ=' + (IQ_OVERRIDE == null ? C.PROFILES.bot.buildIQ : IQ_OVERRIDE) + ')' + (IQ_OVERRIDE == null ? '' : '【覆盖】') + ' / 普通');
console.log('【口径头】配额只改抽取规则：选项 value / survival / 卡表数值零改动；主文件零改动');
console.log('【口径头】变体清单：' + plan.map((v) => v.id).join(' / '));

applyConfig();

/* ---- 逐变体 × 逐口径跑 ---- */
const all = {};   // all[modeKey][variantId] = {per, ms}
MODES.forEach((mode) => {
  all[mode.key] = {};
  plan.forEach((v) => {
    const t0 = Date.now();
    const SIM = buildSim(v);
    const per = runVariant(SIM, runs, mode, v.quota);
    all[mode.key][v.id] = { per, ms: Date.now() - t0, v };
    process.stdout.write('  [' + mode.key + '] ' + v.id + ' 完成 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');
  });
});

restoreConfig();

/* ---------------------------------------------------------------------------
 * 4. 结果整理
 * ------------------------------------------------------------------------- */
const out = {
  ts: new Date().toISOString(),
  runs,
  ashHp,
  fingerprints: {
    sim: md5Of(SIM_PATH),
    config: md5Of(path.join(DIR, 'config.js')),
    html: md5Of(LIVE_HTML)
  },
  modes: {},
  variants: VARIANTS
};

/**
 * 汇总一个变体 × 一个口径的「最差 10 层 / F20」及其口径名与 SE
 * @param {object} per runVariant 的 per
 * @returns {object} 汇总
 */
function worstOf(per) {
  const perRate = {};
  PROFILES.forEach((p) => {
    const x = per[p.name];
    perRate[p.name] = {
      f10: rateSe(x.f10),
      f20: rateSe(x.f20),
      meanFloor: meanSe(x.fl)
    };
  });
  const w10 = Math.max(...PROFILES.map((p) => perRate[p.name].f10.rate));
  const w10Name = PROFILES.map((p) => p.name).find((n) => perRate[n].f10.rate === w10);
  const w20 = Math.max(...PROFILES.map((p) => perRate[p.name].f20.rate));
  const w20Name = PROFILES.map((p) => p.name).find((n) => perRate[n].f20.rate === w20);
  return {
    perRate,
    worst10: { rate: w10, se: perRate[w10Name].f10.se, profile: w10Name },
    worst20: { rate: w20, se: perRate[w20Name].f20.se, profile: w20Name }
  };
}

/**
 * 抽牌结构汇总（守拙口径，四口径共享同一 buildIQ，守拙是闸门最差档，取它做代表）
 * @param {object[]} rows 每局记录
 * @returns {object} 结构统计
 */
function drawProfile(rows) {
  const draws = countAcrossRuns(rows, (r) => r.skillDraws);
  const passiveDraws = countAcrossRuns(rows, (r) => r.passiveDraws);
  const skillSlots = C.SIM_PARAMS.skillCount || 4;
  const pick = {};
  const slot = {};
  const pickShare = {};
  ['dmg', 'util', 'tech', 'relic', 'fusion'].forEach((k) => {
    pick[k] = countAcrossRuns(rows, (r) => r.picks[k]);
    pickShare[k] = ratioAcrossRuns(rows, (r) => r.picks[k], (r) => r.picksTotal);
    slot[k] = ratioAcrossRuns(rows, (r) => r.slots[k], (r) => r.skillDraws);
  });
  /* 每次抽卡里各类的槽位占比（分母 = 技能段抽卡次数 × 4，按局聚类求 SE） */
  const slotShare = {};
  ['dmg', 'util', 'tech', 'relic', 'fusion'].forEach((k) => {
    slotShare[k] = ratioAcrossRuns(rows, (r) => r.slots[k], (r) => r.skillDraws * skillSlots);
  });
  /* 票型分布：把所有出现过的 shape 收集起来，逐 shape 求「占全部抽卡的百分比」 */
  const shapeSet = {};
  rows.forEach((r) => { Object.keys(r.shapes).forEach((k) => { shapeSet[k] = true; }); });
  const shapes = Object.keys(shapeSet).map((k) => {
    const v = ratioAcrossRuns(rows, (r) => (r.shapes[k] || 0), (r) => r.skillDraws);
    return { key: k, share: v.rate * 100, se: v.se * 100 };
  }).sort((a, b) => b.share - a.share);
  /* 核心拥挤指标：技能段 4 张全是伤害卡的抽卡占比（两段池下遗物已不在技能池） */
  const allDmg = ratioAcrossRuns(rows, (r) => (r.shapes['4伤害卡'] || 0), (r) => r.skillDraws);
  /* 遗物：技能段出现率（两段池后恒为 0，保留指标用于回归检查） */
  const relicOffer = ratioAcrossRuns(rows, (r) => {
    let n = 0;
    Object.keys(r.shapes).forEach((k) => { if (k.indexOf('遗物') >= 0) n += r.shapes[k]; });
    return n;
  }, (r) => r.skillDraws);
  /* 遗物被选：总张数 / 技能段抽卡（分母保持与旧表可比） */
  const relicPick = ratioAcrossRuns(rows, (r) => r.picks.relic, (r) => r.skillDraws);
  /* 被动段：每次被动抽卡拿到遗物的比例（应接近 100%） */
  const relicPickGivenOffer = ratioAcrossRuns(rows, (r) => r.passiveRelicPicks, (r) => r.passiveDraws);
  const relicPickWhenDmgShown = ratioAcrossRuns(rows, (r) => r.relicPickWithDmg, (r) => r.relicWithDmgDraws);
  /* 技能段是否还出现过「遗物 + 伤害卡同屏」：两段池下应为 false，用于回归检查而非当除数 */
  const relicWithDmgSeen = rows.some((r) => r.relicWithDmgDraws > 0);
  return {
    draws, passiveDraws, pick, pickShare, slot, slotShare, shapes, allDmg, relicOffer, relicPick,
    relicPickGivenOffer, relicPickWhenDmgShown, relicWithDmgSeen,
    swaps: countAcrossRuns(rows, (r) => r.swaps),
    emptyPicks: countAcrossRuns(rows, (r) => r.emptyPicks),
    /* 空转率 = (被选 - 真换槽) / 被选；分母是伤害卡被选次数，按局聚类求 SE */
    idleRate: ratioAcrossRuns(rows, (r) => (r.picks.dmg - r.swaps), (r) => r.picks.dmg),
    deck: countAcrossRuns(rows, (r) => r.deck),
    ashStacks: countAcrossRuns(rows, (r) => r.ashStacks),
    ashBurns: countAcrossRuns(rows, (r) => r.ashBurns)
  };
}

MODES.forEach((mode) => {
  const baseAgg = worstOf(all[mode.key].base.per);
  const m = {
    label: mode.label,
    base: {
      worst10: baseAgg.worst10,
      worst20: baseAgg.worst20,
      shou10: baseAgg.perRate['守拙'].f10,
      shou20: baseAgg.perRate['守拙'].f20,
      meanFloor: baseAgg.perRate['守拙'].meanFloor,
      perRate: baseAgg.perRate,
      draw: drawProfile(all[mode.key].base.per['守拙'].rows)
    },
    rows: [],
    pairs: []
  };
  plan.forEach((v) => {
    if (v.id === 'base') return;
    const agg = worstOf(all[mode.key][v.id].per);
    const shou = agg.perRate['守拙'];
    const bShou = baseAgg.perRate['守拙'];
    /* 配对差：最差口径相对「基线同一口径」，另给守拙相对守拙 */
    const wProfile = agg.worst10.profile;
    const d10w = pairedDiff(all[mode.key][v.id].per[wProfile].f10, all[mode.key].base.per[wProfile].f10);
    const d20w = pairedDiff(all[mode.key][v.id].per[wProfile].f20, all[mode.key].base.per[wProfile].f20);
    const d10s = pairedDiff(all[mode.key][v.id].per['守拙'].f10, all[mode.key].base.per['守拙'].f10);
    const d20s = pairedDiff(all[mode.key][v.id].per['守拙'].f20, all[mode.key].base.per['守拙'].f20);
    const dp = drawProfile(all[mode.key][v.id].per['守拙'].rows);
    m.rows.push({
      id: v.id,
      note: v.note,
      worst10: agg.worst10,
      worst20: agg.worst20,
      shou10: shou.f10,
      shou20: shou.f20,
      d10w, d20w, d10s, d20s,
      draw: dp,
      deltaDmgPick: pairedDiff(
        all[mode.key][v.id].per['守拙'].rows.map((r) => r.picks.dmg),
        all[mode.key].base.per['守拙'].rows.map((r) => r.picks.dmg), 1),
      deltaRelicPick: pairedDiff(
        all[mode.key][v.id].per['守拙'].rows.map((r) => r.picks.relic),
        all[mode.key].base.per['守拙'].rows.map((r) => r.picks.relic), 1)
    });
    /* 拿掉熔岩的净收益：与「同一抽取/评分规则、但没有 ban」的兄弟变体逐局配对 */
    if (v.banPair && all[mode.key][v.banPair]) {
      const a = all[mode.key][v.id].per['守拙'];
      const b = all[mode.key][v.banPair].per['守拙'];
      m.pairs.push({
        id: v.id,
        ref: v.banPair,
        d10: pairedDiff(a.f10, b.f10),
        d20: pairedDiff(a.f20, b.f20)
      });
    }
  });
  out.modes[mode.key] = m;
});

/* ---------------------------------------------------------------------------
 * 5. 打印
 * ------------------------------------------------------------------------- */
const L = [];
/**
 * 同时写控制台与内存行缓冲，最后一起落盘
 * @param {string} s 一行文本
 * @returns {void}
 */
function say(s) {
  L.push(s);
  console.log(s);
}

say('');
MODES.forEach((mode) => {
  const m = out.modes[mode.key];
  const bd = m.base.draw;
  say('══════════════════════════════════════════════════════════════════');
  say('【' + mode.label + '｜sim ' + out.fingerprints.sim.slice(0, 8) + '｜n=' + runs + '/口径 ×4｜档案 bot/普通】');
  say('══════════════════════════════════════════════════════════════════');
  say('基线：最差 10 层 ' + m.base.worst10.rate.toFixed(1) + '%±' + m.base.worst10.se.toFixed(1)
    + '%（' + m.base.worst10.profile + '）/ F20 ' + m.base.worst20.rate.toFixed(1) + '%±'
    + m.base.worst20.se.toFixed(1) + '%（' + m.base.worst20.profile + '）'
    + '｜守拙 ' + m.base.shou10.rate.toFixed(1) + '/' + m.base.shou20.rate.toFixed(1));
  say('');
  say('—— 表 1：技能段现状（' + mode.label + '｜守拙｜分母 = 每局技能段抽卡 ' + bd.draws.rate.toFixed(2) + '±'
    + bd.draws.se.toFixed(2) + ' 次 × 4 槽；被动段另计）——');
  say('| 类别 | 每局被选次数 | 技能段出现槽位/次 | 槽位占比 | 占被选票 |');
  say('|---|---|---|---|---|');
  ['dmg', 'util', 'tech', 'relic', 'fusion'].forEach((k) => {
    say('| ' + KIND_LABEL[k] + ' | ' + fmtSE(bd.pick[k].rate, bd.pick[k].se)
      + ' | ' + fmtSE(bd.slot[k].rate, bd.slot[k].se)
      + ' | ' + fmtSE(bd.slotShare[k].rate * 100, bd.slotShare[k].se * 100, 1) + '%'
      + ' | ' + fmtSE(bd.pickShare[k].rate * 100, bd.pickShare[k].se * 100, 1) + '% |');
  });
  say('');
  say('关键数：遗物每局 ' + fmtSE(bd.pick.relic.rate, bd.pick.relic.se)
    + ' 张（唯一来源 = 被动段 ' + fmtSE(bd.passiveDraws.rate, bd.passiveDraws.se) + ' 次/局 × '
    + (C.SIM_PARAMS.passiveCount || 3) + ' 张）｜技能段含遗物抽卡占比 '
    + fmtSE(bd.relicOffer.rate * 100, bd.relicOffer.se * 100, 1) + '%（两段池下应为 0，回归检查）');
  say('关键条件概率：被动段遗物被选 ' + fmtSE(bd.relicPickGivenOffer.rate * 100, bd.relicPickGivenOffer.se * 100, 1)
    + '%｜技能段同屏有伤害卡时遗物被选 ' + (bd.relicWithDmgSeen
      ? fmtSE(bd.relicPickWhenDmgShown.rate * 100, bd.relicPickWhenDmgShown.se * 100, 1) + '%'
      : '—（技能段已无遗物）'));
  say('拥挤指标：技能段四张全是伤害卡的抽卡占比 ' + fmtSE(bd.allDmg.rate * 100, bd.allDmg.se * 100, 1) + '%');
  say('空转指标：伤害卡每局被选 ' + fmtSE(bd.pick.dmg.rate, bd.pick.dmg.se)
    + ' 张，其中真正换上主/副槽 ' + fmtSE(bd.swaps.rate, bd.swaps.se)
    + ' 次 → 空转 ' + fmtSE(bd.emptyPicks.rate, bd.emptyPicks.se) + ' 张/局');
  say('');
  say('—— 表 2：技能段票型分布（' + mode.label + '｜守拙｜分母 = ' + bd.draws.rate.toFixed(2) + ' 次技能段抽卡/局，SE 按局聚类）——');
  say('| 票型 | 占抽卡 |');
  say('|---|---|');
  bd.shapes.forEach((s) => {
    say('| ' + s.key + ' | ' + fmtSE(s.share, s.se, 1) + '% |');
  });
  say('');
  say('—— 表 3：配额变体（' + mode.label + '，n=' + runs + '/口径，Δ = 同 seed 逐局配对，pp）——');
  say('| 变体 | 最差10层 | Δ10(同口径) | 最差20层 | Δ20(同口径) | 守拙Δ10 | 守拙Δ20 | 技能段非伤害槽占比 | 遗物/局 |');
  say('|---|---|---|---|---|---|---|---|---|');
  m.rows.forEach((r) => {
    const nonDmg = r.draw.slotShare.dmg != null
      ? (1 - r.draw.slotShare.dmg.rate) * 100 : 0;
    say('| ' + r.id + ' | ' + r.worst10.rate.toFixed(1) + '%±' + r.worst10.se.toFixed(1)
      + '（' + r.worst10.profile + '） | ' + fmtD(r.d10w) + ' | '
      + r.worst20.rate.toFixed(1) + '%±' + r.worst20.se.toFixed(1) + ' | ' + fmtD(r.d20w) + ' | '
      + fmtD(r.d10s) + ' | ' + fmtD(r.d20s) + ' | '
      + nonDmg.toFixed(1) + '% | ' + fmtSE(r.draw.pick.relic.rate, r.draw.pick.relic.se) + ' |');
  });
  say('');
  say('—— 表 4：配额 / 评分修复对抽牌结构的影响（' + mode.label + '｜守拙｜Δ = 变体 − 基线，同 seed 逐局配对）——');
  say('| 变体 | 伤害卡被选/局 | 真换槽/局 | 空转率 | Δ遗物被选/局 | 被动段遗物被选率 | 焚卡张数 | 灰烬层数 |');
  say('|---|---|---|---|---|---|---|---|');
  m.rows.forEach((r) => {
    say('| ' + r.id + ' | ' + fmtSE(r.draw.pick.dmg.rate, r.draw.pick.dmg.se)
      + ' | ' + fmtSE(r.draw.swaps.rate, r.draw.swaps.se)
      + ' | ' + fmtSE(r.draw.idleRate.rate * 100, r.draw.idleRate.se * 100, 1) + '%'
      + ' | ' + fmtD(r.deltaRelicPick) + ' | '
      + fmtSE(r.draw.relicPickGivenOffer.rate * 100, r.draw.relicPickGivenOffer.se * 100, 1) + '% | '
      + r.draw.ashBurns.rate.toFixed(2) + ' | ' + r.draw.ashStacks.rate.toFixed(2) + ' |');
  });
  say('');
  if (m.pairs.length) {
    say('—— 表 5：拿掉熔岩地裂的净收益（同规则兄弟变体逐局配对，守拙，pp）——');
    say('| 变体 | 对照 | Δ10 | Δ20 |');
    say('|---|---|---|---|');
    m.pairs.forEach((p) => {
      say('| ' + p.id + ' | ' + p.ref + ' | ' + fmtD(p.d10) + ' | ' + fmtD(p.d20) + ' |');
    });
    say('');
  }
});

/* ---- 落盘 ---- */
const outFile = path.join(__dirname, '..', '.seedwork', 'draw_quota_' + runs + '.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
const logDir = path.join(__dirname, '..', '_archive', '20261109');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'draw_quota_' + runs + '.log');
fs.writeFileSync(logFile, L.join('\n') + '\n', 'utf8');
console.log('\n【存档】' + outFile);
console.log('【存档】' + logFile);
