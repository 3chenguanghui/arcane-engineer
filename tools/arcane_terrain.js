// P8 专项验收：地形杀三通道（撞墙 / 爆桶 / 裂隙，各自 A/B）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9539;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p8terrain');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

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
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
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

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);

  // ---- 1) 配置：三条通道各自独立开关 + spec 数值 ----
  const info = await ev('__roamDebug.terrain.info()');
  check('三条地形杀通道默认开启（总开关 / 撞墙 / 爆桶 / 裂隙）',
    info.config.enabled === true && info.config.wall.enabled === true
      && info.config.barrel.enabled === true && info.config.rift.enabled === true,
    { enabled: info.config.enabled, wall: info.config.wall.enabled, barrel: info.config.barrel.enabled, rift: info.config.rift.enabled });
  check('spec 数值就位：撞墙门槛 260 / 爆桶 ×1.5 / 裂隙半径 26',
    info.config.wall.minImpactSpeed === 260 && info.config.barrel.damageMul === 1.5
      && info.config.rift.radius === 26,
    { minImpactSpeed: info.config.wall.minImpactSpeed, damageMul: info.config.barrel.damageMul, radius: info.config.rift.radius });
  check('处决计数结构完整（wall / barrel / rift）',
    info.counts && info.counts.wall === 0 && info.counts.barrel === 0 && info.counts.rift === 0,
    info.counts);

  // ---- 2) 选一层有 ≥2 个爆炸桶的楼层，并定位桶所在房间 ----
  const world = await ev(`(() => {
    const d = window.__roamDebug;
    let floor = 1, audit = null;
    for (let f = 1; f <= 5; f += 1) {
      d.setFloor(f);
      audit = d.u10Audit();
      if (audit.barrels.length >= 2) { floor = f; break; }
    }
    const rooms = d.getState().rooms || [];
    const roomOf = (x, y) => rooms.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || null;
    const barrels = audit.barrels.map((b) => ({
      uid: b.uid, x: b.x, y: b.y, r: b.r,
      roomId: (roomOf(b.x, b.y) || {}).id
    }));
    return {
      floor,
      barrels,
      rooms: rooms.map((r) => ({ id: r.id, type: r.type, x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy }))
    };
  })()`);
  check('找到可测楼层（≥2 个爆炸桶，桶都能定位到房间）',
    world.barrels.length >= 2 && world.barrels.every((b) => b.roomId != null),
    { floor: world.floor, barrels: world.barrels.map((b) => ({ uid: b.uid, roomId: b.roomId })) });

  const barrelA = world.barrels[0];
  const barrelB = world.barrels[1];
  const roomA = world.rooms.find((r) => r.id === barrelA.roomId);

  // 玩家站到桶 A 的房间中心（镜头覆盖整间房，截图才拍得到）
  await ev(`__roamDebug.teleport(${roomA.cx}, ${roomA.cy})`);
  await sleep(600);

  // ---- 3) 撞墙：直接结算（高速击退 → 补伤害 → 残血击杀） ----
  const slamOn = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    t.set({ enabled: true, wall: { enabled: true }, barrel: { enabled: true }, rift: { enabled: true } });
    t.resetCounts();
    const s = d.spawnEnemyAt('wanderer', ${roomA.cx + 30}, ${roomA.cy + 30}, { roomId: ${roomA.id} });
    t.weaken(s.id, 3);
    const r = t.slam(s.id, 520);
    return { s, r, counts: t.counts(), after: d.enemyHpOf(s.id) };
  })()`);
  check('撞墙开启：残血怪被撞击补刀致死，wall 计数 +1',
    slamOn.r.applied === true && slamOn.r.killed === true && slamOn.counts.wall === 1,
    { applied: slamOn.r.applied, hpBefore: slamOn.r.hpBefore, hp: slamOn.r.hp, counts: slamOn.counts, after: slamOn.after });

  // ---- 4) 撞墙 A/B 关闭：同样的冲击不再结算 ----
  const slamOff = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    t.set({ wall: { enabled: false } });
    t.resetCounts();
    const s = d.spawnEnemyAt('wanderer', ${roomA.cx + 30}, ${roomA.cy + 70}, { roomId: ${roomA.id} });
    t.weaken(s.id, 3);
    const r = t.slam(s.id, 520);
    return { s, r, counts: t.counts(), after: d.enemyHpOf(s.id) };
  })()`);
  check('撞墙 A/B 关闭：同冲击不结算、残血怪存活、wall 计数不变',
    slamOff.r.applied === false && slamOff.r.killed === false
      && slamOff.counts.wall === 0 && slamOff.after && slamOff.after.hp === 3,
    { applied: slamOff.r.applied, hp: slamOff.r.hp, counts: slamOff.counts, after: slamOff.after });

  // ---- 5) 撞墙门槛：轻推（120 < 260）不算地形杀，避免刷伤害 ----
  const slamSoft = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    t.set({ wall: { enabled: true } });
    const s = d.spawnEnemyAt('wanderer', ${roomA.cx + 30}, ${roomA.cy + 110}, { roomId: ${roomA.id} });
    const r = t.slam(s.id, 120);
    return { s, r, after: d.enemyHpOf(s.id) };
  })()`);
  check('撞墙门槛生效：120 速度不触发（minImpactSpeed 260）',
    slamSoft.r.applied === false && slamSoft.after && slamSoft.after.hp === slamSoft.r.hpBefore,
    { applied: slamSoft.r.applied, hpBefore: slamSoft.r.hpBefore, after: slamSoft.after });

  // ---- 6) 撞墙真实接线：注击退速度撞向房间左墙（走物理积分，不是直接调函数） ----
  const wallSetup = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    // 沿左墙找一个可站立点（从 30→120px 向内扫）
    let sx = null, sy = null;
    for (let dy = 0; dy <= ${Math.round(roomA.h * 0.4)}; dy += 10) {
      for (let k = 0; k < 2; k += 1) {
        const yy = ${roomA.cy} + (k === 0 ? dy : -dy);
        for (let dx = 30; dx <= 120; dx += 8) {
          const xx = ${roomA.x} + dx;
          if (d.walkableAt(xx, yy, 18)) { sx = xx; sy = yy; break; }
        }
        if (sx != null) break;
      }
      if (sx != null) break;
    }
    if (sx == null) return { ok: false };
    t.set({ wall: { enabled: false } });
    t.resetCounts();
    const s = d.spawnEnemyAt('wanderer', sx, sy, { roomId: ${roomA.id} });
    t.weaken(s.id, 3);
    const k = t.knock(s.id, ${roomA.x - 90}, sy, 520);
    return { ok: true, s, sx, sy, k, counts: t.counts() };
  })()`);
  await sleep(500);
  await shot('terrain-wall-before.png');
  const wallBeforeState = await ev(`(() => { const d = __roamDebug; return { hp: d.enemyHpOf(${wallSetup.s ? wallSetup.s.id : -1}), pose: d.terrain.pose(${wallSetup.s ? wallSetup.s.id : -1}), counts: d.terrain.counts() }; })()`);
  check('撞墙 A/B（物理路径）关闭：撞墙后残血怪仍存活（before 截图）',
    wallSetup.ok === true && wallBeforeState.hp && wallBeforeState.hp.hp === 3 && wallBeforeState.counts.wall === 0,
    { setup: { sx: wallSetup.sx, sy: wallSetup.sy }, hp: wallBeforeState.hp, pose: wallBeforeState.pose, counts: wallBeforeState.counts });

  const wallAfterSetup = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    t.set({ wall: { enabled: true } });
    t.resetCounts();
    const s = d.spawnEnemyAt('wanderer', ${wallSetup.sx}, ${wallSetup.sy}, { roomId: ${roomA.id} });
    t.weaken(s.id, 3);
    const k = t.knock(s.id, ${roomA.x - 90}, ${wallSetup.sy}, 520);
    return { ok: true, s, k };
  })()`);
  await sleep(140);
  const wallPoseA = await ev(`__roamDebug.terrain.pose(${wallAfterSetup.s.id})`);
  await sleep(220);
  await shot('terrain-wall-after.png');
  const wallAfterState = await ev(`(() => { const d = __roamDebug; return { hp: d.enemyHpOf(${wallAfterSetup.s.id}), pose: d.terrain.pose(${wallAfterSetup.s.id}), counts: d.terrain.counts() }; })()`);
  check('撞墙 A/B（物理路径）开启：同一次击退把残血怪撞死，wall 计数 +1（after 截图）',
    wallAfterState.hp === null && wallAfterState.counts.wall >= 1,
    { hp: wallAfterState.hp, poseAt140ms: wallPoseA, pose: wallAfterState.pose, counts: wallAfterState.counts, knock: wallAfterSetup.k });

  // ---- 7) 爆桶：开启时 ×1.5，27 血被 39 伤炸死 ----
  const barrelOn = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    t.set({ enabled: true, barrel: { enabled: true } });
    const before = t.counts();
    const s = d.spawnEnemyAt('shooter', ${barrelA.x}, ${barrelA.y}, { roomId: ${barrelA.roomId} });
    t.weaken(s.id, 27);
    const hit = d.hitBarrel(${JSON.stringify(barrelA.uid)}, 999);
    return { s, hit, before, counts: t.counts(), after: d.enemyHpOf(s.id) };
  })()`);
  await sleep(220);
  await shot('terrain-barrel-after.png');
  check('爆桶开启：27 血敌人吃到 39 伤被处决，barrel 计数 +1',
    barrelOn.hit && barrelOn.hit.exploded === true && barrelOn.after === null
      && barrelOn.counts.barrel - barrelOn.before.barrel >= 1,
    { hit: barrelOn.hit, after: barrelOn.after, before: barrelOn.before, counts: barrelOn.counts });

  // ---- 8) 爆桶 A/B 关闭：同样 27 血只吃 26 伤，留 1 血存活 ----
  await ev(`__roamDebug.teleport(${(world.rooms.find((r) => r.id === barrelB.roomId) || roomA).cx}, ${(world.rooms.find((r) => r.id === barrelB.roomId) || roomA).cy})`);
  await sleep(500);
  const barrelOff = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    t.set({ barrel: { enabled: false } });
    const before = t.counts();
    const s = d.spawnEnemyAt('shooter', ${barrelB.x}, ${barrelB.y}, { roomId: ${barrelB.roomId} });
    t.weaken(s.id, 27);
    const hit = d.hitBarrel(${JSON.stringify(barrelB.uid)}, 999);
    return { s, hit, before, counts: t.counts(), after: d.enemyHpOf(s.id) };
  })()`);
  check('爆桶 A/B 关闭：27 血敌人只吃 26 伤、留 1 血存活、barrel 计数不变',
    barrelOff.hit && barrelOff.hit.exploded === true && barrelOff.after && barrelOff.after.hp === 1
      && barrelOff.counts.barrel - barrelOff.before.barrel === 0,
    { hit: barrelOff.hit, after: barrelOff.after, before: barrelOff.before, counts: barrelOff.counts });

  // ---- 9) 换层找空间裂隙 ----
  const riftWorld = await ev(`(() => {
    const d = window.__roamDebug;
    let floor = 0, info = null;
    for (let f = 1; f <= 6; f += 1) {
      d.setFloor(f);
      info = d.terrain.info();
      if (info.rift) { floor = f; break; }
    }
    if (!info || !info.rift) return { ok: false };
    const rooms = d.getState().rooms || [];
    const room = rooms.find((r) => info.rift.x >= r.x && info.rift.x <= r.x + r.w
      && info.rift.y >= r.y && info.rift.y <= r.y + r.h) || null;
    return { ok: true, floor, rift: info.rift, room: room ? { id: room.id, cx: room.cx, cy: room.cy } : null };
  })()`);
  check('找到带空间裂隙的楼层，并定位裂隙所在房间',
    riftWorld.ok === true && riftWorld.room != null && riftWorld.rift.used === false,
    { floor: riftWorld.floor, rift: riftWorld.rift, room: riftWorld.room });

  await ev(`__roamDebug.teleport(${riftWorld.room.cx}, ${riftWorld.room.cy})`);
  await sleep(600);

  // ---- 10) 裂隙：散步靠近不触发（没有高速击退标记） ----
  const riftWalk = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    t.set({ enabled: true, rift: { enabled: true } });
    t.resetCounts();
    const s = d.spawnEnemyAt('wanderer', ${riftWorld.rift.x}, ${riftWorld.rift.y}, { roomId: ${riftWorld.room.id} });
    return { s, counts: t.counts() };
  })()`);
  await sleep(650);
  const riftWalkState = await ev(`(() => { const d = __roamDebug; return { hp: d.enemyHpOf(${riftWalk.s.id}), counts: d.terrain.counts() }; })()`);
  check('裂隙不误杀：敌人站在裂隙上也不会被吞噬（必须是被高速击退推进去）',
    riftWalkState.hp && riftWalkState.hp.hp > 0 && riftWalkState.counts.rift === 0,
    { hp: riftWalkState.hp, counts: riftWalkState.counts });

  // ---- 11) 裂隙：高速击退进半径 → 吞噬 ----
  const riftKnock = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    t.resetCounts();
    const before = t.counts();
    const s = d.spawnEnemyAt('wanderer', ${riftWorld.rift.x + 60}, ${riftWorld.rift.y}, { roomId: ${riftWorld.room.id} });
    const k = t.nearRift(s.id, 480);
    return { s, k, before };
  })()`);
  await sleep(900);
  await shot('terrain-rift-after.png');
  const riftKnockState = await ev(`(() => { const d = __roamDebug; return { hp: d.enemyHpOf(${riftKnock.s.id}), counts: d.terrain.counts() }; })()`);
  check('裂隙开启：被高速击退推进半径的敌人被吞噬，rift 计数 +1（after 截图）',
    riftKnockState.hp === null && riftKnockState.counts.rift - riftKnock.before.rift >= 1,
    { hp: riftKnockState.hp, before: riftKnock.before, counts: riftKnockState.counts, knock: riftKnock.k });

  // ---- 12) 裂隙 A/B 关闭：同样击退不再吞噬 ----
  const riftOff = await ev(`(() => {
    const d = window.__roamDebug, t = d.terrain;
    t.set({ rift: { enabled: false } });
    t.resetCounts();
    const before = t.counts();
    const s = d.spawnEnemyAt('wanderer', ${riftWorld.rift.x + 60}, ${riftWorld.rift.y}, { roomId: ${riftWorld.room.id} });
    const k = t.nearRift(s.id, 480);
    return { s, k, before };
  })()`);
  await sleep(800);
  const riftOffState = await ev(`(() => { const d = __roamDebug; return { hp: d.enemyHpOf(${riftOff.s.id}), counts: d.terrain.counts() }; })()`);
  check('裂隙 A/B 关闭：同样的击退不吞噬、敌人存活、rift 计数不变',
    riftOffState.hp && riftOffState.hp.hp > 0 && riftOffState.counts.rift === 0,
    { hp: riftOffState.hp, counts: riftOffState.counts });

  // ---- 13) 恢复默认 + 截图落盘检查 ----
  const restored = await ev(`__roamDebug.terrain.set({ enabled: true, wall: { enabled: true }, barrel: { enabled: true }, rift: { enabled: true } }).config`);
  check('测试结束恢复正常配置（三通道重新开启）',
    restored.enabled === true && restored.wall.enabled === true
      && restored.barrel.enabled === true && restored.rift.enabled === true,
    { wall: restored.wall.enabled, barrel: restored.barrel.enabled, rift: restored.rift.enabled });

  const shots = ['terrain-wall-before.png', 'terrain-wall-after.png', 'terrain-barrel-after.png', 'terrain-rift-after.png'];
  const sizes = shots.map((name) => (fs.existsSync(path.join(OUT, name)) ? fs.statSync(path.join(OUT, name)).size : 0));
  check('4 张证据截图都已落盘（> 100KB）',
    sizes.every((s) => s > 100000), { shots, sizes });

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'p8-result.json'), JSON.stringify({ pass, total: results.length, results }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
