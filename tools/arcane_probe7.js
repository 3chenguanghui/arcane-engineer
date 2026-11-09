// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 探针：在 1024×576（1280×720@125%）下量标题页各区块高度，找矮视口溢出根因
const { spawn } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'; const PORT = 9763; const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--allow-file-access-from-files', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i++) { try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find(t => t.type === 'page'); if (target) break; } catch (e) {} await sleep(250); }
  const ws = new WebSocket(target.webSocketDebuggerUrl); let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => { seq++; pending.set(seq, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: seq, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 576, deviceScaleFactor: 1.25, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  console.log(JSON.stringify(await ev(`(function(){
    var card = document.querySelector('.title-card');
    var scroll = document.querySelector('.title-scroll');
    var act = document.querySelector('.title-actions');
    var kids = Array.from(scroll.children).map(function(el){ var r = el.getBoundingClientRect(); return { cls: el.className || el.tagName, h: Math.round(r.height), y: Math.round(r.top) }; });
    var duoKids = Array.from(document.querySelectorAll('.title-duo-col > *')).map(function(el){ var r = el.getBoundingClientRect(); return { cls: el.className, h: Math.round(r.height), y: Math.round(r.top) }; });
    var cr = card.getBoundingClientRect();
    return {
      vh: innerHeight,
      card: { y: Math.round(cr.top), h: Math.round(cr.height) },
      scroll: { h: Math.round(scroll.getBoundingClientRect().height), sh: scroll.scrollHeight },
      actions: Math.round(act.getBoundingClientRect().height),
      kids: kids, duoKids: duoKids
    };
  })()`), null, 2));
  ws.close(); killEdge(edge);
})();
