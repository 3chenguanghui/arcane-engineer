// 第 7 轮 · 第 2 组验收：编队模板 + 两只新怪（地形改写 / 增益换召唤）
// 断言覆盖：模板配置完整性、指定层出场、同场混编 ≥5、两只新怪的行为分支、可击杀与掉落。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9552;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'formations');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印（沿用既有脚本的 PASS/FAIL 口径） */
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
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const runtimeErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(m.params && m.params.exceptionDetails
        ? (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text
        : 'unknown');
    }
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

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);
  // 关掉升级四选一（会打断连续采样）；自适应也关掉，避免 headless 掉帧降档影响数量断言
  await ev(`(() => { window.__roamDebug.xp.setEnabled(false); window.__roamDebug.enemies.setAdaptive(false); return true; })()`);

  /* ================= 1) 编队模板配置完整性 ================= */
  const cfg = await ev('__roamDebug.enemies.config()');
  const tpls = (cfg.formations && cfg.formations.templates) || [];
  const roleIds = tpls.flatMap((t) => t.roles || []);
  const allRolesExist = await ev(`(() => ${JSON.stringify(roleIds)}.every((id) => !!ENEMY_BY_ID[id]))()`);
  const regions = Array.from(new Set(tpls.map((t) => t.region)));
  const rolesOk = tpls.every((t) => Array.isArray(t.roles) && t.roles.length >= 5
    && new Set(t.roles).size === t.roles.length);
  const proseOk = tpls.every((t) => typeof t.intent === 'string' && t.intent.length >= 8
    && typeof t.counter === 'string' && t.counter.length >= 8);
  check('编队模板 ≥6 套且每套 ≥5 个不重复角色、含设计意图与破法',
    cfg.formations.enabled === true && tpls.length >= 6 && rolesOk && proseOk,
    { count: tpls.length, rolesOk, proseOk });
  check('三个区域都有编队模板（1/2/3 全覆盖）',
    regions.length === 3 && [1, 2, 3].every((r) => regions.includes(r)), { regions });
  check('所有模板角色 id 都在 ENEMY_CONFIG 里', allRolesExist, { roleCount: roleIds.length });

  /* ================= 2) 两只新怪的配置归属 ================= */
  const news = await ev(`(() => {
    const pick = (id) => ENEMY_CONFIG.find((e) => e.id === id) || null;
    const pw = pick('platewright');
    const vc = pick('voidconduit');
    return {
      pw: pw && { id: pw.id, region: pw.region, sig: pw.signature, exclusive: !!pw.exclusive },
      vc: vc && { id: vc.id, region: vc.region, sig: vc.signature, exclusive: !!vc.exclusive },
      behaviors: {
        terraform: !!EXCLUSIVE_ENEMY_CONFIG.behaviors.terraform,
        overload: !!EXCLUSIVE_ENEMY_CONFIG.behaviors.overload
      },
      roster6: enemyRosterForFloor(6),
      roster7: enemyRosterForFloor(7),
      roster8: enemyRosterForFloor(8)
    };
  })()`);
  check('新怪 1「熔铸师」属于符文主题且自带 terraform 行为参数',
    !!news.pw && news.pw.region === 2 && news.pw.sig === 'terraform'
      && news.pw.exclusive === true && news.behaviors.terraform === true, news.pw);
  check('新怪 2「虚空导体」属于虚空主题且自带 overload 行为参数',
    !!news.vc && news.vc.region === 3 && news.vc.sig === 'overload'
      && news.vc.exclusive === true && news.behaviors.overload === true, news.vc);
  check('两只新怪进入对应区域名册（F6 虚空含导体 / F8 符文含熔铸师）',
    news.roster6.indexOf('voidconduit') >= 0
      && news.roster8.indexOf('platewright') >= 0
      && news.roster7.indexOf('platewright') < 0 && news.roster7.indexOf('voidconduit') < 0,
    { f6: news.roster6.length, f7: news.roster7.length, f8: news.roster8.length });

  /* ================= 3) 编队模板在指定层真正出场 ================= */
  const floors = [6, 7, 8];
  const floorInfo = [];
  for (const n of floors) {
    await ev(`__roamDebug.enemies.floor(${n})`);
    await sleep(140);
    const info = await ev('__roamDebug.enemies.info()');
    floorInfo.push(info);
  }
  const combatRoomsOf = (info) => (info.rooms || []).filter((r) => (
    (r.type === 'battle' || r.type === 'elite') && (r.planned || 0) > 0
  ));
  const expectedRegion = (n) => ((n - 1) % 3) + 1;
  const templatesByRegion = { 1: [], 2: [], 3: [] };
  tpls.forEach((t) => { if (templatesByRegion[t.region]) templatesByRegion[t.region].push(t.id); });
  const matchRegion = floorInfo.map((info, i) => {
    const region = expectedRegion(floors[i]);
    const rooms = combatRoomsOf(info);
    const ok = rooms.length > 0 && rooms.every((r) => r.formation && templatesByRegion[region].includes(r.formation));
    return { floor: floors[i], region, rooms: rooms.length, formations: rooms.map((r) => r.formation), ok };
  });
  check('F6/F7/F8 的战斗 / 精英房都套用了本区域编队模板',
    matchRegion.every((m) => m.ok), matchRegion);
  const distinctRows = floorInfo.map((info, i) => ({
    floor: floors[i],
    rows: combatRoomsOf(info).map((r) => ({ n: r.planned, distinct: r.distinct, formation: r.formation }))
  }));
  const mixOk = distinctRows.every((row) => row.rows.filter((r) => (r.n || 0) >= 5)
    .every((r) => r.distinct >= 5));
  check('编队落位后同场混编仍 ≥5 种', mixOk, distinctRows);

  /* ================= 4) 熔铸师：terraforming 行为分支 ================= */
  // 先把玩家摆到第 8 层（符文主题）的一间战斗房中央，清空场上干扰
  const setupTerra = await ev(`(() => {
    __roamDebug.enemies.floor(8);
    const room = state.rooms.find((r) => r.type === 'battle') || state.rooms[1];
    state.player.x = room.cx;
    state.player.y = room.cy;
    state.player.hp = state.player.hpMax;
    state.enemies = [];
    state.bullets = [];
    state.sigils = [];
    state.walkBlockers = state.walkBlockers.filter((b) => !b.tempTerrain);
    const e = spawnEnemy('platewright', room.cx + 150, room.cy, state.floor, { roomId: room.id });
    return { roomId: room.id, enemy: e ? e.id : null, cx: room.cx, cy: room.cy };
  })()`);
  const terra = await ev(`(() => {
    const e = state.enemies.find((x) => x.typeId === 'platewright');
    if (!e) return { ok: false, error: 'no enemy' };
    const dx = state.player.x - e.x;
    const dy = state.player.y - e.y;
    const distance = Math.hypot(dx, dy) || 1;
    const before = state.walkBlockers.filter((b) => b.tempTerrain).length;
    const r = enemySignatureStep(e, { dx, dy, distance, room: state.rooms[e.roomId] });
    const blocks = state.walkBlockers.filter((b) => b.tempTerrain);
    const top = blocks[blocks.length - 1] || null;
    return {
      ok: true,
      acted: r.acted,
      signature: r.signature,
      detail: r.detail,
      before: before,
      after: blocks.length,
      blockedAtCenter: top ? isWalkBlocked(top.x, top.y, 6) : false,
      distToPlayer: top ? Math.round(Math.hypot(top.x - state.player.x, top.y - state.player.y)) : -1
    };
  })()`);
  check('熔铸师：terraform 生成 1 根临时石柱，且石柱真的挡路',
    terra.ok && terra.acted && terra.signature === 'terraform'
      && terra.after >= terra.before + 1 && terra.blockedAtCenter === true
      && terra.distToPlayer >= 40, terra);
  const terraExpire = await ev(`(() => {
    const before = state.walkBlockers.filter((b) => b.tempTerrain).length;
    updateTerrainBlocks(9);
    const after = state.walkBlockers.filter((b) => b.tempTerrain).length;
    return { before, after };
  })()`);
  check('熔铸师：石柱 5 秒后自行崩塌（回收后临时阻挡归零）',
    terraExpire.before >= 1 && terraExpire.after === 0, terraExpire);

  /* ================= 5) 虚空导体：overload 行为分支 ================= */
  const setupOver = await ev(`(() => {
    __roamDebug.enemies.floor(6);
    const room = state.rooms.find((r) => r.type === 'battle') || state.rooms[1];
    state.player.x = room.cx;
    state.player.y = room.cy;
    state.player.hp = state.player.hpMax;
    state.enemies = [];
    state.bullets = [];
    state.walkBlockers = state.walkBlockers.filter((b) => !b.tempTerrain);
    const e = spawnEnemy('voidconduit', room.cx + 150, room.cy, state.floor, { roomId: room.id });
    return { roomId: room.id, enemy: e ? e.id : null, dmgBase: state.mods.damageMul };
  })()`);
  const over = await ev(`(() => {
    const e = state.enemies.find((x) => x.typeId === 'voidconduit');
    if (!e) return { ok: false, error: 'no enemy' };
    const dx = state.player.x - e.x;
    const dy = state.player.y - e.y;
    const distance = Math.hypot(dx, dy) || 1;
    const base = state.mods.damageMul;
    const r = enemySignatureStep(e, { dx, dy, distance, room: state.rooms[e.roomId] });
    const granted = state.mods.damageMul;
    const shards = state.enemies.filter((x) => x.typeId === 'shardling').length;
    updateOverloadBuff(9);
    const restored = state.mods.damageMul;
    return {
      ok: true,
      acted: r.acted,
      signature: r.signature,
      detail: r.detail,
      base: Number(base.toFixed(4)),
      granted: Number(granted.toFixed(4)),
      restored: Number(restored.toFixed(4)),
      shards: shards,
      timer: state.player.overloadTimer
    };
  })()`);
  const buffUp = Math.abs(over.granted - over.base * 1.4) <= 0.005;
  const buffDown = Math.abs(over.restored - over.base) <= 0.005;
  check('虚空导体：overload 给玩家 +40% 增伤、同时召唤 2 只碎片，到期后倍率复原',
    over.ok && over.acted && over.signature === 'overload'
      && buffUp && buffDown && over.shards >= 2 && over.timer === 0, over);

  /* ================= 6) 两只新怪可被正常击杀并掉落 ================= */
  const killDrop = await ev(`(() => {
    const room = state.rooms.find((r) => r.type === 'battle') || state.rooms[1];
    // 先清掉上一个用例留下来的导体，保证 left 只统计本轮生成的怪
    state.enemies = [];
    const before = state.pickups.length;
    let spawned = 0;
    let killed = 0;
    ['platewright', 'voidconduit'].forEach((id) => {
      for (let i = 0; i < 8; i += 1) {
        const e = spawnEnemy(id, room.cx + rand(-70, 70), room.cy + rand(-70, 70), state.floor || 1, { roomId: -1 });
        if (!e) continue;
        spawned += 1;
        const hpBefore = e.hp;
        damageEnemy(e, e.hp + 10, null);
        if (state.enemies.indexOf(e) < 0) killed += 1;
        else e._hpBefore = hpBefore;
      }
    });
    return { spawned, killed, pickupGain: state.pickups.length - before, left: state.enemies.filter((x) => x.typeId === 'platewright' || x.typeId === 'voidconduit').length };
  })()`);
  check('两只新怪走真实受伤通道可被击杀，且至少掉落一次',
    killDrop.spawned >= 12 && killDrop.killed >= 12 && killDrop.pickupGain >= 1
      && killDrop.left === 0, killDrop);

  /* ================= 7) 截图（before / after 各 1 张） ================= */
  // before：只摆编队，不触发签名行为
  await ev(`(() => {
    __roamDebug.enemies.floor(6);
    const room = state.rooms.find((r) => r.type === 'battle') || state.rooms[1];
    state.enemies = [];
    state.walkBlockers = state.walkBlockers.filter((b) => !b.tempTerrain);
    ['warper', 'stalker', 'riftling', 'shardling', 'voidconduit'].forEach((id, i) => {
      const a = (Math.PI * 2 / 5) * i;
      spawnEnemy(id, room.cx + Math.cos(a) * 92, room.cy + Math.sin(a) * 92, state.floor, { roomId: room.id });
    });
    state.player.x = room.cx;
    state.player.y = room.cy + 20;
    return true;
  })()`);
  await sleep(600);
  await shot('form_before_F6_void.png');
  // after：触发石柱 + 过载（切到 F8 符文主题，视觉对比更清楚）
  const shotSetup = await ev(`(() => {
    __roamDebug.enemies.floor(8);
    const room = state.rooms.find((r) => r.type === 'battle') || state.rooms[1];
    state.enemies = [];
    state.walkBlockers = state.walkBlockers.filter((b) => !b.tempTerrain);
    state.player.x = room.cx;
    state.player.y = room.cy;
    state.player.hp = state.player.hpMax;
    spawnEnemy('platewright', room.cx + 150, room.cy - 30, state.floor, { roomId: room.id });
    spawnEnemy('voidconduit', room.cx - 150, room.cy - 30, state.floor, { roomId: room.id });
    const pw = state.enemies.find((x) => x.typeId === 'platewright');
    const vc = state.enemies.find((x) => x.typeId === 'voidconduit');
    if (pw) enemySignatureStep(pw, { dx: state.player.x - pw.x, dy: state.player.y - pw.y, distance: Math.hypot(state.player.x - pw.x, state.player.y - pw.y), room });
    if (vc) enemySignatureStep(vc, { dx: state.player.x - vc.x, dy: state.player.y - vc.y, distance: Math.hypot(state.player.x - vc.x, state.player.y - vc.y), room });
    return true;
  })()`);
  await sleep(420);
  await shot('form_after_F8_terraform_overload.png');

  /* ================= 汇总 ================= */
  check('运行期无 JS 异常', runtimeErrors.length === 0, runtimeErrors.slice(0, 3));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${passed}/${results.length} PASS`);
  console.log('FUNCTION: ' + (passed === results.length ? 'PASS' : 'FAIL'));
  console.log('VERDICT: ' + (passed === results.length ? 'PASS' : 'FAIL'));
  fs.writeFileSync(path.join(__dirname, '..', 'FORMATIONS_RESULT.json'),
    JSON.stringify({ results, runtimeErrors, shot: shotSetup }, null, 2));

  killEdge(EDGE_PROC);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err && err.stack ? err.stack : err);
  if (EDGE_PROC) killEdge(EDGE_PROC);
  process.exit(2);
});
