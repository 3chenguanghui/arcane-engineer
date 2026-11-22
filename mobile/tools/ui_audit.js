/**
 * ui_audit.js —— UI 基线自检的运行时采数（只读主文件）
 * ------------------------------------------------------------
 * 量取：
 *   A. 各界面状态下的字号档位（可见文本元素，computed font-size）
 *   B. 390 宽 / 844×390 横屏下可点元素是否 ≥44×44
 *   C. 键盘 Tab 是否走得完主要操作、焦点环是否可见（outline 宽度/颜色）
 *   D. 数字是否等宽（font-variant-numeric / font-family）、单位与空值表现
 *   E. 五态（空/加载/错误/成功/禁用）在 DOM/CSS 中的存在情况
 * 用法：node mobile/tools/ui_audit.js [--html <路径>] [--force]
 * 产物：mobile/shots/ui_audit.json + 若干截图
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9563;
const OUT_DIR = path.join(MOBILE_DIR, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const HTML = (argv.indexOf('--html') >= 0 ? argv[argv.indexOf('--html') + 1] : path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html'));

/** 页面内：测量当前状态下所有可见文本的字号与所有可点元素的尺寸/焦点环 */
const MEASURE_JS = `(function () {
  const vw = window.innerWidth, vh = window.innerHeight;
  function vis(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1.5 || r.height < 1.5) return false;
    if (r.right <= 1 || r.bottom <= 1 || r.left >= vw - 1 || r.top >= vh - 1) return false;
    return true;
  }
  function name(el) {
    if (!el) return 'null';
    if (el.id) return '#' + el.id;
    const c = (typeof el.className === 'string') ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (c ? '.' + c : '');
  }
  /* ---- A. 字号档位 ---- */
  const fonts = {};
  const fontExamples = {};
  document.querySelectorAll('.stage *, body > div').forEach(function (el) {
    if (!vis(el)) return;
    const hasText = Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    if (!hasText) return;
    const fs2 = (parseFloat(getComputedStyle(el).fontSize) || 0).toFixed(1);
    fonts[fs2] = (fonts[fs2] || 0) + 1;
    if (!fontExamples[fs2]) fontExamples[fs2] = name(el) + ' ' + (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 14);
  });
  /* ---- B. 可点元素 ---- */
  const taps = [];
  document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"]), .mini-card, .reward-card, .tree-node')
    .forEach(function (el) {
      if (!vis(el)) return;
      const cs = getComputedStyle(el);
      if (cs.pointerEvents === 'none') return;
      const r = el.getBoundingClientRect();
      taps.push({ name: name(el), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
                  text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 12),
                  disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' });
    });
  /* ---- D. 数字类元素 ---- */
  const nums = [];
  document.querySelectorAll('.stage *, body > div').forEach(function (el) {
    if (!vis(el)) return;
    const t = (el.innerText || '').trim();
    if (!t || t.length > 24) return;
    if (!/[0-9]/.test(t)) return;
    const hasOwnText = Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && /[0-9]/.test(n.nodeValue); });
    if (!hasOwnText) return;
    const cs = getComputedStyle(el);
    nums.push({ name: name(el), text: t.replace(/\\s+/g, ' ').slice(0, 20),
                fvn: cs.fontVariantNumeric || '', ff: cs.fontFamily.split(',')[0].replace(/"/g, '') });
  });
  /* ---- E. 五态 ---- */
  const states = {
    emptyEls: document.querySelectorAll('[class*="empty"], [data-state="empty"]').length,
    loadingEls: document.querySelectorAll('[class*="loading"], [class*="skeleton"], [data-state="loading"]').length,
    errorEls: document.querySelectorAll('[class*="error"], [data-state="error"]').length,
    successEls: document.querySelectorAll('[class*="success"], [data-state="success"]').length,
    disabledEls: document.querySelectorAll('[disabled], [aria-disabled="true"]').length,
    disabledVisible: Array.prototype.filter.call(document.querySelectorAll('[disabled], [aria-disabled="true"]'), vis).length
  };
  return { vw: vw, vh: vh, fonts: fonts, fontExamples: fontExamples, taps: taps, nums: nums, states: states,
           domText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) };
})()`;

/** 启动无头 Edge 并返回 CDP 封装 */
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
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/** 切换视口并加载页面 */
async function goto(cdp, w, h, mobile, dpr) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: dpr, mobile: mobile,
    screenWidth: w, screenHeight: h,
    screenOrientation: { type: h > w ? 'portraitPrimary' : 'landscapePrimary', angle: h > w ? 0 : 90 }
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await cdp.send('Page.navigate', { url: 'file:///' + HTML.replace(/\\/g, '/') + '?ui=' + w + 'x' + h });
  for (let i = 0; i < 120; i += 1) {
    const ok = await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`);
    if (ok) break;
    await sleep(200);
  }
  await sleep(700);
}

/** 进入战斗（标题 → 选角 → 第一层），返回是否成功 */
async function enterBattle(cdp) {
  await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
  await sleep(700);
  let playing = await cdp.ev(`state.mode === 'playing'`);
  if (!playing) {
    await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
  }
  for (let i = 0; i < 90; i += 1) {
    playing = await cdp.ev(`state.mode === 'playing'`);
    if (playing) break;
    await sleep(200);
  }
  await sleep(4200);
  return playing;
}

/** 发送一次键盘动作（keyDown + keyUp） */
async function key(cdp, keyName, code, vk) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(220);
}

/** 读取当前焦点元素与焦点环信息 */
const FOCUS_JS = `(function(){
  const el = document.activeElement;
  if (!el || el === document.body) return { none: true };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { tag: el.tagName, id: el.id || '', cls: (typeof el.className==='string'?el.className:'').split(/\\s+/).slice(0,2).join('.'),
           text: (el.innerText||el.value||'').replace(/\\s+/g,' ').trim().slice(0,16),
           outlineW: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor,
           boxShadow: cs.boxShadow.slice(0, 60), w: Math.round(r.width), h: Math.round(r.height),
           inView: r.top >= -1 && r.bottom <= window.innerHeight + 1 };
})()`;

/** 主流程 */
async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = { html: HTML, bytes: fs.statSync(HTML).size, at: new Date().toISOString(), runs: {} };
  const cdp = await bootEdge();
  try {
    // ---------- 390×844 竖屏：标题页 ----------
    await goto(cdp, 390, 844, true, 3);
    out.runs.title390 = await cdp.ev(MEASURE_JS);
    await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }).then(r => fs.writeFileSync(path.join(OUT_DIR, 'ui_title_390x844.jpg'), Buffer.from(r.data, 'base64')));

    // ---------- 390×844 竖屏：选角页 ----------
    await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
    await sleep(900);
    out.runs.char390 = await cdp.ev(MEASURE_JS);
    await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }).then(r => fs.writeFileSync(path.join(OUT_DIR, 'ui_char_390x844.jpg'), Buffer.from(r.data, 'base64')));

    // ---------- 桌面 1280×720：键盘 Tab 遍历（标题页） ----------
    await goto(cdp, 1280, 720, false, 1);
    const tabs = [];
    for (let i = 0; i < 22; i += 1) {
      await key(cdp, 'Tab', 'Tab', 9);
      tabs.push(await cdp.ev(FOCUS_JS));
    }
    out.runs.tabTitle = tabs;

    // ---------- 桌面 1280×720：进入战斗后的 HUD/面板 ----------
    const ok = await enterBattle(cdp);
    out.runs.playingDesktop = ok ? await cdp.ev(MEASURE_JS) : { failed: true };
    await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }).then(r => fs.writeFileSync(path.join(OUT_DIR, 'ui_playing_1280x720.jpg'), Buffer.from(r.data, 'base64')));

    // 地图 / 技能树 / 设置 三个面板
    const panels = [['map', 'm', 'KeyM', 77], ['tree', 't', 'KeyT', 84], ['settings', 'o', 'KeyO', 79]];
    for (const [tag, k, code, vk] of panels) {
      await key(cdp, k, code, vk);
      await sleep(700);
      out.runs['panel_' + tag] = await cdp.ev(MEASURE_JS);
      await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }).then(r => fs.writeFileSync(path.join(OUT_DIR, 'ui_panel_' + tag + '.jpg'), Buffer.from(r.data, 'base64')));
      await key(cdp, 'Escape', 'Escape', 27);
      await sleep(500);
    }

    // ---------- 横屏 844×390：实战 HUD 可点尺寸 ----------
    await goto(cdp, 844, 390, true, 3);
    const ok2 = await enterBattle(cdp);
    out.runs.land = ok2 ? await cdp.ev(MEASURE_JS) : { failed: true };
    await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }).then(r => fs.writeFileSync(path.join(OUT_DIR, 'ui_land_844x390.jpg'), Buffer.from(r.data, 'base64')));

    // ---------- 键盘 Tab 遍历（战斗中） ----------
    await goto(cdp, 1280, 720, false, 1);
    await enterBattle(cdp);
    const tabs2 = [];
    for (let i = 0; i < 18; i += 1) {
      await key(cdp, 'Tab', 'Tab', 9);
      tabs2.push(await cdp.ev(FOCUS_JS));
    }
    out.runs.tabPlaying = tabs2;
  } finally {
    cdp.close();
  }
  fs.writeFileSync(path.join(OUT_DIR, 'ui_audit.json'), JSON.stringify(out, null, 2));
  console.log('written: ' + path.join(OUT_DIR, 'ui_audit.json'));
  // 控制台简表
  for (const k of Object.keys(out.runs)) {
    const v = out.runs[k];
    if (Array.isArray(v)) {
      console.log('[' + k + '] ' + v.length + ' 次 Tab；可见焦点环=' + v.filter(x => x && x.outlineStyle !== 'none' && parseFloat(x.outlineW) > 0).length + '；到 body=' + v.filter(x => x && x.none).length);
    } else if (v && v.fonts) {
      const tiers = Object.keys(v.fonts).sort((a, b) => parseFloat(a) - parseFloat(b));
      console.log('[' + k + '] 字号档=' + tiers.length + ' (' + tiers.join('/') + ') 可点=' + v.taps.length + ' <44=' + v.taps.filter(t => t.w < 44 || t.h < 44).length);
    } else {
      console.log('[' + k + '] ' + JSON.stringify(v).slice(0, 80));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
