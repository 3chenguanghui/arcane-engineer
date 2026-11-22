/**
 * 第二组（怪物）只读探针
 * ------------------------------------------------------------
 * 目的：量化「强度随层上升 / 同屏与波次 / 刷怪落点撞遮挡物」三项现状。
 * 只生成楼层并读 state，不写存档、不改游戏逻辑。
 * 用法：node tools/_g2_probe.js [--file=<html>] [--out=<json>]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9783;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'g2');
const FLOORS = [1, 2, 6, 10, 20];
const SEED = '261108';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数
 * @returns {{file:string, out:string|null}} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : null;
  };
  return { file: pick('file') || path.join(ROOT, 'index_arcane_v2.html'), out: pick('out') };
}

/**
 * 启动无头 Edge 并连 CDP，加载被测 HTML
 * @param {string} file 被测文件绝对路径
 * @returns {Promise<{ev:Function, close:Function}>} 探针句柄
 */
async function boot(file) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(proc); throw new Error('Edge 调试端口未就绪'); }

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
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  for (let i = 0; i < 160; i += 1) {
    await sleep(250);
    try {
      if (await ev(`typeof state !== 'undefined' && typeof generateFloor === 'function'`)) break;
    } catch (e) { /* 仍在解析 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, close };
}

/**
 * 页面内脚本：逐层生成后统计数量/强度/遮挡重叠
 * @param {number[]} floors 要测的层
 * @param {string} seed 固定种子
 * @returns {string} 可被 Runtime.evaluate 执行的表达式
 */
const PAGE_SCRIPT = (floors, seed) => `(function(){
  var FLOORS = ${JSON.stringify(floors)};
  state.seedInfo = { active: true, value: ${JSON.stringify(seed)}, daily: false, custom: true, startedAt: 0 };
  __rngOverride = null;

  /** 造矩形 */
  function R(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }
  /** 取房型缩放 k */
  function kOf(room) { try { return roomPropK(room); } catch (e) { return 1; } }
  /**
   * 与 paintRoomPropV2 同公式的主体物"视觉矩形"（顶面 + 向下立面）
   * 只读近似，最终实现会迁进游戏里的 roomOcclusionRects。
   */
  function legacyRects(room) {
    var k = kOf(room), cx = room.cx, cy = room.cy, out = [];
    if (typeof roomOcclusionRects === 'function') return roomOcclusionRects(room);
    switch (room.type) {
      case 'shop': {
        var w = 300 * k, h = 34 * k, lift = 58 * k, y = room.y + 230 * k;
        out.push(R(cx - w / 2, y, w, h + lift));
        [-1, 1].forEach(function (side) {
          var sx = side < 0 ? room.x + 70 : room.x + room.w - 190 * k;
          out.push(R(sx, y - 74 * k, 120 * k, 26 * k + 96 * k));
        });
        out.push(R(cx - 84 * k, y - 96 * k, 168 * k, 46 * k + 10 * k));
        break;
      }
      case 'chest': {
        var bw = 108 * k, bh = 40 * k, by = cy - 4 * k;
        out.push(R(cx - bw / 2, by - 28 * k, bw, bh * 1.45 + 44 * k + 28 * k));
        break;
      }
      case 'rest': case 'start': {
        var gy = cy + 16 * k;
        out.push(R(cx - 46 * k, gy - 64 * k, 92 * k, 124 * k));
        break;
      }
      case 'forge': {
        out.push(R(cx - 110 * k, cy - 40 * k, 220 * k, 60 * k + 150 * k));
        out.push(R(cx - 22 * k, cy - 236 * k, 44 * k, 40 * k + 140 * k));
        out.push(R(cx + 150 * k, cy + 56 * k, 86 * k, 26 * k + 36 * k));
        break;
      }
      case 'survival': {
        out.push(R(cx - 56 * k, cy + 8, 112 * k, 40 * k + 30 * k));
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
          out.push(R(cx + p[0] * room.w * 0.30 - 14 * k, cy + p[1] * room.h * 0.30, 28 * k, 24 * k + 96 * k));
        });
        break;
      }
      case 'curse': {
        out.push(R(cx - 60 * k, cy - 16 * k, 120 * k, 36 * k + 150 * k));
        out.push(R(cx - 34 * k, cy - 100 * k, 68 * k, 100 * k));
        break;
      }
      case 'vault': {
        out.push(R(cx - 34 * k, room.y + 40 * k, 68 * k, 24 * k + 120 * k));
        break;
      }
      default: break;
    }
    return out;
  }

  /** 圆与矩形（外扩 pad）是否相交 */
  function circleHitRect(x, y, r, rect, pad) {
    var p = pad || 0;
    var nx = Math.max(rect.x - p, Math.min(x, rect.x + rect.w + p));
    var ny = Math.max(rect.y - p, Math.min(y, rect.y + rect.h + p));
    return (x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r;
  }

  var rows = [];
  FLOORS.forEach(function (f) {
    generateFloor(f);
    var barrels = (state.props && state.props.barrels) ? state.props.barrels : [];
    var rooms = [];
    var occHits = 0, barrelHits = 0, shapeOut = 0, total = 0, guard = 0;
    var typeStat = {};
    (state.rooms || []).forEach(function (room) {
      if (room.id === state.spawnRoomId) return;
      var en = (state.enemies || []).filter(function (e) {
        return e.roomId === room.id && !e.isSummoned && !e.isMirror && !e.boss;
      });
      var rects = legacyRects(room);
      en.forEach(function (e) {
        total += 1;
        var r = e.radius || 10;
        if (e.spawnGuard > 0) guard += 1;
        if (rects.some(function (rc) { return circleHitRect(e.x, e.y, r, rc, 0); })) occHits += 1;
        if (barrels.some(function (b) { return Math.hypot(e.x - b.x, e.y - b.y) < (b.r || 13) + r; })) barrelHits += 1;
        try {
          if (!pointInRoomShape(room, e.x, e.y, 6)) shapeOut += 1;
        } catch (err) { /* 无此函数则跳过 */ }
        if (!typeStat[e.typeId]) typeStat[e.typeId] = { n: 0, hp: 0, dmg: 0, spd: 0 };
        var st = typeStat[e.typeId];
        st.n += 1; st.hp += e.hpMax || 0; st.dmg += e.damage || 0; st.spd += e.speed || 0;
      });
      if ((room.enemyCount || 0) > 0 || en.length > 0) {
        rooms.push({
          id: room.id,
          type: room.type,
          enemyCount: room.enemyCount || 0,
          actual: en.length,
          alivePeak: room.alivePeak || 0,
          waveFirst: room.waveBatchSize || 0,
          waveChunk: room.waveChunk || 0,
          wavePending: (room.wavePending || []).length
        });
      }
    });
    var types = {};
    Object.keys(typeStat).forEach(function (id) {
      var st = typeStat[id];
      types[id] = {
        n: st.n,
        hpMax: Math.round(st.hp / st.n),
        damage: Math.round((st.dmg / st.n) * 10) / 10,
        speed: Math.round((st.spd / st.n) * 10) / 10
      };
    });
    rows.push({
      floor: f,
      rooms: rooms,
      totalEnemies: total,
      occHits: occHits,
      barrelHits: barrelHits,
      shapeOut: shapeOut,
      guard: guard,
      types: types,
      power: (typeof enemyFloorPowerOf === 'function') ? enemyFloorPowerOf(f) : null,
      density: (typeof DENSITY_CONFIG !== 'undefined') ? {
        roomCap: DENSITY_CONFIG.roomCap, aliveCap: DENSITY_CONFIG.aliveCap, spawnGuard: DENSITY_CONFIG.spawnGuard
      } : null,
      spawnStats: (typeof SPAWN_STATS !== 'undefined') ? JSON.parse(JSON.stringify(SPAWN_STATS)) : null
    });
  });
  return rows;
})()`;

/**
 * 主流程：起浏览器 → 逐层采样 → 打印并落盘
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs();
  const h = await boot(args.file);
  let rows = [];
  try {
    rows = await h.ev(PAGE_SCRIPT(FLOORS, SEED));
  } finally {
    h.close();
  }
  const outPath = args.out || path.join(OUT_DIR, 'before.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf8');

  console.log('== 第二组基线（种子 ' + SEED + '）==');
  rows.forEach((r) => {
    const peak = r.rooms.reduce((m, x) => Math.max(m, x.alivePeak), 0);
    const maxCount = r.rooms.reduce((m, x) => Math.max(m, x.enemyCount), 0);
    const waveMax = r.rooms.reduce((m, x) => Math.max(m, x.wavePending), 0);
    console.log(`F${r.floor}: 怪 ${r.totalEnemies} · 单房上限 ${maxCount} · 同屏峰值 ${peak} · 待补波次 ${waveMax}`);
    console.log(`  遮挡重叠 ${r.occHits} · 桶重叠 ${r.barrelHits} · 房型外 ${r.shapeOut}` +
      (r.power ? ` · 强度倍率 dmg×${r.power.damage.toFixed(2)} spd×${r.power.speed.toFixed(2)}` +
        (r.power.rate ? ` rate×${r.power.rate.toFixed(2)}` : '') : ''));
    Object.keys(r.types).slice(0, 6).forEach((id) => {
      const t = r.types[id];
      console.log(`  ${id}: n=${t.n} hp=${t.hpMax} dmg=${t.damage} spd=${t.speed}`);
    });
    const bat = r.rooms.find((x) => x.type === 'battle');
    if (bat) {
      console.log(`  战斗房波次: 总量 ${bat.enemyCount} · 首批 ${bat.waveFirst} · 每段 ${bat.waveChunk}` +
        ` · 排队 ${bat.wavePending} → ${bat.enemyCount} = ${bat.waveFirst}+` +
        Array.from({ length: Math.ceil(bat.wavePending / Math.max(1, bat.waveChunk)) }, () => Math.min(bat.waveChunk, bat.wavePending)).join('+'));
    }
  });
  console.log('已写入 ' + outPath);
  const last = rows[rows.length - 1];
  if (last && last.spawnStats) {
    console.log('落点统计（累计）: ' + JSON.stringify(last.spawnStats));
  }
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
