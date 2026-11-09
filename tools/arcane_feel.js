/**
 * G2/G3 手感验收：A0–A9
 * 用法：node tools/arcane_feel.js
 * 端口：9519
 * 输出：.screenshots/art/feel-g2g3.png、feel-g2g3-result.json
 *
 * 断言：
 *  A0 配置默认值（四相位 1/-0.6/0.3/-0.1、顿帧 scale=0.16、两个开关默认开）
 *  A1 曲线形状：相位序列 + 二次包络（u=0.25 原始值 = -0.3375 等）
 *  A2 峰值取最大值不累加（4/7/5 → 7，不是 16）
 *  A3 幅度上限 8px 仍生效
 *  A4 reduceShake 仍生效（8 → 2.8）
 *  A5 顿帧只缩模拟时间：simDt/realDt≈0.16；关闭开关后 ratio=1
 *  A6 顿帧取最大：0.06 + 0.13 → 0.13，不是 0.19，且 merged≥1
 *  A7 顿帧期间按键仍响应（玩家位移 > 0）
 *  A8 连续 10 次震屏后相机偏移归零
 *  A9 截图 >10KB / fps≥60 / 无脚本错误
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9519;
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

  // ---------- A0 配置 ----------
  const a0 = await ev(`(function(){
    var info = window.__roamDebug.feel.info();
    return { shake: info.shake.config, hitStop: info.hitStop.config };
  })()`);
  ok('A0 配置默认值（四相位 / scale=0.16 / 两个开关默认开）',
    JSON.stringify(a0.shake.phases) === JSON.stringify([1, -0.6, 0.3, -0.1])
      && a0.shake.enabled === true && a0.hitStop.enabled === true
      && Math.abs(a0.hitStop.scale - 0.16) < 0.001, a0);

  // ---------- A1 曲线形状 ----------
  const a1 = await ev(`(function(){
    var c = window.__roamDebug.feel;
    return {
      p0: c.phaseAt(0), p1: c.phaseAt(0.26), p2: c.phaseAt(0.51), p3: c.phaseAt(0.76),
      v0: c.curve(0), v1: c.curve(0.25), v2: c.curve(0.5), v3: c.curve(0.75), v4: c.curve(1)
    };
  })()`);
  ok('A1 曲线形状：1/-0.6/0.3/-0.1 四段 + 二次包络逐段收敛',
    a1.p0 === 1 && a1.p1 === -0.6 && a1.p2 === 0.3 && a1.p3 === -0.1
      && Math.abs(a1.v0 - 1) < 0.001
      && Math.abs(a1.v1 - (-0.3375)) < 0.002
      && Math.abs(a1.v2 - 0.075) < 0.002
      && Math.abs(a1.v3 - (-0.00625)) < 0.001
      && Math.abs(a1.v4) < 0.001, a1);

  // ---------- A2 峰值取最大不累加 ----------
  await ev(`window.__roamDebug.feel.reset()`);
  const a2 = await ev(`(function(){
    var f = window.__roamDebug.feel;
    f.fireShake(4, 0.1, true);
    f.fireShake(7, 0.1, true);
    f.fireShake(5, 0.1, true);
    var cur = f.info().shake.current;
    return { power: cur.power, time: cur.time, dur: cur.dur };
  })()`);
  ok('A2 100ms 内 3 次震屏：峰值=7（取最大），不是 16',
    Math.abs(a2.power - 7) < 0.001 && a2.time <= 0.1 + 0.001, a2);

  // ---------- A3 幅度上限 ----------
  await ev(`window.__roamDebug.feel.reset()`);
  const a3 = await ev(`(function(){
    var f = window.__roamDebug.feel;
    f.fireShake(50, 0.2, true);
    return f.info().shake.current.power;
  })()`);
  ok('A3 普通事件幅度上限 8px 仍生效', a3 <= 8.001 && a3 > 0, { power: a3 });

  // ---------- A4 reduceShake ----------
  await ev(`window.__roamDebug.feel.reset()`);
  const a4 = await ev(`(function(){
    var saved = state.meta.reduceShake;
    state.meta.reduceShake = true;
    var f = window.__roamDebug.feel;
    f.fireShake(8, 0.2, true);
    var p = f.info().shake.current.power;
    state.meta.reduceShake = saved;
    return { power: p, reduced: state.feel.a11yShakeScale };
  })()`);
  ok('A4 开启"减少动态"后幅度降到 35%（8 → 2.8）',
    Math.abs(a4.power - 2.8) < 0.01 && Math.abs(a4.reduced - 0.35) < 0.001, a4);

  // ---------- A5 顿帧只缩模拟时间 ----------
  await ev(`(function(){
    var f = window.__roamDebug.feel;
    f.reset();
    state.slowMo = 0; state.fusionSlow = 0; state.hitStop = 0;
    HITSTOP_CONFIG.enabled = true;
    f.fireHitStop(0.22);
    return true;
  })()`);
  await sleep(120);
  const a5on = await ev(`window.__roamDebug.feel.info().hitStop`);
  await ev(`(function(){
    var f = window.__roamDebug.feel;
    f.reset();
    state.slowMo = 0; state.fusionSlow = 0;
    HITSTOP_CONFIG.enabled = false;
    f.fireHitStop(0.22);
    return true;
  })()`);
  await sleep(120);
  const a5off = await ev(`window.__roamDebug.feel.info().hitStop`);
  await ev(`(function(){ HITSTOP_CONFIG.enabled = true; return true; })()`);
  ok('A5 顿帧只缩模拟时间：开启时 simDt/realDt≈0.16，关闭后 ratio=1',
    Math.abs(a5on.ratio - 0.16) < 0.02 && a5on.remaining > 0
      && Math.abs(a5off.ratio - 1) < 0.001 && a5off.remaining === 0,
    { on: a5on, off: a5off });

  // ---------- A6 顿帧取最大 ----------
  await ev(`window.__roamDebug.feel.reset()`);
  const a6 = await ev(`(function(){
    var f = window.__roamDebug.feel;
    f.fireHitStop(0.06);
    f.fireHitStop(0.13);
    var info = f.info().hitStop;
    return { remaining: info.remaining, merged: info.stats.merged, requests: info.stats.requests };
  })()`);
  ok('A6 两段顿帧取最大值（0.06 + 0.13 → 0.13，不是 0.19）',
    Math.abs(a6.remaining - 0.13) < 0.002 && a6.merged >= 1, a6);

  // ---------- A7 顿帧期间按键仍响应 ----------
  const a7 = await ev(`(function(){
    var f = window.__roamDebug.feel;
    f.reset();
    state.slowMo = 0; state.fusionSlow = 0;
    f.fireHitStop(0.22);
    state.player.vx = 0; state.player.vy = 0;
    var x0 = state.player.x, y0 = state.player.y;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    return { x0: x0, y0: y0 };
  })()`);
  await sleep(140);
  const a7after = await ev(`(function(){
    var d = Math.hypot(state.player.x - ${a7.x0}, state.player.y - ${a7.y0});
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
    var info = window.__roamDebug.feel.info().hitStop;
    return { dist: d, remaining: info.remaining, ratio: info.ratio };
  })()`);
  ok('A7 顿帧期间按键仍被处理（玩家位移 > 0 且当时仍在顿帧）',
    a7after.dist > 0.1 && a7after.remaining > 0, { before: a7, after: a7after });

  // ---------- A8 连续震屏后归零 ----------
  await ev(`(function(){
    var f = window.__roamDebug.feel;
    f.reset();
    for (var i = 0; i < 10; i += 1) f.fireShake(6, 0.1, true);
    return true;
  })()`);
  await sleep(500);
  const a8 = await ev(`window.__roamDebug.feel.info().shake.current`);
  ok('A8 连续 10 次震屏结束后相机偏移归零，无漂移',
    a8.x === 0 && a8.y === 0 && a8.power === 0, a8);

  await ev(`window.__roamDebug.feel.reset()`);
  await shot('feel-g2g3.png');

  // ---------- A9 fps / 错误 / 截图 ----------
  const a9 = await ev(`(function(){
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
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'feel-g2g3.png')).size; } catch (e) { shotSize = 0; }
  ok('A9 截图 >10KB / fps≥60 / 无脚本错误',
    shotSize > 10240 && a9.fps >= 60 && a9.errors === 0, { shot: shotSize, a9 });

  fs.writeFileSync(path.join(OUT_DIR, 'feel-g2g3-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== G2/G3 feel ' + pass + '/' + asserts.length + ' ===== (shot ' + shotSize + 'B, fps ' + a9.fps + ')');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
