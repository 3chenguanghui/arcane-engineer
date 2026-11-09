/**
 * 触屏适配层 touch.js 验收脚本（CDP 无头浏览器 + 真实触摸注入）
 * ------------------------------------------------------------
 * 覆盖：
 *   T0 操作层启动 / DOM 尺寸
 *   T1 固定摇杆：按下、死区、半推程、满推程、真实推动角色
 *   T2 多指同时：左手摇杆 + 右手普攻，互不干扰
 *   T3 按钮触发：普攻按钮真的让奥能下降（走主文件 J 入口）
 *   T4 页面无报错 / 截图 3 张（竖屏 / 横屏 / 按下态）
 * 用法：node tools/arcane_touch_v3.js
 * 端口：9531
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9531;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'touch-demo.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'touch');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

let edgeProc = null;

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=900,900', '--force-device-scale-factor=1', 'about:blank'
  ], { stdio: 'ignore' });
  edgeProc = edge;

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等浏览器端口就绪 */ }
    await sleep(250);
  }
  if (!target) {
    /* 起不来就先收掉进程，否则它会锁住 profile 目录，让下一次也起不来 */
    killEdge(edge);
    throw new Error('Edge 未就绪');
  }

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
   * @param {Object} params 参数
   * @returns {Promise<Object>} 结果
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 页面内求值
   * @param {string} expression 表达式
   * @returns {Promise<*>} 返回值
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /**
   * 保存截图
   * @param {string} name 文件名
   * @returns {Promise<number>} 字节数
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const buf = Buffer.from(r.data, 'base64');
    fs.writeFileSync(path.join(OUT_DIR, name), buf);
    return buf.length;
  };
  /**
   * 设置移动端视口并开启 5 点触摸
   * @param {number} width 宽
   * @param {number} height 高
   * @returns {Promise<void>}
   */
  const setViewport = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 2, mobile: true,
      screenWidth: width, screenHeight: height, positionX: 0, positionY: 0
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  };
  /**
   * 派发触摸事件（坐标单位：CSS 像素）
   * @param {'touchStart'|'touchMove'|'touchEnd'} type 类型
   * @param {Array<{x:number,y:number,id:number}>} points 触点
   * @returns {Promise<void>}
   */
  const touch = async (type, points) => {
    await send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 }))
    });
  };

  /**
   * 确保游戏回到 playing：清房奖励/结算弹窗会让操作层自动隐藏
   * @returns {Promise<string>} 恢复后的模式
   */
  const ensurePlaying = async () => {
    let mode = await ev(`window.__roamDebug && window.__roamDebug.getState ? window.__roamDebug.getState().mode : null`);
    if (mode === 'playing') return mode;
    await ev(`(typeof restartRun === 'function') ? (restartRun(), true) : true`);
    await sleep(2200);
    await ev(`window.__touchLayer.refresh(); true`);
    mode = await ev(`window.__roamDebug && window.__roamDebug.getState ? window.__roamDebug.getState().mode : null`);
    return mode;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.bringToFront');
  /* 在页面任何脚本之前安装错误收集器，确保 boot 阶段的异常也能被取证 */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errors=[];
      window.addEventListener('error', function(e){
        window.__errors.push(String(e.message || e) + ' @' + (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0));
      });
      window.addEventListener('unhandledrejection', function(e){
        window.__errors.push('reject:' + String(e.reason));
      });`
  });

  const URL = encodeURI('file:///' + FILE.replace(/\\/g, '/')) + '?touch=on';
  await setViewport(390, 844);
  await send('Page.navigate', { url: URL });
  await sleep(2400);
  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(2100);

  /* 两段触屏判定：能力已具备，这里补一个真实触摸（左上角 5,5，不落在任何按钮上），
     让两个文案补丁从"键鼠版"切到"触屏版" */
  await touch('touchStart', [{ x: 5, y: 5, id: 90 }]);
  await sleep(60);
  await touch('touchEnd', []);
  await sleep(140);

  /* ---------- T0 操作层启动 / 尺寸 ---------- */
  const t0 = await ev(`(function(){
    var info = window.__touchLayer && window.__touchLayer.info ? window.__touchLayer.info() : null;
    var mode = (window.__roamDebug && window.__roamDebug.getState) ? window.__roamDebug.getState().mode : null;
    var vv = window.visualViewport ? { w: window.visualViewport.width, h: window.visualViewport.height, scale: window.visualViewport.scale } : null;
    return { info: info, mode: mode, tl: typeof window.__touchLayer,
      innerW: window.innerWidth, innerH: window.innerHeight,
      docW: document.documentElement.clientWidth, vv: vv,
      layers: document.querySelectorAll('.tg-layer').length,
      bodyZoom: getComputedStyle(document.body).zoom,
      errors: (window.__errors || []).slice(0, 6) };
  })()`);
  ok('T0 触屏层已启动（?touch=on）、标题已收起、无报错',
    !!t0.info && t0.info.enabled === true && t0.info.hidden === false
      && t0.mode === 'playing' && t0.errors.length === 0, t0);

  const b = t0.info.buttons || {};
  const stickW = t0.info.stick.rect.w;
  const gapX = b['武器'] && b['装置'] ? b['武器'].x - b['装置'].x - b['装置'].w : -1;
  const gapY = b['融合'] && b['装置'] ? b['融合'].y - b['装置'].y - b['装置'].h : -1;
  ok('T0b 竖屏尺寸：摇杆 ' + stickW + 'px，按钮 ' + (b['普攻'] ? b['普攻'].w + 'x' + b['普攻'].h : '?')
    + '，间距 ' + gapX + 'px（建议 ≥44px 触摸目标、8–12px 间距）',
    stickW >= 120 && b['普攻'] && b['普攻'].w >= 80 && b['普攻'].h >= 60
      && b['闪避'] && b['闪避'].w >= 60 && gapX >= 6 && gapX <= 14 && gapY >= 6 && gapY <= 14,
    { stick: t0.info.stick.rect, buttons: b, gapX, gapY });

  /* ---------- T0c 触摸目标尺寸（含系统键） ---------- */
  const minEdge = Math.min.apply(null, Object.keys(b).map((k) => Math.min(b[k].w, b[k].h)));
  ok('T0c 触摸目标：共 ' + Object.keys(b).length + ' 个按钮，最小边 ' + minEdge + 'px（要求 ≥36px）'
    + '、系统键宽 ' + (b['重开'] ? b['重开'].w : '?') + 'px',
    Object.keys(b).length >= 10 && ['地图', '图鉴', '设置', '重开'].every((k) => b[k]) && minEdge >= 36,
    { minEdge, restart: b['重开'], system: ['地图', '图鉴', '设置', '重开'].map((k) => b[k]) });

  /* ---------- T0d 顶部 HUD 不溢出视口 ---------- */
  const topBar = await ev(`(function(){
    var ids = ['btnMute', 'btnRules', 'btnSkillTree'];
    var out = {};
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var r = el.getBoundingClientRect();
      out[id] = { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) };
    });
    return { innerW: window.innerWidth, out: out };
  })()`);
  ok('T0d 顶部 HUD 不溢出：声音/帮助/技能树右缘 '
    + Object.keys(topBar.out).map((k) => topBar.out[k].r).join('/') + 'px ≤ ' + topBar.innerW + 'px（竖屏可点）',
    Object.keys(topBar.out).length === 3
      && Object.keys(topBar.out).every((k) => topBar.out[k].r <= topBar.innerW - 4 && topBar.out[k].w >= 20),
    topBar);

  /* ---------- T0e 情境提示条不压操作区 ---------- */
  const hintClear = await ev(`(function(){
    var h = document.getElementById('contextHint');
    var pad = document.querySelector('.tg-pad');
    if (!h || !pad) return { visible: false };
    var wasHidden = h.classList.contains('hidden');
    h.classList.remove('hidden');
    window.__touchLayer.refresh();
    var r = h.getBoundingClientRect();
    var p = pad.getBoundingClientRect();
    var sys = document.querySelector('.tg-system');
    var s = sys ? sys.getBoundingClientRect() : null;
    var ix = Math.max(0, Math.min(p.right, r.right) - Math.max(p.left, r.left));
    var iy = Math.max(0, Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top));
    var ix2 = s ? Math.max(0, Math.min(s.right, r.right) - Math.max(s.left, r.left)) : 0;
    var iy2 = s ? Math.max(0, Math.min(s.bottom, r.bottom) - Math.max(s.top, r.top)) : 0;
    var lift = getComputedStyle(document.documentElement).getPropertyValue('--tg-lift').trim();
    if (wasHidden) h.classList.add('hidden');
    return {
      visible: true, wasHidden: wasHidden, lift: lift,
      hintBottom: Math.round(r.bottom), padTop: Math.round(p.top),
      sysTop: s ? Math.round(s.top) : null,
      overlap: Math.round(ix * iy), sysOverlap: Math.round(ix2 * iy2)
    };
  })()`);
  ok('T0e 情境提示条已上移：底边 ' + hintClear.hintBottom + 'px ≤ 操作区顶边 ' + hintClear.padTop
    + 'px - 6，且不压系统键行（' + hintClear.sysTop + 'px；lift=' + hintClear.lift
    + '、交叠 ' + hintClear.overlap + '/' + hintClear.sysOverlap + 'px²）',
    hintClear.visible === true && hintClear.hintBottom <= hintClear.padTop - 6
      && hintClear.overlap === 0
      && (hintClear.sysTop === null || (hintClear.hintBottom <= hintClear.sysTop - 6 && hintClear.sysOverlap === 0)),
    hintClear);

  /* ---------- T1 摇杆 ---------- */
  const stick = t0.info.stick.rect;
  const cx = stick.x + stick.w / 2;
  const cy = stick.y + stick.h / 2;
  const maxR = stick.w / 2 - 24 - 2;

  await touch('touchStart', [{ x: cx, y: cy, id: 1 }]);
  await sleep(120);
  const s0 = await ev(`window.__touchLayer.info().stick`);
  ok('T1a 摇杆按下：active=true、推程 0、强度 0（死区起点）',
    s0.active === true && s0.push === 0 && s0.strength === 0, s0);

  await touch('touchMove', [{ x: cx + 2, y: cy, id: 1 }]);
  await sleep(120);
  const s1 = await ev(`window.__touchLayer.info().stick`);
  ok('T1b 死区：推程 2px（<0.08×有效半径）仍不产生移动',
    s1.active === true && s1.push < 0.08 && s1.strength === 0, s1);

  await touch('touchMove', [{ x: cx + maxR * 0.55, y: cy, id: 1 }]);
  await sleep(120);
  const s2 = await ev(`(function(){
    var s = window.__touchLayer.info().stick;
    return { s: s, axisX: state.touch.axisX, axisY: state.touch.axisY };
  })()`);
  ok('T1c 半推程：我方强度 ' + s2.s.strength + ' → 主文件 axisX ' + Number(s2.axisX).toFixed(3) + '（误差 <0.03）',
    s2.s.strength > 0.2 && s2.s.strength < 0.9 && Math.abs(s2.axisX - s2.s.strength) < 0.03
      && Math.abs(s2.axisY) < 0.01, s2);

  await touch('touchMove', [{ x: cx + maxR + 6, y: cy, id: 1 }]);
  await sleep(120);
  const s3 = await ev(`(function(){
    var s = window.__touchLayer.info().stick;
    return { s: s, axisX: state.touch.axisX, moveId: state.touch.moveId };
  })()`);
  ok('T1d 满推程：强度 1.000、主文件 axisX≈1、摇杆被主文件接管',
    Math.abs(s3.s.strength - 1) < 0.001 && Math.abs(s3.axisX - 1) < 0.03 && s3.moveId !== null, s3);

  const p0 = await ev(`({ x: state.player.x, y: state.player.y })`);
  await sleep(600);
  const p1 = await ev(`({ x: state.player.x, y: state.player.y })`);
  const dx = p1.x - p0.x;
  ok('T1e 真实位移：满推 600ms 角色沿 +X 位移 ' + Number(dx).toFixed(1) + 'px（要求 >20px）',
    dx > 20 && Math.abs(p1.y - p0.y) < 25, { before: p0, after: p1, dx });
  /* ---------- T1f 摇杆热区容错 ---------- */
  await touch('touchEnd', []);
  await sleep(120);
  const hotX = stick.x - 10;
  await touch('touchStart', [{ x: hotX, y: cy, id: 1 }]);
  await sleep(140);
  const hot = await ev(`window.__touchLayer.info().stick`);
  ok('T1f 热区容错：在底盘外 10px（x=' + hotX + '）按下仍抓住摇杆（视觉未变大）',
    hot.active === true, hot);
  await touch('touchEnd', []);
  await sleep(140);

  /* ---------- T1g 摇杆移动性能 ---------- */
  await touch('touchStart', [{ x: cx, y: cy, id: 1 }]);
  await sleep(80);
  const perf = await ev(`(function(){
    var sid = window.__touchLayer.info().stick.id;
    var n = 120, t0 = performance.now();
    for (var i = 0; i < n; i += 1) {
      document.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: sid, pointerType: 'touch', clientX: ${cx} + (i % 60), clientY: ${cy},
        bubbles: true, cancelable: true
      }));
    }
    return { n: n, perMove: (performance.now() - t0) / n };
  })()`);
  ok('T1g 性能：连续 ' + perf.n + ' 次摇杆移动平均 ' + Number(perf.perMove).toFixed(3)
    + 'ms/次（要求 <2ms，几何已缓存不重排）', perf.perMove < 2, perf);
  await touch('touchEnd', []);
  await sleep(140);

  const pngPortrait = await shot('touch-portrait.png');

  /* ---------- T2 多指同时：摇杆 + 普攻 ---------- */
  /* 先切到一张非「雷击」的已拥有魔法，避免因附近无目标导致施法静默失败（测试前置条件） */
  const pickMagic = await ev(`(function(){
    var ids = state.ownedMagic || [];
    var pick = null;
    for (var i = 0; i < ids.length; i += 1) { if (ids[i] !== 'bolt') { pick = ids[i]; break; } }
    if (pick && typeof selectMagic === 'function') selectMagic(pick);
    return { pick: pick, active: state.activeMagicId };
  })()`);
  const primary = b['普攻'];
  const px = primary.x + primary.w / 2;
  const py = primary.y + primary.h / 2;
  const aether0 = await ev(`state.player.aether`);
  const keysBefore = await ev(`window.__touchLayer.info().stats.keydowns`);

  await touch('touchStart', [
    { x: cx + maxR * 0.8, y: cy, id: 1 },
    { x: px, y: py, id: 2 }
  ]);
  await sleep(600);
  const t2 = await ev(`(function(){
    var s = window.__touchLayer.info();
    return {
      stickActive: s.stick.active, strength: s.stick.strength,
      keydowns: s.stats.keydowns, lastKey: s.lastKey,
      aether: state.player.aether, axisX: state.touch.axisX,
      pressed: Array.prototype.slice.call(document.querySelectorAll('.tg-btn.is-pressed')).map(function(x){ return x.querySelector('b').textContent; })
    };
  })()`);
  ok('T2a 双指同时按：摇杆仍 active（强度 ' + t2.strength + '）、普攻键进入按下态、持续补发 J',
    t2.stickActive === true && t2.strength > 0.5 && t2.pressed.indexOf('普攻') >= 0
      && t2.keydowns - keysBefore >= 2 && t2.lastKey && t2.lastKey.key === 'j', t2);

  const p2 = await ev(`({ x: state.player.x, y: state.player.y })`);
  await sleep(500);
  const t2b = await ev(`(function(){
    var s = window.__touchLayer.info();
    return {
      x: state.player.x, y: state.player.y,
      axisX: state.touch.axisX, strength: s.stick.strength,
      keydowns: s.stats.keydowns, lastKey: s.lastKey
    };
  })()`);
  const moved = Math.hypot(t2b.x - p2.x, t2b.y - p2.y);
  ok('T2b 双指不冲突：按住普攻 500ms 期间摇杆强度仍 ' + Number(t2b.strength).toFixed(3)
    + '、主文件 axisX 仍 ' + Number(t2b.axisX).toFixed(3) + '、J 仍在补发（位移 ' + moved.toFixed(1) + 'px，可能撞墙）',
    t2b.strength > 0.5 && t2b.axisX > 0.5 && t2b.keydowns > 2 && t2b.lastKey && t2b.lastKey.key === 'j',
    { before: p2, after: { x: t2b.x, y: t2b.y }, moved, axisX: t2b.axisX, strength: t2b.strength, keydowns: t2b.keydowns });

  /* 先抬手，再包一层 castPrimary 计数，确定性证明"按钮 -> J -> handleKeyDown -> castPrimary"链路 */
  await touch('touchEnd', []);
  await sleep(160);
  const modeC = await ensurePlaying();
  await ev(`(function(){
    window.__castCalls = 0;
    window.__realCastPrimary = window.castPrimary;
    window.castPrimary = function () { window.__castCalls += 1; return window.__realCastPrimary.apply(null, arguments); };
    return true;
  })()`);
  await touch('touchStart', [
    { x: cx + maxR * 0.3, y: cy, id: 1 },
    { x: px, y: py, id: 2 }
  ]);
  await sleep(520);

  /* 此时普攻键与摇杆都处于按下态，正好截"按下态" */
  const pngPressed = await shot('touch-pressed.png');

  const castProbe = await ev(`(function(){
    var calls = window.__castCalls || 0;
    window.castPrimary = window.__realCastPrimary;
    delete window.__realCastPrimary;
    return {
      calls: calls, aether: state.player.aether,
      status: state.status, cd: state.cooldowns[state.activeMagicId] || 0
    };
  })()`);
  ok('T2c 普攻按钮走主文件入口：按住 520ms 触发 castPrimary ' + castProbe.calls + ' 次'
    + '（奥能 ' + aether0 + ' → ' + Number(castProbe.aether).toFixed(1) + '，status=' + castProbe.status + '）',
    castProbe.calls >= 1, { mode: modeC, probe: castProbe, aether0, pick: pickMagic });

  await touch('touchEnd', []);
  await sleep(200);
  const t2d = await ev(`(function(){
    var s = window.__touchLayer.info();
    return { stickActive: s.stick.active, axisX: state.touch.axisX, pressed: document.querySelectorAll('.tg-btn.is-pressed').length, stats: s.stats };
  })()`);
  ok('T2d 全部抬手：摇杆归零、按钮无残留按下态、无卡键',
    t2d.stickActive === false && Math.abs(t2d.axisX) < 0.001 && t2d.pressed === 0, t2d);

  /* ---------- T2e 闪避按钮真实触发（不依赖目标，作为按钮链路的确定性证据） ---------- */
  const modeE = await ensurePlaying();
  /* 卡组高度会随战局变化，按钮纵向位置随之移动：每次测前重新取当前矩形 */
  const curE = await ev(`window.__touchLayer.info().buttons`);
  const dashBtn = curE['闪避'];
  const dash0 = await ev(`({ cd: state.player.dashCd, t: state.player.dashTime })`);
  await touch('touchStart', [{ x: dashBtn.x + dashBtn.w / 2, y: dashBtn.y + dashBtn.h / 2, id: 4 }]);
  await sleep(160);
  const dash1 = await ev(`({ cd: state.player.dashCd, t: state.player.dashTime, last: window.__touchLayer.info().lastKey })`);
  await touch('touchEnd', []);
  ok('T2e 闪避按钮真实触发 startDash：dashCd ' + Number(dash0.cd).toFixed(2) + ' → ' + Number(dash1.cd).toFixed(2),
    dash0.cd <= 0.01 && dash1.cd > 0 && dash1.last && dash1.last.key === 'Shift', { before: dash0, after: dash1, mode: modeE });
  await sleep(200);

  /* ---------- T2f 三指同时：摇杆 + 普攻 + 武器 ---------- */
  const modeF = await ensurePlaying();
  const curF = await ev(`(function(){ var i = window.__touchLayer.info(); return { buttons: i.buttons, stick: i.stick.rect }; })()`);
  const wepBtn = curF.buttons['武器'];
  const atkBtn = curF.buttons['普攻'];
  const fcx = curF.stick.x + curF.stick.w / 2;
  const fcy = curF.stick.y + curF.stick.h / 2;
  await touch('touchStart', [
    { x: fcx + (curF.stick.w / 2 - 24 - 2) * 0.5, y: fcy, id: 1 },
    { x: atkBtn.x + atkBtn.w / 2, y: atkBtn.y + atkBtn.h / 2, id: 2 },
    { x: wepBtn.x + wepBtn.w / 2, y: wepBtn.y + wepBtn.h / 2, id: 3 }
  ]);
  await sleep(320);
  const t2f = await ev(`(function(){
    var s = window.__touchLayer.info();
    return {
      stickActive: s.stick.active, strength: s.stick.strength,
      pressed: Array.prototype.slice.call(document.querySelectorAll('.tg-btn.is-pressed')).map(function (x) { return x.querySelector('b').textContent; }),
      keydowns: s.stats.keydowns
    };
  })()`);
  ok('T2f 三指同时：摇杆 active（' + t2f.strength + '）+ 普攻/武器均按下，互不抢焦点',
    t2f.stickActive === true && t2f.strength > 0.4
      && t2f.pressed.indexOf('普攻') >= 0 && t2f.pressed.indexOf('武器') >= 0, { mode: modeF, detail: t2f });
  await touch('touchEnd', []);
  await sleep(200);

  /* ---------- T3 横屏布局 + 横屏截图 ---------- */
  await setViewport(844, 390);
  await sleep(500);
  const t3 = await ev(`(function(){
    window.__touchLayer.refresh();
    var info = window.__touchLayer.info();
    return { info: info, innerW: window.innerWidth, innerH: window.innerHeight };
  })()`);
  const b3 = t3.info.buttons || {};
  const gap3 = b3['武器'] && b3['装置'] ? b3['武器'].x - b3['装置'].x - b3['装置'].w : -1;
  /* 横屏系统键竖排在最右，取所有按钮里最靠右的边来算右边距 */
  const allRight = Math.max.apply(null, Object.keys(b3).map((k) => b3[k].x + b3[k].w));
  const padRight = t3.innerW - allRight;
  ok('T3a 横屏尺寸：摇杆 ' + t3.info.stick.rect.w + 'px、按钮 ' + (b3['普攻'] ? b3['普攻'].w + 'x' + b3['普攻'].h : '?')
    + '、间距 ' + gap3 + 'px、右边距 ' + padRight + 'px（窄屏隐藏小地图，技能键贴右）',
    t3.innerW === 844 && t3.info.stick.rect.w >= 120 && b3['普攻'] && b3['普攻'].w >= 80
      && gap3 >= 6 && padRight >= 10 && padRight <= 24, { inner: [t3.innerW, t3.innerH], stick: t3.info.stick.rect, buttons: b3, gap3, padRight });

  /* ---------- T3g 系统键与顶部 HUD 按钮不重叠 ---------- */
  const overlapTop = await ev(`(function(){
    var sys = Array.prototype.slice.call(document.querySelectorAll('.tg-system .tg-btn'));
    var tops = ['btnRules', 'btnSkillTree'].map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var bad = [];
    sys.forEach(function (a) {
      var ra = a.getBoundingClientRect();
      tops.forEach(function (t) {
        var rb = t.getBoundingClientRect();
        if (rb.width <= 0) return;
        var ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
        var iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
        if (ix * iy > 1) bad.push({ sys: a.querySelector('b').textContent, top: t.id, area: Math.round(ix * iy) });
      });
    });
    return { bad: bad, tops: tops.length };
  })()`);
  ok('T3g 横屏避让：系统键与顶部「帮助/技能树」不重叠（检查 ' + overlapTop.tops + ' 个顶部按钮）',
    overlapTop.tops === 2 && overlapTop.bad.length === 0, overlapTop);

  /* ---------- T3c 操作区不压底部卡组 ---------- */
  const deckClear = await ev(`(function(){
    var pad = document.querySelector('.tg-pad').getBoundingClientRect();
    var deck = document.querySelector('.hud-deck');
    if (!deck) return { deck: false };
    var d = deck.getBoundingClientRect();
    var ix = Math.max(0, Math.min(pad.right, d.right) - Math.max(pad.left, d.left));
    var iy = Math.max(0, Math.min(pad.bottom, d.bottom) - Math.max(pad.top, d.top));
    return {
      deck: true, deckVisible: d.width > 0 && d.height > 0,
      padBottom: Math.round(pad.bottom), deckTop: Math.round(d.top),
      overlapArea: Math.round(ix * iy)
    };
  })()`);
  ok('T3c 布局避让：横屏操作区底边 ' + deckClear.padBottom + 'px、卡组顶边 ' + deckClear.deckTop
    + 'px，交叠面积 ' + deckClear.overlapArea + 'px²（要求 0）',
    deckClear.deck === true && deckClear.deckVisible === true && deckClear.overlapArea === 0, deckClear);

  /* ---------- T3d 旋转重排：横屏 → 竖屏 ---------- */
  await setViewport(390, 844);
  await sleep(450);
  const rot = await ev(`(function(){
    window.__touchLayer.refresh();
    var i = window.__touchLayer.info();
    return { innerW: window.innerWidth, stick: i.stick.rect, primary: i.buttons['普攻'] };
  })()`);
  ok('T3d 旋转回竖屏：视口 ' + rot.innerW + '、摇杆 ' + rot.stick.w + 'px、普攻键 '
    + (rot.primary ? rot.primary.w : '?') + 'px（按媒体查询重排）',
    rot.innerW === 390 && rot.stick.w === 126 && rot.primary && rot.primary.w === 88, rot);
  await setViewport(844, 390);
  await sleep(500);
  await ev(`window.__touchLayer.refresh(); true`);

  const pngLandscape = await shot('touch-landscape.png');

  /* ---------- T3b 悬停改长按：真实天赋卡 ---------- */
  const lp = await ev(`(function(){
    if (typeof openTalentsPage === 'function') openTalentsPage();
    var layer = document.getElementById('talentLayer');
    if (!layer) return { ok: false, reason: 'no-layer' };
    var cards = Array.prototype.slice.call(layer.querySelectorAll('.tal-card'));
    var card = null;
    for (var i = 0; i < cards.length; i += 1) {
      var r = cards[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
        && r.right <= window.innerWidth && r.bottom <= window.innerHeight) { card = cards[i]; break; }
    }
    if (!card && cards.length) card = cards[0];
    if (!card) return { ok: false, reason: 'no-card', count: cards.length };
    var tip = card.querySelector('.tal-tip');
    var rect = card.getBoundingClientRect();
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, hasTip: !!tip, count: cards.length };
  })()`);
  if (lp.ok) {
    await touch('touchStart', [{ x: lp.x, y: lp.y, id: 3 }]);
    await sleep(520);
    const lp2 = await ev(`(function(){
      var c = document.querySelector('#talentLayer .tal-card.tg-tip-on');
      var tip = c ? c.querySelector('.tal-tip') : null;
      return { on: !!c, text: tip ? String(tip.textContent || '').trim().slice(0, 28) : '', longPress: window.__touchLayer.info().stats.longPress };
    })()`);
    ok('T3b 悬停改长按：天赋卡按住 520ms 显示 .tal-tip（文字：' + lp2.text + '）',
      lp2.on === true && lp2.longPress >= 1, lp2);
    await touch('touchEnd', []);
    await sleep(180);

    /* ---------- T3e 长按后补发的 click 被吞 ---------- */
    const swallow = await ev(`(function(){
      var s = window.__touchLayer.info().stats;
      var c = document.querySelector('#talentLayer .tal-card.tg-tip-on');
      return { swallowed: s.clickSwallowed, on: !!c, layer: !!document.getElementById('talentLayer') };
    })()`);
    ok('T3e 长按后补发的 click 被吞：clickSwallowed=' + swallow.swallowed + '、天赋页未误选关闭',
      swallow.swallowed >= 1 && swallow.on === true && swallow.layer === true, swallow);

    /* ---------- T3f 点空白收起说明 ---------- */
    const blankPt = await ev(`(function(){
      var w = window.innerWidth, h = window.innerHeight;
      var pts = [[6, Math.round(h * 0.5)], [Math.round(w * 0.5), 8], [w - 6, Math.round(h * 0.5)]];
      for (var i = 0; i < pts.length; i += 1) {
        var el = document.elementFromPoint(pts[i][0], pts[i][1]);
        if (el && !el.closest('.tal-card')) return { x: pts[i][0], y: pts[i][1], hit: String(el.className || el.tagName) };
      }
      return { x: -1, y: -1 };
    })()`);
    if (blankPt.x >= 0) {
      await touch('touchStart', [{ x: blankPt.x, y: blankPt.y, id: 5 }]);
      await sleep(120);
      await touch('touchEnd', []);
      await sleep(220);
      const stillOn = await ev(`!!document.querySelector('#talentLayer .tal-card.tg-tip-on')`);
      ok('T3f 点空白：长按说明立即收起（空白点 ' + blankPt.x + ',' + blankPt.y + '）',
        stillOn === false, { blankPt, stillOn });
    } else {
      ok('T3f 点空白：找不到安全空白点，测试跳过', false, blankPt);
    }

    await ev(`(function(){
      if (typeof closeTalentsPage === 'function') closeTalentsPage();
      window.__touchLayer.reset();
      return true;
    })()`);
    await sleep(200);
  } else {
    ok('T3b 悬停改长按：未找到天赋卡，测试跳过', false, lp);
  }

  /* ---------- T4a 手势与视口安全 ---------- */
  const sec = await ev(`(function(){
    var c = document.getElementById('game');
    var root = getComputedStyle(document.documentElement);
    var layer = document.querySelector('.tg-layer');
    var style = document.getElementById('tg-touch-style');
    return {
      touchAction: c ? getComputedStyle(c).touchAction : null,
      overscroll: root.overscrollBehavior,
      calloutRule: style ? style.textContent.indexOf('-webkit-touch-callout: none') >= 0 : false,
      layerSelect: layer ? getComputedStyle(layer).userSelect : null,
      scrollY: window.scrollY,
      viewport: (document.querySelector('meta[name=viewport]') || {}).content || ''
    };
  })()`);
  ok('T4a 手势安全：canvas touch-action=none、页面 overscroll=none、禁长按菜单、viewport 禁缩放',
    sec.touchAction === 'none' && String(sec.overscroll).indexOf('none') >= 0
      && sec.calloutRule === true && sec.layerSelect === 'none'
      && sec.viewport.indexOf('user-scalable=no') >= 0 && sec.scrollY === 0, sec);

  /* ---------- T4b 地图双指捏合 ---------- */
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true })); true`);
  await sleep(500);
  const mapr = await ev(`(function(){
    var m = document.getElementById('mapCanvas');
    if (!m) return null;
    var r = m.getBoundingClientRect();
    return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  if (mapr && mapr.w > 0 && mapr.h > 0) {
    const mx = mapr.l + mapr.w / 2;
    const my = mapr.t + mapr.h / 2;
    await touch('touchStart', [{ x: mx - 40, y: my, id: 6 }, { x: mx + 40, y: my, id: 7 }]);
    await sleep(120);
    await touch('touchMove', [{ x: mx - 120, y: my, id: 6 }, { x: mx + 120, y: my, id: 7 }]);
    await sleep(220);
    const pinch = await ev(`window.__touchLayer.info().stats.pinches`);
    ok('T4b 地图双指捏合：pinch 计数 ' + pinch + '（要求 ≥1，已翻译成主文件 wheel 缩放）',
      pinch >= 1, { pinch, map: mapr });
    await touch('touchEnd', []);
  } else {
    ok('T4b 地图双指捏合：地图画布不可见，测试跳过', false, mapr);
  }
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); true`);
  await sleep(350);

  /* ---------- T4c / T4d 重开按钮长按确认 ---------- */
  const modeR = await ensurePlaying();
  await ev(`window.__rLog = []; window.addEventListener('keydown', function (e) { if (String(e.key).toLowerCase() === 'r') window.__rLog.push(1); }); true`);
  const rb = b3['重开'] || b['重开'];
  await touch('touchStart', [{ x: rb.x + rb.w / 2, y: rb.y + rb.h / 2, id: 8 }]);
  await sleep(300);
  await touch('touchEnd', []);
  await sleep(200);
  const shortR = await ev(`({ r: window.__rLog.length, skipped: window.__touchLayer.info().stats.restartSkipped, fired: window.__touchLayer.info().stats.restartFired })`);
  ok('T4c 重开防误触：短按 300ms 不发 R（skipped=' + shortR.skipped + '、fired=' + shortR.fired + '）',
    shortR.r === 0 && shortR.skipped >= 1 && shortR.fired === 0, { mode: modeR, detail: shortR });

  await touch('touchStart', [{ x: rb.x + rb.w / 2, y: rb.y + rb.h / 2, id: 9 }]);
  await sleep(950);
  await touch('touchEnd', []);
  await sleep(240);
  const longR = await ev(`({ r: window.__rLog.length, fired: window.__touchLayer.info().stats.restartFired })`);
  ok('T4d 重开长按 0.95s：真正派发 R（fired=' + longR.fired + '、事件 ' + longR.r + ' 次）',
    longR.r >= 1 && longR.fired >= 1, longR);

  /* ---------- T7 键帽与短提示：触屏态无 F / K / Shift ---------- */
  await setViewport(390, 844);
  await sleep(420);
  const modeCopy = await ensurePlaying();
  /* 等重启后的过场横幅淡出，避免截图时横幅压在教学卡上 */
  await sleep(1100);
  await ev(`window.__touchLayer.refresh(); true`);

  const copyA = await ev(`(function(){
    var bad = [];
    var visible = 0;
    Array.prototype.forEach.call(document.querySelectorAll('kbd'), function (k) {
      /* 触屏态会把按钮里的装饰键帽隐藏（display:none），隐藏的不算"露馅" */
      if (k.style.display === 'none') return;
      visible += 1;
      var t = String(k.textContent || '').trim();
      if (/[A-Za-z]/.test(t)) {
        var layer = k.closest('[id]');
        bad.push(t + '@' + (layer ? layer.id : '?') + (k.closest('button,.btn') ? '/btn' : ''));
      }
    });
    var chips = Array.prototype.map.call(document.querySelectorAll('.skill-chip > span'), function (s) {
      return String(s.textContent || '').trim();
    });
    var hints = Array.prototype.map.call(document.querySelectorAll('.tg-btn > i'), function (i) {
      return String(i.textContent || '').trim();
    });
    var deckEl = document.querySelector('.deck-keys:not(#padLegend)');
    var deck = deckEl ? String(deckEl.textContent || '') : '';
    deck = deck.replace(/\\s+/g, ' ').trim();
    return {
      kbdTotal: document.querySelectorAll('kbd').length,
      kbdVisible: visible,
      badKbd: bad.slice(0, 8), badKbdCount: bad.length,
      deck: deck, chips: chips, hints: hints,
      intro: String((document.getElementById('introHintText') || {}).textContent || '').trim(),
      keycaps: window.__touchKeycaps ? {
        capable: window.__touchKeycaps.capable, sawTouch: window.__touchKeycaps.sawTouch,
        active: window.__touchKeycaps.active, hits: window.__touchKeycaps.hits
      } : null
    };
  })()`);

  const LATIN = /[A-Za-z]/;
  ok('T7a 键帽（kbd）无拉丁键名：共 ' + copyA.kbdTotal + ' 个、残留 ' + copyA.badKbdCount + ' 个'
    + '（capable=' + (copyA.keycaps ? copyA.keycaps.capable : '?')
    + '、sawTouch=' + (copyA.keycaps ? copyA.keycaps.sawTouch : '?') + '）',
    copyA.keycaps && copyA.keycaps.active === true && copyA.kbdVisible >= 5 && copyA.badKbdCount === 0, copyA);

  ok('T7b 卡组与技能条无键位字母：[' + copyA.deck + '] / ' + copyA.chips.join('、'),
    !LATIN.test(copyA.deck) && copyA.deck.indexOf('摇杆') >= 0 && copyA.deck.indexOf('普攻') >= 0
      && copyA.chips.length === 3 && copyA.chips.indexOf('主技能') >= 0
      && copyA.chips.indexOf('装置') >= 0 && copyA.chips.indexOf('武器') >= 0, copyA);

  ok('T7c 触屏按钮副标题全中文：' + copyA.hints.join(' / '),
    copyA.hints.length >= 10 && copyA.hints.every(function (t) { return !LATIN.test(t); })
      && copyA.hints.indexOf('按住连发') >= 0 && copyA.hints.indexOf('冲刺') >= 0, copyA.hints);

  ok('T7d 顶部首次提示改口语：' + copyA.intro,
    copyA.intro.indexOf('按 M') < 0 && copyA.intro.indexOf('按 T') < 0
      && copyA.intro.indexOf('点地图键') >= 0, copyA.intro);

  /* ---------- T8 首局教学文案：触屏分支 ---------- */
  const copyB = await ev(`(function(){
    var steps = (typeof ONBOARD_STEPS !== 'undefined') ? ONBOARD_STEPS : [];
    var chars = steps.map(function (s) { return Array.from(s.hint).length; });
    var hasKey = steps.some(function (s) { return /WASD|左键|按 F|Shift|按 E/.test(s.hint); });
    return {
      hints: steps.map(function (s) { return s.hint; }),
      chars: chars, maxChars: chars.length ? Math.max.apply(null, chars) : -1,
      hasKey: hasKey,
      tr1: window.__touchCopy ? window.__touchCopy.translate('WASD 移动') : null,
      tr2: window.__touchCopy ? window.__touchCopy.translate('按 E 下楼') : null,
      active: window.__touchCopy ? window.__touchCopy.active : false,
      sawTouch: window.__touchCopy ? window.__touchCopy.sawTouch : false
    };
  })()`);
  ok('T8a ONBOARD_STEPS 五条 ≤ 12 字且无键位词：字数 ' + copyB.chars.join('/'),
    copyB.hints.length === 5 && copyB.maxChars <= 12 && copyB.hasKey === false
      && copyB.active === true, copyB);

  ok('T8b translate() 把键位换成人话：' + copyB.tr1 + ' / ' + copyB.tr2,
    copyB.tr1 === '摇杆移动' && copyB.tr2 === '点交互键下楼', copyB);

  /* 展示首局教学卡：临时清空已读记录，让 onboardShowHint 重新弹出；同时把首局三步提示拉回第 1 条 */
  const obShow = await ev(`(function(){
    if (typeof loadOnboardSeen !== 'function' || typeof saveOnboardSeen !== 'function'
        || typeof onboardShowHint !== 'function') return { ok: false, reason: 'missing-api' };
    var bak = loadOnboardSeen() || {};
    saveOnboardSeen({});
    var shown = onboardShowHint('moveAttack');
    saveOnboardSeen(bak);
    var card = document.getElementById('onboardHint');
    var cardText = card ? String(card.textContent || '').trim() : '';
    if (typeof state !== 'undefined' && state && state.meta) { state.meta.hintsSeen = 0; state.elapsed = 2; }
    if (typeof updateContextHints === 'function') updateContextHints();
    window.__touchLayer.refresh();
    var hint = document.getElementById('contextHint');
    var hintText = hint && hint.querySelector('b')
      ? String(hint.querySelector('b').textContent || '').trim() : '';
    return { ok: true, shown: !!shown, cardText: cardText, hintText: hintText };
  })()`);
  /* 提示文本先落一帧，再让触屏层按"系统键行"重算上移量，最后截图 */
  await sleep(260);
  await ev(`window.__touchLayer.refresh(); true`);
  await sleep(300);
  const pngCopy = await shot('touch-copy.png');

  ok('T8c 首局教学卡与情境提示均为触屏版：[' + obShow.cardText + '] / [' + obShow.hintText + ']',
    obShow.ok === true && obShow.shown === true
      && obShow.cardText.indexOf('WASD') < 0 && obShow.cardText.indexOf('摇杆') >= 0
      && obShow.cardText.indexOf('攻击键') >= 0
      && obShow.hintText.indexOf('WASD') < 0 && obShow.hintText.indexOf('摇杆') >= 0
      && pngCopy > 100 * 1024,
    { mode: modeCopy, detail: obShow, pngCopy: pngCopy });

  const errs = await ev(`(window.__errors || []).slice(0, 8)`);
  ok('T5 全程无 JS 报错、四张截图已落盘（竖屏 / 横屏 / 按下态 / 触屏文案）',
    errs.length === 0 && pngPortrait > 100 * 1024 && pngLandscape > 100 * 1024
      && pngPressed > 100 * 1024 && pngCopy > 100 * 1024,
    { errors: errs, pngPortrait, pngLandscape, pngPressed, pngCopy });

  /* ---------- T6 ?touch=off 关闭 ---------- */
  await send('Page.navigate', { url: encodeURI('file:///' + FILE.replace(/\\/g, '/')) + '?touch=off' });
  await sleep(1600);
  const off = await ev(`({
    enabled: !!(window.__touchLayer && window.__touchLayer.enabled),
    reason: window.__touchLayer ? window.__touchLayer.reason : '',
    layers: document.querySelectorAll('.tg-layer').length,
    styles: !!document.getElementById('tg-touch-style'),
    bodyClass: document.body.classList.contains('tg-touch')
  })`);
  ok('T6 ?touch=off：整层不启动、无 DOM / 无样式 / 不改 body',
    off.enabled === false && off.layers === 0 && off.styles === false && off.bodyClass === false, off);

  /* ---------- T9 键鼠态一个像素都不改：?touch=off 下文案保持原文 ---------- */
  const offCopy = await ev(`(function(){
    var deck = document.querySelector('.deck-keys:not(#padLegend)');
    var kbds = deck ? Array.prototype.map.call(deck.querySelectorAll('kbd'), function (k) {
      return String(k.textContent || '').trim();
    }) : [];
    var steps = (typeof ONBOARD_STEPS !== 'undefined') ? ONBOARD_STEPS : [];
    return {
      deckKbds: kbds,
      deckText: deck ? String(deck.textContent || '').replace(/\\s+/g, ' ').trim() : '',
      intro: String((document.getElementById('introHintText') || {}).textContent || '').trim(),
      step0: steps[0] ? steps[0].hint : '',
      keycapsActive: window.__touchKeycaps ? window.__touchKeycaps.active : null,
      copyActive: window.__touchCopy ? window.__touchCopy.active : null
    };
  })()`);
  ok('T9a ?touch=off 卡组仍是原键帽：' + offCopy.deckKbds.join('/') + '、提示：' + offCopy.intro,
    offCopy.deckKbds.indexOf('J') >= 0 && offCopy.deckKbds.indexOf('F') >= 0
      && offCopy.deckText.indexOf('主技能') >= 0 && offCopy.intro.indexOf('按 M') >= 0, offCopy);

  ok('T9b ?touch=off 教学数据保持原文：' + offCopy.step0,
    offCopy.step0 === 'WASD 移动，左键开火'
      && (offCopy.keycapsActive === false || offCopy.keycapsActive === null)
      && (offCopy.copyActive === false || offCopy.copyActive === null), offCopy);

  fs.writeFileSync(path.join(OUT_DIR, 'touch-result.json'), JSON.stringify({
    time: new Date().toISOString(),
    url: URL,
    asserts,
    pass: asserts.filter((a) => a.pass).length,
    total: asserts.length,
    sizes: {
      portrait: b,
      landscape: b3
    }
  }, null, 2));

  const passed = asserts.filter((a) => a.pass).length;
  console.log('\nRESULT: ' + (passed === asserts.length ? 'PASS' : 'FAIL') + ' ' + passed + '/' + asserts.length);
  killEdge(edge);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  /* 任何阶段失败都要收掉浏览器，避免 profile 被锁、下次无法启动 */
  killEdge(edgeProc);
  process.exit(1);
});
