/**
 * D4 工程隐患验收：A0–A13
 * 覆盖：存档版本号落盘、v0 旧档迁移不丢数据、迁移纯函数/幂等、坏 JSON 降级提示、
 *       类型错误降级、性能模式默认关、开启后粒子/迷雾/后处理生效、迷雾画布半分辨率、
 *       关闭恢复、设置页开关可点击、总开关 A/B、截图/fps/报错。
 * 用法：node tools/arcane_d4.js
 * 端口：9529
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9529;
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
  await ev(`(function(){ window.__errors = []; window.addEventListener('error', function(e){ window.__errors.push(String(e.message || e)); }); return true; })()`);

  // ---------- A0 默认存档带当前版本号 ----------
  const a0 = await ev(`(function(){
    var d = defaultMeta();
    var fixed = normalizeMeta({});
    return { schema: META_SCHEMA_VERSION, defVersion: d.version, fixedVersion: fixed.version,
      perf: d.performance, ms: d.milestones };
  })()`);
  ok('A0 默认存档 version=4，含 performance.mode=false 与 milestones 容器',
    a0.schema === 4 && a0.defVersion === 4 && a0.fixedVersion === 4
      && a0.perf.mode === false && a0.ms.highestFloor === 0 && Array.isArray(a0.ms.titles), a0);

  // ---------- A1 v0 旧档迁移：不丢旧字段，里程碑按 bestFloor 推导 ----------
  const a1 = await ev(`(function(){
    var t0 = TALENT_CONFIG[0].id;
    var old = { bestFloor: 7, runs: 9, crystals: 33, talents: {}, storySeen: ['intro'] };
    old.talents[t0] = 2;
    var fixed = normalizeMeta(old);
    var keep = fixed.talents[t0];
    return { bestFloor: fixed.bestFloor, runs: fixed.runs, crystals: fixed.crystals,
      talent: keep, storySeen: fixed.storySeen, version: fixed.version,
      highestFloor: fixed.milestones.highestFloor, titles: fixed.milestones.titles };
  })()`);
  ok('A1 v0 旧档迁移：bestFloor/runs/结晶/天赋/剧情记录不丢，version=4，里程碑=5 层/塔心初响',
    a1.bestFloor === 7 && a1.runs === 9 && a1.crystals === 33 && a1.talent === 2
      && a1.storySeen.join('|') === 'intro' && a1.version === 4
      && a1.highestFloor === 5 && a1.titles.indexOf('塔心初响') >= 0, a1);

  // ---------- A2 迁移纯函数：不改入参 + 重复迁移幂等 ----------
  const a2 = await ev(`(function(){
    var src = { bestFloor: 7, crystals: 33, postFx: false };
    var before = JSON.stringify(src);
    var once = migrateMeta(src, 0);
    var twice = migrateMeta(once, 4);
    return { unchanged: JSON.stringify(src) === before, same: JSON.stringify(once) === JSON.stringify(twice),
      version: twice.version };
  })()`);
  ok('A2 migrateMeta 纯函数（入参不变）且二次迁移结果完全一致（幂等）',
    a2.unchanged === true && a2.same === true && a2.version === 4, a2);

  // ---------- A3 坏 JSON 降级 + 一次性提示 ----------
  const a3 = await ev(`(function(){
    var key = GAME_CONFIG.metaKey;
    var backup = window.localStorage.getItem(key);
    window.localStorage.setItem(key, '{bad json');
    var fixed = loadMeta();
    var notice = metaLoadNotice;
    if (backup == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, backup);
    return { version: fixed.version, bestFloor: fixed.bestFloor, notice: notice, runs: fixed.runs };
  })()`);
  ok('A3 坏 JSON：loadMeta 不崩，返回默认存档且提示「存档已损坏」',
    a3.version === 4 && a3.bestFloor === 1 && a3.runs === 0
      && typeof a3.notice === 'string' && a3.notice.indexOf('损坏') >= 0, a3);

  // ---------- A4 类型错误降级：titles 非数组 / highestFloor 非数 ----------
  const a4 = await ev(`(function(){
    var bad = { bestFloor: 1, milestones: { highestFloor: 'abc', titles: 'nope' } };
    var fixed = normalizeMeta(bad);
    var badPerf = normalizeMeta({ bestFloor: 1, performance: { mode: 'yes' } });
    return { titles: fixed.milestones.titles, highestFloor: fixed.milestones.highestFloor,
      perfMode: badPerf.performance.mode, version: badPerf.version };
  })()`);
  ok('A4 类型错误：titles→[]、highestFloor→0、performance.mode 非布尔→false',
    Array.isArray(a4.titles) && a4.titles.length === 0 && a4.highestFloor === 0
      && a4.perfMode === false && a4.version === 4, a4);

  // ---------- A5 saveMeta：版本号与数据真实落盘 ----------
  const a5 = await ev(`(function(){
    state.meta.crystals = 77;
    state.meta.bestFloor = 6;
    saveMeta();
    var raw = JSON.parse(window.localStorage.getItem(GAME_CONFIG.metaKey));
    var back = normalizeMeta(raw);
    return { version: raw.version, crystals: back.crystals, bestFloor: back.bestFloor,
      perf: raw.performance ? raw.performance.mode : 'missing' };
  })()`);
  ok('A5 saveMeta 落盘：version=4、结晶/最好楼层写入、performance.mode 存在',
    a5.version === 4 && a5.crystals === 77 && a5.bestFloor === 6 && a5.perf === false, a5);

  // ---------- A6 性能模式默认关 ----------
  const a6 = await ev(`(function(){
    window.__roamDebug.perf.setMode(false);
    var info = window.__roamDebug.perf.info();
    return { saf: info, state: window.__roamDebug.getState().performance };
  })()`);
  ok('A6 默认关：performanceMode=false，粒子 1/迷雾 1/后处理生效',
    a6.saf.mode === false && a6.saf.particleScale === 1 && a6.saf.fogScale === 1
      && a6.saf.postFxEffective === true && a6.state.mode === false, a6);

  // ---------- A7 开启后三个参数生效（postFx 强制关，meta.postFx 不变） ----------
  const a7 = await ev(`(function(){
    var postFxBefore = state.meta.postFx;
    window.__roamDebug.perf.setMode(true);
    var info = window.__roamDebug.perf.info();
    var raw = JSON.parse(window.localStorage.getItem(GAME_CONFIG.metaKey));
    return { mode: info.mode, particle: info.particleScale, fog: info.fogScale,
      postFxEffective: info.postFxEffective, postFxMeta: state.meta.postFx,
      postFxBefore: postFxBefore, savedMode: raw.performance ? raw.performance.mode : null,
      version: raw.version, pixel: PIXEL_FX_CONFIG.enabled };
  })()`);
  ok('A7 开启：粒子 0.45 / 迷雾 0.5 / 后处理强制关；meta.postFx 原值不动并写入存档 mode=true',
    a7.mode === true && a7.particle === 0.45 && a7.fog === 0.5 && a7.postFxEffective === false
      && a7.postFxMeta === true && a7.postFxBefore === true && a7.savedMode === true
      && a7.version === 4 && a7.pixel === false, a7);

  // ---------- A8 迷雾离屏画布尺寸减半 ----------
  const a8 = await ev(`(function(){
    ensureFogCanvas();
    var w = GAME_CONFIG.worldWidth, h = GAME_CONFIG.worldHeight;
    return { worldW: w, worldH: h, fogW: fogW, fogH: fogH, scale: fogScaleFactor };
  })()`);
  ok('A8 性能模式：迷雾画布按 0.5 重建（fogW≈worldW/2、fogH≈worldH/2、scale=0.5）',
    a8.scale === 0.5 && Math.abs(a8.fogW - Math.round(a8.worldW * 0.5)) <= 1
      && Math.abs(a8.fogH - Math.round(a8.worldH * 0.5)) <= 1, a8);

  // ---------- A9 粒子数量真实缩减（同一 addBurst 对比） ----------
  const a9 = await ev(`(function(){
    window.__roamDebug.perf.setMode(false);
    addBurst(0, 0, '#ffffff', 40, 100, null, null, false);
    var off = state.lastBurst ? state.lastBurst.count : -1;
    window.__roamDebug.perf.setMode(true);
    addBurst(0, 0, '#ffffff', 40, 100, null, null, false);
    var on = state.lastBurst ? state.lastBurst.count : -1;
    return { off: off, on: on };
  })()`);
  ok('A9 粒子缩减：40 颗粒子在性能模式下变为 18 颗（0.45 倍，且不少于 3）',
    a9.off === 40 && a9.on === Math.max(3, Math.round(40 * 0.45)), a9);

  // ---------- A10 关闭后完全恢复 ----------
  const a10 = await ev(`(function(){
    window.__roamDebug.perf.setMode(false);
    var info = window.__roamDebug.perf.info();
    ensureFogCanvas();
    var w = GAME_CONFIG.worldWidth;
    return { mode: info.mode, particle: info.particleScale, fog: info.fogScale,
      postFx: info.postFxEffective, scale: fogScaleFactor, fogW: fogW, worldW: w,
      saved: JSON.parse(window.localStorage.getItem(GAME_CONFIG.metaKey)).performance.mode };
  })()`);
  ok('A10 关闭恢复：粒子 1/迷雾 1/后处理恢复，迷雾画布回原分辨率，存档 mode=false',
    a10.mode === false && a10.particle === 1 && a10.fog === 1 && a10.postFx === true
      && a10.scale === 1 && Math.abs(a10.fogW - Math.round(a10.worldW)) <= 1 && a10.saved === false, a10);

  // ---------- A11 设置页开关真实存在且可点击 ----------
  const a11 = await ev(`(function(){
    var el = document.getElementById('perfToggle');
    var label = document.getElementById('perfStateText2');
    var before = el ? el.getAttribute('aria-checked') : null;
    if (el) el.click();
    var afterMode = state.performanceMode;
    var after = el ? el.getAttribute('aria-checked') : null;
    var text = label ? label.textContent : '';
    if (el) el.click();
    return { exists: !!el, before: before, after: after, mode: afterMode, text: text,
      restored: state.performanceMode, ariaNow: el ? el.getAttribute('aria-checked') : null };
  })()`);
  ok('A11 设置页「性能模式」开关存在，点击一次开启（aria-checked=true、文案含粒子/迷雾），再点关闭',
    a11.exists === true && a11.before === 'false' && a11.after === 'true' && a11.mode === true
      && a11.text.indexOf('粒子') >= 0 && a11.text.indexOf('迷雾') >= 0
      && a11.restored === false && a11.ariaNow === 'false', a11);

  // ---------- A12 总开关 A/B：关掉后 setMode 不改变运行时 ----------
  const a12 = await ev(`(function(){
    window.__roamDebug.perf.setEnabled(false);
    window.__roamDebug.perf.setMode(true);
    var info = window.__roamDebug.perf.info();
    window.__roamDebug.perf.setEnabled(true);
    window.__roamDebug.perf.setMode(false);
    return { mode: info.mode, particle: info.particleScale, fog: info.fogScale,
      enabled: info.enabled, version: info.version };
  })()`);
  ok('A12 总开关关闭：setMode(true) 不生效（mode=false、粒子/迷雾仍 1）；重开后恢复可控',
    a12.enabled === false && a12.mode === false && a12.particle === 1 && a12.fog === 1, a12);

  // ---------- A13 截图（开/关两组）+ 帧率 + 报错 ----------
  await ev(`(function(){
    state.status = 'playing'; state.mode = 'playing';
    if (window.__modalClose) window.__modalClose();
    var m = document.querySelector('#modalLayer'); if (m) m.classList.add('hidden');
    for (var i = 0; i < 3; i += 1) {
      spawnEnemy('forgepriest', state.player.x - 80 - i * 30, state.player.y + 30 + i * 22, state.floor,
        { roomId: state.currentRoomId });
      spawnEnemy('voidbishop', state.player.x + 80 + i * 30, state.player.y - 30 - i * 22, state.floor,
        { roomId: state.currentRoomId });
    }
    addRing(state.player.x, state.player.y, 150, '#ffd48a', 1.6, 0.9, 'rune', 1.2);
    addBurst(state.player.x, state.player.y, '#b085ff', 30, 140, 0, 0.6, false);
    return true;
  })()`);
  await sleep(300);
  // 全画质
  await ev(`window.__roamDebug.perf.setMode(false)`);
  await sleep(400);
  await shot('d4-off.png');
  const fpsOff = await ev(`window.__roamDebug.getState().fps`);
  // 性能模式
  await ev(`window.__roamDebug.perf.setMode(true)`);
  await sleep(600);
  await shot('d4.png');
  const fpsOn = await ev(`window.__roamDebug.getState().fps`);
  const errors = await ev(`window.__errors.slice()`);
  const pngOff = fs.statSync(path.join(OUT_DIR, 'd4-off.png')).size;
  const pngOn = fs.statSync(path.join(OUT_DIR, 'd4.png')).size;
  ok('A13 两种模式截图均 >600KB（画面非黑屏/非空白）、无运行时报错、帧率 ≥ 30',
    pngOff > 600 * 1024 && pngOn > 600 * 1024 && errors.length === 0
      && fpsOff >= 30 && fpsOn >= 30, { pngOff: pngOff, pngOn: pngOn, fpsOff: fpsOff, fpsOn: fpsOn, errors: errors });

  // 收尾：恢复全画质，避免影响后续手动打开
  await ev(`window.__roamDebug.perf.setMode(false)`);

  fs.writeFileSync(path.join(OUT_DIR, 'd4-result.json'),
    JSON.stringify({ asserts: asserts, pass: asserts.filter((a) => a.pass).length, total: asserts.length }, null, 2));
  killEdge(edge);
  const passed = asserts.filter((a) => a.pass).length;
  console.log('\nRESULT: ' + (passed === asserts.length ? 'PASS' : 'FAIL') + ' ' + passed + '/' + asserts.length);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
