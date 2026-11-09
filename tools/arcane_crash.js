/**
 * 第 18 项 · 崩溃兜底与自动保存验收（C1–C9）
 * 用法：node tools/arcane_crash.js
 * 端口：9542
 * 输出：.screenshots/art/crash-overlay.png、crash-result.json
 *
 * 链路说明：__roamDebug.crash.simulate(n) 让主循环接下来 n 帧主动抛错，
 * 走的是与真实异常完全相同的 loop → noteLoopError → triggerCrash 路径。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9542;
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
   * 重新加载页面（同一 profile，localStorage 保留，用于验证"刷新后仍可恢复"）
   */
  const reload = async () => {
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(1800);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await reload();
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(900);
  // 跳过开场演出，回到第 3 层并手存一档：后面用"崩溃后是否还在第 3 层"验证存档可读回
  await ev(`(function(){
    if (typeof skipOpeningRitual === 'function') skipOpeningRitual();
    state.transitionLock = false;
    window.__roamDebug.clearEnemies();
    state.player.vx = 0; state.player.vy = 0;
    window.__roamDebug.setFloor(3);
    state.runSlot = 1;
    window.__roamDebug.p2.saveNow('manual');
    window.__errors = [];
    return { floor: state.floor, slot: state.runSlot, status: state.status };
  })()`);
  await sleep(400);

  // ---------- C1 启动零错误 ----------
  const boot = await ev(`(function(){
    return { errors: (window.__errors || []).slice(), cfg: window.__roamDebug.crash.config(),
      overlayExists: !!document.getElementById('crashOverlay'), hidden: document.getElementById('crashOverlay').hidden };
  })()`);
  ok('C1 启动：0 脚本错误、配置存在、恢复面板 DOM 存在且默认隐藏',
    boot.errors.length === 0 && boot.cfg.enabled === true && boot.cfg.maxErrors === 2
      && boot.overlayExists === true && boot.hidden === true, boot);

  // ---------- C2 单帧瞬时异常不打扰 ----------
  await ev(`window.__errors = []; window.__roamDebug.crash.simulate(1)`);
  await sleep(320);
  const single = await ev(`window.__roamDebug.crash.state()`);
  ok('C2 单帧异常：不弹面板、不停机、连续计数归零',
    single.halted === false && single.shown === false && single.consecutive === 0
      && single.overlayHidden === true, single);

  // ---------- C3 连续 2 帧 → 停机 + 弹面板 ----------
  const beforeCrash = await ev(`(function(){
    var info = window.__roamDebug.p2.slotInfo(state.runSlot);
    return { savedAt: info ? info.savedAt : 0, floor: state.floor, slot: state.runSlot };
  })()`);
  await ev(`window.__errors = []; window.__roamDebug.crash.simulate(2)`);
  await sleep(450);
  const crashed = await ev(`window.__roamDebug.crash.state()`);
  ok('C3 连续 2 帧异常：halted=true、面板可见、崩溃标记已写、楼层与槽位正确',
    crashed.halted === true && crashed.shown === true && crashed.overlayHidden === false
      && !!crashed.flag && Number(crashed.flag.floor) === 3 && Number(crashed.flag.slot) >= 1,
    crashed);

  // ---------- C4 崩溃前自动存档 ----------
  const slot = await ev(`(function(){
    var info = window.__roamDebug.p2.slotInfo(state.runSlot);
    return info ? { savedAt: info.savedAt, reason: info.reason, floor: info.floor, slot: info.slot } : null;
  })()`);
  ok('C4 崩溃瞬间自动存档：同一槽 savedAt 更新、reason=crash、楼层=3',
    !!slot && slot.reason === 'crash' && slot.savedAt > beforeCrash.savedAt && slot.floor === 3,
    { before: beforeCrash, after: slot });

  // ---------- C5 非白屏：面板 + 最后一帧仍在 ----------
  await shot('crash-overlay.png');
  const pixels = await ev(`(function(){
    var c = document.getElementById('game');
    var g = c.getContext('2d');
    var uniq = {}; var white = 0; var n = 0;
    for (var i = 1; i <= 5; i += 1) {
      for (var j = 1; j <= 5; j += 1) {
        var d = g.getImageData(Math.floor(c.width * i / 6), Math.floor(c.height * j / 6), 1, 1).data;
        uniq[d[0] + ',' + d[1] + ',' + d[2]] = 1; n += 1;
        if (d[0] > 245 && d[1] > 245 && d[2] > 245) white += 1;
      }
    }
    var card = document.querySelector('#crashOverlay .crash-card');
    var cs = card ? getComputedStyle(card) : null;
    return { colors: Object.keys(uniq).length, samples: n, white: white,
      display: getComputedStyle(document.getElementById('crashOverlay')).display,
      cardBg: cs ? cs.backgroundImage : '', meta: document.getElementById('crashMeta').textContent };
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'crash-overlay.png')).size; } catch (e) { shotSize = 0; }
  ok('C5 非白屏：画布中心 25 采样 ≥3 种颜色、纯白 <25%、面板 display=flex、截图 >10KB',
    pixels.colors >= 3 && pixels.white < pixels.samples * 0.25 && pixels.display === 'flex' && shotSize > 10240,
    { colors: pixels.colors, white: pixels.white, samples: pixels.samples, shotSize, meta: pixels.meta });

  // ---------- C6 一键恢复 ----------
  await ev(`document.getElementById('crashRestoreBtn').click(); true`);
  await sleep(700);
  const restored = await ev(`(function(){
    return { crash: window.__roamDebug.crash.state(), floor: state.floor,
      mode: state.mode, status: state.status, errors: (window.__errors || []).length };
  })()`);
  ok('C6 读取最近存档：halted 复位、面板收起、回到第 3 层、循环恢复推进',
    restored.crash.halted === false && restored.crash.overlayHidden === true
      && restored.floor === 3 && restored.mode === 'playing',
    restored);

  // ---------- C7 刷新后仍可恢复 ----------
  await ev(`window.__errors = []; window.__roamDebug.crash.trigger('reload-test')`);
  await sleep(400);
  await reload();
  const afterReload = await ev(`(function(){
    var s = window.__roamDebug.crash.state();
    return { s: s, mode: state.mode, overlayHidden: document.getElementById('crashOverlay').hidden };
  })()`);
  await ev(`document.getElementById('crashRestoreBtn').click(); true`);
  await sleep(800);
  const reloadRestored = await ev(`(function(){
    return { crash: window.__roamDebug.crash.state(), floor: state.floor, mode: state.mode,
      slot: window.__roamDebug.p2.slotInfo(1) };
  })()`);
  ok('C7 刷新后恢复：启动即弹面板 → 点恢复回到崩溃前楼层（3）',
    afterReload.s.overlayHidden === false && afterReload.mode === 'title'
      && reloadRestored.crash.overlayHidden === true && reloadRestored.floor === 3
      && !!reloadRestored.slot, { afterReload, reloadRestored });

  // ---------- C8 放弃本局重开 ----------
  await ev(`window.__errors = []; window.__roamDebug.crash.trigger('restart-test')`);
  await sleep(350);
  await ev(`document.getElementById('crashRestartBtn').click(); true`);
  await sleep(900);
  const restarted = await ev(`(function(){
    return { crash: window.__roamDebug.crash.state(), floor: state.floor,
      mode: state.mode, flag: window.__roamDebug.crash.state().flag };
  })()`);
  ok('C8 放弃重开：回到第 1 层、崩溃标记清空、面板收起、halted 复位',
    restarted.floor === 1 && restarted.flag === null
      && restarted.crash.overlayHidden === true && restarted.crash.halted === false, restarted);

  // ---------- C9 总开关可回退 ----------
  const off = await ev(`(function(){
    window.__roamDebug.crash.clearFlag();
    CRASH_CONFIG.enabled = false;
    var r = window.__roamDebug.crash.trigger('disabled-test');
    var s = window.__roamDebug.crash.state();
    CRASH_CONFIG.enabled = true;
    return { triggered: r, halted: s.halted, overlayHidden: s.overlayHidden };
  })()`);
  ok('C9 总开关：enabled=false 时触发返回 false、不停机、不弹面板',
    off.triggered === false && off.halted === false && off.overlayHidden === true, off);

  // 收尾：清标记、清测试输入
  await ev(`(function(){ window.__roamDebug.crash.clearFlag(); state.keys = {}; state.player.vx = 0; state.player.vy = 0; return true; })()`);

  fs.writeFileSync(path.join(OUT_DIR, 'crash-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log(`\n===== T crash ${pass}/${asserts.length} ===== (shot ${shotSize}B)`);
  console.log('VERDICT: ' + (pass === asserts.length ? 'PASS' : 'FAIL'));

  try { ws.close(); } catch (e) { /* ignore */ }
  try { killEdge(edge); } catch (e) { /* ignore */ }
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (pass !== asserts.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
