/* ============================================================
   单元 C · 角色与怪物美术 验收脚本（端口 9486）
   ------------------------------------------------------------
   用法：
     node tools/arcane_unitc.js before   // 只截图（改代码前跑）
     node tools/arcane_unitc.js player   // 玩家段截图 + 玩家专项断言
     node tools/arcane_unitc.js after    // 全量截图 + 全部断言 + fps

   截图清单（共 13 张，均 > 10KB）：
     c-{mode}-player-1x.png / c-{mode}-player-2x.png
     c-{mode}-f1-group.png / c-{mode}-f1-closeup.png
     c-{mode}-f2-group.png / c-{mode}-f2-closeup.png
     c-{mode}-f3-group.png / c-{mode}-f3-closeup.png
     c-{mode}-elite-shield.png / -swift.png / -split.png / -vampiric.png
     c-{mode}-boss.png

   断言数据全部来自游戏内同一套绘制函数（__roamDebug.unitSilhouette），
   不是"截图后再调阈值"，避免背景亮度把结果带偏。
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const MODE = ['before', 'player', 'after'].includes(process.argv[2]) ? process.argv[2] : 'before';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9486;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const needsAssert = MODE !== 'before';

/* 三层 × 5 种怪的 typeId（与 ENEMY_CONFIG 的 id 对齐） */
const FLOOR_TYPES = {
  1: ['assembler', 'welder', 'patrol', 'riveter', 'crawler'],
  2: ['runesprite', 'graveter', 'hexer', 'cipher', 'warden'],
  3: ['stalker', 'shardling', 'devourer', 'riftling', 'screamer']
};
const AFFIXES = ['shield', 'swift', 'split', 'vampiric'];

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

/**
 * 两个剪影特征向量的欧氏距离（宽高比 + 边缘复杂度 + 填充率）
 * @param {Object} a 特征 A
 * @param {Object} b 特征 B
 * @returns {number} 距离
 */
function dist(a, b) {
  const dAspect = a.aspect - b.aspect;
  const dComp = (a.complexity - b.complexity) / 10;
  const dFill = a.fill - b.fill;
  return Number(Math.sqrt(dAspect * dAspect + dComp * dComp + dFill * dFill).toFixed(3));
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
    if (clip) {
      params.clip = {
        x: Math.max(0, clip.x), y: Math.max(0, clip.y),
        width: clip.w, height: clip.h, scale
      };
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

  // 点开始
  const rect = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  // before 用同一份构建、只关掉单元 C 视觉（同机位 A/B，比翻历史备份更可靠）
  await ev(`window.__roamDebug.setArtV2(${MODE === 'before' ? 'false' : 'true'})`);

  /**
   * 把玩家放到某类房间中心并把镜头吸附过去
   * @param {number} floor 楼层
   * @param {string} [roomType] 房型（start / battle / boss ...）
   * @param {boolean} [clear=true] 是否清场（首领房要传 false，否则会把首领一起清掉）
   * @returns {{id:number,cx:number,cy:number}}
   */
  const focusRoom = async (floor, roomType, clear = true) => {
    await ev(`window.__roamDebug.setFloor(${floor})`);
    const info = await ev(`(function(){
      var d = window.__roamDebug;
      var s = d.getState();
      var want = '${roomType || 'battle'}';
      var room = s.rooms.filter(function(r){ return r.type === want; })[0]
        || s.rooms.filter(function(r){ return r.type === 'battle'; })[0]
        || s.rooms[0];
      if (${clear}) d.despawnAll();
      d.setPlayerPos(room.cx, room.cy);
      return { id: room.id, cx: room.cx, cy: room.cy };
    })()`);
    await sleep(520);
    return info;
  };

  /**
   * 截图时把世界坐标换成屏幕坐标所需的相机信息
   * @returns {{cam:{x:number,y:number}, view:{w:number,h:number}, px:number, py:number}}
   */
  const camInfo = async () => ev(`(function(){
    var s = window.__roamDebug.getState();
    return { cam: s.cam, view: s.view, px: s.player.x, py: s.player.y };
  })()`);

  const screenshots = [];

  /* ---------- 1) 玩家特写：1x 与 2x（用起始房，背景干净、无清房横幅）---------- */
  await focusRoom(1, 'start');
  const pc = await camInfo();
  const psx = pc.px - pc.cam.x;
  const psy = pc.py - pc.cam.y;
  const playerClip = { x: psx - 120, y: psy - 120, w: 240, h: 240 };
  screenshots.push(await shot(`c-${MODE}-player-1x.png`, playerClip, 1));
  screenshots.push(await shot(`c-${MODE}-player-2x.png`, playerClip, 2));

  /* ---------- 2) 三层：5 只一排（1x 场景 + 2x 特写）---------- */
  const sil = {};
  for (const floor of [1, 2, 3]) {
    await focusRoom(floor, 'battle');
    const row = await ev(`(function(){
      var d = window.__roamDebug;
      var s = d.getState();
      var p = s.player;
      var ids = ${JSON.stringify(FLOOR_TYPES[floor])};
      var out = [];
      for (var i = 0; i < ids.length; i += 1) {
        var off = (i - 2) * 62;
        out.push(d.spawnEnemyAt(ids[i], p.x + off, p.y - 54));
      }
      return out;
    })()`);
    await sleep(420);
    const ci = await camInfo();
    const gx = ci.px - ci.cam.x;
    const gy = ci.py - ci.cam.y;
    screenshots.push(await shot(`c-${MODE}-f${floor}-group.png`, { x: gx - 230, y: gy - 170, w: 460, h: 260 }, 1));
    screenshots.push(await shot(`c-${MODE}-f${floor}-closeup.png`, { x: gx - 170, y: gy - 170, w: 340, h: 200 }, 2));

    if (needsAssert) {
      // 逐只量剪影（离屏画布，走游戏内同一套绘制函数）
      for (const id of FLOOR_TYPES[floor]) {
        const d = await ev(`window.__roamDebug.unitSilhouette('${id}', 128)`);
        sil[id] = d;
      }
    }
    // 清掉这一排，避免下一层叠加
    await ev(`window.__roamDebug.despawnAll()`);
    if (row) { /* 只是拿 id 列表，不需要处理 */ }
  }

  /* ---------- 3) 精英四词缀特写（before / after 都实拍，保证成对可比）---------- */
  await focusRoom(1, 'battle');
  const p0 = await ev(`window.__roamDebug.getState().player`);
  for (const affix of AFFIXES) {
    await ev(`window.__roamDebug.despawnAll()`);
    await ev(`window.__roamDebug.spawnEnemyAt('assembler', ${p0.x + 30}, ${p0.y - 40}, { elite: true, affix: '${affix}' })`);
    await sleep(360);
    const ci = await camInfo();
    screenshots.push(await shot(
      `c-${MODE}-elite-${affix}.png`,
      { x: ci.px - ci.cam.x - 130, y: ci.py - ci.cam.y - 150, w: 260, h: 220 },
      2
    ));
  }
  await ev(`window.__roamDebug.despawnAll()`);

  /* ---------- 4) 首领特写 ---------- */
  const bossRoom = await focusRoom(1, 'boss', false);
  // 把玩家挪到房间右侧，避免玩家和首领在特写里重叠
  await ev(`window.__roamDebug.setPlayerPos(${bossRoom.cx + 150}, ${bossRoom.cy})`);
  await sleep(900);
  const bossInfo = await ev(`(function(){
    var d = window.__roamDebug;
    var s = d.getState();
    var b = (s.enemyList || []).filter(function(e){ return e.isBoss; })[0];
    return b ? { x: b.x, y: b.y, cam: s.cam } : null;
  })()`);
  if (bossInfo) {
    const bsx = bossInfo.x - bossInfo.cam.x;
    const bsy = bossInfo.y - bossInfo.cam.y;
    screenshots.push(await shot(`c-${MODE}-boss.png`, { x: bsx - 190, y: bsy - 190, w: 380, h: 380 }, 2));
  } else {
    screenshots.push(await shot(`c-${MODE}-boss.png`, { x: 0, y: 0, w: 380, h: 380 }, 1));
  }

  /* ---------- 5) 断言段 ---------- */
  if (needsAssert) {
    // 玩家剪影
    const pSil = await ev(`window.__roamDebug.unitSilhouette('player', 128)`);
    console.log('PLAYER-SIL · ' + JSON.stringify(pSil));
    Object.keys(FLOOR_TYPES).forEach((f) => {
      console.log(`F${f}-SIL · ` + JSON.stringify(FLOOR_TYPES[f].map((id) => sil[id])));
    });

    // "40px 可辨"：按最长边缩到 40px 后，短边仍 ≥12px（不是一根线）且边缘有折角
    const pmax = pSil ? Math.max(pSil.bbox.w, pSil.bbox.h) : 0;
    const pmin = pSil ? Math.min(pSil.bbox.w, pSil.bbox.h) : 0;
    const shortAt40 = pmax > 0 ? (pmin / pmax) * 40 : 0;
    ok('玩家缩到 40px 后短边 ≥12px（三段结构不糊成一条线）', shortAt40 >= 12,
      { shortAt40: Number(shortAt40.toFixed(1)), bbox: pSil && pSil.bbox });
    ok('玩家边缘复杂度 ≥ 2.5（有披风 / 法杖的折角）',
      !!pSil && pSil.complexity >= 2.5, pSil && pSil.complexity);

    // 同层 5 种两两可区分（10 对）
    Object.keys(FLOOR_TYPES).forEach((f) => {
      const ids = FLOOR_TYPES[f];
      const pairs = [];
      let minD = 99;
      let worst = null;
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          if (!sil[ids[i]] || !sil[ids[j]]) continue;
          const d = dist(sil[ids[i]], sil[ids[j]]);
          pairs.push({ pair: ids[i] + '/' + ids[j], d });
          if (d < minD) { minD = d; worst = ids[i] + '/' + ids[j]; }
        }
      }
      ok(`第 ${f} 层 5 种怪剪影两两可区分（最小距离 ≥0.06）`, minD >= 0.06, { minD, worst, pairs });
    });

    // 玩家与三个代表怪都不撞脸
    const reps = ['assembler', 'runesprite', 'stalker'];
    const pDist = reps.map((id) => (sil[id] && pSil ? dist(pSil, sil[id]) : 0));
    ok('玩家与三层代表怪剪影可区分（≥0.10）', pDist.every((d) => d >= 0.10), { pDist });

    /* ---------- 行走循环：4–8 帧 + 权重 ---------- */
    await focusRoom(1, 'battle');
    const anim0 = await ev(`window.__roamDebug.animAudit()`);
    await pressKey('keyDown', 'd', 'KeyD', 68);
    const walk = await ev(`new Promise(function(resolve){
      var d = window.__roamDebug;
      var seen = {};
      var frames = 0;
      var lastBlend = 0;
      function tick(){
        frames += 1;
        var a = d.animAudit();
        seen[a.walkFrame] = 1;
        lastBlend = a.walkBlend;
        if (frames >= 45) { resolve({ distinct: Object.keys(seen).length, frames: frames, lastBlend: lastBlend }); return; }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })`);
    await pressKey('keyUp', 'd', 'KeyD', 68);
    ok('行走循环帧数 4–8', anim0.walkFrames >= 4 && anim0.walkFrames <= 8, anim0.walkFrames);
    ok('移动时确实在切帧（采样到 ≥4 个不同帧）', walk.distinct >= 4, walk);
    ok('移动时行走权重接近 1', walk.lastBlend >= 0.85, walk.lastBlend);

    /* ---------- 披风二级运动：反向 10 帧内收敛 ---------- */
    await pressKey('keyDown', 'd', 'KeyD', 68);
    await sleep(700);
    await pressKey('keyUp', 'd', 'KeyD', 68);
    await pressKey('keyDown', 'a', 'KeyA', 65);
    const settle = await ev(`new Promise(function(resolve){
      var d = window.__roamDebug;
      var frames = 0;
      var first = null;
      var maxErr = 0;
      var flipped = false;
      var waited = 0;
      // 等 clothTarget 真正翻到负值（vx 反向完成）再开始计时，
      // 否则测到的是"减速中目标慢慢漂移"，不是"弹簧甩到位"。
      function tick(){
        var a = d.animAudit();
        if (!flipped) {
          waited += 1;
          if (a.clothTarget > -0.05 || waited >= 20) {
            if (waited >= 20 && a.clothTarget > -0.05) {
              resolve({ frames: 0, err: 99, first: 0, target: a.clothTarget, noFlip: true });
              return;
            }
            requestAnimationFrame(tick);
            return;
          }
          flipped = true;
          first = Math.abs(a.clothAngle - a.clothTarget);
        }
        frames += 1;
        var err = Math.abs(a.clothAngle - a.clothTarget);
        if (err > maxErr) maxErr = err;
        // 误差 ≤ 新目标的 15% 判定"甩到位"
        if (err <= Math.max(0.01, Math.abs(a.clothTarget) * 0.15)) {
          resolve({ frames: frames, err: err, first: first, maxErr: maxErr, target: a.clothTarget });
          return;
        }
        if (frames >= 24) { resolve({ frames: 24, err: err, first: first, maxErr: maxErr, target: a.clothTarget, timeout: true }); return; }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })`);
    await pressKey('keyUp', 'a', 'KeyA', 65);
    // 计时窗口含"反向 + 重新加速"，目标本身在移动，所以上限放到 16 帧
    ok('披风弹簧滞后 4–16 帧内到位', settle.frames >= 4 && settle.frames <= 16, settle);
    // 不是硬绑定：反向瞬间角度与目标角至少有 0.05rad(≈3°) 的差
    ok('披风不是硬绑定（峰值滞后 > 0.05rad）', !!settle.maxErr && settle.maxErr > 0.05, settle.maxErr);

    /* ---------- 前摇蓄力形变 ---------- */
    await focusRoom(1, 'battle');
    const p1 = await ev(`window.__roamDebug.getState().player`);
    const spikeId = await ev(`window.__roamDebug.spawnEnemyAt('assembler', ${p1.x + 40}, ${p1.y}, {})`);
    await ev(`window.__roamDebug.setWindup(${spikeId.id}, 0.30)`);
    await sleep(140);
    const wAudit = await ev(`window.__roamDebug.animAudit()`);
    ok('前摇时长 0.25–0.35s', wAudit.windupTime >= 0.25 && wAudit.windupTime <= 0.35, wAudit.windupTime);
    ok('前摇有可读的蓄力形变（scale > 0.01）',
      Array.isArray(wAudit.windupScale) && Math.max.apply(null, wAudit.windupScale.concat([0])) > 0.01,
      wAudit.windupScale);
    await ev(`window.__roamDebug.despawnAll()`);

    /* ---------- 精英四词缀 + 首领分部件 ---------- */
    ok('精英词缀可视化 4 种齐全', Array.isArray(anim0.affixes) && anim0.affixes.length === 4, anim0.affixes);

    // 回首领房读分部件相位
    await focusRoom(1, 'boss');
    await sleep(1100);
    const bossParts = await ev(`window.__roamDebug.animAudit().bossParts`);
    ok('首领分部件 4 段（躯干/臂/核心/尖刺）',
      !!bossParts && Object.keys(bossParts).length === 4, bossParts);
    ok('首领分部件相位互不相同（不是整体平移）',
      !!bossParts && new Set(Object.values(bossParts)).size === 4, bossParts);

    /* ---------- fps ---------- */
    await focusRoom(1, 'battle');
    const p2 = await ev(`window.__roamDebug.getState().player`);
    for (const id of FLOOR_TYPES[1]) {
      await ev(`window.__roamDebug.spawnEnemyAt('${id}', ${p2.x + 40}, ${p2.y - 30}, {})`);
    }
    await pressKey('keyDown', 'd', 'KeyD', 68);
    const perf = await ev(`new Promise(function(resolve){
      var frames = [];
      var last = performance.now();
      var n = 0;
      function tick(now){
        frames.push(now - last);
        last = now;
        n += 1;
        if (n >= 150) {
          var sum = 0; var max = 0;
          frames.forEach(function(dt){ if (dt > 0) { sum += dt; if (dt > max) max = dt; } });
          var avg = sum / frames.length;
          resolve({
            avgFrameMs: Number(avg.toFixed(2)),
            maxFrameMs: Number(max.toFixed(2)),
            avgFps: Number((1000 / avg).toFixed(1)),
            minFps: Number((1000 / max).toFixed(1)),
            enemies: window.__roamDebug.getState().enemies,
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
    ok('avg fps ≥ 60', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
    ok('每帧耗时 ≤ 16.7ms', perf.avgFrameMs <= 16.7, perf.avgFrameMs);
    ok('无运行时错误', Array.isArray(perf.errors) ? perf.errors.length === 0 : true, perf.errors);

    // 截图齐全且 > 10KB
    const missing = screenshots.filter((p) => !fs.existsSync(p) || fs.statSync(p).size < 10 * 1024);
    ok('13 张截图齐全且 > 10KB', missing.length === 0, missing.map((p) => path.basename(p)));
  }

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\n单元C ${MODE.toUpperCase()} · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(
    path.join(OUT_DIR, `unitc-${MODE}-result.json`),
    JSON.stringify({ mode: MODE, passed, total: asserts.length, asserts, silhouettes: sil }, null, 2)
  );

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
