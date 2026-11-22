/**
 * 加载与首帧计时（只读工作副本）
 * ------------------------------------------------------------
 * 口径（全部用 performance.now 毫秒）：
 *   t0            注入脚本执行时刻（≈ 导航开始）
 *   firstRaf      页面第一个 requestAnimationFrame 回调（= 第一帧真正要画）
 *   dcl / load    DOMContentLoaded / load 事件
 *   btnStartReady #btnStart 可见且可点
 *   battleReady   点开始 → state.mode==='playing'（含开场仪式的可跳过段）
 * 用法：node mobile/tools/mfirst.js [--force]
 * 产物：mobile/shots/first.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9565;
const SNAP = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const OUT_DIR = path.join(MOBILE_DIR, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 首帧钩子：在页面脚本执行前装好，记录 t0 / 首个 rAF / DCL / load */
const HOOK = `(function () {
  window.__fp = { t0: performance.now() };
  try {
    var raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return raf(function (ts) {
        if (!window.__fp.firstRaf) window.__fp.firstRaf = performance.now();
        return cb(ts);
      });
    };
  } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () { window.__fp.dcl = performance.now(); });
  window.addEventListener('load', function () { window.__fp.load = performance.now(); });
})();`;

/**
 * 启动无头 Edge 并返回 CDP 封装
 * @returns {Promise<{send:Function, ev:Function, close:Function}>}
 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/**
 * 环境守卫：高负载时提示，--force 跳过
 * @returns {boolean} 是否继续
 */
function envGuard() {
  if (process.argv.includes('--force')) return true;
  let cpu = 0, edgeCount = 0;
  try {
    cpu = Number(require('child_process').execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"',
      { encoding: 'utf8' }).trim()) || 0;
    edgeCount = Number(require('child_process').execSync(
      'powershell -NoProfile -Command "(Get-Process msedge -ErrorAction SilentlyContinue | Measure-Object).Count"',
      { encoding: 'utf8' }).trim()) || 0;
  } catch (e) { /* 读不到不拦 */ }
  console.log(`环境守卫：CPU=${cpu}%  msedge=${edgeCount}`);
  return cpu < 60 && edgeCount < 2;
}

/**
 * 主流程：跑 3 次取中位数（单文件，缓存效应很弱，但仍取多次）
 * @returns {Promise<void>}
 */
async function main() {
  if (!envGuard()) { process.exitCode = 3; return; }
  const bytes = fs.statSync(SNAP).size;
  const md5 = require('crypto').createHash('md5').update(fs.readFileSync(SNAP)).digest('hex').toUpperCase();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`副本：${path.basename(SNAP)}  bytes=${bytes}  md5=${md5}`);

  const cdp = await bootEdge();
  const runs = [];
  try {
    for (let i = 0; i < 3; i += 1) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 844, height: 390, deviceScaleFactor: 3, mobile: true,
        screenWidth: 844, screenHeight: 390,
        screenOrientation: { type: 'landscapePrimary', angle: 90 }
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
      const id = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK })).identifier;

      const url = 'file:///' + SNAP.replace(/\\/g, '/') + '?fp=' + i;
      await cdp.send('Page.navigate', { url });
      /* 等 DOM 完整（用轮询拿到"可交互"时刻） */
      let readyAt = 0;
      for (let k = 0; k < 200; k += 1) {
        const st = await cdp.ev(`({rs: document.readyState, start: !!document.getElementById('btnStart')})`);
        if (st.rs === 'complete' && st.start) { readyAt = await cdp.ev('performance.now()'); break; }
        await sleep(50);
      }
      await sleep(300);
      const fp = await cdp.ev('window.__fp');
      const nav = await cdp.ev(`(function(){var n=performance.getEntriesByType('navigation')[0]||{};return {
        domInteractive:n.domInteractive, domContentLoaded:n.domContentLoadedEventEnd,
        loadEventEnd:n.loadEventEnd, resources: performance.getEntriesByType('resource').length};})()`);
      /* 点开始 → 进战斗 */
      const tClick = await cdp.ev('performance.now()');
      await cdp.ev(`(document.getElementById('btnStart')||{}).click(); true`);
      await sleep(500);
      const playing0 = await cdp.ev(`typeof state!=='undefined' && state && state.mode==='playing'`);
      if (!playing0) {
        await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
      }
      let battleAt = 0;
      for (let k = 0; k < 200; k += 1) {
        const ok = await cdp.ev(`typeof state!=='undefined' && state && state.mode==='playing'`);
        if (ok) { battleAt = await cdp.ev('performance.now()'); break; }
        await sleep(50);
      }
      runs.push({ fp: fp, readyAt: readyAt, click: tClick, battleAt: battleAt, nav: nav,
                  battleMs: battleAt && tClick ? Math.round(battleAt - tClick) : null });
      console.log(`run${i}: t0→firstRaf=${Math.round((fp.firstRaf || 0) - fp.t0)}ms ` +
        `dcl=${fp.dcl ? Math.round(fp.dcl) : '-'}ms load=${fp.load ? Math.round(fp.load) : '-'}ms ` +
        `可点开始=${readyAt ? Math.round(readyAt) : '-'}ms 点开始→可操作=${runs[i].battleMs}ms 资源请求=${nav.resources}`);
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
    }
    fs.writeFileSync(path.join(OUT_DIR, 'first.json'), JSON.stringify({ bytes, md5, runs }, null, 1));
    console.log('已写 mobile/shots/first.json');
  } finally {
    cdp.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
