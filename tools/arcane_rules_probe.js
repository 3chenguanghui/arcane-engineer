// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// 规则面板尺寸探针：判断内容是否能在固定高度内完整显示（不靠滚动）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9783;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => { seq += 1; pending.set(seq, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: seq, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1600);
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

  await ev(`(() => { document.getElementById('btnStart').click(); window.__roamDebug.openRules(); return true; })()`);
  await sleep(500);
  const data = await ev(`(() => {
    const card = document.querySelector('.rules-card');
    const grid = document.querySelector('.rules-grid');
    const body = document.getElementById('rulesBody');
    const settings = document.querySelector('.settings-box');
    const talents = document.querySelector('.talent-box');
    const r = (el) => el ? { t: Math.round(el.getBoundingClientRect().top), b: Math.round(el.getBoundingClientRect().bottom), h: Math.round(el.getBoundingClientRect().height) } : null;
    return {
      viewport: { w: innerWidth, h: innerHeight },
      card: Object.assign(r(card), { client: card.clientHeight, scroll: card.scrollHeight }),
      grid: r(grid), body: r(body), talents: r(talents), settings: r(settings)
    };
  })()`);
  console.log(JSON.stringify(data, null, 2));
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
