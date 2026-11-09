// M2-1 单元二专项验收：精英岔路
// 用法：node arcane_m22.js [html路径] [截图输出目录]
// 覆盖：回环边选线 / 门上有骷髅标识 / 路线房间全精英 / 词缀与数量血量叠加 /
//       普通路线房间不受影响 / 200 次奖励抽样对比 / 小地图标识 / 迷雾规则不变 /
//       清房累积奖励等级 / 换层重置 / 帧率与报错
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9471;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm22');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

/**
 * 记录一条断言并即时打印
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起来，继续等 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(1000);

  // ==================== 0) 找到一张带精英路线的层 ====================
  const gen = await ev(`(function(){
    var tries = 0;
    var s = window.__roamDebug.getState();
    while (!s.eliteRoute && tries < 12) {
      tries += 1;
      window.__roamDebug.setFloor(1 + (tries % 5));
      s = window.__roamDebug.getState();
    }
    window.__roamDebug.centerPlayer();
    window.__roamDebug.setHp(100);
    return { floor: s.floor, rooms: s.rooms.length, tries: tries, hasRoute: !!s.eliteRoute };
  })()`);
  await sleep(400);
  check('本层生成精英路线（回环边可用）', gen.hasRoute === true, gen);

  // ==================== 1) 路线结构 + 门标识 ====================
  const a = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var e = s.eliteRoute;
    var g = state.floorGraph;
    var routeDoors = s.doors.filter(function(d){ return d.eliteRoute; });
    var entryRoom = s.rooms[e.entryRoomId];
    var loops = g.loopEdges.map(function(edge){ return edge[0] + '-' + edge[1]; });
    var edgeKeyStr = e.loopEdge ? (e.loopEdge[0] + '-' + e.loopEdge[1]) : null;
    var edgeKeyRev = e.loopEdge ? (e.loopEdge[1] + '-' + e.loopEdge[0]) : null;
    // 入口门是否真的贴在入口房间的墙上（门坐标在房间边界 ±6px 内）
    var onWall = routeDoors.length === 1 ? (function(){
      var d = routeDoors[0];
      var r = s.rooms[d.roomId];
      var nearLeft = Math.abs(d.x - r.x) <= 8;
      var nearRight = Math.abs(d.x - (r.x + r.w)) <= 8;
      var nearTop = Math.abs(d.y - r.y) <= 8;
      var nearBottom = Math.abs(d.y - (r.y + r.h)) <= 8;
      return nearLeft || nearRight || nearTop || nearBottom;
    })() : false;
    return {
      e: e, floor: s.floor,
      routeDoors: routeDoors.length,
      entryRoomId: e.entryRoomId,
      entryRoomType: entryRoom ? entryRoom.type : null,
      entryRoomInRoute: e.roomIds.indexOf(e.entryRoomId) !== -1,
      firstInRoute: e.roomIds.indexOf(e.firstRoomId) !== -1,
      onWall: onWall,
      allRoomsTypes: e.roomIds.map(function(id){ return s.rooms[id].type; }),
      allRoomsFlagged: e.roomIds.every(function(id){ return s.rooms[id].eliteRoute; }),
      flaggedCount: s.rooms.filter(function(r){ return r.eliteRoute; }).length,
      loops: loops, edgeKey: edgeKeyStr, edgeKeyRev: edgeKeyRev,
      legend: ELITE_ROUTE_CONFIG.legend.text,
      legendColor: ELITE_ROUTE_CONFIG.legend.color,
      hasBadgeFn: typeof drawEliteDoorBadge === 'function',
      hasSkullFn: typeof drawSkullIcon === 'function',
      spawnRoomId: state.spawnRoomId,
      stairRoom: s.stairs,
      spawnInRoute: e.roomIds.indexOf(state.spawnRoomId) !== -1,
      difficulty: s.difficulty,
      difficultyValid: Object.keys(DIFFICULTY_CONFIG.modes).indexOf(state.difficulty) !== -1 && !!difficultyCfg()
    };
  })()`);

  check('精英路线来自回环边（loopEdge 在 floorGraph.loopEdges 里）',
    !!a.edgeKey && (a.loops.indexOf(a.edgeKey) !== -1 || a.loops.indexOf(a.edgeKeyRev) !== -1),
    { edgeKey: a.edgeKey, loops: a.loops });
  check('精英路线至少包含 1 间房', !!a.e && a.e.roomIds.length >= 1, a.e.roomIds);
  check('出生房 / 楼梯房没有被划进精英路线', a.spawnInRoute === false, { roomIds: a.e.roomIds, spawn: a.spawnRoomId });
  check('分叉点（入口房）不在精英路线内', a.entryRoomInRoute === false, { entryRoomId: a.entryRoomId, roomIds: a.e.roomIds });
  check('路线上的第一间精英房确实属于路线', a.firstInRoute === true, { firstRoomId: a.firstRoomId });
  check('恰好 1 扇门带精英路线标识（与普通门一眼可分）', a.routeDoors === 1, { routeDoors: a.routeDoors });
  check('精英门长在入口房间的墙上（不是悬空标记）', a.onWall === true, { onWall: a.onWall });
  check('门标识文案 = 精英 · 高收益', a.legend === '精英 · 高收益', { text: a.legend });
  check('门标识使用红色（#ff2f4f）', a.legendColor === '#ff2f4f', { color: a.legendColor });
  check('骷髅图标与门标识绘制函数已就位', a.hasSkullFn === true && a.hasBadgeFn === true,
    { skull: a.hasSkullFn, badge: a.hasBadgeFn });
  check('难度档位未被改变', a.difficultyValid === true, { difficulty: a.difficulty });

  // ==================== 2) 进入后房型全精英 + 词缀/数量/血量叠加 ====================
  const b = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var e = s.eliteRoute;
    var floor = s.floor;
    var diff = difficultyCfg();
    var pressure = difficultyPressure(floor);
    /* 第 13 项修正：引擎在 E 批预算房里额外乘了 rampHpScale(floor)（逐层单只血量缩放），
       旧复刻漏掉这一项，第 6 层起会把正确的血量判成"叠层错误"。 */
    var hpScale = Math.pow(GAME_CONFIG.floorScale, floor) * rampHpScale(floor);
    /* 第 13 项修正：第 1 层还额外吃 ONBOARD_CONFIG.weakFloor1.hpMul（教学"低血"），
       旧复刻同样漏了这一层，F1 的血量期望会偏高 40%。 */
    var weakMul = (onboardActiveFloor(floor) && floor === 1) ? ONBOARD_CONFIG.weakFloor1.hpMul : 1;
    // M2 房间放大：房间可用区变大后，引擎对敌人数额外乘了一层"面积系数"
    // （clamp(面积 / roomAreaRef, 0.85, 1.5)），所以这里的期望区间也要按
    // 每间房自己的面积系数算，否则会误判成"超出难度基线"。
    var areaMulOf = function(r){
      return r.enemyAreaMul || Math.max(0.85, Math.min(1.5, (r.w * r.h) / (GAME_CONFIG.roomAreaRef || 266000)));
    };
    /** 复刻引擎的数量计算：难度基线 → ×面积系数（≤7）→ 精英路线再 ×countMul（≤countCap） */
    var bandOf = function(type, mul, isRoute){
      /* 第 13 项修正：复刻引擎的"前五层教学分支"——F1 锁 2 只、F2–F5 走 onboardEnemyCount，
         且不乘面积系数；精英路线只在 F2–F5 叠加 countMul（F1 连这一层也豁免）。
         旧复刻只写了 F6+ 的基线分支，F1 会把 2 只误判成数量越界。 */
      if (onboardActiveFloor(floor)) {
        var oLo = onboardEnemyCount(type.count[0], floor);
        var oHi = onboardEnemyCount(type.count[1], floor);
        if (isRoute && floor !== 1) {
          oLo = Math.max(1, Math.min(ELITE_ROUTE_CONFIG.countCap, Math.round(oLo * ELITE_ROUTE_CONFIG.countMul)));
          oHi = Math.max(1, Math.min(ELITE_ROUTE_CONFIG.countCap, Math.round(oHi * ELITE_ROUTE_CONFIG.countMul)));
        }
        return { min: oLo, max: oHi };
      }
      var lo = difficultyEnemyCount(type.count[0], floor);
      var hi = difficultyEnemyCount(type.count[1], floor);
      lo = Math.max(1, Math.min(7, Math.round(lo * mul)));
      hi = Math.max(1, Math.min(7, Math.round(hi * mul)));
      if (isRoute) {
        lo = Math.max(1, Math.min(ELITE_ROUTE_CONFIG.countCap, Math.round(lo * ELITE_ROUTE_CONFIG.countMul)));
        hi = Math.max(1, Math.min(ELITE_ROUTE_CONFIG.countCap, Math.round(hi * ELITE_ROUTE_CONFIG.countMul)));
      }
      return { min: lo, max: hi };
    };
    var routeMin = Infinity;
    var routeMax = 0;
    var rooms = e.roomIds.map(function(id){
      var r = s.rooms[id];
      var list = s.enemyList.filter(function(x){ return x.roomId === id; });
      var confOk = list.every(function(x){ return !!ENEMY_BY_ID[x.typeId]; });
      var allElite = list.every(function(x){ return x.elite === true; });
      var allAffix = list.every(function(x){ return typeof x.affix === 'string' && x.affix.length > 0; });
      var hpOk = list.every(function(x){
        var conf = ENEMY_BY_ID[x.typeId] || ENEMY_CONFIG[0];
        var expect = Math.max(1, Math.round(conf.hp * hpScale * 2.2 * diff.hpMul * diff.eliteHpMul
          * pressure * weakMul * ELITE_ROUTE_CONFIG.hpMul));
        return x.hp === expect;
      });
      var hpAboveBaseline = list.every(function(x){
        var conf = ENEMY_BY_ID[x.typeId] || ENEMY_CONFIG[0];
        var base = Math.max(1, Math.round(conf.hp * hpScale * 2.2 * diff.hpMul * diff.eliteHpMul * pressure * weakMul));
        return x.hp > base;
      });
      var band = bandOf(ROOM_TYPE_CONFIG.types[r.type] || ROOM_TYPE_CONFIG.types.elite, areaMulOf(r), true);
      if (band.min < routeMin) routeMin = band.min;
      if (band.max > routeMax) routeMax = band.max;
      return {
        id: id, type: r.type, count: list.length,
        countMin: band.min, countMax: band.max, areaMul: areaMulOf(r),
        allElite: allElite, allAffix: allAffix, hpOk: hpOk, hpAboveBaseline: hpAboveBaseline,
        confOk: confOk, affixes: list.map(function(x){ return x.affix; })
      };
    });
    // 普通路线房间（不被标记为精英路线）的怪：应完全按难度基线生成
    var normalBattle = s.rooms.filter(function(r){
      return r.type === 'battle' && !r.eliteRoute;
    }).map(function(r){
      var list = s.enemyList.filter(function(x){ return x.roomId === r.id; });
      var band = bandOf(ROOM_TYPE_CONFIG.types.battle, areaMulOf(r), false);
      var countMin = band.min;
      var countMax = band.max;
      var hpOk = list.every(function(x){
        var conf = ENEMY_BY_ID[x.typeId] || ENEMY_CONFIG[0];
        var expect = Math.max(1, Math.round(conf.hp * hpScale * diff.hpMul * pressure * weakMul));
        return x.hp === expect && x.elite === false && !x.affix;
      });
      return { id: r.id, count: list.length, countMin: countMin, countMax: countMax, hpOk: hpOk };
    });
    return {
      routeMin: routeMin, routeMax: routeMax,
      rooms: rooms, normalBattle: normalBattle,
      hpMul: ELITE_ROUTE_CONFIG.hpMul, countMul: ELITE_ROUTE_CONFIG.countMul,
      routeEnemyTotal: rooms.reduce(function(n, r){ return n + r.count; }, 0)
    };
  })()`);

  check('精英路线房间的房型全部为 elite', b.rooms.every((r) => r.type === 'elite'),
    b.rooms.map((r) => ({ id: r.id, type: r.type })));
  check('精英路线房间每只怪都是精英', b.rooms.every((r) => r.allElite === true),
    b.rooms.map((r) => ({ id: r.id, allElite: r.allElite })));
  check('精英路线房间每只怪至少 1 条词缀（复用现有词缀系统）', b.rooms.every((r) => r.allAffix === true),
    b.rooms.map((r) => ({ id: r.id, affixes: r.affixes })));
  check('精英路线房间血量 = 难度基线 × 额外倍率（叠层正确）', b.rooms.every((r) => r.hpOk === true),
    { hpMul: b.hpMul, rooms: b.rooms.map((r) => ({ id: r.id, hpOk: r.hpOk })) });
  check('精英路线房间血量严格高于同难度下的精英基线', b.rooms.every((r) => r.hpAboveBaseline === true),
    { hpMul: b.hpMul });
  check('精英路线房间敌人数量落在「难度数量 × 面积系数 × countMul」区间且 ≤ 上限',
    b.rooms.every((r) => r.count >= r.countMin && r.count <= r.countMax),
    { routeMin: b.routeMin, routeMax: b.routeMax, rooms: b.rooms.map((r) => ({ id: r.id, count: r.count, min: r.countMin, max: r.countMax, mul: r.areaMul })) });
  check('普通战斗房数量仍按难度基线（没有被精英路线倍率污染）',
    b.normalBattle.every((r) => r.count >= r.countMin && r.count <= r.countMax),
    b.normalBattle);
  check('普通战斗房血量/词缀仍按基线（不被精英路线加成）',
    b.normalBattle.every((r) => r.hpOk === true), b.normalBattle);

  // ==================== 3) 普通路线房间类型未被改动 + 迷雾规则不变 ====================
  const c = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var e = s.eliteRoute;
    var unchanged = true;
    var changed = [];
    s.rooms.forEach(function(r, i){
      if (e.roomIds.indexOf(r.id) !== -1) return;
      // M2 Boss：楼梯房由 rest 改为 boss 是本期预期改动（首领守楼梯），不算"被精英路线改动"
      var bossSwap = (r.type === 'boss' && e.beforeTypes[i] === 'rest');
      if (r.type !== e.beforeTypes[i] && !bossSwap) { unchanged = false; changed.push({ id: r.id, before: e.beforeTypes[i], now: r.type }); }
    });
    var seen = s.fog.seenRoomIds;
    var unseenRouteRooms = e.roomIds.filter(function(id){ return seen.indexOf(id) === -1; });
    window.__roamDebug.getState();
    drawMinimap();
    var ms = state.minimapStats || {};
    return {
      unchanged: unchanged, changed: changed,
      flaggedOutside: s.rooms.filter(function(r){ return r.eliteRoute && e.roomIds.indexOf(r.id) === -1; }).length,
      unseenRouteRooms: unseenRouteRooms,
      miniEliteRooms: ms.eliteRooms, miniEliteDoors: ms.eliteDoors,
      fogAlpha: FOG_CONFIG.alpha,
      fogTrail: FOG_CONFIG.trailRadius
    };
  })()`);
  check('普通路线房间房型未被精英路线改动（beforeTypes 逐间一致）', c.unchanged === true, c.changed);
  check('精英路线标记没有外溢到其他房间', c.flaggedOutside === 0, { outside: c.flaggedOutside });
  check('迷雾规则不变：未探索的精英房不暴露', c.unseenRouteRooms.length === b.rooms.length,
    { unseenRouteRooms: c.unseenRouteRooms, routeRooms: b.rooms.map((r) => r.id) });
  check('迷雾底 alpha 仍为 0.94（未自行改成全黑）', c.fogAlpha === 0.94, { alpha: c.fogAlpha });
  // 入口门所在的房间如果是出生房，本就在视野内 —— 显示它是合理的（玩家一出门就能看见岔路标识）
  check('迷雾未探索时小地图不显示精英房骷髅（房内标记仍受迷雾约束）',
    c.miniEliteRooms === 0,
    { rooms: c.miniEliteRooms, doors: c.miniEliteDoors });

  // ==================== 4) 奖励抽样：普通路线 vs 精英路线（200 次） ====================
  const d = await ev(`(function(){
    var normal = window.__roamDebug.rewardSample(false, 200);
    var boosted = window.__roamDebug.rewardSample(true, 200);
    return { normal: normal, boosted: boosted, mul: ELITE_ROUTE_CONFIG.rewardWeightMul };
  })()`);
  check('普通路线 200 次抽样完成（600 次抽取）', d.normal.samples === 200 && d.normal.picks === 600, d.normal);
  check('精英路线 200 次抽样完成（600 次抽取）', d.boosted.samples === 200 && d.boosted.picks === 600, d.boosted);
  check('精英路线史诗占比 ≥ 普通路线 2 倍', d.boosted.epicRate >= d.normal.epicRate * 2,
    { normalEpic: d.normal.epicRate, eliteEpic: d.boosted.epicRate });
  check('精英路线稀有占比高于普通路线', d.boosted.rareRate > d.normal.rareRate,
    { normalRare: d.normal.rareRate, eliteRare: d.boosted.rareRate });
  check('精英路线普通占比低于普通路线', d.boosted.commonRate < d.normal.commonRate,
    { normalCommon: d.normal.commonRate, eliteCommon: d.boosted.commonRate });
  check('精英路线「每次三选一至少一张史诗」的概率更高',
    d.boosted.epicSampleRate > d.normal.epicSampleRate,
    { normal: d.normal.epicSampleRate, elite: d.boosted.epicSampleRate });

  // ==================== 5) 进门：小地图标识 + 关门规则 + 迷雾揭示 ====================
  const entry = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var e = s.eliteRoute;
    var room = s.rooms[e.entryRoomId];
    window.__roamDebug.teleport(room.cx, room.cy);
    return { roomId: room.id, x: room.cx, y: room.cy };
  })()`);
  await sleep(500);
  await ev("drawMinimap(); true");
  const e1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var e = s.eliteRoute;
    var ms = state.minimapStats || {};
    return {
      miniEliteDoors: ms.eliteDoors, miniEliteRooms: ms.eliteRooms,
      seen: s.fog.seenRoomIds,
      entryRoomId: e.entryRoomId
    };
  })()`);
  check('站到入口房后，小地图显示精英入口门标记', e1.miniEliteDoors === 1, e1);
  await shot('elite-entry-door.png');

  const f1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var e = s.eliteRoute;
    var room = s.rooms[e.firstRoomId];
    state.player.invuln = 3;
    window.__roamDebug.teleport(room.cx, room.cy);
    return { roomId: room.id, x: room.cx, y: room.cy };
  })()`);
  await sleep(600);
  await ev("drawMinimap(); true");
  const f2 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var e = s.eliteRoute;
    var room = s.rooms[e.firstRoomId];
    var ms = state.minimapStats || {};
    return {
      roomId: room.id, cleared: !!room.cleared, locked: !!room.locked,
      seen: s.fog.seenRoomIds,
      miniEliteRooms: ms.eliteRooms,
      isElite: room.type === 'elite',
      enemies: s.enemyList.filter(function(x){ return x.roomId === room.id; }).length
    };
  })()`);
  check('进入第一间精英房后：房型 elite + 落闸', f2.isElite === true && f2.locked === true, f2);
  check('进入后迷雾才揭示该精英房（规则与普通房一致）',
    f2.seen.indexOf(f2.roomId) !== -1, { seen: f2.seen, id: f2.roomId });
  check('已探索后小地图出现精英房骷髅标记', f2.miniEliteRooms >= 1, { marks: f2.miniEliteRooms });
  await shot('elite-room.png');

  // ==================== 6) 清房 → 奖励等级累积 → 三选一加成 ====================
  const g0 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var e = s.eliteRoute;
    var room = s.rooms[e.firstRoomId];
    state.enemies = state.enemies.filter(function(x){ return x.roomId !== room.id; });
    return { roomId: room.id, charges: s.eliteRewardCharges };
  })()`);
  await sleep(600);
  const g1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var e = s.eliteRoute;
    var room = s.rooms[e.firstRoomId];
    return {
      cleared: !!room.cleared, locked: !!room.locked,
      charges: s.eliteRewardCharges,
      expected: ELITE_ROUTE_CONFIG.chargesPerRoom,
      rooms: s.eliteRoute.roomIds.length
    };
  })()`);
  check('清空精英路线房后累积 1 级奖励加成', g1.charges >= g1.expected && g1.charges >= 1, g1);
  check('清房后门恢复开启（清房开门规则不变）', g1.cleared === true && g1.locked === false, g1);

  const g2 = await ev(`(function(){
    window.__roamDebug.setHp(100);
    openReward('debug');
    var s = window.__roamDebug.getState();
    return {
      mode: s.mode, stage: s.rewardStage,
      boost: s.eliteRewardBoost, charges: s.eliteRewardCharges,
      options: s.options.length, rarities: s.rarities,
      /* 第 13 项修正：选项数量由全局"三/四选一"配置决定，不再写死 3 */
      expected: rewardChoiceCount()
    };
  })()`);
  check('进入奖励流程时把累积等级换算成 boost（并清零 charges）',
    g2.mode === 'reward' && g2.boost >= 1 && g2.charges === 0,
    { mode: g2.mode, boost: g2.boost, charges: g2.charges });
  check('精英加成流程不改变奖励选项数量（等于全局配置值）', g2.options === g2.expected,
    { options: g2.options, expected: g2.expected });

  const g3 = await ev(`(function(){
    closeRewardFlow(true);
    var s = window.__roamDebug.getState();
    return { mode: s.mode, boost: s.eliteRewardBoost, charges: s.eliteRewardCharges };
  })()`);
  check('结束奖励流程后精英 boost 归零（不影响后续普通奖励）',
    g3.mode === 'playing' && g3.boost === 0 && g3.charges === 0, g3);

  const g4 = await ev(`(function(){
    state.eliteRewardBoost = ELITE_ROUTE_CONFIG.epicGuaranteeLevel;
    var opts = buildRewardOptions('skill');
    var epic = opts.filter(function(o){ return o.rarity === 'epic'; }).length;
    state.eliteRewardBoost = 0;
    return { epic: epic, level: ELITE_ROUTE_CONFIG.epicGuaranteeLevel, total: opts.length };
  })()`);
  check('加成等级 ≥ 保底等级时，三选一至少 1 张史诗', g4.epic >= 1, g4);

  // ==================== 7) 换层重置 ====================
  const h = await ev(`(function(){
    var list = [];
    var baseFloor = window.__roamDebug.getState().floor;
    for (var k = 1; k <= 3; k += 1) {
      window.__roamDebug.setFloor(baseFloor + k);
      window.__roamDebug.centerPlayer();
      var s = window.__roamDebug.getState();
      var e = s.eliteRoute;
      var routeDoors = s.doors.filter(function(d){ return d.eliteRoute; }).length;
      var allElite = e ? e.roomIds.every(function(id){ return s.rooms[id].type === 'elite'; }) : null;
      var unchanged = e ? s.rooms.every(function(r, i){
        // 同样放行楼梯房 rest → boss（M2 Boss 的预期改动）
        return e.roomIds.indexOf(r.id) !== -1 || r.type === e.beforeTypes[i]
          || (r.type === 'boss' && e.beforeTypes[i] === 'rest');
      }) : null;
      // 失败时把具体差异带出来，便于定位是哪一步后置逻辑改了房型
      var changed = e ? s.rooms.filter(function(r, i){
        return e.roomIds.indexOf(r.id) === -1 && r.type !== e.beforeTypes[i]
          && !(r.type === 'boss' && e.beforeTypes[i] === 'rest');
      }).map(function(r, i){ return { id: r.id, before: e.beforeTypes[r.id], now: r.type }; }) : null;
      list.push({
        floor: s.floor, rooms: s.rooms.length, hasRoute: !!e,
        roomIds: e ? e.roomIds : null, allElite: allElite, unchanged: unchanged,
        routeDoors: routeDoors, charges: s.eliteRewardCharges, boost: s.eliteRewardBoost,
        changed: changed
      });
    }
    return { list: list };
  })()`);
  check('换层后奖励累积与 boost 全部清零',
    h.list.every((r) => r.charges === 0 && r.boost === 0),
    h.list.map((r) => ({ floor: r.floor, charges: r.charges, boost: r.boost })));
  check('换层后精英路线按新图重新生成（不携带上一层的房号）',
    h.list.every((r) => r.hasRoute === true && r.roomIds.length >= 1),
    h.list.map((r) => ({ floor: r.floor, roomIds: r.roomIds })));
  check('换层后路线房间仍全精英', h.list.every((r) => r.allElite === true),
    h.list.map((r) => ({ floor: r.floor, allElite: r.allElite })));
  check('换层后普通房间类型仍然逐间一致（beforeTypes 校验）',
    h.list.every((r) => r.unchanged === true),
    h.list.map((r) => ({ floor: r.floor, unchanged: r.unchanged, changed: r.changed })));
  check('换层后精英入口门恰好 1 扇',
    h.list.every((r) => r.routeDoors === 1),
    h.list.map((r) => ({ floor: r.floor, doors: r.routeDoors })));
  // B 开放层：floor%3===0 时为 7–9 间，其余层 4–7
  check('换层后房间数（普通 4–7 / 开放层 7–9）',
    h.list.every((r) => (r.floor % 3 === 0
      ? (r.rooms >= 7 && r.rooms <= 9)
      : (r.rooms >= 4 && r.rooms <= 7))),
    h.list.map((r) => ({ floor: r.floor, rooms: r.rooms })));

  // ==================== 8) 帧率 + 报错 ====================
  await sleep(1200);
  const fps = await ev(`new Promise(function(resolve){
    var frames = 0, t0 = performance.now();
    function tick(){
      frames += 1;
      if (frames >= 120) {
        var sec = (performance.now() - t0) / 1000;
        resolve({ fps: Math.round(frames / sec), frameMs: Number((sec * 1000 / frames).toFixed(2)) });
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })`);
  const errs = await ev("window.__roamDebug.errors()");
  check('精英路线场景帧率 ≥ 90', fps.fps >= 90, fps);
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  console.log(`奖励抽样：普通 epic ${d.normal.epicRate}% / rare ${d.normal.rareRate}% / common ${d.normal.commonRate}%`
    + `；精英 epic ${d.boosted.epicRate}% / rare ${d.boosted.rareRate}% / common ${d.boosted.commonRate}%`);
  fs.writeFileSync(path.join(OUT, 'm22-result.json'), JSON.stringify({
    pass, total: results.length, results,
    gen, a, b, c, d, e1, f1, f2, g0, g1, g2, g3, g4, h, fps, errs
  }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 进程已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
