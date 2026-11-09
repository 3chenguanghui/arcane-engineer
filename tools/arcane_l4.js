/**
 * L4「终点 / 通关」验收脚本（端口 9491）
 * ------------------------------------------------------------
 * 用法：node tools/arcane_l4.js
 * 断言见 .spec/u4-end/spec.md 第 4 节。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9491;                 // L4 专用端口（L1=9489 / L2=9490）
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 名称
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---------- 0. 静态守卫：死亡路径必须原样保留 ----------
  const source = fs.readFileSync(FILE, 'utf8');
  ok('死亡结算路径未被改动（loseGame + 机体失效 仍在）',
    source.includes('function loseGame(') && source.includes('机体失效') && source.includes('function showResult('),
    { loseGame: source.includes('function loseGame('), showResult: source.includes('function showResult(') });

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
    } catch (e) { /* 等 Edge */ }
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
   * 截图
   * @param {string} name 文件名
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  const btn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  // ---------- 1. 配置 ----------
  const info0 = await ev(`window.__roamDebug.runInfo()`);
  ok('终点配置：finalFloor = 5，初始未通关', info0.finalFloor === 5 && info0.runCompleted === false,
    { finalFloor: info0.finalFloor, runCompleted: info0.runCompleted, clears: info0.clears });

  // ---------- 2. 非末层不触发 ----------
  await ev(`window.__roamDebug.setFloor(1)`);
  await sleep(400);
  await ev(`window.__roamDebug.defeatBoss()`);
  await sleep(3000);
  const info1 = await ev(`window.__roamDebug.runInfo()`);
  ok('第 1 层击败首领：不弹通关面板', info1.runCompleted === false && !info1.modalKind.includes('victory-modal'),
    { floor: info1.floor, runCompleted: info1.runCompleted, modalKind: info1.modalKind, status: info1.status });

  // ---------- 3. 末层触发通关 ----------
  await ev(`window.__roamDebug.setFloor(5)`);
  await sleep(400);
  const beforeWin = await ev(`window.__roamDebug.runInfo()`);
  await ev(`window.__roamDebug.defeatBoss()`);
  // 立刻读一次：计时器应该已经启动（2.4s 延迟）
  const armed = await ev(`window.__roamDebug.runInfo()`);
  ok('末层首领倒下即起通关计时（2.4s 延迟，不抢击杀演出）',
    armed.victoryTimer > 0 && armed.victoryTimer <= 2.45 && armed.runCompleted === false,
    { victoryTimer: armed.victoryTimer, floor: armed.floor });

  await sleep(2800);
  const info3 = await ev(`window.__roamDebug.runInfo()`);
  ok('第 5 层通关：status=won + 金色通关面板', info3.status === 'won' && info3.runCompleted === true
    && info3.modalKind.includes('victory-modal') && info3.modalVisible === true,
    { status: info3.status, runCompleted: info3.runCompleted, modalKind: info3.modalKind });

  // ---------- 4. 战绩 ----------
  ok('通关次数 +1、最佳楼层 ≥5', info3.clears === 1 && info3.bestFloor >= 5,
    { clearsBefore: beforeWin.clears, clearsAfter: info3.clears, bestFloor: info3.bestFloor });
  const panelText = await ev(`document.querySelector('.modal.victory-modal') ? document.querySelector('.modal.victory-modal').innerText : ''`);
  ok('通关面板包含关键统计文案', /本局完成/.test(panelText) && /通关次数/.test(panelText)
    && /构筑规模/.test(panelText) && /最高连击/.test(panelText),
    panelText.replace(/\s+/g, ' ').slice(0, 90));

  const shots = [];
  shots.push(await shot('l4-victory-panel.png'));

  // ---------- 5. 不会重复触发 ----------
  await sleep(900);
  const info5 = await ev(`window.__roamDebug.runInfo()`);
  ok('面板显示后计时器归零、不重复弹', info5.victoryTimer === 0 && info5.status === 'won',
    { victoryTimer: info5.victoryTimer, status: info5.status, clears: info5.clears });

  // ---------- 6. 无尽下潜 ----------
  const resumed = await ev(`window.__roamDebug.continueEndless()`);
  const info6 = await ev(`window.__roamDebug.runInfo()`);
  ok('继续下潜：返回 playing + endless=true + 面板隐藏', resumed === true && info6.status === 'playing'
    && info6.endless === true && info6.modalVisible === false,
    { resumed, status: info6.status, endless: info6.endless, modalVisible: info6.modalVisible });

  // ---------- 7. 无尽模式不再弹通关 ----------
  await ev(`window.__roamDebug.setFloor(6)`);
  await sleep(400);
  await ev(`window.__roamDebug.defeatBoss()`);
  await sleep(3000);
  const info7 = await ev(`window.__roamDebug.runInfo()`);
  const noVictoryAgain = info7.status !== 'won' && !(info7.modalVisible && info7.modalKind.includes('victory-modal'));
  ok('无尽第 6 层击败首领：不再弹通关面板', info7.runCompleted === true && info7.endless === true && noVictoryAgain,
    { floor: info7.floor, endless: info7.endless, runCompleted: info7.runCompleted, modalKind: info7.modalKind, modalVisible: info7.modalVisible, status: info7.status });

  // ---------- 8. 截图与 fps ----------
  for (const id of ['crawler', 'welder', 'patrol', 'riveter', 'assembler']) {
    await ev(`window.__roamDebug.spawnThreat('${id}', ${120 + Math.random() * 40}, ${-60 + Math.random() * 120})`);
  }
  const perf = await ev(`new Promise(function(resolve){
    var frames = []; var last = performance.now(); var warm = 0;
    function tick(now){
      var dt = now - last; last = now;
      if (warm < 40) { warm += 1; } else { frames.push(dt); }
      if (frames.length >= 150) {
        var sum = 0; var max = 0;
        frames.forEach(function(d){ if (d > 0) { sum += d; if (d > max) max = d; } });
        var avg = sum / frames.length;
        resolve({ avgFps: Number((1000 / avg).toFixed(1)), minFps: Number((1000 / max).toFixed(1)),
          errors: window.__roamDebug.errors() });
      } else { requestAnimationFrame(tick); }
    }
    requestAnimationFrame(tick);
  })`);
  console.log('PERF · ' + JSON.stringify(perf));
  ok('avg fps ≥ 60（跳过首帧预热）', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
  ok('无运行时错误', perf.errors.length === 0, perf.errors);

  const missing = shots.filter((s) => !fs.existsSync(s) || fs.statSync(s).size < 10 * 1024);
  ok('通关面板截图 >10KB', missing.length === 0, missing.map((s) => path.basename(s)));

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nL4 · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(path.join(OUT_DIR, 'l4-result.json'),
    JSON.stringify({ passed, total: asserts.length, asserts }, null, 2));

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 150);
});
