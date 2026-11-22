/**
 * 移动端版面/触控探针（只读工作副本，不改主文件）
 * ------------------------------------------------------------
 * 目的：在 4 个真实手机视口（竖屏 375×667 / 390×844，横屏 667×375 / 844×390）上量取：
 *   · 顶栏越界与三块状态条（生命/奥能/体力）互相压盖
 *   · 可点目标 <44×44 的数量
 *   · 字号分布（<12px 的可读文本条数）
 *   · UI 占屏比例与战斗可视区高度
 *   · 摇杆/技能键是否存在（可见且矩形 >0）
 *   · 竖屏「请横屏」提示是否可见
 * 用法：node mobile/tools/mprobe.js [--html <路径>] [--tag <标签>] [--force]
 * 产物：mobile/shots/<tag>_<W>x<H>.jpg（JPEG q85）与 mobile/shots/<tag>.json
 * 纪律：一次只开一个 Edge 实例；只读；不写主文件。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9561;
const SNAP = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const OUT_DIR = path.join(MOBILE_DIR, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 四档视口：竖屏两档用于验证「请横屏」，横屏两档用于验证可玩版面 */
const VIEWPORTS = [
  { id: '375x667', w: 375, h: 667, dpr: 3, mobile: true, orientation: 'portrait' },
  { id: '390x844', w: 390, h: 844, dpr: 3, mobile: true, orientation: 'portrait' },
  { id: '667x375', w: 667, h: 375, dpr: 3, mobile: true, orientation: 'landscape' },
  { id: '844x390', w: 844, h: 390, dpr: 3, mobile: true, orientation: 'landscape' }
];

/**
 * 页面内测量函数（注入字符串执行，返回纯 JSON）
 * 全部为 CSS 像素；四舍五入到 0.1，避免把 0.4px 误差当成越界。
 */
const MEASURE_JS = `(function () {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  function rct(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10,
             w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
             right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10 };
  }
  function isVisible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1.5 || r.height < 1.5) return false;
    if (r.right <= 1 || r.bottom <= 1 || r.left >= vw - 1 || r.top >= vh - 1) return false;
    return true;
  }
  function label(el) {
    if (!el) return 'null';
    if (el.id) return '#' + el.id;
    const cls = (typeof el.className === 'string') ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  }
  function rec(el) {
    const r = rct(el);
    return { name: label(el), x: r.x, y: r.y, w: r.w, h: r.h, right: r.right, bottom: r.bottom,
             visible: isVisible(el), fontSize: getComputedStyle(el).fontSize,
             text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 24) };
  }

  /* ---------- 关键块 ---------- */
  const groups = {
    top: 'header.hud-top', brand: '.brand', readouts: '.hud-readouts',
    actions: '.hud-actions', deck: '.hud-deck', deckRow: '#magicRow',
    floor: '.floor-panel', minimap: '.minimap-panel',
    dockMap: '#btnMapDock', dockSkill: '#btnSkillDock',
    introHint: '#introHint', onboard: '#onboardHint', toast: '#toast',
    spirit: '#spiritLine', ash: '#ashBurnBtn', rotate: '#rotateHint'
  };
  const blocks = {};
  Object.keys(groups).forEach(function (k) {
    const el = document.querySelector(groups[k]);
    blocks[k] = el ? rec(el) : null;
  });
  const bars = Array.prototype.slice.call(document.querySelectorAll('.hud-readouts .bar-group')).map(rec);
  const topBtns = Array.prototype.slice.call(document.querySelectorAll('.hud-actions .btn')).map(rec);

  /* ---------- 压盖（父子弹开，按 a/b 交集面积排序） ---------- */
  const pairs = [['readouts', 'actions'], ['readouts', 'brand'], ['brand', 'actions']];
  const overlaps = [];
  function rectOf(key) { return blocks[key]; }
  pairs.forEach(function (p) {
    const A = rectOf(p[0]), B = rectOf(p[1]);
    if (!A || !B || !A.visible || !B.visible) return;
    const ox = Math.min(A.right, B.right) - Math.max(A.x, B.x);
    const oy = Math.min(A.bottom, B.bottom) - Math.max(A.y, B.y);
    if (ox > 1 && oy > 1) overlaps.push({ a: p[0], b: p[1], w: Math.round(ox), h: Math.round(oy), area: Math.round(ox * oy) });
  });
  /* 三块状态条两两压盖 */
  for (let i = 0; i < bars.length; i += 1) {
    for (let j = i + 1; j < bars.length; j += 1) {
      const A = bars[i], B = bars[j];
      const ox = Math.min(A.right, B.right) - Math.max(A.x, B.x);
      const oy = Math.min(A.bottom, B.bottom) - Math.max(A.y, B.y);
      if (ox > 1 && oy > 1) overlaps.push({ a: 'bar#' + i, b: 'bar#' + j, w: Math.round(ox), h: Math.round(oy), area: Math.round(ox * oy) });
    }
  }
  /* 状态条内容溢出自身（字被挤到条外） */
  const barOverflow = bars.map(function (b, idx) {
    const el = document.querySelectorAll('.hud-readouts .bar-group')[idx];
    if (!el) return null;
    const pr = el.getBoundingClientRect();
    let maxR = pr.right;
    Array.prototype.slice.call(el.querySelectorAll('*')).forEach(function (ch) {
      const r = ch.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) maxR = Math.max(maxR, r.right);
    });
    return { idx: idx, w: Math.round(pr.width * 10) / 10, overRightPx: Math.round((maxR - pr.right) * 10) / 10 };
  });

  /* ---------- 可点目标 ---------- */
  const taps = [];
  document.querySelectorAll('button, a[href], input, [role="button"], [tabindex]:not([tabindex="-1"]), .mini-card')
    .forEach(function (el) {
      const cs = getComputedStyle(el);
      if (cs.pointerEvents === 'none' || !isVisible(el)) return;
      const r = rct(el);
      taps.push({ name: label(el), w: r.w, h: r.h, text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 10) });
    });
  const tooSmall = taps.filter(function (t) { return t.w < 44 || t.h < 44; });

  /* ---------- 字号分布（只统计有直接文本的可见元素） ---------- */
  const fontCount = {};
  let smallText = 0;
  const smallTexts = [];
  document.querySelectorAll('.stage *').forEach(function (el) {
    if (!isVisible(el)) return;
    const hasText = Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    if (!hasText) return;
    const fs2 = parseFloat(getComputedStyle(el).fontSize) || 0;
    const key = fs2.toFixed(1);
    fontCount[key] = (fontCount[key] || 0) + 1;
    if (fs2 < 12) {
      smallText += 1;
      if (smallTexts.length < 15) smallTexts.push({ name: label(el), fs: key, text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 18) });
    }
  });

  /* ---------- UI 占屏（可见块面积并集，简化网格 4px 精度） ---------- */
  function unionArea(rs) {
    rs = rs.filter(function (r) { return r.w > 0 && r.h > 0; });
    if (!rs.length) return 0;
    const ys = [];
    rs.forEach(function (r) { ys.push(r.y, r.y + r.h); });
    ys.sort(function (a, b) { return a - b; });
    let area = 0;
    for (let i = 0; i < ys.length - 1; i += 1) {
      const y0 = ys[i], y1 = ys[i + 1];
      if (y1 - y0 < 0.001) continue;
      let cur = -1e9, sum = 0;
      const segs = [];
      rs.forEach(function (r) { if (r.y < y1 && r.y + r.h > y0) segs.push([r.x, r.x + r.w]); });
      segs.sort(function (a, b) { return a[0] - b[0]; });
      segs.forEach(function (s) {
        if (s[1] <= cur) return;
        const a = Math.max(s[0], cur);
        sum += s[1] - a;
        cur = Math.max(cur, s[1]);
      });
      area += sum * (y1 - y0);
    }
    return area;
  }
  const occ = ['top', 'readouts', 'deck', 'floor', 'minimap', 'dockMap', 'dockSkill', 'introHint', 'onboard', 'toast', 'spirit', 'ash'];
  const occRects = occ.map(function (k) { return blocks[k]; }).filter(function (b) { return b && b.visible; });
  const uiArea = unionArea(occRects);

  /* ---------- 触控层存在性（改前为 0） ---------- */
  const stick = document.querySelector('#arcmStick');
  const actionBtns = Array.prototype.slice.call(document.querySelectorAll('.arcm-act'));
  const skillBtns = Array.prototype.slice.call(document.querySelectorAll('.arcm-skill'));

  return {
    vw: vw, vh: vh, dpr: window.devicePixelRatio,
    scrollW: document.documentElement.scrollWidth,
    bodyClass: document.body.className,
    coarse: !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches),
    maxTouchPoints: navigator.maxTouchPoints || 0,
    mode: (typeof state !== 'undefined' && state) ? { mode: state.mode, status: state.status } : null,
    arcm: (typeof window.__arcm === 'object' && window.__arcm) ? window.__arcm.info() : null,
    blocks: blocks,
    bars: bars,
    topBtns: topBtns,
    topBtnMinSide: topBtns.reduce(function (m, b) { return Math.min(m, b.w, b.h); }, 999),
    overlaps: overlaps,
    barOverflow: barOverflow,
    taps: { total: taps.length, tooSmallCount: tooSmall.length, tooSmall: tooSmall.slice(0, 12),
            minSide: taps.reduce(function (m, t) { return Math.min(m, t.w, t.h); }, 999) },
    fontCount: fontCount,
    smallTextCount: smallText,
    smallTexts: smallTexts,
    coverage: { uiAreaPx: Math.round(uiArea), uiPct: Math.round(uiArea / (vw * vh) * 1000) / 10,
                visibleGameH: Math.round((vh - (blocks.top ? blocks.top.h : 0) - (blocks.deck && blocks.deck.visible ? blocks.deck.h : 0)) * 10) / 10 },
    touchLayer: {
      stick: stick ? rec(stick) : null,
      actionBtns: actionBtns.map(rec),
      skillBtns: skillBtns.map(rec),
      rotateVisible: blocks.rotate ? blocks.rotate.visible : false,
      rotateText: (document.querySelector('#rotateHint') || {}).innerText || ''
    },
    summary: {
      topOverflowPx: Math.max(0, Math.round(((blocks.actions ? blocks.actions.right : 0) - vw) * 10) / 10),
      topHeightPx: blocks.top ? blocks.top.h : 0,
      deckHeightPx: blocks.deck ? blocks.deck.h : 0,
      overlapCount: overlaps.length,
      barOverflowPx: Math.max.apply(null, barOverflow.map(function (b) { return b ? b.overRightPx : 0; }).concat([0])),
      tapTooSmall: tooSmall.length,
      smallTextCount: smallText,
      uiPct: Math.round(uiArea / (vw * vh) * 1000) / 10,
      visibleGameH: Math.round((vh - (blocks.top ? blocks.top.h : 0) - (blocks.deck && blocks.deck.visible ? blocks.deck.h : 0)) * 10) / 10
    }
  };
})()`;

/**
 * 启动一个无头 Edge 并返回 CDP 封装（单实例）
 * @returns {Promise<{send:Function, ev:Function, shot:Function, close:Function}>}
 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=1280,900', 'about:blank'
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return Buffer.from(r.data, 'base64').length;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/**
 * 在指定视口里进入战斗（标题 → 选角 → 第一层）
 * @param {Object} cdp CDP 封装
 * @param {Object} vp 视口配置
 * @returns {Promise<boolean>} 是否进入 playing
 */
async function enterBattle(cdp, vp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile,
    screenWidth: vp.w, screenHeight: vp.h,
    screenOrientation: { type: vp.orientation === 'portrait' ? 'portraitPrimary' : 'landscapePrimary', angle: vp.orientation === 'portrait' ? 0 : 90 }
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const url = 'file:///' + SNAP.replace(/\\/g, '/') + '?mp=' + vp.id;
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 100; i += 1) {
    const ready = await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`);
    if (ready) break;
    await sleep(200);
  }
  await sleep(900);
  await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
  await sleep(600);
  const playing0 = await cdp.ev(`typeof state !== 'undefined' && state && state.mode === 'playing'`);
  if (!playing0) {
    await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
  }
  for (let i = 0; i < 80; i += 1) {
    const playing = await cdp.ev(`typeof state !== 'undefined' && state && state.mode === 'playing'`);
    if (playing) break;
    await sleep(200);
  }
  /* 等开场仪式结束，避免把仪式层当 HUD 量 */
  await sleep(4500);
  return await cdp.ev(`typeof state !== 'undefined' && state && state.mode === 'playing'`);
}

/**
 * 环境守卫：高负载时提示，--force 跳过
 * @returns {boolean} 是否继续
 */
function envGuard() {
  if (process.argv.includes('--force')) { console.log('环境守卫：--force 跳过'); return true; }
  let cpu = 0, edgeCount = 0;
  try {
    cpu = Number(require('child_process').execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"',
      { encoding: 'utf8' }).trim()) || 0;
    edgeCount = Number(require('child_process').execSync(
      'powershell -NoProfile -Command "(Get-Process msedge -ErrorAction SilentlyContinue | Measure-Object).Count"',
      { encoding: 'utf8' }).trim()) || 0;
  } catch (e) { /* 读不到不拦 */ }
  console.log(`环境守卫：CPU=${cpu}%  msedge=${edgeCount}`);
  if (cpu >= 60 || edgeCount >= 2) { console.log('环境高负载：加 --force 才继续'); return false; }
  return true;
}

/**
 * 主流程：逐视口进入战斗 → 测量 → 截图 → 落 JSON
 * @returns {Promise<void>}
 */
async function main() {
  if (!envGuard()) { process.exitCode = 3; return; }
  const htmlIdx = process.argv.indexOf('--html');
  if (htmlIdx >= 0) fs.copyFileSync(process.argv[htmlIdx + 1], SNAP);
  const tagIdx = process.argv.indexOf('--tag');
  const tag = tagIdx >= 0 ? process.argv[tagIdx + 1] : 'baseline';
  if (!fs.existsSync(SNAP)) throw new Error('缺少工作副本：' + SNAP);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bytes = fs.statSync(SNAP).size;
  const md5 = require('crypto').createHash('md5').update(fs.readFileSync(SNAP)).digest('hex').toUpperCase();
  console.log(`副本：${path.basename(SNAP)}  bytes=${bytes}  md5=${md5}  tag=${tag}`);

  const cdp = await bootEdge();
  const out = { snapshot: { bytes, md5 }, tag, viewports: [] };
  try {
    for (const vp of VIEWPORTS) {
      const ok = await enterBattle(cdp, vp);
      const data = await cdp.ev(MEASURE_JS);
      const file = path.join(OUT_DIR, `${tag}_${vp.id}.jpg`);
      const n = await cdp.shot(file);
      out.viewports.push({ vp, entered: ok, data, screenshot: file, jpegBytes: n });
      console.log(`[${vp.id}] ${ok ? '战斗中' : '未进战斗(竖屏门禁/异常)'} 顶栏=${data.summary.topHeightPx}px 越界=${data.summary.topOverflowPx}px ` +
        `压盖=${data.summary.overlapCount}对 状态条溢出=${data.summary.barOverflowPx}px ` +
        `<44px=${data.summary.tapTooSmall} <12px文本=${data.summary.smallTextCount} ` +
        `UI=${data.summary.uiPct}% 可视战斗高=${data.summary.visibleGameH}px ` +
        `摇杆=${data.touchLayer.stick && data.touchLayer.stick.visible ? Math.round(data.touchLayer.stick.w) + 'px' : '无'} ` +
        `技能键=${data.touchLayer.actionBtns.filter(function (b) { return b.visible; }).length} ` +
        `请横屏=${data.touchLayer.rotateVisible} 截图=${path.basename(file)}(${n}B)`);
    }
    fs.writeFileSync(path.join(OUT_DIR, `${tag}.json`), JSON.stringify(out, null, 2));
    console.log(`已写出 shots/${tag}.json`);
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exit(1);
});
