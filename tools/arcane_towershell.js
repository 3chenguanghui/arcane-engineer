/**
 * M3 塔壁叙事验收：A0–A6
 * 用法：node tools/arcane_towershell.js
 * 端口：9516
 * 输出：.screenshots/art/m3-shell-{mech,rune,void}.png、m3-shell-result.json
 *
 * 断言：
 *  A0 开关与逐层开关默认开
 *  A1 机械层：管道/警示斜纹/检修梯都在，且没有符文/虚空细节
 *  A2 符文层：符文带/门龛都在，且没有机械/虚空细节
 *  A3 虚空层：霜裂/漏缝都在，且没有机械/符文细节
 *  A4 总开关关闭 → 一个细节都不画（rooms=0、marks 全 0）
 *  A5 单层关闭（只关符文）→ 符文层 0 细节，开回来恢复
 *  A6 三层各一张截图 >10KB / fps≥60 / 无脚本错误
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9516;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1200);

  // ---------- A0 ----------
  const a0 = await ev(`window.__roamDebug.towerShell.info()`);
  ok('A0 总开关 + 三层逐层开关默认开',
    a0.enabled === true && a0.narrative.mech === true
      && a0.narrative.rune === true && a0.narrative.void === true, a0);

  // ---------- A1 机械层 ----------
  const a1 = await ev(`(function(){ state.floor = 1; return window.__roamDebug.towerShell.bake(); })()`);
  await sleep(320);
  await shot('m3-shell-mech.png');
  const a1m = a1.marks || {};
  ok('A1 机械层：管道/警示斜纹/检修梯 >0，其他层细节全为 0',
    a1.themeId === 'mech' && a1.rooms > 0
      && a1m.pipe > 0 && a1m.hazard > 0 && a1m.ladder > 0
      && a1m.rune === 0 && a1m.niche === 0 && a1m.frost === 0 && a1m.seam === 0, a1);

  // ---------- A2 符文层 ----------
  const a2 = await ev(`(function(){ state.floor = 2; return window.__roamDebug.towerShell.bake(); })()`);
  await sleep(320);
  await shot('m3-shell-rune.png');
  const a2m = a2.marks || {};
  ok('A2 符文层：符文带/门龛 >0，其他层细节全为 0',
    a2.themeId === 'rune' && a2.rooms > 0
      && a2m.rune > 0 && a2m.niche > 0
      && a2m.pipe === 0 && a2m.hazard === 0 && a2m.ladder === 0
      && a2m.frost === 0 && a2m.seam === 0, a2);

  // ---------- A3 虚空层 ----------
  const a3 = await ev(`(function(){ state.floor = 3; return window.__roamDebug.towerShell.bake(); })()`);
  await sleep(320);
  await shot('m3-shell-void.png');
  const a3m = a3.marks || {};
  ok('A3 虚空层：霜裂/漏缝 >0，其他层细节全为 0',
    a3.themeId === 'void' && a3.rooms > 0
      && a3m.frost > 0 && a3m.seam > 0
      && a3m.pipe === 0 && a3m.hazard === 0 && a3m.ladder === 0
      && a3m.rune === 0 && a3m.niche === 0, a3);

  // ---------- A4 总开关 ----------
  const a4 = await ev(`(function(){
    TOWER_SHELL_CONFIG.enabled = false;
    state.floor = 1;
    var r = window.__roamDebug.towerShell.bake();
    TOWER_SHELL_CONFIG.enabled = true;
    return r;
  })()`);
  const a4m = a4.marks || {};
  const a4allZero = Object.keys(a4m).every((k) => a4m[k] === 0);
  ok('A4 enabled=false → 一个细节都不画（rooms=0 / marks 全 0）',
    a4.rooms === 0 && a4allZero, a4);

  // ---------- A5 单层关闭 ----------
  const a5 = await ev(`(function(){
    TOWER_SHELL_CONFIG.narrative.rune = false;
    state.floor = 2;
    var off = window.__roamDebug.towerShell.bake();
    TOWER_SHELL_CONFIG.narrative.rune = true;
    var on = window.__roamDebug.towerShell.bake();
    return { off: off, on: on };
  })()`);
  const a5om = a5.off.marks || {};
  const a5onm = a5.on.marks || {};
  ok('A5 只关符文层 → 该层 0 细节；开回来 >0（其他层不受影响）',
    a5.off.rooms === 0 && Object.keys(a5om).every((k) => a5om[k] === 0)
      && a5.on.rooms > 0 && a5onm.rune > 0 && a5onm.niche > 0, a5);

  // ---------- A6 截图 / fps / 错误 ----------
  const a6 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){
      state.floor = 1;
      bakeScene();
      return { fps: f, errors: (window.__errors || []).length, themeId: window.__roamDebug.towerShell.info().themeId };
    });
  })()`);
  const sizes = ['m3-shell-mech.png', 'm3-shell-rune.png', 'm3-shell-void.png']
    .map((n) => { try { return fs.statSync(path.join(OUT_DIR, n)).size; } catch (e) { return 0; } });
  ok('A6 三层截图 >10KB / fps≥60 / 无脚本错误',
    sizes.every((s) => s > 10240) && a6.fps >= 60 && a6.errors === 0, { fps: a6.fps, errors: a6.errors, sizes });

  fs.writeFileSync(path.join(OUT_DIR, 'm3-shell-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== m3-towershell ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
