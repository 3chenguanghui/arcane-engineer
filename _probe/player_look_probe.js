/**
 * 人物造型 A/B 体检（只读探针，不改任何玩法数值）
 * ------------------------------------------------------------------
 * 量四件事，全部在同一机位（战斗房正中、相机居中）取样：
 *   1) 地板参考亮度 floorL（取画面四角 12×12 中位数，远离角色光晕）
 *   2) 角色最亮/最暗亮度 maxL / minL（半径 ≤22 世界像素的圆盘内）
 *   3) 轮廓亮度差：contrastUp = maxL-floorL、contrastDown = floorL-minL
 *   4) 边界梯度 edgeGrad：72 条射线从 8→28 世界像素扫描，取每条射线的
 *      最大相邻亮度跳变，再取均值/最小值 —— 越大说明"剪影边缘越切得开"
 * 另存同机位特写两张，并打印造型配置（披风长度/摆角/描边宽度）。
 *
 * 用法：
 *   node _probe/player_look_probe.js after
 *   ARCANE_MAIN=_backup\feely_20261110\index_arcane_v2.before_player.html node _probe/player_look_probe.js before
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'look';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-look-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const PORT = 9300 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge 可执行文件 */
function findEdge() { for (const p of EDGE) if (fs.existsSync(p)) return p; throw new Error('找不到 msedge.exe'); }

/** 启动 headless Edge 并连上 CDP，返回 {send, ev, shot, close} */
async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  spawn(findEdge(), [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  /** 在页面里求值并带回结果 */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };
  /** 截当前画面（可带裁剪区域；scale>1 放大采样，用来看清像素级描边） */
  const shot = async (name, clip, scale) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.w), height: Math.round(clip.h), scale: scale || 1 };
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return name;
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进游戏、选角色、传送到战斗房正中，并清空敌人避免遮挡测量 */
async function enter(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    if (await ev(`(() => { const b = document.getElementById('btnStart'); return !!(b && b.getBoundingClientRect().width > 0); })()`) === true) break;
    await sleep(150);
  }
  /* 固定随机源：before/after 两次运行用同一颗种子，房间装饰/地板纹理才会一致，
     否则地板基准亮度会随生成结果漂移，把"人物的变化"淹没在场景差异里。 */
  await ev(`(() => { let s = 20261110; Math.random = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; return 1; })()`);
  await ev(`(() => { document.getElementById('btnStart').click(); return 1; })()`);
  for (let i = 0; i < 60; i += 1) { if (await ev(`(() => !!document.querySelector('.char-card'))()`) === true) break; await sleep(120); }
  await ev(`(() => { document.querySelector('.char-card').click(); return 1; })()`);
  await sleep(200);
  await ev(`(() => { document.getElementById('btnCharConfirm').click(); return 1; })()`);
  for (let i = 0; i < 200; i += 1) {
    const st = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return null; return { mode: d.getState().mode }; })()`);
    if (st && st.mode === 'playing') break;
    if (i > 0 && i % 40 === 0) await ev(`(() => { document.getElementById('btnCharConfirm').click(); return 1; })()`);
    await sleep(200);
  }
  const room = await ev(`(() => { const r = (state.rooms || []).find((x) => x.type === 'battle') || state.rooms[1]; window.__roamDebug.teleport(r.cx, r.cy); window.__PLROOM = { w: r.w, h: r.h }; return { id: r.id }; })()`);
  await sleep(900);
  // 清掉敌人/弹幕/碎片，避免它们进入取样圆盘（只动运行时数组，不改游戏代码）
  await ev(`(() => { try { if (Array.isArray(state.enemies)) state.enemies.length = 0; if (Array.isArray(state.projectiles)) state.projectiles.length = 0; if (Array.isArray(state.shards)) state.shards.length = 0; } catch (e) {} return 1; })()`);
  await sleep(500);
  return room;
}

/** 页面内取样：地板亮度、角色最亮/最暗、轮廓亮度差、边界梯度 */
const LSAMPLE = `(() => {
  const dpr = ctx.canvas.width / state.viewW;
  const z = cameraZoom();
  const p = state.player;
  const sx = (p.x - state.cam.x) * z * dpr;
  const sy = (p.y - state.cam.y) * z * dpr;
  const R = 260;
  const off = document.createElement('canvas');
  off.width = R * 2; off.height = R * 2;
  const og = off.getContext('2d');
  og.drawImage(ctx.canvas, sx - R, sy - R, R * 2, R * 2, 0, 0, R * 2, R * 2);
  const d = og.getImageData(0, 0, R * 2, R * 2).data;
  /* 相对亮度（ITU-R BT.709），0–255 */
  const at = (x, y) => {
    const px = Math.round(R + x), py = Math.round(R + y);
    if (px < 0 || py < 0 || px >= R * 2 || py >= R * 2) return -1;
    const i = (py * R * 2 + px) * 4;
    return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  };
  const w2d = z * dpr;  /* 世界像素 → 设备像素 */
  /* 地板参考改成"角色周围同一圈"：半径 40–48 世界像素、32 个方向取中位数。
     上一版取四角，跨局时房间装饰不同会让基准漂 20+ 亮度，把人物变化淹没掉。 */
  const ringVals = [];
  for (let a = 0; a < 32; a += 1) {
    const ang = (a / 32) * Math.PI * 2;
    for (let rw = 40; rw <= 48; rw += 4) {
      const L = at(Math.cos(ang) * rw * w2d, Math.sin(ang) * rw * w2d);
      if (L >= 0) ringVals.push(L);
    }
  }
  ringVals.sort((a, b) => a - b);
  const floorL = ringVals.length ? ringVals[Math.floor(ringVals.length / 2)] : 0;
  /* 剪影内部面积统计：暗像素（深描边/法袍）/ 亮像素（青色亮边/高光）各多少格 */
  let darkPx = 0, brightPx = 0, bodyPx = 0;
  const discR = 24 * w2d;
  const stepPx = Math.max(1, Math.round(w2d));
  for (let yy = -discR; yy <= discR; yy += stepPx) {
    for (let xx = -discR; xx <= discR; xx += stepPx) {
      if (xx * xx + yy * yy > discR * discR) continue;
      const L = at(xx, yy);
      if (L < 0) continue;
      bodyPx += 1;
      if (L < 50) darkPx += 1;
      if (L > 200) brightPx += 1;
    }
  }
  /* 轮廓带平均亮度：半径 17.5–21 世界像素的一圈（就是描边所在的那条带） */
  let bandSum = 0, bandN = 0;
  for (let a = 0; a < 72; a += 1) {
    const ang = (a / 72) * Math.PI * 2;
    for (let rw = 17.5; rw <= 21; rw += 0.5) {
      const L = at(Math.cos(ang) * rw * w2d, Math.sin(ang) * rw * w2d);
      if (L >= 0) { bandSum += L; bandN += 1; }
    }
  }
  let maxL = -1, minL = 999, gradSum = 0, gradMin = 999, rays = 0, edgeRSum = 0;
  for (let a = 0; a < 72; a += 1) {
    const ang = (a / 72) * Math.PI * 2;
    let prev = null, best = 0, bestR = 0;
    for (let rw = 8; rw <= 28; rw += 0.4) {
      const rd = rw * w2d;
      const L = at(Math.cos(ang) * rd, Math.sin(ang) * rd);
      if (L < 0) { prev = null; continue; }
      if (rw <= 22) { if (L > maxL) maxL = L; if (L < minL) minL = L; }
      if (prev !== null) {
        const g = Math.abs(L - prev);
        if (g > best) { best = g; bestR = rw; }
      }
      prev = L;
    }
    if (best > 0) { gradSum += best; if (best < gradMin) gradMin = best; rays += 1; edgeRSum += bestR; }
  }
  return {
    dpr: +dpr.toFixed(2), z: +z.toFixed(3),
    floorL: +floorL.toFixed(1),
    maxL: +maxL.toFixed(1), minL: +minL.toFixed(1),
    contrastUp: +(maxL - floorL).toFixed(1),
    contrastDown: +(floorL - minL).toFixed(1),
    edgeGradMean: +(gradSum / Math.max(1, rays)).toFixed(1),
    edgeGradMin: +gradMin.toFixed(1),
    edgeRMean: +(edgeRSum / Math.max(1, rays)).toFixed(1),
    bandL: +(bandSum / Math.max(1, bandN)).toFixed(1),
    darkPx, brightPx, bodyPx,
    clothMaxAngle: PLAYER_ART_CONFIG.clothMaxAngle,
    outlineWidth: PLAYER_ART_CONFIG.outlineWidth
  };
})()`;

/** 求中位数（用于多次取样的稳健汇总） */
function median(arr) {
  const v = arr.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}

/** 主流程 */
(async () => {
  const t = await boot();
  const log = [];
  const say = (s) => { console.log(s); log.push(s); };
  try {
    const room = await enter(t);
    say('main=' + MAIN);
    say('room=' + JSON.stringify(room));
    const samples = [];
    /* 固定姿态：侧视、静止、不施法，保证 before/after 画的是同一帧姿势 */
    await t.ev(`(() => { const p = state.player; p.facingAngle = 0; p.walkBlend = 0; p.castAnim = 0; p.squash = 0; return 1; })()`);
    await sleep(300);
    for (let k = 0; k < 5; k += 1) {
      const s = await t.ev(LSAMPLE);
      if (s && s.__err) throw new Error(s.__err);
      samples.push(s);
      say('sample#' + k + ' ' + JSON.stringify(s));
      await sleep(300);
    }
    const keys = ['floorL', 'maxL', 'minL', 'contrastUp', 'contrastDown', 'edgeGradMean', 'edgeGradMin', 'edgeRMean', 'bandL', 'darkPx', 'brightPx', 'bodyPx'];
    const agg = {};
    keys.forEach((k) => { agg[k] = +median(samples.map((s) => s[k])).toFixed(1); });
    agg.clothMaxAngle = samples[0].clothMaxAngle;
    agg.outlineWidth = samples[0].outlineWidth;
    agg.dpr = samples[0].dpr; agg.z = samples[0].z;
    say('\n[汇总·5 次中位数] ' + JSON.stringify(agg));
    // 同机位特写：先固定姿态（侧视、静止、不施法），再放大 3 倍截图，便于看描边像素
    await t.ev(`(() => { const p = state.player; p.facingAngle = 0; p.walkBlend = 0; p.castAnim = 0; p.squash = 0; return 1; })()`);
    await sleep(300);
    for (let k = 0; k < 2; k += 1) {
      const clip = await t.ev(`(() => {
        const z = cameraZoom(); const dpr = ctx.canvas.width / state.viewW;
        return { x: Math.max(0, (state.player.x - state.cam.x) * z * dpr - 60), y: Math.max(0, (state.player.y - state.cam.y) * z * dpr - 70), w: 120, h: 145 };
      })()`);
      await t.shot(`player-${TAG}-closeup-${k}.png`, clip, 3);
      await sleep(600);
    }
    say('已存 player-' + TAG + '-closeup-0/1.png');
    fs.writeFileSync(path.join(OUT, `player-${TAG}-look.json`), JSON.stringify({ room, samples, agg }, null, 2));
    fs.writeFileSync(path.join(OUT, `player-${TAG}-look.log`), log.join('\n'), 'utf8');
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
