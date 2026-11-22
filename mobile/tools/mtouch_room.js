/**
 * 只读探针：触摸屏上"选房浮层"到底能不能开、卡片能不能点
 * ============================================================
 * 背景：v1.8.2 把换房改成"点相邻房间"（传送结构）。主文件里只有两条入口：
 *   1) handleCanvasMouseDown → trySelectRoomAt（鼠标/点击画布）
 *   2) 键盘 Q → toggleRoomPicker → 浮层卡片 mousedown → pickRoomFromOverlay
 * 触屏 handleTouchStart 只做摇杆/瞄准，没有选房分支。
 *
 * 本脚本不改任何游戏代码，只做三件事：
 *   A. 调 toggleRoomPicker() 打开浮层，读卡片数量与尺寸；
 *   B. 用 Input.dispatchTouchEvent 发**真实触摸**点第一张卡，
 *      期间在 document 捕获阶段统计 touchstart/pointerdown/mousedown 各来几次；
 *   C. 读 ROOM_PICKER_STATS，判断卡片处理器到底有没有被触发。
 *
 * 用法：node mobile/tools/mtouch_room.js
 * 产物：mobile/shots/touch_<时间戳>/touch.json + touch.jpg
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_touch');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9571;
const PAGE = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const OUT = path.join(MOBILE_DIR, 'shots', 'touch_' + stamp);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 页面内注入的小工具：事件计数 + 浮层读数（不碰游戏逻辑） */
const INSTRUMENT = `(function () {
  window.__tr = { touch: 0, pointer: 0, mouse: 0, mouseTrusted: 0 };
  ['touchstart', 'pointerdown', 'mousedown'].forEach(function (name) {
    document.addEventListener(name, function (ev) {
      if (name === 'touchstart') window.__tr.touch += 1;
      if (name === 'pointerdown') window.__tr.pointer += 1;
      if (name === 'mousedown') { window.__tr.mouse += 1; if (ev.isTrusted) window.__tr.mouseTrusted += 1; }
    }, true);
  });
  return true;
})()`;

/** 启动无头 Edge 并连上 CDP */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,600',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 360; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('Edge 调试端口未就绪'); }
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
    const id = seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP 超时：' + method)); }, 45000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  /** 求值：返回页面里的值（失败抛错，便于定位是语法还是运行期问题） */
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails));
    return r.result ? r.result.value : undefined;
  };
  return { send, ev, edge };
}

/** 发一次真实触摸（touchStart + touchEnd），坐标为 CSS 像素 */
async function tap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x, y: y, radiusX: 6, radiusY: 6, force: 1, id: 1 }]
  });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const log = (m) => console.log(m);
  const cdp = await bootEdge();
  const out = { page: PAGE, pageMd5: crypto.createHash('md5').update(fs.readFileSync(PAGE)).digest('hex').toUpperCase() };
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
    const url = 'file:///' + PAGE.replace(/\\/g, '/');
    await cdp.send('Page.navigate', { url });
    for (let i = 0; i < 80; i += 1) {
      await sleep(250);
      const ok = await cdp.ev(`typeof state !== 'undefined' && !!state && !!state.player`).catch(() => false);
      if (ok) break;
    }
    await cdp.ev(INSTRUMENT);
    await sleep(800);

    /* 先离开标题层：优先真实触摸点"开始"按钮，点不到再退回 startGame() */
    let boot = await cdp.ev(`({mode: state.mode, status: state.status, floor: state.floor, room: state.currentRoomId, doors: (state.doors||[]).length, pickerDom: !!document.getElementById('roomPicker'), stats: JSON.parse(JSON.stringify(ROOM_PICKER_STATS))})`);
    if (boot.mode === 'title') {
      const btn = await cdp.ev(`(function(){ var b = ui && ui.btnStart; if (!b) return null; var r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
      out.startButton = btn;
      if (btn && btn.w > 0) await tap(cdp, btn.x, btn.y);
      for (let i = 0; i < 20; i += 1) {
        await sleep(200);
        if (await cdp.ev(`state.mode`) !== 'title') break;
      }
      if (await cdp.ev(`state.mode`) === 'title') await cdp.ev(`startGame()`);
      await sleep(400);
      /* v1.8 起标题页之后还有"三角色选择"：选第一个角色才会真正进战斗 */
      if (await cdp.ev(`typeof __charSelectOpen !== 'undefined' && __charSelectOpen`)) {
        out.characterPick = await cdp.ev(`chooseCharacter(CHARACTER_CONFIG.ids[0])`);
        await sleep(800);
      }
      boot = await cdp.ev(`({mode: state.mode, status: state.status, floor: state.floor, room: state.currentRoomId, doors: (state.doors||[]).length, pickerDom: !!document.getElementById('roomPicker'), stats: JSON.parse(JSON.stringify(ROOM_PICKER_STATS))})`);
    }
    out.boot = boot;
    log('[启动] ' + JSON.stringify(boot));

    /* A. 浮层能不能开（键盘路径等价调用） */
    const opened = await cdp.ev(`(function(){ var r = toggleRoomPicker(); var el = document.getElementById('roomPicker'); return { ret: r, open: roomPickerOpen, display: el ? getComputedStyle(el).display : null }; })()`);
    out.open = opened;
    log('[浮层] ' + JSON.stringify(opened));

    const cards = await cdp.ev(`(function(){
      var list = document.querySelectorAll('#roomPickerList button');
      return Array.prototype.map.call(list, function (b) {
        var r = b.getBoundingClientRect();
        return { roomId: Number(b.dataset.roomId), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
      });
    })()`);
    out.cards = cards;
    log('[卡片] ' + JSON.stringify(cards));

    if (!cards.length) {
      out.result = 'NO_CARDS（浮层里没有卡片，后续触摸无从测）';
      log('[结果] ' + out.result);
    } else {
      const before = await cdp.ev(`JSON.parse(JSON.stringify(ROOM_PICKER_STATS))`);
      await cdp.ev(`window.__tr = { touch: 0, pointer: 0, mouse: 0, mouseTrusted: 0 }`);
      const c = cards[0];
      await tap(cdp, c.x, c.y);
      const evt = await cdp.ev(`JSON.parse(JSON.stringify(window.__tr))`);
      const after = await cdp.ev(`JSON.parse(JSON.stringify(ROOM_PICKER_STATS))`);
      const toast = await cdp.ev(`(function(){ var t = document.querySelector('#toast, .toast'); return t ? String(t.textContent || '').trim() : null; })()`);
      out.tap = { target: c, before: before, after: after, events: evt, toast: toast, pickerOpenAfter: await cdp.ev(`roomPickerOpen`) };
      out.result = 'tap 触发次数：denied/picks 变化=' + ((after.denied - before.denied) + (after.picks - before.picks))
        + '；compat mousedown=' + evt.mouse + '（可信 ' + evt.mouseTrusted + '）；pointerdown=' + evt.pointer + '；touchstart=' + evt.touch;
      log('[触摸] ' + JSON.stringify(out.tap));
      log('[结果] ' + out.result);
    }

    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    fs.writeFileSync(path.join(OUT, 'touch.jpg'), Buffer.from(shot.data, 'base64'));
    fs.writeFileSync(path.join(OUT, 'touch.json'), JSON.stringify(out, null, 1));
    log('[产物] ' + OUT);
  } catch (err) {
    out.error = String(err && err.message || err);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'touch.json'), JSON.stringify(out, null, 1));
    log('[异常] ' + out.error);
    process.exitCode = 1;
  } finally {
    killEdge(cdp.edge);
  }
}

main();
