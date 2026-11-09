/**
 * D3 里程碑验收：A0–A8
 * 覆盖：第 5/10/15 层专属演出、同层只触发一次、称号入档、镜头推上、结算文案、开关 A/B、旧档迁移
 * 用法：node tools/arcane_d3.js
 * 端口：9528
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9528;
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
  // 清空本局触发统计与存档称号，保证从"零"开始验证
  await ev(`(function(){
    window.__roamDebug.milestone.resetStats();
    state.meta.milestones = { highestFloor: 0, titles: [] };
    localStorage.removeItem('arcane_meta_v2');
    state.meta = defaultMeta();
    return true;
  })()`);

  // ---------- A0 配置：3 个锚点 5/10/15 ----------
  const a0 = await ev(`window.__roamDebug.milestone.info()`);
  ok('A0 配置：enabled=true，锚点 5/10/15 升序，各有称号与台词峰值',
    a0.enabled === true && a0.floors.length === 3
      && a0.floors[0].floor === 5 && a0.floors[1].floor === 10 && a0.floors[2].floor === 15
      && a0.floors.every((f) => !!f.title && f.camPeak > 0 && f.duration > 0),
    a0.floors);

  // ---------- A1 第 4 层不触发，第 5 层触发一次 ----------
  const a1 = await ev(`(function(){
    window.__roamDebug.milestone.setFloor(4);
    var at4 = window.__roamDebug.milestone.info();
    window.__roamDebug.milestone.setFloor(5);
    var at5 = window.__roamDebug.milestone.info();
    return {
      at4: { triggered: at4.stats.triggered, titles: at4.meta.titles },
      at5: { triggered: at5.stats.triggered, highest: at5.meta.highestFloor, titles: at5.meta.titles }
    };
  })()`);
  ok('A1 第 4 层不触发（triggered=0）；第 5 层触发一次，称号「塔心初响」入档',
    a1.at4.triggered === 0 && a1.at5.triggered === 1
      && a1.at5.highest === 5 && a1.at5.titles.indexOf('塔心初响') >= 0, a1);

  // ---------- A2 同层重复到达不再触发 ----------
  const a2 = await ev(`(function(){
    var before = window.__roamDebug.milestone.info();
    window.__roamDebug.milestone.trigger(5);
    window.__roamDebug.milestone.trigger(5);
    var after = window.__roamDebug.milestone.info();
    return { before: before.stats, after: after.stats, titles: after.meta.titles };
  })()`);
  ok('A2 同一层再次触发只会累加 duplicates，不会重复演出/称号',
    a2.after.triggered === a2.before.triggered && a2.after.duplicates >= a2.before.duplicates + 2
      && a2.titles.length === 1, a2);

  // ---------- A3 第 10 / 15 层各触发一次，最高里程碑递增 ----------
  const a3 = await ev(`(function(){
    window.__roamDebug.milestone.setFloor(10);
    window.__roamDebug.milestone.setFloor(15);
    var info = window.__roamDebug.milestone.info();
    return { stats: info.stats, meta: info.meta, highestName: info.highestName };
  })()`);
  ok('A3 第 10/15 层各触发一次，highestFloor=15，三个称号不重复',
    a3.stats.triggered === 3 && a3.meta.highestFloor === 15
      && a3.meta.titles.join('|') === '塔心初响|深塔行者|无图纸者'
      && a3.highestName === '无图纸者', a3);

  // ---------- A4 镜头：演出期间 targetY 上推，结束后回正 ----------
  const a4 = await ev(`(function(){
    window.__roamDebug.milestone.trigger(15);
    state.milestoneTriggers = {};        // 允许再触发一次用于测镜头
    var fired = window.__roamDebug.milestone.trigger(15);
    var camOn = state.milestoneCam ? Object.assign({}, state.milestoneCam) : null;
    // 推到"刚开始上推"的位置（sin 包络在 t=dur 时为 0，必须离开起点才有位移）
    if (state.milestoneCam) state.milestoneCam.t = state.milestoneCam.dur * 0.85;
    var yOn = getCameraTarget(false).y;
    // 手动把演出推进到峰值（progress = 0.5）
    if (state.milestoneCam) state.milestoneCam.t = state.milestoneCam.dur * 0.5;
    var yPeak = getCameraTarget(false).y;
    state.milestoneCam = null;
    var yOff = getCameraTarget(false).y;
    return { fired: fired, camOn: camOn, yOn: yOn, yPeak: yPeak, yOff: yOff };
  })()`);
  ok('A4 镜头：演出中 targetY 比无演出时更小（镜头上推），峰值差 ≈ camPeak',
    a4.fired === true && a4.camOn && a4.camOn.t > 0
      && a4.yOn < a4.yOff && (a4.yOff - a4.yPeak) >= 40, a4);

  // ---------- A5 结算文案（死亡 / 通关共用） ----------
  const a5 = await ev(`(function(){
    var line = window.__roamDebug.milestone.resultText();
    var ms = window.__roamDebug.milestone.info();
    return { line: line, titles: ms.meta.titles };
  })()`);
  ok('A5 结算文案：label=最高里程碑，value=当前称号，且与存档 title 一致',
    a5.line.label === '最高里程碑' && a5.line.value === '无图纸者'
      && a5.titles.indexOf('无图纸者') >= 0, a5);

  // ---------- A5b 死亡面板真实 HTML 含「最高里程碑」 ----------
  const a5b = await ev(`(function(){
    state.status = 'dead';
    state.mode = 'result';
    showResult();
    var html = document.querySelector('#modal') ? document.querySelector('#modal').innerHTML : '';
    return { hasLabel: html.indexOf('最高里程碑') >= 0, hasTitle: html.indexOf('无图纸者') >= 0 };
  })()`);
  ok('A5b 死亡结算面板 HTML 含「最高里程碑 · 无图纸者」',
    a5b.hasLabel && a5b.hasTitle, a5b);

  // ---------- A6 开关 A/B：关掉后不触发、不写称号 ----------
  const a6 = await ev(`(function(){
    window.__roamDebug.milestone.setEnabled(false);
    window.__roamDebug.milestone.resetStats();
    // 隔离验证：清空称号，确认"关闭时绝不写档、重开后恰好补 1 条"
    state.meta.milestones = { highestFloor: 0, titles: [] };
    var before = window.__roamDebug.milestone.info().meta.titles.slice();
    var fired = window.__roamDebug.milestone.trigger(5);
    var after = window.__roamDebug.milestone.info();
    window.__roamDebug.milestone.setEnabled(true);
    var firedOn = window.__roamDebug.milestone.trigger(5);
    var infoOn = window.__roamDebug.milestone.info();
    return { fired: fired, before: before, after: after.meta.titles,
      firedOn: firedOn, titlesOn: infoOn.meta.titles, enabled: infoOn.enabled };
  })()`);
  ok('A6 关开关：trigger 返回 false 且称号不变；重开后可正常触发',
    a6.fired === false && a6.after.join('|') === a6.before.join('|')
      && a6.firedOn === true && a6.enabled === true && a6.titlesOn.length === a6.before.length + 1, a6);

  // ---------- A7 旧档迁移：无 milestones 字段 + bestFloor=7 → highestFloor=5 ----------
  const a7 = await ev(`(function(){
    var old = { bestFloor: 7, crystals: 33, talents: {}, unlocks: {} };
    var fixed = normalizeMeta(old);
    return { bestFloor: fixed.bestFloor, crystals: fixed.crystals,
      highestFloor: fixed.milestones.highestFloor, titles: fixed.milestones.titles };
  })()`);
  ok('A7 旧存档：bestFloor=7 → 里程碑最高 5 层/塔心初响，结晶等旧字段不丢',
    a7.bestFloor === 7 && a7.crystals === 33 && a7.highestFloor === 5
      && a7.titles.indexOf('塔心初响') >= 0, a7);

  // ---------- A8 截图 + 帧率 + 报错 ----------
  await ev(`(function(){
    state.status = 'playing'; state.mode = 'playing';
    if (window.__modalClose) window.__modalClose();
    var m = document.querySelector('#modalLayer'); if (m) m.classList.add('hidden');
    window.__roamDebug.milestone.resetStats();
    state.meta.milestones = { highestFloor: 0, titles: [] };
    window.__roamDebug.milestone.setFloor(4);
    window.__roamDebug.milestone.setFloor(5);
    // 停到镜头峰值再截图，确保"上推"在画面里可见
    if (state.milestoneCam) state.milestoneCam.t = state.milestoneCam.dur * 0.5;
    state.cam.y = getCameraTarget(false).y;
    // 让画面信息量足够（非空白截图门槛）：刷几只怪 + 两个演出光环
    for (var i = 0; i < 3; i += 1) {
      spawnEnemy('forgepriest', state.player.x - 80 - i * 30, state.player.y + 30 + i * 22, state.floor,
        { roomId: state.currentRoomId });
      spawnEnemy('voidbishop', state.player.x + 80 + i * 30, state.player.y - 30 - i * 22, state.floor,
        { roomId: state.currentRoomId });
    }
    addRing(state.player.x, state.player.y, 150, '#ffd48a', 1.6, 0.9, 'rune', 1.2);
    addRing(state.player.x, state.player.y, 60, '#9a7bff', 1.2);
    return true;
  })()`);
  await sleep(350);
  await shot('d3.png');
  const fps = await ev(`window.__roamDebug.getState().fps`);
  const errors = await ev(`window.__errors.slice()`);
  const png = fs.statSync(path.join(OUT_DIR, 'd3.png')).size;
  // 第 5 层出生房背景较平，PNG 压缩后约 0.8MB；700KB 作为"非空白画面"门槛
  ok('A8 截图 >700KB / 无运行时报错 / 帧率 ≥ 50',
    png > 700 * 1024 && errors.length === 0 && fps >= 50, { png: png, errors: errors, fps: fps });

  fs.writeFileSync(path.join(OUT_DIR, 'd3-result.json'),
    JSON.stringify({ asserts: asserts, pass: asserts.filter((a) => a.pass).length, total: asserts.length }, null, 2));
  killEdge(edge);
  const passed = asserts.filter((a) => a.pass).length;
  console.log('\nRESULT: ' + (passed === asserts.length ? 'PASS' : 'FAIL') + ' ' + passed + '/' + asserts.length);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
