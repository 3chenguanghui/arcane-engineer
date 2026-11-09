// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9701;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'hitshot');
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression.slice(0, 80) + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(1000);
  const stage = await ev("(function(){ PIXEL_FX_CONFIG.impact.life = 1.6; var d = window.__roamDebug; d.centerPlayer(); d.spawnEnemy('wanderer', 160, -30); var s = d.getState(); return { mode: s.mode, count: s.enemies, list: s.enemyList }; })()");
  await sleep(500);
  const b = await ev("(function(){ var d = window.__roamDebug; var s = d.getState(); var e = s.enemyList[0]; if (!e) return { empty: true, list: s.enemyList }; var ang = Math.atan2(e.y - s.player.y, e.x - s.player.x); var hit = d.hitNearest(18, ang); var s2 = d.getState(); return { hit: hit, impacts: s2.fx.impacts, ang: ang }; })()");
  await sleep(180);
  await shot('04b_impact.png');
  await ev("window.__roamDebug.hitNearest(9999)");
  await sleep(160);
  await shot('06b_shatter.png');
  const q = await ev("(function(){ PIXEL_FX_CONFIG.glitch.duration = 2.2; var d = window.__roamDebug; var s = d.getState(); d.setHp(Math.round(s.hpMax * 0.3)); d.damagePlayer(1, s.player.x + 40, s.player.y); return true; })()");
  await sleep(160);
  await shot('14b_lowhp_glitch.png');
  const fx = await ev("(function(){ var s = window.__roamDebug.getState(); return s.fx; })()");
  console.log(JSON.stringify({ stage, hit: b, lowhp: q, fx }, null, 2));
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
