// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9722;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'flow');
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression.slice(0, 80) + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
  const heal = () => ev("state.player.hp = state.player.hpMax; true");

  const report = { assertions: [], notes: {} };
  const check = (name, ok, detail) => report.assertions.push({ name, ok: !!ok, detail });

  // ---------- 0. 开局 ----------
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  check('start-enters-playing', (await ev("state.mode")) === 'playing', await ev("state.mode"));

  // ---------- 1. 房间分区结构 ----------
  const floor1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var groups = {};
    s.enemyList.forEach(function(e){ var k = e.roomId + ':' + (e.roomType||'-'); groups[k] = (groups[k]||0)+1; });
    return { rooms: s.rooms, doors: s.doors, corridorRects: s.corridorRects, enemies: s.enemyList,
             groups: groups, theme: state.themeId, mechVariants: state.rooms.map(function(r){return r.mechVariant;}) };
  })()`);
  report.notes.floor1 = {
    rooms: floor1.rooms.map((r) => ({ id: r.id, type: r.type, variant: r.variant, cleared: r.cleared })),
    doors: floor1.doors.length,
    corridorRects: floor1.corridorRects,
    groups: floor1.groups,
    mechVariants: floor1.mechVariants
  };

  const battleEnemies = floor1.enemies.filter((e) => (e.roomType === 'battle' || e.roomType === 'elite'));
  check('每层 4–7 房间', floor1.rooms.length >= 4 && floor1.rooms.length <= 7, floor1.rooms.length);
  check('敌人全部绑定房间', floor1.enemies.length > 0 && floor1.enemies.every((e) => e.roomId >= 0), floor1.enemies.length);
  check('无休整/宝箱/事件房刷怪', floor1.enemies.every((e) => e.roomType === 'battle' || e.roomType === 'elite'),
    JSON.stringify(floor1.groups));
  check('机械层敌人 art=mech', floor1.enemies.every((e) => e.art === 'mech'),
    Array.from(new Set(floor1.enemies.map((e) => e.art))).join(','));
  const variants = Array.from(new Set(floor1.rooms.map((r) => r.variant).filter((v) => v != null)));
  check('机械层 ≥3 种房间变体', variants.length >= 3, variants.join('/'));
  check('门已生成', floor1.doors.length >= 2, floor1.doors.length);

  // 主题组合：每个战斗房的敌人种类应来自本层池（机械层 3 种）
  const typeSet = Array.from(new Set(floor1.enemies.map((e) => e.typeId)));
  check('区域怪池 = 机械三种', typeSet.every((t) => ['assembler', 'welder', 'patrol'].indexOf(t) >= 0), typeSet.join(','));

  // ---------- 2. 走廊安全：把玩家丢到走廊，敌人不得进入走廊 ----------
  const corridor = await ev(`(function(){
    var c = (state.corridorRects||[])[0]; if(!c) return null;
    return { x: c.x + c.w/2, y: c.y + c.h/2 };
  })()`);
  if (corridor) {
    const okTeleport = await ev(`window.__roamDebug.teleport(${corridor.x}, ${corridor.y})`);
    await sleep(1500);
    const corridorCheck = await ev(`(function(){
      var leaks = state.enemies.map(function(e){
        // 敌人在走廊内的次数：检查是否落在任一走廊矩形内
        var inside = (state.corridorRects||[]).some(function(c){
          return e.x > c.x && e.x < c.x+c.w && e.y > c.y && e.y < c.y+c.h;
        });
        return inside ? 1 : 0;
      });
      return { enemiesInCorridor: leaks.reduce(function(a,b){return a+b;},0),
               currentRoomId: state.currentRoomId, doorsClosed: state.doors.filter(function(d){return d.closed;}).length };
    })()`);
    check('走廊内无敌人', corridorCheck.enemiesInCorridor === 0, JSON.stringify(corridorCheck));
    await shot('05_corridor.png');
    report.notes.corridor = { teleport: okTeleport, ...corridorCheck };
  } else {
    check('存在走廊矩形', false, 'none');
  }

  // ---------- 3. 进战斗房 → 锁门 → 截图 ----------
  const battleRoom = await ev(`(function(){
    var r = state.rooms.filter(function(x){return x.type==='battle' && state.enemies.some(function(e){return e.roomId===x.id;});})[0];
    return r ? { id:r.id, cx:r.cx, cy:r.cy } : null;
  })()`);
  check('存在有怪战斗房', !!battleRoom, JSON.stringify(battleRoom));
  if (battleRoom) {
    await ev(`window.__roamDebug.teleport(${battleRoom.cx}, ${battleRoom.cy})`);
    await sleep(1300);
    await heal();
    const locked = await ev(`(function(){
      var r = state.rooms[${battleRoom.id}];
      return { locked: r.locked, cleared: r.cleared,
               doors: state.doors.filter(function(d){return d.roomId===${battleRoom.id};}).map(function(d){return d.closed;}),
               currentRoomId: state.currentRoomId };
    })()`);
    check('进房触发落闸', locked.locked && locked.doors.some((d) => d === true), JSON.stringify(locked));
    await shot('02_battle_locked.png');
    report.notes.locked = locked;

    // ---------- 4. 清空本房 → 开门 + 奖励反馈 ----------
    const killedInRoom = await ev(`(function(){
      var list = state.enemies.filter(function(e){ return e.roomId === ${battleRoom.id}; });
      var n = list.length;
      list.slice().forEach(function(e){ killEnemy(e); });
      return n;
    })()`);
    await sleep(700);
    const opened = await ev(`(function(){
      var r = state.rooms[${battleRoom.id}];
      return { cleared: r.cleared, locked: r.locked,
               doors: state.doors.filter(function(d){return d.roomId===${battleRoom.id};}).map(function(d){return d.closed;}) };
    })()`);
    check('清房后开门', opened.cleared && opened.doors.every((d) => d === false), JSON.stringify(opened));
    await shot('03_room_cleared_open.png');
    report.notes.opened = { killedInRoom, ...opened };
  }

  // ---------- 5. 连杀奖励 ----------
  const comboTest = await ev(`(function(){
    var before = state.player.aether;
    var beforeMeta = state.meta.crystals;
    // 找一间还有 3 只以上敌人的房间，补足到 5 连
    state.combo.count = 0; state.combo.timer = 0;
    var pool = state.enemies.slice(0, 5);
    var kills = 0;
    pool.forEach(function(e){ killEnemy(e); kills++; });
    return { kills: kills, combo: JSON.parse(JSON.stringify(state.combo)),
             aetherBefore: before, aetherAfter: state.player.aether,
             crystalsBefore: beforeMeta, crystalsAfter: state.meta.crystals };
  })()`);
  check('连杀计数生效', comboTest.combo.count >= 2 && comboTest.combo.count === comboTest.kills, JSON.stringify(comboTest.combo));
  check('连杀奖励发奥能', comboTest.aetherAfter >= comboTest.aetherBefore + 18, comboTest.aetherBefore + '→' + comboTest.aetherAfter);
  report.notes.combo = comboTest;

  // ---------- 6. 精英房（第 2 层保证存在）----------
  await ev("window.__roamDebug.setFloor(2); true");
  await sleep(900);
  const eliteRoom = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var r = s.rooms.filter(function(x){return x.type==='elite';})[0];
    if (!r) return { room: null, rooms: s.rooms.map(function(x){return x.type;}) };
    var es = s.enemyList.filter(function(e){return e.roomId===r.id;});
    return { room: r, enemies: es, allElite: es.length>0 && es.every(function(e){return e.elite;}),
             pool: Array.from(new Set(es.map(function(e){return e.typeId;}))),
             art: Array.from(new Set(es.map(function(e){return e.art;}))), hp: es.map(function(e){return e.hp;}) };
  })()`);
  check('第 2 层存在精英房', !!eliteRoom.room, JSON.stringify(eliteRoom.room));
  if (eliteRoom.room) {
    check('精英房只刷强化版', eliteRoom.allElite, JSON.stringify(eliteRoom.enemies && eliteRoom.enemies.map((e) => ({ t: e.typeId, elite: e.elite, hp: e.hp }))));
    check('符文层敌人 art=rune', eliteRoom.art.every((a) => a === 'rune'), String(eliteRoom.art));
    await ev(`window.__roamDebug.teleport(${eliteRoom.room.cx}, ${eliteRoom.room.cy})`);
    await sleep(1400);
    await heal();
    await shot('04_elite_room.png');
    report.notes.elite = { room: eliteRoom.room, pool: eliteRoom.pool, hp: eliteRoom.hp, allElite: eliteRoom.allElite };
  }

  // ---------- 7. 越界距离：在每个战斗房里待 2 秒，敌人不得越界 ----------
  const roomsForLeak = await ev(`(function(){
    return state.rooms.filter(function(r){ return r.type==='battle' || r.type==='elite'; })
      .map(function(r){ return { id:r.id, cx:r.cx, cy:r.cy, type:r.type }; });
  })()`);
  const leakList = [];
  for (const room of roomsForLeak) {
    await ev(`window.__roamDebug.teleport(${room.cx}, ${room.cy})`);
    await sleep(1500);
    await heal();
    const snap = await ev(`(function(){
      return state.enemies.filter(function(e){return e.roomId===${room.id};}).map(function(e){ return Number(e.maxLeak.toFixed(2)); });
    })()`);
    leakList.push({ roomId: room.id, type: room.type, leaks: snap });
  }
  const maxLeak = Math.max(0, ...leakList.flatMap((r) => r.leaks));
  check('敌人不越出房间边界（最大越界 ≤ 0.5px）', maxLeak <= 0.5, 'maxLeak=' + maxLeak);
  report.notes.leak = { maxLeak, detail: leakList };

  // ---------- 8. 宝箱 / 事件 / 休整房奖励 ----------
  const utility = await ev(`(function(){
    var s = window.__roamDebug.getState();
    return s.rooms.filter(function(r){ return ['chest','event','rest','start'].indexOf(r.type)>=0; })
      .map(function(r){ return { id:r.id, type:r.type, cx:r.cx, cy:r.cy, rewarded: r.cleared }; });
  })()`);
  report.notes.utilityRooms = utility;
  const specialRoom = utility.find((r) => r.type === 'chest' || r.type === 'event');
  if (specialRoom) {
    await ev(`window.__roamDebug.teleport(${specialRoom.cx}, ${specialRoom.cy})`);
    await sleep(700);
    await heal();
    await shot('06_utility_room_' + specialRoom.type + '.png');
    const rewarded = await ev(`(function(){ var r=state.rooms[${specialRoom.id}]; return { rewarded: r.rewarded, crystals: state.meta.crystals }; })()`);
    check('宝箱/事件房发奖励', rewarded.rewarded === true, JSON.stringify(rewarded));
    report.notes.utility = { room: specialRoom, ...rewarded };
  }

  // ---------- 9. 全清 → 三选一 → 下楼 ----------
  await ev("window.__roamDebug.killAllEnemies(); true");
  await sleep(900);
  const afterClear = await ev(`(function(){
    var s = window.__roamDebug.getState();
    return { mode: s.mode, floorCleared: s.floorCleared, roomsCleared: state.rooms.every(function(r){return r.cleared || r.type==='start';}), stairs: s.stairs };
  })()`);
  check('全清后进入奖励面板', afterClear.mode === 'reward', JSON.stringify(afterClear));
  await shot('07_floor_reward.png');
  report.notes.floorClear = afterClear;

  const chosen = await ev("window.__roamDebug.chooseReward(window.__roamDebug.getState().options[0])");
  await sleep(700);
  const afterChoose = await ev("(function(){var s=window.__roamDebug.getState();return {mode:s.mode, floor:s.floor};})()");
  check('选择奖励后回到 playing', afterChoose.mode === 'playing', JSON.stringify(afterChoose));

  const beforeFloor = await ev("state.floor");
  await ev("window.__roamDebug.descend(); true");
  await sleep(1000);
  const afterFloor = await ev("(function(){var s=window.__roamDebug.getState();return {floor:s.floor, mode:s.mode, enemies:s.enemies, rooms:s.rooms.length, doors:s.doors.length};})()");
  check('下楼进入下一层且重建房间/门', afterFloor.floor === beforeFloor + 1 && afterFloor.rooms >= 4 && afterFloor.doors >= 2,
    JSON.stringify(afterFloor));

  // ---------- 10. 死亡结算 + 重开 ----------
  await ev("window.__roamDebug.forceDeath(); true");
  await sleep(900);
  const dead = await ev("(function(){var s=window.__roamDebug.getState();return {mode:s.mode, status:s.status};})()");
  check('死亡进入结算', dead.mode === 'result' && dead.status === 'dead', JSON.stringify(dead));
  await shot('08_result.png');

  await ev("window.__roamDebug.restart(); true");
  await sleep(1000);
  const restarted = await ev("(function(){var s=window.__roamDebug.getState();return {mode:s.mode, status:s.status, floor:s.floor, hp:s.hp, enemies:s.enemies, rooms:s.rooms.length};})()");
  check('重开回到第 1 层满血', restarted.mode === 'playing' && restarted.floor === 1 && restarted.hp === restarted.hpMax, JSON.stringify(restarted));

  // ---------- 11. 帧率 ----------
  const fps = await ev("new Promise(function(res){ var n=0; var t0=performance.now(); function f(){ n++; if(performance.now()-t0<1500) requestAnimationFrame(f); else res(Math.round(n/((performance.now()-t0)/1000))); } requestAnimationFrame(f); })");
  check('帧率 ≥ 60', fps >= 60, fps);
  report.notes.fps = fps;

  // ---------- 12. 截图：房间变体 ----------
  await ev("window.__roamDebug.setFloor(1); true");
  await sleep(900);
  const mechRooms = await ev(`(function(){
    return state.rooms.map(function(r){ return { id:r.id, type:r.type, v:r.mechVariant, cx:r.cx, cy:r.cy }; });
  })()`);
  for (let i = 0; i < mechRooms.length; i += 1) {
    const r = mechRooms[i];
    if (r.type === 'battle' || r.type === 'elite') {
      await ev(`window.__roamDebug.teleport(${r.cx}, ${r.cy})`);
      await sleep(700);
      await heal();
      await shot('09_room_' + i + '_v' + r.v + '_' + r.type + '.png');
      await ev("(function(){ var list=state.enemies.filter(function(e){return e.roomId===" + r.id + ";}); list.forEach(function(e){killEnemy(e);}); return true; })()");
      await sleep(400);
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
