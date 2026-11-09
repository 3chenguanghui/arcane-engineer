// 第 4 轮 · 第 4 组：说明页完整性 + 单文件"全新目录 / 无缓存"启动
//   A. 说明页：按键表 == 真实绑定（双向比对、不手写期望值）、融合 13 条 + 首领蓝图、
//      难度三档及其真实倍率、前五层速查（内容取自 ONBOARD_STEPS）
//   B. 打包：把 index_arcane_v2.html 复制到一个全新目录 + 全新 profile（零缓存）双击即开
//
// 运行：node tools/arcane_help.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');
const { summarize } = require('./test_known_red');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// 允许用命令行参数指定被测文件（冻结期只在主文件副本上验证，绝不动主文件）
const SRC = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html'));
const OUT = path.join(__dirname, '..', '.screenshots', 'help');
const RESULTS = path.join(OUT, 'help-results.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动一个无头 Edge 并接上 CDP
 * @param {string} filePath 要打开的 HTML 绝对路径（走 file://）
 * @param {string} profileDir 独立 profile 目录（决定"有没有缓存"）
 * @param {number} port 调试端口
 * @param {number} width 视口宽
 * @param {number} height 视口高
 * @returns {Promise<Object>} { send, ev, shot, errors, edge, closed }
 */
async function launch(filePath, profileDir, port, width, height) {
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', `--window-size=${width},${height}`, 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('CDP target 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev2) => {
    const m = JSON.parse(ev2.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    // 页面运行时异常 / console.error 全部记账（"全新目录启动不得报错"要用）
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + (m.params.exceptionDetails.exception
        ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: width, height: height, deviceScaleFactor: 1, mobile: false
  });
  const url = 'file:///' + filePath.replace(/\\/g, '/');
  await send('Page.navigate', { url: url });
  await sleep(2600);

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const clickAt = async (selector) => {
    const p = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!p) return false;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    return true;
  };
  const key = async (k, code) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || k, windowsVirtualKeyCode: 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || k, windowsVirtualKeyCode: 0 });
  };
  return { send, ev, shot, clickAt, key, errors, edge };
}

/**
 * 结束指定 Edge 进程树（自定义 profile 目录的版本，本脚本 packaging 阶段要用）
 * @param {import('child_process').ChildProcess} edge 进程
 * @returns {void}
 */
function killTree(edge) {
  if (!edge) return;
  try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { assertions: [], notes: {}, errors: [] };
  const check = (name, ok, detail) => report.assertions.push({ name: name, ok: !!ok, detail: detail });

  // ================= A. 说明页完整性 =================
  const profile = prepareProfile();
  const app = await launch(SRC, profile, 9758, 1440, 900);

  // 进游戏（说明页在暂停态打开；标题页不响应 H）
  await app.ev('__roamDebug.onboard.reset(true)');
  await app.clickAt('#btnStart');
  await sleep(1500);
  // 用真实键盘事件开帮助页（验证 H 键这条绑定）
  await app.key('h', 'KeyH');
  await sleep(500);
  const opened = await app.ev(`(() => ({ mode: state.mode, tab: state.helpTab,
    pane: (document.querySelector('[data-help-pane].is-on') || {}).getAttribute
      ? document.querySelector('[data-help-pane].is-on').getAttribute('data-help-pane') : null }))()`);
  check('H0 按 H 真的打开帮助面板（mode=rules，默认操作页签）',
    opened.mode === 'rules' && opened.pane === 'ops', opened);

  // ---- 页签切换（真实点击页签按钮，而不是只调函数） ----
  await app.clickAt('[data-help-tab="fusion"]');
  await sleep(250);
  const tabFusion = await app.ev(`(() => ({ tab: state.helpTab,
    on: Array.from(document.querySelectorAll('[data-help-pane].is-on')).map((p) => p.getAttribute('data-help-pane')) }))()`);
  await app.shot('help-fusion.png');
  await app.clickAt('[data-help-tab="rules"]');
  await sleep(250);
  const tabRules = await app.ev(`(() => ({ tab: state.helpTab,
    on: Array.from(document.querySelectorAll('[data-help-pane].is-on')).map((p) => p.getAttribute('data-help-pane')) }))()`);
  await app.shot('help-rules.png');
  check('H1 三个页签可点击切换，且同一时刻只有一个页签可见',
    tabFusion.tab === 'fusion' && tabFusion.on.length === 1 && tabFusion.on[0] === 'fusion'
    && tabRules.tab === 'rules' && tabRules.on.length === 1 && tabRules.on[0] === 'rules',
    { fusion: tabFusion, rules: tabRules });

  // ---- 条目数 vs 配置真实数量 ----
  const page = await app.ev(`(() => {
    const fusionPane = document.querySelector('[data-help-pane="fusion"]');
    const bpCard = document.querySelector('[data-help-card="blueprint"]');
    const quick = Array.from(document.querySelectorAll('[data-quickref-step]'));
    const rulesText = (document.querySelector('[data-help-pane="rules"]') || {}).textContent || '';
    return {
      fusionRows: document.querySelectorAll('[data-fusion-id]').length,
      fusionCfg: FUSION_CONFIG.length,
      fusionHeading: (fusionPane.querySelector('.help-card h3') || {}).textContent || '',
      bpRows: document.querySelectorAll('[data-blueprint-id]').length,
      bpCfg: BOSS_BLUEPRINT_CONFIG.blueprints.length,
      bpHeading: bpCard ? (bpCard.querySelector('h3') || {}).textContent || '' : '',
      quickRows: quick.map((li) => Number(li.getAttribute('data-quickref-step'))),
      quickText: quick.map((li) => li.textContent),
      quickCfg: ONBOARD_STEPS.map((s) => ({ n: s.n, verb: s.verb, hint: s.hint })),
      keyRows: HELP_KEYS.length,
      keyTable: HELP_KEYS.map((r) => ({ keys: r.keys, desc: r.desc })),
      rulesText: rulesText,
      diffCfg: {
        easy: DIFFICULTY_CONFIG.modes.easy, normal: DIFFICULTY_CONFIG.modes.normal,
        nightmare: DIFFICULTY_CONFIG.modes.nightmare
      },
      talentMax: GAME_CONFIG.talentMaxLevel,
      tabs: HELP_TABS.slice()
    };
  })()`);
  report.notes.page = {
    fusionRows: page.fusionRows, fusionCfg: page.fusionCfg, bpRows: page.bpRows, bpCfg: page.bpCfg,
    quickRows: page.quickRows, keyRows: page.keyRows
  };

  check('H2 融合配方条目数 == FUSION_CONFIG 真实条数（13 条，标题数字同步）',
    page.fusionRows === page.fusionCfg && page.fusionCfg === 13
    && page.fusionHeading.indexOf(String(page.fusionCfg)) >= 0,
    { rows: page.fusionRows, cfg: page.fusionCfg, heading: page.fusionHeading.trim() });
  check('H3 首领蓝图条目数 == BOSS_BLUEPRINT_CONFIG 真实条数（标题数字同步）',
    page.bpRows === page.bpCfg && page.bpCfg > 0
    && page.bpHeading.indexOf(String(page.bpCfg)) >= 0,
    { rows: page.bpRows, cfg: page.bpCfg, heading: page.bpHeading.trim() });
  check('H4 首局事件速查 == ONBOARD_STEPS（5 条，序号 1–5，文案一致）',
    page.quickRows.length === page.quickCfg.length && page.quickRows.length === 5
    && page.quickCfg.every((s, i) => page.quickRows[i] === s.n
      && page.quickText[i].indexOf(s.hint) >= 0 && page.quickText[i].indexOf(s.verb) >= 0),
    { rows: page.quickRows, cfg: page.quickCfg });
  check('H5 难度三档说明齐全，且倍率数字与 DIFFICULTY_CONFIG 一致',
    ['简单', '普通', '困难'].every((t) => page.rulesText.indexOf(t) >= 0)
    && ['easy', 'normal', 'nightmare'].every((id) => page.rulesText.indexOf(String(page.diffCfg[id].hpMul)) >= 0
      && page.rulesText.indexOf(String(page.diffCfg[id].countMul)) >= 0),
    page.diffCfg);

  // ---- 按键表 vs 真实绑定（双向，不写死期望 action） ----
  const keys = await app.ev(`(() => {
    /* 把 HELP_KEYS 的"展示文案"解析成键名集合：不是手写期望表，而是从真实帮助文案反解 */
    const parse = (text) => {
      let t = String(text);
      const out = [];
      const push = (arr) => arr.forEach((k) => { if (out.indexOf(k) < 0) out.push(k); });
      if (/WASD/i.test(t)) { push(['w', 'a', 's', 'd']); t = t.replace(/WASD/i, ' '); }
      if (/方向键/.test(t)) { push(['arrowup', 'arrowdown', 'arrowleft', 'arrowright']); t = t.replace(/方向键/g, ' '); }
      t = t.replace(/鼠标/g, ' ');
      t = t.replace(/左键/g, ' ');
      t = t.replace(/右键/g, ' ');
      if (/Tab/i.test(t)) { push(['tab']); t = t.replace(/Tab/i, ' '); }
      if (/Shift/i.test(t)) { push(['shift']); t = t.replace(/Shift/i, ' '); }
      if (/Enter/i.test(t)) { push(['enter']); t = t.replace(/Enter/i, ' '); }
      if (/Esc/i.test(t)) { push(['escape']); t = t.replace(/Esc/i, ' '); }
      if (/空格/.test(t)) { push([' ']); t = t.replace(/空格/g, ' '); }
      if (/1[–-]6/.test(t)) { push(['1', '2', '3', '4', '5', '6']); t = t.replace(/1[–-]6/g, ' '); }
      (t.match(/[A-Za-z]/g) || []).forEach((ch) => push([ch.toLowerCase()]));
      return out;
    };
    const documented = [];
    HELP_KEYS.forEach((row) => parse(row.keys).forEach((k) => { if (documented.indexOf(k) < 0) documented.push(k); }));
    const candidates = [];
    for (let i = 0; i < 26; i += 1) candidates.push(String.fromCharCode(97 + i));
    for (let i = 0; i <= 9; i += 1) candidates.push(String(i));
    [' ', 'tab', 'shift', 'escape', 'enter', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']
      .forEach((k) => candidates.push(k));
    const act = (k) => keyToAction({ key: k });
    const bound = candidates.filter((k) => { const a = act(k); return !!a; });
    const undocumented = bound.filter((k) => documented.indexOf(k) < 0);
    const unbound = documented.filter((k) => !act(k));
    return { documented: documented, bound: bound, undocumented: undocumented, unbound: unbound,
      table: HELP_KEYS.map((r) => r.keys),
      actions: documented.map((k) => ({ key: k, action: act(k) })) };
  })()`);
  report.notes.keys = keys;
  check('H6 按键表 → 真实绑定：文档里写到的每个键都真的有动作（无僵尸键）',
    keys.unbound.length === 0 && keys.documented.length >= 20, { unbound: keys.unbound, n: keys.documented.length });
  check('H7 真实绑定 → 按键表：每个能触发的键都被文档覆盖（无隐藏键）',
    keys.undocumented.length === 0, { undocumented: keys.undocumented });
  check('H8 关键四键 M/N/T/H 在表里且绑定正确（地图/静音/技能树/帮助）',
    (() => {
      const want = { m: 'map', n: 'mute', t: 'skilltree', h: 'rules' };
      const table = page.keyTable.map((r) => r.keys.toUpperCase()).join(' | ');
      return Object.keys(want).every((k) => table.indexOf(k.toUpperCase()) >= 0)
        && Object.keys(want).every((k) => keys.actions.some((a) => a.key === k && a.action === want[k]));
    })(), keys.actions.filter((a) => 'mnth'.indexOf(a.key) >= 0));

  // ---- 面板能关 ----
  await app.key('Escape', 'Escape');
  await sleep(300);
  const closed = await app.ev(`(() => ({ mode: state.mode, status: state.status }))()`);
  check('H9 Esc 能关掉说明页并回到战斗（不是卡在面板里）',
    closed.mode === 'playing', closed);

  report.errors = report.errors.concat(app.errors);
  killTree(app.edge);
  await sleep(600);

  // ================= B. 单文件 · 全新目录 · 零缓存 =================
  const html = fs.readFileSync(SRC, 'utf8');
  const extRefs = {
    scriptSrc: /<script[^>]+src=/i.test(html),
    linkHref: /<link[^>]+href=/i.test(html),
    cssImport: /@import/i.test(html),
    remoteUrl: /src\s*=\s*["']https?:/i.test(html)
  };
  const freshDir = path.join(path.dirname(SRC), '.packtest_' + Date.now());
  fs.mkdirSync(freshDir, { recursive: true });
  const freshFile = path.join(freshDir, 'index_arcane_v2.html');
  fs.copyFileSync(SRC, freshFile);
  const stat = fs.statSync(freshFile);

  check('H10 交付物是自包含单文件（无外链 script/link/@import/远程 src）',
    !extRefs.scriptSrc && !extRefs.linkHref && !extRefs.cssImport && !extRefs.remoteUrl,
    extRefs);
  check('H11 单文件尺寸合理（>1MB 且 <8MB，全部资源内联）',
    stat.size > 1024 * 1024 && stat.size < 8 * 1024 * 1024,
    { bytes: stat.size, mb: +(stat.size / 1048576).toFixed(2) });

  const freshApp = await launch(freshFile, path.join(freshDir, 'profile'), 9759, 1440, 900);
  const bootInfo = await freshApp.ev(`(() => {
    const c = document.getElementById('game');
    return { mode: state.mode, floor: state.floor, difficulty: state.difficulty,
      canvas: { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight },
      diffBtns: document.querySelectorAll('[data-difficulty]').length,
      startBtn: !!document.getElementById('btnStart'),
      resources: performance.getEntriesByType('resource').length,
      storageKeys: (() => { try { return Object.keys(window.localStorage); } catch (e) { return ['blocked']; } })(),
      titleVisible: !!(document.getElementById('screenTitle') || {}).className
        ? !document.getElementById('screenTitle').classList.contains('hidden') : true };
  })()`);
  await freshApp.shot('fresh-title.png');
  check('H12 全新目录 + 全新 profile：双击即开到标题页（无缓存依赖）',
    bootInfo.mode === 'title' && bootInfo.startBtn && bootInfo.diffBtns === 3,
    bootInfo);
  check('H13 全新目录启动画面真实可用（canvas 有像素尺寸 + 无外部网络请求）',
    bootInfo.canvas.w > 100 && bootInfo.canvas.h > 100
    && bootInfo.canvas.cssW > 100 && bootInfo.resources === 0,
    { canvas: bootInfo.canvas, resources: bootInfo.resources });
  check('H14 全新 profile 首次启动零运行时错误',
    freshApp.errors.length === 0, freshApp.errors.slice(0, 5));

  // 全新目录里再走一次"点开始"，证明不是只能看标题
  const freshStart = await freshApp.ev(`(() => { const ok = (typeof __roamDebug !== 'undefined');
    return { debugReady: ok }; })()`);
  await freshApp.clickAt('#btnStart');
  await sleep(1600);
  const freshPlaying = await freshApp.ev(`(() => ({ mode: state.mode, floor: state.floor,
    rooms: state.rooms.length, hp: Math.round(state.player.hp), hpMax: state.player.hpMax }))()`);
  check('H15 全新目录里点"开始"能真的进第 1 层（不是只有标题壳）',
    freshStart.debugReady && freshPlaying.mode === 'playing' && freshPlaying.floor === 1
    && freshPlaying.rooms >= 4 && freshPlaying.hp === freshPlaying.hpMax, freshPlaying);

  report.notes.fresh = { dir: freshDir, bytes: stat.size, boot: bootInfo, errors: freshApp.errors };

  // 清理：删掉临时"全新目录"（含 profile），避免留下测试垃圾
  killTree(freshApp.edge);
  await sleep(600);
  try { fs.rmSync(freshDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* 稍后 cleanup 脚本兜底 */ }

  report.errors = report.errors.concat(freshApp.errors);

  // ================= 汇总 =================
  fs.writeFileSync(RESULTS, JSON.stringify(report, null, 2));
  console.log('\n===== 断言 =====');
  report.assertions.forEach((a) => console.log((a.ok ? 'PASS  ' : 'FAIL  ') + a.name + '  '
    + JSON.stringify(a.detail)));
  const s = summarize(report.assertions, '说明页');
  console.log(`\nVERDICT: ${s.exitCode === 0 ? 'PASS' : (s.exitCode === 2 ? 'BLOCKED(新增已知红未批准)' : 'FAIL')}`);
  process.exitCode = s.exitCode;
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
