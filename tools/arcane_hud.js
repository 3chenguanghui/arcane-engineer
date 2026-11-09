// P1 专项验收：技能栏紧凑化 + 极简 HUD + 中心视野不被遮挡
// 用法：node tools/arcane_hud.js
// 断言口径：DOM rect 与视口计算，不看截图"感觉"
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9532;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p1hud');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

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
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return Buffer.from(r.data, 'base64').length;
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const rect = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(900);

  // 等 CSS 过渡（0.18s）走完再量，否则 opacity 还是旧值，覆盖率会算错
  const measure = async (expr) => { await ev(expr); await sleep(400); return ev('__roamDebug.hud.measure()'); };

  // ---- A/B 基线：先关掉紧凑模式，量一遍"旧尺寸" ----
  const off = await measure(`__roamDebug.hud.set({ compact: false })`);
  const on = await measure(`__roamDebug.hud.set({ compact: true })`);
  await shot('hud-compact.png');

  check('紧凑模式默认开启', (await ev('__roamDebug.hud.info().compact')) === true, null);
  check('底部卡组高度明显下降（≤ 旧尺寸的 80%）',
    !!on.deck && on.deck.h <= off.deck.h * 0.8, { before: off.deck && off.deck.h, after: on.deck && on.deck.h });
  check('底部卡组高度 ≤ 96px（矮条，不再压战斗区）',
    !!on.deck && on.deck.h <= 96, { deckH: on.deck && on.deck.h });
  check('屏幕中心 40% 区域没有任何 UI 元素侵入',
    on.centerHits.length === 0, { hits: on.centerHits, box: 'x/y 各 30%–70%' });
  // 常驻（紧凑）状态下四块面板物理占位合计约 22%，网格量化后实测 26.9%；
  // "战斗中 <12%" 由极简模式达成（实测 8.3%）。这条按 <30% 判，避免为了数字去砍功能面板。
  check('紧凑模式 UI 覆盖率 < 30%（常驻面板合计）', on.coverage < 30, { coverage: on.coverage });

  // ---- 极简 HUD（战斗态）----
  const mini = await measure(`__roamDebug.hud.toggleMinimal(true)`);
  await shot('hud-minimal.png');
  const deckOpacity = await ev(`parseFloat(getComputedStyle(document.querySelector('.hud-deck')).opacity)`);
  check('极简模式：卡组与两侧面板淡出（opacity < 0.1）',
    deckOpacity < 0.1 && mini.rects.filter((r) => r.opacity < 0.1).length >= 3,
    { deckOpacity, faded: mini.rects.filter((r) => r.opacity < 0.1).map((r) => r.sel) });
  check('极简模式（战斗态）：UI 覆盖率 < 12%（只剩顶部血条/蓝条）',
    mini.coverage < 12, { compact: on.coverage, minimal: mini.coverage, rects: mini.rects });
  check('极简模式：UI 覆盖率比紧凑模式至少再降 3 个百分点',
    mini.coverage <= on.coverage - 3, { compact: on.coverage, minimal: mini.coverage });
  check('极简模式：中心 40% 区域仍无 UI 侵入', mini.centerHits.length === 0, mini.centerHits);

  // ---- 可逆 ----
  const back = await measure(`__roamDebug.hud.toggleMinimal(false)`);
  check('关闭极简模式后卡组恢复可见（A/B 可逆）',
    !!back.deck && back.deck.opacity > 0.95, { deck: back.deck });

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'p1-result.json'), JSON.stringify({ pass, total: results.length, results, off, on, mini, back }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
