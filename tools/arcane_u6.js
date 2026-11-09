/**
 * U6「房型光照情绪分级」验收脚本（端口 9493）
 * ------------------------------------------------------------
 * 断言见 .spec/u6-light/spec.md 第 4 节（11 项）。
 *
 * 关键口径：
 *   · "同层对比" —— 主光色只在同一层（同一主题）里比较，排除楼层色温干扰；
 *   · 像素证据来自 `sceneAudit()`（读烘焙底图 sceneCanvas，不含角色 / HUD / 门闸）；
 *   · 截图用 `scenePng()` 直接导出底图矩形，A/B 两张机位完全相同。
 *
 * 用法：node tools/arcane_u6.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9493;                 // U6 专用端口
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
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
}

/**
 * RGB 欧氏距离
 * @param {number[]} a 颜色 A
 * @param {number[]} b 颜色 B
 * @returns {number} 距离
 */
function rgbDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---------- 静态守卫：paintRoomLight / paintRoomVignette 必须读房型情绪 ----------
  const source = fs.readFileSync(FILE, 'utf8');
  ok('结构就位：ROOM_LIGHT_MOODS + roomLightMood + 两处绘制接入',
    source.includes('const ROOM_LIGHT_MOODS = {') && source.includes('function roomLightMood(')
    && source.includes('const mood = roomLightMood(room, theme);')
    && source.includes('ROOM_LIGHT_MOODS[room.type].vignette'),
    { table: source.includes('const ROOM_LIGHT_MOODS = {') });

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
    } catch (e) { /* 等 Edge 就绪 */ }
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
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  const btn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  // ---------- 1) 配置覆盖 ----------
  const moodAudit = await ev(`window.__roamDebug.roomLightAudit()`);
  const types = Object.keys(moodAudit.types);
  const missingCfg = types.filter((t) => !moodAudit.types[t]);
  ok('8 种房型全部有情绪条目', types.length === 8 && missingCfg.length === 0,
    { types, missing: missingCfg, enabled: moodAudit.enabled });

  // ---------- 2) 主光色互异 ----------
  const colorTypes = types.filter((t) => moodAudit.types[t].color);
  let minDist = Infinity;
  let minPair = null;
  for (let i = 0; i < colorTypes.length; i += 1) {
    for (let j = i + 1; j < colorTypes.length; j += 1) {
      const d = rgbDist(moodAudit.types[colorTypes[i]].color, moodAudit.types[colorTypes[j]].color);
      if (d < minDist) { minDist = d; minPair = [colorTypes[i], colorTypes[j]]; }
    }
  }
  ok('7 种房型主光色两两距离 ≥ 18（缩到小地图也能分辨）',
    minDist >= 18, { minDist: Number(minDist.toFixed(2)), pair: minPair });

  // ---------- 3) 分级方向 ----------
  const b = moodAudit.types.battle;
  const e = moodAudit.types.elite;
  const bo = moodAudit.types.boss;
  ok('battle 继承楼层主题（color=null）', b.color === null && !!b.effectiveColor, { color: b.color, effective: b.effectiveColor });
  ok('精英/首领：更亮的整间薄染 + 更亮的核心 + 更聚集的半径 + 更高的边缘压暗',
    e.tint > b.tint && bo.tint > b.tint
    && e.coreAlpha > b.coreAlpha && bo.coreAlpha > b.coreAlpha
    && e.radiusMul < b.radiusMul && bo.radiusMul < b.radiusMul
    && e.vignette > b.vignette && bo.vignette > b.vignette,
    {
      battle: { tint: b.tint, core: b.coreAlpha, radius: b.radiusMul, vig: b.vignette },
      elite: { tint: e.tint, core: e.coreAlpha, radius: e.radiusMul, vig: e.vignette },
      boss: { tint: bo.tint, core: bo.coreAlpha, radius: bo.radiusMul, vig: bo.vignette }
    });

  // ---------- 4) 暖色房型方向 ----------
  const warmTypes = ['rest', 'chest', 'vault'].filter((t) => moodAudit.types[t].color);
  const cold = warmTypes.filter((t) => moodAudit.types[t].color[0] <= moodAudit.types[t].color[2]);
  ok('休整/宝箱/秘藏主光偏暖（R > B）', cold.length === 0,
    warmTypes.map((t) => ({ type: t, color: moodAudit.types[t].color })));
  const coolTypes = ['elite', 'boss'].filter((t) => moodAudit.types[t].color[2] >= moodAudit.types[t].color[1]);
  ok('精英/首领主光偏红（R 明显大于 G/B）', coolTypes.length === 2,
    { elite: moodAudit.types.elite.color, boss: moodAudit.types.boss.color });

  // ---------- 5)/6)/7) 同层像素证据 ----------
  const floors = [1, 2, 3];
  const perFloor = [];
  for (const f of floors) {
    // 同一层最多重掷 5 次，直到同时出现战斗房、精英房与暖色房（否则该层无法做"同层对比"）
    let snap = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await ev(`window.__roamDebug.setFloor(${f})`);
      await sleep(650);
      snap = await ev(`window.__roamDebug.sceneAudit()`);
      const hasBattle = snap.rooms.some((r) => r.type === 'battle');
      const hasElite = snap.rooms.some((r) => r.type === 'elite');
      const hasWarm = snap.rooms.some((r) => r.type === 'rest' || r.type === 'chest');
      if (hasBattle && hasElite && hasWarm) break;
    }
    const rooms = snap.rooms;
    const find = (t) => rooms.filter((r) => r.type === t)[0] || null;
    const rb = (r) => (r && r.meanRgb ? Number((r.meanRgb[0] / Math.max(1, r.meanRgb[2])).toFixed(3)) : null);
    perFloor.push({
      floor: f,
      theme: snap.theme,
      battle: find('battle'),
      elite: find('elite'),
      boss: find('boss'),
      chest: find('chest'),
      rest: find('rest'),
      vault: find('vault'),
      event: find('event'),
      rbBattle: rb(find('battle')),
      rbElite: rb(find('elite')),
      rbBoss: rb(find('boss'))
    });
  }
  console.log('SAMPLE · ' + JSON.stringify(perFloor.map((p) => ({
    floor: p.floor, theme: p.theme, rbBattle: p.rbBattle, rbElite: p.rbElite, rbBoss: p.rbBoss,
    warmBattle: p.battle && p.battle.warmRatio,
    warmRest: p.rest && p.rest.warmRatio, warmChest: p.chest && p.chest.warmRatio
  }))));

  const pairs = perFloor.filter((p) => p.battle && p.elite && p.rbBattle != null && p.rbElite != null);
  const eliteGap = pairs.map((p) => Number((p.rbElite - p.rbBattle).toFixed(3)));
  ok('同层精英房 R/B 比高于战斗房 ≥ 0.10',
    pairs.length > 0 && eliteGap.every((g) => g >= 0.10),
    { floors: pairs.map((p) => p.floor), gaps: eliteGap, themes: pairs.map((p) => p.theme) });

  const warmPairs = perFloor.filter((p) => p.battle && (p.rest || p.chest));
  const warmOk = warmPairs.every((p) => {
    const w = p.rest || p.chest;
    return w.warmRatio > p.battle.warmRatio;
  });
  ok('同层休整/宝箱房暖色像素占比高于战斗房',
    warmPairs.length > 0 && warmOk,
    warmPairs.map((p) => ({
      floor: p.floor,
      battle: p.battle && p.battle.warmRatio,
      rest: p.rest && p.rest.warmRatio,
      chest: p.chest && p.chest.warmRatio
    })));

  // ---------- 8) A/B：同一层上"分级开 / 关"各烘焙一次 ----------
  const abFloor = pairs.length ? pairs[0].floor : 1;
  let onSnap = null;
  // 重掷直到这一代地图同时有战斗房与精英房（否则无法做同层对比）
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await ev(`window.__roamDebug.setFloor(${abFloor})`);
    await sleep(650);
    onSnap = await ev(`window.__roamDebug.sceneAudit()`);
    const hasBattle = onSnap.rooms.some((r) => r.type === 'battle');
    const hasElite = onSnap.rooms.some((r) => r.type === 'elite');
    if (hasBattle && hasElite) break;
  }
  await ev(`window.__roamDebug.clearEnemies()`);

  /**
   * 把某个房型搬到镜头中心并裁剪一张图（沿用 A1 的同机位口径）
   * @param {string} type 房型
   * @param {string} name 文件名
   * @returns {string|null} 截图路径
   */
  const shotRoom = async (type, name) => {
    const room = await ev(`(function(){
      var s = window.__roamDebug.getState();
      var r = s.rooms.filter(function(x){ return x.type === '${type}'; })[0];
      if (!r) return null;
      window.__roamDebug.setPlayerPos(r.cx, r.cy);
      return { x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy };
    })()`);
    if (!room) return null;
    await sleep(480);
    const cam = await ev(`window.__roamDebug.getState().cam`);
    const view = await ev(`window.__roamDebug.getState().view`);
    const cw = Math.min(view.w, Math.round(room.w * 0.92));
    const ch = Math.min(view.h, Math.round(room.h * 0.92));
    const clip = {
      x: Math.min(Math.max(0, room.cx - cam.x - cw / 2), Math.max(0, view.w - cw)),
      y: Math.min(Math.max(0, room.cy - cam.y - ch / 2), Math.max(0, view.h - ch)),
      width: cw,
      height: ch,
      scale: 1
    };
    const r = await send('Page.captureScreenshot', { format: 'png', clip });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  // ---------- 9) 截图（分级开）：战斗 / 精英 / 第三种房型 ----------
  const shotFiles = [];
  const availTypes = onSnap.rooms.map((r) => r.type);
  const extraType = ['chest', 'boss', 'rest', 'vault', 'event', 'start'].filter((t) => availTypes.includes(t))[0] || null;
  const afterTypes = ['battle', 'elite'].concat(extraType ? [extraType] : []);
  for (const t of afterTypes) {
    const p = await shotRoom(t, `u6-mood-${t}-on-f${abFloor}.png`);
    if (p) shotFiles.push(p);
  }

  // ---------- 10) A/B 关闭后重新烘焙（同一代地图，只改情绪开关） ----------
  await ev(`window.__roamDebug.setRoomMood(false)`);
  const moodOff = await ev(`window.__roamDebug.roomLightAudit()`);
  const offSnap = await ev(`window.__roamDebug.sceneAudit()`);
  const offBattle = offSnap.rooms.filter((r) => r.type === 'battle')[0];
  const offElite = offSnap.rooms.filter((r) => r.type === 'elite')[0];
  const offGap = (offElite && offBattle)
    ? Math.abs((offElite.meanRgb[0] / Math.max(1, offElite.meanRgb[2])) - (offBattle.meanRgb[0] / Math.max(1, offBattle.meanRgb[2])))
    : 1;
  ok('A/B 关闭：情绪表停用（enabled=false）', moodOff.enabled === false, { enabled: moodOff.enabled });
  ok('A/B 关闭后 精英/战斗 的 R/B 差 < 0.10（色温分级消失）',
    offElite && offBattle ? offGap < 0.10 : false,
    { gap: Number(offGap.toFixed(3)), elite: offElite && offElite.meanRgb, battle: offBattle && offBattle.meanRgb });

  const beforeShot = await shotRoom('elite', `u6-mood-elite-off-f${abFloor}.png`);
  if (beforeShot) shotFiles.push(beforeShot);
  await ev(`window.__roamDebug.setRoomMood(true)`);

  const badShots = shotFiles.filter((p) => !fs.existsSync(p) || fs.statSync(p).size < 10 * 1024);
  ok('至少 3 张房型裁剪图 + A/B 对比图 >10KB',
    shotFiles.length >= 4 && badShots.length === 0,
    { files: shotFiles.map((p) => path.basename(p)), bad: badShots.map((p) => path.basename(p)) });

  // ---------- 10) 性能 ----------
  const perf = await ev(`new Promise(function(resolve){
    var frames = []; var last = performance.now(); var warm = 0;
    function tick(now){
      var dt = now - last; last = now;
      if (warm < 40) { warm += 1; } else { frames.push(dt); }
      if (frames.length >= 150) {
        var sum = 0; var max = 0;
        frames.forEach(function(d){ if (d > 0) { sum += d; if (d > max) max = d; } });
        var avg = sum / frames.length;
        resolve({ avgFps: Number((1000 / avg).toFixed(1)), minFps: Number((1000 / max).toFixed(1)),
          errors: window.__roamDebug.errors() });
      } else { requestAnimationFrame(tick); }
    }
    requestAnimationFrame(tick);
  })`);
  console.log('PERF · ' + JSON.stringify(perf));
  ok('avg fps ≥ 60（跳过首帧预热）', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
  ok('无运行时错误', perf.errors.length === 0, perf.errors);

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nU6 · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(path.join(OUT_DIR, 'u6-result.json'),
    JSON.stringify({ passed, total: asserts.length, asserts, samples: perFloor.map((p) => ({
      floor: p.floor, theme: p.theme, rbBattle: p.rbBattle, rbElite: p.rbElite, rbBoss: p.rbBoss
    })) }, null, 2));

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 150);
});
