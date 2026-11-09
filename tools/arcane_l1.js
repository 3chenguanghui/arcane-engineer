/**
 * L1「冲刺裂印」验收脚本
 * ------------------------------------------------------------
 * 用法：
 *   node tools/arcane_l1.js before   // 关掉裂印层（setDashMarkV1(false)）的基准图
 *   node tools/arcane_l1.js after    // 打开裂印层 + 全部断言 + fps（跳过首帧采样）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const MODE = ['before', 'after'].includes(process.argv[2]) ? process.argv[2] : 'after';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9489;                        // L1 专用端口（U1 用 9488）
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
   * @param {{x:number,y:number,w:number,h:number}} [clip] 裁切区域
   * @param {number} [scale=1] 像素倍率
   */
  const shot = async (name, clip, scale = 1) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: clip.w, height: clip.h, scale };
    const r = await send('Page.captureScreenshot', params);
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  const startBtn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startBtn.x, y: startBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startBtn.x, y: startBtn.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  // 同构建 A/B：before 关掉裂印层
  await ev(`window.__roamDebug.setDashMarkV1(${MODE === 'before' ? 'false' : 'true'})`);

  const p = await ev(`window.__roamDebug.getState().player`);
  const shots = [];

  // ------------------------------------------------------------
  // 阶段 1（仅 after）：伤害 / 消耗 / 引爆
  // 两个敌人只隔 20px，并且交替之间不 sleep，避免敌人走位把距离拉出 70px
  // ------------------------------------------------------------
  if (MODE === 'after') {
    await ev(`window.__roamDebug.despawnAll()`);
    await ev(`window.__roamDebug.spawnEnemyAt('assembler', ${p.x + 40}, ${p.y}, {})`);
    await ev(`window.__roamDebug.spawnEnemyAt('welder', ${p.x + 60}, ${p.y + 8}, {})`);
    await sleep(60);

    await ev(`window.__roamDebug.setCritChance(0)`);
    await ev(`window.__roamDebug.clearMarks()`);
    const baseHit = await ev(`window.__roamDebug.hitEnemy('assembler', 10)`);
    await ev(`window.__roamDebug.markEnemy('assembler')`);
    const beforeHitWatcher = await ev(`window.__roamDebug.probeMark()`);
    const welderBefore = await ev(`window.__roamDebug.enemyHp('welder')`);
    const markedHit = await ev(`window.__roamDebug.hitEnemy('assembler', 10)`);
    const welderAfter = await ev(`window.__roamDebug.enemyHp('welder')`);
    const afterHitWatcher = await ev(`window.__roamDebug.probeMark()`);
    const ratio = baseHit && markedHit ? markedHit.delta / baseHit.delta : 0;

    ok('无印命中是基准伤害（delta=10）', baseHit && baseHit.delta === 10, baseHit);
    ok('带裂印命中伤害 ×1.4', ratio >= 1.4 - 1e-6, { base: baseHit, marked: markedHit, ratio });
    ok('命中时相邻敌人在 70px 内', beforeHitWatcher.distance != null && beforeHitWatcher.distance <= beforeHitWatcher.radius, beforeHitWatcher);
    ok('命中后裂印立即消耗（count=0）', (await ev(`window.__roamDebug.dashMark()`)).count === 0, afterHitWatcher);
    ok('引爆波及 70px 内敌人', welderBefore != null && welderAfter != null && welderAfter < welderBefore,
      { welderBefore, welderAfter, detonating: afterHitWatcher.detonating });
    ok('引爆不重复伤害主目标（delta 仍为 14）', markedHit && markedHit.delta === 14, markedHit);
  }

  // ------------------------------------------------------------
  // 阶段 2：截图（重新摆一对相邻敌人，让裂印可见）
  // ------------------------------------------------------------
  await ev(`window.__roamDebug.despawnAll()`);
  await ev(`window.__roamDebug.spawnEnemyAt('assembler', ${p.x + 40}, ${p.y}, {})`);
  await ev(`window.__roamDebug.spawnEnemyAt('welder', ${p.x + 62}, ${p.y + 8}, {})`);
  await sleep(80);
  await ev(`window.__roamDebug.markEnemy('assembler')`);
  await sleep(80);
  // 截图会消耗真实时间：先把"刚挂上"的时长快照下来
  const freshMark = MODE === 'after' ? await ev(`window.__roamDebug.probeMark()`) : null;

  shots.push(await shot(`l1-${MODE}-full.png`));
  const canvasRect = await ev(`(function(){ var c = document.getElementById('game'); var b = c.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  // 相机始终跟随玩家 → 敌人就在画布中心，直接裁画布中心 260px 做 2x 特写
  shots.push(await shot(`l1-${MODE}-mark2x.png`,
    { x: canvasRect.x + canvasRect.w / 2 - 130, y: canvasRect.y + canvasRect.h / 2 - 130, w: 260, h: 260 }, 2));

  if (MODE === 'after') {
    ok('裂印时长接近 3.0s（截图前快照）', freshMark.mainMark != null && freshMark.mainMark >= 2.9, freshMark);

    await sleep(560);
    const ticked = await ev(`window.__roamDebug.dashMark()`);
    ok('裂印按世界时间递减', ticked.enemies[0] && ticked.enemies[0].timer < 2.9, ticked.enemies[0]);

    /* ---------- 冲刺穿身：把敌人放到脚下再冲刺 ---------- */
    await ev(`window.__roamDebug.despawnAll()`);
    const p2 = await ev(`window.__roamDebug.getState().player`);
    await ev(`window.__roamDebug.spawnEnemyAt('assembler', ${p2.x}, ${p2.y}, {})`);
    await sleep(80);
    await ev(`window.__roamDebug.dash()`);
    await sleep(260);
    const dashMarked = await ev(`window.__roamDebug.dashMark()`);
    ok('冲刺穿身自动挂裂印', dashMarked.count >= 1, dashMarked);
    shots.push(await shot('l1-after-dash.png'));

    /* ---------- A/B 关闭 ---------- */
    await ev(`window.__roamDebug.setDashMarkV1(false)`);
    await ev(`window.__roamDebug.markEnemy('assembler')`);
    const offHit = await ev(`window.__roamDebug.hitEnemy('assembler', 10)`);
    ok('关闭裂印层后标记不生效（delta=10）', offHit && offHit.delta === 10, offHit);
    ok('关闭后 dashMark().enabled=false', (await ev(`window.__roamDebug.dashMark()`)).enabled === false, null);
    await ev(`window.__roamDebug.setDashMarkV1(true)`);

    /* ---------- fps：跳过前 40 帧预热，再采样 150 帧 ---------- */
    for (const id of ['assembler', 'welder', 'patrol']) {
      await ev(`window.__roamDebug.spawnEnemyAt('${id}', ${p2.x + 70}, ${p2.y - 30}, {})`);
    }
    const perf = await ev(`new Promise(function(resolve){
      var frames = []; var last = performance.now(); var n = 0; var warm = 0;
      function tick(now){
        var dt = now - last; last = now;
        if (warm < 40) { warm += 1; } else { frames.push(dt); }
        n += 1;
        if (frames.length >= 150) {
          var sum = 0; var max = 0;
          frames.forEach(function(d){ if (d > 0) { sum += d; if (d > max) max = d; } });
          var avg = sum / frames.length;
          resolve({ avgFrameMs: Number(avg.toFixed(2)), maxFrameMs: Number(max.toFixed(2)),
            avgFps: Number((1000 / avg).toFixed(1)), minFps: Number((1000 / max).toFixed(1)),
            errors: window.__roamDebug.errors() });
        } else { requestAnimationFrame(tick); }
      }
      requestAnimationFrame(tick);
    })`);
    console.log('PERF · ' + JSON.stringify(perf));
    ok('avg fps ≥ 60（跳过首帧预热）', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
    ok('无运行时错误', Array.isArray(perf.errors) ? perf.errors.length === 0 : true, perf.errors);

    const missing = shots.filter((s) => !fs.existsSync(s) || fs.statSync(s).size < 10 * 1024);
    ok('截图齐全且 > 10KB', missing.length === 0, missing.map((s) => path.basename(s)));
  }

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nL1 ${MODE.toUpperCase()} · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(
    path.join(OUT_DIR, `l1-${MODE}-result.json`),
    JSON.stringify({ mode: MODE, passed, total: asserts.length, asserts }, null, 2)
  );

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 150);
});
