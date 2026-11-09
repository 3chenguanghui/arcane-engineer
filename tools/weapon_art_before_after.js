/**
 * W 批 · 武器外观 & 场景可读性 before/after 截图（一次性探针）
 * ------------------------------------------------------------
 * 同一个机位、同一个房间，分别对「旧包 dist/emberfall_v1.3.0」和「当前 index_arcane_v2.html」
 * 抓图，保证对比只差本轮改动：
 *
 *   node tools/weapon_art_before_after.js weapon <html> <outDir>
 *     五把武器各抓一张放大裁剪（以玩家为锚点向右偏 30px，能看到刀身明暗与刃口）
 *
 *   node tools/weapon_art_before_after.js scene <html> <outDir>
 *     抓一张 1600×900 全屏：未探索房轮廓 / 顶部灯带 / 地面砖缝的对比
 *
 * 端口 9593（避开之前占用的 9582-9587 / 9756 / 9758 / 9444）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9593;
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mode = process.argv[2] || 'weapon';
  const FILE = process.argv[3] || path.join(ROOT, 'index_arcane_v2.html');
  const OUT = process.argv[4] || path.join(ROOT, '.screenshots', 'weapon_art', mode);
  fs.mkdirSync(OUT, { recursive: true });

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
   * 页面内执行表达式并取返回值
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
  /* dpr=2：Canvas 按 2 倍分辨率绘制，放大裁剪才不会糊成一片 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  // 进入实战
  const startPos = await ev(`(function(){
    var el = document.getElementById('btnStart');
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(700);

  // 关经验弹窗、跳到第 6 层、清怪、站到房间中心
  const setup = await ev(`(function(){
    var d = window.__roamDebug;
    XP_CONFIG.enabled = false;
    for (var i = 0; i < 40 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    d.setFloor(6);
    for (var k = 0; k < 40 && state.mode === 'reward'; k += 1) closeRewardFlow(true);
    var rooms = state.rooms || [];
    var pick = null;
    rooms.forEach(function(r){ if (!pick && r.type !== 'start') pick = r; });
    if (!pick) pick = rooms[0];
    if (pick && d.teleport) d.teleport(pick.cx, pick.cy); else d.centerPlayer();
    state.enemies = [];
    state.player.invuln = 99999;
    state.player.facingAngle = 0;
    if (d.centerPlayer) d.centerPlayer();
    render();
    return { floor: state.floor, mode: state.mode, rooms: rooms.length };
  })()`);
  console.log('SETUP ' + JSON.stringify(setup));
  await sleep(1400);   // 让迷雾按真实帧推进，擦亮当前房间
  /* 等「改造」提示条淡出，避免挡住武器 */
  await sleep(1200);

  if (mode === 'scene') {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'scene_full.png'), Buffer.from(shot.data, 'base64'));
    console.log('SHOT scene_full → ' + OUT);
  } else {
    const ids = ['dagger', 'longsword', 'hammer', 'twin', 'spear'];
    for (const id of ids) {
      await ev(`(function(){
        var d = window.__roamDebug;
        d.weapons.set('${id}', true);
        d.weapons.setMods({});
        state.enemies = [];
        state.weapon.cd = 0;
        state.weapon.combo = 0;
        state.player.facingAngle = 0;
        if (d.centerPlayer) d.centerPlayer();
        render();
        return true;
      })()`);
      await sleep(320);
      const center = await ev(`(function(){
        var z = cameraZoom();
        return { x: (state.player.x - state.cam.x) * z, y: (state.player.y - state.cam.y) * z };
      })()`);
      /* 紧贴武器：宽 200 CSS px，向右偏 26px 让刀身占满画面中心 */
      const clipW = 200;
      const clipH = 130;
      const clipX = Math.max(0, Math.min(1600 - clipW, Math.round(center.x + 26 - clipW / 2)));
      const clipY = Math.max(0, Math.min(900 - clipH, Math.round(center.y - clipH / 2)));
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: clipX, y: clipY, width: clipW, height: clipH, scale: 2 }
      });
      fs.writeFileSync(path.join(OUT, id + '.png'), Buffer.from(shot.data, 'base64'));
      console.log('SHOT ' + id);
    }
  }

  console.log('DONE → ' + OUT);
  ws.close();
  killEdge(edge);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
