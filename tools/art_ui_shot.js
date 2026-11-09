/**
 * C1-10 第 4 步截图器：UI 统一改前 / 改后
 * ------------------------------------------------------------
 * 说明：UI 在前几轮已做过一轮令牌化（--r-* / --sp-* / --surface-* / --mat-*），
 * 所以本轮不是"重画"，而是把残留裸值收回令牌，并用同一套材质复核四类面。
 * 为了保证"改前"可复现，卡牌圆角走了 --ui-card-r 变量：
 *   - 改前：把它写成旧裸值 11px；
 *   - 改后：移除该变量，落回 var(--r-md)=12px。
 * 同时补一张结算页，证明它与奖励页共用同一套圆角/描边/阴影。
 * 用法：node tools/art_ui_shot.js
 * @returns {Promise<void>}
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9697;
const OUT = path.join(__dirname, '..', '.screenshots', 'art', 'step4');
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程
 * @returns {Promise<void>}
 */
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
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
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
    return fs.statSync(path.join(OUT, name)).size;
  };

  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(700);

  // ---- 奖励卡牌（四张同屏，最能量出圆角/间距/材质是否一致）----
  const cards = await ev(`(() => {
    const d = window.__roamDebug;
    const keys = d.openReward('skill');
    return keys;
  })()`);
  await sleep(520);
  await ev(`document.documentElement.style.setProperty('--ui-card-r', '11px'); true`);
  await sleep(160);
  const rewardBefore = await shot('reward-before.png');
  await ev(`document.documentElement.style.removeProperty('--ui-card-r'); true`);
  await sleep(160);
  const rewardAfter = await shot('reward-after.png');

  // ---- 结算页（同一套圆角/描边/阴影的证明）----
  await ev(`(() => { const d = window.__roamDebug; d.chooseReward(${JSON.stringify(cards && cards[0] ? cards[0] : '')}); return true; })()`);
  await sleep(400);
  await ev(`(() => { window.__roamDebug.forceDeath(); return true; })()`);
  await sleep(700);
  const resultShot = await shot('result-after.png');

  console.log(JSON.stringify({
    ok: true, out: OUT,
    cards,
    sizes: { rewardBefore, rewardAfter, resultShot },
    errors
  }, null, 2));

  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
