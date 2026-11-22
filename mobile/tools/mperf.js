/**
 * 手机端性能探针（工作副本专用，只读）
 * ------------------------------------------------------------
 * 回答三个问题：
 *   1) 844×390 / 390×844 连续 60 秒的帧率中位数与最差 1% 帧；
 *   2) 迷雾 / 粒子 / 后处理 / shadowBlur / 分辨率 逐项关掉后，帧率与主线程占用各回升多少；
 *   3) 每帧是否真的在调 getImageData（计数），画布多大。
 * 方法：
 *   · 帧率用页面内 requestAnimationFrame 时间戳采样（记录相邻帧间隔）；
 *   · 主线程占用用 CDP Performance.getMetrics 的 TaskDuration 增量 / 采样秒数；
 *   · 归因实验在 **解锁 vsync 的第二个实例** 里做，否则帧率被 60 卡住看不到回升；
 *   · 本机是桌面浏览器模拟移动视口，不是真机，结果只用于相对比较。
 * 用法：node mobile/tools/mperf.js [--force]
 * 产物：mobile/shots/perf.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_perf');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9562;
const SNAP = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const OUT_DIR = path.join(MOBILE_DIR, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面内采样器：返回相邻帧间隔的分位数（毫秒） */
const SAMPLER = `
window.__perf = {
  frames: [],
  sample: function (ms) {
    return new Promise(function (resolve) {
      var ts = [];
      var last = performance.now();
      var t0 = last;
      function tick(t) {
        ts.push(t - last);
        last = t;
        if (t - t0 < ms) { requestAnimationFrame(tick); return; }
        var a = ts.slice().sort(function (x, y) { return x - y; });
        function q(p) { return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))]; }
        var med = q(0.5);
        resolve({
          n: a.length, spanMs: Math.round(t - t0),
          fpsMedian: Math.round(1000 / med * 10) / 10,
          p95FrameMs: Math.round(q(0.95) * 10) / 10,
          worst1PctFrameMs: Math.round(q(0.99) * 10) / 10,
          maxFrameMs: Math.round(a[a.length - 1] * 10) / 10,
          medianFrameMs: Math.round(med * 10) / 10
        });
      }
      requestAnimationFrame(tick);
    });
  },
  /* getImageData 计数（验证是否存在每帧读像素） */
  gid: { n: 0, px: 0 },
  gidOn: function () {
    if (this._orig) return;
    var p = CanvasRenderingContext2D.prototype;
    this._orig = p.getImageData;
    var self = this;
    p.getImageData = function (x, y, w, h) { self.gid.n += 1; self.gid.px += (w || 0) * (h || 0); return self._orig.apply(this, arguments); };
  },
  gidOff: function () {
    if (!this._orig) return;
    CanvasRenderingContext2D.prototype.getImageData = this._orig;
    this._orig = null;
  },
  /* 关掉所有 canvas shadowBlur：改原型 getter，绘制时读到 0 */
  shadowOff: function () {
    if (this._sd) return;
    var self = this;
    this._sd = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'shadowBlur');
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'shadowBlur', {
      configurable: true,
      get: function () { return 0; },
      set: function () { /* 忽略写入 */ }
    });
  },
  shadowOn: function () {
    if (!this._sd) return;
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'shadowBlur', this._sd);
    this._sd = null;
  }
};
true
`;

/**
 * 启动 Edge 并返回 CDP 封装
 * @param {Object} opt {port:number, uncapped:boolean}
 * @returns {Promise<{send:Function, ev:Function, close:Function}>}
 */
async function bootEdge(opt) {
  const profile = prepareProfile();
  const args = [
    `--remote-debugging-port=${opt.port}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,600', 'about:blank'
  ];
  if (opt.uncapped) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  const edge = spawn(EDGE, args, { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${opt.port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('Edge 调试端口未就绪'); }

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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Performance.enable');
  return { send, ev, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/**
 * 进入战斗（标题 → 选角 → 第一层）
 * @param {Object} cdp CDP
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} dpr 像素比
 * @returns {Promise<boolean>} 是否 playing
 */
async function enterBattle(cdp, w, h, dpr) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: dpr, mobile: true,
    screenWidth: w, screenHeight: h,
    screenOrientation: { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 }
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Page.navigate', { url: 'file:///' + SNAP.replace(/\\/g, '/') + '?perf=1' });
  for (let i = 0; i < 100; i += 1) {
    if (await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`)) break;
    await sleep(200);
  }
  await sleep(800);
  await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
  await sleep(500);
  if (!(await cdp.ev(`state.mode === 'playing'`))) {
    await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
  }
  for (let i = 0; i < 80; i += 1) {
    if (await cdp.ev(`state.mode === 'playing'`)) break;
    await sleep(200);
  }
  await sleep(4000);
  return await cdp.ev(`state.mode === 'playing'`);
}

/**
 * 取 CDP 性能指标（秒）
 * @param {Object} cdp CDP
 * @returns {Promise<Object>} 指标字典
 */
async function metrics(cdp) {
  const r = await cdp.send('Performance.getMetrics');
  const m = {};
  r.metrics.forEach((x) => { m[x.name] = x.value; });
  return m;
}

/**
 * 采样 ms 毫秒，同时给出帧间隔分位与主线程占用
 * @param {Object} cdp CDP
 * @param {number} ms 时长
 * @returns {Promise<Object>} 采样结果
 */
async function sample(cdp, ms) {
  const a = await metrics(cdp);
  const t0 = Date.now();
  const frames = await cdp.ev(`window.__perf.sample(${ms})`);
  const b = await metrics(cdp);
  const wall = (Date.now() - t0) / 1000;
  const task = (b.TaskDuration || 0) - (a.TaskDuration || 0);
  const script = (b.ScriptDuration || 0) - (a.ScriptDuration || 0);
  return Object.assign(frames, {
    wallSec: Math.round(wall * 10) / 10,
    taskPct: Math.round(task / wall * 1000) / 10,
    scriptPct: Math.round(script / wall * 1000) / 10
  });
}

/**
 * 环境守卫
 * @returns {boolean} 是否继续
 */
function envGuard() {
  if (process.argv.includes('--force')) { console.log('环境守卫：--force 跳过'); return true; }
  let cpu = 0, edgeCount = 0;
  try {
    cpu = Number(require('child_process').execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"', { encoding: 'utf8' }).trim()) || 0;
    edgeCount = Number(require('child_process').execSync('powershell -NoProfile -Command "(Get-Process msedge -ErrorAction SilentlyContinue | Measure-Object).Count"', { encoding: 'utf8' }).trim()) || 0;
  } catch (e) { /* 读不到不拦 */ }
  console.log(`环境守卫：CPU=${cpu}%  msedge=${edgeCount}`);
  if (cpu >= 60 || edgeCount >= 2) { console.log('环境高负载：加 --force 才继续'); return false; }
  return true;
}

/**
 * 主流程：限帧 60s×2 → 解锁 vsync 归因
 * @returns {Promise<void>}
 */
async function main() {
  if (!envGuard()) { process.exitCode = 3; return; }
  const bytes = fs.statSync(SNAP).size;
  const md5 = require('crypto').createHash('md5').update(fs.readFileSync(SNAP)).digest('hex').toUpperCase();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    snapshot: { bytes, md5 },
    method: 'requestAnimationFrame 相邻帧间隔采样 + CDP Performance.getMetrics(TaskDuration)；桌面无头 Edge 模拟移动视口，非真机',
    env: {},
    capped: {},
    uncapped: {},
    toggles: []
  };
  try {
    out.env.cpuPct = Number(require('child_process').execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"', { encoding: 'utf8' }).trim()) || 0;
    out.env.edgeProcs = Number(require('child_process').execSync('powershell -NoProfile -Command "(Get-Process msedge -ErrorAction SilentlyContinue | Measure-Object).Count"', { encoding: 'utf8' }).trim()) || 0;
  } catch (e) { out.env.cpuPct = null; out.env.edgeProcs = null; }

  /* ---------- A. 限帧实例：两个尺寸各 60 秒 ---------- */
  const cdpA = await bootEdge({ port: PORT, uncapped: false });
  try {
    if (!(await enterBattle(cdpA, 844, 390, 3))) throw new Error('844×390 未进入战斗');
    await cdpA.ev(SAMPLER);
    out.capped.env844 = await cdpA.ev(`({
      quality: (typeof currentQualityTier === 'function') ? currentQualityTier() : null,
      canvas: { w: canvas.width, h: canvas.height },
      css: { w: Math.round(canvas.getBoundingClientRect().width), h: Math.round(canvas.getBoundingClientRect().height) },
      dpr: window.devicePixelRatio,
      particles: (state.particles || []).length,
      sparks: (state.sparks || []).length
    })`);
    console.log('844×390 采样 60s …');
    out.capped.landscape = await sample(cdpA, 60000);
    console.log('  ', JSON.stringify(out.capped.landscape));

    await cdpA.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844,
      screenOrientation: { type: 'portraitPrimary', angle: 0 }
    });
    await sleep(1500);
    out.capped.env390 = await cdpA.ev(`({ canvas: { w: canvas.width, h: canvas.height }, css: { w: Math.round(canvas.getBoundingClientRect().width), h: Math.round(canvas.getBoundingClientRect().height) } })`);
    console.log('390×844 采样 60s …');
    out.capped.portrait = await sample(cdpA, 60000);
    console.log('  ', JSON.stringify(out.capped.portrait));

    /* getImageData 计数 10s */
    await cdpA.ev(`window.__perf.gidOn(); true`);
    await sleep(10000);
    out.capped.getImageData = await cdpA.ev(`({ calls: window.__perf.gid.n, px: window.__perf.gid.px, seconds: 10 })`);
    await cdpA.ev(`window.__perf.gidOff(); true`);
  } finally {
    cdpA.close();
  }

  /* ---------- B. 解锁 vsync 实例：逐项关掉看回升 ---------- */
  const cdpB = await bootEdge({ port: PORT + 1, uncapped: true });
  try {
    if (!(await enterBattle(cdpB, 844, 390, 3))) throw new Error('归因实例未进入战斗');
    await cdpB.ev(SAMPLER);
    out.uncapped.env = await cdpB.ev(`({
      quality: (typeof currentQualityTier === 'function') ? currentQualityTier() : null,
      canvas: { w: canvas.width, h: canvas.height }, dpr: window.devicePixelRatio
    })`);
    console.log('解锁 vsync 基线 15s …');
    out.uncapped.baseline = await sample(cdpB, 15000);
    console.log('  ', JSON.stringify(out.uncapped.baseline));

    /** 记录一次"关掉某特性"的对照采样 */
    async function toggle(name, on, off, restore, ms) {
      await cdpB.ev(on);
      await sleep(600);
      const s = await sample(cdpB, ms);
      await cdpB.ev(off || restore || 'true');
      await sleep(400);
      const row = { name, fpsMedian: s.fpsMedian, worst1PctFrameMs: s.worst1PctFrameMs, taskPct: s.taskPct, scriptPct: s.scriptPct };
      out.toggles.push(row);
      console.log(`  [${name}] ${JSON.stringify(row)}`);
    }

    await toggle('关迷雾', `(function(){window.__fogKeep=setInterval(function(){try{fogReady=false;}catch(e){}},100);return true;})()`,
      `(function(){clearInterval(window.__fogKeep);try{fogReady=true;}catch(e){}return true;})()`, null, 10000);
    await toggle('关粒子', `(function(){window.__pKeep=setInterval(function(){try{state.particles.length=0;}catch(e){}},50);return true;})()`,
      `(function(){clearInterval(window.__pKeep);return true;})()`, null, 10000);
    await toggle('关后处理', `(function(){window.__pfx=JSON.parse(JSON.stringify(state.meta.postfx||{}));state.meta.postfx={bloom:false,chroma:false,crt:false,vignette:false};return true;})()`,
      null, `(function(){state.meta.postfx=window.__pfx;return true;})()`, 10000);
    await toggle('关shadowBlur', `(window.__perf.shadowOff(),true)`, null, `(window.__perf.shadowOn(),true)`, 10000);
    await toggle('DPR3→1', `(function(){return true;})()`, null, `(function(){return true;})()`, 0);

    /* DPR 对照需要重设视口，单独处理 */
    await cdpB.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenWidth: 844, screenHeight: 390,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await sleep(1500);
    const dpr1 = await sample(cdpB, 10000);
    out.toggles[out.toggles.length - 1] = { name: 'DPR3→1', fpsMedian: dpr1.fpsMedian, worst1PctFrameMs: dpr1.worst1PctFrameMs, taskPct: dpr1.taskPct, scriptPct: dpr1.scriptPct };
    console.log('  [DPR3→1]', JSON.stringify(out.toggles[out.toggles.length - 1]));
  } finally {
    cdpB.close();
  }

  fs.writeFileSync(path.join(OUT_DIR, 'perf.json'), JSON.stringify(out, null, 2));
  console.log('已写出 shots/perf.json');
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exit(1);
});
