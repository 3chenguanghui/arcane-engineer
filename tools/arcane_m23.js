// M2-1 单元三专项验收：虚空裂隙
// 用法：node arcane_m23.js [html路径] [截图输出目录]
// 覆盖：非相邻连接 / 落点无重叠 / 生命与奥能代价 / 低血改扣蓝 / 二次确认与走开取消 /
//       一次性关闭 / 小地图紫色与灰化符号 / 迷雾与相机衔接 / 与门楼梯秘藏无冲突 /
//       换层重置 / 不影响清场、巡逻、难度 / 帧率与报错
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9473;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm23');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

/** 记录一条断言并打印 */
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
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待端口 */ }
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

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(1000);

  // ==================== 0) 找到一张有裂隙的层 ====================
  const gen = await ev(`(function(){
    var tries = 0;
    var s = window.__roamDebug.getState();
    while (!s.voidRift && tries < 14) {
      tries += 1;
      window.__roamDebug.setFloor(1 + (tries % 6));
      s = window.__roamDebug.getState();
    }
    window.__roamDebug.centerPlayer();
    window.__roamDebug.setHp(100);
    return { floor: s.floor, hasRift: !!s.voidRift, tries: tries, rooms: s.rooms.length };
  })()`);
  await sleep(400);
  check('本层生成虚空裂隙', gen.hasRift === true, gen);

  // ==================== 1) 结构：非相邻 + 落点无重叠 ====================
  const a = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var r = s.voidRift;
    var src = state.rooms.find(function(x){ return x.id === r.sourceId; });
    var dst = state.rooms.find(function(x){ return x.id === r.targetId; });
    var corridorAdj = state.corridorRects.some(function(c){
      return (c.a === src.id && c.b === dst.id) || (c.a === dst.id && c.b === src.id);
    });
    var graphAdj = state.floorGraph.edges.some(function(e){
      return (e[0] === src.id && e[1] === dst.id) || (e[1] === src.id && e[0] === dst.id);
    });
    var doors = state.doors.filter(function(d){ return d.roomId === src.id; });
    var minDoor = doors.length ? Math.min.apply(null, doors.map(function(d){ return dist(r.x, r.y, d.x, d.y); })) : Infinity;
    var wallDist = Math.min(r.x - src.x, src.x + src.w - r.x, r.y - src.y, src.y + src.h - r.y);
    var stairsDist = state.stairs ? dist(r.x, r.y, state.stairs.x, state.stairs.y) : 99999;
    // 不同房间时没有"秘藏暗门冲突"可言，用 99999 表示"无穷远"
    var hiddenDist = 99999;
    if (state.hiddenRoom && state.hiddenRoom.hostId === src.id && state.hiddenRoom.gap) {
      var g = state.hiddenRoom.gap;
      hiddenDist = dist(r.x, r.y, g.x + g.w / 2, g.y + g.h / 2);
    }
    return {
      r: r, sourceType: src.type, targetType: dst.type,
      corridorAdj: corridorAdj, graphAdj: graphAdj,
      steps: r.steps,
      inside: r.x > src.x && r.x < src.x + src.w && r.y > src.y && r.y < src.y + src.h,
      wallDist: Math.round(wallDist), minDoor: Math.round(minDoor),
      stairsDist: Math.round(stairsDist), hiddenDist: Math.round(hiddenDist),
      srcStair: src.id === (state.stairs && state.stairs.roomId) ? true : false,
      targetIsStairRoom: dst.type === 'stairs',
      roomsCount: s.rooms.length,
      doorCountBefore: s.doors.length,
      enemyCountBefore: s.enemyList.length,
      floor: s.floor,
      difficulty: s.difficulty,
      difficultyValid: Object.keys(DIFFICULTY_CONFIG.modes).indexOf(state.difficulty) !== -1
    };
  })()`);

  check('裂隙连接的是两个不同房间', a.r.sourceId !== a.r.targetId, { source: a.r.sourceId, target: a.r.targetId });
  check('两端房间在走廊上非相邻', a.corridorAdj === false && a.graphAdj === false,
    { corridorAdj: a.corridorAdj, graphAdj: a.graphAdj });
  check('图距离 ≥2（真的能跳过中间的房）', a.steps >= 2, { steps: a.steps });
  check('裂隙落点在房间内部', a.inside === true, { x: a.r.x, y: a.r.y });
  check('离四面墙 ≥40px', a.wallDist >= 40, { wallDist: a.wallDist });
  check('离所有门 ≥46px（不与门重叠）', a.minDoor >= 46, { minDoor: a.minDoor });
  check('离楼梯 ≥60px（不与楼梯重叠）', a.stairsDist >= 60, { stairsDist: a.stairsDist });
  check('离秘藏暗门 ≥70px（不与秘藏冲突）', a.hiddenDist >= 70, { hiddenDist: a.hiddenDist });
  check('裂隙没有新增房间 / 改变房间数（4–7 不变）', a.roomsCount >= 4 && a.roomsCount <= 7, { rooms: a.roomsCount });
  check('难度档位未被改变', a.difficultyValid === true, { difficulty: a.difficulty });

  // ==================== 2) 迷雾 + 小地图：未探索不显示紫色漩涡 ====================
  const b = await ev(`(function(){
    var s = window.__roamDebug.getState();
    drawMinimap();
    var ms = state.minimapStats || {};
    return {
      seen: s.fog.seenRoomIds,
      sourceSeen: s.fog.seenRoomIds.indexOf(s.voidRift.sourceId) !== -1,
      riftVisible: ms.riftVisible, riftUsed: ms.riftUsed,
      fogAlpha: FOG_CONFIG.alpha
    };
  })()`);
  check('未探索裂隙所在房间时，小地图不显示漩涡（迷雾规则不变）',
    b.sourceSeen === false && b.riftVisible === 0, b);
  check('迷雾底 alpha 仍为 0.94', b.fogAlpha === 0.94, { alpha: b.fogAlpha });

  const c0 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var r = s.voidRift;
    var src = state.rooms.find(function(x){ return x.id === r.sourceId; });
    state.player.invuln = 5;
    window.__roamDebug.teleport(src.cx, src.cy);
    return { srcId: src.id, x: src.cx, y: src.cy };
  })()`);
  await sleep(500);
  await ev("drawMinimap(); true");
  const c1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var ms = state.minimapStats || {};
    return { riftVisible: ms.riftVisible, riftUsed: ms.riftUsed, seen: s.fog.seenRoomIds.indexOf(s.voidRift.sourceId) !== -1 };
  })()`);
  check('进入裂隙所在房间后，小地图出现紫色漩涡符号',
    c1.seen === true && c1.riftVisible === 1 && c1.riftUsed === 0, c1);
  await shot('rift-idle.png');

  // ==================== 3) 二次确认 + 走开取消 ====================
  const d1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var r = s.voidRift;
    window.__roamDebug.setPlayerPos(r.x + 28, r.y);
    return { x: r.x + 28, y: r.y, hp: state.player.hp, aether: state.player.aether };
  })()`);
  await sleep(400);
  const d2 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    return { near: s.voidRift.near, confirm: s.voidRift.confirm, used: s.voidRift.used,
      hp: state.player.hp, aether: state.player.aether };
  })()`);
  check('靠近裂隙后进入可交互范围', d2.near === true, d2);

  const d3 = await ev(`(function(){
    var before = { hp: state.player.hp, aether: state.player.aether };
    var consumed = tryVoidRiftInteract();
    var s = window.__roamDebug.getState();
    return { consumed: consumed, confirm: s.voidRift.confirm, used: s.voidRift.used,
      before: before, after: { hp: state.player.hp, aether: state.player.aether } };
  })()`);
  check('第一次按 E 只进入待确认，不扣代价、不传送',
    d3.consumed === true && d3.confirm === true && d3.used === false
      && d3.after.hp === d3.before.hp && d3.after.aether === d3.before.aether, d3);

  const d4 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var r = s.voidRift;
    var src = state.rooms.find(function(x){ return x.id === r.sourceId; });
    // 走到房间另一侧角落：超过 cancelRadius（78px）
    var far = { x: src.x + 44, y: src.y + 44 };
    if (dist(far.x, far.y, r.x, r.y) < 100) far = { x: src.x + src.w - 44, y: src.y + src.h - 44 };
    window.__roamDebug.setPlayerPos(far.x, far.y);
    return far;
  })()`);
  await sleep(500);
  const d5 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    return { confirm: s.voidRift.confirm, used: s.voidRift.used,
      near: s.voidRift.near, hp: state.player.hp };
  })()`);
  check('走开后自动取消确认（不会误扣血）',
    d5.confirm === false && d5.used === false, d5);

  // ==================== 4) 确认穿越：扣 8% 生命 + 传送 + 迷雾/相机衔接 ====================
  const beforeUse = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var r = s.voidRift;
    window.__roamDebug.setHp(100);
    state.player.aether = 100;
    window.__roamDebug.setPlayerPos(r.x + 28, r.y);
    return { x: r.x, y: r.y, cam: s.cam, hp: state.player.hp, aether: state.player.aether };
  })()`);
  await sleep(400);
  const u1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var before = { hp: state.player.hp, aether: state.player.aether, cam: { x: state.cam.x, y: state.cam.y } };
    tryVoidRiftInteract();   // 第一次：待确认
    var ok = tryVoidRiftInteract();  // 第二次：穿越
    var s2 = window.__roamDebug.getState();
    var target = state.rooms.find(function(x){ return x.id === s2.voidRift.targetId; });
    var hpMax = state.player.hpMax;
    var expectHp = Math.max(1, Math.round(hpMax * 0.08));
    return {
      ok: ok, before: before,
      used: s2.voidRift.used, confirm: s2.voidRift.confirm,
      lastCost: s2.voidRift.lastCost, costKind: s2.voidRift.costKind,
      hpAfter: state.player.hp, aetherAfter: state.player.aether,
      expectHp: expectHp,
      playerPos: { x: state.player.x, y: state.player.y },
      target: { x: target.cx, y: target.cy, id: target.id },
      camAfter: { x: state.cam.x, y: state.cam.y }
    };
  })()`);
  await sleep(400);
  const u2 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var r = s.voidRift;
    var target = state.rooms.find(function(x){ return x.id === r.targetId; });
    var src = state.rooms.find(function(x){ return x.id === r.sourceId; });
    var d = dist(r.x, r.y, src.cx, src.cy);
    return {
      currentRoomId: s.currentRoomId,
      targetId: r.targetId,
      targetSeen: s.fog.seenRoomIds.indexOf(r.targetId) !== -1,
      sourceSeen: s.fog.seenRoomIds.indexOf(r.sourceId) !== -1,
      targetCleared: !!target.cleared,
      sourceCleared: !!src.cleared,
      targetType: target.type,
      targetMonster: ROOM_TYPE_CONFIG.types[target.type].count[1] > 0,
      doors: s.doors.length,
      enemies: s.enemyList.length,
      mode: s.mode,
      riftUsed: r.used,
      rift: r,
      cam: s.cam,
      player: { x: state.player.x, y: state.player.y },
      targetCenter: { x: target.cx, y: target.cy }
    };
  })()`);
  check('第二次 E 真的穿越成功', u1.ok === true && u1.used === true, { ok: u1.ok, used: u1.used });
  check('使用后立即关闭（本层不再可用）', u2.riftUsed === true, { used: u2.riftUsed });
  // 注意：计时窗口内可能有小怪造成伤害，所以代价必须用"交互前一瞬的血量"算差值，
  // 不能用写死的 100 作为基准（否则环境里刚好有怪就会假红）。
  check('代价正确：扣 8% 最大生命',
    u1.lastCost === 'hp' && (u1.before.hp - u1.hpAfter) === u1.expectHp,
    { lastCost: u1.lastCost, hpBefore: u1.before.hp, hpAfter: u1.hpAfter, expectCost: u1.expectHp });
  check('生命足够时不会扣奥能', u1.aetherAfter === 100, { aether: u1.aetherAfter });
  check('传送到目标房间中心附近',
    Math.abs(u2.player.x - u2.targetCenter.x) < 4 && Math.abs(u2.player.y - u2.targetCenter.y) < 4,
    { player: u2.player, target: u2.targetCenter });
  check('目标房间迷雾被揭示（迷雾衔接正确）', u2.targetSeen === true && u2.sourceSeen === true,
    { targetSeen: u2.targetSeen, sourceSeen: u2.sourceSeen });
  check('相机跟着传送到目标房（相机衔接正确）',
    Math.abs(u2.cam.x - beforeUse.cam.x) + Math.abs(u2.cam.y - beforeUse.cam.y) > 50,
    { before: beforeUse.cam, after: u2.cam });
  // 目标房若本身是有怪房，裂隙传送不应把它"顺带清空"；若是休整/宝箱类，进房自然结算属于原有规则
  check('裂隙不参与清场：有怪的目标房没有被传送顺带清空',
    u2.targetMonster ? u2.targetCleared === false : true,
    { targetType: u2.targetType, targetCleared: u2.targetCleared, sourceCleared: u2.sourceCleared });
  // 目标房若首次进入、原本敌人尚未激活，按原有规则会生成该房敌人——这不是裂隙造成的；
  // 裂隙本身只允许"不减少、不额外生成到别的房间"，所以这里断言：门数量不变 + 敌人不变少。
  check('使用裂隙不改变门数量 / 不减少敌人数量（不影响清场与巡逻）',
    u2.doors === a.doorCountBefore && u2.enemies >= a.enemyCountBefore,
    { doors: u2.doors, before: a.doorCountBefore, enemies: u2.enemies, beforeEnemies: a.enemyCountBefore });
  check('使用裂隙不会弹奖励 / 不会切换模式', u2.mode === 'playing', { mode: u2.mode });

  // 一次性：再按 E 无效
  const u3 = await ev(`(function(){
    var posBefore = { x: state.player.x, y: state.player.y };
    window.__roamDebug.setPlayerPos(state.voidRift.x, state.voidRift.y);
    var ok = tryVoidRiftInteract();
    return { ok: ok, posBefore: posBefore, posAfter: { x: state.player.x, y: state.player.y },
      used: state.voidRift.used };
  })()`);
  check('用过之后裂隙拒绝交互（一次性生效）', u3.ok === false && u3.used === true, u3);

  // 小地图：已使用 → 灰色叉
  await ev("drawMinimap(); true");
  const u4 = await ev(`(function(){
    var ms = state.minimapStats || {};
    return { riftVisible: ms.riftVisible, riftUsed: ms.riftUsed };
  })()`);
  check('小地图保留"用过"的灰化符号（仍是 1 个可见，且标记为已用）',
    u4.riftVisible === 1 && u4.riftUsed === 1, u4);
  await shot('rift-used.png');

  // ==================== 5) 低血改扣奥能 + 奥能不足拒绝 ====================
  const lowGen = await ev(`(function(){
    var baseFloor = window.__roamDebug.getState().floor;
    var tries = 0;
    var s = window.__roamDebug.getState();
    // 必须换到"还没用过"的裂隙，否则测的是旧的一次性状态
    while ((!s.voidRift || s.voidRift.used) && tries < 10) {
      tries += 1;
      window.__roamDebug.setFloor(baseFloor + tries);
      s = window.__roamDebug.getState();
    }
    state.player.invuln = 6;
    // 裂隙 +28 的固定偏移可能正好压在墙上，这里按候选偏移找一个真实可站立点
    var r = s.voidRift;
    var offs = [[28, 0], [-28, 0], [0, 28], [0, -28], [24, 16], [-24, -16], [16, 24], [-16, -24]];
    for (var oi = 0; oi < offs.length; oi += 1) {
      var ox = r.x + offs[oi][0];
      var oy = r.y + offs[oi][1];
      if (window.__roamDebug.walkableAt(ox, oy, 11)) {
        window.__roamDebug.setPlayerPos(ox, oy);
        break;
      }
    }
    return { floor: s.floor, hasRift: !!s.voidRift, used: s.voidRift.used };
  })()`);
  await sleep(400);
  const low1 = await ev(`(function(){
    // 生命/奥能在交互前一瞬设置，避免被动回血 / 回蓝干扰数值断言
    window.__roamDebug.setHp(5);
    state.player.aether = 100;
    tryVoidRiftInteract();
    var ok = tryVoidRiftInteract();
    var s = window.__roamDebug.getState();
    return { ok: ok, used: s.voidRift.used, lastCost: s.voidRift.lastCost,
      hp: state.player.hp, aether: state.player.aether };
  })()`);
  check('生命低于 35% 时改扣 25 奥能（避免扣血致死）',
    lowGen.hasRift && low1.ok === true && low1.lastCost === 'aether'
      && low1.hp === 5 && low1.aether === 75,
    { gen: lowGen, result: low1 });

  const noGen = await ev(`(function(){
    var baseFloor = window.__roamDebug.getState().floor;
    var tries = 0;
    var s = window.__roamDebug.getState();
    while ((!s.voidRift || s.voidRift.used) && tries < 10) {
      tries += 1;
      window.__roamDebug.setFloor(baseFloor + tries);
      s = window.__roamDebug.getState();
    }
    state.player.invuln = 6;
    var r2 = s.voidRift;
    var offs2 = [[28, 0], [-28, 0], [0, 28], [0, -28], [24, 16], [-24, -16], [16, 24], [-16, -24]];
    for (var oj = 0; oj < offs2.length; oj += 1) {
      var ox2 = r2.x + offs2[oj][0];
      var oy2 = r2.y + offs2[oj][1];
      if (window.__roamDebug.walkableAt(ox2, oy2, 11)) {
        window.__roamDebug.setPlayerPos(ox2, oy2);
        break;
      }
    }
    return { hasRift: !!s.voidRift, used: s.voidRift.used };
  })()`);
  await sleep(400);
  const no1 = await ev(`(function(){
    window.__roamDebug.setHp(5);
    state.player.aether = 10;
    tryVoidRiftInteract();
    var ok = tryVoidRiftInteract();
    var s = window.__roamDebug.getState();
    return { ok: ok, used: s.voidRift.used, lastCost: s.voidRift.lastCost,
      hp: state.player.hp, aether: state.player.aether,
      near: s.voidRift.near, x: state.player.x, y: state.player.y, rx: s.voidRift.x, ry: s.voidRift.y };
  })()`);
  check('低血且奥能不足时拒绝穿越（裂隙保持未使用、玩家留在原地）',
    noGen.hasRift && no1.ok === false && no1.used === false
      && no1.hp === 5 && no1.aether === 10
      && Math.abs(no1.x - no1.rx) < 60,
    { gen: noGen, result: no1 });

  // ==================== 6) 换层重置 ====================
  const h = await ev(`(function(){
    var list = [];
    var baseFloor = window.__roamDebug.getState().floor;
    for (var k = 1; k <= 3; k += 1) {
      window.__roamDebug.setFloor(baseFloor + k);
      window.__roamDebug.centerPlayer();
      var s = window.__roamDebug.getState();
      var r = s.voidRift;
      // 独立复算"该层是否真的存在合法非相邻房对"：与 createVoidRift 同一套规则
      // （起点不能是楼梯房、终点不能是楼梯房、起点可放宽到出生房、落点必须干净）
      var spawnRoom = state.rooms.filter(function(x){ return x.id === state.spawnRoomId; })[0];
      var stairRoom = state.rooms.reduce(function(best, room){
        return dist(room.cx, room.cy, spawnRoom.cx, spawnRoom.cy) > dist(best.cx, best.cy, spawnRoom.cx, spawnRoom.cy) ? room : best;
      }, state.rooms[0]);
      var stairId = stairRoom.id;
      var adj = {};
      state.rooms.forEach(function(x){ adj[x.id] = []; });
      state.floorGraph.edges.forEach(function(e){
        if (adj[e[0]] && adj[e[1]]) { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); }
      });
      var legalPairs = 0;
      state.rooms.forEach(function(a){
        if (a.id === stairId) return;
        if (!findVoidRiftSpot(a)) return;
        var d = {}; d[a.id] = 0; var q = [a.id];
        while (q.length) { var id = q.shift(); (adj[id]||[]).forEach(function(n){ if (d[n]==null) { d[n]=d[id]+1; q.push(n); } }); }
        state.rooms.forEach(function(b){
          if (b.id === a.id || b.id === stairId) return;
          if (d[b.id] != null && d[b.id] >= 2) legalPairs += 1;
        });
      });
      list.push({
        floor: s.floor, hasRift: !!r, used: r ? r.used : null,
        confirm: r ? r.confirm : null, lastCost: r ? r.lastCost : null,
        steps: r ? r.steps : null, rooms: s.rooms.length, stairId: stairId, legalPairs: legalPairs,
        seenSource: r ? s.fog.seenRoomIds.indexOf(r.sourceId) !== -1 : null,
        doors: s.doors.length
      });
    }
    return list;
  })()`);
  check('换层后裂隙重置为未使用 / 未确认 / 无代价记录（存在裂隙的层全部满足）',
    h.filter((x) => x.hasRift).every((x) => x.used === false && x.confirm === false && x.lastCost === null),
    h);
  check('换层后裂隙重新生成且仍是非相邻捷径（图距离 ≥2）',
    h.filter((x) => x.hasRift).every((x) => x.steps >= 2),
    h.map((x) => ({ floor: x.floor, steps: x.steps })));
  check('生成结果与"该层是否存在合法非相邻房对"完全一致（有对必有裂隙，无对才允许为空）',
    h.every((x) => x.hasRift === (x.legalPairs > 0)),
    h.map((x) => ({ floor: x.floor, hasRift: x.hasRift, legalPairs: x.legalPairs, rooms: x.rooms })));
  check('连续 3 层里至少 1 层能生成裂隙（生成鲁棒性）',
    h.filter((x) => x.hasRift).length >= 1,
    h.map((x) => ({ floor: x.floor, hasRift: x.hasRift, legalPairs: x.legalPairs })));
  // B 开放层：floor%3===0 为 7–9 间，其余层 4–7
  check('换层后房间数（普通 4–7 / 开放层 7–9）、门数正常',
    h.every((x) => (x.floor % 3 === 0
      ? (x.rooms >= 7 && x.rooms <= 9)
      : (x.rooms >= 4 && x.rooms <= 7)) && x.doors > 0),
    h.map((x) => ({ floor: x.floor, rooms: x.rooms, doors: x.doors })));

  // ==================== 7) 帧率 + 报错 ====================
  await sleep(1000);
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
  check('裂隙场景帧率 ≥ 90', fps.fps >= 90, fps);
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'm23-result.json'), JSON.stringify({
    pass, total: results.length, results, gen, a, b, c0, c1, d1, d2, d3, d4, d5,
    beforeUse, u1, u2, u3, u4, lowGen, low1, noGen, no1, h, fps, errs
  }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
