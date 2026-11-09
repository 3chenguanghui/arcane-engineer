/**
 * A/B 帧预算对照（用户卡顿反馈的第一手证据）
 * ------------------------------------------------------------
 * 用法：node tools\arcane_ab_perf.js <html 路径> <标签>
 *   例：node tools\arcane_ab_perf.js dist\arcane_engineer_v1.0.3\奥术工程师_v1.0.3.html v103
 *       node tools\arcane_ab_perf.js index_arcane_v2.html current
 *
 * 口径（同一台机器、同一窗口、同一场景）：
 *   - 窗口 1600x900 @ dpr1，进入第 3 层最大战斗房，补足 6 只敌人；
 *   - 连续 30 秒，用独立 RAF 采样每一帧的时长（不改游戏主循环）；
 *   - 记录平均帧时间 / 最坏帧 / >33ms 掉帧占比 / p95；
 *   - 同时记录粒子数、drawStats、每帧 DOM 变更次数；
 *   - 输出 JSON 到 .screenshots\ab\<标签>.json，并截一张当时的画面。
 * 说明：本脚本只测量、不改游戏行为；后处理保持各版本的默认开关。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9778;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.screenshots', 'ab');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 统计一维数组：平均 / 最坏 / p95 / 超阈值占比 */
function stats(list, limitMs) {
  if (!list.length) return { n: 0, avg: 0, worst: 0, p95: 0, dropRatio: 0 };
  const sorted = list.slice().sort((a, b) => a - b);
  const sum = list.reduce((a, b) => a + b, 0);
  return {
    n: list.length,
    avg: +(sum / list.length).toFixed(2),
    worst: +sorted[sorted.length - 1].toFixed(2),
    p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
    dropRatio: +(list.filter((v) => v > limitMs).length / list.length).toFixed(4)
  };
}

async function main() {
  const file = path.resolve(process.argv[2] || path.join(ROOT, 'index_arcane_v2.html'));
  const tag = process.argv[3] || 'current';
  /* 可选环境变量：AB_DPR=2 模拟高分屏；AB_POSTFX=0 关后处理（用来切分卡顿来源）；
     AB_MS=30000 采样时长（默认 30 秒） */
  const dpr = Math.max(1, Number(process.env.AB_DPR) || 1);
  const postfxOn = process.env.AB_POSTFX === undefined ? true : process.env.AB_POSTFX !== '0';
  const sampleMs = Math.max(5000, Number(process.env.AB_MS) || 30000);
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', `--window-size=1600,900`, 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待浏览器起来 */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: dpr, mobile: false });
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  await sleep(3200);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  // 开局：点开始按钮（两个版本都有 #btnStart）
  const p = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(1600);

  // 布置场景：第 3 层最大战斗房 + 6 只敌人
  const load = await ev(`(() => {
    try { __roamDebug.setFloor(3); } catch (e) {}
    try { ENEMY_BUDGET_CONFIG.adaptive.enabled = false; } catch (e) {}
    const room = (state.rooms || []).filter((r) => r.type === 'battle' || r.type === 'elite' || r.type === 'boss')
      .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || state.rooms[0];
    state.player.x = room.cx;
    state.player.y = room.cy;
    state.player.invuln = 1e9;
    state.player.hp = state.player.hpMax;
    state.mode = 'playing'; state.status = 'playing';
    try { state.onboardSkipAll = true; } catch (e) {}
    // 进入房间后让游戏自然刷怪；再补足到 6 只（两版都有全局 spawnEnemy）
    try {
      const ids = Object.keys(ENEMY_CONFIG).slice(0, 6);
      while (state.enemies.filter((e) => e.roomId === room.id).length < 6) {
        const i = state.enemies.length;
        const a = (Math.PI * 2 * i) / 6;
        spawnEnemy(ids[i % ids.length], room.cx + Math.cos(a) * 150, room.cy + Math.sin(a) * 150, state.floor, { roomId: room.id });
      }
    } catch (e) {}
    return {
      room: { id: room.id, type: room.type, w: Math.round(room.w), h: Math.round(room.h) },
      enemies: state.enemies.length,
      postfx: typeof postfxFlags === 'function' ? postfxFlags() : null,
      floor: state.floor
    };
  })()`);
  if (!postfxOn) await ev(`(() => { setPostFx(false); return postfxFlags(); })()`);
  await sleep(900);

  /* 真实帧预算：RAF 间隔会被 vsync 封顶（120Hz≈8.3ms / 60Hz≈16.7ms），
     不能直接当"这帧花了多少 CPU"。这里包住游戏自己的 loop()，
     只统计 update+render 的净耗时，才是帧预算断言该用的口径。 */
  await ev(`(() => {
    const orig = loop;
    const a = window.__work = { ms: [], t0: 0 };
    window.loop = function (now) {
      const s = performance.now();
      orig(now);
      const cost = performance.now() - s;
      a.ms.push(cost);
      if (!a.t0) a.t0 = now;
    };
    return true;
  })()`);

  // 采样：独立 RAF 计时 + MutationObserver 统计 DOM 变更（时长按 AB_MS）
  await ev(`(() => {
    const a = window.__ab = { deltas: [], dom: [], t0: 0, last: 0, domCount: 0, domLast: 0 };
    const mo = new MutationObserver((muts) => { a.domCount += muts.length; });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    a.raf = (ts) => {
      if (!a.t0) a.t0 = ts;
      if (a.last) {
        a.deltas.push(ts - a.last);
        a.dom.push(a.domCount - a.domLast);
        a.domLast = a.domCount;
      } else {
        a.domLast = a.domCount;
      }
      a.last = ts;
      if (ts - a.t0 < ${sampleMs}) requestAnimationFrame(a.raf);
    };
    requestAnimationFrame(a.raf);
    return true;
  })()`);
  await sleep(sampleMs + 1500);

  const raw = await ev(`(() => {
    const a = window.__ab;
    const s = __roamDebug.getState();
    return {
      deltas: a.deltas, dom: a.dom, work: (window.__work && window.__work.ms) || [],
      drawStats: s.drawStats || null,
      particles: state.particles ? state.particles.length : null,
      enemies: state.enemies ? state.enemies.length : null,
      postfx: typeof postfxFlags === 'function' ? postfxFlags() : null,
      view: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio
    };
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(shot.data, 'base64'));

  const frame = stats(raw.deltas, 33.4);
  const work = stats(raw.work, 8.0);
  const workOver33 = raw.work.length
    ? +(raw.work.filter((v) => v > 33.4).length / raw.work.length).toFixed(4) : 0;
  const domAvg = raw.dom.length ? +(raw.dom.reduce((x, y) => x + y, 0) / raw.dom.length).toFixed(2) : 0;
  const report = {
    when: new Date().toISOString(), file, tag, scene: load,
    frame, work: Object.assign({}, work, { over33Ratio: workOver33 }), domPerFrame: domAvg,
    particles: raw.particles, enemies: raw.enemies, postfx: raw.postfx,
    drawStats: raw.drawStats, view: raw.view, dpr: raw.dpr
  };
  fs.writeFileSync(path.join(OUT, tag + '.json'), JSON.stringify(report, null, 2));
  // 帧预算断言：update+render 净耗时平均 ≤ 8ms，且 >33ms 的卡顿帧占比 ≤ 2%
  const budgetPass = work.avg <= 8 && workOver33 <= 0.02;
  console.log(JSON.stringify(report, null, 2));
  console.log('FRAME BUDGET: ' + (budgetPass ? 'PASS' : 'FAIL') +
    ` (avg ${work.avg}ms / over33 ${(workOver33 * 100).toFixed(2)}%)`);
  ws.close();
  killEdge(edge);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
