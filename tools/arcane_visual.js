// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 视觉抽查：生成三种敌人 + 施法特效 + 掉落物，截取战斗画面
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9666;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'visual');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => { seq += 1; pending.set(seq, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: seq, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  /* v2.2.0：路径含中文，必须 encodeURI，否则 file:// 导航失败停在 about:blank；
     主文件涨到 4.2MB 后给 2.5s 起底 */
  await send('Page.navigate', { url: require('url').pathToFileURL(FILE).href });
  await sleep(2500);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  /* v2.2.0：标题流程按 firstplay_probe 的同口径走 —— 等 titleLayer 就绪后
     用真实鼠标事件点 #btnStart → 角色卡 → #btnCharConfirm。
     element.click() 在这些按钮上不触发内部逻辑（之前误判为"按钮不存在"）。 */
  const clickSel = async (sel) => {
    const box = await ev(`(() => {
      const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    })()`);
    if (!box) return false;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    return true;
  };
  let titleReady = false;
  for (let i = 0; i < 40; i += 1) {
    titleReady = await ev(`(function(){
      var t = document.getElementById('titleLayer');
      return document.readyState === 'complete' && !!t && !t.classList.contains('hidden');
    })()`);
    if (titleReady) break;
    await sleep(150);
  }
  if (!(await clickSel('#btnStart'))) {
    const diag = await ev(`(function(){
      var t = document.getElementById('titleLayer');
      return { rs: document.readyState, href: location.href, hasTitle: !!t,
        cls: t ? t.className : null,
        cards: document.querySelectorAll('#charGrid .char-card').length,
        bodyLen: ((document.body && document.body.innerText) || '').length };
    })()`);
    throw new Error('#btnStart 不存在 ' + JSON.stringify(diag));
  }
  await sleep(800);
  await clickSel('#charGrid .char-card');
  await sleep(400);
  if (!(await clickSel('#btnCharConfirm'))) throw new Error('#btnCharConfirm 不存在');
  await sleep(1200);

  // 生成三种敌人 + 让玩家移动一点，制造可辨识的画面
  await ev(`(() => {
    const d = window.__roamDebug;
    d.centerPlayer();
    d.spawnEnemy('wanderer', 120, -40);
    d.spawnEnemy('sentinel', -140, 30);
    d.spawnEnemy('runesprite', 40, 150);
    return d.getState().enemyList;
  })()`);
  await sleep(700);
  await shot('08_enemies.png');

  // 火球飞行中
  await ev(`(() => { const d = window.__roamDebug; d.setAether(100); d.cast(); return true; })()`);
  await sleep(120);
  await shot('09_fireball.png');
  await sleep(400);

  // 冰环 + 雷击 + 治疗
  await ev(`(() => { const d = window.__roamDebug; d.setAether(100); d.grantMagic('frost'); d.cast(); return true; })()`);
  await sleep(180);
  await shot('10_frost.png');
  await ev(`(() => { const d = window.__roamDebug; d.setAether(100); d.grantMagic('bolt'); d.cast(); return true; })()`);
  await sleep(160);
  await shot('11_bolt.png');
  await ev(`(() => { const d = window.__roamDebug; d.setAether(100); d.grantMagic('heal'); d.setHp(40); d.cast(); return true; })()`);
  await sleep(200);
  await shot('12_heal.png');

  console.log('done');
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
