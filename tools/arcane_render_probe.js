// 第 8 轮 · 渲染 bug 复现探针（用户截图 1024×444）
// 目的：在同尺寸窗口进第 1 层，抓"玩家双份/放大虚影"与"右侧房间只剩线框"的成因。
// 做法：包一层 drawPlayer 记录每帧调用次数与进入时的变换矩阵；
//       再逐项关闭后处理/远景/迷雾各截一张图，用于二分定位。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9678;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'renderbug');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1024,444', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + m.params.exceptionDetails.text);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  // 严格复刻用户截图尺寸（headless 窗口会被 chrome 吃掉一部分，必须用设备覆盖）
  // 用户截图 1024×444 是同比例缩略图（1536×666 CSS / 0.667 缩放），按原 CSS 尺寸复现
  await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 666, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1600);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(700);
  // 关掉教学浮层，避免遮住画面（用户截图里没有这些提示）
  await ev(`(() => {
    state.onboardSkipAll = true;
    try { hideIntroHint(true); } catch (e) {}
    const hint = document.getElementById('onboardHint');
    if (hint) { hint.classList.remove('is-on'); hint.setAttribute('aria-hidden', 'true'); }
    return true;
  })()`);
  await sleep(600);
  // 记录：每帧 drawPlayer 调用次数 + 进入时变换矩阵（a=d=缩放，e/f=平移）+ 入口透明度
  await ev(`(() => {
    const real = drawPlayer;
    window.__probe = { frames: [], cur: null, calls: 0 };
    window.drawPlayer = function () {
      const p = window.__probe;
      p.calls += 1;
      const m = ctx.getTransform();
      p.cur.push({ a: +m.a.toFixed(4), b: +m.b.toFixed(4), c: +m.c.toFixed(4), d: +m.d.toFixed(4), e: +m.e.toFixed(1), f: +m.f.toFixed(1), alpha: +ctx.globalAlpha.toFixed(3) });
      return real.apply(this, arguments);
    };
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function (cb) {
      return raf.call(window, function (ts) {
        const p = window.__probe;
        p.cur = [];
        cb(ts);
        p.frames.push({ n: p.calls, m: p.cur.slice(), alpha: p.cur.length ? p.cur[0].alpha : null });
        p.calls = 0;
      });
    };
    return true;
  })()`);
  await sleep(1000);
  await shot('probe-01-baseline.png');
  const scen = {};

  const state1 = await ev(`(() => {
    const s = window.__roamDebug.getState();
    const p = window.__probe;
    const bad = p.frames.filter((f) => f.n !== 1).slice(0, 5);
    const scales = p.frames.map((f) => (f.m[0] ? f.m[0].a : null)).filter((v) => v !== null);
    const sMin = Math.min(...scales), sMax = Math.max(...scales);
    return {
      view: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio,
      floor: s.floor, hp: s.hp, mode: s.mode,
      frames: p.frames.length,
      callsPerFrame: { unique: Array.from(new Set(p.frames.map((f) => f.n))), badCount: bad.length },
      scaleRange: [sMin, sMax],
      firstBad: bad,
      cam: s.cam, rooms: s.rooms ? s.rooms.length : null
    };
  })()`);

  // 二分：关掉后处理
  await ev(`POSTFX_CONFIG.enabled = false; true`);
  await sleep(700);
  await shot('probe-02-no-postfx.png');
  // 再关远景
  await ev(`PARALLAX_CONFIG.enabled = false; true`);
  await sleep(700);
  await shot('probe-03-no-parallax.png');
  // 恢复后处理，单独关迷雾（粗暴地把 fogReady 置 false）
  await ev(`POSTFX_CONFIG.enabled = true; fogReady = false; true`);
  await sleep(700);
  await shot('probe-04-no-fog.png');

  // ---- 泄漏变换检测：跟踪 ctx.save/restore 深度，检查 render 结束后是否回到基态 ----
  await ev(`fogReady = true; state.grid = 0; true`);
  await ev(`(() => {
    const realSave = ctx.save.bind(ctx);
    const realRestore = ctx.restore.bind(ctx);
    let depth = 0;
    ctx.save = function () { depth += 1; return realSave(); };
    ctx.restore = function () { depth -= 1; return realRestore(); };
    const realRender = window.render;
    window.__leak = { frames: 0, bad: [] };
    window.render = function () {
      depth = 0;
      const r = realRender.apply(this, arguments);
      const m = ctx.getTransform();
      const last = window.__leak;
      last.frames += 1;
      if (depth !== 0 || Math.abs(m.a - Math.min(window.devicePixelRatio || 1, 2)) > 0.001) {
        last.bad.push({ depth: depth, a: +m.a.toFixed(3), d: +m.d.toFixed(3), e: +m.e.toFixed(1), f: +m.f.toFixed(1) });
      }
      return r;
    };
    return true;
  })()`);
  await sleep(700);
  const leak = await ev(`JSON.stringify({ frames: window.__leak.frames, bad: window.__leak.bad.slice(0, 6), badCount: window.__leak.bad.length })`);

  // ---- 五种情形各采样一段：静止 / 走动 / 冲刺 / 施法 / 受击 ----
  const range = async (name, fn, waitMs, shotName) => {
    const start = await ev(`window.__probe.frames.length`);
    if (fn) await fn();
    await sleep(waitMs);
    if (shotName) await shot(shotName);
    const end = await ev(`window.__probe.frames.length`);
    const frames = await ev(`window.__probe.frames.slice(${start}, ${end})`);
    scen[name] = { start, end, frames };
  };
  await range('idle', null, 600, 'probe-05-idle.png');
  await range('walk', async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
  }, 700, 'probe-06-walk.png');
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
  await range('dash', async () => {
    await ev(`(() => { state.player.dashCd = 0; startDash(); return true; })()`);
  }, 260, 'probe-07-dash.png');
  await range('cast', async () => {
    await ev(`(() => { try { castPrimary(); } catch (e) {} return true; })()`);
  }, 600, 'probe-08-cast.png');
  await range('hit', async () => {
    await ev(`(() => { damagePlayer(6, state.player.x - 40, state.player.y, 'probe'); return true; })()`);
  }, 600, 'probe-09-hit.png');

  // ---- 视口变化（用户很可能缩放过窗口）：变更后再截图 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 540, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  await shot('probe-10-resized.png');
  await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 666, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  await shot('probe-11-resized-back.png');
  const afterResize = await ev(`(() => {
    const s = window.__roamDebug.getState();
    return { view: [window.innerWidth, window.innerHeight], canvas: [canvas.width, canvas.height], cam: s.cam };
  })()`);

  // ---- 断言（防复发）：每帧只画一次玩家 / 缩放 0.9–1.1 / 入口透明度 ≥0.99 / 泛光不放大 / 残影默认关 ----
  const results = [];
  const chk = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  const names = ['idle', 'walk', 'dash', 'cast', 'hit'];
  const allFrames = names.flatMap((k) => scen[k].frames);
  const badCounts = allFrames.filter((f) => f.n !== 1);
  chk('五情形（静止/走动/冲刺/施法/受击）每帧绘制玩家次数 = 1', badCounts.length === 0,
    { total: allFrames.length, bad: badCounts.slice(0, 6) });
  const scales = allFrames.flatMap((f) => f.m.map((x) => x.a));
  const alphaVals = allFrames.flatMap((f) => f.m.map((x) => x.alpha));
  /* 入口变换 = dpr × 相机缩放；"角色自身缩放"要剥掉这两层才是 0.9–1.1 */
  const baseScale = await ev(`Math.min(window.devicePixelRatio || 1, 2) * cameraZoom()`);
  const ratios = scales.map((v) => v / baseScale);
  chk('玩家绘制自身缩放值在 0.9–1.1（已剥离 dpr 与相机缩放）', ratios.every((v) => v >= 0.9 && v <= 1.1),
    { baseScale, min: Math.min(...ratios), max: Math.max(...ratios) });
  chk('玩家绘制入口透明度 ≥ 0.99', alphaVals.every((v) => v >= 0.99),
    { min: Math.min(...alphaVals), max: Math.max(...alphaVals) });
  const pf = await ev(`({ upscale: POSTFX_CONFIG.bloom.upscale, alpha: POSTFX_CONFIG.bloom.alpha, blur: POSTFX_CONFIG.bloom.blurScale })`);
  chk('泛光 1:1 对齐（upscale = 1.0，不再放大出第二个同形角色）', pf.upscale === 1.0, pf);
  const trail = await ev(`({ enabled: DASH_CONFIG.trailEnabled, life: DASH_CONFIG.trailLife, imgs: state.afterimages.length })`);
  chk('冲刺残影默认关闭，且寿命 ≤ 0.18s', trail.enabled === false && trail.life <= 0.18, trail);
  chk('关闭残影时冲刺后无任何残影对象', trail.imgs === 0, trail);
  // 显式打开（设置里可选）后仍满足短衰减，并且缩放跟随本体（椭圆，不复制立绘）
  const trailOn = await ev(`(() => {
    setMotionTrail(true);
    state.player.dashCd = 0; state.afterimages.length = 0; startDash();
    return { enabled: DASH_CONFIG.trailEnabled, life: DASH_CONFIG.trailLife };
  })()`);
  await sleep(260);
  const trailState = await ev(`({ n: state.afterimages.length, maxLife: state.afterimages.reduce((m, a) => Math.max(m, a.total || 0), 0), scale: PLAYER_ART_CONFIG.scale })`);
  chk('可选残影开启后寿命 ≤ 0.18s，单张寿命字段不倒挂', trailOn.life <= 0.18 && trailState.maxLife <= 0.18,
    { trailOn, trailState });
  await ev(`setMotionTrail(false); state.afterimages.length = 0; true`);

  console.log(JSON.stringify({ state1, leak, afterResize, errors, scenarios: results }, null, 2));
  const passN = results.filter((r) => r.pass).length;
  console.log(`RESULT: ${passN === results.length ? 'PASS' : 'FAIL'} (${passN}/${results.length})`);
  if (passN !== results.length) {
    results.filter((r) => !r.pass).forEach((r) => console.log('FAILED:', r.name, JSON.stringify(r.detail)));
    process.exitCode = 1;
  }
  ws.close(); killEdge(edge); process.exit(process.exitCode || 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
