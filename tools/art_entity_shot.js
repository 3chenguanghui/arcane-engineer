/**
 * C1-10 第 2 步截图器：实体形状改前 / 改后（同机位、同场景、同站位）
 * ------------------------------------------------------------
 * 做法：
 *   1) 启动无头 Edge 打开游戏，点开始；
 *   2) 跳到 F4（机械层，偏亮的地面最能看出描边），把 6 只不同族的小怪摆在固定站位；
 *   3) 把小怪速度/伤害归零（只冻位置，不动动画），保证改前改后像素级同机位；
 *   4) 先关 ART_DIRECTION_CONFIG（改前），再开（改后），各截一张；
 *   5) 再跳到 F6 首领房，同样出改前 / 改后两张（首领描边单独验证）；
 *   6) 退出即清理 profile。
 * 用法：node tools/art_entity_shot.js
 * @returns {Promise<void>}
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9691;
const OUT = path.join(__dirname, '..', '.screenshots', 'art', 'step2');
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
   * 局部放大截图（同机位、同帧，只是取景框更小 + 放大倍数）
   * 原因：全屏图上小怪只有十几个像素，2.5px 描边看不太出来；放大框才是"实体形状"的证据。
   * @param {string} name 文件名
   * @param {{x:number,y:number,w:number,h:number}} box 取景框（CSS 像素）
   * @param {number} scale 放大倍数
   * @returns {Promise<number>} 文件字节数
   */
  const shotZoom = async (name, box, scale) => {
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale }
    });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return fs.statSync(path.join(OUT, name)).size;
  };

  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(900);

  // ---- 场景 A：六族小怪同屏（F4 机械层地面）----
  const lineup = `(() => {
    const d = window.__roamDebug;
    d.setFloor(4);
    d.centerPlayer();
    d.spawnEnemy('patrol', 200, -120);
    d.spawnEnemy('welder', 330, 40);
    d.spawnEnemy('runesprite', -190, -140);
    d.spawnEnemy('graveter', -300, 60);
    d.spawnEnemy('devourer', 80, -260);
    d.spawnEnemy('shardling', -60, 250);
    // 只冻结位移与伤害，保留 bob / 挤压等微动
    state.enemies.forEach((e) => { e.speed = 0; e.damage = 0; e.vx = 0; e.vy = 0; });
    state.player.hp = state.player.hpMax;
    return state.enemies.length;
  })()`;
  const lineupCount = await ev(lineup);
  await sleep(520);

  // 取景框：以视口中心（玩家恒在屏幕中心）为基准的 560×400 放大 2 倍
  const zoomBox = await ev(`({ x: Math.round(window.innerWidth / 2 - 280), y: Math.round(window.innerHeight / 2 - 200), w: 560, h: 400 })`);

  await ev(`ART_DIRECTION_CONFIG.enabled = false; true`);
  await sleep(220);
  const aBefore = await shot('entity-before.png');
  const aBeforeZoom = await shotZoom('entity-before-zoom.png', zoomBox, 2);
  await ev(`ART_DIRECTION_CONFIG.enabled = true; true`);
  await sleep(220);
  const aAfter = await shot('entity-after.png');
  const aAfterZoom = await shotZoom('entity-after-zoom.png', zoomBox, 2);

  // ---- 场景 B：F6 首领（首领描边单独验证）----
  const bossSetup = `(async () => {
    const d = window.__roamDebug;
    d.setFloor(6);
    const room = state.rooms.find((r) => r.type === 'boss');
    state.player.x = room.cx;
    state.player.y = room.cy;
    state.player.hp = state.player.hpMax;
    if (typeof snapCamera === 'function') snapCamera();
    await new Promise((r) => setTimeout(r, 1400));
    /* 首领本体是放进 state.enemies 里的 isBoss 实体；state.boss 只是 HUD/相机元数据（没有坐标）。
       把玩家挪到首领正下方 200px，让首领处在屏幕中心取景框里 */
    const bossEnemy = state.enemies.find((e) => e.isBoss);
    if (bossEnemy) {
      bossEnemy.speed = 0;
      bossEnemy.damage = 0;
      state.player.x = bossEnemy.x;
      state.player.y = bossEnemy.y + 200;
      state.player.hp = state.player.hpMax;
      if (typeof snapCamera === 'function') snapCamera();
    }
    // 等首领登场演出（红色压屏 + 大血条）走完，避免遮挡描边对比
    await new Promise((r) => setTimeout(r, 2200));
    return {
      boss: !!bossEnemy,
      bossXY: bossEnemy ? { x: bossEnemy.x, y: bossEnemy.y } : null,
      room: room.id,
      introDone: state.boss ? !!state.boss.introDone : null
    };
  })()`;
  const bossInfo = await ev(bossSetup);
  await sleep(400);
  let bBefore = null;
  let bAfter = null;
  if (bossInfo && bossInfo.boss) {
    /* 首领站在玩家上方 200px，取景框整体上移 120px 让它居中 */
    const bossZoomBox = { x: zoomBox.x, y: zoomBox.y - 120, w: zoomBox.w, h: zoomBox.h };
    await ev(`ART_DIRECTION_CONFIG.enabled = false; true`);
    await sleep(180);
    bBefore = await shot('boss-before.png');
    const bBeforeZoom = await shotZoom('boss-before-zoom.png', bossZoomBox, 2);
    await ev(`ART_DIRECTION_CONFIG.enabled = true; true`);
    await sleep(180);
    bAfter = await shot('boss-after.png');
    const bAfterZoom = await shotZoom('boss-after-zoom.png', bossZoomBox, 2);
    console.log(JSON.stringify({ bossZoom: { bBeforeZoom, bAfterZoom } }));
  }
  await ev(`ART_DIRECTION_CONFIG.enabled = true; true`);

  console.log(JSON.stringify({
    ok: true,
    out: OUT,
    lineupCount,
    bossInfo,
    sizes: { entityBefore: aBefore, entityAfter: aAfter, bossBefore: bBefore, bossAfter: bAfter },
    errors
  }, null, 2));

  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e && e.message ? e.message : e);
  process.exit(1);
});
