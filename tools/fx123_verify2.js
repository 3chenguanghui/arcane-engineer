/**
 * 打击感补测：① 闪白按"实际绘制帧数"计数 ② 4px 击杀档单点实测
 * 用法：node tools/fx123_verify2.js [被测文件] [输出json]
 * 端口：9736
 *
 * ① 闪白：包一层 drawEnemyHitOutline，只统计 alpha>0.02 的调用（与函数内部早退条件一致），
 *    同时记录每帧真实间隔，用"帧数 × 实测帧间隔"换算成时间区间（无头环境帧长不稳，必须给区间）。
 * ② 击杀震屏：对一只普通怪注入 999 伤害（必击杀），读 SHAKE_STATS.lastPeak 与逐帧峰值。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9736;
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : path.join(ROOT, 'lab', 'index_fx123_candidate.html');
const OUT = process.argv[3] ? path.resolve(ROOT, process.argv[3]) : path.join(ROOT, 'lab', 'fx123', 'verify2.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程：起浏览器 → 开局 → 两项测量 → 落盘
 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    const onMsg = (m) => {
      const d = JSON.parse(m.data);
      if (d.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (d.error) rej(new Error(method + ' ' + JSON.stringify(d.error)));
      else res(d.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 60; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("(function(){ __charSkipPick = true; __charPickedThisBoot = true; if (typeof closeCharSelect === 'function') closeCharSelect(); startGame(); return true; })()");
  await sleep(1200);
  await ev("(function(){ if (typeof closeCharSelect === 'function') closeCharSelect(); var cl = (window.ui && ui.charLayer) || document.getElementById('charLayer'); if (cl) { cl.classList.add('hidden'); cl.style.display = 'none'; } return true; })()");
  await sleep(300);

  /* 命中注入钩子（帧桶在 update 开头重建，必须挂 flush 之前） */
  await ev(`(function(){
    window.__fxQueue = [];
    var origFlush = window.fxTierFlush;
    window.fxTierFlush = function () {
      if (window.__fxQueue.length) {
        var f = window.__fxQueue.shift();
        try { f(); } catch (e) { window.__fxErr = String(e); }
      }
      return origFlush.apply(this, arguments);
    };
    return true;
  })()`);

  /* ① 闪白绘制帧计数：包一层 drawEnemyHitOutline */
  const flash = await ev(`new Promise(function(resolve){
    var d = window.__roamDebug;
    d.centerPlayer(); d.despawnAll();
    state.shake.time = 0; state.shake.power = 0; state.shake.dur = 0;
    state.hitStop = 0;
    d.spawnEnemy('wanderer', 150, -40);
    var e = state.enemies[state.enemies.length - 1];
    e.hpMax = 99999; e.hp = 99999;
    window.__probeEnemy = e;

    /* 记录：真实被描边绘制的帧（alpha>0.02 才会真正 stroke）
       v2.1.1：α 不再由探针按旧公式推算，而是直接调用游戏里的 enemyHitFlashAlpha()，
       保证测到的就是画面上画出来的那个 α（同一份代码路径）。 */
    window.__outline = [];
    var orig = window.drawEnemyHitOutline;
    window.drawEnemyHitOutline = function (enemy, bob) {
      if (enemy === window.__probeEnemy) {
        var a = (typeof window.enemyHitFlashAlpha === 'function')
          ? window.enemyHitFlashAlpha(enemy)
          : (enemy.flash > 0 ? 0.35 : 0);
        if (a > 0.02) window.__outline.push({ t: performance.now(), a: a });
      }
      return orig.apply(this, arguments);
    };

    var ang = Math.atan2(e.y - state.player.y, e.x - state.player.x);
    window.__fxQueue.push(function () { damageEnemy(e, 10, ang); });

    var frames = [];        /* 每帧时间戳 */
    var outlineBefore = 0;
    var t0 = performance.now();
    var peak = 0, decayFrames = 0;
    function step() {
      var now = performance.now();
      frames.push(now);
      if (e.flash > peak) peak = e.flash;
      if (e.flash > 0) decayFrames += 1;
      if (now - t0 < 600) requestAnimationFrame(step);
      else {
        var iv = [];
        for (var i = 1; i < frames.length; i += 1) iv.push(frames[i] - frames[i - 1]);
        var sorted = iv.slice().sort(function (a, b) { return a - b; });
        /* v2.1.1：逐帧时间戳（相对第一帧）+ α≥0.2 的帧数与跨度 */
        var ol = window.__outline;
        var tFirst = ol.length ? ol[0].t : 0;
        var relTimes = ol.map(function (x) { return Number((x.t - tFirst).toFixed(1)); });
        var ge02 = ol.filter(function (x) { return x.a >= 0.2; });
        var ge02Span = ge02.length > 1
          ? Number((ge02[ge02.length - 1].t - ge02[0].t).toFixed(1)) : 0;
        var visSpan = ol.length > 1
          ? Number((ol[ol.length - 1].t - ol[0].t).toFixed(1)) : 0;
        var alphaPeak = ol.reduce(function (m, x) { return Math.max(m, x.a); }, 0);
        resolve({
          outlineFrames: ol.length,
          outlineAlphas: ol.map(function (x) { return Number(x.a.toFixed(3)); }),
          outlineTimesMs: relTimes,
          ge02Frames: ge02.length,
          ge02SpanMs: ge02Span,
          visibleSpanMs: visSpan,
          alphaPeak: Number(alphaPeak.toFixed(3)),
          flashDecayFrames: decayFrames,
          flashPeakFlag: Number(peak.toFixed(3)),
          hitFlashTime: FEEL_CONFIG.hitFlashTime,
          hitFlashHold: FEEL_CONFIG.hitFlashHold,
          hitFlashPeak: FEEL_CONFIG.hitFlashPeak,
          frameCount: frames.length,
          intervalMs: {
            min: Number((sorted[0] || 0).toFixed(1)),
            median: Number((sorted[Math.floor(sorted.length / 2)] || 0).toFixed(1)),
            max: Number((sorted[sorted.length - 1] || 0).toFixed(1))
          }
        });
      }
    }
    requestAnimationFrame(step);
  })`);

  /* ② 4px 击杀档：999 伤害必击杀，量振幅 */
  const kill = await ev(`new Promise(function(resolve){
    var d = window.__roamDebug;
    d.despawnAll();
    state.shake.time = 0; state.shake.power = 0; state.shake.dur = 0;
    state.hitStop = 0;
    d.spawnEnemy('wanderer', 140, 0);
    var e = state.enemies[state.enemies.length - 1];
    e.hpMax = 30; e.hp = 30;
    var ang = Math.atan2(e.y - state.player.y, e.x - state.player.x);
    state.shake.power = 0;
    /* 从下一帧 flush 起注入：走完整分级链路 */
    window.__fxQueue.push(function () { damageEnemy(e, 999, ang); });
    var peak = 0, dur = 0, frames = 0;
    var t0 = performance.now();
    function step() {
      frames += 1;
      if (state.shake.power > peak) peak = state.shake.power;
      if (state.shake.dur > dur) dur = state.shake.dur;
      if (performance.now() - t0 < 500) requestAnimationFrame(step);
      else resolve({
        shakePeak: Number(peak.toFixed(2)),
        shakeDur: Number(dur.toFixed(3)),
        lastPeak: Number((window.SHAKE_STATS && SHAKE_STATS.lastPeak || 0).toFixed(2)),
        lastDur: Number((window.SHAKE_STATS && SHAKE_STATS.lastDur || 0).toFixed(3)),
        expected: (typeof SHAKE_BY_DAMAGE !== 'undefined') ? SHAKE_BY_DAMAGE.big : null,
        classExpected: (typeof HITSTOP_BY_CLASS !== 'undefined') ? HITSTOP_BY_CLASS.normal : null,
        frames: frames
      });
    }
    requestAnimationFrame(step);
  })`);

  const report = {
    when: new Date().toISOString(),
    file: FILE,
    bytes: fs.statSync(FILE).size,
    flash: flash,
    flashEstimateMs: {
      atMedian: Number((flash.outlineFrames * flash.intervalMs.median).toFixed(1)),
      atMin: Number((flash.outlineFrames * flash.intervalMs.min).toFixed(1)),
      atMax: Number((flash.outlineFrames * flash.intervalMs.max).toFixed(1))
    },
    kill: kill,
    err: await ev('window.__fxErr || null')
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  ws.close();
  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
