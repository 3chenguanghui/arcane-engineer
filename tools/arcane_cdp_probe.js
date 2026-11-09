// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 极简 CDP 客户端：启动一个全新 Edge 进程，加载本地文件，抓控制台错误并截图
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT_DIR = process.argv[3] || path.join(os.tmpdir(), 'arcane_shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  // 等待调试端口就绪
  let targets = null;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) { targets = page; break; }
    } catch (e) { /* 端口尚未就绪 */ }
    await sleep(300);
  }
  if (!targets) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let seq = 0;

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  await new Promise((resolve) => { ws.onopen = resolve; });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(2500);

  const evalJs = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) return { __exception: result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception && result.exceptionDetails.exception.description) };
    return result.result.value;
  };

  const probe = await evalJs(`(() => {
    const t = document.getElementById('titleLayer');
    return {
      ready: document.readyState,
      hasDebug: !!window.__roamDebug,
      errors: (window.__errors || []).slice(0, 5),
      mode: (typeof state !== 'undefined' && state) ? state.mode : 'no-state',
      titleVisible: t ? !t.classList.contains('hidden') : 'no-title',
      titleRect: t ? (() => { const r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
      canvas: (() => { const c = document.getElementById('game'); return c ? { w: c.width, h: c.height } : null; })(),
      startBtn: !!document.getElementById('btnStart'),
      bodyText: document.body.innerText.slice(0, 200)
    };
  })()`);

  // 点击开始（若存在按钮绑定），再看是否进入 playing
  const clicked = await evalJs(`(() => {
    const b = document.getElementById('btnStart');
    if (!b) return 'no-btn';
    b.click();
    return (window.__roamDebug && window.__roamDebug.getState().mode) || 'no-debug';
  })()`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'open_check.png'), Buffer.from(shot.data, 'base64'));

  const consoleErrors = events.filter((e) =>
    e.method === 'Runtime.exceptionThrown' ||
    e.method === 'Log.entryAdded'
  ).map((e) => JSON.stringify(e.params).slice(0, 500));

  console.log('PROBE', JSON.stringify(probe, null, 2));
  console.log('CLICK', JSON.stringify(clicked));
  console.log('EVENTS', consoleErrors.length, consoleErrors.slice(0, 8));
  console.log('SHOT', path.join(OUT_DIR, 'open_check.png'));

  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
