/**
 * C3 全探索奖励验收：A0–A9
 * 用法：node tools/arcane_fullclear.js
 * 端口：9525
 * 输出：.screenshots/art/fullclear.png、fullclear-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9525;
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
  const a0 = await ev(`window.__roamDebug.fullClear.info()`);
  ok('A0 配置默认值（开关 / 踏板半径 / 交互半径 / 不要求首领与隐藏房）',
    a0.enabled === true && a0.config.pedestalRadius === 22
      && a0.config.interactRange === 64
      && a0.config.skipTypes.indexOf('boss') >= 0
      && a0.config.skipTypes.indexOf('hidden') >= 0
      && a0.config.readyText.indexOf('全探索') >= 0, a0.config);

  // ---------- A1 新层未探索：不点亮 ----------
  const a1 = await ev(`window.__roamDebug.fullClear.setFloor(1)`);
  ok('A1 刚生成一层：未全探索（available=false、eligible=false）',
    a1.state.available === false && a1.state.granted === false
      && a1.eligible === false && a1.visited.length === 0
      && a1.need.length >= 2, a1);

  // ---------- A2 全部走一遍 → 点亮 ----------
  const a2 = await ev(`(function(){
    var before = window.__roamDebug.fullClear.info();
    var after = window.__roamDebug.fullClear.visitAll();
    return { before: before, after: after, stairs: { x: state.stairs.x, y: state.stairs.y } };
  })()`);
  const dx = a2.after.state.x - a2.stairs.x;
  const dy = a2.after.state.y - a2.stairs.y;
  ok('A2 全探索后点亮踏板：available=true、eligible=true、踏板在楼梯旁',
    a2.after.state.available === true && a2.after.eligible === true
      && a2.after.visited.length === a2.after.need.length
      && Math.hypot(dx, dy) <= a2.after.config.offsetX + 8
      && a2.after.stats.eligible >= 1, { after: a2.after, dx, dy });

  // ---------- A3 点亮但未领取：不弹奖励 ----------
  const a3 = await ev(`(function(){
    return { mode: state.mode, available: window.__roamDebug.fullClear.info().state.available,
      granted: window.__roamDebug.fullClear.info().state.granted };
  })()`);
  ok('A3 点亮但未按 E：仍在 playing、未发放', a3.mode !== 'reward' && a3.available === true && a3.granted === false, a3);

  // ---------- A4 领取 → 奖励弹窗（默认四选一，跟随 REWARD_CHOICES_CONFIG） ----------
  const choiceCount = await ev(`REWARD_CHOICES_CONFIG.count`);
  const a4 = await ev(`window.__roamDebug.fullClear.claim()`);
  ok('A4 按 E 领取：弹出 ' + choiceCount + ' 选一、granted=true、踏板熄灭',
    a4 && a4.consumed === true && a4.mode === 'reward'
      && a4.options === choiceCount && a4.info.state.granted === true
      && a4.info.state.available === false && a4.info.stats.granted >= 1, a4);

  // ---------- A5 每层一次：再次领取无效 ----------
  const a5 = await ev(`window.__roamDebug.fullClear.claim()`);
  ok('A5 同一层只能领一次：再次 claim 返回 null',
    a5 === null, { again: a5 });

  // ---------- A6 换层重置 ----------
  const a6 = await ev(`window.__roamDebug.fullClear.setFloor(2)`);
  ok('A6 换层重置：available=false、granted=false、visited 清空',
    a6.state.available === false && a6.state.granted === false
      && a6.visited.length === 0, a6);

  // ---------- A7 差一间不点亮 ----------
  const a7 = await ev(`(function(){
    window.__roamDebug.fullClear.setFloor(1);
    var info = window.__roamDebug.fullClear.info();
    var bt = state.backtrack;
    var partial = info.need.slice(0, Math.max(0, info.need.length - 1));
    partial.forEach(function(id){ trackBacktrack(state.rooms[id]); });
    var after = window.__roamDebug.fullClear.info();
    return { need: info.need.length, partial: partial.length,
      available: after.state.available, eligible: after.eligible,
      visited: after.visited.length };
  })()`);
  ok('A7 少走一间房不点亮（available=false、eligible=false）',
    a7.need >= 2 && a7.partial === a7.need - 1
      && a7.available === false && a7.eligible === false
      && a7.visited === a7.need - 1, a7);

  // ---------- A8 enabled=false 不点亮 ----------
  const a8 = await ev(`(function(){
    window.__roamDebug.fullClear.setEnabled(false);
    window.__roamDebug.fullClear.setFloor(1);
    var off = window.__roamDebug.fullClear.visitAll();
    window.__roamDebug.fullClear.setEnabled(true);
    window.__roamDebug.fullClear.setFloor(1);
    var on = window.__roamDebug.fullClear.visitAll();
    return { offEnabled: off.enabled, offAvailable: off.state.available, offEligible: off.eligible,
      onEnabled: on.enabled, onAvailable: on.state.available };
  })()`);
  ok('A8 enabled=false 不点亮；打开后恢复点亮',
    a8.offEnabled === false && a8.offAvailable === false
      && a8.onEnabled === true && a8.onAvailable === true, a8);

  // ---------- A9 截图 / fps / 零报错 ----------
  await ev(`(function(){
    // 关掉可能残留的奖励弹窗，回到战斗画面再截图/测帧
    try {
      state.mode = 'playing'; state.rewardStage = null;
      if (typeof ui !== 'undefined' && ui.modalLayer) {
        ui.modalLayer.classList.add('hidden');
        ui.modalLayer.setAttribute('aria-hidden', 'true');
      }
    } catch (e) { /* 忽略 */ }
    var info = window.__roamDebug.fullClear.info();
    if (info.state.x && info.state.y) {
      state.player.x = info.state.x + 40; state.player.y = info.state.y + 30;
      state.player.vx = 0; state.player.vy = 0; snapCamera();
    }
    return true;
  })()`);
  await sleep(700);
  const a9 = await ev(`(new Promise(function(resolve){
    var n = 0; var t0 = performance.now();
    function tick(){ n += 1;
      if (performance.now() - t0 >= 1000) resolve({ fps: Math.round(n * 1000 / (performance.now() - t0)),
        errors: window.__errors || [] });
      else requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  }))`);
  await shot('fullclear.png');
  ok('A9 截图产出 / 帧率 ≥45 / 零报错',
    fs.statSync(path.join(OUT_DIR, 'fullclear.png')).size > 200000
      && a9.fps >= 45 && a9.errors.length === 0, a9);

  const passed = asserts.filter((a) => a.pass).length;
  const summary = { total: asserts.length, passed, failed: asserts.length - passed,
    fps: a9.fps, asserts };
  fs.writeFileSync(path.join(OUT_DIR, 'fullclear-result.json'), JSON.stringify(summary, null, 2));
  console.log(`\n===== C3 全探索奖励 ${passed}/${asserts.length} =====`);
  ws.close();
  killEdge(edge);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
