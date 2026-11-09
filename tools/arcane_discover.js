// P2 专项验收：可发现性（左下地图 M / 右侧技能树 T + 新号前 3 局提示）
// 用法：node tools/arcane_discover.js
// 断言口径：DOM 可见性 + 真实鼠标点击 + 快捷键派发；不看"感觉"
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9533;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p2discover');

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
  /** 用 CDP 真实点击某个元素中心 */
  const clickEl = async (selector) => {
    const pos = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || parseFloat(cs.opacity) < 0.05) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!pos) return false;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    return true;
  };
  /** 在页面里派发一次 keydown（走游戏自己的 handleKeyDown） */
  const pressKey = (key) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);

  // ---- 开局：计时从点击"开始探索"算起 ----
  const tStart = Date.now();
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(800);

  const first = await ev('__roamDebug.discover.info()');
  const hintDebug = await ev(`(() => { const el = document.getElementById('introHint');
    const cs = getComputedStyle(el);
    return { cls: el.className, opacity: cs.opacity, display: cs.display, visibility: cs.visibility }; })()`);
  await shot('discover-after.png');

  check('首局开局提示出现（新号第 1 局）', first.hintVisible === true && first.shownRuns.indexOf(1) >= 0,
    { hintVisible: first.hintVisible, shownRuns: first.shownRuns, runs: first.runs, hintDebug });
  check('提示文案提到 M 与技能树 T',
    /按 ?M/.test(first.hintText) && /技能树/.test(first.hintText) && /T/.test(first.hintText),
    first.hintText);
  check('两个常驻入口在战斗中可见（地图 / 技能树）',
    first.entries.map === true && first.entries.skill === true, first.entries);
  check('地图入口在左下、技能树入口在右侧（不压中心 40%）', (() => {
    const vw = 1440;
    const vh = 900;
    const m = first.entries.mapRect;
    const s = first.entries.skillRect;
    if (!m || !s) return false;
    const inCenter = (r) => !(r.x + r.w <= vw * 0.3 || r.x >= vw * 0.7 || r.y + r.h <= vh * 0.3 || r.y >= vh * 0.7);
    return m.x < vw * 0.3 && inCenter(m) === false && s.x > vw * 0.5 && inCenter(s) === false;
  })(), { map: first.entries.mapRect, skill: first.entries.skillRect });

  // ---- 30 秒内点到两个入口（真实鼠标） ----
  const mapClicked = await clickEl('#btnMapDock');
  await sleep(500);
  const mapOpen = await ev(`__roamDebug.map.info().open`);
  await shot('discover-map-entry.png');
  await ev(`__roamDebug.map.close()`);
  await sleep(300);

  const skillClicked = await clickEl('#btnSkillDock');
  await sleep(450);
  const skillOpen = await ev(`state.mode === 'skilltree'`);
  await shot('discover-skill-entry.png');
  await ev(`closePanel('skilltree')`);
  await sleep(500);
  const tEnd = Date.now();
  const clickSeconds = Math.round((tEnd - tStart) / 100) / 10;

  check('30 秒内点到"地图"入口并打开全屏地图', mapClicked && mapOpen === true,
    { clicked: mapClicked, open: mapOpen, seconds: clickSeconds });
  check('30 秒内点到"技能树"入口并打开技能树', skillClicked && skillOpen === true,
    { clicked: skillClicked, open: skillOpen, seconds: clickSeconds });
  check('两个入口点击总耗时 < 30 秒', clickSeconds < 30, { seconds: clickSeconds });

  // ---- 快捷键 M / T ----
  await pressKey('m');
  await sleep(300);
  const byKeyM = await ev(`state.mode === 'map'`);
  await pressKey('m');
  await sleep(250);
  const mClosed = await ev(`state.mode === 'playing'`);
  check('快捷键 M 打开地图，再按一次关闭', byKeyM === true && mClosed === true, { opened: byKeyM, closed: mClosed });

  await pressKey('t');
  await sleep(300);
  const byKeyT = await ev(`state.mode === 'skilltree'`);
  await pressKey('t');
  await sleep(250);
  const tClosed = await ev(`state.mode === 'playing'`);
  check('快捷键 T 打开技能树，再按一次关闭', byKeyT === true && tClosed === true, { opened: byKeyT, closed: tClosed });

  // ---- ✕ 永久关闭提示 ----
  const hintHit = await ev(`(() => {
    const el = document.getElementById('introHintClose');
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x: Math.round(x), y: Math.round(y), hit: hit ? (hit.id || hit.className || hit.tagName) : null };
  })()`);
  const closeClicked = await clickEl('#introHintClose');
  await sleep(300);
  const dismissed = await ev('__roamDebug.discover.info()');
  check('点 ✕ 后提示隐藏且记为"不再提示"',
    closeClicked && dismissed.hintVisible === false && dismissed.dismissed === true,
    { clicked: closeClicked, hintVisible: dismissed.hintVisible, dismissed: dismissed.dismissed, hit: hintHit });

  // ---- "新号前 3 局各提示一次"规则（清掉本地记录后逐局验证） ----
  const rule = await ev(`(() => {
    __roamDebug.discover.reset();
    const out = [];
    state.meta.runs = 2; out.push(!!maybeShowIntroHint());
    state.meta.runs = 3; out.push(!!maybeShowIntroHint());
    state.meta.runs = 3; out.push(!!maybeShowIntroHint());   // 同一局再调一次
    state.meta.runs = 4; out.push(!!maybeShowIntroHint());
    return out;
  })()`);
  check('第 2 / 3 局各提示一次，同一局不重复，第 4 局不再提示',
    rule[0] === true && rule[1] === true && rule[2] === false && rule[3] === false, { results: rule });
  await ev('hideIntroHint(false)');

  // ---- A/B: 关掉总开关（入口与提示一起消失） ----
  await sleep(250);
  const off = await ev('__roamDebug.discover.set({ enabled: false })');
  await shot('discover-before.png');
  check('A/B 关闭：两个常驻入口不可见', off.entries.map === false && off.entries.skill === false,
    { map: off.entries.map, skill: off.entries.skill });
  const on = await ev(`__roamDebug.discover.set({ enabled: true }); __roamDebug.discover.reset();
    state.meta.runs = 1; maybeShowIntroHint(); __roamDebug.discover.info();`);
  await sleep(350);
  check('A/B 重新开启：入口恢复可见且提示条可再次显示',
    on.entries.map === true && on.entries.skill === true,
    { map: on.entries.map, skill: on.entries.skill });

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'p2-result.json'),
    JSON.stringify({ pass, total: results.length, results, clickSeconds, first, rule }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
