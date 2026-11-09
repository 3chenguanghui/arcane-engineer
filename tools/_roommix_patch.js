/**
 * 房型配比补丁 R1 / R2 / R5（函数级锚点，纯字符串变换）
 * ------------------------------------------------------------
 * 用途：给"副本验证"用。每一个替换都要求命中次数 === 1，
 *       锚点漂移（主文件被别的线改过）会立刻抛错，不会静默生成错副本。
 * 说明：这里只落 R1（配比表）/ R2（定稿调用 + 精英路线收敛）/ R5（四处配色同源）。
 *       R3（休整房机制）与 R4（精英对价）是行为改动，不参与配比实测，单独在文档里给出。
 */
'use strict';

/**
 * 单次替换；命中次数不等于 1 直接抛错
 * @param {string} src 源码
 * @param {string} from 原片段
 * @param {string} to 新片段
 * @param {string} tag 锚点标签
 * @returns {string} 替换结果
 */
function once(src, from, to, tag) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`锚点[${tag}]命中 ${n} 次（应为 1）：${from.slice(0, 70)}`);
  return src.replace(from, to);
}

/* ---------------- R1：配置 + 计划表 + 定稿函数 ---------------- */
const R1_BLOCK = `
/**
 * 房型配比 · 配置与计划表（R1）
 * ------------------------------------------------------------
 * 解决的问题（实测 6 种子 × 20 层）：精英 26.5%、普通战斗 20.8%、商店 1.5%、休整 0%。
 * 休整 0% 不是权重为 0（权重里有 rest:1），而是"唯一必然休整房=楼梯房"最终被
 * generateFloor 里那行 stairRoom.type='boss' 无条件改掉；随机权重的休整房则被
 * 保底二(≥2 战斗) / 保底三(≥1 宝箱或事件) / 保底四(商店) / 保底五(生存) 在 3 个空位里轮流吃掉。
 * 因此这里改成"层计划表"：每层 3 个内容房槽位由表定死，任何让位规则之后再做一次定稿。
 */
const ROOM_MIX_CONFIG = {
  enabled: true,
  /* F1–F20：每层 3 个内容房槽位（不含出生房 / 首领房）。
     设计占比（20 层 × 5 间 = 100 间）：战斗 21%、精英 10%、休整 9%、商店 5%、
     宝箱 9%、事件 3%、生存 3%，出生/首领各 20%。 */
  plan: {
    1: ['battle', 'chest', 'chest'],
    2: ['battle', 'elite', 'chest'],
    3: ['battle', 'rest', 'event'],
    4: ['battle', 'elite', 'shop'],
    5: ['battle', 'survival', 'rest'],
    6: ['battle', 'elite', 'chest'],
    7: ['battle', 'rest', 'chest'],
    8: ['battle', 'elite', 'event'],
    9: ['battle', 'rest', 'shop'],
    10: ['battle', 'elite', 'survival'],
    11: ['battle', 'rest', 'chest'],
    12: ['battle', 'elite', 'shop'],
    13: ['battle', 'rest', 'chest'],
    14: ['battle', 'elite', 'chest'],
    15: ['battle', 'survival', 'shop'],
    16: ['battle', 'elite', 'battle'],
    17: ['battle', 'rest', 'chest'],
    18: ['battle', 'elite', 'event'],
    19: ['battle', 'rest', 'shop'],
    20: ['battle', 'elite', 'rest']
  },
  fallback: ['battle', 'rest', 'chest'],
  /* 只有这些楼层允许出现精英房 / 精英路线（原先"第 2 层起每层必有精英"= 每层 1 间） */
  eliteFloors: { 2: 1, 4: 1, 6: 1, 8: 1, 10: 1, 12: 1, 14: 1, 16: 1, 18: 1, 20: 1 },
  /* 精英支线最多只改 1 间；原先整条支线全改（实测把精英占比推到 26.5%） */
  maxEliteRouteRooms: 1,
  /* 干旱保底：连续 2 层没有任何非战斗房 → 下一层强制排 1 间休整 */
  droughtLimit: 2
};

/**
 * 取某层的内容房槽位计划
 * @param {number} floor 层号
 * @returns {string[]} 房型数组
 */
function roomMixPlanFor(floor) {
  const row = ROOM_MIX_CONFIG.plan[floor];
  return (row || ROOM_MIX_CONFIG.fallback).slice();
}

/**
 * 房型定稿：把所有让位 / 保底规则的最终结果收敛到"层计划表"
 * ------------------------------------------------------------
 * 必须排在 designEliteRoute 之后（否则精英路线会把整条支线重新改成精英）、
 * 排在 setupOpenFloor / assignRoomTemplates / spawnShopRoom 之前（后三者都按房型取行为）。
 * @param {Object} spawnRoom 出生房
 * @param {Object} stairRoom 楼梯房（此时已被改成 boss）
 */
function applyRoomMixPlan(spawnRoom, stairRoom) {
  if (ROOM_MIX_CONFIG.enabled === false) return;
  const others = state.rooms.filter((room) => room.id !== spawnRoom.id && room.id !== stairRoom.id);
  if (!others.length) return;

  let plan = roomMixPlanFor(state.floor);
  while (plan.length < others.length) {
    plan.push(plan.length % 3 === 0 ? 'battle' : (plan.length % 3 === 1 ? 'rest' : 'chest'));
  }
  plan = plan.slice(0, others.length);

  /* 精英路线保留下来的房间必须是精英（路线语义 / 门牌 / 地图标识都依赖它） */
  const keepEliteIds = [];
  if (state.eliteRoute && state.eliteRoute.roomIds) {
    state.eliteRoute.roomIds.forEach((id) => {
      const room = state.rooms[id];
      if (room && room.id !== spawnRoom.id && room.id !== stairRoom.id
        && keepEliteIds.length < ROOM_MIX_CONFIG.maxEliteRouteRooms) keepEliteIds.push(room.id);
    });
  }
  if (!keepEliteIds.length) {
    for (let i = 0; i < plan.length; i += 1) if (plan[i] === 'elite') plan[i] = 'chest';
  } else if (plan.indexOf('elite') < 0) {
    plan[0] = 'elite';
  }

  /* 槽位分配用"层 + 房号"稳定哈希：同层重开不闪变（G1 原则） */
  const salt = 13 + state.floor;
  const ranked = others.slice().sort((a, b) => (roomHash01(a, salt) - roomHash01(b, salt)) || (a.id - b.id));
  ranked.forEach((room) => {
    room.type = 'battle';
    room.cleared = false;
    room.rewarded = false;
  });
  keepEliteIds.forEach((id) => {
    const room = state.rooms[id];
    if (!room) return;
    room.type = 'elite';
    room.cleared = false;
    room.rewarded = false;
  });

  let slot = 0;
  ranked.forEach((room) => {
    if (keepEliteIds.indexOf(room.id) >= 0) return;
    while (slot < plan.length && plan[slot] === 'elite') slot += 1;
    room.type = plan[slot] || 'battle';
    slot += 1;
  });

  /* 保底一：至少 1 间普通战斗房（表已保证，防改表时违约） */
  if (!others.some((room) => room.type === 'battle')) {
    const cand = ranked.find((room) => room.type !== 'elite');
    if (cand) cand.type = 'battle';
  }
  /* 保底二：至少 1 间宝箱或事件（"清房后 2 个门选路线"必须有的选） */
  if (!others.some((room) => room.type === 'chest' || room.type === 'event')) {
    const cand = ranked.find((room) => room.type !== 'elite' && room.type !== 'shop');
    if (cand) cand.type = 'chest';
  }
  /* 干旱保底：连续 droughtLimit 层没有非战斗房 → 强制 1 间休整 */
  const nonCombat = others.filter((room) => ['rest', 'shop', 'chest', 'event'].indexOf(room.type) >= 0).length;
  const drought = state.roomMixDrought || 0;
  if (drought >= ROOM_MIX_CONFIG.droughtLimit && !others.some((room) => room.type === 'rest')) {
    const cand = ranked.find((room) => room.type === 'battle' || room.type === 'chest');
    if (cand) cand.type = 'rest';
  }
  state.roomMixDrought = others.filter((room) => ['rest', 'shop', 'chest', 'event'].indexOf(room.type) >= 0).length > 0
    ? 0 : drought + 1;
}

`;

/* ---------------- R5：四处配色同源 ---------------- */
const R5_BLOCK = `

/**
 * 房型配色同源（R5）
 * ------------------------------------------------------------
 * 现状：门牌 / 小地图读 ROOM_TYPE_CONFIG.types[t].color，室内地面光读 ROOM_LIGHT_MOODS[t].color，
 * 两套色值各自手写，休整房是"绿门牌 + 橙室内光"（#47e8a7 vs 255,207,138）。
 * 这里让室内光反过来推导自门牌色，四处只留一个色源；休整房同时改色以与出生房区分。
 * 只改颜色，不动 coreAlpha / radiusMul / vignette / tint（亮度与压暗是另一套参数）。
 */
(function unifyRoomMoodPalette() {
  const types = ROOM_TYPE_CONFIG.types;
  /* 休整房与出生房同为 #47e8a7，四处无法区分；改成琥珀橙（篝火 / 休息语义） */
  if (types.rest) types.rest.color = '#ffa76b';
  const hexToRgb = (hex) => {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  Object.keys(ROOM_LIGHT_MOODS).forEach((key) => {
    const mood = ROOM_LIGHT_MOODS[key];
    if (!mood || !mood.color || !types[key]) return;   // battle 的 color=null：保留"不吃房间色"
    const rgb = hexToRgb(types[key].color);
    if (!rgb) return;
    mood.color = rgb;
    mood.accent = rgb.join(', ');
  });
})();`;

/**
 * 把 R1 / R2 / R5 应用到源码
 * @param {string} src 主文件源码
 * @returns {string} 打过补丁的源码
 */
function applyRoomMixPatch(src) {
  let out = src;

  // R1：插在 EVENT_ROOM_GATE_CONFIG 定义之前（同一作用域，且早于所有调用点）
  out = once(out, 'const EVENT_ROOM_GATE_CONFIG = {', R1_BLOCK + '\nconst EVENT_ROOM_GATE_CONFIG = {', 'R1-config');

  // R2a：定稿调用（紧跟精英路线之后）
  out = once(out,
    '  designEliteRoute(spawnRoom, stairRoom);',
    '  designEliteRoute(spawnRoom, stairRoom);\n\n  /* R2 房型定稿：把让位/保底收敛到层计划表（晚于精英路线、早于钥匙/模板/道具） */\n  applyRoomMixPlan(spawnRoom, stairRoom);',
    'R2-call');

  // R2b：精英路线只允许出现在计划楼层
  out = once(out,
    '  state.eliteRoute = null;\n  if (!ELITE_ROUTE_CONFIG.enabled) return null;',
    '  state.eliteRoute = null;\n  /* R2：只在计划表排了精英的层生成精英路线，避免"每层必有精英" */\n  if (!ROOM_MIX_CONFIG.enabled || !ROOM_MIX_CONFIG.eliteFloors[state.floor]) return null;\n  if (!ELITE_ROUTE_CONFIG.enabled) return null;',
    'R2-elite-gate');

  // R2c：精英支线最多改 maxEliteRouteRooms 间
  out = once(out,
    '  if (!best) return null;\n\n  /* 第 13 项补丁：',
    '  if (!best) return null;\n  if (best.roomIds.length > ROOM_MIX_CONFIG.maxEliteRouteRooms) {\n    best.roomIds = best.roomIds.slice(0, ROOM_MIX_CONFIG.maxEliteRouteRooms);\n  }\n\n  /* 第 13 项补丁：',
    'R2-elite-cap');

  // R5：接在 ROOM_LIGHT_MOODS 定义之后
  out = once(out,
    '  survival: { color: [255, 107, 107], coreAlpha: 0.32, radiusMul: 0.96, accent: \'255, 107, 107\', vignette: 1.35, tint: 0.10 }\n};',
    '  survival: { color: [255, 107, 107], coreAlpha: 0.32, radiusMul: 0.96, accent: \'255, 107, 107\', vignette: 1.35, tint: 0.10 }\n};' + R5_BLOCK,
    'R5-palette');

  return out;
}

module.exports = { applyRoomMixPatch, once };
