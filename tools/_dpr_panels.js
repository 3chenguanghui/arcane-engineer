/**
 * 高分屏六面板复验（dpr 1.5 / 2.0）
 * 依次打开：说明 rules / 地图 map / 技能树 skilltree / 天赋 talent / 结算 result / 设置 settings，
 * 每个面板做"是否超出视口 / 文字是否被裁 / 是否横向溢出"三项体检，并截图。
 * 用法：node tools\_dpr_panels.js   （端口 9590）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9590;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const SHOT = path.join(ROOT, '.screenshots', 'dpr');
const W = 1600;
const H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并按指定 dpr 建立页面
 * @param {number} dpr 设备像素比
 * @returns {Promise<Object>} CDP 句柄 { send, ev, shot, ws, edge }
 */
async function boot(dpr) {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--window-size=${W},${H}`, 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const runtimeErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push((d && d.exception && (d.exception.description || d.exception.value)) || (d && d.text) || 'unknown');
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dpr, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2500);
  return { send, ev, shot, ws, edge, runtimeErrors };
}

/**
 * 面板体检：把所有可见子元素的盒子与视口比对
 * @param {string} sel 面板选择器
 * @returns {Promise<Object>} 体检结果
 */
const MEASURE = (sel) => `(() => {
  var el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { missing: true };
  var vw = innerWidth, vh = innerHeight;
  var r = el.getBoundingClientRect();
  /* 真实缺陷 = 溢出视口且不在任何"可滚动祖先"里（用户滚不到）。
     可滚动容器里的延伸属于"内容比一屏长"，不是错位，单列计数。 */
  function scrollHost(n) {
    var cur = n;
    while (cur && cur !== document.body) {
      var cs = getComputedStyle(cur);
      var sy = /auto|scroll/.test(cs.overflowY) && cur.scrollHeight > cur.clientHeight + 2;
      var sx = /auto|scroll/.test(cs.overflowX) && cur.scrollWidth > cur.clientWidth + 2;
      if (sy || sx) return { y: sy, x: sx };
      cur = cur.parentElement;
    }
    return null;
  }
  var badRight = 0, minLeft = 0, badBottom = 0, clipped = 0, overX = 0, hidden = 0;
  var scrollBottom = 0, scrollRight = 0, scrollHosts = 0;
  var maxRight = 0, maxBottom = 0;
  var nodes = el.querySelectorAll('*');
  for (var i = 0; i < nodes.length; i += 1) {
    var n = nodes[i];
    var cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') { hidden += 1; continue; }
    var op = parseFloat(cs.opacity);
    if (op === 0) { hidden += 1; continue; }
    var b = n.getBoundingClientRect();
    if (b.width <= 0 && b.height <= 0) continue;
    var host = scrollHost(n);
    if (host) scrollHosts += 1;
    var overB = b.bottom - vh, overR = b.right - vw;
    if (overB > maxBottom) maxBottom = overB;
    if (overR > maxRight) maxRight = overR;
    if (b.left < minLeft) minLeft = b.left;
    if (overB > 2) {
      if (host && host.y) scrollBottom += 1;
      else if (overB > badBottom) badBottom = overB;
    }
    if (overR > 2) {
      if (host && host.x) scrollRight += 1;
      else if (overR > badRight) badRight = overR;
    }
    /* 文字被裁：有文本、内容盒比可视盒大、overflow 是 hidden/clip，且滚不到 */
    var hasText = (n.textContent || '').trim().length > 0 && n.children.length === 0;
    if (hasText && (n.scrollWidth > n.clientWidth + 2) && /hidden|clip/.test(cs.overflowX) && !(host && host.x)) overX += 1;
    if (hasText && (n.scrollHeight > n.clientHeight + 2) && /hidden|clip/.test(cs.overflowY) && !(host && host.y)) clipped += 1;
  }
  var canvas = document.querySelector('canvas');
  var cr = canvas ? canvas.getBoundingClientRect() : null;
  return {
    vw: vw, vh: vh, dpr: devicePixelRatio,
    root: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    badRight: Math.round(badRight), badBottom: Math.round(badBottom), minLeft: Math.round(minLeft),
    maxRight: Math.round(maxRight), maxBottom: Math.round(maxBottom),
    scrollBottom: scrollBottom, scrollRight: scrollRight, scrollHosts: scrollHosts,
    clippedText: clipped, textOverflowX: overX,
    panelScrollY: el.scrollHeight > el.clientHeight + 2 ? el.scrollHeight - el.clientHeight : 0,
    pageScrollX: document.documentElement.scrollWidth - vw,
    visibleNodes: nodes.length - hidden,
    canvas: cr ? { backing: canvas.width, cssW: Math.round(cr.width), ratio: +(canvas.width / cr.width).toFixed(2) } : null
  };
})()`;

/**
 * 主流程：两档 dpr × 六个面板
 * @returns {Promise<void>}
 */
async function main() {
  if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
  const results = [];
  const checks = [];
  const ok = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail));
  };

  const panels = [
    { key: 'rules', name: '说明', sel: '#rulesPanel', open: `openPanel('rules')` },
    { key: 'map', name: '地图', sel: '#mapPanel', open: `openPanel('map')` },
    { key: 'skilltree', name: '技能树', sel: '#skillTreePanel', open: `openPanel('skilltree')` },
    { key: 'talent', name: '天赋', sel: '#talentLayer', open: `openTalentsPage()` },
    { key: 'result', name: '结算', sel: '#modalLayer .modal.result-modal', open: `showResult()` },
    { key: 'settings', name: '设置', sel: '#settingsPanel', open: `openPanel('settings')` }
  ];

  for (const dpr of [1.5, 2]) {
    const h = await boot(dpr);
    try {
      const btn = await h.ev(`(() => { var b = document.getElementById('btnStart'); var r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await h.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await sleep(1400);
      await h.ev(`(() => { __roamDebug.killAllEnemies(); return true; })()`);
      await sleep(300);
      /* 让玩家有一点进度，结算页/天赋页数据不是全 0 */
      await h.ev(`(() => { state.player.hp = state.player.hpMax; return true; })()`);

      const row = { dpr, panels: {} };
      for (const p of panels) {
        /* 面板之间互斥：先全关再开 */
        await h.ev(`(() => { try { closePanel('rules'); closePanel('map'); closePanel('skilltree'); closePanel('settings'); } catch (e) {} if (state.mode === 'result') { state.mode = 'playing'; } if (ui.modalLayer) { ui.modalLayer.classList.add('hidden'); ui.modalLayer.setAttribute('aria-hidden', 'true'); } try { closeTalentsPage(); } catch (e) {} return true; })()`);
        await sleep(200);
        const opened = await h.ev(`(() => { var r = ${p.open}; if (r === false) return 'OPEN-FAIL'; return true; })()`);
        await sleep(450);
        const m = await h.ev(MEASURE(p.sel));
        await h.shot('dpr' + dpr + '-' + p.key);
        row.panels[p.key] = { name: p.name, opened: opened, m: m };
        console.log('  dpr' + dpr + ' · ' + p.name + ' · ' + JSON.stringify(m));
      }
      results.push(row);

      /* 断言：每个面板都在视口内、没有溢出、没有裁字 */
      for (const p of panels) {
        const m = row.panels[p.key].m || {};
        const inside = !m.missing && m.badRight <= 2 && m.badBottom <= 2 && m.minLeft >= -2 && (m.pageScrollX || 0) <= 2;
        const textOk = (m.clippedText || 0) === 0 && (m.textOverflowX || 0) === 0;
        ok('D' + (dpr === 1.5 ? '' : '2') + ' ' + p.name + ' · dpr' + dpr + ' 不出界 / 不裁字', inside && textOk, {
          root: m.root, 不可达溢出右: m.badRight, 不可达溢出下: m.badBottom, minLeft: m.minLeft,
          /* 这些是在可滚动容器里的延伸：用户能滚到，不算错位 */
          可滚动下延伸: m.scrollBottom, 可滚动右延伸: m.scrollRight, 滚动容器: m.scrollHosts,
          clippedText: m.clippedText, textOverflowX: m.textOverflowX, pageScrollX: m.pageScrollX,
          面板自身滚动: m.panelScrollY
        });
      }
      ok('D3 dpr' + dpr + ' · 页面无横向滚动 & 无运行时报错', (await h.ev(`(() => document.documentElement.scrollWidth <= innerWidth + 2)()`)) && h.runtimeErrors.length === 0, { errors: h.runtimeErrors.slice(0, 5) });
    } finally {
      h.ws.close();
      killEdge(h.edge);
    }
  }

  const out = { at: new Date().toISOString(), results, checks };
  fs.writeFileSync(path.join(SHOT, 'dpr-result.json'), JSON.stringify(out, null, 2));
  const failed = checks.filter((c) => !c.pass).length;
  console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS') + '  ' + (checks.length - failed) + '/' + checks.length);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
