/**
 * X 批 · 迷雾"路的虚影"排除实验探针
 * ------------------------------------------------------------
 * 用法：
 *   node tools/_fog_probe.js <html> <outDir>
 *   node tools/_fog_probe.js <html> <outDir> --baseline-only
 *
 * 做什么：
 *   1. 进入第 6 层、把玩家放到第一间非出生房、清空敌人（固定机位）
 *   2. 依次只改一个变量，各自截一张全屏图，并测量"屏幕内最大未探索房"的亮度
 *      ① alpha=1  ② 泛光关  ③ 远景/地面延伸带关  ④ 未探索标记关  ⑤ 地面砖缝关
 *   3. 输出 measurements.json（每项 max/avg/p99）与 6 张 PNG
 *
 * 为什么要用原始表达式而不是 fogLab：
 *   旧包（dist/emberfall_v1.3.1）没有 fogLab，本探针要在新旧两版上跑同一份逻辑，
 *   所以只依赖两个版本都有的全局：FOG_CONFIG / resetFog / PARALLAX_CONFIG / state。
 *
 * 端口 9593；dpr=2（截图 3200×1800，测量按 CSS 像素换算）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9593;
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面内：在固定矩形内统计亮度；首次调用时锁定"屏幕内面积最大的未探索房间" */
const MEASURE_EXPR = `(function(){
  var z = cameraZoom();
  var best = window.__fogRect || null;
  if (!best) {
    (state.rooms || []).forEach(function(r){
      if (!r || r.visited) return;
      if (state.fog && state.fog.seenRooms && state.fog.seenRooms[r.id]) return;
      var sx = (r.cx - r.w / 2 - state.cam.x) * z;
      var sy = (r.cy - r.h / 2 - state.cam.y) * z;
      var sw = r.w * z, sh = r.h * z;
      var x0 = Math.max(sx, 0), y0 = Math.max(sy, 0);
      var x1 = Math.min(sx + sw, window.innerWidth), y1 = Math.min(sy + sh, window.innerHeight);
      var iw = x1 - x0, ih = y1 - y0;
      if (iw < 120 || ih < 90) return;
      if (!best || iw * ih > best.iw * best.ih) best = { x: x0, y: y0, iw: iw, ih: ih, id: r.id };
    });
    window.__fogRect = best;
  }
  if (!best) return null;
  var c = document.getElementById('game');
  var dpr = c.width / window.innerWidth;
  var pad = 26;
  var data = c.getContext('2d').getImageData(
    Math.round((best.x + pad) * dpr), Math.round((best.y + pad) * dpr),
    Math.max(1, Math.round((best.iw - pad * 2) * dpr)), Math.max(1, Math.round((best.ih - pad * 2) * dpr)
    )
  ).data;
  var lums = [], sum = 0;
  for (var i = 0; i < data.length; i += 4) {
    var l = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    lums.push(l); sum += l;
  }
  lums.sort(function(a, b){ return a - b; });
  return {
    rect: { x: Math.round(best.x), y: Math.round(best.y), w: Math.round(best.iw), h: Math.round(best.ih) },
    roomId: best.id,
    max: Number(lums[lums.length - 1].toFixed(1)),
    avg: Number((sum / lums.length).toFixed(1)),
    p99: Number(lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.99))].toFixed(1)),
    px: lums.length,
    alpha: FOG_CONFIG.alpha,
    markers: (typeof UNEXPLORED_HINT_CONFIG !== 'undefined') ? !!UNEXPLORED_HINT_CONFIG.enabled : true,
    secondPass: !!FOG_CONFIG.secondPass,
    parallax: !!PARALLAX_CONFIG.enabled,
    bloom: !!(state.meta && state.meta.postfx && state.meta.postfx.bloom)
  };
})()`;

async function main() {
  const FILE = path.resolve(process.argv[2] || path.join(ROOT, 'index_arcane_v2.html'));
  const OUT = process.argv[3] || path.join(ROOT, '.screenshots', 'fog');
  const baselineOnly = process.argv.includes('--baseline-only');
  fs.mkdirSync(OUT, { recursive: true });

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1600,900', 'about:blank'
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

  /**
   * 发送 CDP 命令
   * @param {string} method 方法名
   * @param {Object} [params] 参数
   * @returns {Promise<Object>}
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  /**
   * 页面内执行表达式并取返回值
   * @param {string} expression JS 表达式
   * @returns {Promise<*>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1200);
  // 等标题页真的挂载（2.5MB 单文件在 headless 里偶尔要 3–5 秒）
  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    ready = await ev(`!!document.getElementById('btnStart')`);
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('标题页未挂载: ' + await ev('document.title + "|" + document.readyState'));
  await sleep(900);

  // 开始一局
  const startPos = await ev(`(function(){
    var el = document.getElementById('btnStart');
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(800);

  // 固定机位：第 6 层第一间非出生房，清怪、锁定朝向
  const setup = await ev(`(function(){
    var d = window.__roamDebug;
    if (typeof XP_CONFIG !== 'undefined') XP_CONFIG.enabled = false;
    for (var i = 0; i < 40 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    d.setFloor(6);
    for (var k = 0; k < 40 && state.mode === 'reward'; k += 1) closeRewardFlow(true);
    var rooms = state.rooms || [];
    var pick = null;
    rooms.forEach(function(r){ if (!pick && r.type !== 'start') pick = r; });
    if (!pick) pick = rooms[0];
    if (pick && d.teleport) d.teleport(pick.cx, pick.cy); else d.centerPlayer();
    state.enemies = [];
    state.player.invuln = 99999;
    state.player.facingAngle = 0;
    if (d.centerPlayer) d.centerPlayer();
    render();
    return { floor: state.floor, mode: state.mode, rooms: rooms.length, px: state.player.x, py: state.player.y };
  })()`);
  console.log('SETUP ' + JSON.stringify(setup));
  await sleep(1800);
  /* 等提示条淡出，避免 HUD 文字干扰亮度统计 */
  await sleep(900);

  // 记录原始配置，每个变量测完都恢复到"本构建的默认"，保证单变量对比
  await ev(`(function(){
    window.__fogOrig = {
      alpha: FOG_CONFIG.alpha,
      secondPass: !!FOG_CONFIG.secondPass,
      parallax: !!PARALLAX_CONFIG.enabled,
      bloom: !!(state.meta && state.meta.postfx && state.meta.postfx.bloom),
      markers: (typeof UNEXPLORED_HINT_CONFIG !== 'undefined') ? !!UNEXPLORED_HINT_CONFIG.enabled : true
    };
    return window.__fogOrig;
  })()`);

  /**
   * 截一张全屏图 + 测量，并打印一行
   * @param {string} name 文件名（不含 .png）
   * @returns {Promise<Object>} 测量结果
   */
  const shoot = async (name) => {
    await sleep(260);
    const m = await ev(MEASURE_EXPR);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
    console.log(name.padEnd(18) + ' ' + JSON.stringify(m));
    return m;
  };

  const results = {};
  results.baseline = await shoot('00_baseline');
  /* 边界羽化带：跨当前房间左边界采样 ±16px，用来证明过渡 ≤8px 且单调 */
  const edge = await ev(`(function(){
    var z = cameraZoom(), r = state.room;
    if (!r) return null;
    var c = document.getElementById('game'), dpr = c.width / window.innerWidth;
    var gx = c.getContext('2d');
    var y = Math.round((r.cy - state.cam.y) * z * dpr);
    var x0 = ((r.cx - r.w / 2) - state.cam.x) * z;
    var out = [];
    for (var k = -16; k <= 16; k += 2) {
      var sx = Math.round((x0 + k) * dpr);
      var px = gx.getImageData(Math.max(0, sx), Math.max(0, y), 1, 1).data;
      out.push({ dx: k, lum: Number((px[0] * 0.2126 + px[1] * 0.7152 + px[2] * 0.0722).toFixed(1)) });
    }
    return { boundaryScreenX: Math.round(x0), samples: out };
  })()`);
  results.edgeProfile = edge;
  console.log('EDGE ' + JSON.stringify(edge));

  if (!baselineOnly) {
    // ① alpha = 1（旧包默认 0.985）
    await ev(`(function(){
      FOG_CONFIG.alpha = 1;
      if (typeof resetFog === 'function' && state.room) resetFog(state.room);
      return FOG_CONFIG.alpha;
    })()`);
    results.alpha1 = await shoot('01_alpha1');
    await ev(`(function(){
      FOG_CONFIG.alpha = window.__fogOrig.alpha;
      if (typeof resetFog === 'function' && state.room) resetFog(state.room);
      return FOG_CONFIG.alpha;
    })()`);
    await sleep(400);

    // ② 泛光关
    await ev(`(function(){
      if (!state.meta.postfx) state.meta.postfx = {};
      state.meta.postfx.bloom = false;
      return state.meta.postfx.bloom;
    })()`);
    results.bloomOff = await shoot('02_bloom_off');
    await ev(`(function(){ state.meta.postfx.bloom = window.__fogOrig.bloom; return true; })()`);
    await sleep(300);

    // ③ 远景层 + 地面延伸带关
    await ev(`(function(){ PARALLAX_CONFIG.enabled = false; return PARALLAX_CONFIG.enabled; })()`);
    results.apronOff = await shoot('03_apron_off');
    await ev(`(function(){ PARALLAX_CONFIG.enabled = window.__fogOrig.parallax; return true; })()`);
    await sleep(400);

    // ④ 未探索标记关（旧包没有 UNEXPLORED_HINT_CONFIG，用 visited 临时骗过绘制）
    const markRes = await ev(`(function(){
      if (typeof UNEXPLORED_HINT_CONFIG !== 'undefined') { UNEXPLORED_HINT_CONFIG.enabled = false; return 'config'; }
      window.__fogVisitedBackup = (state.rooms || []).map(function(r){ return !!r.visited; });
      (state.rooms || []).forEach(function(r){ r.visited = true; });
      return 'visited';
    })()`);
    results.markersOff = await shoot('04_markers_off');
    await ev(`(function(){
      if (typeof UNEXPLORED_HINT_CONFIG !== 'undefined') { UNEXPLORED_HINT_CONFIG.enabled = window.__fogOrig.markers; return true; }
      (state.rooms || []).forEach(function(r, i){ r.visited = window.__fogVisitedBackup[i]; });
      render();
      return true;
    })()`);
    console.log('markers-mode=' + markRes);
    await sleep(400);

    // ⑤ 地面砖缝关（乘数 0 后重新烘焙场景）
    const seamRes = await ev(`(function(){
      if (typeof SCENE_READ_CONFIG === 'undefined') return 'no-config';
      SCENE_READ_CONFIG.seamMul = 0;
      SCENE_READ_CONFIG.gridMul = 0;
      if (typeof bakeScene === 'function') bakeScene();
      return 'ok';
    })()`);
    results.seamOff = await shoot('05_seam_off');
    console.log('seam-mode=' + seamRes);

    // ⑥ 旧观感复现：把本构建切回 v1.3.1 的四个参数，得到"同一机位、同一份代码"的 before
    await ev(`(function(){
      FOG_CONFIG.alpha = 0.985;
      FOG_CONFIG.secondPass = false;
      if (typeof UNEXPLORED_HINT_CONFIG !== 'undefined') UNEXPLORED_HINT_CONFIG.enabled = true;
      if (typeof SCENE_READ_CONFIG !== 'undefined') { SCENE_READ_CONFIG.seamMul = 1; SCENE_READ_CONFIG.gridMul = 1; }
      if (typeof bakeScene === 'function') bakeScene();
      if (typeof resetFog === 'function' && state.room) resetFog(state.room);
      return true;
    })()`);
    await sleep(500);
    results.legacyV131 = await shoot('06_legacy_v1.3.1');
  }

  // 判定：找出"唯一让 max 掉到 ≤12"的单变量
  const baseMax = results.baseline ? results.baseline.max : null;
  const culprits = Object.keys(results).filter((k) => k !== 'baseline' && results[k] && results[k].max <= 12);
  const report = {
    file: FILE,
    viewport: '1600x900@2x',
    baseline: results.baseline,
    results,
    verdict: {
      baselineMax: baseMax,
      culprits,
      unique: culprits.length === 1 ? culprits[0] : null,
      note: baseMax !== null && baseMax <= 12
        ? ('本构建基线已达标（max=' + baseMax + ' ≤12），单变量对比无意义')
        : (culprits.length === 1
          ? ('唯一元凶：' + culprits[0])
          : (culprits.length === 0 ? '没有任何单变量能压到 ≤12' : ('多个单变量都有效：' + culprits.join(', '))))
    }
  };
  fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(report, null, 2));
  console.log('VERDICT ' + JSON.stringify(report.verdict));

  ws.close();
  killEdge(edge);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
