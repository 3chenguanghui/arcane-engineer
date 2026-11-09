/**
 * 敌人数现状探针（只读）：逐层统计房型 × 每房计划敌人数 × 同屏峰值
 * ------------------------------------------------------------
 * 用法：node 敌人数量-现状探针.js <被测文件> [difficulty]
 * 例：  node 敌人数量-现状探针.js index_arcane_v2.html normal
 *
 * 口径：
 *   · planned = room.enemyCount（生成时写入的总计划数；补丁版含排队未出场的）
 *   · live    = state.enemies 里该房间的当前敌人数
 *   · 同屏     = 以每个房间中心为视口中心，1440×900 窗口内的敌人总数（房间之间有墙，实测等于单房最大值）
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { prepareProfile, killEdge } = require('./tools/arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9560;
const FILE = path.resolve(process.argv[2] || path.join(__dirname, 'index_arcane_v2.html'));
const FILE_URL = 'file:///' + FILE.replace(/\\/g, '/');
const DIFF = process.argv[3] || 'normal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('调试端口未就绪'); }

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
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: FILE_URL });

  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    try {
      ready = await ev(`document.readyState === 'complete' && !!document.getElementById('btnStart') && typeof state !== 'undefined'`);
      if (ready) break;
    } catch (e) { /* loading */ }
    await sleep(250);
  }
  if (!ready) throw new Error('页面未就绪');

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await ev('resizeCanvas()');

  const p = await ev(`(() => { const r = document.getElementById('btnStart').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(900);

  await ev(`state.difficulty = '${DIFF}'; true`);

  const floors = [];
  for (let floor = 1; floor <= 10; floor += 1) {
    const info = await ev(`(() => {
      // 固定种子：A/B 两版必须用同一张楼层布局，否则房型/房间数不同，表就不成立
      state.seedInfo = { active: true, value: 'density-probe', daily: false };
      __roamDebug.enemies.floor(${floor});
      const rooms = state.rooms.map((r) => ({
        id: r.id, type: r.type, planned: r.enemyCount != null ? r.enemyCount : 0,
        cx: r.cx, cy: r.cy, w: r.w, h: r.h
      }));
      const live = {};
      state.enemies.forEach((e) => { live[e.roomId] = (live[e.roomId] || 0) + 1; });
      const halfW = (state.viewW || 1440) / 2, halfH = (state.viewH || 900) / 2;
      const viewAt = {};
      rooms.forEach((r) => {
        viewAt[r.id] = state.enemies.filter((e) => Math.abs(e.x - r.cx) <= halfW && Math.abs(e.y - r.cy) <= halfH).length;
      });
      return {
        floor: ${floor},
        roomCount: rooms.length,
        rooms: rooms.map((r) => ({ type: r.type, planned: r.planned, live: live[r.id] || 0,
          view: viewAt[r.id], liveInView: state.enemies.filter((e) => e.roomId === r.id
            && Math.abs(e.x - r.cx) <= halfW && Math.abs(e.y - r.cy) <= halfH).length })),
        totalLive: state.enemies.length,
        viewMax: Math.max(0, ...rooms.map((r) => viewAt[r.id]),
          ...rooms.map((r) => state.enemies.filter((e) => e.roomId === r.id
            && Math.abs(e.x - r.cx) <= halfW && Math.abs(e.y - r.cy) <= halfH).length))
      };
    })()`);
    floors.push(info);
    console.log(`F${floor} rooms=${info.roomCount} totalLive=${info.totalLive} viewMax=${info.viewMax} ` +
      info.rooms.map((r) => `${r.type}:${r.planned}/${r.live}`).join(' '));
  }

  const out = path.join(__dirname, '.seedwork', 'enemy_now_' + (DIFF === 'normal' ? 'normal' : DIFF) + '_' + path.basename(FILE, '.html') + '.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ file: FILE, difficulty: DIFF, floors }, null, 2), 'utf8');
  console.log('wrote ' + out);
  ws.close();
  killEdge(edge);
  await sleep(400);
}

main().catch((e) => { console.error(e); process.exit(1); });
