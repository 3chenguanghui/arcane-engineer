// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// 回旋刃多试次诊断：每次记录敌人相对位置、投射物轨迹与掉血
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9452;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(os.tmpdir(), 'blade-diag2');
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
    if (r.exceptionDetails) throw new Error('EVAL ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const p = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(600);

  const trials = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const d = window.__roamDebug;
    const S = () => d.getState();
    d.setHp(999); d.setAether(100);
    d.clearFloor();
    await sleep(400);
    if (S().options && S().options.length) d.chooseReward(S().options[0]);
    await sleep(300);
    d.grantMagic('blade');
    const out = [];
    for (let trial = 0; trial < 8; trial += 1) {
      d.killAllEnemies(); await sleep(150); d.killAllEnemies(); await sleep(100);
      d.resetCooldowns(); d.setAether(100);
      const id = d.spawnEnemy('devourer', 110, 0);
      await sleep(60);
      const e0 = S().enemyList.find((e) => e.id === id);
      const rel0 = [Math.round(e0.x - S().player.x), Math.round(e0.y - S().player.y)];
      d.setAimExact(Math.atan2(e0.y - S().player.y, e0.x - S().player.x));
      const frames = [];
      const pre = S();
      const castOk = d.cast();
      for (let i = 0; i < 34; i += 1) {
        d.setHp(999);
        const s = S();
        const e = s.enemyList.find((x) => x.id === id);
        frames.push({
          t: i * 50,
          p: s.projectilesInfo.map((pr) => [Math.round(pr.x - s.player.x), Math.round(pr.y - s.player.y), pr.returning, pr.hits]),
          e: e ? [Math.round(e.x - s.player.x), Math.round(e.y - s.player.y), e.hp] : null
        });
        await sleep(50);
      }
      const e1 = S().enemyList.find((e) => e.id === id);
      out.push({ trial, rel0, aim: d.aimState().angle, drop: e0.hp - (e1 ? e1.hp : 0),
        pre: { mode: pre.mode, active: pre.activeMagicId, aether: pre.aether, options: pre.options, cooldown: pre.cooldowns, floorCleared: pre.floorCleared }, castOk, frames });
      await sleep(900);
    }
    return out;
  })()`);

  fs.writeFileSync(path.join(OUT, 'blade_trials.json'), JSON.stringify(trials, null, 2));
  trials.forEach((t) => {
    console.log(`trial ${t.trial} rel0=${t.rel0} aim=${t.aim} drop=${t.drop} castOk=${t.castOk} pre=${JSON.stringify(t.pre)}`);
    if (t.drop < 34) {
      t.frames.filter((f) => f.p.length || f.e).forEach((f) => console.log('  ' + JSON.stringify(f)));
    }
  });
  ws.close();
  killEdge(edge);
}

main().catch((e) => { console.error(e); process.exit(1); });
