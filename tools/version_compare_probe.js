/**
 * 版本对照截图探针（before = 改造前快照，after = 当前主文件）
 * ------------------------------------------------------------
 * 同机位、同流程，各截 4 张：
 *   1) 标题页（版本号小字）
 *   2) 开局 1.2s（进房提示条）
 *   3) 小地图（走廊线 vs 传送虚线）
 *   4) 按 Q（选房浮层）
 * 用法：node tools/version_compare_probe.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
process.env.ARCANE_PROFILE_ROOT = path.join(__dirname, '..', '.testprofile', 'cmp-' + Date.now());
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 99);
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'version_guide');
const BEFORE = path.join(ROOT, 'baseline', 'index_arcane_v2.rooms-teleport.before.2026-11-10.html');
const AFTER = path.join(ROOT, 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  return { edge, send, evalJs };
}

/** 截整页并落盘 */
async function shot(send, name) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(png.data, 'base64'));
}

/** 按元素矩形裁剪 */
async function shotClip(send, name, rect) {
  const png = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 }
  });
  fs.writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(png.data, 'base64'));
}

/** 同一套流程跑一份文件 */
async function runOne(send, evalJs, file, tag) {
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  await sleep(3600);
  const title = await evalJs(`(() => {
    const el = document.getElementById('titleVersion');
    const about = document.getElementById('aboutBuildInfo');
    return { title: el ? el.textContent : null, about: about ? about.textContent : null };
  })()`);
  await shot(send, tag + '_title');

  await evalJs(`(() => { window.__charSkipPick = true; const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1200);
  const hint = await evalJs(`(() => {
    const el = document.getElementById('routeHint');
    return el ? el.textContent : null;
  })()`);
  await shot(send, tag + '_hint');

  const rect = await evalJs(`(() => {
    const el = document.getElementById('minimap');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  if (rect && rect.w > 0) await shotClip(send, tag + '_minimap', rect);

  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }))`);
  await sleep(700);
  const picker = await evalJs(`(() => {
    const wrap = document.getElementById('roomPicker');
    const cards = document.querySelectorAll('#roomPickerList button');
    return { open: !!wrap && wrap.style.display !== 'none', count: cards.length };
  })()`);
  await shot(send, tag + '_picker');
  console.log('COMPARE', JSON.stringify({ tag, title: title.title, about: title.about, hint: hint, picker: picker }));
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const { edge, send, evalJs } = await connect();
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1707, height: 930, deviceScaleFactor: 1, mobile: false });
    await runOne(send, evalJs, BEFORE, 'before');
    await runOne(send, evalJs, AFTER, 'after');
  } finally {
    killEdge(edge);
  }
}

main().catch((e) => { console.error('CMP_FATAL', e); process.exit(1); });
