/**
 * 标题页首屏适配量尺（只读）
 * ------------------------------------------------------------
 * 用途：B4 把按钮抬到 44px 后，标题页「永久天赋」第三行被 .title-secondary
 *       的 overflow 裁掉。本脚本在 1440×900 下量出各区块的真实高度与溢出量，
 *       用于决定要回收多少垂直间距（不靠截图反复试）。
 * 用法：node _probe/title_fit.js [可执行文件路径]
 * 产出：控制台 JSON（含 neededRecoverPx）；不写主文件、不截图。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-fit-${process.pid}-${Date.now()}`);
const PORT = 9791;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 Edge headless 并连上 CDP
 * @returns {Promise<{send:Function, ev:Function, close:Function}>}
 */
async function boot() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', '--hide-scrollbars', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    send,
    ev,
    close: async () => {
      try { ws.close(); } catch (e) { /* ignore */ }
      try { edge.kill(); } catch (e) { /* ignore */ }
      await sleep(500);
      try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch (e) { /* ignore */ }
    }
  };
}

/**
 * 主流程：打开主文件，量标题页布局
 * @returns {Promise<void>}
 */
async function main() {
  const t = await boot();
  try {
    await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
    await sleep(2600);
    const m = await t.ev(`(() => {
      const q = (s) => document.querySelector(s);
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1) }; };
      const sec = q('#titleLayer .title-secondary');
      const talents = q('#titleLayer .title-talents');
      const body = q('#titleLayer .talents-body');
      const rows = Array.from(document.querySelectorAll('#titleLayer .talent-row')).map((el) => ({ text: el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 18), h: +el.getBoundingClientRect().height.toFixed(1), bottom: +el.getBoundingClientRect().bottom.toFixed(1) }));
      const card = q('#titleLayer .title-card-v8');
      const cs = getComputedStyle(card);
      return {
        viewport: { w: innerWidth, h: innerHeight },
        card: { ...box(card), padTop: cs.paddingTop, padBottom: cs.paddingBottom, gap: cs.gap },
        hero: box(q('#titleLayer .title-hero')),
        primary: box(q('#titleLayer .title-primary')),
        secondary: sec ? { ...box(sec), scrollH: sec.scrollHeight, clientH: sec.clientHeight, overflow: +(sec.scrollHeight - sec.clientHeight).toFixed(1) } : null,
        talents: box(talents),
        talentsBody: body ? { ...box(body), scrollH: body.scrollHeight, clientH: body.clientHeight } : null,
        rows,
        longrun: box(q('#titleLayer .title-longrun')),
        corner: box(q('#titleLayer .title-corner'))
      };
    })()`);
    /* 溢出量 = .title-secondary 内容高 - 可视高；也就是要回收的垂直空间 */
    m.neededRecoverPx = m.secondary ? Math.max(0, m.secondary.scrollH - m.secondary.clientH) : 0;
    console.log(JSON.stringify(m, null, 2));
  } finally {
    await t.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
