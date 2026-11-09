/**
 * U7「模板房间 + 柱体碰撞」验收脚本（端口 9495）
 * ------------------------------------------------------------
 * 断言口径（对应 .spec/u7-rooms/spec.md 第 4 节）：
 *   · 形状只看"房间数据 + 可走性探针"，不依赖像素：切角点不可走、房心可走；
 *   · 立柱先用 walkProbe 证明"柱心不可走 / 柱外可走"，再用真实按键推进证明"穿不过去"；
 *   · A/B 关闭走 setRoomTemplates(false)：会同步重建碰撞几何并重烘焙场景，
 *     所以关掉后同一个切角点必须变回可走（这是"贴图与碰撞同步"的反证）；
 *   · 截图用 Page.captureScreenshot（headless 下 canvas.toDataURL 拿不到像素）。
 *
 * 用法：node tools/arcane_u7.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9495;                 // U7 专用端口（L1 9489 / L2 9490 / L4 9491 / U8 9492 / U6 9493 / U4b 9494）
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据（会打印到控制台）
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---------- 1) 静态守卫：配置与关键函数都在 ----------
  const source = fs.readFileSync(FILE, 'utf8');
  const staticOk = source.includes('const ROOM_TEMPLATE_CONFIG = {')
    && source.includes('function roomShapeGeometry(')
    && source.includes('function rebuildRoomWalkGeometry(')
    && source.includes('function isWalkBlocked(')
    && source.includes('state.walkBlockers.push(')
    && source.includes('function paintRoomShapeMask(')
    && source.includes('function drawRoomPillars(');
  ok('结构就位：ROOM_TEMPLATE_CONFIG / 三层几何 / 形状遮罩 / 立柱绘制',
    staticOk, { template: source.includes('const ROOM_TEMPLATE_CONFIG = {') });

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
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

  /**
   * 发一条 CDP 命令并等回包
   * @param {string} method 方法名
   * @param {Object} params 参数
   * @returns {Promise<Object>} 结果
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 在页面里求值并返回值
   * @param {string} expression 表达式
   * @returns {Promise<*>} 结果
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /**
   * 截全屏并落盘
   * @param {string} name 文件名
   * @returns {string} 绝对路径
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };
  /**
   * 按住一个方向键一段时间（用于"真实按键撞柱子"）
   * @param {string} key 键名
   * @param {number} code 虚拟键码
   * @param {number} ms 持续毫秒
   */
  const holdKey = async (key, code, ms) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await sleep(ms);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  };
  /**
   * 传送到某个房间中心并等镜头跟上
   * @param {Object} room 审计出的房间（含 cx / cy）
   * @param {number} wait 等待毫秒
   */
  const gotoRoom = async (room, wait) => {
    await ev(`window.__roamDebug.teleport(${room.cx}, ${room.cy})`);
    await sleep(wait || 700);
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

  // ---------- 2) 同层形状覆盖 ----------
  /* C1-6 补：每层从 6 间收到 5 间后，个别种子的起手层可能刚好没有 L 房或八边房，
     "L 形房 / 八边房"断言就会因为"没抽到"而假红（不是形状没生效）。
     这里先按层扫一遍，挑一层八边 / L / 圆形首领场都齐的做起手层，再开始断言。 */
  let audit = null;
  for (let f = 1; f <= 12 && !audit; f += 1) {
    await ev(`window.__roamDebug.event.newFloor(${f})`);
    await sleep(220);
    const a = await ev(`window.__roamDebug.roomShapeAudit()`);
    const has = new Set(a.rooms.map((r) => r.shape));
    if (has.has('oct') && has.has('L') && has.has('circle')) audit = a;
  }
  if (!audit) audit = await ev(`window.__roamDebug.roomShapeAudit()`);
  const shapes = Array.from(new Set(audit.rooms.map((r) => r.shape)));
  ok('同层至少 2 种形状 + 立柱 ≥ 2 根（模板真的生效）',
    shapes.length >= 2 && audit.totals.pillars >= 2,
    { shapes: shapes, totals: audit.totals, theme: audit.theme, blockers: audit.blockers, rects: audit.walkRects });

  const bossRoom = audit.rooms.find((r) => r.type === 'boss');
  const bossCornersBlocked = bossRoom ? Object.keys(bossRoom.corners).filter((k) => bossRoom.corners[k] === false).length : 0;
  // 逐角诊断：可走的那个角究竟被哪块地板矩形 / 圆盘覆盖（排除"相邻走廊"这类合法覆盖）
  const bossCornerDetail = bossRoom ? await ev(`(function(){
    var r = ${JSON.stringify(bossRoom)};
    var pts = { tl: [r.x + 10, r.y + 10], tr: [r.x + r.w - 10, r.y + 10],
                bl: [r.x + 10, r.y + r.h - 10], br: [r.x + r.w - 10, r.y + r.h - 10] };
    var out = {};
    Object.keys(pts).forEach(function(k){
      out[k] = { walkable: window.__roamDebug.walkProbe(pts[k][0], pts[k][1], 10).walkable,
                 hit: window.__roamDebug.walkDescribe(pts[k][0], pts[k][1]) };
    });
    return out;
  })()`) : null;
  ok('首领房：恰好 1 个圆盘、房心可走、至少 3 个角点在圆外',
    !!bossRoom && bossRoom.shape === 'circle' && audit.walkCircles.length === 1
      && bossRoom.centerWalkable === true && bossCornersBlocked >= 3,
    { circle: audit.walkCircles, corners: bossRoom && bossRoom.corners, center: bossRoom && bossRoom.centerWalkable, detail: bossCornerDetail });

  const octRoom = audit.rooms.find((r) => r.shape === 'oct');
  const octBlocked = octRoom ? Object.keys(octRoom.corners).filter((k) => octRoom.corners[k] === false).length : 0;
  ok('八边房：房心可走、至少 3 个角点被切掉',
    !!octRoom && octRoom.centerWalkable === true && octBlocked >= 3,
    { id: octRoom && octRoom.id, corners: octRoom && octRoom.corners, blocked: octBlocked });

  const lRoom = audit.rooms.find((r) => r.shape === 'L');
  ok('L 形房：缺口右上角不可走、左下角与房心仍可走',
    !!lRoom && lRoom.corners.tr === false && lRoom.corners.bl === true && lRoom.centerWalkable === true,
    { id: lRoom && lRoom.id, corners: lRoom && lRoom.corners });

  // ---------- 3) 立柱碰撞 ----------
  const pillar = await ev(`window.__roamDebug.pillarProbe()`);
  ok('立柱参与碰撞：柱心不可走、柱外一圈可走',
    !!pillar && pillar.centerWalkable === false && pillar.blockedAtCenter === true && pillar.outsideWalkable === true,
    pillar);

  // ---------- 4) 真实按键：持续推进也穿不过柱心 ----------
  const moveSetup = await ev(`(function(){
    var p = window.__roamDebug.pillarProbe();
    if (!p) return null;
    window.__roamDebug.setHp(240);
    var startX = p.pillar.x - (p.pillar.r + 46);
    window.__roamDebug.teleport(startX, p.pillar.y);
    return { pillar: p.pillar, startX: startX, expect: p.pillar.r + 14 - 8 };
  })()`);
  let move = null;
  if (moveSetup) {
    await holdKey('ArrowRight', 39, 700);
    await sleep(140);
    const ps = await ev(`window.__roamDebug.getState()`);
    move = {
      gap: Number((moveSetup.pillar.x - ps.player.x).toFixed(1)),
      expectMin: moveSetup.expect,
      player: { x: Math.round(ps.player.x), y: Math.round(ps.player.y) }
    };
  }
  ok('朝柱子持续推进 0.7s 也穿不过去（距柱心 ≥ 柱半径 + 玩家半径 - 8）',
    !!move && move.gap >= move.expectMin,
    move);

  // ---------- 5) 刷怪安全 ----------
  const spawnAudit = await ev(`window.__roamDebug.spawnSafetyAudit()`);
  ok('所有敌人初始位置合法（没有落在切角块 / 立柱里）',
    spawnAudit.bad.length === 0,
    spawnAudit);

  // ---------- 6) 截图：八边 / L / 圆形首领场 ----------
  await ev(`window.__roamDebug.clearEnemies()`);
  if (octRoom) await gotoRoom(octRoom, 900);
  const shotOct = await shot('u7-room-oct-on.png');
  if (lRoom) await gotoRoom(lRoom, 900);
  const shotL = await shot('u7-room-L-on.png');
  if (bossRoom) {
    await ev(`window.__roamDebug.setHp(240)`);
    await gotoRoom(bossRoom, 2700);   // 等首领登场大字收起，避免盖住圆形场
    await ev(`window.__roamDebug.clearEnemies()`);
    await sleep(320);
  }
  const shotBoss = await shot('u7-room-circle-boss.png');

  // ---------- 7) A/B 关闭 / 恢复 ----------
  const octCornersOn = octRoom ? Object.assign({}, octRoom.corners) : null;
  await ev(`window.__roamDebug.setRoomTemplates(false)`);
  const offAudit = await ev(`window.__roamDebug.roomShapeAudit()`);
  const offAllRect = offAudit.rooms.every((r) => r.shape === 'rect');
  ok('A/B 关闭：所有房间回到矩形、立柱与障碍归零',
    offAudit.enabled === false && offAllRect && offAudit.totals.pillars === 0
      && offAudit.blockers === 0 && offAudit.walkCircles.length === 0,
    { shapes: Array.from(new Set(offAudit.rooms.map((r) => r.shape))), pillars: offAudit.totals.pillars, blockers: offAudit.blockers });

  if (octRoom) await gotoRoom(octRoom, 900);
  const shotOff = await shot('u7-room-oct-off.png');
  const offOct = offAudit.rooms.find((r) => octRoom && r.id === octRoom.id);
  ok('A/B 关闭后同一间房四角恢复可走（没有残留空气墙）',
    !!offOct && Object.keys(offOct.corners).every((k) => offOct.corners[k] === true) && octCornersOn.tr === false,
    { before: octCornersOn, after: offOct && offOct.corners });

  await ev(`window.__roamDebug.setRoomTemplates(true)`);
  const backAudit = await ev(`window.__roamDebug.roomShapeAudit()`);
  ok('A/B 重新开启后形状与立柱恢复（开关可逆）',
    backAudit.enabled === true && backAudit.totals.pillars >= 2
      && Array.from(new Set(backAudit.rooms.map((r) => r.shape))).length >= 2,
    { totals: backAudit.totals, circles: backAudit.walkCircles.length });

  // ---------- 8) 截图文件体积（像素证据真的写出来了） ----------
  const sizes = [shotOct, shotL, shotBoss, shotOff].map((f) => (fs.existsSync(f) ? fs.statSync(f).size : 0));
  ok('四张形状截图都 > 10KB（八边 / L 形 / 圆形首领场 / 关闭态）',
    sizes.every((s) => s > 10 * 1024),
    { sizes: sizes, files: [shotOct, shotL, shotBoss, shotOff].map((f) => path.basename(f)) });

  // ---------- 9) 性能与报错 ----------
  const perf = await ev(`new Promise(function(resolve){
    var frames = []; var last = performance.now(); var warm = 0;
    function tick(now){
      var dt = now - last; last = now;
      if (warm < 40) { warm += 1; } else { frames.push(dt); }
      if (frames.length >= 150) {
        var sum = 0; var max = 0;
        frames.forEach(function(d){ if (d > 0) { sum += d; if (d > max) max = d; } });
        resolve({ avgFps: Number((1000 / (sum / frames.length)).toFixed(1)),
          minFps: Number((1000 / max).toFixed(1)), errors: window.__roamDebug.errors() });
      } else { requestAnimationFrame(tick); }
    }
    requestAnimationFrame(tick);
  })`);
  console.log('PERF · ' + JSON.stringify(perf));
  ok('avg fps ≥ 60 且无运行时错误', perf.avgFps >= 60 && perf.errors.length === 0,
    { avgFps: perf.avgFps, minFps: perf.minFps, errors: perf.errors });

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nU7 · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(path.join(OUT_DIR, 'u7-result.json'),
    JSON.stringify({ passed, total: asserts.length, asserts }, null, 2));

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 150);
});
