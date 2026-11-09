/**
 * 技能特效补丁 · 改前/改后对比截图
 * ------------------------------------------------------------
 * 两个页面完全同机位、同种子、同动作，只差 body.skillfx：
 *   before → ?autoshot=before&freeze=1（只播主文件现有特效）
 *   after  → ?autoshot=after&freeze=1 （叠加 SKILLFX 演出与卡面三态）
 * freeze=1 会在齐射后 110ms 冻结世界并置 window.__shotReady=true，
 * 因此两张图的粒子位置完全一致，不是“抓帧碰运气”。
 *
 * 用法：node tools/skill_fx_shot.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9717;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.screenshots', 'skill-fx');
const PREVIEW = path.join(ROOT, 'skill-fx-preview.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程
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
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

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
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1300, deviceScaleFactor: 1, mobile: false
  });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };

  /**
   * 跑一个模式并截图
   * @param {string} tag before / after
   * @returns {Promise<Object>} 截图与现场读数
   */
  async function run(tag) {
    const url = 'file:///' + PREVIEW.replace(/\\/g, '/') + '?autoshot=' + tag + '&freeze=1';
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i += 1) {
      const ready = await ev('!!window.__shotReady');
      if (ready) break;
      await sleep(100);
    }
    const perf = await ev("document.getElementById('perf').textContent");
    const state = await ev(`(() => ({
      skillfx: !!window.SKILLFX && window.SKILLFX.isEnabled(),
      backend: window.SKILLFX ? window.SKILLFX.backend() : null,
      stats: window.SKILLFX ? window.SKILLFX.stats : null,
      aether: state.player.aether,
      cooling: Object.keys(state.cooldowns).filter(k => state.cooldowns[k] > 0.05).length
    }))()`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, `skill-fx-${tag}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return { tag, file, bytes: fs.statSync(file).size, perf, state };
  }

  const before = await run('before');
  const after = await run('after');
  console.log(JSON.stringify({ ok: errors.length === 0, errors, before, after }, null, 2));

  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
