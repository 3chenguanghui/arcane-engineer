/**
 * 选房浮层横向溢出实测（只读，不改任何文件）
 * ------------------------------------------------------------
 * 目的：验证 `#roomPicker` 在窄屏（667×375 / 375×667）下不再横向溢出，
 *       判据 `scrollWidth <= clientWidth`（文档级与浮层级都要满足），
 *       同时逐张卡片检查右边界是否落在视口内。
 * 打开浮层用的是**真实触摸**（Input.dispatchTouchEvent 点【选房】按钮），
 * 不使用任何脚本直达函数，避免测到"脚本态"的假几何。
 * 用法：node mobile/tools/_overlay_probe.js [--page=绝对路径]
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_overlay');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9575;
const PAGE_ARG = process.argv.find((a) => a.startsWith('--page='));
const SNAP = PAGE_ARG
  ? path.resolve(PAGE_ARG.slice('--page='.length))
  : path.join(MOBILE_DIR, 'lab', 'index_mobile_touchlab.html');
/* 两个必须覆盖的口径 + 基准横屏 */
const VIEWS = [
  { w: 844, h: 390, dpr: 3, name: '844x390' },
  { w: 667, h: 375, dpr: 2, name: '667x375' },
  { w: 375, h: 667, dpr: 2, name: '375x667' }
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并返回最小 CDP 封装
 * @returns {Promise<Object>} { send, ev, close }
 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,700', 'about:blank'
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
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/** 单指轻点（真实触摸） */
async function tap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }]
  });
  await sleep(55);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
}

/**
 * 单个视口：进入战斗 → 真实触摸开浮层 → 量几何
 * @param {Object} cdp CDP
 * @param {{w:number,h:number,dpr:number,name:string}} v 视口
 * @returns {Promise<Object>} 读数
 */
async function runView(cdp, v) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: true,
    screenWidth: v.w, screenHeight: v.h,
    screenOrientation: { type: v.w > v.h ? 'landscapePrimary' : 'portraitPrimary', angle: v.w > v.h ? 90 : 0 }
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
  await cdp.send('Page.navigate', { url: 'file:///' + SNAP.replace(/\\/g, '/') + '?ov=' + v.name });
  for (let i = 0; i < 120; i += 1) {
    if (await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`)) break;
    await sleep(200);
  }
  await sleep(900);
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

  const btn = await cdp.ev(`(function(){
    var el = document.querySelector('[data-act="room"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height,
      visible: getComputedStyle(el).display !== 'none' && r.width > 0 };
  })()`);
  if (!btn || !btn.visible) {
    /* 竖屏：触控层按设计整体隐藏，只显示「请横屏」。这里取证而不是记"未测" */
    const por = await cdp.ev(`(function(){
      var de = document.documentElement;
      var pad = document.querySelector('#arcmPad');
      var rot = document.getElementById('rotateHint');
      function info(el) {
        if (!el) return null;
        var cs = getComputedStyle(el);
        var r = el.getBoundingClientRect();
        return { display: cs.display, w: Math.round(r.width), h: Math.round(r.height),
          text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40) };
      }
      return { landscape: innerWidth > innerHeight, portClass: document.body.classList.contains('arcm-port'),
        playClass: document.body.classList.contains('arcm-play'),
        pad: info(pad), rot: info(rot),
        doc: { scrollW: de.scrollWidth, clientW: de.clientWidth } };
    })()`);
    const byDesign = !!(por && !por.landscape && por.portClass
      && por.pad && por.pad.display === 'none'
      && por.rot && por.rot.display !== 'none' && /请横屏/.test(por.rot.text));
    return { view: v.name, ok: byDesign, byDesign: byDesign,
      reason: byDesign ? 'portrait-hidden-by-design' : 'no-room-button', portrait: por };
  }

  await tap(cdp, btn.x, btn.y);
  const opened = await cdp.ev(`roomPickerOpen === true`);
  if (!opened) return { view: v.name, ok: false, reason: 'picker-not-open' };

  const measure = await cdp.ev(`(function(){
    var de = document.documentElement;
    var pick = document.getElementById('roomPicker');
    var panel = pick ? pick.querySelector(':scope > div') : null;
    var list = document.getElementById('roomPickerList');
    function box(el) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
        scrollW: el.scrollWidth, clientW: el.clientWidth, overflowX: el.scrollWidth - el.clientWidth };
    }
    var cards = [];
    if (list) {
      Array.prototype.forEach.call(list.querySelectorAll('button[data-room-id]'), function (b) {
        var r = b.getBoundingClientRect();
        cards.push({ id: b.getAttribute('data-room-id'), left: Math.round(r.left), right: Math.round(r.right),
          w: Math.round(r.width), h: Math.round(r.height), insideViewport: r.left >= -0.5 && r.right <= innerWidth + 0.5 });
      });
    }
    return {
      innerWidth: innerWidth, innerHeight: innerHeight,
      doc: { scrollW: de.scrollWidth, clientW: de.clientWidth, bodyScrollW: document.body.scrollWidth, bodyClientW: document.body.clientWidth },
      picker: box(pick), panel: box(panel), list: box(list), cards: cards
    };
  })()`);
  const ok = !!(measure
    && measure.doc.scrollW <= measure.doc.clientW
    && (!measure.panel || measure.panel.scrollW <= measure.panel.clientW)
    && measure.cards.every((c) => c.insideViewport));
  /* 收尾：再点一次【选房】把浮层关掉，避免影响下一次视口 */
  await tap(cdp, btn.x, btn.y);
  return { view: v.name, ok: ok, opened: opened, btn: { x: Math.round(btn.x), y: Math.round(btn.y) }, m: measure };
}

/**
 * 主流程：逐个视口量一遍
 */
async function main() {
  const cdp = await bootEdge();
  const results = [];
  try {
    for (let i = 0; i < VIEWS.length; i += 1) {
      const r = await runView(cdp, VIEWS[i]);
      results.push(r);
      console.log(`[${VIEWS[i].name}] ok=${r.ok} ${JSON.stringify(r.reason || '')}`);
      if (r.m) {
        console.log('  文档    scrollW=' + r.m.doc.scrollW + ' clientW=' + r.m.doc.clientW);
        if (r.m.panel) console.log('  面板    ' + JSON.stringify(r.m.panel));
        if (r.m.list) console.log('  列表    ' + JSON.stringify(r.m.list));
        console.log('  卡片    ' + JSON.stringify(r.m.cards));
      }
    }
  } finally {
    cdp.close();
  }
  const all = results.every((r) => r.ok);
  console.log('\n[汇总] ' + (all ? 'PASS' : 'FAIL') + ' —— '
    + results.map((r) => r.view + ':' + (r.ok
      ? (r.byDesign ? '竖屏不支持选房（按设计隐藏，显示「请横屏」）' : 'OK')
      : 'NG(' + (r.reason || 'overflow') + ')')).join('  '));
  fs.mkdirSync(path.join(MOBILE_DIR, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(MOBILE_DIR, 'shots', 'overlay_measure.json'), JSON.stringify(results, null, 1));
  process.exitCode = all ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
