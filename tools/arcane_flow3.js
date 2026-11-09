// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9724;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'flow3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => { seq += 1; pending.set(seq, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: seq, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2000);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression.slice(0, 70) + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
  const heal = () => ev("state.player.hp = state.player.hpMax; true");
  // 若因清层进入了奖励面板，选完奖励回到 playing（测试流程推进用）
  const ensurePlaying = async () => {
    const r = await ev("(function(){ var s=window.__roamDebug.getState(); if(s.mode==='reward' && s.options && s.options.length){ window.__roamDebug.chooseReward(s.options[0]); return 'chosen'; } return s.mode; })()");
    await sleep(600);
    return r;
  };
  const report = { assertions: [], notes: {} };
  const check = (name, ok, detail) => report.assertions.push({ name, ok: !!ok, detail });

  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  // H2 上线后清房发经验、升级会弹四选一，旧流程验收会卡在 reward 模式；关闭成长开关回到"清房发卡"
  await ev("window.__roamDebug.xp.setEnabled(false); true");
  check('开局进入战斗', (await ev("state.mode")) === 'playing', await ev("state.mode"));

  // ============ 1. 房间分区结构 ============
  const floor1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var groups = {};
    s.enemyList.forEach(function(e){ var k = e.roomId + ':' + (e.roomType||'-'); groups[k] = (groups[k]||0)+1; });
    return { rooms: s.rooms, doors: s.doors, corridorRects: s.corridorRects, enemies: s.enemyList,
             groups: groups, variantList: state.rooms.map(function(r){return r.mechVariant;}) };
  })()`);
  report.notes.floor1 = {
    rooms: floor1.rooms.map((r) => ({ id: r.id, type: r.type, variant: r.variant })),
    doors: floor1.doors.length, corridorRects: floor1.corridorRects, groups: floor1.groups
  };
  // P0 之后走廊允许"小规模巡逻怪"（roomId = -2）：房间守军与巡逻怪分开统计
  const roomGuards = floor1.enemies.filter((e) => e.roomId >= 0);
  const patrols1 = floor1.enemies.filter((e) => e.roomId === -2 || e.patrol === true);
  // 区域怪池（P0 扩池到 5 种）必须在页面上下文里取，Node 侧读不到
  const pool1 = await ev('REGION_ENEMY_POOLS[1]');
  report.notes.roomGuards = roomGuards.length;
  report.notes.patrols1 = patrols1.length;
  check('每层 4–7 房间', floor1.rooms.length >= 4 && floor1.rooms.length <= 7, floor1.rooms.length);
  check('敌人全部绑定房间或为走廊巡逻怪', roomGuards.length > 0 && floor1.enemies.every((e) => e.roomId >= 0 || e.roomId === -2), floor1.enemies.length);
  // 首领房守军是 Boss 本体（房间 type='boss'，独立绘制，art 字段为空）
  check('无休整/宝箱/事件房刷怪', roomGuards.every((e) => e.roomType === 'battle' || e.roomType === 'elite' || e.roomType === 'boss'), JSON.stringify(floor1.groups));
  check('机械层敌人 art=mech', roomGuards.length > 0 && roomGuards.every((e) => e.art === 'mech' || e.isBoss === true), Array.from(new Set(roomGuards.map((e) => e.art))).join(','));
  const variants = Array.from(new Set(floor1.rooms.map((r) => r.variant).filter((v) => v != null)));
  check('机械层 ≥3 种房间变体', variants.length >= 3, variants.join('/') + ' 全层=' + floor1.variantList.join(','));
  const typeCount = Array.from(new Set(floor1.rooms.map((r) => r.type)));
  check('本层房型 ≥4 种', typeCount.length >= 4, typeCount.join(','));
  check('门已生成', floor1.doors.length >= 2, floor1.doors.length);
  // Boss 使用独立 typeId（boss_mech / boss_rune / boss_void），不属于常规区域怪池
  check('区域怪池 = 机械五种（P0 扩池）', roomGuards.every((e) => pool1.indexOf(e.typeId) >= 0 || String(e.typeId).indexOf('boss_') === 0),
    Array.from(new Set(roomGuards.map((e) => e.typeId))).join(','));
  check('第 1 层走廊无巡逻怪（走廊安全规则保留）', patrols1.length === 0, patrols1.length);

  // ============ 2. 走廊：所有房间守军都必须在自己房间内；巡逻怪不许进房 ============
  const insideOwnRoom = await ev(`(function(){
    var bad = [];
    var patrolBad = [];
    state.enemies.forEach(function(e){
      if (e.patrol) {
        // 走廊巡逻怪：不得进入任何房间，也不得被当作房间守军
        var inRoom = state.rooms.some(function(r){
          return e.x > r.x && e.x < r.x + r.w && e.y > r.y && e.y < r.y + r.h;
        });
        if (inRoom || e.roomId >= 0) patrolBad.push({ id: e.id, roomId: e.roomId, x: e.x, y: e.y });
        return;
      }
      var r = e.roomId >= 0 ? state.rooms[e.roomId] : null;
      var inside = r ? (e.x > r.x && e.x < r.x + r.w && e.y > r.y && e.y < r.y + r.h) : false;
      if (!inside) bad.push({ id: e.id, roomId: e.roomId });
    });
    return { total: state.enemies.length, bad: bad, patrolBad: patrolBad };
  })()`);
  check('所有房间守军在所属房间内（房间分区成立）', insideOwnRoom.bad.length === 0, JSON.stringify(insideOwnRoom));
  check('走廊巡逻怪没有一只钻进房间', insideOwnRoom.patrolBad.length === 0, JSON.stringify(insideOwnRoom.patrolBad));

  // 找一个"真的在房间外"的走廊点（走廊矩形会伸进房间内，必须排除）
  const corridor = await ev(`(function(){
    var best = null;
    (state.corridorRects||[]).forEach(function(c){
      if (best) return;
      var pts = [[c.x+10, c.y+c.h/2],[c.x+c.w/2, c.y+c.h/2],[c.x+c.w-10, c.y+c.h/2]];
      for (var i=0;i<pts.length;i++){
        var px=pts[i][0], py=pts[i][1];
        var inRoom = state.rooms.some(function(r){ return px>r.x && px<r.x+r.w && py>r.y && py<r.y+r.h; });
        if (!inRoom && isWalkableCircle(px, py, state.player.radius)) { best = { x: px, y: py }; return; }
      }
    });
    return best;
  })()`);
  check('找到真实走廊点', !!corridor, JSON.stringify(corridor));
  if (corridor) {
    await ev(`window.__roamDebug.teleport(${corridor.x}, ${corridor.y})`);
    await sleep(1600);
    await heal();
    const corridorState = await ev(`(function(){
      var p = state.player, insideAny = false;
      state.rooms.forEach(function(r){ if(p.x>r.x&&p.x<r.x+r.w&&p.y>r.y&&p.y<r.y+r.h) insideAny = true; });
      return { inRoom: insideAny, currentRoomId: state.currentRoomId,
               hp: Math.round(p.hp), enemiesNear: state.enemies.filter(function(e){
                 return dist(e.x,e.y,p.x,p.y) < 200; }).length,
               doorsClosed: state.doors.filter(function(d){ return d.closed; }).length };
    })()`);
    check('走廊不算进入房间（不触发战斗）', corridorState.currentRoomId === -1, JSON.stringify(corridorState));
    check('走廊里门全部打开', corridorState.doorsClosed === 0, corridorState.doorsClosed);
    await shot('05_corridor.png');
    report.notes.corridor = corridorState;
  }

  // ============ 3. 宝箱 / 事件房奖励（4 间房的小楼层可能随机不出宝箱房，逐层找一个）============
  let specialRoom = null;
  let utilityFloor = 1;
  for (let f = 1; f <= 6 && !specialRoom; f += 1) {
    if (f > 1) {
      await ensurePlaying();
      await ev(`window.__roamDebug.setFloor(${f}); true`);
      await sleep(800);
    }
    const list = await ev(`(function(){
      return state.rooms.filter(function(r){ return ['chest','event','rest'].indexOf(r.type)>=0; })
        .map(function(r){ return { id:r.id, type:r.type, cx:r.cx, cy:r.cy }; });
    })()`);
    report.notes['utilityFloor' + f] = list.map((r) => r.type);
    const found = list.find((r) => r.type === 'chest' || r.type === 'event');
    if (found) { specialRoom = found; utilityFloor = f; }
  }
  report.notes.utilityRooms = { floor: utilityFloor, room: specialRoom };
  check('找到宝箱/事件房（逐层搜索）', !!specialRoom, JSON.stringify({ floor: utilityFloor, room: specialRoom }));
  if (specialRoom) {
    const before = await ev("(function(){return {c: state.meta.crystals, hp: Math.round(state.player.hp)};})()");
    await ev("state.player.hp = Math.round(state.player.hpMax * 0.5); true");
    await ev(`window.__roamDebug.teleport(${specialRoom.cx}, ${specialRoom.cy})`);
    await sleep(800);
    await shot('06_utility_room_' + specialRoom.type + '.png');
    const after = await ev(`(function(){ var r=state.rooms[${specialRoom.id}]; return { rewarded: r.rewarded, crystals: state.meta.crystals, aether: Math.round(state.player.aether), hp: Math.round(state.player.hp) }; })()`);
    check('宝箱/事件触发一次性奖励', after.rewarded === true, JSON.stringify(after));
    check('宝箱发结晶', specialRoom.type !== 'chest' || after.crystals > before.c, before.c + '→' + after.crystals);
    report.notes.utility = { floor: utilityFloor, room: specialRoom, before, after };
  }
  // 回到第 1 层继续做落闸/清房测试
  await ensurePlaying();
  await ev("window.__roamDebug.setFloor(1); true");
  await sleep(800);

  // ============ 4. 进房落闸 → 清房开门 ============
  // 精英岔路可能把本层所有普通战斗房改写成精英房，因此战斗房找不到时回退到精英房
  // （精英房同样是"进房落闸 → 清光开门"的规则，可用来验证同一套流程）
  const battleRoom = await ev(`(function(){
    var hasEnemy = function(x){ return state.enemies.some(function(e){ return e.roomId === x.id; }); };
    var r = state.rooms.filter(function(x){ return x.type === 'battle' && hasEnemy(x); })[0]
      || state.rooms.filter(function(x){ return x.type === 'elite' && hasEnemy(x); })[0];
    return r ? { id:r.id, cx:r.cx, cy:r.cy, type:r.type, count: state.enemies.filter(function(e){return e.roomId===r.id;}).length } : null;
  })()`);
  check('存在有怪战斗房', !!battleRoom, JSON.stringify(battleRoom));
  if (battleRoom) {
    await ev(`window.__roamDebug.teleport(${battleRoom.cx}, ${battleRoom.cy})`);
    await sleep(1400);
    await heal();
    const locked = await ev(`(function(){
      var r = state.rooms[${battleRoom.id}];
      return { locked: r.locked, cleared: r.cleared, currentRoomId: state.currentRoomId,
               doors: state.doors.filter(function(d){return d.roomId===${battleRoom.id};}).map(function(d){return d.closed;}) };
    })()`);
    check('进房触发落闸（门变红）', locked.locked && locked.doors.some((d) => d === true), JSON.stringify(locked));
    await shot('02_battle_locked.png');
    report.notes.locked = locked;

    // 精英怪死亡可能触发召唤/分裂，所以补一轮"补刀"，确保房间真的清空
    let killed = await ev(`(function(){
      var list = state.enemies.filter(function(e){ return e.roomId === ${battleRoom.id}; });
      list.slice().forEach(function(e){ killEnemy(e); });
      return list.length;
    })()`);
    await sleep(500);
    killed += await ev(`(function(){
      var list = state.enemies.filter(function(e){ return e.roomId === ${battleRoom.id}; });
      list.slice().forEach(function(e){ killEnemy(e); });
      return list.length;
    })()`);
    await sleep(700);
    const opened = await ev(`(function(){
      var r = state.rooms[${battleRoom.id}];
      return { cleared: r.cleared, locked: r.locked,
               doors: state.doors.filter(function(d){return d.roomId===${battleRoom.id};}).map(function(d){return d.closed;}),
               mode: state.mode };
    })()`);
    check('清房后开门（即使顺带清层也不锁着）', opened.cleared && opened.doors.every((d) => d === false), JSON.stringify(opened));
    await shot('03_room_cleared_open.png');
    report.notes.opened = { killed, ...opened };
  }

  // ============ 5. 连杀奖励（新的一层，补 5 只怪测试）============
  await ensurePlaying();
  await ev("window.__roamDebug.setFloor(1); true");
  await sleep(800);
  await ev("window.__roamDebug.setAether(0); state.combo.count = 0; state.combo.timer = 0; true");
  await ev("for (var i=0;i<5;i++) window.__roamDebug.spawnEnemy('wanderer', 100 + i*5, 0); true");
  await sleep(300);
  const comboTest = await ev(`(function(){
    var spawned = state.enemies.slice(-5);
    var before = state.player.aether;
    spawned.forEach(function(e){ killEnemy(e); });
    return { combo: JSON.parse(JSON.stringify(state.combo)),
             aetherBefore: before, aetherAfter: Math.round(state.player.aether),
             hudCombo: (document.getElementById('hudCombo')||{}).textContent,
             hudRoom: (document.getElementById('hudRoomType')||{}).textContent };
  })()`);
  check('连杀计数到 5', comboTest.combo.count === 5, JSON.stringify(comboTest.combo));
  check('5 连发奥能 +18', comboTest.aetherAfter >= Math.floor(comboTest.aetherBefore) + 17, comboTest.aetherBefore + '→' + comboTest.aetherAfter);
  check('HUD 显示连杀', /×5/.test(comboTest.hudCombo || ''), comboTest.hudCombo);
  report.notes.combo = comboTest;

  // ============ 6. 第 2 层精英房 ============
  await ensurePlaying();
  await ev("window.__roamDebug.setFloor(2); true");
  await sleep(900);
  const eliteRoom = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var r = s.rooms.filter(function(x){return x.type==='elite';})[0];
    if (!r) return { room: null, types: s.rooms.map(function(x){return x.type;}) };
    var es = s.enemyList.filter(function(e){return e.roomId===r.id;});
    return { room: r, enemies: es, allElite: es.length>0 && es.every(function(e){return e.elite;}),
             pool: Array.from(new Set(es.map(function(e){return e.typeId;}))),
             art: Array.from(new Set(es.map(function(e){return e.art;}))),
             hp: es.map(function(e){return e.hp;}) };
  })()`);
  check('第 2 层存在精英房', !!eliteRoom.room, JSON.stringify(eliteRoom.room));
  if (eliteRoom.room) {
    check('精英房只刷强化版', eliteRoom.allElite, JSON.stringify(eliteRoom.enemies && eliteRoom.enemies.map((e) => ({ t: e.typeId, elite: e.elite, hp: e.hp }))));
    check('符文层敌人 art=rune', eliteRoom.art.length > 0 && eliteRoom.art.every((a) => a === 'rune'), String(eliteRoom.art));
    await ev(`window.__roamDebug.teleport(${eliteRoom.room.cx}, ${eliteRoom.room.cy})`);
    await sleep(1500);
    await heal();
    await shot('04_elite_room.png');
    report.notes.elite = { room: eliteRoom.room, pool: eliteRoom.pool, hp: eliteRoom.hp, allElite: eliteRoom.allElite };
  }

  // ============ 7. 越界距离：逐间停留 + 击退 ============
  const roomsForLeak = await ev(`(function(){
    return state.rooms.filter(function(r){ return r.type==='battle' || r.type==='elite'; })
      .map(function(r){ return { id:r.id, cx:r.cx, cy:r.cy, type:r.type }; });
  })()`);
  const leakList = [];
  let leakSamples = 0;
  let outsideNow = 0;
  for (const room of roomsForLeak) {
    await ev(`window.__roamDebug.teleport(${room.cx}, ${room.cy})`);
    await sleep(1200);
    await heal();
    await ev(`(function(){
      state.enemies.filter(function(e){return e.roomId===${room.id};}).forEach(function(e){
        e.vx = (Math.random()<0.5?-1:1) * 900;
        e.vy = (Math.random()<0.5?-1:1) * 900;
      });
      return true;
    })()`);
    await sleep(700);
    const snap = await ev(`(function(){
      var list = state.enemies.filter(function(e){return e.roomId===${room.id};});
      var outNow = 0;
      list.forEach(function(e){
        var r = state.rooms[e.roomId];
        if (e.x < r.x || e.x > r.x + r.w || e.y < r.y || e.y > r.y + r.h) outNow++;
      });
      return { leaks: list.map(function(e){ return Number(e.maxLeak.toFixed(2)); }), outNow: outNow };
    })()`);
    leakSamples += snap.leaks.length;
    outsideNow += snap.outNow;
    leakList.push({ roomId: room.id, type: room.type, leaks: snap.leaks, outNow: snap.outNow });
  }
  const maxLeak = leakList.length ? Math.max(0, ...leakList.flatMap((r) => r.leaks)) : 0;
  check('渲染位置无越界（越界敌人数 = 0）', outsideNow === 0, 'outsideNow=' + outsideNow);
  // P0 扩池后新增高移速怪（crawler 122px/s），单帧位移上限 122 × 0.05 ≈ 6.1px，
  // 越界量在"移动后、夹回前"记录，因此阈值放宽到 7px（同帧内必然被夹回房间，见 outNow）
  check('单帧瞬时越界 ≤ 7px（同帧内已夹回）', maxLeak <= 7, 'maxLeak=' + maxLeak + ' samples=' + leakSamples);
  report.notes.leak = { maxLeak, outsideNow, samples: leakSamples, detail: leakList };

  // ============ 8. 全清 → 所有房间开门 + 三选一 ============
  await ev("window.__roamDebug.killAllEnemies(); true");
  await sleep(1000);
  const afterClear = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var combatRooms = s.rooms.filter(function(r){ return r.type==='battle' || r.type==='elite'; });
    return { mode: s.mode, floorCleared: s.floorCleared,
             combatRooms: combatRooms.length,
             clearedCombatRooms: combatRooms.filter(function(r){ return r.cleared; }).length,
             closedDoors: s.doors.filter(function(d){ return d.closed; }).length };
  })()`);
  check('全清后战斗房全部标记已清', afterClear.clearedCombatRooms === afterClear.combatRooms, JSON.stringify(afterClear));
  check('全清后所有门打开', afterClear.closedDoors === 0, afterClear.closedDoors);
  check('全清后进入奖励面板', afterClear.mode === 'reward', afterClear.mode);
  await shot('07_floor_reward.png');
  report.notes.floorClear = afterClear;

  const chosen = await ev("(function(){ var d=window.__roamDebug; for(var g=0; g<4; g+=1){ var s=d.getState(); if(s.mode!=='reward'||!s.options.length) break; d.chooseReward(s.options[0]); } return d.getState().mode; })()");
  await sleep(800);
  check('选择奖励后回到 playing', (await ev("state.mode")) === 'playing', chosen);

  const beforeFloor = await ev("state.floor");
  await ev("window.__roamDebug.descend(); true");
  await sleep(1100);
  const afterFloor = await ev("(function(){var s=window.__roamDebug.getState();return {floor:s.floor, mode:s.mode, enemies:s.enemies, rooms:s.rooms.length, doors:s.doors.length};})()");
  check('下楼到下一层并重建房间/门', afterFloor.floor === beforeFloor + 1 && afterFloor.rooms >= 4 && afterFloor.doors >= 2, JSON.stringify(afterFloor));

  // ============ 9. 死亡结算 + 重开 ============
  await ev("window.__roamDebug.forceDeath(); true");
  await sleep(900);
  const dead = await ev("(function(){var s=window.__roamDebug.getState();return {mode:s.mode, status:s.status};})()");
  check('死亡进入结算', dead.mode === 'result' && dead.status === 'dead', JSON.stringify(dead));
  await shot('08_result.png');

  await ev("window.__roamDebug.restart(); true");
  await sleep(1100);
  const restarted = await ev("(function(){var s=window.__roamDebug.getState();return {mode:s.mode, status:s.status, floor:s.floor, hp:s.hp, hpMax:s.hpMax, enemies:s.enemies, rooms:s.rooms.length};})()");
  check('重开回到第 1 层满血', restarted.mode === 'playing' && restarted.floor === 1 && restarted.hp === restarted.hpMax, JSON.stringify(restarted));

  // ============ 10. 帧率 ============
  const fps = await ev("new Promise(function(res){ var n=0; var t0=performance.now(); function f(){ n++; if(performance.now()-t0<1500) requestAnimationFrame(f); else res(Math.round(n/((performance.now()-t0)/1000))); } requestAnimationFrame(f); })");
  check('帧率 ≥ 60', fps >= 60, fps);
  report.notes.fps = fps;

  // ============ 11. 机械层房间变体截图 ============
  await ensurePlaying();
  await ev("window.__roamDebug.setFloor(1); true");
  await sleep(900);
  const mechRooms = await ev(`(function(){
    return state.rooms.map(function(r){ return { id:r.id, type:r.type, v:r.mechVariant, cx:r.cx, cy:r.cy }; });
  })()`);
  report.notes.mechRooms = mechRooms;
  for (let i = 0; i < mechRooms.length; i += 1) {
    const r = mechRooms[i];
    if (r.type === 'battle' || r.type === 'elite') {
      await ev(`window.__roamDebug.teleport(${r.cx}, ${r.cy})`);
      await sleep(800);
      await heal();
      await shot('09_room_' + i + '_v' + r.v + '_' + r.type + '.png');
      await ev("(function(){ var list=state.enemies.filter(function(e){return e.roomId===" + r.id + ";}); list.forEach(function(e){killEnemy(e);}); return true; })()");
      await sleep(500);
    }
  }
  await shot('01_overview.png');

  const errors = await ev("(window.__errors||[])");
  check('无运行时错误', errors.length === 0, JSON.stringify(errors));
  report.notes.errors = errors;

  console.log(JSON.stringify(report, null, 2));
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });


