/**
 * 只读探针：技能融合到底哪里不对
 * ------------------------------------------------------------
 * 用法：node tools/diag_fuse.js
 * 步骤：开局 → 读解锁/持有 → 首次按 F（未解锁）→ 内存解锁再按 F（无可融合）→
 *      内存塞一组可配对的魔法+科技再按 F（应成功）→ 打印每步 toast 与状态。
 * 只改内存，不写存档（结束时不动 localStorage）。
 */
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9762;
const FILE = path.resolve(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 主流程：起浏览器 → 开局 → 分三步试融合 → 打印读数 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.text || '') + ' ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("document.getElementById('btnStart').click()");
  await sleep(500);
  await ev("const c=document.querySelector('.char-card'); if(c) c.click();");
  await sleep(300);
  await ev("const b=document.getElementById('btnCharConfirm'); if(b) b.click();");
  await sleep(1600);

  const snap = () => ev(`(() => {
    const t = Array.prototype.slice.call(document.querySelectorAll('[class*=toast],[id*=toast]'))
      .map((el) => ({ txt: (el.textContent || '').trim(), shown: el.dataset.on !== '0' && !el.classList.contains('is-hidden') && el.offsetParent !== null }))
      .filter((x) => x.txt && x.shown);
    return {
      unlocked: isUnlocked('fusion'),
      magic: (state.ownedMagic || []).slice(),
      tech: (state.ownedTech || []).slice(),
      fusions: (state.fusions || []).slice(),
      avail: getAvailableFusions().map((f) => f.id),
      toast: t.map((x) => x.txt).join(' | ').slice(0, 160),
      onboard: typeof onboardHintVisible === 'function' ? onboardHintVisible() : null,
      queue: (typeof toastQueue !== 'undefined' && toastQueue) ? toastQueue.map((q) => q.message).slice(0, 4) : null,
      busyMs: (typeof toastBusyUntil !== 'undefined') ? Math.round(toastBusyUntil - nowMs()) : null
    };
  })()`);

  console.log('STEP1 初始状态', JSON.stringify(await snap()));

  /* 第一步：未解锁状态按 F（模拟真实按键路径） */
  await ev("tryFuse && tryFuse(); true");
  await sleep(320);
  console.log('STEP2 未解锁按F', JSON.stringify(await snap()));

  /* 第二步：内存里解锁，仍然没有可配对的模块时按 F */
  await ev("unlockMetaRoot().fusion = true; true");
  await ev("tryFuse && tryFuse(); true");
  await sleep(320);
  console.log('STEP3 解锁但无组合', JSON.stringify(await snap()));

  /* 第三步：塞一组真实可配对的 magic+tech，再按 F */
  await ev(`(() => {
    const pair = FUSION_CONFIG.find((f) => !(state.ownedMagic || []).includes(f.magic) && !(state.ownedTech || []).includes(f.tech));
    if (!pair) return 'NO_PAIR';
    state.ownedMagic.push(pair.magic);
    state.ownedTech.push(pair.tech);
    window.__PAIR = pair.id;
    return pair.id;
  })()`).then((v) => console.log('STEP4 注入配方', v));
  await sleep(200);
  console.log('STEP4 注入后', JSON.stringify(await snap()));
  await ev("tryFuse && tryFuse(); true");
  await sleep(400);
  console.log('STEP5 有组合按F', JSON.stringify(await snap()));

  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
