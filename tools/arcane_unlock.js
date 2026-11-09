/**
 * D1 渐进解锁验收：A0–A8
 * 用法：node tools/arcane_unlock.js
 * 端口：9526
 * 输出：.screenshots/art/unlock.png、unlock-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9526;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
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
  await ev(`(function(){ window.__errors = []; window.addEventListener('error', function(e){ window.__errors.push(String(e.message || e)); }); return true; })()`);

  // ---------- A0 配置 ----------
  const a0 = await ev(`window.__roamDebug.unlocks.info()`);
  ok('A0 配置默认值：enabled / stageFloor=3 / 四道 gate 顺序',
    a0.enabled === true && a0.config.stageFloor === 3
      && a0.config.order.join(',') === 'fusion,device,overdrive,parallel'
      && a0.config.hiddenClass === 'is-unlock-hidden', a0.config);

  // ---------- A1 新档第 1 层：四道 gate 全锁、相关 UI 全部隐藏 ----------
  const a1 = await ev(`window.__roamDebug.unlocks.reset()`);
  ok('A1 新档全锁：fusion/device/overdrive/parallel=false，融合条/过载条/并联条/装置条全隐藏',
    a1.gates.fusion === false && a1.gates.device === false
      && a1.gates.overdrive === false && a1.gates.parallel === false
      && a1.hidden.fusionBar === true && a1.hidden.fusionHint === true
      && a1.hidden.overdriveBar === true && a1.hidden.dualBar === true
      && a1.hidden.deviceChip === true, a1.hidden);

  // ---------- A2 清第一间战斗房 → 只解锁融合 ----------
  const a2 = await ev(`(function(){
    window.__roamDebug.unlocks.setFloor(1);
    window.__roamDebug.unlocks.reset();
    var before = window.__roamDebug.unlocks.info();
    var after = window.__roamDebug.unlocks.clearBattle();
    return { before: before, after: after };
  })()`);
  ok('A2 清第一间战斗房：只解锁 fusion、统计 +1、融合条立刻显示',
    a2.before.gates.fusion === false && a2.after.gates.fusion === true
      && a2.after.gates.device === false && a2.after.gates.overdrive === false
      && a2.after.stats.unlocks === 1 && a2.after.hidden.fusionBar === false, a2.after);

  // ---------- A3 拿到第一张科技卡 → 解锁装置（重复不计数） ----------
  const a3 = await ev(`(function(){
    var first = window.__roamDebug.unlocks.grant('device');
    var second = window.__roamDebug.unlocks.grant('device');
    return { first: first.ok, second: second.ok, stats: second.info.stats,
      gates: second.info.gates, hidden: second.info.hidden.deviceChip };
  })()`);
  ok('A3 第一次拿科技：device 解锁（再次 grant 不重复计数、装置条显示）',
    a3.first === true && a3.second === false && a3.gates.device === true
      && a3.stats.unlocks === 2 && a3.hidden === false, a3);

  // ---------- A4 第 3 层前锁过载/并联，到 3 层解锁且不倒退 ----------
  const a4 = await ev(`(function(){
    var at2 = window.__roamDebug.unlocks.setFloor(2);
    var at3 = window.__roamDebug.unlocks.setFloor(3);
    var at4 = window.__roamDebug.unlocks.setFloor(4);
    return { at2: at2.gates, at3: at3.gates, at4: at4.gates,
      stats: at4.stats, hidden3: at3.hidden };
  })()`);
  ok('A4 第 2 层仍锁过载/并联；第 3 层解锁；第 4 层保持',
    a4.at2.overdrive === false && a4.at2.parallel === false
      && a4.at3.overdrive === true && a4.at3.parallel === true
      && a4.at4.overdrive === true && a4.at4.parallel === true
      && a4.hidden3.overdriveBar === false && a4.hidden3.dualBar === false, a4);

  // ---------- A5 落盘：meta.unlocks 写进 localStorage ----------
  const a5 = await ev(`(function(){
    saveMeta();
    var found = false;
    for (var i = 0; i < localStorage.length; i += 1) {
      var k = localStorage.key(i);
      var v = localStorage.getItem(k);
      if (v && v.indexOf('"unlocks"') >= 0) {
        try {
          var o = JSON.parse(v);
          if (o && o.unlocks && o.unlocks.fusion === true && o.unlocks.overdrive === true) found = true;
        } catch (e) { /* 不是这份存档 */ }
      }
    }
    return { found: found, meta: state.meta.unlocks };
  })()`);
  ok('A5 解锁写进存档（localStorage 里 fusion/overdrive 均为 true）',
    a5.found === true && a5.meta.fusion === true && a5.meta.overdrive === true, a5);

  // ---------- A6 enabled=false：门禁放行、UI 不再隐藏 ----------
  const a6 = await ev(`(function(){
    window.__roamDebug.unlocks.reset();
    window.__roamDebug.unlocks.setEnabled(false);
    var off = window.__roamDebug.unlocks.info();
    window.__roamDebug.unlocks.setEnabled(true);
    var on = window.__roamDebug.unlocks.info();
    return { off: off, on: on };
  })()`);
  ok('A6 enabled=false：四道 gate 全部放行、UI 不隐藏；打开后恢复锁定',
    a6.off.gates.fusion === true && a6.off.gates.device === true
      && a6.off.gates.overdrive === true && a6.off.gates.parallel === true
      && a6.off.hidden.fusionBar === false && a6.off.hidden.overdriveBar === false
      && a6.on.gates.fusion === false && a6.on.hidden.fusionBar === true, { off: a6.off.hidden, on: a6.on.hidden });

  // ---------- A7 tryFuse 守卫：未解锁时直接 false ----------
  const a7 = await ev(`(function(){
    window.__roamDebug.unlocks.reset();
    state.mode = 'playing'; state.status = 'playing';
    var locked = tryFuse();
    window.__roamDebug.unlocks.grant('fusion');
    var unlocked = tryFuse();
    return { locked: locked, unlocked: unlocked, fusion: isUnlocked('fusion') };
  })()`);
  ok('A7 融合守卫：未解锁 tryFuse=false；解锁后不再被守卫拦',
    a7.locked === false && a7.fusion === true, a7);

  // ---------- A8 截图 / fps / 零报错 ----------
  await ev(`(function(){
    window.__roamDebug.unlocks.setEnabled(true);
    window.__roamDebug.unlocks.setFloor(2);
    try { if (typeof ui !== 'undefined' && ui.modalLayer) ui.modalLayer.classList.add('hidden'); } catch (e) {}
    state.mode = 'playing';
    snapCamera();
    return true;
  })()`);
  await sleep(700);
  const a8 = await ev(`(new Promise(function(resolve){
    var n = 0; var t0 = performance.now();
    function tick(){ n += 1;
      if (performance.now() - t0 >= 1000) resolve({ fps: Math.round(n * 1000 / (performance.now() - t0)),
        errors: window.__errors || [] });
      else requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  }))`);
  await shot('unlock.png');
  ok('A8 截图产出 / 帧率 ≥45 / 零报错',
    fs.statSync(path.join(OUT_DIR, 'unlock.png')).size > 200000
      && a8.fps >= 45 && a8.errors.length === 0, a8);

  const passed = asserts.filter((a) => a.pass).length;
  fs.writeFileSync(path.join(OUT_DIR, 'unlock-result.json'), JSON.stringify({
    total: asserts.length, passed, failed: asserts.length - passed, fps: a8.fps, asserts
  }, null, 2));
  console.log(`\n===== D1 渐进解锁 ${passed}/${asserts.length} =====`);
  ws.close();
  killEdge(edge);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
