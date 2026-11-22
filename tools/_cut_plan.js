/**
 * 回削方案验证（v1 两段池之后的「削 13pp」候选扫描 + A/B）
 * ----------------------------------------------------------------------------
 * 目标：把最差 10 层从 51.3% 拉回 36–38、F20 从 43.4% 压到 ≤35，
 *       同时盯住「空转率」与「拿掉熔岩反而更好」这两条结构指标是否收窄。
 *
 * 约束：
 *   · 主文件 index_arcane_v2.html 零改动；sim.js / config.js 也零改动。
 *   · 每个变体都在 .seedwork/ 下生成独立的 sim + config 副本，互不污染。
 *   · 只改「可验证的旋钮」：敌人血量倍率、玩家卡面伤害、首领血量上限、池配比（仅作违反 parity 的对照）。
 *
 * 用法：
 *   node tools/_cut_plan.js --runs 1200                 # 灵敏度扫描
 *   node tools/_cut_plan.js --runs 4000 --set=final     # 最终 A/B
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'sim_panel');
const BASE_CFG = require(path.join(DIR, 'config.js'));
const SIM_PATH = path.join(DIR, 'sim.js');
const LIVE_HTML = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT_DIR = path.join(__dirname, '..', '.seedwork');
const LOG_DIR = path.join(__dirname, '..', '_archive', '20261109');

/* ---------------------------------------------------------------------------
 * S 批卡表（config.js 里没有，和 _card_marginal / s_visibility / _draw_quota 完全一致）
 * 目的：让本脚本的 base 与「51.3% 基线」同尺，否则削出的 pp 与报告对不上。
 * ------------------------------------------------------------------------- */
const EXTRA_CARDS = [
  { id: 'pulseShock', name: '斥力脉冲', cost: 30, cooldown: 3.4, damage: 26, aoe: true,  tag: '范围', minFloor: 4, rarity: 'rare' },
  { id: 'pierceLance', name: '贯流长枪', cost: 30, cooldown: 3.6, damage: 38, aoe: true,  tag: '贯穿', minFloor: 5, rarity: 'rare' },
  { id: 'skyfall',     name: '天陨',     cost: 50, cooldown: 6.0, damage: 78, aoe: true,  tag: '范围', minFloor: 6, rarity: 'epic' },
  { id: 'hammer',      name: '符文重锤', cost: 34, cooldown: 3.0, damage: 52, aoe: false, tag: '单体', minFloor: 4, rarity: 'rare' },
  { id: 'brand',       name: '灼痕烙印', cost: 23, cooldown: 1.4, damage: 36, aoe: false, tag: '灼烧', minFloor: 4, rarity: 'common', segments: 3 },
  { id: 'ward',        name: '护身符阵', cost: 24, cooldown: 5.0, damage: 0,  heal: 12, aoe: false, tag: '守护', minFloor: 4, rarity: 'common', shield: 5.0 },
  { id: 'riftStep',    name: '折跃步',   cost: 18, cooldown: 5.0, damage: 12, aoe: false, tag: '位移', minFloor: 5, rarity: 'rare' },
  { id: 'frostSeal',   name: '霜封印',   cost: 26, cooldown: 4.0, damage: 20, aoe: true,  tag: '控制', minFloor: 5, rarity: 'rare' }
];
const S_IDS = ['pulseShock', 'pierceLance', 'skyfall', 'hammer', 'brand', 'ward'];

/**
 * 给一份 config 副本注入 S 批卡并应用「s1r 采纳版」调整
 * @param {object} cfg 可写的 config 副本
 * @returns {void}
 */
function applyS1r(cfg) {
  EXTRA_CARDS.forEach((card) => {
    if (!cfg.MAGIC.some((m) => m.id === card.id)) cfg.MAGIC.push(JSON.parse(JSON.stringify(card)));
  });
  const brand = cfg.MAGIC.find((m) => m.id === 'brand');
  if (brand) brand.damage = 36 * 3;               // 模拟器只算 1 段，按主文件 3 段等效总伤计
  const ward = cfg.MAGIC.find((m) => m.id === 'ward');
  if (ward) ward.shield = 5.0;
  S_IDS.forEach((id) => {                          // S 批提前到 3 层可见
    const m = cfg.MAGIC.find((x) => x.id === id);
    if (m) m.minFloor = 3;
  });
  const rif = cfg.MAGIC.find((x) => x.id === 'riftStep');
  if (rif) rif.minFloor = 3;
}

/**
 * 文件 MD5（大写）
 * @param {string} file 绝对路径
 * @returns {string} 32 位十六进制
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 读 --runs（默认 1200）
 * @returns {number} 每口径局数
 */
function readRuns() {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 1200;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1200;
}

/**
 * 读 --set（sweep / final），同时支持 `--set final` 与 `--set=final` 两种写法
 * @returns {string} 变体集
 */
function readSet() {
  const eq = process.argv.find((s) => s.startsWith('--set='));
  if (eq) return eq.slice('--set='.length);
  const i = process.argv.indexOf('--set');
  return i >= 0 ? String(process.argv[i + 1]) : 'sweep';
}

/**
 * 读 --only（按 id 子串过滤，便于单点对撞），同时支持 `--only x` 与 `--only=x`
 * @returns {string|null} 过滤词
 */
function readOnly() {
  const eq = process.argv.find((s) => s.startsWith('--only='));
  if (eq) return eq.slice('--only='.length);
  const i = process.argv.indexOf('--only');
  return i >= 0 ? String(process.argv[i + 1]) : null;
}

/**
 * 单次字符串替换，命中数必须为 1
 * @param {string} src 源码
 * @param {string} from 原串
 * @param {string} to 新串
 * @returns {string} 新源码
 */
function replaceOnce(src, from, to) {
  const hit = src.split(from).length - 1;
  if (hit !== 1) throw new Error('补丁锚点命中 ' + hit + ' 次（期望 1）：' + from.slice(0, 60));
  return src.replace(from, to);
}

/**
 * 深拷贝纯数据 config（config.js 只有 module.exports，无函数）
 * @param {object} obj 原对象
 * @returns {object} 副本
 */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 组装一个变体：写独立 config + sim 副本，返回可直接 require 的模块
 * @param {object} v 变体定义 {id, hpMul, bossHpMul, magicMul, cfgEdit, banLava, scoreFix}
 * @returns {object} 模拟器模块
 */
function buildSim(v) {
  const cfg = clone(BASE_CFG);
  /* 0) 先注入 S 批卡 + s1r 调整：保证 base 与「51.3% 基线」同尺 */
  applyS1r(cfg);
  /* 1) 卡面伤害倍率（只改 damage，不改 value：用来验证「实削」而不是「改评分」） */
  if (v.magicMul) {
    const all = v.magicMul.__all || 1;
    cfg.MAGIC.forEach((m) => {
      const f = v.magicMul[m.id] != null ? v.magicMul[m.id] : all;
      if (f !== 1 && m.damage > 0) m.damage = +(m.damage * f).toFixed(4);
    });
  }
  /* 2) 其它 config 改动（首领 hpCap、池配比等） */
  if (v.cfgEdit) v.cfgEdit(cfg);

  const cfgPath = path.join(OUT_DIR, '.cfg_cut_' + v.id + '.js');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(cfgPath, 'module.exports = ' + JSON.stringify(cfg) + ';\n', 'utf8');

  let src = fs.readFileSync(SIM_PATH, 'utf8');
  src = src.replace("require('./config')", 'require(' + JSON.stringify(cfgPath) + ')');

  /* 3) 抽卡日志：stage / 候选 / 选中；并记录当前层（minFloor 闸门要用） */
  src = replaceOnce(src,
    '  const p = createPlayer(profile, ov);',
    '  const p = createPlayer(profile, ov);\n'
    + '  p.__auditFloor = 1;\n  p.__drawLog = [];\n  p.__slotLog = [];');

  src = replaceOnce(src,
    '  if (!pool.length) return null;',
    '  if (!pool.length) {\n'
    + '    if (p.__drawLog) p.__drawLog.push({ stage: stage || \'skill\', empty: true });\n'
    + '    return null;\n'
    + '  }');

  /* 3b) 「修模型」补丁集 —— 与 _draw_quota / _card_marginal / s_visibility 完全一致。
     没有这一组，后期存活会被低估 17pp（F20 27.7% vs 45.1%），基线就不是 51.3 那把尺。 */
  src = replaceOnce(src,
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {',
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {\n    p.__auditFloor = floor;');
  src = replaceOnce(src,
    'function skillPool(p) {',
    'function skillPool(p) {\n  const __fl = (p && p.__auditFloor) || 1;');
  src = replaceOnce(src,
    '  C.MAGIC.forEach((m) => {\n    if (p.magics.includes(m.id)) return;',
    '  C.MAGIC.forEach((m) => {\n    if (p.magics.includes(m.id)) return;\n'
    + '    if (m.minFloor && __fl < m.minFloor) return;');
  /* F1：护盾卡单独成类（否则 ward 被当成治疗卡，模型与实机不一致） */
  src = replaceOnce(src,
    '    const isHeal = m.damage <= 0;',
    '    if (m.shield > 0) {\n'
    + '      if (p.hasWard) return;\n'
    + '      options.push({ kind: \'magic\', id: m.id, name: m.name, value: 0.02, survival: 0.16, data: m });\n'
    + '      return;\n'
    + '    }\n'
    + '    const isHeal = m.damage <= 0;');
  /* F1b：位移卡固定价值；其余伤害卡走 damageCardValue */
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
  /* F4：静态乘区（ward 承伤 ×0.85、riftStep 承伤 ×0.93） */
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

  /* 4) 熔岩禁令（只在技能段池里生效） */
  if (v.banLava) {
    src = replaceOnce(src,
      'function skillPool(p) {',
      'function skillPool(p) {\n  const __banLava = true;');
    src = replaceOnce(src,
      '    if (p.magics.includes(m.id)) return;',
      '    if (p.magics.includes(m.id)) return;\n    if (__banLava && m.id === \'lavaFissure\') return;');
  }

  /* 5) 「应用选项」块：记录每次魔法卡是否真的换了槽（空转口径的唯一来源），
        并在这里一并做槽位规则实验（v.slotRule，只测不改）。
        R1 groupMain：主槽除了看 singleDps，也接受 groupEff 更高的卡
        R2 effSwap  ：主槽/副槽指标互换（主槽按 groupEff、副槽按 singleDps）
        R3 thirdSlot：主/副槽都输时，允许进第三槽（按副槽折扣结算，见 patch 5b） */
  let swapCond = 'singleDps(m.id) > singleDps(p.magics[0])';
  let secondCond = 'groupEff(m.id) > groupEff(p.magics[1])';
  let extraSlot = '';
  if (v.slotRule === 'groupMain') {
    swapCond += ' || groupEff(m.id) > groupEff(p.magics[0])';
  } else if (v.slotRule === 'effSwap') {
    swapCond = 'groupEff(m.id) > groupEff(p.magics[0])';
    secondCond = 'singleDps(m.id) > singleDps(p.magics[1])';
  } else if (v.slotRule === 'thirdSlot') {
    extraSlot = '\n    } else if (p.magics.length >= 2 && groupEff(m.id) > groupEff(p.magics[2] || \'\')) {\n'
      + '      p.magics[2] = m.id;\n'
      + '      __swapped = true;';
  }
  src = replaceOnce(src,
    '    if (singleDps(m.id) > singleDps(p.magics[0])) {\n'
    + '      p.magics[1] = p.magics[0];\n'
    + '      p.magics[0] = m.id;\n'
    + '    } else if (groupEff(m.id) > groupEff(p.magics[1])) {\n'
    + '      p.magics[1] = m.id;\n'
    + '    }',
    '    let __swapped = false;\n'
    + '    if (' + swapCond + ') {\n'
    + '      p.magics[1] = p.magics[0];\n'
    + '      p.magics[0] = m.id;\n'
    + '      __swapped = true;\n'
    + '    } else if (' + secondCond + ') {\n'
    + '      p.magics[1] = m.id;\n'
    + '      __swapped = true;' + extraSlot + '\n'
    + '    }\n'
    + '    if (p.__slotLog) p.__slotLog.push(__swapped);');

  /* 5a) 有效性判定必须跟着槽位规则一起改：否则模型会把「能进新槽」的卡当成空卡（-1e9） */
  if (v.slotRule === 'groupMain') {
    src = replaceOnce(src,
      '  return singleDps(m.id) > singleDps(p.magics[0])\n    || groupEff(m.id) > groupEff(p.magics[1]);',
      '  return singleDps(m.id) > singleDps(p.magics[0])\n    || groupEff(m.id) > groupEff(p.magics[1])\n'
      + '    || groupEff(m.id) > groupEff(p.magics[0]);');
  } else if (v.slotRule === 'effSwap') {
    src = replaceOnce(src,
      '  return singleDps(m.id) > singleDps(p.magics[0])\n    || groupEff(m.id) > groupEff(p.magics[1]);',
      '  return groupEff(m.id) > groupEff(p.magics[0])\n    || singleDps(m.id) > singleDps(p.magics[1]);');
  } else if (v.slotRule === 'thirdSlot') {
    src = replaceOnce(src,
      '  return singleDps(m.id) > singleDps(p.magics[0])\n    || groupEff(m.id) > groupEff(p.magics[1]);',
      '  return singleDps(m.id) > singleDps(p.magics[0])\n    || groupEff(m.id) > groupEff(p.magics[1])\n'
      + '    || (p.magics.length >= 2 && groupEff(m.id) > groupEff(p.magics[2] || \'\'));');
    /* 5b) 第三槽按副槽折扣结算（不额外加成，避免变成纯数值膨胀） */
    src = replaceOnce(src,
      '    const slotDamage = slot === 1 ? C.DUAL.secondaryDamage : 1;',
      '    const slotDamage = slot >= 1 ? C.DUAL.secondaryDamage : 1;');
    src = replaceOnce(src,
      '    const slotCd = slot === 1 ? C.DUAL.secondaryCooldown : 1;',
      '    const slotCd = slot >= 1 ? C.DUAL.secondaryCooldown : 1;');
    src = replaceOnce(src,
      '    const slotCost = slot === 1 ? C.DUAL.secondaryCost : 1;',
      '    const slotCost = slot >= 1 ? C.DUAL.secondaryCost : 1;');
  }

  /* 6) 抽卡日志本体 */
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

  /* 7a) 反向打桩：还原成「未修复」的旧式打分。
     只用于量化修复本身的贡献（E 难度不变、只切评分），永不落地。 */
  if (v.unscoreFix) {
    src = replaceOnce(src,
      '  const score = (o) => (optionEffective(p, o) ? 1 : -1e9) * (o.value * bias.value + o.survival * bias.survival);',
      '  const score = (o) => o.value * bias.value + o.survival * bias.survival;');
  }
  /* 7) 评分修复（可选）：sim.js 已经内置该修复时自动跳过，避免锚点失效报错 */
  if (v.scoreFix && !src.includes('(optionEffective(p, o) ? 1 : -1e9)')) {
    src = replaceOnce(src,
      '  const score = (o) => o.value * bias.value + o.survival * bias.survival;',
      '  const score = (o) => (optionEffective(p, o) ? 1 : -1e9) * (o.value * bias.value + o.survival * bias.survival);');
  }

  /* 8) 结果附加日志 */
  src = replaceOnce(src,
    '  result.ashDeck = (p.deck || []).length;\n  return result;',
    '  result.ashDeck = (p.deck || []).length;\n'
    + '  result.__drawLog = p.__drawLog || [];\n'
    + '  result.__slotLog = p.__slotLog || [];\n  return result;');

  const simPath = path.join(OUT_DIR, '.sim_cut_' + v.id + '.js');
  fs.writeFileSync(simPath, src, 'utf8');
  delete require.cache[simPath];
  return require(simPath);
}

const PROFILES = [
  { name: '中性', spec: { magics: ['fireball', 'frost'] } },
  { name: '守拙', spec: { hpPct: 0.04, magics: ['fireball', 'frost'] } },
  { name: '疾火', spec: { hpFlat: -5, damageMul: 1.08, magics: ['fireball', 'frost'] } },
  { name: '观星', spec: { regenBonus: 1.0, magics: ['fireball', 'frost'] } }
];

/** 伤害卡 id 集合（damage > 0），用于区分「真换槽」与「治疗/功能卡」 */
const DMG_SET = {};
clone(BASE_CFG).MAGIC.forEach((m) => { if (m.damage > 0) DMG_SET[m.id] = true; });
EXTRA_CARDS.forEach((m) => { if (m.damage > 0) DMG_SET[m.id] = true; });

/** 二项比例与 SE（百分比） */
function rateSe(arr) {
  const n = arr.length;
  const p = arr.reduce((s, x) => s + x, 0) / n;
  return { rate: p * 100, se: Math.sqrt(p * (1 - p) / n) * 100 };
}

/** 跨局均值与 SE */
function meanSe(arr) {
  const n = arr.length;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) { s += arr[i]; s2 += arr[i] * arr[i]; }
  const m = s / n;
  return { rate: m, se: Math.sqrt(Math.max(0, s2 / n - m * m) / n) };
}

/**
 * 跑一个变体：四口径 × runs × 两烧稿变体
 * @param {object} v 变体
 * @param {number} runs 每口径局数
 * @param {number} ashHp 焚稿血量代价
 * @returns {object} {ash006:{...}, noash:{...}}
 */
function runVariant(v, runs, ashHp) {
  const SIM = buildSim(v);
  const modes = [
    { key: 'ash006', ash: { enabled: true, hpCostPct: ashHp } },
    { key: 'noash', ash: { enabled: false } }
  ];
  const out = {};
  modes.forEach((mode) => {
    const per = {};
    PROFILES.forEach((prof) => {
      const f10 = new Array(runs);
      const f20 = new Array(runs);
      const floors = new Array(runs);
      const idle = new Array(runs);
      const idleN = new Array(runs);      // 每局空转次数（会随抽卡次数变，只作参考）
      const idleAll = new Array(runs);    // 真口径：空转占「技能段全部选卡」的比例
      const pickAll = new Array(runs);    // 每局全部实际选卡次数（含被动段，仅参考）
      const pickSkill = new Array(runs);  // 每局技能段实际选卡次数（真口径分母）
      const dmgPick = new Array(runs);
      const relic = new Array(runs);
      for (let i = 0; i < runs; i += 1) {
        /* 只在变体真的需要时传难度覆盖：sim 把「字段存在」当成显式覆盖，
           传 1 也可能走不同分支（之前 base 47.8 vs 52.9 的差就出在这）。 */
        const ov = {
          charSpec: Object.assign({}, prof.spec),
          ash: Object.assign({}, mode.ash)
        };
        if (v.hpMul && v.hpMul !== 1) ov.hpMul = v.hpMul;
        /* bossHpMul 已废弃（被 hpCap 夹死，传值会直接抛错），此脚本不再透传 */
        const r = SIM.runOne(BASE_CFG.SIM_PARAMS.baseSeed + i, BASE_CFG.PROFILES.bot, 'normal', ov);
        f10[i] = r.clearedFloors >= 10 ? 1 : 0;
        f20[i] = r.clearedFloors >= BASE_CFG.SIM_PARAMS.maxFloor ? 1 : 0;
        floors[i] = r.clearedFloors;
        let dp = 0;
        (r.__drawLog || []).forEach((e) => {
          if (e.empty || e.stage === 'passive') return;
          /* 只统计「伤害卡」被选：治疗/护盾/位移不属于换槽口径，会把空转率算高 */
          if (e.chosenKind === 'magic' && e.chosen && DMG_SET[e.chosen]) dp += 1;
        });
        dmgPick[i] = dp;
        const sw = (r.__slotLog || []).filter(Boolean).length;
        idle[i] = dp > 0 ? (dp - sw) / dp : 0;
        idleN[i] = Math.max(0, dp - sw);
        /* 全部实际选卡：chosen 非空即算一次（空池 allDud 的抽卡不算） */
        pickAll[i] = (r.__drawLog || []).filter((e) => !e.empty && e.chosen).length;
        /* 真口径分母：技能段实际选卡（被动段只出遗物，不可能空转，计入会稀释比例） */
        pickSkill[i] = (r.__drawLog || []).filter((e) => !e.empty && e.chosen && e.stage !== 'passive').length;
        idleAll[i] = pickSkill[i] > 0 ? idleN[i] / pickSkill[i] : 0;
        relic[i] = Object.keys(r.relics || {}).reduce((s, k) => s + r.relics[k], 0);
      }
      per[prof.name] = { f10, f20, floors, idle, idleN, idleAll, pickAll, pickSkill, dmgPick, relic };
    });
    out[mode.key] = per;
  });
  return out;
}

/** 四口径最差通关率 */
function worstOf(per, key) {
  let best = null;
  PROFILES.forEach((p) => {
    const v = rateSe(per[p.name][key]);
    if (!best || v.rate > best.rate) best = { rate: v.rate, se: v.se, profile: p.name };
  });
  return best;
}

/** 守拙口径的均值指标 */
function shou(per, key) {
  return meanSe(per['守拙'][key]);
}

/* ---------------------------- 变体集 ---------------------------- */
const SWEEP = [
  { id: 'base' },
  { id: 'hp10', hpMul: 1.10 },
  { id: 'hp20', hpMul: 1.20 },
  { id: 'hp35', hpMul: 1.35 },
  { id: 'hp50', hpMul: 1.50 },
  { id: 'hp80', hpMul: 1.80 },
  { id: 'fire085', magicMul: { fireball: 0.85 } },
  { id: 'fire070', magicMul: { fireball: 0.70 } },
  { id: 'trap085', magicMul: { lavaFissure: 0.85, collapseHole: 0.85, mine: 0.85 } },
  { id: 'mag90', magicMul: { __all: 0.90 } },
  { id: 'bossCap13', cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.3); } },
  { id: 'bossCap20', cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 2.0); } },
  /* 违反 parity 的对照：只用来量化「结构面还能削多少」，不建议落地 */
  { id: 'x_passive4', cfgEdit: (c) => { c.SIM_PARAMS.passiveEvery = 4; } },
  { id: 'x_skill3', cfgEdit: (c) => { c.SIM_PARAMS.skillCount = 3; } }
];

const FINAL_SWEEP_IDS = ['base', 'hp35', 'hp80', 'fire085', 'mag90', 'bossCap20'];

/* 焚稿灼身代价：必须锚定 ASH_CONFIG 块内的 hpCostPct。
   直接用 /hpCostPct:\s*([0-9.]+)/ 会抓到文件里另一处 0.08，导致焚稿变体偏难 5pp。 */
const ashHpMatch = fs.readFileSync(LIVE_HTML, 'utf8').match(/var ASH_CONFIG = \{[\s\S]{0,800}?hpCostPct:\s*([0-9.]+)/);
const ashHp = ashHpMatch ? Number(ashHpMatch[1]) : 0.06;
const runs = readRuns();
const set = readSet();

/* A/B 组合：先跑灵敏度，再在 final 集合里加组合与 banLava */
const FINAL = [
  { id: 'base' },
  /* A 路线：难度面「敌人血量」——最平滑，全层等比 */
  { id: 'A_hp160', hpMul: 1.60 },
  { id: 'A_hp165', hpMul: 1.65 },
  { id: 'A_hp170', hpMul: 1.70 },
  /* B 路线：难度面「首领段长」——只压首领，普通层不动 */
  { id: 'B_cap18', cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.8); } },
  { id: 'B_cap20', cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 2.0); } },
  /* C 路线：内容面「全魔法伤害」+ 轻血量，检验能否少动难度 */
  { id: 'C_mag90_hp125', hpMul: 1.25, magicMul: { __all: 0.90 } },
  /* D 路线：内容面「只削起手火球」——火球是唯一吃满面板的卡 */
  { id: 'D_fire078', magicMul: { fireball: 0.78 } },
  /* 熔岩复测：基线与「选中难度」下各拿掉一次，看反向是否收窄 */
  { id: 'base_banLava', banLava: true },
  { id: 'A_hp165_banLava', hpMul: 1.65, banLava: true },
  { id: 'B_cap20_banLava', banLava: true, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 2.0); } },
  /* E 路线：温和混合——普通层轻加压 + 首领适度加长，避免「全场变硬」或「首领成墙」 */
  { id: 'E_hp115_cap13', hpMul: 1.15, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.3); } },
  { id: 'E_hp120_cap12', hpMul: 1.20, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.2); } }
];

/* 组合落地实测：第二轮削已写进 config（enemyHpMul 1.5525 / hpCap 8320），
   评分修复已经写进 sim.js。这里跑四格：评分修复 开/关 × 熔岩 禁/放。
   判定线：最差 10 层 37.0–38.5%、最差 F20 ≤35%。 */
const BATCH = [
  { id: 'F_final' },
  { id: 'F_final_banLava', banLava: true },
  { id: 'F_final_noscore', unscoreFix: true },
  { id: 'F_final_noscore_banLava', unscoreFix: true, banLava: true }
];

/* 槽位规则实验（只测不改）：每条规则各跑「放熔岩 / 禁熔岩」，
   用 banLava 的 Δ 衡量该规则还能不能把「拿掉高价值卡反而更好」压下去。
   当前规则（S_final）的 Δ 约 +1.45（焚稿）/ +1.00（无焚稿）。 */
const SLOT = [
  { id: 'S_final' },
  { id: 'S_final_banLava', banLava: true },
  { id: 'S_R1_groupMain', slotRule: 'groupMain' },
  { id: 'S_R1_groupMain_banLava', slotRule: 'groupMain', banLava: true },
  { id: 'S_R2_effSwap', slotRule: 'effSwap' },
  { id: 'S_R2_effSwap_banLava', slotRule: 'effSwap', banLava: true },
  { id: 'S_R3_thirdSlot', slotRule: 'thirdSlot' },
  { id: 'S_R3_thirdSlot_banLava', slotRule: 'thirdSlot', banLava: true }
];

/* 第二轮削（评分修复后组合仍 49.4%，两线都破）：
   在已落地的 E（enemyHpMul 1.035 / hpCap 4160）之上继续加压。
   cap 倍率作用在 4160 上；hp 倍率只乘非首领。目标：最差10层 37.0–38.5、F20 ≤35。 */
const CUT2 = [
  /* 参照行：当前已落地状态（E + 评分修复），后面所有 Δ 都相对它 */
  { id: 'F_current' },
  { id: 'F_hp120', hpMul: 1.20 },
  { id: 'F_hp135', hpMul: 1.35 },
  { id: 'F_hp150', hpMul: 1.50 },
  { id: 'F_cap15', cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.5); } },
  { id: 'F_cap20', cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 2.0); } },
  { id: 'F_hp120_cap15', hpMul: 1.20, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.5); } },
  { id: 'F_hp125_cap16', hpMul: 1.25, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.6); } },
  { id: 'F_hp135_cap15', hpMul: 1.35, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.5); } },
  /* 细化：hp135_cap15 的 10 层 38.2 达标，但 F20 35.6 略破 → 再压 0.05~0.10 */
  { id: 'F_hp140_cap15', hpMul: 1.40, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.5); } },
  { id: 'F_hp142_cap15', hpMul: 1.42, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.5); } },
  { id: 'F_hp145_cap15', hpMul: 1.45, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 1.5); } },
  /* cap×2.0 在 F20 上比 ×1.5 更有效、10 层代价几乎相同（44.5 vs 44.8），换上限重试 */
  { id: 'F_hp140_cap20', hpMul: 1.40, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 2.0); } },
  { id: 'F_hp142_cap20', hpMul: 1.42, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 2.0); } },
  /* n=4000 复核：hp140_cap20 = 38.6/35.8（焚稿）、38.4/35.3（无），两线都差一点 */
  { id: 'F_hp150_cap20', hpMul: 1.50, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 2.0); } },
  { id: 'F_hp150_cap20_banLava', hpMul: 1.50, banLava: true, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 2.0); } },
  { id: 'F_hp155_cap20', hpMul: 1.55, cfgEdit: (c) => { c.BOSS.hpCap = Math.round(c.BOSS.hpCap * 2.0); } }
];

const variants = (() => {
  const all = set === 'final' ? FINAL
    : set === 'batch' ? BATCH
      : set === 'cut2' ? CUT2
        : set === 'slot' ? SLOT : SWEEP;
  const only = readOnly();
  if (!only) return all;
  const hit = all.filter((v) => v.id.indexOf(only) >= 0);
  return hit.length ? hit : all;
})();

const L = [];
/** 写一行到控制台与缓冲 */
function say(s) { L.push(s); console.log(s); }

say('');
say('══════════════════════════════════════════════════════════════════');
say('【回削方案】sim ' + md5Of(SIM_PATH) + '｜config ' + md5Of(path.join(DIR, 'config.js')));
say('【回削方案】主文件 ' + md5Of(LIVE_HTML) + '｜变体集=' + set + '｜n=' + runs + ' 局/口径 × 4 口径 × 2 烧稿变体');
say('【回削方案】卡表口径 = s1r 采纳版（config 12 卡 + S/P0 8 卡 + brand 3 段 108 伤 + S 卡 minFloor=3）');
say('══════════════════════════════════════════════════════════════════');

const results = [];
variants.forEach((v) => {
  const t0 = Date.now();
  const r = runVariant(v, runs, ashHp);
  results.push({ v, r });
  const w = worstOf(r.ash006, 'f10');
  say('  [' + v.id + '] 焚稿最差 10 层 ' + w.rate.toFixed(1) + '%±' + w.se.toFixed(1)
    + '（' + w.profile + '）  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
});

/** 打印一张表：一个烧稿变体 */
function table(modeKey, label) {
  say('');
  say('—— ' + label + '｜n=' + runs + '/口径｜分母：每格 ' + runs + ' 局 ——');
  say('| 变体 | 最差10层 | 最差F20 | 均层(守拙) | 空转/技能选卡(真) | 空转次数/局 | 技能选卡/局 | 伤害卡/局 | 遗物/局 | Δ10 vs base |');
  say('|---|---|---|---|---|---|---|---|---|---|');
  const base = results[0];
  results.forEach(({ v, r }) => {
    const per = r[modeKey];
    const w10 = worstOf(per, 'f10');
    const w20 = worstOf(per, 'f20');
    const fl = shou(per, 'floors');
    /* 真口径：空转占技能段全部选卡的比例；单报「每局次数」会被抽卡次数稀释 */
    const idle = shou(per, 'idleAll');
    const idleN = shou(per, 'idleN');
    const ps = shou(per, 'pickSkill');
    const dp = shou(per, 'dmgPick');
    const rel = shou(per, 'relic');
    let d10 = '—';
    /* Δ10 的参照永远是「本表第一行」，不依赖变体名叫 base */
    if (base !== undefined && v.id !== base.v.id) {
      const a = per['守拙'].f10;
      const b = base.r[modeKey]['守拙'].f10;
      let s = 0; let s2 = 0;
      const n = a.length;
      for (let i = 0; i < n; i += 1) { const d = (a[i] - b[i]) * 100; s += d; s2 += d * d; }
      const m = s / n;
      const se = Math.sqrt(Math.max(0, s2 / n - m * m) / n);
      d10 = (m >= 0 ? '+' : '') + m.toFixed(2) + '±' + se.toFixed(2);
    }
    say('| ' + v.id + ' | ' + w10.rate.toFixed(1) + '%±' + w10.se.toFixed(1) + '（' + w10.profile + '）'
      + ' | ' + w20.rate.toFixed(1) + '%±' + w20.se.toFixed(1)
      + ' | ' + fl.rate.toFixed(3) + '±' + fl.se.toFixed(3)
      + ' | ' + (idle.rate * 100).toFixed(1) + '%±' + (idle.se * 100).toFixed(1) + '%'
      + ' | ' + idleN.rate.toFixed(2) + '±' + idleN.se.toFixed(2)
      + ' | ' + ps.rate.toFixed(2) + '±' + ps.se.toFixed(2)
      + ' | ' + dp.rate.toFixed(2) + '±' + dp.se.toFixed(2)
      + ' | ' + rel.rate.toFixed(2) + '±' + rel.se.toFixed(2)
      + ' | ' + d10 + ' |');
  });
}

table('ash006', '焚稿 0.06 线上');
table('noash', '无焚稿');

say('');
say('【判定线】10 层 37.0–38.5% 且 F20 ≤35%（取最差口径）');

const outFile = path.join(OUT_DIR, 'cut_plan_' + set + '_' + runs + '.json');
fs.writeFileSync(outFile, JSON.stringify({
  ts: new Date().toISOString(),
  runs,
  set,
  fingerprints: { sim: md5Of(SIM_PATH), config: md5Of(path.join(DIR, 'config.js')), html: md5Of(LIVE_HTML) },
  variants: results.map(({ v, r }) => {
    const o = { id: v.id, hpMul: v.hpMul || 1, unscoreFix: !!v.unscoreFix, magicMul: v.magicMul || null, banLava: !!v.banLava };
    ['ash006', 'noash'].forEach((k) => {
      const w10 = worstOf(r[k], 'f10');
      const w20 = worstOf(r[k], 'f20');
      o[k] = {
        worst10: w10, worst20: w20,
        floors: shou(r[k], 'floors'),
        idle: shou(r[k], 'idle'),        // 旧口径：空转/伤害卡被选
        idleAll: shou(r[k], 'idleAll'),  // 真口径：空转/技能段选卡
        idleN: shou(r[k], 'idleN'),      // 每局空转次数
        pickSkill: shou(r[k], 'pickSkill'),
        dmgPick: shou(r[k], 'dmgPick'), relic: shou(r[k], 'relic')
      };
    });
    return o;
  })
}, null, 2));
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, 'cut_plan_' + set + '_' + runs + '.log');
fs.writeFileSync(logFile, L.join('\n') + '\n', 'utf8');
console.log('\n【存档】' + outFile);
console.log('【存档】' + logFile);
