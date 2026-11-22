/**
 * 从交付件本身打开并截首屏（证明修复在 delivery 里，不只是主文件）
 * 用法：node tools/delivery_firstshot.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'delivery', '烬-奥术工程师-试玩版.html');
const OUT = path.join(ROOT, '.screenshots', 'firstplay', 'delivery-first-screen.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const port = 11120 + Math.floor(Math.random() * 40);
  const edge = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${prepareProfile()}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', '--force-device-scale-factor=1',
    'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page') || null;
    } catch (e) { /* 等端口 */ }
    if (!target) await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('调试端口未就绪'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: pathToFileURL(FILE).href });
  await sleep(3500);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r.exceptionDetails ? null : r.result.value;
  };
  const info = await ev(`({ title: document.title, mode: (typeof state!=='undefined' ? state.mode : null), hasStack: (typeof layoutTopStack === 'function'), hasStairsFix: (document.documentElement.innerHTML.indexOf('清场后必须可见') >= 0), hasQueue: (document.documentElement.innerHTML.indexOf('toastQueue') >= 0) })`);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(r.data, 'base64'));
  console.log(JSON.stringify({ file: FILE, shot: OUT, info }, null, 2));
  try { ws.close(); } catch (e) { /* 忽略 */ }
  try { killEdge(edge); } catch (e) { /* 忽略 */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
