/**
 * 人物造型现状体检（只读，不改任何玩法数值）
 * ------------------------------------------------------------------
 * 报三件事：
 *   1) 造型体量：drawPlayer 一次调用的路径操作数（beginPath/lineTo/arc/椭圆/贝塞尔）
 *      并给出"折算三角面"估算（2D 矢量没有真三角面，折算口径写清楚）
 *   2) 动作段数：animAudit 的 walkFrames / 呼吸 / 施法 / 披风 / 残影等
 *   3) 与场景的比例：角色碰撞/视觉尺寸 vs 房间尺寸、相机缩放
 * 用法：node _probe/player_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'pl';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-pl-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const PORT = 9200 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() { for (const p of EDGE) if (fs.existsSync(p)) return p; throw new Error('找不到 msedge.exe'); }

/** 启动 headless Edge + CDP */
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
    } catch (e) { /* 未就绪 */ }
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
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.w), height: Math.round(clip.h), scale: 1 };
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return name;
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进游戏并站到战斗房中央 */
async function enter(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    if (await ev(`(() => { const b = document.getElementById('btnStart'); return !!(b && b.getBoundingClientRect().width > 0); })()`) === true) break;
    await sleep(150);
  }
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
  await sleep(1200);
  return room;
}

/** 页面内：给 ctx 打桩，数 drawPlayer 内部的路径操作 */
const COUNT = `(() => {
  const g = ctx;
  const keys = ['beginPath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'rect', 'closePath', 'save', 'restore', 'createLinearGradient', 'createRadialGradient', 'fillRect', 'drawImage'];
  const saved = {};
  const c = {};
  keys.forEach((k) => {
    saved[k] = g[k];
    c[k] = 0;
    g[k] = function () { c[k] += 1; return saved[k].apply(g, arguments); };
  });
  const t0 = performance.now();
  for (let i = 0; i < 10; i += 1) drawPlayer();
  const ms = (performance.now() - t0) / 10;
  keys.forEach((k) => { g[k] = saved[k]; });
  const per = {};
  keys.forEach((k) => { per[k] = +(c[k] / 10).toFixed(1); });
  /* 折算三角面：每个 fill 的路径点数近似 (lineTo+moveTo+4*arc+3*bezier+2*quad)，扇形三角 = 点数-2 */
  const pts = (per.moveTo || 0) + (per.lineTo || 0) + (per.arc || 0) * 4 + (per.bezierCurveTo || 0) * 3 + (per.quadraticCurveTo || 0) * 2;
  return {
    perDraw: per,
    pathPoints: Math.round(pts),
    trisEstimate: Math.max(0, Math.round(pts - (per.fill || 0) * 2)),
    drawMs: +ms.toFixed(3),
    art: (typeof PLAYER_ART_CONFIG !== 'undefined') ? PLAYER_ART_CONFIG : null,
    charArt: (typeof CHARACTER_ART_CONFIG !== 'undefined') ? {
      keys: Object.keys(CHARACTER_ART_CONFIG),
      outline: CHARACTER_ART_CONFIG.outline || null,
      emblem: CHARACTER_ART_CONFIG.emblem || null
    } : null
  };
})()`;

/** 主流程 */
(async () => {
  const t = await boot();
  const log = [];
  const say = (s) => { console.log(s); log.push(s); };
  try {
    const room = await enter(t);
    say('room=' + JSON.stringify(room));
    say('camZoom=' + JSON.stringify(await t.ev(`(() => cameraZoom())()`)));
    const anim = await t.ev(`(() => { try { return window.__roamDebug.animAudit(); } catch (e) { return { err: String(e) }; } })()`);
    const render = await t.ev(`(() => { try { return window.__roamDebug.renderAudit(); } catch (e) { return { err: String(e) }; } })()`);
    say('anim=' + JSON.stringify(anim));
    say('render=' + JSON.stringify(render));
    const cnt = await t.ev(COUNT);
    if (cnt && cnt.__err) throw new Error(cnt.__err);
    say('\n[drawPlayer 单次调用]');
    say('  pathPoints=' + cnt.pathPoints + '  trisEstimate≈' + cnt.trisEstimate + '  drawMs=' + cnt.drawMs);
    say('  ops=' + JSON.stringify(cnt.perDraw));
    say('  PLAYER_ART_CONFIG=' + JSON.stringify(cnt.art));
    say('  CHARACTER_ART_CONFIG=' + JSON.stringify(cnt.charArt));
    /* 比例：角色视觉尺寸 vs 房间尺寸（世界单位） */
    const ratio = await t.ev(`(() => {
      const p = state.player;
      const R = window.__PLROOM;
      const r = p.radius || 0;
      return { radius: r, room: R, rw: +(r * 2 / R.w).toFixed(3), rh: +(r * 2 / R.h).toFixed(3), mode: state.mode, hp: p.hp, hpMax: p.hpMax };
    })()`);
    say('\n[比例] ' + JSON.stringify(ratio));
    /* 人物特写：连拍 3 张（升级面板可能在前几秒挡住画面） */
    for (let k = 0; k < 3; k += 1) {
      const clip = await t.ev(`(() => {
        const z = cameraZoom(); const dpr = ctx.canvas.width / state.viewW;
        return { x: Math.max(0, (state.player.x - state.cam.x) * z * dpr - 120), y: Math.max(0, (state.player.y - state.cam.y) * z * dpr - 170), w: 240, h: 300 };
      })()`);
      await t.shot(`player-${TAG}-closeup-${k}.png`, clip);
      await sleep(700);
    }
    say('\n已存 player-' + TAG + '-closeup-0/1/2.png');
    fs.writeFileSync(path.join(OUT, `player-${TAG}.json`), JSON.stringify({ room, anim, render, count: cnt, ratio }, null, 2));
    fs.writeFileSync(path.join(OUT, `player-${TAG}.log`), log.join('\n'), 'utf8');
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
