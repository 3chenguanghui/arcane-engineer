// 第 8 轮 · 组 1 断言：标题页重做（before/after + 主按钮唯一焦点 + 动效可关 + 0 外部资源 + 进第 1 层）
// 用法：node tools\arcane_title_assert.js *> tools\title_assert.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9681;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const BEFORE = path.join(__dirname, '..', 'index_arcane_v2.bak_pre8_title.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'title');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把本地路径转成 file:// URL */
function fileUrl(p) { return 'file:///' + p.replace(/\\/g, '/'); }

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1536,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) throw new Error('Edge CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + m.params.exceptionDetails.text);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const setView = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });

  const checks = [];
  /** 记录一条断言结果 */
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    // 用框架约定的 "PASS  name  detail" 两空格格式，才能被断言分类器识别
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + JSON.stringify(detail));
  };

  // ---------- 0) before 截图：旧标题页（标题页重做前的备份） ----------
  await setView(1536, 900);
  await send('Page.navigate', { url: fileUrl(BEFORE) });
  await sleep(1500);
  await shot('title-before-1536x900.png');

  // ---------- 1) 载入新版 ----------
  await send('Page.navigate', { url: fileUrl(MAIN) });
  await sleep(1600);
  await ev(`try { localStorage.setItem('arcane.titleMotion', '1'); } catch (e) {} ; true`);
  await send('Page.reload');
  await sleep(1500);

  // 外部资源：标题页应当 0 个
  const res = await ev(`(function(){
    var list = performance.getEntriesByType('resource');
    var ext = Array.prototype.slice.call(document.querySelectorAll('[src],[href]')).filter(function(el){
      var u = el.getAttribute('src') || el.getAttribute('href') || '';
      return u.indexOf('http') === 0 || u.indexOf('//') === 0;
    });
    return { resources: list.length, externalTags: ext.length, urls: list.map(function(r){ return r.name; }) };
  })()`);
  check('0 外部资源请求', res.resources === 0 && res.externalTags === 0, res);

  // ---------- 2) 多视口：主按钮完整可见且唯一最大 ----------
  const GEOM = `(function(){
    var start = document.getElementById('btnStart');
    if (!start) return { missing: true };
    var sr = start.getBoundingClientRect();
    var vis = Array.prototype.slice.call(document.querySelectorAll('#titleLayer button')).filter(function(b){
      return b.offsetParent !== null && !b.classList.contains('hidden') && b.getBoundingClientRect().width > 0;
    });
    var list = vis.map(function(b){ var r = b.getBoundingClientRect(); return { id: b.id || b.className, area: Math.round(r.width * r.height) }; });
    var maxArea = 0;
    list.forEach(function(o){ if (o.area > maxArea) maxArea = o.area; });
    var maxCount = list.filter(function(o){ return o.area === maxArea; }).length;
    var inView = sr.top >= 0 && sr.left >= 0 && sr.bottom <= window.innerHeight + 0.5 && sr.right <= window.innerWidth + 0.5;
    return {
      inView: inView,
      maxCount: maxCount,
      isMax: Math.round(sr.width * sr.height) === maxArea,
      w: window.innerWidth, h: window.innerHeight,
      box: { w: Math.round(sr.width), h: Math.round(sr.height), top: Math.round(sr.top), bottom: Math.round(sr.bottom) },
      list: list
    };
  })()`;

  const VIEWS = [
    { name: '1536x900', w: 1536, h: 900 },
    { name: '1366x900', w: 1366, h: 900 },
    { name: '420x800', w: 420, h: 800 }
  ];
  for (const v of VIEWS) {
    await setView(v.w, v.h);
    await sleep(450);
    const g = await ev(GEOM);
    check('主按钮完整可见 @' + v.name, g && g.inView, g);
    check('主按钮唯一最大 @' + v.name, g && g.isMax && g.maxCount === 1, g);
    await shot('title-after-' + v.name + '.png');
  }

  // ---------- 3) 两层景深：后景 + 徽记都真的画了东西 ----------
  await setView(1536, 900);
  await sleep(450);
  const depth = await ev(`(function(){
    function nonZero(c){
      try {
        var g = c.getContext('2d');
        var d = g.getImageData(0, 0, c.width, c.height).data;
        var n = 0;
        for (var i = 3; i < d.length; i += 160) { if (d[i] > 6) n += 1; }
        return n;
      } catch (e) { return -1; }
    }
    var bg = document.getElementById('titleBg');
    var em = document.getElementById('titleEmblem');
    return { bg: nonZero(bg), emblem: nonZero(em), bgW: bg.width, bgH: bg.height, emW: em.width, running: titleBgRuntime.running, frames: titleBgRuntime.frames, emFrames: titleEmblemRuntime.frames };
  })()`);
  check('后景画布非空', depth && depth.bg > 200, depth);
  check('徽记画布非空', depth && depth.emblem > 20, depth);
  check('动效默认开启且有帧', depth && depth.running === true && depth.frames > 20, depth);

  // ---------- 4) 动效可关闭：停 rAF、停帧、但保留静帧 ----------
  await ev(`setTitleMotion(false); applyTitleChrome(); true`);
  await sleep(120);
  const a1 = await ev(`(function(){
    function nonZero(c){ try { var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; var n = 0; for (var i = 3; i < d.length; i += 160) { if (d[i] > 6) n += 1; } return n; } catch (e) { return -1; } }
    return { running: titleBgRuntime.running, motion: titleMotionEnabled(), frames: titleBgRuntime.frames, emFrames: titleEmblemRuntime.frames, emblem: nonZero(document.getElementById('titleEmblem')), bg: nonZero(document.getElementById('titleBg')), btn: document.getElementById('btnTitleMotion').getAttribute('aria-pressed'), label: document.getElementById('btnTitleMotion').textContent };
  })()`);
  await sleep(400);
  const a2 = await ev(`({ running: titleBgRuntime.running, frames: titleBgRuntime.frames, emFrames: titleEmblemRuntime.frames })`);
  check('关闭后 rAF 停止', a1.running === false && a2.running === false, { a1, a2 });
  check('关闭后帧数不再增长', a2.frames === a1.frames && a2.emFrames === a1.emFrames, { a1, a2 });
  check('关闭后保留静帧（后景 + 徽记非空）', a1.bg > 200 && a1.emblem > 20, a1);
  check('关闭后按钮文案/aria 同步', a1.btn === 'false' && /关/.test(a1.label), a1);
  await shot('title-after-motion-off.png');

  // 恢复默认，避免污染后续用例
  await ev(`setTitleMotion(true); applyTitleChrome(); true`);
  await sleep(350);
  const a3 = await ev(`({ running: titleBgRuntime.running, motion: titleMotionEnabled() })`);
  check('重新开启后恢复动画', a3.running === true && a3.motion === true, a3);

  // ---------- 5) 点主按钮能进第 1 层 ----------
  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(1100);
  const started = await ev(`({ mode: state && state.mode, floor: state && state.floor, status: state && state.status, titleHidden: document.getElementById('titleLayer').classList.contains('hidden') })`);
  check('点主按钮进入第 1 层', started && started.mode === 'playing' && started.floor === 1, started);
  check('进入后标题层隐藏', started && started.titleHidden === true, started);

  // ---------- 汇总 ----------
  const pass = checks.filter((c) => c.ok).length;
  console.log('TITLE ASSERT: ' + pass + '/' + checks.length + ' PASS');
  checks.forEach((c) => { if (!c.ok) console.log('  - FAIL: ' + c.name + ' => ' + JSON.stringify(c.detail)); });
  console.log('exceptions=' + errors.length + (errors.length ? ' ' + errors.join(' | ') : ''));
  if (errors.length) process.exitCode = 1;
  if (pass !== checks.length) process.exitCode = 1;
  try { ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  await sleep(300);
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
