/* ============================================================
   人物存在感专项验收（端口 9487）
   ------------------------------------------------------------
   用法：
     node tools/arcane_character_pass.js

   产出：
     .screenshots/art/pass-before.png   同机位 · 旧版
     .screenshots/art/pass-after.png    同机位 · 本轮设计版
     .screenshots/art/pass-run.png      跑动姿态
     .screenshots/art/pass-attack.png   攻击姿态
     .screenshots/art/pass-hit.png      受击姿态

   读数（全部来自游戏内同一点）：
     角色占屏比 / 角色与背景明度差 / 角色与怪物最小色相夹角
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9487;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  /**
   * 截一张图
   * @param {string} name 文件名
   * @param {{x:number,y:number,w:number,h:number}} clip 裁切区域（CSS 像素）
   * @param {number} [scale=1] 像素倍率
   */
  const shot = async (name, clip, scale = 1) => {
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: clip.w, height: clip.h, scale }
    });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
    return name;
  };
  const camInfo = () => ev(`(function(){
    var d = window.__roamDebug;
    var s = d.getState();
    var c = d.cameraState();
    return { cam: { x: c.x, y: c.y }, zoom: c.zoom, view: c.view, px: s.player.x, py: s.player.y };
  })()`);
  /**
   * 计算玩家在页面里的屏幕包围盒
   * 世界 → 屏幕： (world - cam) * zoom（与 render() 的 transform 完全一致）
   */
  const playerClip = async (w, h) => {
    const c = await camInfo();
    return {
      x: (c.px - c.cam.x) * c.zoom - w / 2,
      y: (c.py - c.cam.y) * c.zoom - h / 2,
      w,
      h
    };
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);
  // 无头环境不会自动触发 resize，state.viewW/H 会停在 0，导致相机把玩家顶到屏幕左上角
  await ev('window.dispatchEvent(new Event("resize"))');
  await sleep(300);

  // 点开始
  const rect = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(900);
  // 首次开局会先弹角色选择：选第一张卡 + 确认，否则 mode 停在 title，瞬移会被守卫拦下
  await ev(`(function(){
    var card = document.querySelector('.char-card');
    if (card) card.click();
    var ok = document.getElementById('btnCharConfirm');
    if (ok) ok.click();
    return !!card;
  })()`);
  await sleep(1500);

  // 固定到一间远离世界边界的战斗房中央：相机能真正居中，取景不会贴到 HUD
  await ev(`(function(){
    var d = window.__roamDebug;
    d.setFloor(5);
    var s = d.getState();
    var rooms = s.rooms.filter(function(r){ return r.type === 'battle' && r.cx > 600 && r.cy > 500; });
    var room = rooms[0] || s.rooms[0];
    d.despawnAll();
    d.setPlayerPos(room.cx, room.cy);
    d.snapCamera();
    return room.id;
  })()`);
  await sleep(700);
  await ev('window.__roamDebug.snapCamera()');
  await sleep(120);

  // ---------- A/B 同机位 ----------
  await ev('window.__roamDebug.setCharacterPresence(false)');
  await sleep(420);
  const before = await ev('window.__roamDebug.characterMetrics()');
  const clip = await playerClip(260, 260);
  console.log('CAM ' + JSON.stringify(await camInfo()) + ' CLIP ' + JSON.stringify(clip));
  await shot('pass-full.png', { x: 0, y: 0, w: 1440, h: 900 }, 1);
  await shot('pass-before.png', clip, 2);

  await ev('window.__roamDebug.setCharacterPresence(true)');
  await sleep(420);
  const after = await ev('window.__roamDebug.characterMetrics()');
  await shot('pass-after.png', clip, 2);

  // ---------- 三种姿态 ----------
  await ev("window.__roamDebug.setPose('run')");
  await sleep(420);
  await shot('pass-run.png', await playerClip(260, 220), 2);
  await ev("window.__roamDebug.setPose('attack')");
  await sleep(320);
  await shot('pass-attack.png', await playerClip(260, 220), 2);
  await ev("window.__roamDebug.setPose('hit')");
  await sleep(320);
  await shot('pass-hit.png', await playerClip(260, 220), 2);
  await ev('window.__roamDebug.setPose(null)');

  // ---------- 多房间抽样：明度差随地板主题变化，只测一间会碰运气 ----------
  // 做法：跨楼层各挑几间战斗房，逐间站定取读数，报中位数与最暗值。
  const roomScan = [];
  const scanFloors = [1, 3, 5, 7];
  for (const f of scanFloors) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    await sleep(420);
    const rooms = await ev(`(function(){
      var s = window.__roamDebug.getState();
      return s.rooms.filter(function(r){ return r.type === 'battle'; }).slice(0, 2).map(function(r){
        return { id: r.id, cx: r.cx, cy: r.cy };
      });
    })()`);
    for (const r of rooms) {
      await ev(`(function(){
        var d = window.__roamDebug;
        d.despawnAll();
        d.setPlayerPos(${r.cx}, ${r.cy});
        d.snapCamera();
      })()`);
      await sleep(240);
      const m = await ev('window.__roamDebug.characterMetrics()');
      if (m) {
        roomScan.push({
          floor: f, room: r.id, bgLum: m.bgLum, meanLum: m.meanLum,
          deltaLum: m.deltaLum, glowDelta: m.glowDelta, separationLum: m.separationLum
        });
      }
    }
  }
  const seps = roomScan.map((r) => r.separationLum).sort((a, b) => a - b);
  const medSep = seps.length ? seps[Math.floor(seps.length / 2)] : 0;
  const minSep = seps.length ? seps[0] : 0;
  const deltas = roomScan.map((r) => r.deltaLum).sort((a, b) => a - b);
  const medDelta = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
  const minDelta = deltas.length ? deltas[0] : 0;
  console.log('ROOMSCAN ' + JSON.stringify(roomScan));
  console.log('ROOMSCAN-SUMMARY ' + JSON.stringify({ rooms: roomScan.length, medSep, minSep, medDelta, minDelta }));

  // 抽样结束后回到 5 层主房间，后续帧率 / 瞬移测试都在这里做
  await ev(`window.__roamDebug.setFloor(5)`);
  await sleep(420);
  await ev(`(function(){
    var d = window.__roamDebug;
    var s = d.getState();
    var room = s.rooms.filter(function(r){ return r.type === 'battle'; })[0] || s.rooms[0];
    d.despawnAll();
    d.setPlayerPos(room.cx, room.cy);
    d.snapCamera();
  })()`);
  await sleep(500);

  // ---------- 帧率（后处理 + 残影同时存在）----------
  await ev(`(function(){
    var d = window.__roamDebug;
    var s = d.getState();
    var rooms = s.rooms.filter(function(r){ return r.type === 'battle' && r.cx > 600 && r.cy > 500; });
    var room = rooms[0] || s.rooms[0];
    d.setPlayerPos(room.cx, room.cy);
    d.snapCamera();
    return room.id;
  })()`);
  await sleep(900);
  const probe = await ev('window.__roamDebug.blink.probe(0)');
  const fired = await ev('window.__roamDebug.blink.fire(0)');
  const st0 = await ev('window.__roamDebug.getState()');
  console.log('BLINK ' + JSON.stringify({ probe, fired, mode: st0.mode, status: st0.status, floor: st0.floor, player: st0.player }));
  await sleep(60); // 起手残影阶段
  const chargeState = await ev('window.__roamDebug.blink.state()');
  // 取景前强制把相机贴回玩家：截图与算裁切之间相机还在跟随，会把人切到画框边
  await ev('window.__roamDebug.snapCamera()');
  await sleep(60);
  await shot('pass-blink-start.png', await playerClip(420, 300), 2);

  // 第二轮单独拍落地：先重置，保证落地瞬间正好有"落地残影"
  await ev('window.__roamDebug.blink.reset()');
  await ev('window.__roamDebug.blink.fire(0)');
  await sleep(180);
  const landState = await ev('window.__roamDebug.blink.state()');
  await ev('window.__roamDebug.snapCamera()');
  await shot('pass-blink-land.png', await playerClip(420, 300), 2);
  const fps = await ev('window.__roamDebug.postfx.bench(180)');
  const ghosts = { startGhosts: chargeState.startGhosts, landGhosts: landState.landGhosts, chargeState, landState };
  await ev('window.__roamDebug.setPose(null)');

  console.log('BEFORE ' + JSON.stringify(before));
  console.log('AFTER  ' + JSON.stringify(after));
  console.log('POSE-SHOTS ' + JSON.stringify(['pass-run.png', 'pass-attack.png', 'pass-hit.png']));
  console.log('FPS ' + JSON.stringify(fps) + ' GHOSTS ' + JSON.stringify(ghosts));
  console.log('OUT ' + OUT_DIR);

  // 硬性断言：三件事至少方向正确
  const checks = [
    ['占屏比提升', after.screenRatio > before.screenRatio, before.screenRatio + ' → ' + after.screenRatio],
    ['明度差中位数 ≥ 45', medDelta >= 45, '主体中位 ' + medDelta + ' / 最暗 ' + minDelta + '（' + roomScan.length + ' 间）'],
    ['可读性（主体或亮边）最暗 ≥ 45', minSep >= 45, '中位 ' + medSep + ' / 最暗 ' + minSep],
    ['色相区分度 ≥ 45°', after.hueSepMin != null && after.hueSepMin >= 45, after.hueSepMin],
    ['帧率 ≥ 90', fps.fps >= 90, fps.fps],
    ['起手残影 ≥ 3', ghosts.startGhosts >= 3, ghosts.startGhosts],
    ['落地残影 ≥ 3', ghosts.landGhosts >= 3, ghosts.landGhosts]
  ];
  let pass = true;
  checks.forEach(([name, ok, detail]) => {
    if (!ok) pass = false;
    console.log((ok ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail));
  });
  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
  ws.close();
  edge.kill();
  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
