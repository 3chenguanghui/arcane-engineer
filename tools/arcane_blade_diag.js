// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// 回旋刃双段命中诊断：采样投射物与敌人轨迹，定位第二段为什么漏
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9451;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(os.tmpdir(), 'blade-diag');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL ' + r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`).then(async (p) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  });
  await sleep(600);

  const log = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const d = window.__roamDebug;
    const S = () => d.getState();
    d.setHp(999); d.setAether(100);
    d.clearFloor();
    await sleep(400);
    if (S().options && S().options.length) d.chooseReward(S().options[0]);
    await sleep(300);
    d.killAllEnemies(); await sleep(200); d.killAllEnemies();
    d.resetCooldowns(); d.setAether(100); d.setMouseAim(0);
    d.grantMagic('blade');
    const id = d.spawnEnemy('devourer', 110, 0);
    await sleep(80);
    const first = S().enemyList.find((e) => e.id === id);
    d.setMouseAim(Math.atan2(first.y - S().player.y, first.x - S().player.x));
    await sleep(400);
    const frames = [];
    const before = S();
    d.cast();
    for (let i = 0; i < 40; i += 1) {
      const s = S();
      const enemy = s.enemyList.find((e) => e.id === id);
      frames.push({
        t: i * 50,
        p: s.projectilesInfo.map((p) => [Math.round(p.x), Math.round(p.y), p.returning, p.outElapsed, p.hits]),
        enemy: enemy ? [Math.round(enemy.x), Math.round(enemy.y), enemy.hp] : null,
        player: [Math.round(s.player.x), Math.round(s.player.y)],
        aim: d.aimState().angle
      });
      await sleep(50);
    }
    return { id, before: { player: before.player, enemies: before.enemyList, aim: before.aim }, frames };
  })()`);

  fs.writeFileSync(path.join(OUT, 'blade_diag.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log.frames.map((f) => ({ t: f.t, p: f.p, e: f.enemy })), null, 0));
  ws.close();
  killEdge(edge);
}

main().catch((e) => { console.error(e); process.exit(1); });
