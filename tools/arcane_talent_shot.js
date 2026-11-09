/**
 * 天赋页全貌截图（第 11 项交付件）
 * ------------------------------------------------------------
 * 用途：跑无头 Edge → 进游戏 → 给一笔结晶 → 买一项（露出"✓ 已选"与"⊘ 互斥锁"两种状态）
 *       → 打开天赋页 → 整页截图，落到 `.screenshots/talents/page.png`。
 * 同时回读卡片数量与可见状态文字，作为截图是否"全貌"的机器校验（不只是看图）。
 * 用法：node tools\arcane_talent_shot.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9781;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.screenshots', 'talents');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程：启动浏览器 → 开局 → 造状态 → 打开天赋页 → 截图 + 回读校验
 * @returns {Promise<void>}
 */
async function main() {
  const file = path.join(ROOT, 'index_arcane_v2.html');
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });

  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (error) { /* 浏览器还没起来，继续等 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });

  /**
   * 发送一条 CDP 命令并等待结果
   * @param {string} method 方法名
   * @param {Object} params 参数
   * @returns {Promise<Object>}
   */
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  /* 用更高的虚拟视口：天赋页是纵向长面板，900 高只能露出部分卡片，全貌需要足够高度 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1500, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  await sleep(3000);

  /**
   * 在页面里执行表达式并取回值
   * @param {string} expression JS 表达式
   * @returns {Promise<any>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  /* 从标题页点"开始游戏"，让 state / meta 真正初始化 */
  const point = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(1600);

  /* 造展示状态：足量结晶 + 买 1 级坚壁（露出已选；同排疾影自动变互斥锁） */
  const prep = await ev(`(() => {
    state.meta.crystals = 999;
    buyTalent('armor');
    openTalentsPage();
    /* 新开局的"WASD 移动"教学浮层会压住天赋卡，截图前先收起来 */
    const hint = document.getElementById('onboardHint');
    if (hint) { hint.style.display = 'none'; hint.setAttribute('aria-hidden', 'true'); }
    return { crystals: state.meta.crystals, armor: talentLevelOf ? talentLevelOf('armor') : null };
  })()`);

  await sleep(900);

  /* 机器校验：30 张卡 + 五态文字是否都在 + 顶部三条封顶进度 */
  const audit = await ev(`(() => {
    /* 教学浮层可能在开局 1 秒后才弹，截图前再压一次，保证交付图干净 */
    const hintNow = document.getElementById('onboardHint');
    if (hintNow) { hintNow.style.display = 'none'; hintNow.setAttribute('aria-hidden', 'true'); }
    const layer = document.getElementById('talentLayer');
    const cards = layer.querySelectorAll('.tal-card').length;
    const text = layer.innerText || '';
    const states = ['＋ 可买', '✓ 已选', '⊘ 互斥锁', '↓ 前置不足'].filter((s) => text.indexOf(s) >= 0);
    const caps = layer.querySelectorAll('.tal-cap').length;
    const capText = Array.from(layer.querySelectorAll('.tal-cap-text')).map((el) => el.textContent.trim());
    /* 全貌判定：30 张卡的外接矩形必须都落在视口内，不能有被裁掉的 */
    const rects = Array.from(layer.querySelectorAll('.tal-card')).map((el) => el.getBoundingClientRect());
    const maxBottom = Math.max.apply(null, rects.map((r) => Math.round(r.bottom)));
    const inView = rects.filter((r) => r.bottom <= window.innerHeight + 1 && r.top >= -1).length;
    return { cards, states, caps, capText, visible: !layer.classList.contains('hidden'),
      maxBottom, viewH: window.innerHeight, inView };
  })()`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const outFile = path.join(OUT, 'page.png');
  fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ prep, audit, out: outFile }, null, 2));

  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((error) => { console.error('FATAL', error && error.message); process.exit(1); });
