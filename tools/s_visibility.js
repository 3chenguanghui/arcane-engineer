/**
 * S 批可见性实验：修前 / 修后 / S1 / S2 / S3 同口径对照
 * ----------------------------------------------------------------------------
 * 背景（来自 draw_audit 8000 局体检）：
 *   · 平均只有 5.79 次升级、3.57 张牌，前 3 层只拿到 1.98 张不同的牌
 *   · 70.3% 的局一张 S 批都没见到
 *   · 护身符阵 2.6%（被当成治疗卡，被 hasHeal 门控挡在池外）
 *   · 折跃步 6.2%（纯功能卡，纯伤害估值必然垫底）
 *   · 灼痕烙印 8.8%（主文件 3 段，模拟器只算 1 段）
 *
 * 本脚本做三件事：
 *   1. 修模型估值（只在 .seedwork 的临时副本里改，sim.js / config.js 零改动）
 *   2. 跑「修前 / 修后」两组，并列每张牌获得率、零 S 比例、四口径通关率
 *   3. 跑 S1 / S2 / S3 三个可见性方案，各 2000 局/口径，只报数不选
 *
 * 三个方案：
 *   S1 = 把 S 批 minFloor 全部提前到 3（池子结构不动）
 *   S2 = F1–5 每层保底一次升级（本层零升级才补），S 批 minFloor 不动
 *   S3 = 保底机制：连续 4 次升级都没出现 S 批选项时，第 4 次强制塞入一张 S 选项
 *        （只是"出现"，不白送；bot 仍按自己的估值决定要不要）
 *
 * 红线不变：10 层 ≤38.5%、F20 ≤35%，任一口径破线直接否掉该方案。
 *
 * 用法：node tools/s_visibility.js [--runs 2000]
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'sim_panel');
const C = require(path.join(DIR, 'config.js'));

/**
 * 算文件 MD5（大写），用于口径头指纹。
 * @param {string} file 绝对路径
 * @returns {string} 32 位大写十六进制
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 读命令行 --runs（默认 2000）。
 * @returns {number} 每口径局数
 */
function readRuns() {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 2000;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

/* ---------------------------------------------------------------------------
 * 1. 卡表补齐（只补进内存，config.js 文件不动）
 * ------------------------------------------------------------------------- */

/* 缺的 8 张：数值照抄主文件卡表（L10286–L10338）。
   ward 这里补上主文件 SKILL_POOL_CONFIG 里的 shield:5.0，修模型时要用。 */
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

/* 分组与判据口径 */
const GROUPS = {
  fireball: '基础', frost: '基础', bolt: '基础', heal: '基础', blade: '基础', mine: '基础',
  lavaFissure: 'A', arcanePool: 'A', runeOrbit: 'A', collapseHole: 'A', flameCone: 'A', frostRing: 'A',
  pulseShock: 'S', pierceLance: 'S', skyfall: 'S', hammer: 'S', brand: 'S', ward: 'S',
  riftStep: 'P0', frostSeal: 'P0'
};
const ALL_IDS = Object.keys(GROUPS);
const S_IDS = ALL_IDS.filter((id) => GROUPS[id] === 'S');
const A_IDS = ALL_IDS.filter((id) => GROUPS[id] === 'A');
const STARTERS = ['fireball', 'frost'];

/* ---------------------------------------------------------------------------
 * 2. 模拟器临时副本：按变体打补丁（sim.js 原文件零改动）
 * ------------------------------------------------------------------------- */

/**
 * 单次字符串替换，命中数必须符合预期，否则立刻报错（防止静默贴错）。
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
 * 生成带补丁的模拟器副本。
 * @param {object} v 变体定义 {id, fix, scheme}
 * @returns {object} 模拟器模块
 */
function buildSim(v) {
  let src = fs.readFileSync(path.join(DIR, 'sim.js'), 'utf8');

  /* --- 基础补丁（所有变体都要，用来记录抽牌日志） --- */

  /* B1：每局初始化日志、当前层、本层升级计数 */
  src = replaceOnce(src,
    '  const p = createPlayer(profile, ov);',
    '  const p = createPlayer(profile, ov);\n'
    + '  p.__drawLog = [];\n  p.__auditFloor = 1;\n  p.__floorLevelUps = 0;\n  p.__sinceS = 0;\n'
    + '  p.__s2On = ' + (v.scheme === 's2') + ';\n  p.__s3On = ' + (v.scheme === 's3') + ';\n'
    + '  p.__wardTakenMul = 0.85;\n  p.__riftTakenMul = 0.93;');

  /* B2：层循环里记录当前层，并把"本层升级计数"清零 */
  src = replaceOnce(src,
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {',
    '  for (let floor = 1; floor <= maxFloor; floor += 1) {\n'
    + '    p.__auditFloor = floor;\n    p.__floorLevelUps = 0;');

  /* B3：optionPool 增加 minFloor 闸门（模拟器原本不读这个字段） */
  src = replaceOnce(src,
    'function optionPool(p) {',
    'function optionPool(p) {\n  const __fl = (p && p.__auditFloor) || 1;');
  src = replaceOnce(src,
    '  C.MAGIC.forEach((m) => {\n    if (p.magics.includes(m.id)) return;',
    '  C.MAGIC.forEach((m) => {\n    if (p.magics.includes(m.id)) return;\n'
    + '    if (m.minFloor && __fl < m.minFloor) return;');

  /* B3b：把指定卡从奖励池里摘掉（只影响"能不能被抽到"，不动卡表与起手） */
  if (v.banId) {
    src = replaceOnce(src,
      '    if (m.minFloor && __fl < m.minFloor) return;',
      '    if (m.id === ' + JSON.stringify(v.banId) + ') return;\n'
      + '    if (m.minFloor && __fl < m.minFloor) return;');
  }

  /* B6：每层插入 N 条"纯文字事件"（不改任何数值；txtRng=true 时故意消耗主 RNG，用来验证扰动） */
  if (v.txtEvents) {
    src = replaceOnce(src,
      '    p.__auditFloor = floor;\n    p.__floorLevelUps = 0;',
      '    p.__auditFloor = floor;\n    p.__floorLevelUps = 0;\n'
      + '    for (let __e = 0; __e < ' + v.txtEvents + '; __e += 1) {\n'
      + '      p.__txtN = (p.__txtN || 0) + 1;\n'
      + (v.txtRng ? '      rng();\n' : '')
      + '    }');
  }

  /* B4：levelUp 内部统一记录（覆盖 gainXp / E1 / S2 全部调用点） */
  src = replaceOnce(src,
    '  applyOption(p, chosen, rng);\n  p.level += 1;\n  if (rec) rec({ choices, effective, chosen, allDud: effective.every((v) => !v) });',
    '  applyOption(p, chosen, rng);\n  p.level += 1;\n'
    + '  if (p.__drawLog) {\n'
    + '    p.__drawLog.push({\n'
    + '      floor: p.__auditFloor || 1,\n'
    + '      chosen: chosen && chosen.kind === \'magic\' ? chosen.id : null,\n'
    + '      choices: choices.map((o) => ({ kind: o.kind, id: o.id }))\n'
    + '    });\n'
    + '    p.__floorLevelUps = (p.__floorLevelUps || 0) + 1;\n'
    + '  }\n'
    + '  if (rec) rec({ choices, effective, chosen, allDud: effective.every((v) => !v) });');

  /* B5：结果带上日志 */
  src = replaceOnce(src,
    '  result.ashDeck = (p.deck || []).length;\n  return result;',
    '  result.ashDeck = (p.deck || []).length;\n  result.__drawLog = p.__drawLog || [];\n  return result;');

  /* --- 模型修复（只有 fix 变体打） --- */
  if (v.fix) {
    /* F0：需求感知的生存权重（只有 after2 打开）。
       纯伤害 bot 在任何局面都按 0.7/0.3 打分，功能卡/防御卡必然垫底；
       玩家不会这样——残血时会先保命。这里只做一件事：血量 <60% 时把生存权重提到 0.55。 */
    if (v.survival) {
      src = replaceOnce(src,
        '  const bias = p.growthBias || { value: 0.7, survival: 0.3 };',
        '  const __hpFrac = p.hpMax > 0 ? p.hp / p.hpMax : 1;\n'
        + '  const bias = p.growthBias\n'
        + '    || (__hpFrac < 0.60 ? { value: 0.45, survival: 0.55 } : { value: 0.7, survival: 0.3 });');
    }
    /* F1：护身符阵单独成类，不再被 hasHeal 门控挡掉；
           折跃步属功能卡，估值里给生存权重而不是伤害权重 */
    src = replaceOnce(src,
      '    const isHeal = m.damage <= 0;',
      '    if (m.shield > 0) {\n'
      + '      if (p.hasWard) return;\n'
      + '      options.push({ kind: \'magic\', id: m.id, name: m.name, value: 0.02, survival: 0.16, data: m });\n'
      + '      return;\n'
      + '    }\n'
      + '    const isHeal = m.damage <= 0;');
    /* 位移卡：伤害只有 12，但给的是"活着"的价值 → 伤害价值下调、生存价值上调，
       综合分 ≈0.071（与纯伤害魔法的 0.073 基本持平，略低于它，保证不会被无脑优先） */
    src = replaceOnce(src,
      '    options.push({ kind: \'magic\', id: m.id, name: m.name, value: 0.10, survival: 0.01, data: m });',
      '    options.push({ kind: \'magic\', id: m.id, name: m.name,\n'
      + '      value: (m.tag === \'位移\' ? 0.05 : 0.10),\n'
      + '      survival: (m.tag === \'位移\' ? 0.12 : 0.01), data: m });');

    /* F2：效果判定——护盾卡只看有没有护盾，位移卡永远"有效" */
    src = replaceOnce(src,
      '  if (m.damage <= 0) return !p.hasHeal;          // 治疗卡：还没有治疗时才生效',
      '  if (m.shield > 0) return !p.hasWard;            // 护盾卡：还没有护盾时才生效\n'
      + '  if (m.tag === \'位移\') return true;              // 位移卡：功能型，永远有用\n'
      + '  if (m.damage <= 0) return !p.hasHeal;          // 治疗卡：还没有治疗时才生效');

    /* F3：应用选项——护盾卡挂 p.hasWard（不占双槽），位移卡挂 p.riftStep */
    src = replaceOnce(src,
      '    if (m.damage <= 0) {\n      p.hasHeal = true;',
      '    if (m.shield > 0) {\n'
      + '      p.hasWard = true;\n'
      + '      p.wardTakenMul = p.__wardTakenMul || 0.85;\n'
      + '      p.wardHeal = m.heal || 12;\n'
      + '      p.wardCd = m.cooldown || 5;\n'
      + '      return;\n'
      + '    }\n'
      + '    if (m.tag === \'位移\') { p.riftStep = true; return; }\n'
      + '    if (m.damage <= 0) {\n      p.hasHeal = true;');

    /* F4：静态乘区——护盾给承伤减免 + 等价回血；位移给小额闪避折算 */
    src = replaceOnce(src,
      '  // 敏感度：回血比例（治疗卡 + 纳米机器人 + 嗜血一起乘）',
      '  // 护身符阵：5 秒减伤阵（模型按 30% 覆盖 × 减半 = 承伤 ×0.85，与力场发生器同档）\n'
      + '  if (p.hasWard) {\n'
      + '    takenMul *= (p.wardTakenMul || 0.85);\n'
      + '    healPerSec += (p.wardHeal || 12) / (p.wardCd || 5) * 0.50 * p.profile.healDiscipline;\n'
      + '  }\n'
      + '  // 折跃步：瞬移躲伤折算成承伤 ×0.93（保守，约力场发生器的一半）\n'
      + '  if (p.riftStep) takenMul *= (p.__riftTakenMul || 0.93);\n'
      + '  // 敏感度：回血比例（治疗卡 + 纳米机器人 + 嗜血一起乘）');

    /* F5：护盾卡也要吃回能（24 点 / 5 秒，与治疗卡同口径折扣） */
    src = replaceOnce(src,
      '  const healUseCost = p.hasHeal ? (p.healAmount > 0 ? 28 / p.healCd * 0.50 * profile.healDiscipline : 0) : 0;',
      '  const healUseCost = (p.hasHeal ? (p.healAmount > 0 ? 28 / p.healCd * 0.50 * profile.healDiscipline : 0) : 0)\n'
      + '    + (p.hasWard ? 24 / (p.wardCd || 5) * 0.50 * profile.healDiscipline : 0);');
  }

  /* --- 方案补丁 --- */
  /* S2 不用源码补丁：改的是 C.XP.baseNeed（见 applyConfig）。
     原因：实测 F1–3 已经每层 1.09 次升级，"前 3 层保底"只能 +0.11，达不到 ~7；
     经验需求降到 87.5% 是单参数、可预测、能稳稳落到 ~7 的杠杆。 */

  if (v.scheme === 's4') {
    /* S4（折中案）：S 批提前到 F3 可见，但要求本局已拿到 ≥2 张 A 批才放行。
       目的是"先有基础强化，再开高级档"，避免新手局开局就被 S 批占坑。 */
    src = replaceOnce(src,
      'function optionPool(p) {\n  const __fl = (p && p.__auditFloor) || 1;',
      'function optionPool(p) {\n  const __fl = (p && p.__auditFloor) || 1;\n'
      + '  const __SID = ' + JSON.stringify(S_IDS) + ';\n'
      + '  const __AID = ' + JSON.stringify(A_IDS) + ';');
    src = replaceOnce(src,
      '    if (m.minFloor && __fl < m.minFloor) return;',
      '    if (m.minFloor) {\n'
      + '      if (__SID.indexOf(m.id) >= 0 && __fl >= 3) {\n'
      + '        const __aGot = (p.deck || []).filter((x) => __AID.indexOf(x) >= 0).length;\n'
      + '        if (__aGot < 2) return;\n'
      + '      } else if (__fl < m.minFloor) return;\n'
      + '    }');
  }

  if (v.scheme === 's3' || v.scheme === 's13') {
    /* S3：连续 4 次升级都没出现 S 批选项 → 第 4 次强制塞一张 S 进候选（只出现，不白送） */
    src = replaceOnce(src,
      '  const choices = shuffle(rng, pool).slice(0, 3);',
      '  const choices = shuffle(rng, pool).slice(0, 3);\n'
      + '  if (p.__s3On) {\n'
      + '    const __SID = ' + JSON.stringify(S_IDS) + ';\n'
      + '    const __hasS = choices.some((o) => o.kind === \'magic\' && __SID.indexOf(o.id) >= 0);\n'
      + '    if (__hasS) {\n'
      + '      p.__sinceS = 0;\n'
      + '    } else {\n'
      + '      p.__sinceS = (p.__sinceS || 0) + 1;\n'
      + '      if (p.__sinceS >= 4) {\n'
      + '        const __sPool = pool.filter((o) => o.kind === \'magic\' && __SID.indexOf(o.id) >= 0 && choices.indexOf(o) < 0);\n'
      + '        if (__sPool.length) {\n'
      + '          choices[2] = __sPool[Math.floor(rng() * __sPool.length)];\n'
      + '          p.__sinceS = 0;\n'
      + '        }\n'
      + '      }\n'
      + '    }\n'
      + '  }');
  }

  /* D4 资源房：sim 里没有 cache 房型分支（未知类型会掉进战斗结算，必须补一段）。
     只挂在 cache 变体的副本上，sim.js 源文件与 MD5 保持不动。 */
  if (v.cachePlan === 'cache') {
    src = replaceOnce(src,
      '      if (room.type === \'event\') {',
      '      if (room.type === \'cache\') {\n'
      + '        // D4 资源房：纯资源、无战斗、不回血；结晶 +2、余烬 +12（奥能 sim 不入账）\n'
      + '        incomeBase += C.ROOM.cacheCrystal;\n'
      + '        p.embers += C.ROOM.cacheEmbers;\n'
      + '        result.cacheRooms = (result.cacheRooms || 0) + 1;\n'
      + '        continue;\n'
      + '      }\n'
      + '      if (room.type === \'event\') {');
  }

  src = src.replace("require('./config')", 'require(' + JSON.stringify(path.join(DIR, 'config.js')) + ')');

  const outDir = path.join(__dirname, '..', '.seedwork');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, '.sim_sv_' + v.id + '.js');
  fs.writeFileSync(outFile, src, 'utf8');
  delete require.cache[outFile];
  return require(outFile);
}

/* ---------------------------------------------------------------------------
 * 3. 变体定义与卡表状态
 * ------------------------------------------------------------------------- */

const VARIANTS = [
  { id: 'before', name: '修前（原模型）',    fix: false, scheme: 'none' },
  { id: 'after',  name: '修后A（门控+卡面）', fix: true,  scheme: 'none' },
  { id: 'after2', name: '修后B（+求生倾向）', fix: true, survival: true, scheme: 'none' },
  { id: 's1',     name: 'S1 minFloor→3',     fix: true,  scheme: 's1' },
  { id: 's1r',    name: 'S1+折跃步→3（采纳）', fix: true, scheme: 's1r' },
  { id: 's2',     name: 'S2 经验需求-12.5%', fix: true,  scheme: 's2' },
  { id: 's3',     name: 'S3 每4次保底出S',   fix: true,  scheme: 's3' },
  { id: 's13',    name: 'S1+S3 折中组合',    fix: true,  scheme: 's13' },
  { id: 's4',     name: 'S4 A批≥2才开S',     fix: true,  scheme: 's4' },
  /* 2026-11-09 承重结论实测：火球移出池 / 纯文字事件 0 税 验证 */
  { id: 's1r_rf', name: '采纳版+火球移出池',      fix: true, scheme: 's1r', banId: 'fireball' },
  { id: 's1r_t7', name: '采纳版+7条纯文字事件',   fix: true, scheme: 's1r', txtEvents: 7 },
  { id: 's1r_t7r', name: '采纳版+7条文字事件(误用主RNG)', fix: true, scheme: 's1r', txtEvents: 7, txtRng: true },
  /* D4 资源房（单独一批）：
     · s1r_rf_c0 = 对照：F6 / F14 第 3 槽定死为宝箱（把"层计划固定"这一项单独隔离出来）
     · s1r_rf_c  = 资源房：同样的槽位换成资源房，其余逐位不变
     两个变体唯一的差别就是那一间房的房型，所以 c0 → c 的差值只归因于资源房。 */
  { id: 's1r_rf_c0', name: '采纳版+火球移出+槽位对照', fix: true, scheme: 's1r', banId: 'fireball', cachePlan: 'chest' },
  { id: 's1r_rf_c',  name: '采纳版+火球移出+资源房',   fix: true, scheme: 's1r', banId: 'fireball', cachePlan: 'cache' }
];

/* 原值备份（config 是 require 共享对象，改完必须还原） */
const CFG_BACKUP = {};
C.MAGIC.forEach((m) => { CFG_BACKUP[m.id] = { minFloor: m.minFloor, damage: m.damage, shield: m.shield }; });
const XP_BACKUP = { baseNeed: C.XP.baseNeed };
/* D4：层计划是按变体临时改写的，跑完必须逐键还原（undefined 也要还原成"没有这一层"） */
const ROOM_PLAN_BACKUP = {};
const CACHE_PLAN_FLOORS = [6, 14];

/**
 * 按变体调整卡表状态（共享 config 对象，跑完必须 restoreConfig）。
 * @param {object} v 变体
 * @returns {void}
 */
function applyConfig(v) {
  if (v.fix) {
    const brand = C.MAGIC.find((m) => m.id === 'brand');
    if (brand) brand.damage = 36 * 3;          // 模拟器只算 1 段，这里按主文件的 3 段等效总伤计入
    const ward = C.MAGIC.find((m) => m.id === 'ward');
    if (ward) ward.shield = 5.0;
  }
  if (v.scheme === 's1' || v.scheme === 's13' || v.scheme === 's1r') {
    S_IDS.forEach((id) => {
      const m = C.MAGIC.find((x) => x.id === id);
      if (m) m.minFloor = 3;                   // S 批全部提前到 F3 起可见（F4 为成熟点）
    });
  }
  if (v.scheme === 's1r') {
    const rif = C.MAGIC.find((x) => x.id === 'riftStep');
    if (rif) rif.minFloor = 3;                 // 采纳版：折跃步随 S 批一起降到 3（消除遗留不一致）
  }
  if (v.scheme === 's2') {
    C.XP.baseNeed = Math.round(XP_BACKUP.baseNeed * 0.875);  // 80 → 70，升级次数约 6.4 → 7.0
  }
  /* D4：把 F6 / F14 第 3 槽按变体定死（对照 = chest，资源房 = cache）。
     不新增任何 rng 调用——只是把 sim 其余层仍在用的随机房型里的这两层改成固定槽。 */
  if (v.cachePlan) {
    CACHE_PLAN_FLOORS.forEach((f) => { ROOM_PLAN_BACKUP[f] = C.ROOM.plan[f]; });
    CACHE_PLAN_FLOORS.forEach((f) => { C.ROOM.plan[f] = ['battle', 'elite', v.cachePlan]; });
    if (v.cachePlan === 'cache') {
      C.ROOM.cacheCrystal = 2;                 // 与主文件 cacheReward.magicCrystal 对齐
      C.ROOM.cacheEmbers = 12;                 // 与主文件 cacheReward.embers 对齐
    }
  }
}

/**
 * 还原卡表原值。
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
  C.XP.baseNeed = XP_BACKUP.baseNeed;         // 经验曲线还原
  CACHE_PLAN_FLOORS.forEach((f) => {
    if (ROOM_PLAN_BACKUP[f] === undefined) delete C.ROOM.plan[f];
    else C.ROOM.plan[f] = ROOM_PLAN_BACKUP[f];
    delete ROOM_PLAN_BACKUP[f];
  });
  delete C.ROOM.cacheCrystal;
  delete C.ROOM.cacheEmbers;
}

/* 四口径：与 p0_probe / stack_matrix 完全一致 */
const PROFILES = [
  { name: '中性', spec: { magics: ['fireball', 'frost'] } },
  { name: '守拙', spec: { hpPct: 0.04, magics: ['fireball', 'frost'] } },
  { name: '疾火', spec: { hpFlat: -5, damageMul: 1.08, magics: ['fireball', 'frost'] } },
  { name: '观星', spec: { regenBonus: 1.0, magics: ['fireball', 'frost'] } }
];

/* ---------------------------------------------------------------------------
 * 4. 跑一个变体
 * ------------------------------------------------------------------------- */

/**
 * 跑一个变体的全部口径，返回汇总。
 * @param {object} v 变体
 * @param {number} runs 每口径局数
 * @returns {object} 汇总
 */
function runVariant(v, runs) {
  const SIM = buildSim(v);
  applyConfig(v);

  const agg = {
    runs: 0, levelUps: 0, draws: 0, dup: 0, f3Distinct: 0, repeatRuns: 0,
    zeroSAcq: 0, zeroSOffer: 0, anySAcq: 0, anySOffer: 0,
    cardAcq: {}, cardOffer: {}, prof: {}
  };
  ALL_IDS.forEach((id) => { agg.cardAcq[id] = 0; agg.cardOffer[id] = 0; });
  PROFILES.forEach((p) => { agg.prof[p.name] = { f10: 0, f20: 0 }; });

  PROFILES.forEach((prof) => {
    for (let i = 0; i < runs; i += 1) {
      const seed = C.SIM_PARAMS.baseSeed + i;
      const r = SIM.runOne(seed, C.PROFILES.bot, 'normal', { charSpec: Object.assign({}, prof.spec) });
      const log = r.__drawLog || [];

      const acq = {};
      const offered = {};
      const f3 = {};
      log.forEach((e) => {
        e.choices.forEach((c) => { if (c.kind === 'magic') offered[c.id] = true; });
        if (e.chosen) {
          acq[e.chosen] = (acq[e.chosen] || 0) + 1;
          if (e.floor <= 3) f3[e.chosen] = true;
        }
      });

      const acqIds = Object.keys(acq);
      const draws = acqIds.reduce((s, id) => s + acq[id], 0);

      agg.runs += 1;
      agg.levelUps += log.length;
      agg.draws += draws;
      agg.dup += draws - acqIds.length;
      agg.f3Distinct += Object.keys(f3).length;
      if (draws - acqIds.length > 0) agg.repeatRuns += 1;
      if (!S_IDS.some((id) => acq[id])) agg.zeroSAcq += 1;
      if (!S_IDS.some((id) => offered[id])) agg.zeroSOffer += 1;
      if (S_IDS.some((id) => acq[id])) agg.anySAcq += 1;
      if (S_IDS.some((id) => offered[id])) agg.anySOffer += 1;

      acqIds.forEach((id) => { if (agg.cardAcq[id] !== undefined) agg.cardAcq[id] += 1; });
      Object.keys(offered).forEach((id) => { if (agg.cardOffer[id] !== undefined) agg.cardOffer[id] += 1; });

      if (r.clearedFloors >= 10) agg.prof[prof.name].f10 += 1;
      if (r.clearedFloors >= C.SIM_PARAMS.maxFloor) agg.prof[prof.name].f20 += 1;
    }
  });

  restoreConfig();
  return agg;
}

/* ---------------------------------------------------------------------------
 * 5. 主流程 + 报表
 * ------------------------------------------------------------------------- */

const runs = readRuns();
const pad = (s, n) => String(s).padEnd(n);
const pct = (n, d) => (n / d * 100);

console.log('【口径头】sim.js MD5 ' + md5Of(path.join(DIR, 'sim.js'))
  + ' | config.js MD5 ' + md5Of(path.join(DIR, 'config.js')));
console.log('【口径头】基线含熔炉房 ON（G1）｜真·全关 = G0');
console.log('【口径头】卡池 20 张（基础6 + A6 + S6 + P0 2，运行时补入内存，config 文件不动）');
console.log('【口径头】脚本补丁：optionPool minFloor 闸门 + 每局抽牌日志（所有变体同一套基础补丁）');
console.log('【口径头】n=' + runs + ' 局/口径 × 4 口径 = ' + (runs * 4) + ' 局/变体 | 档案 bot / 普通');
console.log('【口径头】百分比分母：四口径 10层/F20 = ' + runs + '（单口径）；零S/S获得/火球/升级 = ' + (runs * 4) + '（合计）');
console.log('【口径头】红线 10 层 ≤38.5% 且 F20 ≤35%（取最差口径）；±0.1pp 抖动豁免');

const results = {};
/* --only=a,b：只跑指定变体（单点复核用，避免重跑全部变体） */
const onlyArg = process.argv.find((s) => s.startsWith('--only='));
const onlyIds = onlyArg ? onlyArg.slice('--only='.length).split(',').filter(Boolean) : null;
if (onlyIds) {
  const missing = onlyIds.filter((id) => !VARIANTS.some((v) => v.id === id));
  if (missing.length) throw new Error('未知变体：' + missing.join(','));
}
const ACTIVE = onlyIds ? VARIANTS.filter((v) => onlyIds.includes(v.id)) : VARIANTS;

ACTIVE.forEach((v) => {
  process.stdout.write('  跑 ' + v.name + ' ... ');
  results[v.id] = runVariant(v, runs);
  const a = results[v.id];
  console.log('升级 ' + (a.levelUps / a.runs).toFixed(2) + ' 次/局，零S ' + pct(a.zeroSAcq, a.runs).toFixed(1) + '%');
});

/* ---------- 单点复核模式：只打关键指标 ---------- */
if (onlyIds) {
  console.log('\n【复核表】n=' + runs + '/口径 × 4 = ' + (runs * 4) + ' 局/变体');
  /* 列头带分母：* = 合计（4×n 局）；无标记 = 单口径（n 局）。下方每行数字与列头一一对应。 */
  console.log(pad('变体', 30) + pad('升级*', 7) + pad('零S获*', 8) + pad('零S现*', 8) + pad('S获得*', 8)
    + pad('火球off*', 10) + pad('火球获*', 9) + pad('中性', 12) + pad('守拙', 12) + pad('疾火', 12)
    + pad('观星', 12) + '最差');
  const nAll = 'n=' + (runs * 4);
  const nOne = 'n=' + runs;
  console.log(pad('', 30) + pad(nAll, 7) + pad(nAll, 8) + pad(nAll, 8) + pad(nAll, 8)
    + pad(nAll, 10) + pad(nAll, 9) + pad(nOne, 12) + pad(nOne, 12) + pad(nOne, 12)
    + pad(nOne, 12) + nOne);
  ACTIVE.forEach((v) => {
    const x = results[v.id];
    /* 注意：prof[*].f10 是"单口径"计数，分母必须是单口径局数 runs，不是 x.runs（总局数） */
    const cells = PROFILES.map((p) => pct(x.prof[p.name].f10, runs).toFixed(1) + '/'
      + pct(x.prof[p.name].f20, runs).toFixed(1));
    const worst10 = Math.max(...PROFILES.map((p) => pct(x.prof[p.name].f10, runs)));
    const worst20 = Math.max(...PROFILES.map((p) => pct(x.prof[p.name].f20, runs)));
    const sRate = S_IDS.reduce((s, id) => s + x.cardAcq[id], 0) / x.runs * 100;
    console.log(pad(v.name, 30) + pad((x.levelUps / x.runs).toFixed(2), 7)
      + pad(pct(x.zeroSAcq, x.runs).toFixed(1), 8) + pad(pct(x.zeroSOffer, x.runs).toFixed(1), 8)
      + pad(sRate.toFixed(1), 8) + pad(pct(x.cardOffer.fireball, x.runs).toFixed(1), 10)
      + pad(pct(x.cardAcq.fireball, x.runs).toFixed(1), 9)
      + pad(cells[0], 12) + pad(cells[1], 12) + pad(cells[2], 12) + pad(cells[3], 12)
      + worst10.toFixed(1) + '/' + worst20.toFixed(1));
  });
  console.log('\n【复核表·S 批逐张获得率 %】分母 n=' + (runs * 4) + '（合计）');
  console.log(pad('变体', 30) + S_IDS.map((id) => pad(id, 13)).join(''));
  ACTIVE.forEach((v) => {
    console.log(pad(v.name, 30) + S_IDS.map((id) => pad(pct(results[v.id].cardAcq[id], results[v.id].runs).toFixed(1), 13)).join(''));
  });

  const outOnly = {};
  ACTIVE.forEach((v) => { outOnly[v.id] = results[v.id]; });
  const outTest = path.join(__dirname, '..', '.seedwork', 's_band_test_' + runs + '.json');
  fs.writeFileSync(outTest, JSON.stringify({
    runs,
    md5: { sim: md5Of(path.join(DIR, 'sim.js')), config: md5Of(path.join(DIR, 'config.js')) },
    variants: outOnly
  }, null, 2), 'utf8');
  console.log('\n已存档 ' + outTest);
  process.exit(0);
}

/* ---------- 表 1：修前 / 修后 ---------- */
const b = results.before;
const a = results.after;
const a2 = results.after2;
console.log('\n【表 1】修前 / 修后A / 修后B · 每张牌获得率（%）');
console.log(pad('牌', 12) + pad('批', 6) + pad('minFloor', 10) + pad('修前', 9) + pad('修后A', 9) + pad('修后B', 9) + 'A-B(pp)');
ALL_IDS
  .slice()
  .sort((x, y) => (b.cardAcq[y] - b.cardAcq[x]))
  .forEach((id) => {
    const m = C.MAGIC.find((q) => q.id === id) || {};
    const b1 = pct(b.cardAcq[id], b.runs);
    const a1 = pct(a.cardAcq[id], a.runs);
    const c1 = pct(a2.cardAcq[id], a2.runs);
    const d = c1 - a1;
    console.log(pad((m.name || id), 12) + pad(GROUPS[id], 6) + pad(m.minFloor || 1, 10)
      + pad(b1.toFixed(1), 9) + pad(a1.toFixed(1), 9) + pad(c1.toFixed(1), 9)
      + (d >= 0 ? '+' : '') + d.toFixed(1));
  });

console.log('\n【表 1b】修前 / 修后A / 修后B · 总览与四口径通关率');
console.log(pad('指标', 22) + pad('修前', 12) + pad('修后A', 12) + '修后B');
console.log(pad('平均升级次数', 22) + pad((b.levelUps / b.runs).toFixed(2), 12)
  + pad((a.levelUps / a.runs).toFixed(2), 12) + (a2.levelUps / a2.runs).toFixed(2));
console.log(pad('平均获得张数', 22) + pad((b.draws / b.runs).toFixed(2), 12)
  + pad((a.draws / a.runs).toFixed(2), 12) + (a2.draws / a2.runs).toFixed(2));
console.log(pad('前 3 层不同牌', 22) + pad((b.f3Distinct / b.runs).toFixed(2), 12)
  + pad((a.f3Distinct / a.runs).toFixed(2), 12) + (a2.f3Distinct / a2.runs).toFixed(2));
console.log(pad('重复率', 22) + pad(pct(b.repeatRuns, b.runs).toFixed(1) + '%', 12)
  + pad(pct(a.repeatRuns, a.runs).toFixed(1) + '%', 12) + pct(a2.repeatRuns, a2.runs).toFixed(1) + '%');
console.log(pad('整局零 S（获得）', 22) + pad(pct(b.zeroSAcq, b.runs).toFixed(1) + '%', 12)
  + pad(pct(a.zeroSAcq, a.runs).toFixed(1) + '%', 12) + pct(a2.zeroSAcq, a2.runs).toFixed(1) + '%');
console.log(pad('整局零 S（出现）', 22) + pad(pct(b.zeroSOffer, b.runs).toFixed(1) + '%', 12)
  + pad(pct(a.zeroSOffer, a.runs).toFixed(1) + '%', 12) + pct(a2.zeroSOffer, a2.runs).toFixed(1) + '%');
PROFILES.forEach((p) => {
  const bb = b.prof[p.name];
  const aa = a.prof[p.name];
  const cc = a2.prof[p.name];
  console.log(pad(p.name + ' 10层/F20', 22)
    + pad(pct(bb.f10, runs).toFixed(1) + '/' + pct(bb.f20, runs).toFixed(1), 12)
    + pad(pct(aa.f10, runs).toFixed(1) + '/' + pct(aa.f20, runs).toFixed(1), 12)
    + pct(cc.f10, runs).toFixed(1) + '/' + pct(cc.f20, runs).toFixed(1));
});

/* ---------- 表 2：三方案 ---------- */
const SCHEMES = ['after', 's1', 's1r', 's2', 's3', 's4', 's13'];
console.log('\n【表 2】可见性方案 · 只报数不选（全部在"修后"模型上叠加）');
console.log(pad('方案', 20) + pad('升级/局', 10) + pad('获得/局', 10) + pad('前3层不同', 11)
  + pad('S获得率', 10) + pad('零S(获得)', 11) + pad('零S(出现)', 11) + '最差10层/ F20');
SCHEMES.forEach((id) => {
  const r = results[id];
  const v = VARIANTS.find((x) => x.id === id);
  const worst10 = Math.max.apply(null, PROFILES.map((p) => r.prof[p.name].f10 / runs));
  const worst20 = Math.max.apply(null, PROFILES.map((p) => r.prof[p.name].f20 / runs));
  const verdict = (worst10 <= 0.385 && worst20 <= 0.35) ? 'PASS' : '破线';
  console.log(pad(v.name, 20)
    + pad((r.levelUps / r.runs).toFixed(2), 10)
    + pad((r.draws / r.runs).toFixed(2), 10)
    + pad((r.f3Distinct / r.runs).toFixed(2), 11)
    + pad(pct(r.anySAcq, r.runs).toFixed(1) + '%', 10)
    + pad(pct(r.zeroSAcq, r.runs).toFixed(1) + '%', 11)
    + pad(pct(r.zeroSOffer, r.runs).toFixed(1) + '%', 11)
    + pct(worst10, 1).toFixed(1) + ' / ' + pct(worst20, 1).toFixed(1) + '  ' + verdict);
});

/* ---------- 表 3：四口径明细 ---------- */
console.log('\n【表 3】四口径 10 层 / F20（%）');
console.log(pad('方案', 20) + PROFILES.map((p) => pad(p.name, 16)).join(''));
SCHEMES.forEach((id) => {
  const r = results[id];
  const v = VARIANTS.find((x) => x.id === id);
  console.log(pad(v.name, 20) + PROFILES.map((p) => pad(
    pct(r.prof[p.name].f10, runs).toFixed(1) + ' / ' + pct(r.prof[p.name].f20, runs).toFixed(1), 16)).join(''));
});

/* ---------- 表 4：S 批逐张获得率 ---------- */
console.log('\n【表 4】S 批逐张获得率（%）');
console.log(pad('牌', 12) + SCHEMES.map((id) => pad(VARIANTS.find((x) => x.id === id).name.slice(0, 10), 13)).join(''));
S_IDS.forEach((id) => {
  const m = C.MAGIC.find((q) => q.id === id) || {};
  console.log(pad((m.name || id), 12) + SCHEMES.map((sid) => {
    const r = results[sid];
    return pad(pct(r.cardAcq[id], r.runs).toFixed(1), 13);
  }).join(''));
});

/* ---------- 存档 ---------- */
const outJson = path.join(__dirname, '..', '.seedwork', 's_visibility_' + runs + '.json');
fs.writeFileSync(outJson, JSON.stringify({
  runs,
  md5: { sim: md5Of(path.join(DIR, 'sim.js')), config: md5Of(path.join(DIR, 'config.js')) },
  variants: VARIANTS,
  modelFix: {
    brandDamage: 108,
    wardTakenMul: 0.85,
    riftTakenMul: 0.93,
    wardAetherCostPerSec: 24 / 5
  },
  results: Object.keys(results).reduce((acc, id) => {
    const r = results[id];
    acc[id] = {
      avgLevelUps: r.levelUps / r.runs,
      avgDraws: r.draws / r.runs,
      avgF3Distinct: r.f3Distinct / r.runs,
      repeatRate: r.repeatRuns / r.runs,
      zeroSAcq: r.zeroSAcq / r.runs,
      zeroSOffer: r.zeroSOffer / r.runs,
      anySAcq: r.anySAcq / r.runs,
      anySOffer: r.anySOffer / r.runs,
      clear: PROFILES.reduce((o, p) => {
        o[p.name] = { f10: r.prof[p.name].f10 / runs, f20: r.prof[p.name].f20 / runs };
        return o;
      }, {}),
      cards: ALL_IDS.reduce((o, cid) => {
        o[cid] = { acq: r.cardAcq[cid] / r.runs, offer: r.cardOffer[cid] / r.runs };
        return o;
      }, {})
    };
    return acc;
  }, {})
}, null, 2), 'utf8');
console.log('\n已存档 ' + outJson);
