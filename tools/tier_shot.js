/**
 * 技能特效三档分级 · 改前/改后同机位对比截图
 * ------------------------------------------------------------
 * 两页完全同背景、同技能、同粒子种子，唯一差别是档位参数：
 *   before → ?autoshot=before&freeze=1（三档只有粒子数不同，尺寸/颜色/层数完全一样）
 *   after  → ?autoshot=after&freeze=1 （四维同时拉开）
 * freeze=1 在齐射后 110ms 冻结，因此两张图粒子位置逐点一致，不是抓帧碰运气。
 * 同一时刻只允许开 1 个无头浏览器（串行跑完即关）。
 *
 * 用法：node tools/tier_shot.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9729;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.screenshots', 'tier-fx');
const PAGE = path.join(ROOT, 'skill-tier-preview.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程：启动一次 Edge，依次截 before / after，再关闭
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--no-sandbox', '--disable-gpu',
    '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
    '--window-size=1440,1300', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let edgeErr = '';
  edge.stderr.on('data', (d) => { edgeErr += d.toString(); });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪' + (edgeErr ? ('\nstderr: ' + edgeErr.slice(0, 400)) : '（无 stderr 输出）'));

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
  };
  await new Promise((r) => { ws.onopen = r; });

  /**
   * 发送 CDP 指令
   * @param {string} method 方法名
   * @param {Object} params 参数
   * @returns {Promise<Object>} 返回值
   */
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1300, deviceScaleFactor: 1, mobile: false });

  /**
   * 求值表达式
   * @param {string} expression 表达式
   * @returns {Promise<any>} 结果
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };

  const report = {};

  /**
   * 跑一个模式并截图
   * @param {string} tag before / after
   * @returns {Promise<void>}
   */
  async function run(tag) {
    const url = 'file:///' + PAGE.replace(/\\/g, '/') + '?autoshot=' + tag + '&freeze=1';
    await send('Page.navigate', { url });
    for (let i = 0; i < 80; i += 1) {
      if (await ev('!!window.__shotReady')) break;
      await sleep(100);
    }
    // 等性能采样跑满 120 帧
    for (let i = 0; i < 40; i += 1) {
      if (await ev('!!window.__perfInfo')) break;
      await sleep(100);
    }
    const perf = await ev('window.__perfInfo || null');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${tag}.png`), Buffer.from(shot.data, 'base64'));
    report[tag] = perf;
  }

  try {
    await run('before');
    await run('after');
  } finally {
    try { ws.close(); } catch (e) { /* ignore */ }
    try { killEdge(edge); } catch (e) { /* ignore */ }
  }

  fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify({ report, errors }, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5));
  console.log('输出：' + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
