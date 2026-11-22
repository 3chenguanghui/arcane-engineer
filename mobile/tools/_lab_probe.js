/**
 * 实验副本探针：查触摸层为什么不可见（只读，不改任何文件）
 * ------------------------------------------------------------
 * 用途：me2e.js 在 `摇杆或主技能键不可见` 处中断后，用本探针读运行期事实：
 *   1. 补丁脚本有没有执行（body.arcm-on / #arcmPad 按钮数量）
 *   2. 页面加载期有没有 JS 异常（window.onerror 收集）
 *   3. 摇杆 / 技能键的 getBoundingClientRect 与计算样式
 * 用法：node mobile/tools/_lab_probe.js [--page=绝对路径]
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_labprobe');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9574;
const PAGE_ARG = process.argv.find((a) => a.startsWith('--page='));
const SNAP = PAGE_ARG
  ? path.resolve(PAGE_ARG.slice('--page='.length))
  : path.join(MOBILE_DIR, 'lab', 'index_mobile_touchlab.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并返回最小 CDP 封装
 * @returns {Promise<Object>} { send, ev, shot, close }
 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,600', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/** 页面内用：取元素几何与是否可见 */
const RECT_JS = (sel) => `(function(){
  var el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  var r = el.getBoundingClientRect();
  var cs = getComputedStyle(el);
  return { sel: ${JSON.stringify(sel)}, x: Math.round(r.left), y: Math.round(r.top),
    w: Math.round(r.width), h: Math.round(r.height),
    cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity, position: cs.position };
})()`;

/**
 * 主流程
 */
async function main() {
  const cdp = await bootEdge();
  try {
    /* 页面加载前先装错误收集器，才能抓到注入块自己的异常 */
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__err=[];window.addEventListener("error",function(e){window.__err.push(String(e.message)+" @"+(e.filename||"").slice(-40)+":"+e.lineno);});window.addEventListener("unhandledrejection",function(e){window.__err.push("reject:"+String(e.reason));});'
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenWidth: 844, screenHeight: 390,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
    await cdp.send('Page.navigate', { url: 'file:///' + SNAP.replace(/\\/g, '/') + '?probe=1' });
    for (let i = 0; i < 120; i += 1) {
      if (await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`)) break;
      await sleep(200);
    }
    await sleep(900);
    const early = await cdp.ev(`({
      err: (window.__err||[]).slice(0, 8),
      bodyClass: document.body.className,
      padBtns: document.querySelectorAll('#arcmPad button').length,
      hasOn: document.body.classList.contains('arcm-on'),
      touch: { coarse: matchMedia('(pointer: coarse)').matches, maxTouchPoints: navigator.maxTouchPoints, ontouch: ('ontouchstart' in window), iw: innerWidth, ih: innerHeight }
    })`);
    console.log('[加载后]', JSON.stringify(early, null, 0));

    await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
    await sleep(600);
    if (!(await cdp.ev(`state.mode === 'playing'`))) {
      await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
    }
    for (let i = 0; i < 40; i += 1) {
      if (await cdp.ev(`state.mode === 'playing'`)) break;
      await sleep(200);
    }
    await sleep(1200);
    const play = await cdp.ev(`({
      mode: state.mode, err: (window.__err||[]).slice(0, 8),
      bodyClass: document.body.className,
      padBtns: document.querySelectorAll('#arcmPad button').length,
      arcm: (typeof window.__arcm === 'object' && window.__arcm) ? window.__arcm.info() : null
    })`);
    console.log('[进入后]', JSON.stringify(play, null, 0));

    const rects = await cdp.ev(`({
      stick: ${RECT_JS('#arcmStick')},
      pad: ${RECT_JS('#arcmPad')},
      primary: ${RECT_JS('[data-act="primary"]')},
      room: ${RECT_JS('[data-act="room"]')}
    })`);
    console.log('[几何]', JSON.stringify(rects, null, 0));

    /* 楼梯周边 + 首领房中心周边：为什么脚本常停在距楼梯 70px（<64 才能按 E 下楼） */
    const stairInfo = await cdp.ev(`(function(){
      var st = state.stairs;
      if (!st) return null;
      var bossRoom = null;
      state.rooms.forEach(function (r) { if (r && r.type === 'boss') bossRoom = r; });
      var out = { stair: { x: Math.round(st.x), y: Math.round(st.y), active: st.active },
        room: state.currentRoomId, blockers: [], ring70: [] };
      var cx = bossRoom ? bossRoom.cx : st.x;
      var cy = bossRoom ? bossRoom.cy : st.y;
      state.walkBlockers.forEach(function (b) {
        var bx = b.kind === 'circle' ? b.x : b.x + b.w / 2;
        var by = b.kind === 'circle' ? b.y : b.y + b.h / 2;
        if (Math.hypot(bx - cx, by - cy) < 260) {
          out.blockers.push({ kind: b.kind, x: Math.round(bx), y: Math.round(by),
            r: b.r || null, w: b.w || null, h: b.h || null, wall: !!b.wall, temp: !!b.tempTerrain });
        }
      });
      for (var i = 0; i < 16; i += 1) {
        var a = i / 16 * Math.PI * 2;
        var x = cx + Math.cos(a) * 70, y = cy + Math.sin(a) * 70;
        out.ring70.push(!isWalkBlocked(x, y, 12) && isWalkableCircle(x, y, 12) ? 1 : 0);
      }
      out.bossRoom = bossRoom ? { id: bossRoom.id, type: bossRoom.type, cx: Math.round(bossRoom.cx),
        cy: Math.round(bossRoom.cy), w: Math.round(bossRoom.w), h: Math.round(bossRoom.h) } : null;
      out.probeAt70 = { walk: !isWalkBlocked(cx + 70, cy, 12) && isWalkableCircle(cx + 70, cy, 12) };
      return out;
    })()`);
    console.log('[楼梯周边]', JSON.stringify(stairInfo, null, 0));
    await cdp.shot(path.join(MOBILE_DIR, 'shots', 'lab_probe.jpg'));
  } finally {
    cdp.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
