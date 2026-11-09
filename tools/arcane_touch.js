/**
 * M3 移动端触屏 + 虚拟摇杆 验收：A0–A11
 * ------------------------------------------------------------
 * 覆盖：配置默认值、鼠标事件不误触、左半屏摇杆生成、推程归一化与最大半径、
 *       角色真的被摇杆推动、死区、半推程映射、抬手归零、右半屏瞄准施法、
 *       总开关 A/B、摇杆绘制截图 / 帧率 / 报错。
 * 用法：node tools/arcane_touch.js
 * 端口：9530
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9530;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录断言并打印证据
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
  await ev(`document.querySelector('#btnStart').click(); true`);
  await sleep(1300);
  await ev(`(function(){
    window.__errors = [];
    window.addEventListener('error', function(e){ window.__errors.push(String(e.message || e)); });
    window.__firePointer = function(type, id, x, y, pointerType){
      var c = document.getElementById('game');
      var e = new PointerEvent(type, {
        pointerId: id, clientX: x, clientY: y, pointerType: pointerType || 'touch',
        bubbles: true, cancelable: true, buttons: type === 'pointerdown' ? 1 : 0
      });
      c.dispatchEvent(e);
      return true;
    };
    return true;
  })()`);

  // ---------- A0 配置默认值 ----------
  const a0 = await ev(`(function(){
    var info = window.__roamDebug.touch.info();
    return { enabled: info.enabled, config: info.config, state: info };
  })()`);
  ok('A0 触屏默认开启：分界线 0.5 / 底盘 54 / 满推 72 / 死区 0.08 / 满推阈值 0.86 / 曲线 1.15 / 施法拖动 12px',
    a0.enabled === true && a0.config.splitX === 0.5 && a0.config.stickRadius === 54
      && a0.config.maxRadius === 72 && a0.config.deadZone === 0.08
      && a0.config.fullPush === 0.86 && a0.config.moveCurve === 1.15
      && a0.config.castDragThreshold === 12 && a0.config.opacity === 0.5, a0);

  // ---------- A1 鼠标 pointerdown 不触发摇杆 ----------
  const a1 = await ev(`(function(){
    var before = window.__roamDebug.touch.info().stats.downs;
    window.__firePointer('pointerdown', 1, 200, 520, 'mouse');
    var after = window.__roamDebug.touch.info();
    return { before: before, after: after.stats.downs, moveId: after.moveId, active: after.active };
  })()`);
  ok('A1 桌面鼠标事件不误触发摇杆（pointerType=mouse 被忽略）',
    a1.before === a1.after && a1.moveId === null && a1.active === false, a1);

  // ---------- A2 左半屏落指生成摇杆 ----------
  const a2 = await ev(`(function(){
    window.__firePointer('pointerdown', 101, 220, 520, 'touch');
    var info = window.__roamDebug.touch.info();
    return { active: info.active, moveId: info.moveId, axis: info.axis, downs: info.stats.downs,
      base: { x: state.touch.baseX, y: state.touch.baseY },
      knob: { x: state.touch.knobX, y: state.touch.knobY } };
  })()`);
  ok('A2 左半屏落指：生成摇杆（moveId=101、active=true、旋钮与底盘重合、axis=0）',
    a2.active === true && a2.moveId === 101 && a2.axis.x === 0 && a2.axis.y === 0
      && a2.base.x === 220 && a2.base.y === 520 && a2.knob.x === 220 && a2.knob.y === 520, a2);

  // ---------- A3 推程超过最大半径：钳制到满推 ----------
  const a3 = await ev(`(function(){
    window.__firePointer('pointermove', 101, 320, 520, 'touch');
    var t = state.touch;
    var info = window.__roamDebug.touch.info();
    return { axis: info.axis, knob: { x: t.knobX, y: t.knobY }, moves: info.stats.moves };
  })()`);
  ok('A3 推程 100px（>72）：axis.x 钳到 1.0、旋钮停在 292（底盘+72），y 保持 520',
    Math.abs(a3.axis.x - 1) < 0.001 && Math.abs(a3.axis.y) < 0.001
      && Math.abs(a3.knob.x - 292) < 0.6 && Math.abs(a3.knob.y - 520) < 0.6 && a3.moves === 1, a3);

  // ---------- A4 摇杆真的推动角色 ----------
  await ev(`(function(){ window.__roamDebug.centerPlayer(); state.player.vx = 0; state.player.vy = 0; return true; })()`);
  const moveBefore = await ev(`({ x: state.player.x, y: state.player.y })`);
  await sleep(600);
  const moveAfter = await ev(`({ x: state.player.x, y: state.player.y })`);
  ok('A4 摇杆满推 600ms：角色沿 +X 真实位移 > 20px',
    moveAfter.x - moveBefore.x > 20 && Math.abs(moveAfter.y - moveBefore.y) < 20,
    { before: moveBefore, after: moveAfter });

  // ---------- A5 死区：5px 不产生输入（第 21 项：死区 0.10 → 0.08） ----------
  const a5 = await ev(`(function(){
    window.__firePointer('pointermove', 101, 225, 520, 'touch');
    var info = window.__roamDebug.touch.info();
    return { axis: info.axis, deadZone: info.config.deadZone, push: 5 / info.config.maxRadius };
  })()`);
  ok('A5 死区生效：推程 5px（≈0.069 < 0.08）不产生移动输入',
    a5.axis.x === 0 && a5.axis.y === 0, a5);

  // ---------- A6 半推程映射（第 21 项：死区 → 满推阈值 的曲线重映射） ----------
  const a6 = await ev(`(function(){
    window.__firePointer('pointermove', 101, 270, 520, 'touch');
    var info = window.__roamDebug.touch.info();
    var push = 50 / info.config.maxRadius;
    var t = Math.min(1, (push - info.config.deadZone) / (info.config.fullPush - info.config.deadZone));
    return { axis: info.axis, push: push, expect: Math.pow(t, info.config.moveCurve) };
  })()`);
  ok('A6 半推程 50px：axis.x ≈ ' + a6.expect.toFixed(3) + '（死区→满推阈值之间按 t^1.15 映射）',
    Math.abs(a6.axis.x - a6.expect) < 0.02 && Math.abs(a6.axis.y) < 0.001, a6);

  // ---------- A7 抬手：输入归零 ----------
  const a7 = await ev(`(function(){
    window.__firePointer('pointerup', 101, 270, 520, 'touch');
    var info = window.__roamDebug.touch.info();
    return { active: info.active, moveId: info.moveId, axis: info.axis, releases: info.stats.releases };
  })()`);
  ok('A7 抬手：moveId 清空、active=false、axis 归零、releases+1',
    a7.active === false && a7.moveId === null && a7.axis.x === 0 && a7.axis.y === 0
      && a7.releases >= 1, a7);

  // ---------- A8 右半屏瞄准 + 施法 ----------
  const a8 = await ev(`(function(){
    var viewW = state.viewW || window.innerWidth;
    window.__firePointer('pointerdown', 201, viewW * 0.8, 450, 'touch');
    var info = window.__roamDebug.touch.info();
    var cross = window.__roamDebug.getState().crosshair;
    return { aiming: info.aiming, aimId: state.touch.aimId, aim: info.aim,
      aims: info.stats.aims, casts: info.stats.casts, moved: cross.moved };
  })()`);
  ok('A8 右半屏点按：进入瞄准、瞄准点落在落指处、施法计数 +1、准星被唤醒',
    a8.aiming === true && a8.aimId === 201 && a8.aims >= 1 && a8.casts >= 1 && a8.moved === true
      && Math.abs(a8.aim.x - 1440 * 0.8) < 1 && Math.abs(a8.aim.y - 450) < 1, a8);

  // ---------- A9 右半屏拖动：瞄准点实时跟随 ----------
  const a9 = await ev(`(function(){
    window.__firePointer('pointermove', 201, 1320, 380, 'touch');
    var info = window.__roamDebug.touch.info();
    var world = { x: mouseState.worldX, y: mouseState.worldY, camX: state.cam.x, camY: state.cam.y, zoom: cameraZoom() };
    return { aiming: info.aiming, aim: info.aim, world: world };
  })()`);
  ok('A9 右半屏拖动：瞄准点跟到 (1320,380)，世界坐标 = 相机偏移 + 屏幕坐标/缩放',
    a9.aiming === true && Math.abs(a9.aim.x - 1320) < 1 && Math.abs(a9.aim.y - 380) < 1
      && Math.abs(a9.world.x - (a9.world.camX + 1320 / a9.world.zoom)) < 1
      && Math.abs(a9.world.y - (a9.world.camY + 380 / a9.world.zoom)) < 1, a9);

  // ---------- A10 抬手结束瞄准 ----------
  const a10 = await ev(`(function(){
    window.__firePointer('pointerup', 201, 1320, 380, 'touch');
    var info = window.__roamDebug.touch.info();
    return { aiming: info.aiming, aimId: state.touch.aimId };
  })()`);
  ok('A10 右半屏抬手：结束瞄准（aiming=false、aimId=null）',
    a10.aiming === false && a10.aimId === null, a10);

  // ---------- A11 总开关：关闭后完全不响应 ----------
  const a11 = await ev(`(function(){
    window.__roamDebug.touch.setEnabled(false);
    var before = window.__roamDebug.touch.info().stats.downs;
    window.__firePointer('pointerdown', 301, 220, 520, 'touch');
    var off = window.__roamDebug.touch.info();
    window.__roamDebug.touch.setEnabled(true);
    return { before: before, after: off.stats.downs, moveId: off.moveId, enabled: off.enabled };
  })()`);
  ok('A11 总开关关闭：pointerdown 完全不响应（downs 不变、无摇杆）；重开后恢复',
    a11.enabled === false && a11.before === a11.after && a11.moveId === null, a11);

  // ---------- A12 满推阈值：0.86×maxRadius 即全速 ----------
  const a12 = await ev(`(function(){
    window.__firePointer('pointerdown', 501, 220, 520, 'touch');
    var cfg = TOUCH_CONFIG;
    var nearPx = Math.round((cfg.fullPush - 0.06) * cfg.maxRadius);
    var fullPx = Math.round(cfg.fullPush * cfg.maxRadius);
    window.__firePointer('pointermove', 501, 220 + nearPx, 520, 'touch');
    var nearInfo = window.__roamDebug.touch.info();
    window.__firePointer('pointermove', 501, 220 + fullPx, 520, 'touch');
    var fullInfo = window.__roamDebug.touch.info();
    window.__firePointer('pointerup', 501, 220 + fullPx, 520, 'touch');
    return { near: nearInfo.axis.x, full: fullInfo.axis.x, nearPx: nearPx, fullPx: fullPx };
  })()`);
  ok('A12 满推阈值：差 6% 未满速，推到 0.86×maxRadius 即 1.000（拇指不必推到边）',
    a12.near < 0.98 && a12.near > 0.6 && Math.abs(a12.full - 1) < 0.001, a12);

  // ---------- A13 响应曲线：端点 + 单调 ----------
  const a13 = await ev(`(function(){
    var samples = [0.05,0.08,0.15,0.30,0.50,0.70,0.86,0.95,1.00];
    var rows = samples.map(function(p){ return { push: p, axis: Number(touchAxisStrength(p).toFixed(4)) }; });
    var mono = true;
    for (var i = 1; i < rows.length; i += 1) { if (rows[i].axis < rows[i - 1].axis) mono = false; }
    return { rows: rows, mono: mono, zero: touchAxisStrength(0.08) === 0, top: touchAxisStrength(1) === 1 };
  })()`);
  ok('A13 响应曲线：死区处为 0、满推处为 1、全程单调不回落',
    a13.mono === true && a13.zero === true && a13.top === true, a13);

  // ---------- A14 施法拖动阈值：微抖不改朝向 ----------
  const a14 = await ev(`(function(){
    var viewW = state.viewW || window.innerWidth;
    var x = viewW * 0.82, y = 430;
    window.__firePointer('pointerdown', 601, x, y, 'touch');
    var s0 = window.__roamDebug.touch.info();
    var casts0 = s0.stats.casts;
    window.__firePointer('pointermove', 601, x + 6, y, 'touch');
    var s1 = window.__roamDebug.touch.info();
    window.__firePointer('pointermove', 601, x + 30, y + 20, 'touch');
    var s2 = window.__roamDebug.touch.info();
    window.__firePointer('pointerup', 601, x + 30, y + 20, 'touch');
    return { aim0: s0.aim, aimTiny: s1.aim, tinyDragging: s1.aimDragging,
      castsTiny: s1.stats.casts - casts0, aimDrag: s2.aim, dragging: s2.aimDragging };
  })()`);
  ok('A14 施法拖动阈值：微抖 6px 不改朝向、不重复施法；拖 36px 才进入拖动并改朝向',
    a14.aimTiny.x === a14.aim0.x && a14.aimTiny.y === a14.aim0.y
      && a14.tinyDragging === false && a14.castsTiny === 0
      && a14.dragging === true
      && Math.abs(a14.aimDrag.x - a14.aim0.x) > 20 && Math.abs(a14.aimDrag.y - a14.aim0.y) > 10, a14);

  // ---------- A15 参数表（旧 → 新） ----------
  // 旧参数：死区 0.10 / 无满推阈值（1.00）/ 线性（1.00）/ 无施法拖动阈值（0）
  const table = await ev(`(function(){
    var legacy = { deadZone: 0.10, fullPush: 1.00, moveCurve: 1.00 };
    function strength(p, c){
      if (p <= c.deadZone) return 0;
      var t = Math.min(1, (p - c.deadZone) / (c.fullPush - c.deadZone));
      return Math.pow(t, c.moveCurve);
    }
    var pushes = [0.08,0.10,0.20,0.35,0.50,0.65,0.80,0.86,1.00];
    var rows = pushes.map(function(p){
      return { push: p, before: Number(strength(p, legacy).toFixed(3)), after: Number(touchAxisStrength(p).toFixed(3)) };
    });
    return {
      legacy: legacy,
      now: { deadZone: TOUCH_CONFIG.deadZone, fullPush: TOUCH_CONFIG.fullPush,
        moveCurve: TOUCH_CONFIG.moveCurve, castDragThreshold: TOUCH_CONFIG.castDragThreshold,
        castRepeat: TOUCH_CONFIG.castRepeat },
      rows: rows
    };
  })()`);
  const rowsAllUp = table.rows.every((r) => r.after >= r.before);
  const fullRow = table.rows.find((r) => r.push === 0.86);
  ok('A15 参数表：9 档推程上新参数全部 ≥ 旧参数，且 0.86 档由 ' + fullRow.before + ' → ' + fullRow.after,
    rowsAllUp && fullRow.after >= 0.99 && fullRow.before < 0.9, table);
  console.log('参数表：' + JSON.stringify(table.rows));

  // ---------- A16 before/after 截图（同一 0.86×maxRadius 推程） ----------
  /**
   * 用指定参数画一次摇杆并截图（before = 旧参数，after = 新参数）
   * @param {string} tag 输出文件名
   * @param {{dz:number,fp:number,mc:number}} cfg 临时参数
   * @param {number} knobPx 旋钮推程（像素）
   * @returns {Promise<number>} 截图字节数
   */
  const shotAB = async (tag, cfg, knobPx) => {
    await ev(`(function(){
      TOUCH_CONFIG.deadZone = ${cfg.dz}; TOUCH_CONFIG.fullPush = ${cfg.fp}; TOUCH_CONFIG.moveCurve = ${cfg.mc};
      render();
      state.touch.moveId = 401; state.touch.active = true;
      state.touch.baseX = 230; state.touch.baseY = 560;
      state.touch.knobX = 230 + ${knobPx}; state.touch.knobY = 560;
      state.touch.axisX = touchAxisStrength(${knobPx} / TOUCH_CONFIG.maxRadius); state.touch.axisY = 0;
      drawTouchControls();
      return true;
    })()`);
    await sleep(320);
    await shot(tag);
    return fs.statSync(path.join(OUT_DIR, tag)).size;
  };
  const knobAt86 = 62;
  const abBefore = await shotAB('g-touch-before.png', { dz: 0.10, fp: 1.00, mc: 1.00 }, knobAt86);
  const abAfter = await shotAB('g-touch-after.png', { dz: 0.08, fp: 0.86, mc: 1.15 }, knobAt86);
  ok('A16 before/after 截图：旧/新参数各 1 张且 >500KB',
    abBefore > 500 * 1024 && abAfter > 500 * 1024, { before: abBefore, after: abAfter });
  // 恢复正式参数，后续 A17 用正式配置
  await ev(`(function(){
    TOUCH_CONFIG.deadZone = 0.08; TOUCH_CONFIG.fullPush = 0.86; TOUCH_CONFIG.moveCurve = 1.15;
    return true;
  })()`);

  // ---------- A17 摇杆绘制：截图 + 帧率 + 报错 ----------
  await ev(`(function(){
    state.touch.moveId = 401;
    state.touch.active = true;
    state.touch.baseX = 230; state.touch.baseY = 560;
    state.touch.knobX = 292; state.touch.knobY = 560;
    state.touch.axisX = 0; state.touch.axisY = 0;
    drawTouchControls();
    return true;
  })()`);
  await sleep(400);
  await shot('touch.png');
  const png = fs.statSync(path.join(OUT_DIR, 'touch.png')).size;
  const fps = await ev(`window.__roamDebug.getState().fps`);
  const errors = await ev(`window.__errors.slice()`);
  const summary = await ev(`window.__roamDebug.touch.info()`);
  ok('A17 摇杆绘制不报错：截图 >600KB、fps ≥ 30、errors 0、stats 有落指/移动记录',
    png > 600 * 1024 && fps >= 30 && errors.length === 0
      && summary.stats.downs > 0 && summary.stats.moves > 0,
    { png: png, fps: fps, errors: errors, stats: summary.stats });

  await ev(`window.__roamDebug.touch.reset(); true`);

  fs.writeFileSync(path.join(OUT_DIR, 'touch-result.json'),
    JSON.stringify({
      asserts: asserts, pass: asserts.filter((a) => a.pass).length, total: asserts.length,
      params: { legacy: table.legacy, now: table.now, curve: table.rows }
    }, null, 2));
  const passed = asserts.filter((a) => a.pass).length;
  console.log('\nRESULT: ' + (passed === asserts.length ? 'PASS' : 'FAIL') + ' ' + passed + '/' + asserts.length);
  killEdge(edge);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
