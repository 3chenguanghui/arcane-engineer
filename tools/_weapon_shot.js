/**
 * 第 29 项 · 武器判定可视化截图（一次性探针）
 * ------------------------------------------------------------
 * 真实窗口 1600×900、dpr 1，进入实际战斗后：
 *   · 清空房间敌人，站到房间中心；
 *   · 逐把切武器、打开 V 判定显示（__roamDebug.weapons.debug(true)）；
 *   · 在正前方"判定边缘"放一只假人（中心距 = 判定半径 + 敌人半径 − 2），
 *     截图中扇形外缘应当恰好贴住它的身体边缘；
 *   · 每把武器各存一张全屏图到 .screenshots/weapon/。
 * 用法：node tools\_weapon_shot.js
 * 端口：9587
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9587;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'weapon');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1600,900', 'about:blank'
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
  /**
   * 发送 CDP 命令
   * @param {string} method 方法名
   * @param {Object} [params] 参数
   * @returns {Promise<Object>}
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 页面内执行表达式
   * @param {string} expression JS 表达式
   * @returns {Promise<*>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);

  // 点"开始探索"进入实战
  const startPos = await ev(`(function(){
    var el = document.getElementById('btnStart');
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(700);

  // 准备战斗场景：关经验弹窗、清怪、站到房间中心、面朝右
  const setup = await ev(`(function(){
    var d = window.__roamDebug;
    XP_CONFIG.enabled = false;
    for (var i = 0; i < 30 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    d.setFloor(2);
    for (var k = 0; k < 30 && state.mode === 'reward'; k += 1) closeRewardFlow(true);
    var rooms = state.rooms && state.rooms.length ? state.rooms : [];
    var pick = null;
    rooms.forEach(function(r){ if (!pick && r.type !== 'start' && r.type !== 'boss') pick = r; });
    if (!pick) pick = rooms[0];
    if (pick && d.teleport) d.teleport(pick.cx, pick.cy); else d.centerPlayer();
    state.enemies = [];
    state.player.invuln = 9999;
    state.player.facingAngle = 0;
    d.weapons.debug(true);
    return { floor: state.floor, mode: state.mode, rooms: rooms.length };
  })()`);
  console.log('SETUP ' + JSON.stringify(setup));

  const ids = ['dagger', 'longsword', 'hammer', 'twin', 'spear'];
  const rows = [];
  for (const id of ids) {
    const geo = await ev(`(function(){
      var d = window.__roamDebug;
      var row = d.weapons.geometry({}).filter(function(g){ return g.id === '${id}'; })[0];
      d.weapons.set('${id}', true);
      d.weapons.setMods({});
      state.enemies = [];
      state.weapon.cd = 0;
      state.weapon.combo = 0;
      state.player.facingAngle = 0;
      var enemyId = d.spawnEnemy('wanderer', 0, 0);
      var e = state.enemies[0];
      if (e) {
        e.x = state.player.x + (row.reach + (e.radius || 16) - 2);
        e.y = state.player.y;
        e.hp = e.hpMax = 1000000;
        e.vx = 0; e.vy = 0;
      }
      state.cam = state.cam || {};
      if (d.centerPlayer) d.centerPlayer();
      render();
      return row;
    })()`);
    await sleep(320);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, id + '.png'), Buffer.from(shot.data, 'base64'));
    /* 再抓一张以玩家为中心的局部放大图：判定扇形与假人贴身关系只有放大后才看得清 */
    const center = await ev(`(function(){
      var z = cameraZoom();
      return { x: (state.player.x - state.cam.x) * z, y: (state.player.y - state.cam.y) * z };
    })()`);
    const clipW = 360;
    const clipH = 260;
    const clipX = Math.max(0, Math.min(1600 - clipW, Math.round(center.x - clipW / 2)));
    const clipY = Math.max(0, Math.min(900 - clipH, Math.round(center.y - clipH / 2)));
    const crop = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: clipX, y: clipY, width: clipW, height: clipH, scale: 3 }
    });
    fs.writeFileSync(path.join(OUT_DIR, 'crop-' + id + '.png'), Buffer.from(crop.data, 'base64'));
    rows.push(geo);
    console.log('SHOT ' + id + ' ' + JSON.stringify(geo));
  }

  fs.writeFileSync(path.join(OUT_DIR, 'weapon-geometry.json'), JSON.stringify(rows, null, 2));
  console.log('\nDONE ' + rows.length + ' screenshots → ' + OUT_DIR);
  ws.close();
  killEdge(edge);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
