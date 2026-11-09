/**
 * U8「音画质感包」验收脚本（端口 9492）
 * ------------------------------------------------------------
 * 覆盖：B8 Boss 登场全屏大字 + D7 音效音高 / 音量微抖。
 * 断言见 .spec/u8-juice/spec.md 第 4 节（12 项）。
 *
 * 为什么要用 'fire' 做音效断言：
 *   'fire' 的音色只由振荡器 + 包络构成，不含 Math.random 噪声，
 *   因此"三次离线渲染出来的峰值不同"只可能来自音量/音高微抖，
 *   是微抖真的进入波形的干净证据。
 *
 * 用法：node tools/arcane_u8.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9492;                 // U8 专用端口（L1=9489 / L2=9490 / L4=9491）
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---------- U8-1 静态守卫 ----------
  const source = fs.readFileSync(FILE, 'utf8');
  ok('结构就位：#bossTitle / showBossTitle / nextSfxVariation',
    source.includes('id="bossTitle"') && source.includes('function showBossTitle(')
    && source.includes('function nextSfxVariation(') && source.includes('boss-title-kicker'),
    {
      node: source.includes('id="bossTitle"'),
      show: source.includes('function showBossTitle('),
      jitter: source.includes('function nextSfxVariation(')
    });

  // ---------- 启动 Edge headless ----------
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
  /**
   * 截图到 .screenshots/art/
   * @param {string} name 文件名
   * @returns {string} 绝对路径
   */
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
  await sleep(2400);

  const btn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await sleep(1400);

  // ---------- 进入第 2 层并把角色放进首领房（自然触发登场） ----------
  await ev(`window.__roamDebug.setFloor(2)`);
  await sleep(500);
  await ev(`window.__roamDebug.setHp(100)`);
  const bossRoom = await ev(`(() => { const s = window.__roamDebug.bossState(); return s ? s.room : null; })()`);
  if (!bossRoom) throw new Error('第 2 层没有首领房');
  await ev(`window.__roamDebug.teleport(${bossRoom.cx - 90}, ${bossRoom.cy})`);
  await sleep(420);

  // ---------- U8-2 大字可见 + 文案 ----------
  const titleNow = await ev(`(() => {
    const el = document.getElementById('bossTitle');
    const kicker = document.querySelector('.boss-title-kicker');
    return {
      visible: !!(el && !el.classList.contains('hidden')),
      playing: !!(el && el.classList.contains('is-playing')),
      name: (document.getElementById('bossTitleName') || {}).textContent || '',
      sub: (document.getElementById('bossTitleSub') || {}).textContent || '',
      kicker: kicker ? kicker.textContent.trim() : '',
      pointerEvents: el ? getComputedStyle(el).pointerEvents : 'missing'
    };
  })()`);
  ok('进首领房自然触发全屏大字（visible + 层名/称号非空）',
    titleNow.visible === true && titleNow.playing === true
    && titleNow.name.length > 0 && titleNow.sub.length > 0,
    titleNow);
  ok('kicker 文案为 BOSS ENCOUNTER（与中文名分层）',
    titleNow.kicker === 'BOSS ENCOUNTER', { kicker: titleNow.kicker });
  ok('大字不挡操作（pointer-events: none）',
    titleNow.pointerEvents === 'none', { pointerEvents: titleNow.pointerEvents });

  const afterShot = await shot('u8-boss-title-after.png');

  // ---------- U8-3 2.3s 自动收起 ----------
  await sleep(2600);
  const titleLater = await ev(`(() => {
    const el = document.getElementById('bossTitle');
    return { visible: !!(el && !el.classList.contains('hidden')), playing: !!(el && el.classList.contains('is-playing')) };
  })()`);
  ok('2.6s 后自动收起（不残留全屏层）',
    titleLater.visible === false && titleLater.playing === false, titleLater);

  // ---------- U8-4 A/B：关闭后不再出现 ----------
  await ev(`window.__roamDebug.setU8(false)`);
  const off = await ev(`window.__roamDebug.previewBossTitle()`);
  ok('setU8(false) 后重播登场：大字不出现', off && off.visible === false, off);
  await sleep(300);
  const beforeShot = await shot('u8-boss-title-before.png');

  await ev(`window.__roamDebug.setU8(true)`);
  const back = await ev(`(() => { const on = window.__roamDebug.setU8(true); return { on }; })()`);
  ok('setU8(true) 恢复开启', back.on === true, back);

  // ---------- U8-5 音效微抖进波形 ----------
  const jitterOn = await ev(`window.__roamDebug.sfxJitter()`);
  ok('微抖真的进了波形（三次离线渲染 distinct ≥ 2）',
    jitterOn && jitterOn.ok === true && jitterOn.distinct >= 2,
    { peaks: jitterOn && jitterOn.peaks, distinct: jitterOn && jitterOn.distinct });
  const peaks = (jitterOn && jitterOn.peaks) || [];
  const mean = peaks.reduce((a, b) => a + b, 0) / Math.max(1, peaks.length);
  const spread = peaks.length ? (Math.max(...peaks) - Math.min(...peaks)) / mean : 1;
  ok('微抖幅度小（峰值极差 / 均值 ≤ 12%）', spread <= 0.12,
    { spread: Number(spread.toFixed(4)), peaks });

  const jitterOff = await ev(`(() => { window.__roamDebug.setU8(false); return window.__roamDebug.sfxJitter(); })()`);
  ok('关闭后三次渲染波形完全一致（distinct === 1）',
    jitterOff && jitterOff.ok === true && jitterOff.distinct === 1,
    { peaks: jitterOff && jitterOff.peaks, distinct: jitterOff && jitterOff.distinct });
  await ev(`window.__roamDebug.setU8(true)`);

  // ---------- U8-6 性能与截图体积 ----------
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

  const missing = [afterShot, beforeShot].filter((s) => !fs.existsSync(s) || fs.statSync(s).size < 10 * 1024);
  ok('before / after 同机位截图均 >10KB', missing.length === 0, missing.map((s) => path.basename(s)));

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nU8 · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(path.join(OUT_DIR, 'u8-result.json'),
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
