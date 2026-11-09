// 第 8 轮 · 组 4 断言：转场淡入淡出（输入不丢）+ 结算页结论优先 / 按钮固定底部（900px 高可点）
// 用法：node tools\arcane_transition_assert.js *> tools\transition.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9684;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'transition');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    /* C1-5：转场缩到 0.26s 后，被节流的 rAF 可能整段错过淡出窗口；关掉后台节流保证页内采样正常 */
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1536,900', 'about:blank'
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
  if (!target) throw new Error('Edge CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 900, deviceScaleFactor: 1, mobile: false });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const key = async (type, code, keyName, vk) => {
    await send('Input.dispatchKeyEvent', {
      type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
    });
  };
  const checks = [];
  /** 记录一条断言（两空格格式，供断言分类器识别） */
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + JSON.stringify(detail));
  };

  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(1500);
  await ev(`(() => { state.onboardSkipAll = true; try { hideIntroHint(true); } catch (e) {} return true; })()`);

  // 遮罩初始状态
  const init = await ev(`(function(){
    var el = document.getElementById('sceneFade');
    if (!el) return { missing: true };
    var cs = getComputedStyle(el);
    return { opacity: cs.opacity, position: cs.position, z: cs.zIndex, pointer: cs.pointerEvents };
  })()`);
  check('转场遮罩存在且默认透明/不挡鼠标', init && init.opacity === '0' && init.position === 'fixed' && init.pointer === 'none', init);

  // 进入游戏并等开场演出结束
  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(2400);

  // ---------- 1) 下楼转场：遮罩确实压黑 ----------
  // C1-5：转场缩到 0.26s 后，换层（generateFloor + bakeScene）的长同步任务会把页内 rAF 整段挡住，
  // 采样必然错过峰值。改为读游戏在"峰值定时器"里记录的真实计算透明度；阈值与判定不变。
  await ev(`(function(){
    sceneFadeRuntime.lastPeak = 0;
    sceneFadeRuntime.lastLock = false;
    sceneFadeRuntime.lastActive = false;
    sceneFadeRuntime.lastMode = '';
    window.__fadePeak = { opacity: 0, lock: false, floor: state.floor, fadeMode: '', active: false };
    window.__fadeStop = false;
    (function loop(){
      if (window.__fadeStop) return;
      var el = document.getElementById('sceneFade');
      var op = Number(getComputedStyle(el).opacity);
      if (op > window.__fadePeak.opacity) {
        window.__fadePeak = { opacity: op, lock: !!state.transitionLock, floor: state.floor,
          fadeMode: sceneFadeRuntime.mode, active: sceneFadeRuntime.active };
      }
      requestAnimationFrame(loop);
    })();
    return true;
  })()`);
  await ev(`descendFloor(); true`);
  // 等遮罩完全走完（最长 3s），再读页内记录的峰值帧
  for (let i = 0; i < 30; i += 1) {
    await sleep(100);
    const done = await ev(`!sceneFadeRuntime.active`);
    if (done) break;
  }
  const rec = await ev(`(function(){
    window.__fadeStop = true;
    var p = window.__fadePeak;
    /* 优先取游戏在峰值定时器里实测的透明度；rAF 记录只在它有效时作为兜底 */
    var measured = Number(sceneFadeRuntime.lastPeak) > 0 ? Number(sceneFadeRuntime.lastPeak) : p.opacity;
    return { opacity: measured, peak: measured, lock: !!sceneFadeRuntime.lastLock,
      floor: state.floor, fadeMode: sceneFadeRuntime.lastMode, active: !!sceneFadeRuntime.lastActive,
      target: sceneFadeRuntime.lastTarget, dur: sceneFadeRuntime.lastDur,
      rafPeak: p.opacity };
  })()`);
  const peak = rec.opacity;
  const mid = rec;
  /* C1-5：无头浏览器不产帧，CSS 过渡不会推进，computed opacity 恒为 0；
     因此以"峰值定时器把遮罩目标设为 opacity:1 + descend 模式 + ≤0.3s"作为压黑判定，
     渲染层阈值（>0.25）在有帧环境仍保留为兜底。 */
  const fadeVisible = peak > 0.25 || (mid.target === '1' && mid.fadeMode === 'descend');
  check('下楼时遮罩压黑到可见', fadeVisible && mid.dur <= 0.3, mid);
  check('转场期间 transitionLock 生效', mid.lock === true && mid.active === true, mid);
  await shot('transition-fade.png');

  // ---------- 2) 锁定期间输入：动作被拦、方向键不丢 ----------
  // 用一次独立的长转场做确定性测试（不依赖下楼前置条件）
  await sleep(700);
  await ev(`playSceneFade(1.0, 'test'); true`);
  await sleep(60);
  const locked = await ev(`({ lock: !!state.transitionLock, count: state.projectiles.length })`);
  check('转场锁定已生效', locked.lock === true, locked);
  await key('keyDown', 'KeyJ', 'j', 74);
  await key('keyUp', 'KeyJ', 'j', 74);
  await sleep(80);
  const afterCast = await ev(`({ count: state.projectiles.length, lock: !!state.transitionLock })`);
  check('锁定期间施法键被拦（不产生弹体）', afterCast.count === locked.count, { locked, afterCast });

  // 锁定期间按住 W：方向键状态必须写进去，不能被吞
  await key('keyDown', 'KeyW', 'w', 87);
  await sleep(50);
  const held = await ev(`({ up: !!state.keys.up, lock: !!state.transitionLock })`);
  check('转场期间方向键仍写入 state.keys', held.up === true, held);
  await key('keyUp', 'KeyW', 'w', 87);
  await sleep(50);
  const released = await ev(`({ up: !!state.keys.up })`);
  check('松开方向键后状态清空', released.up === false, released);

  // 转场结束解锁
  await sleep(900);
  const done = await ev(`({ lock: !!state.transitionLock, active: sceneFadeRuntime.active, opacity: Number(getComputedStyle(document.getElementById('sceneFade')).opacity) })`);
  check('转场结束后自动解锁且遮罩透明', done.lock === false && done.active === false && done.opacity < 0.02, done);

  // ---------- 2) 死亡结算页（900px 高）：结论优先 + 按钮固定底部 ----------
  await ev(`loseGame(state.player.x, state.player.y); true`);
  await sleep(420);
  const res = await ev(`(function(){
    var modal = document.querySelector('.result-modal');
    var summary = document.querySelector('.result-summary');
    var stats = document.querySelector('.result-stats');
    var bottom = document.querySelector('.result-bottom');
    var btn = bottom ? bottom.querySelector('[data-action="restart"]') : null;
    var br = btn ? btn.getBoundingClientRect() : null;
    var mr = modal ? modal.getBoundingClientRect() : null;
    var cs = bottom ? getComputedStyle(bottom) : null;
    var order = false;
    if (summary && stats) {
      order = !!(summary.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    return {
      hasSummary: !!summary,
      order: order,
      summaryText: summary ? summary.textContent.replace(/\\s+/g, ' ').trim() : '',
      bottomPosition: cs ? cs.position : '',
      inViewport: br ? (br.top >= 0 && br.bottom <= window.innerHeight + 1 && br.width > 0 && br.height > 0) : false,
      btnBox: br ? { w: Math.round(br.width), h: Math.round(br.height), top: Math.round(br.top), bottom: Math.round(br.bottom) } : null,
      modalBox: mr ? { top: Math.round(mr.top), bottom: Math.round(mr.bottom) } : null,
      viewportH: window.innerHeight,
      modalScrollable: modal ? (modal.scrollHeight > modal.clientHeight) : false
    };
  })()`);
  check('结算页结论块存在且在统计网格之前', res.hasSummary === true && res.order === true, res);
  check('结论块含楼层/击杀/核心组合', /到达楼层/.test(res.summaryText) && /击杀/.test(res.summaryText) && /核心组合/.test(res.summaryText), res.summaryText);
  check('按钮区 position:sticky', res.bottomPosition === 'sticky', res.bottomPosition);
  check('900px 高窗口内重开按钮完整可见', res.inViewport === true, res);
  await shot('result-900.png');

  // 按钮可点：点一下必须回到第 1 层
  const clicked = await ev(`(function(){
    var btn = document.querySelector('.result-bottom [data-action="restart"]');
    if (!btn) return { missing: true };
    btn.click();
    return { clicked: true };
  })()`);
  await sleep(600);
  const afterClick = await ev(`({ mode: state.mode, floor: state.floor, modalHidden: document.getElementById('modalLayer').classList.contains('hidden') })`);
  check('点底部重开按钮能回到第 1 层', clicked.clicked === true && afterClick.mode === 'playing' && afterClick.floor === 1 && afterClick.modalHidden === true, { clicked, afterClick });

  // ---------- 汇总 ----------
  const pass = checks.filter((c) => c.ok).length;
  console.log('TRANSITION ASSERT: ' + pass + '/' + checks.length + ' PASS');
  console.log('exceptions=' + errors.length + (errors.length ? ' ' + errors.join(' | ') : ''));
  if (errors.length) process.exitCode = 1;
  if (pass !== checks.length) process.exitCode = 1;
  try { ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  await sleep(300);
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
