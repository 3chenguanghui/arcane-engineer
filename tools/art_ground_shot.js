/**
 * C1-10 第 3 步截图器：场景质感改前 / 改后（同机位、同场景、同一颗烘焙种子）
 * ------------------------------------------------------------
 * 关键点：地面是"烘焙一次、运行时零开销"的静态图，改前后必须重新烘焙同一层，
 * 否则不是同一张地图。这里用游戏自带的 withSeedRng() 把两次烘焙的随机源锁成同一颗种子，
 * 保证除美术层外像素完全一致（砖缝 / 噪点 / 裂纹本来就是 hash 决定，天然一致）。
 * 产物：F4 机械层、F8 虚空层的全屏 + 局部放大各一组。
 * 用法：node tools/art_ground_shot.js
 * @returns {Promise<void>}
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9695;
const OUT = path.join(__dirname, '..', '.screenshots', 'art', 'step3');
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
    return fs.statSync(path.join(OUT, name)).size;
  };
  /**
   * 局部放大截图（地面纹理在 2 倍下才看得清）
   * @param {string} name 文件名
   * @param {{x:number,y:number,w:number,h:number}} box 取景框（CSS 像素）
   * @param {number} scale 放大倍数
   * @returns {Promise<number>} 文件字节数
   */
  const shotZoom = async (name, box, scale) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale } });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return fs.statSync(path.join(OUT, name)).size;
  };

  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(900);

  const sizes = {};
  const pairs = [
    { floor: 4, tag: 'f4', seed: 'artshot-ground-f4' },
    { floor: 8, tag: 'f8', seed: 'artshot-ground-f8' }
  ];

  for (const p of pairs) {
    // 改前：关美术层 → 建层 → 锁种子重烘一次（消除随机污渍位置差异）
    await ev(`ART_DIRECTION_CONFIG.enabled = false; true`);
    await ev(`(() => {
      const d = window.__roamDebug;
      d.setFloor(${p.floor});
      d.centerPlayer();
      d.spawnEnemy('patrol', 210, -130);
      d.spawnEnemy('runesprite', -200, -120);
      state.enemies.forEach((e) => { e.speed = 0; e.damage = 0; e.vx = 0; e.vy = 0; });
      state.player.hp = state.player.hpMax;
      withSeedRng('${p.seed}', 'bake', () => bakeScene());
      return state.enemies.length;
    })()`);
    await sleep(520);
    const box = await ev(`({ x: Math.round(window.innerWidth / 2 - 280), y: Math.round(window.innerHeight / 2 - 200), w: 560, h: 400 })`);
    sizes[p.tag + 'Before'] = await shot('ground-' + p.tag + '-before.png');
    sizes[p.tag + 'BeforeZoom'] = await shotZoom('ground-' + p.tag + '-before-zoom.png', box, 2);

    // 改后：开美术层 → 同一颗种子重烘
    await ev(`ART_DIRECTION_CONFIG.enabled = true; true`);
    await ev(`withSeedRng('${p.seed}', 'bake', () => bakeScene()); true`);
    await sleep(320);
    sizes[p.tag + 'After'] = await shot('ground-' + p.tag + '-after.png');
    sizes[p.tag + 'AfterZoom'] = await shotZoom('ground-' + p.tag + '-after-zoom.png', box, 2);
  }

  console.log(JSON.stringify({ ok: true, out: OUT, sizes, errors }, null, 2));
  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
