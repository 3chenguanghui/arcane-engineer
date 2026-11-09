/* ============================================================================
 * 《烬》离线战斗模拟引擎
 * ----------------------------------------------------------------------------
 * 设计说明（为什么不逐帧模拟）：
 *   游戏里一场房战里"玩家输出 DPS"和"承受伤害 DPS"在同一敌人数量阶段内基本恒定，
 *   所以按"杀一只怪"为阶段推进（事件驱动），比 60fps 逐帧快几百倍，且结果更稳定可复现。
 *
 * 模型边界：
 *   · 会算：敌人总血、玩家奥能经济、技能冷却、暴击期望、群体命中、接触伤害节流、
 *     治疗、遗物/科技/融合、首领血量与伤害分段、清层/宝箱结晶、升级选卡。
 *   · 不会算：具体弹道命中、走位路线、地形遮挡。这些由 profile 的 aim/dodge 参数折算。
 *
 * 所有随机数来自固定种子的 mulberry32，同一个 runIndex 永远得到同一局。
 * ============================================================================ */
'use strict';

const C = require('./config');

/* ---------------------------------------------------------------------------
 * 随机数
 * ------------------------------------------------------------------------- */

/**
 * mulberry32：32 位种子伪随机数，速度快、实现短、同种子完全复现。
 * @param {number} seed 32 位无符号整数种子
 * @returns {Function} 返回 0~1 的随机函数
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 由基础种子 + 局序号派生一局的独立种子。
 * @param {number} baseSeed 基础种子
 * @param {number} runIndex 局序号
 * @returns {number} 32 位种子
 */
function runSeed(baseSeed, runIndex) {
  return ((baseSeed ^ Math.imul(runIndex + 1, 2654435761)) >>> 0);
}

/** 从 [min,max] 闭区间取整数 */
function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** 从数组里随机取一项 */
function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

/** 打乱数组（Fisher-Yates） */
function shuffle(rng, list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/* ---------------------------------------------------------------------------
 * 楼层派生参数
 * ------------------------------------------------------------------------- */

/**
 * 取某层的难度档：前 5 层教学固定 normal（对应 onboardActiveFloor）。
 * @param {number} floor 层数
 * @param {string} difficulty 玩家选择的难度 id
 * @returns {Object} 难度配置
 */
function diffAt(floor, difficulty) {
  if (floor <= C.ONBOARD.maxFloors) return C.DIFFICULTY.normal;
  return C.DIFFICULTY[difficulty] || C.DIFFICULTY.normal;
}

/**
 * 楼层血量压力（对应 difficultyPressure）。
 * @param {number} floor 层数
 * @param {Object} diff 难度配置
 * @returns {number} 压力倍率
 */
function pressureAt(floor, diff) {
  const raw = 1 + Math.max(0, floor - 1) * C.PRESSURE.hpStep;
  return Math.min(C.PRESSURE.maxMul, Math.max(1, raw * diff.pressure));
}

/**
 * 取该层敌人预算表行（超过 20 层沿用第 20 层）。
 * @param {number} floor 层数
 * @returns {Object} { battle:[min,max], elite:[min,max], hpScale }
 */
function rampAt(floor) {
  return C.RAMP_BY_FLOOR[Math.min(20, floor)] || C.RAMP_BY_FLOOR[20];
}

/**
 * 深层血量系数（对应主文件 deepHpMulOf，F19 起每 5 层 +10%，6 档封顶）。
 * @param {number} floor 层数
 * @returns {number} 血量倍率（F≤18 为 1）
 */
function deepHpMulAt(floor) {
  const cfg = C.REGION_DEEP;
  if (floor < cfg.startFloor) return 1;
  const raw = Math.ceil((floor - cfg.startFloor + 1) / cfg.tierEvery);
  const tier = Math.max(1, Math.min(cfg.maxTier, raw));
  return 1 + tier * cfg.hpPerTier;
}

/**
 * 判断某层是否为「深层回血节奏层」（对应主文件 isDeepHealFloor）。
 * 节奏层 = F12 / F15 / F18（从 fromFloor 起每 everyN 层）+ extraFloors 指定的终局层。
 * @param {number} floor 层数
 * @returns {boolean} 是否节奏层
 */
function isRhythmFloor(floor) {
  const cfg = C.ECONOMY.deepHeal;
  if (!cfg) return false;
  if (floor < cfg.fromFloor) return false;
  if (Array.isArray(cfg.extraFloors) && cfg.extraFloors.indexOf(floor) >= 0) return true;
  return (floor - cfg.fromFloor) % Math.max(1, cfg.everyN) === 0;
}

/**
 * 施加一次回血，返回真实回复量（血满时返回 0，便于统计来源占比）。
 * @param {Object} p 玩家
 * @param {number} amount 期望回复量
 * @returns {number} 真实回复量
 */
function applyHeal(p, amount) {
  const before = p.hp;
  p.hp = Math.min(p.hpMax, p.hp + Math.max(0, amount));
  return p.hp - before;
}

/**
 * 该层所属区域池。
 * @param {number} floor 层数
 * @returns {Array<string>} 敌人 id 列表
 */
function poolAt(floor) {
  if (floor <= 6) return C.REGION_POOLS.mech;
  if (floor <= 12) return C.REGION_POOLS.rune;
  if (floor <= 18) return C.REGION_POOLS.void;
  return C.REGION_POOLS.mixed;
}

/**
 * 单只敌人血量（对应 spawnEnemy 的 hpMaxValue 计算）。
 * @param {Object} type 敌人类型配置
 * @param {number} floor 层数
 * @param {Object} diff 难度
 * @param {boolean} elite 是否精英化（×2.2）
 * @param {number} extraMul 额外倍率（精英路线房 ×1.35）
 * @returns {number} 血量
 */
function enemyHpAt(type, floor, diff, elite, extraMul, hpMulOverride, eliteMulOverride) {
  const ramp = rampAt(floor);
  const weak = floor === 1 ? C.ONBOARD.weakFloor1.hpMul : 1;
  const scale = Math.pow(C.GAME.floorScale, floor);
  const eliteHp = elite ? 2.2 * (eliteMulOverride || 1) : 1;
  return Math.max(1, Math.round(
    type.hp * scale * eliteHp * diff.hpMul * pressureAt(floor, diff)
    * ramp.hpScale * weak * (elite ? (extraMul || 1) : 1)
    * deepHpMulAt(floor) * C.GAME.enemyHpMul * (hpMulOverride || 1)
  ));
}

/**
 * 敌人接触/弹幕伤害倍率（对应 spawnEnemy 的 damage 部分与难度 damageMul）。
 * 前提校验（2026-11-08）：主文件 spawnEnemy 的 damage 只乘
 * `diff.damageMul × 第1层弱化 × 深层系数 × 挑战系数`，**不乘楼层压力**
 * （difficultyPressure 只作用于血量与数量，见主文件 L21662 / L21725）。
 * 旧版模拟器多乘了一次 pressure，导致离线承伤比实机偏高 0~18%，
 * 这里按主文件口径同步，保证模拟结论可与实机对照。
 * @param {number} floor 层数
 * @param {Object} diff 难度
 * @returns {number} 伤害倍率
 */
function enemyDamageMul(floor, diff) {
  const weak = floor === 1 ? C.ONBOARD.weakFloor1.damageMul : 1;
  return diff.damageMul * weak;
}

/* ---------------------------------------------------------------------------
 * 玩家构建（build）与数值出口
 * ------------------------------------------------------------------------- */

/**
 * 创建一局玩家的初始状态。
 * @param {Object} profile 操作水平档案
 * @param {Object} [ov] 探针覆盖项（charSpec / talentSpec；不传时与原逻辑完全一致）
 * @returns {Object} 玩家状态
 */
function createPlayer(profile, ov) {
  const o = ov || {};
  const ch = o.charSpec || {};       // 角色五旋钮（只影响离线平衡探针）
  const tal = o.talentSpec || {};    // 天赋静态乘区（离线折算，不是局内卡片）
  /* 起始生命：基础 100 × (1 + 角色生命偏向 + 天赋生命%) + 角色定点生命。
     三者用加法叠加，和主文件 applyMetaStats 的口径一致（百分比相加，不是相乘）。 */
  const hpMax = Math.round(C.GAME.baseHp * (1 + (ch.hpPct || 0) + (tal.hpPct || 0))
    + (ch.hpFlat || 0));
  const magics = (ch.magics && ch.magics.length)
    ? ch.magics.slice(0, 2)
    : ['fireball', 'frost'];         // 主槽 / 副槽（默认取游戏初始卡池前两张）
  /* 起始技能组里如果带治疗符（damage=0），要同步打开 hasHeal，否则治疗不会生效 */
  const healId = magics.find((id) => {
    const m = magicById(id);
    return m && m.damage <= 0;
  });
  const healCard = healId ? magicById(healId) : null;
  const techs = {};
  (ch.techs || []).forEach((id) => { techs[id] = true; });
  const relics = {};
  (ch.relics || []).forEach((id) => { relics[id] = (relics[id] || 0) + 1; });
  return {
    profile,
    hpMax,
    hp: hpMax,
    hpMaxBase: hpMax,                // 遗物「强化机体」在此基础上加，用这个锚点
    magics,
    hasHeal: !!healCard,
    healAmount: healCard ? (healCard.heal || 30) : 0,
    healCd: healCard ? healCard.cooldown : 3.2,
    techs,
    relics,
    fusions: {},
    level: 1,
    xp: 0,
    xpNeed: C.XP.baseNeed,
    phaseShieldUsed: false,          // 相位甲：每层一次
    roomsCleared: 0,
    embers: 0,                       // B2-a：击杀累积的余烬（熔炉房用它换能力强化）
    /* —— 以下是角色平衡探针的静态乘区；默认值全部为 1 / 0，原路径零影响 —— */
    charDamageMul: ch.damageMul || 1,
    charTakenMul: ch.takenMul || 1,
    charRegenBonus: ch.regenBonus || 0,
    growthBias: ch.growthBias || null,
    talentDamageMul: tal.damageMul || 1,
    talentTakenMul: tal.takenMul || 1,
    talentCdrMul: tal.cdrMul || 1,
    talentRegenBonus: tal.regenBonus || 0,
    talentHealMul: tal.healMul || 1
  };
}

/**
 * 取魔法卡配置。
 * @param {string} id 卡 id
 * @returns {Object} 卡配置
 */
function magicById(id) {
  return C.MAGIC.find((m) => m.id === id);
}

/**
 * 计算当前 build 的静态乘区（伤害、减伤、治疗、冷却）。
 * @param {Object} p 玩家状态
 * @returns {Object} mods
 */
function collectMods(p, ov) {
  const o = ov || {};
  let damageMul = 1;
  let cdMul = 1;
  let takenMul = 1;
  let regenBonus = 0;
  let healPerSec = 0;
  let shieldPerHit = 0;

  // 科技被动
  if (p.techs.amp) damageMul *= C.TECH.amp.damageMul;
  if (p.techs.field) takenMul *= C.TECH.field.takenMul;
  if (p.techs.nanite) healPerSec += C.TECH.nanite.healPerSec;
  if (p.techs.concentrator) regenBonus += C.TECH.concentrator.regenBonus;
  if (p.techs.capacitor) regenBonus += 2.6;        // 上限 +30 折算为长战回能收益（约 +2.6/s）
  if (p.techs.rewind) cdMul *= 0.94;               // 12% 击杀重置冷却，期望冷却 -6%
  if (p.techs.phase) shieldPerHit += 0;            // 免死单独结算

  /* 角色 / 天赋静态乘区（离线平衡探针专用；默认 1 时与原路径完全一致）。
     放在科技与遗物之前乘，是为了保证“角色加成 × 天赋加成 × build 加成”的乘法顺序固定。 */
  damageMul *= (p.charDamageMul || 1) * (p.talentDamageMul || 1);
  takenMul *= (p.charTakenMul || 1) * (p.talentTakenMul || 1);
  cdMul *= (p.talentCdrMul || 1);
  regenBonus += (p.charRegenBonus || 0) + (p.talentRegenBonus || 0);

  // 遗物
  const relics = p.relics;
  if (relics.power) damageMul *= Math.pow(C.RELIC.power.damageMul, relics.power);
  if (relics.haste) cdMul *= Math.pow(C.RELIC.haste.cooldownMul, relics.haste);
  if (relics.regen) regenBonus += C.RELIC.regen.regenBonus * relics.regen;
  /* hpMax 锚点改成角色/天赋算好的基础值，否则角色生命与天赋生命会被遗物行覆盖掉 */
  if (relics.hp) p.hpMax = (p.hpMaxBase || C.GAME.baseHp) + C.RELIC.hp.hpBonus * relics.hp;
  if (relics.bloodthirst) healPerSec += 0.45 * relics.bloodthirst; // 击杀回血折算
  if (relics.roomCharge) {
    const bonus = Math.min(C.RELIC.roomCharge.cap, C.RELIC.roomCharge.perRoomDamage * p.roomsCleared);
    damageMul *= (1 + bonus);
  }
  // 条件型遗物：按触发时间占比折算
  if (relics.lastStand) damageMul *= 1.10;      // 40% 以下血时 +30%，按 ~33% 时间触发
  if (relics.overflow) damageMul *= 1.09;       // 75% 以上奥能时 +22%，按 ~40% 时间触发
  if (relics.momentum) damageMul *= 1.12;       // 移动中 +18%，按 ~67% 时间移动
  if (relics.firstStrike) damageMul *= 1.12;    // 每房前 3 击 ×1.5，折合总伤

  // 元素反应期望
  if (C.ELEMENT.enabled) damageMul *= (1 + C.ELEMENT.expectedDpsBonus);

  // 治疗卡（占一个"被动位"，按需释放）
  if (p.hasHeal) {
    healPerSec += p.healAmount / p.healCd * 0.50 * p.profile.healDiscipline;
  }
  // 敏感度：回血比例（治疗卡 + 纳米机器人 + 嗜血一起乘）
  healPerSec *= (o.healMul || 1) * (p.talentHealMul || 1);

  return { damageMul, cdMul, takenMul, regenBonus, healPerSec, shieldPerHit };
}

/**
 * 计算玩家对 n 个目标时的有效输出（DPS）与治疗速率。
 * 核心：奥能供给侧约束 —— 每秒回能 16 点，技能消耗决定"实际能放几下"。
 * @param {Object} p 玩家状态
 * @param {number} n 场上敌人数量
 * @param {Object} mods 乘区
 * @returns {Object} { dps, healPerSec, aetherUse }
 */
function playerOffense(p, n, mods, ov, supplyMul) {
  const o = ov || {};
  const sMul = supplyMul || 1;
  const profile = p.profile;
  const critAvg = 1 + C.CRIT.chance * (C.CRIT.mul - 1);
  const targets = Math.max(1, n);
  const cards = [];

  // 主槽 / 副槽：副槽按 DUAL_CONFIG 打折
  p.magics.forEach((id, slot) => {
    const card = magicById(id);
    if (!card || card.damage <= 0) return;
    const fusion = C.FUSION.find((f) => f.magic === id && p.fusions[f.id]);
    const slotDamage = slot === 1 ? C.DUAL.secondaryDamage : 1;
    const slotCd = slot === 1 ? C.DUAL.secondaryCooldown : 1;
    const slotCost = slot === 1 ? C.DUAL.secondaryCost : 1;
    const dmg = card.damage * (fusion ? fusion.damageMul : 1) * slotDamage
      * critAvg * mods.damageMul;
    // 群体命中：范围/连锁按多目标增长更快；单体只有小范围擦伤
    const aoeBonus = (card.aoe ? 0.42 : 0.06) + (fusion && fusion.aoeBonus ? fusion.aoeBonus : 0);
    const groupMul = 1 + aoeBonus * Math.min(5, targets - 1);
    // 敏感度：范围技冷却倍率只作用于 aoe 卡
    const aoeCd = card.aoe ? (o.aoeCdMul || 1) : 1;
    const cooldown = card.cooldown * mods.cdMul * slotCd * aoeCd;
    const cost = card.cost * slotCost;
    cards.push({
      id,
      dmgOnce: dmg * groupMul * (1 + (fusion ? 0 : 0)),
      cooldown,
      cost,
      groupMul
    });
  });

  // 能量供给侧：自然回复 + 击杀回能（按 dps 反推击杀速度，先取经验值 0.3/s）
  const regen = (C.GAME.baseRegen + mods.regenBonus) * sMul;
  const supply = regen + C.GAME.killAether * 0.30;
  // 治疗卡会吃掉一部分回能
  const healUseCost = p.hasHeal ? (p.healAmount > 0 ? 28 / p.healCd * 0.50 * profile.healDiscipline : 0) : 0;
  const attackSupply = Math.max(1, supply - healUseCost);

  // 需求侧：所有攻击卡满转所需的能量
  let demand = 0;
  cards.forEach((c) => { demand += c.cost / c.cooldown; });
  const scale = demand > 0 ? Math.min(1, attackSupply / demand) : 0;

  // 实际 DPS：命中率 × 冷却利用率 × 技能频率
  let dps = 0;
  cards.forEach((c) => {
    const rate = (1 / c.cooldown) * scale;
    dps += rate * c.dmgOnce;
  });
  dps *= profile.aim * profile.uptime;

  // 击杀回血 + 治疗卡折算
  return { dps: Math.max(1, dps), healPerSec: mods.healPerSec };
}

/**
 * 估算当前敌人群的近战 / 远程构成比例。
 * @param {Array<string>} ids 敌人类型 id 列表
 * @returns {Object} { melee, ranged }
 */
function forceMix(ids) {
  let melee = 0;
  let ranged = 0;
  ids.forEach((id) => {
    const t = C.ENEMY_TYPES[id];
    if (!t) return;
    if (t.ai === 'shooter') ranged += 1; else melee += 1;
  });
  const total = Math.max(1, ids.length);
  return { melee: melee / total, ranged: ranged / total };
}

/**
 * 当前敌人群对玩家的承伤 DPS。
 * 接触伤害受 contactLock 节流：贴身 1 只 3.8/s，3 只封顶约 10/s。
 * @param {Object} p 玩家
 * @param {Object} ctx 房间上下文
 * @param {number} n 存活数量
 * @returns {number} 承伤 dps
 */
function incomingDps(p, ctx, n) {
  if (n <= 0) return 0;
  const dodge = p.profile.dodge;
  const mix = ctx.mix;
  const melee = Math.min(3, Math.round(n * mix.melee));
  const ranged = Math.max(0, Math.round(n * mix.ranged));
  const dmgMul = ctx.damageMul;

  // 接触：玩家会在移动中拉开距离，真正贴身的时间约占一半
  const meleeEngaged = Math.min(2, melee * 0.55);
  const contactRate = Math.min(1 / C.GAME.contactLock, meleeEngaged / C.GAME.contactInterval) * 0.8;
  let contact = C.GAME.contactDamage * dmgMul * contactRate * 0.28 * (1 - dodge * 0.35);
  if (ctx.elite) contact *= 1.25;

  // 远程：每只按各自射速；保持距离时更容易躲
  let rangedDps = 0;
  ctx.enemyIds.slice(0, Math.max(0, ranged)).forEach((id) => {
    const t = C.ENEMY_TYPES[id];
    if (!t || t.ai !== 'shooter') return;
    const interval = t.fireInterval || 2.4;
    const hitRate = 0.30 * (1 - dodge * 0.55);
    rangedDps += t.damage * dmgMul * hitRate / interval;
  });

  // 自爆怪：低血时额外一次性伤害，折算 0.8 dps
  if (ctx.hasSelfdestruct) contact += 6 * dmgMul / 8;

  // 被围（超过 3 只）额外压力
  const surround = n >= 6 ? 1.12 : 1;
  return (contact + rangedDps) * surround;
}

/* ---------------------------------------------------------------------------
 * 房间 / 首领结算
 * ------------------------------------------------------------------------- */

/**
 * 结算一场房间战斗。
 * 事件驱动：每杀一只为一个阶段，阶段内 DPS 与承伤恒定。
 * @param {Object} p 玩家
 * @param {Object} ctx {floor, type, enemyIds, elite, diff}
 * @returns {Object} { seconds, damage, healed, died, killed }
 */
function simulateRoom(p, ctx) {
  const mods = ctx.mods;
  const plan = ctx.healPlan || null;
  let n = ctx.enemyIds.length;
  let totalSeconds = C.SIM_PARAMS.approachSeconds;
  let damageTaken = 0;
  let healed = 0;
  let killHeal = 0;                 // 探针：击杀回血（方案 B）
  let minHp = p.hp;                 // 探针：本房最低血量
  const enemyTotalHp = ctx.hpList.slice();
  let killed = 0;
  const maxSeconds = C.SIM_PARAMS.maxRoomSeconds;
  /* 探针：进场瞬间承伤/回血与首阶段耗时，用于判断"进场 3 秒内暴毙"占比。 */
  const entryHp = p.hp;
  const entryOffense = playerOffense(p, n, mods, ctx.ov);
  const entryIncoming = incomingDps(p, ctx, n) * (1 - p.profile.dodge * 0.25) * mods.takenMul;
  const entryNetDps = entryIncoming - entryOffense.healPerSec;
  let firstStageTime = 0;
  let firstStageGross = 0;
  const clearAt = (ctx.clearKills && ctx.clearKills > 0) ? ctx.clearKills : 0;   // 0=全清；>0=杀够 N 只即可撤离

  while (n > 0 && (!clearAt || killed < clearAt)) {
    const avgHp = enemyTotalHp[n - 1];
    const offense = playerOffense(p, n, mods, ctx.ov);
    let dps = offense.dps;
    if (ctx.elite) dps *= 0.92;                  // 精英体型大，AOE 覆盖略降
    const finalDps = Math.max(1, dps);

    // 本阶段（杀一只）耗时
    let stage = avgHp / finalDps;
    if (stage <= 0) stage = 0.01;
    if (totalSeconds + stage > maxSeconds) stage = Math.max(0.01, maxSeconds - totalSeconds);

    const incoming = incomingDps(p, ctx, n) * (1 - p.profile.dodge * 0.25);
    const gross = incoming * stage * mods.takenMul;
    const heal = offense.healPerSec * stage;
    if (firstStageTime === 0) { firstStageTime = stage; firstStageGross = gross; }
    p.hp = Math.min(p.hpMax, p.hp + heal - gross);
    damageTaken += gross;
    healed += heal;
    if (p.hp < minHp) minHp = p.hp;

    totalSeconds += stage;

    if (p.hp <= 0) {
      // 相位甲：每层一次致死免伤，保留 1 血
      if (p.techs.phase && !p.phaseShieldUsed) {
        p.phaseShieldUsed = true;
        p.hp = 1;
        if (p.hp < minHp) minHp = p.hp;
      } else {
        return {
          seconds: totalSeconds, damage: damageTaken, healed, died: true, killed, minHp, killHeal,
          deathTime: totalSeconds, entryHp, entryIncoming, entryNetDps, firstStageTime, firstStageGross
        };
      }
    }
    if (totalSeconds >= maxSeconds) {
      return {
        seconds: totalSeconds, damage: damageTaken, healed, died: true, killed, minHp, killHeal,
        deathTime: totalSeconds, entryHp, entryIncoming, entryNetDps, firstStageTime, firstStageGross
      };
    }

    n -= 1;
    killed += 1;
    // 探针：击杀回血（方案 B）——按 profile 的最低血线也不触发，纯数值折算
    if (plan && plan.killHeal && ctx.floor >= (plan.killHeal.fromFloor || 0)) {
      const kh = p.hpMax * plan.killHeal.ratio;
      killHeal += applyHeal(p, kh);
      if (p.hp < minHp) minHp = p.hp;
    }
  }

  p.roomsCleared += 1;
  return { seconds: totalSeconds, damage: damageTaken, healed, died: false, killed, minHp, killHeal };
}

/**
 * 结算首领战。
 * 分两个阶段（100%-50%、50%-0%），二阶段攻速提升。
 * @param {Object} p 玩家
 * @param {Object} ctx {floor, boss, hp, damage, diff, mods}
 * @returns {Object} { seconds, damage, healed, died }
 */
function simulateBoss(p, ctx) {
  const mods = ctx.mods;
  const boss = ctx.boss;
  const dodge = p.profile.dodge;
  const plan = ctx.healPlan || null;
  let hp = ctx.hp;
  let seconds = C.BOSS.introTime;
  let damageTaken = 0;
  let healed = 0;
  let pulseHeal = 0;               // 探针：首领阶段补给（方案 C）
  let pulseApplied = 0;
  let minHp = p.hp;
  let guard = 0;

  // 首领战回能 ×2：用真实回能翻倍参与奥能预算，而不是简单乘 DPS
  const singleDps = playerOffense(p, 1, mods, ctx.ov, C.BOSS.aetherRegenMul).dps;

  /* V2 机制折算（默认全 0）：downtime 折算成"首领出手更密"，而不是直接砍玩家 DPS。
     原因：模拟器里战斗时长一拉长，回血也按秒变多，砍 DPS 反而会让高回复流派更安全
     （实测 scale=0.1 时 5 层通关率反而从 45.8% 涨到 71.3%）。折算成出手间隔后，
     回血不吃到额外时间，只会吃到额外承伤，口径才和"机制逼你走位"一致。 */
  const mech = pickBossMech2(ctx.floor, boss.id, !!(ctx.ov && ctx.ov.bossMech2),
    (ctx.ov && ctx.ov.bossMechOnly) || null);
  const mechScale = (ctx.ov && typeof ctx.ov.bossMech2Scale === 'number') ? ctx.ov.bossMech2Scale : 1;   // 标定用：整表等比缩放（0 表示归零，必须可生效）
  const mechDown = Math.min(0.85, (Number(boss.downtime) || 0) + (mech ? mech.downtime * mechScale : 0));
  const mechExtraHit = (Number(boss.extraHitRate) || 0) + (mech ? mech.extraHitRate * mechScale : 0);
  const mechHazardHits = (Number(boss.hazardDps) || 0) + (mech ? mech.hazardDps * mechScale : 0);

  while (hp > 0 && guard < 400) {
    guard += 1;
    const phase2 = hp <= ctx.hp * C.BOSS.phaseThreshold;
    const attackInterval = boss.attackInterval * (phase2 ? 0.74 : 1); // 二阶段更快
    // V2：走位损失 D ⇒ 击杀时间 ×1/(1-D) ⇒ 等效出手间隔 ×(1-D)，首领出手更密
    const attackIntervalEff = attackInterval * Math.max(0.15, 1 - mechDown);
    const hitRate = 0.30 * (1 - dodge * 0.70);
    const heavyEvery = 6.5;
    const heavyHitRate = 0.16 * (1 - dodge * 1.20);
    const hitDamage = ctx.damage;
    const heavyDamage = ctx.damage * (boss.heavyDamage / boss.contactDamage);

    // 每招期望承伤（普通攻击 + 重招 + V2 机制折算的额外命中）
    const bossDps = (hitDamage * (hitRate + mechExtraHit) / attackIntervalEff)
      + (heavyDamage * heavyHitRate / heavyEvery)
      + (hitDamage * mechHazardHits);
    /* 探针：把原来的"半个血条一次结算"拆成 10% 小段。
       否则首领回血节点只会在血量结算完才触发，无法模拟"打到一半就被补一口"；
       总承伤不变（时间线性），只改变回血节点与死亡判定的粒度。 */
    const boundary = phase2 ? 0 : Math.floor(ctx.hp * C.BOSS.phaseThreshold);
    /* 段长：默认 10% 血一条（让阶段回血能在打到一半时触发）；
       bossChunkFrac=0.5 可复现"旧版两段式"口径，用于解释历史基线差异。 */
    const chunkFrac = (ctx.ov && Number(ctx.ov.bossChunkFrac)) || 0.1;
    const chunkHp = Math.max(1, Math.min(hp - boundary, Math.ceil(ctx.hp * chunkFrac)));
    const segmentTime = chunkHp / Math.max(1, singleDps);
    const gross = bossDps * segmentTime * mods.takenMul;
    const heal = mods.healPerSec * segmentTime;
    p.hp = Math.min(p.hpMax, p.hp + heal - gross);
    damageTaken += gross;
    healed += heal;
    if (p.hp < minHp) minHp = Math.max(0, p.hp);
    seconds += segmentTime;

    if (p.hp <= 0) {
      if (p.techs.phase && !p.phaseShieldUsed) {
        p.phaseShieldUsed = true;
        p.hp = 1;
        if (p.hp < minHp) minHp = p.hp;
      } else {
        return { seconds, damage: damageTaken, healed, died: true, minHp, pulseHeal,
          timedOut: false, deathAt: seconds, bossHpLeftPct: hp / Math.max(1, ctx.hp) * 100 };
      }
    }
    if (seconds > C.SIM_PARAMS.maxRoomSeconds) {
      return { seconds, damage: damageTaken, healed, died: true, minHp, pulseHeal,
        timedOut: true, deathAt: seconds, bossHpLeftPct: hp / Math.max(1, ctx.hp) * 100 };
    }
    hp -= chunkHp;

    // 探针：首领阶段补给（方案 C / 主文件 bossPulse 口径）
    if (plan && plan.bossPulse && plan.bossPulse.enabled !== false
      && ctx.floor >= (plan.bossPulse.fromFloor || 0)
      && (!plan.bossPulse.rhythmOnly || isRhythmFloor(ctx.floor))) {
      /* C1-15 隔离测量：允许按场景覆盖 bossPulse 触发频率（0.10 = v1.5.9，0.08 = B1 口径） */
      const every = Math.max(0.05, (ctx.ov && ctx.ov.bossPulseEveryPct) || plan.bossPulse.everyPct || 0.10);
      const progress = 1 - hp / Math.max(1, ctx.hp);
      const bucket = Math.floor(progress / every);
      if (bucket > pulseApplied) {
        const times = bucket - pulseApplied;
        pulseApplied = bucket;
        pulseHeal += applyHeal(p, p.hpMax * plan.bossPulse.ratio * times
          * (ctx.ov && ctx.ov.deepHealMul ? ctx.ov.deepHealMul : 1));
        if (p.hp < minHp) minHp = p.hp;
      }
    }
  }
  return { seconds, damage: damageTaken, healed, died: false, minHp, pulseHeal,
    timedOut: false, deathAt: 0 };
}

/* ---------------------------------------------------------------------------
 * 升级选卡
 * ------------------------------------------------------------------------- */

/**
 * 枚举当前可选的升级项。
 * @param {Object} p 玩家
 * @returns {Array<Object>} 选项
 */
function optionPool(p) {
  const options = [];
  // 融合：拥有对应魔法 + 科技
  C.FUSION.forEach((f) => {
    if (p.fusions[f.id]) return;
    if (p.magics.includes(f.magic) && p.techs[f.tech]) {
      options.push({ kind: 'fusion', id: f.id, name: f.name, value: 0.24, survival: 0.03, data: f });
    }
  });
  // 新魔法：替换较差的一张
  C.MAGIC.forEach((m) => {
    if (p.magics.includes(m.id)) return;
    const isHeal = m.damage <= 0;
    if (isHeal) {
      if (p.hasHeal) return;
      options.push({ kind: 'magic', id: m.id, name: m.name, value: 0.08, survival: 0.10, data: m });
      return;
    }
    options.push({ kind: 'magic', id: m.id, name: m.name, value: 0.10, survival: 0.01, data: m });
  });
  // 科技
  Object.keys(C.TECH).forEach((id) => {
    if (p.techs[id]) return;
    const t = C.TECH[id];
    let value = 0.03;
    let survival = 0.02;
    if (id === 'amp') value = 0.08;
    if (id === 'capacitor') value = 0.05;
    if (id === 'concentrator') value = 0.06;
    if (id === 'rewind') value = 0.04;
    if (id === 'field') survival = 0.12;
    if (id === 'nanite') survival = 0.09;
    if (id === 'phase') survival = 0.10;
    if (id === 'magnet') { value = 0.01; survival = 0.01; }
    options.push({ kind: 'tech', id, name: t.name, value, survival, data: t });
  });
  // 遗物
  Object.keys(C.RELIC).forEach((id) => {
    const r = C.RELIC[id];
    const stacks = p.relics[id] || 0;
    if (stacks >= r.maxStacks) return;
    let value = 0.04;
    let survival = 0.02;
    if (id === 'power') value = 0.12;
    if (id === 'haste') value = 0.08;
    if (id === 'hp') survival = 0.06;
    if (id === 'bloodthirst') survival = 0.05;
    if (id === 'lastStand') value = 0.07;
    if (id === 'overflow') value = 0.06;
    if (id === 'firstStrike') value = 0.05;
    if (id === 'momentum') value = 0.04;
    if (id === 'roomCharge') value = 0.06;
    if (id === 'regen') value = 0.03;
    options.push({ kind: 'relic', id, name: r.name, value, survival, data: r });
  });
  return options;
}

/**
 * 判断一张卡对当前 build 是否"真的有用"。
 * 空卡只有一种：换不动主/副槽的魔法卡（数值比现有两张都低）。
 * 科技/遗物/融合在 optionPool 里已经排除"已拥有/已满层"，拿到就是生效。
 * @param {Object} p 玩家
 * @param {Object} opt 选项
 * @returns {boolean} 是否生效
 */
function optionEffective(p, opt) {
  if (opt.kind !== 'magic') return true;
  const m = opt.data;
  if (m.damage <= 0) return !p.hasHeal;          // 治疗卡：还没有治疗时才生效
  const singleDps = (id) => {
    const c = magicById(id);
    if (!c || c.damage <= 0) return 0;
    return (c.damage * 1.18) / c.cooldown;
  };
  const groupEff = (id) => {
    const c = magicById(id);
    if (!c || c.damage <= 0) return 0;
    return (c.damage / c.cost) * (c.aoe ? 2.26 : 1.18);
  };
  return singleDps(m.id) > singleDps(p.magics[0])
    || groupEff(m.id) > groupEff(p.magics[1]);
}

/**
 * 一次升级三选一：按 profile.buildIQ 决定"按数值选"还是"随机选"。
 * @param {Object} p 玩家
 * @param {Function} rng 随机函数
 * @param {Function} [rec] 可选探针回调，收到本次三选一的完整信息（选项/有效性/是否全空）
 * @returns {Object|null} 选中的项
 */
function levelUp(p, rng, rec) {
  const pool = optionPool(p);
  if (!pool.length) return null;
  const choices = shuffle(rng, pool).slice(0, 3);
  const effective = choices.map((o) => optionEffective(p, o));
  /* 评分：伤害提升占 70%，生存提升占 30%。
     角色「成长偏向」可以在不改选项池的前提下，调整这两项的权重
     （默认 null → 0.7 / 0.3，与原逻辑一致）。 */
  const bias = p.growthBias || { value: 0.7, survival: 0.3 };
  const score = (o) => o.value * bias.value + o.survival * bias.survival;
  let chosen;
  if (rng() < p.profile.buildIQ) {
    chosen = choices.reduce((best, o) => (score(o) > score(best) ? o : best), choices[0]);
  } else {
    chosen = pick(rng, choices);
  }
  applyOption(p, chosen, rng);
  p.level += 1;
  if (rec) rec({ choices, effective, chosen, allDud: effective.every((v) => !v) });
  return chosen;
}

/**
 * 应用一个升级选项到玩家 build。
 * @param {Object} p 玩家
 * @param {Object} opt 选项
 * @param {Function} rng 随机函数
 * @returns {void}
 */
function applyOption(p, opt, rng) {
  if (opt.kind === 'fusion') {
    p.fusions[opt.id] = true;
    return;
  }
  if (opt.kind === 'tech') {
    p.techs[opt.id] = true;
    return;
  }
  if (opt.kind === 'relic') {
    p.relics[opt.id] = (p.relics[opt.id] || 0) + 1;
    return;
  }
  if (opt.kind === 'magic') {
    const m = opt.data;
    if (m.damage <= 0) {
      p.hasHeal = true;
      p.healAmount = (m.heal || 30) * 1.0;
      p.healCd = m.cooldown;
      return;
    }
    // 主槽保留"单体 DPS 最高"的卡（首领战靠它）；副槽按"4 目标每点奥能伤害"挑选
    const singleDps = (id) => {
      const c = magicById(id);
      if (!c || c.damage <= 0) return 0;
      return (c.damage * 1.18) / c.cooldown;
    };
    const groupEff = (id) => {
      const c = magicById(id);
      if (!c || c.damage <= 0) return 0;
      return (c.damage / c.cost) * (c.aoe ? 2.26 : 1.18);
    };
    if (singleDps(m.id) > singleDps(p.magics[0])) {
      p.magics[1] = p.magics[0];
      p.magics[0] = m.id;
    } else if (groupEff(m.id) > groupEff(p.magics[1])) {
      p.magics[1] = m.id;
    }
  }
}

/* ---------------------------------------------------------------------------
 * 单局主循环
 * ------------------------------------------------------------------------- */

/**
 * 生成该层房间列表。
 * @param {Function} rng 随机函数
 * @param {number} floor 层数
 * @param {Object} profile 操作档案
 * @returns {Array<Object>} 房间
 */
function generateRooms(rng, floor, profile, ov) {
  const rooms = [{ type: 'start' }];
  /* B2-a 熔炉层：直接按层计划固定 3 间内容房（与主文件 applyRoomMixPlan 的 plan 表一致）。
     不这样做的话，随机权重根本抽不到 forge，四口径等于没测这一项。 */
  const fixedPlan = C.ROOM.plan && C.ROOM.plan[floor];
  if (fixedPlan) {
    fixedPlan.forEach((t) => rooms.push({ type: t }));
    const skipBossFixed = ov && ov.bossSkipFloors && ov.bossSkipFloors.indexOf(floor) >= 0;
    rooms.push({ type: skipBossFixed ? 'battle' : 'boss' });
    return rooms;
  }
  const weights = Object.assign({}, C.ROOM.weights);
  if (floor >= 2) weights.elite = C.ROOM.eliteWeightFloor2;
  /* A′：真实保底口径用"必经比例"注入精英，先把第 2 层起的按权重随机精英权重归零，
     否则会和实测必经率重复计数（37% + 44% 会虚高到 65%）。
     F1 保持 A 的权重口径：主文件 F1 也可能随机出精英房，且没有"保底"这一条。 */
  if (ov && ov.eliteMandatory && floor >= 2) weights.elite = 0;
  // 精英房是"双价门"主动选择：贪心越低越少进（新手绕开精英路线）
  weights.elite = weights.elite
    ? Math.max(1, Math.round(weights.elite * (0.15 + profile.greed * 0.5)))
    : 0;
  const tune = (ov && ov.eliteTune && floor >= (ov.eliteTune.fromFloor || 0)) ? ov.eliteTune : null;
  if (tune && tune.weightMul !== undefined) {
    weights.elite = Math.max(0, Math.round(weights.elite * tune.weightMul));
  }
  const types = Object.keys(weights);
  for (let i = 0; i < C.ROOM.contentRooms; i += 1) {
    const total = types.reduce((s, k) => s + weights[k], 0);
    let r = rng() * total;
    let chosen = 'battle';
    for (let j = 0; j < types.length; j += 1) {
      r -= weights[types[j]];
      if (r <= 0) { chosen = types[j]; break; }
    }
    rooms.push({ type: chosen });
  }
  const skipBoss = ov && ov.bossSkipFloors && ov.bossSkipFloors.indexOf(floor) >= 0;
  rooms.push({ type: skipBoss ? 'battle' : 'boss' });

  /* 灵敏度开关：主文件"第 2 层起至少 1 间精英房"（L17891），
     默认关闭以保持历史口径；eliteGuarantee=true 时把一间普通战斗房改成精英房。 */
  if (ov && ov.eliteGuarantee && floor >= 2 && !rooms.some((r) => r.type === 'elite')) {
    const idx = rooms.findIndex((r) => r.type === 'battle');
    if (idx >= 0) rooms[idx].type = 'elite';
  }

  /* 口径 A′（真实保底口径）：主文件每层都保底 1 间精英房，但精英房是否"绕不开"
     取决于它在两条路线上的位置。浏览器实测（970 层生成，见 E1_PATCH.md §1）：
       两条路线必然存在（attachLoopRoutes 保证），精英房落在两线交集（必经）的整体比例 ≈44%，
       分楼层：F2 44%、F3 10%、F4 52%、F5 47%、F6–F20 ≈46%。
     eliteMandatory 传入数字或 {楼层: 概率} 时，按该概率补 1 间精英房；
     默认关闭，不影响历史口径。 */
  if (ov && ov.eliteMandatory && floor >= 2 && !rooms.some((r) => r.type === 'elite')) {
    const rate = typeof ov.eliteMandatory === 'number'
      ? ov.eliteMandatory
      : (ov.eliteMandatory[floor] || 0);
    if (rng() < rate) {
      /* 对齐主文件 assignRoomTypes：保底是把"最后一间非出生/非楼梯房"直接改成精英，
         原先可能是宝箱/事件/休息房 —— 不是"把一间战斗房升级成精英"。 */
      const idx = rooms.length - 2;
      if (idx >= 1 && rooms[idx].type !== 'start') rooms[idx].type = 'elite';
    }
  }
  return rooms;
}

/**
 * 构造一场战斗房的敌人列表与血量。
 * @param {Function} rng 随机函数
 * @param {number} floor 层数
 * @param {string} roomType battle/elite
 * @param {Object} diff 难度
 * @returns {Object} ctx
 */
function buildEncounter(rng, floor, roomType, diff, ov) {
  const o = ov || {};
  const ramp = rampAt(floor);
  const pool = poolAt(floor);
  const isElite = roomType === 'elite';
  const tune = (isElite && o.eliteTune && floor >= (o.eliteTune.fromFloor || 0)) ? o.eliteTune : null;
  const range = isElite ? ramp.elite : ramp.battle;
  const budgetOn = true;   /* 对齐主文件 minFloor = 1 */   // 第 6 层起走预算硬区间
  let count = randInt(rng, range[0], range[1]);

  // 精英房 ×1.4 只在"非预算层"生效；预算层直接用 ramp 区间（与主文件 enemyBudgetApplies 分支一致）
  /* 对齐主文件：ENEMY_BUDGET_CONFIG.minFloor = 1，F1 起全部走 ramp 硬区间，
     不再叠精英 ×1.4 / 教学 ×0.8 / F1 上限 3。 */
  if (isElite && !budgetOn) count = Math.round(count * (tune && tune.countMul !== undefined ? tune.countMul : C.ELITE_ROOM.countMul));
  // 上限：预算层 = max(基础上限 7, 区间上界)（F20 战斗房因此可达 9 只）；非预算层仍是精英 8 / 普通 7
  const baseCap = budgetOn
    ? Math.max(C.FLOOR_GEN.enemyCountCap, range[1])
    : (isElite ? C.ELITE_ROOM.countCap : C.FLOOR_GEN.enemyCountCap);
  const cap = (tune && tune.countCap !== undefined) ? tune.countCap : baseCap;
  count = Math.max(1, Math.min(cap, count));

  // 混编：精英房里最后 N 只改为普通怪（模拟"4 精英 + 2 普通"这类配比）
  const mixNormal = (isElite && tune && tune.mixNormal)
    ? Math.max(0, Math.min(count - 1, tune.mixNormal))
    : 0;

  const ids = [];
  for (let i = 0; i < count; i += 1) {
    // 楼层专属怪：F4 炉心祭司 / F5 虚空主教，各 25% 概率混入
    if (floor === 4 && rng() < 0.25) ids.push('forgepriest');
    else if (floor === 5 && rng() < 0.25) ids.push('voidbishop');
    else ids.push(pick(rng, pool));
  }

  const hpList = [];
  ids.forEach((id, idx) => {
    const asNormal = isElite && idx >= count - mixNormal;   // 混编进来的普通怪
    const eliteOn = isElite && !asNormal;
    const eliteHpMul = eliteOn ? ((tune && tune.hpMul !== undefined) ? tune.hpMul : C.ELITE_ROOM.hpMul) : 1;
    hpList.push(enemyHpAt(C.ENEMY_TYPES[id], floor, diff, eliteOn, eliteHpMul, o.hpMul, o.eliteHpMul));
  });
  hpList.sort((a, b) => a - b);   // 从小到大击杀（小数先死，符合实际）

  return {
    floor, type: roomType, elite: isElite, enemyIds: ids, hpList,
    mix: forceMix(ids),
    normalMixed: mixNormal,
    damageMul: enemyDamageMul(floor, diff),
    hasSelfdestruct: ids.some((id) => C.ENEMY_TYPES[id] && C.ENEMY_TYPES[id].selfdestruct),
    totalHp: hpList.reduce((s, v) => s + v, 0)
  };
}

/**
 * 模拟器首领身份映射（对齐主文件 bossKindForFloor）
 * ------------------------------------------------------------
 * 主文件按大区锁身份：F1–6 机械、F7–12 符文、F13–18 虚空、F19+ 深层轮转。
 * 旧版这里用 (floor-1)%3 轮转，等于模拟了"F1机械/F2符文/F3虚空"——
 * 实机一局 5 层是 5 场机械暴君，两者不是同一个游戏（2026-11-08 审计发现）。
 * @param {number} floor 层数
 * @returns {Object} 首领配置（C.BOSS.kinds 的一项）
 */
function bossKindForFloorSim(floor) {
  const f = Math.max(1, Number(floor) || 1);
  if (f <= 6) return C.BOSS.kinds[0];
  if (f <= 12) return C.BOSS.kinds[1];
  if (f <= 18) return C.BOSS.kinds[2];
  return C.BOSS.kinds[Math.max(0, f - 19) % 3];
}

/**
 * 首领机制 V2 的层/身份分配（与补丁 boss-mech-v2.js 的 mechOf 同源）
 * ------------------------------------------------------------
 * 机械：F1–F5（及之后机械层）按层奇偶交替 液压合拢 / 熔核火柱；
 * 符文：F7 起挂 刻印按序；虚空：F13 起挂 引力潮汐。
 * @param {number} floor 层数
 * @param {string} kindId 首领身份
 * @param {boolean} on 是否启用（来自 overrides.bossMech2，默认关闭）
 * @returns {Object|null} 机制折算项（未启用/未命中返回 null）
 */
function pickBossMech2(floor, kindId, on, only) {
  if (!C.BOSS_MECH2 || !C.BOSS_MECH2.table) return null;
  if (!(on || C.BOSS_MECH2.enabled)) return null;
  const t = C.BOSS_MECH2.table;
  let mech = null;
  if (kindId === 'mech') mech = (Number(floor) % 2 === 1) ? t.press : t.beam;
  else if (kindId === 'rune') mech = Number(floor) >= 7 ? t.sigilOrder : null;
  else if (kindId === 'void') mech = Number(floor) >= 13 ? t.gravityTide : null;
  if (!mech) return null;
  // only 用于单独测量某一机制的难度；默认 null 表示全开
  return (only && mech.id !== only) ? null : mech;
}

/**
 * 首领血量与伤害（对应 bossStatsForFloor）。
 * @param {number} floor 层数
 * @param {Object} diff 难度
 * @returns {Object} { kind, hp, damage }
 */
function bossStats(floor, diff, ov) {
  const o = ov || {};
  // oldBossMap 仅用于修映射前后的同代码对照，不参与任何正式基线
  const kind = o.oldBossMap
    ? C.BOSS.kinds[((floor - 1) % 3 + 3) % 3]
    : bossKindForFloorSim(floor);
  const steps = Math.max(0, floor - 1);
  /* C1-11 评估入口：bossCapByFloor 允许按层指定首领上限（覆盖时优先生效）。
     C1-15 / B1：默认改为按层 cap(f) = hpCap × (1 + hpCapRampPerFloor × (f−1))。 */
  const capOverride = o.bossCapByFloor && o.bossCapByFloor[floor];
  let cap = capOverride || (C.BOSS.hpCap * (1 + (C.BOSS.hpCapRampPerFloor || 0) * steps));
  /* C1-15 硬闸门：F20 压系数（与主文件 bossHpCapForFloor 同步；显式覆盖时不生效） */
  if (!capOverride && floor >= 20) cap *= (C.BOSS.hpCapF20Scale || 1);
  const hpFloorOverride = (o.bossHpMulByFloor && o.bossHpMulByFloor[floor]) || 1;
  let hp = Math.min(cap, C.BOSS.hpBase * Math.pow(C.BOSS.hpFloorMul, steps) * diff.hpMul * (o.bossHpMul || 1) * hpFloorOverride);
  if (floor % 6 === 0) hp *= C.BOSS.regionBossHpMul;
  hp *= deepHpMulAt(floor);   // F19 起 ×1.1（与主文件 deepHpMulOf 对齐）
  hp = Math.round(Math.min(cap * 2, hp));
  let damage = Math.min(C.BOSS.damageCap, kind.contactDamage * Math.pow(1.08, steps) * diff.damageMul
    * C.BOSS.damageScale * (o.bossDamageMul || 1)
    * ((o.bossDamageMulByFloor && o.bossDamageMulByFloor[floor]) || 1));
  const band = C.BOSS.damageBandDamp;
  if (floor >= 12) damage *= band.deepMul;
  else if (floor >= band.midFrom && floor <= band.midTo) damage *= band.midMul;
  return { kind, hp, damage: Math.round(damage * 10) / 10 };
}

/**
 * 跑一局，返回本局结果与统计原始值。
 * @param {number} seed 本局种子
 * @param {Object} profile 操作档案
 * @param {string} difficulty 难度 id
 * @param {Object} overrides 敏感度覆盖参数
 * @returns {Object} 本局结果
 */
function runOne(seed, profile, difficulty, overrides) {
  const rng = mulberry32(seed);
  // E1 专用随机流：与主随机流完全分叉（同一 seed 派生，互不消耗）
  const e1rng = mulberry32(((seed ^ 0x5bd1e995) >>> 0));
  const ov = overrides || {};
  const p = createPlayer(profile, ov);
  // 探针：起手额外等级，用于评估"到 F2/F3 手牌不够"的影响
  // 记录每张"额外卡"到底是什么，用来判断它是真提升还是"第三张更贵的卡"
  const startCards = [];
  for (let i = 0; i < (ov.startLevels || 0); i += 1) {
    const before = p.magics.slice();
    const chosen = levelUp(p, rng);          // levelUp 内部已经 +1 级，不要再手动加
    if (chosen) {
      startCards.push({
        kind: chosen.kind,
        id: chosen.id,
        name: chosen.name,
        magicsBefore: before,
        magicsAfter: p.magics.slice(),
        magicChanged: before[0] !== p.magics[0] || before[1] !== p.magics[1]
      });
    }
  }
  const maxFloor = C.SIM_PARAMS.maxFloor;
  const result = {
    profile: profile.id,
    died: false,
    deathFloor: 0,
    deathRoom: null,
    clearedFloors: 0,
    income: 0,
    clearTimes: [],      // 每层平均清房时间
    damageByFloor: [],   // 每层总承伤
    primaryMagic: null,
    ownedMagic: {},
    techs: {},
    relics: {},
    fusionCount: 0,
    roomsCleared: 0,
    level: 1,
    seconds: 0,
    forgeUses: 0,              // B2-a 探针：熔炉房实际兑换了几次能力强化
    eliteDeaths: []            // 探针：精英房死亡样本（进场 3 秒分析用）
    , bossEntries: []         // 探针：F1-F5 首领入场时的 build 与结果
    , startCards: startCards  // 探针：E1 额外卡的实际内容
    , e1Cards: []             // 探针：清层后额外三选一的实际内容（e1CardAtFloor）
    , composition: []         // 探针：楼层/出怪组成（compositionTrace，用于种子一致性验证）
    , roomTrace: []            // 探针：逐房 [floor, type, count, seconds, died, totalHp]
  };
  let incomeBase = 0;
  let extraSpent = 0;
  let runGain = 0;
  /* 探针：回血方案（默认不启用，保证原有数值路径不变）
   * parity=true 时把进层/清房/精英击杀三类回复按主文件口径限制在节奏层，
   * 并补上主文件已有的 bossPulse，用来做"实机口径"基线。 */
  const plan = Object.assign({}, ov.healPlan || {});
  const parity = !!ov.healParity;
  if (parity && !plan.bossPulse) {
    plan.bossPulse = Object.assign(
      { fromFloor: C.ECONOMY.deepHeal.fromFloor, rhythmOnly: true },
      C.ECONOMY.deepHeal.bossPulse
    );
  }
  result.floorTrace = [];

  for (let floor = 1; floor <= maxFloor; floor += 1) {
    const diff = diffAt(floor, difficulty);
    p.phaseShieldUsed = false;
    // 探针：本层血量/治疗记账
    const hpIn = p.hp;
    let healEntry = 0;
    let healCombatRoom = 0;
    let healCombatBoss = 0;
    let healKill = 0;
    let healPulse = 0;
    let healClear = 0;
    let healElite = 0;
    let healRest = 0;
    let healEvent = 0;
    let hpMin = p.hp;
    let floorBossDamage = 0;
    const rhythmGate = !parity || isRhythmFloor(floor);

    // 进层回复（默认口径：第 2 层起每层都回；parity 口径：仅节奏层）
    if (floor > 1 && rhythmGate) {
      healEntry += applyHeal(p, p.hpMax * C.ECONOMY.entryHealRatio * (ov.healMul || 1) * (ov.deepHealMul || 1));
    }
    if (plan.entry && floor >= (plan.entry.fromFloor || 0)
      && (!plan.entry.onlyNonRhythm || !isRhythmFloor(floor))) {
      healEntry += applyHeal(p, p.hpMax * plan.entry.ratio * (ov.healMul || 1));
    }
    if (p.hp < hpMin) hpMin = p.hp;

    const rooms = generateRooms(rng, floor, profile, ov);
    /* 种子一致性探针：记录本层房间类型与每间战斗/精英房的出怪 id。
       用于验证"额外一次三选一不会改变楼层布局与出怪"（E1 的硬前置）。 */
    const traceRec = ov.compositionTrace
      ? { floor, types: rooms.map((r) => r.type), encounters: [], complete: false }
      : null;
    if (traceRec) result.composition.push(traceRec);
    let floorClearSeconds = 0;
    let floorClearRooms = 0;
    let floorDamage = 0;
    let floorDied = false;
    // 探针：本层首领战时长/结果（F1–F6 分布表与 F2 首领画像用）
    let floorBossSeconds = 0;
    let bossFightInfo = null;

    for (let ri = 0; ri < rooms.length; ri += 1) {
      const room = rooms[ri];
      const mods = collectMods(p, ov);

      if (room.type === 'start') continue;   // 出生房无战斗、无奖励
      if (room.type === 'chest') {
        incomeBase += C.ROOM.chestCrystal;
        continue;
      }
      if (room.type === 'rest') {
        healRest += applyHeal(p, p.hpMax * C.ROOM.restHealRatio);
        if (p.hp < hpMin) hpMin = p.hp;
        continue;
      }
      if (room.type === 'forge') {
        /* B2-a 熔炉房：用余烬换一次能力强化（等价于主文件的一次刻印）。
           阶梯按本房计 4/6/8，但一间房通常只够付首次，这里只建模首档，
           与"按本房计不按本局计"的定稿一致。 */
        const cost = C.ROOM.forgeEmberCost;
        if (p.embers >= cost) {
          p.embers -= cost;
          result.forgeUses += 1;
          levelUp(p, rng);
        }
        continue;
      }
      if (room.type === 'event') {
        // 事件房：一半概率给医疗（+34），一半给结晶额度
        if (rng() < 0.5) {
          healEvent += applyHeal(p, 34);
          if (p.hp < hpMin) hpMin = p.hp;
        } else if (extraSpent < C.ECONOMY.extraBudget) { extraSpent += 1; }
        continue;
      }

      if (room.type === 'boss') {
        const stats = bossStats(floor, diff, ov);
        /* 探针：首领房入场补给（P2：按"已损生命"比例回复；默认 0 = 不改）。
           必须在采样 entryHp 之前生效，否则 entryHp 记录的是补给前的血量。 */
        const entryHealFrac = (ov.bossEntryHealFracByFloor && ov.bossEntryHealFracByFloor[floor]) || 0;
        let healBossEntry = 0;
        if (entryHealFrac > 0 && p.hp < p.hpMax) {
          healBossEntry = applyHeal(p, (p.hpMax - p.hp) * entryHealFrac);
        }
        const entryOff = (floor <= 5) ? playerOffense(p, 1, mods, ov, C.BOSS.aetherRegenMul) : null;
        const entrySample = (floor <= 5) ? {
          floor,
          profile: p.profile.id,
          level: p.level,
          hp: p.hp,
          hpMax: p.hpMax,
          bossHp: stats.hp,
          bossDamage: stats.damage,
          singleDps: entryOff.dps,
          healPerSec: entryOff.healPerSec,
          magics: p.magics.slice(),
          techs: Object.keys(p.techs || {}).filter((k) => p.techs[k]),
          relics: Object.keys(p.relics || {}).filter((k) => p.relics[k]),
          roomsCleared: p.roomsCleared,
          died: false,
          seconds: 0,
          damage: 0
        } : null;
        /* 探针：按层缩放首领血量（P1 单层验证用；默认 1 = 不改） */
        const bossHpScale = (ov.bossHpScaleByFloor && ov.bossHpScaleByFloor[floor]) || 1;
        const fight = simulateBoss(p, {
          floor, boss: stats.kind, hp: stats.hp * bossHpScale, damage: stats.damage, diff, mods, ov, healPlan: plan
        });
        if (entrySample) {
          entrySample.died = fight.died;
          entrySample.seconds = fight.seconds;
          entrySample.damage = fight.damage;
          entrySample.hpLeft = p.hp;
          result.bossEntries.push(entrySample);
        }
        floorDamage += fight.damage;
        floorBossDamage += fight.damage;
        floorClearSeconds += fight.seconds;
        floorBossSeconds += fight.seconds;
        bossFightInfo = {
          seconds: +fight.seconds.toFixed(2),
          died: !!fight.died,
          timedOut: !!fight.timedOut,
          deathAt: +(fight.deathAt || 0).toFixed(2),
          bossHpLeftPct: fight.bossHpLeftPct == null ? null : +fight.bossHpLeftPct.toFixed(1),
          entryHp: entrySample ? entrySample.hp : null,
          entryHpMax: p.hpMax,
          entryLevel: p.level,
          entryHeal: +healBossEntry.toFixed(1)
        };
        result.seconds += fight.seconds;
        result.roomTrace.push({
          floor, type: 'boss', count: 1,
          seconds: fight.seconds, died: !!fight.died,
          damage: fight.damage, totalHp: stats.hp * bossHpScale
        });
        healCombatBoss += fight.healed + healBossEntry;
        healPulse += fight.pulseHeal || 0;
        if (fight.minHp < hpMin) hpMin = fight.minHp;
        if (fight.died) {
          result.died = true;
          result.deathFloor = floor;
          result.deathRoom = 'boss';
          floorDied = true;
          break;
        }
        // 击杀首领：经验 + 宝箱结晶
        gainXp(p, C.XP.killXp.boss, rng);
        incomeBase += C.ECONOMY.bossChestCrystals;
        floorClearRooms += 1;
        continue;
      }

      // 战斗房 / 精英房
      const enc = buildEncounter(rng, floor, room.type, diff, ov);
      if (traceRec) traceRec.encounters.push({ room: room.type, ids: enc.enemyIds.slice(), count: enc.enemyIds.length });
      const eliteTuneNow = (room.type === 'elite' && ov.eliteTune && floor >= (ov.eliteTune.fromFloor || 0))
        ? ov.eliteTune : null;
      const fight = simulateRoom(p, { floor, type: room.type, enemyIds: enc.enemyIds, hpList: enc.hpList, elite: enc.elite, mix: enc.mix, damageMul: enc.damageMul, hasSelfdestruct: enc.hasSelfdestruct, mods, ov, healPlan: plan, clearKills: eliteTuneNow ? eliteTuneNow.clearKills : 0 });
      floorDamage += fight.damage;
      floorClearSeconds += fight.seconds;
      result.seconds += fight.seconds;
      result.roomTrace.push({
        floor, type: room.type, count: enc.enemyIds.length,
        seconds: fight.seconds, died: !!fight.died,
        damage: fight.damage, totalHp: enc.totalHp
      });
      healCombatRoom += fight.healed;
      healKill += fight.killHeal || 0;
      if (fight.minHp < hpMin) hpMin = fight.minHp;
      if (fight.died) {
        if (room.type === 'elite') {
          result.eliteDeaths.push({
            floor,
            profile: p.profile.id,
            level: p.level,
            hpMax: p.hpMax,
            entryHp: fight.entryHp,
            deathTime: fight.deathTime,
            killed: fight.killed,
            entryIncoming: fight.entryIncoming,
            entryNetDps: fight.entryNetDps,
            firstStageTime: fight.firstStageTime,
            firstStageGross: fight.firstStageGross,
            enemyCount: enc.enemyIds.length,
            mix: enc.mix,
            totalHp: enc.totalHp,
            damage: fight.damage,
            killHeal: fight.killHeal,
            magics: Object.keys(p.magics || {}),
            techs: Object.keys(p.techs || {}).filter((k) => p.techs[k]),
            relics: Object.keys(p.relics || {}).filter((k) => p.relics[k])
          });
        }
        result.died = true;
        result.deathFloor = floor;
        result.deathRoom = room.type;
        floorDied = true;
        break;
      }
      /* B2-a：击杀累积余烬（普通 1 / 只、精英 3 / 只），供熔炉房消费 */
      p.embers += enc.enemyIds.length
        * (room.type === 'elite' ? C.ROOM.emberPerEliteKill : C.ROOM.emberPerKill);
      for (let k = 0; k < enc.enemyIds.length; k += 1) {
        gainXp(p, C.XP.killXp.normal, rng);
        // 精英击杀回复（默认口径每层都回；parity 只算节奏层）
        if (room.type === 'elite' && rhythmGate) {
          healElite += applyHeal(p, p.hpMax * C.ECONOMY.eliteKillHealRatio * (ov.healMul || 1) * (ov.deepHealMul || 1));
        }
      }
      // 清空一间有怪房回复（同上门控）
      if (rhythmGate) {
        healClear += applyHeal(p, p.hpMax * C.ECONOMY.roomClearHealRatio * (ov.healMul || 1) * (ov.deepHealMul || 1));
      }
      if (plan.clear && floor >= (plan.clear.fromFloor || 0)) {
        healClear += applyHeal(p, p.hpMax * plan.clear.ratio * (ov.healMul || 1));
      }
      if (p.hp < hpMin) hpMin = p.hp;
      floorClearRooms += 1;
    }

    if (floorDied) {
      result.clearTimes.push(floorClearRooms ? floorClearSeconds / floorClearRooms : 0);
      result.damageByFloor.push(floorDamage);
      result.floorTrace.push({
        floor, hpIn, hpAfterEntry: Math.min(p.hpMax, hpIn + healEntry), hpMin: hpMin, hpOut: 0,
        dmg: floorDamage, dmgBoss: floorBossDamage,
        healEntry, healCombatRoom, healCombatBoss, healKill, healPulse, healClear, healElite, healRest, healEvent,
        died: true, deathRoom: result.deathRoom, rooms: floorClearRooms,
        clearSeconds: +floorClearSeconds.toFixed(2), bossSeconds: +floorBossSeconds.toFixed(2),
        boss: bossFightInfo
      });
      break;
    }

    // 清层奖励
    if (traceRec) traceRec.complete = true;
    result.clearedFloors = floor;
    incomeBase += C.ECONOMY.clearCrystals;
    result.clearTimes.push(floorClearRooms ? floorClearSeconds / floorClearRooms : 0);
    result.damageByFloor.push(floorDamage);
    result.floorTrace.push({
      floor, hpIn, hpAfterEntry: Math.min(p.hpMax, hpIn + healEntry), hpMin: hpMin, hpOut: p.hp,
      dmg: floorDamage, dmgBoss: floorBossDamage,
      healEntry, healCombatRoom, healCombatBoss, healKill, healPulse, healClear, healElite, healRest, healEvent,
      died: false, deathRoom: null, rooms: floorClearRooms,
      clearSeconds: +floorClearSeconds.toFixed(2), bossSeconds: +floorBossSeconds.toFixed(2),
      boss: bossFightInfo
    });
    /* E1 探针：本层清层后额外一次三选一。
       用独立随机流（由种子派生），保证主随机流一次都不多消耗 —— 这也是实机补丁
       "同种子同局"的模拟验证方式（主线不消费随机，楼层生成不受影响）。 */
    if (ov.e1CardAtFloor === floor) {
      const beforeMagics = p.magics.slice();
      const rec = { choices: [], effective: [], allDud: false };
      const chosen = levelUp(p, e1rng, (info) => Object.assign(rec, info));
      if (chosen) {
        result.e1Cards.push({
          floor,
          level: p.level,
          xp: p.xp,
          xpNeed: p.xpNeed,
          kind: chosen.kind,
          id: chosen.id,
          name: chosen.name,
          magicsBefore: beforeMagics,
          magicsAfter: p.magics.slice(),
          magicChanged: beforeMagics[0] !== p.magics[0] || beforeMagics[1] !== p.magics[1],
          choices: rec.choices.map((o, i) => ({ kind: o.kind, id: o.id, effective: rec.effective[i] })),
          allDud: rec.allDud
        });
      }
    }
  }
  let income = incomeBase + extraSpent;
  income = Math.round(income * (1 + 0) * (ov.crystalMul || 1));
  income = Math.min(C.ECONOMY.runMax, income);
  runGain = income;

  // ---------- 汇总 build ----------
  result.primaryMagic = p.magics[0];
  p.magics.forEach((id) => { result.ownedMagic[id] = true; });
  Object.keys(p.techs).forEach((id) => { result.techs[id] = true; });
  Object.keys(p.relics).forEach((id) => { result.relics[id] = p.relics[id]; });
  result.fusionCount = Object.keys(p.fusions).length;
  result.roomsCleared = p.roomsCleared;
  result.level = p.level;
  result.hpLeft = p.hp;
  result.income = income;
  result.damageTotal = result.damageByFloor.reduce((s, v) => s + v, 0);
  return result;
}

/**
 * 发经验并处理升级（可连续多级）。
 * @param {Object} p 玩家
 * @param {number} amount 经验
 * @param {Function} rng 随机函数
 * @returns {void}
 */
function gainXp(p, amount, rng) {
  p.xp += amount;
  let guard = 0;
  while (p.xp >= p.xpNeed && guard < 8) {
    guard += 1;
    p.xp -= p.xpNeed;
    // 注意：等级只在这里由 levelUp 内部 +1 一次，不要再手动 p.level += 1
    // （旧版两处都加，导致等级翻倍、xp 曲线提前变陡，手牌数量被系统性低估）
    levelUp(p, rng);
    p.xpNeed = Math.round(C.XP.baseNeed * Math.pow(C.XP.growth, p.level - 1));
  }
}

/* ---------------------------------------------------------------------------
 * 统计聚合
 * ------------------------------------------------------------------------- */

/**
 * 创建一个空聚合器。
 * @returns {Object} 聚合器
 */
function createAgg() {
  const perFloor = () => ({
    reached: 0, cleared: 0, died: 0,
    clearSum: 0, clearN: 0, clearMax: 0,
    dmgSum: 0, dmgN: 0, dmgMax: 0,
    dmgHist: new Array(50).fill(0),       // 0-500 生命，10 一档
    clearHist: new Array(60).fill(0)      // 0-240 秒，4 秒一档
  });
  return {
    runs: 0,
    reached: new Array(21).fill(0),
    cleared: new Array(21).fill(0),
    deathFloor: new Array(21).fill(0),
    deathRoom: { battle: 0, elite: 0, boss: 0 },
    floors: Array.from({ length: 21 }, perFloor),
    income: { n: 0, sum: 0, max: 0, hist: new Array(41).fill(0) },
    incomeByFloor: new Array(21).fill(0),
    primaryMagic: {},
    ownedMagic: {},
    techs: {},
    relics: {},
    fusionRuns: 0,
    fusionTotal: 0,
    clearRooms: 0,
    seconds: 0,
    levels: 0,
    completed5: 0
  };
}

/**
 * 把一局结果并入聚合器。
 * @param {Object} agg 聚合器
 * @param {Object} r 单局结果
 * @returns {void}
 */
function addRun(agg, r) {
  agg.runs += 1;
  for (let f = 1; f <= r.clearTimes.length; f += 1) {
    agg.reached[f] += 1;
    if (r.clearedFloors >= f) agg.cleared[f] += 1;
    // 清房时间（按层平均）
    const fl = agg.floors[f];
    const ct = r.clearTimes[f - 1] || 0;
    fl.clearSum += ct;
    fl.clearN += 1;
    if (ct > fl.clearMax) fl.clearMax = ct;
    const cbin = Math.min(59, Math.floor(ct / 4));
    fl.clearHist[cbin] += 1;
    // 承伤（按层）
    const dm = r.damageByFloor[f - 1] || 0;
    fl.dmgSum += dm;
    fl.dmgN += 1;
    if (dm > fl.dmgMax) fl.dmgMax = dm;
    fl.dmgHist[Math.min(49, Math.floor(dm / 10))] += 1;
  }
  if (r.died) {
    agg.deathFloor[r.deathFloor] += 1;
    agg.deathRoom[r.deathRoom] = (agg.deathRoom[r.deathRoom] || 0) + 1;
  }
  if (r.clearedFloors >= 5) agg.completed5 += 1;
  agg.income.n += 1;
  agg.income.sum += r.income;
  agg.income.max = Math.max(agg.income.max, r.income);
  agg.income.hist[Math.min(40, Math.round(r.income))] += 1;
  agg.clearRooms += r.roomsCleared;
  agg.seconds += r.seconds;
  agg.levels += r.level;
  agg.fusionRuns += r.fusionCount > 0 ? 1 : 0;
  agg.fusionTotal += r.fusionCount;
  if (r.primaryMagic) {
    agg.primaryMagic[r.primaryMagic] = (agg.primaryMagic[r.primaryMagic] || 0) + 1;
  }
  Object.keys(r.ownedMagic).forEach((id) => { agg.ownedMagic[id] = (agg.ownedMagic[id] || 0) + 1; });
  Object.keys(r.techs).forEach((id) => { agg.techs[id] = (agg.techs[id] || 0) + 1; });
  Object.keys(r.relics).forEach((id) => { agg.relics[id] = (agg.relics[id] || 0) + 1; });
}

/**
 * 合并两个聚合器（多进程汇总用）。
 * @param {Object} a 目标
 * @param {Object} b 来源
 * @returns {Object} a
 */
function mergeAgg(a, b) {
  a.runs += b.runs;
  for (let i = 0; i < 21; i += 1) {
    a.reached[i] += b.reached[i];
    a.cleared[i] += b.cleared[i];
    a.deathFloor[i] += b.deathFloor[i];
    a.incomeByFloor[i] += b.incomeByFloor[i];
    const fa = a.floors[i];
    const fb = b.floors[i];
    fa.reached += fb.reached;
    fa.cleared += fb.cleared;
    fa.died += fb.died;
    fa.clearSum += fb.clearSum; fa.clearN += fb.clearN;
    fa.clearMax = Math.max(fa.clearMax, fb.clearMax);
    fa.dmgSum += fb.dmgSum; fa.dmgN += fb.dmgN;
    fa.dmgMax = Math.max(fa.dmgMax, fb.dmgMax);
    for (let j = 0; j < 50; j += 1) fa.dmgHist[j] += fb.dmgHist[j];
    for (let j = 0; j < 60; j += 1) fa.clearHist[j] += fb.clearHist[j];
  }
  ['battle', 'elite', 'boss'].forEach((k) => { a.deathRoom[k] += b.deathRoom[k]; });
  a.income.n += b.income.n;
  a.income.sum += b.income.sum;
  a.income.max = Math.max(a.income.max, b.income.max);
  for (let i = 0; i < 41; i += 1) a.income.hist[i] += b.income.hist[i];
  ['primaryMagic', 'ownedMagic', 'techs', 'relics'].forEach((key) => {
    Object.keys(b[key]).forEach((id) => { a[key][id] = (a[key][id] || 0) + b[key][id]; });
  });
  a.fusionRuns += b.fusionRuns;
  a.fusionTotal += b.fusionTotal;
  a.clearRooms += b.clearRooms;
  a.seconds += b.seconds;
  a.levels += b.levels;
  a.completed5 += b.completed5;
  return a;
}

/**
 * 直方图分位数。
 * @param {Array<number>} hist 分箱计数
 * @param {number} binSize 每箱宽度
 * @param {number} q 0~1
 * @returns {number} 近似分位值
 */
function histPercentile(hist, binSize, q) {
  const total = hist.reduce((s, v) => s + v, 0);
  if (!total) return 0;
  const target = total * q;
  let acc = 0;
  for (let i = 0; i < hist.length; i += 1) {
    acc += hist[i];
    if (acc >= target) return i * binSize + binSize / 2;
  }
  return hist.length * binSize;
}

module.exports = {
  mulberry32, runSeed, runOne, createAgg, addRun, mergeAgg, histPercentile,
  magicById, collectMods, playerOffense, bossStats, diffAt, isRhythmFloor
};
