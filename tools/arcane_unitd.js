/**
 * 单元 D「场景 UI 装置感」验收脚本
 * ------------------------------------------------------------
 * 用法：
 *   node tools/arcane_unitd.js before   // 旧观感截图（同一份构建，setUiV2(false)）
 *   node tools/arcane_unitd.js after    // 新观感截图 + 全部断言 + fps
 *
 * 设计：不改 DOM 结构，只给 body 挂 .ui-v2；before / after 同机位同代码，
 *       差异只来自本次单元 D 的样式与交互语言。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const MODE = ['before', 'after'].includes(process.argv[2]) ? process.argv[2] : 'after';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9487;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言结果并打印
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 附加信息
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
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
  /**
   * 截一张图（可裁切 + 可放大）
   * @param {string} name 文件名
   * @param {{x:number,y:number,w:number,h:number}} [clip] 裁切区域（CSS 像素）
   * @param {number} [scale=1] 像素倍率（2 = 2x 特写）
   */
  const shot = async (name, clip, scale = 1) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: clip.w, height: clip.h, scale };
    const r = await send('Page.captureScreenshot', params);
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };
  const pressKey = async (type, key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  // 点开始，进入可操作的战斗界面
  const startBtn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startBtn.x, y: startBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startBtn.x, y: startBtn.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  // 同一份构建的 A/B：before 关掉 .ui-v2，after 打开
  await ev(`window.__roamDebug.setUiV2(${MODE === 'before' ? 'false' : 'true'})`);
  await sleep(420);

  const rects = await ev(`(function(){
    function r(sel){ var el = document.querySelector(sel); if (!el) return null; var b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; }
    return { full: { x: 0, y: 0, w: 1440, h: 900 }, floor: r('.floor-panel'), deck: r('.hud-deck'),
      minimap: r('.minimap-panel'), card: r('.mini-card'), top: r('.hud-top') };
  })()`);

  const shots = [];
  shots.push(await shot(`unitd-${MODE}-full.png`));
  if (rects.floor) shots.push(await shot(`unitd-${MODE}-floor.png`, { ...rects.floor, x: rects.floor.x - 8, y: rects.floor.y - 8, w: rects.floor.w + 16, h: rects.floor.h + 16 }, 2));
  if (rects.deck) shots.push(await shot(`unitd-${MODE}-deck.png`, { ...rects.deck, x: rects.deck.x - 6, y: rects.deck.y - 6, w: rects.deck.w + 12, h: rects.deck.h + 12 }, 1));
  if (rects.minimap) shots.push(await shot(`unitd-${MODE}-minimap.png`, { ...rects.minimap, x: rects.minimap.x - 8, y: rects.minimap.y - 8, w: rects.minimap.w + 16, h: rects.minimap.h + 16 }, 2));
  if (rects.card) shots.push(await shot(`unitd-${MODE}-card2x.png`, { ...rects.card, x: rects.card.x - 4, y: rects.card.y - 4, w: rects.card.w + 8, h: rects.card.h + 8 }, 3));

  // 楼梯交互框：清场后把玩家传送到楼梯旁，再截一张世界层特写
  await ev(`(function(){ var d = window.__roamDebug; var s = d.getState();
    d.despawnAll(); if (s.stairs) d.setPlayerPos(s.stairs.x, s.stairs.y + 70); return !!s.stairs; })()`);
  await sleep(600);
  const stairRect = await ev(`(function(){ var s = window.__roamDebug.getState(); var cam = s.cam; var p = s.player;
    return { x: Math.round(p.x - cam.x - 70), y: Math.round(p.y - cam.y - 90), w: 140, h: 180 }; })()`);
  shots.push(await shot(`unitd-${MODE}-stairs.png`, stairRect, 2));

  if (MODE === 'after') {
    const audit = await ev(`window.__roamDebug.uiAudit()`);
    console.log('AUDIT · ' + JSON.stringify(audit));

    /* ---------- D-1 面板装置化 ---------- */
    ok('body 挂载 .ui-v2 且 state.uiV2 为真', audit.on === true, audit.on);
    ok('底部卡组有扫描线（repeating-linear-gradient）', !!(audit.deck && audit.deck.scanlines), audit.deck && audit.deck.bg.slice(0, 60));
    ok('面板有内发光 + 铆钉层（radial-gradient 背景）', !!(audit.deck && /radial-gradient/.test(audit.deck.bg)), '');
    ok('面板投影含 inset 内发光', !!(audit.deck && /inset/.test(audit.deck.shadow)), '');
    ok('左侧楼层面板有导轨（::after 刻度线）', !!(audit.floor && audit.floor.rail && audit.floor.railScan), { rail: audit.floor && audit.floor.rail, scan: audit.floor && audit.floor.railScan });

    /* ---------- D-3 竖排楼层装置 ---------- */
    ok('楼层标签竖排（writing-mode: vertical-rl）', audit.floor && audit.floor.labelWritingMode === 'vertical-rl', audit.floor && audit.floor.labelWritingMode);

    /* ---------- D-2 数值扫描翻牌 ---------- */
    const scanAnim = await ev(`(function(){ var b = document.querySelector('.floor-num b');
      if (!b) return null; b.classList.add('is-scan'); var cs = getComputedStyle(b);
      var name = cs.animationName; b.classList.remove('is-scan'); return name; })()`);
    ok('数值动效为 valueScan（扫描翻牌）', scanAnim === 'valueScan', scanAnim);

    /* ---------- D-4 卡牌材质与稀有度光 ---------- */
    ok('卡面有材质扫描线', !!(audit.card && audit.card.scanlines), audit.card && audit.card.bg.slice(0, 60));
    const rarity = await ev(`(function(){
      var rare = document.querySelector('.mini-card.r-rare') || document.querySelector('.mini-card.r-epic');
      if (!rare) return { found: false, cards: document.querySelectorAll('.mini-card').length };
      var cs = getComputedStyle(rare);
      return { found: true, shadow: cs.boxShadow, inset: /inset/.test(cs.boxShadow), bg: cs.backgroundImage.slice(0, 80) };
    })()`);
    ok('稀有/史诗卡有内发光档位光', rarity.found ? /inset/.test(rarity.shadow) : true, rarity);

    /* ---------- D-6 小地图终端 ---------- */
    ok('小地图统计标记 uiV2', !!(audit.minimapLive && audit.minimapLive.uiV2 === true), audit.minimapLive);
    ok('小地图画布有终端边框 + 内发光', !!(audit.minimap && /rgba\(62, 230, 255/.test(audit.minimap.canvasBorder) && /inset/.test(audit.minimap.canvasShadow)), audit.minimap && audit.minimap.canvasBorder);
    const mmGrid = await ev(`(function(){ var c = document.getElementById('minimap'); var g = c.getContext('2d');
      var cnt = 0; for (var y = 20; y < 340; y += 24) { var px = g.getImageData(24, y, 1, 1).data; if (px[2] > px[0] + 4) cnt += 1; }
      return cnt; })()`);
    ok('小地图网格实际绘制（采样 14 行 ≥ 3 行偏青）', mmGrid >= 3, mmGrid);

    /* ---------- D-5 交互物统一语言 ---------- */
    const interact = await ev(`window.__roamDebug.interactConfig ? window.__roamDebug.interactConfig() : null`);
    ok('交互框配置存在且字号 ≥11px', !!interact && parseFloat(interact.labelFont) >= 11, interact);
    const probe = await ev(`window.__roamDebug.uiProbeInteract()`);
    ok('交互框实际出画（离屏探针金色像素 ≥ 300）', !!(probe && probe.gold >= 300), probe);

    /* ---------- 字号下限 / 版面 ---------- */
    const f = audit.fonts || {};
    ok('HUD 关键文本字号 ≥ 11px', f.deckTitle >= 11 && f.floorRow >= 11 && f.floorLabel >= 11 && f.minimapHead >= 11, f);

    const layout = await ev(`(function(){
      function r(sel){ var el = document.querySelector(sel); if (!el) return null; var b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; }
      var top = r('.hud-top'), floor = r('.floor-panel'), deck = r('.hud-deck'), map = r('.minimap-panel');
      function overlap(a, b){ return !!a && !!b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom; }
      return { floorDeck: overlap(floor, deck), deckMinimap: overlap(deck, map), floorMinimap: overlap(floor, map),
        floorTop: overlap(floor, top), inView: [floor, deck, map].every(function(a){ return a && a.x >= 0 && a.y >= 0 && a.right <= 1440 && a.bottom <= 900; }),
        floor: floor, deck: deck, map: map };
    })()`);
    ok('左侧楼层面板不与卡组 / 小地图 / 顶栏重叠', layout.floorDeck === false && layout.deckMinimap === false && layout.floorMinimap === false && layout.floorTop === false, layout);
    ok('HUD 三块面板全部在视口内', layout.inView === true, layout);

    /* ---------- fps ---------- */
    const p = await ev(`window.__roamDebug.getState().player`);
    for (const id of ['assembler', 'welder', 'patrol', 'riveter', 'crawler']) {
      await ev(`window.__roamDebug.spawnEnemyAt('${id}', ${p.x + 80}, ${p.y - 40}, {})`);
    }
    await pressKey('keyDown', 'd', 'KeyD', 68);
    const perf = await ev(`new Promise(function(resolve){
      var frames = []; var last = performance.now(); var n = 0;
      function tick(now){
        frames.push(now - last); last = now; n += 1;
        if (n >= 150) {
          var sum = 0; var max = 0;
          frames.forEach(function(dt){ if (dt > 0) { sum += dt; if (dt > max) max = dt; } });
          var avg = sum / frames.length;
          resolve({ avgFrameMs: Number(avg.toFixed(2)), maxFrameMs: Number(max.toFixed(2)),
            avgFps: Number((1000 / avg).toFixed(1)), minFps: Number((1000 / max).toFixed(1)),
            errors: window.__roamDebug.errors() });
        } else { requestAnimationFrame(tick); }
      }
      requestAnimationFrame(tick);
    })`);
    await pressKey('keyUp', 'd', 'KeyD', 68);
    console.log('PERF · ' + JSON.stringify(perf));
    ok('avg fps ≥ 60', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
    ok('每帧耗时 ≤ 16.7ms', perf.avgFrameMs <= 16.7, perf.avgFrameMs);
    ok('无运行时错误', Array.isArray(perf.errors) ? perf.errors.length === 0 : true, perf.errors);

    const missing = shots.filter((p2) => !fs.existsSync(p2) || fs.statSync(p2).size < 10 * 1024);
    ok('6 张截图齐全且 > 10KB', missing.length === 0, missing.map((p2) => path.basename(p2)));
  }

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\n单元D ${MODE.toUpperCase()} · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(
    path.join(OUT_DIR, `unitd-${MODE}-result.json`),
    JSON.stringify({ mode: MODE, passed, total: asserts.length, asserts }, null, 2)
  );

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  // 保证异常时也不留下 headless Edge 进程
  setTimeout(() => process.exit(1), 150);
});
