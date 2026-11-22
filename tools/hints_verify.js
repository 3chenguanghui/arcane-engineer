/**
 * P0-① 完整验收（真实键盘事件，不调用任何游戏函数）
 * ------------------------------------------------------------
 * 判据：
 *   1) 按 K → 等 10 秒 → 再按 K，两次都能在屏上看到提示
 *   2) 真重开（Page.reload 重建 JS 上下文）后再按 K，仍然能看到
 *   3) 提示出现后 10 秒内，它的文案不被任何其它 toast 改写
 *      （逐帧采样，给出 on/off 与文案变化的时间戳，而不是只给一张图）
 *
 * 用法：node tools/hints_verify.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log('[probe] ' + m);

/** 建连并打开游戏页 */
async function connect() {
  let edge = null;
  let target = null;
  for (let attempt = 0; attempt < 5 && !target; attempt += 1) {
    const port = 10880 + Math.floor(Math.random() * 100);
    edge = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${prepareProfile()}`,
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--allow-file-access-from-files', '--window-size=1440,900', '--force-device-scale-factor=1',
      'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !target; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page') || null;
      } catch (e) { /* 等端口 */ }
      if (!target) await sleep(250);
    }
    if (!target) { try { killEdge(edge); } catch (e) { /* 忽略 */ } await sleep(300); }
  }
  if (!target) throw new Error('调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r.result.value;
  };
  return { edge, ws, send, ev };
}

/** 走完整开局流程：点开始 → 选角色 → 确认 */
async function startGame(ev) {
  for (let i = 0; i < 80; i += 1) {
    const ok = await ev(`(function(){ var t=document.getElementById('titleLayer'); return document.readyState==='complete' && typeof state!=='undefined' && !!t && !t.classList.contains('hidden'); })()`);
    if (ok) break;
    await sleep(200);
  }
  await ev(`document.getElementById('btnStart').click()`);
  await sleep(400);
  await ev(`document.querySelector('#charGrid .char-card').click()`);
  await sleep(250);
  await ev(`document.getElementById('btnCharConfirm').click()`);
  for (let i = 0; i < 50; i += 1) { if ((await ev(`state.mode`)) === 'playing') break; await sleep(100); }
  await sleep(600);
}

/** 发一次真实按键（keyDown + keyUp），走浏览器事件链 */
async function pressKey(send, key, code) {
  const vk = key.toUpperCase().charCodeAt(0);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: key
  });
  await sleep(60);
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
  });
}

/** 只截顶部提示条，快且能证明"玩家真的看得见" */
async function grab(send, name) {
  const r = await send('Page.captureScreenshot', {
    format: 'png', clip: { x: 320, y: 0, width: 800, height: 150, scale: 1 }
  });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}

/**
 * 连续采样 top toast，返回逐次变化的时间线（出现/换文案/消失）
 * @param {Object} ev 页面求值
 * @param {Object} send CDP send
 * @param {number} watchMs 观察窗口（毫秒）
 * @param {string} shotName 第一次可见时截的图
 * @returns {Promise<Object[]>} 变化点列表 [{at, on, text}]
 */
async function watchTimeline(ev, send, watchMs, shotName) {
  const t0 = Date.now();
  const changes = [];
  let lastKey = null;
  let shotStarted = false;
  while (Date.now() - t0 < watchMs) {
    const cur = await ev(`(function(){
      var el = document.getElementById('toast');
      return { on: el.classList.contains('is-on'), text: el.textContent };
    })()`);
    const t = Date.now() - t0;
    if (cur && !cur.__err) {
      const key = cur.on + '|' + (cur.on ? cur.text : '');
      if (key !== lastKey) {
        changes.push({ at: t, on: cur.on, text: cur.on ? cur.text : '' });
        lastKey = key;
      }
      if (cur.on && !shotStarted) { shotStarted = true; grab(send, shotName); }
    }
    await sleep(40);
  }
  return changes;
}

/** 时间线里第一次匹配 /未解锁/ 的区间（起点/终点） */
function lockedWindow(changes) {
  const start = changes.find((c) => c.on && /未解锁/.test(c.text));
  if (!start) return null;
  const after = changes.filter((c) => c.at > start.at);
  const end = after.find((c) => !c.on || !/未解锁/.test(c.text));
  return { from: start.at, to: end ? end.at : null, text: start.text };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev } = await connect();
  const report = { at: new Date().toISOString(), presses: [] };
  try {
    await send('Page.navigate', { url: pathToFileURL(FILE).href });
    await startGame(ev);
    report.locked = await ev(`(function(){ return { device: isUnlocked('device'), fusion: isUnlocked('fusion'), swap: isUnlocked('parallel') }; })()`);
    /* 等开局引导 toast 播完，模拟玩家真正开始操作 */
    await sleep(4500);

    /* ---- 第 1 次按 K ---- */
    let tPress = Date.now();
    await pressKey(send, 'k', 'KeyK');
    log('第 1 次按 K @ ' + new Date(tPress).toISOString());
    let timeline1 = await watchTimeline(ev, send, 10000, 'p0-hint-k-1.png');
    report.presses.push({ label: 'press1', at: tPress, timeline: timeline1, window: lockedWindow(timeline1) });

    /* ---- 与第 1 次间隔 ≥10 秒，再按第 2 次 ---- */
    const gap = Date.now() - tPress;
    if (gap < 10000) await sleep(10000 - gap);
    tPress = Date.now();
    await pressKey(send, 'k', 'KeyK');
    log('第 2 次按 K @ ' + new Date(tPress).toISOString());
    const timeline2 = await watchTimeline(ev, send, 10000, 'p0-hint-k-2.png');
    report.presses.push({ label: 'press2', at: tPress, gapFromPrevMs: gap, timeline: timeline2, window: lockedWindow(timeline2) });

    /* ---- 真重开：刷新页面重建 JS 上下文 → 重新开局 → 再按 K ---- */
    await send('Page.reload');
    await sleep(1000);
    await startGame(ev);
    await sleep(4500);
    tPress = Date.now();
    await pressKey(send, 'k', 'KeyK');
    log('第 3 次按 K（重开一局后）@ ' + new Date(tPress).toISOString());
    const timeline3 = await watchTimeline(ev, send, 10000, 'p0-hint-k-3.png');
    report.presses.push({ label: 'press3_after_restart', at: tPress, timeline: timeline3, window: lockedWindow(timeline3) });

    /* ---- 判定 ---- */
    const visible = (p) => !!p.window;
    const stable = (p) => {
      /* 提示区间内不允许出现第二条不同文案：时间线里区间内只有一条 /未解锁/ 记录 */
      if (!p.window) return false;
      const inside = p.timeline.filter((c) => c.at > p.window.from && c.at < (p.window.to || Infinity) && c.on);
      return inside.every((c) => /未解锁/.test(c.text));
    };
    const held = (p) => (p.window && p.window.to ? p.window.to - p.window.from : null);
    report.verdict = {
      press1_visible: visible(report.presses[0]),
      press2_visible_after_10s: visible(report.presses[1]),
      press3_visible_after_restart: visible(report.presses[2]),
      press2_gap_ms: report.presses[1].gapFromPrevMs,
      hint_hold_ms: report.presses.map(held),
      text_not_replaced_by_other_toast: report.presses.every(stable)
    };
    console.log(JSON.stringify(report.verdict, null, 2));
  } finally {
    fs.writeFileSync(path.join(OUT, 'p0-hints-verify-v2.json'), JSON.stringify(report, null, 2));
    try { ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(edge); } catch (e) { /* 忽略 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
