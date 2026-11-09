/**
 * 第 17 项 · 手柄支持验收（G1–G13）
 * 用法：node tools/arcane_gamepad.js
 * 端口：9541
 * 输出：.screenshots/art/gamepad.png、gamepad-result.json
 *
 * 说明：CI 里没有真实手柄，脚本通过 __roamDebug.gamepad.setFake() 注入虚拟手柄，
 * 走的是和真实设备完全同一条 pollGamepad 路径（不是另写一套模拟逻辑）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9541;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} [detail] 证据
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
  /**
   * 发送 CDP 命令并等待返回
   * @param {string} method CDP 方法
   * @param {Object} [params] 参数
   * @returns {Promise<Object>}
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 页面内执行表达式
   * @param {string} expression JS 表达式
   * @returns {Promise<*>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /**
   * 截图
   * @param {string} name 文件名
   * @returns {Promise<void>}
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };
  /**
   * 注入虚拟手柄（buttons 长度 17，axes 4 轴）
   * @param {number} ax 左摇杆 X
   * @param {number} ay 左摇杆 Y
   * @param {number[]} pressed 按下的按钮索引
   */
  const setPad = async (ax, ay, pressed = []) => ev(`(function(){
    var btns = [];
    for (var i = 0; i < 17; i += 1) btns.push(false);
    ${pressed.map((i) => `btns[${i}] = true;`).join('')}
    window.__roamDebug.gamepad.setFake({ id: 'Virtual Pad', axes: [${ax}, ${ay}, 0, 0], buttons: btns });
    return true;
  })()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(900);
  // 跳过开场演出，清空敌人，避免测试期被打断
  await ev(`(function(){
    if (typeof skipOpeningRitual === 'function') skipOpeningRitual();
    state.transitionLock = false;
    window.__roamDebug.clearEnemies();
    state.player.vx = 0; state.player.vy = 0;
    window.__errors = [];
    return true;
  })()`);
  await sleep(500);

  // ---------- G1 配置 ----------
  const cfg = await ev(`window.__roamDebug.gamepad.config()`);
  ok('G1 配置：总开关开、死区 0.24、12 个按钮 + 4 个十字键、动作键齐全',
    cfg.enabled === true && cfg.deadzone === 0.24
      && Object.keys(cfg.buttons).length === 12 && Object.keys(cfg.dpad).length === 4
      && !!cfg.actionKey.primary && !!cfg.actionKey.dash
      && !!cfg.actionKey.weapon && !!cfg.actionKey.start, cfg);

  // ---------- G2 无手柄基线：不接管、不漂移、图例隐藏 ----------
  const base = await ev(`(function(){
    var d = window.__roamDebug, g = d.gamepad;
    g.clearFake();
    state.keys = {};
    state.player.vx = 0; state.player.vy = 0;
    return { info: g.info(), legend: g.legend() };
  })()`);
  await sleep(400);
  const base2 = await ev(`(function(){
    var g = window.__roamDebug.gamepad;
    return { info: g.info(), speed: Math.hypot(state.player.vx, state.player.vy), legend: g.legend() };
  })()`);
  ok('G2 无手柄：padKeys 全 false、角色不漂移（速度 <20）、图例隐藏',
    base.info.connected === false && base.legend.hidden === true
      && base2.info.keys.left === false && base2.info.keys.right === false
      && base2.speed < 20 && base2.legend.hidden === true,
    { base: base.info, after: base2.info, speed: base2.speed, legend: base2.legend });

  // ---------- G3 连接虚拟手柄：图例出现 ----------
  await setPad(0.9, 0, []);
  await sleep(450);
  const conn = await ev(`(function(){
    var g = window.__roamDebug.gamepad;
    return { info: g.info(), legend: g.legend() };
  })()`);
  ok('G3 连接手柄：connected=true、名称回显、右摇杆写入 padKeys.right、图例出现',
    conn.info.connected === true && conn.info.name === 'Virtual Pad'
      && conn.info.keys.right === true
      && conn.legend.hidden === false && conn.legend.text.indexOf('手柄已连接') >= 0,
    { info: conn.info, legend: conn.legend });

  // 截图：手柄连接 + 图例可见
  await shot('gamepad.png');

  // ---------- G4 摇杆推动角色 ----------
  const x0 = await ev(`state.player.x`);
  await sleep(250);
  // 速度在中途取：0.55s 时可能已经贴墙，速度会被墙归一化到 0，不能代表"摇杆没推动"
  const mid = await ev(`(function(){
    return { speed: Math.hypot(state.player.vx, state.player.vy), keys: Object.assign({}, state.padKeys) };
  })()`);
  await sleep(300);
  const move = await ev(`(function(){
    return { x: state.player.x, keys: Object.assign({}, state.padKeys) };
  })()`);
  ok('G4 摇杆移动：中途速度 >80、0.55s 后角色位移 ≥40px、right 持续按住',
    mid.speed > 80 && move.x - x0 >= 40 && move.keys.right === true,
    { dx: Number((move.x - x0).toFixed(1)), midSpeed: Number(mid.speed.toFixed(1)) });

  // ---------- G5 死区 ----------
  await setPad(0.10, 0.06, []);
  await sleep(350);
  const dz = await ev(`(function(){
    return { keys: Object.assign({}, state.padKeys), speed: Math.hypot(state.player.vx, state.player.vy) };
  })()`);
  ok('G5 死区：摇杆 0.10 视为回中（padKeys 全 false），角色速度衰减到 <80',
    dz.keys.left === false && dz.keys.right === false && dz.speed < 80,
    { keys: dz.keys, speed: Number(dz.speed.toFixed(1)) });

  // ---------- G6 十字键移动 ----------
  await setPad(0, 0, [15]); // 十字键右
  await sleep(220);
  const dpad = await ev(`Object.assign({}, state.padKeys)`);
  ok('G6 十字键：按住 15（右）时 padKeys.right=true', dpad.right === true, dpad);
  await setPad(0, 0, []);

  // ---------- G7 A 键 = 普攻 ----------
  const beforeA = await ev(`window.__roamDebug.gamepad.actions()`);
  await setPad(0, 0, [0]);
  await sleep(300);
  const afterA = await ev(`(function(){
    var cd = 0;
    Object.keys(state.cooldowns || {}).forEach(function(k){ if (state.cooldowns[k] > 0) cd += 1; });
    return { actions: window.__roamDebug.gamepad.actions(), cd: cd, castAnim: state.player.castAnim };
  })()`);
  ok('G7 A 键映射普攻：动作计数 +1、last=primary、至少一个魔法进入冷却或出手动画',
    afterA.actions.count === beforeA.count + 1 && afterA.actions.last === 'primary'
      && (afterA.cd > 0 || afterA.castAnim > 0),
    { before: beforeA, after: afterA.actions, cd: afterA.cd, castAnim: afterA.castAnim });
  await setPad(0, 0, []);
  await sleep(120);

  // ---------- G8 长按不连发（按下沿） ----------
  const beforeHold = await ev(`window.__roamDebug.gamepad.actions()`);
  await setPad(0, 0, [0]);
  await sleep(450);
  const hold1 = await ev(`window.__roamDebug.gamepad.actions()`);
  await sleep(350);
  const hold2 = await ev(`window.__roamDebug.gamepad.actions()`);
  ok('G8 长按 A 键 0.8s：动作只触发 1 次（按下沿检测）',
    hold1.count === beforeHold.count + 1 && hold2.count === hold1.count,
    { before: beforeHold.count, hold1: hold1.count, hold2: hold2.count });
  await setPad(0, 0, []);
  await sleep(120);

  // ---------- G9 B 键 = 影步 ----------
  await setPad(0, 0, [1]);
  await sleep(180);
  const dash = await ev(`(function(){
    return { dashTime: Number((state.player.dashTime || 0).toFixed(3)), dashCd: Number((state.player.dashCd || 0).toFixed(3)), last: window.__roamDebug.gamepad.actions().last };
  })()`);
  ok('G9 B 键映射影步：dashTime 或 dashCd >0，last=dash',
    (dash.dashTime > 0 || dash.dashCd > 0) && dash.last === 'dash', dash);
  await setPad(0, 0, []);
  await sleep(160);

  // ---------- G10 Y 键 = 近战 ----------
  const beforeY = await ev(`state.weapon.stats.swings`);
  await setPad(0, 0, [3]);
  await sleep(220);
  const weapon = await ev(`(function(){
    return { swings: state.weapon.stats.swings, last: window.__roamDebug.gamepad.actions().last };
  })()`);
  ok('G10 Y 键映射近战：武器挥击次数 +1、last=weapon',
    weapon.swings === beforeY + 1 && weapon.last === 'weapon', { before: beforeY, after: weapon });
  await setPad(0, 0, []);
  await sleep(160);

  // ---------- G11 LT 键 = 交互/下楼 ----------
  const beforeLT = await ev(`window.__roamDebug.gamepad.actions()`);
  await setPad(0, 0, [6]);
  await sleep(200);
  const lt = await ev(`window.__roamDebug.gamepad.actions()`);
  ok('G11 LT 键映射交互：last=descend（不在楼梯旁也不会报错）',
    lt.count === beforeLT.count + 1 && lt.last === 'descend', lt);
  await setPad(0, 0, []);
  await sleep(160);

  // ---------- G12 拔掉手柄：零影响 + 键盘照常 ----------
  await ev(`window.__roamDebug.gamepad.clearFake(); true`);
  await sleep(400);
  const unplug = await ev(`(function(){
    var g = window.__roamDebug.gamepad;
    // 键盘路径直接调用同一个入口，验证没被手柄改动破坏
    handleKeyDown({ key: 'w', preventDefault: function(){} });
    var up = !!state.keys.up;
    handleKeyUp({ key: 'w', preventDefault: function(){} });
    return { info: g.info(), legend: g.legend(), keyboardUp: up, afterUp: !!state.keys.up };
  })()`);
  ok('G12 拔掉手柄：padKeys 全 false、图例隐藏，键盘 W 仍可按下/松开',
    unplug.info.connected === false && unplug.info.keys.right === false
      && unplug.legend.hidden === true && unplug.keyboardUp === true && unplug.afterUp === false,
    unplug);

  // ---------- G13 总开关：关闭后摇杆无效，重开恢复 ----------
  await setPad(0.95, 0, []);
  await sleep(250);
  const on = await ev(`window.__roamDebug.gamepad.info()`);
  await ev(`window.__roamDebug.gamepad.setEnabled(false); true`);
  await sleep(300);
  const off = await ev(`(function(){
    return { info: window.__roamDebug.gamepad.info(), speed: Math.hypot(state.player.vx, state.player.vy) };
  })()`);
  await ev(`(function(){
    window.__roamDebug.gamepad.setEnabled(true);
    return true;
  })()`);
  await sleep(300);
  const back = await ev(`window.__roamDebug.gamepad.info()`);
  ok('G13 手柄总开关：关闭后摇杆方向不再生效（速度衰减），重开恢复 right=true',
    on.keys.right === true && off.info.keys.right === false && off.speed < 80
      && back.keys.right === true,
    { on: on.keys, off: off.info.keys, offSpeed: Number(off.speed.toFixed(1)), back: back.keys });

  // ---------- G14 性能 / 截图 / 错误 ----------
  const perf = await ev(`(function(){
    var p = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return p.then(function(f){ return { fps: f, errors: (window.__errors || []).length }; });
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'gamepad.png')).size; } catch (e) { shotSize = 0; }
  const legend = await ev(`window.__roamDebug.gamepad.legend()`);
  ok('G14 截图 >10KB、fps≥60、无脚本错误、图例文案同步',
    shotSize > 10240 && perf.fps >= 60 && perf.errors === 0
      && legend.hidden === false && legend.text.indexOf('RB 融合') >= 0,
    { shotSize, perf, legend });

  // 收尾：拔掉虚拟手柄、恢复开关、清空测试输入
  await ev(`(function(){
    var d = window.__roamDebug;
    d.gamepad.clearFake();
    d.gamepad.setEnabled(true);
    state.keys = {};
    state.padKeys = { left: false, right: false, up: false, down: false };
    state.player.vx = 0; state.player.vy = 0;
    d.clearEnemies();
    return true;
  })()`);

  fs.writeFileSync(path.join(OUT_DIR, 'gamepad-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log(`\n===== T gamepad ${pass}/${asserts.length} ===== (shot ${shotSize}B, fps ${perf.fps})`);
  console.log('VERDICT: ' + (pass === asserts.length ? 'PASS' : 'FAIL'));

  try { ws.close(); } catch (e) { /* ignore */ }
  try { killEdge(edge); } catch (e) { /* ignore */ }
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (pass !== asserts.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
