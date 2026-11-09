/**
 * B2-a · 熔炉房（付费刻印，价格按本房计）
 * ------------------------------------------------------------
 * 设计：不刷怪的机制房，房内一台刻印台；本房第 1/2/3 次刻印 = 4/6/8 余烬，
 *       换一间熔炉房重新从 4 起价（用户拍板：按本房计，不按本局计）。
 * 为什么建在刻印系统上：刻印只改标签，不动 ownedMagic / ownedTech 的 id 数组，
 *       因此不会打断已成立的融合与蓝图配对（见文档"地基事实"）。
 * 约束：函数级锚点；每个替换必须命中 1 次；删掉对应块即可单独回退。
 */
'use strict';

/**
 * 单次替换；命中次数不为 1 立即抛错
 * @param {string} src 源码
 * @param {string} from 原片段
 * @param {string} to 新片段
 * @param {string} tag 锚点标签
 * @returns {string} 替换结果
 */
function once(src, from, to, tag) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`锚点[${tag}]命中 ${n} 次（应为 1）：${from.slice(0, 60)}`);
  return src.replace(from, to);
}

/**
 * 应用熔炉房补丁
 * @param {string} src 主文件源码
 * @returns {string} 打过补丁的源码
 */
function applyForgePatch(src) {
  let out = src;

  // 1) 房型注册（门牌 / 小地图 / 室内光都读这张表）
  out = once(out,
    "    survival: { name: '生存', en: 'SURVIVE', risk: 3, color: '#ff6b6b', count: [0, 0] },",
    "    survival: { name: '生存', en: 'SURVIVE', risk: 3, color: '#ff6b6b', count: [0, 0] },\n"
    + "    /* B2 熔炉房：不刷怪；房内一台按本房计价的刻印台（4/6/8 余烬阶梯） */\n"
    + "    forge: { name: '熔炉', en: 'FORGE', risk: 0, color: '#ff8a3d', count: [0, 0] },",
    'B2-type');

  // 2) 室内光照情绪（颜色随后被 R5 的色源统一覆盖，这里只给亮度/压暗参数）
  out = once(out,
    "  survival: { color: [255, 107, 107], coreAlpha: 0.32, radiusMul: 0.96, accent: '255, 107, 107', vignette: 1.35, tint: 0.10 }\n};",
    "  survival: { color: [255, 107, 107], coreAlpha: 0.32, radiusMul: 0.96, accent: '255, 107, 107', vignette: 1.35, tint: 0.10 },\n"
    + "  /* B2 熔炉：暖橙、核心亮、压暗轻（玩家要看清台座） */\n"
    + "  forge:  { color: [255, 138, 61], coreAlpha: 0.34, radiusMul: 0.94, accent: '255, 138, 61', vignette: 0.95, tint: 0.09 }\n};",
    'B2-mood');

  // 3) 门牌提示 + 图标（四个界面同源的第 1、2 处）
  out = once(out, "    survival: '生存 · 持续刷波',",
    "    survival: '生存 · 持续刷波',\n    forge: '熔炉 · 余烬换刻印',", 'B2-tip');
  out = once(out, "    shop: '⌂', survival: '◈', boss: '✦', start: '⌂', vault: '◈',",
    "    shop: '⌂', survival: '◈', boss: '✦', start: '⌂', vault: '◈', forge: '⚒',", 'B2-icon');

  // 4) 层计划表：第 4 / 13 层各排 1 间熔炉（2/20 层 = 5% 的房间占比）
  out = once(out, "    4: ['battle', 'elite', 'shop'],",
    "    4: ['battle', 'elite', 'forge'],", 'B2-plan4');
  out = once(out, "    13: ['battle', 'rest', 'chest'],",
    "    13: ['battle', 'rest', 'forge'],", 'B2-plan13');

  // 5) 价格阶梯配置
  out = once(out, "  costEmbers: 3,          // 每次刻印花费余烬",
    "  costEmbers: 3,          // 每次刻印花费余烬\n"
    + "  forgeLadder: [4, 6, 8], // B2 熔炉房：本房第 1/2/3 次刻印价格（换房重新起价）",
    'B2-ladder');

  // 6) 熔炉房里放一台台座
  out = once(out, "  // 商店房追加：用房间坐标 + 层号做确定性哈希",
    "  // B2 熔炉房：本房专属台座（标记 forge:true，价格走阶梯）\n"
    + "  const forgeRoom = state.rooms.find((room) => room.type === 'forge');\n"
    + "  if (forgeRoom) {\n"
    + "    const forgeSpot = findEngraveSpot(forgeRoom, 43);\n"
    + "    if (forgeSpot) {\n"
    + "      state.engrave.stations.push({ roomId: forgeRoom.id, x: forgeSpot.x, y: forgeSpot.y, r: ENGRAVE_CONFIG.radius, forge: true });\n"
    + "    }\n"
    + "  }\n\n"
    + "  // 商店房追加：用房间坐标 + 层号做确定性哈希",
    'B2-station');

  // 7) 费用判定：熔炉房允许同层多次（绕开每层 1 次），价格按本房阶梯
  out = once(out,
    "  if (state.engrave.usedFloor === state.floor) return { ok: false, reason: 'limitFloor' };\n"
    + "  /* R3：从休整房出发的本次刻印免费 */\n"
    + "  const engraveFree = state.engrave.freeFloor === state.floor && state.engrave.freeUsed !== state.floor;\n"
    + "  const engraveCost = engraveFree ? 0 : ENGRAVE_CONFIG.costEmbers;\n"
    + "  if (!engraveFree && (state.embers || 0) < ENGRAVE_CONFIG.costEmbers) {\n"
    + "    return { ok: false, reason: 'embers', cost: ENGRAVE_CONFIG.costEmbers, embers: state.embers || 0 };\n"
    + "  }",
    `  /* B2 熔炉：站在熔炉台座旁时，允许同一层多次刻印（价格走本房阶梯） */
  const forgeNear = nearestEngraveStation();
  const inForge = !!(forgeNear && forgeNear.station && forgeNear.station.forge);
  if (state.engrave.usedFloor === state.floor && !inForge) return { ok: false, reason: 'limitFloor' };
  /* R3：从休整房出发的本次刻印免费 */
  const engraveFree = state.engrave.freeFloor === state.floor && state.engrave.freeUsed !== state.floor;
  let engraveCost = engraveFree ? 0 : ENGRAVE_CONFIG.costEmbers;
  /* B2 熔炉阶梯：本房第 1/2/3 次 = 4/6/8；换房由 roomId 变化重置计数 */
  if (inForge && !engraveFree) {
    if (!state.engrave.forgeRoomId || state.engrave.forgeRoomId !== forgeNear.station.roomId) {
      state.engrave.forgeRoomId = forgeNear.station.roomId;
      state.engrave.forgeUses = 0;
    }
    const ladder = ENGRAVE_CONFIG.forgeLadder;
    engraveCost = ladder[Math.min(state.engrave.forgeUses || 0, ladder.length - 1)];
  }
  if ((state.embers || 0) < engraveCost) {
    return { ok: false, reason: 'embers', cost: engraveCost, embers: state.embers || 0 };
  }`,
    'B2-cost');

  // 8) 实际扣费与记录：把写死的 costEmbers 换成实算费用
  out = once(out,
    "  applyTagPatch(abilityId, tags);\n  state.embers -= engraveCost;\n  if (engraveFree) state.engrave.freeUsed = state.floor;",
    "  applyTagPatch(abilityId, tags);\n  state.embers -= engraveCost;\n"
    + "  if (inForge) state.engrave.forgeUses = (state.engrave.forgeUses || 0) + 1;\n"
    + "  if (engraveFree) state.engrave.freeUsed = state.floor;",
    'B2-deduct');
  out = once(out,
    "    abilityId: abilityId, before: before, after: tags.slice(), cost: ENGRAVE_CONFIG.costEmbers,",
    "    abilityId: abilityId, before: before, after: tags.slice(), cost: engraveCost,",
    'B2-lastcost');

  return out;
}

module.exports = { applyForgePatch, once };
