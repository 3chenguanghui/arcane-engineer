// 第 8 轮 · 组 2 断言：开场演出（1.5–2.5s / 任意键跳过 / ≤3s / 不重播 / 0 外部请求 / 与演出分级兼容）
// 用法：node tools\arcane_opening_assert.js *> tools\opening_assert.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9682;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'opening');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
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
  const checks = [];
  /** 记录一条断言（用框架约定的两空格格式，供断言分类器识别） */
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + JSON.stringify(detail));
  };
  const nav = async () => {
    await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
    await sleep(1400);
    await ev(`(() => { state.onboardSkipAll = true; try { hideIntroHint(true); } catch (e) {} return true; })()`);
  };

  // ---------- 1) 正常播放 ----------
  await nav();
  const res = await ev(`(function(){
    var list = performance.getEntriesByType('resource');
    return { resources: list.length };
  })()`);
  check('开局页 0 外部资源请求', res.resources === 0, res);

  await ev(`window.__openingStart = performance.now(); document.getElementById('btnStart').click(); true`);
  await sleep(200);
  const s1 = await ev(`({ active: openingRitual.active, t: openingRitual.t, dur: openingRitual.dur, frames: openingRitual.frames, mode: state.mode, floor: state.floor })`);
  check('开局立即进入演出', s1.active === true, s1);
  check('演出总长在 1.5–2.5s', s1.dur >= 1.5 && s1.dur <= 2.5, s1);
  await sleep(800);
  await shot('opening-0.9s.png');
  const s2 = await ev(`({ active: openingRitual.active, t: openingRitual.t, frames: openingRitual.frames })`);
  check('演出在推进（帧与时间都在涨）', s2.active === true && s2.t > s1.t && s2.frames > 0, { s1, s2 });

  // 轮询到演出自然结束：用页面内时钟测量真实播放时长（不受截图/通信延迟影响）
  let elapsed = 0;
  let s3 = null;
  for (let i = 0; i < 25; i += 1) {
    await sleep(140);
    const p = await ev(`({ active: openingRitual.active, played: openingRitual.played, t: openingRitual.t, frames: openingRitual.frames, mode: state.mode, now: performance.now() })`);
    if (!p.active) {
      s3 = p;
      elapsed = (p.now - (await ev(`window.__openingStart`))) / 1000;
      break;
    }
  }
  check('演出自行结束且不超过 3s', !!s3 && elapsed >= 1.5 && elapsed <= 3.0, { elapsed, s3 });
  check('演出结束后仍在第 1 层可玩', !!s3 && s3.mode === 'playing', s3);
  await shot('opening-done.png');

  // 同页再开局不重播
  await ev(`restartRun(); true`);
  await sleep(120);
  const s4 = await ev(`({ active: openingRitual.active, played: openingRitual.played })`);
  check('同页重开不再重播', s4.active === false, s4);

  // ---------- 2) 任意键跳过（新页面，保证 played 归零） ----------
  await nav();
  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(90);
  const b1 = await ev(`({ active: openingRitual.active })`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 87, code: 'KeyW', key: 'w' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 87, code: 'KeyW', key: 'w' });
  await sleep(100);
  const b2 = await ev(`({ active: openingRitual.active, skipped: openingRitual.skipped, played: openingRitual.played })`);
  check('演出期间按键可跳过', b1.active === true && b2.active === false && b2.skipped === true, { b1, b2 });

  // 跳过后 restartRun 也不重播
  await ev(`restartRun(); true`);
  await sleep(120);
  const b3 = await ev(`({ active: openingRitual.active })`);
  check('跳过后重开不重播', b3.active === false, b3);

  // ---------- 3) 与演出分级 / 性能模式兼容 ----------
  await nav();
  const c1 = await ev(`(function(){
    var prev = FX_TIER_CONFIG.enabled;
    FX_TIER_CONFIG.enabled = false;
    openingRitual.played = false;
    var on = startOpeningRitual();
    FX_TIER_CONFIG.enabled = prev;
    openingRitual.played = false;
    openingRitual.active = false;
    return { started: on };
  })()`);
  check('演出分级关闭时不播开场仪式', c1.started === false, c1);

  const c2 = await ev(`(function(){
    var prev = !!state.performanceMode;
    state.performanceMode = true;
    openingRitual.played = false;
    openingRitual.active = false;
    var on = startOpeningRitual();
    var dur = openingRitual.dur;
    openingRitual.active = false;
    openingRitual.played = false;
    state.performanceMode = prev;
    return { started: on, dur: dur };
  })()`);
  check('性能模式下演出缩短到 1.2s', c2.started === true && c2.dur === 1.2, c2);

  // ---------- 汇总 ----------
  const pass = checks.filter((c) => c.ok).length;
  console.log('OPENING ASSERT: ' + pass + '/' + checks.length + ' PASS');
  console.log('exceptions=' + errors.length + (errors.length ? ' ' + errors.join(' | ') : ''));
  if (errors.length) process.exitCode = 1;
  if (pass !== checks.length) process.exitCode = 1;
  try { ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  await sleep(300);
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
