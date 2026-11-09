// P3 专项验收：全屏地图（M）
// 断言口径：暂停（elapsed 冻结）+ 房数与 state.rooms 一致 + 未探索不泄露房型 + 图标齐全 + 缩放/平移
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9534;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p3map');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const pressKey = (key) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);

  // ---- 用 M 键打开全屏地图 ----
  await pressKey('m');
  await sleep(500);
  const opened = await ev('__roamDebug.map.info()');
  check('M 键打开全屏地图且游戏进入暂停态', opened.open === true && opened.mode === 'map', { mode: opened.mode, open: opened.open });

  // ---- 暂停：elapsed 不增长 ----
  const t0 = opened.elapsed;
  await sleep(1300);
  const frozen = await ev('__roamDebug.map.info().elapsed');
  check('地图打开期间 elapsed 不再增长（游戏暂停）', Math.abs(frozen - t0) < 0.05, { before: t0, after: frozen });

  // ---- 房数一致 + 迷雾统计自洽 ----
  const st = opened.stats;
  const rooms = await ev('state.rooms.length');
  check('地图绘制房间数 === state.rooms.length', st.drawnRooms === rooms, { drawn: st.drawnRooms, rooms });
  check('已探索 + 未探索 === 总房数，且未探索 > 0',
    st.exploredRooms + st.unexploredRooms === rooms && st.unexploredRooms > 0,
    { explored: st.exploredRooms, unexplored: st.unexploredRooms, rooms });
  check('未探索房间不写房型色/图标（typeLeaks === 0）', st.typeLeaks === 0, { typeLeaks: st.typeLeaks });
  check('开局只有出生房已探索：楼梯/首领/商店/事件/宝箱/钥匙图标均为 0', (() => {
    const i = st.icons;
    return i.stairs === 0 && i.boss === 0 && i.elite === 0 && i.shop === 0 && i.event === 0 && i.chest === 0 && i.key === 0;
  })(), st.icons);

  // ---- 未探索房间在地图上只是一块黑（亮度很低） ----
  const darkProbe = await ev(`(() => {
    const hidden = state.rooms.filter((r) => !state.fog.seenRooms[r.id]);
    if (!hidden.length) return null;
    const sample = __roamDebug.map.sampleRoom(hidden[0].id);
    return { roomId: hidden[0].id, roomType: hidden[0].type, sample };
  })()`);
  check('未探索房间中心像素为深黑（lum < 30，不泄露房型配色）',
    !!darkProbe && darkProbe.sample && darkProbe.sample.lum != null && darkProbe.sample.lum < 30,
    darkProbe);
  await shot('map-fog.png');

  // ---- 全部揭示：图标数量与房间类型一一对应 ----
  const expect = await ev(`(() => {
    const rooms = state.rooms;
    const count = (fn) => rooms.filter(fn).length;
    return {
      stairs: count((r) => r.type === 'boss'),
      boss: count((r) => r.type === 'boss'),
      elite: count((r) => r.type === 'elite' || (typeof isEliteRouteRoom === 'function' && isEliteRouteRoom(r.id))),
      shop: count((r) => r.type === 'shop'),
      event: count((r) => r.type === 'event'),
      chest: count((r) => r.type === 'chest'),
      key: count((r) => r.hasKey && !r.keyTaken),
      rest: count((r) => r.type === 'rest' || r.type === 'start')
    };
  })()`);
  const revealed = await ev('__roamDebug.map.reveal(null)');
  check('全部揭示后楼梯/首领图标数量正确',
    revealed.icons.stairs === expect.stairs && revealed.icons.boss === expect.boss && expect.boss >= 1,
    { got: { stairs: revealed.icons.stairs, boss: revealed.icons.boss }, expect });
  check('精英/商店/事件/宝箱数量与房间类型一致',
    revealed.icons.elite === expect.elite && revealed.icons.shop === expect.shop
    && revealed.icons.event === expect.event && revealed.icons.chest === expect.chest,
    { got: revealed.icons, expect });
  check('钥匙线索图标只标在"藏钥匙且未取走"的房间上',
    revealed.icons.key === expect.key, { got: revealed.icons.key, expectKey: expect.key });
  await shot('map-full.png');

  // ---- 缩放 / 平移 ----
  const zoomed = await ev('__roamDebug.map.setView(1.8, 0, 0)');
  check('滚轮缩放生效（zoom 1.8 且统计同步）', Math.abs(zoomed.zoom - 1.8) < 0.001, { zoom: zoomed.zoom });
  await shot('map-zoom.png');
  const panned = await ev('__roamDebug.map.setView(1.8, 140, 90)');
  check('拖拽平移生效（panX/panY 写入并重绘）',
    Math.abs(panned.panX - 140) < 0.001 && Math.abs(panned.panY - 90) < 0.001,
    { panX: panned.panX, panY: panned.panY });
  const clamped = await ev('__roamDebug.map.setView(99, 0, 0)');
  check('缩放被夹在上限内（不会放大到失控）', clamped.zoom <= 3.0001, { zoom: clamped.zoom });

  // ---- 关闭后恢复流水（elapsed 增长） ----
  await pressKey('m');
  await sleep(400);
  const closed = await ev('__roamDebug.map.info()');
  await sleep(800);
  const resumed = await ev('__roamDebug.map.info().elapsed');
  check('关闭地图后回到游戏，elapsed 重新增长',
    closed.mode === 'playing' && resumed > closed.elapsed, { mode: closed.mode, before: closed.elapsed, after: resumed });

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'p3-result.json'), JSON.stringify({ pass, total: results.length, results, expect }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
