// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// P0-敌人更多 专项验收：池 3→5 / 房间同场数量 / 走廊巡逻 / 新怪外形 / 清层不被阻塞
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9745;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p0_more');
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
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const report = { assertions: [], notes: {} };
  const check = (name, ok, detail) => report.assertions.push({ name, ok: !!ok, detail });

  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);

  // 池子长度：每区域 5 种
  const pools = await ev('({1: REGION_ENEMY_POOLS[1].slice(), 2: REGION_ENEMY_POOLS[2].slice(), 3: REGION_ENEMY_POOLS[3].slice()})');
  check('机械层敌人池 = 5 种', pools['1'].length === 5, pools['1']);
  check('符文层敌人池 = 5 种', pools['2'].length === 5, pools['2']);
  check('虚空层敌人池 = 5 种', pools['3'].length === 5, pools['3']);
  report.notes.pools = pools;

  // 逐层检查：房间怪是否都在本层池里 + battle 房同场数量 + 走廊巡逻
  const floors = [];
  for (let floor = 1; floor <= 3; floor += 1) {
    await ev(`window.__roamDebug.setFloor(${floor}); true`);
    await sleep(700);
    await ev(`(function(){
      var s = window.__roamDebug.getState();
      if (s.mode === 'reward' && s.options && s.options.length) window.__roamDebug.chooseReward(s.options[0]);
      return s.mode;
    })()`);
    await sleep(250);
    const info = await ev(`(function(){
      var st = window.__roamDebug.getState();
      var key = ((state.floor - 1) % 3) + 1;
      var pool = REGION_ENEMY_POOLS[key];
      var badTypes = st.enemyList.filter(function(e){
        return e.roomId >= 0 && e.patrol !== true && pool.indexOf(e.typeId) < 0;
      }).map(function(e){ return e.typeId; });
      var battleRoom = st.rooms.filter(function(r){ return r.type === 'battle'; })[0] || null;
      var battleCount = battleRoom
        ? st.enemyList.filter(function(e){ return e.roomId === battleRoom.id; }).length : 0;
      var patrols = st.enemyList.filter(function(e){ return e.patrol; });
      return {
        floor: state.floor, poolKey: key,
        roomEnemies: st.enemyList.filter(function(e){ return e.roomId >= 0; }).length,
        badTypes: badTypes, battleRoomId: battleRoom ? battleRoom.id : null,
        battleCount: battleCount, patrolCount: st.corridorPatrolCount,
        patrols: patrols.map(function(e){
          var pr = e.patrolRect;
          return {
            id: e.id, x: e.x, y: e.y, roomId: e.roomId,
            inRect: !!(pr && e.x >= pr.x - 1 && e.x <= pr.x + pr.w + 1 && e.y >= pr.y - 1 && e.y <= pr.y + pr.h + 1),
            inRoom: !!roomAt(e.x, e.y), maxLeak: e.maxLeak
          };
        })
      };
    })()`);
    floors.push(info);
    check(`第 ${floor} 层：房间怪全部来自本层池（不串区域）`, info.badTypes.length === 0, info.badTypes);
    if (info.battleRoomId != null) {
      check(`第 ${floor} 层：战斗房同场敌人 ≥3（原 2–3 → 3–4）`, info.battleCount >= 3, info.battleCount);
    }
    if (floor >= 2) {
      check(`第 ${floor} 层：走廊巡逻怪数量 ≤2`, info.patrolCount <= 2, info.patrolCount);
      const patrolOK = info.patrols.every((p) => p.inRect && !p.inRoom && p.roomId === -2);
      check(`第 ${floor} 层：巡逻怪都在走廊内、不在房间里`, patrolOK, info.patrols);
    } else {
      check('第 1 层：走廊完全安全（无巡逻怪）', info.patrolCount === 0, info.patrolCount);
    }
    await shot(`floor_${floor}_layout.png`);
  }
  report.notes.floors = floors;

  // 巡逻怪"不追人"：把玩家移回房间中心，跑 2.4 秒，巡逻怪不能离开走廊矩形
  await ev(`window.__roamDebug.setFloor(2); true`);
  await sleep(700);
  await ev(`(function(){
    var st = window.__roamDebug.getState();
    if (st.mode === 'reward' && st.options && st.options.length) window.__roamDebug.chooseReward(st.options[0]);
    var spawnRoom = state.rooms[0];
    state.player.x = spawnRoom.cx;
    state.player.y = spawnRoom.cy;
    state.player.vx = 0; state.player.vy = 0;
    return true;
  })()`);
  await sleep(2400);
  const patrolAfter = await ev(`(function(){
    var st = window.__roamDebug.getState();
    return st.enemyList.filter(function(e){ return e.patrol; }).map(function(e){
      var pr = e.patrolRect;
      return {
        x: e.x, y: e.y, roomId: e.roomId, maxLeak: e.maxLeak,
        inRoom: !!roomAt(e.x, e.y),
        inRect: !!(pr && e.x >= pr.x - 1 && e.x <= pr.x + pr.w + 1 && e.y >= pr.y - 1 && e.y <= pr.y + pr.h + 1)
      };
    });
  })()`);
  check('巡逻怪 2.4 秒内没有离开走廊（也没有追人进房）',
    patrolAfter.every((p) => p.inRect && !p.inRoom && p.roomId === -2),
    patrolAfter);
  check('巡逻怪单帧越界 ≤5px', patrolAfter.every((p) => p.maxLeak <= 5), patrolAfter);
  report.notes.patrolAfter = patrolAfter;

  // 新怪外形：逐区域把 5 种都摆出来截图（确认没有空白 / 报错）
  const spawnShowcase = async (floor, ids, name) => {
    await ev(`window.__roamDebug.setFloor(${floor}); true`);
    await sleep(650);
    await ev(`(function(){
      var st = window.__roamDebug.getState();
      if (st.mode === 'reward' && st.options && st.options.length) window.__roamDebug.chooseReward(st.options[0]);
      state.enemies.length = 0;
      var room = null;
      for (var i = 0; i < state.rooms.length; i += 1) {
        if (state.rooms[i].type === 'battle') { room = state.rooms[i]; break; }
      }
      room = room || state.rooms[0];
      state.player.x = room.cx;
      state.player.y = room.cy - 40;
      var ids = ${JSON.stringify(ids)};
      ids.forEach(function(id, k){
        var ax = room.cx - 120 + k * 60;
        var ay = room.cy + 40;
        var en = spawnEnemy(id, ax, ay, state.floor, { roomId: room.id });
        en.speed = 0;
        en.ai = 'chaser';
      });
      return state.enemies.length;
    })()`);
    await sleep(500);
    await shot(name);
    const drawn = await ev('window.__roamDebug.getState().enemyList.map(function(e){ return e.typeId; })');
    check(`${name}：5 种新怪都生成`, drawn.length === 5, drawn);
  };
  await spawnShowcase(1, ['assembler', 'welder', 'patrol', 'riveter', 'crawler'], 'mech_pool5.png');
  await spawnShowcase(2, ['runesprite', 'graveter', 'hexer', 'cipher', 'warden'], 'rune_pool5.png');
  await spawnShowcase(3, ['stalker', 'shardling', 'devourer', 'riftling', 'screamer'], 'void_pool5.png');

  // 清层不被走廊怪阻塞：只杀房间怪，留下巡逻怪，仍应判定清层
  await ev(`window.__roamDebug.setFloor(2); true`);
  await sleep(650);
  await ev(`(function(){
    var st = window.__roamDebug.getState();
    if (st.mode === 'reward' && st.options && st.options.length) window.__roamDebug.chooseReward(st.options[0]);
    return true;
  })()`);
  const patrolBeforeClear = await ev('state.enemies.filter(function(e){ return e.patrol; }).length');
  await ev(`(function(){
    // 只杀"房间守军"，走廊巡逻怪留着
    state.enemies.filter(function(e){ return e.roomId >= 0; }).forEach(function(e){
      damageEnemy(e, 99999, 0);
    });
    return true;
  })()`);
  await sleep(600);
  const clearState = await ev(`(function(){
    var st = window.__roamDebug.getState();
    return { floorCleared: st.floorCleared, mode: st.mode, patrolsLeft:
      st.enemyList.filter(function(e){ return e.patrol; }).length };
  })()`);
  check('走廊巡逻怪存在时清层仍然触发（不被阻塞）',
    clearState.floorCleared === true || clearState.mode === 'reward', clearState);
  report.notes.clearState = clearState;
  report.notes.patrolBeforeClear = patrolBeforeClear;

  // 帧率 / 报错
  await sleep(300);
  const st = await ev('window.__roamDebug.getState()');
  check('帧率 ≥60', st.fps >= 60, st.fps);
  report.notes.fps = st.fps;
  const errors = await ev('window.__roamDebug.errors()');
  check('运行无报错', Array.isArray(errors) && errors.length === 0, errors);
  report.notes.errors = errors;
  await shot('final.png');

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  const failed = report.assertions.filter((a) => !a.ok);
  console.log(JSON.stringify(report, null, 2));
  console.log('==== 结果：' + (report.assertions.length - failed.length) + '/' + report.assertions.length + ' 通过 ====');
  if (failed.length) console.log('失败项：' + failed.map((a) => a.name).join(' | '));
  ws.close(); killEdge(edge);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
