/**
 * 第一层三行字（顶部提示 / 新手训练条 / 叙事句）真实渲染几何测量
 * ------------------------------------------------------------
 * - 每个视口重新加载页面，真实点击开局，真实键盘按 K 触发提示
 * - 只读 getBoundingClientRect（渲染后的盒子），计算两两相交面积
 * - 截图存 .screenshots/firstplay/stack-<w>x<h>.png
 * 用法：node tools/top_stack_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'firstplay');
const TAG = process.argv[2] || 'before';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动无头 Edge 并建立 CDP 连接 */
async function connect() {
  const port = 11040 + Math.floor(Math.random() * 50);
  const edge = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${prepareProfile()}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1280,720', '--force-device-scale-factor=1',
    'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page') || null;
    } catch (e) { /* 等端口 */ }
    if (!target) await sleep(250);
  }
  if (!target) { try { killEdge(edge); } catch (e) { /* 忽略 */ } throw new Error('调试端口未就绪'); }
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
  await send('Runtime.enable'); await send('Page.enable'); await send('Input.setIgnoreInputEvents', { ignore: false });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k });
    await sleep(60);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  return { edge, ws, send, ev, key, shot };
}

/** 真实点击：开始 → 选角色 → 确认 */
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
  await sleep(900);
}

/** 读取三条的渲染矩形、可见性、文本 */
const RECTS = `(function(){
  function box(id){
    var el = document.getElementById(id);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return {
      id: id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      opacity: +cs.opacity, cls: el.className,
      on: el.classList.contains('is-on') || el.dataset.on === '1' || (id === 'tutOverlay' ? el.dataset.on === '1' : false),
      text: (el.textContent || '').trim().slice(0, 40)
    };
  }
  return { vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
    toast: box('toast'), tut: box('tutOverlay'), spirit: box('spiritLine'), onboard: box('onboardHint'), intro: box('introHint') };
})()`;

/** 计算两个矩形的相交面积（px²） */
function inter(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

async function runViewport(ctx, vw, vh, dpr) {
  const { send, ev, key, shot } = ctx;
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: dpr || 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2000);
  await startGame(ev);
  // 真实键盘按 K：触发"装置未解锁"提示（① 修复后一定能看到）
  await key('k', 'KeyK', 75);
  const samples = [];
  const shotName = `stack-${TAG}-${vw}x${vh}${dpr && dpr !== 1 ? '@' + dpr + 'x' : ''}.png`;
  let shotPromise = null;
  for (let i = 0; i < 14; i += 1) {
    const r = await ev(RECTS);
    if (r && !r.__err) samples.push(Object.assign({ t: i * 120 }, r));
    // 三条同时在屏的那一帧立刻截图（不阻塞采样），保证证据图里三行都在
    if (!shotPromise && r && r.toast && r.toast.on && r.tut && r.tut.on && r.spirit && r.spirit.on) {
      shotPromise = shot(shotName);
    }
    await sleep(120);
  }
  const best = samples.find((s) => s.toast.on && s.tut.on && s.spirit.on) || samples.find((s) => s.toast.on) || samples[0];
  if (shotPromise) await shotPromise; else await shot(shotName);
  const visSum = samples.filter((s) => s.toast.on && s.tut.on && s.spirit.on).length;
  return {
    viewport: `${vw}x${vh}${dpr && dpr !== 1 ? '@' + dpr + 'x' : ''}`, allThreeFrames: visSum, shots: shotName,
    sample: best,
    overlap: best ? {
      toast_tut: inter(best.toast, best.tut),
      toast_spirit: inter(best.toast, best.spirit),
      tut_spirit: inter(best.tut, best.spirit),
      toast_onboard: inter(best.toast, best.onboard),
      tut_onboard: inter(best.tut, best.onboard),
      spirit_onboard: inter(best.spirit, best.onboard),
      toast_intro: inter(best.toast, best.intro),
      intro_tut: inter(best.intro, best.tut),
      intro_spirit: inter(best.intro, best.spirit)
    } : null,
    frames: samples.map((s) => ({
      t: s.t, toast: s.toast && s.toast.on, tut: s.tut && s.tut.on, spirit: s.spirit && s.spirit.on,
      boxes: { toast: s.toast && [s.toast.x, s.toast.y, s.toast.w, s.toast.h],
        tut: s.tut && [s.tut.x, s.tut.y, s.tut.w, s.tut.h],
        spirit: s.spirit && [s.spirit.x, s.spirit.y, s.spirit.w, s.spirit.h] }
    }))
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await connect();
  const out = { tag: TAG, at: new Date().toISOString(), results: [] };
  try {
    for (const [w, h, d] of [[1280, 720, 1], [1440, 900, 1], [1707, 930, 1.5]]) {
      out.results.push(await runViewport(ctx, w, h, d));
      console.log(`[probe] ${w}x${h}@${d}x done`);
    }
  } finally {
    try { ctx.ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(ctx.edge); } catch (e) { /* 忽略 */ }
  }
  fs.writeFileSync(path.join(OUT, `stack-probe-${TAG}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.results.map((r) => ({ vp: r.viewport, all: r.allThreeFrames, boxes: r.sample && { toast: r.sample.toast && [r.sample.toast.y, r.sample.toast.h, r.sample.toast.on], tut: r.sample.tut && [r.sample.tut.y, r.sample.tut.h, r.sample.tut.on], spirit: r.sample.spirit && [r.sample.spirit.y, r.sample.spirit.h, r.sample.spirit.on] }, overlap: r.overlap })), null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
