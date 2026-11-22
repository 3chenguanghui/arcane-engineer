/**
 * HUD 层级专项复测（只读工作副本，不改主文件 / delivery）
 * ------------------------------------------------------------
 * 一个 Edge 实例里串行跑四个场景，全部用 getBoundingClientRect 实测：
 *   A 844×390 触屏态（改后）：目标金条 / 最小小地图 / 区块重叠 / 文字重叠 /
 *                              HUD 占屏 / 可玩带 / 触控目标 / 拇指距离
 *   B 1920×1080 桌面（不做任何触控模拟）：验证「焚稿球 × 技能树钮」重叠已归零，
 *                              并用真实键盘事件（Input.dispatchKeyEvent）回归 WASD / J
 *   C 844×390 + ?m=off：逃生开关 = 原始交付版布局（当"改前同机位"对照）
 *   D 844×390 非触屏兜底：pointer:fine + maxTouchPoints=0 + ontouchstart 存在，
 *                          模拟玩家那张实拍图的内嵌 WebView
 * 用法：node mobile/tools/mfix.js [--force]
 * 产物：mobile/shots/fix_*.jpg 与 mobile/shots/fix.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9563;
const SNAP = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const OUT_DIR = path.join(MOBILE_DIR, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------
   页面内测量：区块重叠 / 文字重叠 / HUD 占屏 / 可玩带 / 触控目标
   ------------------------------------------------------------ */
const MEASURE_JS = `(function () {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const round = (n) => Math.round(n * 10) / 10;

  /** 取元素矩形（CSS 像素），不可见返回 null */
  function box(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05
      && r.width > 1.5 && r.height > 1.5 && r.right > 1 && r.bottom > 1 && r.left < vw - 1 && r.top < vh - 1;
    return { sel: sel, x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height),
             right: round(r.right), bottom: round(r.bottom), visible: vis,
             text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 30) };
  }

  const SEL = {
    top: 'header.hud-top', brand: '.brand', readouts: '.hud-readouts', actions: '.hud-actions',
    floor: '.floor-panel', minimap: '.minimap-panel', dockMap: '#btnMapDock', dockSkill: '#btnSkillDock',
    ash: '#ashBurnBtn', deck: '.hud-deck', intro: '#introHint', onboard: '#onboardHint',
    toast: '#toast', spirit: '#spiritLine', goal: '#arcmGoal', stick: '#arcmStick', pad: '#arcmPad',
    deckBtn: '#arcmDeckBtn', rotate: '#rotateHint', ctx: '#contextHint', obj: '#hudObjective'
  };
  const blocks = {};
  Object.keys(SEL).forEach(function (k) { blocks[k] = box(SEL[k]); });

  /* 可见区块两两求交（M 线同一判据：交叠 > 0.5px 才算） */
  const keys = Object.keys(blocks).filter(function (k) { return blocks[k] && blocks[k].visible; });
  const overlaps = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const A = blocks[keys[i]], B = blocks[keys[j]];
      /* 父子关系不算重叠（例如 hud-top 里本来就装着 readouts） */
      const ea = document.querySelector(A.sel), eb = document.querySelector(B.sel);
      if (ea && eb && (ea.contains(eb) || eb.contains(ea))) continue;
      const ox = Math.min(A.right, B.right) - Math.max(A.x, B.x);
      const oy = Math.min(A.bottom, B.bottom) - Math.max(A.y, B.y);
      if (ox > 0.5 && oy > 0.5) {
        overlaps.push({ a: keys[i], b: keys[j], w: Math.round(ox), h: Math.round(oy), area: Math.round(ox * oy) });
      }
    }
  }
  overlaps.sort(function (a, b) { return b.area - a.area; });

  /* 文字级重叠：顶栏内所有可见文本节点，Range.getBoundingClientRect 两两求交 */
  const top = document.querySelector('header.hud-top');
  const texts = [];
  if (top) {
    const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
    });
    let n;
    while ((n = walker.nextNode())) {
      const pe = n.parentElement;
      if (!pe) continue;
      const cs = getComputedStyle(pe);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const b = rg.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) {
        texts.push({ t: n.nodeValue.trim().slice(0, 14), p: pe, x: b.left, y: b.top, w: b.width, h: b.height });
      }
    }
  }
  const textOverlaps = [];
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      if (texts[i].p === texts[j].p) continue;
      if (texts[i].p.contains(texts[j].p) || texts[j].p.contains(texts[i].p)) continue;
      const ox = Math.min(texts[i].x + texts[i].w, texts[j].x + texts[j].w) - Math.max(texts[i].x, texts[j].x);
      const oy = Math.min(texts[i].y + texts[i].h, texts[j].y + texts[j].h) - Math.max(texts[i].y, texts[j].y);
      if (ox > 0.5 && oy > 0.5 && ox * oy > 20) {
        textOverlaps.push({ a: texts[i].t, b: texts[j].t, w: Math.round(ox), h: Math.round(oy), area: Math.round(ox * oy) });
      }
    }
  }

  /* HUD 占屏：可见矩形并集 / 视口面积（不重复计） */
  function unionArea(rects) {
    let area = 0;
    const ys = [];
    rects.forEach(function (r) { ys.push(r.y, r.bottom); });
    ys.sort(function (a, b) { return a - b; });
    for (let i = 0; i < ys.length - 1; i += 1) {
      const y0 = ys[i], y1 = ys[i + 1];
      if (y1 - y0 < 0.001) continue;
      let cur = -1e9, sum = 0;
      const segs = [];
      rects.forEach(function (r) { if (r.y < y1 && r.bottom > y0) segs.push([r.x, r.right]); });
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

  /* 中轴可玩带：x=vw/2 上未被给定矩形盖住的最长垂直段 */
  function bandAt(rects) {
    const mid = vw / 2;
    const spans = rects.filter(function (r) { return r.x <= mid && r.right >= mid; })
      .map(function (r) { return [Math.max(0, r.y), Math.min(vh, r.bottom)]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    let band = 0, cursor = 0;
    spans.forEach(function (s) {
      if (s[0] > cursor) band = Math.max(band, s[0] - cursor);
      cursor = Math.max(cursor, s[1]);
    });
    return Math.max(band, vh - cursor);
  }

  /* 口径① core：常驻 HUD 区块（可与 M 线 44.3% / 191.3px 对齐） */
  const CORE = ['top', 'floor', 'minimap', 'dockMap', 'dockSkill', 'ash', 'deck', 'goal'];
  /* 口径② ctrl：core + 触控层（摇杆 / 技能键 / 卡组键） */
  const CTRL = CORE.concat(['stick', 'pad', 'deckBtn']);
  /* 口径③ all：所有可见区块（含教学卡 / toast / 旁白这类浮动文字） */
  const coreRects = CORE.map(function (k) { return blocks[k]; }).filter(function (r) { return r && r.visible; });
  const ctrlRects = CTRL.map(function (k) { return blocks[k]; }).filter(function (r) { return r && r.visible; });
  const allRects = keys.map(function (k) { return blocks[k]; });

  const area = unionArea(allRects);

  /* 可玩带：core 口径（与 M 线一致）与 ctrl 口径（含摇杆/技能键） */
  const band = bandAt(coreRects);
  const bandCtrl = bandAt(ctrlRects);

  /* 触控目标：逐个量最小边 */
  const targets = [];
  [['#arcmStick', '摇杆底盘'], ['#arcmDeckBtn', '卡组'], ['#btnMapDock', '地图'],
   ['#ashBurnBtn', '焚稿']].forEach(function (p) {
    const b = box(p[0]);
    if (b && b.visible) targets.push({ name: p[1], sel: p[0], w: b.w, h: b.h, min: Math.min(b.w, b.h) });
  });
  document.querySelectorAll('.arcm-act').forEach(function (el) {
    const r = el.getBoundingClientRect();
    targets.push({ name: '技能·' + (el.innerText || '').replace(/\\s+/g, ' ').trim(), sel: '.arcm-act',
                   w: round(r.width), h: round(r.height), min: round(Math.min(r.width, r.height)) });
  });
  document.querySelectorAll('.hud-actions .btn').forEach(function (el) {
    const r = el.getBoundingClientRect();
    targets.push({ name: '顶栏·' + (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 10),
                   sel: '.hud-actions .btn', w: round(r.width), h: round(r.height),
                   min: round(Math.min(r.width, r.height)) });
  });

  /* 拇指距离：按钮中心到最近屏幕底角的直线距离（CSS px） */
  const thumb = [];
  ['#btnMapDock', '#arcmDeckBtn', '#ashBurnBtn', '#arcmStick', '#arcmPad'].forEach(function (sel) {
    const el = document.querySelector(sel);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dl = Math.hypot(cx, vh - cy);
    const dr = Math.hypot(vw - cx, vh - cy);
    thumb.push({ sel: sel, cx: round(cx), cy: round(cy), toBottomLeft: Math.round(Math.min(dl, dr)),
                 corner: dl <= dr ? '左下' : '右下' });
  });

  return {
    vw: vw, vh: vh, dpr: window.devicePixelRatio,
    bodyClass: document.body.className,
    mode: (typeof state !== 'undefined' && state) ? state.mode : null,
    arcm: (typeof window.__arcm === 'object' && window.__arcm) ? window.__arcm.info() : null,
    blocks: blocks,
    overlaps: overlaps,
    overlapCount: overlaps.length,
    textOverlaps: textOverlaps,
    textOverlapCount: textOverlaps.length,
    hudPct: Math.round(area / (vw * vh) * 1000) / 10,
    hudCorePct: Math.round(unionArea(coreRects) / (vw * vh) * 1000) / 10,
    hudCtrlPct: Math.round(unionArea(ctrlRects) / (vw * vh) * 1000) / 10,
    playBand: Math.round(band),
    playBandCtrl: Math.round(bandCtrl),
    targets: targets,
    targetTooSmall: targets.filter(function (t) { return t.min < 44; }).length,
    targetMin: targets.reduce(function (m, t) { return Math.min(m, t.min); }, 999),
    thumb: thumb
  };
})()`;

/* ------------------------------------------------------------
   CDP 启动（单实例）
   ------------------------------------------------------------ */
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
 * 设置视口（可选触控模拟）
 * @param {Object} cdp CDP 封装
 * @param {Object} vp {w,h,dpr,mobile,orientation}
 * @param {boolean} touch 是否开启触控模拟
 * @returns {Promise<void>}
 */
async function setViewport(cdp, vp, touch) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile,
    screenWidth: vp.w, screenHeight: vp.h,
    screenOrientation: { type: vp.orientation === 'portrait' ? 'portraitPrimary' : 'landscapePrimary', angle: vp.orientation === 'portrait' ? 0 : 90 }
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!touch, maxTouchPoints: touch ? 5 : 1 });
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'pointer', value: touch ? 'coarse' : 'fine' }]
  });
}

/**
 * 打开副本并进入战斗第一层
 * @param {Object} cdp CDP 封装
 * @param {string} query URL 查询串（如 ?m=off）
 * @returns {Promise<boolean>} 是否处于 playing
 */
async function openBattle(cdp, query, file) {
  const url = 'file:///' + (file || SNAP).replace(/\\/g, '/') + (query || '');
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 120; i += 1) {
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
  await sleep(4500);  // 等开场仪式
  return await cdp.ev(`typeof state !== 'undefined' && state && state.mode === 'playing'`);
}

/**
 * 注入"设备上报无触控"的补丁（用于复现玩家实拍图的内嵌 WebView 态）
 * @param {Object} cdp CDP 封装
 * @param {boolean} withOnTouch 是否同时伪造 ontouchstart（触控层兜底分支需要）
 * @returns {Promise<string>} 脚本 id，便于移除
 */
async function injectNoTouch(cdp, withOnTouch) {
  const source = [
    'try { Object.defineProperty(navigator, "maxTouchPoints", { get: function(){ return 0; }, configurable: true }); } catch (e) {}',
    withOnTouch ? 'window.ontouchstart = null;' : ''
  ].join('\n');
  const r = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
  return r.identifier;
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
 * 主流程：A 手机触屏 / B 桌面 / C 逃生开关 / D 非触屏兜底
 * @returns {Promise<void>}
 */
async function main() {
  if (!envGuard()) { process.exitCode = 3; return; }
  if (!fs.existsSync(SNAP)) throw new Error('缺少工作副本：' + SNAP);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bytes = fs.statSync(SNAP).size;
  const md5 = require('crypto').createHash('md5').update(fs.readFileSync(SNAP)).digest('hex').toUpperCase();
  console.log(`副本：${path.basename(SNAP)}  bytes=${bytes}  md5=${md5}`);

  const cdp = await bootEdge();
  const out = { snapshot: { bytes, md5 }, scenarios: {} };
  try {
    /* ---------- A 844×390 触屏态（改后） ---------- */
    await setViewport(cdp, { w: 844, h: 390, dpr: 3, mobile: true, orientation: 'landscape' }, true);
    await openBattle(cdp, '?mp=A');
    await sleep(600);
    const a = await cdp.ev(MEASURE_JS);
    await cdp.shot(path.join(OUT_DIR, 'fix_844x390_after.jpg'));
    out.scenarios.A_mobile_touch = a;
    console.log(`[A 844×390 触屏] 重叠=${a.overlapCount} 文字重叠=${a.textOverlapCount} HUDcore=${a.hudCorePct}% HUDctrl=${a.hudCtrlPct}% ` +
      `可玩带=${a.playBand}px/含控件=${a.playBandCtrl}px 目标条=${a.blocks.goal && a.blocks.goal.visible} "${a.blocks.goal && a.blocks.goal.text}" ` +
      `小地图=${a.blocks.minimap && a.blocks.minimap.visible} 目标<44=${a.targetTooSmall}`);

    /* ---------- B 1920×1080 桌面（无触控） ---------- */
    await setViewport(cdp, { w: 1920, h: 1080, dpr: 1, mobile: false, orientation: 'landscape' }, false);
    await openBattle(cdp, '?mp=B');
    const b = await cdp.ev(MEASURE_JS);
    /* 键盘回归：先量位置，按住 D 500ms，松开再量 */
    const p0 = await cdp.ev(`(function(){var s=typeof state!=='undefined'&&state;if(!s||!s.player)return null;return {x:s.player.x,y:s.player.y};})()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
    await sleep(500);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
    await sleep(250);
    const p1 = await cdp.ev(`(function(){var s=typeof state!=='undefined'&&state;if(!s||!s.player)return null;return {x:s.player.x,y:s.player.y};})()`);
    const keyState = await cdp.ev(`JSON.stringify((typeof state!=='undefined'&&state&&state.keys)||null)`);
    /* 施法：J 键，比较火焰粒子数 */
    const n0 = await cdp.ev(`(function(){var s=typeof state!=='undefined'&&state;return s&&s.particles?s.particles.length:-1;})()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74 });
    await sleep(120);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74 });
    await sleep(250);
    const n1 = await cdp.ev(`(function(){var s=typeof state!=='undefined'&&state;return s&&s.particles?s.particles.length:-1;})()`);
    await cdp.shot(path.join(OUT_DIR, 'fix_desktop1920.jpg'));
    out.scenarios.B_desktop = Object.assign({}, b, {
      keyboard: { p0: p0, p1: p1, moved: !!(p0 && p1 && (Math.abs(p1.x - p0.x) > 0.5 || Math.abs(p1.y - p0.y) > 0.5)),
                  keysAfter: keyState, particles0: n0, particles1: n1, castDetected: n1 > n0 }
    });
    console.log(`[B 1920×1080 桌面] arcm-on=${/arcm-on/.test(b.bodyClass)} 重叠=${b.overlapCount} 焚稿×技能树=${(b.overlaps.find(o=>/ash/.test(o.a+o.b)&&/dockSkill/.test(o.a+o.b))||{}).area||0}px² ` +
      `键盘移动=${out.scenarios.B_desktop.keyboard.moved} 施法=${out.scenarios.B_desktop.keyboard.castDetected}`);

    /* ---------- C 844×390 非触屏 + ?m=off（= 玩家实拍图的原始态，当"改前同机位"） ---------- */
    await setViewport(cdp, { w: 844, h: 390, dpr: 3, mobile: true, orientation: 'landscape' }, false);
    const cId = await injectNoTouch(cdp, false);
    await openBattle(cdp, '?m=off&mp=C');
    const c = await cdp.ev(MEASURE_JS);
    const cEnv = await cdp.ev(`({coarse: matchMedia('(pointer: coarse)').matches, maxTouch: navigator.maxTouchPoints, hasOnTouch: 'ontouchstart' in window, ui: document.body.classList.contains('touch-ui')})`);
    await cdp.shot(path.join(OUT_DIR, 'fix_844x390_moff.jpg'));
    out.scenarios.C_mobile_moff = Object.assign({}, c, { env: cEnv });
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: cId });
    console.log(`[C 844×390 原始态(非触屏+m=off)] touch-ui=${cEnv.ui} arcm-on=${/arcm-on/.test(c.bodyClass)} ` +
      `重叠=${c.overlapCount} 文字重叠=${c.textOverlapCount} HUDcore=${c.hudCorePct}% 可玩带=${c.playBand}px`);

    /* ---------- D 844×390 非触屏兜底（模拟玩家那张实拍图，触控层应救回来） ---------- */
    await setViewport(cdp, { w: 844, h: 390, dpr: 3, mobile: true, orientation: 'landscape' }, false);
    const dId = await injectNoTouch(cdp, true);
    await openBattle(cdp, '?mp=D');
    const d = await cdp.ev(MEASURE_JS);
    const dEnv = await cdp.ev(`({coarse: matchMedia('(pointer: coarse)').matches, maxTouch: navigator.maxTouchPoints, hasOnTouch: 'ontouchstart' in window})`);
    await cdp.shot(path.join(OUT_DIR, 'fix_844x390_notouch.jpg'));
    out.scenarios.D_mobile_notouch = Object.assign({}, d, { env: dEnv });
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: dId });
    console.log(`[D 844×390 非触屏兜底] coarse=${dEnv.coarse} maxTouch=${dEnv.maxTouch} ontouchstart=${dEnv.hasOnTouch} ` +
      `arcm-on=${/arcm-on/.test(d.bodyClass)} 重叠=${d.overlapCount} 文字重叠=${d.textOverlapCount} 摇杆=${d.blocks.stick && d.blocks.stick.visible}`);

    fs.writeFileSync(path.join(OUT_DIR, 'fix.json'), JSON.stringify(out, null, 1));
    console.log('已写 mobile/shots/fix.json');
  } finally {
    cdp.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
module.exports = { bootEdge, setViewport, openBattle, injectNoTouch, MEASURE_JS, envGuard };
