/**
 * 房型配比实测探针（只读，不写主文件）
 * ------------------------------------------------------------
 * 用途：回答「休整房 0% 是权重、闸门还是渲染」这三个互斥可能。
 * 做法：把主文件复制到 .seedwork/main.html，用独立 profile + 独立端口起 Edge，
 *       通过 __roamDebug.p2.probeFloor(seed, floor) 生成 6 个种子 × 20 层，
 *       统计每层房型，并在房型改写的每一个阶段前后快照房型数组，
 *       从而确定"休整房是从来没被分配，还是分配后被哪一步吃掉"。
 * 约束：本脚本不写 index_arcane_v2.html 任何一个字节；副本跑完即删。
 * 用法：node tools/_roomtypes_probe.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9532;
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const WORK = path.join(ROOT, '.seedwork', 'roomprobe');
const COPY = path.join(WORK, 'main.html');
const PATCHED = process.env.ROOMMIX === '1';
const OUT = path.join(WORK, PATCHED ? 'roommix_after.json' : 'roomtypes.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 6 个 8 位数字种子，覆盖不同布局；每层各采样 6 次 */
const SEEDS = ['20261101', '20261102', '20261103', '20261104', '20261105', '20261106'];
const FLOORS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * 复制主文件并校验完整性：尾部必须含 </html>，否则说明抓到了半写状态
 * @returns {{bytes:number, md5:string}}
 */
function snapshot() {
  fs.mkdirSync(WORK, { recursive: true });
  fs.copyFileSync(SRC, COPY);
  let text = fs.readFileSync(COPY, 'utf8');
  if (!text.trimEnd().endsWith('</html>')) throw new Error('副本不完整（主文件正在被写入），中止');
  if (PATCHED) {
    const { applyRoomMixPatch } = require('./_roommix_patch');
    text = applyRoomMixPatch(text);
    fs.writeFileSync(COPY, text, 'utf8');
  }
  const crypto = require('crypto');
  const md5 = crypto.createHash('md5').update(text).digest('hex').toUpperCase();
  return { bytes: text.length, md5, patched: PATCHED };
}

async function main() {
  const info = snapshot();
  console.log('副本快照: ' + JSON.stringify(info));

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + COPY.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(900);

  /* 1) 阶段快照：把房型改写函数包一层，记录每一步之后的房型数组 */
  await ev(`(function(){
    window.__stageLog = [];
    function snap(label){
      window.__stageLog.push({
        label: label,
        floor: state.floor,
        stair: state.floor ? state.stairRoomId : null,
        types: state.rooms.map(function(r){ return r.type; }),
        ids: state.rooms.map(function(r){ return r.id; })
      });
    }
    ['assignRoomTypes','ensureRouteVariety','ensureOrdinaryBattleRoom','designEliteRoute',
     'setupEventRoom','applyEventRoomGate'].forEach(function(name){
      var orig = window[name];
      if (typeof orig !== 'function') { window.__stageLog.push({label:'MISSING:'+name}); return; }
      window[name] = function(){
        snap('before:' + name);
        var out = orig.apply(this, arguments);
        snap('after:' + name);
        return out;
      };
    });
    return true;
  })()`);

  /* 2) 主样本：6 种子 × 20 层 */
  const rows = await ev(`(function(){
    var seeds = ${JSON.stringify(SEEDS)};
    var floors = ${JSON.stringify(FLOORS)};
    var out = [];
    for (var si = 0; si < seeds.length; si += 1) {
      for (var fi = 0; fi < floors.length; fi += 1) {
        window.__stageLog = [];
        var sig = window.__roamDebug.p2.probeFloor(seeds[si], floors[fi]);
        out.push({
          seed: seeds[si], floor: floors[fi],
          types: sig.rooms.map(function(r){ return r.type; }),
          rooms: sig.rooms.length,
          stairRoomId: sig.stairRoomId,
          stages: window.__stageLog.slice()
        });
      }
    }
    return out;
  })()`);

  /* 3) 渲染假设：把一间房直接改成 rest，走真实 drawMinimap()，看是否报错 + 取配色口径 */
  const render = await ev(`(function(){
    var errBefore = (window.__errors || []).length;
    var room = state.rooms.find(function(r){ return r.type === 'battle'; });
    if (!room) return { ok: false, note: '没有战斗房可改' };
    room.type = 'rest';
    var drew = false;
    try { drawMinimap(); drew = true; } catch (e) { return { ok: false, note: String(e) }; }
    var cfg = ROOM_TYPE_CONFIG.types.rest;
    var mood = ROOM_LIGHT_MOODS.rest;
    var errAfter = (window.__errors || []).length;
    return {
      ok: drew && errAfter === errBefore,
      minimapColor: cfg.color,
      lightColor: mood.color,
      lightAccent: mood.accent,
      doorIcon: DOOR_VIS_CONFIG.icons.rest,
      doorLabel: DOOR_VIS_CONFIG.labels.rest,
      doorTip: DOOR_INFO_CONFIG.tipByType.rest,
      errBefore: errBefore, errAfter: errAfter
    };
  })()`);

  /* 4) 关键配置快照（占位权重 / 精英权重 / 房间数区间） */
  const cfg = await ev(`(function(){
    return {
      weights: ROOM_TYPE_CONFIG.weights,
      eliteWeightFloor2: ROOM_TYPE_CONFIG.eliteWeightFloor2,
      restReward: ROOM_TYPE_CONFIG.restReward,
      minRooms: FLOOR_GEN_CONFIG.minRooms,
      maxRooms: FLOOR_GEN_CONFIG.maxRooms,
      eliteRoute: typeof ELITE_ROUTE_CONFIG !== 'undefined' ? ELITE_ROUTE_CONFIG.enabled : null,
      compound: typeof COMPOUND_ROOMS !== 'undefined'
    };
  })()`);

  fs.writeFileSync(OUT, JSON.stringify({ info, cfg, render, rows }, null, 1));

  /* 5) 汇总打印 */
  const count = (types) => types.reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {});
  const total = {};
  rows.forEach((r) => { const c = count(r.types); Object.keys(c).forEach((k) => { total[k] = (total[k] || 0) + c[k]; }); });
  console.log('总房间数: ' + rows.reduce((s, r) => s + r.rooms, 0));
  console.log('房型总分布: ' + JSON.stringify(total));
  const perFloor = {};
  rows.forEach((r) => {
    const c = count(r.types);
    perFloor[r.floor] = perFloor[r.floor] || {};
    Object.keys(c).forEach((k) => { perFloor[r.floor][k] = (perFloor[r.floor][k] || 0) + c[k]; });
  });
  console.log('逐层分布(6 采样): ' + JSON.stringify(perFloor));
  console.log('渲染假设: ' + JSON.stringify(render));
  console.log('配置: ' + JSON.stringify(cfg));

  /* 6) 归因：找"rest 被谁吃掉"的记录 */
  let restBorn = 0; let restKilled = [];
  rows.forEach((r) => {
    const log = r.stages;
    for (let i = 0; i < log.length; i += 1) {
      const s = log[i];
      if (!s || !s.types) continue;
      if (s.label.indexOf('after:') === 0 && s.types.indexOf('rest') >= 0) restBorn += 1;
      if (s.label.indexOf('after:') === 0 && i + 1 < log.length && log[i + 1].types
        && s.types.indexOf('rest') >= 0 && log[i + 1].types.indexOf('rest') < 0) {
        restKilled.push({ seed: r.seed, floor: r.floor, stage: log[i + 1].label, before: s.types, after: log[i + 1].types });
      }
    }
  });
  console.log('出现过 rest 的阶段快照数: ' + restBorn + ' / 快照总数(约 ' + (rows.length * 12) + ')');
  console.log('rest 被消除的首批样本: ' + JSON.stringify(restKilled.slice(0, 12)));

  ws.close();
  killEdge(edge);
  /* 副本用完即删 */
  try { fs.unlinkSync(COPY); } catch (e) { /* ignore */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
