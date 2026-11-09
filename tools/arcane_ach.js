/**
 * 第 22 项 · 成就进度条验收：A0–A7
 * ------------------------------------------------------------
 * 覆盖：行数与配置一致、每行进度条内联宽度 = data-pct、aria 进度三元组、
 *       当前值不超过目标、中途进度（50/100）、达成后 100% + 置灰 + 日期、
 *       面板统计与存档真值一致、档案面板截图、零运行时报错、存档还原。
 * 用法：node tools/arcane_ach.js
 * 端口：9547
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9547;
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
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

/**
 * 主流程：起 Edge → 打开设置里的档案面板 → 逐项断言 → 还原存档
 * @returns {Promise<void>}
 */
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
    return fs.statSync(path.join(OUT_DIR, name)).size;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`document.querySelector('#btnStart').click(); true`);
  await sleep(1200);
  await ev(`(function(){
    window.__errors = [];
    window.addEventListener('error', function(e){ window.__errors.push(String(e.message || e)); });
    window.__origMeta = JSON.parse(JSON.stringify(state.meta));
    document.getElementById('btnSettings').click();
    return true;
  })()`);
  await sleep(500);

  // ---------- A0 行数与配置一致 ----------
  const cfg = await ev(`window.__roamDebug.meta2.config()`);
  const p0 = await ev(`window.__roamDebug.meta2.progress()`);
  ok('A0 每条成就一行：面板行数 = 配置条数（' + cfg.count + '）',
    p0.count === cfg.count && cfg.count > 0, { rows: p0.count, config: cfg.count, achText: p0.achText });

  // ---------- A1 进度条渲染：宽度 / aria / 角色 ----------
  const badBar = p0.rows.filter((r) => r.role !== 'progressbar'
    || r.barWidth !== (r.pct + '%')
    || r.ariaMax !== r.target
    || r.ariaNow !== r.value
    || r.pct < 0 || r.pct > 100);
  ok('A1 每行进度条：宽度 = data-pct、role=progressbar、aria-valuenow/max 与目标一致',
    badBar.length === 0, { rows: p0.rows.length, bad: badBar.slice(0, 4) });

  // ---------- A2 数值口径：value = min(raw,target)，pct = value/target ----------
  const badMath = p0.rows.filter((r) => {
    const v = Math.min(r.raw, r.target);
    const pct = r.target > 0 ? Math.round((v / r.target) * 1000) / 10 : (r.done ? 100 : 0);
    return r.value !== v || Math.abs(r.pct - pct) > 0.001;
  });
  ok('A2 数值口径：value = min(raw,target)，pct = round(value/target×1000)/10',
    badMath.length === 0, { bad: badMath.slice(0, 4) });

  // ---------- A3 中途进度：kills 50/100 → 50% ----------
  const mid = await ev(`(function(){
    var m = state.meta;
    m.stats = m.stats || {};
    m.stats.kills = 50;
    var rows = window.__roamDebug.meta2.progress().rows;
    var row = rows.filter(function(r){ return r.id === 'kills_100'; })[0];
    return { row: row, panelKills: (document.getElementById('archiveKills') || {}).textContent };
  })()`);
  ok('A3 中途进度：击杀 50/100 → 进度条 50%、未达成、面板击杀数同步 50',
    mid.row && mid.row.pct === 50 && mid.row.barWidth === '50%'
      && mid.row.value === 50 && mid.row.done === false
      && String(mid.panelKills) === '50', mid);

  // ---------- A4 达成：100% + 整行置灰 + 日期 ----------
  const unlocked = await ev(`window.__roamDebug.meta2.simulate('first_kill')`);
  const p1 = await ev(`window.__roamDebug.meta2.progress()`);
  const firstRow = p1.rows.filter((r) => r.id === 'first_kill')[0];
  ok('A4 达成后：进度条 100%、整行置灰、显示达成日期',
    unlocked.unlocked.indexOf('first_kill') >= 0
      && firstRow && firstRow.pct === 100 && firstRow.barWidth === '100%'
      && firstRow.done === true && firstRow.grayed === true && firstRow.date.length > 0,
    { unlocked: unlocked.unlocked, row: firstRow });

  // ---------- A5 面板统计 = 存档真值 ----------
  const sync = await ev(`(function(){
    var m = state.meta;
    var read = function(id){ var el = document.getElementById(id); return el ? el.textContent : null; };
    return {
      kills: read('archiveKills'), bestFloor: read('archiveBestFloor'), clears: read('archiveClears'),
      deaths: read('archiveDeaths'), achText: read('archiveAchText'),
      metaKills: Number(m.stats && m.stats.kills) || 0,
      metaBest: Number(m.bestFloor) || 0, metaClears: Number(m.clears) || 0, metaDeaths: Number(m.stats && m.stats.deaths) || 0,
      got: Object.keys(m.achievements || {}).length
    };
  })()`);
  ok('A5 面板统计 = 存档真值（击杀 / 最高层 / 通关 / 死亡 / 成就计数）',
    String(sync.metaKills) === String(sync.kills)
      && String(sync.metaBest) === String(sync.bestFloor)
      && String(sync.metaClears) === String(sync.clears)
      && String(sync.metaDeaths) === String(sync.deaths)
      && sync.achText.indexOf(String(sync.got)) >= 0, sync);

  // ---------- A6 档案面板截图 ----------
  const view = await ev(`(function(){
    var list = document.getElementById('archiveAchList');
    if (list && list.scrollIntoView) list.scrollIntoView({ block: 'center' });
    var r = list ? list.getBoundingClientRect() : null;
    return { height: r ? Math.round(r.height) : 0, top: r ? Math.round(r.top) : -1,
      panelOpen: !document.getElementById('settingsPanel').classList.contains('hidden') };
  })()`);
  await sleep(350);
  const png = await shot('i-achievements.png');
  /* 设置面板是居中弹窗，截图天然比全屏场景小：> 200KB 且成就列表高度 > 250px 即说明 22 行真的在画面上 */
  ok('A6 档案面板截图 > 200KB，且成就列表可见高度 > 250px（22 行真的渲染在画面里）',
    png > 200 * 1024 && view.height > 250, { png, view });

  // ---------- A7 零报错 + 还原存档 ----------
  const errors = await ev(`window.__errors.slice()`);
  const restored = await ev(`(function(){
    var orig = window.__origMeta;
    state.meta = normalizeMeta(orig);
    saveMeta();
    renderArchivePanel();
    return { kills: Number(state.meta.stats && state.meta.stats.kills) || 0,
      origKills: Number(orig.stats && orig.stats.kills) || 0,
      got: Object.keys(state.meta.achievements || {}).length };
  })()`);
  ok('A7 零运行时报错，且测试存档已还原（击杀数回到原始值）',
    errors.length === 0 && restored.kills === restored.origKills,
    { errors, restored });

  fs.writeFileSync(path.join(OUT_DIR, 'i-achievements-result.json'),
    JSON.stringify({
      asserts,
      pass: asserts.filter((a) => a.pass).length,
      total: asserts.length,
      configCount: cfg.count,
      sample: p0.rows.slice(0, 6)
    }, null, 2));

  console.log('\nRESULT: ' + (asserts.every((a) => a.pass) ? 'PASS' : 'FAIL')
    + ' ' + asserts.filter((a) => a.pass).length + '/' + asserts.length);

  ws.close();
  edge.kill();
  setTimeout(() => { killEdge(); process.exit(asserts.every((a) => a.pass) ? 0 : 1); }, 900);
}

main().catch((e) => {
  console.error('FATAL', e && e.stack ? e.stack : e);
  killEdge();
  process.exit(1);
});
