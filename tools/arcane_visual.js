// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 视觉抽查：生成三种敌人 + 施法特效 + 掉落物，截取战斗画面
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9666;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'visual');
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await ev(`(() => { document.getElementById('btnStart').click(); return true; })()`);
  await sleep(900);

  // 生成三种敌人 + 让玩家移动一点，制造可辨识的画面
  await ev(`(() => {
    const d = window.__roamDebug;
    d.centerPlayer();
    d.spawnEnemy('wanderer', 120, -40);
    d.spawnEnemy('sentinel', -140, 30);
    d.spawnEnemy('phaser', 40, 150);
    return d.getState().enemyList;
  })()`);
  await sleep(700);
  await shot('08_enemies.png');

  // 火球飞行中
  await ev(`(() => { const d = window.__roamDebug; d.setAether(100); d.cast(); return true; })()`);
  await sleep(120);
  await shot('09_fireball.png');
  await sleep(400);

  // 冰环 + 雷击 + 治疗
  await ev(`(() => { const d = window.__roamDebug; d.setAether(100); d.grantMagic('frost'); d.cast(); return true; })()`);
  await sleep(180);
  await shot('10_frost.png');
  await ev(`(() => { const d = window.__roamDebug; d.setAether(100); d.grantMagic('bolt'); d.cast(); return true; })()`);
  await sleep(160);
  await shot('11_bolt.png');
  await ev(`(() => { const d = window.__roamDebug; d.setAether(100); d.grantMagic('heal'); d.setHp(40); d.cast(); return true; })()`);
  await sleep(200);
  await shot('12_heal.png');

  console.log('done');
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
