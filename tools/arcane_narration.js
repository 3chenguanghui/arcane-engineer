// 第 7 轮 · 第 3 组验收：轻量叙事层（主题进层 / 首领战前 / 蓝图装配后一句）
// 断言：条目数与主题、首领数一致且都在 12–20 字；可整体关闭；不抢焦点、不阻塞；
//      进同一主题只播一次；暂停时让位而不是丢弃。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9553;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'narration');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const runtimeErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(m.params && m.params.exceptionDetails
        ? (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text
        : 'unknown');
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);
  await ev(`(() => { window.__roamDebug.xp.setEnabled(false); return true; })()`);

  /* ================= 1) 配置：条目数 / 长度 / 键覆盖 ================= */
  const cfg = await ev('__roamDebug.narration.config()');
  const themeIds = await ev('Object.keys(THEME_CONFIG.themes)');
  const bossIds = await ev('BOSS_CONFIG.kinds.map((k) => k.id)');
  const themeKeys = Object.keys(cfg.theme || {});
  const bossKeys = Object.keys(cfg.boss || {});
  const themeCover = themeIds.every((id) => themeKeys.includes(id)) && themeKeys.length === themeIds.length;
  const bossCover = bossIds.every((id) => bossKeys.includes(id)) && bossKeys.length === bossIds.length;
  check('主题字幕条目数与主题数一致（3 条，键全覆盖）', themeCover, { themeIds, themeKeys });
  check('首领字幕条目数与首领数一致（3 条，键全覆盖）', bossCover, { bossIds, bossKeys });
  const allLines = themeKeys.map((k) => cfg.theme[k]).concat(bossKeys.map((k) => cfg.boss[k]),
    [typeof cfg.blueprint === 'string' ? cfg.blueprint : '']);
  const lenRows = allLines.map((t) => ({ t, n: Array.from(t).length }));
  const lenOk = lenRows.every((r) => r.n >= 12 && r.n <= 20);
  check('全部 7 条字幕长度都在 12–20 字（含标点）', lenOk && allLines.length === 7, lenRows);
  check('蓝图装配后文案存在且为非空字符串',
    typeof cfg.blueprint === 'string' && cfg.blueprint.length >= 12, { blueprint: cfg.blueprint });
  check('总开关默认开启、停留时长 ≤3s（不占屏）',
    cfg.enabled === true && cfg.dwell <= 3, { enabled: cfg.enabled, dwell: cfg.dwell });

  /* ================= 2) 整体关闭：不再出现 ================= */
  await ev('__roamDebug.narration.clear()');
  const offPush = await ev(`(() => {
    __roamDebug.narration.setEnabled(false);
    const r = __roamDebug.narration.push('theme', 'mech');
    const info = __roamDebug.narration.info();
    return { push: r, info };
  })()`);
  check('关闭总开关后 push 返回 null，且队列 / 当前条都被清空',
    offPush.push === null && offPush.info.enabled === false
      && offPush.info.current === null && offPush.info.queue.length === 0, offPush);
  const offShow = await ev(`(() => {
    const r = __roamDebug.narration.show('theme', 'mech');
    return { show: r, current: __roamDebug.narration.info().current };
  })()`);
  check('关闭后即使强制显示也不会出现',
    offShow.show === null && offShow.current === null, offShow);
  await ev('__roamDebug.narration.setEnabled(true)');

  /* ================= 3) 进同一主题只播一次 ================= */
  const themeOnce = await ev(`(() => {
    __roamDebug.narration.clear();
    __roamDebug.narration.resetShown();
    const first = narrateOnce('theme', 'mech');
    const second = narrateOnce('theme', 'mech');
    return { first, second, shown: __roamDebug.narration.info().shown };
  })()`);
  check('同一主题第二次进入不再重复播报',
    typeof themeOnce.first === 'string' && themeOnce.second === null
      && themeOnce.shown.includes('theme:mech'), themeOnce);
  // 走真实换层：F1(机械) → F2(符文) → F3(虚空) → F4(机械，重复)
  const floorThemes = [];
  for (const n of [1, 2, 3, 4]) {
    await ev(`__roamDebug.enemies.floor(${n})`);
    await sleep(90);
    const info = await ev('__roamDebug.narration.info()');
    floorThemes.push({ floor: n, shown: info.shown.filter((k) => k.indexOf('theme:') === 0) });
  }
  const lastShown = floorThemes[floorThemes.length - 1].shown;
  check('真实换层：三个主题各播一次，第四层回到机械不重复',
    lastShown.length === 3 && lastShown.includes('theme:mech')
      && lastShown.includes('theme:rune') && lastShown.includes('theme:void'),
    { lastShown, floors: floorThemes });

  /* ================= 4) 首领战前一句 ================= */
  const bossLine = await ev(`(() => {
    __roamDebug.narration.clear();
    __roamDebug.enemies.floor(6);
    const text = narrate('boss', 'void');
    return { text, expect: NARRATION_CONFIG.boss.void };
  })()`);
  await sleep(320);
  const bossState = await ev('__roamDebug.narration.info()');
  check('首领字幕与配置一致，并能进入当前显示位',
    bossLine.text === bossLine.expect && bossState.current === bossLine.expect
      && bossState.currentKind === 'boss', { bossLine, bossState });

  /* ================= 5) 蓝图装配后一句 ================= */
  const bpLine = await ev(`(() => {
    __roamDebug.narration.clear();
    __roamDebug.narration.resetShown();
    const a = narrateOnce('blueprint', 'default');
    const b = narrateOnce('blueprint', 'default');
    return { a, b, expect: NARRATION_CONFIG.blueprint };
  })()`);
  check('蓝图字幕只在装配成功时播一次（重复装配不重复刷屏）',
    bpLine.a === bpLine.expect && bpLine.b === null, bpLine);

  /* ================= 6) 不抢焦点 / 不阻塞 ================= */
  const focusProbe = await ev(`(() => {
    __roamDebug.narration.clear();
    const before = document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none';
    const noDom = document.querySelectorAll('[data-narration], #narration, .narration').length === 0;
    const shown = __roamDebug.narration.show('theme', 'rune');
    const after = document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none';
    return { before, after, noDom, shown };
  })()`);
  check('字幕不新增任何 DOM 节点、不改变 activeElement（结构上不可能抢焦点）',
    focusProbe.after === focusProbe.before && focusProbe.noDom === true
      && typeof focusProbe.shown === 'string', focusProbe);
  // 暂停时让位：先清空，再把 mode 改成 paused，push 之后 400ms 内不应占屏
  const cfgVoid = (await ev('__roamDebug.narration.config()')).theme.void;
  const pauseProbe = await ev(`(() => {
    __roamDebug.narration.clear();
    __roamDebug.narration.push('theme', 'void');
    state.mode = 'paused';
    return { queue: __roamDebug.narration.info().queue.length, blocked: narrationBlocked() };
  })()`);
  await sleep(420);
  const pausedInfo = await ev('__roamDebug.narration.info()');
  await ev(`(() => { state.mode = 'playing'; return state.mode; })()`);
  await sleep(320);
  const resumedInfo = await ev('__roamDebug.narration.info()');
  check('暂停 / 弹窗期间让位：不占屏但保留队列，恢复后自动接上并显示虚空字幕',
    pauseProbe.blocked === true && pausedInfo.current === null && pausedInfo.queue.length === 1
      && resumedInfo.current === cfgVoid, { pauseProbe, pausedInfo, resumed: resumedInfo.current });

  /* ================= 7) 截图：关闭态 / 显示态 ================= */
  await ev(`(() => {
    __roamDebug.enemies.floor(8);
    __roamDebug.narration.setEnabled(false);
    __roamDebug.narration.clear();
    return true;
  })()`);
  await sleep(420);
  await shot('narr_before_off.png');
  await ev(`(() => {
    __roamDebug.narration.setEnabled(true);
    __roamDebug.narration.show('theme', 'rune');
    return true;
  })()`);
  await sleep(320);
  await shot('narr_after_theme_line.png');

  /* ================= 汇总 ================= */
  check('运行期无 JS 异常', runtimeErrors.length === 0, runtimeErrors.slice(0, 3));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${passed}/${results.length} PASS`);
  console.log('FUNCTION: ' + (passed === results.length ? 'PASS' : 'FAIL'));
  console.log('VERDICT: ' + (passed === results.length ? 'PASS' : 'FAIL'));
  fs.writeFileSync(path.join(__dirname, '..', 'NARRATION_RESULT.json'),
    JSON.stringify({ results, runtimeErrors }, null, 2));
  killEdge(EDGE_PROC);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err && err.stack ? err.stack : err);
  if (EDGE_PROC) killEdge(EDGE_PROC);
  process.exit(2);
});
