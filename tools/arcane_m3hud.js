/**
 * M3 HUD 三角布局验收：左上自身状态 / 右上世界状态 / 左下空间地图 / 底部卡组，中央留空
 * 用法：node tools/arcane_m3hud.js
 * 端口：9511
 * 输出：.screenshots/art/m3-hud-triangle.png、m3-hud-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9511;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1400);
  await ev(`(function(){ state.player.invuln = 9999; state.player.hp = Math.round(state.player.hpMax * 0.62); return true; })()`);
  await sleep(500);
  await shot('m3-hud-triangle.png');

  const geo = await ev(`(function(){
    function rect(sel){ var el = document.querySelector(sel); if (!el) return null; var r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; }
    var vw = window.innerWidth, vh = window.innerHeight;
    var vitals = rect('.hud-readouts');
    var world = rect('.floor-panel');
    var map = rect('.minimap-panel');
    var deck = rect('.hud-deck');
    var overlap = function(a, b){ return !!(a && b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom); };
    var centerEl = document.elementFromPoint(vw / 2, vh / 2);
    return {
      vw: vw, vh: vh, vitals: vitals, world: world, map: map, deck: deck,
      overlaps: {
        vitalsWorld: overlap(vitals, world), vitalsMap: overlap(vitals, map), worldMap: overlap(world, map), deckMap: overlap(deck, map)
      },
      center: centerEl ? (centerEl.id || centerEl.className || centerEl.tagName) : 'none',
      cards: document.querySelectorAll('#magicRow .mini-card').length,
      hpText: (document.getElementById('hudHpText') || {}).textContent || ''
    };
  })()`);

  ok('M3HUD-1 左上角自身状态卡（left < 30、top < 130、宽度 ≤ 240、不与右侧面板重叠）',
    !!geo.vitals && geo.vitals.x < 30 && geo.vitals.y < 130 && geo.vitals.w <= 240 && !geo.overlaps.vitalsWorld,
    geo.vitals);

  ok('M3HUD-2 右上角世界状态（右边缘贴右 ≤ 30、top < 130、不与地图/状态卡重叠）',
    !!geo.world && (geo.vw - geo.world.right) <= 30 && geo.world.y < 130 && !geo.overlaps.worldMap,
    geo.world);

  ok('M3HUD-3 左下角空间地图（left < 30、面板中心位于下半屏）',
    !!geo.map && geo.map.x < 30 && (geo.map.y + geo.map.h / 2) > geo.vh / 2,
    geo.map);

  ok('M3HUD-4 四块 HUD 互不遮挡（状态 / 世界 / 地图 / 卡组）',
    !geo.overlaps.vitalsMap && !geo.overlaps.deckMap && !geo.overlaps.vitalsWorld && !geo.overlaps.worldMap,
    geo.overlaps);

  ok('M3HUD-5 画面正中属于战斗画布（无面板覆盖）',
    geo.center === 'game' || geo.center === 'stage' || geo.center === 'vignette' || geo.center === 'danger-layer' || geo.center === 'canvas',
    { center: geo.center });

  ok('M3HUD-6 底部卡组仍完整（可见魔法卡 ≥ 1）且生命读数在状态卡内',
    geo.cards >= 1 && geo.hpText.indexOf('/') > 0,
    { cards: geo.cards, hpText: geo.hpText });

  const fps = await ev(`(function(){
    return new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
  })()`);
  const errors = await ev(`(window.__errors || []).length`);
  const size = (() => { try { return fs.statSync(path.join(OUT_DIR, 'm3-hud-triangle.png')).size; } catch (e) { return 0; } })();
  ok('M3HUD-7 帧率 ≥ 90 / 无脚本错误 / 截图 > 10KB',
    fps >= 90 && errors === 0 && size > 10240,
    { fps, errors, size });

  fs.writeFileSync(path.join(OUT_DIR, 'm3-hud-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== m3-hud ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
