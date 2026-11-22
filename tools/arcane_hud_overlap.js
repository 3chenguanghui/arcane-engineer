/**
 * 七 · 快捷键复核 + 六 · 融合对照探针
 * ------------------------------------------------------------
 * 用法：node tools/arcane_hud_overlap.js [tag]
 * 端口：9545
 *
 * 做三件事：
 *  1) 三个视口（1280×720 / 1440×900 / 500×683@1.5）真实开局后，量所有常驻 HUD 元素
 *     的 getBoundingClientRect，两两求相交面积；父子包含关系单独标记，不算遮挡。
 *  2) 单独给出「焚稿药丸 ∩ 技能树键（顶栏 / 右下 dock）」的相交面积。
 *  3) 在 1280 视口分别对 baseline 与当前文件截一张「融合三处同屏」对照图
 *     （Q 浮层打开，背景同时有地面出口光点 + 右下小地图徽标）。
 *
 * 输出：.screenshots/art/d7-hud-<tag>.json 与 d7-*.png
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9545;
const ROOT = path.join(__dirname, '..');
/* 第 3 个参数可指定被测文件（用于同一套量测跑 baseline 对照） */
const FILE = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'index_arcane_v2.html');
const BASE = path.join(ROOT, 'baseline', 'index_arcane_v2_2026-11-11_2FB0697F.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const TAG = process.argv[2] || 'run';

/* 验收视口 */
const VIEWPORTS = [
  { name: '1280x720@1', width: 1280, height: 720, dpr: 1, mobile: false },
  { name: '1440x900@1', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: '750x1024@1', width: 750, height: 1024, dpr: 1, mobile: false },
  { name: '500x683@1.5', width: 500, height: 683, dpr: 1.5, mobile: true }
];

/* 参与两两相交统计的常驻 HUD 元素 */
const SELECTORS = [
  '.hud-top', '.floor-panel', '.minimap-panel', '.minimap-legend',
  '#btnMapDock', '#btnSkillDock', '#btnSkillTree', '#ashBurnBtn',
  '#toast', '#routeHint', '.deck-keys', '#introHint'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 页面内执行的量测脚本（字符串形式，经 Runtime.evaluate 注入）
 * @returns {string} 立即执行函数源码
 */
function measureSource() {
  return `(function(){
    var SELECTORS = ${JSON.stringify(SELECTORS)};
    function visible(el){
      if (!el) return false;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity || '1') < 0.05) return false;
      var r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }
    function box(el){
      var r = el.getBoundingClientRect();
      return { x: Math.round(r.left*10)/10, y: Math.round(r.top*10)/10,
               w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10,
               right: Math.round(r.right*10)/10, bottom: Math.round(r.bottom*10)/10 };
    }
    function area(a,b){
      var w = Math.min(a.right,b.right) - Math.max(a.x,b.x);
      var h = Math.min(a.bottom,b.bottom) - Math.max(a.y,b.y);
      return (w > 0 && h > 0) ? Math.round(w*h*10)/10 : 0;
    }
    /* 焚稿药丸平时 display:none（未解锁/未持有），量遮挡时必须强制显示，
       否则这一对永远是"不可见=不重叠"，等于漏测。 */
    var ashBtn = document.querySelector('#ashBurnBtn');
    if (ashBtn) ashBtn.style.display = 'flex';
    var nodes = [];
    SELECTORS.forEach(function(sel){
      var el = document.querySelector(sel);
      if (!el) { nodes.push({ sel: sel, absent: true }); return; }
      nodes.push({ sel: sel, el: el, visible: visible(el), box: visible(el) ? box(el) : null });
    });
    var pairs = [];
    var violations = [];
    for (var i = 0; i < nodes.length; i += 1) {
      for (var j = i + 1; j < nodes.length; j += 1) {
        var A = nodes[i], B = nodes[j];
        if (!A.visible || !B.visible) continue;
        var inter = area(A.box, B.box);
        if (inter <= 0) continue;
        var related = A.el.contains(B.el) || B.el.contains(A.el);
        pairs.push({ a: A.sel, b: B.sel, area: inter, related: related });
        if (!related) violations.push({ a: A.sel, b: B.sel, area: inter });
      }
    }
    function pairArea(sa, sb){
      var a = document.querySelector(sa), b = document.querySelector(sb);
      if (!a || !b || !visible(a) || !visible(b)) return null;
      return area(box(a), box(b));
    }
    var res = {
      innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio,
      mode: (typeof state !== 'undefined' && state) ? state.mode : 'no-state',
      floor: (typeof state !== 'undefined' && state) ? state.floor : null,
      nodes: nodes.map(function(n){ return { sel: n.sel, absent: !!n.absent, visible: !!n.visible, box: n.box || null }; }),
      pairs: pairs,
      violations: violations,
      special: {
        ash_vs_btnSkillTree: pairArea('#ashBurnBtn', '#btnSkillTree'),
        ash_vs_btnSkillDock: pairArea('#ashBurnBtn', '#btnSkillDock'),
        toast_vs_routeHint: pairArea('#toast', '#routeHint')
      }
    };
    /* Q 浮层：打开后量卡片互相之间、以及卡片是否越出视口 */
    if (typeof openRoomPicker === 'function') {
      openRoomPicker();
      var panel = document.querySelector('#roomPicker');
      var cards = panel ? Array.prototype.slice.call(panel.querySelectorAll('#roomPickerList button')) : [];
      res.picker = {
        open: !!panel && getComputedStyle(panel).display !== 'none',
        panel: (panel && getComputedStyle(panel).display !== 'none') ? box(panel) : null,
        cards: cards.map(function(c){
          var b = box(c);
          return { text: (c.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 40),
                   border: getComputedStyle(c).borderTopColor, box: b,
                   inViewport: b.x >= 0 && b.y >= 0 && b.right <= window.innerWidth + 1 && b.bottom <= window.innerHeight + 1 };
        })
      };
      var cardOverlap = [];
      for (var m = 0; m < cards.length; m += 1) {
        for (var n = m + 1; n < cards.length; n += 1) {
          var ia = area(box(cards[m]), box(cards[n]));
          if (ia > 0) cardOverlap.push({ a: m, b: n, area: ia });
        }
      }
      res.picker.cardOverlaps = cardOverlap;
      if (typeof closeRoomPicker === 'function') closeRoomPicker();
    }
    return res;
  })()`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1280,900', 'about:blank'
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
    return fs.statSync(path.join(OUT_DIR, name)).size;
  };

  await send('Runtime.enable');
  await send('Page.enable');

  /**
   * 在指定视口加载指定文件并进入真实开局
   * @param {Object} vp 视口配置
   * @param {string} file 目标 html 绝对路径
   * @returns {Promise<void>}
   */
  async function loadAndStart(vp, file) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile
    });
    await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
    for (let i = 0; i < 60; i += 1) {
      if (await ev(`typeof startGame === 'function'`)) break;
      await sleep(250);
    }
    await ev(`(function(){
      if (state.mode === 'title') {
        startGame();
        if (state.mode === 'title' && typeof chooseCharacter === 'function' && CHARACTER_CONFIG) {
          chooseCharacter(CHARACTER_CONFIG.ids[0]);
        }
      }
      return state.mode;
    })()`);
    for (let i = 0; i < 60; i += 1) {
      if ((await ev(`state.mode`)) === 'playing') break;
      await sleep(200);
    }
    await sleep(2600);
  }

  const results = [];
  for (const vp of VIEWPORTS) {
    await loadAndStart(vp, FILE);
    const measure = await ev(measureSource());
    measure.viewport = vp.name;
    const file = 'd7-hud-' + vp.name.replace(/[^\w@]/g, '') + '-' + TAG + '.png';
    measure.screenshot = file;
    measure.screenshotBytes = await shot(file);
    results.push(measure);
    console.log('VP', vp.name,
      'violations', JSON.stringify(measure.violations),
      'special', JSON.stringify(measure.special),
      'pickerCards', measure.picker ? measure.picker.cards.length : 'n/a',
      'cardOverlaps', measure.picker ? JSON.stringify(measure.picker.cardOverlaps) : 'n/a');
  }

  /* 1280 融合对照：baseline vs 当前，Q 浮层打开 */
  const vp1280 = VIEWPORTS[0];
  const shots = {};
  if (fs.existsSync(BASE) && path.resolve(FILE) !== path.resolve(BASE)) {
    await loadAndStart(vp1280, BASE);
    await ev(`(typeof openRoomPicker === 'function' ? openRoomPicker() : false)`);
    await sleep(450);
    shots.beforeBytes = await shot('d7-fusion-before-1280.png');
  }
  await loadAndStart(vp1280, FILE);
  await ev(`(typeof openRoomPicker === 'function' ? openRoomPicker() : false)`);
  await sleep(450);
  shots.afterBytes = await shot('d7-fusion-after-1280.png');

  const outFile = path.join(OUT_DIR, 'd7-hud-' + TAG + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ tag: TAG, results, shots }, null, 2));
  console.log('OUT', outFile, 'shots', JSON.stringify(shots));
  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
