/* ============================================================================
 * 《烬》数值模拟器 · 可读配置
 * ----------------------------------------------------------------------------
 * 本文件是"从主文件 index_arcane_v2.html 抽出来的战斗数值副本"，不参与游戏运行。
 * 抽取原则：
 *   1) 只抄影响战斗/经济结果的数值，美术、演出、UI 参数一律不进；
 *   2) 每一项都标注主文件中的来源符号名，方便回到原文件核对；
 *   3) 主文件不改动，这里的改动只影响离线模拟与面板。
 *
 * 重新核对的方法：在主文件里搜索下面注释中的符号名（例如 GAME_CONFIG）。
 * ============================================================================ */
'use strict';

/* ---------------------------------------------------------------------------
 * 1. 全局战斗参数（来源：GAME_CONFIG，主文件 L5677）
 * ------------------------------------------------------------------------- */
const GAME = {
  baseHp: 100,              // 初始生命
  baseAether: 100,          // 初始奥能上限
  baseRegen: 16,            // 奥能自然回复 / 秒（方案 A 供给侧：8 → 16）
  killAether: 6,            // 击杀单只非首领回复奥能
  contactDamage: 7,         // 敌人接触伤害基数
  contactInterval: 0.85,    // 单只敌人两次接触伤害间隔
  contactLock: 0.32,        // 玩家侧全局接触伤害冷却（防止 6 只叠加）
  floorScale: 1.07,         // 单只敌人血量 ×1.07^层
  /* C1-11 调参：非首领怪基础血量 −10%（主文件 ENEMY_BUDGET_CONFIG.globalHpMul） */
  enemyHpMul: 0.9,
  speedScaleCap: 1.8,       // 敌人速度缩放上限
  playerSpeed: 230,         // 玩家移速（用于估算走图开销）
  finalFloor: 5,            // 正式一局 5 层通关
  talentMaxLevel: 5
};

/* ---------------------------------------------------------------------------
 * 2. 难度三档（来源：DIFFICULTY_CONFIG，主文件 L7171）
 * 注：前 5 层是教学层，主文件 onboardActiveFloor() 强制使用 normal 档，
 *     所以难度倍率只在第 6 层（无尽下潜）之后生效。
 * ------------------------------------------------------------------------- */
const DIFFICULTY = {
  easy:      { id: 'easy',      label: '简单', hpMul: 2.05, countMul: 0.75, speedMul: 0.9,  damageMul: 0.44, dropMul: 1.25, eliteHpMul: 0.85, pressure: 0.8 },
  normal:    { id: 'normal',    label: '普通', hpMul: 2.60, countMul: 1.00, speedMul: 1.0,  damageMul: 0.49, dropMul: 1.00, eliteHpMul: 1.00, pressure: 1.0 },
  nightmare: { id: 'nightmare', label: '困难', hpMul: 2.70, countMul: 1.05, speedMul: 1.08, damageMul: 0.54, dropMul: 0.85, eliteHpMul: 1.20, pressure: 1.12 }
};

/* 楼层压力（来源：DIFFICULTY_CONFIG.pressure + difficultyPressure()，L7175 / L7595）
 * pressure = min(1.25, (1 + (层-1)×hpStep) × 难度pressure) */
const PRESSURE = { hpStep: 0.02, countStep: 0.08, maxMul: 1.25 };

/* 深层档位（来源：REGION_CONFIG.deepStart / regionConfig.deep，主文件 L7915 / L10904）
 * F19 起每 5 层一档，每档总血 +10%，6 档封顶；F≤20 只会吃到第 1 档（×1.1）。
 * 旧版模拟器漏了这条，F19/F20 的 Boss 血量比实机低 10%。 */
const REGION_DEEP = { startFloor: 19, tierEvery: 5, maxTier: 6, hpPerTier: 0.10 };

/* 教学层（来源：ONBOARD_CONFIG，L45425） */
const ONBOARD = {
  maxFloors: 5,
  enemyCountMul: 0.8,                       // 前五层敌人数 -20%
  floor1CountCap: 3,                        // 第 1 层单房敌人数上限
  weakFloor1: { hpMul: 0.6, speedMul: 0.8, damageMul: 0.7 }
};

/* ---------------------------------------------------------------------------
 * 3. 敌人表（来源：ENEMY_CONFIG，主文件 L9911）
 * hp 为基础血量，实际生成还要乘：1.07^层 × 难度hpMul × 楼层压力 × hpScale × 精英倍率
 * role 来自 ENEMY_AI_V2_ROLES（L14628），只用于承伤估算。
 * ------------------------------------------------------------------------- */
const ENEMY_TYPES = {
  /* 机械层（F1-6） */
  assembler:  { id: 'assembler',  name: '装配体',     hp: 36, damage: 7,  ai: 'chaser', role: 'summon' },
  welder:     { id: 'welder',     name: '焊工构装',   hp: 44, damage: 5,  ai: 'shooter', role: 'suppress', fireInterval: 2.4 },
  patrol:     { id: 'patrol',     name: '巡检机',     hp: 62, damage: 8,  ai: 'chaser', role: 'orbit' },
  riveter:    { id: 'riveter',    name: '铆钉炮台',   hp: 56, damage: 6,  ai: 'shooter', role: 'burst', fireInterval: 1.9 },
  crawler:    { id: 'crawler',    name: '履带爬行者', hp: 28, damage: 6,  ai: 'chaser', role: 'rush' },
  /* 符文层（F7-12） */
  runesprite: { id: 'runesprite', name: '符灵',       hp: 32, damage: 6,  ai: 'chaser', role: 'orbit' },
  graveter:   { id: 'graveter',   name: '碑卫',       hp: 64, damage: 9,  ai: 'chaser', role: 'burst' },
  hexer:      { id: 'hexer',      name: '咒术体',     hp: 46, damage: 5,  ai: 'shooter', role: 'suppress', fireInterval: 2.5 },
  cipher:     { id: 'cipher',     name: '密文术士',   hp: 40, damage: 5,  ai: 'shooter', role: 'summon', fireInterval: 2.9 },
  warden:     { id: 'warden',     name: '戍卫碑像',   hp: 80, damage: 11, ai: 'chaser', role: 'rush' },
  /* 虚空层（F13-18） */
  stalker:    { id: 'stalker',    name: '潜行者',     hp: 42, damage: 8,  ai: 'blink', role: 'orbit' },
  shardling:  { id: 'shardling',  name: '裂隙残片',   hp: 26, damage: 6,  ai: 'chaser', role: 'rush', selfdestruct: true },
  devourer:   { id: 'devourer',   name: '虚空吞噬者', hp: 92, damage: 12, ai: 'chaser', role: 'burst' },
  riftling:   { id: 'riftling',   name: '裂隙幼体',   hp: 33, damage: 6,  ai: 'blink', role: 'summon' },
  screamer:   { id: 'screamer',   name: '尖啸者',     hp: 50, damage: 6,  ai: 'shooter', role: 'suppress', fireInterval: 2.5 },
  /* 楼层专属（来源：ENEMY_CONFIG floorOnly） */
  forgepriest: { id: 'forgepriest', name: '炉心祭司', hp: 96, damage: 8, ai: 'shooter', role: 'burst', fireInterval: 2.2, floorOnly: [4] },
  voidbishop:  { id: 'voidbishop',  name: '虚空主教', hp: 88, damage: 10, ai: 'chaser', role: 'rush', floorOnly: [5] }
};

/* 区域怪物池（来源：REGION_ENEMY_POOLS，L10574）
 * 大区：F1-6=机械、F7-12=符文、F13-18=虚空、F19+=混合（REGION_CONFIG） */
const REGION_POOLS = {
  mech: ['assembler', 'welder', 'patrol', 'riveter', 'crawler'],
  rune: ['runesprite', 'graveter', 'hexer', 'cipher', 'warden'],
  void: ['stalker', 'shardling', 'devourer', 'riftling', 'screamer'],
  mixed: ['stalker', 'shardling', 'devourer', 'riftling', 'screamer',
          'runesprite', 'graveter', 'hexer', 'cipher', 'warden',
          'assembler', 'welder', 'patrol', 'riveter', 'crawler']
};

/* 每层战斗房 / 精英房敌人数区间与单只血量倍率（来源：ENEMY_BUDGET_CONFIG.rampByFloor，L10510） */
const RAMP_BY_FLOOR = {
  1: { battle: [4, 4], elite: [3, 3], hpScale: 1.543 },
  2: { battle: [4, 4], elite: [3, 3], hpScale: 0.961 },
  3: { battle: [5, 5], elite: [4, 4], hpScale: 0.800 },
  4: { battle: [5, 5], elite: [4, 4], hpScale: 0.546 },
  5: { battle: [5, 6], elite: [4, 5], hpScale: 0.550 },
  6: { battle: [7, 7], elite: [5, 5], hpScale: 0.515 },
  7: { battle: [7, 7], elite: [5, 5], hpScale: 0.467 },
  8: { battle: [7, 8], elite: [5, 6], hpScale: 0.428 },
  9: { battle: [8, 8], elite: [6, 6], hpScale: 0.394 },
  10: { battle: [8, 8], elite: [6, 6], hpScale: 0.394 },
  11: { battle: [8, 8], elite: [6, 6], hpScale: 0.388 },
  12: { battle: [8, 8], elite: [6, 6], hpScale: 0.385 },
  13: { battle: [8, 8], elite: [6, 6], hpScale: 0.395 },
  14: { battle: [8, 8], elite: [6, 6], hpScale: 0.400 },
  15: { battle: [8, 8], elite: [6, 6], hpScale: 0.406 },
  16: { battle: [8, 8], elite: [6, 6], hpScale: 0.414 },
  17: { battle: [8, 8], elite: [6, 6], hpScale: 0.422 },
  18: { battle: [8, 8], elite: [6, 6], hpScale: 0.429 },
  19: { battle: [8, 8], elite: [6, 6], hpScale: 0.478 },
  20: { battle: [8, 9], elite: [6, 7], hpScale: 0.466 }
};

/* 精英房额外参数（来源：ELITE_ROUTE_CONFIG，L14720）
 * 精英路线房：数量 ×1.4（上限 8）、血量 ×1.35、每只怪精英化再 ×2.2 血
 * 注意：第 6 层起走 ENEMY_BUDGET_CONFIG 预算区间的房间不吃 ×1.4（见 FLOOR_GEN） */
const ELITE_ROOM = { countMul: 1.4, countCap: 8, hpMul: 1.35 };

/* 楼层生成预算（来源：FLOOR_GEN_CONFIG，主文件 L10790–L10810）
 * budgetFrom：从第 6 层起，战斗/精英房敌人数改用 rampByFloor 硬区间，不再叠 ×1.4；
 * enemyCountCap：基础上限 7，但上限 = max(7, 区间上界)，所以 F20 战斗房可以是 9 只。 */
const FLOOR_GEN = { budgetFrom: 6, enemyCountCap: 7 };

/* 房间类型权重（来源：ROOM_TYPE_CONFIG.weights，L11072）
 * 每层固定 5 间：1 出生房 + 3 内容房 + 1 首领房（GAME_CONFIG.floorMinRooms=5） */
const ROOM = {
  roomsPerFloor: 5,
  contentRooms: 3,
  weights: { battle: 3, elite: 1, chest: 1, event: 1, rest: 1 },
  eliteWeightFloor2: 2,          // 第 2 层起精英权重提高
  restHealRatio: 0.3,            // 休整房回复 30% 最大生命
  chestCrystal: 1,               // 宝箱房即时结晶
  /* B2-a 熔炉房：只覆盖"确实带熔炉"的层（与主文件 applyRoomMixPlan 的层计划一致），
     其余层继续走上面的随机权重，保证四口径可与历史基线逐层对比。
     F4 主文件：battle / elite / shop → 熔炉替代商店
     F13 主文件：battle / rest / chest → 熔炉替代宝箱 */
  plan: {
    4: ['battle', 'elite', 'forge'],
    13: ['battle', 'rest', 'forge']
  },
  forgeEmberCost: 4,            // 熔炉首次刻印价（ENGRAVE_CONFIG.forgeLadder[0]）
  emberPerKill: 1,              // 普通击杀余烬（U11_CONFIG.emberPerKill）
  emberPerEliteKill: 3          // 精英击杀余烬（U11_CONFIG.emberPerElite）
};

/* ---------------------------------------------------------------------------
 * 4. 魔法卡（来源：MAGIC_CONFIG，主文件 L8726；AOE_SKILL_CONFIG，L8816）
 * damage 为单发面板伤害，cost 为奥能消耗，cooldown 为冷却（秒）。
 * aoe=true 表示一次可命中多个目标（群体系数见 sim.js）。
 * ------------------------------------------------------------------------- */
const MAGIC = [
  { id: 'fireball',      name: '火球',     cost: 15, cooldown: 0.55, damage: 24, aoe: false, tag: '投射' },
  { id: 'frost',         name: '冰环',     cost: 25, cooldown: 1.80, damage: 16, aoe: true,  tag: '范围' },
  { id: 'bolt',          name: '雷击',     cost: 30, cooldown: 2.20, damage: 28, aoe: true,  tag: '连锁' },
  { id: 'heal',          name: '治疗符',   cost: 28, cooldown: 3.20, damage: 0,  heal: 30, aoe: false, tag: '恢复' },
  { id: 'blade',         name: '回旋刃',   cost: 20, cooldown: 1.40, damage: 18, aoe: false, tag: '回旋' },
  { id: 'mine',          name: '符文雷',   cost: 22, cooldown: 2.60, damage: 40, aoe: true,  tag: '布防' },
  { id: 'lavaFissure',   name: '熔岩地裂', cost: 24, cooldown: 2.40, damage: 46, aoe: true,  tag: '范围' },
  { id: 'arcanePool',    name: '奥术雷池', cost: 30, cooldown: 3.00, damage: 22, aoe: true,  tag: '范围' },
  { id: 'runeOrbit',     name: '符文轨道', cost: 26, cooldown: 2.80, damage: 34, aoe: true,  tag: '范围' },
  { id: 'collapseHole',  name: '坍缩黑洞', cost: 32, cooldown: 3.20, damage: 52, aoe: true,  tag: '范围' },
  { id: 'flameCone',     name: '喷火锥',   cost: 22, cooldown: 2.20, damage: 30, aoe: true,  tag: '范围' },
  { id: 'frostRing',     name: '冰霜环',   cost: 25, cooldown: 2.60, damage: 28, aoe: true,  tag: '范围' }
];

/* 双槽并联回路（来源：DUAL_CONFIG，L8662） */
const DUAL = { enabled: true, secondaryDamage: 0.8, secondaryCooldown: 1.45, secondaryCost: 0.9, switchTime: 0.35, autoFill: true };

/* 暴击（来源：FEEL_CONFIG.critChance / critMul，L8105） */
const CRIT = { chance: 0.12, mul: 1.6 };

/* ---------------------------------------------------------------------------
 * 5. 科技卡（来源：TECH_CONFIG，主文件 L8966）
 * 只抽会影响战斗结果的被动/装置；数值型效果在 sim.js 里转成倍率。
 * ------------------------------------------------------------------------- */
const TECH = {
  concentrator: { id: 'concentrator', name: '聚能模块', regenBonus: 2 },          // 奥能回复 +2/s
  field:        { id: 'field',        name: '力场发生器', takenMul: 0.85 },        // 受到伤害 -15%
  capacitor:    { id: 'capacitor',    name: '电容',     aetherMaxBonus: 30 },      // 奥能上限 +30（提高续航）
  nanite:       { id: 'nanite',       name: '纳米机器人', healPerSec: 1.2 },        // 每秒回复 1.2 生命
  magnet:       { id: 'magnet',       name: '磁吸',     utility: true },           // 拾取范围（不影响战斗）
  amp:          { id: 'amp',          name: '增幅',     damageMul: 1.08 },         // 技能伤害 +8%
  phase:       { id: 'phase',         name: '相位甲',   cheatDeathPerFloor: 1 },    // 每层 1 次致死免伤
  rewind:      { id: 'rewind',        name: '时序器',   cdResetChance: 0.12 }      // 击杀 12% 重置冷却
};

/* ---------------------------------------------------------------------------
 * 6. 遗物（来源：RELIC_CONFIG，主文件 L9285）
 * ------------------------------------------------------------------------- */
const RELIC = {
  hp:          { id: 'hp',          name: '强化机体', maxStacks: 4, hpBonus: 15 },          // 最大生命 +15
  regen:       { id: 'regen',       name: '奥能循环', maxStacks: 3, regenBonus: 1.5 },      // 奥能回复 +1.5/s
  power:       { id: 'power',       name: '符文增幅', maxStacks: 4, damageMul: 1.12 },      // 技能伤害 +12%
  haste:       { id: 'haste',       name: '快速咏唱', maxStacks: 3, cooldownMul: 0.9 },     // 冷却 -10%
  swift:       { id: 'swift',       name: '轻步',     maxStacks: 3, speedMul: 1.08 },       // 移速 +8%
  lastStand:   { id: 'lastStand',   name: '背水',     maxStacks: 1, lowHpDamageMul: 1.3 },  // 血量<40% 伤害 +30%
  overflow:    { id: 'overflow',    name: '溢流',     maxStacks: 1, highAetherDamageMul: 1.22 }, // 奥能>75% 伤害 +22%
  firstStrike: { id: 'firstStrike', name: '先手',     maxStacks: 1, firstHitsMul: 1.5 },    // 每房前 3 次命中 ×1.5
  momentum:    { id: 'momentum',    name: '惯性',     maxStacks: 1, movingDamageMul: 1.18 }, // 移动中施法 +18%
  bloodthirst: { id: 'bloodthirst', name: '嗜血',     maxStacks: 2, healPerKill: 3 },       // 击杀回 3 生命
  thorns:      { id: 'thorns',      name: '荆棘',     maxStacks: 1, reflectRatio: 0.4 },    // 受伤反弹 40%
  roomCharge:  { id: 'roomCharge',  name: '层压',     maxStacks: 1, perRoomDamage: 0.03, cap: 0.15 } // 每清一房 +3%，最多 +15%
};

/* ---------------------------------------------------------------------------
 * 7. 融合（来源：FUSION_CONFIG，主文件 L9029）
 * 模拟里把融合视为"对应魔法的强化版"：伤害倍率与群体命中提升。
 * ------------------------------------------------------------------------- */
const FUSION = [
  { id: 'homingFireball', magic: 'fireball',     tech: 'concentrator', name: '追踪火球', damageMul: 1.15 },
  { id: 'frostField',     magic: 'frost',        tech: 'field',        name: '冻结力场', damageMul: 1.25, aoeBonus: 0.15 },
  { id: 'chainBolt',      magic: 'bolt',         tech: 'capacitor',    name: '连锁闪电', damageMul: 1.20, aoeBonus: 0.25 },
  { id: 'regenField',     magic: 'heal',         tech: 'nanite',       name: '再生力场', damageMul: 1.00, healMul: 1.6 },
  { id: 'novaBurst',      magic: 'fireball',     tech: 'field',        name: '爆炸新星', damageMul: 1.18, aoeBonus: 0.45 },
  { id: 'chainSpread',    magic: 'bolt',         tech: 'field',        name: '连锁扩散', damageMul: 1.18, aoeBonus: 0.30 },
  { id: 'piercingBeam',   magic: 'fireball',     tech: 'capacitor',    name: '贯光矛',   damageMul: 1.35, aoeBonus: 0.20 },
  { id: 'droneSwarm',     magic: 'bolt',         tech: 'nanite',       name: '雷暴无人机', damageMul: 1.25, aoeBonus: 0.25 },
  { id: 'gravityWell',    magic: 'frost',        tech: 'concentrator', name: '引力井',   damageMul: 1.20, aoeBonus: 0.20 },
  { id: 'shieldNova',     magic: 'heal',         tech: 'field',        name: '护盾爆轰', damageMul: 1.00, healMul: 1.0, shield: true },
  { id: 'lavaBand',       magic: 'lavaFissure',  tech: 'capacitor',    name: '熔雷带',   damageMul: 1.30, aoeBonus: 0.15 },
  { id: 'drainRing',      magic: 'collapseHole', tech: 'magnet',       name: '吸噬环',   damageMul: 1.10, healPerHit: 3 },
  { id: 'frostFlame',     magic: 'frostRing',    tech: 'amp',          name: '霜焰爆发', damageMul: 1.35, aoeBonus: 0.20 }
];

/* 元素反应（来源：ELEMENT_CONFIG.reactions，L8898）
 * 模拟里按"附着一层火/冰/雷"的期望折算：反应伤害 = 触发那一发伤害 × ratio，
 * 冷却 0.6s；这里折算成整体 DPS 的 8%（有对应附着来源时）。 */
const ELEMENT = {
  enabled: true,
  frostBurst: { ratio: 0.55, maxTargets: 3 },
  conduct: { ratio: 0.45, maxTargets: 3 },
  fireCloud: { ratio: 0.25, maxTargets: 4 },
  reactionCooldown: 0.6,
  expectedDpsBonus: 0.08
};

/* 处决与破防（来源：EXECUTION_CONFIG，L8920）
 * 普通怪血量 ≤15% 可处决；首领 ≤35% 破防，受伤 ×1.25。 */
const EXECUTION = {
  normalThreshold: 0.15,
  eliteThreshold: 0.20,
  bossThreshold: 0.35,
  bossBreakDamageMul: 1.25
};

/* ---------------------------------------------------------------------------
 * 8. 首领（来源：BOSS_CONFIG，主文件 L13592）
 * ------------------------------------------------------------------------- */
const BOSS = {
  introTime: 0.75,
  phaseThreshold: 0.5,
  hpBase: 1250,
  hpFloorMul: 1.30,
  hpCap: 3200,
  /* C1-15 / B1：上限按层抬升 cap(f) = hpCap × (1 + 0.04 × (f−1))（与主文件同源） */
  hpCapRampPerFloor: 0.04,
  /* C1-15 · 75 秒硬闸门：真机 F20 首领战 135.4s → scale = 75/135.4 ≈ 0.55 */
  hpCapF20Scale: 0.55,
  regionBossHpMul: 1.15,
  damageCap: 30,
  /* C1-11 调参：首领全招式伤害 −10%（主文件 BOSS_CONFIG.damageScale） */
  damageScale: 0.9,
  damageBandDamp: { midFrom: 6, midTo: 11, midMul: 0.82, deepMul: 0.80 },
  aetherRegenMul: 2.0,        // 首领战回能 ×2
  dropCrystals: 3,
  kinds: [
    /* V2 机制折算字段：默认全 0 —— 乘 1 / 加 0，旧基线逐位不变（硬约束）。 */
    { id: 'mech', name: '机械暴君', contactDamage: 14, bulletDamage: 12, attackInterval: 2.6, heavyDamage: 26,
      downtime: 0, extraHitRate: 0, hazardDps: 0 },
    { id: 'rune', name: '符文织者', contactDamage: 13, bulletDamage: 11, attackInterval: 2.4, heavyDamage: 24,
      downtime: 0, extraHitRate: 0, hazardDps: 0 },
    { id: 'void', name: '虚空噬主', contactDamage: 15, bulletDamage: 12, attackInterval: 2.2, heavyDamage: 30,
      downtime: 0, extraHitRate: 0, hazardDps: 0 }
  ]
};

/* ---------------------------------------------------------------------------
 * 9b. 首领机制 V2 折算表（仅离线估算，不参与游戏运行）
 * ----------------------------------------------------------------------------
 * 模拟器没有"走位 / 预警 / 冲刺"，所以新机制无法直接跑。
 * 这里把每个机制折算成三个无量纲量，喂给 simulateBoss：
 *   downtime     玩家被迫放弃输出的时间占比（1 - D 乘到玩家 DPS 上）
 *   extraHitRate 每招额外期望命中概率（和 hitRate 同分母 attackInterval）
 *   hazardDps    地面危险区额外期望命中次数/秒（乘单次伤害）
 * 硬约束：table 里每项默认值都是 0；enabled=false 时整张表不生效。
 * 打开方式：node run.js --mech2
 * ------------------------------------------------------------------------- */
const BOSS_MECH2 = {
  enabled: false,
  table: {
    press:       { id: 'press',       name: '液压合拢', downtime: 0.0020, extraHitRate: 0.0010, hazardDps: 0 },
    beam:        { id: 'beam',        name: '熔核火柱', downtime: 0.0016, extraHitRate: 0.0008, hazardDps: 0 },
    sigilOrder:  { id: 'sigilOrder',  name: '刻印按序', downtime: 0.0040, extraHitRate: 0.0010, hazardDps: 0 },
    gravityTide: { id: 'gravityTide', name: '引力潮汐', downtime: 0.0008, extraHitRate: 0.0006, hazardDps: 0 }
  }
};

/* ---------------------------------------------------------------------------
 * 9. 经济与天赋（来源：FLOOR_GEN_CONFIG / TALENT_PACE_CONFIG / TALENT_CONFIG）
 * ------------------------------------------------------------------------- */
const ECONOMY = {
  clearCrystals: 3,            // 每清一层 +3
  bossChestCrystals: 3,        // 首领宝箱 +3
  chestCrystals: 1,            // 宝箱房 +1
  pricedDoorCrystals: 1,       // 双价门 +1
  extraBudget: 4,              // 本局额外来源额度
  runMax: 40,                  // 本局入账上限
  crystalTalentPerLevel: 0.10, // 「结晶」天赋每级 +10%
  floorBonusPerClear: 1,       // 「厚利」天赋每层额外 +1 结晶
  /* 续航（来源：runClear 节奏层，L17881 / L13560 / L43811）
   * 进层回复 15% 最大生命；每清空一间有怪房回 5%；精英击杀回 4%。 */
  /* C1-15 回退：回血比例整体回退到调参前的 0.15/0.05/0.04（主文件 DEEP_HEAL_CONFIG 同步） */
  entryHealRatio: 0.15,
  roomClearHealRatio: 0.05,
  eliteKillHealRatio: 0.04,
  /* 深层回血节奏（来源：DEEP_HEAL_CONFIG，主文件 L13783）
   * 主文件里进层/清房/精英击杀三类回复**只在节奏层触发**（F12/F15/F18/F20），
   * 本模拟器旧口径是所有层都回；探针用 healParity 开关切到主文件口径做对照。
   * bossPulse：首领每掉 8% 血回 18% 最大生命，同样只在节奏层（C1-15 / B1）。 */
  deepHeal: {
    fromFloor: 12,
    everyN: 3,
    extraFloors: [20],
    bossPulse: { enabled: true, everyPct: 0.08, ratio: 0.18 }
  }
};

/* 敌人 XP 与升级门槛（来源：XP_CONFIG，L9811） */
const XP = {
  killXp: { normal: 10, elite: 35, boss: 120 },
  baseNeed: 80,
  growth: 1.28
};

/* 玩家能力档案（不是游戏内数值，是"操作水平"建模参数）
 * aim        命中率
 * uptime     技能冷却利用率（站着发呆/走位会损失输出）
 * dodge      躲避成功率（影响远程弹幕与首领重招命中）
 * healDiscipline 血量低于阈值时是否及时治疗
 * greed      对高风险高收益房型的选择倾向（影响房间权重）
 * buildIQ    升级选卡水平：1=按数值最优，0=随机
 */
const PROFILES = {
  novice:  { id: 'novice',  label: '新手', aim: 0.80, uptime: 0.86, dodge: 0.38, healDiscipline: 0.55, greed: 0.30, buildIQ: 0.35 },
  veteran: { id: 'veteran', label: '老手', aim: 0.92, uptime: 0.96, dodge: 0.62, healDiscipline: 0.85, greed: 0.70, buildIQ: 0.95 },
  bot:     { id: 'bot',     label: '机器人', aim: 0.94, uptime: 0.94, dodge: 0.40, healDiscipline: 0.60, greed: 0.50, buildIQ: 0.75 }
};

/* ---------------------------------------------------------------------------
 * 10. 模拟开关与可调参数（敏感度扫描的四个主参数）
 * 这些不是主文件里的常量，而是"如果策划改这几个数"的假设入口。
 * ------------------------------------------------------------------------- */
const SIM_PARAMS = {
  maxFloor: 20,               // 模拟最多下潜层数（正式一局 5 层，之后是"无尽下潜"）
  baseSeed: 20261108,         // 固定随机种子：结果可复现
  step: 0.1,                  // 房间模拟步长（秒）
  maxRoomSeconds: 240,        // 单房超时上限（超过视为被拖死/放弃）
  sensitivityRuns: 4000,      // 每个敏感度档位的局数
  sensitivityMuls: [0.9, 1.0, 1.1],
  approachSeconds: 4,         // 进入房间 + 接敌的固定开销（秒）
  roomLenPenalty: 1.0         // 房间长度对走位的影响系数（保留调参入口）
};

module.exports = {
  GAME, DIFFICULTY, PRESSURE, REGION_DEEP, ONBOARD, ENEMY_TYPES, REGION_POOLS, RAMP_BY_FLOOR,
  ELITE_ROOM, FLOOR_GEN, ROOM, MAGIC, DUAL, CRIT, TECH, RELIC, FUSION, ELEMENT, EXECUTION,
  BOSS, BOSS_MECH2, ECONOMY, XP, PROFILES, SIM_PARAMS
};
