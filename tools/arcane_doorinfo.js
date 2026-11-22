/**
 * A1 门口信息板验收：A0–A6
 * 用法：node tools/arcane_doorinfo.js
 * 端口：9517
 * 输出：.screenshots/art/choice-doorinfo.png、choice-doorinfo-result.json
 *
 * 断言：
 *  A0 开关/距离/迷雾默认值 + 提示表覆盖全部房型
 *  A1 当前楼层每扇有目标的门都能算出信息（提示非空、风险档在三档内）
 *  A2 房型→风险档/提示映射正确（宝箱安全无战斗 / 精英危险 / 首领危险 / 休整安全 / 战斗常规）
 *  A3 迷雾：未访问房 → 未探测；reveal(true) 后恢复具体信息
 *  A4 距离：贴近门 → 本帧 labels≥1；回到房间中心（>132px）→ labels=0
 *  A5 总开关关闭 → labels=0，开回来 >0
 *  A6 截图 >10KB / fps≥60 / 无脚本错误
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9517;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1300);

  // ---------- A0 默认值 + 提示表覆盖 ----------
  const a0 = await ev(`(function(){
    var missing = Object.keys(ROOM_TYPE_CONFIG.types).filter(function(k){
      return !DOOR_INFO_CONFIG.tipByType[k];
    });
    return { info: window.__roamDebug.doorInfo.info(), missing: missing, types: Object.keys(ROOM_TYPE_CONFIG.types) };
  })()`);
  ok('A0 配置默认值正确 + 提示表覆盖全部房型',
    a0.info.enabled === true && a0.info.fog === false && a0.info.showRange === 132
      && a0.missing.length === 0, a0);

  // ---------- A1 当前楼层每扇门 ----------
  const a1 = await ev(`(function(){
    var list = window.__roamDebug.doorInfo.doors().filter(function(d){ return d.targetRoomId >= 0; });
    var bad = list.filter(function(d){
      return !d.info || !d.info.tip || !/^(安全|常规|危险)$/.test(d.info.riskLabel);
    });
    return { count: list.length, bad: bad.length, sample: list.slice(0, 2) };
  })()`);
  ok('A1 每扇有目标的门都有信息（提示非空 / 风险档在三档内）',
    a1.count > 0 && a1.bad === 0, a1);

  // ---------- A2 映射 ----------
  const a2 = await ev(`(function(){
    var ids = ['start','battle','elite','chest','event','rest','shop','survival','vault','boss'];
    var out = {};
    ids.forEach(function(id){ out[id] = window.__roamDebug.doorInfo.tipFor(id); });
    return out;
  })()`);
  ok('A2 房型→风险档/提示映射（宝箱=安全+无战斗 / 精英=危险 / 首领=危险 / 休整=安全 / 战斗=常规）',
    a2.chest.riskLabel === '安全' && a2.chest.tip.indexOf('无战斗') >= 0
      && a2.elite.riskLabel === '危险' && a2.boss.riskLabel === '危险'
      && a2.rest.riskLabel === '安全' && a2.battle.riskLabel === '常规'
      && a2.chest.tip && a2.elite.tip && a2.boss.tip, a2);

  // ---------- A3 迷雾 ----------
  // R1 起 "未知" 只留给真正没走到过的门：当前房间的相邻门永远可读。
  // 所以这里必须挑一扇"非相邻"的门，否则测的是被明确改掉的老语义。
  const a3 = await ev(`(function(){
    DOOR_INFO_CONFIG.fog = true;
    var cur = state.currentRoomId;
    function nonAdjacent(door){
      return door.targetRoomId >= 0 && door.roomId !== cur && door.targetRoomId !== cur;
    }
    var d = state.doors.find(function(door){
      var t = state.rooms[door.targetRoomId];
      return nonAdjacent(door) && t && !t.visited && !t.cleared && !t.pricedTag;
    });
    if (!d) {
      // 兜底：找一扇非相邻、非双价的门，把目标房改成"未访问"，只为验证迷雾分支
      d = state.doors.find(nonAdjacent);
      var t2 = state.rooms[d.targetRoomId];
      t2.visited = false; t2.cleared = false; t2.pricedTag = null;
    }
    var before = doorInfoFor(d);
    var revealed = window.__roamDebug.doorInfo.reveal(true);
    var after = doorInfoFor(d);
    DOOR_INFO_CONFIG.fog = false;
    window.__roamDebug.doorInfo.reveal(false);
    return {
      unknownText: DOOR_INFO_CONFIG.unknownText,
      adjacent: d.roomId === cur || d.targetRoomId === cur,
      before: { unknown: before.unknown, typeName: before.typeName },
      after: { unknown: after.unknown, typeName: after.typeName },
      revealed: revealed
    };
  })()`);
  ok('A3 迷雾：非相邻且未访问→未探测；reveal(true) 后恢复具体信息',
    a3.adjacent === false
      && a3.before.unknown === true && a3.after.unknown === false && a3.revealed === true
      && a3.unknownText === '未探测 · 随机', a3);

  // ---------- A3b 相邻门永远可读 ----------
  // R1 的另一半：当前房间的相邻门，不管有没有访问过，门牌和信息板都必须读得出
  // 房型/危险度，且绝不能显示"未知"。这里故意把 fog 打开（最坏情况），
  // 用来证明"相邻"这一条能压过迷雾开关。
  const a3b = await ev(`(function(){
    DOOR_INFO_CONFIG.fog = true;
    var cur = state.currentRoomId;
    var adj = state.doors.filter(function(door){
      return door.targetRoomId >= 0 && door.roomId === cur;
    });
    if (!adj.length) { DOOR_INFO_CONFIG.fog = false; return null; }
    var d = adj[0];
    var t = state.rooms[d.targetRoomId];
    var sv = t.visited, sc = t.cleared;
    t.visited = false; t.cleared = false;
    var infoU = doorInfoFor(d), visU = doorVisFor(d);
    t.visited = true; t.cleared = false;
    var infoV = doorInfoFor(d);
    t.visited = sv; t.cleared = sc;
    DOOR_INFO_CONFIG.fog = false;
    return {
      count: adj.length,
      typeName: infoU.typeName, riskLabel: infoU.riskLabel,
      unvisited: { infoUnknown: infoU.unknown, plateUnknown: visU.unknown, plateLabel: visU.label },
      visited: { infoUnknown: infoV.unknown }
    };
  })()`);
  ok('A3b 相邻门永远可读：未访问/已访问都不得显示"未知"，房型与危险度可见',
    !!a3b
      && a3b.unvisited.infoUnknown === false && a3b.visited.infoUnknown === false
      && a3b.unvisited.plateUnknown === false && a3b.unvisited.plateLabel !== '未知'
      && !!a3b.typeName && !!a3b.riskLabel, a3b);

  // ---------- A4 距离 ----------
  const a4 = await ev(`(function(){
    var d = state.doors.find(function(door){
      return door.targetRoomId >= 0 && !door.eliteRoute && !state.rooms[door.roomId].locked;
    });
    if (!d) return null;
    var r = state.rooms[d.roomId];
    var nx = r.cx - d.x, ny = r.cy - d.y;
    var len = Math.max(1, Math.sqrt(nx * nx + ny * ny));
    state.player.x = d.x + nx / len * 40;
    state.player.y = d.y + ny / len * 40;
    state.player.vx = 0; state.player.vy = 0;
    return { door: { x: Math.round(d.x), y: Math.round(d.y) }, roomId: d.roomId, dist: 40 };
  })()`);
  await sleep(220);
  await shot('choice-doorinfo.png');
  const a4near = await ev(`window.__roamDebug.doorInfo.info().stats`);
  const a4back = await ev(`(function(){
    var r = state.rooms[state.currentRoomId];
    state.player.x = r.cx; state.player.y = r.cy;
    state.player.vx = 0; state.player.vy = 0;
    return { cx: Math.round(r.cx), cy: Math.round(r.cy) };
  })()`);
  await sleep(220);
  const a4far = await ev(`window.__roamDebug.doorInfo.info().stats`);
  ok('A4 距离：贴近门 labels≥1；回到房间中心 labels=0',
    a4near.labels >= 1 && a4far.labels === 0, { near: a4near, far: a4far, back: a4back });

  // ---------- A5 总开关（把玩家放回门边，才能区分"关"与"开"） ----------
  await ev(`(function(){
    var d = state.doors.find(function(door){
      return door.targetRoomId >= 0 && !door.eliteRoute && !state.rooms[door.roomId].locked;
    });
    if (d) {
      var r = state.rooms[d.roomId];
      var nx = r.cx - d.x, ny = r.cy - d.y;
      var len = Math.max(1, Math.sqrt(nx * nx + ny * ny));
      state.player.x = d.x + nx / len * 40;
      state.player.y = d.y + ny / len * 40;
      state.player.vx = 0; state.player.vy = 0;
    }
    DOOR_INFO_CONFIG.enabled = false;
    return true;
  })()`);
  await sleep(220);
  const a5off = await ev(`window.__roamDebug.doorInfo.info().stats`);
  await ev(`(function(){ DOOR_INFO_CONFIG.enabled = true; return true; })()`);
  await sleep(220);
  const a5on = await ev(`window.__roamDebug.doorInfo.info().stats`);
  ok('A5 A/B：关闭时 labels=0，开回来 labels≥1',
    a5off.labels === 0 && a5on.labels >= 1, { off: a5off, on: a5on });

  // ---------- A6 fps / 错误 / 截图 ----------
  const a6 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){
      return { fps: f, errors: (window.__errors || []).length };
    });
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'choice-doorinfo.png')).size; } catch (e) { shotSize = 0; }
  ok('A6 截图 >10KB / fps≥60 / 无脚本错误',
    shotSize > 10240 && a6.fps >= 60 && a6.errors === 0, { shot: shotSize, a6 });

  fs.writeFileSync(path.join(OUT_DIR, 'choice-doorinfo-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== choice-a1 doorinfo ' + pass + '/' + asserts.length + ' ===== (shot ' + shotSize + 'B)');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
