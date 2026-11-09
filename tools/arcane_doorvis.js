/**
 * H1 出入口可读性验收
 * 用法：node tools/arcane_doorvis.js
 * 端口：9561
 * 产出：.screenshots/art/h1-door-vis-before.png / h1-door-vis-after.png
 *       .screenshots/art/h1-doorvis-result.json
 *
 * 断言（逐门）：
 *  H0 配置默认值：enabled / fogUnvisited / hintRange=90 / 门牌文本 ≤6 字
 *  H1 每扇有目标的门都有门牌文本（非空、<12 字），颜色与状态一一对应
 *  H2 未探索门只显示"未知"（不泄露房型）；reveal(true) 后显示真实房型
 *  H3 三态计算正确：locked / visited / open（纯函数验证）
 *  H4 距离：≤90px 出现"按 E 进入"且门框有光晕；拉远后消失
 *  H5 渲染统计自洽：plates == 门数，arrows/glows/minimapBlink 与可通行门数一致
 *  H6 A/B 总开关：关闭后渲染统计全 0，打开恢复
 *  H7 before/after 截图各 1 张（>60KB）
 *  H8 fps ≥60 / 无脚本错误
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9561;
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

  // ---------- H0 配置默认值 ----------
  const h0 = await ev(`(function(){
    var cfg = window.__roamDebug.doorVis.info().config;
    var labels = Object.keys(cfg.labels).map(function(k){ return cfg.labels[k]; });
    var tooLong = labels.filter(function(s){ return s.length > 6; });
    return { cfg: cfg, tooLong: tooLong, labels: labels.length };
  })()`);
  ok('H0 配置：开关开 / 未探索显示未知 / 90px 提示 / 门牌 ≤6 字',
    h0.cfg.enabled === true && h0.cfg.fogUnvisited === true && h0.cfg.hintRange === 90
      && h0.tooLong.length === 0, { hintRange: h0.cfg.hintRange, tooLong: h0.tooLong });

  // ---------- H1 逐门门牌 + 颜色 ----------
  const h1 = await ev(`(function(){
    var list = window.__roamDebug.doorVis.audit();
    var colors = window.__roamDebug.doorVis.info().config.colors;
    var bad = list.filter(function(d){
      if (!d.text || d.textLen >= 12) return true;
      if (d.state === 'open' && d.color !== colors.open) return true;
      if (d.state === 'locked' && d.color !== colors.locked) return true;
      if (d.state === 'visited' && d.color !== colors.visited) return true;
      return false;
    });
    return { count: list.length, bad: bad.length, sample: list.slice(0, 3) };
  })()`);
  ok('H1 每扇门都有门牌（<12 字）且颜色与状态匹配',
    h1.count > 0 && h1.bad === 0, h1);

  // ---------- H2 未探索不剧透 ----------
  const h2 = await ev(`(function(){
    var list = window.__roamDebug.doorVis.audit();
    var fogged = list.filter(function(d){ return d.unknown; });
    var known = list.filter(function(d){ return !d.unknown; });
    var probe = null;
    if (fogged.length) {
      var id = fogged[0].id;
      var before = fogged[0].text;
      window.__roamDebug.doorInfo.reveal(true);
      var after = window.__roamDebug.doorVis.audit().filter(function(d){ return d.id === id; })[0];
      window.__roamDebug.doorInfo.reveal(false);
      probe = { id: id, before: before, after: after ? after.text : null, afterUnknown: after ? after.unknown : null };
    }
    return { fogged: fogged.length, known: known.length, probe: probe };
  })()`);
  ok('H2 未探索门显示"未知"；探测后显示真实房型',
    h2.fogged > 0 && h2.probe && h2.probe.before === '? 未知'
      && h2.probe.afterUnknown === false && h2.probe.after.indexOf('未知') < 0, h2);

  // ---------- H3 三态纯函数 ----------
  const h3 = await ev(`(function(){
    var door = state.doors.filter(function(d){ return d.targetRoomId >= 0; })[0];
    var room = state.rooms[door.roomId];
    var target = state.rooms[door.targetRoomId];
    var savedLocked = room.locked;
    var savedVisited = target.visited;
    var savedCleared = target.cleared;
    var colors = DOOR_VIS_CONFIG.colors;
    // 1) 锁定
    room.locked = true; target.visited = false; target.cleared = false;
    var locked = doorVisFor(door);
    // 2) 已探索可回访
    room.locked = false; target.visited = true;
    var visited = doorVisFor(door);
    // 3) 可通行未探索
    target.visited = false; target.cleared = false;
    var open = doorVisFor(door);
    // 还原现场，避免影响后续渲染
    room.locked = savedLocked; target.visited = savedVisited; target.cleared = savedCleared;
    return {
      locked: { state: locked.state, color: locked.color, passable: locked.passable },
      visited: { state: visited.state, color: visited.color, passable: visited.passable },
      open: { state: open.state, color: open.color, unknown: open.unknown },
      colors: colors
    };
  })()`);
  ok('H3 三态：锁定=红不可通行 / 已探索=暗青可通行 / 未探索=青绿可通行',
    h3.locked.state === 'locked' && h3.locked.color === h3.colors.locked && h3.locked.passable === false
      && h3.visited.state === 'visited' && h3.visited.color === h3.colors.visited && h3.visited.passable === true
      && h3.open.state === 'open' && h3.open.color === h3.colors.open && h3.open.unknown === true, h3);

  // ---------- H4 距离提示（90px） ----------
  const near = await ev(`(function(){
    var door = state.doors.filter(function(d){ return d.targetRoomId >= 0; })[0];
    var room = state.rooms[door.roomId];
    var cx = room.x + room.w / 2, cy = room.y + room.h / 2;
    var ux = cx - door.x, uy = cy - door.y;
    var len = Math.hypot(ux, uy) || 1; ux /= len; uy /= len;
    var p = state.player;
    p.x = door.x + ux * 60; p.y = door.y + uy * 60;
    return { doorId: door.id, x: Math.round(p.x), y: Math.round(p.y) };
  })()`);
  await sleep(350);
  const h4near = await ev(`(function(){
    var a = window.__roamDebug.doorVis.audit();
    var s = window.__roamDebug.doorVis.info().stats;
    var t = a.filter(function(d){ return d.id === ${near.doorId}; })[0];
    return { dist: t ? t.dist : -1, hintVisible: t ? t.hintVisible : false, stats: s };
  })()`);
  ok('H4a 贴近门（≤90px）：出现"按 E 进入" + 门框光晕',
    h4near.dist <= 90 && h4near.hintVisible === true
      && h4near.stats.hints >= 1 && h4near.stats.glows >= 1, h4near);

  const far = await ev(`(function(){
    var door = state.doors.filter(function(d){ return d.targetRoomId >= 0; })[0];
    var room = state.rooms[door.roomId];
    var p = state.player;
    p.x = room.x + room.w / 2; p.y = room.y + room.h / 2;
    return { cx: Math.round(p.x), cy: Math.round(p.y) };
  })()`);
  await sleep(350);
  const h4far = await ev(`(function(){
    var a = window.__roamDebug.doorVis.audit();
    var s = window.__roamDebug.doorVis.info().stats;
    return { minDist: a.reduce(function(m, d){ return Math.min(m, d.dist); }, 1e9), stats: s };
  })()`);
  ok('H4b 拉回房间中心（>90px）：提示消失',
    h4far.minDist > 90 && h4far.stats.hints === 0, h4far);

  // ---------- H5 渲染统计自洽 ----------
  const h5 = await ev(`(function(){
    var a = window.__roamDebug.doorVis.audit();
    var s = window.__roamDebug.doorVis.info().stats;
    var shouldBlink = a.filter(function(d){ return d.minimapBlink; }).length;
    return { doors: a.length, stats: s, shouldBlink: shouldBlink };
  })()`);
  ok('H5 统计自洽：门牌=门数 / 箭头>0 / 小地图闪烁数≥1',
    h5.stats.plates === h5.doors && h5.stats.arrows > 0
      && h5.stats.minimapBlink >= 1 && h5.stats.minimapBlink <= h5.shouldBlink, h5);

  // ---------- H6 A/B 总开关 ----------
  const h6off = await ev(`(function(){
    window.__roamDebug.doorVis.setEnabled(false);
    return true;
  })()`);
  await sleep(320);
  const h6a = await ev(`window.__roamDebug.doorVis.info().stats`);
  const h6on = await ev(`(function(){
    window.__roamDebug.doorVis.setEnabled(true);
    return true;
  })()`);
  await sleep(320);
  const h6b = await ev(`window.__roamDebug.doorVis.info().stats`);
  ok('H6 A/B：关闭后渲染统计全 0，打开后恢复',
    h6a.plates === 0 && h6a.hints === 0 && h6a.glows === 0 && h6a.arrows === 0
      && h6b.plates >= 1 && h6b.arrows >= 1, { off: h6a, on: h6b });

  // ---------- H7 before / after 截图 ----------
  await ev(`(function(){
    var door = state.doors.filter(function(d){ return d.targetRoomId >= 0; })[0];
    var room = state.rooms[door.roomId];
    var cx = room.x + room.w / 2, cy = room.y + room.h / 2;
    var ux = cx - door.x, uy = cy - door.y;
    var len = Math.hypot(ux, uy) || 1; ux /= len; uy /= len;
    var p = state.player;
    p.x = door.x + ux * 60; p.y = door.y + uy * 60;
    return true;
  })()`);
  await sleep(400);
  await ev(`window.__roamDebug.doorVis.setEnabled(false)`);
  await sleep(300);
  await shot('h1-door-vis-before.png');
  await ev(`window.__roamDebug.doorVis.setEnabled(true)`);
  await sleep(300);
  await shot('h1-door-vis-after.png');
  const beforeSize = fs.statSync(path.join(OUT_DIR, 'h1-door-vis-before.png')).size;
  const afterSize = fs.statSync(path.join(OUT_DIR, 'h1-door-vis-after.png')).size;
  ok('H7 before/after 截图各 1 张（>60KB）',
    beforeSize > 61440 && afterSize > 61440, { before: beforeSize, after: afterSize });

  // ---------- H8 fps / 错误 ----------
  const h8 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){ return { fps: f, errors: (window.__errors || []).length }; });
  })()`);
  ok('H8 fps ≥60 / 无脚本错误', h8.fps >= 60 && h8.errors === 0, h8);

  fs.writeFileSync(path.join(OUT_DIR, 'h1-doorvis-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== h1 doorvis ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
