/**
 * D4 实测探针：三个视口下顶栏是否横向溢出（scrollWidth vs clientWidth）
 * ------------------------------------------------------------
 * 用法：node tools/arcane_hud_narrow.js [输出后缀]
 * 端口：9542
 * 输出：.screenshots/art/d4-hud-<视口>-<后缀>.png / d4-hud-<后缀>.json
 *
 * 判据：被测元素的 scrollWidth <= clientWidth（不产生横向滚动）；
 *       同时给出每块状态条的实际宽度与标签是否被省略号截断（span.scrollWidth > span.clientWidth）。
 * 每个视口都重新加载 + 点「开始」+ 等真实开局，截图不是调试摆位。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9542;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const TAG = process.argv[2] || 'run';

/* 三个验收视口：手机竖屏 / 平板竖屏 / 桌面 */
const VIEWPORTS = [
  { name: '500x683@1.5', width: 500, height: 683, dpr: 1.5, mobile: true },
  { name: '750x1024@1', width: 750, height: 1024, dpr: 1, mobile: true },
  { name: '1280x720@1', width: 1280, height: 720, dpr: 1, mobile: false }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
    return fs.statSync(path.join(OUT_DIR, name)).size;
  };

  await send('Runtime.enable');
  await send('Page.enable');

  const results = [];
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile
    });
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    // 等脚本就绪再开局（3.2MB 单文件解析慢，太早点按钮会被吞）；新档首局还要过一次角色选择
    for (let i = 0; i < 60; i += 1) {
      if (await ev(`typeof startGame === 'function'`)) break;
      await sleep(250);
    }
    await ev(`(function(){
      if (state.mode === 'title') {
        startGame();
        if (state.mode === 'title' && typeof chooseCharacter === 'function' && CHARACTER_CONFIG) {
          chooseCharacter(CHARACTER_CONFIG.ids[0]);
        }
      }
      return state.mode;
    })()`);
    for (let i = 0; i < 60; i += 1) {
      if ((await ev(`state.mode`)) === 'playing') break;
      await sleep(200);
    }
    await sleep(2600);

    const measure = await ev(`(function(){
      function box(sel){
        var el = document.querySelector(sel);
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return {
          sel: sel,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          offsetWidth: el.offsetWidth,
          rectW: Math.round(r.width * 10) / 10,
          overflow: el.scrollWidth - el.clientWidth
        };
      }
      var groups = [];
      var list = document.querySelectorAll('.hud-readouts .bar-group');
      for (var i = 0; i < list.length; i += 1) {
        var g = list[i];
        var span = g.querySelector('.bar-label > span');
        var b = g.querySelector('.bar-label > b');
        var gr = g.getBoundingClientRect();
        groups.push({
          index: i,
          label: span ? span.textContent : '',
          groupW: Math.round(gr.width * 10) / 10,
          labelClipped: span ? span.scrollWidth > span.clientWidth + 1 : null,
          labelW: span ? span.clientWidth : null,
          valueW: b ? Math.round(b.getBoundingClientRect().width) : null
        });
      }
      var top = document.querySelector('.hud-top');
      var ro = document.querySelector('.hud-readouts');
      var topStyle = ro ? getComputedStyle(ro) : null;
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        dpr: window.devicePixelRatio,
        doc: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          bodyScrollWidth: document.body.scrollWidth
        },
        hud: box('.hud-top'),
        readouts: box('.hud-readouts'),
        actions: box('.hud-actions'),
        brand: box('.brand'),
        readoutsDisplay: topStyle ? topStyle.display : null,
        readoutsFlex: topStyle ? (topStyle.flex || topStyle.flexGrow) : null,
        groups: groups,
        mode: (typeof state !== 'undefined' && state) ? state.mode : 'no-state',
        floor: (typeof state !== 'undefined' && state) ? state.floor : null
      };
    })()`);

    const file = 'd4-hud-' + vp.name.replace(/[^\w@]/g, '') + '-' + TAG + '.png';
    const bytes = await shot(file);
    measure.screenshot = file;
    measure.screenshotBytes = bytes;
    measure.viewport = vp.name;
    measure.pass = !!(measure.hud && measure.hud.overflow <= 0
      && measure.readouts && measure.readouts.overflow <= 0
      && measure.doc.scrollWidth <= measure.doc.clientWidth + 1);
    results.push(measure);
    console.log('VP', vp.name, 'hudOverflow', measure.hud && measure.hud.overflow,
      'readoutsOverflow', measure.readouts && measure.readouts.overflow,
      'docSW/CW', measure.doc.scrollWidth + '/' + measure.doc.clientWidth,
      'groups', measure.groups.map((g) => Math.round(g.groupW) + (g.labelClipped ? '*' : '')).join(','),
      'shot', bytes + 'B', measure.pass ? 'PASS' : 'FAIL');
  }

  const outFile = path.join(OUT_DIR, 'd4-hud-' + TAG + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ tag: TAG, results }, null, 2));
  console.log('OUT', outFile);
  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
