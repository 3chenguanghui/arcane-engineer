/**
 * P2/P6/P7/P8/P9 落地验收（W1–W9）
 * ------------------------------------------------------------
 * 用法：
 *   node tools/ctrl_p9.js baseline   // 只量改前布局基线（不写结果文件）
 *   node tools/ctrl_p9.js full       // 全量验收，写 tools/ctrl_p9_result.json + .screenshots/ctrl/*.png
 * 设备：无头 Edge（headless=new）+ 原生 CDP，端口 9557，仅 1 个浏览器
 * 身份：触屏 390×844@2x（mobile/touch）→ 桌面 1280×800（mouse）
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9557;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'ctrl');
const LOG_PATH = path.join(__dirname, '_ctrl_p9.log');
const RESULT_PATH = path.join(__dirname, 'ctrl_p9_result.json');
const MODE = process.argv[2] === 'baseline' ? 'baseline' : 'full';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logStream = fs.createWriteStream(LOG_PATH, { flags: MODE === 'baseline' ? 'w' : 'a' });

/**
 * 统一日志输出（同时写 tools/_ctrl_p9.log 与控制台）
 * @param {string} msg 文本
 * @returns {void}
 */
function log(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
  logStream.write(line + '\n');
  console.log(line);
}

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} id 编号（W1…W9）
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function ok(id, name, pass, detail) {
  const item = { id, name, pass: !!pass, detail: detail === undefined ? null : detail };
  asserts.push(item);
  log((pass ? 'PASS' : 'FAIL') + ' · ' + id + ' ' + name + ' · ' + JSON.stringify(item.detail));
}

/**
 * 计算文件 MD5（大写，与 Get-FileHash 一致）
 * @param {string} file 文件路径
 * @returns {string} MD5
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 页面内通用布局快照表达式（返回顶栏 padding / 按钮 rect / 关闭键 rect / 小地图 / 滚动宽度）
 * @returns {string} JS 表达式源码
 */
function layoutExpr() {
  return `(function(){
    var top = document.querySelector('.hud-top');
    var cs = top ? window.getComputedStyle(top) : null;
    var rectOf = function(el){ var r = el.getBoundingClientRect(); return {
      left: Math.round(r.left*10)/10, right: Math.round(r.right*10)/10,
      top: Math.round(r.top*10)/10, bottom: Math.round(r.bottom*10)/10,
      width: Math.round(r.width*10)/10, height: Math.round(r.height*10)/10,
      display: window.getComputedStyle(el).display, vis: window.getComputedStyle(el).visibility
    }; };
    var ids = ['btnMute','btnRules','btnSkillTree','btnSettings','btnRestart'];
    var buttons = ids.map(function(id){
      var el = document.getElementById(id);
      return el ? Object.assign({ id: id }, rectOf(el)) : { id: id, missing: true };
    });
    var closes = ['rulesClose','settingsClose','mapClose','codexClose','skillTreeClose','engraveClose','btnTalentClose'].map(function(id){
      var el = document.getElementById(id);
      return el ? Object.assign({ id: id }, rectOf(el)) : { id: id, missing: true };
    });
    var mm = document.querySelector('.minimap-panel');
    var hudR = top ? top.getBoundingClientRect() : null;
    var brand = document.querySelector('.hud-top .brand');
    var readouts = document.querySelector('.hud-top .hud-readouts');
    var actions = document.querySelector('.hud-top .hud-actions');
    var rowTop = function(el){ return el ? Math.round(el.getBoundingClientRect().top*10)/10 : null; };
    var modal = document.querySelector('.modal-layer');
    var modalCs = modal ? window.getComputedStyle(modal) : null;
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      pad: cs ? { top: cs.paddingTop, left: cs.paddingLeft, right: cs.paddingRight, bottom: cs.paddingBottom } : null,
      hud: hudR ? { top: Math.round(hudR.top*10)/10, height: Math.round(hudR.height*10)/10, bottom: Math.round(hudR.bottom*10)/10 } : null,
      buttons: buttons, closes: closes,
      rowTops: { brand: rowTop(brand), readouts: rowTop(readouts), actions: rowTop(actions) },
      actionsRect: actions ? rectOf(actions) : null,
      minimap: mm ? rectOf(mm) : null,
      modalPadBottom: modalCs ? modalCs.paddingBottom : null,
      scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
      bodyScrollW: document.body.scrollWidth, bodyScrollH: document.body.scrollHeight,
      bodyOverflow: window.getComputedStyle(document.body).overflow,
      overscroll: window.getComputedStyle(document.body).overscrollBehavior,
      touchAction: window.getComputedStyle(document.body).touchAction,
      hudTopTouchAction: cs ? cs.touchAction : null,
      envTop: (function(){
        var p = document.createElement('div');
        p.style.cssText = 'position:fixed;top:env(safe-area-inset-top);left:env(safe-area-inset-left);width:1px;height:1px;';
        document.body.appendChild(p);
        var r = p.getBoundingClientRect();
        document.body.removeChild(p);
        return { top: Math.round(r.top*10)/10, left: Math.round(r.left*10)/10 };
      })()
    };
  })()`;
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md5Before = md5Of(FILE);
  const sizeBefore = fs.statSync(FILE).size;
  log('==== ' + MODE + ' 开始 · 文件 MD5=' + md5Before + ' size=' + sizeBefore + ' ====');

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--mute-audio', '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });

  let ws = null;
  let consoleErrCount = 0;
  let exceptionCount = 0;
  try {
    // ---------- 连接 CDP ----------
    let target = null;
    for (let i = 0; i < 90; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) { /* Edge 还没起来 */ }
      await sleep(250);
    }
    if (!target) throw new Error('Edge 未就绪（端口 ' + PORT + '）');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (msg) => {
      const m = JSON.parse(msg.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
        return;
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') consoleErrCount += 1;
      if (m.method === 'Runtime.exceptionThrown') exceptionCount += 1;
    };
    await new Promise((r) => { ws.onopen = r; });

    /**
     * 发送 CDP 命令并等待返回
     * @param {string} method CDP 方法
     * @param {Object} [params] 参数
     * @returns {Promise<Object>} 结果
     */
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      seq += 1;
      pending.set(seq, (m) => {
        if (m.error) reject(new Error(method + ': ' + JSON.stringify(m.error)));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id: seq, method, params }));
    });

    /**
     * 页面内执行表达式（按值返回）
     * @param {string} expression JS 表达式
     * @returns {Promise<*>} 返回值
     */
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
      return r.result.value;
    };

    /**
     * 轮询等待页面条件成立
     * @param {string} expr 布尔表达式
     * @param {number} [timeout=20000] 超时毫秒
     * @returns {Promise<boolean>} 是否成立
     */
    const waitFor = async (expr, timeout = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        try { if (await ev(expr) === true) return true; } catch (e) { /* 页面还没加载完 */ }
        await sleep(200);
      }
      return false;
    };

    /**
     * 截图到 .screenshots/ctrl/
     * @param {string} name 文件名
     * @returns {Promise<number>} 文件字节数
     */
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(OUT_DIR, name);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      const size = fs.statSync(file).size;
      log('截图 ' + name + ' · ' + size + 'B');
      return size;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function(){
        window.__errMirror = [];
        function push(m){
          var s = String(m);
          window.__errMirror.push(s);
          try { if (!window.__errors) window.__errors = []; window.__errors.push(s); } catch (e) {}
        }
        window.addEventListener('error', function(e){
          push((e && e.message ? e.message : String(e)) + ' @' + (e && e.filename ? e.filename : '') + ':' + (e && e.lineno ? e.lineno : 0));
        });
        window.addEventListener('unhandledrejection', function(e){
          var r = e && e.reason;
          push('rejection: ' + (r && r.message ? r.message : String(r)));
        });
      })();`
    });

    /**
     * 切到触屏竖屏身份并导航
     * @returns {Promise<void>}
     */
    const openTouch = async () => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const url = encodeURI('file:///' + FILE.replace(/\\/g, '/'));
      await send('Page.navigate', { url });
      const loaded = await waitFor(`document.readyState === 'complete' && !!(window.__roamDebug) && !!document.getElementById('game')`, 30000);
      if (!loaded) throw new Error('页面未在 30s 内加载完成（触屏身份）');
      await sleep(1200);
    };

    /**
     * 点开始 → 必要时选角色 → 等进入 playing
     * @returns {Promise<string>} 最终 state.mode
     */
    const startGame = async () => {
      await ev(`(function(){ var b = document.getElementById('btnStart'); if (b) b.click(); return !!b; })()`);
      await sleep(600);
      const charOpen = await ev(`(function(){ var l = document.getElementById('charLayer'); return !!(l && !l.classList.contains('hidden')); })()`);
      const mode1 = await ev(`(function(){ try { return window.__roamDebug.getState().mode || state.mode; } catch (e) { return ''; } })()`);
      if (mode1 !== 'playing' && charOpen) {
        await ev(`(function(){ var b = document.getElementById('btnCharConfirm'); if (b) b.click(); return !!b; })()`);
        await sleep(1000);
      }
      return await ev(`(function(){ try { return window.__roamDebug.getState().mode || state.mode; } catch (e) { return ''; } })()`);
    };

    // ============================================================
    // 触屏 390×844
    // ============================================================
    await openTouch();
    log('触屏页面加载完成');

    if (MODE === 'baseline') {
      await startGame();
      await sleep(400);
      const layout = await ev(layoutExpr());
      log('BASELINE_LAYOUT ' + JSON.stringify(layout));
      return;
    }

    // ---------- W1 语法/加载 + 可开局 ----------
    try {
      const base = await ev(`(function(){
        var c = document.getElementById('game');
        return { errors: (window.__errors || []).slice(), mirror: (window.__errMirror || []).slice(), cw: c ? c.width : 0, ch: c ? c.height : 0, ready: document.readyState };
      })()`);
      const modeFinal = await startGame();
      await sleep(300);
      const errAfter = await ev(`(function(){ return (window.__errors || []).slice(); })()`);
      ok('W1', '页面零错误且可开局进 playing',
        base.errors.length === 0 && base.mirror.length === 0 && errAfter.length === 0
          && base.cw > 0 && base.ch > 0 && modeFinal === 'playing',
        { errors: base.errors.length, mirror: base.mirror.length, errorsAfterStart: errAfter.length,
          canvas: [base.cw, base.ch], mode: modeFinal, consoleErrCount, exceptionCount });
    } catch (e) { ok('W1', '页面加载/开局', false, { error: String(e.message || e) }); }

    // 稳定画面（关掉开场演出、清空敌人，便于截图）
    try {
      await ev(`(function(){
        try { if (typeof skipOpeningRitual === 'function') skipOpeningRitual(); } catch (e) {}
        try { state.transitionLock = false; state.player.vx = 0; state.player.vy = 0; } catch (e) {}
        try { if (window.__roamDebug && typeof window.__roamDebug.clearEnemies === 'function') window.__roamDebug.clearEnemies(); } catch (e) {}
        try { window.__roamDebug.touch.reset(); } catch (e) {}
        return true;
      })()`);
    } catch (e) { log('稳定画面失败：' + String(e.message || e)); }
    await sleep(400);

    // ---------- W2 P2 长按右半屏持续施法 ----------
    let w2Detail = null;
    try {
      const wrap = await ev(`(function(){
        if (window.__castCalls !== undefined) { window.__castCalls = 0; return 'already'; }
        var f = window.castPrimary || (typeof castPrimary === 'function' ? castPrimary : null);
        if (typeof f !== 'function') return 'no-castPrimary';
        window.__castCalls = 0;
        window.__castOrig = f;
        window.castPrimary = function(){ window.__castCalls += 1; return window.__castOrig.apply(this, arguments); };
        return 'ok';
      })()`);
      const before = await ev(`(function(){ try { return window.__roamDebug.touch.info().stats.casts; } catch (e) { return -1; } })()`);
      const rst = await ev(`(function(){ try { window.__roamDebug.touch.reset(); return true; } catch (e) { return false; } })()`);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
      await sleep(1200);
      const hold = await ev(`(function(){
        var info = window.__roamDebug.touch.info();
        return { calls: window.__castCalls, casts: info.stats.casts, aiming: info.aiming, aimId: info.moveId, mode: (function(){ try { return window.__roamDebug.getState().mode; } catch (e) { return ''; } })() };
      })()`);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(150);
      const after = await ev(`(function(){ return window.__roamDebug.touch.info().stats.casts; })()`);
      w2Detail = { wrap, before, after, hold, callsDuringHold: hold.calls, castsDelta: hold.casts - before };
      ok('W2', '右半屏按住 1.2s 不动，施法次数 ≥2',
        hold.calls >= 2 || (hold.casts - before) >= 2,
        w2Detail);
    } catch (e) { ok('W2', '长按连施', false, { error: String(e.message || e) }); }

    // ---------- W3 P8 混合设备守卫 ----------
    let w3Detail = null;
    try {
      await ev(`(function(){ try { window.__roamDebug.touch.reset(); } catch (e) {} return true; })()`);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 430, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 500, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
      await sleep(80);
      const st1 = await ev(`(function(){ return window.__roamDebug.touch.info(); })()`);
      const probe = await ev(`(function(){
        var c = document.getElementById('game');
        var id = window.__roamDebug.touch.info().moveId;
        var r = c.getBoundingClientRect();
        var moved = new PointerEvent('pointermove', { pointerId: id, pointerType: 'mouse', bubbles: true, cancelable: true,
          clientX: r.left + 10, clientY: r.top + 10, button: 0, buttons: 1 });
        c.dispatchEvent(moved);
        var up = new PointerEvent('pointerup', { pointerId: id, pointerType: 'mouse', bubbles: true, cancelable: true,
          clientX: r.left + 10, clientY: r.top + 10, button: 0 });
        c.dispatchEvent(up);
        var after = window.__roamDebug.touch.info();
        return { pointerIdUsed: id, axisBefore: { x: st_axis_x, y: st_axis_y }, axisAfter: after.axis, moveIdAfter: after.moveId, active: after.active };
      })()`.replace('st_axis_x', String(st1.axis.x)).replace('st_axis_y', String(st1.axis.y)));
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(100);
      const sameAxis = Math.abs(probe.axisAfter.x - probe.axisBefore.x) < 0.0001
        && Math.abs(probe.axisAfter.y - probe.axisBefore.y) < 0.0001;
      w3Detail = { axisBefore: st1.axis, axisAfterMouseEvent: probe.axisAfter, moveIdBefore: st1.moveId,
        moveIdAfter: probe.moveIdAfter, pointerIdUsed: probe.pointerIdUsed, sameAxis, activeBefore: st1.active };
      ok('W3', '触屏摇杆按住时同 pointerId 的 mouse pointermove/up 不劫持摇杆',
        sameAxis && probe.moveIdAfter === st1.moveId && st1.active === true,
        w3Detail);
    } catch (e) { ok('W3', '混合设备守卫', false, { error: String(e.message || e) }); }

    // ---------- W4 P6 安全区（env=0 零位移） ----------
    let layout390 = null;
    try {
      layout390 = await ev(layoutExpr());
      const pad = layout390.pad;
      const same = pad.top === '12px' && pad.left === '16px' && pad.right === '16px';
      ok('W4', '无刘海下 .hud-top padding 与改前一致（12/16/16）',
        same && layout390.envTop.top === 0 && layout390.envTop.left === 0,
        { padBefore: '12px 16px 16px', padAfter: pad, env: layout390.envTop, modalPadBottom: layout390.modalPadBottom });
    } catch (e) { ok('W4', '安全区 padding', false, { error: String(e.message || e) }); }

    // ---------- W5/W6 P7 触摸目标 ----------
    try {
      const btnSettings = layout390.buttons.find((b) => b.id === 'btnSettings') || {};
      ok('W5', '#btnSettings rect.right ≤ 390',
        typeof btnSettings.right === 'number' && btnSettings.right <= 390 && btnSettings.left >= 0,
        { rect: btnSettings, hudActions: layout390.actionsRect, scrollW: layout390.scrollW });
    } catch (e) { ok('W5', '#btnSettings 右缘', false, { error: String(e.message || e) }); }

    try {
      const topBtns = layout390.buttons.filter((b) => !b.missing);
      const shortTop = topBtns.filter((b) => b.height < 44);
      const closes = layout390.closes.filter((b) => !b.missing);
      const shortClose = closes.filter((b) => b.height < 44);
      ok('W6', '顶部按钮全部 ≥44 且面板关闭键 ≥44',
        shortTop.length === 0 && shortClose.length === 0 && closes.length >= 6,
        { top: topBtns.map((b) => ({ id: b.id, h: b.height })), closes: closes.map((b) => ({ id: b.id, h: b.height })),
          shortTop, shortClose });
    } catch (e) { ok('W6', '触摸目标 44px', false, { error: String(e.message || e) }); }

    // ---------- W8 触屏截图 ----------
    let touchShot = 0;
    try {
      touchShot = await shot('touch_390_after.png');
    } catch (e) { log('触屏截图失败：' + String(e.message || e)); }

    // ---------- W9 回归（页面内文案 + 源码标记 grep 计数） ----------
    try {
      const regress = await ev(`(function(){
        var intro = document.getElementById('introHintText');
        var t = intro ? String(intro.textContent || '') : '';
        return {
          intro: t, hasM: t.indexOf('按 M') >= 0, hasT: t.indexOf('按 T') >= 0,
          touchUi: document.body.classList.contains('touch-ui'),
          kbds: document.querySelectorAll('kbd').length,
          kbdVisible: Array.prototype.slice.call(document.querySelectorAll('kbd')).filter(function(el){
            if (!(el.getClientRects().length > 0)) return false;
            var cs = window.getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden';
          }).length,
          weaponsEnabledDeleted: (function(){ try { return !('weaponsEnabled' in (state.meta || {})); } catch (e) { return 'unknown'; } })()
        };
      })()`);
      /* P3/P4 标记在源码里（KEY_BY_MODE / padButtonDown 都在闭包里，页面全局取不到，改用 grep 计数） */
      const src = fs.readFileSync(FILE, 'utf8');
      const count = (re) => (src.match(re) || []).length;
      const markers = {
        KEY_BY_MODE: count(/KEY_BY_MODE/g),
        padButtonDown: count(/padButtonDown/g),
        syncGamepadLegend: count(/syncGamepadLegend/g),
        weaponsEnabledDeleted: count(/delete (?:meta|base)\.weaponsEnabled/g),
        touchCast: count(/touchCast/g)
      };
      ok('W9', 'P1 文案生效（intro 无按 M）、P3/P4/P5 标记在、meta 无 weaponsEnabled',
        !regress.hasM && !regress.hasT && regress.touchUi === true && regress.kbdVisible === 0
          && markers.KEY_BY_MODE >= 1 && markers.padButtonDown >= 1 && markers.syncGamepadLegend >= 1
          && markers.weaponsEnabledDeleted >= 1 && regress.weaponsEnabledDeleted === true,
        { runtime: regress, fileMarkers: markers });
    } catch (e) { ok('W9', 'P1/P3/P4 回归', false, { error: String(e.message || e) }); }

    // ---------- W7/W8 桌面 1280×800 ----------
    try {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 800
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      const url = encodeURI('file:///' + FILE.replace(/\\/g, '/'));
      /* 本机是触摸屏：把原生触点覆写成 0，才是真正的"非触屏桌面"身份（沿用 ctrl_p1 V14b 的做法） */
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(function(){
          try {
            Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
              configurable: true,
              get: function () { return 0; }
            });
          } catch (e) {}
        })();`
      });
      await send('Page.navigate', { url });
      const loadedD = await waitFor(`document.readyState === 'complete' && !!(window.__roamDebug) && !!document.getElementById('game')`, 30000);
      if (!loadedD) throw new Error('桌面身份页面未加载完成');
      await sleep(1200);
      const modeD = await startGame();
      await sleep(400);
      const stable = await ev(`(function(){
        try { if (typeof skipOpeningRitual === 'function') skipOpeningRitual(); } catch (e) {}
        try { if (window.__roamDebug && typeof window.__roamDebug.clearEnemies === 'function') window.__roamDebug.clearEnemies(); } catch (e) {}
        return true;
      })()`);
      await sleep(500);
      const d = await ev(layoutExpr());
      const desk = await ev(`(function(){
        return {
          touchUi: document.body.classList.contains('touch-ui'),
          maxTouchPoints: navigator.maxTouchPoints,
          intro: (function(){ var el = document.getElementById('introHintText'); return el ? String(el.textContent || '').trim() : ''; })(),
          kbdVisible: Array.prototype.slice.call(document.querySelectorAll('kbd')).filter(function(el){
            if (!(el.getClientRects().length > 0)) return false;
            var cs = window.getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden';
          }).length
        };
      })()`);
      const topBtns = d.buttons.filter((b) => !b.missing);
      /* 顶栏只有 brand + actions 在同一行；.hud-readouts 在桌面是绝对定位的左上角状态卡（设计如此，不能算换行） */
      const singleRow = Math.abs(d.rowTops.brand - d.rowTops.actions) <= 2;
      const btnTopSpread = Math.max(...topBtns.map((b) => b.top)) - Math.min(...topBtns.map((b) => b.top));
      const desktopShot = await shot('desktop_1280_after.png');
      ok('W7', '桌面 1280×800：顶栏单行、按钮布局正常、截图非空',
        d.vw === 1280 && singleRow && btnTopSpread <= 2 && d.scrollW <= 1280 + 1 && desktopShot > 15000
          && modeD === 'playing' && desk.touchUi === false,
        { vw: d.vw, vh: d.vh, singleRow, rowTops: d.rowTops, btnTopsSpread: btnTopSpread,
          btnHeights: topBtns.map((b) => ({ id: b.id, h: b.height })), hudHeight: d.hud && d.hud.height,
          scrollW: d.scrollW, shotBytes: desktopShot, mode: modeD, pad: d.pad, minimap: d.minimap,
          readoutsCorner: { top: d.rowTops.readouts }, desktop: desk });
    } catch (e) { ok('W7', '桌面回归', false, { error: String(e.message || e) }); }

    // ---------- W8 汇总 ----------
    try {
      const dir = fs.readdirSync(OUT_DIR);
      const t = fs.statSync(path.join(OUT_DIR, 'touch_390_after.png')).size;
      const dsz = fs.statSync(path.join(OUT_DIR, 'desktop_1280_after.png')).size;
      ok('W8', '两张截图存在且非空', t > 15000 && dsz > 15000, { touch_390_after: t, desktop_1280_after: dsz, dirCount: dir.length });
    } catch (e) { ok('W8', '截图', false, { error: String(e.message || e) }); }

  } catch (e) {
    ok('W0', 'harness 异常', false, { error: String(e.message || e) });
  } finally {
    try { if (ws) ws.close(); } catch (e) { /* ignore */ }
    killEdge(edge);
    const md5After = md5Of(FILE);
    const sizeAfter = fs.statSync(FILE).size;
    log('==== 文件 MD5=' + md5After + ' size=' + sizeAfter + '（运行全程未写页面文件）====');
    if (MODE !== 'baseline') {
      fs.writeFileSync(RESULT_PATH, JSON.stringify({
        mode: MODE,
        file: FILE,
        md5Before, sizeBefore, md5After, sizeAfter,
        consoleErrCount, exceptionCount,
        asserts,
        w2: asserts.find((a) => a.id === 'W2') ? asserts.find((a) => a.id === 'W2').detail : null,
        w3: asserts.find((a) => a.id === 'W3') ? asserts.find((a) => a.id === 'W3').detail : null
      }, null, 2));
      log('结果已写入 ' + RESULT_PATH);
      const failed = asserts.filter((a) => !a.pass);
      log('汇总：' + (asserts.length - failed.length) + '/' + asserts.length + ' PASS'
        + (failed.length ? ' · FAIL=' + failed.map((a) => a.id).join(',') : ''));
    }
    process.exit(0);
  }
}

main();
