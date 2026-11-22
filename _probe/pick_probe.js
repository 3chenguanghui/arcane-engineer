/**
 * ① 房间/角色三选一 · 是否会被"零决策"推进（只读）
 * ------------------------------------------------------------
 * 复现三种真实路径，记录：玩家输入次数、三选一停留帧数、是否进入 playing。
 *   A 鼠标单击「开始探索」后静置
 *   B 键盘 Enter 单击（keydown + keyup）后静置
 *   C 键盘 Enter 长按（autoRepeat 3 次）后静置
 *   D 完全不输入，静置
 * 用法：node _probe/pick_probe.js
 * 产出：控制台 JSON；不写主文件、不截图。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-pick-${process.pid}-${Date.now()}`);
const PORT = 9793;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 Edge headless 并连上 CDP
 * @returns {Promise<{send:Function, ev:Function, close:Function}>}
 */
async function boot() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', '--hide-scrollbars', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    send,
    ev,
    /** 整页截图（仅用于证据留档） */
    shot: async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.join(ROOT, 'shots', 'audit'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'shots', 'audit', name), Buffer.from(r.data, 'base64'));
      return name;
    },
    close: async () => {
      try { ws.close(); } catch (e) { /* ignore */ }
      try { edge.kill(); } catch (e) { /* ignore */ }
      await sleep(500);
      try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch (e) { /* ignore */ }
    }
  };
}

/**
 * 注入输入计数器 + 帧计数器 + 三选一可见时长采样
 * @param {Function} ev 页面求值函数
 * @returns {Promise<void>}
 */
async function installCounters(ev) {
  await ev(`(() => {
    window.__pick = { input: 0, frames: 0, selFrames: 0, firstSelAt: 0, lastSelAt: 0, modeAtSel: null, entered: false };
    const p = window.__pick;
    window.addEventListener('pointerdown', () => p.input++, true);
    window.addEventListener('keydown', (e) => { if (!e.repeat) p.input++; }, true);
    const loop = () => { p.frames++; const layer = document.getElementById('charLayer');
      if (layer && !layer.classList.contains('hidden')) {
        p.selFrames++;
        if (!p.firstSelAt) p.firstSelAt = performance.now();
        p.lastSelAt = performance.now();
        const d = window.__roamDebug;
        p.modeAtSel = d && d.getState ? d.getState().mode : null;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })()`);
}

/**
 * 读取当前快照
 * @param {Function} ev 页面求值函数
 * @returns {Promise<Object>}
 */
async function snapshot(ev) {
  return ev(`(() => {
    const p = window.__pick || {};
    const d = window.__roamDebug;
    const s = m => (d && d.getState ? d.getState()[m] : null);
    const layer = document.getElementById('charLayer');
    const on = document.getElementById('charHighlight');
    const firstCard = document.querySelector('.char-card.is-on');
    return {
      mode: s('mode'), status: s('status'), floor: s('floor'),
      charLayerOpen: !!layer && !layer.classList.contains('hidden'),
      highlighted: firstCard ? firstCard.textContent.replace(/\\s+/g, ' ').trim().slice(0, 12) : null,
      inputs: p.input || 0,
      frames: p.frames || 0,
      selFrames: p.selFrames || 0,
      selMs: p.firstSelAt ? Math.round(p.lastSelAt - p.firstSelAt) : 0,
      modeDuringSelect: p.modeAtSel || null
    };
  })()`);
}

/**
 * 用 CDP 派发一次真实键盘事件
 * @param {Object} t boot() 返回
 * @param {string} type keyDown / keyUp / rawKeyDown
 * @param {boolean} autoRepeat 是否自动重复
 * @returns {Promise<void>}
 */
async function keyEnter(t, type, autoRepeat) {
  await t.send('Input.dispatchKeyEvent', {
    type, key: 'Enter', code: 'Enter', text: type === 'keyDown' ? '\r' : undefined,
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, autoRepeat: !!autoRepeat
  });
}

/**
 * 用 CDP 在「开始探索」按钮中心派发一次真实鼠标点击
 * @param {Object} t boot() 返回
 * @returns {Promise<boolean>} 是否找到按钮
 */
async function clickStart(t) {
  const r = await t.ev(`(() => { const b = document.getElementById('btnStart'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!r) return false;
  await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  return true;
}

/**
 * 单场景：重载页面 → 注入计数 → 执行输入 → 静置 → 读快照
 * @param {Object} t boot() 返回
 * @param {string} name 场景名
 * @param {Function} act 输入动作（可为空）
 * @param {number} waitMs 静置时长
 * @returns {Promise<Object>}
 */
async function scenario(t, name, act, waitMs) {
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(2600);
  await installCounters(t.ev);
  const t0 = Date.now();
  if (act) await act();
  await sleep(waitMs);
  const snap = await snapshot(t.ev);
  return Object.assign({ name, waitMs, wallMs: Date.now() - t0 }, snap);
}

/**
 * 主流程：逐一验证"必须真实选择才进房"
 * @returns {Promise<void>}
 */
async function main() {
  const t = await boot();
  const out = [];
  try {
    /* A 单击开始 → 应停在选人页 */
    out.push(await scenario(t, 'A 鼠标单击开始探索', async () => { await clickStart(t); }, 3000));
    /* B 单击开始 → 再单按一次 Enter（没选人）→ 应仍在选人页 */
    out.push(await scenario(t, 'B 开始后只按 Enter（不选人）', async () => {
      await clickStart(t);
      await sleep(800);
      await keyEnter(t, 'keyDown'); await keyEnter(t, 'keyUp');
      await sleep(140);
      await t.shot('pick-need-select.png');
    }, 2500));
    /* C 按住 Enter 不放（自动重复 3 次）→ 应仍在选人页 */
    out.push(await scenario(t, 'C 按住 Enter（重复3次）', async () => {
      await keyEnter(t, 'rawKeyDown', false);
      for (let i = 0; i < 3; i += 1) { await sleep(120); await keyEnter(t, 'rawKeyDown', true); }
      await keyEnter(t, 'keyUp');
    }, 3000));
    /* D 完全不输入 → 应停在标题页 */
    out.push(await scenario(t, 'D 完全不输入', null, 4000));
    /* E 点卡片 → Enter → 应进游戏 */
    out.push(await scenario(t, 'E 点卡片后 Enter', async () => {
      await clickStart(t);
      await sleep(800);
      const r = await t.ev(`(() => { const c = document.querySelector('.char-card'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 60 }; })()`);
      if (r) {
        await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
        await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      }
      await sleep(300);
      await keyEnter(t, 'keyDown'); await keyEnter(t, 'keyUp');
    }, 3000));
    /* F 按数字键选人 → Enter → 应进游戏 */
    out.push(await scenario(t, 'F 数字键选人后 Enter', async () => {
      await clickStart(t);
      await sleep(800);
      await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', code: 'Digit2', text: '2', windowsVirtualKeyCode: 50 });
      await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
      await sleep(300);
      await keyEnter(t, 'keyDown'); await keyEnter(t, 'keyUp');
    }, 3000));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await t.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
