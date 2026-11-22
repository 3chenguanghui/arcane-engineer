/**
 * 只读探针：每层第 3 间内容房的房型 + 到 Boss 前累计经验/等级
 * ------------------------------------------------------------
 * 用法：node tools/diag_elite3.js
 * 口径：
 *   · 内容房 = 除出生房与首领房以外的房间
 *   · 第 3 间 = 按楼层图深度升序、深度相同按房号升序的第 3 个
 *   · 经验 = 各房 enemyCount × 单只经验（普通/生存 10，精英 35，取自 XP_CONFIG.killXp）
 *   · 等级 = 用真实 xpNeedFor(level) 逐级扣减得到（不含 Boss 的 120）
 * 全程只调 generateFloor(f)，不写存档。
 */
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9766;
const FILE = path.resolve(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读取某一层房型与经验的脚本（在页面里执行） */
const READ_FLOOR = `(() => {
  const depth = (state.floorGraph && state.floorGraph.depthOf) || {};
  const spawnId = state.spawnRoomId;
  const boss = state.rooms.find((r) => r.type === 'boss');
  const bossId = boss ? boss.id : -1;
  const others = state.rooms.filter((r) => r.id !== spawnId && r.id !== bossId);
  const ordered = others.slice().sort((a, b) => ((depth[a.id] || 0) - (depth[b.id] || 0)) || (a.id - b.id));
  const combat = ['battle', 'elite', 'survival'];
  const xpOf = (room) => {
    const n = room.enemyCount || 0;
    const per = room.type === 'elite' ? XP_CONFIG.killXp.elite : XP_CONFIG.killXp.normal;
    return combat.indexOf(room.type) >= 0 ? n * per : 0;
  };
  const xp = ordered.reduce((s, r) => s + xpOf(r), 0);
  let lv = 1; let rest = xp;
  while (rest >= xpNeedFor(lv)) { rest -= xpNeedFor(lv); lv += 1; }
  return {
    floor: state.floor,
    order: ordered.map((r) => ({ id: r.id, type: r.type, d: depth[r.id] || 0, n: r.enemyCount || 0, xp: xpOf(r) })),
    third: ordered[2] ? { id: ordered[2].id, type: ordered[2].type, n: ordered[2].enemyCount || 0 } : null,
    battle: ordered.filter((r) => r.type === 'battle').length,
    elite: ordered.filter((r) => r.type === 'elite').length,
    survival: ordered.filter((r) => r.type === 'survival').length,
    combat: ordered.filter((r) => combat.indexOf(r.type) >= 0).length,
    pick: ordered.filter((r) => ['chest', 'event', 'cache'].indexOf(r.type) >= 0).length,
    rest: ordered.filter((r) => r.type === 'rest').length,
    xp, level: lv
  };
})()`;

/** 主流程 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.text || '') + ' ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("document.getElementById('btnStart').click()");
  await sleep(500);
  await ev("const c=document.querySelector('.char-card'); if(c) c.click();");
  await sleep(300);
  await ev("const b=document.getElementById('btnCharConfirm'); if(b) b.click();");
  await sleep(1600);

  for (let f = 1; f <= 8; f += 1) {
    await ev(`generateFloor(${f})`);
    await sleep(60);
    const info = await ev(READ_FLOOR);
    console.log(`F${f} 第三间=${info.third ? info.third.type + '(id ' + info.third.id + ',怪' + info.third.n + ')' : '无'}`
      + ` | battle=${info.battle} elite=${info.elite} survival=${info.survival} combat=${info.combat} pick=${info.pick} rest=${info.rest}`
      + ` | XP到Boss前=${info.xp} 等级=${info.level}`);
    console.log('   order', info.order.map((r) => `${r.id}:${r.type}(d${r.d},n${r.n},xp${r.xp})`).join(' '));
  }
  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
