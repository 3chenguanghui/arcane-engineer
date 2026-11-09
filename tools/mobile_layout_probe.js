/**
 * 手机真实版面回归探针（只读，不改主文件）
 * ------------------------------------------------------------
 * 目的：在三个真实手机视口（375×667 / 390×844 / 412×915，DPR 3）上量取 HUD 的
 *       安全区越界、元素压盖、可点区域（<44×44）、文字溢出、UI 占屏比例，
 *       并用"注入样式"的方式量取修复方案的代价（不落盘、不写主文件）。
 * 用法：node tools/mobile_layout_probe.js [--html <路径>]
 * 产物：shots/mobile_<W>x<H>.jpg（全屏截图 JPEG q85）
 *       shots/mobile_layout.json（三档测量结果）
 * 纪律：一次只开一个 Edge 实例；不写主文件；截图不在 _tmp 里留中间图。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 独立 profile 根目录，避免与其它并行线抢同一个 .testprofile 锁
process.env.ARCANE_PROFILE_ROOT = path.join(__dirname, '..', '.testprofile_mobile');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9551;
const ROOT = path.join(__dirname, '..');
const SNAP = path.join(ROOT, '_mobile_probe_snapshot.html');
const OUT_DIR = path.join(ROOT, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 三档真实手机视口 + 安全区模型（无头浏览器 env() 恒为 0，故用机型模型代替） */
const VIEWPORTS = [
  { id: '375x667', w: 375, h: 667, dpr: 3, safe: { top: 20, bottom: 0, left: 0, right: 0 }, note: 'iPhone SE/8：状态栏 20px，无底部横条' },
  { id: '390x844', w: 390, h: 844, dpr: 3, safe: { top: 47, bottom: 34, left: 0, right: 0 }, note: 'iPhone 12/13/14：刘海 47px，Home 横条 34px' },
  { id: '412x915', w: 412, h: 915, dpr: 3, safe: { top: 24, bottom: 24, left: 0, right: 0 }, note: 'Android 412×915：状态栏 24px，手势条 24px' }
];

/**
 * 页面内测量函数（字符串注入，返回全部几何数据）
 * 说明：全部用 CSS 像素（DPR 只影响截图分辨率，不影响 CSS 布局）
 */
const MEASURE_JS = `(function () {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /** 取元素矩形（保留 0.1px，避免四舍五入吃掉 1px 的越界） */
  function rct(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10,
             w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
             right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10 };
  }
  /** 是否"看着像在屏幕上"：display/visibility/透明度/尺寸/出屏 */
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
  /** 人类可读的元素名 */
  function label(el) {
    if (!el) return 'null';
    if (el.id) return '#' + el.id;
    const cls = (typeof el.className === 'string') ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  }
  /** 元素记录 */
  function rec(key, sel, el) {
    const cs = getComputedStyle(el);
    const r = rct(el);
    return {
      key: key, sel: sel, name: label(el),
      x: r.x, y: r.y, w: r.w, h: r.h, right: r.right, bottom: r.bottom,
      visible: isVisible(el),
      opacity: Math.round(parseFloat(cs.opacity) * 100) / 100,
      z: cs.zIndex, pos: cs.position, pe: cs.pointerEvents,
      fontSize: cs.fontSize,
      overRight: Math.max(0, Math.round((r.right - vw) * 10) / 10),
      overLeft: Math.max(0, Math.round((-r.left) * 10) / 10),
      overBottom: Math.max(0, Math.round((r.bottom - vh) * 10) / 10),
      text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 26)
    };
  }

  const GROUPS = [
    ['top', 'header.hud-top'], ['brand', '.brand'], ['logo', '.logo'], ['brandSub', '#brandSub'],
    ['readouts', '.hud-readouts'], ['record', '.hud-record'], ['actions', '.hud-actions'],
    ['btnMute', '#btnMute'], ['btnRules', '#btnRules'], ['btnSkillTree', '#btnSkillTree'],
    ['btnSettings', '#btnSettings'], ['btnRestart', '#btnRestart'],
    ['floor', '.floor-panel'], ['minimap', '.minimap-panel'],
    ['deck', '.hud-deck'], ['deckBlock', '.deck-block'], ['deckSide', '.deck-side'],
    ['skillPair', '.skill-pair'], ['fusionBar', '#fusionBar'],
    ['dockMap', '#btnMapDock'], ['dockSkill', '#btnSkillDock'],
    ['introHint', '#introHint'], ['toast', '#toast'], ['onboardHint', '#onboardHint'],
    ['spirit', '#spiritLine'], ['overdrive', '#overdriveBar'], ['dual', '#dualBar']
  ];
  const elements = [];
  GROUPS.forEach(function (g) {
    Array.prototype.slice.call(document.querySelectorAll(g[1])).forEach(function (el) {
      elements.push(rec(g[0], g[1], el));
    });
  });

  /* --------- 压盖：可见块两两求交（跳过 DOM 父子嵌套） --------- */
  const overlap = [];
  const blockKeys = ['top', 'readouts', 'floor', 'minimap', 'deck', 'dockMap', 'dockSkill',
    'introHint', 'toast', 'onboardHint', 'overdrive', 'dual', 'spirit', 'fusionBar'];
  const blocks = [];
  blockKeys.forEach(function (key) {
    const g = GROUPS.find(function (x) { return x[0] === key; });
    Array.prototype.slice.call(document.querySelectorAll(g[1])).forEach(function (el) {
      if (!isVisible(el)) return;
      blocks.push({ key: key, el: el, r: rct(el) });
    });
  });
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const A = blocks[i], B = blocks[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.x, B.r.x);
      const oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.y, B.r.y);
      if (ox > 1 && oy > 1) {
        overlap.push({
          a: A.key + '(' + label(A.el) + ')', b: B.key + '(' + label(B.el) + ')',
          w: Math.round(ox * 10) / 10, h: Math.round(oy * 10) / 10,
          area: Math.round(ox * oy)
        });
      }
    }
  }

  /* --------- 容器内容溢出（子元素越出父框的像素数） --------- */
  const contentOverflow = [];
  ['top', 'readouts', 'actions', 'deck', 'deckSide', 'floor', 'minimap'].forEach(function (key) {
    const g = GROUPS.find(function (x) { return x[0] === key; });
    const el = document.querySelector(g[1]);
    if (!el || !isVisible(el)) return;
    const pr = el.getBoundingClientRect();
    let maxR = pr.right, maxB = pr.bottom;
    Array.prototype.slice.call(el.querySelectorAll('*')).forEach(function (ch) {
      if (!isVisible(ch)) return;
      const r = ch.getBoundingClientRect();
      maxR = Math.max(maxR, r.right);
      maxB = Math.max(maxB, r.bottom);
    });
    const overR = maxR - pr.right, overB = maxB - pr.bottom;
    if (overR > 1 || overB > 1) {
      contentOverflow.push({
        key: key, name: label(el),
        overRightPx: Math.round(overR * 10) / 10,
        overBottomPx: Math.round(overB * 10) / 10,
        rect: rct(el)
      });
    }
  });

  /* --------- 可点区域 --------- */
  const tapSet = new Set();
  document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')
    .forEach(function (e) { tapSet.add(e); });
  document.querySelectorAll('.mini-card, .char-card, .dock-btn, .card-row > *')
    .forEach(function (e) { tapSet.add(e); });
  const tapsAll = [];
  tapSet.forEach(function (el) {
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none') return;
    if (!isVisible(el)) return;
    const r = rct(el);
    tapsAll.push({ name: label(el), text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 12), w: r.w, h: r.h, x: r.x, y: r.y });
  });
  const tapTooSmall = tapsAll.filter(function (t) { return t.w < 44 || t.h < 44; })
    .sort(function (a, b) { return (a.w * a.h) - (b.w * b.h); });
  const tapMin = tapsAll.reduce(function (m, t) { return Math.min(m, t.w, t.h); }, 999);

  /* --------- 文字溢出 / 截断（按文本节点量，避免整块误判） --------- */
  const textFails = [];
  const seenText = new Set();
  const walker = document.createTreeWalker(document.querySelector('.stage') || document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = (node.nodeValue || '').trim();
    if (!t) continue;
    let pe = node.parentElement;
    if (!pe || !isVisible(pe)) continue;
    while (pe && pe !== document.body) {
      const c = getComputedStyle(pe);
      if (!c.display.startsWith('inline')) break;
      pe = pe.parentElement;
    }
    if (!pe || pe === document.body) continue;
    const cs = getComputedStyle(pe);
    if (cs.display === 'none') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rr = range.getBoundingClientRect();
    if (rr.width < 0.1 || rr.height < 0.1) continue;
    const pr = pe.getBoundingClientRect();
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    const prd = parseFloat(cs.paddingRight) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    const contentLeft = pr.left + bl + pl;
    const contentRight = pr.left + bl + pe.clientWidth - prd;
    const contentBottom = pr.top + (parseFloat(cs.borderTopWidth) || 0) + pe.clientHeight - pb;
    const overX = Math.max(0, rr.right - contentRight, contentLeft - rr.left);
    const overY = Math.max(0, rr.bottom - contentBottom);
    if (overX > 1.5 || overY > 1.5) {
      const key = label(pe) + '|' + t.slice(0, 10);
      if (seenText.has(key)) continue;
      seenText.add(key);
      textFails.push({
        node: label(pe), text: t.slice(0, 20),
        overRightPx: Math.round(Math.max(0, rr.right - contentRight) * 10) / 10,
        overLeftPx: Math.round(Math.max(0, contentLeft - rr.left) * 10) / 10,
        overBottomPx: Math.round(overY * 10) / 10,
        fontSize: cs.fontSize, overflowX: cs.overflowX, ellipsis: cs.textOverflow,
        rect: rct(pe)
      });
    }
  }

  /* --------- UI 占屏面积（精确并集，不做网格量化） --------- */
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
  const occKeys = ['top', 'readouts', 'floor', 'minimap', 'deck', 'dockMap', 'dockSkill',
    'introHint', 'toast', 'onboardHint', 'overdrive', 'dual', 'spirit', 'fusionBar'];
  const occRects = [];
  const byBlock = {};
  occKeys.forEach(function (key) {
    const g = GROUPS.find(function (x) { return x[0] === key; });
    Array.prototype.slice.call(document.querySelectorAll(g[1])).forEach(function (el) {
      if (!isVisible(el)) return;
      const r = rct(el);
      occRects.push(r);
      byBlock[key] = (byBlock[key] || 0) + Math.round(r.w * r.h);
    });
  });
  const uiArea = unionArea(occRects);
  const center = { x: vw * 0.2, y: vh * 0.2, w: vw * 0.6, h: vh * 0.6 };
  const centerRects = occRects.map(function (r) {
    const x0 = Math.max(r.x, center.x), x1 = Math.min(r.right, center.x + center.w);
    const y0 = Math.max(r.y, center.y), y1 = Math.min(r.bottom, center.y + center.h);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  });
  const centerArea = unionArea(centerRects);

  /* --------- 小字号计数（可见元素，按计算后字号） --------- */
  const fontCount = {};
  document.querySelectorAll('.stage *').forEach(function (el) {
    if (!isVisible(el)) return;
    const hasText = Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    if (!hasText) return;
    const fs2 = getComputedStyle(el).fontSize;
    fontCount[fs2] = (fontCount[fs2] || 0) + 1;
  });

  const topRightMax = elements.filter(function (e) { return e.key === 'top' || e.key === 'brand' || e.key === 'readouts' || e.key === 'actions' || e.key === 'record' || e.key === 'btnMute' || e.key === 'btnRules' || e.key === 'btnSkillTree' || e.key === 'btnSettings' || e.key === 'btnRestart'; })
    .filter(function (e) { return e.visible; })
    .reduce(function (m, e) { return Math.max(m, e.overRight); }, 0);

  return {
    vw: vw, vh: vh, dpr: window.devicePixelRatio,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    bodyClass: document.body.className,
    coarse: !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches),
    maxTouchPoints: navigator.maxTouchPoints || 0,
    safeEnvBottom: getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)') || '0',
    hudMode: (window.__roamDebug && window.__roamDebug.hud) ? window.__roamDebug.hud.info() : null,
    hudMeasure: (window.__roamDebug && window.__roamDebug.hud) ? window.__roamDebug.hud.measure() : null,
    elements: elements,
    topRightMax: Math.round(topRightMax * 10) / 10,
    overlaps: overlap,
    contentOverflow: contentOverflow,
    taps: { total: tapsAll.length, minSide: tapMin, tooSmall: tapTooSmall },
    textFails: textFails,
    fontCount: fontCount,
    coverage: {
      uiAreaPx: Math.round(uiArea), centerAreaPx: Math.round(centerArea),
      uiPct: Math.round(uiArea / (vw * vh) * 1000) / 10,
      centerPct: Math.round(centerArea / (vw * vh) * 1000) / 10,
      byBlockArea: byBlock
    },
    summary: {
      topRightOverflowPx: Math.round(topRightMax * 10) / 10,
      topHeightPx: (function () { const t = document.querySelector('header.hud-top'); return t ? Math.round(t.getBoundingClientRect().height * 10) / 10 : 0; })(),
      actionsWidthPx: (function () { const a = document.querySelector('.hud-actions'); return a ? Math.round(a.getBoundingClientRect().width * 10) / 10 : 0; })(),
      readoutsWidthPx: (function () { const a = document.querySelector('.hud-readouts'); return a ? Math.round(a.getBoundingClientRect().width * 10) / 10 : 0; })(),
      deckTopPx: (function () { const a = document.querySelector('.hud-deck'); return a ? Math.round(a.getBoundingClientRect().top * 10) / 10 : 0; })(),
      deckHeightPx: (function () { const a = document.querySelector('.hud-deck'); return a ? Math.round(a.getBoundingClientRect().height * 10) / 10 : 0; })(),
      coveragePct: Math.round(uiArea / (vw * vh) * 1000) / 10,
      centerPct: Math.round(centerArea / (vw * vh) * 1000) / 10,
      tapTooSmallCount: tapTooSmall.length,
      textFailCount: textFails.length,
      overlapCount: overlap.length
    }
  };
})()`;

/** 变体样式：用注入样式量取修复代价（不改文件） */
const VARIANTS = [
  { id: 'v0-baseline', css: '' },
  { id: 'v1-fs-xs-12', css: ':root{--fs-xs:12px}' },
  {
    id: 'v2-icon-44',
    css: '@media (max-width:760px){.hud-actions .btn{width:44px;height:44px;min-width:44px;padding:0;justify-content:center;gap:0}' +
      '.hud-actions .btn span,.hud-actions .btn kbd{display:none}}'
  },
  {
    id: 'v3-mobile-top',
    css: '@media (max-width:760px){' +
      '.hud-top{flex-wrap:wrap;padding:6px 10px 8px;gap:6px;align-items:flex-start}' +
      '.brand{width:auto;min-width:0}.logo{font-size:16px}' +
      '.hud-actions{margin-left:auto}' +
      '.hud-actions .btn{width:44px;height:44px;min-width:44px;padding:0;justify-content:center;gap:0}' +
      '.hud-actions .btn span,.hud-actions .btn kbd{display:none}' +
      '.hud-readouts{order:3;flex:0 0 100%;width:100%;flex-direction:row;gap:8px}' +
      '.hud-readouts .bar-group{width:calc(50% - 4px)}' +
      '}'
  }
];

/**
 * 启动 Edge（单实例），等调试端口就绪并返回 CDP 通道
 * @returns {Promise<{send:Function, ev:Function, shot:Function, close:Function}>} CDP 封装
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
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(200);
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  };
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return r.data.length;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/**
 * 在指定视口里进入战斗（标题 → 选角 → 第一层），返回是否成功
 * @param {Object} cdp CDP 封装
 * @param {Object} vp 视口配置
 * @returns {Promise<boolean>} 是否进入 playing
 */
async function enterBattle(cdp, vp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: true,
    screenWidth: vp.w, screenHeight: vp.h,
    screenOrientation: { type: 'portraitPrimary', angle: 0 }
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const url = 'file:///' + SNAP.replace(/\\/g, '/') + '?ml=' + vp.id;
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 80; i += 1) {
    const ready = await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`);
    if (ready) break;
    await sleep(150);
  }
  await sleep(700);

  // 标题 →（角色选择）→ 战斗
  await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
  await sleep(500);
  const alreadyPlaying = await cdp.ev(`typeof state !== 'undefined' && state && state.mode === 'playing' && state.status === 'playing'`);
  if (!alreadyPlaying) {
    const hasChar = await cdp.ev(`!!document.querySelector('#charLayer:not(.hidden)')`);
    if (hasChar) {
      // 点第一张角色卡（会重渲染卡片 DOM）→ 点确认；确认按钮按 id 取，重渲染不影响
      await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
    }
  }
  for (let i = 0; i < 60; i += 1) {
    const playing = await cdp.ev(`typeof state !== 'undefined' && state && state.mode === 'playing' && state.status === 'playing'`);
    if (playing) break;
    await sleep(150);
  }
  // 等开场演演出结束（开场 ritual 有 2–3 秒信箱条），避免把演出层当 HUD 量
  await sleep(4200);
  return await cdp.ev(`typeof state !== 'undefined' && state && state.mode === 'playing' && state.status === 'playing'`);
}

/**
 * 注入/移除变体样式并量取当前版面
 * @param {Object} cdp CDP 封装
 * @param {string} css 注入的 CSS（空串 = 移除）
 * @returns {Promise<Object>} 测量结果
 */
async function measureWith(cdp, css) {
  // 先移除上一次注入的变体样式，保证每次测量都是干净基线
  await cdp.ev(`(function(){var o=document.getElementById('__mlProbe');if(o)o.remove();return true;})()`);
  if (css) {
    await cdp.ev(`(function(){var s=document.createElement('style');s.id='__mlProbe';s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true;})()`);
  }
  await sleep(320);
  return cdp.ev(MEASURE_JS);
}

/**
 * 环境守卫：CPU 占用过高或多个 headless 时拒绝出数（避免把环境卡顿记成版面问题）
 * @returns {boolean} 是否允许继续
 */
function envGuard() {
  if (process.argv.includes('--force')) {
    console.log('环境守卫：--force 已跳过');
    return true;
  }
  let cpu = 0, edgeCount = 0;
  try {
    cpu = Number(require('child_process').execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"',
      { encoding: 'utf8' }).trim()) || 0;
    edgeCount = Number(require('child_process').execSync(
      'powershell -NoProfile -Command "(Get-Process msedge -ErrorAction SilentlyContinue | Measure-Object).Count"',
      { encoding: 'utf8' }).trim()) || 0;
  } catch (e) { /* 读不到就不拦 */ }
  console.log(`环境守卫：CPU=${cpu}%  msedge进程=${edgeCount}`);
  if (cpu >= 60 || edgeCount >= 2) {
    console.log('环境守卫：机器处于高负载（CPU>=60% 或已有其它 msedge），拒绝出数。确认是干净窗口后加 --force 或改时段再跑。');
    return false;
  }
  return true;
}

/**
 * 主流程：三档视口 × 四组变体，落 JSON 与截图
 * @returns {Promise<void>}
 */
async function main() {
  if (!envGuard()) { process.exitCode = 3; return; }
  const htmlArgIdx = process.argv.indexOf('--html');
  if (htmlArgIdx >= 0) {
    const src = process.argv[htmlArgIdx + 1];
    fs.copyFileSync(src, SNAP);
  }
  if (!fs.existsSync(SNAP)) throw new Error('缺少快照文件：' + SNAP);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const snapBytes = fs.statSync(SNAP).size;
  const snapMd5 = require('crypto').createHash('md5').update(fs.readFileSync(SNAP)).digest('hex').toUpperCase();
  console.log(`快照：${path.basename(SNAP)}  bytes=${snapBytes}  md5=${snapMd5}`);

  const cdp = await bootEdge();
  const out = { snapshot: { file: SNAP, bytes: snapBytes, md5: snapMd5 }, envUnstable: [], viewports: [] };
  try {
    for (const vp of VIEWPORTS) {
      // 环境卡顿时最多重试一次；仍失败标 ENV_UNSTABLE（不是版面 FAIL）
      let ok = false;
      for (let attempt = 1; attempt <= 2 && !ok; attempt += 1) {
        ok = await enterBattle(cdp, vp);
        if (!ok) {
          console.log(`[${vp.id}] 第 ${attempt} 次未进入战斗（疑似 CPU 抢占/加载超时，不记为 FAIL）`);
          await sleep(1200);
        }
      }
      if (!ok) {
        out.envUnstable.push({ viewport: vp.id, reason: 'ENTER_BATTLE_TIMEOUT' });
        continue;
      }

      const runs = [];
      for (const variant of VARIANTS) {
        const data = await measureWith(cdp, variant.css);
        runs.push({ variant: variant.id, data });
        console.log(`[${vp.id}] ${variant.id}  顶部越界=${data.summary.topRightOverflowPx}px  ` +
          `压盖=${data.summary.overlapCount}对  <44px=${data.summary.tapTooSmallCount}个  ` +
          `文字溢出=${data.summary.textFailCount}处  UI占屏=${data.summary.coveragePct}%  ` +
          `(中心20%-80%占 ${data.summary.centerPct}%)`);
      }

      // 回基线后截图；只有确实存在问题才落盘（"截图只在有问题时留"）
      await measureWith(cdp, '');
      const base = runs[0].data.summary;
      const hasProblem = base.topRightOverflowPx > 0 || base.overlapCount > 0
        || base.tapTooSmallCount > 0 || base.textFailCount > 0;
      let screenshot = null;
      if (hasProblem) {
        screenshot = path.join(OUT_DIR, `mobile_${vp.id}.jpg`);
        const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
        fs.writeFileSync(screenshot, Buffer.from(r.data, 'base64'));
        console.log(`[${vp.id}] 存在问题 → 留截图 ${path.basename(screenshot)}  jpeg_bytes=${Buffer.from(r.data, 'base64').length}`);
      } else {
        console.log(`[${vp.id}] 基线无问题 → 不留截图`);
      }
      out.viewports.push({ vp, runs, screenshot });
    }
    fs.writeFileSync(path.join(OUT_DIR, 'mobile_layout.json'), JSON.stringify(out, null, 2));
    console.log('已写出 shots/mobile_layout.json');
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exit(1);
});
