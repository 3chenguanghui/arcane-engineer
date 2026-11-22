/**
 * 版本标识验收探针
 * ------------------------------------------------------------
 * 做三件事：
 *   1. 以 1707×930（用户真机 CSS 视口）加载主文件
 *   2. 截标题页，读出角落版本文本
 *   3. 打开设置 → 切到「其他」页，截「关于 · 构建信息」并读文本
 * 只读不写，不改游戏状态。
 * 用法：node tools/version_label_probe.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9456;
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, 'index_arcane_v2.html');
const SHOT_DIR = path.join(ROOT, '.screenshots', 'version_label');
const VIEW_W = 1707;
const VIEW_H = 930;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    `--window-size=${VIEW_W},${VIEW_H}`,
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(3500);

    const titleInfo = await evalJs(`(() => {
      const el = document.getElementById('titleVersion');
      const r = el ? el.getBoundingClientRect() : null;
      return {
        text: el ? el.textContent : '(missing)',
        rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
        viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
        overflowX: document.documentElement.scrollWidth > innerWidth,
        mode: typeof state !== 'undefined' ? state.mode : 'no-state'
      };
    })()`);
    console.log('TITLE', JSON.stringify(titleInfo));

    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, 'title_corner.png'), Buffer.from(shot1.data, 'base64'));

    // 打开设置面板并切到「其他」（关于 / 构建信息所在页）
    // 标题页只允许说明 / 图鉴，所以先真实开局（跳过角色选择），再开设置
    const opened = await evalJs(`(() => {
      window.__charSkipPick = true;
      const b = document.getElementById('btnStart');
      if (b) b.click();
      if (typeof crashState !== 'undefined') crashState.halted = true;
      const ok = (typeof openPanel === 'function') ? openPanel('settings') : false;
      if (typeof showSettingsTab === 'function') showSettingsTab('other');
      const el = document.getElementById('aboutBuildInfo');
      return {
        mode: state.mode,
        opened: ok,
        hasPanel: !!document.getElementById('settingsPanel'),
        tab: typeof settingsTabId !== 'undefined' ? settingsTabId : '(n/a)',
        buildText: el ? el.textContent : '(missing)',
        visible: el ? (el.getBoundingClientRect().height > 0) : false
      };
    })()`);
    console.log('SETTINGS', JSON.stringify(opened));
    // 滚到「关于」区，让构建信息落在可视区
    await evalJs(`(() => {
      const s = document.getElementById('aboutSection');
      if (s) s.scrollIntoView({ block: 'center' });
      return true;
    })()`);
    await sleep(500);

    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, 'settings_about.png'), Buffer.from(shot2.data, 'base64'));

    const errors = await evalJs(`(() => (window.__errors || []).slice(0, 5))()`);
    console.log('ERRORS', JSON.stringify(errors));
    console.log('SHOTS', SHOT_DIR);
  } finally {
    killEdge(edge);
  }
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
