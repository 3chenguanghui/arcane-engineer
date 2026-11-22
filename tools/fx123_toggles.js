/**
 * FX 开关对照：关掉震屏 / 闪白 / 粒子 / 慢动作后，帧耗时是否与开时一致。
 * 用法：node tools/fx123_toggles.js [被测文件] [输出json]
 * 端口：9735
 *
 * 手法：
 *   1. 停掉 RAF，手动组合一帧 update(1/60) + render()，与 arcane_perf.js 同口径；
 *   2. 粒子池用"直接推入队列"的方式维持在 100 颗（绕开 addBurst 的开关门控），
 *      保证开/关两组的渲染负载完全相同，差值只来自开关本身；
 *   3. 每帧额外调一次 triggerShake / flashScreen，让门控分支真的被执行到；
 *   4. 顺序：全开 → 全关 → 再全开（验证可逆）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9735;
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : path.join(ROOT, 'lab', 'index_fx123_candidate.html');
const OUT = process.argv[3] ? path.resolve(ROOT, process.argv[3]) : path.join(ROOT, 'lab', 'fx123', 'toggles.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程：起浏览器 → 布场 → 三段测量 → 落盘
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
    /* 等脚本真正执行完（btnStart 先于 3MB 主脚本解析完成出现，必须等函数可调用） */
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("(function(){ __charSkipPick = true; __charPickedThisBoot = true; if (typeof closeCharSelect === 'function') closeCharSelect(); startGame(); return true; })()");
  await sleep(1200);
  await ev("(function(){ if (typeof closeCharSelect === 'function') closeCharSelect(); var cl = (window.ui && ui.charLayer) || document.getElementById('charLayer'); if (cl) { cl.classList.add('hidden'); cl.style.display = 'none'; } return true; })()");

  /* 布场：6 只怪 + 粒子原型（用于两组完全相同的负载） */
  const setup = await ev(`(function(){
    var d = window.__roamDebug;
    d.centerPlayer(); d.despawnAll();
    for (var i = 0; i < 6; i += 1) {
      var a = Math.PI * 2 * i / 6;
      d.spawnEnemy(i % 2 ? 'warden' : 'wanderer', Math.cos(a) * 150, Math.sin(a) * 120);
    }
    var p = state.player;
    p.hp = 99999; p.hpMax = 99999;
    state.particles.length = 0;
    addBurst(p.x, p.y, '#8fe9ff', 100, 3, 0, Math.PI * 2, true);
    window.__proto = state.particles.slice(0, Math.max(1, state.particles.length)).map(function (o) { return Object.assign({}, o); });
    return { enemies: state.enemies.length, particles: state.particles.length, proto: window.__proto.length };
  })()`);

  /* 测量一段：90 帧，每帧把粒子补回 100 颗（直接推入，不受开关影响） */
  const measure = (frames) => ev(`(() => {
    window.requestAnimationFrame = function () { return 0; };
    var p = state.player;
    var proto = window.__proto;
    var list = [];
    var t0 = performance.now();
    for (var i = 0; i < ${frames}; i += 1) {
      p.invuln = 9; p.hp = p.hpMax;
      state.mode = 'playing'; state.status = 'playing';
      var s = performance.now();
      while (state.particles.length < 100) {
        var q = Object.assign({}, proto[state.particles.length % proto.length]);
        state.particles.push(q);
      }
      triggerShake(2, 0.12, false, 0);
      flashScreen(0.2);
      update(1 / 60);
      render();
      list.push(performance.now() - s);
    }
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    var avg = list.reduce(function (a, b) { return a + b; }, 0) / list.length;
    return {
      avg: avg,
      p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      worst: sorted[sorted.length - 1],
      particles: state.particles.length,
      enemies: state.enemies.length
    };
  })()`);

  const setAll = (on) => ev(`(function(){
    ['shake','flash','particles','slowmo'].forEach(function (k) { setFxSwitch(k, ${on}); });
    return { shake: fxOn('shake'), flash: fxOn('flash'), particles: fxOn('particles'), slowmo: fxOn('slowmo') };
  })()`);

  const onFlags = await setAll(true);
  const a = await measure(90);
  await setAll(false);
  const offFlags = await setAll(false);
  const b = await measure(90);
  await setAll(true);
  const c = await measure(90);

  const report = {
    when: new Date().toISOString(),
    file: FILE,
    bytes: fs.statSync(FILE).size,
    setup,
    onFlags,
    offFlags,
    on: a,
    off: b,
    onAgain: c,
    deltaP95OnToOff: Number((((b.p95 - a.p95) / a.p95) * 100).toFixed(2)),
    deltaAvgOnToOff: Number((((b.avg - a.avg) / a.avg) * 100).toFixed(2)),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  ws.close();
  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
