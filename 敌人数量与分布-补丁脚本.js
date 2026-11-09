/**
 * 敌潮密度补丁施加脚本（只读主文件，输出副本）
 * ------------------------------------------------------------
 * 用法：node 敌人数量与分布-补丁脚本.js [输入文件] [输出文件]
 * 默认：index_arcane_v2.html → .seedwork/index_enemy_patched.html
 *
 * 每一项都要求 oldString 在原文中**恰好出现 1 次**；否则整批中止、不写输出。
 * 8 项锚点全部命中 1 次 = 补丁可用；任意一项命中 0 或 ≥2 = 主文件已变更，必须重锚。
 */
const fs = require('fs');
const path = require('path');

const IN = path.resolve(process.argv[2] || path.join(__dirname, 'index_arcane_v2.html'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '.seedwork', 'index_enemy_patched.html'));

let src = fs.readFileSync(IN, 'utf8');
const applied = [];

/** 精确替换一次；出现次数不等于 1 直接失败（这是"锚点命中数必须=1"的硬门禁） */
function once(label, oldStr, newStr) {
  const n = src.split(oldStr).length - 1;
  if (n !== 1) throw new Error(`锚点命中数=${n}（必须=1）：${label}`);
  src = src.replace(oldStr, newStr);
  applied.push(label);
}

// ---------------------------------------------------------------
// 1) 配置 + 工具函数：插在 spawnEnemy 之前
// ---------------------------------------------------------------
const DENSITY_BLOCK = `/* ===== 敌潮密度：总数量上升，但同屏峰值不上升 ===== */
/* 为什么这么做：玩家反馈"每个房间的怪太少"。直接加数量会把同屏峰值一起抬上去，
   峰值才是帧时间与"站桩磨"的来源。所以把多出来的怪做成"排队补员"：
   开局先到场 firstRatio，场上剩一半时再补剩下的，峰值封顶 aliveCap。
   aliveCap=10 的来源：2026-11-08 对主文件实测，同屏峰值 9–10 只
   （固定种子 9 只（F8 / F9）；随机布局抽样最高 10 只（F6 / F8）。
   取 10 = 现状上界，属于"不抬高现状"的玩法判断；8 只强制峰值实测
   render CPU p95 ≈ 4–5ms（60Hz 预算 16.7ms），10 只仍有余量。 */
const DENSITY_CONFIG = {
  enabled: true,
  // 楼层闸门（按 2026-11-08 四口径 2000 局验收定的）：
  //   F1–2 完全不加：F2 是已经存在的死亡墙（对齐尺子后 F2 死亡 243/2000），不能再加压
  //   F3–5 只给普通战斗房 +1，且**不分批**（整批同时出场，缩短清场时间）
  //   F6+ 才做 wave 补员，普通战斗房 +2、精英房 +1（且只加"基础 ≤5 只"的小精英房）
  //   F9–10 精英房不分批：F10 精英 7 只被 wave 切成 5+2，第二段要重新接敌，
  //   实测时长从 25s 档掉到 33s 档（样本不足，见方案 §7.2）；不分批只动"什么时候出场"，
  //   不动数量与上限，同屏回到改前的 7 只。
  gate: { noAddUntil: 2, earlyUntil: 5, waveUntil: 5, smallEliteMax: 5, eliteNoWaveFrom: 9 },
  add: { battle: 2, elite: 1 },      // F6+ 的总数量增量（普通档）
  addEarlyBattle: 1,                  // F3–5 普通战斗房增量
  roomCap: 12,                        // 本房总数量硬上限（含排队）
  aliveCap: 10,                       // 同屏硬上限（超过就排队）
  firstRatio: 0.6,                    // 开局到场 60%（只对 F6+ 生效）
  refillAtRatio: 0.5,                 // 场上剩 ≤50% 时补员
  refillCooldown: 0.6,                // 补员最小间隔（秒）
  // 困难档：数量增量更小（+1），压力靠"更早到场 + 更早补员 + 全面编队"
  nightmare: {
    add: { battle: 1, elite: 1 },
    addEarlyBattle: 1,
    firstRatio: 0.75,
    refillAtRatio: 0.6,
    refillCooldown: 0.45
  }
};

/**
 * 取当前难度的密度档位
 * @returns {Object} 普通档返回 DENSITY_CONFIG 本体，困难档返回其 nightmare 段
 */
function densityProfile() {
  return difficultyId() === 'nightmare' ? DENSITY_CONFIG.nightmare : DENSITY_CONFIG;
}

/**
 * 该房间是否参与敌潮（只有战斗房 / 精英房加；首领、事件、宝箱、起始房不加）
 * @param {Object} room 房间对象
 * @returns {boolean} 是否参与
 */
function densityApplies(room) {
  return !!(DENSITY_CONFIG.enabled && room && (room.type === 'battle' || room.type === 'elite'));
}

/**
 * 按难度、房型、楼层上调本房总敌人数，并压在本房总量硬上限内
 * 楼层闸门：F1–2 不加；F3–5 普通房 +1；F6+ 普通房 +2；精英房只在 F6+ 且基础 ≤5 只时 +1。
 * 简单档不加（保持原有手感）。
 * @param {Object} room 房间对象
 * @param {number} count 原计划数量
 * @param {number} floorNumber 当前层数
 * @returns {number} 上调后的总数量（含排队未出场的）
 */
function enemyDensityCount(room, count, floorNumber) {
  if (!densityApplies(room)) return count;
  const d = difficultyId();
  if (d === 'easy') return count;
  const prof = densityProfile();
  const g = DENSITY_CONFIG.gate;
  const f = floorNumber || 1;
  let add = 0;
  if (room.type === 'battle') {
    if (f > g.noAddUntil) add = (f <= g.earlyUntil ? (prof.addEarlyBattle || 0) : (prof.add.battle || 0));
  } else if (room.type === 'elite' && f > g.earlyUntil && count <= g.smallEliteMax) {
    add = prof.add.elite || 0;
  }
  return Math.max(1, Math.min(DENSITY_CONFIG.roomCap, count + add));
}

/**
 * 计算开局先出场的数量，并初始化该房间的排队数组
 * F1–5 不分批：整批同时出场（清场更快、峰值不因排队而延长），F6+ 才按 firstRatio 分批。
 * @param {Object} room 房间对象
 * @param {number} count 本房总数量
 * @param {number} floorNumber 当前层数
 * @returns {number} 第一批出场数量
 */
function enemyWaveFirst(room, count, floorNumber) {
  room.wavePending = [];
  const f = floorNumber || 1;
  const g = DENSITY_CONFIG.gate;
  // 不分批的三种情况：不参与密度、前 5 层、F9–10 的精英房（高层精英房一次出完，避免二次接敌）
  if (!densityApplies(room) || f <= g.waveUntil
      || (room.type === 'elite' && f >= (g.eliteNoWaveFrom || Infinity))) {
    room.waveBatchSize = count;
    return count;
  }
  const first = Math.max(1, Math.ceil(count * densityProfile().firstRatio));
  room.waveBatchSize = Math.min(count, first);
  return room.waveBatchSize;
}

/**
 * 每帧补员：场剩 ≤refillAtRatio 时把排队里的怪补进房间
 * 场上打空时不等冷却立刻补，否则会出现"房间没怪但门不开"的死局。
 * @param {number} dt 帧间隔（秒）
 */
function tickEnemyWaves(dt) {
  if (!DENSITY_CONFIG.enabled || !state || !state.rooms) return;
  const prof = densityProfile();
  state.rooms.forEach((room) => {
    if (!room || !room.wavePending || !room.wavePending.length) return;
    if (room.cleared) { room.wavePending = []; return; }
    let alive = 0;
    state.enemies.forEach((e) => { if (e.roomId === room.id) alive += 1; });
    const urgent = alive <= 0;
    const threshold = Math.max(1, Math.ceil((room.waveBatchSize || 1) * prof.refillAtRatio));
    if (!urgent && alive > threshold) { room.waveCd = 0; return; }
    room.waveCd = Math.max(0, (room.waveCd || 0) - dt);
    if (!urgent && room.waveCd > 0) return;
    const slots = Math.max(0, DENSITY_CONFIG.aliveCap - alive);
    if (slots <= 0) return;
    const batch = Math.min(slots, room.wavePending.length);
    let spawnedCount = 0;
    for (let k = 0; k < batch; k += 1) {
      const plan = room.wavePending.shift();
      const spawned = spawnEnemy(plan.typeId, plan.x, plan.y, plan.floorNumber, plan.opts);
      if (spawned) spawnedCount += 1;
    }
    room.waveBatchSize = Math.max(1, alive + spawnedCount);
    room.waveCd = prof.refillCooldown;
  });
}

function spawnEnemy(`;
once('配置与补员函数（插在 spawnEnemy 之前）', 'function spawnEnemy(', DENSITY_BLOCK);

// ---------------------------------------------------------------
// 2) 难度分层：困难档在 F1–F5 也启用编队（"配合"而不是"数量翻倍"）
// ---------------------------------------------------------------
once('困难档全面编队',
  '    const formation = budgetOn ? pickFormation(floorNumber, room) : null;',
  `    // 困难档即使不在预算层也启用编队：多给的是"配合"，不是"数量翻倍"
    const formation = (budgetOn || (DENSITY_CONFIG.enabled && difficultyId() === 'nightmare'))
      ? pickFormation(floorNumber, room) : null;`);

// ---------------------------------------------------------------
// 3) 总数量：生成时先过密度上调
// ---------------------------------------------------------------
once('总量密度上调',
  '    room.enemyCount = count;',
  `    count = enemyDensityCount(room, count, floorNumber);
    room.enemyCount = count;`);

// ---------------------------------------------------------------
// 4) 分批：算出第一批，循环只跑第一批
// ---------------------------------------------------------------
once('第一批数量与排队初始化',
  `    const anchorX = shift.x;
    const anchorY = shift.y;
    for (let i = 0; i < count; i += 1) {`,
  `    const anchorX = shift.x;
    const anchorY = shift.y;
    // 分批入场：只先跑第一批，剩下的按"清掉一半再补"排进队列
    const waveFirst = enemyWaveFirst(room, count, floorNumber);
    for (let i = 0; i < count; i += 1) {`);

// ---------------------------------------------------------------
// 5) 循环内：超出第一批的只记账、不出场
// ---------------------------------------------------------------
once('排队记账分支',
  '      const spawned = spawnEnemy(pick, x, y, floorNumber, opts);',
  `      // 超过第一批的计划只入队，等场上清到一半再由 tickEnemyWaves 补
      if (i >= waveFirst && room.wavePending) {
        room.wavePending.push({ typeId: pick, x: x, y: y, floorNumber: floorNumber,
          opts: Object.assign({}, opts) });
        continue;
      }
      const spawned = spawnEnemy(pick, x, y, floorNumber, opts);`);

// ---------------------------------------------------------------
// 6) 房间清空判定：必须把"还在排队"的怪算进去，否则会提前开门/提前结算
// ---------------------------------------------------------------
once('清空判定 A（进房检测）',
  '  if (type.count[1] > 0 && !room.cleared && !state.enemies.some((e) => e.roomId === room.id)) {',
  `  if (type.count[1] > 0 && !room.cleared && !state.enemies.some((e) => e.roomId === room.id)
    && !(room.wavePending && room.wavePending.length)) {`);

once('清空判定 B（击杀结算）',
  `    if (roomType.count[1] > 0 && !roomJustCleared.cleared
      && !state.enemies.some((e) => e.roomId === roomJustCleared.id)) {`,
  `    if (roomType.count[1] > 0 && !roomJustCleared.cleared
      && !state.enemies.some((e) => e.roomId === roomJustCleared.id)
      && !(roomJustCleared.wavePending && roomJustCleared.wavePending.length)) {`);

// ---------------------------------------------------------------
// 7) 每帧补员
// ---------------------------------------------------------------
once('每帧补员入口',
  'function updateEnemies(dt) {',
  `function updateEnemies(dt) {
  tickEnemyWaves(dt);`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, src, 'utf8');
console.log('输入：' + IN);
console.log('输出：' + OUT);
console.log('命中项（每项=1）：');
applied.forEach((x, i) => console.log('  ' + (i + 1) + '. ' + x));
console.log('共 ' + applied.length + ' 项；输出行数=' + src.split('\n').length);
