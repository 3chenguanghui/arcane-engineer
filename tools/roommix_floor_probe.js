/**
 * 房型计划表验收探针（第三批：每层 8 → 10 间）
 * ------------------------------------------------------------
 * 只读：走真实的 __roamDebug.floor(f)（= state.floor + generateFloor），读最终房型。
 * 每层输出：
 *   · rooms：按 id 升序的 [id, type, depth]
 *   · 按"深度 + id"排序的房型序列（玩家推进顺序，含出生与首领）
 *   · D2 违规增量（ROOM_MIX_STATS.violations）、抛错信息
 *   · roomMixRestGap / thirdRoomEliteId / 精英路线房
 * 汇总：总违规数、报错层、非战斗房型重复层。
 *
 * 用法：
 *   node tools\roommix_floor_probe.js                # 主文件，F1–F20
 *   ARCANE_FILE=...\tmp.html node tools\roommix_floor_probe.js 5   # 只跑前 5 层
 *   TAG=batch3_before node tools\roommix_floor_probe.js            # 输出文件名标记
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const ROOT = path.join(__dirname, '..');
const FILE = process.env.ARCANE_FILE
  ? path.resolve(process.env.ARCANE_FILE)
  : path.join(ROOT, 'index_arcane_v2.html');
const MAX_FLOOR = Number(process.argv[2] || 20);
const TAG = process.env.TAG || 'run';
const OUT_DIR = path.join(ROOT, 'tools', 'rhythm_out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动无头 Edge 并连上 CDP，返回 { edge, send, evalJs } */
async function connect() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1600,1000',
    'about:blank'
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
  let seq = 0;
  const pending = new Map();
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
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(String(r.exceptionDetails.text || '') + ' '
        + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };
  return { edge, send, evalJs };
}

/** 主流程：起浏览器 → 开局 → 逐层重建 → 打印房型序列 */
async function main() {
  const ctx = await connect();
  const { edge, send, evalJs } = ctx;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    for (let i = 0; i < 120; i += 1) {
      const ok = await evalJs("typeof generateFloor === 'function' && typeof state === 'object'");
      if (ok) break;
      await sleep(250);
    }
    /* 开局（跳过角色选择），保证后续 generateFloor 需要的运行时对象都已就绪 */
    await evalJs("(() => { window.__charSkipPick = true; const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()");
    await sleep(1200);

    const rows = [];
    for (let f = 1; f <= MAX_FLOOR; f += 1) {
      const row = await evalJs(`(() => {
        const before = ROOM_MIX_STATS.violations;
        let error = null;
        try {
          /* 与量尺同一条路径：enemies.floor = state.floor 赋值 + generateFloor（含房型定稿） */
          if (__roamDebug && __roamDebug.enemies && typeof __roamDebug.enemies.floor === 'function') {
            __roamDebug.enemies.floor(${f});
          } else if (typeof __roamDebug.setFloor === 'function') {
            __roamDebug.setFloor(${f});
          } else {
            state.floor = ${f};
            generateFloor(${f});
          }
        } catch (e) {
          error = String((e && e.message) || e);
        }
        const rooms = (state.rooms || []).map((r) => ({
          id: r.id, type: r.type, depth: r.depth == null ? -1 : r.depth
        }));
        const ordered = rooms.slice().sort((a, b) => (a.depth - b.depth) || (a.id - b.id));
        const nonBattle = ordered.filter((r) => r.type !== 'battle' && r.type !== 'elite');
        const dup = [];
        const seen = {};
        nonBattle.forEach((r) => {
          if (seen[r.type] !== undefined) dup.push(r.type + ':' + seen[r.type] + ',' + r.id);
          seen[r.type] = r.id;
        });
        return {
          floor: ${f},
          error: error,
          rooms: rooms,
          seq: ordered.map((r) => r.type),
          spawnId: state.spawnRoomId,
          stairId: state.stairRoomId,
          violationsDelta: ROOM_MIX_STATS.violations - before,
          restGap: state.roomMixRestGap,
          thirdElite: state.thirdRoomEliteId,
          thirdEliteSkipped: !!state.thirdRoomEliteSkipped,
          eliteRoute: state.eliteRoute && state.eliteRoute.roomIds ? state.eliteRoute.roomIds.slice() : [],
          dup: dup,
          layered: !!(state.floorGraph && state.floorGraph.layered),
          edges: state.floorGraph && state.floorGraph.edges ? state.floorGraph.edges.length : 0,
          genFallback: !!(state.floorGen && state.floorGen.fallback),
          genValid: !!(state.floorGen && state.floorGen.valid),
          roomCount: rooms.length
        };
      })()`);
      rows.push(row);
      const flag = row.error ? 'ERR' : (row.dup.length ? 'DUP' : 'ok');
      console.log(`F${row.floor} ${flag} n=${row.roomCount} layered=${row.layered} edges=${row.edges}`
        + ` valid=${row.genValid} fallback=${row.genFallback}`
        + ` viol+${row.violationsDelta} restGap=${row.restGap} thirdElite=${row.thirdElite}`
        + ` elite=[${row.eliteRoute.join(',')}]`);
      console.log(`   seq=[${row.seq.join(',')}]`);
      console.log(`   byId=[${row.rooms.map((r) => r.id + ':' + r.type + '@' + r.depth).join(' ')}]`);
      if (row.dup.length) console.log('   DUP=' + row.dup.join(' | '));
      if (row.error) console.log('   ERROR=' + row.error);
    }
    const errFloors = rows.filter((r) => r.error).map((r) => r.floor);
    const dupFloors = rows.filter((r) => r.dup.length).map((r) => r.floor);
    const violTotal = rows.reduce((s, r) => s + r.violationsDelta, 0);
    const out = {
      at: new Date().toISOString(),
      file: FILE,
      maxFloor: MAX_FLOOR,
      summary: { errorFloors: errFloors, dupFloors: dupFloors, violationsTotal: violTotal },
      floors: rows
    };
    const outFile = path.join(OUT_DIR, 'roommix_' + TAG + '.json');
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
    console.log('SUMMARY ' + JSON.stringify(out.summary));
    console.log('OUT ' + outFile);
  } finally {
    killEdge(edge);
  }
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
