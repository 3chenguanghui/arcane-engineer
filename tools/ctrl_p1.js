/**
 * P1 触屏文案层验收（V1–V15）· 只读验证
 * ------------------------------------------------------------
 * 目标：index_arcane_v2.html（跑前跑后校验 MD5，全程不写页面文件）
 * 设备：无头 Edge（headless=new）+ CDP，端口 9553，只开 1 个浏览器
 * 身份：390×844 @2x、mobile=true、touch=true（pointer: coarse）
 * 输出：
 *   tools/ctrl_p1_result.json
 *   tools/_ctrl_p1.log
 *   .screenshots/ctrl/p1_touch_hud.png
 *   .screenshots/ctrl/p1_touch_tutorial.png
 * 用法：node tools/ctrl_p1.js
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9553;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'ctrl');
const LOG_PATH = path.join(__dirname, '_ctrl_p1.log');
const RESULT_PATH = path.join(__dirname, 'ctrl_p1_result.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const logStream = fs.createWriteStream(LOG_PATH, { flags: 'w' });
/**
 * 统一日志输出（同时写日志文件与控制台）
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
 * @param {string} id 编号（V1…）
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
 * 计算文件 MD5（十六进制大写，与 Get-FileHash 对齐）
 * @param {string} file 文件路径
 * @returns {string} MD5
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const md5Before = md5Of(FILE);
  const sizeBefore = fs.statSync(FILE).size;
  log('文件 MD5（前）：' + md5Before + '  size=' + sizeBefore);

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--mute-audio', '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });

  let ws = null;
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
    let consoleErrCount = 0;
    let exceptionCount = 0;
    ws.onmessage = (msg) => {
      const m = JSON.parse(msg.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
        return;
      }
      /* V13 用：统计点击开始期间的 console error / 未捕获异常 */
      if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
        consoleErrCount += 1;
      }
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
      pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
      ws.send(JSON.stringify({ id: seq, method, params }));
    });

    /**
     * 页面内执行表达式（按值返回）
     * @param {string} expression JS 表达式
     * @returns {Promise<*>} 返回值
     */
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
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

    // ---------- 导航前装错误收集器（跨导航生效） ----------
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

    // ---------- 触屏身份：竖屏 390×844 @2x + 触摸仿真 ----------
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenWidth: 390, screenHeight: 844
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const url = encodeURI('file:///' + FILE.replace(/\\/g, '/'));
    await send('Page.navigate', { url });
    // 等 load 完成 + 页面调试口就绪，再额外静置 1.5s（2.7MB 单文件加载较久）
    const loaded = await waitFor(`document.readyState === 'complete' && !!(window.__roamDebug) && !!document.getElementById('game')`, 30000);
    if (!loaded) throw new Error('页面未在 30s 内加载完成');
    await sleep(1500);
    log('页面加载完成，已静置 1.5s');

    // ---------- V1 页面加载 ----------
    try {
      const v1 = await ev(`(function(){
        var c = document.getElementById('game');
        return {
          errors: (window.__errors || []).slice(),
          mirror: (window.__errMirror || []).slice(),
          cw: c ? c.width : 0,
          ch: c ? c.height : 0,
          ready: document.readyState
        };
      })()`);
      ok('V1', '页面加载：__errors 为空、canvas 宽高 >0',
        v1.errors.length === 0 && v1.mirror.length === 0 && v1.cw > 0 && v1.ch > 0,
        v1);
    } catch (e) { ok('V1', '页面加载', false, { error: String(e.message || e) }); }

    // ---------- V2 触屏识别 ----------
    try {
      const v2 = await ev(`(function(){
        return {
          touchUi: document.body.classList.contains('touch-ui'),
          coarse: window.matchMedia('(pointer: coarse)').matches,
          anyCoarse: window.matchMedia('(any-pointer: coarse)').matches,
          maxTouchPoints: navigator.maxTouchPoints,
          copyApi: !!(window.__touchCopy)
        };
      })()`);
      ok('V2', '触屏识别：body.touch-ui 且 pointer: coarse',
        v2.touchUi === true && v2.coarse === true, v2);
    } catch (e) { ok('V2', '触屏识别', false, { error: String(e.message || e) }); }

    // ---------- V3 顶部首次提示 ----------
    try {
      const v3 = await ev(`(function(){
        var el = document.getElementById('introHintText');
        var t = el ? String(el.textContent || '').trim() : '';
        return { text: t, hasM: t.indexOf('按 M') >= 0, hasT: t.indexOf('按 T') >= 0 };
      })()`);
      ok('V3', '顶部首次提示已触屏化',
        v3.text === '点地图键看全屏地图 · 点技能树键看技能树'
          && !v3.hasM && !v3.hasT, v3);
    } catch (e) { ok('V3', '顶部首次提示', false, { error: String(e.message || e) }); }

    // ---------- V4 底部操作行 ----------
    try {
      const v4 = await ev(`(function(){
        var rows = Array.prototype.slice.call(document.querySelectorAll('.deck-keys')).filter(function(el){ return el.id !== 'padLegend'; });
        var first = rows[0] || null;
        var raw = first ? String(first.textContent || '') : '';
        var norm = raw.replace(/\\s+/g, ' ').trim();
        return {
          count: rows.length,
          raw: raw,
          norm: norm,
          hasStick: norm.indexOf('摇杆移动') >= 0,
          hasCast: norm.indexOf('右侧点按施法') >= 0,
          hasLeft: norm.indexOf('左键') >= 0,
          hasJ: norm.indexOf('J') >= 0,
          hasK: norm.indexOf('K') >= 0,
          hasHPause: norm.indexOf('H 暂停') >= 0
        };
      })()`);
      ok('V4', '底部操作行：含摇杆/右侧点按施法，不含键位',
        v4.hasStick && v4.hasCast && !v4.hasLeft && !v4.hasJ && !v4.hasK && !v4.hasHPause, v4);
    } catch (e) { ok('V4', '底部操作行', false, { error: String(e.message || e) }); }

    // ---------- V5 键帽清零（只是隐藏不是删除） ----------
    try {
      const v5 = await ev(`(function(){
        var all = Array.prototype.slice.call(document.querySelectorAll('kbd'));
        var visible = all.filter(function(el){
          if (!(el.getClientRects().length > 0)) return false;
          var cs = window.getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden';
        });
        return {
          total: all.length,
          visible: visible.length,
          samples: visible.slice(0, 6).map(function(el){ return String(el.textContent || '').trim(); })
        };
      })()`);
      ok('V5', '键帽清零：可见 kbd=0 且 DOM 仍有 kbd',
        v5.visible === 0 && v5.total > 0, v5);
    } catch (e) { ok('V5', '键帽清零', false, { error: String(e.message || e) }); }

    // ---------- V6 融合提示 ----------
    try {
      const v6a = await ev(`(function(){
        var el = document.getElementById('fusionNote');
        var text = el ? String(el.textContent || '').trim() : '';
        var html = el ? String(el.innerHTML || '') : '';
        return {
          text: text,
          hasKbdTag: text.indexOf('<kbd>') >= 0 || html.indexOf('<kbd>') >= 0,
          hasWF: /按\\s*F/.test(text),
          buildFusionHint: typeof buildFusionHint === 'function',
          updateFusionHint: typeof updateFusionHint === 'function'
        };
      })()`);
      let skip = 'skip';
      if (v6a.buildFusionHint) {
        skip = 'called';
        await ev(`(function(){ buildFusionHint(); buildFusionHint(); return true; })()`);
      } else if (v6a.updateFusionHint) {
        /* 页面实际函数名是 updateFusionHint，额外调用两次做同口径验证 */
        skip = 'skip(buildFusionHint 不存在; 已用 updateFusionHint×2)';
        try { await ev(`(function(){ updateFusionHint(); updateFusionHint(); return true; })()`); } catch (e) { /* 忽略 */ }
      }
      await sleep(60);
      const v6b = await ev(`(function(){
        var el = document.getElementById('fusionNote');
        var text = el ? String(el.textContent || '').trim() : '';
        var html = el ? String(el.innerHTML || '') : '';
        return {
          text: text,
          hasKbdTag: text.indexOf('<kbd>') >= 0 || html.indexOf('<kbd>') >= 0,
          hasWF: /按\\s*F/.test(text)
        };
      })()`);
      ok('V6', '融合提示不含 <kbd> / 按 F（连续调用两次后仍成立）',
        !v6b.hasKbdTag && !v6b.hasWF,
        { buildFusionHint: skip, before: v6a.text, after: v6b.text });
    } catch (e) { ok('V6', '融合提示', false, { error: String(e.message || e) }); }

    // ---------- V7 过载提示 ----------
    try {
      const v7 = await ev(`(function(){
        var el = document.getElementById('overdriveLabel');
        var t = el ? String(el.textContent || '').trim() : '';
        return { text: t, hasWF: /按\\s*F/.test(t) };
      })()`);
      ok('V7', '过载提示不含按 F', !v7.hasWF, v7);
    } catch (e) { ok('V7', '过载提示', false, { error: String(e.message || e) }); }

    // ---------- V8 画布门提示 ----------
    try {
      const v8 = await ev(`(function(){
        var enter = (typeof DOOR_VIS_CONFIG !== 'undefined' && DOOR_VIS_CONFIG.enterHint) ? String(DOOR_VIS_CONFIG.enterHint) : '';
        var footer = (typeof DUAL_ALTAR_CONFIG !== 'undefined' && DUAL_ALTAR_CONFIG.footerText) ? String(DUAL_ALTAR_CONFIG.footerText) : '';
        return {
          enterHint: enter,
          altarFooter: footer,
          enterHasE: enter.indexOf('按 E') >= 0,
          altarHasE: footer.indexOf('按 E') >= 0
        };
      })()`);
      ok('V8', '画布门提示：点交互键进入、无双祭坛按 E',
        v8.enterHint === '点交互键进入' && !v8.enterHasE && !v8.altarHasE, v8);
    } catch (e) { ok('V8', '画布门提示', false, { error: String(e.message || e) }); }

    // ---------- V9 教学第一条 ----------
    try {
      const v9 = await ev(`(function(){
        var step = (typeof ONBOARD_STEPS !== 'undefined' && Array.isArray(ONBOARD_STEPS)) ? ONBOARD_STEPS[0] : null;
        var hint = step ? String(step.hint || '') : '';
        return {
          hint: hint,
          hasWASD: hint.indexOf('WASD') >= 0,
          hasLeft: hint.indexOf('左键') >= 0,
          total: (typeof ONBOARD_STEPS !== 'undefined' && Array.isArray(ONBOARD_STEPS)) ? ONBOARD_STEPS.length : 0
        };
      })()`);
      ok('V9', '教学第一条 = 摇杆移动，右侧点按施法',
        v9.hint === '摇杆移动，右侧点按施法' && !v9.hasWASD && !v9.hasLeft, v9);
    } catch (e) { ok('V9', '教学第一条', false, { error: String(e.message || e) }); }

    // ---------- V10 toast 翻译 ----------
    try {
      await ev(`(function(){ showToast('商店 · 靠近展台按 E 购买'); return true; })()`);
      await sleep(100);
      const v10 = await ev(`(function(){
        var el = document.getElementById('toast');
        var t = el ? String(el.textContent || '').trim() : '';
        return { text: t, hasE: /按\\s*E/.test(t), cls: el ? el.className : '' };
      })()`);
      ok('V10', 'toast 翻译：点交互键购买、不含按 E',
        v10.text === '商店 · 靠近展台点交互键购买' && !v10.hasE, v10);
    } catch (e) { ok('V10', 'toast 翻译', false, { error: String(e.message || e) }); }

    // ---------- V11 地图面板提示 ----------
    try {
      const v11 = await ev(`(function(){
        var el = document.querySelector('.map-tip');
        var t = el ? String(el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        return {
          text: t,
          count: document.querySelectorAll('.map-tip').length,
          hasWheel: t.indexOf('滚轮') >= 0,
          hasM: /[Mm]/.test(t),
          hasEsc: /Esc/i.test(t)
        };
      })()`);
      ok('V11', '地图提示不含滚轮/M/Esc',
        !v11.hasWheel && !v11.hasM && !v11.hasEsc, v11);
    } catch (e) { ok('V11', '地图提示', false, { error: String(e.message || e) }); }

    // ---------- V12 设置页 BGM 说明 ----------
    try {
      const v12 = await ev(`(function(){
        var el = document.querySelector('.setting-note');
        var t = el ? String(el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        return {
          text: t,
          count: document.querySelectorAll('.setting-note').length,
          hasN: /按\\s*N/.test(t),
          hasSpeaker: t.indexOf('点顶部喇叭') >= 0
        };
      })()`);
      ok('V12', '设置页 BGM：不含按 N、含点顶部喇叭',
        !v12.hasN && v12.hasSpeaker, v12);
    } catch (e) { ok('V12', '设置页 BGM', false, { error: String(e.message || e) }); }

    // ---------- V13 加载自检：点开始 → playing ----------
    try {
      const errBase = consoleErrCount;
      const excBase = exceptionCount;
      const clicked = await ev(`(function(){
        var b = document.getElementById('btnStart');
        if (!b) return false;
        b.click();
        return true;
      })()`);
      await sleep(500);
      const mode500 = await ev(`(function(){
        var m = '';
        try {
          if (window.__roamDebug && typeof window.__roamDebug.getState === 'function') m = window.__roamDebug.getState().mode;
        } catch (e) { /* ignore */ }
        if (!m) { try { m = (typeof state !== 'undefined' && state) ? state.mode : ''; } catch (e) { /* ignore */ } }
        return m;
      })()`);
      const charOpen = await ev(`(function(){
        var l = document.getElementById('charLayer');
        return !!(l && !l.classList.contains('hidden'));
      })()`);
      /* 首次开局会先弹角色选择页：按真实用户路径点“以此角色开始”再回到 playing */
      if (mode500 !== 'playing' && charOpen) {
        await ev(`(function(){
          var b = document.getElementById('btnCharConfirm');
          if (b) b.click();
          return !!b;
        })()`);
        await sleep(900);
      }
      const modeFinal = await ev(`(function(){
        var m = '';
        try {
          if (window.__roamDebug && typeof window.__roamDebug.getState === 'function') m = window.__roamDebug.getState().mode;
        } catch (e) { /* ignore */ }
        if (!m) { try { m = (typeof state !== 'undefined' && state) ? state.mode : ''; } catch (e) { /* ignore */ } }
        return m;
      })()`);
      const errDelta = consoleErrCount - errBase;
      const excDelta = exceptionCount - excBase;
      ok('V13', '点开始进入 playing，期间无新增 console error',
        clicked && modeFinal === 'playing' && errDelta === 0 && excDelta === 0,
        { clicked, modeAt500ms: mode500, charSelectOpen: charOpen, modeFinal, consoleErrors: errDelta, exceptions: excDelta });
    } catch (e) { ok('V13', '加载自检', false, { error: String(e.message || e) }); }

    // ---------- 稳定画面 + HUD 截图 ----------
    try {
      await ev(`(function(){
        try { if (typeof skipOpeningRitual === 'function') skipOpeningRitual(); } catch (e) {}
        try {
          state.transitionLock = false;
          state.player.vx = 0;
          state.player.vy = 0;
        } catch (e) {}
        try {
          if (window.__roamDebug && typeof window.__roamDebug.clearEnemies === 'function') window.__roamDebug.clearEnemies();
        } catch (e) {}
        return true;
      })()`);
    } catch (e) { log('稳定画面失败：' + String(e.message || e)); }
    await sleep(700);
    await shot('p1_touch_hud.png');

    // ---------- 第一条教学提示截图（走游戏自身的 onboardEvent 路径） ----------
    try {
      const fired = await ev(`(function(){
        try {
          if (typeof onboardEvent === 'function') return onboardEvent('firstRoom');
          if (typeof onboardShowHint === 'function') return onboardShowHint('firstRoom');
        } catch (e) {}
        return false;
      })()`);
      log('触发 firstRoom 教学：' + JSON.stringify(fired));
    } catch (e) { log('触发教学失败：' + String(e.message || e)); }
    await sleep(1500);
    try {
      const hint = await ev(`(function(){
        var el = document.getElementById('onboardHint');
        return {
          on: !!(el && el.classList.contains('is-on')),
          text: el ? String(el.textContent || '').replace(/\\s+/g, ' ').trim() : ''
        };
      })()`);
      log('教学提示状态：' + JSON.stringify(hint));
    } catch (e) { log('读教学提示失败：' + String(e.message || e)); }
    await shot('p1_touch_tutorial.png');

    // ---------- V14 桌面回归（另一次导航，desktop 身份） ----------
    try {
      /* 桌面快照表达式：触屏类 / 指针类型 / 原生触点 / 文案 / 可见键帽 */
      const desktopSnapshot = `(function(){
        var all = Array.prototype.slice.call(document.querySelectorAll('kbd'));
        var visible = all.filter(function(el){
          if (!(el.getClientRects().length > 0)) return false;
          var cs = window.getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden';
        });
        var intro = document.getElementById('introHintText');
        var introText = intro ? String(intro.textContent || '').trim() : '';
        var enter = (typeof DOOR_VIS_CONFIG !== 'undefined' && DOOR_VIS_CONFIG.enterHint) ? String(DOOR_VIS_CONFIG.enterHint) : '';
        return {
          touchUi: document.body.classList.contains('touch-ui'),
          coarse: window.matchMedia('(pointer: coarse)').matches,
          anyCoarse: window.matchMedia('(any-pointer: coarse)').matches,
          maxTouchPoints: navigator.maxTouchPoints,
          introText: introText,
          enterHint: enter,
          kbdVisible: visible.length,
          kbdTotal: all.length
        };
      })()`;

      await send('Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
        screenWidth: 1280, screenHeight: 800
      });
      /* 关闭触摸仿真：CDP 要求 maxTouchPoints 在 1–16 之间，关闭时省略该字段 */
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });

      /* 14a：先记录"裸桌面"事实（本机是触摸屏，原生 maxTouchPoints 会 >0） */
      await send('Page.navigate', { url });
      const loadedD1 = await waitFor(`document.readyState === 'complete' && !!(window.__roamDebug) && !!document.getElementById('game')`, 30000);
      if (!loadedD1) throw new Error('桌面身份页面未加载完成');
      await sleep(1500);
      const hostDesktop = await ev(desktopSnapshot);

      /* 14b：模拟"纯非触屏桌面"（只把原生触点覆写为 0，不加任何触摸事件仿真） */
      const spoof = await send('Page.addScriptToEvaluateOnNewDocument', {
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
      const loadedD2 = await waitFor(`document.readyState === 'complete' && !!(window.__roamDebug) && !!document.getElementById('game')`, 30000);
      if (!loadedD2) throw new Error('非触屏桌面页面未加载完成');
      await sleep(1500);
      const v14 = await ev(desktopSnapshot);

      ok('V14', '桌面端不受污染：无 touch-ui、原键位文案、kbd 可见',
        v14.touchUi === false
          && v14.introText === '按 M 看全屏地图 · 按 T 看技能树'
          && v14.enterHint === '按 E 进入'
          && v14.kbdVisible > 0,
        { hostDesktop, hostIsTouchHardware: (hostDesktop.maxTouchPoints > 0), nonTouchDesktop: v14 });

      if (spoof && spoof.identifier) {
        try {
          await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: spoof.identifier });
        } catch (e) { log('移除桌面触点覆写脚本失败：' + String(e.message || e)); }
      }
    } catch (e) { ok('V14', '桌面端回归', false, { error: String(e.message || e) }); }

    // ---------- 回到触屏会话继续 V15（再导航一次触屏身份） ----------
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenWidth: 390, screenHeight: 844
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Page.navigate', { url });
    const loadedT2 = await waitFor(`document.readyState === 'complete' && !!(window.__roamDebug) && !!document.getElementById('game')`, 30000);
    if (!loadedT2) throw new Error('触屏第二会话未加载完成');
    await sleep(1500);
    try {
      await ev(`(function(){ var b = document.getElementById('btnStart'); if (b) b.click(); return !!b; })()`);
      await sleep(500);
      await ev(`(function(){
        var l = document.getElementById('charLayer');
        if (l && !l.classList.contains('hidden')) {
          var b = document.getElementById('btnCharConfirm');
          if (b) b.click();
        }
        return true;
      })()`);
      await sleep(900);
      await ev(`(function(){
        try { if (typeof skipOpeningRitual === 'function') skipOpeningRitual(); } catch (e) {}
        try {
          state.transitionLock = false;
          state.player.vx = 0;
          state.player.vy = 0;
        } catch (e) {}
        try { if (window.__roamDebug && typeof window.__roamDebug.clearEnemies === 'function') window.__roamDebug.clearEnemies(); } catch (e) {}
        try { if (window.__roamDebug && window.__roamDebug.touch && typeof window.__roamDebug.touch.reset === 'function') window.__roamDebug.touch.reset(); } catch (e) {}
        return true;
      })()`);
      await sleep(400);

      /**
       * 构造一个 CDP 触点
       * @param {number} x 横坐标
       * @param {number} y 纵坐标
       * @param {number} id 触点 id
       * @returns {Object} 触点
       */
      const tp = (x, y, id) => ({ x: Math.round(x), y: Math.round(y), id, radiusX: 8, radiusY: 8, force: 1 });

      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(90, 430, 1)] });
      await sleep(120);
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(155, 495, 1)] });
      await sleep(220);
      const mid = await ev(`(function(){
        var i = window.__roamDebug.touch.info();
        return { axis: i.axis, active: i.active, moveId: i.moveId };
      })()`);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(350);
      const after = await ev(`(function(){
        var i = window.__roamDebug.touch.info();
        return { axis: i.axis, active: i.active, moveId: i.moveId };
      })()`);
      const mag = Math.max(Math.abs(mid.axis.x), Math.abs(mid.axis.y));
      const afterMag = Math.max(Math.abs(after.axis.x), Math.abs(after.axis.y));
      ok('V15', '触屏摇杆冒烟：移动时 axis 非 0、松手后归零',
        mid.active === true && mag > 0.2 && afterMag < 0.02,
        { mid, after, midMag: Number(mag.toFixed(3)), afterMag: Number(afterMag.toFixed(3)) });
    } catch (e) { ok('V15', '触屏摇杆冒烟', false, { error: String(e.message || e) }); }
  } catch (e) {
    log('FATAL：' + String(e && e.stack ? e.stack : e));
  } finally {
    /* 兜底补齐 15 行（避免致命中断时结果缺项） */
    if (asserts.length < 15) {
      for (let i = asserts.length + 1; i <= 15; i += 1) {
        ok('V' + i, '未执行（流程中断）', false, { reason: 'not-run' });
      }
    }

    const md5After = md5Of(FILE);
    const sizeAfter = fs.statSync(FILE).size;
    log('文件 MD5（后）：' + md5After + '  size=' + sizeAfter);

    const passCount = asserts.filter((a) => a.pass).length;
    const payload = {
      time: new Date().toISOString(),
      fileMd5Before: md5Before,
      fileMd5After: md5After,
      asserts,
      passCount,
      total: asserts.length,
      fileSizeBefore: sizeBefore,
      fileSizeAfter: sizeAfter
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    log('结果写入 ' + RESULT_PATH + ' · ' + passCount + '/' + asserts.length);

    if (ws) { try { ws.close(); } catch (e) { /* 已关闭 */ } }
    killEdge(edge);
  }
}

main().then(() => {
  logStream.end();
}).catch((e) => {
  console.error(e);
  try { logStream.end(); } catch (ignored) { /* ignore */ }
  process.exitCode = 1;
});
