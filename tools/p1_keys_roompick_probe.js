/**
 * 欠账 3 真机取证：数字键 1–6 切技能 + 传送选房（原"双击两扇门"的等价路径）
 * ----------------------------------------------------------------------------
 * 背景：
 *   - 数字键 1–6 → selectMagic(MAGIC_CONFIG[i])，此前只做过代码核对；
 *   - "连点两扇门"：主文件 64914 行注释已写明"传送结构：门已不存在，
 *     删掉 tryDoorEntryInteract"，门对象在本版本已下线，等价交互是
 *     房间选房浮层（Q 打开 / 数字键 1–3 选房）。所以这条欠账不是"没测"，
 *     而是"被测对象没了"，本探针验证替代路径。
 *
 * 口径：真机 CDP 输入（Input.dispatchKeyEvent），不是 page.click()。
 * 产物：.screenshots/p0/p1-keys.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9614;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'p0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asserts = [];

/**
 * 记录断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails).slice(0, 200));
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  /**
   * 真机按下并松开一个键（带正确 key/code/vk，走页面 keydown 监听）
   * @param {string} key 字符（'1'..'6' / 'q'）
   * @param {string} code 物理键码（Digit1 / KeyQ）
   * @param {number} vk Windows 虚拟键码
   * @returns {Promise<void>}
   */
  const press = async (key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(60);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(120);
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  // 开局：真实点击（难度 → 开始 → 选角 → 确认）
  const clickAt = async (selector) => {
    const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!box) return;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  await ev(`__roamDebug.onboard.reset(true)`);
  await clickAt('[data-difficulty="normal"]');
  await sleep(150);
  await clickAt('#btnStart');
  await sleep(700);
  const firstChar = await ev(`(() => { const c = document.querySelector('#charGrid .char-card');
    return c ? c.getAttribute('data-char-id') : null; })()`);
  if (firstChar) { await clickAt(`#charGrid .char-card[data-char-id="${firstChar}"]`); await sleep(200); await clickAt('#btnCharConfirm'); }
  await sleep(1400);

  // 探针特权：先解锁全部魔法（否则 1–6 只会弹"尚未解锁"）
  const unlocked = await ev(`(() => {
    state.ownedMagic = MAGIC_CONFIG.map((m) => m.id);
    applyMetaStats(state, false);
    return { owned: state.ownedMagic.slice(), active: state.activeMagicId,
             count: MAGIC_CONFIG.length };
  })()`);

  const keyRows = [];
  for (let i = 1; i <= 6; i += 1) {
    if (i > unlocked.count) break;
    await press(String(i), 'Digit' + i, 48 + i);
    const row = await ev(`(() => ({
      key: ${i},
      expect: MAGIC_CONFIG[${i - 1}].id,
      active: state.activeMagicId,
      hudActive: (document.querySelector('.magic-card.is-active, .card.is-active, [data-magic].is-active') || {})
        .getAttribute ? (document.querySelector('.magic-card.is-active, .card.is-active, [data-magic].is-active') || {}).getAttribute('data-magic') : null
    }))()`);
    keyRows.push(row);
  }
  ok('数字键 1–6 真机切换主技能（每次 activeMagicId 与 MAGIC_CONFIG[i] 一致）',
    keyRows.length === Math.min(6, unlocked.count)
    && keyRows.every((r) => r.active === r.expect),
    { unlockedCount: unlocked.count, rows: keyRows });

  // 传送选房：Q 打开 → 数字键 1 选第一间
  const beforePos = await ev(`(() => ({ x: Math.round(state.player.x), y: Math.round(state.player.y),
    room: state.currentRoomId, mode: state.mode }))()`);
  await press('q', 'KeyQ', 81);
  const picker = await ev(`(() => {
    const el = document.getElementById('roomPicker');
    const shown = !!(el && getComputedStyle(el).display !== 'none');
    return { open: shown, flag: typeof roomPickerOpen === 'boolean' ? roomPickerOpen : null,
             count: el ? el.querySelectorAll('#roomPickerList button').length : 0,
             mode: state.mode };
  })()`);
  await press('1', 'Digit1', 49);
  await sleep(500);
  const afterPos = await ev(`(() => ({ x: Math.round(state.player.x), y: Math.round(state.player.y),
    room: state.currentRoomId, mode: state.mode,
    pickerOpen: (() => { const el = document.getElementById('roomPicker');
      return !!(el && getComputedStyle(el).display !== 'none'); })() }))()`);
  ok('传送选房真机可用（Q 打开浮层 → 数字键 1 真的把玩家传走 → 浮层收起）',
    picker.open === true && picker.count >= 1
    && (afterPos.room !== beforePos.room || afterPos.x !== beforePos.x || afterPos.y !== beforePos.y)
    && afterPos.pickerOpen === false,
    { before: beforePos, picker: picker, after: afterPos });
  ok('全程零 JS 异常', errors.length === 0, { errors });

  const passed = asserts.filter((a) => a.pass).length;
  fs.writeFileSync(path.join(OUT, 'p1-keys.json'), JSON.stringify({ passed, total: asserts.length, asserts }, null, 2));
  console.log(`\n===== 键位/选房真机 ${passed}/${asserts.length} =====`);
  ws.close(); killEdge(edge);
  process.exit(passed === asserts.length ? 0 : 1);
})().catch((e) => { console.error('ERR', e && (e.stack || e.message)); process.exit(1); });
