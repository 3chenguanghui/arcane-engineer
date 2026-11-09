// 最小加载自检：任何写入主文件后，先证明页面还能加载（不跑功能、不判时长）
// 用法：node tools/_load_check.js [目标文件]
// 判据：readyState=complete / 标题可见 / init 与 __roamDebug 存在 / 无 console error / 画布存在
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9455;
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动无头 Edge 并连接 CDP，返回一套 send/ev 辅助函数 */
async function launch() {
  const profile = prepareProfile();
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
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  await new Promise((r) => { ws.onopen = r; });
  /** 发一条 CDP 命令并等回包 */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  /** 在页面里求值并取回值 */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text);
    return r.result.value;
  };
  return { edge, ws, events, send, ev };
}

/** 主流程：只做加载判据，不碰游戏流程 */
async function main() {
  const { edge, ws, events, send, ev } = await launch();
  let ok = false;
  try {
    const before = events.length;
    const url = 'file:///' + FILE.replace(/\\/g, '/');
    await send('Page.navigate', { url });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const ready = await ev('document.readyState');
      if (ready === 'complete') break;
      await sleep(150);
    }
    await sleep(1200);
    const snap = await ev(`(function(){
      var t = document.getElementById('titleLayer');
      return {
        ready: document.readyState,
        title: document.title,
        titleVisible: t ? !t.classList.contains('hidden') : null,
        hasInit: typeof init === 'function',
        hasDebug: typeof window.__roamDebug === 'object' && window.__roamDebug !== null,
        canvas: !!document.querySelector('canvas')
      };
    })()`);
    const errs = events.slice(before).filter((e) =>
      e.method === 'Runtime.exceptionThrown'
      || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
    ok = !!(snap && snap.ready === 'complete' && snap.titleVisible !== false
      && snap.hasInit && snap.hasDebug && snap.canvas && errs.length === 0);
    console.log('LOAD-SNAP ' + JSON.stringify(snap));
    console.log('CONSOLE-ERRORS ' + errs.length
      + (errs.length ? ' ' + JSON.stringify(errs.slice(0, 3).map((e) => e.params.entry ? e.params.entry.text : e.params.exceptionDetails.text)) : ''));
    console.log('LOAD: ' + (ok ? 'PASS' : 'FAIL') + '  ' + FILE);
  } finally {
    try { ws.close(); } catch (e) {}
    killEdge(edge);
  }
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.log('LOAD: FAIL  ' + e.message);
  process.exit(2);
});
