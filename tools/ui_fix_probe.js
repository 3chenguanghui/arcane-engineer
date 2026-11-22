/**
 * 三件修复的实测探针（选房可用性 / 出口可见性 / HUD 重叠）
 * ------------------------------------------------------------
 * 用真实 CDP 输入（Input.dispatchKeyEvent / dispatchMouseEvent），不是 DOM 合成事件。
 * 三个视口各跑一遍：1280×720@1、1440×900@1、1707×930@1.5。
 * 输出：元素矩形 / 相交面积 / 文本溢出 / Q 浮层与点击传送结果 / 提示条是否常驻。
 *
 * 用法：node tools/ui_fix_probe.js <html 绝对路径> <before|after>
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
process.env.ARCANE_PROFILE_ROOT = path.join(__dirname, '..', '.testprofile', 'uifix-' + Date.now());
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 400);
const FILE = process.argv[2];
const TAG = process.argv[3] || 'run';
const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(ROOT, '.screenshots', 'ui_fix');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = [
  { w: 1280, h: 720, dpr: 1, label: '1280x720' },
  { w: 1440, h: 900, dpr: 1, label: '1440x900' },
  { w: 1707, h: 930, dpr: 1.5, label: '1707x930@1.5' }
];

/** 启动无头 Edge 并连上 CDP */
async function connect() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1707,930',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(300);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  await new Promise((resolve) => { ws.onopen = resolve; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  return { edge, send, evalJs };
}

/** 真按键：keyDown + keyUp（CDP 层，等同物理键盘） */
async function pressKey(send, key, code, vk, text) {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text
  });
  await sleep(60);
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
  });
  await sleep(120);
}

/** 真鼠标点击（按下 + 抬起） */
async function clickAt(send, x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(900);
}

/** 页面内：量矩形 / 相交面积 / 文本溢出 / 提示条 */
const MEASURE = `(() => {
  const R = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
      return { hidden: true, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
    }
    return {
      hidden: false,
      x: Math.round(b.left), y: Math.round(b.top),
      w: Math.round(b.width), h: Math.round(b.height),
      right: Math.round(b.right), bottom: Math.round(b.bottom)
    };
  };
  const inter = (a, b) => {
    if (!a || !b || a.hidden || b.hidden) return 0;
    const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? Math.round(w * h) : 0;
  };
  const el = (id) => document.getElementById(id);
  const rects = {
    ash: R(el('ashBurnBtn')),
    skillDock: R(el('btnSkillDock')),
    mapDock: R(el('btnMapDock')),
    readouts: R(document.querySelector('.hud-readouts')),
    record: R(el('hudRecordText')),
    recordBox: R(document.querySelector('.hud-record')),
    aether: R(el('hudAetherText')),
    aetherLabel: R(document.querySelector('.bar-aether') ? document.querySelector('.bar-aether').parentNode.querySelector('.bar-label') : null),
    routeHint: R(el('routeHint')),
    minimap: R(document.querySelector('.minimap-panel'))
  };
  const lh = (node) => {
    if (!node) return null;
    const cs = getComputedStyle(node);
    const l = parseFloat(cs.lineHeight);
    const r = node.getBoundingClientRect();
    return { lineHeight: Math.round(l * 10) / 10, height: Math.round(r.height * 10) / 10, lines: Math.round(r.height / (l || 1)) };
  };
  const overflow = {
    record: { scrollW: el('hudRecordText') ? el('hudRecordText').scrollWidth : null, clientW: el('hudRecordText') ? el('hudRecordText').clientWidth : null },
    aether: { lines: lh(el('hudAetherText')), text: el('hudAetherText') ? el('hudAetherText').textContent : null },
    recordLines: lh(el('hudRecordText'))
  };
  const overlaps = {
    ash_vs_skillDock: inter(rects.ash, rects.skillDock),
    ash_vs_mapDock: inter(rects.ash, rects.mapDock),
    ash_vs_minimap: inter(rects.ash, rects.minimap),
    routeHint_vs_minimap: inter(rects.routeHint, rects.minimap),
    routeHint_vs_readouts: inter(rects.routeHint, rects.readouts),
    record_vs_panelRight: rects.record && rects.readouts && !rects.record.hidden
      ? Math.round(Math.max(0, rects.record.right - rects.readouts.right)) : null
  };
  return {
    view: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    mode: state.mode, status: state.status,
    room: state.currentRoomId,
    rects: rects, overlaps: overlaps, overflow: overflow,
    hint: {
      exists: !!el('routeHint'),
      opacity: el('routeHint') ? getComputedStyle(el('routeHint')).opacity : null,
      text: el('routeHint') ? el('routeHint').textContent : null
    }
  };
})()`;

/** 开局（跳过角色选择） */
const START_GAME = `(() => {
  window.__charSkipPick = true;
  const btn = document.getElementById('btnStart');
  if (btn) btn.click();
  return true;
})()`;

/** 读 Q 浮层状态：是否显示、卡片数、卡片中心点命中的元素 */
const PICKER_STATE = `(() => {
  const wrap = document.getElementById('roomPicker');
  const cards = Array.from(document.querySelectorAll('#roomPickerList button'));
  const visible = wrap ? getComputedStyle(wrap).display !== 'none' : false;
  const hits = cards.map((c) => {
    const r = c.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(x, y);
    return {
      roomId: Number(c.dataset.roomId),
      center: { x: x, y: y },
      size: { w: Math.round(r.width), h: Math.round(r.height) },
      text: c.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60),
      hitCard: !!(top && top.closest && top.closest('#roomPickerList button')),
      covering: top ? (top.id || top.className || top.tagName) : null,
      disabled: c.disabled === true
    };
  });
  return { visible: visible, open: !!window.roomPickerOpen, count: cards.length, cards: hits,
    note: (document.getElementById('roomPickerNote') || {}).textContent || null };
})()`;

/** 读落点/房号 */
const AFTER_CLICK = `(() => {
  const cur = state.rooms[state.currentRoomId];
  const gap = cur ? Math.min(state.player.x - cur.x, cur.x + cur.w - state.player.x,
    state.player.y - cur.y, cur.y + cur.h - state.player.y) : null;
  return { room: state.currentRoomId, player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
    wallGap: gap == null ? null : Math.round(gap) };
})()`;

/** 出口光点是否画出来（读调试快照，按实现补） */
const EXIT_MARKS = `(() => (typeof window.__exitMarks === 'function' ? window.__exitMarks() : null))()`;

async function main() {
  if (!FILE) throw new Error('缺少文件参数');
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const { edge, send, evalJs } = await connect();
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    for (const v of VIEWS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: false
      });
      await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
      await sleep(3200);
      await evalJs(START_GAME);
      await sleep(1800);

      const m1 = await evalJs(MEASURE);
      console.log('VIEW', v.label, JSON.stringify({
        overlaps: m1.overlaps, overflow: m1.overflow, hint1: m1.hint, mode: m1.mode
      }));

      // 提示条是否常驻：进房 7 秒后再读一次
      await sleep(5600);
      const m2 = await evalJs(MEASURE);
      console.log('HINT_PERSIST', v.label, JSON.stringify(m2.hint));

      // 真按键 Q
      await pressKey(send, 'q', 'KeyQ', 81, 'q');
      const picker = await evalJs(PICKER_STATE);
      console.log('Q_OPEN', v.label, JSON.stringify(picker));

      // 真鼠标点第一张卡（优先不带"代价"的卡）
      let clickInfo = { skipped: true };
      if (picker.visible && picker.cards.length) {
        const idx = Math.max(0, picker.cards.findIndex((c) => !/代价/.test(c.text))) ;
        const target = picker.cards[idx];
        const before = await evalJs(AFTER_CLICK);
        await clickAt(send, target.center.x, target.center.y);
        const after = await evalJs(AFTER_CLICK);
        clickInfo = {
          cardRoomId: target.roomId, from: before.room, to: after.room,
          changed: before.room !== after.room, wallGap: after.wallGap, player: after.player
        };
      }
      console.log('Q_CLICK', v.label, JSON.stringify(clickInfo));
      console.log('EXIT_MARKS', v.label, JSON.stringify(await evalJs(EXIT_MARKS)));

      const png = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, `${TAG}_${v.label.replace(/[^0-9a-zA-Zx]+/g, '_')}.png`), Buffer.from(png.data, 'base64'));

      // 第二张截图：Q 浮层（重新打开）
      await pressKey(send, 'q', 'KeyQ', 81, 'q');
      await sleep(200);
      const png2 = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, `${TAG}_${v.label.replace(/[^0-9a-zA-Zx]+/g, '_')}_picker.png`), Buffer.from(png2.data, 'base64'));
      await pressKey(send, 'Escape', 'Escape', 27, '');
    }
  } finally {
    killEdge(edge);
  }
}

main().catch((e) => { console.error('UIFIX_FATAL', e); process.exit(1); });
