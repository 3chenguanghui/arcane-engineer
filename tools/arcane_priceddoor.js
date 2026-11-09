/**
 * A2 双价门验收：A0–A9
 * 用法：node tools/arcane_priceddoor.js
 * 端口：9520
 * 输出：.screenshots/art/priced-door.png、priced-door-result.json
 *
 * 断言：
 *  A0 配置默认值（每层 1 组 / 三种代价 / 15% 生命 / 3 余烬）
 *  A1 连续 3 层都生成 1 组双价门：分叉房有 ≥2 扇通往不同目标的门，且两侧房各一个标记
 *  A2 信息对称：代价门写明"代价 · … 必得稀有"，安全门写明"安全 · 普通奖励"
 *  A3 生命代价：进代价房后 hpMax 按 15% 下降、paid 标记与统计 +1
 *  A4 余烬代价：10 余烬 → 7
 *  A5 波次代价：进房后该房敌人 +2
 *  A6 付不起：退回分叉房中心、hpMax 不变、declined=1
 *  A7 清房奖励：付过款的代价房清空后结晶 +1、奖励等级 +1
 *  A8 门板第三行真的画出来：靠近代价门时 DOOR_INFO_STATS.priced ≥ 1
 *  A9 截图 >10KB / fps≥60 / 无脚本错误
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9520;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

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
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };
  /** 把玩家放到某间房中心（并吸附相机），用于"走进代价房" */
  const teleportRoom = async (roomId) => ev(`(function(){
    var room = state.rooms[${roomId}];
    state.player.x = room.cx; state.player.y = room.cy;
    state.player.vx = 0; state.player.vy = 0;
    snapCamera();
    return { x: room.cx, y: room.cy };
  })()`);
  /** 强制生成指定代价的双价门；若当前布局没有可用分叉，换一层再试（最多 3 次） */
  const forceSetup = async (kind) => {
    for (let i = 0; i < 3; i += 1) {
      const st = await ev(`window.__roamDebug.pricedDoors.setup('${kind}')`);
      if (st) return st;
      await ev(`generateFloor(1)`);
      await sleep(320);
    }
    return null;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1300);

  // ---------- A0 配置 ----------
  const a0 = await ev(`window.__roamDebug.pricedDoors.info()`);
  ok('A0 配置默认值（每层 1 组 / hp 15% / 余烬 3 / 波次 2 只）',
    a0.enabled === true && a0.config.perFloor === 1
      && a0.config.hpPct === 0.15 && a0.config.emberCost === 3
      && a0.config.waveEnemies === 2 && a0.config.bonusCrystals === 1, a0.config);

  // ---------- A1 每层 1 组 ----------
  const floors = [];
  for (const f of [1, 2, 3]) {
    await ev(`generateFloor(${f})`);
    await sleep(320);
    floors.push(await ev(`(function(){
      var info = window.__roamDebug.pricedDoors.info();
      var st = info.current;
      var fork = st ? state.rooms[st.forkId] : null;
      var outs = st ? state.doors.filter(function(d){ return d.roomId === st.forkId && d.targetRoomId >= 0; }) : [];
      var uniq = [];
      outs.forEach(function(d){ if (uniq.indexOf(d.targetRoomId) < 0) uniq.push(d.targetRoomId); });
      return {
        floor: state.floor, current: st, tags: info.tags,
        uniqueTargets: uniq.length, hasPaid: !!(st && st.paidRoomId != null),
        hasSafe: !!(st && st.safeRoomId != null),
        bossTagged: info.tags.some(function(t){ return t.type === 'boss'; })
      };
    })()`));
  }
  ok('A1 连续 3 层都有 1 组双价门（分叉 ≥2 个不同目标，两侧各一个标记，首领房不参与）',
    floors.length === 3 && floors.every((x) => x.current && x.tags.length === 2
      && x.uniqueTargets >= 2 && x.hasPaid && x.hasSafe && !x.bossTagged), floors);

  // 回到第 1 层做后续断言
  await ev(`generateFloor(1)`);
  await sleep(320);

  // ---------- A2 信息对称 ----------
  const a2 = await ev(`(function(){
    var rows = window.__roamDebug.pricedDoors.infoFor();
    return rows.map(function(row){
      return { roomId: row.roomId, side: row.side, info: row.info && {
        typeName: row.info.typeName, tip: row.info.tip, riskLabel: row.info.riskLabel, priced: row.info.priced
      } };
    });
  })()`);
  const paidRow = a2.find((r) => r.side === 'paid');
  const safeRow = a2.find((r) => r.side === 'safe');
  ok('A2 两侧信息都写清楚：代价门有"代价 … 必得稀有"，安全门有"安全 · 普通奖励"',
    !!paidRow && !!safeRow && !!paidRow.info && !!paidRow.info.priced
      && /代价|付不起/.test(paidRow.info.priced.text)
      && !!safeRow.info.priced && /安全/.test(safeRow.info.priced.text)
      && !!paidRow.info.tip && !!safeRow.info.tip, a2);

  // ---------- A8 门板第三行真的画出（先做，避免房间被锁后门板隐藏） ----------
  const a8 = await ev(`(function(){
    var st = state.pricedDoors;
    var savedLock = ROOM_FLOW_CONFIG.lockDoors;
    ROOM_FLOW_CONFIG.lockDoors = false;               // 测试隔离：不让分叉房落闸把门板遮住
    var forkRoom = state.rooms[st.forkId];
    forkRoom.locked = false;
    var door = state.doors.find(function(d){ return d.targetRoomId === st.paidRoomId; });
    door.anim = 0; door.closed = 0;
    var dx = forkRoom.cx - door.x, dy = forkRoom.cy - door.y;
    var len = Math.hypot(dx, dy) || 1;
    state.player.x = door.x + dx / len * 42;
    state.player.y = door.y + dy / len * 42;
    state.player.vx = 0; state.player.vy = 0;
    snapCamera();
    window.__a8SavedLock = savedLock;
    return { door: { x: door.x, y: door.y }, player: { x: state.player.x, y: state.player.y } };
  })()`);
  await sleep(320);
  const a8stats = await ev(`window.__roamDebug.doorInfo.info().stats`);
  await ev(`(function(){
    ROOM_FLOW_CONFIG.lockDoors = window.__a8SavedLock;
    delete window.__a8SavedLock;
    return true;
  })()`);
  ok('A8 靠近代价门时第三行被绘制（DOOR_INFO_STATS.priced ≥ 1）',
    a8stats.priced >= 1 && a8stats.labels >= 1, { a8, stats: a8stats });

  // ---------- A3 生命代价 ----------
  await ev(`generateFloor(1)`);
  await sleep(320);
  const a3setup = await forceSetup('hp');
  ok('A3-0 强制生成 hp 双价门', !!a3setup && a3setup.costKind === 'hp', a3setup);
  const a3before = await ev(`({ hpMax: state.player.hpMax, hp: state.player.hp,
    paid: window.__roamDebug.pricedDoors.info().stats.paid,
    cost: window.__roamDebug.pricedDoors.cost('hp') })`);
  await teleportRoom(a3setup.paidRoomId);
  await sleep(300);
  const a3after = await ev(`(function(){
    var info = window.__roamDebug.pricedDoors.info();
    return { hpMax: state.player.hpMax, hp: state.player.hp, paid: info.stats.paid,
      currentPaid: info.current ? info.current.paid : null };
  })()`);
  ok('A3 进代价房后最大生命按 15% 扣除，paid 标记与统计 +1',
    a3after.hpMax === a3before.hpMax - a3before.cost.amount
      && a3after.paid === a3before.paid + 1 && a3after.currentPaid === true
      && Math.abs(a3before.cost.amount - Math.round(a3before.hpMax * 0.15)) <= 1,
    { before: a3before, after: a3after });

  // ---------- A4 余烬代价 ----------
  await ev(`generateFloor(1)`);
  await sleep(320);
  const a4setup = await ev(`(function(){ state.embers = 10; return true; })()`);
  const a4st = await forceSetup('ember');
  await teleportRoom(a4st.paidRoomId);
  await sleep(300);
  const a4 = await ev(`({ embers: state.embers, paid: window.__roamDebug.pricedDoors.info().stats.paid })`);
  ok('A4 余烬代价：10 → 7，且记一次 paid', a4.embers === 7 && a4.paid >= 1, { setup: a4st, after: a4 });

  // ---------- A5 波次代价 ----------
  await ev(`generateFloor(1)`);
  await sleep(320);
  const a5setup = await forceSetup('wave');
  const a5before = await ev(`(function(){
    var id = state.pricedDoors.paidRoomId;
    return { count: state.enemies.filter(function(e){ return e.roomId === id; }).length, id: id };
  })()`);
  await teleportRoom(a5setup.paidRoomId);
  await sleep(360);
  const a5after = await ev(`(function(){
    var id = state.pricedDoors.paidRoomId;
    return { count: state.enemies.filter(function(e){ return e.roomId === id; }).length,
      paid: state.pricedDoors.paid };
  })()`);
  ok('A5 波次代价：进房后该房敌人 +2（且 paid=true）',
    a5after.count === a5before.count + 2 && a5after.paid === true, { before: a5before, after: a5after });

  // ---------- A6 付不起被退回 ----------
  await ev(`generateFloor(1)`);
  await sleep(320);
  const a6setup = await ev(`(function(){
    var st = window.__roamDebug.pricedDoors.setup('hp');
    if (st) { state.player.hpMax = 20; state.player.hp = 20; }
    return { st: st, cost: window.__roamDebug.pricedDoors.cost('hp'), hpMax: state.player.hpMax };
  })()`);
  if (!a6setup.st) {
    await ev(`generateFloor(1)`);
    await sleep(320);
    Object.assign(a6setup, await ev(`(function(){
      var st = window.__roamDebug.pricedDoors.setup('hp');
      if (st) { state.player.hpMax = 20; state.player.hp = 20; }
      return { st: st, cost: window.__roamDebug.pricedDoors.cost('hp'), hpMax: state.player.hpMax };
    })()`));
  }
  await teleportRoom(a6setup.st.paidRoomId);
  await sleep(320);
  const a6 = await ev(`(function(){
    var st = state.pricedDoors;
    var fork = state.rooms[st.forkId];
    return {
      declined: st.declined, paid: st.paid,
      hpMax: state.player.hpMax, cost: window.__roamDebug.pricedDoors.cost('hp'),
      forkDist: Math.round(Math.hypot(state.player.x - fork.cx, state.player.y - fork.cy)),
      statsDeclined: window.__roamDebug.pricedDoors.info().stats.declined
    };
  })()`);
  ok('A6 付不起：declined=true、退回分叉房中心、最大生命不变',
    a6.declined === true && a6.paid === false && a6.hpMax === 20
      && a6.forkDist <= 2 && a6.cost.affordable === false && a6.statsDeclined >= 1, { setup: a6setup, after: a6 });

  // ---------- A7a 自然房型：非战斗房进房即发 / 战斗房清房后发 ----------
  // 两种房型都可能被 setup 选中，因此断言"结算完成后"的最终值，而不是固定在清房那一刻：
  //   非战斗房（宝箱/事件/休整）→ handlePricedRoomEntry 付款当帧就发稀有
  //   战斗房 → 先付款，等该房敌人清空由 onRoomCleared 发稀有
  await ev(`generateFloor(1)`);
  await sleep(320);
  const a7setup = await ev(`(function(){
    state.player.hpMax = 100; state.player.hp = 100;
    var st = window.__roamDebug.pricedDoors.setup('hp');
    return { st: st, crystals: state.meta.crystals, charges: state.eliteRewardCharges,
      bonus: window.__roamDebug.pricedDoors.info().stats.bonusGranted };
  })()`);
  if (!a7setup.st) {
    await ev(`generateFloor(1)`);
    await sleep(320);
    Object.assign(a7setup, await ev(`(function(){
      state.player.hpMax = 100; state.player.hp = 100;
      var st = window.__roamDebug.pricedDoors.setup('hp');
      return { st: st, crystals: state.meta.crystals, charges: state.eliteRewardCharges,
        bonus: window.__roamDebug.pricedDoors.info().stats.bonusGranted };
    })()`));
  }
  await teleportRoom(a7setup.st.paidRoomId);
  await sleep(420);   // 等落闸 + 付款（非战斗房此时已发奖）
  const a7paid = await ev(`(function(){
    var id = state.pricedDoors.paidRoomId, room = state.rooms[id];
    var type = ROOM_TYPE_CONFIG.types[room.type] || ROOM_TYPE_CONFIG.types.battle;
    return { paid: state.pricedDoors.paid, locked: !!room.locked, crystals: state.meta.crystals,
      charges: state.eliteRewardCharges, combat: type.count[1] > 0, type: room.type,
      enemies: state.enemies.filter(function(e){ return e.roomId === id; }).length };
  })()`);
  // 若该房是战斗房，这里把敌人清空，让下一帧 onRoomCleared 走清房发奖路径
  await ev(`(function(){
    var id = state.pricedDoors.paidRoomId;
    state.enemies = state.enemies.filter(function(e){ return e.roomId !== id; });
    return true;
  })()`);
  await sleep(400);
  const a7after = await ev(`(function(){
    var broom = state.rooms[state.pricedDoors.paidRoomId];
    return { cleared: !!broom.cleared, crystals: state.meta.crystals, charges: state.eliteRewardCharges,
      bonus: window.__roamDebug.pricedDoors.info().stats.bonusGranted };
  })()`);
  // 注意：若代价房恰好是精英房，清房本身还会给 +1 结晶 / 精英路线 +1 等级，
  // 所以这里只断言"至少 +1"（代价门自己那一份），并用 bonusGranted 恰好 +1 证明没有重复发放。
  ok('A7a 代价门必得稀有：结晶 ≥+1、奖励等级 ≥+1，且只发一次（进房即发 / 清房发两路径）',
    !!a7setup.st && a7paid.paid === true
      && a7after.crystals >= a7setup.crystals + 1
      && a7after.charges >= a7setup.charges + 1
      && a7after.bonus === a7setup.bonus + 1
      && (a7paid.combat ? a7after.cleared === true : true),
    { setup: a7setup, paid: a7paid, after: a7after });

  // ---------- A7b 强制战斗房：先付款不发奖，清空敌人后由 onRoomCleared 发 ----------
  /* A7a 的代价房可能是战斗房：清房会弹出三选一奖励并把 mode 切走，
     下一段 teleport 后 updateRoomLogic 不再运行，会被误判成"没付款"。
     这里先把上一段的奖励弹窗结掉，再回到 playing，保证 A7b 起始状态干净。 */
  await ev(`(function(){
    var b = document.querySelector('#modal [data-reward-key]');
    if (b) b.click();
    state.mode = 'playing'; state.status = 'playing';
    return { mode: state.mode };
  })()`);
  await sleep(260);
  await ev(`generateFloor(1)`);
  await sleep(320);
  const a7bSetup = await ev(`(function(){
    state.player.hpMax = 100; state.player.hp = 100;
    var st = window.__roamDebug.pricedDoors.setup('hp');
    if (!st) return { st: null };
    var room = state.rooms[st.paidRoomId];
    // 强制把它变成战斗房，确保走 onRoomCleared 发奖路径
    room.type = 'battle'; room.cleared = false; room.locked = false;
    /* 测试隔离：若该房正好在精英路线上，清房会额外 +1 奖励等级（独立系统），
       会把"代价门只发一次 +1 等级"的断言污染成 +2。这里把它从精英路线摘掉，
       只保留代价门自身那 1 级，断言仍然严格等于 +1。 */
    if (state.eliteRoute && Array.isArray(state.eliteRoute.roomIds)) {
      state.eliteRoute.roomIds = state.eliteRoute.roomIds.filter(function(id){ return id !== room.id; });
    }
    state.enemies = state.enemies.filter(function(e){ return e.roomId !== room.id; });
    return { st: st, crystals: state.meta.crystals, charges: state.eliteRewardCharges,
      bonus: window.__roamDebug.pricedDoors.info().stats.bonusGranted };
  })()`);
  if (!a7bSetup.st) {
    await ev(`generateFloor(1)`);
    await sleep(320);
    Object.assign(a7bSetup, await ev(`(function(){
      state.player.hpMax = 100; state.player.hp = 100;
      var st = window.__roamDebug.pricedDoors.setup('hp');
      if (!st) return { st: null };
      var room = state.rooms[st.paidRoomId];
      room.type = 'battle'; room.cleared = false; room.locked = false;
      // 同上：摘掉精英路线标记，避免清房奖励等级干扰"只发一次"的断言
      if (state.eliteRoute && Array.isArray(state.eliteRoute.roomIds)) {
        state.eliteRoute.roomIds = state.eliteRoute.roomIds.filter(function(id){ return id !== room.id; });
      }
      state.enemies = state.enemies.filter(function(e){ return e.roomId !== room.id; });
      return { st: st, crystals: state.meta.crystals, charges: state.eliteRewardCharges,
        bonus: window.__roamDebug.pricedDoors.info().stats.bonusGranted };
    })()`));
  }
  await teleportRoom(a7bSetup.st.paidRoomId);
  await sleep(420);
  const a7b = await ev(`(function(){
    var st = state.pricedDoors, room = state.rooms[st.paidRoomId];
    return { paid: st.paid, cleared: !!room.cleared, type: room.type,
      crystals: state.meta.crystals, charges: state.eliteRewardCharges,
      bonus: window.__roamDebug.pricedDoors.info().stats.bonusGranted };
  })()`);
  ok('A7b 战斗房路径：付款当帧不发奖，清空后 onRoomCleared 发且只发一次',
    !!a7bSetup.st && a7b.paid === true && a7b.cleared === true && a7b.type === 'battle'
      && a7b.crystals === a7bSetup.crystals + 1
      && a7b.charges === a7bSetup.charges + 1
      && a7b.bonus === a7bSetup.bonus + 1,
    { setup: a7bSetup, after: a7b });

  // 复位到第 1 层干净状态，截图
  await ev(`(function(){
    var b = document.querySelector('#modal [data-reward-key]');
    if (b) b.click();
    state.mode = 'playing'; state.status = 'playing';
    return true;
  })()`);
  await sleep(220);
  await ev(`generateFloor(1)`);
  await sleep(400);
  await shot('priced-door.png');

  // ---------- A9 fps / 错误 / 截图 ----------
  const a9 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){
      return { fps: f, errors: (window.__errors || []).length };
    });
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'priced-door.png')).size; } catch (e) { shotSize = 0; }
  ok('A9 截图 >10KB / fps≥60 / 无脚本错误',
    shotSize > 10240 && a9.fps >= 60 && a9.errors === 0, { shot: shotSize, a9 });

  fs.writeFileSync(path.join(OUT_DIR, 'priced-door-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== A2 priced-door ' + pass + '/' + asserts.length + ' ===== (shot ' + shotSize + 'B, fps ' + a9.fps + ')');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
