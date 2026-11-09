/**
 * C1-10 第 5 步截图器：特效档位对照（默认 vs ?fx=low）
 * ------------------------------------------------------------
 * 目的：验证"特效收紧后低档位仍然可读"，并留下 ?fx=low 的对照图。
 * 为了让两次加载是同一张地图，楼层生成与地面烘焙都套同一颗 withSeedRng 种子；
 * 小怪站位写死，速度归零，只有后处理强度不同（1.0 vs 0.55）。
 * 产物：fx-normal.png / fx-low.png
 * 用法：node tools/art_fx_shot.js
 * @returns {Promise<void>}
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9699;
const OUT = path.join(__dirname, '..', '.screenshots', 'art', 'step5');
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程
 * @returns {Promise<void>}
 */
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
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return fs.statSync(path.join(OUT, name)).size;
  };

  /** 加载一次游戏并布好同一场景，然后截图 */
  const runOnce = async (url, name) => {
    await send('Page.navigate', { url });
    await sleep(1900);
    await ev(`document.getElementById('btnStart').click(); true`);
    await sleep(800);
    await ev(`(() => {
      const d = window.__roamDebug;
      withSeedRng('artfx-floor', 'floor', () => d.setFloor(4));
      d.centerPlayer();
      d.spawnEnemy('patrol', 200, -120);
      d.spawnEnemy('welder', 330, 40);
      d.spawnEnemy('runesprite', -190, -140);
      d.spawnEnemy('devourer', 80, -250);
      state.enemies.forEach((e) => { e.speed = 0; e.damage = 0; e.vx = 0; e.vy = 0; });
      state.player.hp = state.player.hpMax;
      withSeedRng('artfx-bake', 'bake', () => bakeScene());
      return true;
    })()`);
    await sleep(600);
    return shot(name);
  };

  const normal = await runOnce('file:///' + FILE.replace(/\\/g, '/'), 'fx-normal.png');
  const low = await runOnce('file:///' + FILE.replace(/\\/g, '/') + '?fx=low', 'fx-low.png');

  console.log(JSON.stringify({ ok: true, out: OUT, sizes: { normal, low }, errors }, null, 2));
  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
