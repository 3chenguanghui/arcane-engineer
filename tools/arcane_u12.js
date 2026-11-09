/**
 * U12 专项验收：浮游装置回应 + 可访问性开关（端口 9505）
 * 用法：node tools/arcane_u12.js
 * 输出：.screenshots/art/u12-*.png + u12-result.json
 *
 * 断言分两组：
 * A) 可访问性：设置页两个开关真实写存档、减少屏震 35%、关闭闪白完全不播；
 * B) 装置回应：施法前移 / 冲刺拖后 / 濒死抖动（只读绘制偏移，不改碰撞）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9505;
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
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2000);

  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1100);
  // 验收期间玩家无敌，避免被打死导致截图变成结算屏
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);

  // ---------- U12-1 默认：两开关关闭 ----------
  let a = await ev(`window.__roamDebug.a11y()`);
  let uiInfo = await ev(`(function(){
    var s = document.getElementById('reduceShakeToggle');
    var f = document.getElementById('reduceFlashToggle');
    var box = document.getElementById('a11yStateText');
    return {
      shake: !!s, flash: !!f, summary: box ? box.textContent : null,
      shakeAria: s ? s.getAttribute('aria-checked') : null,
      flashAria: f ? f.getAttribute('aria-checked') : null
    };
  })()`);
  ok('U12-1 设置页存在两个可访问性开关，默认关闭（aria-checked=false）',
    uiInfo.shake && uiInfo.flash && !a.reduceShake && !a.reduceFlash
    && uiInfo.shakeAria === 'false' && uiInfo.flashAria === 'false' && uiInfo.summary === '全效果开',
    { a11y: a, panel: uiInfo });

  // ---------- U12-2 面板打开后 A11Y 区块可见 ----------
  await ev(`window.__roamDebug.openPanel('settings')`);
  await sleep(300);
  const panelVisible = await ev(`(function(){
    var layer = document.getElementById('settingsPanel');
    if (!layer) return null;
    // 面板内容超过卡片高度时自身可滚动：滚到底再看「可访问性」开关
    var scroller = layer.querySelector('.settings-panel');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    var shake = document.getElementById('reduceShakeToggle');
    var flash = document.getElementById('reduceFlashToggle');
    var rs = shake ? shake.getBoundingClientRect() : null;
    var rf = flash ? flash.getBoundingClientRect() : null;
    return {
      open: layer.getAttribute('aria-hidden') !== 'true',
      scrollable: !!scroller && scroller.scrollHeight > scroller.clientHeight + 2,
      scrollTop: scroller ? scroller.scrollTop : 0,
      shakeRect: rs ? { x: Math.round(rs.x), y: Math.round(rs.y), w: Math.round(rs.width), h: Math.round(rs.height) } : null,
      flashRect: rf ? { x: Math.round(rf.x), y: Math.round(rf.y), w: Math.round(rf.width), h: Math.round(rf.height) } : null,
      viewportH: window.innerHeight,
      mode: state.mode
    };
  })()`);
  await shot('u12-settings.png');
  ok('U12-2 设置面板可滚动，「可访问性」两个开关滚到后完整可见',
    !!panelVisible && panelVisible.shakeRect && panelVisible.flashRect
    && panelVisible.shakeRect.w > 20 && panelVisible.flashRect.w > 20
    && panelVisible.flashRect.y + panelVisible.flashRect.h < panelVisible.viewportH,
    panelVisible);

  // ---------- U12-3 两项全开：写存档 + 同步 UI ----------
  a = await ev(`window.__roamDebug.setA11y(true, true)`);
  ok('U12-3 开启后 meta 写入 + 两个 aria 为 true + 总状态「已开启」',
    a.reduceShake && a.reduceFlash && a.panel.shakeChecked === 'true'
    && a.panel.flashChecked === 'true' && a.panel.summary === '已开启',
    a);

  // ---------- U12-4 减少屏震：固定 20 → 7（35%） ----------
  const shakeBase = await ev(`window.__roamDebug.setA11y(false, false)`);
  const shakeFull = await ev(`window.__roamDebug.shakeTest(20)`);
  await ev(`window.__roamDebug.setA11y(true, true)`);
  const shakeReduced = await ev(`window.__roamDebug.shakeTest(20)`);
  ok('U12-4 减少屏震：峰值 20 → 7（35%），scale 记账正确',
    Math.abs(shakeFull.peak - 20) < 0.01 && Math.abs(shakeReduced.peak - 7) < 0.3
    && shakeReduced.scale === 0.35,
    { full: shakeFull, reduced: shakeReduced, baseMeta: shakeBase.reduceShake });
  await shot('u12-a11y-on.png');

  // ---------- U12-5 关闭闪白：100ms → 0（且记一次 suppressed） ----------
  await ev(`window.__roamDebug.setA11y(false, false)`);
  const flashFull = await ev(`window.__roamDebug.flashTest()`);
  await ev(`window.__roamDebug.setA11y(true, true)`);
  const flashOff = await ev(`window.__roamDebug.flashTest()`);
  ok('U12-5 关闭闪白：实际播出 100ms → 0ms，并记录一次 suppressed',
    flashFull.ms === 100 && flashOff.ms === 0 && flashOff.suppressed >= 1,
    { on: flashFull, off: flashOff });

  // ---------- U12-6 写存档 + 重开保留 ----------
  const saved = await ev(`(function(){
    var key = GAME_CONFIG.metaKey;
    var raw = window.localStorage.getItem(key);
    var m = raw ? JSON.parse(raw) : null;
    return m ? { reduceShake: m.reduceShake === true, reduceFlash: m.reduceFlash === true } : null;
  })()`);
  // 先把设置面板关掉再重开（面板打开时 mode=settings，主循环暂停）
  await ev(`(function(){ var b = document.getElementById('settingsClose'); if (b) b.click(); return true; })()`);
  await sleep(200);
  await ev(`window.__roamDebug.restart()`);
  await sleep(900);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);
  const afterRestart = await ev(`window.__roamDebug.a11y()`);
  ok('U12-6 开关写入永久存档，重开后仍保持开启',
    !!saved && saved.reduceShake && saved.reduceFlash
    && afterRestart.reduceShake && afterRestart.reduceFlash,
    { saved: saved, afterRestart: afterRestart });

  // ---------- U12-7 装置：施法前移 ----------
  await ev(`(function(){ var b = document.getElementById('settingsClose'); if (b) b.click(); return true; })()`);
  await sleep(200);
  const castPose = await ev(`(function(){
    var p = state.player;
    p.castAnim = 1.2;           // 让偏移保持在峰值（衰减前一定能读到）
    return window.__roamDebug.devicePose();
  })()`);
  await sleep(80);
  await shot('u12-device-cast.png');
  ok('U12-7 装置回应·施法：向前顶出 4–5px 且辉光拉满',
    castPose.x >= 4.0 && castPose.x <= 5.0 && castPose.glow >= 0.99,
    castPose);

  // ---------- U12-8 装置：冲刺拖后 ----------
  const dashPose = await ev(`(function(){
    var p = state.player;
    p.castAnim = 0;
    p.dashTime = 0.25;
    p.dashVX = 120; p.dashVY = 0;
    return window.__roamDebug.devicePose();
  })()`);
  ok('U12-8 装置回应·冲刺：向后甩出 4–5px',
    dashPose.x <= -4.0 && dashPose.x >= -5.0, dashPose);

  // ---------- U12-9 装置：濒死抖动 + 变红 ----------
  const lowPose = await ev(`(function(){
    var p = state.player;
    p.dashTime = 0;
    p.hp = Math.max(1, Math.round(p.hpMax * 0.15));
    return window.__roamDebug.devicePose();
  })()`);
  await sleep(60);
  await shot('u12-device-lowhp.png');
  ok('U12-9 装置回应·濒死：alert=true、抖动幅度 ≤1.8px、辉光压到 0.45',
    lowPose.alert === true && Math.abs(lowPose.x) <= 1.8 && Math.abs(lowPose.y) <= 1.4
    && lowPose.glow <= 0.46,
    lowPose);
  // 恢复血量，避免后续收尾时被低血状态影响
  await ev(`(function(){ state.player.hp = state.player.hpMax; return true; })()`);

  // ---------- U12-10 关掉后可访问性恢回原强度 ----------
  const restore = await ev(`window.__roamDebug.setA11y(false, false)`);
  const shakeBack = await ev(`window.__roamDebug.shakeTest(20)`);
  const flashBack = await ev(`window.__roamDebug.flashTest()`);
  ok('U12-10 关闭两项后：震屏回到 20、闪白回到 100ms、总状态回「全效果开」',
    Math.abs(shakeBack.peak - 20) < 0.01 && flashBack.ms === 100
    && restore.panel.summary === '全效果开',
    { shake: shakeBack, flash: flashBack, panel: restore.panel });

  // ---------- U12-11 帧率 / 异常 / 截图 ----------
  const fps = await ev(`(function(){
    return new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
  })()`);
  const errors = await ev(`(window.__errors || []).length`);
  const names = ['u12-settings.png', 'u12-a11y-on.png', 'u12-device-cast.png', 'u12-device-lowhp.png'];
  const sizes = names.map((n) => {
    try { return fs.statSync(path.join(OUT_DIR, n)).size; } catch (e) { return 0; }
  });
  ok('U12-11 帧率 ≥90 / 无脚本错误 / 4 张截图 >10KB / 仍在游戏中',
    fps >= 90 && errors === 0 && sizes.every((s) => s > 10240)
    && (await ev(`state.mode`)) === 'playing',
    { fps, errors, sizes, mode: await ev(`state.mode`) });

  fs.writeFileSync(path.join(OUT_DIR, 'u12-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== u12 ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
