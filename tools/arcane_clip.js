// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// 局部放大截图 2.0：按世界坐标 -> 屏幕坐标计算裁剪区，确保真的框住玩家与敌人
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9781;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'clip');
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
  await sleep(1700);
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

  await ev(`(() => {
    document.getElementById('btnStart').click();
    const d = window.__roamDebug;
    d.centerPlayer();
    d.spawnEnemy('wanderer', 105, 30);
    d.spawnEnemy('sentinel', 10, -96);
    d.spawnEnemy('phaser', -110, 22);
    return true;
  })()`);
  await sleep(1000);

  // 世界坐标 -> 屏幕坐标：渲染时用的是 translate(-cam.x, -cam.y)
  const info = await ev(`(() => {
    const s = window.__roamDebug.getState();
    return { px: s.player.x - s.cam.x, py: s.player.y - s.cam.y, cx: s.player.x, cy: s.player.y, w: s.view.w, h: s.view.h };
  })()`);
  const cw = 420, ch = 260;
  let x = Math.round(info.px - cw / 2);
  let y = Math.round(info.py - ch / 2);
  x = Math.max(0, Math.min(x, info.w - cw));
  y = Math.max(0, Math.min(y, info.h - ch));
  const clip = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: cw, height: ch, scale: 2 } });
  fs.writeFileSync(path.join(OUT, '13_zoom.png'), Buffer.from(clip.data, 'base64'));
  console.log(JSON.stringify({ playerScreen: info, clip: { x, y, cw, ch } }));

  // 结算页局部
  await ev(`(() => { const d = window.__roamDebug; d.setHp(1); d.forceDeath(); return true; })()`);
  await sleep(600);
  const resultClip = await send('Page.captureScreenshot', { format: 'png', clip: { x: 300, y: 120, width: 840, height: 560, scale: 1.4 } });
  fs.writeFileSync(path.join(OUT, '14_result_zoom.png'), Buffer.from(resultClip.data, 'base64'));

  const errs = await ev(`JSON.stringify({ errors: window.__errors || [], mode: window.__roamDebug.getState().mode })`);
  console.log(errs);
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

