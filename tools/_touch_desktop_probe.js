/**
 * 键鼠态零改动探针（CDP 无头浏览器，不开启触摸模拟）
 * ------------------------------------------------------------
 * 目的：证明两个文案补丁在"没有真实 touch 事件"的桌面上完全不生效，
 *      演示副本在键鼠态的文本与原始主文件逐字段一致（= 视觉不会变）。
 * 用法：node tools/_touch_desktop_probe.js
 * 端口：9532
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9532;
const ROOT = path.join(__dirname, '..');
const DEMO = 'file:///' + path.join(ROOT, 'touch-demo.html').replace(/\\/g, '/');
const ORIG = 'file:///' + path.join(ROOT, 'index_arcane_v2.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 采集桌面态下的关键文本与补丁状态
 * @returns {Object} 采样结果
 */
const SAMPLE = `(function () {
  const q = (s) => document.querySelector(s);
  const kbd = (s) => Array.prototype.map.call(document.querySelectorAll(s + ' kbd'), function (k) { return k.textContent.trim(); });
  return {
    maxTouchPoints: Number(navigator.maxTouchPoints) || 0,
    coarse: !!(window.matchMedia && matchMedia('(any-pointer: coarse)').matches),
    bodyClass: document.body ? document.body.className : '',
    sheets: document.styleSheets.length,
    layers: document.querySelectorAll('.tg-layer, #tgLayer').length,
    deckKbds: kbd('.deck-keys'),
    deckText: (q('.deck-keys') || {}).textContent || '',
    skillChips: Array.prototype.map.call(document.querySelectorAll('.skill-chip > span'), function (e) { return e.textContent.trim(); }),
    intro: (q('#introHintText') || {}).textContent || '',
    step0: (typeof ONBOARD_STEPS !== 'undefined' && ONBOARD_STEPS[0]) ? ONBOARD_STEPS[0].hint : null,
    keycapsActive: !!(window.__touchKeycaps && window.__touchKeycaps.active),
    keycapsSawTouch: !!(window.__touchKeycaps && window.__touchKeycaps.sawTouch),
    copyActive: !!(window.__touchCopy && window.__touchCopy.active),
    copySawTouch: !!(window.__touchCopy && window.__touchCopy.sawTouch)
  };
})()`;

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1280,800', '--force-device-scale-factor=1', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口就绪 */ }
    await sleep(250);
  }
  if (!target) {
    killEdge(edge);
    throw new Error('Edge 未就绪');
  }

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

  await send('Runtime.enable');
  await send('Page.enable');
  /* 桌面视口，不调用 setTouchEmulationEnabled：maxTouchPoints 保持 0 */
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1280, screenHeight: 800, positionX: 0, positionY: 0
  });

  await send('Page.navigate', { url: encodeURI(DEMO + '?touch=off') });
  await sleep(2200);
  const off = await ev(SAMPLE);

  await send('Page.navigate', { url: encodeURI(DEMO) });
  await sleep(2200);
  const demo = await ev(SAMPLE);

  await send('Page.navigate', { url: encodeURI(ORIG) });
  await sleep(2200);
  const orig = await ev(SAMPLE);

  const fields = ['deckKbds', 'deckText', 'skillChips', 'intro', 'step0', 'bodyClass', 'sheets'];
  const textFields = ['deckKbds', 'deckText', 'skillChips', 'intro', 'step0'];
  const offDiff = fields.filter((key) => JSON.stringify(off[key]) !== JSON.stringify(orig[key]));
  /* 默认桌面会挂触屏层（body class / 样式表因此不同是预期），这里只比文本 */
  const demoDiff = textFields.filter((key) => JSON.stringify(demo[key]) !== JSON.stringify(orig[key]));
  /* ?touch=off：与原始主文件逐字段一致（含 body class 与样式表数量） */
  const offPass = offDiff.length === 0;
  /* 默认桌面（有能力但没有真实触摸）：两个补丁不生效、文本保持原文 */
  const demoPass = demoDiff.length === 0
    && demo.keycapsActive === false && demo.keycapsSawTouch === false
    && demo.copyActive === false && demo.copySawTouch === false;
  const pass = offPass && demoPass;

  console.log(JSON.stringify({
    pass,
    offDiff,
    demoDiff,
    off: {
      bodyClass: off.bodyClass, sheets: off.sheets, keycapsActive: off.keycapsActive,
      copyActive: off.copyActive, deckKbds: off.deckKbds, intro: off.intro, step0: off.step0
    },
    demo: {
      maxTouchPoints: demo.maxTouchPoints,
      coarse: demo.coarse,
      layers: demo.layers,
      keycapsActive: demo.keycapsActive,
      keycapsSawTouch: demo.keycapsSawTouch,
      copyActive: demo.copyActive,
      copySawTouch: demo.copySawTouch,
      deckKbds: demo.deckKbds,
      deckText: demo.deckText,
      intro: demo.intro,
      step0: demo.step0
    },
    orig: { bodyClass: orig.bodyClass, sheets: orig.sheets, deckKbds: orig.deckKbds, deckText: orig.deckText, intro: orig.intro, step0: orig.step0 }
  }, null, 2));

  ws.close();
  killEdge(edge);
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
