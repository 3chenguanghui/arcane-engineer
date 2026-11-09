// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// 非无头冒烟：像双击一样让 Edge 直接打开本地文件，检查首屏能否看到并截图
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9785;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'realopen');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  const url = 'file:///' + FILE.replace(/\\/g, '/');
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--window-size=1410,860', url
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page' && t.url.indexOf('index_arcane_v2') >= 0); if (target) break; } catch (e) {}
    await sleep(250);
  }
  if (!target) throw new Error('未找到页面 target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => { seq += 1; pending.set(seq, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: seq, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await sleep(1500);
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const state = await ev(`JSON.stringify({
    url: location.href,
    ready: document.readyState,
    mode: window.__roamDebug ? window.__roamDebug.getState().mode : 'no-debug-api',
    titleVisible: !!document.querySelector('#titleLayer .title-card') && getComputedStyle(document.getElementById('titleLayer')).visibility,
    startBtn: !!document.getElementById('btnStart'),
    errors: window.__errors || []
  })`);
  console.log(state);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, '15_real_open.png'), Buffer.from(shot.data, 'base64'));
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
