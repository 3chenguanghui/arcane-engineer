/* ============================================================
   B2-b 回响房补丁（路线 1：跨层快照）
   ------------------------------------------------------------
   落地内容：
     1. 新函数 captureFloorWaveSnapshot(floorNumber) —— 本层敌人构成的纯数据深拷贝
     2. 新函数 pickEchoWaveSource(snapshot, floorNumber) —— 只接受"严格上一层"的快照
     3. 新函数 spawnEchoRoomEnemies(room, floorNumber, spawnRoom) —— 按快照重放守军
     4. spawnEnemiesForFloor 入口插回响分支（失败即降级为 battle，绝不空房）
     5. spawnEnemiesForFloor 末尾写快照（在 spawnCorridorPatrols 之后）
     6. onRoomCleared：回响房基础奥能 ×2 + 补一份等量余烬（= 击杀翻倍）
     7. 房型注册：types / 光情绪 / 门牌 / 图标 / 标签 / 层内强制 1 间
     8. createInitialState 加 lastFloorWave: null（老档缺字段时天然兼容）

   纪律：
     · 主文件一个字节都不写，本文件只做"读 → 改内存字符串 → 返回"；
     · 每个锚点必须命中且仅命中 1 次，漂移立即抛错；
     · 快照一律 JSON 往返做深拷贝，绝不把 state.enemies 的引用带进下一层。
   ============================================================ */

/**
 * 精确替换一次：命中次数必须 === 1
 * @param {string} src 源文本
 * @param {string} from 锚点（必须唯一）
 * @param {string} to 替换内容
 * @param {string} tag 日志标签（出错时能直接定位是哪条锚点漂移）
 * @returns {string} 替换后的文本
 */
function once(src, from, to, tag) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`锚点[${tag}]命中 ${n} 次（应为 1）：${from.slice(0, 70)}`);
  return src.replace(from, to);
}

/* ---------------- 新增配置（紧跟在 ROOM_MIX_CONFIG 之后） ---------------- */
const ECHO_CONFIG_BLOCK = `

/* ============================================================
   B2-b 回响房配置
   ------------------------------------------------------------
   机制：进入回响房时，把"上一层最厚的一队守军"按原样（种类 / 精英 / 词缀）
   重放一遍；清空后基础奥能与余烬按 2 倍结算。它不是换皮加强波：
   敌人构成来自真实快照，玩家必须用上一层的应对方式来打。
   快照缺失（老存档 / 跳层测试）时整房降级为普通战斗房，绝不空房也不报错。
   ============================================================ */
const ECHO_ROOM_CONFIG = {
  enabled: true,
  floor: 4,            // 回响房固定出现的层（F4：玩家此时已有 3 层战斗经验）
  maxEnemies: 9,       // 重放上限（防止把整层 25 只塞进一间）
  rewardMul: 2         // 清空后的基础奥能 / 余烬倍率
};

const FLOOR_WAVE_SNAPSHOT_CONFIG = {
  enabled: true,
  version: 1          // 结构版本：以后改字段时用它判旧快照，不硬用
};`;

/* ---------------- 新增函数（紧跟在 spawnEnemiesForFloor 之后） ---------------- */
const ECHO_FUNCTIONS = `

/**
 * 抓取本层敌人构成的纯数据快照（深拷贝）
 * ------------------------------------------------------------
 * 只记"回响房需要重放的东西"：房间类型 + 每只敌人的种类 / 精英标记 / 词缀。
 * 不记坐标（回响房是新房间，坐标按本房重新排布）、不记血量（血量由 spawnEnemy
 * 按当前层重新算，否则跨层难度会失控）。
 * 走廊巡逻怪 roomId = -2，不属于任何房间，必须排除。
 * @param {number} floorNumber 本层层号
 * @returns {{version:number, floor:number, rooms:Array}|null} 快照；无敌人时返回 null
 */
function captureFloorWaveSnapshot(floorNumber) {
  if (!FLOOR_WAVE_SNAPSHOT_CONFIG.enabled) return null;
  const byRoom = {};
  (state.enemies || []).forEach((enemy) => {
    if (!enemy || enemy.roomId == null || enemy.roomId < 0) return;
    if (!enemy.typeId) return;
    const rid = enemy.roomId;
    if (!byRoom[rid]) byRoom[rid] = [];
    byRoom[rid].push({
      typeId: enemy.typeId,
      elite: !!enemy.elite,
      affix: enemy.affix || null,
      affix2: enemy.affix2 || null
    });
  });
  const rooms = Object.keys(byRoom).map((key) => {
    const rid = Number(key);
    const room = (state.rooms || []).find((r) => r.id === rid) || null;
    return {
      roomId: rid,
      type: room ? room.type : 'battle',
      enemies: byRoom[key]
    };
  });
  if (!rooms.length) return null;
  /* 深拷贝兜底：上面每只敌人已是新字面量，这里再 JSON 往返一次，
     彻底切断与 state.enemies / room 对象的任何引用关系（用户硬条件 1）。 */
  return JSON.parse(JSON.stringify({
    version: FLOOR_WAVE_SNAPSHOT_CONFIG.version,
    floor: floorNumber,
    rooms: rooms
  }));
}

/**
 * 从快照里挑出"回响源"——上一层最厚的一队守军
 * ------------------------------------------------------------
 * 只认 battle / elite：宝箱 / 商店 / 事件房本身无怪，生存房的波次不是"守军"。
 * 严格校验快照层号 = 当前层 - 1：读档跳层 / 调试跳层时宁可不回响，也不重放错层。
 * @param {Object} snap 快照（可能为 null / 旧结构）
 * @param {number} floorNumber 当前层号
 * @returns {{floor:number, roomType:string, enemies:Array}|null} 源；不可用时返回 null
 */
function pickEchoWaveSource(snap, floorNumber) {
  if (!snap || typeof snap !== 'object') return null;
  if (snap.version !== FLOOR_WAVE_SNAPSHOT_CONFIG.version) return null;
  if (Number(snap.floor) !== Number(floorNumber) - 1) return null;
  if (!Array.isArray(snap.rooms) || !snap.rooms.length) return null;
  let best = null;
  snap.rooms.forEach((row) => {
    if (!row || !Array.isArray(row.enemies) || !row.enemies.length) return;
    if (row.type !== 'battle' && row.type !== 'elite') return;
    if (!best || row.enemies.length > best.enemies.length) best = row;
  });
  if (!best) return null;
  return {
    floor: snap.floor,
    roomType: best.type,
    enemies: best.enemies.slice(0, ECHO_ROOM_CONFIG.maxEnemies)
  };
}

/**
 * 在回响房里按快照重放一队守军（单簇环形落位）
 * ------------------------------------------------------------
 * 位置策略沿用战斗房的"单簇聚怪"（C1-5b）：回响房的目标是"重打"，不是
 * 重新走一遍三段阵线，单簇能让玩家一进门就接战。
 * @param {Object} room 回响房
 * @param {number} floorNumber 当前层号
 * @param {Object} spawnRoom 出生房（用于落位偏移）
 * @returns {boolean} 是否成功重放（false = 调用方应降级为普通战斗房）
 */
function spawnEchoRoomEnemies(room, floorNumber, spawnRoom) {
  const src = pickEchoWaveSource(state.lastFloorWave, floorNumber);
  if (!src) return false;
  const list = src.enemies;
  const shortSide = Math.min(room.w, room.h);
  const ringR = Math.min(shortSide * 0.26, 30 + list.length * 9);
  const laneAxis = hash01(room.x + 13, room.y + 29) * Math.PI * 2;
  room.enemyCount = list.length;
  room.enemyTypes = [];
  room.echoSourceFloor = src.floor;
  room.echoSourceType = src.roomType;
  list.forEach((item, i) => {
    if (!item || !item.typeId) return;
    const angle = laneAxis + (i / Math.max(1, list.length)) * Math.PI * 2
      + (hash01(room.x + i * 5, room.y + i * 31) - 0.5) * 0.45;
    const spot = nudgeOutOfBlockers(room.cx + Math.cos(angle) * ringR,
      room.cy + Math.sin(angle) * ringR, 26);
    const x = pointInRoomShape(room, spot.x, spot.y, 16) ? spot.x : room.cx;
    const y = pointInRoomShape(room, spot.x, spot.y, 16) ? spot.y : room.cy;
    const opts = { roomId: room.id, elite: !!item.elite };
    if (item.elite) {
      opts.affix = item.affix || null;
      opts.affix2 = item.affix2 || null;
    }
    const spawned = spawnEnemy(item.typeId, x, y, floorNumber, opts);
    if (spawned) {
      room.enemyTypes.push(item.typeId);
      room.enemyCount = room.enemyTypes.length;
    }
  });
  /* 一只都没生成（名册变更导致旧 id 失效）→ 交给调用方降级，不留空房 */
  return room.enemyTypes.length > 0;
}`;

/**
 * 对源码应用 B2-b 回响房补丁
 * @param {string} src 主文件全文
 * @returns {string} 打补丁后的全文
 */
function applyEchoPatch(src) {
  let out = src;

  /* 1) 房型注册：插在 boss 之前（boss 必须留在 types 末尾，楼梯房逻辑按它兜底） */
  out = once(out,
    "    /* M2 Boss：每层最远的楼梯房就是首领房；进房落闸，首领死前楼梯无法使用 */\n    boss:   { name: '首领', en: 'BOSS', risk: 3, color: '#ff3d6e', count: [1, 1], boss: true }",
    "    /* B2-b 回响：不预刷怪，由 spawnEchoRoomEnemies 按上一层快照重放 */\n    echo:   { name: '回响', en: 'ECHO', risk: 2, color: '#9fb4ff', count: [0, 0] },\n    /* M2 Boss：每层最远的楼梯房就是首领房；进房落闸，首领死前楼梯无法使用 */\n    boss:   { name: '首领', en: 'BOSS', risk: 3, color: '#ff3d6e', count: [1, 1], boss: true }",
    'B2b-types');

  /* 2) 门牌提示 */
  out = once(out,
    "    boss: '首领 · 通往楼梯'\n  }",
    "    boss: '首领 · 通往楼梯',\n    echo: '回响 · 重打上一层守军'\n  }",
    'B2b-tip');

  /* 3) 门牌图标 / 标签 */
  out = once(out,
    "    sacrifice: '☩', wager: '⚄', curse: '☠'\n  },",
    "    sacrifice: '☩', wager: '⚄', curse: '☠', echo: '⟳'\n  },",
    'B2b-icons');
  out = once(out,
    "    sacrifice: '献祭', wager: '赌注', curse: '诅咒'\n  },",
    "    sacrifice: '献祭', wager: '赌注', curse: '诅咒', echo: '回响'\n  },",
    'B2b-labels');

  /* 4) 室内光情绪（color 会被 unifyRoomMoodPalette 用 types.echo.color 覆盖，写完仍等于 #9fb4ff） */
  out = once(out,
    "  survival: { color: [255, 107, 107], coreAlpha: 0.32, radiusMul: 0.96, accent: '255, 107, 107', vignette: 1.35, tint: 0.10 }\n};",
    "  survival: { color: [255, 107, 107], coreAlpha: 0.32, radiusMul: 0.96, accent: '255, 107, 107', vignette: 1.35, tint: 0.10 },\n  /* B2-b 回响：冷蓝紫 = \"这不是这一层的敌人\"；暗角偏重，但比生存房轻 */\n  echo: { color: [159, 180, 255], coreAlpha: 0.32, radiusMul: 0.95, accent: '159, 180, 255', vignette: 1.28, tint: 0.09 }\n};",
    'B2b-mood');

  /* 5) 配置块：紧跟 ROOM_MIX_CONFIG 的结尾 */
  out = once(out,
    "  /* 干旱保底：连续 2 层没有任何非战斗房 → 下一层强制排 1 间休整 */\n  droughtLimit: 2\n};",
    "  /* 干旱保底：连续 2 层没有任何非战斗房 → 下一层强制排 1 间休整 */\n  droughtLimit: 2\n};" + ECHO_CONFIG_BLOCK,
    'B2b-config');

  /* 6) 层内强制 1 间回响：放在所有保底之后，避免被"至少 1 战斗 / 1 宝箱"吃掉 */
  out = once(out,
    "  state.roomMixDrought = others.filter((room) => ['rest', 'shop', 'chest', 'event'].indexOf(room.type) >= 0).length > 0\n    ? 0 : drought + 1;\n}",
    "  state.roomMixDrought = others.filter((room) => ['rest', 'shop', 'chest', 'event'].indexOf(room.type) >= 0).length > 0\n    ? 0 : drought + 1;\n\n  /* B2-b 回响房：指定层强制 1 间。必须排在上面所有保底之后——\n     否则\"至少 1 间战斗 / 1 间宝箱\"会把它改回去，回响房变成偶发。 */\n  if (ECHO_ROOM_CONFIG.enabled && state.floor === ECHO_ROOM_CONFIG.floor) {\n    if (!others.some((room) => room.type === 'echo')) {\n      const cand = ranked.find((room) => room.type === 'battle')\n        || ranked.find((room) => room.type === 'chest' || room.type === 'event' || room.type === 'shop');\n      if (cand) cand.type = 'echo';\n    }\n  }\n}",
    'B2b-force-room');

  /* 7) spawnEnemiesForFloor 入口：回响分支（先于 boss 判定，boss 房不会被改） */
  out = once(out,
    "    if (room.id === spawnRoom.id) return;\n    /* M2 Boss：首领房只刷 1 只首领。",
    "    if (room.id === spawnRoom.id) return;\n    /* B2-b 回响房：优先按上一层快照重放；快照缺失 / 名册失效 → 降级为普通战斗房 */\n    if (room.type === 'echo') {\n      if (spawnEchoRoomEnemies(room, floorNumber, spawnRoom)) return;\n      room.type = 'battle';\n      room.echoDowngraded = true;\n    }\n    /* M2 Boss：首领房只刷 1 只首领。",
    'B2b-spawn-branch');

  /* 8) 快照写入：本层敌人全部生成完之后（含走廊巡逻），再抓一次 */
  out = once(out,
    "  // 走廊巡逻（P0）：走廊只放\"小规模、无攻击性\"的巡逻怪，见 CORRIDOR_PATROL_CONFIG\n  spawnCorridorPatrols(floorNumber);\n}",
    "  // 走廊巡逻（P0）：走廊只放\"小规模、无攻击性\"的巡逻怪，见 CORRIDOR_PATROL_CONFIG\n  spawnCorridorPatrols(floorNumber);\n  /* B2-b：本层构成快照。必须放在所有敌人（含走廊巡逻）生成之后；\n     快照只写 state.lastFloorWave，不参与任何房型判定，失败也不影响本层。 */\n  state.lastFloorWave = captureFloorWaveSnapshot(floorNumber);\n}",
    'B2b-snapshot-write');

  /* 9) 新增三个函数：紧跟 spawnEnemiesForFloor 之后 */
  out = once(out,
    "  state.lastFloorWave = captureFloorWaveSnapshot(floorNumber);\n}\n\n/**\n * 在走廊里找一个合法的巡逻中心点",
    "  state.lastFloorWave = captureFloorWaveSnapshot(floorNumber);\n}" + ECHO_FUNCTIONS + "\n\n/**\n * 在走廊里找一个合法的巡逻中心点",
    'B2b-functions');

  /* 10) 清房掉落：基础奥能 ×2 */
  out = once(out,
    "  const gain = room.type === 'elite' ? 46 : 24;",
    "  /* B2-b：回响房的基础奥能按 ×2 结算（24 → 48）；精英房仍走 46 */\n  const gain = room.type === 'elite' ? 46 : (room.type === 'echo' ? 24 * ECHO_ROOM_CONFIG.rewardMul : 24);",
    'B2b-reward-gain');

  /* 11) 清房掉落：余烬按"再补一份击杀量"实现 ×2（击杀本身已给 1/只） */
  out = once(out,
    "  // M2-1 精英路线：每清空一间，累积 1 级奖励加成（下次三选一稀有度更高）\n  if (isEliteRouteRoom(room.id)) {",
    "  /* B2-b 回响房：余烬 = 击杀量 × 2。击杀时已按 1/只入账，这里补等量一份。\n     按 room.enemyTypes 的真实数量结算，降级房（type 已改 battle）不会进这条。 */\n  if (room.type === 'echo') {\n    const echoKills = Array.isArray(room.enemyTypes) ? room.enemyTypes.length : 0;\n    const echoBonus = echoKills * U11_CONFIG.emberPerKill * (ECHO_ROOM_CONFIG.rewardMul - 1);\n    if (echoBonus > 0) {\n      state.embers = (state.embers || 0) + echoBonus;\n      addFloat('回响 · 余烬 +' + echoBonus, room.cx, room.cy + 18, '#9fb4ff', 12,\n        { outline: 2, outlineColor: 'rgba(10, 14, 32, 0.9)' });\n    }\n  }\n  // M2-1 精英路线：每清空一间，累积 1 级奖励加成（下次三选一稀有度更高）\n  if (isEliteRouteRoom(room.id)) {",
    'B2b-reward-embers');

  /* 12) 新局默认值：老存档缺该字段时，restoreRunFromSlot 会保留这条默认值 */
  out = once(out,
    "    runRecipes: [],\n    runSchools: [],",
    "    runRecipes: [],\n    runSchools: [],\n    /* B2-b 跨层快照：上一层敌人构成（深拷贝纯数据）。老存档没有该字段时为 null，\n       回响房读取失败即降级为普通战斗房，不会报错。 */\n    lastFloorWave: null,",
    'B2b-initial-state');

  return out;
}

module.exports = { applyEchoPatch, once };
