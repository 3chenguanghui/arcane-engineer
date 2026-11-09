// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 场景/UI 截图核对脚本：开始页 → 三层战斗 → 奖励 → 规则 → 结算
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9677;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'scene_shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push('CONSOLE.ERROR: ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => { seq += 1; pending.set(seq, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: seq, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await shot('s01_title.png');
  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(900);
  await ev(`(() => { const d = window.__roamDebug; d.centerPlayer(); d.spawnEnemy('wanderer', 210, -130); d.spawnEnemy('sentinel', -220, 40); d.spawnEnemy('shooter', 40, 220); return d.getState().floor; })()`);
  await sleep(420);
  await shot('s02_battle_f1.png');

  // 第二层（符文层）
  await ev(`(() => { const d = window.__roamDebug; d.setFloor(2); d.centerPlayer(); d.spawnEnemy('wanderer', 220, 60); d.spawnEnemy('shooter', -210, -50); return true; })()`);
  await sleep(420);
  await shot('s03_battle_f2.png');

  // 第三层（虚空层）
  await ev(`(() => { const d = window.__roamDebug; d.setFloor(3); d.centerPlayer(); d.spawnEnemy('phaser', 220, -110); d.spawnEnemy('wanderer', -200, 120); return true; })()`);
  await sleep(420);
  await shot('s04_battle_f3.png');

  // 奖励页
  await ev(`(() => { const d = window.__roamDebug; d.setFloor(1); d.openReward(); return true; })()`);
  await sleep(600);
  await shot('s05_reward.png');

  // 规则页
  await ev(`(() => { const d = window.__roamDebug; d.chooseReward(window.__roamDebug.getState().options[0]); document.getElementById('btnRules').click(); return true; })()`);
  await sleep(600);
  await shot('s06_rules.png');
  await ev(`(() => { const b = document.getElementById('btnCloseRules') || document.getElementById('rulesClose'); if (b) b.click(); else document.getElementById('btnRules').click(); return true; })()`);
  await sleep(400);

  // 结算页
  await ev(`(() => { const d = window.__roamDebug; d.forceDeath(); return true; })()`);
  await sleep(700);
  await shot('s07_result.png');

  // 布局与状态检查
  const check = await ev(`(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }; };
    const deck = box('.hud-deck'), map = box('.minimap-panel'), fp = box('.floor-panel'), top = box('.hud-top');
    const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.b && b.y < a.b;
    return {
      viewW: window.innerWidth, viewH: window.innerHeight,
      deck, map, fp, top,
      deckInView: deck ? (deck.b <= window.innerHeight + 1 && deck.x >= 0) : null,
      mapOverlapsDeck: overlap(map, deck),
      fpOverlapsMap: overlap(fp, map),
      fpOverlapsDeck: overlap(fp, deck),
      playerVisible: window.__roamDebug.getState().hp > 0
    };
  })()`);
  console.log(JSON.stringify({ check, consoleErrors }, null, 2));
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
