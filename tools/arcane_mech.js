// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9711;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'mech');
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
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => { seq += 1; pending.set(seq, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: seq, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression.slice(0, 90) + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(1000);
  await ev("(function(){ var d=window.__roamDebug; d.setFloor(1); d.centerPlayer(); return true; })()");
  await sleep(700);
  const info = await ev("(function(){ var s=window.__roamDebug.getState(); var r=state.rooms.map(function(x){return {v:x.mechVariant,x:x.x,y:x.y,w:x.w,h:x.h,cx:x.cx,cy:x.cy};}); var p=state.sceneProps; return { floor:s.floor, rooms:r, fans:p.fans.length, steam:p.steam.length, belts:p.belts.length, drips:p.drips.length, warm:p.warm.length, corridors:(state.corridors||[]).map(function(c){return {x:c.x,y:c.y,w:c.w,h:c.h};}), errors:(window.__errors||[]) }; })()");
  await shot('01_mech_wide.png');
  for (let i = 0; i < Math.min(3, info.rooms.length); i += 1) {
    const room = info.rooms[i];
    await ev("window.__roamDebug.teleport(" + (room.cx) + "," + (room.cy) + "); true");
    await sleep(650);
    await shot("0" + (i + 2) + "_room_" + room.v + ".png");
  }
  if (info.corridors.length) {
    const c = info.corridors[0];
    await ev("window.__roamDebug.teleport(" + (c.x + c.w / 2) + "," + (c.y + c.h / 2) + "); true");
    await sleep(650);
    await shot('05_corridor.png');
  }
  const fps = await ev("new Promise(function(res){ var n=0; var t0=performance.now(); function f(){ n++; if(performance.now()-t0<1200) requestAnimationFrame(f); else res(Math.round(n/((performance.now()-t0)/1000))); } requestAnimationFrame(f); })");
  const errors = await ev("(window.__errors||[])");
  console.log(JSON.stringify({ info, fps, errors }, null, 2));
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
