/* ============================================================
   A2 · 远景与纵深 验收脚本（端口 9481）
   ------------------------------------------------------------
   用法：
     node tools/arcane_a2.js before   // 只截图（A2 代码改动前跑）
     node tools/arcane_a2.js after    // 截图 + 专项断言 + fps

   机位规则（每层两张）：
     battle：setPlayerPos(房心) —— 房间本体为主，左右露出远景带
     edge  ：setPlayerPos(房间左墙内 70px) —— 相机贴左墙，左侧远景带最大化
   设备像素固定 1440×900 / dsf 1，保证 before / after 同缩放。
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const MODE = process.argv[2] === 'after' ? 'after' : 'before';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9481;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言结果并打印
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 附加信息（会 JSON 序列化）
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
}

/**
 * 把世界坐标矩形换算成屏幕矩形（含震屏偏移）
 * @param {Object} rect 世界矩形 {x,y,w,h}
 * @param {Object} cam 相机左上角
 * @param {number} shakeX 震屏 x
 * @param {number} shakeY 震屏 y
 * @returns {Object} 屏幕矩形
 */
function screenRect(rect, cam, shakeX, shakeY) {
  return {
    x: rect.x - cam.x + (shakeX || 0),
    y: rect.y - cam.y + (shakeY || 0),
    w: rect.w,
    h: rect.h
  };
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
   * 截一张图（可带裁切）
   * @param {string} name 文件名
   * @param {{x:number,y:number,width:number,height:number}} [clip] 裁切区域（CSS 像素）
   */
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) {
      params.clip = { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: clip.width, height: clip.height, scale: 1 };
    }
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

  /* 点击开始进入战斗 */
  const rect = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  const floors = [1, 2, 3];
  const audits = [];
  let perf = null;
  let shift = null;

  /**
   * 取本层用于截图的房间：优先"离地图边界至少有 260px"的战斗房，
   * 保证相机贴左墙时左侧确实还有世界可画（远景带不会被世界边界吃掉）。
   */
  const pickRoomExpr = `(function(){
    var d = window.__roamDebug;
    var s = d.getState();
    var W = s.world.w;
    var ok2 = function(r){ return r.x >= 260 && r.x + r.w <= W - 260; };
    var list = s.rooms.filter(function(r){ return r.type === 'battle' && ok2(r); });
    var room = list[0] || s.rooms.filter(function(r){ return r.type === 'battle'; })[0]
      || s.rooms.filter(function(r){ return r.type === 'elite'; })[0] || s.rooms[0];
    return room;
  })()`;

  for (const f of floors) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    const room = await ev(pickRoomExpr);

    /* 机位 1：房心 */
    await ev(`window.__roamDebug.setPlayerPos(${room.cx}, ${room.cy})`);
    await sleep(650);
    await shot(`a2-${MODE}-f${f}-battle.png`);

    /* 机位 2：贴左墙（相机随角色，左侧远景带最大化） */
    await ev(`window.__roamDebug.setPlayerPos(${room.x + 70}, ${room.cy})`);
    await sleep(650);
    await shot(`a2-${MODE}-f${f}-edge.png`);

    if (MODE === 'after') {
      const info = await ev(`(function(){
        var d = window.__roamDebug;
        var s = d.getState();
        var room = ${pickRoomExpr};
        d.setPlayerPos(room.cx, room.cy);
        var a = d.parallaxAudit();
        /* 地面延伸衰减：对每间房取"四边"里衰减最明显的一侧（16px vs 108px） */
        var decay = s.rooms.map(function(r){
          var best = -999, bn = 0, bf = 0;
          for (var side = 0; side < 4; side += 1) {
            var near = d.apronAlphaSample(r.id, 16, side);
            var far = d.apronAlphaSample(r.id, 108, side);
            if (near - far > best) { best = near - far; bn = near; bf = far; }
          }
          return { id: r.id, diff: best, near: bn, far: bf };
        });
        return { floor: s.floor, theme: a.theme, roomId: room.id, room: room, audit: a,
                 rooms: s.rooms, corridors: s.corridorRects, decay: decay };
      })()`);
      audits.push(info);
    }
  }

  if (MODE === 'after') {
    /* ---------- 视差位移差：房心 → 沿 x 移动 220px ---------- */
    const shiftTest = await ev(`(async function(){
      var d = window.__roamDebug;
      var s = d.getState();
      /* 选中"相机不会被世界边界夹住"的房间，保证位移测试真的产生相机位移 */
      var rooms = s.rooms.filter(function(r){ return r.cx > 900 && r.cx < 2000; });
      var room = rooms[0] || s.rooms[0];
      var waitFrame = function(){
        return new Promise(function(resolve){
          requestAnimationFrame(function(){ requestAnimationFrame(resolve); });
        });
      };
      d.setPlayerPos(room.cx, room.cy);
      await waitFrame();
      var a = d.parallaxAudit();
      d.setPlayerPos(room.cx + 300, room.cy);
      await waitFrame();
      var b = d.parallaxAudit();
      var camShift = b.cam.x - a.cam.x;
      var T = 512;
      var deltas = a.layers.map(function(l, i){
        var raw = b.layers[i].offsetX - l.offsetX;
        var w = ((raw % T) + T) % T;
        return Number((w > T / 2 ? T - w : w).toFixed(1));
      });
      return { from: a.layers.map(function(l){ return l.offsetX; }),
               to: b.layers.map(function(l){ return l.offsetX; }), deltas: deltas,
               camShift: camShift, factors: a.layers.map(function(l){ return l.factor; }) };
    })()`);
    shift = shiftTest;

    /* ---------- fps / 每帧耗时：按住 D 采样 150 帧 ---------- */
    await ev(`window.__roamDebug.setFloor(1)`);
    await pressKey('keyDown', 'd', 'KeyD', 68);
    perf = await ev(`new Promise(function(resolve){
      var frames = [];
      var last = performance.now();
      var n = 0;
      var warm = 0;
      var maxDraw = 0;
      function tick(now){
        /* 跳过前 20 帧（按键触发 / 首帧编译造成的假抖动），只量稳定段 */
        if (warm < 20) {
          warm += 1;
          last = now;
          requestAnimationFrame(tick);
          return;
        }
        frames.push(now - last);
        last = now;
        n += 1;
        var st = window.__roamDebug.getState();
        var par = st.parallax || null;
        if (par && par.drawMs != null && par.drawMs > maxDraw) maxDraw = par.drawMs;
        if (n >= 150) {
          var sum = 0, max = 0, min = 1e9;
          frames.forEach(function(dt){
            if (dt <= 0) return;
            sum += dt;
            if (dt > max) max = dt;
            if (dt < min) min = dt;
          });
          var avg = sum / frames.length;
          var s = window.__roamDebug.getState();
          resolve({
            frames: frames.length,
            avgFrameMs: Number(avg.toFixed(2)),
            maxFrameMs: Number(max.toFixed(2)),
            minFrameMs: Number(min.toFixed(2)),
            avgFps: Number((1000 / avg).toFixed(1)),
            minFps: Number((1000 / max).toFixed(1)),
            scenePatch: s.scenePatch,
            view: s.view,
            drawStats: s.drawStats,
            parallax: s.parallax || null,
            maxParallaxDrawMs: Number(maxDraw.toFixed(2)),
            fogSeen: s.fog ? s.fog.seenRooms : null,
            errors: window.__roamDebug.errors()
          });
        } else {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
    })`);
    await pressKey('keyUp', 'd', 'KeyD', 68);
    console.log('PERF · ' + JSON.stringify(perf));

    /* ---------- 断言 ---------- */
    const expected = { 1: 'mech', 2: 'rune', 3: 'void' };

    /* 1) 三层存在 + factor 正确 */
    audits.forEach((item) => {
      const a = item.audit;
      ok(`第 ${item.floor} 层主题 = ${expected[item.floor]}`, item.theme === expected[item.floor], { theme: item.theme });
      ok(`第 ${item.floor} 层视差为 3 层`, !!a && a.layers.length === 3, a ? a.layers.map((l) => l.id) : null);
      ok(`第 ${item.floor} 层视差 factor 符合配置`,
        !!a && a.layers.every((l, i) => Math.abs(l.factor - [0.16, 0.38, 0.66][i]) <= 0.02),
        a ? a.layers.map((l) => l.factor) : null);
      /* 2) 远近亮度梯度 far < mid < near */
      const lum = a ? a.layers.map((l) => l.meanLum) : [0, 0, 0];
      ok(`第 ${item.floor} 层远近亮度梯度 far<mid<near`,
        lum[0] < lum[1] && lum[1] < lum[2] && (lum[2] - lum[0]) >= 4,
        { far: lum[0], mid: lum[1], near: lum[2] });
      /* 3) 主题配色：远层均色 */
      const far = a ? a.layers[0].meanRgb : [0, 0, 0];
      const themeOk = expected[item.floor] === 'rune' ? far[0] > far[1]
        : expected[item.floor] === 'void' ? far[2] > far[0] : far[2] >= far[0];
      ok(`第 ${item.floor} 层远景配色与主题一致`, themeOk, { farRgb: far });
      /* 4) 不遮挡 */
      const cov = a ? a.coverage : null;
      ok(`第 ${item.floor} 层挖洞覆盖全部可交互区域`,
        !!cov && cov.rooms && cov.corridors && cov.hiddenRoom && cov.player
        && cov.pickups && cov.stairs && cov.doors && cov.rift,
        cov);
      ok(`第 ${item.floor} 层挖洞数量 ≥ 房间 + 走廊 + 秘藏房`,
        !!a && a.holes.total >= item.rooms.length + item.corridors + (a.holes.hidden > 0 ? 1 : 0),
        a ? { holes: a.holes.total, rooms: item.rooms.length, corridors: item.corridors, hidden: a.holes.hidden } : null);
      /* 5) 地面延伸 */
      ok(`第 ${item.floor} 层地面延伸覆盖全部房间`,
        !!a && a.apron && a.apron.rooms === item.rooms.length && a.apron.width === 120,
        a ? a.apron : null);
      const decayOk = item.decay.filter((d) => d.diff >= 25).length;
      ok(`第 ${item.floor} 层地面延伸向外衰减（≥5 间房 near-far ≥ 25）`,
        decayOk >= Math.min(5, item.decay.length), { pass: decayOk, total: item.decay.length, sample: item.decay.slice(0, 3) });
      /* 6) 景深 */
      const tiers = a && a.depth ? a.depth.dustTiers : [0, 0, 0];
      ok(`第 ${item.floor} 层尘埃 3 档齐备`, Array.isArray(tiers) && tiers.filter((n) => n > 0).length === 3, tiers);
      ok(`第 ${item.floor} 层碎片 / 掉落物各 3 档`,
        !!a && a.depth && a.depth.debris.length === 3 && a.depth.pickup.length === 3, a ? a.depth : null);
    });

    /* 7) ≥3 档位移差 */
    const d = shift ? shift.deltas : [0, 0, 0];
    ok('位移差测试前提：相机确实移动 ≥ 200px', !!shift && shift.camShift >= 200, shift ? { camShift: shift.camShift } : null);
    ok('视差随相机位移产生 ≥3 档位移差',
      d.length === 3 && Math.abs(d[0]) > 0 && d[0] < d[1] && d[1] < d[2]
      && (d[1] - d[0]) >= 30 && (d[2] - d[1]) >= 30,
      shift);

    /* 8) 性能 */
    ok('avg fps ≥ 60', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
    ok('每帧耗时 ≤ 16.7ms', perf.avgFrameMs <= 16.7, { avgFrameMs: perf.avgFrameMs, maxFrameMs: perf.maxFrameMs });
    ok('视差每帧成本 ≤ 3.5ms', perf.parallax && perf.parallax.drawMsAvg <= 3.5,
      perf.parallax ? { drawMsAvg: perf.parallax.drawMsAvg, max: perf.maxParallaxDrawMs } : null);
    ok('贴图裁剪仍生效（只贴镜头附近一块）',
      !!perf.scenePatch && perf.scenePatch.w <= perf.view.w + 48 && perf.scenePatch.h <= perf.view.h + 48,
      perf.scenePatch);
    ok('迷雾正常（已探索房间 ≥ 1）', perf.fogSeen >= 1, { fogSeen: perf.fogSeen });
    ok('无运行时错误', Array.isArray(perf.errors) ? perf.errors.length === 0 : true, perf.errors);

    /* 9) 截图 */
    const names = [];
    floors.forEach((f) => { names.push(`a2-before-f${f}-battle.png`, `a2-before-f${f}-edge.png`, `a2-after-f${f}-battle.png`, `a2-after-f${f}-edge.png`); });
    const missing = names.filter((n) => {
      const p = path.join(OUT_DIR, n);
      return !fs.existsSync(p) || fs.statSync(p).size < 10 * 1024;
    });
    ok('12 张 A2 before/after 截图齐全且 > 10KB', missing.length === 0, missing);
  } else {
    /* before 模式：只校验 6 张截图 */
    const names = floors.flatMap((f) => [`a2-before-f${f}-battle.png`, `a2-before-f${f}-edge.png`]);
    const missing = names.filter((n) => {
      const p = path.join(OUT_DIR, n);
      return !fs.existsSync(p) || fs.statSync(p).size < 10 * 1024;
    });
    ok('6 张 A2 before 截图齐全且 > 10KB', missing.length === 0, missing);
  }

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nA2 ${MODE.toUpperCase()} · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(
    path.join(OUT_DIR, `a2-${MODE}-result.json`),
    JSON.stringify({ mode: MODE, passed, total: asserts.length, asserts, perf, audits, shift }, null, 2)
  );

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
